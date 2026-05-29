/**
 * local-history-service.ts (LYK-1061) — per-file edit revision retention,
 * independent of git. Every file write captures a compressed snapshot of
 * the saved content into ~/.e/local-history/<file-key>/<timestamp>.gz so
 * the user can preview / restore earlier states after a destructive edit
 * or `git reset --hard`.
 *
 * Keying: snapshots are bucketed by sha256(absolutePath) (truncated). The
 * bucket also stores a `path.txt` with the absolute path for reverse
 * lookup / debugging. Because paths are absolute, per-file keying already
 * isolates workspaces from each other — no separate workspace dir needed.
 *
 * Retention: pruned on every capture to the tighter of MAX_ENTRIES (count)
 * and MAX_AGE_MS (age). Defaults ~30 entries / 14 days per file, matching
 * the ticket.
 *
 * Capture is best-effort and fire-and-forget from the write route — a
 * failure to snapshot must never block or fail the actual save.
 */

import { mkdir, readdir, readFile, writeFile, rm, stat } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';
// node:zlib (not Bun.gzipSync) so the service works under both the Bun
// server runtime and the Node-based vitest harness.
import { gzipSync, gunzipSync } from 'zlib';

const ROOT = join(homedir(), '.e', 'local-history');
const MAX_ENTRIES = 30;
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
/** Don't snapshot generated / vendored / VCS paths. */
const EXCLUDE_PATTERNS = [
  /[/\\]node_modules[/\\]/,
  /[/\\]\.git[/\\]/,
  /[/\\](?:build|dist|out|coverage|\.next|\.svelte-kit|\.turbo)[/\\]/,
  /[/\\]\.e[/\\]local-history[/\\]/, // never snapshot our own store
];
/** Cap snapshot size — refuse to retain enormous (likely generated) files. */
const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;

export interface LocalHistoryEntry {
  /** Snapshot id == capture timestamp (ms epoch). */
  id: number;
  timestamp: number;
  /** Compressed byte size on disk. */
  size: number;
}

function shouldExclude(absPath: string): boolean {
  return EXCLUDE_PATTERNS.some((re) => re.test(absPath));
}

function fileKey(absPath: string): string {
  return createHash('sha256').update(absPath).digest('hex').slice(0, 24);
}

function bucketDir(absPath: string): string {
  return join(ROOT, fileKey(absPath));
}

/** List raw snapshot descriptors in a bucket, oldest-first. */
async function listBucket(dir: string): Promise<LocalHistoryEntry[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: LocalHistoryEntry[] = [];
  for (const name of names) {
    if (!name.endsWith('.gz')) continue;
    const ts = parseInt(name.slice(0, -3), 10);
    if (!Number.isFinite(ts)) continue;
    let size = 0;
    try {
      size = (await stat(join(dir, name))).size;
    } catch {
      continue;
    }
    out.push({ id: ts, timestamp: ts, size });
  }
  out.sort((a, b) => a.timestamp - b.timestamp);
  return out;
}

async function readSnapshot(dir: string, id: number): Promise<string | null> {
  try {
    const gz = await readFile(join(dir, `${id}.gz`));
    return gunzipSync(gz).toString('utf-8');
  } catch {
    return null;
  }
}

/** Apply count + age retention caps, deleting the overflow. */
async function prune(dir: string): Promise<void> {
  const entries = await listBucket(dir);
  const now = Date.now();
  const withinAge = entries.filter((e) => now - e.timestamp <= MAX_AGE_MS);
  const keep = new Set(withinAge.slice(-MAX_ENTRIES).map((e) => e.id));
  for (const e of entries) {
    if (!keep.has(e.id)) {
      await rm(join(dir, `${e.id}.gz`)).catch(() => {});
    }
  }
}

/**
 * Capture a snapshot of `content` for `absPath`. No-ops when the path is
 * excluded, the content is too large, or it's byte-identical to the most
 * recent snapshot (avoids duplicating no-op / format-only re-saves).
 */
export async function captureSnapshot(absPath: string, content: string): Promise<void> {
  if (shouldExclude(absPath)) return;
  const bytes = Buffer.byteLength(content, 'utf-8');
  if (bytes > MAX_SNAPSHOT_BYTES) return;

  const dir = bucketDir(absPath);
  await mkdir(dir, { recursive: true });

  // Skip if identical to the latest retained snapshot.
  const existing = await listBucket(dir);
  if (existing.length > 0) {
    const latest = existing[existing.length - 1];
    const prev = await readSnapshot(dir, latest.id);
    if (prev === content) return;
  }

  const ts = Date.now();
  const gz = gzipSync(Buffer.from(content, 'utf-8'));
  await writeFile(join(dir, `${ts}.gz`), gz);
  // Reverse-lookup breadcrumb; cheap to rewrite each time.
  await writeFile(join(dir, 'path.txt'), absPath, 'utf-8').catch(() => {});
  await prune(dir);
}

/** List snapshots for a file, newest-first (UI-friendly order). */
export async function listSnapshots(absPath: string): Promise<LocalHistoryEntry[]> {
  const entries = await listBucket(bucketDir(absPath));
  return entries.reverse();
}

/** Read the decompressed content of one snapshot. */
export async function getSnapshotContent(absPath: string, id: number): Promise<string | null> {
  return readSnapshot(bucketDir(absPath), id);
}

/** Delete every snapshot for a file. */
export async function clearHistory(absPath: string): Promise<void> {
  await rm(bucketDir(absPath), { recursive: true, force: true }).catch(() => {});
}
