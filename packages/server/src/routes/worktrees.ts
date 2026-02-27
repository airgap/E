/**
 * Worktree REST API — CRUD + status/merge/prune endpoints.
 *
 * All responses follow the { ok, data?, error? } envelope pattern.
 * Service layer handles git operations; this layer handles HTTP semantics.
 */

import { Hono } from 'hono';
import { resolve } from 'path';
import * as worktreeService from '../services/worktree-service';
import * as mergeService from '../services/worktree-merge';
import { lspManager } from '../services/lsp-instance-manager';
import { getDb } from '../db/database';
import type { WorktreeInfo, WorktreeRecord } from '@e/shared';

const app = new Hono();

// ---------------------------------------------------------------------------
// Helper — run a git command (used by status endpoint)
// ---------------------------------------------------------------------------

async function gitRun(
  args: string[],
  opts: { cwd: string },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(args, { cwd: opts.cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

// ---------------------------------------------------------------------------
// GET / — list worktrees with merged git + DB info
// ---------------------------------------------------------------------------

app.get('/', async (c) => {
  const workspacePath = c.req.query('workspacePath');
  if (!workspacePath) {
    return c.json({ ok: false, error: 'workspacePath query parameter is required' }, 400);
  }

  const resolved = resolve(workspacePath);
  const gitResult = await worktreeService.list(resolved);
  const dbRecords = worktreeService.listAll(resolved);
  const gitInfos = gitResult.ok ? (gitResult.data ?? []) : [];

  // Merge: attach DB record to each git worktree entry
  const merged: Array<WorktreeInfo & { record: WorktreeRecord | null }> = gitInfos.map((info) => {
    const dbRecord = dbRecords.find((r) => r.story_id === info.storyId) ?? null;
    return { ...info, record: dbRecord };
  });

  // Include DB-only records (abandoned/cleanup_pending where git worktree is gone)
  for (const record of dbRecords) {
    const alreadyIncluded = merged.some((m) => m.record?.story_id === record.story_id);
    if (!alreadyIncluded) {
      merged.push({
        path: record.worktree_path,
        branch: record.branch_name,
        head: record.base_commit ?? '',
        storyId: record.story_id,
        isMain: false,
        isLocked: false,
        isDirty: false,
        record,
      });
    }
  }

  return c.json({ ok: true, data: merged });
});

// ---------------------------------------------------------------------------
// POST / — create worktree
// ---------------------------------------------------------------------------

app.post('/', async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const { workspacePath, storyId, baseBranch } = body;

  if (!workspacePath || typeof workspacePath !== 'string') {
    return c.json({ ok: false, error: 'workspacePath is required' }, 400);
  }
  if (!storyId || typeof storyId !== 'string') {
    return c.json({ ok: false, error: 'storyId is required' }, 400);
  }

  // Validate story exists in prd_stories
  const db = getDb();
  const story = db.query('SELECT id, prd_id FROM prd_stories WHERE id = ?').get(storyId) as {
    id: string;
    prd_id: string | null;
  } | null;
  if (!story) {
    return c.json({ ok: false, error: `Story '${storyId}' not found` }, 400);
  }

  // Check no active worktree for this story
  const existing = worktreeService.getForStory(storyId);
  if (existing && (existing.status === 'active' || existing.status === 'merging')) {
    return c.json({ ok: false, error: `Worktree already active for story '${storyId}'` }, 409);
  }

  const resolved = resolve(workspacePath);

  // Create git worktree
  const createResult = await worktreeService.create({
    workspacePath: resolved,
    storyId,
    baseBranch,
  });
  if (!createResult.ok) {
    return c.json({ ok: false, error: createResult.error }, 400);
  }

  // Create DB record
  const recordResult = await worktreeService.createRecord({
    workspacePath: resolved,
    storyId,
    baseBranch,
    prdId: story.prd_id,
    worktreePath: createResult.data!,
  });

  if (!recordResult.ok) {
    return c.json({ ok: false, error: recordResult.error }, 400);
  }

  return c.json({ ok: true, data: recordResult.data }, 201);
});

// ---------------------------------------------------------------------------
// POST /prune — cleanup stale worktrees (git + DB)
// ---------------------------------------------------------------------------

app.post('/prune', async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const workspacePath = body.workspacePath ?? c.req.query('workspacePath');
  if (!workspacePath || typeof workspacePath !== 'string') {
    return c.json({ ok: false, error: 'workspacePath is required' }, 400);
  }

  const resolved = resolve(workspacePath);

  // Git prune
  const pruneResult = await worktreeService.prune(resolved);
  const prunedGit = pruneResult.ok ? (pruneResult.data ?? 0) : 0;

  // DB prune: remove records with status 'abandoned' or 'cleanup_pending'
  const db = getDb();
  const staleRows = db
    .query(
      "SELECT id FROM worktrees WHERE workspace_path = ? AND status IN ('abandoned', 'cleanup_pending')",
    )
    .all(resolved) as { id: string }[];

  for (const row of staleRows) {
    db.query('DELETE FROM worktrees WHERE id = ?').run(row.id);
  }

  return c.json({
    ok: true,
    data: { prunedGit, prunedDb: staleRows.length },
  });
});

// ---------------------------------------------------------------------------
// GET /:storyId/status — detailed worktree status
// ---------------------------------------------------------------------------

app.get('/:storyId/status', async (c) => {
  const storyId = c.req.param('storyId');
  const record = worktreeService.getForStory(storyId);

  if (!record) {
    return c.json({ ok: false, error: `No worktree found for story '${storyId}'` }, 404);
  }

  const worktreePath = record.worktree_path;
  const branch = record.branch_name;

  // Dirty files
  let dirtyFiles: string[] = [];
  try {
    const statusResult = await gitRun(['git', 'status', '--porcelain'], { cwd: worktreePath });
    if (statusResult.exitCode === 0) {
      dirtyFiles = statusResult.stdout
        .trim()
        .split('\n')
        .filter((line) => line.trim().length > 0);
    }
  } catch {
    // Ignore errors — return empty dirtyFiles
  }

  // Ahead/behind counts via rev-list
  let aheadBy = 0;
  let behindBy = 0;
  try {
    const baseBranch = record.base_branch ?? 'main';
    const revResult = await gitRun(
      ['git', 'rev-list', '--left-right', '--count', `${baseBranch}...HEAD`],
      { cwd: worktreePath },
    );
    if (revResult.exitCode === 0) {
      const parts = revResult.stdout.trim().split(/\s+/);
      if (parts.length === 2) {
        behindBy = parseInt(parts[0], 10) || 0;
        aheadBy = parseInt(parts[1], 10) || 0;
      }
    }
  } catch {
    // Ignore errors — return zeros
  }

  return c.json({
    ok: true,
    data: { branch, dirtyFiles, aheadBy, behindBy },
  });
});

// ---------------------------------------------------------------------------
// POST /:storyId/merge — delegate to merge service
// ---------------------------------------------------------------------------

app.post('/:storyId/merge', async (c) => {
  const storyId = c.req.param('storyId');
  const record = worktreeService.getForStory(storyId);

  if (!record) {
    return c.json({ ok: false, error: `No worktree found for story '${storyId}'` }, 404);
  }

  if (record.status === 'merged') {
    return c.json({ ok: false, error: `Worktree for story '${storyId}' is already merged` }, 409);
  }

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const isRetry = record.status === 'conflict' || body.retry === true;
  const skipQualityCheck = body.skipQualityCheck ?? false;

  // Delegate to merge service — runs synchronously (rebase + merge + cleanup)
  const result = isRetry
    ? await mergeService.retry({ storyId, skipQualityCheck })
    : await mergeService.merge({ storyId, skipQualityCheck });

  if (!result.ok) {
    const statusCode = result.status === 'conflict' ? 409 : 400;
    return c.json(
      {
        ok: false,
        error: result.error,
        conflictingFiles: result.conflictingFiles,
        status: result.status,
        operationLog: result.operationLog,
      },
      statusCode,
    );
  }

  return c.json(
    {
      ok: true,
      data: {
        storyId,
        status: result.status,
        commitSha: result.commitSha,
        operationLog: result.operationLog,
      },
    },
    202,
  );
});

// ---------------------------------------------------------------------------
// DELETE /:storyId — remove worktree
// ---------------------------------------------------------------------------

app.delete('/:storyId', async (c) => {
  const storyId = c.req.param('storyId');
  const force = c.req.query('force') === 'true';
  const record = worktreeService.getForStory(storyId);

  if (!record) {
    return c.json({ ok: false, error: `No worktree found for story '${storyId}'` }, 404);
  }

  // Capture the worktree path before removal for LSP cleanup
  const worktreePath = record.worktree_path;

  if (force) {
    // Force remove via removeRecord (uses git worktree remove --force)
    const result = await worktreeService.removeRecord(record.workspace_path, storyId);
    if (!result.ok) {
      return c.json({ ok: false, error: result.error }, 400);
    }
    // Shutdown any LSP instances scoped to this worktree
    lspManager.shutdownForRoot(worktreePath);
    return c.json({ ok: true, data: { storyId } });
  }

  // Non-forced: remove() checks dirty state first
  const removeResult = await worktreeService.remove(record.workspace_path, storyId);
  if (!removeResult.ok) {
    if (removeResult.dirtyFiles && removeResult.dirtyFiles.length > 0) {
      return c.json(
        {
          ok: false,
          error: removeResult.error,
          uncommittedFiles: removeResult.dirtyFiles,
        },
        409,
      );
    }
    return c.json({ ok: false, error: removeResult.error }, 400);
  }

  // Git removal succeeded — delete DB record
  const db = getDb();
  db.query('DELETE FROM worktrees WHERE story_id = ?').run(storyId);

  // Shutdown any LSP instances scoped to this worktree
  lspManager.shutdownForRoot(worktreePath);

  return c.json({ ok: true, data: { storyId } });
});

export { app as worktreeRoutes };
