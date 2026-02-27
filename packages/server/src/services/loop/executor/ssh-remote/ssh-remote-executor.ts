// ---------------------------------------------------------------------------
// SSHRemoteExecutor — GolemExecutor for remote SSH/Tailscale hosts
// ---------------------------------------------------------------------------
// Dispatches story execution to pre-configured remote machines via SSH.
// Supports persistent build servers, Tailscale hostnames, health-checked
// load balancing, automatic failover, and real-time log streaming.
// ---------------------------------------------------------------------------

import { nanoid } from 'nanoid';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFile, unlink } from 'fs/promises';
import type {
  GolemExecutor,
  ExecutionContext,
  ExecutionResult,
  ExecutorStatus,
  ExecutorCapabilities,
  ExecutionStatus,
  RemoteHostConfig,
  RemoteExecution,
  SSHRemoteExecutorConfig,
  GolemSpec,
} from '@e/shared';
import { DEFAULT_SSH_REMOTE_EXECUTOR_CONFIG, GOLEM_DEFAULTS } from '@e/shared';
import { SSHClient } from './ssh-client';
import { HostHealthMonitor } from './host-health';

/** Internal state for a running execution. */
interface ActiveExecution {
  executionId: string;
  storyId: string;
  hostId: string;
  sshClient: SSHClient;
  remotePid: number | null;
  remoteSpecPath: string;
  remoteLogPath: string;
  remoteWorkDir: string;
  status: ExecutorStatus;
  cancelled: boolean;
  startedAt: number;
  monitorTimer: ReturnType<typeof setInterval> | null;
  logTail: string[];
}

/**
 * SSHRemoteExecutor — runs stories on remote machines via SSH.
 *
 * AC1: Implements GolemExecutor interface.
 * AC3: SSHs to target, transfers story spec, launches headless golem.
 * AC4: Supports both key-file auth and SSH agent forwarding.
 * AC5: Tailscale hostnames work transparently.
 * AC6: Health check runs every 30s; unhealthy hosts excluded.
 * AC7: If host fails mid-execution, story released back to queue after heartbeat timeout.
 * AC8: Load balancing respects max_concurrent_stories per host.
 * AC9: Remote golem logs streamed back in real-time via SSH tunnel.
 */
export class SSHRemoteExecutor implements GolemExecutor {
  readonly type = 'remote-ssh';
  readonly name = 'Remote SSH';

  private config: SSHRemoteExecutorConfig;
  private healthMonitor: HostHealthMonitor;
  private activeExecutions = new Map<string, ActiveExecution>();
  private hostConfigs = new Map<string, RemoteHostConfig>();

  constructor(config: Partial<SSHRemoteExecutorConfig> = {}) {
    this.config = { ...DEFAULT_SSH_REMOTE_EXECUTOR_CONFIG, ...config };

    // Index hosts by ID
    for (const host of this.config.hosts) {
      this.hostConfigs.set(host.id, host);
    }

    // Initialize health monitor
    this.healthMonitor = new HostHealthMonitor(
      this.config.hosts.filter((h) => h.enabled),
      this.config.healthCheckIntervalMs,
    );
  }

  // ---------------------------------------------------------------------------
  // GolemExecutor interface implementation
  // ---------------------------------------------------------------------------

  canExecute(_context: ExecutionContext): boolean {
    // SSH executor can handle any story as long as there are configured hosts
    // The dispatcher will prefer this for remote repos, but it can handle local too
    return this.config.hosts.length > 0 && this.healthMonitor.getAvailableHosts().length > 0;
  }

  async execute(context: ExecutionContext): Promise<ExecutionResult> {
    const startTime = Date.now();
    const logs: string[] = [];
    const tag = `[ssh-remote:${context.executionId}]`;

    const log = (msg: string) => {
      logs.push(msg);
      console.log(`${tag} ${msg}`);
    };

    // --- Select a healthy host with available slots ---
    const host = this.selectHost(context);
    if (!host) {
      log('No healthy hosts with available slots');
      return this.failureResult(context, startTime, logs, 'No healthy remote hosts available');
    }

    const hostConfig = this.hostConfigs.get(host.hostId)!;
    const sshClient = this.healthMonitor.getSSHClient(host.hostId)!;
    log(`Selected host: ${hostConfig.label ?? hostConfig.hostname} (${host.hostId})`);

    // Increment active story count
    this.healthMonitor.incrementActiveStories(host.hostId);

    // Build remote paths
    const storyDirName = `golem-${context.storyId}-${Date.now()}`;
    const remoteWorkDir = `${hostConfig.workDir}/${storyDirName}`;
    const remoteSpecPath = `${remoteWorkDir}/golem-spec.json`;
    const remoteLogPath = `${remoteWorkDir}/golem.log`;

    // Register execution
    const execution: ActiveExecution = {
      executionId: context.executionId,
      storyId: context.storyId,
      hostId: host.hostId,
      sshClient,
      remotePid: null,
      remoteSpecPath,
      remoteLogPath,
      remoteWorkDir,
      status: {
        status: 'executing',
        executionId: context.executionId,
        message: `Preparing remote host: ${hostConfig.hostname}`,
        progress: 0,
        timestamp: Date.now(),
      },
      cancelled: false,
      startedAt: startTime,
      monitorTimer: null,
      logTail: [],
    };
    this.activeExecutions.set(context.executionId, execution);

    try {
      // --- Step 1: Create remote work directory ---
      log(`Creating remote directory: ${remoteWorkDir}`);
      const mkdirResult = await sshClient.exec(`mkdir -p ${remoteWorkDir}`, {
        timeoutMs: this.config.connectionTimeoutMs,
      });
      if (mkdirResult.exitCode !== 0) {
        throw new Error(`Failed to create remote directory: ${mkdirResult.stderr}`);
      }

      if (execution.cancelled) return this.cancelledResult(context, startTime, logs);

      // --- Step 2: Build and transfer golem spec ---
      this.updateStatus(execution, 'executing', 'Transferring story spec', 10);
      const golemSpec = this.buildGolemSpec(context);
      const specJson = JSON.stringify(golemSpec, null, 2);

      log('Transferring golem spec to remote host...');
      const writeResult = await sshClient.writeRemoteFile(remoteSpecPath, specJson);
      if (writeResult.exitCode !== 0) {
        throw new Error(`Failed to write spec file: ${writeResult.stderr}`);
      }

      if (execution.cancelled) return this.cancelledResult(context, startTime, logs);

      // --- Step 3: Build environment variables ---
      const remoteEnv: Record<string, string> = {};
      // Pass LLM API keys directly as env vars for the remote golem
      for (const [envVar, value] of Object.entries(this.config.llmApiKeyRefs)) {
        remoteEnv[envVar] = value;
      }
      // Also pass any secrets refs from the execution context
      for (const [key, value] of Object.entries(context.secretsRefs)) {
        remoteEnv[key] = value;
      }

      // --- Step 4: Launch golem process on remote host ---
      this.updateStatus(execution, 'executing', 'Launching golem on remote host', 20);
      log('Launching golem process...');

      const startResult = await sshClient.startGolemProcess(
        remoteSpecPath,
        remoteLogPath,
        remoteEnv,
      );

      if (startResult.error || !startResult.pid) {
        throw new Error(`Failed to start golem: ${startResult.error ?? 'No PID returned'}`);
      }

      execution.remotePid = startResult.pid;
      log(`Golem started with remote PID: ${startResult.pid}`);

      if (execution.cancelled) {
        await this.killRemoteProcess(execution, log);
        return this.cancelledResult(context, startTime, logs);
      }

      // --- Step 5: Monitor execution ---
      this.updateStatus(execution, 'executing', `Story running on ${hostConfig.hostname}`, 30);

      // Start log streaming and process monitoring
      const result = await this.monitorExecution(execution, context, log);

      // --- Step 6: Cleanup remote resources ---
      log('Cleaning up remote work directory...');
      await sshClient.cleanup(remoteWorkDir).catch(() => {
        /* best effort */
      });

      const duration = Date.now() - startTime;
      log(`Execution completed in ${duration}ms with status: ${result}`);

      return {
        status: result,
        branchName: null,
        commitSha: null,
        logs,
        duration,
        costMetadata: {
          model: context.llmConfig.model,
        },
        agentOutput: execution.logTail.join('\n'),
        agentError: result === 'failure' ? 'Remote execution failed' : null,
        qualityResults: [],
        conversationId: null,
        agentId: null,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log(`Error: ${errMsg}`);

      // Attempt to kill remote process
      if (execution.remotePid) {
        await this.killRemoteProcess(execution, log);
      }

      // Clean up remote resources
      await sshClient.cleanup(remoteWorkDir).catch(() => {});

      // AC7: If host fails mid-execution, story will be released back to queue
      // via the coordination protocol heartbeat timeout (handled by coordinator).
      if (this.config.enableFailover) {
        log('Host failure — story will be released back to queue via heartbeat timeout');
      }

      return this.failureResult(context, startTime, logs, errMsg);
    } finally {
      // Clean up execution tracking
      if (execution.monitorTimer) {
        clearInterval(execution.monitorTimer);
      }
      this.activeExecutions.delete(context.executionId);
      this.healthMonitor.decrementActiveStories(host.hostId);
    }
  }

  async cancel(executionId: string): Promise<void> {
    const execution = this.activeExecutions.get(executionId);
    if (!execution) return;

    execution.cancelled = true;
    const log = (msg: string) => console.log(`[ssh-remote:${executionId}] ${msg}`);

    // Kill remote process
    if (execution.remotePid) {
      await this.killRemoteProcess(execution, log);
    }

    // Clean up remote resources
    await execution.sshClient.cleanup(execution.remoteWorkDir).catch(() => {});

    // Clean up execution
    if (execution.monitorTimer) {
      clearInterval(execution.monitorTimer);
    }
    this.activeExecutions.delete(executionId);
    this.healthMonitor.decrementActiveStories(execution.hostId);

    console.log(`[ssh-remote] Cancelled execution: ${executionId}`);
  }

  getStatus(executionId?: string): ExecutorStatus {
    if (executionId) {
      const execution = this.activeExecutions.get(executionId);
      if (execution) return execution.status;
      return {
        status: 'idle',
        executionId,
        message: 'Execution not found or already completed',
        progress: null,
        timestamp: Date.now(),
      };
    }

    const activeCount = this.activeExecutions.size;
    const healthyHosts = this.healthMonitor.getAvailableHosts().length;
    return {
      status: activeCount > 0 ? 'busy' : 'idle',
      executionId: null,
      message:
        activeCount > 0
          ? `${activeCount} remote execution(s) on ${healthyHosts} host(s)`
          : `Ready (${healthyHosts} healthy hosts)`,
      progress: null,
      timestamp: Date.now(),
    };
  }

  getCapabilities(): ExecutorCapabilities {
    const totalSlots = this.config.hosts.reduce((sum, h) => sum + h.maxConcurrentStories, 0);
    return {
      supportsLocal: false,
      supportsRemote: true,
      supportsWorktrees: true,
      maxConcurrency: totalSlots,
      supportedModels: [],
      supportsQualityChecks: true,
      supportsAutoCommit: true,
    };
  }

  // ---------------------------------------------------------------------------
  // SSH-specific public methods
  // ---------------------------------------------------------------------------

  /**
   * Start the host health monitor.
   */
  startHealthMonitor(): void {
    this.healthMonitor.start();
  }

  /**
   * Stop the host health monitor.
   */
  stopHealthMonitor(): void {
    this.healthMonitor.stop();
  }

  /**
   * Get health status for all hosts.
   */
  getHostHealth() {
    return this.healthMonitor.getAllHealth();
  }

  /**
   * Get the list of active remote executions.
   */
  getActiveExecutions(): RemoteExecution[] {
    return Array.from(this.activeExecutions.values()).map((e) => ({
      executionId: e.executionId,
      storyId: e.storyId,
      hostId: e.hostId,
      remotePid: e.remotePid,
      phase: e.status.message,
      startedAt: new Date(e.startedAt).toISOString(),
      elapsedMs: Date.now() - e.startedAt,
      active: !e.cancelled,
      logTail: e.logTail,
    }));
  }

  /**
   * Add a new remote host at runtime.
   */
  addHost(host: RemoteHostConfig): void {
    this.config.hosts.push(host);
    this.hostConfigs.set(host.id, host);
    this.healthMonitor.addHost(host);
    console.log(`[ssh-remote] Added host: ${host.id} (${host.hostname})`);
  }

  /**
   * Remove a remote host at runtime.
   */
  removeHost(hostId: string): void {
    this.config.hosts = this.config.hosts.filter((h) => h.id !== hostId);
    this.hostConfigs.delete(hostId);
    this.healthMonitor.removeHost(hostId);
    console.log(`[ssh-remote] Removed host: ${hostId}`);
  }

  /**
   * Shut down the executor: stop health monitor, cancel all executions.
   */
  async shutdown(): Promise<void> {
    console.log('[ssh-remote] Shutting down...');
    this.healthMonitor.stop();

    for (const [executionId] of this.activeExecutions) {
      await this.cancel(executionId);
    }

    console.log('[ssh-remote] Shutdown complete');
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Select the best host for a new execution.
   * Picks from healthy hosts with available slots, preferring lowest load.
   */
  private selectHost(context: ExecutionContext) {
    const available = this.healthMonitor.getAvailableHosts();

    if (available.length === 0) return null;

    // Sort by: most available slots first, then lowest load, then lowest latency
    const sorted = [...available].sort((a, b) => {
      // Primary: most available slots
      if (a.availableSlots !== b.availableSlots) return b.availableSlots - a.availableSlots;
      // Secondary: lowest load
      const aLoad = a.loadAverage ?? Infinity;
      const bLoad = b.loadAverage ?? Infinity;
      if (aLoad !== bLoad) return aLoad - bLoad;
      // Tertiary: lowest latency
      const aLat = a.latencyMs ?? Infinity;
      const bLat = b.latencyMs ?? Infinity;
      return aLat - bLat;
    });

    return sorted[0];
  }

  /**
   * Build a GolemSpec for the remote execution.
   */
  private buildGolemSpec(context: ExecutionContext): GolemSpec {
    return {
      repoUrl: context.repoUrl,
      branch: context.branch,
      story: {
        storyId: context.storyId,
        title: context.storyTitle,
        description: context.prompt,
        acceptanceCriteria: [],
      },
      llm: {
        model: context.llmConfig.model,
        effort: context.llmConfig.effort,
      },
      coordinatorUrl: this.config.coordinatorBaseUrl
        ? `${this.config.coordinatorBaseUrl}/api/story-coordination`
        : undefined,
      executorId: context.executionId,
      timeoutMs: context.resourceConstraints.maxDurationMs || this.config.defaultTimeoutMs,
      autoCommit: context.autoCommit,
      autoPush: true,
      healthPort: 0, // Disable health server for SSH-launched golems (we monitor via PID)
    };
  }

  /**
   * Monitor a running remote execution until completion or failure.
   *
   * AC9: Remote golem logs streamed back to coordinator in real-time.
   */
  private async monitorExecution(
    execution: ActiveExecution,
    context: ExecutionContext,
    log: (msg: string) => void,
  ): Promise<ExecutionStatus> {
    const pollIntervalMs = 5_000;
    const maxRuntime = context.resourceConstraints.maxDurationMs || this.config.defaultTimeoutMs;

    return new Promise<ExecutionStatus>((resolve) => {
      let resolved = false;
      const done = (status: ExecutionStatus) => {
        if (resolved) return;
        resolved = true;
        if (execution.monitorTimer) {
          clearInterval(execution.monitorTimer);
          execution.monitorTimer = null;
        }
        resolve(status);
      };

      execution.monitorTimer = setInterval(async () => {
        if (execution.cancelled) {
          done('cancelled');
          return;
        }

        // Check max runtime
        const elapsed = Date.now() - execution.startedAt;
        if (elapsed > maxRuntime) {
          log(`Max runtime exceeded (${elapsed}ms > ${maxRuntime}ms)`);
          await this.killRemoteProcess(execution, log);
          done('timeout');
          return;
        }

        // Check if process is still running
        if (execution.remotePid) {
          const running = await execution.sshClient.isProcessRunning(execution.remotePid);

          if (!running) {
            // Process exited — read final logs to determine result
            log('Remote golem process has exited');
            const logTail = await execution.sshClient.readLogTail(execution.remoteLogPath, 100);
            execution.logTail = logTail;

            // Check for success indicators in the log output
            const lastLines = logTail.join('\n');
            if (
              lastLines.includes('"exitCode":0') ||
              lastLines.includes('Execution complete: success')
            ) {
              done('success');
            } else if (lastLines.includes('"exitCode":3') || lastLines.includes('timed out')) {
              done('timeout');
            } else {
              done('failure');
            }
            return;
          }
        }

        // Stream logs back
        if (this.config.enableLogStreaming) {
          const logTail = await execution.sshClient.readLogTail(execution.remoteLogPath, 20);
          if (logTail.length > 0) {
            execution.logTail = logTail;
          }
        }

        // Update progress
        const progress = Math.min(90, Math.round((elapsed / maxRuntime) * 70) + 20);
        const hostConfig = this.hostConfigs.get(execution.hostId);
        this.updateStatus(
          execution,
          'executing',
          `Story running on ${hostConfig?.hostname ?? execution.hostId}`,
          progress,
        );
      }, pollIntervalMs);
    });
  }

  /**
   * Kill a remote golem process.
   */
  private async killRemoteProcess(
    execution: ActiveExecution,
    log: (msg: string) => void,
  ): Promise<void> {
    if (!execution.remotePid) return;

    log(`Killing remote process PID ${execution.remotePid}`);

    // Try SIGTERM first
    const killed = await execution.sshClient.killProcess(execution.remotePid, 'SIGTERM');
    if (!killed) {
      // Force kill
      await execution.sshClient.killProcess(execution.remotePid, 'SIGKILL');
    }

    // Wait a moment and verify
    await sleep(1000);
    const stillRunning = await execution.sshClient.isProcessRunning(execution.remotePid);
    if (stillRunning) {
      log(`Warning: Process ${execution.remotePid} still running after kill`);
    } else {
      log(`Process ${execution.remotePid} terminated`);
    }
  }

  private updateStatus(
    execution: ActiveExecution,
    status: ExecutorStatus['status'],
    message: string,
    progress: number | null,
  ): void {
    execution.status = {
      status,
      executionId: execution.executionId,
      message,
      progress,
      timestamp: Date.now(),
    };
  }

  private failureResult(
    context: ExecutionContext,
    startTime: number,
    logs: string[],
    error: string,
  ): ExecutionResult {
    return {
      status: 'failure',
      branchName: null,
      commitSha: null,
      logs,
      duration: Date.now() - startTime,
      agentOutput: '',
      agentError: error,
      qualityResults: [],
      conversationId: null,
      agentId: null,
    };
  }

  private cancelledResult(
    context: ExecutionContext,
    startTime: number,
    logs: string[],
  ): ExecutionResult {
    return {
      status: 'cancelled',
      branchName: null,
      commitSha: null,
      logs: [...logs, 'Execution cancelled'],
      duration: Date.now() - startTime,
      agentOutput: '',
      agentError: 'Execution was cancelled',
      qualityResults: [],
      conversationId: null,
      agentId: null,
    };
  }
}

/** Promise-based sleep helper. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
