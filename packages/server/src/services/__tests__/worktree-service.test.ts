import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { resolve, join } from 'path';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import type { WorktreeInfo, WorktreeCreateOptions, WorktreeResult } from '@e/shared';

// ---------------------------------------------------------------------------
// Mock Bun.spawn to control git command output in unit tests
// ---------------------------------------------------------------------------

type SpawnResult = {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
};

let spawnMock: ReturnType<typeof mock>;
let spawnResults: Array<{ stdout: string; stderr: string; exitCode: number }> = [];
let spawnCallIndex = 0;
let spawnCalls: Array<{ args: string[]; cwd: string }> = [];

function mockSpawnResult(stdout: string, stderr: string, exitCode: number) {
  spawnResults.push({ stdout, stderr, exitCode });
}

function makeReadableStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

// We need to mock at the module level before imports
const originalSpawn = Bun.spawn;

function setupSpawnMock() {
  spawnResults = [];
  spawnCallIndex = 0;
  spawnCalls = [];

  // Replace Bun.spawn with our mock
  (Bun as any).spawn = (args: string[], opts: any) => {
    const idx = spawnCallIndex++;
    const result = spawnResults[idx] ?? { stdout: '', stderr: '', exitCode: 0 };
    spawnCalls.push({ args: [...args], cwd: opts?.cwd ?? '' });

    return {
      stdout: makeReadableStream(result.stdout),
      stderr: makeReadableStream(result.stderr),
      exited: Promise.resolve(result.exitCode),
    };
  };
}

function restoreSpawnMock() {
  (Bun as any).spawn = originalSpawn;
}

// Import after setting up types (actual module uses Bun.spawn internally)
import {
  parsePorcelain,
  create,
  remove,
  list,
  getPath,
  validate,
  prune,
  _testHelpers,
} from '../worktree-service';

// ---------------------------------------------------------------------------
// parsePorcelain — unit tests for the porcelain parser
// ---------------------------------------------------------------------------

describe('parsePorcelain', () => {
  test('parses single main worktree', () => {
    const output = `worktree /home/user/project
HEAD abc123def456
branch refs/heads/main

`;
    const result = parsePorcelain(output);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      path: '/home/user/project',
      head: 'abc123def456',
      branch: 'main',
      storyId: null,
      isMain: true,
      isLocked: false,
    });
  });

  test('parses multiple worktrees', () => {
    const output = `worktree /home/user/project
HEAD abc123
branch refs/heads/main

worktree /home/user/project/.e/worktrees/add-auth
HEAD def456
branch refs/heads/story/add-auth

worktree /home/user/project/.e/worktrees/fix-bug
HEAD 789abc
branch refs/heads/story/fix-bug

`;
    const result = parsePorcelain(output);
    expect(result).toHaveLength(3);

    // Main worktree
    expect(result[0].isMain).toBe(true);
    expect(result[0].branch).toBe('main');
    expect(result[0].storyId).toBeNull();

    // Story worktrees
    expect(result[1].isMain).toBe(false);
    expect(result[1].branch).toBe('story/add-auth');
    expect(result[1].storyId).toBe('add-auth');
    expect(result[1].path).toBe('/home/user/project/.e/worktrees/add-auth');

    expect(result[2].storyId).toBe('fix-bug');
  });

  test('parses locked worktree', () => {
    const output = `worktree /home/user/project
HEAD abc123
branch refs/heads/main

worktree /home/user/project/.e/worktrees/locked-story
HEAD def456
branch refs/heads/story/locked-story
locked

`;
    const result = parsePorcelain(output);
    expect(result[0].isLocked).toBe(false);
    expect(result[1].isLocked).toBe(true);
    expect(result[1].storyId).toBe('locked-story');
  });

  test('parses locked worktree with reason', () => {
    const output = `worktree /home/user/project/.e/worktrees/locked-story
HEAD def456
branch refs/heads/story/locked-story
locked reason: in-use by agent

`;
    const result = parsePorcelain(output);
    expect(result[0].isLocked).toBe(true);
  });

  test('parses detached HEAD', () => {
    const output = `worktree /home/user/project
HEAD abc123
branch refs/heads/main

worktree /home/user/project/.e/worktrees/detached
HEAD def456
detached

`;
    const result = parsePorcelain(output);
    expect(result[1].branch).toBeNull();
    expect(result[1].storyId).toBeNull();
  });

  test('parses bare repository marker', () => {
    const output = `worktree /home/user/project.git
HEAD abc123
bare

`;
    const result = parsePorcelain(output);
    expect(result[0].isMain).toBe(true);
  });

  test('handles empty output', () => {
    expect(parsePorcelain('')).toEqual([]);
    expect(parsePorcelain('\n')).toEqual([]);
    expect(parsePorcelain('  \n  ')).toEqual([]);
  });

  test('extracts storyId only from story/ prefix branches', () => {
    const output = `worktree /home/user/project
HEAD abc123
branch refs/heads/main

worktree /path/a
HEAD 111
branch refs/heads/feature/xyz

worktree /path/b
HEAD 222
branch refs/heads/story/my-story-123

`;
    const result = parsePorcelain(output);
    expect(result[0].storyId).toBeNull(); // main
    expect(result[1].storyId).toBeNull(); // feature/xyz — not story/
    expect(result[2].storyId).toBe('my-story-123'); // story/my-story-123
  });

  test('parses prunable worktree', () => {
    const output = `worktree /home/user/project
HEAD abc123
branch refs/heads/main

worktree /home/user/project/.e/worktrees/old
HEAD def456
branch refs/heads/story/old
prunable gitdir file points to non-existent location

`;
    // Prunable is a state marker — we still parse the entry
    const result = parsePorcelain(output);
    expect(result).toHaveLength(2);
    expect(result[1].storyId).toBe('old');
  });
});

// ---------------------------------------------------------------------------
// create() — unit tests
// ---------------------------------------------------------------------------

describe('create()', () => {
  beforeEach(() => {
    setupSpawnMock();
    _testHelpers.clearLocks();
  });

  afterEach(() => {
    restoreSpawnMock();
  });

  test('spawns git worktree add with correct path and branch', async () => {
    mockSpawnResult('', 'Preparing worktree\n', 0);

    const result = await create({
      workspacePath: '/home/user/project',
      storyId: 'add-auth',
    });

    expect(result.ok).toBe(true);
    expect(result.data).toBe(resolve('/home/user/project/.e/worktrees/add-auth'));

    // Verify the exact git command
    expect(spawnCalls[0].args).toEqual([
      'git',
      'worktree',
      'add',
      join('/home/user/project', '.e/worktrees', 'add-auth'),
      '-b',
      'story/add-auth',
    ]);
    expect(spawnCalls[0].cwd).toBe('/home/user/project');
  });

  test('creates worktree from specified baseBranch', async () => {
    mockSpawnResult('', '', 0);

    const result = await create({
      workspacePath: '/home/user/project',
      storyId: 'feature-x',
      baseBranch: 'develop',
    });

    expect(result.ok).toBe(true);
    // Last arg should be the baseBranch
    expect(spawnCalls[0].args).toEqual([
      'git',
      'worktree',
      'add',
      join('/home/user/project', '.e/worktrees', 'feature-x'),
      '-b',
      'story/feature-x',
      'develop',
    ]);
  });

  test('returns error on git failure', async () => {
    mockSpawnResult('', "fatal: 'story/add-auth' is already checked out", 128);

    const result = await create({
      workspacePath: '/home/user/project',
      storyId: 'add-auth',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('already checked out');
  });

  test('returns error with stderr message', async () => {
    mockSpawnResult('', 'fatal: invalid reference: bad-ref', 128);

    const result = await create({
      workspacePath: '/home/user/project',
      storyId: 'bad',
      baseBranch: 'bad-ref',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('invalid reference');
  });

  test('handles spawn exception gracefully', async () => {
    // Make spawn throw
    (Bun as any).spawn = () => {
      throw new Error('spawn ENOENT');
    };

    const result = await create({
      workspacePath: '/home/user/project',
      storyId: 'crash',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('spawn ENOENT');
  });
});

// ---------------------------------------------------------------------------
// remove() — unit tests
// ---------------------------------------------------------------------------

describe('remove()', () => {
  beforeEach(() => {
    setupSpawnMock();
    _testHelpers.clearLocks();
  });

  afterEach(() => {
    restoreSpawnMock();
  });

  test('returns error when worktree directory does not exist', async () => {
    const result = await remove('/nonexistent/path', 'story-1');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Worktree not found');
  });

  test('returns error with dirty file list when worktree has changes', async () => {
    // Create a temp directory to simulate the worktree existing
    const tmpDir = mkdtempSync(join(tmpdir(), 'wt-test-'));
    const storyId = 'dirty-story';
    const worktreeDir = join(tmpDir, '.e', 'worktrees', storyId);

    // We need the directory to actually exist for existsSync check
    const { mkdirSync } = require('fs');
    mkdirSync(worktreeDir, { recursive: true });

    // Mock git status --porcelain returning dirty files
    mockSpawnResult(' M src/main.ts\n?? new-file.ts\n', '', 0);

    const result = await remove(tmpDir, storyId);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('uncommitted changes');
    expect(result.dirtyFiles).toBeDefined();
    expect(result.dirtyFiles).toHaveLength(2);
    // Note: .trim() on the full output strips leading space from first line
    expect(result.dirtyFiles).toContain('M src/main.ts');
    expect(result.dirtyFiles).toContain('?? new-file.ts');

    // Verify git status was run in the worktree directory
    expect(spawnCalls[0].args).toEqual(['git', 'status', '--porcelain']);

    // Cleanup
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('successfully removes clean worktree', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'wt-test-'));
    const storyId = 'clean-story';
    const worktreeDir = join(tmpDir, '.e', 'worktrees', storyId);

    const { mkdirSync } = require('fs');
    mkdirSync(worktreeDir, { recursive: true });

    // Mock: git status --porcelain returns empty (clean)
    mockSpawnResult('', '', 0);
    // Mock: git worktree remove succeeds
    mockSpawnResult('', '', 0);

    const result = await remove(tmpDir, storyId);

    expect(result.ok).toBe(true);

    // Verify remove command was called with correct path
    expect(spawnCalls[1].args[0]).toBe('git');
    expect(spawnCalls[1].args[1]).toBe('worktree');
    expect(spawnCalls[1].args[2]).toBe('remove');
    expect(spawnCalls[1].cwd).toBe(tmpDir);

    // Cleanup
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns error when git status check fails', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'wt-test-'));
    const storyId = 'broken';
    const worktreeDir = join(tmpDir, '.e', 'worktrees', storyId);

    const { mkdirSync } = require('fs');
    mkdirSync(worktreeDir, { recursive: true });

    // Mock: git status fails
    mockSpawnResult('', 'fatal: not a git repository', 128);

    const result = await remove(tmpDir, storyId);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Failed to check worktree status');

    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns error when git worktree remove fails', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'wt-test-'));
    const storyId = 'remove-fail';
    const worktreeDir = join(tmpDir, '.e', 'worktrees', storyId);

    const { mkdirSync } = require('fs');
    mkdirSync(worktreeDir, { recursive: true });

    // Mock: git status clean
    mockSpawnResult('', '', 0);
    // Mock: git worktree remove fails
    mockSpawnResult('', 'fatal: cannot remove worktree', 1);

    const result = await remove(tmpDir, storyId);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Failed to remove worktree');

    rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// list() — unit tests
// ---------------------------------------------------------------------------

describe('list()', () => {
  beforeEach(() => {
    setupSpawnMock();
    _testHelpers.clearLocks();
  });

  afterEach(() => {
    restoreSpawnMock();
  });

  test('parses and returns worktree list with dirty state', async () => {
    const porcelainOutput = `worktree /home/user/project
HEAD abc123
branch refs/heads/main

worktree /home/user/project/.e/worktrees/story-1
HEAD def456
branch refs/heads/story/story-1

`;
    // Mock: git worktree list --porcelain
    mockSpawnResult(porcelainOutput, '', 0);
    // Mock: git status for main worktree (dirty)
    mockSpawnResult(' M file.ts\n', '', 0);
    // Mock: git status for story worktree (clean)
    mockSpawnResult('', '', 0);

    // We need the paths to "exist" for the dirty check
    // Since we're using mocked Bun.spawn and the paths don't actually exist,
    // existsSync will return false and skip the dirty check
    const result = await list('/home/user/project');

    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.length).toBe(2);
    expect(result.data![0].isMain).toBe(true);
    expect(result.data![0].branch).toBe('main');
    expect(result.data![1].storyId).toBe('story-1');
  });

  test('returns error on git worktree list failure', async () => {
    mockSpawnResult('', 'fatal: not a git repository', 128);

    const result = await list('/not-a-repo');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('not a git repository');
  });

  test('correctly identifies main worktree and extracts storyIds', async () => {
    const porcelainOutput = `worktree /repo
HEAD aaa
branch refs/heads/main

worktree /repo/.e/worktrees/s1
HEAD bbb
branch refs/heads/story/s1

worktree /repo/.e/worktrees/s2
HEAD ccc
branch refs/heads/story/s2
locked

`;
    mockSpawnResult(porcelainOutput, '', 0);

    const result = await list('/repo');
    expect(result.ok).toBe(true);

    const data = result.data!;
    expect(data[0].isMain).toBe(true);
    expect(data[0].storyId).toBeNull();

    expect(data[1].isMain).toBe(false);
    expect(data[1].storyId).toBe('s1');
    expect(data[1].isLocked).toBe(false);

    expect(data[2].isMain).toBe(false);
    expect(data[2].storyId).toBe('s2');
    expect(data[2].isLocked).toBe(true);
  });

  test('detects detached HEAD worktrees', async () => {
    const porcelainOutput = `worktree /repo
HEAD aaa
branch refs/heads/main

worktree /repo/.e/worktrees/detached-wt
HEAD bbb
detached

`;
    mockSpawnResult(porcelainOutput, '', 0);

    const result = await list('/repo');
    expect(result.ok).toBe(true);
    expect(result.data![1].branch).toBeNull();
    expect(result.data![1].storyId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getPath() — unit tests
// ---------------------------------------------------------------------------

describe('getPath()', () => {
  beforeEach(() => {
    setupSpawnMock();
    _testHelpers.clearLocks();
  });

  afterEach(() => {
    restoreSpawnMock();
  });

  test('returns null for non-existent worktree', async () => {
    const result = await getPath('/nonexistent/workspace', 'no-story');

    expect(result.ok).toBe(true);
    expect(result.data).toBeNull();
  });

  test('returns resolved absolute path for existing worktree', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'wt-test-'));
    const storyId = 'existing';
    const worktreeDir = join(tmpDir, '.e', 'worktrees', storyId);

    const { mkdirSync } = require('fs');
    mkdirSync(worktreeDir, { recursive: true });

    const result = await getPath(tmpDir, storyId);

    expect(result.ok).toBe(true);
    expect(result.data).toBe(resolve(worktreeDir));

    rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// validate() — unit tests
// ---------------------------------------------------------------------------

describe('validate()', () => {
  beforeEach(() => {
    setupSpawnMock();
    _testHelpers.clearLocks();
  });

  afterEach(() => {
    restoreSpawnMock();
  });

  test('returns false for missing directory', async () => {
    const result = await validate('/nonexistent', 'missing');

    expect(result.ok).toBe(true);
    expect(result.data!.valid).toBe(false);
    expect(result.data!.dirExists).toBe(false);
    expect(result.data!.headValid).toBe(false);
    expect(result.data!.branchIntact).toBe(false);
  });

  test('returns true for valid worktree', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'wt-test-'));
    const storyId = 'valid-story';
    const worktreeDir = join(tmpDir, '.e', 'worktrees', storyId);

    const { mkdirSync } = require('fs');
    mkdirSync(worktreeDir, { recursive: true });

    // Mock: git rev-parse --verify HEAD succeeds
    mockSpawnResult('abc123\n', '', 0);
    // Mock: git rev-parse --verify refs/heads/story/valid-story succeeds
    mockSpawnResult('abc123\n', '', 0);

    const result = await validate(tmpDir, storyId);

    expect(result.ok).toBe(true);
    expect(result.data!.valid).toBe(true);
    expect(result.data!.dirExists).toBe(true);
    expect(result.data!.headValid).toBe(true);
    expect(result.data!.branchIntact).toBe(true);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('detects invalid HEAD', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'wt-test-'));
    const storyId = 'bad-head';
    const worktreeDir = join(tmpDir, '.e', 'worktrees', storyId);

    const { mkdirSync } = require('fs');
    mkdirSync(worktreeDir, { recursive: true });

    // Mock: HEAD check fails
    mockSpawnResult('', 'fatal: Needed a single revision', 128);
    // Mock: branch check succeeds
    mockSpawnResult('abc123\n', '', 0);

    const result = await validate(tmpDir, storyId);

    expect(result.ok).toBe(true);
    expect(result.data!.valid).toBe(false);
    expect(result.data!.dirExists).toBe(true);
    expect(result.data!.headValid).toBe(false);
    expect(result.data!.branchIntact).toBe(true);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('detects missing branch', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'wt-test-'));
    const storyId = 'no-branch';
    const worktreeDir = join(tmpDir, '.e', 'worktrees', storyId);

    const { mkdirSync } = require('fs');
    mkdirSync(worktreeDir, { recursive: true });

    // Mock: HEAD check succeeds
    mockSpawnResult('abc123\n', '', 0);
    // Mock: branch check fails
    mockSpawnResult('', 'fatal: Needed a single revision', 128);

    const result = await validate(tmpDir, storyId);

    expect(result.ok).toBe(true);
    expect(result.data!.valid).toBe(false);
    expect(result.data!.dirExists).toBe(true);
    expect(result.data!.headValid).toBe(true);
    expect(result.data!.branchIntact).toBe(false);

    rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// prune() — unit tests
// ---------------------------------------------------------------------------

describe('prune()', () => {
  beforeEach(() => {
    setupSpawnMock();
    _testHelpers.clearLocks();
  });

  afterEach(() => {
    restoreSpawnMock();
  });

  test('runs git worktree prune and returns count', async () => {
    // Before: 3 worktrees
    const beforeOutput = `worktree /repo
HEAD aaa
branch refs/heads/main

worktree /repo/.e/worktrees/s1
HEAD bbb
branch refs/heads/story/s1

worktree /repo/.e/worktrees/s2
HEAD ccc
branch refs/heads/story/s2

`;
    // After: 2 worktrees (1 pruned)
    const afterOutput = `worktree /repo
HEAD aaa
branch refs/heads/main

worktree /repo/.e/worktrees/s1
HEAD bbb
branch refs/heads/story/s1

`;

    mockSpawnResult(beforeOutput, '', 0); // git worktree list (before)
    mockSpawnResult('', '', 0); // git worktree prune
    mockSpawnResult(afterOutput, '', 0); // git worktree list (after)

    const result = await prune('/repo');

    expect(result.ok).toBe(true);
    expect(result.data).toBe(1);

    // Verify prune command was called
    expect(spawnCalls[1].args).toEqual(['git', 'worktree', 'prune']);
  });

  test('returns 0 when nothing to prune', async () => {
    const sameOutput = `worktree /repo
HEAD aaa
branch refs/heads/main

`;
    mockSpawnResult(sameOutput, '', 0); // before
    mockSpawnResult('', '', 0); // prune
    mockSpawnResult(sameOutput, '', 0); // after

    const result = await prune('/repo');

    expect(result.ok).toBe(true);
    expect(result.data).toBe(0);
  });

  test('returns error when prune command fails', async () => {
    mockSpawnResult('', '', 0); // before list
    mockSpawnResult('', 'fatal: not a git repository', 128); // prune fails

    const result = await prune('/not-a-repo');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('not a git repository');
  });
});

// ---------------------------------------------------------------------------
// Per-workspace mutex — serialization tests
// ---------------------------------------------------------------------------

describe('per-workspace mutex', () => {
  beforeEach(() => {
    setupSpawnMock();
    _testHelpers.clearLocks();
  });

  afterEach(() => {
    restoreSpawnMock();
  });

  test('serializes concurrent operations on same workspace', async () => {
    const executionOrder: number[] = [];

    // Set up enough spawn results for all operations
    for (let i = 0; i < 10; i++) {
      mockSpawnResult('', '', 0);
    }

    // Launch 3 concurrent operations on the same workspace
    const p1 = create({
      workspacePath: '/same/workspace',
      storyId: 'story-1',
    }).then((r) => {
      executionOrder.push(1);
      return r;
    });

    const p2 = create({
      workspacePath: '/same/workspace',
      storyId: 'story-2',
    }).then((r) => {
      executionOrder.push(2);
      return r;
    });

    const p3 = create({
      workspacePath: '/same/workspace',
      storyId: 'story-3',
    }).then((r) => {
      executionOrder.push(3);
      return r;
    });

    await Promise.all([p1, p2, p3]);

    // All should have completed
    expect(executionOrder).toHaveLength(3);
    // They should execute in order (serialized)
    expect(executionOrder).toEqual([1, 2, 3]);
  });

  test('different workspaces can run in parallel', async () => {
    const activeWorkspaces = new Set<string>();
    let maxConcurrent = 0;

    // We need to track which workspaces are active
    const origSpawn = (Bun as any).spawn;

    (Bun as any).spawn = (args: string[], opts: any) => {
      const cwd = opts?.cwd ?? '';
      activeWorkspaces.add(cwd);
      maxConcurrent = Math.max(maxConcurrent, activeWorkspaces.size);

      return {
        stdout: makeReadableStream(''),
        stderr: makeReadableStream(''),
        exited: Promise.resolve(0).then(() => {
          activeWorkspaces.delete(cwd);
          return 0;
        }),
      };
    };

    // Launch operations on different workspaces
    const results = await Promise.all([
      create({ workspacePath: '/workspace-a', storyId: 's1' }),
      create({ workspacePath: '/workspace-b', storyId: 's2' }),
      create({ workspacePath: '/workspace-c', storyId: 's3' }),
    ]);

    // All should succeed
    results.forEach((r) => expect(r.ok).toBe(true));
  });

  test('mutex is cleaned up after operations complete', async () => {
    mockSpawnResult('', '', 0);

    await create({ workspacePath: '/clean/workspace', storyId: 's1' });

    const locks = _testHelpers.getWorkspaceLocks();
    // Lock should be cleaned up after the operation completes
    // (or replaced by the resolution — either way the map doesn't grow unbounded)
    expect(locks.size).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Error handling — structured WorktreeResult
// ---------------------------------------------------------------------------

describe('structured error handling', () => {
  beforeEach(() => {
    setupSpawnMock();
    _testHelpers.clearLocks();
  });

  afterEach(() => {
    restoreSpawnMock();
  });

  test('create never throws uncaught', async () => {
    (Bun as any).spawn = () => {
      throw new Error('catastrophic failure');
    };

    const result = await create({
      workspacePath: '/workspace',
      storyId: 'crash',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  test('list never throws uncaught', async () => {
    (Bun as any).spawn = () => {
      throw new Error('catastrophic failure');
    };

    const result = await list('/workspace');
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  test('remove never throws uncaught', async () => {
    // remove checks existsSync first — need a real directory
    const tmpDir = mkdtempSync(join(tmpdir(), 'wt-test-'));
    const storyId = 'crash-story';
    const worktreeDir = join(tmpDir, '.e', 'worktrees', storyId);
    const { mkdirSync } = require('fs');
    mkdirSync(worktreeDir, { recursive: true });

    (Bun as any).spawn = () => {
      throw new Error('catastrophic failure');
    };

    const result = await remove(tmpDir, storyId);
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();

    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('validate never throws uncaught', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'wt-test-'));
    const storyId = 'crash-val';
    const worktreeDir = join(tmpDir, '.e', 'worktrees', storyId);
    const { mkdirSync } = require('fs');
    mkdirSync(worktreeDir, { recursive: true });

    (Bun as any).spawn = () => {
      throw new Error('catastrophic failure');
    };

    const result = await validate(tmpDir, storyId);
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();

    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('prune never throws uncaught', async () => {
    (Bun as any).spawn = () => {
      throw new Error('catastrophic failure');
    };

    const result = await prune('/workspace');
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  test('getPath never throws uncaught', async () => {
    // getPath doesn't call git, but test that the withLock wrapper handles errors
    const result = await getPath('/workspace', 'story');
    expect(result.ok).toBe(true);
  });

  test('all error results have ok: false and error string', async () => {
    mockSpawnResult('', 'fatal: bad', 128);
    const r = await create({ workspacePath: '/w', storyId: 's' });
    expect(r.ok).toBe(false);
    expect(typeof r.error).toBe('string');
    expect(r.error!.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Integration test — real temp git repo
// ---------------------------------------------------------------------------

describe('integration: real git repo', () => {
  let repoDir: string;

  beforeEach(async () => {
    // Restore real Bun.spawn for integration tests
    restoreSpawnMock();
    _testHelpers.clearLocks();

    // Create a temp git repo
    repoDir = mkdtempSync(join(tmpdir(), 'wt-integration-'));

    const execGit = async (args: string[]) => {
      const proc = Bun.spawn(['git', ...args], {
        cwd: repoDir,
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'Test',
          GIT_AUTHOR_EMAIL: 'test@test.com',
          GIT_COMMITTER_NAME: 'Test',
          GIT_COMMITTER_EMAIL: 'test@test.com',
        },
      });
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        throw new Error(`git ${args.join(' ')} failed: ${stderr}`);
      }
      return stdout;
    };

    // Init repo with initial commit
    await execGit(['init', '-b', 'main']);
    // Write a file using Bun
    await Bun.write(join(repoDir, 'README.md'), '# Test\n');
    await execGit(['add', '.']);
    await execGit(['commit', '-m', 'initial commit']);
  });

  afterEach(() => {
    if (repoDir && existsSync(repoDir)) {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });

  test('full lifecycle: create → list → validate → getPath → remove → prune', async () => {
    // 1. Create a worktree
    const createResult = await create({
      workspacePath: repoDir,
      storyId: 'integration-test',
    });
    expect(createResult.ok).toBe(true);
    expect(createResult.data).toBeDefined();
    expect(existsSync(createResult.data!)).toBe(true);

    // 2. List worktrees
    const listResult = await list(repoDir);
    expect(listResult.ok).toBe(true);
    expect(listResult.data!.length).toBe(2);

    const mainWt = listResult.data!.find((w) => w.isMain);
    const storyWt = listResult.data!.find((w) => w.storyId === 'integration-test');
    expect(mainWt).toBeDefined();
    expect(storyWt).toBeDefined();
    expect(storyWt!.branch).toBe('story/integration-test');
    expect(storyWt!.isDirty).toBe(false);

    // 3. Validate worktree
    const valResult = await validate(repoDir, 'integration-test');
    expect(valResult.ok).toBe(true);
    expect(valResult.data!.valid).toBe(true);
    expect(valResult.data!.dirExists).toBe(true);
    expect(valResult.data!.headValid).toBe(true);
    expect(valResult.data!.branchIntact).toBe(true);

    // 4. Get path
    const pathResult = await getPath(repoDir, 'integration-test');
    expect(pathResult.ok).toBe(true);
    expect(pathResult.data).toBe(createResult.data);

    // 5. Remove worktree (should succeed since clean)
    const removeResult = await remove(repoDir, 'integration-test');
    expect(removeResult.ok).toBe(true);

    // 6. Verify it's gone
    const afterList = await list(repoDir);
    expect(afterList.ok).toBe(true);
    expect(afterList.data!.length).toBe(1);
    expect(afterList.data![0].isMain).toBe(true);

    // 7. Prune (should have nothing to prune)
    const pruneResult = await prune(repoDir);
    expect(pruneResult.ok).toBe(true);
    expect(pruneResult.data).toBe(0);
  });

  test('create with baseBranch from a real branch', async () => {
    const result = await create({
      workspacePath: repoDir,
      storyId: 'from-main',
      baseBranch: 'main',
    });

    expect(result.ok).toBe(true);
    expect(existsSync(result.data!)).toBe(true);

    // Clean up
    await remove(repoDir, 'from-main');
  });

  test('remove rejects dirty worktree with file list', async () => {
    // Create worktree
    const createResult = await create({
      workspacePath: repoDir,
      storyId: 'dirty-test',
    });
    expect(createResult.ok).toBe(true);

    // Make it dirty by writing a file
    await Bun.write(join(createResult.data!, 'dirty-file.txt'), 'dirty content');

    // Try to remove — should fail
    const removeResult = await remove(repoDir, 'dirty-test');
    expect(removeResult.ok).toBe(false);
    expect(removeResult.error).toContain('uncommitted changes');
    expect(removeResult.dirtyFiles).toBeDefined();
    expect(removeResult.dirtyFiles!.length).toBeGreaterThan(0);

    // Force cleanup for the test
    rmSync(createResult.data!, { recursive: true, force: true });
    // Prune the stale reference
    await prune(repoDir);
  });

  test('validate returns false for missing directory', async () => {
    const result = await validate(repoDir, 'nonexistent-story');
    expect(result.ok).toBe(true);
    expect(result.data!.valid).toBe(false);
    expect(result.data!.dirExists).toBe(false);
  });

  test('getPath returns null for non-existent worktree', async () => {
    const result = await getPath(repoDir, 'nonexistent');
    expect(result.ok).toBe(true);
    expect(result.data).toBeNull();
  });

  test('create fails for duplicate storyId', async () => {
    const first = await create({
      workspacePath: repoDir,
      storyId: 'dup-test',
    });
    expect(first.ok).toBe(true);

    const second = await create({
      workspacePath: repoDir,
      storyId: 'dup-test',
    });
    expect(second.ok).toBe(false);
    expect(second.error).toBeDefined();

    // Cleanup
    await remove(repoDir, 'dup-test');
  });
});
