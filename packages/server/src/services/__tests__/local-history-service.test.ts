import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  captureSnapshot,
  listSnapshots,
  getSnapshotContent,
  clearHistory,
} from '../local-history-service';

/**
 * These tests write to the real ~/.e/local-history store keyed by the
 * temp file's absolute path. Each test uses a unique temp file so the
 * buckets don't collide, and clears its own history in afterEach.
 */
describe('local-history-service', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lh-test-'));
    file = join(dir, 'sample.ts');
  });

  afterEach(async () => {
    await clearHistory(file);
    await rm(dir, { recursive: true, force: true });
  });

  it('captures and lists snapshots newest-first', async () => {
    await captureSnapshot(file, 'v1');
    // Ensure distinct timestamps.
    await new Promise((r) => setTimeout(r, 5));
    await captureSnapshot(file, 'v2');
    const entries = await listSnapshots(file);
    expect(entries.length).toBe(2);
    expect(entries[0].timestamp).toBeGreaterThanOrEqual(entries[1].timestamp);
  });

  it('round-trips content through gzip', async () => {
    const content = 'line1\nline2\n  indented\n';
    await captureSnapshot(file, content);
    const entries = await listSnapshots(file);
    const got = await getSnapshotContent(file, entries[0].id);
    expect(got).toBe(content);
  });

  it('dedupes identical consecutive saves', async () => {
    await captureSnapshot(file, 'same');
    await new Promise((r) => setTimeout(r, 5));
    await captureSnapshot(file, 'same');
    const entries = await listSnapshots(file);
    expect(entries.length).toBe(1);
  });

  it('excludes node_modules paths', async () => {
    const excluded = join(dir, 'node_modules', 'pkg', 'index.js');
    await captureSnapshot(excluded, 'whatever');
    const entries = await listSnapshots(excluded);
    expect(entries.length).toBe(0);
  });

  it('clears history for a file', async () => {
    await captureSnapshot(file, 'x');
    expect((await listSnapshots(file)).length).toBe(1);
    await clearHistory(file);
    expect((await listSnapshots(file)).length).toBe(0);
  });
});
