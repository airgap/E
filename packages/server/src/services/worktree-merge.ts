/**
 * Worktree Merge Service — merges completed story branches back to base
 * with conflict detection, safe rebase, and --ff-only merge.
 *
 * Happy path:
 *   pre-check (clean + quality) → fetch base → rebase story onto base
 *   → --ff-only merge into base → cleanup (status=merged, remove worktree,
 *     delete branch, update story.commitSha).
 *
 * Conflict path:
 *   rebase fails → abort rebase → detect conflicting files → status=conflict,
 *   story=failed with learning → user resolves → retry.
 *
 * Safety: never force-push/merge, prefer --ff-only, log all operations.
 *
 * All operations return MergeResult and never throw uncaught errors.
 */

import { resolve } from 'path';
import { existsSync } from 'fs';
import type { WorktreeRecord, MergeResult, MergeOptions, MergeOperationLogEntry } from '@e/shared';
import { getDb } from '../db/database';
import * as worktreeService from './worktree-service';

// ---------------------------------------------------------------------------
// Helpers — safe Bun.spawn (same pattern as worktree-service.ts)
// ---------------------------------------------------------------------------

async function run(
  args: string[],
  opts: { cwd: string },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(args, {
    cwd: opts.cwd,
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
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

// ---------------------------------------------------------------------------
// Per-workspace mutex — serializes merge ops on the same repo
// ---------------------------------------------------------------------------

const mergeLocks = new Map<string, Promise<void>>();

function withMergeLock<T>(workspacePath: string, fn: () => Promise<T>): Promise<T> {
  const key = resolve(workspacePath);
  const prev = mergeLocks.get(key) ?? Promise.resolve();

  let releaseFn: () => void;
  const gate = new Promise<void>((r) => {
    releaseFn = r;
  });
  mergeLocks.set(key, gate);

  return prev.then(async () => {
    try {
      return await fn();
    } finally {
      releaseFn!();
      if (mergeLocks.get(key) === gate) {
        mergeLocks.delete(key);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Operation log helper
// ---------------------------------------------------------------------------

function logEntry(
  opLog: MergeOperationLogEntry[],
  operation: string,
  success: boolean,
  detail?: string,
): void {
  const entry: MergeOperationLogEntry = {
    timestamp: new Date().toISOString(),
    operation,
    success,
    detail,
  };
  opLog.push(entry);

  const prefix = success ? '[worktree-merge]' : '[worktree-merge] ERROR';
  const msg = detail ? `${operation}: ${detail}` : operation;
  if (success) {
    console.log(`${prefix} ${msg}`);
  } else {
    console.error(`${prefix} ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Pre-check: clean worktree + passing quality checks
// ---------------------------------------------------------------------------

async function preCheck(
  record: WorktreeRecord,
  opLog: MergeOperationLogEntry[],
  skipQuality: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const { worktree_path } = record;

  // 1. Verify worktree directory exists
  if (!existsSync(worktree_path)) {
    logEntry(opLog, 'pre-check:directory', false, `Worktree not found: ${worktree_path}`);
    return { ok: false, error: `Worktree directory not found: ${worktree_path}` };
  }
  logEntry(opLog, 'pre-check:directory', true, 'Worktree directory exists');

  // 2. Check for clean worktree (no uncommitted changes)
  const status = await run(['git', 'status', '--porcelain'], { cwd: worktree_path });
  if (status.exitCode !== 0) {
    logEntry(opLog, 'pre-check:clean', false, `git status failed: ${status.stderr.trim()}`);
    return { ok: false, error: `Failed to check worktree status: ${status.stderr.trim()}` };
  }

  const dirtyFiles = status.stdout
    .trim()
    .split('\n')
    .filter((line) => line.trim().length > 0);

  if (dirtyFiles.length > 0) {
    logEntry(
      opLog,
      'pre-check:clean',
      false,
      `Worktree has ${dirtyFiles.length} uncommitted file(s)`,
    );
    return {
      ok: false,
      error: `Worktree has uncommitted changes (${dirtyFiles.length} file(s)): ${dirtyFiles.slice(0, 5).join(', ')}`,
    };
  }
  logEntry(opLog, 'pre-check:clean', true, 'Worktree is clean');

  // 3. Run quality checks (unless skipped)
  if (!skipQuality) {
    const qualityResult = await run(['bun', 'run', 'check'], { cwd: worktree_path });
    if (qualityResult.exitCode !== 0) {
      const failDetail =
        qualityResult.stderr.trim().slice(0, 500) || qualityResult.stdout.trim().slice(0, 500);
      logEntry(
        opLog,
        'pre-check:quality',
        false,
        `Quality checks failed (exit ${qualityResult.exitCode}): ${failDetail}`,
      );
      return { ok: false, error: `Quality checks failed: ${failDetail}` };
    }
    logEntry(opLog, 'pre-check:quality', true, 'Quality checks passed');
  } else {
    logEntry(opLog, 'pre-check:quality', true, 'Quality checks skipped');
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Fetch base branch
// ---------------------------------------------------------------------------

async function fetchBase(record: WorktreeRecord, opLog: MergeOperationLogEntry[]): Promise<void> {
  const { workspace_path, base_branch } = record;
  const baseBranch = base_branch || 'main';

  // Check if remote exists
  const remoteResult = await run(['git', 'remote'], { cwd: workspace_path });
  if (remoteResult.exitCode !== 0 || !remoteResult.stdout.trim()) {
    logEntry(opLog, 'fetch', true, 'No remote configured, skipping fetch');
    return;
  }

  const remote = remoteResult.stdout.trim().split('\n')[0];
  const fetchResult = await run(['git', 'fetch', remote, baseBranch], { cwd: workspace_path });

  if (fetchResult.exitCode !== 0) {
    // Non-fatal — base may still be up to date locally
    logEntry(
      opLog,
      'fetch',
      true,
      `Fetch warning (non-fatal): ${fetchResult.stderr.trim().slice(0, 200)}`,
    );
  } else {
    logEntry(opLog, 'fetch', true, `Fetched ${remote}/${baseBranch}`);
  }
}

// ---------------------------------------------------------------------------
// Rebase story onto base
// ---------------------------------------------------------------------------

async function rebaseOntoBase(
  record: WorktreeRecord,
  opLog: MergeOperationLogEntry[],
): Promise<{ ok: boolean; error?: string; conflictFiles?: string[] }> {
  const { worktree_path, base_branch } = record;
  const baseBranch = base_branch || 'main';

  logEntry(opLog, 'rebase', true, `Rebasing story branch onto '${baseBranch}'`);

  const rebaseResult = await run(['git', 'rebase', baseBranch], { cwd: worktree_path });

  if (rebaseResult.exitCode === 0) {
    logEntry(opLog, 'rebase', true, 'Rebase succeeded');
    return { ok: true };
  }

  // Rebase failed — likely conflict
  logEntry(opLog, 'rebase', false, `Rebase failed: ${rebaseResult.stderr.trim().slice(0, 500)}`);

  // Detect conflicting files before aborting
  const conflictFiles = await detectConflictFiles(worktree_path);
  logEntry(
    opLog,
    'conflict:detect',
    true,
    `Conflicting files: ${conflictFiles.length > 0 ? conflictFiles.join(', ') : '(none detected)'}`,
  );

  // Abort the rebase to restore clean state
  const abortResult = await run(['git', 'rebase', '--abort'], { cwd: worktree_path });
  if (abortResult.exitCode === 0) {
    logEntry(opLog, 'rebase:abort', true, 'Rebase aborted successfully');
  } else {
    logEntry(opLog, 'rebase:abort', false, `Rebase abort warning: ${abortResult.stderr.trim()}`);
  }

  return {
    ok: false,
    error: `Rebase conflict on ${conflictFiles.length} file(s)`,
    conflictFiles,
  };
}

// ---------------------------------------------------------------------------
// Detect conflicting files (during a rebase conflict)
// ---------------------------------------------------------------------------

export async function detectConflictFiles(worktreePath: string): Promise<string[]> {
  // git diff --name-only --diff-filter=U shows unmerged (conflicted) files
  const result = await run(['git', 'diff', '--name-only', '--diff-filter=U'], {
    cwd: worktreePath,
  });

  if (result.exitCode === 0 && result.stdout.trim()) {
    return result.stdout
      .trim()
      .split('\n')
      .filter((f) => f.trim().length > 0);
  }

  // Fallback: check git status for UU/AA/DU/UD entries
  const statusResult = await run(['git', 'status', '--porcelain'], { cwd: worktreePath });
  if (statusResult.exitCode === 0) {
    return statusResult.stdout
      .trim()
      .split('\n')
      .filter(
        (line) =>
          line.startsWith('UU') ||
          line.startsWith('AA') ||
          line.startsWith('DU') ||
          line.startsWith('UD'),
      )
      .map((line) => line.slice(3).trim())
      .filter((f) => f.length > 0);
  }

  return [];
}

// ---------------------------------------------------------------------------
// Merge into base (--ff-only with fallback to merge commit)
// ---------------------------------------------------------------------------

async function mergeIntoBase(
  record: WorktreeRecord,
  opLog: MergeOperationLogEntry[],
): Promise<{ ok: boolean; commitSha?: string; error?: string }> {
  const { story_id, workspace_path, branch_name, base_branch } = record;
  const baseBranch = base_branch || 'main';

  // Checkout the base branch in the main workspace
  const checkoutResult = await run(['git', 'checkout', baseBranch], { cwd: workspace_path });

  if (checkoutResult.exitCode !== 0) {
    const err = checkoutResult.stderr.trim();
    logEntry(opLog, 'checkout:base', false, `Failed to checkout '${baseBranch}': ${err}`);
    return { ok: false, error: `Failed to checkout base branch: ${err}` };
  }
  logEntry(opLog, 'checkout:base', true, `Checked out ${baseBranch}`);

  // Try --ff-only merge first (preferred — AC #9: never force merge)
  const ffResult = await run(['git', 'merge', '--ff-only', branch_name], { cwd: workspace_path });

  if (ffResult.exitCode === 0) {
    const shaResult = await run(['git', 'rev-parse', 'HEAD'], { cwd: workspace_path });
    const commitSha = shaResult.stdout.trim();
    logEntry(
      opLog,
      'merge:ff-only',
      true,
      `Fast-forward merge succeeded (${commitSha.slice(0, 12)})`,
    );
    return { ok: true, commitSha };
  }

  // AC #10: --ff-only failed post-rebase → fallback to merge commit
  logEntry(opLog, 'merge:ff-only', false, 'Fast-forward failed, falling back to merge commit');

  const mergeResult = await run(
    ['git', 'merge', '--no-ff', branch_name, '-m', `Merge story/${story_id} into ${baseBranch}`],
    { cwd: workspace_path },
  );

  if (mergeResult.exitCode !== 0) {
    const err = mergeResult.stderr.trim();
    logEntry(opLog, 'merge:commit', false, `Merge commit also failed: ${err}`);

    // Abort if left in conflict state
    await run(['git', 'merge', '--abort'], { cwd: workspace_path });

    return { ok: false, error: `Merge failed: ${err}` };
  }

  const shaResult = await run(['git', 'rev-parse', 'HEAD'], { cwd: workspace_path });
  const commitSha = shaResult.stdout.trim();
  logEntry(opLog, 'merge:commit', true, `Merge commit created (${commitSha.slice(0, 12)})`);
  return { ok: true, commitSha };
}

// ---------------------------------------------------------------------------
// Cleanup: status=merged, remove worktree, delete branch, update story
// ---------------------------------------------------------------------------

async function cleanup(
  record: WorktreeRecord,
  commitSha: string,
  opLog: MergeOperationLogEntry[],
): Promise<void> {
  const { story_id, workspace_path, branch_name, worktree_path } = record;

  // 1. Update worktree status to 'merged'
  const statusResult = worktreeService.updateStatus(story_id, 'merged');
  if (statusResult.ok) {
    logEntry(opLog, 'cleanup:status', true, 'Worktree status set to merged');
  } else {
    logEntry(opLog, 'cleanup:status', false, `Failed to update status: ${statusResult.error}`);
  }

  // 2. Remove the worktree directory
  if (existsSync(worktree_path)) {
    const removeResult = await run(['git', 'worktree', 'remove', worktree_path], {
      cwd: workspace_path,
    });

    if (removeResult.exitCode === 0) {
      logEntry(opLog, 'cleanup:worktree', true, 'Worktree removed');
    } else {
      logEntry(
        opLog,
        'cleanup:worktree',
        false,
        `Worktree removal warning: ${removeResult.stderr.trim()}`,
      );
    }
  } else {
    logEntry(opLog, 'cleanup:worktree', true, 'Worktree directory already removed');
  }

  // 3. Delete the story branch (safe -d, not -D)
  const branchResult = await run(['git', 'branch', '-d', branch_name], { cwd: workspace_path });

  if (branchResult.exitCode === 0) {
    logEntry(opLog, 'cleanup:branch', true, `Branch ${branch_name} deleted`);
  } else {
    logEntry(
      opLog,
      'cleanup:branch',
      false,
      `Branch deletion warning: ${branchResult.stderr.trim()}`,
    );
  }

  // 4. Update story commit_sha (AC #7)
  try {
    const db = getDb();
    db.query('UPDATE prd_stories SET commit_sha = ?, updated_at = ? WHERE id = ?').run(
      commitSha,
      Date.now(),
      story_id,
    );
    logEntry(
      opLog,
      'cleanup:commitSha',
      true,
      `Story commitSha updated to ${commitSha.slice(0, 12)}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logEntry(opLog, 'cleanup:commitSha', false, `Failed to update commitSha: ${msg}`);
  }

  // 5. Prune stale worktree refs
  await run(['git', 'worktree', 'prune'], { cwd: workspace_path });
  logEntry(opLog, 'cleanup:prune', true, 'Pruned stale worktree references');
}

// ---------------------------------------------------------------------------
// Handle conflict: status=conflict, story=failed with learning
// ---------------------------------------------------------------------------

function handleConflict(
  record: WorktreeRecord,
  conflictFiles: string[],
  opLog: MergeOperationLogEntry[],
): void {
  const { story_id } = record;

  // 1. Set worktree status to 'conflict' (AC #3, #4)
  worktreeService.updateStatus(story_id, 'conflict');
  logEntry(opLog, 'conflict:status', true, 'Worktree status set to conflict');

  // 2. Update story with conflict learning (AC #4)
  try {
    const db = getDb();
    const story = db
      .query('SELECT learnings, attempts FROM prd_stories WHERE id = ?')
      .get(story_id) as { learnings: string; attempts: number } | null;

    if (story) {
      let learnings: string[] = [];
      try {
        learnings = JSON.parse(story.learnings || '[]');
      } catch {
        learnings = [];
      }

      const learning = `Merge conflict detected in files: ${conflictFiles.join(', ')}. Manual resolution required.`;
      learnings.push(learning);

      db.query(
        'UPDATE prd_stories SET status = ?, learnings = ?, attempts = ?, updated_at = ? WHERE id = ?',
      ).run('failed', JSON.stringify(learnings), story.attempts + 1, Date.now(), story_id);

      logEntry(
        opLog,
        'conflict:story',
        true,
        `Story set to failed with learning about ${conflictFiles.length} conflict file(s)`,
      );
    } else {
      logEntry(opLog, 'conflict:story', false, `Story ${story_id} not found in prd_stories`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logEntry(opLog, 'conflict:story', false, `Failed to update story: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Main merge function
// ---------------------------------------------------------------------------

/**
 * Merge a story's worktree branch back to the base branch.
 *
 * Safety: never force-push/merge, prefer --ff-only. (AC #9)
 * All operations logged with timestamps. (AC #11)
 */
export async function merge(options: MergeOptions): Promise<MergeResult> {
  const { storyId, skipQualityCheck = false } = options;
  const opLog: MergeOperationLogEntry[] = [];

  try {
    logEntry(opLog, 'start', true, `Beginning merge for story ${storyId}`);

    // 1. Look up the worktree record
    const record = worktreeService.getForStory(storyId);
    if (!record) {
      logEntry(opLog, 'validate', false, `No worktree record found for story ${storyId}`);
      return {
        ok: false,
        error: `No worktree record found for story '${storyId}'`,
        status: 'active',
        operationLog: opLog,
      };
    }

    // Validate status — allow 'active', 'merging', or 'conflict' (retry)
    if (record.status === 'merged') {
      logEntry(opLog, 'validate', false, 'Story already merged');
      return {
        ok: false,
        error: `Story '${storyId}' is already merged`,
        status: 'merged',
        operationLog: opLog,
      };
    }

    if (record.status !== 'active' && record.status !== 'merging' && record.status !== 'conflict') {
      logEntry(opLog, 'validate', false, `Invalid status for merge: ${record.status}`);
      return {
        ok: false,
        error: `Cannot merge story in '${record.status}' status`,
        status: record.status,
        operationLog: opLog,
      };
    }

    logEntry(
      opLog,
      'validate',
      true,
      `Record found: branch=${record.branch_name}, base=${record.base_branch ?? 'main'}`,
    );

    return await withMergeLock(record.workspace_path, async () => {
      // 2. Set status to 'merging'
      worktreeService.updateStatus(storyId, 'merging');
      logEntry(opLog, 'status:merging', true, 'Status set to merging');

      // 3. Pre-check: clean worktree + quality (AC #1)
      const preCheckResult = await preCheck(record, opLog, skipQualityCheck);
      if (!preCheckResult.ok) {
        worktreeService.updateStatus(storyId, 'active');
        logEntry(opLog, 'status:revert', true, 'Reverted to active after pre-check failure');
        return {
          ok: false,
          error: preCheckResult.error,
          status: 'active' as const,
          operationLog: opLog,
        };
      }

      // 4. Fetch base branch
      await fetchBase(record, opLog);

      // 5. Rebase story onto base (AC #2, #3)
      const rebaseResult = await rebaseOntoBase(record, opLog);
      if (!rebaseResult.ok) {
        // Conflict path (AC #3, #4)
        handleConflict(record, rebaseResult.conflictFiles || [], opLog);
        return {
          ok: false,
          error: rebaseResult.error,
          conflictingFiles: rebaseResult.conflictFiles,
          status: 'conflict' as const,
          operationLog: opLog,
        };
      }

      // 6. Merge into base (AC #5, #10)
      const mergeResult = await mergeIntoBase(record, opLog);
      if (!mergeResult.ok) {
        worktreeService.updateStatus(storyId, 'active');
        logEntry(opLog, 'status:revert', true, 'Reverted to active after merge failure');
        return {
          ok: false,
          error: mergeResult.error,
          status: 'active' as const,
          operationLog: opLog,
        };
      }

      // 7. Cleanup (AC #6, #7)
      await cleanup(record, mergeResult.commitSha!, opLog);

      logEntry(opLog, 'complete', true, `Merge completed (${mergeResult.commitSha!.slice(0, 12)})`);

      return {
        ok: true,
        commitSha: mergeResult.commitSha,
        status: 'merged' as const,
        operationLog: opLog,
      };
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logEntry(opLog, 'fatal', false, msg);

    // Try to revert status
    try {
      worktreeService.updateStatus(storyId, 'active');
    } catch {
      // Ignore — best-effort
    }

    return {
      ok: false,
      error: msg,
      status: 'active',
      operationLog: opLog,
    };
  }
}

/**
 * Retry a merge after manual conflict resolution. (AC #8)
 *
 * Resets status from 'conflict' → 'active' and re-runs the merge.
 */
export async function retry(options: MergeOptions): Promise<MergeResult> {
  const { storyId } = options;
  const opLog: MergeOperationLogEntry[] = [];

  logEntry(opLog, 'retry:start', true, `Retrying merge for story ${storyId}`);

  const record = worktreeService.getForStory(storyId);
  if (!record) {
    logEntry(opLog, 'retry:validate', false, `No worktree record for story ${storyId}`);
    return {
      ok: false,
      error: `No worktree record found for story '${storyId}'`,
      status: 'active',
      operationLog: opLog,
    };
  }

  if (record.status !== 'conflict' && record.status !== 'active') {
    logEntry(opLog, 'retry:validate', false, `Cannot retry from '${record.status}' status`);
    return {
      ok: false,
      error: `Cannot retry merge from '${record.status}' status. Expected 'conflict' or 'active'.`,
      status: record.status,
      operationLog: opLog,
    };
  }

  // Reset status to active for retry
  if (record.status === 'conflict') {
    worktreeService.updateStatus(storyId, 'active');
    logEntry(opLog, 'retry:reset', true, 'Reset status from conflict to active');
  }

  // Re-run the merge (skip quality by default for retry)
  const result = await merge({
    storyId,
    skipQualityCheck: options.skipQualityCheck ?? true,
  });

  // Combine operation logs
  return {
    ...result,
    operationLog: [...opLog, ...result.operationLog],
  };
}

// ---------------------------------------------------------------------------
// Exported for testing
// ---------------------------------------------------------------------------

export const _testHelpers = {
  preCheck,
  fetchBase,
  rebaseOntoBase,
  mergeIntoBase,
  cleanup,
  handleConflict,
  detectConflictFiles,
  getMergeLocks: () => mergeLocks,
  clearLocks: () => mergeLocks.clear(),
};
