// ---------------------------------------------------------------------------
// AWS ECS Fargate Manager
// ---------------------------------------------------------------------------
// Manages ECS Fargate tasks for lightweight, fast-start story execution.
// Handles cluster creation, task definition management, and task lifecycle.
//
// Acceptance Criterion 4: ECS Fargate mode runs golem container image with
// configurable vCPU (default 1) and memory (default 2GB).
//
// Acceptance Criterion 5: Fargate cold start under 60 seconds from dispatch
// to golem accepting story.
//
// Acceptance Criterion 9: All resources tagged with e-golem=true, story-id,
// prd-id, created-by for cost allocation and cleanup.
// ---------------------------------------------------------------------------

import {
  ECSClient,
  CreateClusterCommand,
  DescribeClustersCommand,
  RegisterTaskDefinitionCommand,
  RunTaskCommand,
  StopTaskCommand,
  DescribeTasksCommand,
  ListTasksCommand,
  DeregisterTaskDefinitionCommand,
  type Task as ECSTask,
  type KeyValuePair,
  type Tag as ECSTag,
  Compatibility,
  NetworkMode,
  TaskDefinitionStatus,
  AssignPublicIp,
  LaunchType,
} from '@aws-sdk/client-ecs';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import type {
  AWSECSFargateConfig,
  CloudInstance,
  CloudInstanceCreateOptions,
  CloudBackendType,
  CloudProviderType,
} from '@e/shared';
import { DEFAULT_AWS_ECS_FARGATE_CONFIG } from '@e/shared';
import { ProvisionFailedError } from '../cloud-errors';
import { generateContainerBootstrapScript, buildGolemSpecJson } from '../cloud-init';
import type { ResolvedVPCContext } from './aws-vpc';

/**
 * Mapping from Fargate vCPU to valid memory ranges (in MB).
 * See: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-cpu-memory-error.html
 */
const FARGATE_CPU_MEMORY_MAP: Record<number, { cpu: string; memoryOptions: number[] }> = {
  0.25: { cpu: '256', memoryOptions: [512, 1024, 2048] },
  0.5: { cpu: '512', memoryOptions: [1024, 2048, 3072, 4096] },
  1: { cpu: '1024', memoryOptions: [2048, 3072, 4096, 5120, 6144, 7168, 8192] },
  2: {
    cpu: '2048',
    memoryOptions: [
      4096, 5120, 6144, 7168, 8192, 9216, 10240, 11264, 12288, 13312, 14336, 15360, 16384,
    ],
  },
  4: {
    cpu: '4096',
    memoryOptions: [
      8192, 9216, 10240, 11264, 12288, 13312, 14336, 15360, 16384, 17408, 18432, 19456, 20480,
      21504, 22528, 23552, 24576, 25600, 26624, 27648, 28672, 29696, 30720,
    ],
  },
  8: {
    cpu: '8192',
    memoryOptions: [
      16384, 20480, 24576, 28672, 32768, 36864, 40960, 45056, 49152, 53248, 57344, 61440,
    ],
  },
  16: {
    cpu: '16384',
    memoryOptions: [
      32768, 40960, 49152, 57344, 65536, 73728, 81920, 90112, 98304, 106496, 114688, 122880,
    ],
  },
};

/**
 * AWS ECS Fargate Manager — handles container-based story execution.
 *
 * Execution flow:
 * 1. Ensure ECS cluster exists (create if needed)
 * 2. Register/update task definition with golem container image
 * 3. Run task with appropriate vCPU, memory, and networking
 * 4. Monitor task status until completion
 * 5. Stop/deregister on teardown
 */
export class AWSECSManager {
  private config: AWSECSFargateConfig;
  private ecsClient: ECSClient | null = null;
  private currentRegion: string = 'us-east-1';
  private clusterArn: string | null = null;
  private taskDefinitionArn: string | null = null;

  /** Map of instanceId (taskArn) → taskArn for tracking. */
  private taskArnMap = new Map<string, string>();

  constructor(config: Partial<AWSECSFargateConfig> = {}) {
    this.config = { ...DEFAULT_AWS_ECS_FARGATE_CONFIG, ...config };
  }

  /**
   * Initialize the ECS client for a specific region.
   */
  initialize(region: string, credentials: AwsCredentialIdentityProvider): void {
    this.currentRegion = region;
    this.ecsClient = new ECSClient({ region, credentials });
    // Reset cached cluster/task definition on re-init
    this.clusterArn = null;
    this.taskDefinitionArn = null;
  }

  /**
   * Launch a Fargate task for a story execution.
   *
   * Steps:
   * 1. Ensure cluster exists
   * 2. Register task definition
   * 3. Run the task with networking
   */
  async launchTask(
    options: CloudInstanceCreateOptions,
    vpcContext: ResolvedVPCContext,
  ): Promise<CloudInstance> {
    const client = this.getClient();

    // Ensure cluster exists
    await this.ensureCluster();

    // Register/update task definition
    await this.ensureTaskDefinition(options);

    // Build environment variables for the container
    const envVars = this.buildContainerEnv(options);

    // Build tags
    const ecsTags = this.buildECSTags(options);

    // Run the task
    const response = await client.send(
      new RunTaskCommand({
        cluster: this.clusterArn!,
        taskDefinition: this.taskDefinitionArn!,
        launchType: LaunchType.FARGATE,
        count: 1,
        platformVersion: this.config.platformVersion,
        networkConfiguration: {
          awsvpcConfiguration: {
            subnets: vpcContext.subnetIds,
            securityGroups: vpcContext.securityGroupIds,
            assignPublicIp: this.config.assignPublicIp
              ? AssignPublicIp.ENABLED
              : AssignPublicIp.DISABLED,
          },
        },
        overrides: {
          containerOverrides: [
            {
              name: 'e-golem',
              environment: envVars,
            },
          ],
        },
        tags: ecsTags,
        propagateTags: 'TASK_DEFINITION',
      }),
    );

    const tasks = response.tasks ?? [];
    if (tasks.length === 0) {
      const failures = response.failures ?? [];
      const failReason = failures.map((f) => `${f.arn}: ${f.reason}`).join('; ');
      throw new ProvisionFailedError(
        'aws',
        `Fargate task launch failed: ${failReason || 'no tasks returned'}`,
      );
    }

    const task = tasks[0];
    const taskArn = task.taskArn!;
    // Use the task ID (last segment of ARN) as the instance_id
    const taskId = taskArn.split('/').pop()!;
    this.taskArnMap.set(taskId, taskArn);

    console.log(`[aws-ecs] Fargate task launched: ${taskId}`);

    return {
      instance_id: taskId,
      provider: 'aws' as CloudProviderType,
      region: this.currentRegion,
      instance_type: `fargate-${this.config.cpu}vcpu-${this.config.memoryMb / 1024}gb`,
      status: 'provisioning',
      public_ip: null,
      created_at: new Date().toISOString(),
      story_id: options.storyId,
      cost_so_far: 0,
      backend: 'container' as CloudBackendType,
      execution_id: options.executionId,
      prd_id: options.prdId ?? null,
      tags: options.tags ?? {},
    };
  }

  /**
   * Stop a running Fargate task.
   */
  async stopTask(taskIdOrArn: string): Promise<void> {
    const client = this.getClient();

    const taskArn = this.resolveTaskArn(taskIdOrArn);

    try {
      await client.send(
        new StopTaskCommand({
          cluster: this.clusterArn ?? this.config.clusterName,
          task: taskArn,
          reason: 'e-golem teardown',
        }),
      );
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      // Ignore if task is already stopped
      if (errMsg.includes('STOPPED') || errMsg.includes('not found')) {
        return;
      }
      throw err;
    }

    this.taskArnMap.delete(taskIdOrArn);
  }

  /**
   * Describe a Fargate task and return its current status.
   */
  async describeTask(taskIdOrArn: string): Promise<CloudInstance | null> {
    const client = this.getClient();

    const taskArn = this.resolveTaskArn(taskIdOrArn);

    try {
      const response = await client.send(
        new DescribeTasksCommand({
          cluster: this.clusterArn ?? this.config.clusterName,
          tasks: [taskArn],
        }),
      );

      const tasks = response.tasks ?? [];
      if (tasks.length === 0) return null;

      return this.mapECSTask(tasks[0], taskIdOrArn);
    } catch {
      return null;
    }
  }

  /**
   * List all running e-golem Fargate tasks.
   */
  async listTasks(tags?: Record<string, string>): Promise<CloudInstance[]> {
    const client = this.getClient();

    try {
      const listResponse = await client.send(
        new ListTasksCommand({
          cluster: this.clusterArn ?? this.config.clusterName,
          launchType: LaunchType.FARGATE,
        }),
      );

      const taskArns = listResponse.taskArns ?? [];
      if (taskArns.length === 0) return [];

      const describeResponse = await client.send(
        new DescribeTasksCommand({
          cluster: this.clusterArn ?? this.config.clusterName,
          tasks: taskArns,
          include: ['TAGS'],
        }),
      );

      const results: CloudInstance[] = [];
      for (const task of describeResponse.tasks ?? []) {
        const taskId = task.taskArn?.split('/').pop();
        if (!taskId) continue;

        // Filter by tags if provided
        if (tags) {
          const taskTags: Record<string, string> = {};
          for (const tag of task.tags ?? []) {
            if (tag.key && tag.value) {
              taskTags[tag.key] = tag.value;
            }
          }
          const matches = Object.entries(tags).every(([k, v]) => taskTags[k] === v);
          if (!matches) continue;
        }

        const instance = this.mapECSTask(task, taskId);
        if (instance) results.push(instance);
      }

      return results;
    } catch {
      return [];
    }
  }

  /**
   * Update configuration.
   */
  updateConfig(config: Partial<AWSECSFargateConfig>): void {
    this.config = { ...this.config, ...config };
    // Invalidate cached task definition if cpu/memory changed
    if (config.cpu !== undefined || config.memoryMb !== undefined) {
      this.taskDefinitionArn = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Cluster management
  // ---------------------------------------------------------------------------

  private async ensureCluster(): Promise<void> {
    const client = this.getClient();

    // Check if cluster already exists
    try {
      const descResponse = await client.send(
        new DescribeClustersCommand({
          clusters: [this.config.clusterName],
        }),
      );

      const clusters = descResponse.clusters ?? [];
      const active = clusters.find((c) => c.status === 'ACTIVE');
      if (active) {
        this.clusterArn = active.clusterArn!;
        return;
      }
    } catch {
      // Cluster doesn't exist; create it below
    }

    // Create cluster
    const createResponse = await client.send(
      new CreateClusterCommand({
        clusterName: this.config.clusterName,
        tags: [
          { key: 'e-golem', value: 'true' },
          { key: 'managed-by', value: 'e-golem' },
          { key: 'created-by', value: 'e-golem' },
        ],
        settings: [{ name: 'containerInsights', value: 'disabled' }],
      }),
    );

    this.clusterArn = createResponse.cluster!.clusterArn!;
    console.log(`[aws-ecs] Created ECS cluster: ${this.config.clusterName}`);
  }

  // ---------------------------------------------------------------------------
  // Private: Task definition management
  // ---------------------------------------------------------------------------

  private async ensureTaskDefinition(options: CloudInstanceCreateOptions): Promise<void> {
    // Reuse cached task definition if available
    if (this.taskDefinitionArn) return;

    const client = this.getClient();

    const { cpuStr, memoryStr } = this.resolveFargateResources();

    const response = await client.send(
      new RegisterTaskDefinitionCommand({
        family: this.config.taskDefinitionFamily,
        requiresCompatibilities: [Compatibility.FARGATE],
        networkMode: NetworkMode.AWSVPC,
        cpu: cpuStr,
        memory: memoryStr,
        executionRoleArn: undefined, // Uses default ECS execution role
        containerDefinitions: [
          {
            name: 'e-golem',
            image: this.config.containerImage,
            essential: true,
            portMappings: [
              {
                containerPort: this.config.containerPort,
                protocol: 'tcp',
              },
            ],
            logConfiguration: {
              logDriver: 'awslogs',
              options: {
                'awslogs-group': `/ecs/${this.config.taskDefinitionFamily}`,
                'awslogs-region': this.currentRegion,
                'awslogs-stream-prefix': 'golem',
                'awslogs-create-group': 'true',
              },
            },
            healthCheck: {
              command: [
                'CMD-SHELL',
                `curl -f http://localhost:${this.config.containerPort}/health || exit 1`,
              ],
              interval: 15,
              timeout: 5,
              retries: 3,
              startPeriod: 30,
            },
          },
        ],
        tags: [
          { key: 'e-golem', value: 'true' },
          { key: 'managed-by', value: 'e-golem' },
        ],
      }),
    );

    this.taskDefinitionArn = response.taskDefinition!.taskDefinitionArn!;
    console.log(`[aws-ecs] Registered task definition: ${this.taskDefinitionArn}`);
  }

  /**
   * Resolve Fargate CPU and memory values to valid AWS strings.
   */
  private resolveFargateResources(): { cpuStr: string; memoryStr: string } {
    const cpuConfig = FARGATE_CPU_MEMORY_MAP[this.config.cpu];
    if (!cpuConfig) {
      // Default to 1 vCPU if invalid
      const defaultCpu = FARGATE_CPU_MEMORY_MAP[1];
      return { cpuStr: defaultCpu.cpu, memoryStr: String(this.config.memoryMb) };
    }

    // Find the closest valid memory value
    const validMemory =
      cpuConfig.memoryOptions.find((m) => m >= this.config.memoryMb) ??
      cpuConfig.memoryOptions[cpuConfig.memoryOptions.length - 1];

    return { cpuStr: cpuConfig.cpu, memoryStr: String(validMemory) };
  }

  // ---------------------------------------------------------------------------
  // Private: Environment and tags
  // ---------------------------------------------------------------------------

  private buildContainerEnv(options: CloudInstanceCreateOptions): KeyValuePair[] {
    const specJson = options.cloudInit.storySpec;

    const env: KeyValuePair[] = [
      { name: 'GOLEM_SPEC', value: specJson },
      { name: 'GOLEM_COORDINATOR_URL', value: options.cloudInit.coordinatorCallbackUrl },
      { name: 'GOLEM_EXECUTOR_ID', value: options.cloudInit.executorId },
      { name: 'GOLEM_HEALTH_PORT', value: String(options.cloudInit.healthPort) },
      { name: 'GOLEM_REPO_URL', value: options.cloudInit.repoUrl },
      { name: 'GOLEM_BRANCH', value: options.cloudInit.branch },
    ];

    // Add LLM API key references
    for (const [envVar, secretRef] of Object.entries(options.cloudInit.llmApiKeyRefs)) {
      env.push({ name: envVar, value: secretRef });
    }

    // Add extra env vars
    for (const [key, value] of Object.entries(options.cloudInit.env ?? {})) {
      env.push({ name: key, value });
    }

    return env;
  }

  private buildECSTags(options: CloudInstanceCreateOptions): ECSTag[] {
    const tags: ECSTag[] = [
      { key: 'e-golem', value: 'true' },
      { key: 'created-by', value: 'e-golem' },
    ];

    for (const [key, value] of Object.entries(options.tags ?? {})) {
      tags.push({ key, value });
    }

    return tags;
  }

  // ---------------------------------------------------------------------------
  // Private: Mapping
  // ---------------------------------------------------------------------------

  private mapECSTask(task: ECSTask, taskId: string): CloudInstance | null {
    if (!task.taskArn) return null;

    // Extract tags
    const tags: Record<string, string> = {};
    for (const tag of task.tags ?? []) {
      if (tag.key && tag.value) {
        tags[tag.key] = tag.value;
      }
    }

    // Get public IP from network attachments
    let publicIp: string | null = null;
    for (const attachment of task.attachments ?? []) {
      if (attachment.type === 'ElasticNetworkInterface') {
        for (const detail of attachment.details ?? []) {
          if (detail.name === 'publicIPv4Address' && detail.value) {
            publicIp = detail.value;
          }
        }
      }
    }

    return {
      instance_id: taskId,
      provider: 'aws' as CloudProviderType,
      region: this.currentRegion,
      instance_type: `fargate-${this.config.cpu}vcpu-${this.config.memoryMb / 1024}gb`,
      status: this.mapECSStatus(task.lastStatus),
      public_ip: publicIp,
      created_at: task.createdAt?.toISOString() ?? new Date().toISOString(),
      story_id: tags['e-golem-story-id'] ?? '',
      cost_so_far: 0,
      backend: 'container' as CloudBackendType,
      execution_id: tags['e-golem-execution-id'],
      prd_id: tags['e-golem-prd-id'] ?? null,
      tags,
      last_heartbeat: null,
      terminated_at:
        task.lastStatus === 'STOPPED'
          ? (task.stoppedAt?.toISOString() ?? new Date().toISOString())
          : null,
    };
  }

  /**
   * Map ECS task status to CloudInstanceStatus.
   */
  private mapECSStatus(status: string | undefined): CloudInstance['status'] {
    switch (status) {
      case 'PROVISIONING':
        return 'provisioning';
      case 'PENDING':
        return 'pending';
      case 'ACTIVATING':
        return 'configuring';
      case 'RUNNING':
        return 'running';
      case 'DEACTIVATING':
      case 'STOPPING':
        return 'stopping';
      case 'DEPROVISIONING':
        return 'stopping';
      case 'STOPPED':
        return 'terminated';
      default:
        return 'pending';
    }
  }

  private resolveTaskArn(taskIdOrArn: string): string {
    // If it's already an ARN, return as-is
    if (taskIdOrArn.startsWith('arn:')) return taskIdOrArn;
    // Look up from our map
    return this.taskArnMap.get(taskIdOrArn) ?? taskIdOrArn;
  }

  private getClient(): ECSClient {
    if (!this.ecsClient) {
      throw new Error('[aws-ecs] ECS client not initialized. Call initialize() first.');
    }
    return this.ecsClient;
  }
}
