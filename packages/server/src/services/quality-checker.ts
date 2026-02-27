import { existsSync } from 'fs';
import { join } from 'path';
import type { QualityCheckConfig, QualityCheckResult } from '@e/shared';
import { resolveWorkspacePath } from './worktree-service';

/**
 * Strip ANSI escape codes from a string.
 */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

/**
 * Parse raw typecheck / lint / build output and extract only meaningful
 * error and warning lines. Strips ANSI codes, NX boilerplate, progress
 * lines, and empty filler so the agent sees only actionable diagnostics.
 *
 * Returns filtered output (or the original if no filtering was productive).
 */
export function parseCheckOutput(raw: string, checkType: string): string {
  const clean = stripAnsi(raw);
  const lines = clean.split('\n');

  if (checkType === 'typecheck' || checkType === 'lint') {
    // Keep lines that contain error indicators or file paths with diagnostics
    const errorLines = lines.filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;

      // Keep actual error/warning lines (file:line:col patterns, Error/error, TS errors)
      if (/\.(ts|js|svelte|tsx|jsx)[:()]\d+/.test(trimmed)) return true;
      if (/\b(Error|error|ERR!|TS\d{4,5})\b/.test(trimmed)) return true;
      if (/\b(Warn|warn|Warning|warning)\b/.test(trimmed)) return true;
      if (trimmed.startsWith('×') || trimmed.startsWith('✖')) return true;

      // Keep Svelte diagnostic context (indented code snippets after error lines)
      if (/^\s{2,}/.test(line) && /[|>]/.test(trimmed)) return true;

      // Keep "X error(s) found" summary lines
      if (/\d+\s+(error|warning|problem)/.test(trimmed)) return true;

      // Keep file headers from svelte-check
      if (trimmed.startsWith('/') && /\.(ts|js|svelte|tsx|jsx)/.test(trimmed)) return true;

      // Filter out: NX runner lines, "Running target", "Successfully ran", timing, dashes
      if (/^\s*NX\s/.test(trimmed)) return false;
      if (/Running target|Successfully ran|read the output|Nx read/.test(trimmed)) return false;
      if (/^[-=]+$/.test(trimmed)) return false;
      if (/^\$\s/.test(trimmed)) return false; // command echoes like "$ tsc --noEmit"
      if (/^>\s*nx run/.test(trimmed)) return false;
      if (/Exited with code \d/.test(trimmed)) return false;
      if (/Getting Svelte diagnostics/.test(trimmed)) return false;
      if (/Loading svelte-check/.test(trimmed)) return false;

      return false;
    });

    // If we filtered too aggressively (no error lines found), return the original
    if (errorLines.length === 0) return clean.slice(0, 15000);

    return errorLines.join('\n').slice(0, 15000);
  }

  // For build/test/custom checks, just strip ANSI codes
  return clean.slice(0, 15000);
}

/**
 * Options for running quality checks, optionally scoped to a story's worktree.
 */
export interface QualityCheckOptions {
  /** Story ID — when provided, CWD resolves to the story's worktree path */
  storyId?: string;
}

/**
 * Track which worktree paths have already had `bun install` run,
 * to avoid running it multiple times per worktree within a process lifetime.
 */
const installedWorktrees = new Set<string>();

/** @internal — exposed for testing */
export const _testHelpers = {
  getInstalledWorktrees: () => installedWorktrees,
  clearInstalledWorktrees: () => installedWorktrees.clear(),
};

/**
 * Ensure node_modules exists in the given directory.
 * If missing, runs `bun install --frozen-lockfile` once per worktree.
 * Returns true if install was run, false if already present.
 */
export async function ensureDependencies(cwd: string): Promise<boolean> {
  const nodeModulesPath = join(cwd, 'node_modules');

  // Already installed in this process lifetime
  if (installedWorktrees.has(cwd)) {
    return false;
  }

  // node_modules already exists on disk
  if (existsSync(nodeModulesPath)) {
    installedWorktrees.add(cwd);
    return false;
  }

  // Need to install — check for a package.json first (no package.json = not a JS project)
  const packageJsonPath = join(cwd, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return false;
  }

  console.log(
    `[quality-checker] node_modules missing in ${cwd}, running bun install --frozen-lockfile`,
  );

  try {
    const proc = Bun.spawn(['bun', 'install', '--frozen-lockfile'], {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, FORCE_COLOR: '0', CI: '1' },
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    if (exitCode === 0) {
      console.log(`[quality-checker] bun install succeeded in ${cwd}`);
      installedWorktrees.add(cwd);
      return true;
    } else {
      console.error(
        `[quality-checker] bun install failed in ${cwd} (exit ${exitCode}): ${(stdout + '\n' + stderr).trim().slice(0, 1000)}`,
      );
      // Mark as attempted to avoid retrying every check
      installedWorktrees.add(cwd);
      return true;
    }
  } catch (err) {
    console.error(`[quality-checker] bun install error in ${cwd}:`, err);
    // Mark as attempted
    installedWorktrees.add(cwd);
    return true;
  }
}

/**
 * Run a single quality check by spawning the configured command.
 *
 * When `options.storyId` is provided, the CWD is resolved to the story's
 * worktree path and the result is tagged with the storyId.
 */
export async function runQualityCheck(
  check: QualityCheckConfig,
  workspacePath: string,
  options?: QualityCheckOptions,
): Promise<QualityCheckResult> {
  const start = Date.now();
  const storyId = options?.storyId;

  // Resolve CWD: use worktree path if story context is active
  const cwd = resolveWorkspacePath(workspacePath, storyId);

  try {
    // Auto-install dependencies if node_modules is missing in the worktree
    if (storyId) {
      await ensureDependencies(cwd);
    }

    // Split command respecting quotes
    const parts = check.command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [check.command];
    const cleanParts = parts.map((p) => p.replace(/^["']|["']$/g, ''));

    const proc = Bun.spawn(cleanParts, {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, FORCE_COLOR: '0', CI: '1' },
    });

    // Track whether we killed the process due to timeout
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      console.warn(
        `[quality-checker] Killing "${check.name}" (${check.command}) after ${check.timeout}ms timeout`,
      );
      proc.kill();
    }, check.timeout);

    // Read stdout and stderr concurrently to prevent pipe buffer deadlocks.
    // Sequential reads can deadlock when one pipe fills its OS buffer (~64KB)
    // while the parent is blocked reading the other pipe.
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    clearTimeout(timeoutId);

    const rawOutput = (stdout + '\n' + stderr).trim();
    const passed = exitCode === 0;

    if (!passed) {
      console.warn(
        `[quality-checker] "${check.name}" failed: exitCode=${exitCode}, timedOut=${timedOut}, duration=${Date.now() - start}ms, cwd=${cwd}`,
      );
    }

    const result: QualityCheckResult = {
      checkId: check.id,
      checkName: check.name,
      checkType: check.type,
      passed,
      output: passed
        ? rawOutput.slice(0, 15000)
        : timedOut
          ? `[TIMEOUT] Check killed after ${check.timeout}ms. Partial output:\n${parseCheckOutput(rawOutput, check.type)}`
          : parseCheckOutput(rawOutput, check.type),
      duration: Date.now() - start,
      exitCode,
      timedOut,
    };
    if (storyId) result.storyId = storyId;
    return result;
  } catch (err) {
    console.error(
      `[quality-checker] "${check.name}" threw exception: ${String(err).slice(0, 500)}`,
    );
    const result: QualityCheckResult = {
      checkId: check.id,
      checkName: check.name,
      checkType: check.type,
      passed: false,
      output: String(err).slice(0, 5000),
      duration: Date.now() - start,
      exitCode: -1,
    };
    if (storyId) result.storyId = storyId;
    return result;
  }
}

/**
 * Validate that all enabled quality check commands are executable.
 * Catches misconfigured checks (e.g. "Script not found") before the loop
 * wastes attempts on them. Returns an array of warnings for checks that
 * appear broken; these checks are auto-disabled so the loop can proceed.
 */
export async function validateQualityChecks(
  checks: QualityCheckConfig[],
  workspacePath: string,
): Promise<{ warnings: string[]; disabledCheckIds: string[] }> {
  const warnings: string[] = [];
  const disabledCheckIds: string[] = [];

  for (const check of checks) {
    if (!check.enabled) continue;

    // Quick validation: run the command with a very short timeout to detect
    // "Script not found", "command not found", etc.
    try {
      const parts = check.command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [check.command];
      const cleanParts = parts.map((p) => p.replace(/^["']|["']$/g, ''));

      const proc = Bun.spawn(cleanParts, {
        cwd: workspacePath,
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, FORCE_COLOR: '0', CI: '1' },
      });

      // Give it 15s max — we just need to see if the command starts
      const timeoutId = setTimeout(() => proc.kill(), 15_000);
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      clearTimeout(timeoutId);

      const combinedOutput = (stdout + '\n' + stderr).toLowerCase();

      // Detect "Script not found" style failures — these will never succeed
      const isScriptNotFound =
        combinedOutput.includes('script not found') ||
        combinedOutput.includes('command not found') ||
        (combinedOutput.includes('not found') &&
          exitCode !== 0 &&
          combinedOutput.includes('error'));

      if (isScriptNotFound) {
        const msg = `Quality check "${check.name}" (${check.command}) appears misconfigured: ${(stdout + '\n' + stderr).trim().slice(0, 200)}. Auto-disabling this check.`;
        warnings.push(msg);
        disabledCheckIds.push(check.id);
        check.enabled = false;
        console.warn(`[quality-checker] ${msg}`);
      }
    } catch (err) {
      const msg = `Quality check "${check.name}" (${check.command}) failed to execute: ${String(err).slice(0, 200)}. Auto-disabling this check.`;
      warnings.push(msg);
      disabledCheckIds.push(check.id);
      check.enabled = false;
      console.warn(`[quality-checker] ${msg}`);
    }
  }

  return { warnings, disabledCheckIds };
}

/**
 * Detect which monorepo packages were modified by looking at git status.
 * Returns an array of affected package directory names (e.g. ['client', 'shared']).
 * Falls back to empty array (run all checks) if detection fails.
 */
export async function detectAffectedPackages(workspacePath: string): Promise<string[]> {
  try {
    const proc = Bun.spawn(['git', 'diff', '--name-only', 'HEAD'], {
      cwd: workspacePath,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const output = (await new Response(proc.stdout).text()).trim();
    await proc.exited;

    if (!output) {
      // Also check untracked files
      const statusProc = Bun.spawn(['git', 'status', '--porcelain'], {
        cwd: workspacePath,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const statusOutput = (await new Response(statusProc.stdout).text()).trim();
      await statusProc.exited;
      if (!statusOutput) return [];

      const files = statusOutput.split('\n').map((l) => l.trim().slice(3));
      return extractPackageNames(files);
    }

    return extractPackageNames(output.split('\n'));
  } catch {
    return [];
  }
}

/**
 * Extract unique package directory names from file paths.
 * Handles patterns like "packages/client/src/..." → "client"
 */
function extractPackageNames(files: string[]): string[] {
  const packages = new Set<string>();
  for (const file of files) {
    // Match "packages/<name>/..." pattern
    const match = file.match(/^packages\/([^/]+)\//);
    if (match) {
      packages.add(match[1]);
    }
  }
  return Array.from(packages);
}

// --- Placeholder / Stub Detection ---

/** File extensions to scan for placeholder patterns */
const PLACEHOLDER_SCAN_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.svelte',
  '.py',
  '.rs',
  '.go',
]);

/** Patterns that indicate placeholder / stub code */
const PLACEHOLDER_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  // JavaScript / TypeScript
  {
    pattern: /throw\s+new\s+Error\(\s*['"`](not implemented|TODO|FIXME|stub|placeholder)/i,
    label: 'throw not-implemented error',
  },
  {
    pattern: /\/\/\s*(TODO|FIXME|HACK|XXX)\b/i,
    label: 'TODO/FIXME comment',
  },
  {
    pattern: /\/\*\s*(TODO|FIXME|HACK|XXX)\b/i,
    label: 'TODO/FIXME block comment',
  },
  {
    pattern: /console\.(log|warn|error)\(\s*['"`](placeholder|stub|todo|fixme|not implemented)/i,
    label: 'placeholder console output',
  },
  // Python
  {
    pattern: /pass\s+#\s*(placeholder|TODO|FIXME|stub)/i,
    label: 'Python placeholder pass',
  },
  {
    pattern: /raise\s+NotImplementedError/,
    label: 'Python NotImplementedError',
  },
  // Rust
  { pattern: /\bunimplemented!\s*\(/, label: 'Rust unimplemented!()' },
  { pattern: /\btodo!\s*\(/, label: 'Rust todo!()' },
  // Go
  { pattern: /panic\(\s*["']not implemented/i, label: 'Go panic not-implemented' },
];

export interface PlaceholderViolation {
  file: string;
  line: number;
  pattern: string;
  content: string;
}

/**
 * Scan files changed by the agent for placeholder / stub patterns.
 * Returns a QualityCheckResult-compatible result.
 */
export async function runPlaceholderCheck(
  workspacePath: string,
  options?: QualityCheckOptions,
): Promise<QualityCheckResult> {
  const start = Date.now();
  const storyId = options?.storyId;
  const cwd = resolveWorkspacePath(workspacePath, storyId);
  const violations: PlaceholderViolation[] = [];

  try {
    // Get list of changed/new files via git
    const diffProc = Bun.spawn(['git', 'diff', '--name-only', 'HEAD'], {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const diffOutput = (await new Response(diffProc.stdout).text()).trim();
    await diffProc.exited;

    // Also include untracked files
    const statusProc = Bun.spawn(['git', 'ls-files', '--others', '--exclude-standard'], {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const untrackedOutput = (await new Response(statusProc.stdout).text()).trim();
    await statusProc.exited;

    const allFiles = new Set<string>();
    if (diffOutput) diffOutput.split('\n').forEach((f) => allFiles.add(f.trim()));
    if (untrackedOutput) untrackedOutput.split('\n').forEach((f) => allFiles.add(f.trim()));

    // Scan each file that has a scannable extension
    for (const relPath of allFiles) {
      const ext = relPath.slice(relPath.lastIndexOf('.'));
      if (!PLACEHOLDER_SCAN_EXTENSIONS.has(ext)) continue;

      const fullPath = join(cwd, relPath);
      try {
        const file = Bun.file(fullPath);
        if (!(await file.exists())) continue;
        const content = await file.text();
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          for (const { pattern, label } of PLACEHOLDER_PATTERNS) {
            if (pattern.test(line)) {
              violations.push({
                file: relPath,
                line: i + 1,
                pattern: label,
                content: line.trim().slice(0, 120),
              });
            }
          }
        }
      } catch {
        // Skip files we can't read
      }
    }

    const passed = violations.length === 0;
    let output: string;
    if (passed) {
      output = 'No placeholder or stub code detected in changed files.';
    } else {
      output = `Found ${violations.length} placeholder/stub violation(s):\n\n`;
      for (const v of violations) {
        output += `  ${v.file}:${v.line} — ${v.pattern}\n    ${v.content}\n\n`;
      }
      output +=
        'All functions must have complete, working implementations. Remove TODOs, stubs, and placeholder code.';
    }

    const result: QualityCheckResult = {
      checkId: '__placeholder__',
      checkName: 'Placeholder Detection',
      checkType: 'placeholder',
      passed,
      output,
      duration: Date.now() - start,
      exitCode: passed ? 0 : 1,
    };
    if (storyId) result.storyId = storyId;
    return result;
  } catch (err) {
    const result: QualityCheckResult = {
      checkId: '__placeholder__',
      checkName: 'Placeholder Detection',
      checkType: 'placeholder',
      passed: true, // Don't block on infrastructure errors
      output: `Placeholder check error: ${String(err).slice(0, 500)}`,
      duration: Date.now() - start,
      exitCode: 0,
    };
    if (storyId) result.storyId = storyId;
    return result;
  }
}

/**
 * Run all enabled quality checks sequentially, plus built-in checks
 * like placeholder detection.
 *
 * When `options.storyId` is provided, all checks run in the story's
 * worktree directory and results are tagged with the storyId.
 */
export async function runAllQualityChecks(
  checks: QualityCheckConfig[],
  workspacePath: string,
  options?: QualityCheckOptions,
): Promise<QualityCheckResult[]> {
  const enabledChecks = checks.filter((c) => c.enabled);
  const results: QualityCheckResult[] = [];
  for (const check of enabledChecks) {
    if (check.type === 'placeholder') {
      // Built-in placeholder check — no external command needed
      results.push(await runPlaceholderCheck(workspacePath, options));
    } else {
      results.push(await runQualityCheck(check, workspacePath, options));
    }
  }
  return results;
}
