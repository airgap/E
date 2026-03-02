import { EventEmitter } from 'events';
import { nanoid } from 'nanoid';
import { getDb } from '../../db/database';
import { runAllQualityChecks, validateQualityChecks } from '../quality-checker';
import { resolveWorkspacePath } from '../worktree-service';
import { sendNotification } from '../notification-channels';
import type {
  LoopConfig,
  IterationLogEntry,
  QualityCheckConfig,
  QualityCheckResult,
  UserStory,
  AttemptResult,
  StreamLoopEvent,
  AgentNote,
  StreamAgentNoteCreated,
  GolemPhase,
  GolemMood,
  WorkflowConfig,
  ExecutionContext,
  ExecutionResult,
} from '@e/shared';
import { DEFAULT_WORKFLOW_CONFIG } from '@e/shared';
import { PRIORITY_ORDER, storyFromRow } from './helpers';
import { GolemDispatcher } from './dispatcher';
import { ParallelScheduler } from './parallel-scheduler';

/**
 * Drives a single loop execution. Manages the iteration cycle, story selection,
 * agent spawning, quality checks, and progress tracking.
 */
export class LoopRunner {
  private cancelled = false;
  private pauseGate: { promise: Promise<void>; resolve: () => void } | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Tracks per-story fix-up state. When a story fails quality checks, we keep
   * the broken code in place and give the agent multiple chances to fix it
   * surgically ("fix-up" passes) before reverting and starting a fresh attempt.
   *
   * Each fresh attempt gets up to `config.maxFixUpAttempts` sub-attempts.
   * Fix-up passes do NOT consume the story's main attempt counter.
   *
   * Map key: story ID
   * Map value: { subAttempts count, lastResults from most recent failure }
   */
  private fixUpState = new Map<
    string,
    { subAttempts: number; lastResults: QualityCheckResult[] }
  >();

  /** Golem mood tracker — derives from recent success/failure patterns */
  private recentOutcomes: Array<'success' | 'failure'> = [];
  private currentMood: GolemMood = 'neutral';

  /** Cached workflow config for the PRD (loaded once at run start) */
  private workflowConfig: WorkflowConfig = DEFAULT_WORKFLOW_CONFIG;

  /**
   * Tracks failure signatures per story to detect identical repeated failures.
   * Key: storyId, Value: array of failure signature hashes.
   * When the same signature appears 3+ times, the story is auto-skipped.
   */
  private failureSignatures = new Map<string, string[]>();

  /**
   * Baseline quality check error fingerprints, captured once at loop start.
   * Used to diff post-story check results and only surface NEW errors
   * the agent introduced — pre-existing errors are filtered out.
   * Key: checkId, Value: set of error line fingerprints.
   */
  private baselineErrors = new Map<string, Set<string>>();

  /** Golem dispatcher — selects and delegates to the appropriate executor. */
  private dispatcher: GolemDispatcher;

  /** Parallel scheduler — manages concurrent story dispatch when maxParallel > 1. */
  private parallelScheduler: ParallelScheduler | null = null;

  constructor(
    private loopId: string,
    private prdId: string | null,
    private workspacePath: string,
    private config: LoopConfig,
    private events: EventEmitter,
    dispatcher?: GolemDispatcher,
  ) {
    this.dispatcher = dispatcher ?? new GolemDispatcher();

    // Initialize parallel scheduler when maxParallel > 1
    const maxParallel = this.config.maxParallel ?? 1;
    if (maxParallel > 1) {
      this.parallelScheduler = new ParallelScheduler(
        loopId,
        prdId,
        workspacePath,
        config,
        events,
        this.dispatcher,
      );
    }
  }

  /**
   * Resolve the effective CWD for a story — returns the worktree path
   * if the story has an active worktree, otherwise falls back to workspacePath.
   */
  private resolveStoryCwd(storyId: string): string {
    return resolveWorkspacePath(this.workspacePath, storyId);
  }

  /**
   * Extract error fingerprints from quality check output.
   * Each fingerprint is a normalized error line (file:line:message pattern).
   */
  private extractErrorFingerprints(output: string): Set<string> {
    const fingerprints = new Set<string>();
    // Strip ANSI for consistent comparison
    // eslint-disable-next-line no-control-regex
    const clean = output.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
    for (const line of clean.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Match common error patterns: file:line:col, TS errors, etc.
      if (/\.(ts|js|svelte|tsx|jsx)[:()]\d+/.test(trimmed) || /\bTS\d{4,5}\b/.test(trimmed)) {
        fingerprints.add(trimmed);
      }
    }
    return fingerprints;
  }

  /**
   * Capture baseline error fingerprints from current quality check state.
   * Called once at loop start before any stories are modified.
   */
  private async captureBaseline(checks: QualityCheckConfig[]): Promise<void> {
    const enabledChecks = checks.filter((c) => c.enabled);
    if (enabledChecks.length === 0) return;

    console.log(`[loop:${this.loopId}] Capturing baseline quality check state...`);
    const results = await runAllQualityChecks(enabledChecks, this.workspacePath);
    for (const result of results) {
      if (!result.passed) {
        const fingerprints = this.extractErrorFingerprints(result.output);
        if (fingerprints.size > 0) {
          this.baselineErrors.set(result.checkId, fingerprints);
          console.log(
            `[loop:${this.loopId}] Baseline: ${result.checkName} has ${fingerprints.size} pre-existing error(s)`,
          );
        }
      }
    }
  }

  /**
   * Filter quality check results to only show errors the agent introduced.
   * Pre-existing errors (from the baseline) are stripped from the output
   * and the result is re-evaluated — if all remaining errors were pre-existing,
   * the check is marked as passed.
   */
  private diffAgainstBaseline(results: QualityCheckResult[]): QualityCheckResult[] {
    return results.map((result) => {
      if (result.passed) return result;

      const baselineFingerprints = this.baselineErrors.get(result.checkId);
      if (!baselineFingerprints || baselineFingerprints.size === 0) return result;

      // Extract current error fingerprints
      const currentFingerprints = this.extractErrorFingerprints(result.output);

      // Find genuinely new errors (not in baseline)
      const newErrors = new Set<string>();
      for (const fp of currentFingerprints) {
        if (!baselineFingerprints.has(fp)) {
          newErrors.add(fp);
        }
      }

      if (newErrors.size === 0 && currentFingerprints.size > 0) {
        // All errors were pre-existing — treat as passed
        console.log(
          `[loop:${this.loopId}] Baseline diff: ${result.checkName} — all ${currentFingerprints.size} error(s) are pre-existing, treating as passed`,
        );
        return {
          ...result,
          passed: true,
          output:
            result.output + '\n\n[baseline-diff] All errors were pre-existing, treating as passed.',
        };
      }

      if (newErrors.size < currentFingerprints.size) {
        // Some errors are new, some pre-existing — filter output to only show new ones
        const filteredLines = result.output.split('\n').filter((line) => {
          const trimmed = line.trim();
          // Keep the line if it's a new error or non-error context
          if (baselineFingerprints.has(trimmed)) return false;
          return true;
        });

        console.log(
          `[loop:${this.loopId}] Baseline diff: ${result.checkName} — ${newErrors.size} new error(s) out of ${currentFingerprints.size} total`,
        );
        return {
          ...result,
          output:
            `[baseline-diff] ${newErrors.size} new error(s), ${currentFingerprints.size - newErrors.size} pre-existing (filtered out):\n` +
            filteredLines.join('\n'),
        };
      }

      return result;
    });
  }

  /**
   * Compute a simple hash of quality check failure output to detect identical
   * repeated failures. Uses the check names and first 500 chars of each error.
   */
  private computeFailureSignature(qualityResults: QualityCheckResult[]): string {
    const failed = qualityResults.filter((qr) => !qr.passed);
    const parts = failed.map((qr) => `${qr.checkName}:${qr.output.trim().slice(0, 500)}`);
    // Simple string-based hash for comparison
    return parts.sort().join('|||');
  }

  /**
   * Track a failure signature for a story. Returns true if the story has
   * failed with an identical signature 3+ times and should be auto-skipped.
   */
  private trackFailureSignature(storyId: string, qualityResults: QualityCheckResult[]): boolean {
    const signature = this.computeFailureSignature(qualityResults);
    if (!signature) return false;

    const existing = this.failureSignatures.get(storyId) || [];
    existing.push(signature);
    this.failureSignatures.set(storyId, existing);

    // Count how many times this exact signature has appeared
    const identicalCount = existing.filter((s) => s === signature).length;
    return identicalCount >= 3;
  }

  /** Load workflow config from the PRD (if any). Falls back to defaults. */
  private loadWorkflowConfig(): void {
    if (!this.prdId) return; // standalone loop — use defaults
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

  /**
   * Returns the set of story IDs considered "done" for dependency resolution.
   * When qaUnblocksDependents is true, 'qa' counts as done alongside 'completed'.
   */
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

  /** Emit a golem thought event — tells the UI what the golem is thinking/doing */
  private emitThought(
    thought: string,
    phase: GolemPhase,
    extra?: Partial<StreamLoopEvent['data']>,
  ): void {
    this.emitEvent('golem_thought', {
      thought,
      phase,
      mood: this.currentMood,
      ...extra,
    });
  }

  /** Update mood based on recent outcomes */
  private updateMood(outcome?: 'success' | 'failure'): void {
    if (outcome) {
      this.recentOutcomes.push(outcome);
      if (this.recentOutcomes.length > 5) this.recentOutcomes.shift();
    }

    const successes = this.recentOutcomes.filter((o) => o === 'success').length;
    const failures = this.recentOutcomes.filter((o) => o === 'failure').length;
    const total = this.recentOutcomes.length;

    if (total === 0) {
      this.currentMood = 'focused';
    } else if (successes >= 3) {
      this.currentMood = 'excited';
    } else if (successes > failures) {
      this.currentMood = 'proud';
    } else if (failures >= 3) {
      this.currentMood = 'frustrated';
    } else if (failures > successes) {
      this.currentMood = 'worried';
    } else {
      this.currentMood = 'determined';
    }
  }

  /** Update heartbeat timestamp so zombie recovery knows we're alive. */
  private sendHeartbeat(): void {
    try {
      const db = getDb();
      db.query('UPDATE loops SET last_heartbeat = ? WHERE id = ?').run(Date.now(), this.loopId);
    } catch {
      /* best effort */
    }
  }

  /** Start periodic heartbeat (every 15s). */
  private startHeartbeat(): void {
    this.sendHeartbeat();
    this.heartbeatInterval = setInterval(() => this.sendHeartbeat(), 15_000);
  }

  /** Stop periodic heartbeat. */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  async run(): Promise<void> {
    const db = getDb();
    let iteration = 0;
    let noStoryNullCount = 0; // Tracks consecutive times selectNextStory returned null
    const mode = this.prdId ? `PRD:${this.prdId}` : 'standalone';

    console.log(
      `[loop:${this.loopId}] Starting ${mode} loop (maxIter=${this.config.maxIterations})`,
    );

    this.startHeartbeat();
    this.loadWorkflowConfig();
    this.updateMood();
    this.emitThought('Waking up... scanning the backlog', 'idle');

    // Apply maxAttemptsPerStory from loop config to all stories.
    // Stories have their own max_attempts (default 3), but the loop config
    // should override this so the user's setting actually takes effect.
    this.applyMaxAttemptsConfig();

    // Pre-flight: validate quality check commands exist before burning attempts.
    // This catches misconfigured checks (e.g. "Script not found") and auto-disables them.
    if (this.config.qualityChecks.length > 0) {
      this.emitThought('Validating quality check commands...', 'pre_check');
      try {
        const { warnings, disabledCheckIds } = await validateQualityChecks(
          this.config.qualityChecks,
          this.workspacePath,
        );
        if (warnings.length > 0) {
          for (const w of warnings) {
            this.addLogEntry({
              iteration: 0,
              storyId: '',
              storyTitle: '',
              action: 'quality_check',
              detail: `Pre-flight validation: ${w}`,
              timestamp: Date.now(),
            });
          }
          console.log(
            `[loop:${this.loopId}] Pre-flight: disabled ${disabledCheckIds.length} misconfigured quality check(s)`,
          );
        }
      } catch (err) {
        console.warn(`[loop:${this.loopId}] Quality check validation failed (non-fatal):`, err);
      }
    }

    // Capture baseline quality check state BEFORE any stories are modified.
    // Used to diff post-story results and only surface new errors.
    if (this.config.qualityChecks.some((c) => c.enabled)) {
      this.emitThought('Capturing baseline quality check state...', 'pre_check');
      try {
        await this.captureBaseline(this.config.qualityChecks);
      } catch (err) {
        console.warn(`[loop:${this.loopId}] Baseline capture failed (non-fatal):`, err);
      }
    }

    // Ensure maxIterations is large enough to actually complete all stories.
    // Each story may need up to maxAttemptsPerStory fresh starts, and each
    // fresh start may need up to (1 + maxFixUpAttempts) iterations (the initial
    // attempt plus fix-up passes). Auto-increase if the budget is too low.
    const stories = this.getAllStories();
    // Only count stories that are actually eligible to be picked up (or currently running).
    // 'failed', 'archived', 'skipped', 'qa', 'completed' stories won't be selected by
    // selectNextStory(), so including them inflates the budget unnecessarily.
    const nonTerminalStories = stories.filter(
      (s) =>
        (s.status === 'pending' || s.status === 'in_progress' || s.status === 'failed_timeout') &&
        !s.researchOnly,
    );
    const maxAttempts = this.config.maxAttemptsPerStory || 3;
    const maxFixUps = this.config.maxFixUpAttempts ?? 2;
    const iterationsPerAttempt = 1 + maxFixUps; // initial + fix-ups
    const minIterationsNeeded = nonTerminalStories.length * maxAttempts * iterationsPerAttempt;
    if (this.config.maxIterations < minIterationsNeeded) {
      console.log(
        `[loop:${this.loopId}] Auto-increasing maxIterations from ${this.config.maxIterations} to ${minIterationsNeeded} (${nonTerminalStories.length} stories × ${maxAttempts} attempts × ${iterationsPerAttempt} iterations/attempt)`,
      );
      this.config.maxIterations = minIterationsNeeded;
    }

    // --- Parallel dispatch path ---
    // When maxParallel > 1, use the parallel scheduler to dispatch multiple
    // stories concurrently via worktrees. Each story gets its own worktree
    // and golem. Completion triggers quality checks + auto-merge.
    if (this.parallelScheduler) {
      try {
        await this.runParallel();
      } finally {
        this.stopHeartbeat();
      }
      return;
    }

    // --- Serial dispatch path (maxParallel=1, unchanged behavior) ---
    try {
      while (iteration < this.config.maxIterations && !this.cancelled) {
        // Check pause gate
        await this.checkPauseGate();
        if (this.cancelled) break;

        // Update heartbeat at the start of each iteration
        this.sendHeartbeat();

        // Recover any orphaned in_progress stories before selecting next.
        // Wrapped in try/catch so a transient DB issue doesn't crash the loop.
        try {
          this.recoverOrphanedStories();
        } catch (recoverErr) {
          console.error(
            `[loop:${this.loopId}] recoverOrphanedStories() failed (non-fatal):`,
            recoverErr,
          );
        }

        // Select next story.
        // If selectNextStory() returns null, it could be a transient issue (e.g. the
        // previous story's status update hasn't settled). Retry once after a brief
        // delay before deciding the loop is truly done.
        this.emitThought('Scanning backlog for the next story...', 'selecting_story');
        let story: UserStory | null = null;
        try {
          story = this.selectNextStory();
        } catch (selectErr) {
          console.error(`[loop:${this.loopId}] selectNextStory() threw:`, selectErr);
          // Wait and retry once — if it fails again we'll handle it in the next iteration
          await new Promise((r) => setTimeout(r, 2000));
          try {
            story = this.selectNextStory();
          } catch (retryErr) {
            console.error(`[loop:${this.loopId}] selectNextStory() retry also failed:`, retryErr);
            // Continue to next iteration — the while condition may still allow us to try again
            continue;
          }
        }

        if (!story) {
          // No story selected. Before giving up, wait briefly and retry once.
          // This handles the race where a story was just marked completed but the
          // DB read for the next story happens before the write is visible (unlikely
          // in SQLite, but defensive against other transient issues).
          await new Promise((r) => setTimeout(r, 1000));
          try {
            story = this.selectNextStory();
          } catch {
            /* handled below */
          }
        }

        if (!story) {
          // Wrap exit-path logic in try/catch — an unhandled error here (e.g. from
          // getAllStories() or storyFromRow() JSON parsing) would crash the entire
          // loop, which was the root cause of silent loop termination after one story.
          let stories: UserStory[] = [];
          try {
            stories = this.getAllStories();
          } catch (exitErr) {
            console.error(
              `[loop:${this.loopId}] getAllStories() threw in exit path (non-fatal):`,
              exitErr,
            );
            // Transient DB error — retry on next iteration instead of crashing
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          }

          console.log(
            `[loop:${this.loopId}] No eligible story. ${stories.length} total stories: ${stories.map((s) => `${s.title}[${s.status}:${s.attempts}/${s.maxAttempts}${s.researchOnly ? ':research' : ''}]`).join(', ')}`,
          );

          // Guard: empty stories array means the query returned nothing (possibly
          // a workspace_path mismatch or DB transient issue). [].every() returns
          // true which would incorrectly mark the loop as "completed".
          if (stories.length === 0) {
            // Retry a few times before giving up — the stories might reappear
            // (e.g. after a concurrent workspace_path update settles).
            noStoryNullCount++;
            if (noStoryNullCount < 3) {
              console.warn(
                `[loop:${this.loopId}] getAllStories() returned empty (attempt ${noStoryNullCount}/3). Retrying...`,
              );
              await new Promise((r) => setTimeout(r, 3000));
              continue;
            }
            console.warn(
              `[loop:${this.loopId}] getAllStories() returned empty after ${noStoryNullCount} attempts — cannot determine loop state. Marking as failed.`,
            );
            this.updateLoopDb({
              status: 'failed',
              completed_at: Date.now(),
              current_story_id: null,
              current_agent_id: null,
            });
            this.emitEvent('failed', {
              message:
                'No stories found. They may have been deleted or the workspace path changed.',
            });
            this.events.emit('loop_done', this.loopId);
            return;
          }

          const allCompleted = stories.every(
            (s) =>
              s.status === 'completed' ||
              s.status === 'qa' ||
              s.status === 'skipped' ||
              s.status === 'archived' ||
              s.status === 'pending_merge' ||
              s.researchOnly,
          );

          if (allCompleted) {
            this.updateLoopDb({
              status: 'completed',
              completed_at: Date.now(),
              current_story_id: null,
              current_agent_id: null,
            });
            this.emitEvent('completed', { message: 'All stories completed!' });

            // Send notification for loop completion
            sendNotification({
              event: 'golem_completion',
              title: 'Loop Completed',
              message: `All ${stories.length} stories completed successfully!`,
              workspaceId: this.workspacePath,
            }).catch((err) => {
              console.error(
                `[loop:${this.loopId}] Failed to send golem_completion notification:`,
                err,
              );
            });

            this.events.emit('loop_done', this.loopId);
            return;
          }

          // Check if any stories are still in_progress (shouldn't happen after recovery, but guard)
          const hasInProgress = stories.some((s) => s.status === 'in_progress');
          if (hasInProgress) {
            console.warn(
              `[loop:${this.loopId}] Stories still in_progress after recovery — forcing reset`,
            );
            for (const s of stories.filter((s) => s.status === 'in_progress')) {
              if (s.attempts >= s.maxAttempts) {
                this.updateStory(s.id, { status: 'failed' });
              } else {
                this.updateStory(s.id, { status: 'pending' });
              }
            }
            // Retry selection after forced reset
            continue;
          }

          // Check if there are pending stories that SHOULD be eligible (no unmet deps,
          // attempts < maxAttempts, not researchOnly). If selectNextStory() returned
          // null but these exist, it's a transient issue — retry instead of quitting.
          const doneIds = this.getDoneIds(stories);
          const pendingEligible = stories.filter(
            (s) =>
              (s.status === 'pending' || s.status === 'failed_timeout') &&
              s.attempts < s.maxAttempts &&
              !s.researchOnly &&
              (s.dependsOn || []).every((depId) => doneIds.has(depId)),
          );
          if (pendingEligible.length > 0) {
            noStoryNullCount++;
            console.warn(
              `[loop:${this.loopId}] selectNextStory() returned null but ${pendingEligible.length} pending eligible stories exist (null-streak ${noStoryNullCount}): ${pendingEligible.map((s) => `"${s.title}"[attempts=${s.attempts}/${s.maxAttempts}]`).join(', ')}. Retrying...`,
            );
            // Brief delay then retry on next iteration
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          }

          // Check if there are pending stories with unmet dependencies — they're
          // not eligible yet but may become eligible as other stories complete.
          // However, since no eligible stories exist to unblock them, this is a deadlock.
          const hasPendingWithDeps = stories.some(
            (s) =>
              s.status === 'pending' &&
              s.attempts < s.maxAttempts &&
              !s.researchOnly &&
              (s.dependsOn || []).length > 0,
          );
          if (hasPendingWithDeps) {
            console.warn(
              `[loop:${this.loopId}] Pending stories exist with unmet dependencies — cannot proceed. Marking loop as failed.`,
            );
          }

          // No eligible stories left (all failed/maxed out or blocked by deps).
          // Tell the UI that the backlog is empty before we wind down.
          const exhaustedStories = stories.filter(
            (s) => s.status === 'pending' && s.attempts >= s.maxAttempts && !s.researchOnly,
          );
          const blockedStories = stories.filter(
            (s) =>
              s.status === 'pending' &&
              s.attempts < s.maxAttempts &&
              !s.researchOnly &&
              (s.dependsOn || []).length > 0 &&
              !(s.dependsOn || []).every((depId) => doneIds.has(depId)),
          );
          const reason =
            exhaustedStories.length > 0
              ? `${exhaustedStories.length} story(ies) exhausted max attempts`
              : blockedStories.length > 0
                ? `${blockedStories.length} story(ies) blocked by unmet dependencies`
                : 'All stories processed';
          this.emitThought(`No eligible stories — ${reason}`, 'backlog_empty');

          // Distinguish full success / partial success / total failure.
          const completedCount = stories.filter(
            (s) =>
              s.status === 'completed' ||
              s.status === 'qa' ||
              s.status === 'skipped' ||
              s.status === 'archived' ||
              s.researchOnly,
          ).length;
          const failedStoryCount = stories.filter((s) => s.status === 'failed').length;
          const endStatus =
            failedStoryCount === 0 && completedCount === stories.length
              ? 'completed'
              : completedCount > 0
                ? 'completed_with_failures'
                : 'failed';

          this.updateLoopDb({
            status: endStatus,
            completed_at: Date.now(),
            current_story_id: null,
            current_agent_id: null,
          });
          this.emitEvent(endStatus === 'failed' ? 'failed' : 'completed', {
            message:
              endStatus === 'completed'
                ? 'All stories completed!'
                : endStatus === 'completed_with_failures'
                  ? `Finished with partial success: ${completedCount} completed, ${failedStoryCount} failed.`
                  : 'No more eligible stories. Some stories could not be completed.',
          });

          // Send appropriate notification
          if (endStatus === 'completed') {
            sendNotification({
              event: 'golem_completion',
              title: 'Loop Completed',
              message: `All ${stories.length} stories completed successfully!`,
              workspaceId: this.workspacePath,
            }).catch((err) => {
              console.error(
                `[loop:${this.loopId}] Failed to send golem_completion notification:`,
                err,
              );
            });
          } else {
            const failedCount = stories.filter((s) => s.status === 'failed').length;
            sendNotification({
              event: 'golem_failure',
              title:
                endStatus === 'completed_with_failures'
                  ? 'Loop Partially Completed'
                  : 'Loop Failed',
              message:
                endStatus === 'completed_with_failures'
                  ? `Loop finished: ${completedCount} completed, ${failedCount} failed.`
                  : `Loop completed with ${failedCount} failed story(ies). No more eligible stories to process.`,
              workspaceId: this.workspacePath,
            }).catch((err) => {
              console.error(
                `[loop:${this.loopId}] Failed to send golem_failure notification:`,
                err,
              );
            });
          }

          this.events.emit('loop_done', this.loopId);
          return;
        }

        // Story selected — reset the null-streak counter
        noStoryNullCount = 0;

        iteration++;
        console.log(
          `[loop:${this.loopId}] Iteration ${iteration}: "${story.title}" (attempt ${story.attempts + 1}/${story.maxAttempts})`,
        );

        try {
          // === Begin iteration try block ===
          const checksToRun = this.config.qualityChecks.filter((c) => c.enabled);

          this.updateLoopDb({
            current_iteration: iteration,
            current_story_id: story.id,
            total_iterations: iteration,
          });

          this.emitEvent('iteration_start', {
            storyId: story.id,
            storyTitle: story.title,
            iteration,
          });

          const isStoryFixUp = this.fixUpState.has(story.id);
          const fixUpInfo = isStoryFixUp ? this.fixUpState.get(story.id)! : null;
          const maxFixUps = this.config.maxFixUpAttempts ?? 2;

          // Emit golem thought about the new story
          if (isStoryFixUp) {
            this.emitThought(
              `Fix-up pass ${fixUpInfo!.subAttempts}/${maxFixUps} for "${story.title}" — patching errors`,
              'fixing_up',
              {
                storyId: story.id,
                storyTitle: story.title,
                iteration,
                attempt: story.attempts,
                maxAttempts: story.maxAttempts,
                fixUpAttempt: fixUpInfo!.subAttempts,
                maxFixUpAttempts: maxFixUps,
              },
            );
          } else {
            this.emitThought(
              `Starting "${story.title}" — attempt ${story.attempts + 1}/${story.maxAttempts}`,
              'preparing',
              {
                storyId: story.id,
                storyTitle: story.title,
                iteration,
                attempt: story.attempts + 1,
                maxAttempts: story.maxAttempts,
              },
            );
          }

          this.addLogEntry({
            iteration,
            storyId: story.id,
            storyTitle: story.title,
            action: 'started',
            detail: isStoryFixUp
              ? `Fix-up pass ${fixUpInfo!.subAttempts}/${maxFixUps} for: ${story.title} (attempt ${story.attempts}/${story.maxAttempts}) — fixing errors in-place`
              : `Starting story: ${story.title} (attempt ${story.attempts + 1}/${story.maxAttempts})`,
            timestamp: Date.now(),
          });

          // Mark story as in_progress.
          // Only increment the attempt counter on fresh starts, NOT fix-up passes.
          // Fix-ups are sub-attempts within a single main attempt.
          if (isStoryFixUp) {
            this.updateStory(story.id, { status: 'in_progress' });
          } else {
            this.updateStory(story.id, { status: 'in_progress', attempts: story.attempts + 1 });
          }

          // Pre-generate assistant message ID for snapshot linkage
          const assistantMsgId = nanoid();

          // Create git snapshot if configured, linked to the upcoming assistant message
          if (this.config.autoSnapshot) {
            this.emitThought('Taking a snapshot of the current state...', 'snapshot', {
              storyId: story.id,
              storyTitle: story.title,
            });
            try {
              await this.createGitSnapshot(story.id, assistantMsgId);
            } catch (err) {
              console.error(`[loop:${this.loopId}] Git snapshot failed:`, err);
            }
          }

          // Pre-story quality gate: if the build is already broken (e.g. from a
          // previous story's uncommitted failure), clean the working tree before
          // the agent starts. This prevents cascading failures where story B gets
          // blamed for story A's broken code.
          //
          // EXCEPTION: skip this gate when we intentionally kept broken code for a
          // fix-up pass on this same story — the agent needs that code in-place.
          const isFixUpPass = this.fixUpState.has(story.id);
          if (checksToRun.length > 0 && !isFixUpPass) {
            this.emitThought('Running pre-flight quality checks...', 'pre_check', {
              storyId: story.id,
              storyTitle: story.title,
            });
            const preCheckResults = await runAllQualityChecks(checksToRun, this.workspacePath, {
              storyId: story.id,
            });
            const preBuildBroken = preCheckResults.some((qr) => {
              const cfg = checksToRun.find((c) => c.id === qr.checkId);
              return cfg?.required && !qr.passed;
            });
            if (preBuildBroken) {
              const failedChecks = preCheckResults
                .filter((qr) => {
                  const cfg = checksToRun.find((c) => c.id === qr.checkId);
                  return cfg?.required && !qr.passed;
                })
                .map((qr) => qr.checkName)
                .join(', ');

              console.error(
                `[loop:${this.loopId}] FATAL: Pre-story quality gate failed — build is already broken (${failedChecks}). Cannot proceed with golem execution.`,
              );
              this.addLogEntry({
                iteration,
                storyId: story.id,
                storyTitle: story.title,
                action: 'quality_check',
                detail: `Pre-story gate: build already broken (${failedChecks}). Loop terminated.`,
                timestamp: Date.now(),
                qualityResults: preCheckResults,
              });
              await this.revertUncommittedChanges(story.id);

              // Fail the loop immediately - cannot execute stories on a broken build
              this.updateLoopDb({
                status: 'failed',
                completed_at: Date.now(),
                current_story_id: null,
                current_agent_id: null,
              });
              this.emitEvent('failed', {
                message: `Build is broken before golem started. Quality checks failed: ${failedChecks}. Fix the errors and try again.`,
              });
              this.events.emit('loop_done', this.loopId);
              return;
            }
          } else if (isFixUpPass) {
            console.log(
              `[loop:${this.loopId}] Skipping pre-story quality gate — fix-up pass for "${story.title}"`,
            );
          }

          // Build the prompt and execution context
          const prompt = this.buildStoryPrompt(story);
          const AGENT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes per story

          const executionContext: ExecutionContext = {
            executionId: nanoid(),
            repoUrl: this.workspacePath,
            branch: 'HEAD',
            workspacePath: this.workspacePath,
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

          // Dispatch execution to the appropriate executor via the Golem Dispatcher.
          // The executor handles: conversation creation, agent spawning, stream reading,
          // and quality check execution. The runner handles: result evaluation, fix-up
          // state, commit/revert, status updates, and notifications.
          this.emitThought(`Summoning agent to work on "${story.title}"...`, 'spawning_agent', {
            storyId: story.id,
            storyTitle: story.title,
          });

          const executionResult: ExecutionResult = await this.dispatcher.execute(executionContext);

          // Extract results from the execution
          const conversationId = executionResult.conversationId ?? nanoid();
          const agentResult = executionResult.agentOutput;
          const agentError = executionResult.agentError;

          // Infrastructure failure — halt the entire loop and alert the user.
          // These are fatal errors (worktree setup, DB, dependency install) that
          // affect every story, not just the current one. No point retrying.
          if (agentError?.startsWith('INFRA_FAILURE:')) {
            const infraMsg = agentError.slice('INFRA_FAILURE: '.length);
            this.emitThought(`Fatal infrastructure error — halting: ${infraMsg}`, 'error', {
              storyId: story.id,
              storyTitle: story.title,
            });
            sendNotification({
              event: 'golem_failure',
              title: 'Golem Infrastructure Failure',
              message: `Fatal error — golem has stopped: ${infraMsg}`,
              workspaceId: this.workspacePath,
              storyId: story.id,
            }).catch(() => {});
            this.cancelled = true;
            this.updateLoopDb({
              status: 'failed',
              completed_at: Date.now(),
              current_story_id: null,
              current_agent_id: null,
            });
            this.emitEvent('failed', { message: `Infrastructure failure: ${infraMsg}` });
            break;
          }

          // Update story with conversation and agent references
          this.updateStory(story.id, { conversationId });
          if (executionResult.agentId) {
            this.updateStory(story.id, { agentId: executionResult.agentId });
            this.updateLoopDb({ current_agent_id: executionResult.agentId });
          }

          // Emit story_started after execution setup so the client can navigate to the conversation
          this.emitEvent('story_started', {
            storyId: story.id,
            storyTitle: story.title,
            iteration,
            conversationId,
          });

          this.emitThought(`Agent is implementing "${story.title}"...`, 'implementing', {
            storyId: story.id,
            storyTitle: story.title,
          });

          if (this.cancelled || executionResult.status === 'cancelled') break;

          // Process quality check results — apply baseline diff and emit events
          let qualityResults: QualityCheckResult[] = executionResult.qualityResults;

          if (qualityResults.length > 0) {
            this.emitThought('Agent done. Running quality checks...', 'quality_checking', {
              storyId: story.id,
              storyTitle: story.title,
            });

            // Diff against baseline to filter out pre-existing errors
            qualityResults = this.diffAgainstBaseline(qualityResults);

            for (const qr of qualityResults) {
              this.emitEvent('quality_check', {
                storyId: story.id,
                storyTitle: story.title,
                qualityResult: qr,
              });
              this.addLogEntry({
                iteration,
                storyId: story.id,
                storyTitle: story.title,
                action: 'quality_check',
                detail: `${qr.checkName}: ${qr.passed ? 'PASSED' : 'FAILED'} (${qr.duration}ms)`,
                timestamp: Date.now(),
                qualityResults: [qr],
              });
            }
          }

          // Determine success
          const requiredChecksFailed = qualityResults.some((qr) => {
            const checkConfig = checksToRun.find((c) => c.id === qr.checkId);
            return checkConfig?.required && !qr.passed;
          });
          const hasAgentError = !!agentError;
          const passed = !hasAgentError && !requiredChecksFailed;

          if (passed) {
            // Story succeeded! Clear any fix-up state if it was a fix-up pass.
            this.fixUpState.delete(story.id);
            this.updateMood('success');
            this.emitThought(`All checks passed for "${story.title}"!`, 'celebrating', {
              storyId: story.id,
              storyTitle: story.title,
            });

            // Git commit BEFORE marking complete — task stays in_progress until changes are committed
            if (this.config.autoCommit) {
              this.emitThought('Committing changes to git...', 'committing', {
                storyId: story.id,
                storyTitle: story.title,
              });
              try {
                const sha = await this.gitCommit(story);
                if (sha) {
                  this.updateStory(story.id, { commitSha: sha });
                  this.addLogEntry({
                    iteration,
                    storyId: story.id,
                    storyTitle: story.title,
                    action: 'committed',
                    detail: `Committed: ${sha.slice(0, 8)}`,
                    timestamp: Date.now(),
                  });
                }
              } catch (err) {
                console.error(
                  `[loop:${this.loopId}] Git commit failed for story ${story.id}:`,
                  err,
                );
                // Don't mark complete if commit fails — revert and retry
                const commitErrMsg = err instanceof Error ? err.message : String(err);
                this.addLogEntry({
                  iteration,
                  storyId: story.id,
                  storyTitle: story.title,
                  action: 'failed',
                  detail: `Git commit failed: ${commitErrMsg}`,
                  timestamp: Date.now(),
                });
                await this.revertUncommittedChanges(story.id);
                this.recordAttemptResult(
                  story.id,
                  'failed',
                  `Git commit failed: ${commitErrMsg}`,
                  conversationId,
                );
                this.updateStory(story.id, { status: 'pending' });
                this.emitEvent('story_failed', {
                  storyId: story.id,
                  storyTitle: story.title,
                  iteration,
                  conversationId,
                  message: `Git commit failed: ${commitErrMsg}`,
                  willRetry: true,
                });
                // Fall through to iteration_end cleanup
                this.updateLoopDb({ current_story_id: null, current_agent_id: null });
                this.emitEvent('iteration_end', {
                  storyId: story.id,
                  storyTitle: story.title,
                  iteration,
                });
                continue;
              }
            }

            // Move to QA — story is implemented and committed, awaiting review.
            // The human (or a separate approval step) promotes qa → completed.
            this.updateStory(story.id, { status: 'qa' });
            this.recordAttemptResult(
              story.id,
              'success',
              'All quality checks passed',
              conversationId,
            );

            // Increment completed counter
            const loop = db.query('SELECT * FROM loops WHERE id = ?').get(this.loopId) as any;
            this.updateLoopDb({
              total_stories_completed: (loop?.total_stories_completed || 0) + 1,
            });

            this.emitEvent('story_completed', {
              storyId: story.id,
              storyTitle: story.title,
              iteration,
              conversationId,
            });
            this.addLogEntry({
              iteration,
              storyId: story.id,
              storyTitle: story.title,
              action: 'passed',
              detail: 'Story completed successfully',
              timestamp: Date.now(),
            });

            // Send notification for story completion
            sendNotification({
              event: 'story_completed',
              title: 'Story Completed',
              message: `"${story.title}" completed successfully after ${iteration} iteration(s).`,
              workspaceId: this.workspacePath,
              conversationId,
              storyId: story.id,
            }).catch((err) => {
              console.error(
                `[loop:${this.loopId}] Failed to send story_completed notification:`,
                err,
              );
            });

            // Record learnings from success
            this.recordLearning(story, 'Completed successfully', qualityResults);

            // Create agent note with report for the user
            this.createAgentNote(story, conversationId, 'completed', agentResult, qualityResults);

            // External status writeback hook — story is in QA, not fully completed yet.
            // Push 'qa' status so external tools know it's awaiting review.
            const qaStory = this.getStory(story.id);
            if (qaStory?.externalRef) {
              this.pushExternalStatus(qaStory, 'qa').catch((err) => {
                console.error(`[loop:${this.loopId}] External status push failed:`, err);
              });
            }
          } else {
            // Story failed
            this.updateMood('failure');
            const failReason = hasAgentError
              ? `Agent error: ${agentError}`
              : `Quality checks failed: ${qualityResults
                  .filter((qr) => !qr.passed)
                  .map((qr) => qr.checkName)
                  .join(', ')}`;

            // Record per-attempt outcome
            this.recordAttemptResult(story.id, 'failed', failReason, conversationId);

            // Record learning
            this.recordLearning(story, failReason, qualityResults);

            // Create agent note with failure report for the user
            this.createAgentNote(
              story,
              conversationId,
              'failed',
              agentResult,
              qualityResults,
              failReason,
            );

            // --- Auto-skip detection ---
            // If the story has failed with the exact same error signature 3+ times,
            // it's stuck in a loop and further attempts won't help. Auto-skip it
            // to avoid wasting more iterations.
            if (requiredChecksFailed && !hasAgentError) {
              const shouldAutoSkip = this.trackFailureSignature(story.id, qualityResults);
              if (shouldAutoSkip) {
                console.log(
                  `[loop:${this.loopId}] Auto-skipping "${story.title}" — identical failure 3+ times`,
                );
                this.fixUpState.delete(story.id);
                await this.revertUncommittedChanges(story.id);
                this.updateStory(story.id, { status: 'failed' });

                const loop = db.query('SELECT * FROM loops WHERE id = ?').get(this.loopId) as any;
                this.updateLoopDb({ total_stories_failed: (loop?.total_stories_failed || 0) + 1 });

                this.addLogEntry({
                  iteration,
                  storyId: story.id,
                  storyTitle: story.title,
                  action: 'failed',
                  detail: `Auto-skipped: identical failure detected 3+ times. Error: ${failReason}`,
                  timestamp: Date.now(),
                  qualityResults,
                });
                this.emitEvent('story_failed', {
                  storyId: story.id,
                  storyTitle: story.title,
                  iteration,
                  conversationId,
                  message: `Auto-skipped after 3+ identical failures: ${failReason}`,
                  willRetry: false,
                });

                // Clear current story/agent and continue to next iteration
                this.updateLoopDb({ current_story_id: null, current_agent_id: null });
                this.emitEvent('iteration_end', {
                  storyId: story.id,
                  storyTitle: story.title,
                  iteration,
                });
                continue;
              }
            }

            // --- Fix-up pass logic ---
            // When quality checks fail, instead of immediately reverting all work,
            // we give the agent multiple chances to fix the broken code in-place.
            // This is much more efficient than starting from scratch — most failures
            // are small typecheck or lint errors that are quick to patch.
            //
            // Each fresh attempt gets up to maxFixUpAttempts sub-attempts:
            //   fresh start → fail → fix-up 1 → fail → fix-up 2 → fail → REVERT → fresh start → ...
            //   agent error → always revert immediately (code may be inconsistent)
            const currentFixUp = this.fixUpState.get(story.id);
            const fixUpSubAttempts = currentFixUp?.subAttempts ?? 0;
            const maxFixUps = this.config.maxFixUpAttempts ?? 2;
            const fixUpsExhausted = fixUpSubAttempts >= maxFixUps;

            let didRevert = false;
            if (hasAgentError) {
              // Agent error — always revert, code may be in an inconsistent state
              this.fixUpState.delete(story.id);
              this.emitThought('Agent error — reverting to clean state...', 'reverting', {
                storyId: story.id,
                storyTitle: story.title,
              });
              console.log(
                `[loop:${this.loopId}] Agent error — reverting to clean state for "${story.title}"`,
              );
              this.addLogEntry({
                iteration,
                storyId: story.id,
                storyTitle: story.title,
                action: 'quality_check',
                detail: `Post-failure rollback: agent error — reverting to clean state`,
                timestamp: Date.now(),
              });
              await this.revertUncommittedChanges(story.id);
              didRevert = true;
            } else if (requiredChecksFailed && fixUpsExhausted) {
              // All fix-up sub-attempts exhausted — revert and let the next fresh attempt start clean
              this.fixUpState.delete(story.id);
              this.emitThought(
                `Fix-up attempts exhausted for "${story.title}" — reverting...`,
                'reverting',
                { storyId: story.id, storyTitle: story.title },
              );
              console.log(
                `[loop:${this.loopId}] Fix-up attempts exhausted (${fixUpSubAttempts}/${maxFixUps}) — reverting to clean state for "${story.title}"`,
              );
              this.addLogEntry({
                iteration,
                storyId: story.id,
                storyTitle: story.title,
                action: 'quality_check',
                detail: `Post-failure rollback: fix-up attempts exhausted (${fixUpSubAttempts}/${maxFixUps}), reverting for fresh attempt`,
                timestamp: Date.now(),
              });
              await this.revertUncommittedChanges(story.id);
              didRevert = true;
            } else if (requiredChecksFailed) {
              // Fix-up sub-attempts remaining — keep the code, store/update errors for next fix-up
              this.emitThought(
                `Quality checks failed — preparing fix-up pass for "${story.title}"...`,
                'fixing_up',
                { storyId: story.id, storyTitle: story.title },
              );
              const failedResults = qualityResults.filter((qr) => !qr.passed);
              const nextSubAttempt = fixUpSubAttempts + 1;
              this.fixUpState.set(story.id, {
                subAttempts: nextSubAttempt,
                lastResults: failedResults,
              });
              console.log(
                `[loop:${this.loopId}] Keeping broken code for fix-up pass ${nextSubAttempt}/${maxFixUps} on "${story.title}" (${failedResults.length} failed check(s))`,
              );
              this.addLogEntry({
                iteration,
                storyId: story.id,
                storyTitle: story.title,
                action: 'quality_check',
                detail: `Skipping revert — next attempt will be fix-up pass ${nextSubAttempt}/${maxFixUps}`,
                timestamp: Date.now(),
              });
            }

            // Check if main retries exhausted (only matters after a revert,
            // since fix-ups don't consume the attempt counter)
            const updatedStory = this.getStory(story.id);
            const retriesExhausted =
              didRevert && updatedStory && updatedStory.attempts >= updatedStory.maxAttempts;

            if (retriesExhausted) {
              this.fixUpState.delete(story.id);
              this.updateStory(story.id, { status: 'failed' });

              const loop = db.query('SELECT * FROM loops WHERE id = ?').get(this.loopId) as any;
              this.updateLoopDb({ total_stories_failed: (loop?.total_stories_failed || 0) + 1 });

              // Send notification for story failure
              sendNotification({
                event: 'story_failed',
                title: 'Story Failed',
                message: `"${story.title}" failed after ${updatedStory?.attempts || 0} attempt(s). Reason: ${failReason}`,
                workspaceId: this.workspacePath,
                conversationId,
                storyId: story.id,
              }).catch((err) => {
                console.error(
                  `[loop:${this.loopId}] Failed to send story_failed notification:`,
                  err,
                );
              });

              // External status writeback hook for failures
              const failedStory = this.getStory(story.id);
              if (failedStory?.externalRef) {
                this.pushExternalStatus(failedStory, 'failed').catch((err) => {
                  console.error(`[loop:${this.loopId}] External status push failed:`, err);
                });
              }
            } else {
              // Reset to pending for retry (either fix-up or fresh)
              this.updateStory(story.id, { status: 'pending' });
            }

            const willRetry = !retriesExhausted;
            const hasFixUpNext = this.fixUpState.has(story.id);
            this.emitEvent('story_failed', {
              storyId: story.id,
              storyTitle: story.title,
              iteration,
              conversationId,
              message: failReason,
              willRetry,
            });
            this.addLogEntry({
              iteration,
              storyId: story.id,
              storyTitle: story.title,
              action: 'failed',
              detail:
                failReason +
                (hasFixUpNext
                  ? ` (fix-up pass ${this.fixUpState.get(story.id)!.subAttempts}/${maxFixUps} next)`
                  : didRevert
                    ? ' (reverted, fresh start next)'
                    : ''),
              timestamp: Date.now(),
              qualityResults,
            });

            // Pause on failure if configured
            if (this.config.pauseOnFailure) {
              this.pause();
              this.updateLoopDb({ status: 'paused', paused_at: Date.now() });
              this.emitEvent('paused', { message: `Paused: story "${story.title}" failed` });
              await this.checkPauseGate();
              if (this.cancelled) break;
              this.updateLoopDb({ status: 'running' });
            }
          }

          // Clear current story/agent so UI doesn't show stale state between iterations
          this.updateLoopDb({ current_story_id: null, current_agent_id: null });

          this.emitEvent('iteration_end', {
            storyId: story.id,
            storyTitle: story.title,
            iteration,
          });
          // === End iteration try block ===
        } catch (iterErr) {
          // Don't let a single iteration crash kill the entire loop.
          // Log the error, mark the story as failed if it was in_progress, and continue.
          console.error(`[loop:${this.loopId}] Iteration ${iteration} crashed:`, iterErr);
          this.addLogEntry({
            iteration,
            storyId: story.id,
            storyTitle: story.title,
            action: 'failed',
            detail: `Iteration crashed: ${String(iterErr).slice(0, 500)}`,
            timestamp: Date.now(),
          });

          // Reset story to pending if it was in_progress (so it can be retried)
          let willRetry = false;
          try {
            this.recordAttemptResult(
              story.id,
              'failed',
              `Iteration crashed: ${String(iterErr).slice(0, 200)}`,
            );
            const crashedStory = this.getStory(story.id);
            if (crashedStory?.status === 'in_progress') {
              if (crashedStory.attempts >= crashedStory.maxAttempts) {
                this.updateStory(story.id, { status: 'failed' });
              } else {
                this.updateStory(story.id, { status: 'pending' });
                willRetry = true;
              }
            }
          } catch {
            /* best effort */
          }

          // Clear current story/agent so UI doesn't show stale state after crash
          this.updateLoopDb({ current_story_id: null, current_agent_id: null });

          this.emitEvent('story_failed', {
            storyId: story.id,
            storyTitle: story.title,
            iteration,
            message: `Iteration crashed: ${String(iterErr).slice(0, 200)}`,
            willRetry,
          });
        }

        // Small delay between iterations
        this.emitThought('Resting briefly before the next story...', 'resting');
        await new Promise((r) => setTimeout(r, 2000));
      }

      if (this.cancelled) {
        console.log(`[loop:${this.loopId}] Cancelled after ${iteration} iterations`);
        this.updateLoopDb({
          status: 'cancelled',
          completed_at: Date.now(),
          current_story_id: null,
          current_agent_id: null,
        });
        this.events.emit('loop_done', this.loopId);
        return;
      }

      // Max iterations reached — check final state
      const finalStories = this.getAllStories();
      console.log(
        `[loop:${this.loopId}] Loop ended after ${iteration} iterations. Stories: ${finalStories.map((s) => `${s.title}[${s.status}]`).join(', ')}`,
      );
      const allDone =
        finalStories.length > 0 &&
        finalStories.every(
          (s) =>
            s.status === 'completed' ||
            s.status === 'qa' ||
            s.status === 'skipped' ||
            s.status === 'archived' ||
            s.researchOnly,
        );

      if (allDone) {
        this.emitThought('All stories completed! Time to rest.', 'celebrating');
        this.updateLoopDb({
          status: 'completed',
          completed_at: Date.now(),
          current_story_id: null,
          current_agent_id: null,
        });
        this.emitEvent('completed', { message: 'All stories completed!' });
      } else {
        // Distinguish full success / partial success / total failure at max iterations
        const doneCount = finalStories.filter(
          (s) =>
            s.status === 'completed' ||
            s.status === 'qa' ||
            s.status === 'skipped' ||
            s.status === 'archived' ||
            s.researchOnly,
        ).length;
        const failedCount = finalStories.filter((s) => s.status === 'failed').length;
        const pendingCount = finalStories.length - doneCount - failedCount;
        const maxIterStatus =
          failedCount === 0 && pendingCount === 0
            ? 'completed'
            : doneCount > 0
              ? 'completed_with_failures'
              : 'failed';

        this.updateLoopDb({
          status: maxIterStatus,
          completed_at: Date.now(),
          current_story_id: null,
          current_agent_id: null,
        });
        this.emitEvent(maxIterStatus === 'failed' ? 'failed' : 'completed', {
          message:
            maxIterStatus === 'completed'
              ? 'All stories completed!'
              : maxIterStatus === 'completed_with_failures'
                ? `Max iterations reached. Partial success: ${doneCount} completed, ${failedCount} failed, ${pendingCount} pending.`
                : `Max iterations (${this.config.maxIterations}) reached. Some stories remain incomplete.`,
        });
      }

      // Clean up — the orchestrator will remove us from the runners Map
      // via the 'loop_done' event handler
      this.events.emit('loop_done', this.loopId);
    } finally {
      this.stopHeartbeat();
      // Safety net: if the loop somehow exits without setting a terminal status,
      // do NOT immediately mark it as failed. During hot reloads, the runner's
      // finally block fires as the old module is replaced, but the new
      // orchestrator's startup recovery will detect the orphaned loop and
      // auto-resume it. Marking it failed here would prevent that recovery.
      //
      // Instead, just update the heartbeat to "now" so the zombie checker
      // knows this loop was recently alive. The zombie checker (30s interval)
      // and startup recovery will handle the rest — either auto-resuming if
      // there's pending work, or marking as failed/completed if not.
      try {
        const db = getDb();
        const row = db.query('SELECT status FROM loops WHERE id = ?').get(this.loopId) as any;
        if (row && (row.status === 'running' || row.status === 'paused')) {
          console.warn(
            `[loop:${this.loopId}] Runner exiting while still "${row.status}" — leaving for zombie recovery to handle (hot reload safe)`,
          );
          // Stamp a fresh heartbeat so zombie recovery doesn't immediately
          // mark it as stale. The orchestrator's recoverOrResumeZombieLoops()
          // will pick it up on the next startup or 30s check cycle.
          db.query('UPDATE loops SET last_heartbeat = ? WHERE id = ?').run(Date.now(), this.loopId);
        }
      } catch {
        /* best effort */
      }
    }
  }

  // --- Config application ---

  // --- Parallel dispatch loop ---

  /**
   * Run the loop in parallel mode (maxParallel > 1).
   *
   * Uses the ParallelScheduler to dispatch up to maxParallel stories
   * concurrently. Each story gets its own worktree and golem. Completion
   * triggers quality checks + auto-merge. Conflicts mark stories as failed
   * without blocking others.
   */
  private async runParallel(): Promise<void> {
    const scheduler = this.parallelScheduler!;
    const maxParallel = this.config.maxParallel ?? 1;
    let iteration = 0;
    let noProgressCount = 0;
    const maxNoProgress = 5;

    console.log(
      `[loop:${this.loopId}] Running in PARALLEL mode (maxParallel=${maxParallel}, autoMerge=${this.config.autoMerge !== false})`,
    );

    this.emitThought(
      `Parallel mode: dispatching up to ${maxParallel} stories concurrently`,
      'idle',
    );

    try {
      while (iteration < this.config.maxIterations && !this.cancelled) {
        await this.checkPauseGate();
        if (this.cancelled) break;

        this.sendHeartbeat();

        iteration++;

        this.updateLoopDb({
          current_iteration: iteration,
          total_iterations: iteration,
        });

        this.emitEvent('iteration_start', {
          iteration,
          message: `Parallel iteration ${iteration} — dispatching batch (up to ${maxParallel} concurrent)`,
        });

        console.log(
          `[loop:${this.loopId}] Parallel iteration ${iteration}: running batch via scheduler`,
        );

        // Delegate to the scheduler which handles selection, dispatch, waiting, and results
        const batchResult = await scheduler.runParallelBatch(iteration, () => this.cancelled);

        this.emitEvent('iteration_end', { iteration });

        if (
          batchResult.dispatched === 0 &&
          batchResult.completed === 0 &&
          batchResult.failed === 0
        ) {
          // Nothing happened — check if we're done or stuck
          noProgressCount++;

          const stories = this.getAllStories();
          const allCompleted = stories.every(
            (s) =>
              s.status === 'completed' ||
              s.status === 'qa' ||
              s.status === 'skipped' ||
              s.status === 'archived' ||
              s.status === 'pending_merge' ||
              s.researchOnly,
          );

          if (allCompleted) {
            this.updateLoopDb({
              status: 'completed',
              completed_at: Date.now(),
              current_story_id: null,
              current_agent_id: null,
            });
            this.emitEvent('completed', { message: 'All stories completed!' });
            sendNotification({
              event: 'golem_completion',
              title: 'Loop Completed',
              message: `All ${stories.length} stories completed successfully!`,
              workspaceId: this.workspacePath,
            }).catch(() => {});
            this.events.emit('loop_done', this.loopId);
            return;
          }

          if (noProgressCount >= maxNoProgress) {
            const completedCount = stories.filter(
              (s) =>
                s.status === 'completed' ||
                s.status === 'qa' ||
                s.status === 'skipped' ||
                s.status === 'archived' ||
                s.researchOnly,
            ).length;
            const failedStoryCount = stories.filter((s) => s.status === 'failed').length;
            const endStatus =
              failedStoryCount === 0 && completedCount === stories.length
                ? 'completed'
                : completedCount > 0
                  ? 'completed_with_failures'
                  : 'failed';

            this.updateLoopDb({
              status: endStatus,
              completed_at: Date.now(),
              current_story_id: null,
              current_agent_id: null,
            });
            this.emitEvent(endStatus === 'failed' ? 'failed' : 'completed', {
              message:
                endStatus === 'completed'
                  ? 'All stories completed!'
                  : endStatus === 'completed_with_failures'
                    ? `Finished with partial success: ${completedCount} completed, ${failedStoryCount} failed.`
                    : 'No more eligible stories. Some stories could not be completed.',
            });
            this.events.emit('loop_done', this.loopId);
            return;
          }

          // Wait briefly before retrying
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }

        // Reset no-progress counter since the batch had activity
        noProgressCount = 0;

        // Small delay between iterations
        await new Promise((r) => setTimeout(r, 2000));
      }

      // Loop ended — determine final status
      if (this.cancelled) {
        this.updateLoopDb({
          status: 'cancelled',
          completed_at: Date.now(),
          current_story_id: null,
          current_agent_id: null,
        });
        this.events.emit('loop_done', this.loopId);
        return;
      }

      const finalStories = this.getAllStories();
      const allDone =
        finalStories.length > 0 &&
        finalStories.every(
          (s) =>
            s.status === 'completed' ||
            s.status === 'qa' ||
            s.status === 'skipped' ||
            s.status === 'archived' ||
            s.researchOnly,
        );

      if (allDone) {
        this.updateLoopDb({
          status: 'completed',
          completed_at: Date.now(),
          current_story_id: null,
          current_agent_id: null,
        });
        this.emitEvent('completed', { message: 'All stories completed!' });
      } else {
        const doneCount = finalStories.filter(
          (s) =>
            s.status === 'completed' ||
            s.status === 'qa' ||
            s.status === 'skipped' ||
            s.status === 'archived' ||
            s.researchOnly,
        ).length;
        const failedCount = finalStories.filter((s) => s.status === 'failed').length;
        const endStatus = doneCount > 0 ? 'completed_with_failures' : 'failed';

        this.updateLoopDb({
          status: endStatus,
          completed_at: Date.now(),
          current_story_id: null,
          current_agent_id: null,
        });
        this.emitEvent(endStatus === 'failed' ? 'failed' : 'completed', {
          message: `Parallel loop finished: ${doneCount} completed, ${failedCount} failed.`,
        });
      }

      this.events.emit('loop_done', this.loopId);
    } finally {
      this.stopHeartbeat();
    }
  }

  /**
   * Apply the loop config's maxAttemptsPerStory to all stories that will be
   * processed in this loop. This ensures the user's retry setting actually
   * takes effect, overriding the per-story DB default (usually 3).
   */
  private applyMaxAttemptsConfig(): void {
    const configMaxAttempts = this.config.maxAttemptsPerStory;
    if (!configMaxAttempts || configMaxAttempts < 1) return;

    const db = getDb();
    let result;
    if (this.prdId) {
      result = db
        .query(
          "UPDATE prd_stories SET max_attempts = ?, updated_at = ? WHERE prd_id = ? AND status IN ('pending', 'in_progress') AND (research_only = 0 OR research_only IS NULL)",
        )
        .run(configMaxAttempts, Date.now(), this.prdId);
    } else {
      result = db
        .query(
          "UPDATE prd_stories SET max_attempts = ?, updated_at = ? WHERE prd_id IS NULL AND workspace_path = ? AND status IN ('pending', 'in_progress') AND (research_only = 0 OR research_only IS NULL)",
        )
        .run(configMaxAttempts, Date.now(), this.workspacePath);
    }

    if (result.changes > 0) {
      console.log(
        `[loop:${this.loopId}] Applied maxAttemptsPerStory=${configMaxAttempts} to ${result.changes} stories`,
      );
    }
  }

  // --- Story selection ---

  /**
   * Reset any orphaned in_progress stories back to pending.
   * This handles the case where a story was marked in_progress but the iteration
   * crashed or exited without properly transitioning the story to completed/failed/pending.
   * Only resets stories that are NOT the current story being worked on.
   */
  private recoverOrphanedStories(): void {
    const stories = this.getAllStories();
    const db = getDb();
    const loop = db
      .query('SELECT current_story_id FROM loops WHERE id = ?')
      .get(this.loopId) as any;
    const currentStoryId = loop?.current_story_id;

    for (const s of stories) {
      if (s.status !== 'in_progress') continue;
      if (s.id === currentStoryId) continue; // Don't touch the actively-running story

      console.warn(
        `[loop:${this.loopId}] Recovering orphaned in_progress story "${s.title}" (${s.id}) — resetting to pending`,
      );
      if (s.attempts >= s.maxAttempts) {
        this.updateStory(s.id, { status: 'failed' });
      } else {
        this.updateStory(s.id, { status: 'pending' });
      }
    }
  }

  private selectNextStory(): UserStory | null {
    const stories = this.getAllStories();
    const doneIds = this.getDoneIds(stories);

    const eligible = stories.filter((s) => {
      // Allow pending and failed_timeout (timed-out stories eligible for retry)
      if (s.status !== 'pending' && s.status !== 'failed_timeout') return false;
      if (s.attempts >= s.maxAttempts) return false;
      // Skip research-only stories — they are not picked up by the implementation loop
      if (s.researchOnly) return false;
      // Check dependencies resolved (respects qaUnblocksDependents config)
      const deps = s.dependsOn || [];
      return deps.every((depId) => doneIds.has(depId));
    });

    if (eligible.length === 0) return null;

    // Sort by priority
    eligible.sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority] ?? 2;
      const pb = PRIORITY_ORDER[b.priority] ?? 2;
      if (pa !== pb) return pa - pb;
      return a.sortOrder - b.sortOrder;
    });

    return eligible[0];
  }

  // --- Prompt building ---

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
10. Do NOT leave placeholder implementations, stubs, TODOs, or empty function bodies. Every function must have a complete, working implementation. The system will detect and fail placeholder code automatically.
11. When writing or modifying tests, include a brief comment above each test explaining WHY the test exists — what behavior, edge case, or invariant it guards against. Future agents will lose your reasoning context; the test comment is the only record.

## Critical: Story Management Rules
- You are assigned ONE specific story. Do NOT attempt to implement other stories.
- Do NOT use story management tools (update_story, list_stories, complete_story, etc.) to change the status of ANY story — the system manages story lifecycle automatically.
- Stories marked as completed (✅) or in QA review (🔍) in the progress context are ALREADY DONE. Do not re-implement or modify their work unless your assigned story explicitly depends on correcting them.
- Your job is solely to implement the assigned story and make the code changes required by its acceptance criteria.`;

    // Add project memory context
    try {
      const db = getDb();
      const memories = db
        .query(
          `SELECT * FROM workspace_memories WHERE workspace_path = ? AND confidence >= 0.3 ORDER BY category, times_seen DESC LIMIT 50`,
        )
        .all(this.workspacePath) as any[];

      if (memories.length > 0) {
        const grouped: Record<string, string[]> = {};
        for (const m of memories) {
          if (!grouped[m.category]) grouped[m.category] = [];
          grouped[m.category].push(`- ${m.key}: ${m.content}`);
        }

        prompt += '\n\n## Project Memory\n';
        const labels: Record<string, string> = {
          convention: 'Coding Conventions',
          decision: 'Architecture Decisions',
          preference: 'User Preferences',
          pattern: 'Common Patterns',
          context: 'Project Context',
        };
        for (const [cat, items] of Object.entries(grouped)) {
          prompt += `\n### ${labels[cat] || cat}\n${items.join('\n')}\n`;
        }
      }
    } catch {
      /* no project memory available */
    }

    return prompt;
  }

  private buildStoryPrompt(story: UserStory): string {
    const criteria = story.acceptanceCriteria
      .map((ac, i) => `${i + 1}. ${ac.description}`)
      .join('\n');

    const fixUpInfo = this.fixUpState.get(story.id);
    const isFixUp = !!fixUpInfo;
    const maxFixUps = this.config.maxFixUpAttempts ?? 2;

    let prompt = `## User Story: ${story.title}

${story.description}

## Acceptance Criteria
${criteria}
`;

    if (isFixUp) {
      prompt += `\n## Attempt ${story.attempts} of ${story.maxAttempts} — Fix-up ${fixUpInfo.subAttempts} of ${maxFixUps}`;
    } else {
      prompt += `\n## Attempt ${story.attempts + 1} of ${story.maxAttempts}`;
    }

    // Fix-up pass: the previous attempt's code is still in place — tell the
    // agent to fix the specific errors rather than rewriting from scratch.
    if (isFixUp) {
      prompt += `\n\n## ⚠️ FIX-UP PASS — Do Not Start Over`;
      prompt += `\nYour previous attempt for this story is still in the working tree.`;
      prompt += ` Quality checks failed. Your job is to **fix the specific errors below**,`;
      prompt += ` not rewrite the implementation from scratch.`;
      if (fixUpInfo.subAttempts > 1) {
        prompt += ` This is fix-up attempt ${fixUpInfo.subAttempts} of ${maxFixUps} — previous fixes did not resolve all issues.`;
      }
      prompt += '\n';

      for (const qr of fixUpInfo.lastResults) {
        prompt += `\n### Failed: ${qr.checkName} (exit code ${qr.exitCode})`;
        // Include up to 8000 chars of actual error output so the agent can
        // see exactly what line/file/message caused each failure.
        const output = qr.output.trim();
        if (output) {
          prompt += `\n\`\`\`\n${output.slice(0, 8000)}\n\`\`\`\n`;
        }
      }

      // Include the git diff of uncommitted changes so the agent knows exactly
      // what code it wrote that needs fixing. This is critical context for
      // surgical error fixes.
      try {
        const storyCwd = this.resolveStoryCwd(story.id);
        const diffProc = Bun.spawnSync(['git', 'diff', '--stat'], {
          cwd: storyCwd,
          stdout: 'pipe',
          stderr: 'pipe',
        });
        const diffStat = diffProc.stdout.toString().trim();
        if (diffStat) {
          prompt += `\n### Your Changes (git diff --stat)\n\`\`\`\n${diffStat.slice(0, 2000)}\n\`\`\`\n`;
        }
      } catch {
        /* non-critical */
      }

      prompt += `\nFix these errors. Keep all working code intact. Do not restructure or rewrite unchanged files.`;
      prompt += `\nTIP: Run the project's typecheck command yourself before declaring you're done, to verify your fixes.`;
    }

    // Add learnings from previous attempts (always useful context, even on fix-up)
    if (story.learnings.length > 0) {
      prompt += '\n\n## Learnings from Previous Attempts\n';
      for (const learning of story.learnings) {
        prompt += `- ${learning}\n`;
      }
      if (!isFixUp) {
        prompt += '\nPlease address these issues in this attempt. Do not repeat the same mistakes.';
      }
    }

    // Add progress context
    const stories = this.getAllStories();
    // Count both 'completed' and 'qa' as done — qa stories are fully implemented,
    // just awaiting human approval. The agent should treat them as finished work.
    const completed = stories.filter((s) => s.status === 'completed' || s.status === 'qa');
    const remaining = stories.filter((s) => s.status === 'pending' || s.status === 'in_progress');

    // If the story description mentions specific packages or file paths, hint which
    // packages the agent should verify typechecking for
    const qualityChecks = this.config.qualityChecks.filter((c) => c.enabled);
    if (qualityChecks.length > 0) {
      prompt += '\n\n## Quality Checks That Will Run';
      for (const qc of qualityChecks) {
        prompt += `\n- **${qc.name}** (${qc.type}${qc.required ? ', required' : ''}): \`${qc.command}\``;
      }
      prompt += '\n\nMake sure your changes pass these checks before completion.';
    }

    prompt += `\n\n## Project Progress
- Completed: ${completed.length} of ${stories.length} stories
- Remaining: ${remaining.length} stories (including this one)`;

    if (completed.length > 0) {
      prompt += '\n\nAlready completed (do not re-implement these):';
      for (const cs of completed) {
        const label = cs.status === 'qa' ? '🔍' : '✅';
        prompt += `\n- ${label} ${cs.title}${cs.status === 'qa' ? ' (in QA review)' : ''}`;
      }
    }

    return prompt;
  }

  // --- Helpers ---

  private getAllStories(): UserStory[] {
    const db = getDb();
    let rows: any[];
    if (this.prdId) {
      rows = db
        .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order ASC')
        .all(this.prdId) as any[];
    } else {
      // Standalone mode: get stories with no PRD in this workspace
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

  /** Push status back to external provider (Jira/Linear/Asana) if story has an externalRef */
  private async pushExternalStatus(
    story: UserStory,
    status: 'completed' | 'failed' | 'qa',
  ): Promise<void> {
    if (!story.externalRef) return;

    const { getProviderConfig, getExternalProvider } = await import('../external-providers');
    const config = getProviderConfig(story.externalRef.provider);
    if (!config) return; // provider not configured, skip silently

    // Map 'qa' → 'in_progress' for external tools (they don't have a QA concept natively).
    // When the story is later promoted to 'completed', a separate push will mark it done.
    const externalStatus = status === 'qa' ? 'in_progress' : status;

    const provider = getExternalProvider(story.externalRef.provider);
    const comment =
      status === 'qa'
        ? `Implementation complete, moved to QA. Commit: ${story.commitSha || 'N/A'}`
        : status === 'completed'
          ? `Implemented automatically by E. Commit: ${story.commitSha || 'N/A'}`
          : `Automatic implementation failed after ${story.attempts} attempt(s).`;

    await provider.pushStatus(config, story.externalRef.externalId, externalStatus, {
      commitSha: story.commitSha,
      comment,
    });

    // Update syncedAt
    const db = getDb();
    const updatedRef = { ...story.externalRef, syncedAt: Date.now() };
    db.query('UPDATE prd_stories SET external_ref = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(updatedRef),
      Date.now(),
      story.id,
    );
  }

  private updateStory(storyId: string, updates: Record<string, any>): void {
    const db = getDb();
    const fieldMap: Record<string, string> = {
      status: 'status',
      taskId: 'task_id',
      agentId: 'agent_id',
      conversationId: 'conversation_id',
      commitSha: 'commit_sha',
      attempts: 'attempts',
      attemptResults: 'attempt_results',
    };
    // Fields that store JSON arrays/objects and need serialization
    const jsonFields = new Set(['attemptResults']);

    const setClauses: string[] = [];
    const values: any[] = [];

    for (const [key, value] of Object.entries(updates)) {
      const col = fieldMap[key] || key;
      setClauses.push(`${col} = ?`);
      values.push(jsonFields.has(key) ? JSON.stringify(value) : value);
    }

    setClauses.push('updated_at = ?');
    values.push(Date.now());
    values.push(storyId);

    db.query(`UPDATE prd_stories SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
  }

  /** Append a per-attempt outcome to the story's attemptResults array. */
  private recordAttemptResult(
    storyId: string,
    result: AttemptResult['result'],
    reason: string,
    conversationId?: string,
  ): void {
    const story = this.getStory(storyId);
    if (!story) return;
    const existing: AttemptResult[] = story.attemptResults ?? [];
    existing.push({
      attempt: story.attempts,
      result,
      reason,
      conversationId: conversationId || undefined,
      timestamp: Date.now(),
    });
    this.updateStory(storyId, { attemptResults: existing });
  }

  private updateLoopDb(updates: Record<string, any>): void {
    const db = getDb();
    const setClauses: string[] = [];
    const values: any[] = [];

    for (const [key, value] of Object.entries(updates)) {
      setClauses.push(`${key} = ?`);
      values.push(value);
    }

    values.push(this.loopId);
    db.query(`UPDATE loops SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
  }

  private addLogEntry(entry: IterationLogEntry): void {
    const db = getDb();
    const row = db.query('SELECT iteration_log FROM loops WHERE id = ?').get(this.loopId) as any;
    const log: IterationLogEntry[] = JSON.parse(row?.iteration_log || '[]');
    log.push(entry);
    db.query('UPDATE loops SET iteration_log = ? WHERE id = ?').run(
      JSON.stringify(log),
      this.loopId,
    );
  }

  private recordLearning(
    story: UserStory,
    summary: string,
    qualityResults: QualityCheckResult[],
  ): void {
    this.emitThought(`Recording learnings from "${story.title}"...`, 'recording_learnings', {
      storyId: story.id,
      storyTitle: story.title,
    });
    const failedChecks = qualityResults.filter((qr) => !qr.passed);
    let learning = summary;
    if (failedChecks.length > 0) {
      learning += `. Failed checks: ${failedChecks.map((qr) => `${qr.checkName} (${qr.output.slice(0, 200)})`).join('; ')}`;
    }

    // Append to story learnings
    const db = getDb();
    const row = db.query('SELECT learnings FROM prd_stories WHERE id = ?').get(story.id) as any;
    const learnings: string[] = JSON.parse(row?.learnings || '[]');
    learnings.push(learning);
    db.query('UPDATE prd_stories SET learnings = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(learnings),
      Date.now(),
      story.id,
    );

    // Also store in project memory for cross-loop persistence
    try {
      const memKey = `loop-learning:${story.title.slice(0, 60)}`;
      const existing = db
        .query('SELECT * FROM workspace_memories WHERE workspace_path = ? AND key = ?')
        .get(this.workspacePath, memKey) as any;

      if (existing) {
        db.query(
          'UPDATE workspace_memories SET content = ?, times_seen = times_seen + 1, updated_at = ? WHERE id = ?',
        ).run(learning.slice(0, 500), Date.now(), existing.id);
      } else {
        db.query(
          `INSERT INTO workspace_memories (id, workspace_path, category, key, content, source, confidence, times_seen, created_at, updated_at)
           VALUES (?, ?, 'context', ?, ?, 'auto', 0.6, 1, ?, ?)`,
        ).run(nanoid(), this.workspacePath, memKey, learning.slice(0, 500), Date.now(), Date.now());
      }
    } catch {
      /* non-critical */
    }

    this.emitEvent('learning', {
      storyId: story.id,
      storyTitle: story.title,
      learning,
    });
  }

  // --- Agent Notes ---

  /**
   * Create an agent note when a story completes or fails.
   * This lets users review agent reports/results without digging through conversations.
   */
  private createAgentNote(
    story: UserStory,
    conversationId: string,
    outcome: 'completed' | 'failed',
    agentOutput: string,
    qualityResults: QualityCheckResult[],
    failReason?: string,
  ): void {
    try {
      const db = getDb();
      const id = nanoid(12);
      const now = Date.now();

      const isSuccess = outcome === 'completed';
      const category = isSuccess ? 'report' : 'status';
      const statusEmoji = isSuccess ? '✅' : '❌';
      const title = `${statusEmoji} ${story.title}`;

      // Build the note content as markdown
      const sections: string[] = [];

      sections.push(`# ${isSuccess ? 'Completed' : 'Failed'}: ${story.title}\n`);

      if (story.description) {
        sections.push(`## Story Description\n${story.description}\n`);
      }

      sections.push(`## Outcome\n**Status:** ${isSuccess ? 'Completed successfully' : 'Failed'}  `);
      sections.push(`**Attempts:** ${story.attempts + 1}/${story.maxAttempts}  `);
      sections.push(`**Iteration:** Loop \`${this.loopId}\`\n`);

      if (failReason) {
        sections.push(`## Failure Reason\n${failReason}\n`);
      }

      if (qualityResults.length > 0) {
        sections.push(`## Quality Check Results`);
        for (const qr of qualityResults) {
          const icon = qr.passed ? '✅' : '❌';
          sections.push(
            `- ${icon} **${qr.checkName}** (${qr.checkType}): ${qr.passed ? 'Passed' : 'Failed'} — ${qr.duration}ms`,
          );
          if (!qr.passed && qr.output) {
            // Include first 500 chars of failure output
            const truncated = qr.output.slice(0, 500);
            sections.push(
              `  \`\`\`\n  ${truncated}${qr.output.length > 500 ? '\n  ...(truncated)' : ''}\n  \`\`\``,
            );
          }
        }
        sections.push('');
      }

      // Include a summary from the agent output (first 2000 chars)
      if (agentOutput && agentOutput.trim().length > 0) {
        const trimmedOutput = agentOutput.trim().slice(0, 2000);
        sections.push(
          `## Agent Output Summary\n\`\`\`\n${trimmedOutput}${agentOutput.length > 2000 ? '\n...(truncated)' : ''}\n\`\`\`\n`,
        );
      }

      const content = sections.join('\n');

      const metadata = {
        loopId: this.loopId,
        storyId: story.id,
        conversationId,
        outcome,
        attempts: story.attempts + 1,
        maxAttempts: story.maxAttempts,
        qualityPassed: qualityResults.filter((qr) => qr.passed).length,
        qualityFailed: qualityResults.filter((qr) => !qr.passed).length,
      };

      db.query(
        `INSERT INTO agent_notes (id, workspace_path, conversation_id, story_id, title, content, category, status, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'unread', ?, ?, ?)`,
      ).run(
        id,
        this.workspacePath,
        conversationId,
        story.id,
        title,
        content,
        category,
        JSON.stringify(metadata),
        now,
        now,
      );

      // Emit stream event so UI updates in real time
      const note: AgentNote = {
        id,
        workspacePath: this.workspacePath,
        conversationId,
        storyId: story.id,
        title,
        content,
        category,
        status: 'unread',
        metadata,
        createdAt: now,
        updatedAt: now,
      };

      const evt: StreamAgentNoteCreated = {
        type: 'agent_note_created',
        note,
      };
      this.events.emit('loop_event', evt);

      // Send notification for agent note
      sendNotification({
        event: 'agent_note_created',
        title: 'Agent Note Created',
        message: `📝 ${title}\n\n${content.slice(0, 200)}${content.length > 200 ? '...' : ''}`,
        workspaceId: this.workspacePath,
        conversationId,
        storyId: story.id,
      }).catch((err) => {
        console.error(`[loop:${this.loopId}] Failed to send agent_note_created notification:`, err);
      });

      console.log(`[loop:${this.loopId}] Created agent note "${title}" (${id})`);
    } catch (err) {
      console.error(`[loop:${this.loopId}] Failed to create agent note:`, err);
    }
  }

  // --- Git operations ---

  /**
   * Revert all uncommitted changes (staged, tracked modifications, + untracked files)
   * so the working tree matches the last commit. Used to clean up after a
   * story fails quality checks, preventing cascading failures.
   *
   * The three-step sequence handles all cases:
   *   1. git reset HEAD — unstage everything (critical when `git add -A` ran
   *      but `git commit` failed, leaving new files in the index)
   *   2. git checkout . — revert tracked file modifications
   *   3. git clean -fd  — remove untracked files and directories
   */
  private async revertUncommittedChanges(storyId?: string): Promise<void> {
    const tag = `[loop:${this.loopId}]`;
    const cwd = storyId ? this.resolveStoryCwd(storyId) : this.workspacePath;
    try {
      const checkProc = Bun.spawn(['git', 'rev-parse', '--is-inside-work-tree'], {
        cwd,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const isRepo = (await new Response(checkProc.stdout).text()).trim() === 'true';
      if (!isRepo) return;

      // Log status BEFORE reverting — helpful for diagnosing what the failed story changed
      const beforeStatusProc = Bun.spawn(['git', 'status', '--porcelain'], {
        cwd,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const beforeStatus = await new Response(beforeStatusProc.stdout).text();
      await beforeStatusProc.exited;
      const beforeLines = beforeStatus.trim() ? beforeStatus.trim().split('\n') : [];
      console.log(
        `${tag} [revert] Status BEFORE revert (${beforeLines.length} file(s)):`,
        beforeStatus,
      );

      // Step 1: Unstage everything — handles new files left in the index after
      // a failed `git commit` (git checkout alone won't touch staged new files)
      const resetProc = Bun.spawn(['git', 'reset', 'HEAD'], {
        cwd,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const resetExit = await resetProc.exited;
      if (resetExit !== 0) {
        const resetErr = await new Response(resetProc.stderr).text();
        console.warn(`${tag} [revert] git reset HEAD failed (exit ${resetExit}):`, resetErr.trim());
      }

      // Step 2: Revert tracked file modifications
      const checkoutProc = Bun.spawn(['git', 'checkout', '.'], {
        cwd,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const checkoutExit = await checkoutProc.exited;
      if (checkoutExit !== 0) {
        const checkoutErr = await new Response(checkoutProc.stderr).text();
        console.warn(
          `${tag} [revert] git checkout . failed (exit ${checkoutExit}):`,
          checkoutErr.trim(),
        );
      }

      // Step 3: Remove untracked files and directories added by the failed story
      const cleanProc = Bun.spawn(['git', 'clean', '-fd'], {
        cwd,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const cleanExit = await cleanProc.exited;
      if (cleanExit !== 0) {
        const cleanErr = await new Response(cleanProc.stderr).text();
        console.warn(`${tag} [revert] git clean -fd failed (exit ${cleanExit}):`, cleanErr.trim());
      }

      // Log status AFTER reverting — should be clean
      const afterStatusProc = Bun.spawn(['git', 'status', '--porcelain'], {
        cwd,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const afterStatus = await new Response(afterStatusProc.stdout).text();
      await afterStatusProc.exited;
      const afterLines = afterStatus.trim() ? afterStatus.trim().split('\n') : [];

      if (afterLines.length > 0) {
        console.warn(
          `${tag} [revert] WARNING: Working tree still has ${afterLines.length} change(s) after revert:`,
          afterStatus,
        );
      } else {
        console.log(
          `${tag} [revert] Reverted ${beforeLines.length} change(s) — working tree is clean`,
        );
      }
    } catch (err) {
      console.error(`${tag} [revert] Failed to revert uncommitted changes:`, err);
    }
  }

  private async createGitSnapshot(storyId: string, messageId?: string): Promise<void> {
    const snapshotCwd = this.resolveStoryCwd(storyId);
    try {
      const checkProc = Bun.spawn(['git', 'rev-parse', '--is-inside-work-tree'], {
        cwd: snapshotCwd,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const isRepo = (await new Response(checkProc.stdout).text()).trim() === 'true';
      if (!isRepo) return;

      const headProc = Bun.spawn(['git', 'rev-parse', 'HEAD'], {
        cwd: snapshotCwd,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const headSha = (await new Response(headProc.stdout).text()).trim();
      if ((await headProc.exited) !== 0) return;

      const statusProc = Bun.spawn(['git', 'status', '--porcelain'], {
        cwd: snapshotCwd,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const statusOutput = (await new Response(statusProc.stdout).text()).trim();
      const hasChanges = statusOutput.length > 0;

      let stashSha: string | null = null;
      if (hasChanges) {
        const stashProc = Bun.spawn(['git', 'stash', 'create'], {
          cwd: snapshotCwd,
          stdout: 'pipe',
          stderr: 'pipe',
        });
        stashSha = (await new Response(stashProc.stdout).text()).trim() || null;
      }

      const db = getDb();
      db.query(
        `INSERT INTO git_snapshots (id, workspace_path, head_sha, stash_sha, reason, has_changes, message_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        nanoid(),
        this.workspacePath,
        headSha,
        stashSha,
        `loop:${this.loopId}:story:${storyId}`,
        hasChanges ? 1 : 0,
        messageId || null,
        Date.now(),
      );
    } catch (err) {
      console.error(`[loop:${this.loopId}] Git snapshot failed:`, err);
    }
  }

  private async gitCommit(story: UserStory): Promise<string | null> {
    const tag = `[loop:${this.loopId}]`;
    const commitCwd = this.resolveStoryCwd(story.id);
    // Git commits should have a very long timeout to accommodate slow pre-commit hooks
    const GIT_COMMIT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

    // Check status BEFORE staging
    const beforeStatusProc = Bun.spawn(['git', 'status', '--porcelain'], {
      cwd: commitCwd,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const beforeStatus = await new Response(beforeStatusProc.stdout).text();
    await beforeStatusProc.exited;
    console.log(`${tag} [gitCommit] Status BEFORE git add:`, beforeStatus);

    // Run prettier on changed files BEFORE staging to prevent pre-commit hook
    // failures from lint-staged/prettier reformatting staged files.
    try {
      // Get list of changed files (modified + new) to format only those
      const changedFiles = beforeStatus
        .trim()
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => l.trim().slice(3)) // strip git status prefix (e.g. " M ", "?? ")
        .filter(
          (f) =>
            f.endsWith('.ts') ||
            f.endsWith('.js') ||
            f.endsWith('.svelte') ||
            f.endsWith('.json') ||
            f.endsWith('.css') ||
            f.endsWith('.html') ||
            f.endsWith('.md'),
        );

      if (changedFiles.length > 0) {
        console.log(
          `${tag} [gitCommit] Running prettier on ${changedFiles.length} file(s) before staging...`,
        );
        const prettierProc = Bun.spawn(['npx', 'prettier', '--write', ...changedFiles], {
          cwd: commitCwd,
          stdout: 'pipe',
          stderr: 'pipe',
          env: { ...process.env, FORCE_COLOR: '0' },
        });
        // Short timeout — prettier should be fast
        const prettierTimeout = setTimeout(() => prettierProc.kill(), 60_000);
        await prettierProc.exited;
        clearTimeout(prettierTimeout);
        console.log(`${tag} [gitCommit] Prettier formatting complete`);
      }
    } catch (prettierErr) {
      // Non-fatal — continue with commit even if prettier fails
      console.warn(`${tag} [gitCommit] Prettier failed (non-fatal):`, prettierErr);
    }

    // Stage all changes
    const addProc = Bun.spawn(['git', 'add', '-A'], {
      cwd: commitCwd,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const addExit = await addProc.exited;
    if (addExit !== 0) {
      const stderr = (await new Response(addProc.stderr).text()).trim();
      throw new Error(`git add failed (exit ${addExit}): ${stderr.slice(0, 500)}`);
    }

    // Check status AFTER staging, BEFORE commit
    const afterAddProc = Bun.spawn(['git', 'status', '--porcelain'], {
      cwd: commitCwd,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const afterAddStatus = await new Response(afterAddProc.stdout).text();
    await afterAddProc.exited;
    console.log(`${tag} [gitCommit] Status AFTER git add:`, afterAddStatus);

    // Check if there are staged changes
    const diffProc = Bun.spawn(['git', 'diff', '--cached', '--quiet'], {
      cwd: commitCwd,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const diffExit = await diffProc.exited;
    if (diffExit === 0) {
      console.log(`${tag} [gitCommit] No staged changes to commit`);
      return null;
    }

    // Commit with timeout to handle slow pre-commit hooks
    const msg = this.prdId
      ? `[golem] ${story.title}\n\nImplemented by E Golem.\nPRD: ${this.prdId}\nStory: ${story.id}`
      : `[golem] ${story.title}\n\nImplemented by E Golem.\nStory: ${story.id}`;

    // Use --no-verify to skip the pre-commit hook — the loop has already run
    // its own quality checks (typecheck, lint, test). Re-running them in the
    // hook is redundant and frequently causes spurious commit failures (e.g.
    // lint-staged conflicts, NX cache mismatches) that burn through attempts.
    console.log(
      `${tag} [gitCommit] Starting commit (timeout: ${GIT_COMMIT_TIMEOUT_MS / 1000}s)...`,
    );
    const commitProc = Bun.spawn(['git', 'commit', '--no-verify', '-m', msg], {
      cwd: commitCwd,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    // Race commit against timeout to handle slow pre-commit hooks
    const commitTimeout = new Promise<number>((resolve) =>
      setTimeout(() => resolve(-1), GIT_COMMIT_TIMEOUT_MS),
    );
    const commitExit = await Promise.race([commitProc.exited, commitTimeout]);

    if (commitExit === -1) {
      // Timeout hit - kill the process
      console.error(`${tag} [gitCommit] Commit timed out after ${GIT_COMMIT_TIMEOUT_MS / 1000}s`);
      commitProc.kill();
      throw new Error(
        `git commit timed out after ${GIT_COMMIT_TIMEOUT_MS / 1000}s - pre-commit hooks may be too slow`,
      );
    }

    if (commitExit !== 0) {
      const stderr = (await new Response(commitProc.stderr).text()).trim();
      throw new Error(`git commit failed (exit ${commitExit}): ${stderr.slice(0, 500)}`);
    }

    console.log(`${tag} [gitCommit] Commit succeeded`);

    // Check status AFTER commit
    const afterCommitProc = Bun.spawn(['git', 'status', '--porcelain'], {
      cwd: commitCwd,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const afterCommitStatus = await new Response(afterCommitProc.stdout).text();
    await afterCommitProc.exited;
    console.log(`${tag} [gitCommit] Status AFTER commit:`, afterCommitStatus);

    // Get commit SHA
    const shaProc = Bun.spawn(['git', 'rev-parse', 'HEAD'], {
      cwd: commitCwd,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const shaExit = await shaProc.exited;
    const sha = (await new Response(shaProc.stdout).text()).trim();
    if (shaExit !== 0 || !sha) {
      throw new Error(`Failed to get commit SHA after successful commit (exit ${shaExit})`);
    }

    console.log(`${tag} [gitCommit] Commit successful: ${sha}`);
    return sha;
  }

  // --- Pause/Resume/Cancel ---

  pause(): void {
    let resolve: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    this.pauseGate = { promise, resolve: resolve! };
  }

  resume(): void {
    if (this.pauseGate) {
      this.pauseGate.resolve();
      this.pauseGate = null;
    }
  }

  cancel(): void {
    this.cancelled = true;
    // Also resolve pause gate if paused
    if (this.pauseGate) {
      this.pauseGate.resolve();
      this.pauseGate = null;
    }
  }

  private async checkPauseGate(): Promise<void> {
    if (this.pauseGate) {
      await this.pauseGate.promise;
    }
  }

  private emitEvent(event: StreamLoopEvent['event'], data: StreamLoopEvent['data']): void {
    const evt: StreamLoopEvent = { type: 'loop_event', loopId: this.loopId, event, data };
    this.events.emit('loop_event', evt);
  }
}
