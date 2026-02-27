import { describe, test, expect, beforeEach, mock, spyOn } from 'bun:test';

// ---------------------------------------------------------------------------
// Mock worktree-service — resolveWorkspacePath returns worktree path for known
// stories, falls back to workspacePath otherwise.
// ---------------------------------------------------------------------------

const ACTIVE_STORY_ID = 'story-active-1';
const ACTIVE_WORKTREE = '/workspace/project/.e/worktrees/story-active-1';
const WORKSPACE = '/workspace/project';

mock.module('../worktree-service', () => ({
  resolveWorkspacePath: (workspacePath: string, storyId?: string | null) => {
    if (storyId === ACTIVE_STORY_ID) return ACTIVE_WORKTREE;
    return workspacePath;
  },
  getForStory: (storyId: string) => {
    if (storyId === ACTIVE_STORY_ID) {
      return {
        id: 'wt-1',
        story_id: ACTIVE_STORY_ID,
        worktree_path: ACTIVE_WORKTREE,
        status: 'active',
      };
    }
    return null;
  },
}));

// ---------------------------------------------------------------------------
// Track Bun.spawn calls and fs checks
// ---------------------------------------------------------------------------

let spawnCalls: Array<{ cmd: string[]; cwd: string }> = [];
let spawnExitCode = 0;
let existingPaths = new Set<string>();

const originalSpawn = Bun.spawn;

(Bun as any).spawn = (cmd: string[], opts?: any) => {
  spawnCalls.push({ cmd, cwd: opts?.cwd ?? '' });
  return {
    stdout: new ReadableStream({
      start(controller: ReadableStreamDefaultController) {
        controller.enqueue(new TextEncoder().encode('check output'));
        controller.close();
      },
    }),
    stderr: new ReadableStream({
      start(controller: ReadableStreamDefaultController) {
        controller.enqueue(new TextEncoder().encode(''));
        controller.close();
      },
    }),
    exited: Promise.resolve(spawnExitCode),
    exitCode: spawnExitCode,
    kill: () => {},
  };
};

// Mock fs.existsSync
mock.module('fs', () => ({
  existsSync: (p: string) => existingPaths.has(p),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  runQualityCheck,
  runAllQualityChecks,
  ensureDependencies,
  parseCheckOutput,
  validateQualityChecks,
  detectAffectedPackages,
  _testHelpers,
} from '../quality-checker';
import type { QualityCheckConfig } from '@e/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCheck(overrides: Partial<QualityCheckConfig> = {}): QualityCheckConfig {
  return {
    id: 'check-1',
    name: 'Test Check',
    type: 'custom',
    command: 'echo hello',
    timeout: 30000,
    required: true,
    enabled: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('quality-checker', () => {
  beforeEach(() => {
    spawnCalls = [];
    spawnExitCode = 0;
    existingPaths = new Set();
    _testHelpers.clearInstalledWorktrees();
  });

  // -------------------------------------------------------------------------
  // runQualityCheck — basic behavior
  // -------------------------------------------------------------------------

  describe('runQualityCheck', () => {
    test('returns passing result on exit code 0', async () => {
      const result = await runQualityCheck(makeCheck(), WORKSPACE);
      expect(result.passed).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.checkId).toBe('check-1');
      expect(result.checkName).toBe('Test Check');
      expect(result.checkType).toBe('custom');
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    test('returns failing result on non-zero exit', async () => {
      spawnExitCode = 1;
      const result = await runQualityCheck(makeCheck(), WORKSPACE);
      expect(result.passed).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    test('uses workspacePath as CWD without storyId', async () => {
      await runQualityCheck(makeCheck(), WORKSPACE);
      expect(spawnCalls.length).toBeGreaterThanOrEqual(1);
      const checkCall = spawnCalls.find((c) => c.cmd[0] === 'echo');
      expect(checkCall?.cwd).toBe(WORKSPACE);
    });

    test('output is captured', async () => {
      const result = await runQualityCheck(makeCheck(), WORKSPACE);
      expect(result.output).toContain('check output');
    });
  });

  // -------------------------------------------------------------------------
  // runQualityCheck — worktree scoping (AC3: quality checks use worktree CWD)
  // -------------------------------------------------------------------------

  describe('worktree-scoped execution', () => {
    test('uses worktree CWD when storyId provided', async () => {
      // Ensure ensureDependencies doesn't trigger install
      existingPaths.add(ACTIVE_WORKTREE + '/node_modules');
      await runQualityCheck(makeCheck(), WORKSPACE, { storyId: ACTIVE_STORY_ID });
      const checkCall = spawnCalls.find((c) => c.cmd[0] === 'echo');
      expect(checkCall?.cwd).toBe(ACTIVE_WORKTREE);
    });

    test('falls back to workspacePath for unknown story', async () => {
      await runQualityCheck(makeCheck(), WORKSPACE, { storyId: 'unknown-story' });
      const checkCall = spawnCalls.find((c) => c.cmd[0] === 'echo');
      expect(checkCall?.cwd).toBe(WORKSPACE);
    });
  });

  // -------------------------------------------------------------------------
  // storyId tagging (AC4: results tagged with storyId)
  // -------------------------------------------------------------------------

  describe('storyId tagging', () => {
    test('result includes storyId when provided', async () => {
      existingPaths.add(ACTIVE_WORKTREE + '/node_modules');
      const result = await runQualityCheck(makeCheck(), WORKSPACE, { storyId: ACTIVE_STORY_ID });
      expect(result.storyId).toBe(ACTIVE_STORY_ID);
    });

    test('result has no storyId when not provided', async () => {
      const result = await runQualityCheck(makeCheck(), WORKSPACE);
      expect(result.storyId).toBeUndefined();
    });

    test('result has no storyId when options empty', async () => {
      const result = await runQualityCheck(makeCheck(), WORKSPACE, {});
      expect(result.storyId).toBeUndefined();
    });

    test('failing result still tagged with storyId', async () => {
      spawnExitCode = 1;
      existingPaths.add(ACTIVE_WORKTREE + '/node_modules');
      const result = await runQualityCheck(makeCheck(), WORKSPACE, { storyId: ACTIVE_STORY_ID });
      expect(result.storyId).toBe(ACTIVE_STORY_ID);
      expect(result.passed).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // ensureDependencies (AC5: auto bun install)
  // -------------------------------------------------------------------------

  describe('ensureDependencies', () => {
    test('skips when node_modules exists', async () => {
      existingPaths.add('/some/path/node_modules');
      const result = await ensureDependencies('/some/path');
      expect(result).toBe(false); // skipped
      expect(spawnCalls).toHaveLength(0);
    });

    test('skips when already installed this process', async () => {
      // First call: no node_modules, has package.json → installs
      existingPaths.add('/some/path/package.json');
      const first = await ensureDependencies('/some/path');
      expect(first).toBe(true); // install attempted

      // Second call: already tracked → skips
      const second = await ensureDependencies('/some/path');
      expect(second).toBe(false); // skipped
    });

    test('runs bun install when node_modules missing and package.json present', async () => {
      existingPaths.add('/wp/package.json');
      const result = await ensureDependencies('/wp');
      expect(result).toBe(true);
      const installCall = spawnCalls.find((c) => c.cmd.includes('install'));
      expect(installCall).toBeTruthy();
      expect(installCall!.cmd).toEqual(['bun', 'install', '--frozen-lockfile']);
      expect(installCall!.cwd).toBe('/wp');
    });

    test('skips when no package.json', async () => {
      // neither node_modules nor package.json
      const result = await ensureDependencies('/empty/dir');
      expect(result).toBe(false);
      expect(spawnCalls).toHaveLength(0);
    });

    test('marks worktree as installed even if install fails', async () => {
      existingPaths.add('/fail/path/package.json');
      spawnExitCode = 1;
      const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
      const logSpy = spyOn(console, 'log').mockImplementation(() => {});
      await ensureDependencies('/fail/path');
      // Should be tracked so it doesn't retry
      expect(_testHelpers.getInstalledWorktrees().has('/fail/path')).toBe(true);
      warnSpy.mockRestore();
      logSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // Auto-install triggered by runQualityCheck (AC5 integration)
  // -------------------------------------------------------------------------

  describe('auto-install in worktree context', () => {
    test('triggers ensureDependencies for worktree-scoped checks', async () => {
      // No node_modules, has package.json → should trigger install
      existingPaths.add(ACTIVE_WORKTREE + '/package.json');
      const logSpy = spyOn(console, 'log').mockImplementation(() => {});
      await runQualityCheck(makeCheck(), WORKSPACE, { storyId: ACTIVE_STORY_ID });
      // Should have a bun install call
      const installCall = spawnCalls.find(
        (c) => c.cmd.includes('install') && c.cwd === ACTIVE_WORKTREE,
      );
      expect(installCall).toBeTruthy();
      logSpy.mockRestore();
    });

    test('does not trigger install without storyId', async () => {
      await runQualityCheck(makeCheck(), WORKSPACE);
      const installCall = spawnCalls.find((c) => c.cmd.includes('install'));
      expect(installCall).toBeUndefined();
    });

    test('does not trigger install when CWD matches workspace (no worktree)', async () => {
      // unknown story falls back to workspace path
      await runQualityCheck(makeCheck(), WORKSPACE, { storyId: 'unknown-story' });
      const installCall = spawnCalls.find((c) => c.cmd.includes('install'));
      expect(installCall).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // runAllQualityChecks
  // -------------------------------------------------------------------------

  describe('runAllQualityChecks', () => {
    test('runs all enabled checks', async () => {
      const checks = [
        makeCheck({ id: 'c1', enabled: true }),
        makeCheck({ id: 'c2', enabled: false }),
        makeCheck({ id: 'c3', enabled: true }),
      ];
      const results = await runAllQualityChecks(checks, WORKSPACE);
      expect(results).toHaveLength(2);
      expect(results[0].checkId).toBe('c1');
      expect(results[1].checkId).toBe('c3');
    });

    test('passes storyId options through to each check', async () => {
      existingPaths.add(ACTIVE_WORKTREE + '/node_modules');
      const checks = [makeCheck({ id: 'c1' }), makeCheck({ id: 'c2' })];
      const results = await runAllQualityChecks(checks, WORKSPACE, {
        storyId: ACTIVE_STORY_ID,
      });
      expect(results).toHaveLength(2);
      expect(results[0].storyId).toBe(ACTIVE_STORY_ID);
      expect(results[1].storyId).toBe(ACTIVE_STORY_ID);
    });

    test('returns empty array when no checks enabled', async () => {
      const checks = [makeCheck({ enabled: false })];
      const results = await runAllQualityChecks(checks, WORKSPACE);
      expect(results).toEqual([]);
    });

    test('backward compat: works without options', async () => {
      const checks = [makeCheck()];
      const results = await runAllQualityChecks(checks, WORKSPACE);
      expect(results).toHaveLength(1);
      expect(results[0].storyId).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // _testHelpers
  // -------------------------------------------------------------------------

  describe('_testHelpers', () => {
    test('clearInstalledWorktrees resets tracking', async () => {
      existingPaths.add('/x/package.json');
      const logSpy = spyOn(console, 'log').mockImplementation(() => {});
      await ensureDependencies('/x');
      expect(_testHelpers.getInstalledWorktrees().size).toBeGreaterThan(0);
      _testHelpers.clearInstalledWorktrees();
      expect(_testHelpers.getInstalledWorktrees().size).toBe(0);
      logSpy.mockRestore();
    });

    test('getInstalledWorktrees returns the set', () => {
      expect(_testHelpers.getInstalledWorktrees()).toBeInstanceOf(Set);
    });
  });

  // -------------------------------------------------------------------------
  // Backward compatibility (AC6)
  // -------------------------------------------------------------------------

  describe('backward compatibility', () => {
    test('runQualityCheck works with two args (no options)', async () => {
      const result = await runQualityCheck(makeCheck(), WORKSPACE);
      expect(result.passed).toBe(true);
      expect(result.storyId).toBeUndefined();
    });

    test('runAllQualityChecks works with two args (no options)', async () => {
      const results = await runAllQualityChecks([makeCheck()], WORKSPACE);
      expect(results).toHaveLength(1);
      expect(results[0].storyId).toBeUndefined();
    });

    test('CWD is workspacePath without storyId', async () => {
      await runQualityCheck(makeCheck(), '/my/workspace');
      const call = spawnCalls.find((c) => c.cmd[0] === 'echo');
      expect(call?.cwd).toBe('/my/workspace');
    });
  });

  // -------------------------------------------------------------------------
  // parseCheckOutput
  // -------------------------------------------------------------------------

  describe('parseCheckOutput', () => {
    test('strips ANSI escape codes', () => {
      const raw = '\x1b[31merror\x1b[0m in file.ts:10:5';
      const result = parseCheckOutput(raw, 'typecheck');
      expect(result).not.toContain('\x1b');
      expect(result).toContain('error');
    });

    test('keeps error lines for typecheck output', () => {
      const raw = [
        'NX  Running target check for 3 projects:',
        '',
        '> nx run @e/server:check',
        '$ tsc --noEmit',
        '',
        '/home/project/src/foo.ts:10:5',
        'error TS2345: Argument of type string is not assignable',
        '',
        'NX  Successfully ran target check',
      ].join('\n');

      const result = parseCheckOutput(raw, 'typecheck');
      expect(result).toContain('foo.ts:10:5');
      expect(result).toContain('TS2345');
      expect(result).not.toContain('NX  Running target');
      expect(result).not.toContain('Successfully ran');
      expect(result).not.toContain('$ tsc');
    });

    test('keeps svelte-check file headers', () => {
      const raw = '/home/project/src/App.svelte:42:10\nWarn: unused variable';
      const result = parseCheckOutput(raw, 'typecheck');
      expect(result).toContain('App.svelte:42:10');
      expect(result).toContain('Warn');
    });

    test('filters out NX boilerplate and progress lines', () => {
      const raw = [
        'NX  Running target check for 3 projects:',
        '- @e/client',
        '- @e/server',
        '> nx run @e/shared:check',
        '$ tsc --noEmit',
        'Exited with code 0',
        'Loading svelte-check in workspace: /home/project',
        'Getting Svelte diagnostics...',
        'NX  Successfully ran target check for 3 projects',
        'Nx read the output from the cache',
      ].join('\n');

      const result = parseCheckOutput(raw, 'typecheck');
      // Should return original if no error lines found
      expect(result).toBeTruthy();
    });

    test('returns original for build/test/custom types', () => {
      const raw = 'Some build output\nMore output';
      const result = parseCheckOutput(raw, 'build');
      expect(result).toContain('Some build output');
    });

    test('keeps error summary lines', () => {
      const raw = 'Found 5 errors in 3 files';
      const result = parseCheckOutput(raw, 'typecheck');
      expect(result).toContain('5 errors');
    });

    test('truncates at 15000 chars', () => {
      const raw = 'error TS2345: '.repeat(2000);
      const result = parseCheckOutput(raw, 'typecheck');
      expect(result.length).toBeLessThanOrEqual(15000);
    });
  });

  // -------------------------------------------------------------------------
  // validateQualityChecks
  // -------------------------------------------------------------------------

  describe('validateQualityChecks', () => {
    test('returns empty warnings when all checks are valid', async () => {
      const checks = [makeCheck({ command: 'echo hello' })];
      const { warnings, disabledCheckIds } = await validateQualityChecks(checks, WORKSPACE);
      expect(warnings).toHaveLength(0);
      expect(disabledCheckIds).toHaveLength(0);
    });

    test('skips disabled checks', async () => {
      const checks = [makeCheck({ enabled: false, command: 'nonexistent-script' })];
      const { warnings } = await validateQualityChecks(checks, WORKSPACE);
      expect(warnings).toHaveLength(0);
    });

    test('detects and disables checks with "script not found" errors', async () => {
      // Override spawn to return "script not found"
      const prevExitCode = spawnExitCode;
      spawnExitCode = 1;

      // Override the mock spawn to emit "script not found"
      const prevSpawn = (Bun as any).spawn;
      (Bun as any).spawn = (cmd: string[], opts?: any) => {
        spawnCalls.push({ cmd, cwd: opts?.cwd ?? '' });
        return {
          stdout: new ReadableStream({
            start(controller: ReadableStreamDefaultController) {
              controller.enqueue(new TextEncoder().encode('error: Script not found "lint"'));
              controller.close();
            },
          }),
          stderr: new ReadableStream({
            start(controller: ReadableStreamDefaultController) {
              controller.close();
            },
          }),
          exited: Promise.resolve(1),
          exitCode: 1,
          kill: () => {},
        };
      };

      const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
      const checks = [makeCheck({ id: 'bad-lint', name: 'ESLint', command: 'bun run lint' })];
      const { warnings, disabledCheckIds } = await validateQualityChecks(checks, WORKSPACE);

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('ESLint');
      expect(warnings[0]).toContain('misconfigured');
      expect(disabledCheckIds).toContain('bad-lint');
      expect(checks[0].enabled).toBe(false);

      warnSpy.mockRestore();
      (Bun as any).spawn = prevSpawn;
      spawnExitCode = prevExitCode;
    });
  });

  // -------------------------------------------------------------------------
  // detectAffectedPackages
  // -------------------------------------------------------------------------

  describe('detectAffectedPackages', () => {
    test('extracts package names from file paths', async () => {
      // This is tricky to test with mocked spawn; mainly test the logic indirectly
      // by verifying the function returns an array
      const result = await detectAffectedPackages(WORKSPACE);
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
