import { EventEmitter } from 'events';
import { getDb } from '../../db/database';
import type { LoopConfig, LoopState, LoopStatus, StreamLoopEvent } from '@e/shared';
import { LoopRunner } from './runner';
import { loopFromRow } from './helpers';
import { getHostname } from '../../golem-names';

/**
 * Manages the Golem lifecycle. Singleton, like claudeManager.
 * Each loop run creates real E conversations and tasks for traceability.
 */
class LoopOrchestrator {
  private runners = new Map<string, LoopRunner>();
  readonly events = new EventEmitter();
  private zombieCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Clean up finished runners
    this.events.on('loop_done', (loopId: string) => {
      this.runners.delete(loopId);
    });

    // On startup, recover or resume any orphaned loops from a previous server crash / hot reload
    this.recoverOrResumeZombieLoops();

    // Periodically check for zombie loops (runner died without updating DB)
    this.zombieCheckInterval = setInterval(() => this.recoverZombieLoops(), 30_000);
  }

  /**
   * Collect the story IDs that belong to this specific loop (from current_story_id
   * and active_story_ids). Returns an array of IDs, which may be empty if the loop
   * had no recorded active stories.
   */
  private getLoopStoryIds(row: any): string[] {
    const ids = new Set<string>();
    if (row.current_story_id) ids.add(row.current_story_id);
    if (row.active_story_ids) {
      try {
        const parsed = JSON.parse(row.active_story_ids);
        if (Array.isArray(parsed)) {
          for (const id of parsed) {
            if (typeof id === 'string' && id) ids.add(id);
          }
        }
      } catch {
        // Malformed JSON — ignore
      }
    }
    return Array.from(ids);
  }

  /**
   * Check whether the loop has remaining stories to work on, scoped to this
   * loop's tracked story IDs when available. Falls back to PRD/workspace-level
   * check as a safety net if no active story IDs are recorded on the loop.
   */
  private hasPendingWork(row: any): boolean {
    const db = getDb();
    const storyIds = this.getLoopStoryIds(row);

    if (storyIds.length > 0) {
      // Scoped check: only count stories belonging to THIS loop
      const placeholders = storyIds.map(() => '?').join(', ');
      const count = db
        .query(
          `SELECT COUNT(*) as c FROM prd_stories WHERE id IN (${placeholders}) AND status IN ('pending', 'in_progress', 'failed_timeout') AND (research_only = 0 OR research_only IS NULL)`,
        )
        .get(...storyIds) as any;
      return count && count.c > 0;
    }

    // Fallback: no recorded story IDs — use broader PRD/workspace scope
    if (row.prd_id) {
      const count = db
        .query(
          "SELECT COUNT(*) as c FROM prd_stories WHERE prd_id = ? AND status IN ('pending', 'in_progress', 'failed_timeout') AND (research_only = 0 OR research_only IS NULL)",
        )
        .get(row.prd_id) as any;
      return count && count.c > 0;
    } else {
      const count = db
        .query(
          "SELECT COUNT(*) as c FROM prd_stories WHERE prd_id IS NULL AND workspace_path = ? AND status IN ('pending', 'in_progress', 'failed_timeout') AND (research_only = 0 OR research_only IS NULL)",
        )
        .get(row.workspace_path) as any;
      return count && count.c > 0;
    }
  }

  /**
   * Reset in_progress stories back to pending, scoped to the specific loop's
   * story IDs when available. Falls back to PRD/workspace-level reset as a
   * safety net if no active story IDs are recorded on the loop.
   */
  private resetInProgressStories(row: any, now: number): void {
    const db = getDb();
    const storyIds = this.getLoopStoryIds(row);

    if (storyIds.length > 0) {
      // Scoped reset: only reset stories that belong to THIS loop
      const placeholders = storyIds.map(() => '?').join(', ');
      db.query(
        `UPDATE prd_stories SET status = 'pending', updated_at = ? WHERE id IN (${placeholders}) AND status = 'in_progress'`,
      ).run(now, ...storyIds);
    } else {
      // Fallback: no recorded story IDs — use the broader PRD/workspace scope
      const prdId = row.prd_id;
      if (prdId) {
        db.query(
          "UPDATE prd_stories SET status = 'pending', updated_at = ? WHERE prd_id = ? AND status = 'in_progress'",
        ).run(now, prdId);
      } else {
        db.query(
          "UPDATE prd_stories SET status = 'pending', updated_at = ? WHERE prd_id IS NULL AND workspace_path = ? AND status = 'in_progress'",
        ).run(now, row.workspace_path);
      }
    }
  }

  /**
   * Determine the correct terminal status for a loop based on its story outcomes.
   * Returns 'completed' if all stories succeeded, 'completed_with_failures' if
   * some succeeded but others failed, or 'failed' if none succeeded.
   */
  private determineTerminalStatus(row: any): {
    status: LoopStatus;
    partial: boolean;
    message: string;
  } {
    const db = getDb();
    const storyIds = this.getLoopStoryIds(row);

    let stories: any[];
    if (storyIds.length > 0) {
      // Scoped: only evaluate stories belonging to THIS loop
      const placeholders = storyIds.map(() => '?').join(', ');
      stories = db
        .query(`SELECT status, research_only FROM prd_stories WHERE id IN (${placeholders})`)
        .all(...storyIds) as any[];
    } else if (row.prd_id) {
      // Fallback: no recorded story IDs — use broader PRD scope
      stories = db
        .query('SELECT status, research_only FROM prd_stories WHERE prd_id = ?')
        .all(row.prd_id) as any[];
    } else {
      // Fallback: no recorded story IDs — use broader workspace scope
      stories = db
        .query(
          'SELECT status, research_only FROM prd_stories WHERE prd_id IS NULL AND workspace_path = ?',
        )
        .all(row.workspace_path) as any[];
    }
    const completedCount = stories.filter(
      (s) =>
        s.status === 'completed' ||
        s.status === 'qa' ||
        s.status === 'skipped' ||
        s.status === 'archived' ||
        s.research_only,
    ).length;
    const failedCount = stories.filter((s) => s.status === 'failed').length;

    if (failedCount === 0 && completedCount === stories.length) {
      return {
        status: 'completed',
        partial: false,
        message: 'All stories completed!',
      };
    } else if (completedCount > 0) {
      return {
        status: 'completed_with_failures',
        partial: true,
        message: `Partial success: ${completedCount} completed, ${failedCount} failed.`,
      };
    } else {
      return {
        status: 'failed',
        partial: false,
        message: 'Loop runner lost. Please start a new loop.',
      };
    }
  }

  /**
   * On startup (including hot reload), detect orphaned running loops and
   * automatically resume them instead of marking them failed. This ensures
   * loops survive Bun --hot reloads transparently.
   */
  private recoverOrResumeZombieLoops(): void {
    try {
      const db = getDb();
      const activeLoops = db
        .query("SELECT * FROM loops WHERE status IN ('running', 'paused')")
        .all() as any[];

      for (const row of activeLoops) {
        if (this.runners.has(row.id)) continue; // Already has a runner

        // Check if there are still pending stories to work on (scoped to this loop)
        const hasPendingWork = this.hasPendingWork(row);

        if (hasPendingWork && row.status === 'running') {
          // Auto-resume: create a new runner to continue this loop
          console.log(`[loop] Auto-resuming orphaned loop ${row.id} (hot reload recovery)`);
          // Reset in_progress stories back to pending — scoped to THIS loop's stories
          this.resetInProgressStories(row, Date.now());

          const config: LoopConfig = JSON.parse(row.config || '{}');
          const runner = new LoopRunner(
            row.id,
            row.prd_id || null,
            row.workspace_path,
            config,
            this.events,
          );
          this.runners.set(row.id, runner);

          runner.run().catch((err) => {
            console.error(`[loop:${row.id}] Resumed runner error:`, err);
            this.updateStatus(row.id, 'failed');
            this.emitEvent(row.id, 'failed', {
              message: `Loop failed after resume: ${String(err)}`,
            });
            this.events.emit('loop_done', row.id);
          });
        } else {
          // No pending work or paused — determine terminal status from story outcomes
          const terminal = hasPendingWork
            ? {
                status: 'failed' as LoopStatus,
                partial: false,
                message: 'Loop runner lost. Please start a new loop.',
              }
            : this.determineTerminalStatus(row);
          db.query('UPDATE loops SET status = ?, completed_at = ? WHERE id = ?').run(
            terminal.status,
            Date.now(),
            row.id,
          );
          console.log(`[loop] Recovered zombie loop ${row.id} → ${terminal.status}`);
          // Emit 'completed' (with partial flag) or 'failed' — never 'completed_with_failures'
          // as an event type, since the client derives that from the partial flag
          const eventType = terminal.status === 'failed' ? 'failed' : 'completed';
          this.emitEvent(row.id, eventType, {
            message: terminal.message,
            partial: terminal.partial,
          });
          this.events.emit('loop_done', row.id);
        }
      }
    } catch (err) {
      console.error('[loop] Startup recovery failed:', err);
    }
  }

  /** How long a runner can go without a heartbeat before being considered dead.
   * Needs to be long enough to accommodate slow quality checks (typecheck can take 10+ minutes)
   * and long-running git operations (pre-commit hooks can take 30+ minutes). */
  private static HEARTBEAT_STALE_MS = 45 * 60 * 1000; // 45 minutes

  /** Find loops marked running/paused in DB that have no in-memory runner
   *  (or whose heartbeat is stale) and auto-resume them if possible.
   *  Falls back to marking as failed/completed if no pending work remains. */
  private recoverZombieLoops(): void {
    try {
      const db = getDb();
      const now = Date.now();

      const activeLoops = db
        .query("SELECT id, last_heartbeat FROM loops WHERE status IN ('running', 'paused')")
        .all() as any[];

      const zombieLoops = activeLoops.filter((z) => {
        // No runner in memory → definitely a zombie
        if (!this.runners.has(z.id)) return true;
        // Runner exists but heartbeat is stale → runner is stuck/dead
        if (z.last_heartbeat && now - z.last_heartbeat > LoopOrchestrator.HEARTBEAT_STALE_MS) {
          console.log(
            `[loop] Runner for ${z.id} has stale heartbeat (${Math.round((now - z.last_heartbeat) / 1000)}s ago)`,
          );
          this.runners.delete(z.id);
          return true;
        }
        return false;
      });

      for (const z of zombieLoops) {
        // Load full loop row for auto-resume attempt
        const row = db.query('SELECT * FROM loops WHERE id = ?').get(z.id) as any;
        if (!row) continue;

        // Check if there's still pending work (scoped to this loop)
        const hasPendingWork = this.hasPendingWork(row);

        if (hasPendingWork && row.status === 'running') {
          // Auto-resume: create a new runner instead of marking as failed.
          // This makes loops resilient to hot reloads and transient crashes.
          console.log(`[loop] Auto-resuming zombie loop ${z.id} (periodic recovery)`);

          // Reset in_progress stories back to pending — scoped to THIS loop's stories
          this.resetInProgressStories(row, now);

          const config: LoopConfig = JSON.parse(row.config || '{}');
          const runner = new LoopRunner(
            row.id,
            row.prd_id || null,
            row.workspace_path,
            config,
            this.events,
          );
          this.runners.set(row.id, runner);

          runner.run().catch((err) => {
            console.error(`[loop:${row.id}] Resumed runner error:`, err);
            this.updateStatus(row.id, 'failed');
            this.emitEvent(row.id, 'failed', {
              message: `Loop failed after resume: ${String(err)}`,
            });
            this.events.emit('loop_done', row.id);
          });
        } else {
          // No pending work or paused — determine terminal status from story outcomes
          const terminal = hasPendingWork
            ? {
                status: 'failed' as LoopStatus,
                partial: false,
                message: 'Loop runner lost. Please start a new loop.',
              }
            : this.determineTerminalStatus(row);
          db.query('UPDATE loops SET status = ?, completed_at = ? WHERE id = ?').run(
            terminal.status,
            now,
            z.id,
          );
          console.log(`[loop] Recovered zombie loop ${z.id} → ${terminal.status}`);
          // Emit 'completed' (with partial flag) or 'failed' — never 'completed_with_failures'
          // as an event type, since the client derives that from the partial flag
          const eventType = terminal.status === 'failed' ? 'failed' : 'completed';
          this.emitEvent(z.id, eventType, {
            message: terminal.message,
            partial: terminal.partial,
          });
          this.events.emit('loop_done', z.id);

          // Reset in_progress stories back to pending — scoped to THIS loop's stories
          this.resetInProgressStories(row, now);
        }
      }
    } catch (err) {
      console.error('[loop] Zombie recovery failed:', err);
    }
  }

  async startLoop(
    prdId: string | null,
    workspacePath: string,
    config: LoopConfig,
  ): Promise<string> {
    const db = getDb();
    let label: string;

    if (prdId) {
      // PRD mode: validate PRD exists and has pending stories
      const prd = db.query('SELECT * FROM prds WHERE id = ?').get(prdId) as any;
      if (!prd) throw new Error(`PRD ${prdId} not found`);

      const storyCount = db
        .query(
          "SELECT COUNT(*) as count FROM prd_stories WHERE prd_id = ? AND status IN ('pending', 'in_progress', 'failed_timeout') AND (research_only = 0 OR research_only IS NULL)",
        )
        .get(prdId) as any;
      if (!storyCount || storyCount.count === 0) {
        throw new Error(
          'Cannot activate Golem: PRD has no pending stories. Add at least one story first.',
        );
      }
      label = `PRD: ${prd.name}`;
    } else {
      // Standalone mode: validate standalone stories exist in this workspace
      const storyCount = db
        .query(
          "SELECT COUNT(*) as count FROM prd_stories WHERE prd_id IS NULL AND workspace_path = ? AND status IN ('pending', 'in_progress', 'failed_timeout') AND (research_only = 0 OR research_only IS NULL)",
        )
        .get(workspacePath) as any;
      if (!storyCount || storyCount.count === 0) {
        throw new Error('Cannot activate Golem: No pending standalone stories in this workspace.');
      }
      label = 'Standalone stories';
    }

    // Refuse to start if the working tree has uncommitted changes.
    // Dirty state causes cascading quality-check failures — one story's
    // leftover changes break every subsequent story's build.
    await this.ensureCleanWorkingTree(workspacePath);

    const { nanoid } = await import('nanoid');
    const loopId = nanoid(12);
    const now = Date.now();

    // Persist loop to DB
    const machineId = getHostname();
    db.query(
      `INSERT INTO loops (id, prd_id, workspace_path, status, config, current_iteration, started_at, total_stories_completed, total_stories_failed, total_iterations, iteration_log, last_heartbeat, machine_id)
       VALUES (?, ?, ?, 'running', ?, 0, ?, 0, 0, 0, '[]', ?, ?)`,
    ).run(loopId, prdId, workspacePath, JSON.stringify(config), now, now, machineId);

    // Update golem's last_active_at
    db.query(`UPDATE golems SET last_active_at = ? WHERE machine_id = ?`).run(now, machineId);

    const runner = new LoopRunner(loopId, prdId, workspacePath, config, this.events);
    this.runners.set(loopId, runner);

    // Start the loop asynchronously
    runner.run().catch((err) => {
      console.error(`[loop:${loopId}] Unhandled error:`, err);
      this.updateStatus(loopId, 'failed');
      this.emitEvent(loopId, 'failed', { message: `Loop failed: ${String(err)}` });
      this.events.emit('loop_done', loopId);
    });

    this.emitEvent(loopId, 'started', { message: `Loop started for ${label}` });

    return loopId;
  }

  async pauseLoop(loopId: string): Promise<void> {
    const runner = this.runners.get(loopId);
    if (!runner) {
      // No runner in memory — just update DB if it's still running
      const db = getDb();
      const row = db.query('SELECT status FROM loops WHERE id = ?').get(loopId) as any;
      if (!row) throw new Error(`Loop ${loopId} not found`);
      if (row.status !== 'running') return;
    } else {
      runner.pause();
    }
    this.updateStatus(loopId, 'paused');
    this.emitEvent(loopId, 'paused', { message: 'Loop paused' });
  }

  async resumeLoop(loopId: string): Promise<void> {
    const runner = this.runners.get(loopId);
    if (!runner) {
      const db = getDb();
      const row = db.query('SELECT status FROM loops WHERE id = ?').get(loopId) as any;
      if (!row) throw new Error(`Loop ${loopId} not found`);
      // Can't resume a zombie — it has no runner. Mark it failed.
      if (row.status === 'paused') {
        this.updateStatus(loopId, 'failed');
        this.emitEvent(loopId, 'failed', {
          message:
            'Loop runner not available (server may have restarted). Please start a new loop.',
        });
        return;
      }
    } else {
      runner.resume();
    }
    this.updateStatus(loopId, 'running');
    this.emitEvent(loopId, 'resumed', { message: 'Loop resumed' });
  }

  async cancelLoop(loopId: string): Promise<void> {
    const runner = this.runners.get(loopId);
    if (runner) {
      runner.cancel();
      this.runners.delete(loopId);
      // Update DB immediately for consistency; the runner will emit the
      // 'cancelled' SSE event itself when it exits its loop, so we skip
      // emitting here to avoid sending a duplicate to the client.
      this.updateStatus(loopId, 'cancelled');
    } else {
      // Runner not in memory (server restart or crash) — update DB and
      // emit the event ourselves since no runner is around to do it.
      const db = getDb();
      const row = db.query('SELECT status FROM loops WHERE id = ?').get(loopId) as any;
      if (!row) throw new Error(`Loop ${loopId} not found`);
      if (row.status !== 'running' && row.status !== 'paused') {
        return; // Already terminal
      }
      this.updateStatus(loopId, 'cancelled');
      this.emitEvent(loopId, 'cancelled', { message: 'Loop cancelled by user' });
    }
  }

  getLoopState(loopId: string): LoopState | null {
    const db = getDb();
    const row = db.query('SELECT * FROM loops WHERE id = ?').get(loopId) as any;
    if (!row) return null;
    // Detect zombie on read: DB says active but no runner exists
    if ((row.status === 'running' || row.status === 'paused') && !this.runners.has(loopId)) {
      this.recoverZombieLoops();
      // Re-read after recovery
      const fresh = db.query('SELECT * FROM loops WHERE id = ?').get(loopId) as any;
      return fresh ? loopFromRow(fresh) : null;
    }
    return loopFromRow(row);
  }

  listLoops(status?: string): LoopState[] {
    const db = getDb();
    // Eagerly recover zombies before listing so callers always see accurate state
    if (!status || status === 'running' || status === 'paused') {
      this.recoverZombieLoops();
    }
    let rows: any[];
    if (status) {
      rows = db
        .query(
          'SELECT * FROM loops WHERE status = ? AND dismissed_at IS NULL ORDER BY started_at DESC',
        )
        .all(status);
    } else {
      rows = db
        .query('SELECT * FROM loops WHERE dismissed_at IS NULL ORDER BY started_at DESC LIMIT 50')
        .all();
    }
    return rows.map(loopFromRow);
  }

  /**
   * Refuse to start a loop if git reports uncommitted changes.
   * Dirty working trees cause cascading quality-check failures.
   */
  private async ensureCleanWorkingTree(workspacePath: string): Promise<void> {
    try {
      const checkProc = Bun.spawn(['git', 'rev-parse', '--is-inside-work-tree'], {
        cwd: workspacePath,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const isRepo = (await new Response(checkProc.stdout).text()).trim() === 'true';
      if (!isRepo) return; // Not a git repo — nothing to check

      const statusProc = Bun.spawn(['git', 'status', '--porcelain'], {
        cwd: workspacePath,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const output = (await new Response(statusProc.stdout).text()).trim();
      if (output.length > 0) {
        const changedFiles = output.split('\n').length;
        throw new Error(
          `Cannot activate Golem: working tree has ${changedFiles} uncommitted change${changedFiles === 1 ? '' : 's'}. ` +
            `Please commit or stash your changes first. Dirty state causes cascading build failures across stories.`,
        );
      }
    } catch (err) {
      // Re-throw our own Error, but swallow git failures (e.g. git not installed)
      if (err instanceof Error && err.message.startsWith('Cannot activate Golem:')) {
        throw err;
      }
      console.warn(`[loop] ensureCleanWorkingTree check failed (non-fatal):`, err);
    }
  }

  private updateStatus(loopId: string, status: LoopStatus): void {
    const db = getDb();
    const updates: string[] = ['status = ?'];
    const values: any[] = [status];

    if (status === 'paused') {
      updates.push('paused_at = ?');
      values.push(Date.now());
    }
    if (
      status === 'completed' ||
      status === 'completed_with_failures' ||
      status === 'failed' ||
      status === 'cancelled'
    ) {
      updates.push('completed_at = ?');
      values.push(Date.now());
    }

    values.push(loopId);
    db.query(`UPDATE loops SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }

  private emitEvent(
    loopId: string,
    event: StreamLoopEvent['event'],
    data: StreamLoopEvent['data'],
  ): void {
    const evt: StreamLoopEvent = { type: 'loop_event', loopId, event, data };
    this.events.emit('loop_event', evt);
  }
}

export const loopOrchestrator = new LoopOrchestrator();
