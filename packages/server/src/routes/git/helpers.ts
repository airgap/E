import { resolve } from 'path';

// ---------------------------------------------------------------------------
// Helpers for safe Bun.spawn — always consume piped streams to prevent deadlocks
// ---------------------------------------------------------------------------

/**
 * Run a command and return { stdout, stderr, exitCode }.
 * Reads both stdout and stderr concurrently so the process never blocks
 * waiting on a full pipe buffer (classic deadlock with Bun.spawn 'pipe' mode).
 *
 * @param opts.timeoutMs — kill the process after this many ms (default: 120 000 = 2 min).
 *   Pass 0 to disable the timeout entirely.
 */
export async function run(
  args: string[],
  opts: { cwd: string; timeoutMs?: number },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const timeout = opts.timeoutMs ?? 120_000;
  const proc = Bun.spawn(args, {
    cwd: opts.cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  let killed = false;

  if (timeout > 0) {
    timer = setTimeout(() => {
      killed = true;
      proc.kill('SIGTERM');
      // Force-kill if SIGTERM is ignored after 5s
      setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {
          /* already dead */
        }
      }, 5_000);
    }, timeout);
  }

  // Read both streams concurrently to avoid deadlock
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  if (timer) clearTimeout(timer);

  if (killed) {
    return {
      stdout,
      stderr: `${stderr}\nProcess timed out after ${Math.round(timeout / 1000)}s and was killed.`,
      exitCode: exitCode || 124, // 124 = timeout (like GNU timeout)
    };
  }

  return { stdout, stderr, exitCode };
}

/**
 * Run a command and return only the exit code.
 * Discards stdout/stderr safely (inherits to parent process).
 */
export async function runExitCode(args: string[], opts: { cwd: string }): Promise<number> {
  const proc = Bun.spawn(args, {
    cwd: opts.cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  // Consume both to prevent deadlock, even though we discard the content
  await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return proc.exited;
}

/**
 * Validate that a path is a plausible workspace directory.
 * Prevents path traversal attacks via the cwd parameter.
 */
export function validateWorkspacePath(rawPath: string): {
  valid: boolean;
  resolved: string;
  reason?: string;
} {
  const resolved = resolve(rawPath);

  // Block obvious system directories that shouldn't be used as cwd
  const blockedPrefixes = ['/proc', '/sys', '/dev', '/boot', '/sbin'];
  for (const prefix of blockedPrefixes) {
    if (resolved.startsWith(prefix)) {
      return { valid: false, resolved, reason: `Path ${prefix} is not a valid workspace` };
    }
  }

  return { valid: true, resolved };
}

/**
 * Parse raw git commit failure output into a concise, human-readable summary.
 * Pre-commit hooks (lint-staged, typecheck, tests) produce large output — we
 * extract the key failure reason so the user doesn't have to scroll through it.
 */
export function parseCommitFailure(stderr: string, stdout: string): string {
  const combined = `${stderr}\n${stdout}`;

  // Pre-commit hook failure
  if (combined.includes('pre-commit hook') || combined.includes('husky')) {
    // Look for test failures — only report when the fail count is actually > 0.
    // The previous regex matched "0 failed" from passing-test output and
    // incorrectly reported "0 tests failed".
    const allFailMatches = [...combined.matchAll(/(\d+)\s+fail(?:ed|ure|s|ing)?/gi)];
    const actualFailCount = allFailMatches.map((m) => parseInt(m[1], 10)).find((n) => n > 0);
    if (actualFailCount) {
      const testPassMatch = combined.match(/(\d+)\s+pass/i);
      const passCount = testPassMatch?.[1] ?? '?';
      return `Pre-commit hook failed: ${actualFailCount} test(s) failed (${passCount} passed). Fix failing tests or commit with --no-verify.`;
    }

    // Look for typecheck errors (only when count > 0)
    const errorMatch = combined.match(/found\s+(\d+)\s+error/i);
    if (errorMatch && parseInt(errorMatch[1], 10) > 0) {
      return `Pre-commit hook failed: ${errorMatch[1]} type error(s). Fix type errors or commit with --no-verify.`;
    }

    // Look for lint-staged / prettier errors
    if (combined.includes('lint-staged') && combined.includes('failed')) {
      return 'Pre-commit hook failed: lint-staged reported formatting errors. Run your formatter and try again.';
    }

    // Look for nx task failures (e.g. "Failed tasks: project:check")
    const nxFailMatch = combined.match(/Failed tasks?:\s*(.+)/i);
    if (nxFailMatch) {
      return `Pre-commit hook failed: ${nxFailMatch[1].trim()}. Check the output above for details.`;
    }

    // Look for non-zero exit codes from hook scripts
    const scriptExit = combined.match(/exited with code\s+([1-9]\d*)/i);
    if (scriptExit) {
      return `Pre-commit hook failed (exit code ${scriptExit[1]}). Check the output above for details.`;
    }

    // Generic hook failure
    return 'Pre-commit hook failed. Check the output above for details, or commit with --no-verify to skip hooks.';
  }

  // Exit code from a script
  if (combined.includes('exited with code') || combined.includes('Exited with code')) {
    const exitMatch = combined.match(/[Ee]xited? with code\s+(\d+)/);
    const scriptMatch = combined.match(/script\s+"([^"]+)"\s+exited/);
    if (scriptMatch && exitMatch) {
      return `Commit aborted: "${scriptMatch[1]}" failed (exit ${exitMatch[1]}). Fix the issue or commit with --no-verify.`;
    }
  }

  // Nothing to commit
  if (combined.includes('nothing to commit')) {
    return 'Nothing to commit — working tree clean.';
  }

  // Empty commit message
  if (
    combined.includes('empty commit message') ||
    combined.includes('Aborting commit due to empty')
  ) {
    return 'Commit aborted: empty commit message.';
  }

  // Truncate raw message to something readable
  const firstLine =
    (stderr || stdout)
      .split('\n')
      .filter((l) => l.trim())
      .pop() || 'Unknown error';
  return `git commit failed: ${firstLine.length > 200 ? firstLine.slice(0, 200) + '\u2026' : firstLine}`;
}

/** Shared type for diagnostic checks */
export interface DiagnosticCheck {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  detail?: string;
}
