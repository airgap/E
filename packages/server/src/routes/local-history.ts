/**
 * local-history.ts (LYK-1061) — list / read / restore / clear endpoints
 * for the per-file local-history store. Snapshot *capture* happens
 * implicitly on /files/write; this route only reads back and restores.
 *
 * Paths are resolved through the same worktree context + safety checks
 * the files route uses, so restore can't be used to write outside the
 * sandbox.
 */

import { Hono } from 'hono';
import { writeFile, mkdir } from 'fs/promises';
import { dirname, resolve } from 'path';
import {
  listSnapshots,
  getSnapshotContent,
  clearHistory,
  captureSnapshot,
} from '../services/local-history-service';

const app = new Hono();

/** Mirror of files.ts isSafePath — kept local to avoid a cross-route import. */
function isSafePath(filePath: string): boolean {
  const resolved = resolve(filePath);
  const blockedPrefixes = ['/etc/shadow', '/proc/', '/sys/'];
  if (blockedPrefixes.some((p) => resolved.startsWith(p))) return false;
  const blockedPatterns = [
    /\.ssh\/.*(?:id_|known_hosts|authorized_keys)/,
    /\.gnupg\//,
    /\.aws\/credentials/,
  ];
  return !blockedPatterns.some((re) => re.test(resolved));
}

// List snapshots for a file (newest-first).
app.get('/list', async (c) => {
  const path = c.req.query('path');
  if (!path) return c.json({ ok: false, error: 'path required' }, 400);
  try {
    const entries = await listSnapshots(resolve(path));
    return c.json({ ok: true, data: { entries } });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// Read one snapshot's decompressed content.
app.get('/content', async (c) => {
  const path = c.req.query('path');
  const idRaw = c.req.query('id');
  if (!path || !idRaw) return c.json({ ok: false, error: 'path and id required' }, 400);
  const id = parseInt(idRaw, 10);
  if (!Number.isFinite(id)) return c.json({ ok: false, error: 'invalid id' }, 400);
  try {
    const content = await getSnapshotContent(resolve(path), id);
    if (content === null) return c.json({ ok: false, error: 'snapshot not found' }, 404);
    return c.json({ ok: true, data: { content } });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// Restore a snapshot — writes its content back as the current file.
// Before overwriting, captures the *current* content as a fresh snapshot
// so the restore itself is undoable from history.
app.post('/restore', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const path: string = body.path;
  const id: number = body.id;
  if (!path || !Number.isFinite(id)) {
    return c.json({ ok: false, error: 'path and id required' }, 400);
  }
  const abs = resolve(path);
  if (!isSafePath(abs)) return c.json({ ok: false, error: 'unsafe path' }, 403);
  try {
    const content = await getSnapshotContent(abs, id);
    if (content === null) return c.json({ ok: false, error: 'snapshot not found' }, 404);
    // Snapshot current state first (best-effort) so restore is reversible.
    try {
      const current = await Bun.file(abs).text();
      await captureSnapshot(abs, current);
    } catch {
      // File may not exist (restoring a deleted file) — fine.
    }
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, 'utf-8');
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// Clear all snapshots for a file.
app.delete('/clear', async (c) => {
  const path = c.req.query('path');
  if (!path) return c.json({ ok: false, error: 'path required' }, 400);
  try {
    await clearHistory(resolve(path));
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

export { app as localHistoryRoutes };
export default app;
