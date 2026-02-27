// ---------------------------------------------------------------------------
// CloudExecutor — GolemExecutor implementation for cloud-based execution
// ---------------------------------------------------------------------------
// Extends the GolemExecutor strategy interface to provision cloud instances,
// inject configuration, monitor execution, and teardown on completion.
// Integrates with GolemDispatcher as a first-class executor strategy.
// ---------------------------------------------------------------------------

import type {
  GolemExecutor,
  ExecutionContext,
  ExecutionResult,
  ExecutorStatus,
  ExecutorCapabilities,
  ExecutionStatus,
  CloudProvider,
  CloudInstance,
  CloudInstanceCreateOptions,
  CloudExecutorConfig,
  CloudInitConfig,
  TeardownReason,
  TeardownEvent,
  CloudProviderType,
} from '@e/shared';
import {
  generateInstanceName,
  generateInstanceTags,
  DEFAULT_CLOUD_EXECUTOR_CONFIG,
} from '@e/shared';
import { SSHKeyManager } from './ssh-keys';
import { CloudCostTracker } from './cost-tracker';
import { ZombieDetector } from './zombie-detector';
import { RegionSelector } from './region-selector';
import {
  generateCloudInitScript,
  generateContainerBootstrapScript,
  buildGolemSpecJson,
} from './cloud-init';
import { wrapProviderError, ProvisionFailedError, TimeoutError } from './cloud-errors';
import { cloudBudgetManager } from '../../../cloud-budget-manager.js';

/** Tracks a single cloud execution lifecycle. */
interface CloudExecution {
  executionId: string;
  storyId: string;
  instance: CloudInstance | null;
  status: ExecutorStatus;
  cancelled: boolean;
  startedAt: number;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  maxRuntimeTimer: ReturnType<typeof setTimeout> | null;
  teardownReason: TeardownReason | null;
  /** Cached hourly cost rate for periodic cost updates. */
  hourlyCostUsd: number;
}

/**
 * CloudExecutor — provisions cloud instances to run golem stories.
 *
 * Lifecycle: provisionForStory() → waitForReady() → injectConfiguration() →
 * monitor heartbeats → teardown on completion/failure/timeout.
 *
 * Acceptance Criterion 10: Integrates with GolemDispatcher as a first-class
 * executor strategy.
 */
export class CloudExecutor implements GolemExecutor {
  readonly type: string;
  readonly name: string;

  private config: CloudExecutorConfig;
  private provider: CloudProvider;
  private sshKeyManager: SSHKeyManager;
  private costTracker: CloudCostTracker;
  private zombieDetector: ZombieDetector;
  private regionSelector: RegionSelector;
  private activeExecutions = new Map<string, CloudExecution>();
  private instances = new Map<string, CloudInstance>();
  private teardownLog: TeardownEvent[] = [];

  constructor(provider: CloudProvider, config: Partial<CloudExecutorConfig> = {}) {
    this.provider = provider;
    this.config = { ...DEFAULT_CLOUD_EXECUTOR_CONFIG, ...config };
    this.type = `cloud-${provider.providerType}`;
    this.name = `Cloud (${provider.name})`;

    // Initialize subsystems
    this.sshKeyManager = new SSHKeyManager();
    this.costTracker = new CloudCostTracker();
    this.zombieDetector = new ZombieDetector(this.config.zombieDetector);
    this.regionSelector = new RegionSelector(this.config.regionSelection);

    // Register this provider for zombie detection
    this.zombieDetector.registerProvider(provider);
    this.zombieDetector.onDetected((zombie) => {
      console.log(`[${this.type}] Zombie detected: ${zombie.instanceId} in ${zombie.region}`);
    });
  }

  // ---------------------------------------------------------------------------
  // GolemExecutor interface
  // ---------------------------------------------------------------------------

  canExecute(context: ExecutionContext): boolean {
    // Cloud executor can handle remote repos (HTTPS/SSH URLs)
    // and local repos if configured to always use cloud
    return (
      context.repoUrl.startsWith('https://') ||
      context.repoUrl.startsWith('git://') ||
      context.repoUrl.startsWith('ssh://') ||
      context.repoUrl.startsWith('git@')
    );
  }

  async execute(context: ExecutionContext): Promise<ExecutionResult> {
    const startTime = Date.now();
    const logs: string[] = [];
    const tag = `[${this.type}:${context.executionId}]`;

    const log = (msg: string) => {
      logs.push(msg);
      console.log(`${tag} ${msg}`);
    };

    // --- Budget enforcement check (AC 2, 4, 6) ---
    const budgetCheck = cloudBudgetManager.checkProvisioning({
      storyId: context.storyId,
      prdId: context.prdId,
      provider: this.provider.providerType,
      instanceType: this.config.defaultInstanceType,
      executorType: this.type,
      currentActiveInstances: this.activeExecutions.size,
    });

    // Log any circuit breaker events
    for (const evt of budgetCheck.events) {
      log(`[budget] ${evt.type}: ${evt.message}`);
    }

    if (!budgetCheck.allowed) {
      if (budgetCheck.queued) {
        log(`Instance limit reached — dispatch queued`);
      } else {
        log(`Provisioning blocked by budget controls: ${budgetCheck.reason}`);
      }
      return this.failureResult(
        context,
        startTime,
        logs,
        budgetCheck.reason ?? 'Blocked by budget controls',
      );
    }

    // Check concurrent instance limit (fallback — budget manager also checks this)
    if (this.activeExecutions.size >= this.config.maxConcurrentInstances) {
      log(`Concurrent instance limit reached (${this.config.maxConcurrentInstances})`);
      return this.failureResult(
        context,
        startTime,
        logs,
        'Concurrent cloud instance limit reached',
      );
    }

    // Register execution
    const execution: CloudExecution = {
      executionId: context.executionId,
      storyId: context.storyId,
      instance: null,
      status: {
        status: 'executing',
        executionId: context.executionId,
        message: 'Provisioning cloud instance',
        progress: 0,
        timestamp: Date.now(),
      },
      cancelled: false,
      startedAt: startTime,
      heartbeatTimer: null,
      maxRuntimeTimer: null,
      teardownReason: null,
      hourlyCostUsd: 0,
    };
    this.activeExecutions.set(context.executionId, execution);

    try {
      // --- Step 1: Provision instance ---
      log('Provisioning cloud instance...');
      const instance = await this.provisionForStory(context, log);

      if (execution.cancelled) {
        await this.teardown(instance.instance_id, 'manual', log);
        return this.cancelledResult(context, startTime, logs);
      }

      execution.instance = instance;
      this.instances.set(instance.instance_id, instance);
      this.zombieDetector.trackInstance(instance.instance_id);

      // Start cost tracking — both in-memory and persistent (AC 8)
      this.costTracker.startTracking(instance, context.executionId);
      cloudBudgetManager.recordCostStart({
        provider: instance.provider,
        region: instance.region,
        instanceType: instance.instance_type,
        storyId: context.storyId,
        prdId: context.prdId,
        instanceId: instance.instance_id,
        executorType: this.type,
      });
      try {
        const costEstimate = await this.provider.estimateCost({
          instanceType: instance.instance_type,
          region: instance.region,
          estimatedDurationMs:
            context.resourceConstraints.maxDurationMs || this.config.maxRuntimeMs,
          backend: instance.backend,
        });
        execution.hourlyCostUsd = costEstimate.hourlyRateUsd;
      } catch {
        // Non-fatal: cost tracking will use 0 rate until finalization
        log('Warning: Could not fetch hourly cost rate for periodic tracking');
      }
      log(`Instance provisioned: ${instance.instance_id} in ${instance.region}`);

      // --- Step 2: Wait for ready ---
      this.updateExecutionStatus(execution, 'executing', 'Waiting for instance ready', 20);
      log('Waiting for instance to become ready...');
      await this.waitForReady(instance.instance_id, log);

      if (execution.cancelled) {
        await this.teardown(instance.instance_id, 'manual', log);
        return this.cancelledResult(context, startTime, logs);
      }

      log('Instance ready');
      this.updateExecutionStatus(execution, 'executing', 'Story executing on cloud instance', 40);

      // --- Step 3: Monitor execution ---
      // Set up heartbeat monitoring
      const heartbeatTimeout = this.config.heartbeatTimeoutMs;
      let lastHeartbeat = Date.now();

      execution.heartbeatTimer = setInterval(() => {
        const elapsed = Date.now() - lastHeartbeat;
        if (elapsed > heartbeatTimeout) {
          console.log(
            `${tag} Heartbeat timeout for ${instance.instance_id} (${elapsed}ms > ${heartbeatTimeout}ms)`,
          );
          execution.teardownReason = 'heartbeat_timeout';
          void this.teardownExecution(execution, 'heartbeat_timeout', log);
        }
        // Update cost estimate periodically using cached hourly rate
        this.costTracker.updateCost(instance.instance_id, execution.hourlyCostUsd);
        // Also update the persisted cost record (AC 8)
        cloudBudgetManager.updateCostRecord(instance.instance_id, execution.hourlyCostUsd);

        // AC 2: Check if budget has been exceeded while running
        const stopCheck = cloudBudgetManager.shouldStopRunning({
          storyId: context.storyId,
          prdId: context.prdId,
          provider: instance.provider,
        });
        if (stopCheck.shouldStop) {
          console.log(`${tag} Budget exceeded for ${instance.instance_id}: ${stopCheck.reason}`);
          execution.teardownReason = 'quota_exceeded';
          void this.teardownExecution(execution, 'quota_exceeded', log);
        }
      }, 30_000);

      // Set up max runtime timer
      const maxRuntime = context.resourceConstraints.maxDurationMs || this.config.maxRuntimeMs;
      execution.maxRuntimeTimer = setTimeout(() => {
        console.log(`${tag} Max runtime exceeded for ${instance.instance_id} (${maxRuntime}ms)`);
        execution.teardownReason = 'max_runtime_exceeded';
        void this.teardownExecution(execution, 'max_runtime_exceeded', log);
      }, maxRuntime);

      // --- Step 4: Poll for completion ---
      // In a real implementation, the golem reports results via the coordinator API.
      // Here we poll instance status until it reaches a terminal state.
      const result = await this.waitForCompletion(execution, instance.instance_id, log, () => {
        lastHeartbeat = Date.now();
      });

      // --- Step 5: Teardown ---
      const teardownReason: TeardownReason =
        execution.teardownReason ?? (result === 'success' ? 'story_success' : 'story_failure');
      await this.teardown(instance.instance_id, teardownReason, log);

      // Finalize cost — in-memory and persistent (AC 8)
      const costEstimate = await this.provider.estimateCost({
        instanceType: instance.instance_type,
        region: instance.region,
        estimatedDurationMs: Date.now() - startTime,
        backend: instance.backend,
      });
      this.costTracker.finalize(instance.instance_id, costEstimate.hourlyRateUsd);
      cloudBudgetManager.finalizeCostRecord(instance.instance_id, costEstimate.hourlyRateUsd);

      const duration = Date.now() - startTime;
      log(`Execution completed in ${duration}ms with status: ${result}`);

      const costRecord = this.costTracker.getByInstance(instance.instance_id);

      return {
        status: result,
        branchName: null,
        commitSha: null,
        logs,
        duration,
        costMetadata: {
          estimatedCost: costRecord?.estimatedCostUsd,
        },
        agentOutput: '',
        agentError: result === 'failure' ? 'Cloud execution failed' : null,
        qualityResults: [],
        conversationId: null,
        agentId: null,
      };
    } catch (err) {
      const cloudErr = wrapProviderError(this.provider.providerType, err, 'Cloud execution failed');
      log(`Error: ${cloudErr.message}`);

      // Attempt teardown of any provisioned instance
      if (execution.instance) {
        try {
          await this.teardown(execution.instance.instance_id, 'story_failure', log);
        } catch (teardownErr) {
          log(`Teardown error: ${teardownErr}`);
        }
      }

      return this.failureResult(context, startTime, logs, cloudErr.message);
    } finally {
      // Clean up timers and tracking
      this.cleanupExecution(execution);
    }
  }

  async cancel(executionId: string): Promise<void> {
    const execution = this.activeExecutions.get(executionId);
    if (!execution) return;

    execution.cancelled = true;
    execution.teardownReason = 'manual';

    if (execution.instance) {
      const log = (msg: string) => console.log(`[${this.type}:${executionId}] ${msg}`);
      await this.teardown(execution.instance.instance_id, 'manual', log);
    }

    this.cleanupExecution(execution);
    console.log(`[${this.type}] Cancelled execution: ${executionId}`);
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
    return {
      status: activeCount > 0 ? 'busy' : 'idle',
      executionId: null,
      message: activeCount > 0 ? `${activeCount} cloud execution(s)` : 'Ready',
      progress: null,
      timestamp: Date.now(),
    };
  }

  getCapabilities(): ExecutorCapabilities {
    return {
      supportsLocal: false,
      supportsRemote: true,
      supportsWorktrees: false,
      maxConcurrency: this.config.maxConcurrentInstances,
      supportedModels: [],
      supportsQualityChecks: true,
      supportsAutoCommit: true,
    };
  }

  // ---------------------------------------------------------------------------
  // CloudExecutor-specific methods
  // ---------------------------------------------------------------------------

  /**
   * Provision a cloud instance for a story execution.
   * Generates SSH keys, selects region, creates instance with cloud-init.
   */
  async provisionForStory(
    context: ExecutionContext,
    log: (msg: string) => void,
  ): Promise<CloudInstance> {
    // Generate ephemeral SSH key pair
    const instanceName = generateInstanceName(context.storyId);
    const keyPair = this.sshKeyManager.generateKeyPair(instanceName);
    log(`Generated SSH key pair: ${keyPair.fingerprint}`);

    // Select region
    const regionResult = await this.regionSelector.selectRegion(
      this.provider,
      this.config.defaultInstanceType,
    );
    log(`Selected region: ${regionResult.region} (${regionResult.reason})`);

    // Build cloud-init configuration
    const cloudInit: CloudInitConfig = {
      repoUrl: context.repoUrl,
      storySpec: buildGolemSpecJson(
        {
          repoUrl: context.repoUrl,
          storySpec: '',
          golemBinaryUrl: this.config.golemBinaryUrl,
          llmApiKeyRefs: this.config.llmApiKeyRefs,
          coordinatorCallbackUrl: `${this.config.coordinatorBaseUrl}/api/story-coordination`,
          branch: context.branch,
          executorId: context.executionId,
          healthPort: this.config.healthCheckPort,
        },
        {
          storyId: context.storyId,
          storyTitle: context.storyTitle,
          storyDescription: context.prompt,
          acceptanceCriteria: [],
          model: context.llmConfig.model,
          effort: context.llmConfig.effort,
          timeoutMs: context.resourceConstraints.maxDurationMs,
          branch: context.branch,
        },
      ),
      golemBinaryUrl: this.config.golemBinaryUrl,
      llmApiKeyRefs: this.config.llmApiKeyRefs,
      coordinatorCallbackUrl: `${this.config.coordinatorBaseUrl}/api/story-coordination`,
      branch: context.branch,
      executorId: context.executionId,
      healthPort: this.config.healthCheckPort,
    };

    // Determine backend
    const backend = this.config.preferredBackend;

    // Build tags
    const tags = {
      ...generateInstanceTags(context.storyId, context.executionId, context.prdId),
      name: instanceName,
    };

    // Create instance options
    const createOptions: CloudInstanceCreateOptions = {
      storyId: context.storyId,
      prdId: context.prdId,
      executionId: context.executionId,
      region: regionResult.region,
      instanceType: this.config.defaultInstanceType,
      backend,
      tags,
      cloudInit,
      sshPublicKey: keyPair.publicKey,
      maxRuntimeMs: context.resourceConstraints.maxDurationMs || this.config.maxRuntimeMs,
    };

    try {
      const instance = await this.provider.createInstance(createOptions);

      // Bind SSH key to the actual instance ID
      if (instance.instance_id !== instanceName) {
        const existingKey = this.sshKeyManager.getKeyPair(instanceName);
        if (existingKey) {
          this.sshKeyManager.destroyKeyPair(instanceName);
          this.sshKeyManager.generateKeyPair(instance.instance_id);
        }
      }

      return instance;
    } catch (err) {
      // Clean up SSH key on failure
      this.sshKeyManager.destroyKeyPair(instanceName);
      throw err instanceof Error
        ? new ProvisionFailedError(this.provider.providerType, err.message)
        : new ProvisionFailedError(this.provider.providerType, String(err));
    }
  }

  /**
   * Wait for an instance to become ready (healthy and accepting connections).
   * Polls instance status until it transitions past 'configuring'.
   */
  async waitForReady(
    instanceId: string,
    log: (msg: string) => void,
    timeoutMs: number = 300_000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    const pollIntervalMs = 10_000;

    while (Date.now() < deadline) {
      const instance = await this.provider.getInstanceStatus(instanceId);
      if (!instance) {
        throw new ProvisionFailedError(
          this.provider.providerType,
          `Instance ${instanceId} not found during readiness check`,
        );
      }

      if (instance.status === 'ready' || instance.status === 'running') {
        // Update tracked instance
        this.instances.set(instanceId, instance);
        return;
      }

      if (instance.status === 'failed' || instance.status === 'terminated') {
        throw new ProvisionFailedError(
          this.provider.providerType,
          `Instance ${instanceId} entered ${instance.status} state during startup`,
        );
      }

      log(`Instance ${instanceId} status: ${instance.status}, waiting...`);
      await sleep(pollIntervalMs);
    }

    throw new TimeoutError(
      this.provider.providerType,
      `Instance ${instanceId} did not become ready within ${timeoutMs}ms`,
    );
  }

  /**
   * Tear down a cloud instance and clean up all associated resources.
   *
   * Acceptance Criterion 5: Automatic teardown triggered on story success,
   * story failure, heartbeat timeout, or max_runtime exceeded.
   */
  async teardown(
    instanceId: string,
    reason: TeardownReason,
    log: (msg: string) => void,
  ): Promise<TeardownEvent> {
    const event: TeardownEvent = {
      instanceId,
      reason,
      triggeredAt: new Date().toISOString(),
      completedAt: null,
      success: false,
    };

    log(`Teardown: ${instanceId} (reason: ${reason})`);

    try {
      await this.provider.destroyInstance(instanceId);
      event.success = true;
      event.completedAt = new Date().toISOString();
      log(`Instance ${instanceId} destroyed successfully`);
    } catch (err) {
      event.error = err instanceof Error ? err.message : String(err);
      log(`Teardown error for ${instanceId}: ${event.error}`);
    }

    // Clean up SSH keys
    this.sshKeyManager.destroyKeyPair(instanceId);

    // Remove from tracking
    this.instances.delete(instanceId);
    this.zombieDetector.untrackInstance(instanceId);

    this.teardownLog.push(event);
    return event;
  }

  /**
   * Start the zombie detector.
   */
  startZombieDetector(): void {
    this.zombieDetector.start();
  }

  /**
   * Stop the zombie detector.
   */
  stopZombieDetector(): void {
    this.zombieDetector.stop();
  }

  /**
   * Get the cost tracker for querying cloud spend.
   */
  getCostTracker(): CloudCostTracker {
    return this.costTracker;
  }

  /**
   * Get all tracked cloud instances.
   */
  getInstances(): CloudInstance[] {
    return Array.from(this.instances.values());
  }

  /**
   * Get the teardown log.
   */
  getTeardownLog(): TeardownEvent[] {
    return [...this.teardownLog];
  }

  /**
   * Shut down the executor: stop zombie detector, destroy all instances,
   * clean up SSH keys.
   */
  async shutdown(): Promise<void> {
    console.log(`[${this.type}] Shutting down...`);
    this.zombieDetector.stop();

    // Cancel all active executions
    for (const [executionId] of this.activeExecutions) {
      await this.cancel(executionId);
    }

    // Destroy all tracked instances
    const log = (msg: string) => console.log(`[${this.type}] ${msg}`);
    for (const instanceId of this.instances.keys()) {
      await this.teardown(instanceId, 'manual', log);
    }

    // Clean up SSH keys
    this.sshKeyManager.destroyAll();

    console.log(`[${this.type}] Shutdown complete`);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async waitForCompletion(
    execution: CloudExecution,
    instanceId: string,
    log: (msg: string) => void,
    onHeartbeat: () => void,
  ): Promise<ExecutionStatus> {
    const pollIntervalMs = 15_000;

    while (!execution.cancelled && !execution.teardownReason) {
      const instance = await this.provider.getInstanceStatus(instanceId);
      if (!instance) {
        log(`Instance ${instanceId} disappeared — treating as failure`);
        return 'failure';
      }

      // Update tracked instance
      this.instances.set(instanceId, instance);
      onHeartbeat();

      if (instance.status === 'terminated') {
        // Check if story reported success via coordinator
        log(`Instance ${instanceId} terminated`);
        return 'success'; // Assume success if cleanly terminated
      }

      if (instance.status === 'failed') {
        log(`Instance ${instanceId} failed`);
        return 'failure';
      }

      // Update progress estimate based on elapsed time
      const elapsed = Date.now() - execution.startedAt;
      const maxRuntime = this.config.maxRuntimeMs;
      const progress = Math.min(90, Math.round((elapsed / maxRuntime) * 80) + 10);
      this.updateExecutionStatus(
        execution,
        'executing',
        'Story executing on cloud instance',
        progress,
      );

      await sleep(pollIntervalMs);
    }

    if (execution.cancelled) return 'cancelled';
    if (execution.teardownReason === 'max_runtime_exceeded') return 'timeout';
    if (execution.teardownReason === 'heartbeat_timeout') return 'timeout';
    return 'failure';
  }

  private async teardownExecution(
    execution: CloudExecution,
    reason: TeardownReason,
    log: (msg: string) => void,
  ): Promise<void> {
    if (execution.instance) {
      await this.teardown(execution.instance.instance_id, reason, log);
    }
    this.cleanupExecution(execution);
  }

  private cleanupExecution(execution: CloudExecution): void {
    if (execution.heartbeatTimer) {
      clearInterval(execution.heartbeatTimer);
      execution.heartbeatTimer = null;
    }
    if (execution.maxRuntimeTimer) {
      clearTimeout(execution.maxRuntimeTimer);
      execution.maxRuntimeTimer = null;
    }
    this.activeExecutions.delete(execution.executionId);
  }

  private updateExecutionStatus(
    execution: CloudExecution,
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
