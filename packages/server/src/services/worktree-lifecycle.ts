/**
 * Worktree Lifecycle & Garbage Collection
 *
 * Handles automatic cleanup of worktrees when stories are archived/deleted,
 * PRDs are deleted, and provides a configurable GC sweep for merged,
 * abandoned, orphaned, and stale worktrees.
 *
 * Also enforces resource limits: max worktrees per workspace and disk space.
 */

import { resolve } from 'path';
import { existsSync, statfsSync } from 'fs';
import { getDb } from '../db/database';
import * as worktreeService from './worktree-service';
import { lspManager } from './lsp-instance-manager';
import { prdEvents, type PrdEvent } from '../routes/prd/events';
import type { WorktreeRecord } from '@e/shared';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface LifecycleConfig {
  /** GC interval in ms. Default: 3_600_000 (1 hour). */
  gcIntervalMs: number;
  /** Max worktrees per workspace. Default: 5. */
  maxWorktreesPerWorkspace: number;
  /** Disk warning threshold in bytes. Default: 1GB. */
  diskWarnBytes: number;
  /** Disk block threshold in bytes. Default: 100MB. */
  diskBlockBytes: number;
  /** Abandoned threshold in ms. Default: 86_400_000 (24 hours). */
  abandonedThresholdMs: number;
}

export const DEFAULT_CONFIG: LifecycleConfig = {
  gcIntervalMs: 3_600_000,
  maxWorktreesPerWorkspace: 5,
  diskWarnBytes: 1_000_000_000,
  diskBlockBytes: 100_000_000,
  abandonedThresholdMs: 86_400_000,
};

// ---------------------------------------------------------------------------
// GC stats
// ---------------------------------------------------------------------------

export interface GCStats {
  merged: number;
  abandoned: number;
  orphaned: number;
  stale: number;
  errors: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Disk check result
// ---------------------------------------------------------------------------

export interface DiskCheckResult {
  ok: boolean;
  availableBytes: number;
  warn: boolean;
  blocked: boolean;
  message?: string;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let gcTimer: ReturnType<typeof setInterval> | null = null;
let gcRunning = false;
let currentConfig: LifecycleConfig = { ...DEFAULT_CONFIG };
let eventListenerAttached = false;

/**
 * Platform abstraction for disk space checking.
 * Overridable via _testHelpers for unit tests.
 */
let _getAvailableBytes = (fsPath: string): number => {
  const stats = statfsSync(fsPath);
  return stats.bavail * stats.bsize;
};

// ---------------------------------------------------------------------------
// Event-driven cleanup — listens to PRD/story events
// ---------------------------------------------------------------------------

function handlePrdEvent(event: PrdEvent): void {
  switch (event.type) {
    case 'story_deleted':
      if (event.storyId) {
        cleanupWorktreeForStory(event.storyId).catch((err) => {
          console.error(`[worktree-lifecycle] Error cleaning up story ${event.storyId}:`, err);
        });
      }
      break;

    case 'story_updated':
      // Check if the story was just archived — clean up its worktree
      if (event.storyId) {
        cleanupIfArchived(event.storyId).catch((err) => {
          console.error(
            `[worktree-lifecycle] Error checking archived status for story ${event.storyId}:`,
            err,
          );
        });
      }
      break;

    case 'stories_archived':
      if (event.prdId) {
        cleanupArchivedStories(event.prdId).catch((err) => {
          console.error(
            `[worktree-lifecycle] Error cleaning up archived stories for PRD ${event.prdId}:`,
            err,
          );
        });
      }
      break;

    case 'prd_deleted':
      if (event.prdId) {
        cleanupWorktreesForPrd(event.prdId).catch((err) => {
          console.error(
            `[worktree-lifecycle] Error cleaning up worktrees for PRD ${event.prdId}:`,
            err,
          );
        });
      }
      break;

    default:
      // Other events don't trigger cleanup
      break;
  }
}

// ---------------------------------------------------------------------------
// Cleanup functions
// ---------------------------------------------------------------------------

/**
 * Check if a story is archived and clean up its worktree if so.
 * Called on story_updated events.
 */
export async function cleanupIfArchived(storyId: string): Promise<boolean> {
  const db = getDb();
  const story = db.query('SELECT status FROM prd_stories WHERE id = ?').get(storyId) as {
    status: string;
  } | null;

  if (story?.status === 'archived') {
    return cleanupWorktreeForStory(storyId);
  }
  return true; // Not archived, nothing to do
}

/**
 * Remove the worktree for a single story. Idempotent — no-op if no worktree exists.
 */
export async function cleanupWorktreeForStory(storyId: string): Promise<boolean> {
  const record = worktreeService.getForStory(storyId);
  if (!record) {
    console.log(`[worktree-lifecycle] No worktree for story ${storyId}, nothing to clean up`);
    return true;
  }

  // Capture worktree path before removal for LSP cleanup
  const worktreePath = record.worktree_path;

  console.log(
    `[worktree-lifecycle] Cleaning up worktree for story ${storyId} (status: ${record.status})`,
  );

  const result = await worktreeService.removeRecord(record.workspace_path, storyId);
  if (!result.ok) {
    console.error(
      `[worktree-lifecycle] Failed to remove worktree for story ${storyId}: ${result.error}`,
    );
    return false;
  }

  // Shutdown any LSP instances scoped to this worktree
  lspManager.shutdownForRoot(worktreePath);

  console.log(`[worktree-lifecycle] Successfully cleaned up worktree for story ${storyId}`);
  return true;
}

/**
 * Remove worktrees for all archived stories in a PRD.
 */
export async function cleanupArchivedStories(prdId: string): Promise<number> {
  const db = getDb();
  const archivedStories = db
    .query("SELECT id FROM prd_stories WHERE prd_id = ? AND status = 'archived'")
    .all(prdId) as { id: string }[];

  let cleaned = 0;
  for (const story of archivedStories) {
    const success = await cleanupWorktreeForStory(story.id);
    if (success) cleaned++;
  }

  console.log(
    `[worktree-lifecycle] Cleaned up ${cleaned}/${archivedStories.length} worktrees for archived stories in PRD ${prdId}`,
  );
  return cleaned;
}

/**
 * Remove all worktrees associated with a PRD.
 *
 * When a PRD is deleted, its stories cascade-delete in DB,
 * but worktree records may remain. We look up all worktrees
 * for this PRD and force-remove them.
 */
export async function cleanupWorktreesForPrd(prdId: string): Promise<number> {
  const db = getDb();

  // Find all worktrees that belong to this PRD
  const worktrees = db
    .query('SELECT * FROM worktrees WHERE prd_id = ?')
    .all(prdId) as WorktreeRecord[];

  let cleaned = 0;
  for (const wt of worktrees) {
    console.log(
      `[worktree-lifecycle] Removing worktree for story ${wt.story_id} (PRD ${prdId} deleted)`,
    );
    const result = await worktreeService.removeRecord(wt.workspace_path, wt.story_id);
    if (result.ok) {
      // Shutdown any LSP instances scoped to this worktree
      lspManager.shutdownForRoot(wt.worktree_path);
      cleaned++;
    } else {
      // Force-delete the DB record if git removal failed
      try {
        db.query('DELETE FROM worktrees WHERE id = ?').run(wt.id);
        // Still shutdown LSP instances even if git removal failed
        lspManager.shutdownForRoot(wt.worktree_path);
        cleaned++;
        console.log(
          `[worktree-lifecycle] Force-deleted DB record for story ${wt.story_id} after git removal failed`,
        );
      } catch (err) {
        console.error(`[worktree-lifecycle] Failed to force-delete worktree record ${wt.id}:`, err);
      }
    }
  }

  console.log(
    `[worktree-lifecycle] Cleaned up ${cleaned}/${worktrees.length} worktrees for PRD ${prdId}`,
  );
  return cleaned;
}

// ---------------------------------------------------------------------------
// GC sweep
// ---------------------------------------------------------------------------

/**
 * Run a full GC sweep across all workspaces.
 *
 * Handles:
 * 1. Merged worktrees — status='merged' on disk
 * 2. Abandoned worktrees — not updated in > abandonedThresholdMs
 * 3. Orphaned worktrees — story no longer exists in DB
 * 4. Stale git refs — via `git worktree prune`
 */
export async function runGC(config?: Partial<LifecycleConfig>): Promise<GCStats> {
  const cfg = { ...currentConfig, ...config };
  const start = Date.now();
  const stats: GCStats = {
    merged: 0,
    abandoned: 0,
    orphaned: 0,
    stale: 0,
    errors: 0,
    durationMs: 0,
  };

  console.log('[worktree-lifecycle] Starting GC sweep...');

  try {
    const db = getDb();
    const now = Date.now();

    // Snapshot workspace paths BEFORE any cleanup, so we can still prune
    // workspaces whose worktree records are all deleted during steps 1-3.
    const preCleanupRecords = db.query('SELECT * FROM worktrees').all() as WorktreeRecord[];
    const workspacePaths = new Set(preCleanupRecords.map((r) => r.workspace_path));

    // 1. Clean up merged worktrees
    const mergedRecords = preCleanupRecords.filter((r) => r.status === 'merged');

    for (const record of mergedRecords) {
      try {
        const result = await worktreeService.removeRecord(record.workspace_path, record.story_id);
        // Shutdown LSP instances scoped to this worktree
        lspManager.shutdownForRoot(record.worktree_path);
        if (result.ok) {
          stats.merged++;
        } else {
          // Force-delete DB record for merged worktrees since data is already merged
          db.query('DELETE FROM worktrees WHERE id = ?').run(record.id);
          stats.merged++;
        }
      } catch {
        stats.errors++;
      }
    }

    // 2. Clean up abandoned worktrees (not updated in > threshold)
    const abandonedCutoff = now - cfg.abandonedThresholdMs;
    const abandonedRecords = preCleanupRecords.filter(
      (r) => r.status === 'abandoned' && r.updated_at < abandonedCutoff,
    );

    for (const record of abandonedRecords) {
      try {
        const result = await worktreeService.removeRecord(record.workspace_path, record.story_id);
        // Shutdown LSP instances scoped to this worktree
        lspManager.shutdownForRoot(record.worktree_path);
        if (result.ok) {
          stats.abandoned++;
        } else {
          // Force-delete for abandoned
          db.query('DELETE FROM worktrees WHERE id = ?').run(record.id);
          stats.abandoned++;
        }
      } catch {
        stats.errors++;
      }
    }

    // 3. Find orphaned worktrees — story_id doesn't exist in prd_stories
    // Re-query to get current state after steps 1 & 2
    const remainingWorktrees = db.query('SELECT * FROM worktrees').all() as WorktreeRecord[];

    for (const wt of remainingWorktrees) {
      const storyExists = db.query('SELECT id FROM prd_stories WHERE id = ?').get(wt.story_id) as {
        id: string;
      } | null;

      if (!storyExists) {
        try {
          const result = await worktreeService.removeRecord(wt.workspace_path, wt.story_id);
          // Shutdown LSP instances scoped to this worktree
          lspManager.shutdownForRoot(wt.worktree_path);
          if (result.ok) {
            stats.orphaned++;
          } else {
            db.query('DELETE FROM worktrees WHERE id = ?').run(wt.id);
            stats.orphaned++;
          }
        } catch {
          stats.errors++;
        }
      }
    }

    // 4. Prune stale git refs for each unique workspace (collected upfront)
    for (const wsPath of workspacePaths) {
      try {
        const pruneResult = await worktreeService.prune(wsPath);
        if (pruneResult.ok && pruneResult.data) {
          stats.stale += pruneResult.data;
        }
      } catch {
        stats.errors++;
      }
    }
  } catch (err) {
    console.error('[worktree-lifecycle] GC sweep error:', err);
    stats.errors++;
  }

  stats.durationMs = Date.now() - start;

  console.log(
    `[worktree-lifecycle] GC sweep complete: merged=${stats.merged} abandoned=${stats.abandoned} orphaned=${stats.orphaned} stale=${stats.stale} errors=${stats.errors} duration=${stats.durationMs}ms`,
  );

  return stats;
}

// ---------------------------------------------------------------------------
// Resource limits
// ---------------------------------------------------------------------------

/**
 * Check whether a new worktree can be created for the given workspace.
 *
 * Enforces:
 * - Max worktrees per workspace (default 5)
 * - Disk space thresholds (warn <1GB, block <100MB)
 */
export function checkWorktreeLimit(
  workspacePath: string,
  config?: Partial<LifecycleConfig>,
): { allowed: boolean; reason?: string; warning?: string } {
  const cfg = { ...currentConfig, ...config };
  const resolved = resolve(workspacePath);

  // Check max worktrees per workspace
  const activeWorktrees = worktreeService.listActive(resolved);
  if (activeWorktrees.length >= cfg.maxWorktreesPerWorkspace) {
    return {
      allowed: false,
      reason: `Maximum worktrees (${cfg.maxWorktreesPerWorkspace}) reached for workspace. Remove or merge existing worktrees first.`,
    };
  }

  // Check disk space
  const diskCheck = checkDiskSpace(resolved, cfg);
  if (diskCheck.blocked) {
    return {
      allowed: false,
      reason: diskCheck.message || 'Insufficient disk space',
    };
  }

  if (diskCheck.warn) {
    return {
      allowed: true,
      warning: diskCheck.message || 'Low disk space',
    };
  }

  return { allowed: true };
}

/**
 * Check available disk space for a path.
 */
export function checkDiskSpace(path: string, config?: Partial<LifecycleConfig>): DiskCheckResult {
  const cfg = { ...currentConfig, ...config };

  try {
    const resolved = resolve(path);
    // Find a path that exists by walking up
    let checkPath = resolved;
    while (!existsSync(checkPath)) {
      const parent = resolve(checkPath, '..');
      if (parent === checkPath) break; // root
      checkPath = parent;
    }

    const availableBytes = _getAvailableBytes(checkPath);

    if (availableBytes < cfg.diskBlockBytes) {
      return {
        ok: false,
        availableBytes,
        warn: true,
        blocked: true,
        message: `Disk space critically low: ${formatBytes(availableBytes)} available (minimum: ${formatBytes(cfg.diskBlockBytes)})`,
      };
    }

    if (availableBytes < cfg.diskWarnBytes) {
      return {
        ok: true,
        availableBytes,
        warn: true,
        blocked: false,
        message: `Disk space low: ${formatBytes(availableBytes)} available (warning threshold: ${formatBytes(cfg.diskWarnBytes)})`,
      };
    }

    return {
      ok: true,
      availableBytes,
      warn: false,
      blocked: false,
    };
  } catch (err) {
    // If we can't check disk space, allow but warn
    console.warn('[worktree-lifecycle] Could not check disk space:', err);
    return {
      ok: true,
      availableBytes: -1,
      warn: false,
      blocked: false,
      message: 'Could not determine disk space',
    };
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

// ---------------------------------------------------------------------------
// Lifecycle start/stop
// ---------------------------------------------------------------------------

/**
 * Start the worktree lifecycle manager.
 *
 * - Subscribes to PRD events for automatic cleanup
 * - Starts the GC sweep timer
 */
export function start(config?: Partial<LifecycleConfig>): void {
  currentConfig = { ...DEFAULT_CONFIG, ...config };

  // Attach event listener (idempotent)
  if (!eventListenerAttached) {
    prdEvents.on('prd_change', handlePrdEvent);
    eventListenerAttached = true;
    console.log('[worktree-lifecycle] Attached PRD event listener');
  }

  // Start GC timer
  if (gcTimer) {
    clearInterval(gcTimer);
  }

  gcTimer = setInterval(async () => {
    if (gcRunning) {
      console.log('[worktree-lifecycle] GC sweep already running, skipping');
      return;
    }
    gcRunning = true;
    try {
      await runGC();
    } catch (err) {
      console.error('[worktree-lifecycle] GC timer error:', err);
    } finally {
      gcRunning = false;
    }
  }, currentConfig.gcIntervalMs);

  // Don't keep the process alive just for GC
  if (gcTimer && typeof gcTimer === 'object' && 'unref' in gcTimer) {
    (gcTimer as NodeJS.Timeout).unref();
  }

  console.log(
    `[worktree-lifecycle] Started (GC every ${currentConfig.gcIntervalMs}ms, max ${currentConfig.maxWorktreesPerWorkspace} worktrees/workspace)`,
  );
}

/**
 * Stop the worktree lifecycle manager.
 */
export function stop(): void {
  if (gcTimer) {
    clearInterval(gcTimer);
    gcTimer = null;
  }

  if (eventListenerAttached) {
    prdEvents.off('prd_change', handlePrdEvent);
    eventListenerAttached = false;
  }

  console.log('[worktree-lifecycle] Stopped');
}

/**
 * Update configuration. Restarts the GC timer if interval changed.
 */
export function configure(config: Partial<LifecycleConfig>): void {
  const oldInterval = currentConfig.gcIntervalMs;
  currentConfig = { ...currentConfig, ...config };

  if (config.gcIntervalMs && config.gcIntervalMs !== oldInterval && gcTimer) {
    clearInterval(gcTimer);
    gcTimer = setInterval(async () => {
      if (gcRunning) return;
      gcRunning = true;
      try {
        await runGC();
      } catch (err) {
        console.error('[worktree-lifecycle] GC timer error:', err);
      } finally {
        gcRunning = false;
      }
    }, currentConfig.gcIntervalMs);
    console.log(`[worktree-lifecycle] GC interval updated to ${currentConfig.gcIntervalMs}ms`);
  }
}

/**
 * Get current configuration.
 */
export function getConfig(): LifecycleConfig {
  return { ...currentConfig };
}

// ---------------------------------------------------------------------------
// Exported for testing
// ---------------------------------------------------------------------------

export const _testHelpers = {
  getGcTimer: () => gcTimer,
  isGcRunning: () => gcRunning,
  isEventListenerAttached: () => eventListenerAttached,
  handlePrdEvent,
  resetState: () => {
    stop();
    gcRunning = false;
    currentConfig = { ...DEFAULT_CONFIG };
  },
  /** Override disk space checker for testing. */
  setGetAvailableBytes: (fn: (path: string) => number) => {
    _getAvailableBytes = fn;
  },
  /** Restore default disk space checker. */
  restoreGetAvailableBytes: () => {
    _getAvailableBytes = (fsPath: string): number => {
      const stats = statfsSync(fsPath);
      return stats.bavail * stats.bsize;
    };
  },
};
