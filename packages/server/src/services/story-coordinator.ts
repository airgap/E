import { EventEmitter } from 'events';
import { getDb } from '../db/database';
import type {
  StoryClaimRequest,
  StoryClaimResponse,
  StoryHeartbeatRequest,
  StoryHeartbeatResponse,
  StoryResultReport,
  StoryResultResponse,
  AvailableStoriesRequest,
  AvailableStory,
  CoordinationConfig,
  CoordinationEvent,
  UserStory,
  WorkflowConfig,
} from '@e/shared';
import { DEFAULT_COORDINATION_CONFIG, DEFAULT_WORKFLOW_CONFIG } from '@e/shared';
import { storyFromRow } from './loop/helpers';

/**
 * StoryCoordinator — manages distributed story claiming, lease-based locking,
 * heartbeat renewal, and result reporting.
 *
 * The E server (coordinator) is the single source of truth. Remote golems
 * claim stories via authenticated HTTP endpoints. All claim operations are
 * atomic (compare-and-swap on story status) to prevent double-assignment.
 *
 * Protocol flow:
 * 1. Golem sends claim request
 * 2. Coordinator atomically assigns story + creates lease
 * 3. Golem sends heartbeats during execution
 * 4. Golem sends result (success/failure + branch name)
 * 5. Coordinator releases lease and updates story status
 * 6. On heartbeat timeout, coordinator marks story as failed_timeout
 */
class StoryCoordinator {
  readonly events = new EventEmitter();
  private config: CoordinationConfig = { ...DEFAULT_COORDINATION_CONFIG };
  private leaseCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Periodically check for expired leases
    this.leaseCheckInterval = setInterval(() => {
      this.releaseTimedOutLeases();
    }, 30_000); // Check every 30s
  }

  /**
   * Update coordination config (heartbeat interval, lease expiry, etc.).
   */
  updateConfig(config: Partial<CoordinationConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get the current coordination config.
   */
  getConfig(): CoordinationConfig {
    return { ...this.config };
  }

  /**
   * Atomically claim a story for execution.
   *
   * Uses compare-and-swap: only claims if story status is 'pending' or 'failed_timeout'.
   * Creates a lease in the story_leases table and updates the story's executor metadata.
   *
   * First writer wins — if two executors race, the one whose UPDATE affects a row
   * first will succeed. SQLite's serialized writes guarantee this.
   */
  claimStory(request: StoryClaimRequest): StoryClaimResponse {
    const db = getDb();
    const now = Date.now();
    const leaseExpiresAt = now + this.config.leaseExpiryMs;

    // Step 1: Check if the story exists and is claimable
    const story = db.query('SELECT * FROM prd_stories WHERE id = ?').get(request.storyId) as any;
    if (!story) {
      return { claimed: false, reason: 'Story not found' };
    }

    // Step 2: Check if story has exhausted its attempts
    if (story.attempts >= story.max_attempts) {
      return { claimed: false, reason: 'Story has exhausted all attempts' };
    }

    // Step 3: Check if the story status allows claiming
    const claimableStatuses = ['pending', 'failed_timeout'];
    if (!claimableStatuses.includes(story.status)) {
      // Check if there's an existing lease holder
      const existingLease = db
        .query('SELECT * FROM story_leases WHERE story_id = ?')
        .get(request.storyId) as any;
      return {
        claimed: false,
        reason: `Story is in status '${story.status}' — only 'pending' or 'failed_timeout' stories can be claimed`,
        currentExecutorId: existingLease?.executor_id,
      };
    }

    // Step 4: Dependency-aware scheduling — check if all dependencies are met
    const dependsOn: string[] = JSON.parse(story.depends_on || '[]');
    if (dependsOn.length > 0) {
      const unmetDeps = this.getUnmetDependencies(dependsOn, story.prd_id, story.workspace_path);
      if (unmetDeps.length > 0) {
        return {
          claimed: false,
          reason: 'Story has unmet dependencies',
          unmetDependencies: unmetDeps,
        };
      }
    }

    // Step 5: Atomic claim — compare-and-swap on status
    // Only transitions from claimable status to 'in_progress'.
    // If another executor already claimed it (status changed), this UPDATE will
    // match 0 rows and we detect the conflict.
    const result = db
      .query(
        `UPDATE prd_stories
       SET status = 'in_progress',
           executor_id = ?,
           executor_type = ?,
           machine_id = ?,
           started_at = ?,
           last_heartbeat = ?,
           assigned_branch = ?,
           lease_expires_at = ?,
           attempts = attempts + 1,
           updated_at = ?
       WHERE id = ? AND status IN ('pending', 'failed_timeout')`,
      )
      .run(
        request.executorId,
        request.executorType,
        request.machineId,
        now,
        now,
        request.assignedBranch,
        leaseExpiresAt,
        now,
        request.storyId,
      );

    if (result.changes === 0) {
      // CAS failed — another executor claimed it first
      const currentStory = db
        .query('SELECT executor_id, status FROM prd_stories WHERE id = ?')
        .get(request.storyId) as any;
      return {
        claimed: false,
        reason: `Conflict: story was claimed by another executor (status: ${currentStory?.status})`,
        currentExecutorId: currentStory?.executor_id,
      };
    }

    // Step 6: Create lease record
    db.query(
      `INSERT OR REPLACE INTO story_leases
       (story_id, executor_id, executor_type, machine_id, assigned_branch,
        started_at, last_heartbeat, lease_expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      request.storyId,
      request.executorId,
      request.executorType,
      request.machineId,
      request.assignedBranch,
      now,
      now,
      leaseExpiresAt,
      now,
    );

    // Step 7: Emit coordination event
    this.emitEvent({
      type: 'story_claimed',
      storyId: request.storyId,
      executorId: request.executorId,
      executorType: request.executorType,
      machineId: request.machineId,
      timestamp: now,
    });

    console.log(
      `[coordinator] Story ${request.storyId} claimed by executor ${request.executorId} (${request.executorType}@${request.machineId})`,
    );

    return {
      claimed: true,
      leaseExpiresAt,
    };
  }

  /**
   * Renew the heartbeat for a claimed story, extending the lease.
   *
   * Only the executor that holds the lease can renew it (validated by executorId).
   * If the lease has already expired, the renewal is rejected.
   */
  renewHeartbeat(storyId: string, request: StoryHeartbeatRequest): StoryHeartbeatResponse {
    const db = getDb();
    const now = Date.now();
    const newLeaseExpiresAt = now + this.config.leaseExpiryMs;

    // Verify the lease exists and belongs to this executor
    const lease = db.query('SELECT * FROM story_leases WHERE story_id = ?').get(storyId) as any;

    if (!lease) {
      return { renewed: false, reason: 'No active lease for this story' };
    }

    if (lease.executor_id !== request.executorId) {
      return { renewed: false, reason: 'wrong_executor' };
    }

    // Check if lease has already expired (another process may have cleaned it up)
    if (lease.lease_expires_at < now) {
      return { renewed: false, reason: 'lease_expired' };
    }

    // Update the lease and story heartbeat
    db.query(
      `UPDATE story_leases
       SET last_heartbeat = ?, lease_expires_at = ?
       WHERE story_id = ? AND executor_id = ?`,
    ).run(now, newLeaseExpiresAt, storyId, request.executorId);

    db.query(
      `UPDATE prd_stories
       SET last_heartbeat = ?, lease_expires_at = ?, updated_at = ?
       WHERE id = ?`,
    ).run(now, newLeaseExpiresAt, now, storyId);

    this.emitEvent({
      type: 'story_heartbeat',
      storyId,
      executorId: request.executorId,
      timestamp: now,
      data: {
        progress: request.progress,
        message: request.message,
      },
    });

    return {
      renewed: true,
      leaseExpiresAt: newLeaseExpiresAt,
    };
  }

  /**
   * Report the result of a story execution.
   *
   * Validates that the reporting executor holds the lease, then:
   * - On success: marks story as 'qa' (or 'completed'), triggers merge-back workflow
   * - On failure: marks story as 'failed', releases lease
   * - On timeout: marks story as 'failed_timeout', makes available for retry
   * - On cancel: marks story as 'pending', releases lease
   */
  reportResult(storyId: string, report: StoryResultReport): StoryResultResponse {
    const db = getDb();
    const now = Date.now();

    // Verify the lease
    const lease = db.query('SELECT * FROM story_leases WHERE story_id = ?').get(storyId) as any;

    if (!lease) {
      return { accepted: false, reason: 'No active lease for this story' };
    }

    if (lease.executor_id !== report.executorId) {
      return {
        accepted: false,
        reason: 'Executor ID mismatch — only the lease holder can report results',
      };
    }

    // Determine new status based on result
    let newStatus: string;
    let mergeTriggered = false;

    switch (report.status) {
      case 'success':
        newStatus = 'qa'; // Goes to QA for review; coordinator may auto-complete
        mergeTriggered = true;
        break;
      case 'failure':
        newStatus = 'failed';
        break;
      case 'timeout':
        newStatus = 'failed_timeout';
        break;
      case 'cancelled':
        newStatus = 'pending';
        break;
      default:
        return { accepted: false, reason: `Unknown status: ${report.status}` };
    }

    // Update the story
    const updateFields: string[] = ['status = ?', 'updated_at = ?'];
    const updateValues: any[] = [newStatus, now];

    if (report.commitSha) {
      updateFields.push('commit_sha = ?');
      updateValues.push(report.commitSha);
    }
    if (report.conversationId) {
      updateFields.push('conversation_id = ?');
      updateValues.push(report.conversationId);
    }
    if (report.agentId) {
      updateFields.push('agent_id = ?');
      updateValues.push(report.agentId);
    }
    if (report.learnings && report.learnings.length > 0) {
      // Append learnings to existing ones
      const story = db.query('SELECT learnings FROM prd_stories WHERE id = ?').get(storyId) as any;
      const existingLearnings: string[] = JSON.parse(story?.learnings || '[]');
      const allLearnings = [...existingLearnings, ...report.learnings];
      updateFields.push('learnings = ?');
      updateValues.push(JSON.stringify(allLearnings));
    }

    // Clear executor metadata on release (except for success where we keep it for audit)
    if (report.status !== 'success') {
      updateFields.push('executor_id = NULL');
      updateFields.push('executor_type = NULL');
      updateFields.push('machine_id = NULL');
      updateFields.push('started_at = NULL');
      updateFields.push('last_heartbeat = NULL');
      updateFields.push('assigned_branch = NULL');
      updateFields.push('lease_expires_at = NULL');
    }

    updateValues.push(storyId);
    db.query(`UPDATE prd_stories SET ${updateFields.join(', ')} WHERE id = ?`).run(...updateValues);

    // Release the lease
    db.query('DELETE FROM story_leases WHERE story_id = ?').run(storyId);

    // Emit coordination event
    const eventType = report.status === 'success' ? 'story_completed' : 'story_failed';
    this.emitEvent({
      type: eventType,
      storyId,
      executorId: report.executorId,
      timestamp: now,
      data: {
        status: report.status,
        branchName: report.branchName,
        commitSha: report.commitSha,
        durationMs: report.durationMs,
      },
    });

    // Trigger merge-back workflow on success
    if (mergeTriggered && report.branchName) {
      this.triggerMergeBack(storyId, report.branchName, report.executorId);
    }

    console.log(
      `[coordinator] Story ${storyId} result reported by ${report.executorId}: ${report.status} → ${newStatus}`,
    );

    return {
      accepted: true,
      newStatus: newStatus as any,
      mergeTriggered,
    };
  }

  /**
   * Release all timed-out story leases.
   *
   * Called periodically by the coordinator. Any lease whose lease_expires_at
   * is in the past gets released, and the story status is set to 'failed_timeout'
   * making it available for retry by another executor.
   */
  releaseTimedOutLeases(): number {
    const db = getDb();
    const now = Date.now();

    // Find expired leases
    const expiredLeases = db
      .query('SELECT * FROM story_leases WHERE lease_expires_at < ?')
      .all(now) as any[];

    if (expiredLeases.length === 0) return 0;

    for (const lease of expiredLeases) {
      // Check if story is still in_progress (hasn't been completed by another path)
      const story = db
        .query('SELECT status, attempts, max_attempts FROM prd_stories WHERE id = ?')
        .get(lease.story_id) as any;

      if (!story || story.status !== 'in_progress') {
        // Story status already changed — just clean up the lease
        db.query('DELETE FROM story_leases WHERE story_id = ?').run(lease.story_id);
        continue;
      }

      // Mark story as failed_timeout (eligible for retry)
      const newStatus = story.attempts >= story.max_attempts ? 'failed' : 'failed_timeout';

      db.query(
        `UPDATE prd_stories
         SET status = ?,
             executor_id = NULL,
             executor_type = NULL,
             machine_id = NULL,
             started_at = NULL,
             last_heartbeat = NULL,
             assigned_branch = NULL,
             lease_expires_at = NULL,
             updated_at = ?
         WHERE id = ?`,
      ).run(newStatus, now, lease.story_id);

      // Remove the lease
      db.query('DELETE FROM story_leases WHERE story_id = ?').run(lease.story_id);

      // Emit timeout event
      this.emitEvent({
        type: 'story_timeout',
        storyId: lease.story_id,
        executorId: lease.executor_id,
        executorType: lease.executor_type,
        machineId: lease.machine_id,
        timestamp: now,
      });

      console.log(
        `[coordinator] Lease expired for story ${lease.story_id} (executor: ${lease.executor_id}@${lease.machine_id}) → ${newStatus}`,
      );
    }

    return expiredLeases.length;
  }

  /**
   * List stories available for claiming by a remote executor.
   *
   * Returns stories that are 'pending' or 'failed_timeout', have attempts
   * remaining, are not research-only, and have all dependencies met.
   */
  getAvailableStories(request: AvailableStoriesRequest): AvailableStory[] {
    const db = getDb();

    // Build query based on filters
    let query: string;
    const params: any[] = [];

    if (request.prdId) {
      query = `SELECT * FROM prd_stories
               WHERE prd_id = ? AND status IN ('pending', 'failed_timeout')
               AND attempts < max_attempts
               AND (research_only = 0 OR research_only IS NULL)
               ORDER BY sort_order ASC, created_at ASC`;
      params.push(request.prdId);
    } else if (request.workspacePath) {
      query = `SELECT * FROM prd_stories
               WHERE workspace_path = ? AND status IN ('pending', 'failed_timeout')
               AND attempts < max_attempts
               AND (research_only = 0 OR research_only IS NULL)
               ORDER BY sort_order ASC, created_at ASC`;
      params.push(request.workspacePath);
    } else {
      query = `SELECT * FROM prd_stories
               WHERE status IN ('pending', 'failed_timeout')
               AND attempts < max_attempts
               AND (research_only = 0 OR research_only IS NULL)
               ORDER BY sort_order ASC, created_at ASC`;
    }

    const rows = db.query(query).all(...params) as any[];

    // Filter by dependency satisfaction
    // Load all stories in the same context to check dependencies
    let allStories: any[];
    if (request.prdId) {
      allStories = db.query('SELECT * FROM prd_stories WHERE prd_id = ?').all(request.prdId);
    } else if (request.workspacePath) {
      allStories = db
        .query('SELECT * FROM prd_stories WHERE workspace_path = ?')
        .all(request.workspacePath);
    } else {
      allStories = db.query('SELECT * FROM prd_stories').all();
    }

    const allStoriesParsed = allStories.map(storyFromRow);

    // Get workflow config for dependency resolution
    let workflowConfig: WorkflowConfig = DEFAULT_WORKFLOW_CONFIG;
    if (request.prdId) {
      const prd = db
        .query('SELECT workflow_config FROM prds WHERE id = ?')
        .get(request.prdId) as any;
      if (prd?.workflow_config) {
        try {
          const parsed = JSON.parse(prd.workflow_config);
          if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
            workflowConfig = { ...DEFAULT_WORKFLOW_CONFIG, ...parsed };
          }
        } catch {
          /* use defaults */
        }
      }
    }

    const doneIds = new Set(
      allStoriesParsed
        .filter(
          (s: UserStory) =>
            s.status === 'completed' || (workflowConfig.qaUnblocksDependents && s.status === 'qa'),
        )
        .map((s: UserStory) => s.id),
    );

    // Filter to only stories with all dependencies met
    const available: AvailableStory[] = [];
    for (const row of rows) {
      const dependsOn: string[] = JSON.parse(row.depends_on || '[]');
      const allDepsMet = dependsOn.every((depId: string) => doneIds.has(depId));

      if (allDepsMet) {
        available.push({
          id: row.id,
          title: row.title,
          description: row.description,
          priority: row.priority,
          prdId: row.prd_id || null,
          workspacePath: row.workspace_path || '',
          acceptanceCriteria: JSON.parse(row.acceptance_criteria || '[]').map((ac: any) =>
            typeof ac === 'string' ? ac : ac.description,
          ),
          learnings: JSON.parse(row.learnings || '[]'),
          attempts: row.attempts,
          maxAttempts: row.max_attempts,
          dependsOn,
        });
      }
    }

    return available;
  }

  /**
   * Get active leases for monitoring.
   */
  getActiveLeases(): any[] {
    const db = getDb();
    return db
      .query(
        `SELECT sl.*, ps.title as story_title, ps.status as story_status
       FROM story_leases sl
       JOIN prd_stories ps ON ps.id = sl.story_id
       ORDER BY sl.created_at DESC`,
      )
      .all();
  }

  /**
   * Force-release a lease (admin operation).
   * Sets the story back to 'pending' and removes the lease.
   */
  forceReleaseLease(storyId: string): boolean {
    const db = getDb();
    const now = Date.now();

    const lease = db.query('SELECT * FROM story_leases WHERE story_id = ?').get(storyId) as any;

    if (!lease) return false;

    db.query(
      `UPDATE prd_stories
       SET status = 'pending',
           executor_id = NULL,
           executor_type = NULL,
           machine_id = NULL,
           started_at = NULL,
           last_heartbeat = NULL,
           assigned_branch = NULL,
           lease_expires_at = NULL,
           updated_at = ?
       WHERE id = ?`,
    ).run(now, storyId);

    db.query('DELETE FROM story_leases WHERE story_id = ?').run(storyId);

    this.emitEvent({
      type: 'story_released',
      storyId,
      executorId: lease.executor_id,
      timestamp: now,
    });

    console.log(
      `[coordinator] Force-released lease for story ${storyId} (was held by ${lease.executor_id})`,
    );

    return true;
  }

  /**
   * Shutdown the coordinator (cleanup intervals).
   */
  shutdown(): void {
    if (this.leaseCheckInterval) {
      clearInterval(this.leaseCheckInterval);
      this.leaseCheckInterval = null;
    }
  }

  // --- Private helpers ---

  /**
   * Check which dependency story IDs are not yet completed.
   */
  private getUnmetDependencies(
    dependsOn: string[],
    prdId: string | null,
    workspacePath: string | null,
  ): string[] {
    const db = getDb();

    // Load workflow config
    let workflowConfig: WorkflowConfig = DEFAULT_WORKFLOW_CONFIG;
    if (prdId) {
      const prd = db.query('SELECT workflow_config FROM prds WHERE id = ?').get(prdId) as any;
      if (prd?.workflow_config) {
        try {
          const parsed = JSON.parse(prd.workflow_config);
          if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
            workflowConfig = { ...DEFAULT_WORKFLOW_CONFIG, ...parsed };
          }
        } catch {
          /* use defaults */
        }
      }
    }

    const unmet: string[] = [];
    for (const depId of dependsOn) {
      const dep = db.query('SELECT status FROM prd_stories WHERE id = ?').get(depId) as any;

      if (!dep) continue; // Dependency doesn't exist — skip (could be deleted)

      const isDone =
        dep.status === 'completed' || (workflowConfig.qaUnblocksDependents && dep.status === 'qa');

      if (!isDone) {
        unmet.push(depId);
      }
    }

    return unmet;
  }

  /**
   * Trigger merge-back workflow for a completed story.
   * This is a fire-and-forget operation — the actual merge is handled
   * by the worktree service or the executor.
   */
  private triggerMergeBack(storyId: string, branchName: string, executorId: string): void {
    this.emitEvent({
      type: 'merge_triggered',
      storyId,
      executorId,
      timestamp: Date.now(),
      data: { branchName },
    });

    console.log(`[coordinator] Merge-back triggered for story ${storyId} (branch: ${branchName})`);
  }

  /**
   * Emit a coordination event.
   */
  private emitEvent(event: CoordinationEvent): void {
    this.events.emit('coordination_event', event);
  }
}

/** Singleton story coordinator. */
export const storyCoordinator = new StoryCoordinator();
