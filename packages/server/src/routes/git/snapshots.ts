import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { getDb } from '../../db/database';
import { run, runExitCode, validateWorkspacePath } from './helpers';

const app = new Hono();

// Create a snapshot (stash-like) before agent runs
app.post('/snapshot', async (c) => {
  const body = await c.req.json();
  const { path: rootPath, conversationId, reason, messageId } = body;

  if (!rootPath) return c.json({ ok: false, error: 'path required' }, 400);

  const snapshotPathCheck = validateWorkspacePath(rootPath);
  if (!snapshotPathCheck.valid) {
    return c.json({ ok: false, error: snapshotPathCheck.reason }, 403);
  }

  try {
    // Check if this is a git repo (not an error — workspace may not be git-initialized)
    const checkResult = await run(['git', 'rev-parse', '--is-inside-work-tree'], {
      cwd: snapshotPathCheck.resolved,
    });
    const isRepo = checkResult.stdout.trim() === 'true';
    if (!isRepo) return c.json({ ok: false, skipped: true, reason: 'not-a-git-repo' });

    // Get current HEAD
    const headResult = await run(['git', 'rev-parse', 'HEAD'], { cwd: rootPath });
    const headSha = headResult.stdout.trim();
    if (headResult.exitCode !== 0) {
      return c.json({ ok: false, skipped: true, reason: 'no-commits' });
    }

    // Check if there are changes to snapshot
    const statusResult = await run(['git', 'status', '--porcelain'], { cwd: rootPath });
    const statusOutput = statusResult.stdout.trim();
    const hasChanges = statusOutput.length > 0;

    // Create a snapshot tag using git stash create (creates a commit object without modifying working tree)
    let stashSha: string | null = null;
    if (hasChanges) {
      const stashResult = await run(['git', 'stash', 'create'], { cwd: rootPath });
      stashSha = stashResult.stdout.trim() || null;
    }

    // Record snapshot in DB
    const id = nanoid();
    const now = Date.now();
    const db = getDb();
    db.query(
      `INSERT INTO git_snapshots (id, workspace_path, conversation_id, head_sha, stash_sha, reason, has_changes, message_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      rootPath,
      conversationId || null,
      headSha,
      stashSha,
      reason || 'pre-agent',
      hasChanges ? 1 : 0,
      messageId || null,
      now,
    );

    return c.json({
      ok: true,
      data: { id, headSha, stashSha, hasChanges },
    });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// List snapshots for a project
app.get('/snapshots', (c) => {
  const rootPath = c.req.query('path');
  if (!rootPath) return c.json({ ok: false, error: 'path required' }, 400);

  const db = getDb();
  const rows = db
    .query(`SELECT * FROM git_snapshots WHERE workspace_path = ? ORDER BY created_at DESC LIMIT 50`)
    .all(rootPath) as any[];

  return c.json({
    ok: true,
    data: rows.map((r) => ({
      id: r.id,
      workspacePath: r.workspace_path,
      conversationId: r.conversation_id,
      headSha: r.head_sha,
      stashSha: r.stash_sha,
      reason: r.reason,
      hasChanges: !!r.has_changes,
      messageId: r.message_id || null,
      createdAt: r.created_at,
    })),
  });
});

// Get snapshot by message ID
app.get('/snapshot/by-message/:messageId', (c) => {
  const messageId = c.req.param('messageId');
  const db = getDb();
  const row = db
    .query(`SELECT * FROM git_snapshots WHERE message_id = ? ORDER BY created_at DESC LIMIT 1`)
    .get(messageId) as any;

  if (!row) return c.json({ ok: false, error: 'No snapshot for this message' }, 404);

  return c.json({
    ok: true,
    data: {
      id: row.id,
      workspacePath: row.workspace_path,
      conversationId: row.conversation_id,
      headSha: row.head_sha,
      stashSha: row.stash_sha,
      reason: row.reason,
      hasChanges: !!row.has_changes,
      messageId: row.message_id || null,
      createdAt: row.created_at,
    },
  });
});

// Restore a snapshot
app.post('/snapshot/:id/restore', async (c) => {
  const id = c.req.param('id');
  const db = getDb();
  const snapshot = db.query(`SELECT * FROM git_snapshots WHERE id = ?`).get(id) as any;
  if (!snapshot) return c.json({ ok: false, error: 'Snapshot not found' }, 404);

  try {
    // Reset to the HEAD sha from the snapshot
    const resetResult = await run(['git', 'reset', '--hard', snapshot.head_sha], {
      cwd: snapshot.workspace_path,
    });
    if (resetResult.exitCode !== 0) {
      return c.json({ ok: false, error: `Reset failed: ${resetResult.stderr}` }, 500);
    }

    // If there was a stash, apply it
    if (snapshot.stash_sha) {
      await runExitCode(['git', 'stash', 'apply', snapshot.stash_sha], {
        cwd: snapshot.workspace_path,
      });
      // Stash apply can fail if there are conflicts — that's okay, user can resolve
    }

    return c.json({ ok: true, data: { restored: true } });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

export default app;
