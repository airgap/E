import { EventEmitter } from 'events';
import { getDb } from '../../db/database';
import type { LoopConfig, LoopState, LoopStatus, StreamLoopEvent } from '@e/shared';
import { LoopRunner } from './runner';
import { loopFromRow } from './helpers';

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

        // Check if there are still pending stories to work on
        let hasPendingWork = false;
        if (row.prd_id) {
          const count = db
            .query(
              "SELECT COUNT(*) as c FROM prd_stories WHERE prd_id = ? AND status IN ('pending', 'in_progress', 'failed_timeout') AND (research_only = 0 OR research_only IS NULL)",
            )
            .get(row.prd_id) as any;
          hasPendingWork = count && count.c > 0;
        } else {
          const count = db
            .query(
              "SELECT COUNT(*) as c FROM prd_stories WHERE prd_id IS NULL AND workspace_path = ? AND status IN ('pending', 'in_progress', 'failed_timeout') AND (research_only = 0 OR research_only IS NULL)",
            )
            .get(row.workspace_path) as any;
          hasPendingWork = count && count.c > 0;
        }

        if (hasPendingWork && row.status === 'running') {
          // Auto-resume: create a new runner to continue this loop
          console.log(`[loop] Auto-resuming orphaned loop ${row.id} (hot reload recovery)`);
          // Reset any in_progress stories back to pending — but only for THIS loop's PRD/workspace
          // to avoid clobbering other running loops' story states.
          const prdId = row.prd_id;
          if (prdId) {
            db.query(
              "UPDATE prd_stories SET status = 'pending', updated_at = ? WHERE prd_id = ? AND status = 'in_progress'",
            ).run(Date.now(), prdId);
          } else {
            db.query(
              "UPDATE prd_stories SET status = 'pending', updated_at = ? WHERE prd_id IS NULL AND workspace_path = ? AND status = 'in_progress'",
            ).run(Date.now(), row.workspace_path);
          }

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
          // No pending work or paused — just mark as failed/completed
          const newStatus = hasPendingWork ? 'failed' : 'completed';
          db.query('UPDATE loops SET status = ?, completed_at = ? WHERE id = ?').run(
            newStatus,
            Date.now(),
            row.id,
          );
          console.log(`[loop] Recovered zombie loop ${row.id} → ${newStatus}`);
          this.emitEvent(row.id, newStatus as StreamLoopEvent['event'], {
            message:
              newStatus === 'completed'
                ? 'All stories completed!'
                : 'Loop runner lost. Please start a new loop.',
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

        // Check if there's still pending work
        let hasPendingWork = false;
        if (row.prd_id) {
          const count = db
            .query(
              "SELECT COUNT(*) as c FROM prd_stories WHERE prd_id = ? AND status IN ('pending', 'in_progress', 'failed_timeout') AND (research_only = 0 OR research_only IS NULL)",
            )
            .get(row.prd_id) as any;
          hasPendingWork = count && count.c > 0;
        } else {
          const count = db
            .query(
              "SELECT COUNT(*) as c FROM prd_stories WHERE prd_id IS NULL AND workspace_path = ? AND status IN ('pending', 'in_progress', 'failed_timeout') AND (research_only = 0 OR research_only IS NULL)",
            )
            .get(row.workspace_path) as any;
          hasPendingWork = count && count.c > 0;
        }

        if (hasPendingWork && row.status === 'running') {
          // Auto-resume: create a new runner instead of marking as failed.
          // This makes loops resilient to hot reloads and transient crashes.
          console.log(`[loop] Auto-resuming zombie loop ${z.id} (periodic recovery)`);

          // Reset any in_progress stories back to pending
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
          // No pending work or paused — mark as failed/completed
          const newStatus = hasPendingWork ? 'failed' : 'completed';
          db.query('UPDATE loops SET status = ?, completed_at = ? WHERE id = ?').run(
            newStatus,
            now,
            z.id,
          );
          console.log(`[loop] Recovered zombie loop ${z.id} → ${newStatus}`);
          this.emitEvent(z.id, newStatus as StreamLoopEvent['event'], {
            message:
              newStatus === 'completed'
                ? 'All stories completed!'
                : 'Loop runner lost. Please start a new loop.',
          });
          this.events.emit('loop_done', z.id);

          // Reset in_progress stories back to pending
          const zombieLoop = db
            .query('SELECT prd_id, workspace_path FROM loops WHERE id = ?')
            .get(z.id) as any;
          if (zombieLoop) {
            if (zombieLoop.prd_id) {
              db.query(
                "UPDATE prd_stories SET status = 'pending', updated_at = ? WHERE prd_id = ? AND status = 'in_progress'",
              ).run(now, zombieLoop.prd_id);
            } else {
              db.query(
                "UPDATE prd_stories SET status = 'pending', updated_at = ? WHERE prd_id IS NULL AND workspace_path = ? AND status = 'in_progress'",
              ).run(now, zombieLoop.workspace_path);
            }
          }
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
    db.query(
      `INSERT INTO loops (id, prd_id, workspace_path, status, config, current_iteration, started_at, total_stories_completed, total_stories_failed, total_iterations, iteration_log, last_heartbeat)
       VALUES (?, ?, ?, 'running', ?, 0, ?, 0, 0, 0, '[]', ?)`,
    ).run(loopId, prdId, workspacePath, JSON.stringify(config), now, now);

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
    } else {
      // Runner not in memory (server restart or crash) — just update DB
      const db = getDb();
      const row = db.query('SELECT status FROM loops WHERE id = ?').get(loopId) as any;
      if (!row) throw new Error(`Loop ${loopId} not found`);
      if (row.status !== 'running' && row.status !== 'paused') {
        return; // Already terminal
      }
    }
    this.updateStatus(loopId, 'cancelled');
    this.emitEvent(loopId, 'cancelled', { message: 'Loop cancelled by user' });
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
      rows = db.query('SELECT * FROM loops WHERE status = ? ORDER BY started_at DESC').all(status);
    } else {
      rows = db.query('SELECT * FROM loops ORDER BY started_at DESC LIMIT 50').all();
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
