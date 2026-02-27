import { describe, test, expect, beforeEach, spyOn, mock } from 'bun:test';
import { resolve, join } from 'path';
import { createTestDb } from '../../test-helpers';

// ---------------------------------------------------------------------------
// Test database
// ---------------------------------------------------------------------------

const testDb = createTestDb();

mock.module('../../db/database', () => ({
  getDb: () => testDb,
  initDatabase: () => {},
}));

// ---------------------------------------------------------------------------
// Track Bun.spawn calls to verify CWD resolution and auto-install
// ---------------------------------------------------------------------------

const spawnCalls: Array<{ args: string[]; cwd: string }> = [];
const originalSpawn = Bun.spawn;

function mockSpawn(argsOrCmd: any, opts?: any) {
  const args = Array.isArray(argsOrCmd) ? argsOrCmd : [argsOrCmd];
  const cwd = opts?.cwd || '';
  spawnCalls.push({ args, cwd });

  // Simulate successful command execution
  return {
    stdout: new ReadableStream({
      start(controller: ReadableStreamDefaultController) {
        controller.enqueue(new TextEncoder().encode('mock output'));
        controller.close();
      },
    }),
    stderr: new ReadableStream({
      start(controller: ReadableStreamDefaultController) {
        controller.enqueue(new TextEncoder().encode(''));
        controller.close();
      },
    }),
    exited: Promise.resolve(0),
    kill: () => {},
    pid: 12345,
  };
}

(Bun as any).spawn = mockSpawn;

// ---------------------------------------------------------------------------
// Mock fs.existsSync for controlled testing
// ---------------------------------------------------------------------------

const existingPaths = new Set<string>();

mock.module('fs', () => {
  const actual = require('fs');
  return {
    ...actual,
    existsSync: (p: string) => existingPaths.has(p),
  };
});

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  runQualityCheck,
  runAllQualityChecks,
  ensureDependencies,
  _testHelpers,
  type QualityCheckOptions,
} from '../quality-checker';
import { resolveWorkspacePath, getForStory } from '../worktree-service';
import type { QualityCheckConfig, QualityCheckResult } from '@e/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clearWorktrees() {
  testDb.exec('DELETE FROM worktrees');
}

function insertWorktreeRecord(overrides: Record<string, any> = {}) {
  const defaults = {
    id: 'wt-test-' + Math.random().toString(36).slice(2, 8),
    story_id: 'test-story',
    prd_id: null,
    workspace_path: resolve('/workspace/project'),
    worktree_path: resolve('/workspace/project/.e/worktrees/test-story'),
    branch_name: 'story/test-story',
    base_branch: 'main',
    base_commit: 'abc123',
    status: 'active',
    created_at: Date.now(),
    updated_at: Date.now(),
  };
  const row = { ...defaults, ...overrides };
  testDb
    .query(
      `INSERT INTO worktrees (id, story_id, prd_id, workspace_path, worktree_path, branch_name, base_branch, base_commit, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.story_id,
      row.prd_id,
      row.workspace_path,
      row.worktree_path,
      row.branch_name,
      row.base_branch,
      row.base_commit,
      row.status,
      row.created_at,
      row.updated_at,
    );
  return row;
}

const makeCheck = (overrides: Partial<QualityCheckConfig> = {}): QualityCheckConfig => ({
  id: 'typecheck',
  type: 'typecheck',
  name: 'TypeScript Check',
  command: 'npx tsc --noEmit',
  timeout: 30000,
  required: true,
  enabled: true,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('quality-checker worktree integration', () => {
  beforeEach(() => {
    clearWorktrees();
    spawnCalls.length = 0;
    existingPaths.clear();
    _testHelpers.clearInstalledWorktrees();
  });

  // -----------------------------------------------------------------------
  // AC3: Quality checks execute with CWD = worktree path
  // -----------------------------------------------------------------------
  describe('CWD resolution', () => {
    test('uses worktree path when storyId has active worktree', async () => {
      const worktreePath = resolve('/workspace/project/.e/worktrees/story-1');
      insertWorktreeRecord({
        story_id: 'story-1',
        workspace_path: resolve('/workspace/project'),
        worktree_path: worktreePath,
        status: 'active',
      });

      const check = makeCheck();
      await runQualityCheck(check, '/workspace/project', { storyId: 'story-1' });

      // The spawn call should use the worktree path as CWD
      const cmdSpawn = spawnCalls.find((s) => s.args.includes('tsc'));
      expect(cmdSpawn).toBeDefined();
      expect(cmdSpawn!.cwd).toBe(worktreePath);
    });

    test('uses workspace path when no storyId provided', async () => {
      const check = makeCheck();
      await runQualityCheck(check, '/workspace/project');

      const cmdSpawn = spawnCalls.find((s) => s.args.includes('tsc'));
      expect(cmdSpawn).toBeDefined();
      expect(cmdSpawn!.cwd).toBe(resolve('/workspace/project'));
    });

    test('uses workspace path when storyId has no worktree', async () => {
      const check = makeCheck();
      await runQualityCheck(check, '/workspace/project', { storyId: 'no-worktree' });

      const cmdSpawn = spawnCalls.find((s) => s.args.includes('tsc'));
      expect(cmdSpawn).toBeDefined();
      expect(cmdSpawn!.cwd).toBe(resolve('/workspace/project'));
    });

    test('uses workspace path when storyId has abandoned worktree', async () => {
      insertWorktreeRecord({
        story_id: 'abandoned-story',
        workspace_path: resolve('/workspace/project'),
        worktree_path: resolve('/workspace/project/.e/worktrees/abandoned-story'),
        status: 'abandoned',
      });

      const check = makeCheck();
      await runQualityCheck(check, '/workspace/project', { storyId: 'abandoned-story' });

      const cmdSpawn = spawnCalls.find((s) => s.args.includes('tsc'));
      expect(cmdSpawn).toBeDefined();
      expect(cmdSpawn!.cwd).toBe(resolve('/workspace/project'));
    });
  });

  // -----------------------------------------------------------------------
  // AC4: Results tagged with storyId
  // -----------------------------------------------------------------------
  describe('storyId tagging', () => {
    test('includes storyId in result when provided', async () => {
      insertWorktreeRecord({
        story_id: 'tagged-story',
        workspace_path: resolve('/workspace/project'),
        worktree_path: resolve('/workspace/project/.e/worktrees/tagged-story'),
        status: 'active',
      });

      const check = makeCheck();
      const result = await runQualityCheck(check, '/workspace/project', {
        storyId: 'tagged-story',
      });

      expect(result.storyId).toBe('tagged-story');
    });

    test('does not include storyId when not provided', async () => {
      const check = makeCheck();
      const result = await runQualityCheck(check, '/workspace/project');

      expect(result.storyId).toBeUndefined();
    });

    test('includes storyId even when worktree not found (fallback CWD)', async () => {
      const check = makeCheck();
      const result = await runQualityCheck(check, '/workspace/project', { storyId: 'no-wt' });

      expect(result.storyId).toBe('no-wt');
    });

    test('runAllQualityChecks tags all results with storyId', async () => {
      insertWorktreeRecord({
        story_id: 'bulk-story',
        workspace_path: resolve('/workspace/project'),
        worktree_path: resolve('/workspace/project/.e/worktrees/bulk-story'),
        status: 'active',
      });

      const checks = [
        makeCheck({ id: 'check-1', name: 'Check 1' }),
        makeCheck({ id: 'check-2', name: 'Check 2' }),
      ];

      const results = await runAllQualityChecks(checks, '/workspace/project', {
        storyId: 'bulk-story',
      });

      expect(results).toHaveLength(2);
      expect(results[0].storyId).toBe('bulk-story');
      expect(results[1].storyId).toBe('bulk-story');
    });
  });

  // -----------------------------------------------------------------------
  // AC5: Auto bun install --frozen-lockfile
  // -----------------------------------------------------------------------
  describe('ensureDependencies', () => {
    test('runs bun install when node_modules missing and package.json exists', async () => {
      const worktreePath = '/tmp/test-worktree';
      existingPaths.add(join(worktreePath, 'package.json'));
      // node_modules NOT in existingPaths

      const installed = await ensureDependencies(worktreePath);

      expect(installed).toBe(true);
      const installCall = spawnCalls.find(
        (s) => s.args.includes('bun') && s.args.includes('install'),
      );
      expect(installCall).toBeDefined();
      expect(installCall!.args).toContain('--frozen-lockfile');
      expect(installCall!.cwd).toBe(worktreePath);
    });

    test('skips install when node_modules already exists', async () => {
      const worktreePath = '/tmp/test-worktree-2';
      existingPaths.add(join(worktreePath, 'package.json'));
      existingPaths.add(join(worktreePath, 'node_modules'));

      const installed = await ensureDependencies(worktreePath);

      expect(installed).toBe(false);
      const installCall = spawnCalls.find(
        (s) => s.args.includes('bun') && s.args.includes('install') && s.cwd === worktreePath,
      );
      expect(installCall).toBeUndefined();
    });

    test('skips install when no package.json', async () => {
      const worktreePath = '/tmp/test-worktree-3';
      // No package.json, no node_modules

      const installed = await ensureDependencies(worktreePath);

      expect(installed).toBe(false);
    });

    test('only installs once per worktree per process lifetime', async () => {
      const worktreePath = '/tmp/test-worktree-4';
      existingPaths.add(join(worktreePath, 'package.json'));

      await ensureDependencies(worktreePath);
      spawnCalls.length = 0; // Clear after first call

      const secondInstall = await ensureDependencies(worktreePath);

      expect(secondInstall).toBe(false);
      const installCalls = spawnCalls.filter(
        (s) => s.args.includes('bun') && s.args.includes('install'),
      );
      expect(installCalls).toHaveLength(0);
    });

    test('installs separately for different worktrees', async () => {
      const path1 = '/tmp/test-wt-a';
      const path2 = '/tmp/test-wt-b';
      existingPaths.add(join(path1, 'package.json'));
      existingPaths.add(join(path2, 'package.json'));

      await ensureDependencies(path1);
      await ensureDependencies(path2);

      const installCalls = spawnCalls.filter(
        (s) => s.args.includes('bun') && s.args.includes('install'),
      );
      expect(installCalls).toHaveLength(2);
    });

    test('_testHelpers.clearInstalledWorktrees resets tracking', async () => {
      const worktreePath = '/tmp/test-wt-clear';
      existingPaths.add(join(worktreePath, 'package.json'));

      await ensureDependencies(worktreePath);
      _testHelpers.clearInstalledWorktrees();
      spawnCalls.length = 0;

      const installed = await ensureDependencies(worktreePath);
      expect(installed).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // AC5 integration: auto-install triggered by runQualityCheck with storyId
  // -----------------------------------------------------------------------
  describe('auto-install integration', () => {
    test('triggers ensureDependencies when storyId resolves to worktree', async () => {
      const worktreePath = resolve('/workspace/project/.e/worktrees/install-story');
      insertWorktreeRecord({
        story_id: 'install-story',
        workspace_path: resolve('/workspace/project'),
        worktree_path: worktreePath,
        status: 'active',
      });
      existingPaths.add(join(worktreePath, 'package.json'));

      const check = makeCheck();
      await runQualityCheck(check, '/workspace/project', { storyId: 'install-story' });

      const installCall = spawnCalls.find(
        (s) => s.args.includes('bun') && s.args.includes('install'),
      );
      expect(installCall).toBeDefined();
      expect(installCall!.cwd).toBe(worktreePath);
    });

    test('does not trigger ensureDependencies without storyId', async () => {
      const check = makeCheck();
      await runQualityCheck(check, '/workspace/project');

      const installCall = spawnCalls.find(
        (s) => s.args.includes('bun') && s.args.includes('install'),
      );
      expect(installCall).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // AC6: Backward compatibility
  // -----------------------------------------------------------------------
  describe('backward compatibility', () => {
    test('runQualityCheck works without options parameter', async () => {
      const check = makeCheck();
      const result = await runQualityCheck(check, '/workspace/project');

      expect(result.checkId).toBe('typecheck');
      expect(result.passed).toBe(true);
      expect(result.storyId).toBeUndefined();
    });

    test('runAllQualityChecks works without options parameter', async () => {
      const checks = [makeCheck(), makeCheck({ id: 'lint', name: 'ESLint', type: 'lint' })];
      const results = await runAllQualityChecks(checks, '/workspace/project');

      expect(results).toHaveLength(2);
      results.forEach((r) => expect(r.storyId).toBeUndefined());
    });

    test('runAllQualityChecks skips disabled checks', async () => {
      const checks = [
        makeCheck({ id: 'enabled', enabled: true }),
        makeCheck({ id: 'disabled', enabled: false }),
      ];
      const results = await runAllQualityChecks(checks, '/workspace/project');

      expect(results).toHaveLength(1);
      expect(results[0].checkId).toBe('enabled');
    });

    test('handles command execution failure gracefully', async () => {
      // Override spawn temporarily to simulate failure
      const savedSpawn = (Bun as any).spawn;
      (Bun as any).spawn = () => {
        throw new Error('Command not found');
      };

      const check = makeCheck();
      const result = await runQualityCheck(check, '/workspace/project', { storyId: 'fail-story' });

      expect(result.passed).toBe(false);
      expect(result.exitCode).toBe(-1);
      expect(result.storyId).toBe('fail-story');
      expect(result.output).toContain('Command not found');

      (Bun as any).spawn = savedSpawn;
    });
  });

  // -----------------------------------------------------------------------
  // QualityCheckResult shape
  // -----------------------------------------------------------------------
  describe('QualityCheckResult shape', () => {
    test('result has all required fields', async () => {
      const check = makeCheck();
      const result = await runQualityCheck(check, '/workspace/project');

      expect(result).toHaveProperty('checkId');
      expect(result).toHaveProperty('checkName');
      expect(result).toHaveProperty('checkType');
      expect(result).toHaveProperty('passed');
      expect(result).toHaveProperty('output');
      expect(result).toHaveProperty('duration');
      expect(result).toHaveProperty('exitCode');
    });

    test('duration is measured in milliseconds', async () => {
      const check = makeCheck();
      const result = await runQualityCheck(check, '/workspace/project');

      expect(typeof result.duration).toBe('number');
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    test('storyId field is optional in QualityCheckResult interface', async () => {
      const check = makeCheck();

      // Without storyId
      const result1 = await runQualityCheck(check, '/workspace/project');
      expect(result1.storyId).toBeUndefined();

      // With storyId
      const result2 = await runQualityCheck(check, '/workspace/project', { storyId: 'x' });
      expect(result2.storyId).toBe('x');
    });
  });
});
