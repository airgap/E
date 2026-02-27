// ---------------------------------------------------------------------------
// SSH Client Abstraction
// ---------------------------------------------------------------------------
// Wraps SSH command execution via Bun.spawn for connecting to remote hosts.
// Supports key-file auth and SSH agent forwarding.
// Works transparently with Tailscale hostnames (.ts.net domains).
// ---------------------------------------------------------------------------

import type { RemoteHostConfig } from '@e/shared';

/** Result of an SSH command execution. */
export interface SSHCommandResult {
  /** Exit code (0 = success). */
  exitCode: number;
  /** Standard output. */
  stdout: string;
  /** Standard error output. */
  stderr: string;
  /** Whether the command timed out. */
  timedOut: boolean;
}

/**
 * SSH Client — executes commands on remote hosts via OpenSSH.
 *
 * AC3: SSHs to target host, transfers story spec, launches headless golem binary.
 * AC4: Supports both password-less SSH key auth and SSH agent forwarding.
 * AC5: Tailscale hostnames work transparently.
 */
export class SSHClient {
  private hostConfig: RemoteHostConfig;

  constructor(hostConfig: RemoteHostConfig) {
    this.hostConfig = hostConfig;
  }

  /**
   * Build the base SSH command arguments for this host.
   * Handles key auth vs agent forwarding and common SSH options.
   */
  private buildSSHArgs(): string[] {
    const args: string[] = [
      'ssh',
      // Strict host key checking off for first-time connections
      // (Tailscale hosts are inherently trusted via WireGuard)
      '-o',
      'StrictHostKeyChecking=accept-new',
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=10',
      '-o',
      'ServerAliveInterval=15',
      '-o',
      'ServerAliveCountMax=3',
      // Port
      '-p',
      String(this.hostConfig.port),
    ];

    // Authentication
    if (this.hostConfig.authMethod === 'key-file' && this.hostConfig.keyPath) {
      args.push('-i', this.hostConfig.keyPath);
    } else if (this.hostConfig.authMethod === 'agent-forwarding') {
      args.push('-A');
    }

    // User@host
    args.push(`${this.hostConfig.user}@${this.hostConfig.hostname}`);

    return args;
  }

  /**
   * Execute a command on the remote host.
   * Returns stdout, stderr, and exit code.
   */
  async exec(
    command: string,
    options: { timeoutMs?: number; env?: Record<string, string> } = {},
  ): Promise<SSHCommandResult> {
    const timeoutMs = options.timeoutMs ?? 60_000;
    const sshArgs = this.buildSSHArgs();

    // Wrap command with env vars if needed
    let remoteCmd = command;
    if (options.env && Object.keys(options.env).length > 0) {
      const envPrefix = Object.entries(options.env)
        .map(([k, v]) => `${k}=${shellEscape(v)}`)
        .join(' ');
      remoteCmd = `${envPrefix} ${command}`;
    }

    sshArgs.push('--', remoteCmd);

    const proc = Bun.spawn(sshArgs, {
      stdout: 'pipe',
      stderr: 'pipe',
      env: process.env,
    });

    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeoutMs);

    try {
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      clearTimeout(timeoutId);

      return { exitCode: exitCode ?? -1, stdout, stderr, timedOut };
    } catch (err) {
      clearTimeout(timeoutId);
      return {
        exitCode: -1,
        stdout: '',
        stderr: err instanceof Error ? err.message : String(err),
        timedOut,
      };
    }
  }

  /**
   * Transfer a file to the remote host using SCP.
   */
  async scpUpload(
    localPath: string,
    remotePath: string,
    timeoutMs: number = 30_000,
  ): Promise<SSHCommandResult> {
    const args: string[] = [
      'scp',
      '-o',
      'StrictHostKeyChecking=accept-new',
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=10',
      '-P',
      String(this.hostConfig.port),
    ];

    if (this.hostConfig.authMethod === 'key-file' && this.hostConfig.keyPath) {
      args.push('-i', this.hostConfig.keyPath);
    }

    args.push(localPath, `${this.hostConfig.user}@${this.hostConfig.hostname}:${remotePath}`);

    const proc = Bun.spawn(args, {
      stdout: 'pipe',
      stderr: 'pipe',
      env: process.env,
    });

    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeoutMs);

    try {
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      clearTimeout(timeoutId);

      return { exitCode: exitCode ?? -1, stdout, stderr, timedOut };
    } catch (err) {
      clearTimeout(timeoutId);
      return {
        exitCode: -1,
        stdout: '',
        stderr: err instanceof Error ? err.message : String(err),
        timedOut,
      };
    }
  }

  /**
   * Write content to a remote file by piping through SSH stdin.
   */
  async writeRemoteFile(
    remotePath: string,
    content: string,
    timeoutMs: number = 15_000,
  ): Promise<SSHCommandResult> {
    const sshArgs = this.buildSSHArgs();
    sshArgs.push('--', `cat > ${shellEscape(remotePath)}`);

    const proc = Bun.spawn(sshArgs, {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      env: process.env,
    });

    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeoutMs);

    try {
      // Write content to stdin (Bun FileSink API)
      proc.stdin.write(new TextEncoder().encode(content));
      proc.stdin.end();

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      clearTimeout(timeoutId);

      return { exitCode: exitCode ?? -1, stdout, stderr, timedOut };
    } catch (err) {
      clearTimeout(timeoutId);
      return {
        exitCode: -1,
        stdout: '',
        stderr: err instanceof Error ? err.message : String(err),
        timedOut,
      };
    }
  }

  /**
   * Test SSH connectivity with a simple echo command.
   * Returns latency in milliseconds or null if unreachable.
   */
  async ping(
    timeoutMs: number = 5_000,
  ): Promise<{ reachable: boolean; latencyMs: number | null; error: string | null }> {
    const start = Date.now();
    const result = await this.exec('echo ok', { timeoutMs });
    const latencyMs = Date.now() - start;

    if (result.exitCode === 0 && result.stdout.trim() === 'ok') {
      return { reachable: true, latencyMs, error: null };
    }

    return {
      reachable: false,
      latencyMs: null,
      error: result.timedOut ? 'Connection timed out' : result.stderr.trim() || 'SSH failed',
    };
  }

  /**
   * Check if the golem binary exists on the remote host.
   */
  async checkGolemBinary(): Promise<boolean> {
    const result = await this.exec(
      `test -x ${shellEscape(this.hostConfig.golemBinaryPath)} && echo exists`,
      { timeoutMs: 5_000 },
    );
    return result.exitCode === 0 && result.stdout.trim() === 'exists';
  }

  /**
   * Get system load average from the remote host.
   */
  async getLoadAverage(): Promise<number | null> {
    const result = await this.exec('cat /proc/loadavg 2>/dev/null || uptime', { timeoutMs: 5_000 });
    if (result.exitCode !== 0) return null;

    const match = result.stdout.match(/(\d+\.\d+)/);
    return match ? parseFloat(match[1]) : null;
  }

  /**
   * Start a long-running golem process on the remote host.
   * Returns the remote PID for monitoring.
   */
  async startGolemProcess(
    specPath: string,
    logPath: string,
    env: Record<string, string> = {},
  ): Promise<{ pid: number | null; error: string | null }> {
    const golemBin = shellEscape(this.hostConfig.golemBinaryPath);
    const specFile = shellEscape(specPath);
    const logFile = shellEscape(logPath);

    // Build env prefix
    const envPrefix = Object.entries(env)
      .map(([k, v]) => `${k}=${shellEscape(v)}`)
      .join(' ');

    // Launch golem in background with nohup, capture PID
    const command = `${envPrefix} nohup ${golemBin} run --spec ${specFile} > ${logFile} 2>&1 & echo $!`;

    const result = await this.exec(command, { timeoutMs: 15_000 });

    if (result.exitCode !== 0) {
      return { pid: null, error: result.stderr.trim() || 'Failed to start golem process' };
    }

    const pid = parseInt(result.stdout.trim(), 10);
    return { pid: isNaN(pid) ? null : pid, error: null };
  }

  /**
   * Check if a remote process is still running.
   */
  async isProcessRunning(pid: number): Promise<boolean> {
    const result = await this.exec(`kill -0 ${pid} 2>/dev/null && echo alive`, {
      timeoutMs: 5_000,
    });
    return result.stdout.trim() === 'alive';
  }

  /**
   * Kill a remote process.
   */
  async killProcess(pid: number, signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM'): Promise<boolean> {
    const sig = signal === 'SIGKILL' ? '-9' : '-15';
    const result = await this.exec(`kill ${sig} ${pid} 2>/dev/null`, { timeoutMs: 5_000 });
    return result.exitCode === 0;
  }

  /**
   * Read the tail of a remote log file.
   */
  async readLogTail(logPath: string, lines: number = 50): Promise<string[]> {
    const result = await this.exec(`tail -n ${lines} ${shellEscape(logPath)} 2>/dev/null`, {
      timeoutMs: 5_000,
    });
    if (result.exitCode !== 0) return [];
    return result.stdout.split('\n').filter((l) => l.trim().length > 0);
  }

  /**
   * Clean up remote working directory for a story.
   */
  async cleanup(workDir: string): Promise<void> {
    await this.exec(`rm -rf ${shellEscape(workDir)}`, { timeoutMs: 10_000 });
  }

  /**
   * Get the host config.
   */
  getConfig(): RemoteHostConfig {
    return this.hostConfig;
  }
}

/** Escape a string for safe use in shell commands. */
function shellEscape(value: string): string {
  // Wrap in single quotes, escaping any single quotes in the value
  return `'${value.replace(/'/g, "'\\''")}'`;
}
