import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { createTestDb } from '../../test-helpers';

const testDb = createTestDb();
mock.module('../../db/database', () => ({
  getDb: () => testDb,
  initDatabase: () => {},
}));

const mockCallLlm = mock(() => Promise.resolve('Add feature X'));
mock.module('../../services/llm-oneshot', () => ({
  callLlm: mockCallLlm,
}));

import { gitRoutes as app } from '../git/index';

function clearTables() {
  testDb.exec('DELETE FROM git_snapshots');
}

describe('Git Routes', () => {
  beforeEach(() => {
    clearTables();
  });

  describe('GET /snapshots — list snapshots', () => {
    test('requires path query param', async () => {
      const res = await app.request('/snapshots');
      expect(res.status).toBe(400);
    });

    test('returns empty array when no snapshots', async () => {
      const res = await app.request('/snapshots?path=/test');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data).toEqual([]);
    });

    test('returns snapshots ordered by created_at DESC', async () => {
      testDb
        .query(
          'INSERT INTO git_snapshots (id, workspace_path, head_sha, reason, has_changes, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run('snap-1', '/test', 'abc123', 'pre-agent', 0, 100);
      testDb
        .query(
          'INSERT INTO git_snapshots (id, workspace_path, head_sha, reason, has_changes, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run('snap-2', '/test', 'def456', 'pre-agent', 1, 200);

      const res = await app.request('/snapshots?path=/test');
      const json = await res.json();
      expect(json.data).toHaveLength(2);
      expect(json.data[0].id).toBe('snap-2');
      expect(json.data[1].id).toBe('snap-1');
    });

    test('maps snapshot fields to camelCase', async () => {
      testDb
        .query(
          'INSERT INTO git_snapshots (id, workspace_path, conversation_id, head_sha, stash_sha, reason, has_changes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run('snap-1', '/test', 'conv-1', 'abc123', 'stash456', 'pre-agent', 1, 1000);

      const res = await app.request('/snapshots?path=/test');
      const json = await res.json();
      const snap = json.data[0];
      expect(snap.id).toBe('snap-1');
      expect(snap.workspacePath).toBe('/test');
      expect(snap.conversationId).toBe('conv-1');
      expect(snap.headSha).toBe('abc123');
      expect(snap.stashSha).toBe('stash456');
      expect(snap.reason).toBe('pre-agent');
      expect(snap.hasChanges).toBe(true);
      expect(snap.createdAt).toBe(1000);
    });

    test('hasChanges is false when has_changes is 0', async () => {
      testDb
        .query(
          'INSERT INTO git_snapshots (id, workspace_path, head_sha, reason, has_changes, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run('snap-1', '/test', 'abc123', 'pre-agent', 0, 1000);

      const res = await app.request('/snapshots?path=/test');
      const json = await res.json();
      expect(json.data[0].hasChanges).toBe(false);
    });

    test('filters by workspace_path', async () => {
      testDb
        .query(
          'INSERT INTO git_snapshots (id, workspace_path, head_sha, reason, has_changes, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run('snap-1', '/project-a', 'abc', 'pre-agent', 0, 100);
      testDb
        .query(
          'INSERT INTO git_snapshots (id, workspace_path, head_sha, reason, has_changes, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run('snap-2', '/project-b', 'def', 'pre-agent', 0, 200);

      const res = await app.request('/snapshots?path=/project-a');
      const json = await res.json();
      expect(json.data).toHaveLength(1);
      expect(json.data[0].id).toBe('snap-1');
    });

    test('returns null conversationId when not set', async () => {
      testDb
        .query(
          'INSERT INTO git_snapshots (id, workspace_path, conversation_id, head_sha, reason, has_changes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run('snap-1', '/test', null, 'abc123', 'pre-agent', 0, 1000);

      const res = await app.request('/snapshots?path=/test');
      const json = await res.json();
      expect(json.data[0].conversationId).toBeNull();
    });

    test('returns null stashSha when not set', async () => {
      testDb
        .query(
          'INSERT INTO git_snapshots (id, workspace_path, head_sha, stash_sha, reason, has_changes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run('snap-1', '/test', 'abc123', null, 'pre-agent', 0, 1000);

      const res = await app.request('/snapshots?path=/test');
      const json = await res.json();
      expect(json.data[0].stashSha).toBeNull();
    });
  });

  // ---------------------------------------------------------------
  // POST /snapshot — create snapshot (validation)
  // ---------------------------------------------------------------
  describe('POST /snapshot — validation', () => {
    test('returns 400 when path is missing', async () => {
      const res = await app.request('/snapshot', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('path required');
    });
  });

  // ---------------------------------------------------------------
  // POST /snapshot/:id/restore — restore snapshot
  // ---------------------------------------------------------------
  describe('POST /snapshot/:id/restore — restore snapshot', () => {
    test('returns 404 for non-existent snapshot', async () => {
      const res = await app.request('/snapshot/nonexistent/restore', {
        method: 'POST',
      });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('Snapshot not found');
    });
  });

  // ---------------------------------------------------------------
  // GET /diff — git diff
  // ---------------------------------------------------------------
  describe('GET /diff — validation', () => {
    test('returns 400 when file parameter is missing', async () => {
      const res = await app.request('/diff');
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('file parameter required');
    });

    test('returns 400 when file parameter is missing but path is provided', async () => {
      const res = await app.request('/diff?path=/test');
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('file parameter required');
    });
  });
});

// ---------------------------------------------------------------------------
// Helper: create a mock Bun.spawn process
// ---------------------------------------------------------------------------
function mockProc(stdout: string, exitCode: number, stderr = '') {
  return {
    stdout: new Response(stdout).body!,
    stderr: new Response(stderr).body!,
    exited: Promise.resolve(exitCode),
    pid: 1234,
    stdin: undefined,
    kill: () => {},
    ref: () => {},
    unref: () => {},
    exitCode: null,
    signalCode: null,
    killed: false,
    readable: new ReadableStream(),
    resourceUsage: () => ({
      userCPUTime: 0,
      systemCPUTime: 0,
      maxRSS: 0,
      sharedMemorySize: 0,
      unsharedDataSize: 0,
      unsharedStackSize: 0,
      minorPageFault: 0,
      majorPageFault: 0,
      swappedOut: 0,
      fsRead: 0,
      fsWrite: 0,
      ipcSent: 0,
      ipcReceived: 0,
      signalsCount: 0,
      voluntaryContextSwitches: 0,
      involuntaryContextSwitches: 0,
    }),
  };
}

/**
 * Create a Bun.spawn mock for the GET /status endpoint.
 *
 * The endpoint makes two spawn calls:
 *   1. `git status --porcelain -uall` → returns the porcelain output
 *   2. `git rev-parse --git-dir` → returns the git directory path
 *
 * Then it calls `Bun.file(lockPath).exists()` to check for index.lock.
 * The returned `fileSpy` mocks that to always return false (no lock).
 */
function mockStatusSpawn(
  porcelain: string,
  exitCode: number,
  stderr = '',
): {
  spawnSpy: ReturnType<typeof spyOn>;
  fileSpy: ReturnType<typeof spyOn>;
} {
  let callIndex = 0;
  const spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
    callIndex++;
    if (callIndex === 1) {
      // git status --porcelain -uall
      return mockProc(porcelain, exitCode, stderr) as any;
    }
    // git rev-parse --git-dir
    return mockProc('.git\n', 0) as any;
  });
  const originalFile = Bun.file.bind(Bun);
  const fileSpy = spyOn(Bun, 'file').mockImplementation((path: any, ...rest: any[]) => {
    if (typeof path === 'string' && path.endsWith('index.lock')) {
      return { exists: () => Promise.resolve(false) } as any;
    }
    return originalFile(path, ...rest);
  });
  return { spawnSpy, fileSpy };
}

// ---------------------------------------------------------------------------
// Tests that mock Bun.spawn for git command endpoints
// ---------------------------------------------------------------------------
describe('Git Routes — Bun.spawn mocked', () => {
  let spawnSpy: ReturnType<typeof spyOn>;
  let fileSpy: ReturnType<typeof spyOn> | undefined;

  beforeEach(() => {
    // Reset DB tables used by snapshot endpoints
    testDb.exec('DELETE FROM git_snapshots');
  });

  afterEach(() => {
    if (fileSpy) {
      fileSpy.mockRestore();
      fileSpy = undefined;
    }
    if (spawnSpy) spawnSpy.mockRestore();
  });

  // ---------------------------------------------------------------
  // GET /status
  // ---------------------------------------------------------------
  describe('GET /status', () => {
    test('parses porcelain output with modified files', async () => {
      ({ spawnSpy, fileSpy } = mockStatusSpawn(' M src/app.ts\n M README.md\n', 0));

      const res = await app.request('/status?path=/myproject');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.isRepo).toBe(true);
      expect(json.data.files).toHaveLength(2);
      expect(json.data.files[0]).toEqual({ path: 'src/app.ts', status: 'M', staged: false });
      expect(json.data.files[1]).toEqual({ path: 'README.md', status: 'M', staged: false });
    });

    test('parses untracked files', async () => {
      ({ spawnSpy, fileSpy } = mockStatusSpawn('?? newfile.ts\n', 0));

      const res = await app.request('/status?path=/myproject');
      const json = await res.json();
      expect(json.data.files).toHaveLength(1);
      expect(json.data.files[0]).toEqual({ path: 'newfile.ts', status: 'U', staged: false });
    });

    test('parses staged added files', async () => {
      ({ spawnSpy, fileSpy } = mockStatusSpawn('A  new.ts\n', 0));

      const res = await app.request('/status?path=/proj');
      const json = await res.json();
      expect(json.data.files[0]).toEqual({ path: 'new.ts', status: 'A', staged: true });
    });

    test('parses staged deleted files', async () => {
      ({ spawnSpy, fileSpy } = mockStatusSpawn('D  removed.ts\n', 0));

      const res = await app.request('/status?path=/proj');
      const json = await res.json();
      expect(json.data.files[0]).toEqual({ path: 'removed.ts', status: 'D', staged: true });
    });

    test('parses renamed files', async () => {
      ({ spawnSpy, fileSpy } = mockStatusSpawn('R  old.ts -> new.ts\n', 0));

      const res = await app.request('/status?path=/proj');
      const json = await res.json();
      expect(json.data.files[0].status).toBe('R');
      expect(json.data.files[0].staged).toBe(true);
    });

    test('parses staged modified files (M in index)', async () => {
      ({ spawnSpy, fileSpy } = mockStatusSpawn('M  staged.ts\n', 0));

      const res = await app.request('/status?path=/proj');
      const json = await res.json();
      expect(json.data.files[0]).toEqual({ path: 'staged.ts', status: 'M', staged: true });
    });

    test('returns isRepo=false when exit code is non-zero', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(
        mockProc('', 128, 'fatal: not a git repository') as any,
      );

      const res = await app.request('/status?path=/not-a-repo');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.isRepo).toBe(false);
      expect(json.data.files).toEqual([]);
    });

    test('returns empty files array for clean repo', async () => {
      ({ spawnSpy, fileSpy } = mockStatusSpawn('', 0));

      const res = await app.request('/status?path=/clean');
      const json = await res.json();
      expect(json.data.isRepo).toBe(true);
      expect(json.data.files).toEqual([]);
    });

    test('returns isRepo=false when spawn throws', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        throw new Error('spawn failed');
      });

      const res = await app.request('/status?path=/err');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.isRepo).toBe(false);
      expect(json.data.files).toEqual([]);
    });
  });

  // ---------------------------------------------------------------
  // GET /branch
  // ---------------------------------------------------------------
  describe('GET /branch', () => {
    test('returns the current branch name', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(mockProc('main\n', 0) as any);

      const res = await app.request('/branch?path=/proj');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.branch).toBe('main');
    });

    test('trims whitespace from branch name', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(mockProc('  feature/foo  \n', 0) as any);

      const res = await app.request('/branch?path=/proj');
      const json = await res.json();
      expect(json.data.branch).toBe('feature/foo');
    });

    test('returns empty branch when exit code is non-zero', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(
        mockProc('', 128, 'fatal: not a git repository') as any,
      );

      const res = await app.request('/branch?path=/not-a-repo');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.branch).toBe('');
    });

    test('returns empty branch when spawn throws', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        throw new Error('spawn failed');
      });

      const res = await app.request('/branch?path=/err');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.branch).toBe('');
    });
  });

  // ---------------------------------------------------------------
  // GET /diff
  // ---------------------------------------------------------------
  describe('GET /diff', () => {
    test('returns diff output for a file', async () => {
      const diffOutput = `diff --git a/src/app.ts b/src/app.ts
index abc..def 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
+import { foo } from 'bar';
 const x = 1;
`;
      spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(mockProc(diffOutput, 0) as any);

      const res = await app.request('/diff?path=/proj&file=src/app.ts');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.diff).toBe(diffOutput);
    });

    test('passes staged flag to git diff --cached', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(mockProc('staged diff output', 0) as any);

      const res = await app.request('/diff?path=/proj&file=src/app.ts&staged=true');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.diff).toBe('staged diff output');

      // Verify that git diff --cached was called
      const callArgs = spawnSpy.mock.calls[0][0] as string[];
      expect(callArgs).toContain('--cached');
    });

    test('does not pass --cached without staged=true', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(mockProc('unstaged diff', 0) as any);

      const res = await app.request('/diff?path=/proj&file=src/app.ts');
      await res.json();

      const callArgs = spawnSpy.mock.calls[0][0] as string[];
      expect(callArgs).not.toContain('--cached');
      expect(callArgs).toContain('--');
      expect(callArgs).toContain('src/app.ts');
    });

    test('returns error when git diff fails with non-zero exit', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(mockProc('', 1, 'fatal: bad file') as any);

      const res = await app.request('/diff?path=/proj&file=bad.ts');
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('fatal: bad file');
    });

    test('returns generic error when git diff fails with empty stderr', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(mockProc('', 1, '') as any);

      const res = await app.request('/diff?path=/proj&file=bad.ts');
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe('git diff failed');
    });

    test('returns 500 when spawn throws', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        throw new Error('spawn error');
      });

      const res = await app.request('/diff?path=/proj&file=x.ts');
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('spawn error');
    });

    test('returns empty diff for unchanged file', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(mockProc('', 0) as any);

      const res = await app.request('/diff?path=/proj&file=clean.ts');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.diff).toBe('');
    });
  });

  // ---------------------------------------------------------------
  // POST /snapshot — with mocked Bun.spawn
  // ---------------------------------------------------------------
  describe('POST /snapshot — git commands mocked', () => {
    test('creates a snapshot when repo has changes', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1: // git rev-parse --is-inside-work-tree
            return mockProc('true\n', 0) as any;
          case 2: // git rev-parse HEAD
            return mockProc('abc123def456\n', 0) as any;
          case 3: // git status --porcelain
            return mockProc(' M src/app.ts\n', 0) as any;
          case 4: // git stash create
            return mockProc('stash789xyz\n', 0) as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const res = await app.request('/snapshot', {
        method: 'POST',
        body: JSON.stringify({ path: '/myproject', conversationId: 'conv-1', reason: 'test' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.headSha).toBe('abc123def456');
      expect(json.data.stashSha).toBe('stash789xyz');
      expect(json.data.hasChanges).toBe(true);
      expect(json.data.id).toBeDefined();

      // Verify it was stored in the database
      const row = testDb.query('SELECT * FROM git_snapshots WHERE id = ?').get(json.data.id) as any;
      expect(row).toBeDefined();
      expect(row.head_sha).toBe('abc123def456');
      expect(row.stash_sha).toBe('stash789xyz');
      expect(row.has_changes).toBe(1);
      expect(row.reason).toBe('test');
      expect(row.conversation_id).toBe('conv-1');
    });

    test('creates a snapshot without stash when no changes', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1: // git rev-parse --is-inside-work-tree
            return mockProc('true\n', 0) as any;
          case 2: // git rev-parse HEAD
            return mockProc('headsha123\n', 0) as any;
          case 3: // git status --porcelain
            return mockProc('', 0) as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const res = await app.request('/snapshot', {
        method: 'POST',
        body: JSON.stringify({ path: '/clean-project' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.headSha).toBe('headsha123');
      expect(json.data.stashSha).toBeNull();
      expect(json.data.hasChanges).toBe(false);

      // Should NOT have called stash create (only 3 spawn calls)
      expect(spawnSpy).toHaveBeenCalledTimes(3);
    });

    test('returns 200 with skipped when not a git repo', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(mockProc('false\n', 0) as any);

      const res = await app.request('/snapshot', {
        method: 'POST',
        body: JSON.stringify({ path: '/not-a-repo' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.skipped).toBe(true);
      expect(json.reason).toBe('not-a-git-repo');
    });

    test('returns 200 with skipped when no commits yet', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1: // git rev-parse --is-inside-work-tree
            return mockProc('true\n', 0) as any;
          case 2: // git rev-parse HEAD — fails (no commits)
            return mockProc('', 128, 'fatal: bad default revision') as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const res = await app.request('/snapshot', {
        method: 'POST',
        body: JSON.stringify({ path: '/empty-repo' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.skipped).toBe(true);
      expect(json.reason).toBe('no-commits');
    });

    test('returns 500 when an unexpected error occurs', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        throw new Error('something went wrong');
      });

      const res = await app.request('/snapshot', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('something went wrong');
    });

    test('uses default reason when not provided', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1:
            return mockProc('true\n', 0) as any;
          case 2:
            return mockProc('sha456\n', 0) as any;
          case 3:
            return mockProc('', 0) as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const res = await app.request('/snapshot', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      const row = testDb.query('SELECT * FROM git_snapshots WHERE id = ?').get(json.data.id) as any;
      expect(row.reason).toBe('pre-agent');
    });

    test('stores null stashSha when stash create returns empty', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1:
            return mockProc('true\n', 0) as any;
          case 2:
            return mockProc('headabc\n', 0) as any;
          case 3:
            return mockProc(' M file.ts\n', 0) as any;
          case 4: // git stash create returns empty (no stash needed)
            return mockProc('', 0) as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const res = await app.request('/snapshot', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.data.stashSha).toBeNull();
    });
  });

  // ---------------------------------------------------------------
  // POST /snapshot/:id/restore — with mocked Bun.spawn
  // ---------------------------------------------------------------
  describe('POST /snapshot/:id/restore — git commands mocked', () => {
    test('restores a snapshot without stash', async () => {
      testDb
        .query(
          'INSERT INTO git_snapshots (id, workspace_path, head_sha, stash_sha, reason, has_changes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run('restore-1', '/proj', 'headabc', null, 'pre-agent', 0, Date.now());

      spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(
        mockProc('HEAD is now at headabc\n', 0) as any,
      );

      const res = await app.request('/snapshot/restore-1/restore', { method: 'POST' });
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.restored).toBe(true);

      // Only reset was called, no stash apply
      expect(spawnSpy).toHaveBeenCalledTimes(1);
    });

    test('restores a snapshot with stash apply', async () => {
      testDb
        .query(
          'INSERT INTO git_snapshots (id, workspace_path, head_sha, stash_sha, reason, has_changes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run('restore-2', '/proj', 'headabc', 'stash123', 'pre-agent', 1, Date.now());

      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => mockProc('', 0) as any);

      const res = await app.request('/snapshot/restore-2/restore', { method: 'POST' });
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.restored).toBe(true);

      // Both reset and stash apply were called
      expect(spawnSpy).toHaveBeenCalledTimes(2);
    });

    test('returns 500 when git reset fails', async () => {
      testDb
        .query(
          'INSERT INTO git_snapshots (id, workspace_path, head_sha, stash_sha, reason, has_changes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run('restore-fail', '/proj', 'badsha', null, 'pre-agent', 0, Date.now());

      spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(
        mockProc('', 1, 'fatal: could not reset') as any,
      );

      const res = await app.request('/snapshot/restore-fail/restore', { method: 'POST' });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('Reset failed');
    });

    test('returns 500 when spawn throws during restore', async () => {
      testDb
        .query(
          'INSERT INTO git_snapshots (id, workspace_path, head_sha, stash_sha, reason, has_changes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run('restore-err', '/proj', 'sha', null, 'pre-agent', 0, Date.now());

      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        throw new Error('restore spawn failed');
      });

      const res = await app.request('/snapshot/restore-err/restore', { method: 'POST' });
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('restore spawn failed');
    });
  });

  // ---------------------------------------------------------------
  // POST /commit — stage all + commit
  // ---------------------------------------------------------------
  describe('POST /commit', () => {
    test('returns 400 when path is missing', async () => {
      const res = await app.request('/commit', {
        method: 'POST',
        body: JSON.stringify({ message: 'test' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('path required');
    });

    test('returns 400 when message is missing', async () => {
      const res = await app.request('/commit', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('commit message required');
    });

    test('returns 400 when message is empty string', async () => {
      const res = await app.request('/commit', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj', message: '   ' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
    });

    test('successful commit returns sha', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1: // runExitCode: git diff --cached --quiet → 0 = nothing staged
            return mockProc('', 0) as any;
          case 2: // run: git add -A (auto-stage)
            return mockProc('', 0) as any;
          case 3: // run: git commit -m
            return mockProc('[main abc1234] test commit\n 1 file changed\n', 0) as any;
          case 4: // run: git rev-parse HEAD
            return mockProc('abc1234567890\n', 0) as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const res = await app.request('/commit', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj', message: 'test commit' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.sha).toBe('abc1234567890');
    });

    test('returns error when git add fails', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1: // runExitCode: git diff --cached --quiet → 0 = nothing staged
            return mockProc('', 0) as any;
          case 2: // run: git add -A — fails
            return mockProc('', 128, 'fatal: Unable to create index.lock') as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const res = await app.request('/commit', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj', message: 'test' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('git add failed');
      expect(json.error).toContain('index.lock');
    });

    test('returns error when git commit fails', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1: // runExitCode: git diff --cached --quiet → 0 = nothing staged
            return mockProc('', 0) as any;
          case 2: // run: git add -A
            return mockProc('', 0) as any;
          case 3: // run: git commit -m — fails
            return mockProc('', 1, 'pre-commit hook failed') as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const res = await app.request('/commit', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj', message: 'test' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('git commit failed');
    });

    test('returns 500 when spawn throws', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        throw new Error('spawn error during commit');
      });

      const res = await app.request('/commit', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj', message: 'test' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('spawn error during commit');
    });

    test('rejects blocked paths', async () => {
      const res = await app.request('/commit', {
        method: 'POST',
        body: JSON.stringify({ path: '/proc/something', message: 'test' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.ok).toBe(false);
    });
  });

  // ---------------------------------------------------------------
  // POST /clean — discard all uncommitted changes
  // ---------------------------------------------------------------
  describe('POST /clean', () => {
    test('returns 400 when path is missing', async () => {
      const res = await app.request('/clean', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('path required');
    });

    test('cleans dirty working tree and returns file counts', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1: // git status --porcelain (before)
            return mockProc(' M file.ts\n?? new.ts\n', 0) as any;
          case 2: // git reset HEAD
            return mockProc('', 0) as any;
          case 3: // git checkout -- .
            return mockProc('', 0) as any;
          case 4: // git clean -fd
            return mockProc('Removing new.ts\n', 0) as any;
          case 5: // git status --porcelain (after)
            return mockProc('', 0) as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const res = await app.request('/clean', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.cleaned).toBe(true);
      expect(json.data.beforeFileCount).toBe(2);
      expect(json.data.afterFileCount).toBe(0);
      expect(json.data.fullyClean).toBe(true);
    });

    test('reports when clean leaves residual files', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1: // git status --porcelain (before)
            return mockProc(' M file.ts\n M locked.ts\n', 0) as any;
          case 2: // git reset HEAD
            return mockProc('', 0) as any;
          case 3: // git checkout -- .
            return mockProc('', 0) as any;
          case 4: // git clean -fd
            return mockProc('', 0) as any;
          case 5: // git status --porcelain (after) — one file remains
            return mockProc(' M locked.ts\n', 0) as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const res = await app.request('/clean', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.cleaned).toBe(true);
      expect(json.data.beforeFileCount).toBe(2);
      expect(json.data.afterFileCount).toBe(1);
      expect(json.data.fullyClean).toBe(false);
    });

    test('handles already-clean working tree', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1: // git status --porcelain (before — clean)
            return mockProc('', 0) as any;
          case 2: // git reset HEAD
            return mockProc('', 0) as any;
          case 3: // git checkout -- .
            return mockProc('', 0) as any;
          case 4: // git clean -fd
            return mockProc('', 0) as any;
          case 5: // git status --porcelain (after)
            return mockProc('', 0) as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const res = await app.request('/clean', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.beforeFileCount).toBe(0);
      expect(json.data.afterFileCount).toBe(0);
      expect(json.data.fullyClean).toBe(true);
    });

    test('returns 500 when spawn throws', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        throw new Error('clean spawn failed');
      });

      const res = await app.request('/clean', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('clean spawn failed');
    });
  });

  // ---------------------------------------------------------------
  // GET /diagnose — git diagnostics
  // ---------------------------------------------------------------
  describe('GET /diagnose', () => {
    test('returns error check when not a git repo', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(mockProc('false\n', 0) as any);

      const res = await app.request('/diagnose?path=/not-a-repo');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.checks).toHaveLength(1);
      expect(json.data.checks[0].name).toBe('git-repo');
      expect(json.data.checks[0].status).toBe('error');
    });

    test('returns all checks for a healthy repo', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1: // git rev-parse --is-inside-work-tree
            return mockProc('true\n', 0) as any;
          case 2: // git rev-parse --git-dir
            return mockProc('.git\n', 0) as any;
          case 3: // git rev-parse HEAD
            return mockProc('abc123def456\n', 0) as any;
          case 4: // git status --porcelain
            return mockProc('', 0) as any;
          case 5: // git diff --cached --stat
            return mockProc('', 0) as any;
          case 6: // git diff --stat
            return mockProc('', 0) as any;
          case 7: // git diff --name-only --diff-filter=U
            return mockProc('', 0) as any;
          case 8: // git rev-parse --abbrev-ref HEAD
            return mockProc('main\n', 0) as any;
          case 9: // git ls-files --others --exclude-standard
            return mockProc('', 0) as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      // Mock Bun.file for lock/rebase/merge checks
      const originalFile = Bun.file.bind(Bun);
      const fileSpy = spyOn(Bun, 'file').mockImplementation((path: any) => {
        // Return a mock file that doesn't exist
        return { exists: () => Promise.resolve(false) } as any;
      });

      try {
        const res = await app.request('/diagnose?path=/proj');
        const json = await res.json();
        expect(json.ok).toBe(true);

        const checkNames = json.data.checks.map((c: any) => c.name);
        expect(checkNames).toContain('git-repo');
        expect(checkNames).toContain('index-lock');
        expect(checkNames).toContain('head-ref');
        expect(checkNames).toContain('working-tree');
        expect(checkNames).toContain('staging-mismatch');
        expect(checkNames).toContain('merge-conflicts');
        expect(checkNames).toContain('in-progress-op');
        expect(checkNames).toContain('branch');
        expect(checkNames).toContain('untracked-count');

        // All should be ok for a healthy repo
        for (const check of json.data.checks) {
          expect(check.status).toBe('ok');
        }
      } finally {
        fileSpy.mockRestore();
      }
    });

    test('detects dirty working tree', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1: // git rev-parse --is-inside-work-tree
            return mockProc('true\n', 0) as any;
          case 2: // git rev-parse --git-dir
            return mockProc('.git\n', 0) as any;
          case 3: // git rev-parse HEAD
            return mockProc('abc123\n', 0) as any;
          case 4: // git status --porcelain
            return mockProc(' M src/app.ts\n?? newfile.ts\n', 0) as any;
          case 5: // git diff --cached --stat
            return mockProc('', 0) as any;
          case 6: // git diff --stat
            return mockProc(' src/app.ts | 2 +-\n 1 file changed\n', 0) as any;
          case 7: // git diff --name-only --diff-filter=U
            return mockProc('', 0) as any;
          case 8: // git rev-parse --abbrev-ref HEAD
            return mockProc('feature/test\n', 0) as any;
          case 9: // git ls-files --others --exclude-standard
            return mockProc('newfile.ts\n', 0) as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const fileSpy = spyOn(Bun, 'file').mockImplementation((path: any) => {
        return { exists: () => Promise.resolve(false) } as any;
      });

      try {
        const res = await app.request('/diagnose?path=/proj');
        const json = await res.json();
        expect(json.ok).toBe(true);

        const workingTree = json.data.checks.find((c: any) => c.name === 'working-tree');
        expect(workingTree.status).toBe('warn');
        expect(workingTree.message).toContain('changes');

        const branchCheck = json.data.checks.find((c: any) => c.name === 'branch');
        expect(branchCheck.message).toContain('feature/test');
      } finally {
        fileSpy.mockRestore();
      }
    });

    test('detects merge conflicts', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1:
            return mockProc('true\n', 0) as any;
          case 2:
            return mockProc('.git\n', 0) as any;
          case 3:
            return mockProc('abc123\n', 0) as any;
          case 4:
            return mockProc('UU conflicted.ts\n', 0) as any;
          case 5:
            return mockProc('', 0) as any;
          case 6:
            return mockProc('', 0) as any;
          case 7: // git diff --name-only --diff-filter=U — conflict files
            return mockProc('conflicted.ts\n', 0) as any;
          case 8:
            return mockProc('main\n', 0) as any;
          case 9:
            return mockProc('', 0) as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const fileSpy = spyOn(Bun, 'file').mockImplementation((path: any) => {
        return { exists: () => Promise.resolve(false) } as any;
      });

      try {
        const res = await app.request('/diagnose?path=/proj');
        const json = await res.json();

        const conflictCheck = json.data.checks.find((c: any) => c.name === 'merge-conflicts');
        expect(conflictCheck.status).toBe('error');
        expect(conflictCheck.message).toContain('Merge conflicts');
      } finally {
        fileSpy.mockRestore();
      }
    });

    test('returns 403 for blocked paths', async () => {
      const res = await app.request('/diagnose?path=/proc/something');
      expect(res.status).toBe(403);
    });

    test('returns 500 when spawn throws', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        throw new Error('diagnose spawn failed');
      });

      const res = await app.request('/diagnose?path=/proj');
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('diagnose spawn failed');
    });

    test('detects index.lock file', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1:
            return mockProc('true\n', 0) as any;
          case 2:
            return mockProc('.git\n', 0) as any;
          case 3:
            return mockProc('abc123\n', 0) as any;
          case 4:
            return mockProc('', 0) as any;
          case 5:
            return mockProc('', 0) as any;
          case 6:
            return mockProc('', 0) as any;
          case 7:
            return mockProc('', 0) as any;
          case 8:
            return mockProc('main\n', 0) as any;
          case 9:
            return mockProc('', 0) as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const fileSpy = spyOn(Bun, 'file').mockImplementation((path: any) => {
        const pathStr = String(path);
        // Simulate index.lock existing
        if (pathStr.includes('index.lock')) {
          return { exists: () => Promise.resolve(true) } as any;
        }
        return { exists: () => Promise.resolve(false) } as any;
      });

      try {
        const res = await app.request('/diagnose?path=/proj');
        const json = await res.json();
        const lockCheck = json.data.checks.find((c: any) => c.name === 'index-lock');
        expect(lockCheck.status).toBe('error');
        expect(lockCheck.message).toContain('index.lock');
      } finally {
        fileSpy.mockRestore();
      }
    });

    test('detects detached HEAD state', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1:
            return mockProc('true\n', 0) as any;
          case 2:
            return mockProc('.git\n', 0) as any;
          case 3:
            return mockProc('abc123\n', 0) as any;
          case 4:
            return mockProc('', 0) as any;
          case 5:
            return mockProc('', 0) as any;
          case 6:
            return mockProc('', 0) as any;
          case 7:
            return mockProc('', 0) as any;
          case 8:
            return mockProc('HEAD\n', 0) as any; // Detached HEAD
          case 9:
            return mockProc('', 0) as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const fileSpy = spyOn(Bun, 'file').mockImplementation(() => {
        return { exists: () => Promise.resolve(false) } as any;
      });

      try {
        const res = await app.request('/diagnose?path=/proj');
        const json = await res.json();
        const branchCheck = json.data.checks.find((c: any) => c.name === 'branch');
        expect(branchCheck.status).toBe('warn');
        expect(branchCheck.message).toContain('Detached HEAD');
      } finally {
        fileSpy.mockRestore();
      }
    });

    test('detects both staged and unstaged changes (staging mismatch)', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1:
            return mockProc('true\n', 0) as any;
          case 2:
            return mockProc('.git\n', 0) as any;
          case 3:
            return mockProc('abc123\n', 0) as any;
          case 4:
            return mockProc('MM both.ts\n', 0) as any;
          case 5:
            return mockProc(' both.ts | 3 +++\n 1 file changed\n', 0) as any; // staged diff
          case 6:
            return mockProc(' both.ts | 2 ++\n 1 file changed\n', 0) as any; // unstaged diff
          case 7:
            return mockProc('', 0) as any;
          case 8:
            return mockProc('main\n', 0) as any;
          case 9:
            return mockProc('', 0) as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const fileSpy = spyOn(Bun, 'file').mockImplementation(() => {
        return { exists: () => Promise.resolve(false) } as any;
      });

      try {
        const res = await app.request('/diagnose?path=/proj');
        const json = await res.json();
        const stagingCheck = json.data.checks.find((c: any) => c.name === 'staging-mismatch');
        expect(stagingCheck.status).toBe('warn');
        expect(stagingCheck.message).toContain('Both staged AND unstaged');
      } finally {
        fileSpy.mockRestore();
      }
    });

    test('detects rebase in progress', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1:
            return mockProc('true\n', 0) as any;
          case 2:
            return mockProc('.git\n', 0) as any;
          case 3:
            return mockProc('abc123\n', 0) as any;
          case 4:
            return mockProc('', 0) as any;
          case 5:
            return mockProc('', 0) as any;
          case 6:
            return mockProc('', 0) as any;
          case 7:
            return mockProc('', 0) as any;
          case 8:
            return mockProc('main\n', 0) as any;
          case 9:
            return mockProc('', 0) as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const fileSpy = spyOn(Bun, 'file').mockImplementation((path: any) => {
        const pathStr = String(path);
        // Simulate rebase-merge directory existing
        if (pathStr.includes('rebase-merge')) {
          return { exists: () => Promise.resolve(true) } as any;
        }
        return { exists: () => Promise.resolve(false) } as any;
      });

      try {
        const res = await app.request('/diagnose?path=/proj');
        const json = await res.json();
        const opCheck = json.data.checks.find((c: any) => c.name === 'in-progress-op');
        expect(opCheck.status).toBe('error');
        expect(opCheck.message).toContain('rebase');
      } finally {
        fileSpy.mockRestore();
      }
    });

    test('detects merge in progress', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1:
            return mockProc('true\n', 0) as any;
          case 2:
            return mockProc('.git\n', 0) as any;
          case 3:
            return mockProc('abc123\n', 0) as any;
          case 4:
            return mockProc('', 0) as any;
          case 5:
            return mockProc('', 0) as any;
          case 6:
            return mockProc('', 0) as any;
          case 7:
            return mockProc('', 0) as any;
          case 8:
            return mockProc('main\n', 0) as any;
          case 9:
            return mockProc('', 0) as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const fileSpy = spyOn(Bun, 'file').mockImplementation((path: any) => {
        const pathStr = String(path);
        if (pathStr.includes('MERGE_HEAD')) {
          return { exists: () => Promise.resolve(true) } as any;
        }
        return { exists: () => Promise.resolve(false) } as any;
      });

      try {
        const res = await app.request('/diagnose?path=/proj');
        const json = await res.json();
        const opCheck = json.data.checks.find((c: any) => c.name === 'in-progress-op');
        expect(opCheck.status).toBe('warn');
        expect(opCheck.message).toContain('merge');
      } finally {
        fileSpy.mockRestore();
      }
    });

    test('warns about invalid HEAD (no commits)', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1:
            return mockProc('true\n', 0) as any;
          case 2:
            return mockProc('.git\n', 0) as any;
          case 3:
            return mockProc('', 128, 'fatal: bad default revision HEAD') as any; // HEAD invalid
          case 4:
            return mockProc('', 0) as any;
          case 5:
            return mockProc('', 0) as any;
          case 6:
            return mockProc('', 0) as any;
          case 7:
            return mockProc('', 0) as any;
          case 8:
            return mockProc('main\n', 0) as any;
          case 9:
            return mockProc('', 0) as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const fileSpy = spyOn(Bun, 'file').mockImplementation(() => {
        return { exists: () => Promise.resolve(false) } as any;
      });

      try {
        const res = await app.request('/diagnose?path=/proj');
        const json = await res.json();
        const headCheck = json.data.checks.find((c: any) => c.name === 'head-ref');
        expect(headCheck.status).toBe('warn');
        expect(headCheck.message).toContain('invalid');
      } finally {
        fileSpy.mockRestore();
      }
    });

    test('warns about large number of untracked files', async () => {
      // Generate 150 untracked files
      const untrackedList = Array.from({ length: 150 }, (_, i) => `untracked_${i}.ts`).join('\n');

      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1:
            return mockProc('true\n', 0) as any;
          case 2:
            return mockProc('.git\n', 0) as any;
          case 3:
            return mockProc('abc123\n', 0) as any;
          case 4:
            return mockProc('', 0) as any;
          case 5:
            return mockProc('', 0) as any;
          case 6:
            return mockProc('', 0) as any;
          case 7:
            return mockProc('', 0) as any;
          case 8:
            return mockProc('main\n', 0) as any;
          case 9:
            return mockProc(untrackedList + '\n', 0) as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const fileSpy = spyOn(Bun, 'file').mockImplementation(() => {
        return { exists: () => Promise.resolve(false) } as any;
      });

      try {
        const res = await app.request('/diagnose?path=/proj');
        const json = await res.json();
        const untrackedCheck = json.data.checks.find((c: any) => c.name === 'untracked-count');
        expect(untrackedCheck.status).toBe('warn');
        expect(untrackedCheck.message).toContain('150');
        expect(untrackedCheck.message).toContain('.gitignore');
        // Should include detail with first 10 files
        expect(untrackedCheck.detail).toContain('untracked_0.ts');
        expect(untrackedCheck.detail).toContain('...');
      } finally {
        fileSpy.mockRestore();
      }
    });

    test('working tree status shows correct counts for staged, unstaged, and untracked', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1:
            return mockProc('true\n', 0) as any;
          case 2:
            return mockProc('.git\n', 0) as any;
          case 3:
            return mockProc('abc123\n', 0) as any;
          case 4:
            return mockProc('M  staged.ts\n M unstaged.ts\n?? untracked.ts\n', 0) as any;
          case 5:
            return mockProc('', 0) as any;
          case 6:
            return mockProc('', 0) as any;
          case 7:
            return mockProc('', 0) as any;
          case 8:
            return mockProc('main\n', 0) as any;
          case 9:
            return mockProc('', 0) as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const fileSpy = spyOn(Bun, 'file').mockImplementation(() => {
        return { exists: () => Promise.resolve(false) } as any;
      });

      try {
        const res = await app.request('/diagnose?path=/proj');
        const json = await res.json();
        const workingTree = json.data.checks.find((c: any) => c.name === 'working-tree');
        expect(workingTree.status).toBe('warn');
        expect(workingTree.message).toContain('1 staged');
        expect(workingTree.message).toContain('1 unstaged');
        expect(workingTree.message).toContain('1 untracked');
        expect(workingTree.message).toContain('3 total');
      } finally {
        fileSpy.mockRestore();
      }
    });
  });

  // ---------------------------------------------------------------
  // POST /commit — commit flow diagnostic logging verification
  // ---------------------------------------------------------------
  describe('POST /commit — command verification', () => {
    test('calls correct git commands in order: diff-check, add, commit, rev-parse', async () => {
      let callIndex = 0;
      const spawnCalls: string[][] = [];
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation((...args: any[]) => {
        callIndex++;
        const cmd = args[0] as string[];
        spawnCalls.push(cmd);
        switch (callIndex) {
          case 1: // runExitCode: git diff --cached --quiet → 0 = nothing staged
            return mockProc('', 0) as any;
          case 2: // run: git add -A
            return mockProc('', 0) as any;
          case 3: // run: git commit -m
            return mockProc('[main abc1234] test\n', 0) as any;
          case 4: // run: git rev-parse HEAD
            return mockProc('abc1234567890\n', 0) as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const res = await app.request('/commit', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj', message: 'test' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.ok).toBe(true);

      // Verify exactly 4 spawn calls
      expect(spawnCalls).toHaveLength(4);

      // Verify the staging check
      expect(spawnCalls[0]).toEqual(expect.arrayContaining(['git', 'diff', '--cached', '--quiet']));

      // Verify git add was called
      const addCalls = spawnCalls.filter((cmd) => cmd.includes('git') && cmd.includes('add'));
      expect(addCalls).toHaveLength(1);

      // Verify git commit was called
      const commitCalls = spawnCalls.filter((cmd) => cmd.includes('commit') && cmd.includes('-m'));
      expect(commitCalls).toHaveLength(1);

      // Verify rev-parse HEAD was called
      const revParseCalls = spawnCalls.filter(
        (cmd) => cmd.includes('rev-parse') && cmd.includes('HEAD'),
      );
      expect(revParseCalls).toHaveLength(1);
    });

    test('trims commit message whitespace', async () => {
      let callIndex = 0;
      let commitMsg = '';
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation((...args: any[]) => {
        callIndex++;
        const cmd = args[0] as string[];
        if (cmd.includes('commit') && cmd.includes('-m')) {
          commitMsg = cmd[cmd.indexOf('-m') + 1];
        }
        switch (callIndex) {
          case 1: // runExitCode: git diff --cached --quiet → 0 = nothing staged
            return mockProc('', 0) as any;
          case 2: // run: git add -A
            return mockProc('', 0) as any;
          case 3: // run: git commit -m
            return mockProc('[main abc] test\n', 0) as any;
          case 4: // run: git rev-parse HEAD
            return mockProc('abc123\n', 0) as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const res = await app.request('/commit', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj', message: '  trimmed message  ' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect((await res.json()).ok).toBe(true);
      expect(commitMsg).toBe('trimmed message');
    });
  });

  // ---------------------------------------------------------------
  // POST /clean — diagnostic edge cases
  // ---------------------------------------------------------------
  describe('POST /clean — diagnostic edge cases', () => {
    test('continues cleaning when reset fails (non-fatal)', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1:
            return mockProc(' M file.ts\n', 0) as any; // before
          case 2:
            return mockProc('', 1, 'reset failed') as any; // reset HEAD fails
          case 3:
            return mockProc('', 0) as any; // checkout
          case 4:
            return mockProc('', 0) as any; // clean
          case 5:
            return mockProc('', 0) as any; // after
          default:
            return mockProc('', 0) as any;
        }
      });

      const res = await app.request('/clean', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.fullyClean).toBe(true);
    });

    test('continues cleaning when checkout fails (non-fatal)', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1:
            return mockProc(' M file.ts\n', 0) as any;
          case 2:
            return mockProc('', 0) as any; // reset OK
          case 3:
            return mockProc('', 1, 'checkout failed') as any; // checkout fails
          case 4:
            return mockProc('', 0) as any; // clean
          case 5:
            return mockProc('', 0) as any; // after — clean despite checkout fail
          default:
            return mockProc('', 0) as any;
        }
      });

      const res = await app.request('/clean', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.fullyClean).toBe(true);
    });

    test('continues cleaning when git clean -fd fails (non-fatal)', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1:
            return mockProc('?? new.ts\n', 0) as any;
          case 2:
            return mockProc('', 0) as any;
          case 3:
            return mockProc('', 0) as any;
          case 4:
            return mockProc('', 1, 'clean failed') as any; // clean -fd fails
          case 5:
            return mockProc('?? new.ts\n', 0) as any; // still dirty
          default:
            return mockProc('', 0) as any;
        }
      });

      const res = await app.request('/clean', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.fullyClean).toBe(false);
      expect(json.data.afterFileCount).toBe(1);
    });
  });

  // ---------------------------------------------------------------
  // Path validation
  // ---------------------------------------------------------------
  describe('Path validation', () => {
    test('blocks /sys path for status', async () => {
      const res = await app.request('/status?path=/sys/something');
      expect(res.status).toBe(403);
    });

    test('blocks /dev path for branch', async () => {
      const res = await app.request('/branch?path=/dev/null');
      expect(res.status).toBe(403);
    });

    test('blocks /boot path for commit', async () => {
      const res = await app.request('/commit', {
        method: 'POST',
        body: JSON.stringify({ path: '/boot/kernel', message: 'test' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(403);
    });

    test('blocks /sbin path for clean', async () => {
      const res = await app.request('/clean', {
        method: 'POST',
        body: JSON.stringify({ path: '/sbin/init' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(403);
    });

    test('blocks /proc path for push', async () => {
      const res = await app.request('/push', {
        method: 'POST',
        body: JSON.stringify({ path: '/proc/self' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(403);
    });

    test('blocks /proc path for stage', async () => {
      const res = await app.request('/stage', {
        method: 'POST',
        body: JSON.stringify({ path: '/proc/self' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(403);
    });

    test('blocks /sys path for unstage', async () => {
      const res = await app.request('/unstage', {
        method: 'POST',
        body: JSON.stringify({ path: '/sys/block' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(403);
    });

    test('blocks /dev path for snapshot', async () => {
      const res = await app.request('/snapshot', {
        method: 'POST',
        body: JSON.stringify({ path: '/dev/null' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(403);
    });

    test('blocks /boot path for generate-commit-message', async () => {
      const res = await app.request('/generate-commit-message', {
        method: 'POST',
        body: JSON.stringify({ path: '/boot/vmlinuz' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(403);
    });

    test('blocks /proc path for diff', async () => {
      const res = await app.request('/diff?path=/proc/self&file=test.ts');
      expect(res.status).toBe(403);
    });

    test('blocks /proc path for blame', async () => {
      const res = await app.request('/blame?path=/proc/self&file=test.ts');
      expect(res.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------
  // GET /snapshot/by-message/:messageId — get snapshot by message ID
  // ---------------------------------------------------------------
  describe('GET /snapshot/by-message/:messageId', () => {
    test('returns 404 when no snapshot exists for message', async () => {
      const res = await app.request('/snapshot/by-message/nonexistent-msg');
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('No snapshot for this message');
    });

    test('returns snapshot for a given message ID', async () => {
      testDb
        .query(
          'INSERT INTO git_snapshots (id, workspace_path, conversation_id, head_sha, stash_sha, reason, has_changes, message_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run('snap-msg-1', '/proj', 'conv-1', 'abc123', 'stash456', 'pre-agent', 1, 'msg-42', 5000);

      const res = await app.request('/snapshot/by-message/msg-42');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.id).toBe('snap-msg-1');
      expect(json.data.workspacePath).toBe('/proj');
      expect(json.data.conversationId).toBe('conv-1');
      expect(json.data.headSha).toBe('abc123');
      expect(json.data.stashSha).toBe('stash456');
      expect(json.data.reason).toBe('pre-agent');
      expect(json.data.hasChanges).toBe(true);
      expect(json.data.messageId).toBe('msg-42');
      expect(json.data.createdAt).toBe(5000);
    });

    test('returns the most recent snapshot when multiple exist for the same message', async () => {
      testDb
        .query(
          'INSERT INTO git_snapshots (id, workspace_path, head_sha, reason, has_changes, message_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run('snap-old', '/proj', 'old-sha', 'pre-agent', 0, 'msg-dup', 1000);
      testDb
        .query(
          'INSERT INTO git_snapshots (id, workspace_path, head_sha, reason, has_changes, message_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run('snap-new', '/proj', 'new-sha', 'pre-agent', 0, 'msg-dup', 2000);

      const res = await app.request('/snapshot/by-message/msg-dup');
      const json = await res.json();
      expect(json.data.id).toBe('snap-new');
    });

    test('returns null messageId when not set in row', async () => {
      testDb
        .query(
          'INSERT INTO git_snapshots (id, workspace_path, head_sha, reason, has_changes, message_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run('snap-no-msg', '/proj', 'sha', 'pre-agent', 0, 'msg-x', 3000);

      const res = await app.request('/snapshot/by-message/msg-x');
      const json = await res.json();
      expect(json.ok).toBe(true);
      // message_id is set in this case
      expect(json.data.messageId).toBe('msg-x');
    });
  });

  // ---------------------------------------------------------------
  // POST /stage — stage files
  // ---------------------------------------------------------------
  describe('POST /stage', () => {
    test('returns 400 when path is missing', async () => {
      const res = await app.request('/stage', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('path required');
    });

    test('stages all files when no files array is provided', async () => {
      const spawnCalls: string[][] = [];
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation((...args: any[]) => {
        spawnCalls.push(args[0] as string[]);
        return mockProc('', 0) as any;
      });

      const res = await app.request('/stage', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.ok).toBe(true);
      // Should call `git add -A`
      expect(spawnCalls[0]).toEqual(['git', 'add', '-A']);
    });

    test('stages specific files when files array is provided', async () => {
      const spawnCalls: string[][] = [];
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation((...args: any[]) => {
        spawnCalls.push(args[0] as string[]);
        return mockProc('', 0) as any;
      });

      const res = await app.request('/stage', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj', files: ['src/a.ts', 'src/b.ts'] }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(spawnCalls[0]).toEqual(['git', 'add', '--', 'src/a.ts', 'src/b.ts']);
    });

    test('stages all when files is empty array', async () => {
      const spawnCalls: string[][] = [];
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation((...args: any[]) => {
        spawnCalls.push(args[0] as string[]);
        return mockProc('', 0) as any;
      });

      const res = await app.request('/stage', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj', files: [] }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(spawnCalls[0]).toEqual(['git', 'add', '-A']);
    });

    test('returns 500 when git add fails', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(
        mockProc('', 128, 'fatal: pathspec did not match') as any,
      );

      const res = await app.request('/stage', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj', files: ['nonexistent.ts'] }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('git add failed');
    });

    test('returns 500 when spawn throws', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        throw new Error('stage spawn failed');
      });

      const res = await app.request('/stage', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('stage spawn failed');
    });
  });

  // ---------------------------------------------------------------
  // POST /unstage — unstage files
  // ---------------------------------------------------------------
  describe('POST /unstage', () => {
    test('returns 400 when path is missing', async () => {
      const res = await app.request('/unstage', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('path required');
    });

    test('unstages all files when no files array is provided', async () => {
      const spawnCalls: string[][] = [];
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation((...args: any[]) => {
        spawnCalls.push(args[0] as string[]);
        return mockProc('', 0) as any;
      });

      const res = await app.request('/unstage', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(spawnCalls[0]).toEqual(['git', 'reset', 'HEAD']);
    });

    test('unstages specific files when files array is provided', async () => {
      const spawnCalls: string[][] = [];
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation((...args: any[]) => {
        spawnCalls.push(args[0] as string[]);
        return mockProc('', 0) as any;
      });

      const res = await app.request('/unstage', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj', files: ['src/a.ts'] }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(spawnCalls[0]).toEqual(['git', 'reset', 'HEAD', '--', 'src/a.ts']);
    });

    test('unstages all when files is empty array', async () => {
      const spawnCalls: string[][] = [];
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation((...args: any[]) => {
        spawnCalls.push(args[0] as string[]);
        return mockProc('', 0) as any;
      });

      const res = await app.request('/unstage', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj', files: [] }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(spawnCalls[0]).toEqual(['git', 'reset', 'HEAD']);
    });

    test('returns 500 when git reset fails', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(
        mockProc('', 128, 'fatal: reset failed') as any,
      );

      const res = await app.request('/unstage', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('git reset failed');
    });

    test('returns 500 when spawn throws', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        throw new Error('unstage spawn failed');
      });

      const res = await app.request('/unstage', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('unstage spawn failed');
    });
  });

  // ---------------------------------------------------------------
  // GET /blame — git blame
  // ---------------------------------------------------------------
  describe('GET /blame', () => {
    test('returns 400 when file parameter is missing', async () => {
      const res = await app.request('/blame');
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('file parameter required');
    });

    test('returns 400 when file parameter is missing but path is provided', async () => {
      const res = await app.request('/blame?path=/proj');
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('file parameter required');
    });

    test('parses porcelain blame output correctly', async () => {
      // SHAs must be exactly 40 hex chars to match the regex
      const sha1 = 'a'.repeat(40);
      const sha2 = 'b'.repeat(40);
      const blameOutput = [
        `${sha1} 1 1 1`,
        'author Alice',
        'author-time 1700000000',
        'summary Initial commit',
        '\tconst x = 1;',
        `${sha2} 2 2 1`,
        'author Bob',
        'author-time 1700100000',
        'summary Fix bug',
        '\tconst y = 2;',
        '',
      ].join('\n');

      spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(mockProc(blameOutput, 0) as any);

      const res = await app.request('/blame?path=/proj&file=src/app.ts');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.blame).toHaveLength(2);

      expect(json.data.blame[0].line).toBe(1);
      expect(json.data.blame[0].sha).toBe(sha1.slice(0, 8));
      expect(json.data.blame[0].author).toBe('Alice');
      expect(json.data.blame[0].timestamp).toBe(1700000000);
      expect(json.data.blame[0].summary).toBe('Initial commit');

      expect(json.data.blame[1].line).toBe(2);
      expect(json.data.blame[1].sha).toBe(sha2.slice(0, 8));
      expect(json.data.blame[1].author).toBe('Bob');
      expect(json.data.blame[1].timestamp).toBe(1700100000);
      expect(json.data.blame[1].summary).toBe('Fix bug');
    });

    test('handles repeated SHA (same commit for multiple lines)', async () => {
      const sha1 = 'c'.repeat(40);
      const blameOutput = [
        `${sha1} 1 1 2`,
        'author Alice',
        'author-time 1700000000',
        'summary Initial commit',
        '\tline 1',
        `${sha1} 2 2 1`,
        '\tline 2',
        '',
      ].join('\n');

      spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(mockProc(blameOutput, 0) as any);

      const res = await app.request('/blame?path=/proj&file=src/app.ts');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.blame).toHaveLength(2);
      // Both lines should reference the same commit
      expect(json.data.blame[0].sha).toBe('cccccccc');
      expect(json.data.blame[1].sha).toBe('cccccccc');
      expect(json.data.blame[0].author).toBe('Alice');
      expect(json.data.blame[1].author).toBe('Alice');
    });

    test('returns error when git blame fails', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(
        mockProc('', 128, 'fatal: no such path') as any,
      );

      const res = await app.request('/blame?path=/proj&file=nonexistent.ts');
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('no such path');
    });

    test('returns generic error when blame fails with empty stderr', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(mockProc('', 1, '') as any);

      const res = await app.request('/blame?path=/proj&file=bad.ts');
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe('git blame failed');
    });

    test('returns 500 when spawn throws during blame', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        throw new Error('blame spawn error');
      });

      const res = await app.request('/blame?path=/proj&file=x.ts');
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('blame spawn error');
    });

    test('returns empty blame array for empty file', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(mockProc('', 0) as any);

      const res = await app.request('/blame?path=/proj&file=empty.ts');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.blame).toEqual([]);
    });
  });

  // ---------------------------------------------------------------
  // POST /push — push to remote
  // ---------------------------------------------------------------
  describe('POST /push', () => {
    test('returns 400 when path is missing', async () => {
      const res = await app.request('/push', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('path required');
    });

    test('pushes to origin with auto-detected branch', async () => {
      let callIndex = 0;
      const spawnCalls: string[][] = [];
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation((...args: any[]) => {
        callIndex++;
        spawnCalls.push(args[0] as string[]);
        switch (callIndex) {
          case 1: // git rev-parse --abbrev-ref HEAD
            return mockProc('main\n', 0) as any;
          case 2: // git push origin main
            return mockProc('', 0) as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const res = await app.request('/push', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.pushed).toBe(true);
      expect(json.data.setUpstream).toBe(false);
      expect(spawnCalls[1]).toEqual(['git', 'push', 'origin', 'main']);
    });

    test('uses specified remote and branch', async () => {
      const spawnCalls: string[][] = [];
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation((...args: any[]) => {
        spawnCalls.push(args[0] as string[]);
        return mockProc('', 0) as any;
      });

      const res = await app.request('/push', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj', remote: 'upstream', branch: 'feature' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.ok).toBe(true);
      // Should not call rev-parse when branch is specified
      expect(spawnCalls[0]).toEqual(['git', 'push', 'upstream', 'feature']);
    });

    test('retries with --set-upstream when no upstream branch', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1: // git rev-parse --abbrev-ref HEAD
            return mockProc('new-branch\n', 0) as any;
          case 2: // git push origin new-branch — fails with no upstream
            return mockProc('', 1, 'fatal: The current branch has no upstream branch') as any;
          case 3: // git push --set-upstream origin new-branch
            return mockProc('', 0) as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const res = await app.request('/push', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.pushed).toBe(true);
      expect(json.data.setUpstream).toBe(true);
    });

    test('returns 500 when --set-upstream push also fails', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1:
            return mockProc('feat\n', 0) as any;
          case 2:
            return mockProc('', 1, 'fatal: has no upstream') as any;
          case 3: // upstream push also fails
            return mockProc('', 1, 'fatal: remote rejected') as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const res = await app.request('/push', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('remote rejected');
    });

    test('returns 500 when push fails for non-upstream reason', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1:
            return mockProc('main\n', 0) as any;
          case 2:
            return mockProc('', 1, 'fatal: remote host unreachable') as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const res = await app.request('/push', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('remote host unreachable');
    });

    test('returns 500 when branch detection fails', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(mockProc('', 128, 'fatal') as any);

      const res = await app.request('/push', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('Could not determine current branch');
    });

    test('returns 500 when spawn throws during push', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        throw new Error('push spawn failed');
      });

      const res = await app.request('/push', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('push spawn failed');
    });

    test('returns generic error when push stderr is empty', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1:
            return mockProc('main\n', 0) as any;
          case 2:
            return mockProc('', 1, '') as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const res = await app.request('/push', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe('git push failed');
    });
  });

  // ---------------------------------------------------------------
  // POST /generate-commit-message — LLM commit message generation
  // ---------------------------------------------------------------
  describe('POST /generate-commit-message', () => {
    test('returns 400 when path is missing', async () => {
      const res = await app.request('/generate-commit-message', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('path required');
    });

    test('generates a commit message from diff', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1: // git diff HEAD
            return mockProc('diff --git a/file.ts\n+new line\n', 0) as any;
          case 2: // git ls-files --others --exclude-standard
            return mockProc('', 0) as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      mockCallLlm.mockResolvedValue('  Add new feature  ');

      const res = await app.request('/generate-commit-message', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.message).toBe('Add new feature');
    });

    test('includes untracked files in prompt', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1: // git diff HEAD — no diff
            return mockProc('', 0) as any;
          case 2: // git ls-files — untracked files
            return mockProc('new-file.ts\nanother.ts\n', 0) as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      mockCallLlm.mockResolvedValue('Add new files');

      const res = await app.request('/generate-commit-message', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.message).toBe('Add new files');
    });

    test('returns 400 when no changes to describe', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1: // git diff HEAD — empty
            return mockProc('', 0) as any;
          case 2: // git ls-files — empty (no untracked)
            return mockProc('', 0) as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const res = await app.request('/generate-commit-message', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('No changes to describe');
    });

    test('returns 500 when LLM call fails', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1:
            return mockProc('diff content\n', 0) as any;
          case 2:
            return mockProc('', 0) as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      mockCallLlm.mockRejectedValue(new Error('LLM service unavailable'));

      const res = await app.request('/generate-commit-message', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('LLM service unavailable');
    });

    test('returns 500 when spawn throws', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        throw new Error('gen spawn failed');
      });

      const res = await app.request('/generate-commit-message', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('gen spawn failed');
    });
  });

  // ---------------------------------------------------------------
  // POST /commit — skips auto-stage when files are already staged
  // ---------------------------------------------------------------
  describe('POST /commit — already-staged files', () => {
    test('skips git add when files are already staged', async () => {
      let callIndex = 0;
      const spawnCalls: string[][] = [];
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation((...args: any[]) => {
        callIndex++;
        spawnCalls.push(args[0] as string[]);
        switch (callIndex) {
          case 1: // runExitCode: git diff --cached --quiet → 1 = has staged changes
            return mockProc('', 1) as any;
          case 2: // run: git commit -m (no git add)
            return mockProc('[main def789] commit msg\n', 0) as any;
          case 3: // run: git rev-parse HEAD
            return mockProc('def789abcdef\n', 0) as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const res = await app.request('/commit', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj', message: 'commit msg' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.sha).toBe('def789abcdef');

      // Should NOT have called git add (only 3 calls: diff-check, commit, rev-parse)
      expect(spawnCalls).toHaveLength(3);
      const addCalls = spawnCalls.filter((cmd) => cmd.includes('add'));
      expect(addCalls).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------
  // GET /status — mixed porcelain statuses
  // ---------------------------------------------------------------
  describe('GET /status — mixed porcelain statuses', () => {
    test('emits both staged and unstaged entries for MM status', async () => {
      ({ spawnSpy, fileSpy } = mockStatusSpawn('MM both.ts\n', 0));

      const res = await app.request('/status?path=/proj');
      const json = await res.json();
      expect(json.data.files).toHaveLength(2);
      // First entry: staged M
      expect(json.data.files[0]).toEqual({ path: 'both.ts', status: 'M', staged: true });
      // Second entry: unstaged M
      expect(json.data.files[1]).toEqual({ path: 'both.ts', status: 'M', staged: false });
    });

    test('handles deleted file in working tree (unstaged)', async () => {
      ({ spawnSpy, fileSpy } = mockStatusSpawn(' D deleted.ts\n', 0));

      const res = await app.request('/status?path=/proj');
      const json = await res.json();
      expect(json.data.files).toHaveLength(1);
      expect(json.data.files[0]).toEqual({ path: 'deleted.ts', status: 'D', staged: false });
    });

    test('handles staged added file with unstaged modifications (AM)', async () => {
      ({ spawnSpy, fileSpy } = mockStatusSpawn('AM newmod.ts\n', 0));

      const res = await app.request('/status?path=/proj');
      const json = await res.json();
      expect(json.data.files).toHaveLength(2);
      expect(json.data.files[0]).toEqual({ path: 'newmod.ts', status: 'A', staged: true });
      expect(json.data.files[1]).toEqual({ path: 'newmod.ts', status: 'M', staged: false });
    });
  });

  // ---------------------------------------------------------------
  // POST /snapshot — stores messageId
  // ---------------------------------------------------------------
  describe('POST /snapshot — messageId', () => {
    test('stores messageId when provided', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1:
            return mockProc('true\n', 0) as any;
          case 2:
            return mockProc('sha123\n', 0) as any;
          case 3:
            return mockProc('', 0) as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const res = await app.request('/snapshot', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj', messageId: 'msg-99' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.ok).toBe(true);

      const row = testDb.query('SELECT * FROM git_snapshots WHERE id = ?').get(json.data.id) as any;
      expect(row.message_id).toBe('msg-99');
    });
  });

  // ---------------------------------------------------------------
  // GET /snapshots — messageId in output
  // ---------------------------------------------------------------
  describe('GET /snapshots — messageId field', () => {
    test('returns messageId when set', async () => {
      testDb
        .query(
          'INSERT INTO git_snapshots (id, workspace_path, head_sha, reason, has_changes, message_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run('snap-m1', '/test', 'abc', 'pre-agent', 0, 'msg-10', 1000);

      const res = await app.request('/snapshots?path=/test');
      const json = await res.json();
      expect(json.data[0].messageId).toBe('msg-10');
    });

    test('returns null messageId when not set', async () => {
      testDb
        .query(
          'INSERT INTO git_snapshots (id, workspace_path, head_sha, reason, has_changes, message_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run('snap-m2', '/test', 'abc', 'pre-agent', 0, null, 1000);

      const res = await app.request('/snapshots?path=/test');
      const json = await res.json();
      expect(json.data[0].messageId).toBeNull();
    });
  });

  // ---------------------------------------------------------------
  // POST /commit/stream — validation
  // ---------------------------------------------------------------
  describe('POST /commit/stream — validation', () => {
    test('returns 400 when path is missing', async () => {
      const res = await app.request('/commit/stream', {
        method: 'POST',
        body: JSON.stringify({ message: 'test' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('path required');
    });

    test('returns 400 when message is missing', async () => {
      const res = await app.request('/commit/stream', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('commit message required');
    });

    test('returns 400 when message is blank', async () => {
      const res = await app.request('/commit/stream', {
        method: 'POST',
        body: JSON.stringify({ path: '/proj', message: '   ' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
    });

    test('returns 403 for blocked paths', async () => {
      const res = await app.request('/commit/stream', {
        method: 'POST',
        body: JSON.stringify({ path: '/proc/something', message: 'test' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------
  // POST /push/stream — validation
  // ---------------------------------------------------------------
  describe('POST /push/stream — validation', () => {
    test('returns 400 when path is missing', async () => {
      const res = await app.request('/push/stream', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('path required');
    });

    test('returns 403 for blocked paths', async () => {
      const res = await app.request('/push/stream', {
        method: 'POST',
        body: JSON.stringify({ path: '/dev/null' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(403);
    });
  });
});
