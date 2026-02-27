import { describe, test, expect, beforeEach, afterEach, spyOn, mock } from 'bun:test';
import { createTestDb } from '../../test-helpers';

const testDb = createTestDb();
mock.module('../../db/database', () => ({
  getDb: () => testDb,
  initDatabase: () => {},
}));

// Mock the LLM service (used by generate-commit-message)
mock.module('../../services/llm-oneshot', () => ({
  callLlm: async () => 'Auto-generated commit message',
}));

import { gitRoutes as app } from '../git/index';

// ---------------------------------------------------------------------------
// Helpers
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
 * Parse SSE events from a streaming response body.
 * Returns parsed JSON objects from each `data: {...}` line.
 */
async function parseSSEResponse(res: Response): Promise<any[]> {
  const text = await res.text();
  const events: any[] = [];
  for (const block of text.split('\n\n')) {
    for (const line of block.split('\n')) {
      if (line.startsWith('data:')) {
        const data = line.slice(5).trim();
        try {
          events.push(JSON.parse(data));
        } catch {
          // Skip malformed JSON
        }
      }
    }
  }
  return events;
}

function jsonPost(path: string, body: object) {
  return app.request(path, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /commit/stream — Streaming Commit', () => {
  let spawnSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    if (spawnSpy) spawnSpy.mockRestore();
  });

  // ─── Validation ────────────────────────────────────────────────────

  describe('validation', () => {
    test('returns 400 JSON (not SSE) when path is missing', async () => {
      const res = await jsonPost('/commit/stream', { message: 'test' });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('path required');
    });

    test('returns 400 when message is missing', async () => {
      const res = await jsonPost('/commit/stream', { path: '/proj' });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('commit message required');
    });

    test('returns 400 when message is empty string', async () => {
      const res = await jsonPost('/commit/stream', { path: '/proj', message: '' });
      expect(res.status).toBe(400);
    });

    test('returns 400 when message is whitespace-only', async () => {
      const res = await jsonPost('/commit/stream', { path: '/proj', message: '   \n\t  ' });
      expect(res.status).toBe(400);
    });

    test('returns 400 when message is not a string', async () => {
      const res = await jsonPost('/commit/stream', { path: '/proj', message: 123 });
      expect(res.status).toBe(400);
    });

    test('returns 400 when message is null', async () => {
      const res = await jsonPost('/commit/stream', { path: '/proj', message: null });
      expect(res.status).toBe(400);
    });

    test('returns 403 for blocked /proc path', async () => {
      const res = await jsonPost('/commit/stream', { path: '/proc/self', message: 'test' });
      expect(res.status).toBe(403);
    });

    test('returns 403 for blocked /sys path', async () => {
      const res = await jsonPost('/commit/stream', { path: '/sys/kernel', message: 'test' });
      expect(res.status).toBe(403);
    });

    test('returns 403 for blocked /dev path', async () => {
      const res = await jsonPost('/commit/stream', { path: '/dev/null', message: 'test' });
      expect(res.status).toBe(403);
    });

    test('returns 403 for blocked /boot path', async () => {
      const res = await jsonPost('/commit/stream', { path: '/boot/vmlinuz', message: 'test' });
      expect(res.status).toBe(403);
    });

    test('returns 403 for blocked /sbin path', async () => {
      const res = await jsonPost('/commit/stream', { path: '/sbin/init', message: 'test' });
      expect(res.status).toBe(403);
    });
  });

  // ─── Successful commit with auto-staging ────────────────────────────

  describe('successful commit — nothing staged (auto-stage)', () => {
    test('emits diagnostic, status, output, diagnostic, and complete events', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1: // git status --porcelain (before)
            return mockProc(' M src/app.ts\n?? newfile.ts\n', 0) as any;
          case 2: // git diff --cached --quiet (check staging) → exit 0 = nothing staged
            return mockProc('', 0) as any;
          case 3: // git add -A (auto-stage)
            return mockProc('', 0) as any;
          case 4: // git commit -m (the actual commit) — stdout piped
            return mockProc('[main abc1234] test commit\n 2 files changed\n', 0) as any;
          case 5: // git status --porcelain (after commit)
            return mockProc('', 0) as any;
          case 6: // git rev-parse HEAD
            return mockProc('abc1234567890abcdef\n', 0) as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const res = await jsonPost('/commit/stream', { path: '/proj', message: 'test commit' });
      expect(res.status).toBe(200);

      const events = await parseSSEResponse(res);

      // Should have at minimum: before-staging diagnostic, status (auto-staging), commit output, after-commit diagnostic, complete
      const diagnostics = events.filter((e) => e.type === 'diagnostic');
      const statuses = events.filter((e) => e.type === 'status');
      const complete = events.find((e) => e.type === 'complete');
      const errors = events.filter((e) => e.type === 'error');

      expect(errors).toHaveLength(0);
      expect(diagnostics.length).toBeGreaterThanOrEqual(1);
      expect(statuses.length).toBeGreaterThanOrEqual(1);
      expect(complete).toBeDefined();
      expect(complete.sha).toBe('abc1234567890abcdef');
      expect(complete.message).toBe('Commit successful!');

      // Before-staging diagnostic should include file count
      const beforeStaging = diagnostics.find((d) => d.phase === 'before-staging');
      expect(beforeStaging).toBeDefined();
      expect(beforeStaging.fileCount).toBe(2);
      expect(beforeStaging.porcelain).toContain('src/app.ts');

      // Status should mention auto-staging
      const autoStageMsg = statuses.find((s) => s.message?.includes('auto-staging'));
      expect(autoStageMsg).toBeDefined();
    });

    test('emits after-commit diagnostic showing clean tree', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1:
            return mockProc(' M file.ts\n', 0) as any;
          case 2:
            return mockProc('', 0) as any; // nothing staged
          case 3:
            return mockProc('', 0) as any; // git add -A
          case 4:
            return mockProc('[main abc] done\n', 0) as any; // commit
          case 5:
            return mockProc('', 0) as any; // status after (clean)
          case 6:
            return mockProc('deadbeef\n', 0) as any; // rev-parse
          default:
            return mockProc('', 0) as any;
        }
      });

      const res = await jsonPost('/commit/stream', { path: '/proj', message: 'fix' });
      const events = await parseSSEResponse(res);

      const afterCommit = events.find((e) => e.type === 'diagnostic' && e.phase === 'after-commit');
      expect(afterCommit).toBeDefined();
      expect(afterCommit.message).toContain('clean');
      expect(afterCommit.fileCount).toBe(0);
    });
  });

  // ─── Successful commit with pre-staged files ────────────────────────

  describe('successful commit — files already staged', () => {
    test('skips auto-staging when files are already staged', async () => {
      let callIndex = 0;
      const spawnCalls: string[][] = [];
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation((...args: any[]) => {
        callIndex++;
        spawnCalls.push(args[0] as string[]);
        switch (callIndex) {
          case 1: // git status --porcelain
            return mockProc('M  staged.ts\n', 0) as any;
          case 2: // git diff --cached --quiet → exit 1 = HAS staged changes
            return mockProc('', 1) as any;
          case 3: // git commit -m (no git add needed)
            return mockProc('[main abc] commit\n', 0) as any;
          case 4: // git status --porcelain (after)
            return mockProc('', 0) as any;
          case 5: // git rev-parse HEAD
            return mockProc('sha123456\n', 0) as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const res = await jsonPost('/commit/stream', { path: '/proj', message: 'staged commit' });
      const events = await parseSSEResponse(res);

      const complete = events.find((e) => e.type === 'complete');
      expect(complete).toBeDefined();
      expect(complete.sha).toBe('sha123456');

      // Verify NO git add was called
      const addCalls = spawnCalls.filter((cmd) => cmd.includes('git') && cmd.includes('add'));
      expect(addCalls).toHaveLength(0);

      // Should not have the "auto-staging" status message
      const autoStageMsg = events.find(
        (e) => e.type === 'status' && e.message?.includes('auto-staging'),
      );
      expect(autoStageMsg).toBeUndefined();
    });
  });

  // ─── git add -A failure ─────────────────────────────────────────────

  describe('git add failure', () => {
    test('emits error event when git add -A fails', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1:
            return mockProc(' M file.ts\n', 0) as any; // status before
          case 2:
            return mockProc('', 0) as any; // diff --cached → nothing staged
          case 3: // git add -A FAILS
            return mockProc('', 128, 'fatal: Unable to create index.lock') as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const res = await jsonPost('/commit/stream', { path: '/proj', message: 'test' });
      const events = await parseSSEResponse(res);

      const errorEvent = events.find((e) => e.type === 'error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent.message).toContain('git add failed');
      expect(errorEvent.message).toContain('index.lock');

      // No complete event should be emitted
      const complete = events.find((e) => e.type === 'complete');
      expect(complete).toBeUndefined();
    });
  });

  // ─── git commit failure (pre-commit hooks, etc.) ────────────────────

  describe('git commit failure', () => {
    test('emits error when commit exits non-zero (pre-commit hook)', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1:
            return mockProc(' M file.ts\n', 0) as any;
          case 2:
            return mockProc('', 0) as any; // nothing staged
          case 3:
            return mockProc('', 0) as any; // git add -A
          case 4: // git commit fails with pre-commit hook
            return mockProc('', 1, 'husky - pre-commit hook failed\n3 fail\n5 pass\n') as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const res = await jsonPost('/commit/stream', { path: '/proj', message: 'test' });
      const events = await parseSSEResponse(res);

      const errorEvent = events.find((e) => e.type === 'error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent.message).toContain('Pre-commit hook failed');
      expect(errorEvent.message).toContain('3 test(s) failed');

      // Should have detail with raw output
      expect(errorEvent.detail).toBeDefined();

      const complete = events.find((e) => e.type === 'complete');
      expect(complete).toBeUndefined();
    });

    test('emits error when commit returns "nothing to commit"', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1:
            return mockProc('', 0) as any; // status (clean)
          case 2:
            return mockProc('', 0) as any; // diff --cached
          case 3:
            return mockProc('', 0) as any; // git add
          case 4: // commit fails
            return mockProc('nothing to commit, working tree clean\n', 1, '') as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const res = await jsonPost('/commit/stream', { path: '/proj', message: 'test' });
      const events = await parseSSEResponse(res);

      const errorEvent = events.find((e) => e.type === 'error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent.message).toContain('Nothing to commit');
    });

    test('emits error with type error details from pre-commit hook', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1:
            return mockProc(' M file.ts\n', 0) as any;
          case 2:
            return mockProc('', 0) as any;
          case 3:
            return mockProc('', 0) as any;
          case 4:
            return mockProc('', 1, 'husky - pre-commit hook\nfound 5 errors in 3 files\n') as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const res = await jsonPost('/commit/stream', { path: '/proj', message: 'test' });
      const events = await parseSSEResponse(res);

      const errorEvent = events.find((e) => e.type === 'error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent.message).toContain('5 type error');
    });

    test('emits error with lint-staged details from pre-commit hook', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1:
            return mockProc(' M file.ts\n', 0) as any;
          case 2:
            return mockProc('', 0) as any;
          case 3:
            return mockProc('', 0) as any;
          case 4:
            return mockProc('', 1, 'husky - pre-commit hook\nlint-staged failed\n') as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const res = await jsonPost('/commit/stream', { path: '/proj', message: 'test' });
      const events = await parseSSEResponse(res);

      const errorEvent = events.find((e) => e.type === 'error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent.message).toContain('lint-staged');
    });

    test('emits error with script exit code details', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1:
            return mockProc(' M file.ts\n', 0) as any;
          case 2:
            return mockProc('', 0) as any;
          case 3:
            return mockProc('', 0) as any;
          case 4:
            return mockProc('script "test" exited with code 1\n', 1, 'Exited with code 1\n') as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const res = await jsonPost('/commit/stream', { path: '/proj', message: 'test' });
      const events = await parseSSEResponse(res);

      const errorEvent = events.find((e) => e.type === 'error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent.message).toContain('exit');
    });

    test('emits error for empty commit message rejection from git', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1:
            return mockProc(' M file.ts\n', 0) as any;
          case 2:
            return mockProc('', 0) as any;
          case 3:
            return mockProc('', 0) as any;
          case 4:
            return mockProc('', 1, 'Aborting commit due to empty commit message.\n') as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const res = await jsonPost('/commit/stream', { path: '/proj', message: 'test' });
      const events = await parseSSEResponse(res);

      const errorEvent = events.find((e) => e.type === 'error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent.message).toContain('empty commit message');
    });

    test('emits error with unknown failure (fallback message)', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1:
            return mockProc(' M file.ts\n', 0) as any;
          case 2:
            return mockProc('', 0) as any;
          case 3:
            return mockProc('', 0) as any;
          case 4:
            return mockProc('', 1, 'some unknown error\n') as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const res = await jsonPost('/commit/stream', { path: '/proj', message: 'test' });
      const events = await parseSSEResponse(res);

      const errorEvent = events.find((e) => e.type === 'error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent.message).toContain('git commit failed');
    });

    test('truncates very long error detail to 500 characters', async () => {
      let callIndex = 0;
      const longError = 'x'.repeat(1000);
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1:
            return mockProc(' M file.ts\n', 0) as any;
          case 2:
            return mockProc('', 0) as any;
          case 3:
            return mockProc('', 0) as any;
          case 4:
            return mockProc('', 1, longError) as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const res = await jsonPost('/commit/stream', { path: '/proj', message: 'test' });
      const events = await parseSSEResponse(res);

      const errorEvent = events.find((e) => e.type === 'error');
      expect(errorEvent).toBeDefined();
      // Detail should be truncated to last 500 chars
      expect(errorEvent.detail.length).toBeLessThanOrEqual(500);
    });
  });

  // ─── After-commit warnings ─────────────────────────────────────────

  describe('post-commit diagnostics', () => {
    test('warns when working tree still dirty after commit', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1:
            return mockProc(' M a.ts\n?? b.ts\n', 0) as any;
          case 2:
            return mockProc('', 0) as any; // nothing staged
          case 3:
            return mockProc('', 0) as any; // git add
          case 4:
            return mockProc('[main abc] done\n', 0) as any; // commit ok
          case 5: // status after commit — still dirty!
            return mockProc('?? untracked-big-file.bin\n', 0) as any;
          case 6:
            return mockProc('sha999\n', 0) as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const res = await jsonPost('/commit/stream', { path: '/proj', message: 'test' });
      const events = await parseSSEResponse(res);

      const afterCommit = events.find((e) => e.type === 'diagnostic' && e.phase === 'after-commit');
      expect(afterCommit).toBeDefined();
      expect(afterCommit.message).toContain('WARNING');
      expect(afterCommit.message).toContain('still has changes');
      expect(afterCommit.fileCount).toBe(1);

      // But commit should still be reported as successful
      const complete = events.find((e) => e.type === 'complete');
      expect(complete).toBeDefined();
    });
  });

  // ─── Unexpected errors ──────────────────────────────────────────────

  describe('unexpected errors', () => {
    test('emits error event when Bun.spawn throws', async () => {
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        throw new Error('spawn failed: ENOMEM');
      });

      const res = await jsonPost('/commit/stream', { path: '/proj', message: 'test' });
      const events = await parseSSEResponse(res);

      const errorEvent = events.find((e) => e.type === 'error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent.message).toContain('ENOMEM');
    });

    test('emits error event when git status before commit throws', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        if (callIndex === 1) {
          throw new Error('permission denied');
        }
        return mockProc('', 0) as any;
      });

      const res = await jsonPost('/commit/stream', { path: '/proj', message: 'test' });
      const events = await parseSSEResponse(res);

      const errorEvent = events.find((e) => e.type === 'error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent.message).toContain('permission denied');
    });
  });

  // ─── Message trimming ──────────────────────────────────────────────

  describe('commit message handling', () => {
    test('trims whitespace from commit message', async () => {
      let capturedCommitCmd: string[] = [];
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation((...args: any[]) => {
        callIndex++;
        const cmd = args[0] as string[];
        if (cmd.includes('commit') && cmd.includes('-m')) {
          capturedCommitCmd = cmd;
        }
        switch (callIndex) {
          case 1:
            return mockProc(' M file.ts\n', 0) as any;
          case 2:
            return mockProc('', 0) as any;
          case 3:
            return mockProc('', 0) as any;
          case 4:
            return mockProc('[main abc] done\n', 0) as any;
          case 5:
            return mockProc('', 0) as any;
          case 6:
            return mockProc('sha\n', 0) as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const res = await jsonPost('/commit/stream', {
        path: '/proj',
        message: '  trimmed message  ',
      });
      await res.text(); // Consume the SSE stream to trigger all spawn calls

      const msgIndex = capturedCommitCmd.indexOf('-m');
      expect(msgIndex).toBeGreaterThan(-1);
      expect(capturedCommitCmd[msgIndex + 1]).toBe('trimmed message');
    });
  });

  // ─── Event ordering ─────────────────────────────────────────────────

  describe('event ordering', () => {
    test('events arrive in correct order: diagnostic → status → output → diagnostic → complete', async () => {
      let callIndex = 0;
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
        callIndex++;
        switch (callIndex) {
          case 1:
            return mockProc(' M file.ts\n', 0) as any;
          case 2:
            return mockProc('', 0) as any;
          case 3:
            return mockProc('', 0) as any;
          case 4:
            return mockProc('[main abc] commit msg\n', 0) as any;
          case 5:
            return mockProc('', 0) as any;
          case 6:
            return mockProc('sha123\n', 0) as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const res = await jsonPost('/commit/stream', { path: '/proj', message: 'test' });
      const events = await parseSSEResponse(res);

      // First event should be before-staging diagnostic
      expect(events[0].type).toBe('diagnostic');
      expect(events[0].phase).toBe('before-staging');

      // Last event should be complete
      expect(events[events.length - 1].type).toBe('complete');

      // Before the last event should be after-commit diagnostic
      const lastDiag = [...events].reverse().find((e) => e.type === 'diagnostic');
      expect(lastDiag?.phase).toBe('after-commit');
    });
  });

  // ─── Spawn call verification ────────────────────────────────────────

  describe('spawn call verification', () => {
    test('calls correct git commands in order when auto-staging', async () => {
      let callIndex = 0;
      const spawnCalls: string[][] = [];
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation((...args: any[]) => {
        callIndex++;
        spawnCalls.push(args[0] as string[]);
        switch (callIndex) {
          case 1:
            return mockProc(' M file.ts\n', 0) as any;
          case 2:
            return mockProc('', 0) as any;
          case 3:
            return mockProc('', 0) as any;
          case 4:
            return mockProc('[main abc] test\n', 0) as any;
          case 5:
            return mockProc('', 0) as any;
          case 6:
            return mockProc('sha\n', 0) as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const res = await jsonPost('/commit/stream', { path: '/proj', message: 'test' });
      await res.text(); // Consume the SSE stream to trigger all spawn calls

      // Verify command sequence
      expect(spawnCalls[0]).toEqual(expect.arrayContaining(['git', 'status', '--porcelain']));
      expect(spawnCalls[1]).toEqual(expect.arrayContaining(['git', 'diff', '--cached', '--quiet']));
      expect(spawnCalls[2]).toEqual(expect.arrayContaining(['git', 'add', '-A']));
      expect(spawnCalls[3]).toEqual(expect.arrayContaining(['git', 'commit', '-m', 'test']));
      expect(spawnCalls[4]).toEqual(expect.arrayContaining(['git', 'status', '--porcelain']));
      expect(spawnCalls[5]).toEqual(expect.arrayContaining(['git', 'rev-parse', 'HEAD']));
    });

    test('calls correct git commands when files already staged (no auto-stage)', async () => {
      let callIndex = 0;
      const spawnCalls: string[][] = [];
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation((...args: any[]) => {
        callIndex++;
        spawnCalls.push(args[0] as string[]);
        switch (callIndex) {
          case 1:
            return mockProc('M  staged.ts\n', 0) as any;
          case 2:
            return mockProc('', 1) as any; // exit 1 = has staged
          case 3:
            return mockProc('[main abc] test\n', 0) as any;
          case 4:
            return mockProc('', 0) as any;
          case 5:
            return mockProc('sha\n', 0) as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const res = await jsonPost('/commit/stream', { path: '/proj', message: 'test' });
      await res.text(); // Consume the SSE stream to trigger all spawn calls

      // Should be 5 calls (no git add)
      expect(spawnCalls).toHaveLength(5);
      expect(spawnCalls[0]).toEqual(expect.arrayContaining(['git', 'status', '--porcelain']));
      expect(spawnCalls[1]).toEqual(expect.arrayContaining(['git', 'diff', '--cached', '--quiet']));
      expect(spawnCalls[2]).toEqual(expect.arrayContaining(['git', 'commit', '-m', 'test']));
      expect(spawnCalls[3]).toEqual(expect.arrayContaining(['git', 'status', '--porcelain']));
      expect(spawnCalls[4]).toEqual(expect.arrayContaining(['git', 'rev-parse', 'HEAD']));
    });

    test('uses resolved cwd for all spawn calls', async () => {
      let callIndex = 0;
      const spawnOpts: any[] = [];
      spawnSpy = spyOn(Bun, 'spawn').mockImplementation((...args: any[]) => {
        callIndex++;
        spawnOpts.push(args[1]);
        switch (callIndex) {
          case 1:
            return mockProc(' M f.ts\n', 0) as any;
          case 2:
            return mockProc('', 0) as any;
          case 3:
            return mockProc('', 0) as any;
          case 4:
            return mockProc('[main a] m\n', 0) as any;
          case 5:
            return mockProc('', 0) as any;
          case 6:
            return mockProc('s\n', 0) as any;
          default:
            return mockProc('', 0) as any;
        }
      });

      const res = await jsonPost('/commit/stream', { path: '/home/user/project', message: 'test' });
      await res.text(); // Consume the SSE stream to trigger all spawn calls

      // All spawn calls should use the resolved path as cwd
      for (const opts of spawnOpts) {
        expect(opts.cwd).toBe('/home/user/project');
      }
    });
  });
});

// ---------------------------------------------------------------------------
// POST /commit (non-streaming) — additional tests
// ---------------------------------------------------------------------------

describe('POST /commit (non-streaming) — comprehensive', () => {
  let spawnSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    if (spawnSpy) spawnSpy.mockRestore();
  });

  test('successful commit with correct mock ordering (4 spawn calls)', async () => {
    let callIndex = 0;
    const spawnCalls: string[][] = [];
    spawnSpy = spyOn(Bun, 'spawn').mockImplementation((...args: any[]) => {
      callIndex++;
      spawnCalls.push(args[0] as string[]);
      switch (callIndex) {
        case 1: // runExitCode: git diff --cached --quiet → exit 0 = nothing staged
          return mockProc('', 0) as any;
        case 2: // run: git add -A
          return mockProc('', 0) as any;
        case 3: // run: git commit -m
          return mockProc('[main abc1234] test commit\n 1 file changed\n', 0) as any;
        case 4: // run: git rev-parse HEAD
          return mockProc('abc1234567890abcdef\n', 0) as any;
        default:
          return mockProc('', 0) as any;
      }
    });

    const res = await jsonPost('/commit', { path: '/proj', message: 'test commit' });
    const json = await res.json();

    expect(json.ok).toBe(true);
    expect(json.data.sha).toBe('abc1234567890abcdef');
    expect(spawnCalls).toHaveLength(4);
    expect(spawnCalls[0]).toEqual(expect.arrayContaining(['git', 'diff', '--cached', '--quiet']));
    expect(spawnCalls[1]).toEqual(expect.arrayContaining(['git', 'add', '-A']));
    expect(spawnCalls[2]).toEqual(expect.arrayContaining(['git', 'commit', '-m', 'test commit']));
    expect(spawnCalls[3]).toEqual(expect.arrayContaining(['git', 'rev-parse', 'HEAD']));
  });

  test('skips git add when files already staged (3 spawn calls)', async () => {
    let callIndex = 0;
    const spawnCalls: string[][] = [];
    spawnSpy = spyOn(Bun, 'spawn').mockImplementation((...args: any[]) => {
      callIndex++;
      spawnCalls.push(args[0] as string[]);
      switch (callIndex) {
        case 1: // git diff --cached --quiet → exit 1 = HAS staged
          return mockProc('', 1) as any;
        case 2: // git commit -m (no add needed)
          return mockProc('[main abc] commit\n', 0) as any;
        case 3: // git rev-parse HEAD
          return mockProc('sha999\n', 0) as any;
        default:
          return mockProc('', 0) as any;
      }
    });

    const res = await jsonPost('/commit', { path: '/proj', message: 'already staged' });
    const json = await res.json();

    expect(json.ok).toBe(true);
    expect(json.data.sha).toBe('sha999');
    expect(spawnCalls).toHaveLength(3);
    // No git add call
    const addCalls = spawnCalls.filter((c) => c.includes('add'));
    expect(addCalls).toHaveLength(0);
  });

  test('returns error when git add fails with index.lock', async () => {
    let callIndex = 0;
    spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
      callIndex++;
      switch (callIndex) {
        case 1:
          return mockProc('', 0) as any; // nothing staged
        case 2: // git add fails
          return mockProc(
            '',
            128,
            'fatal: Unable to create /proj/.git/index.lock: File exists.',
          ) as any;
        default:
          return mockProc('', 0) as any;
      }
    });

    const res = await jsonPost('/commit', { path: '/proj', message: 'test' });
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toContain('git add failed');
    expect(json.error).toContain('index.lock');
  });

  test('returns error when git commit exits non-zero', async () => {
    let callIndex = 0;
    spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
      callIndex++;
      switch (callIndex) {
        case 1:
          return mockProc('', 0) as any;
        case 2:
          return mockProc('', 0) as any;
        case 3: // commit fails
          return mockProc('', 1, 'error: pathspec not found') as any;
        default:
          return mockProc('', 0) as any;
      }
    });

    const res = await jsonPost('/commit', { path: '/proj', message: 'test' });
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toContain('git commit failed');
  });

  test('returns commit stdout in error when stderr is empty', async () => {
    let callIndex = 0;
    spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
      callIndex++;
      switch (callIndex) {
        case 1:
          return mockProc('', 0) as any;
        case 2:
          return mockProc('', 0) as any;
        case 3:
          return mockProc('nothing to commit, working tree clean\n', 1, '') as any;
        default:
          return mockProc('', 0) as any;
      }
    });

    const res = await jsonPost('/commit', { path: '/proj', message: 'test' });
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain('nothing to commit');
  });
});

// ---------------------------------------------------------------------------
// POST /stage — staging files
// ---------------------------------------------------------------------------

describe('POST /stage', () => {
  let spawnSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    if (spawnSpy) spawnSpy.mockRestore();
  });

  test('returns 400 when path is missing', async () => {
    const res = await jsonPost('/stage', { files: ['a.ts'] });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toBe('path required');
  });

  test('returns 403 for blocked paths', async () => {
    const res = await jsonPost('/stage', { path: '/proc/self', files: ['a.ts'] });
    expect(res.status).toBe(403);
  });

  test('stages specific files when files array provided', async () => {
    let capturedCmd: string[] = [];
    spawnSpy = spyOn(Bun, 'spawn').mockImplementation((...args: any[]) => {
      capturedCmd = args[0] as string[];
      return mockProc('', 0) as any;
    });

    const res = await jsonPost('/stage', { path: '/proj', files: ['src/a.ts', 'src/b.ts'] });
    const json = await res.json();

    expect(json.ok).toBe(true);
    expect(capturedCmd).toEqual(['git', 'add', '--', 'src/a.ts', 'src/b.ts']);
  });

  test('stages all files when no files array provided', async () => {
    let capturedCmd: string[] = [];
    spawnSpy = spyOn(Bun, 'spawn').mockImplementation((...args: any[]) => {
      capturedCmd = args[0] as string[];
      return mockProc('', 0) as any;
    });

    const res = await jsonPost('/stage', { path: '/proj' });
    const json = await res.json();

    expect(json.ok).toBe(true);
    expect(capturedCmd).toEqual(['git', 'add', '-A']);
  });

  test('stages all when files is empty array', async () => {
    let capturedCmd: string[] = [];
    spawnSpy = spyOn(Bun, 'spawn').mockImplementation((...args: any[]) => {
      capturedCmd = args[0] as string[];
      return mockProc('', 0) as any;
    });

    const res = await jsonPost('/stage', { path: '/proj', files: [] });
    const json = await res.json();

    expect(json.ok).toBe(true);
    expect(capturedCmd).toEqual(['git', 'add', '-A']);
  });

  test('returns error when git add fails', async () => {
    spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(
      mockProc('', 128, 'fatal: pathspec error') as any,
    );

    const res = await jsonPost('/stage', { path: '/proj', files: ['bad.ts'] });
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toContain('git add failed');
  });

  test('returns 500 when spawn throws', async () => {
    spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
      throw new Error('spawn ENOENT');
    });

    const res = await jsonPost('/stage', { path: '/proj', files: ['a.ts'] });
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// POST /unstage — unstaging files
// ---------------------------------------------------------------------------

describe('POST /unstage', () => {
  let spawnSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    if (spawnSpy) spawnSpy.mockRestore();
  });

  test('returns 400 when path is missing', async () => {
    const res = await jsonPost('/unstage', { files: ['a.ts'] });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toBe('path required');
  });

  test('returns 403 for blocked paths', async () => {
    const res = await jsonPost('/unstage', { path: '/sys/kernel', files: ['a.ts'] });
    expect(res.status).toBe(403);
  });

  test('unstages specific files when files array provided', async () => {
    let capturedCmd: string[] = [];
    spawnSpy = spyOn(Bun, 'spawn').mockImplementation((...args: any[]) => {
      capturedCmd = args[0] as string[];
      return mockProc('', 0) as any;
    });

    const res = await jsonPost('/unstage', { path: '/proj', files: ['src/a.ts'] });
    const json = await res.json();

    expect(json.ok).toBe(true);
    expect(capturedCmd).toEqual(['git', 'reset', 'HEAD', '--', 'src/a.ts']);
  });

  test('unstages all files when no files provided', async () => {
    let capturedCmd: string[] = [];
    spawnSpy = spyOn(Bun, 'spawn').mockImplementation((...args: any[]) => {
      capturedCmd = args[0] as string[];
      return mockProc('', 0) as any;
    });

    const res = await jsonPost('/unstage', { path: '/proj' });
    const json = await res.json();

    expect(json.ok).toBe(true);
    expect(capturedCmd).toEqual(['git', 'reset', 'HEAD']);
  });

  test('returns error when git reset fails', async () => {
    spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(
      mockProc('', 128, 'fatal: Failed to resolve HEAD') as any,
    );

    const res = await jsonPost('/unstage', { path: '/proj', files: ['bad.ts'] });
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toContain('git reset failed');
  });
});

// ---------------------------------------------------------------------------
// POST /push — pushing to remote
// ---------------------------------------------------------------------------

describe('POST /push', () => {
  let spawnSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    if (spawnSpy) spawnSpy.mockRestore();
  });

  test('returns 400 when path is missing', async () => {
    const res = await jsonPost('/push', {});
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toBe('path required');
  });

  test('returns 403 for blocked paths', async () => {
    const res = await jsonPost('/push', { path: '/proc/self' });
    expect(res.status).toBe(403);
  });

  test('pushes to origin with detected branch', async () => {
    let callIndex = 0;
    const spawnCalls: string[][] = [];
    spawnSpy = spyOn(Bun, 'spawn').mockImplementation((...args: any[]) => {
      callIndex++;
      spawnCalls.push(args[0] as string[]);
      switch (callIndex) {
        case 1: // git rev-parse --abbrev-ref HEAD
          return mockProc('feature/my-branch\n', 0) as any;
        case 2: // git push origin feature/my-branch
          return mockProc('', 0) as any;
        default:
          return mockProc('', 0) as any;
      }
    });

    const res = await jsonPost('/push', { path: '/proj' });
    const json = await res.json();

    expect(json.ok).toBe(true);
    expect(json.data.pushed).toBe(true);
    expect(json.data.setUpstream).toBe(false);
    expect(spawnCalls[1]).toEqual(['git', 'push', 'origin', 'feature/my-branch']);
  });

  test('uses custom remote and branch when specified', async () => {
    let capturedCmd: string[] = [];
    spawnSpy = spyOn(Bun, 'spawn').mockImplementation((...args: any[]) => {
      capturedCmd = args[0] as string[];
      return mockProc('', 0) as any;
    });

    const res = await jsonPost('/push', {
      path: '/proj',
      remote: 'upstream',
      branch: 'develop',
    });
    const json = await res.json();

    expect(json.ok).toBe(true);
    expect(capturedCmd).toEqual(['git', 'push', 'upstream', 'develop']);
  });

  test('auto-sets upstream when push fails with no upstream', async () => {
    let callIndex = 0;
    spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
      callIndex++;
      switch (callIndex) {
        case 1: // get branch
          return mockProc('new-branch\n', 0) as any;
        case 2: // push fails — no upstream
          return mockProc('', 1, 'fatal: no upstream branch') as any;
        case 3: // push --set-upstream
          return mockProc('', 0) as any;
        default:
          return mockProc('', 0) as any;
      }
    });

    const res = await jsonPost('/push', { path: '/proj' });
    const json = await res.json();

    expect(json.ok).toBe(true);
    expect(json.data.setUpstream).toBe(true);
  });

  test('returns error when push fails for non-upstream reason', async () => {
    let callIndex = 0;
    spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
      callIndex++;
      switch (callIndex) {
        case 1:
          return mockProc('main\n', 0) as any;
        case 2: // push fails
          return mockProc('', 1, 'fatal: Authentication failed') as any;
        default:
          return mockProc('', 0) as any;
      }
    });

    const res = await jsonPost('/push', { path: '/proj' });
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toContain('Authentication failed');
  });

  test('returns error when branch detection fails', async () => {
    spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(
      mockProc('', 128, 'fatal: not a git repo') as any,
    );

    const res = await jsonPost('/push', { path: '/proj' });
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toContain('Could not determine current branch');
  });
});

// ---------------------------------------------------------------------------
// POST /generate-commit-message — AI commit message generation
// ---------------------------------------------------------------------------

describe('POST /generate-commit-message', () => {
  let spawnSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    if (spawnSpy) spawnSpy.mockRestore();
  });

  test('returns 400 when path is missing', async () => {
    const res = await jsonPost('/generate-commit-message', {});
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toBe('path required');
  });

  test('returns 403 for blocked paths', async () => {
    const res = await jsonPost('/generate-commit-message', { path: '/proc/self' });
    expect(res.status).toBe(403);
  });

  test('returns 400 when no changes to describe', async () => {
    let callIndex = 0;
    spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
      callIndex++;
      switch (callIndex) {
        case 1: // git diff HEAD
          return mockProc('', 0) as any;
        case 2: // git ls-files --others
          return mockProc('', 0) as any;
        default:
          return mockProc('', 0) as any;
      }
    });

    const res = await jsonPost('/generate-commit-message', { path: '/proj' });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('No changes');
  });
});
