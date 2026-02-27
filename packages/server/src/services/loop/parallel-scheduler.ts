/**
 * ParallelScheduler — manages concurrent story dispatch when maxParallel > 1.
 *
 * Responsibilities:
 *   - Select eligible stories respecting dependencies and maxParallel
 *   - Ensure each story gets its own worktree (create or reuse for retries)
 *   - Dispatch stories via GolemDispatcher
 *   - Handle completion: trigger auto-merge on success, mark failed on conflict
 *   - Emit SSE events for worktree lifecycle
 *   - Track active executions for status reporting
 *
 * Design:
 *   - Called by LoopRunner when config.maxParallel > 1
 *   - Does NOT replace the runner — the runner still owns the iteration loop,
 *     pause/cancel, heartbeat, and final status. The scheduler handles the
 *     parallel dispatch within each "super-iteration".
 *   - When maxParallel=1, the runner uses its existing serial path (unchanged).
 */

import { EventEmitter } from 'events';
import { nanoid } from 'nanoid';
import { getDb } from '../../db/database';
import type {
  UserStory,
  LoopConfig,
  ExecutionContext,
  ExecutionResult,
  QualityCheckResult,
  StreamLoopEvent,
  GolemPhase,
  GolemMood,
  WorkflowConfig,
  WorktreeRecord,
} from '@e/shared';
import { DEFAULT_WORKFLOW_CONFIG } from '@e/shared';
import { GolemDispatcher } from './dispatcher';
import { PRIORITY_ORDER, storyFromRow } from './helpers';
import * as worktreeService from '../worktree-service';
import * as worktreeMerge from '../worktree-merge';

/** Tracks a single in-flight story execution. */
export interface ActiveStoryExecution {
  storyId: string;
  storyTitle: string;
  executionId: string;
  worktreePath: string;
  branchName: string;
  startedAt: number;
  promise: Promise<StoryExecutionResult>;
}

/** Result of a single parallel story execution (internal). */
export interface StoryExecutionResult {
  storyId: string;
  storyTitle: string;
  executionResult: ExecutionResult;
  qualityPassed: boolean;
  worktreePath: string;
  branchName: string;
}

/**
 * Result returned from runParallelBatch — tells the runner how many
 * stories were dispatched, completed, failed, etc.
 */
export interface ParallelBatchResult {
  dispatched: number;
  completed: number;
  failed: number;
  merged: number;
  conflicts: number;
  /** Story IDs that were dispatched in this batch */
  storyIds: string[];
}

export class ParallelScheduler {
  private activeExecutions = new Map<string, ActiveStoryExecution>();
  private workflowConfig: WorkflowConfig = DEFAULT_WORKFLOW_CONFIG;
  private currentMood: GolemMood = 'neutral';

  constructor(
    private loopId: string,
    private prdId: string | null,
    private workspacePath: string,
    private config: LoopConfig,
    private events: EventEmitter,
    private dispatcher: GolemDispatcher,
  ) {
    this.loadWorkflowConfig();
  }

  /**
   * Get the list of currently active story IDs (for LoopState.activeStoryIds).
   */
  getActiveStoryIds(): string[] {
    return Array.from(this.activeExecutions.keys());
  }

  /**
   * Get the number of currently active executions.
   */
  getActiveCount(): number {
    return this.activeExecutions.size;
  }

  /**
   * Set the current mood (from the runner's mood tracking).
   */
  setMood(mood: GolemMood): void {
    this.currentMood = mood;
  }

  /**
   * Run a batch of parallel story dispatches.
   *
   * 1. Select eligible stories (up to maxParallel - activeCount)
   * 2. For each: ensure worktree → mark in_progress → dispatch
   * 3. Wait for ALL dispatched stories to complete
   * 4. For each completed: handle success (auto-merge) or failure
   * 5. Return batch summary
   *
   * The runner calls this in a loop until no more eligible stories exist.
   */
  async runParallelBatch(
    iteration: number,
    isCancelled: () => boolean,
  ): Promise<ParallelBatchResult> {
    const maxParallel = this.config.maxParallel ?? 1;
    const slotsAvailable = maxParallel - this.activeExecutions.size;

    if (slotsAvailable <= 0) {
      // All slots occupied — wait for current batch to finish
      return this.waitForBatch(isCancelled);
    }

    // Select eligible stories
    const eligible = this.selectEligibleStories(slotsAvailable);
    if (eligible.length === 0) {
      // No eligible stories but may have active executions
      if (this.activeExecutions.size > 0) {
        return this.waitForBatch(isCancelled);
      }
      return { dispatched: 0, completed: 0, failed: 0, merged: 0, conflicts: 0, storyIds: [] };
    }

    const result: ParallelBatchResult = {
      dispatched: 0,
      completed: 0,
      failed: 0,
      merged: 0,
      conflicts: 0,
      storyIds: [],
    };

    // Dispatch each eligible story
    for (const story of eligible) {
      if (isCancelled()) break;

      try {
        const execution = await this.dispatchStory(story, iteration);
        if (execution) {
          this.activeExecutions.set(story.id, execution);
          result.dispatched++;
          result.storyIds.push(story.id);

          // Update loop DB with active story IDs
          this.updateActiveStoryIds();
        }
      } catch (err) {
        console.error(`[parallel:${this.loopId}] Failed to dispatch story "${story.title}":`, err);
        // Mark story as failed if dispatch itself fails
        this.updateStory(story.id, { status: 'failed' });
        result.failed++;
      }
    }

    // Wait for all dispatched stories to complete
    if (this.activeExecutions.size > 0) {
      const batchResult = await this.waitForBatch(isCancelled);
      result.completed += batchResult.completed;
      result.failed += batchResult.failed;
      result.merged += batchResult.merged;
      result.conflicts += batchResult.conflicts;
    }

    return result;
  }

  /**
   * Wait for all currently active executions to complete.
   */
  private async waitForBatch(isCancelled: () => boolean): Promise<ParallelBatchResult> {
    const result: ParallelBatchResult = {
      dispatched: 0,
      completed: 0,
      failed: 0,
      merged: 0,
      conflicts: 0,
      storyIds: [],
    };

    if (this.activeExecutions.size === 0) return result;

    // Collect all active promises
    const entries = Array.from(this.activeExecutions.entries());
    const promises = entries.map(([storyId, exec]) =>
      exec.promise
        .then((res) => ({ storyId, result: res, error: null as Error | null }))
        .catch((err) => ({
          storyId,
          result: null as StoryExecutionResult | null,
          error: err as Error,
        })),
    );

    // Wait for all to settle
    const settled = await Promise.all(promises);

    for (const { storyId, result: execResult, error } of settled) {
      if (isCancelled()) break;

      this.activeExecutions.delete(storyId);
      this.updateActiveStoryIds();

      if (error || !execResult) {
        console.error(`[parallel:${this.loopId}] Story ${storyId} execution error:`, error);
        this.updateStory(storyId, { status: 'failed' });
        result.failed++;
        continue;
      }

      // Handle the execution result
      const handleResult = await this.handleStoryResult(execResult);
      if (handleResult.completed) result.completed++;
      if (handleResult.failed) result.failed++;
      if (handleResult.merged) result.merged++;
      if (handleResult.conflict) result.conflicts++;
    }

    return result;
  }

  /**
   * Select stories eligible for parallel dispatch.
   *
   * Criteria:
   *   - Status: pending or failed_timeout
   *   - attempts < maxAttempts
   *   - Not research-only
   *   - All dependencies completed (or in QA if qaUnblocksDependents)
   *   - Not already being executed
   *
   * Returns at most `limit` stories, sorted by priority then sortOrder.
   */
  selectEligibleStories(limit: number): UserStory[] {
    const stories = this.getAllStories();
    const doneIds = this.getDoneIds(stories);
    const activeIds = new Set(this.activeExecutions.keys());

    const eligible = stories.filter((s) => {
      // Must be pending or timed out (eligible for retry)
      if (s.status !== 'pending' && s.status !== 'failed_timeout') return false;
      // Not already maxed out on attempts
      if (s.attempts >= s.maxAttempts) return false;
      // Not research-only
      if (s.researchOnly) return false;
      // Not already running in parallel
      if (activeIds.has(s.id)) return false;
      // Dependencies satisfied
      const deps = s.dependsOn || [];
      return deps.every((depId) => doneIds.has(depId));
    });

    // Sort by priority, then sortOrder
    eligible.sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority] ?? 2;
      const pb = PRIORITY_ORDER[b.priority] ?? 2;
      if (pa !== pb) return pa - pb;
      return a.sortOrder - b.sortOrder;
    });

    return eligible.slice(0, limit);
  }

  /**
   * Dispatch a single story for parallel execution.
   *
   * 1. Ensure worktree exists (create or reuse for retries)
   * 2. Mark story as in_progress
   * 3. Build execution context
   * 4. Dispatch via GolemDispatcher
   * 5. Return ActiveStoryExecution with the promise
   */
  private async dispatchStory(
    story: UserStory,
    iteration: number,
  ): Promise<ActiveStoryExecution | null> {
    const tag = `[parallel:${this.loopId}]`;

    // Step 1: Ensure worktree
    const worktreeResult = await this.ensureWorktree(story);
    if (!worktreeResult) {
      console.error(`${tag} Failed to ensure worktree for story "${story.title}"`);
      return null;
    }

    const { worktreePath, branchName } = worktreeResult;

    // Step 2: Mark story as in_progress and increment attempts
    this.updateStory(story.id, {
      status: 'in_progress',
      attempts: story.attempts + 1,
    });

    // Emit story_started event
    this.emitEvent('story_started', {
      storyId: story.id,
      storyTitle: story.title,
      iteration,
      activeStories: this.activeExecutions.size + 1,
      maxParallel: this.config.maxParallel ?? 1,
    });

    console.log(
      `${tag} Dispatching story "${story.title}" (attempt ${story.attempts + 1}/${story.maxAttempts}) to worktree: ${worktreePath}`,
    );

    // Step 3: Build execution context
    const executionId = nanoid();
    const checksToRun = this.config.qualityChecks.filter((c) => c.enabled);

    const prompt = this.buildStoryPrompt(story);
    const AGENT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes per story

    const executionContext: ExecutionContext = {
      executionId,
      repoUrl: this.workspacePath,
      branch: branchName,
      workspacePath: worktreePath,
      storyId: story.id,
      storyTitle: story.title,
      prdId: this.prdId,
      prompt,
      systemPrompt: this.buildSystemPrompt(),
      llmConfig: {
        model: this.config.model,
        effort: this.config.effort,
      },
      secretsRefs: {},
      resourceConstraints: {
        maxDurationMs: AGENT_TIMEOUT_MS,
      },
      qualityChecks: checksToRun,
      autoCommit: this.config.autoCommit,
      timeout: AGENT_TIMEOUT_MS,
    };

    // Step 4: Create promise for execution
    const promise = this.executeStory(story, executionContext, worktreePath, branchName, iteration);

    return {
      storyId: story.id,
      storyTitle: story.title,
      executionId,
      worktreePath,
      branchName,
      startedAt: Date.now(),
      promise,
    };
  }

  /**
   * Execute a story and return the result (runs asynchronously).
   */
  private async executeStory(
    story: UserStory,
    context: ExecutionContext,
    worktreePath: string,
    branchName: string,
    iteration: number,
  ): Promise<StoryExecutionResult> {
    const tag = `[parallel:${this.loopId}]`;

    const executionResult = await this.dispatcher.execute(context);

    // Update story with conversation and agent references
    if (executionResult.conversationId) {
      this.updateStory(story.id, { conversationId: executionResult.conversationId });
    }
    if (executionResult.agentId) {
      this.updateStory(story.id, { agentId: executionResult.agentId });
    }

    // Determine if quality checks passed
    const checksToRun = this.config.qualityChecks.filter((c) => c.enabled);
    const requiredChecksFailed = executionResult.qualityResults.some((qr) => {
      const checkConfig = checksToRun.find((c) => c.id === qr.checkId);
      return checkConfig?.required && !qr.passed;
    });

    const hasAgentError = !!executionResult.agentError;
    const qualityPassed = !hasAgentError && !requiredChecksFailed;

    console.log(
      `${tag} Story "${story.title}" execution ${qualityPassed ? 'PASSED' : 'FAILED'} (status: ${executionResult.status})`,
    );

    return {
      storyId: story.id,
      storyTitle: story.title,
      executionResult,
      qualityPassed,
      worktreePath,
      branchName,
    };
  }

  /**
   * Handle the result of a parallel story execution.
   *
   * On success:
   *   - If autoMerge: trigger merge, emit merge events
   *   - Mark story as 'qa'
   *
   * On failure:
   *   - Check if retries remain → mark pending
   *   - Otherwise → mark failed
   */
  private async handleStoryResult(
    result: StoryExecutionResult,
  ): Promise<{ completed: boolean; failed: boolean; merged: boolean; conflict: boolean }> {
    const tag = `[parallel:${this.loopId}]`;
    const { storyId, storyTitle, executionResult, qualityPassed } = result;
    const autoMerge = this.config.autoMerge !== false; // default true

    if (qualityPassed && executionResult.status === 'success') {
      // --- Success path ---

      // Git commit in worktree
      if (this.config.autoCommit) {
        try {
          const sha = await this.gitCommitInWorktree(storyId, storyTitle, result.worktreePath);
          if (sha) {
            this.updateStory(storyId, { commitSha: sha });
          }
        } catch (err) {
          console.error(`${tag} Git commit failed for story "${storyTitle}":`, err);
          // Commit failed — treat as failure
          this.updateStory(storyId, { status: 'pending' });
          this.emitEvent('story_failed', {
            storyId,
            storyTitle,
            message: `Git commit failed: ${String(err)}`,
            willRetry: true,
          });
          return { completed: false, failed: true, merged: false, conflict: false };
        }
      }

      // Auto-merge if configured
      if (autoMerge) {
        this.emitEvent('worktree_merge_started', {
          storyId,
          storyTitle,
          worktreePath: result.worktreePath,
          branchName: result.branchName,
        });

        const mergeResult = await worktreeMerge.merge({
          storyId,
          skipQualityCheck: true, // Already passed checks before merge
        });

        if (mergeResult.ok) {
          // Merge succeeded
          this.emitEvent('worktree_merge_completed', {
            storyId,
            storyTitle,
            commitSha: mergeResult.commitSha,
            worktreePath: result.worktreePath,
            branchName: result.branchName,
          });

          this.updateStory(storyId, { status: 'qa' });
          this.emitEvent('story_completed', {
            storyId,
            storyTitle,
            message: `Merged successfully (${mergeResult.commitSha?.slice(0, 8)})`,
          });

          this.incrementCompleted();
          console.log(`${tag} Story "${storyTitle}" merged successfully`);
          return { completed: true, failed: false, merged: true, conflict: false };
        } else if (mergeResult.conflictingFiles && mergeResult.conflictingFiles.length > 0) {
          // Merge conflict — mark failed but don't block others (AC #6)
          this.emitEvent('worktree_merge_conflict', {
            storyId,
            storyTitle,
            conflictingFiles: mergeResult.conflictingFiles,
            worktreePath: result.worktreePath,
            branchName: result.branchName,
          });

          // Story already marked as failed by worktree-merge handleConflict
          this.incrementFailed();
          this.emitEvent('story_failed', {
            storyId,
            storyTitle,
            message: `Merge conflict in ${mergeResult.conflictingFiles.length} file(s): ${mergeResult.conflictingFiles.join(', ')}`,
            willRetry: false,
          });

          console.warn(
            `${tag} Story "${storyTitle}" has merge conflict — marked failed, others continue`,
          );
          return { completed: false, failed: true, merged: false, conflict: true };
        } else {
          // Merge failed for non-conflict reason — retry
          console.error(`${tag} Merge failed for "${storyTitle}": ${mergeResult.error}`);
          this.updateStory(storyId, { status: 'pending' });
          this.emitEvent('story_failed', {
            storyId,
            storyTitle,
            message: `Merge failed: ${mergeResult.error}`,
            willRetry: true,
          });
          return { completed: false, failed: true, merged: false, conflict: false };
        }
      } else {
        // No auto-merge — mark as qa
        this.updateStory(storyId, { status: 'qa' });
        this.emitEvent('story_completed', { storyId, storyTitle });
        this.incrementCompleted();
        console.log(`${tag} Story "${storyTitle}" completed (no auto-merge)`);
        return { completed: true, failed: false, merged: false, conflict: false };
      }
    } else {
      // --- Failure path ---
      const story = this.getStory(storyId);
      const retriesRemain = story && story.attempts < story.maxAttempts;

      if (retriesRemain) {
        this.updateStory(storyId, { status: 'pending' });
        this.emitEvent('story_failed', {
          storyId,
          storyTitle,
          message: executionResult.agentError || 'Quality checks failed',
          willRetry: true,
        });
        console.log(`${tag} Story "${storyTitle}" failed — will retry`);
      } else {
        this.updateStory(storyId, { status: 'failed' });
        this.incrementFailed();
        this.emitEvent('story_failed', {
          storyId,
          storyTitle,
          message: executionResult.agentError || 'Quality checks failed — no retries remaining',
          willRetry: false,
        });
        console.log(`${tag} Story "${storyTitle}" failed — no retries remaining`);
      }

      // Record learning
      const failedChecks = executionResult.qualityResults.filter((qr) => !qr.passed);
      const learning = executionResult.agentError
        ? `Agent error: ${executionResult.agentError}`
        : `Quality checks failed: ${failedChecks.map((qr) => qr.checkName).join(', ')}`;
      this.recordLearning(storyId, learning);

      return { completed: false, failed: true, merged: false, conflict: false };
    }
  }

  /**
   * Ensure a worktree exists for a story.
   *
   * - If a worktree already exists (retry case), reuse it (AC #7)
   * - Otherwise, create a new one and DB record
   */
  private async ensureWorktree(
    story: UserStory,
  ): Promise<{ worktreePath: string; branchName: string } | null> {
    const tag = `[parallel:${this.loopId}]`;

    // Check for existing worktree (retry reuse — AC #7)
    const existingRecord = worktreeService.getForStory(story.id);
    if (
      existingRecord &&
      (existingRecord.status === 'active' || existingRecord.status === 'conflict')
    ) {
      console.log(
        `${tag} Reusing existing worktree for story "${story.title}" (status: ${existingRecord.status})`,
      );

      // Reset status to active if it was conflict (retry)
      if (existingRecord.status === 'conflict') {
        worktreeService.updateStatus(story.id, 'active');
      }

      return {
        worktreePath: existingRecord.worktree_path,
        branchName: existingRecord.branch_name,
      };
    }

    // Create new worktree
    const createResult = await worktreeService.create({
      workspacePath: this.workspacePath,
      storyId: story.id,
    });

    if (!createResult.ok || !createResult.data) {
      console.error(`${tag} Failed to create worktree for "${story.title}": ${createResult.error}`);
      return null;
    }

    const worktreePath = createResult.data;
    const branchName = `story/${story.id}`;

    // Create DB record
    const recordResult = await worktreeService.createRecord({
      workspacePath: this.workspacePath,
      storyId: story.id,
      prdId: this.prdId,
      worktreePath,
    });

    if (!recordResult.ok) {
      console.error(`${tag} Failed to create worktree record: ${recordResult.error}`);
      // Worktree was created on disk but DB record failed — try to clean up
      await worktreeService.remove(this.workspacePath, story.id);
      return null;
    }

    // Emit worktree_created event (AC #9)
    this.emitEvent('worktree_created', {
      storyId: story.id,
      storyTitle: story.title,
      worktreePath,
      branchName,
      activeStories: this.activeExecutions.size + 1,
      maxParallel: this.config.maxParallel ?? 1,
    });

    console.log(`${tag} Created worktree for "${story.title}" at ${worktreePath}`);
    return { worktreePath, branchName };
  }

  /**
   * Git commit all changes in a worktree.
   */
  private async gitCommitInWorktree(
    storyId: string,
    storyTitle: string,
    worktreePath: string,
  ): Promise<string | null> {
    // Stage all changes
    const addProc = Bun.spawn(['git', 'add', '-A'], {
      cwd: worktreePath,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    await addProc.exited;

    // Check if there are changes to commit
    const statusProc = Bun.spawn(['git', 'status', '--porcelain'], {
      cwd: worktreePath,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const statusOutput = (await new Response(statusProc.stdout).text()).trim();
    await statusProc.exited;

    if (!statusOutput) {
      return null; // Nothing to commit
    }

    // Commit
    const commitProc = Bun.spawn(['git', 'commit', '-m', `[e-work] Implement: ${storyTitle}`], {
      cwd: worktreePath,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME ?? 'e-work',
        GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL ?? 'e-work@localhost',
        GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME ?? 'e-work',
        GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL ?? 'e-work@localhost',
      },
    });
    const commitExit = await commitProc.exited;
    if (commitExit !== 0) {
      const stderr = await new Response(commitProc.stderr).text();
      throw new Error(`git commit failed: ${stderr.trim()}`);
    }

    // Get commit SHA
    const shaProc = Bun.spawn(['git', 'rev-parse', 'HEAD'], {
      cwd: worktreePath,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const sha = (await new Response(shaProc.stdout).text()).trim();
    await shaProc.exited;

    return sha || null;
  }

  // --- Helper methods ---

  private loadWorkflowConfig(): void {
    if (!this.prdId) return;
    try {
      const db = getDb();
      const row = db.query('SELECT workflow_config FROM prds WHERE id = ?').get(this.prdId) as any;
      if (row?.workflow_config) {
        const parsed = JSON.parse(row.workflow_config);
        if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
          this.workflowConfig = { ...DEFAULT_WORKFLOW_CONFIG, ...parsed };
        }
      }
    } catch {
      /* use defaults */
    }
  }

  private getDoneIds(stories: UserStory[]): Set<string> {
    return new Set(
      stories
        .filter(
          (s) =>
            s.status === 'completed' ||
            (this.workflowConfig.qaUnblocksDependents && s.status === 'qa'),
        )
        .map((s) => s.id),
    );
  }

  private getAllStories(): UserStory[] {
    const db = getDb();
    let rows: any[];
    if (this.prdId) {
      rows = db
        .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order ASC')
        .all(this.prdId) as any[];
    } else {
      rows = db
        .query(
          'SELECT * FROM prd_stories WHERE prd_id IS NULL AND workspace_path = ? ORDER BY sort_order ASC',
        )
        .all(this.workspacePath) as any[];
    }
    return rows.map(storyFromRow);
  }

  private getStory(storyId: string): UserStory | null {
    const db = getDb();
    const row = db.query('SELECT * FROM prd_stories WHERE id = ?').get(storyId) as any;
    return row ? storyFromRow(row) : null;
  }

  private updateStory(storyId: string, updates: Record<string, any>): void {
    const db = getDb();
    const fieldMap: Record<string, string> = {
      status: 'status',
      agentId: 'agent_id',
      conversationId: 'conversation_id',
      commitSha: 'commit_sha',
      attempts: 'attempts',
    };

    const setClauses: string[] = [];
    const values: any[] = [];

    for (const [key, value] of Object.entries(updates)) {
      const col = fieldMap[key] || key;
      setClauses.push(`${col} = ?`);
      values.push(value);
    }

    setClauses.push('updated_at = ?');
    values.push(Date.now());
    values.push(storyId);

    db.query(`UPDATE prd_stories SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
  }

  private updateActiveStoryIds(): void {
    const db = getDb();
    const activeIds = this.getActiveStoryIds();
    db.query('UPDATE loops SET active_story_ids = ? WHERE id = ?').run(
      JSON.stringify(activeIds),
      this.loopId,
    );
  }

  private incrementCompleted(): void {
    const db = getDb();
    const row = db
      .query('SELECT total_stories_completed FROM loops WHERE id = ?')
      .get(this.loopId) as any;
    db.query('UPDATE loops SET total_stories_completed = ? WHERE id = ?').run(
      (row?.total_stories_completed || 0) + 1,
      this.loopId,
    );
  }

  private incrementFailed(): void {
    const db = getDb();
    const row = db
      .query('SELECT total_stories_failed FROM loops WHERE id = ?')
      .get(this.loopId) as any;
    db.query('UPDATE loops SET total_stories_failed = ? WHERE id = ?').run(
      (row?.total_stories_failed || 0) + 1,
      this.loopId,
    );
  }

  private recordLearning(storyId: string, learning: string): void {
    try {
      const db = getDb();
      const row = db.query('SELECT learnings FROM prd_stories WHERE id = ?').get(storyId) as any;
      const learnings: string[] = JSON.parse(row?.learnings || '[]');
      learnings.push(learning);
      db.query('UPDATE prd_stories SET learnings = ?, updated_at = ? WHERE id = ?').run(
        JSON.stringify(learnings),
        Date.now(),
        storyId,
      );
    } catch {
      /* non-critical */
    }
  }

  private emitEvent(event: StreamLoopEvent['event'], data: StreamLoopEvent['data']): void {
    const evt: StreamLoopEvent = {
      type: 'loop_event',
      loopId: this.loopId,
      event,
      data: { ...data, mood: this.currentMood },
    };
    this.events.emit('loop_event', evt);
  }

  private buildSystemPrompt(): string {
    let prompt = `You are an autonomous AI agent implementing user stories for a software project.

## Instructions
1. Read the user story carefully, including all acceptance criteria
2. Implement the story completely — make all necessary code changes
3. Ensure every acceptance criterion is met
4. Follow existing project conventions and patterns
5. Write clean, well-structured code
6. Do NOT ask questions — make reasonable decisions and document them
7. After implementation, the system will automatically run quality checks
8. IMPORTANT: Before declaring you are done, run the project's typecheck/build commands yourself to catch errors early
9. If this is a monorepo, ensure your changes maintain type compatibility across packages (especially shared types)
10. Do NOT leave placeholder implementations, stubs, TODOs, or empty function bodies.
11. When writing or modifying tests, include a brief comment above each test explaining WHY the test exists.

## Critical: Story Management Rules
- You are assigned ONE specific story. Do NOT attempt to implement other stories.
- Do NOT use story management tools to change the status of ANY story.
- Your job is solely to implement the assigned story and make the code changes required by its acceptance criteria.`;

    return prompt;
  }

  private buildStoryPrompt(story: UserStory): string {
    const criteria = story.acceptanceCriteria
      .map((ac, i) => `${i + 1}. ${ac.description}`)
      .join('\n');

    let prompt = `## User Story: ${story.title}

${story.description}

## Acceptance Criteria
${criteria}

## Attempt ${story.attempts + 1} of ${story.maxAttempts}`;

    // Add learnings from previous attempts
    if (story.learnings.length > 0) {
      prompt += '\n\n## Learnings from Previous Attempts\n';
      for (const learning of story.learnings) {
        prompt += `- ${learning}\n`;
      }
      prompt += '\nPlease address these issues in this attempt. Do not repeat the same mistakes.';
    }

    return prompt;
  }
}
