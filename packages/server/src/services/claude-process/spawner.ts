import { execSync } from 'child_process';

// Check if `script` utility is available (util-linux) for PTY-wrapped spawning.
// This avoids native addon issues with node-pty in Bun.
export let hasScript = false;
try {
  execSync('which script', { stdio: 'ignore' });
  hasScript = true;
} catch {
  console.warn('[claude] `script` not available — pipe mode may buffer stdout');
}

/** Map signal number to name for diagnostic messages */
export function signalName(sig: number): string {
  const names: Record<number, string> = {
    1: 'SIGHUP',
    2: 'SIGINT',
    3: 'SIGQUIT',
    6: 'SIGABRT',
    9: 'SIGKILL',
    14: 'SIGALRM',
    15: 'SIGTERM',
  };
  return names[sig] || `SIG${sig}`;
}

/** Abstraction over Bun.spawn and node-pty so the streaming code works with either. */
export interface CliProcess {
  readonly pid: number;
  /** ReadableStream of stdout data (for pipe mode) or combined pty output. */
  readonly stdout: ReadableStream<Uint8Array>;
  /** Separate stderr stream (pipe mode only; null in PTY mode where stderr is merged). */
  readonly stderr: ReadableStream<Uint8Array> | null;
  /** Write to the process's stdin / pty input. */
  write(data: string): void;
  /** Kill the process. */
  kill(signal?: string): void;
  /** Promise that resolves with the exit code when the process exits. */
  readonly exited: Promise<number>;
  /** The exit code if the process has already exited, or null. */
  readonly exitCode: number | null;
}

/** Shell-escape a string for use in single-quoted shell arguments. */
export function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * Spawn the CLI wrapped in `script -qec` (allocates a real PTY via util-linux).
 * This forces the child process to see a TTY on stdout, preventing full-buffer mode
 * that causes the CLI to withhold output until its buffer fills or it exits.
 */
export function spawnWithScript(
  binary: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
): CliProcess {
  // Build shell-safe command string for `script -c`.
  // Disable PTY echo (stty -echo) so stdin writes aren't reflected in stdout.
  const escaped = [binary, ...args].map(shellEscape).join(' ');
  const command = `stty -echo 2>/dev/null; ${escaped}`;
  // -q: quiet (no "Script started/done" messages)
  // -e: return child's exit code (--return)
  // -c: command to run
  // /dev/null: typescript file (discard PTY recording)
  const proc = Bun.spawn(['script', '-qec', command, '/dev/null'], {
    cwd,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...env, TERM: 'dumb' },
  });

  return {
    get pid() {
      return proc.pid;
    },
    get stdout() {
      return proc.stdout as ReadableStream<Uint8Array>;
    },
    get stderr() {
      return proc.stderr as ReadableStream<Uint8Array>;
    },
    write(data: string) {
      try {
        const stdin = proc.stdin as any;
        if (stdin?.write) {
          stdin.write(new TextEncoder().encode(data));
          stdin.flush?.();
        }
      } catch {
        /* stdin closed */
      }
    },
    kill(signal?: string) {
      try {
        if (signal === 'SIGINT') proc.kill(2);
        else if (signal === 'SIGTERM') proc.kill(15);
        else proc.kill();
      } catch {
        /* already dead */
      }
    },
    get exited() {
      return proc.exited;
    },
    get exitCode() {
      return proc.exitCode;
    },
  };
}

/** Spawn the CLI using Bun.spawn (pipe mode — used as fallback if node-pty is unavailable). */
export function spawnWithPipe(
  binary: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
): CliProcess {
  const proc = Bun.spawn([binary, ...args], {
    cwd,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    env,
  });

  return {
    get pid() {
      return proc.pid;
    },
    get stdout() {
      return proc.stdout as ReadableStream<Uint8Array>;
    },
    get stderr() {
      return proc.stderr as ReadableStream<Uint8Array>;
    },
    write(data: string) {
      try {
        // Bun's proc.stdin is a FileSink, not a WritableStream
        const stdin = proc.stdin as any;
        if (stdin?.write) {
          stdin.write(new TextEncoder().encode(data));
          stdin.flush?.();
        }
      } catch {
        /* stdin closed */
      }
    },
    kill(signal?: string) {
      try {
        if (signal === 'SIGINT') proc.kill(2);
        else if (signal === 'SIGTERM') proc.kill(15);
        else proc.kill();
      } catch {
        /* already dead */
      }
    },
    get exited() {
      return proc.exited;
    },
    get exitCode() {
      return proc.exitCode;
    },
  };
}
