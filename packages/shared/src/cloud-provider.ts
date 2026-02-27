// ---------------------------------------------------------------------------
// Cloud Provider Abstraction Layer — shared types
// ---------------------------------------------------------------------------
// Defines the CloudProvider interface and supporting types that all cloud
// executors (AWS, GCP, Azure, etc.) build on. Covers VM lifecycle, cost
// tracking, region selection, and failure recovery.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Cloud provider & backend identification
// ---------------------------------------------------------------------------

/** Supported cloud provider identifiers. */
export type CloudProviderType = 'aws' | 'gcp' | 'azure' | 'custom';

/** Execution backend — VM-based or container-based. */
export type CloudBackendType = 'vm' | 'container';

// ---------------------------------------------------------------------------
// Instance status & lifecycle
// ---------------------------------------------------------------------------

/** Lifecycle states of a cloud instance. */
export type CloudInstanceStatus =
  | 'pending' // create request sent, waiting for provider
  | 'provisioning' // provider accepted, instance is starting up
  | 'configuring' // instance running, cloud-init / user-data executing
  | 'ready' // golem bootstrapped and reporting healthy
  | 'running' // story execution in progress
  | 'stopping' // teardown initiated
  | 'terminated' // instance destroyed
  | 'failed'; // provisioning or runtime failure

/**
 * Tracks a single cloud instance throughout its lifecycle.
 * Acceptance Criterion 2: tracks instance_id, provider, region, instance_type,
 * status, public_ip, created_at, story_id, cost_so_far.
 */
export interface CloudInstance {
  /** Provider-assigned instance identifier (e.g. i-abc123, gce-xyz). */
  instance_id: string;
  /** Which cloud provider owns this instance. */
  provider: CloudProviderType;
  /** Cloud region the instance runs in (e.g. us-east-1, us-central1). */
  region: string;
  /** Instance/machine type (e.g. t3.medium, e2-standard-4). */
  instance_type: string;
  /** Current lifecycle status. */
  status: CloudInstanceStatus;
  /** Public IP address (null until assigned). */
  public_ip: string | null;
  /** When the instance was created (ISO 8601). */
  created_at: string;
  /** Story ID this instance is working on. */
  story_id: string;
  /** Accumulated cost in USD so far. */
  cost_so_far: number;
  /** Backend type (VM or container). */
  backend: CloudBackendType;
  /** Execution ID for dispatcher correlation. */
  execution_id?: string;
  /** SSH fingerprint for host verification. */
  ssh_host_fingerprint?: string;
  /** PRD ID the story belongs to (null for standalone). */
  prd_id?: string | null;
  /** Instance tags applied for identification/management. */
  tags: Record<string, string>;
  /** When the instance was last seen healthy (ISO 8601, null if never). */
  last_heartbeat?: string | null;
  /** When the instance was terminated (ISO 8601, null if still running). */
  terminated_at?: string | null;
}

// ---------------------------------------------------------------------------
// Instance creation options
// ---------------------------------------------------------------------------

/** Options for creating a cloud instance. */
export interface CloudInstanceCreateOptions {
  /** Story ID to assign. */
  storyId: string;
  /** PRD ID (null for standalone stories). */
  prdId?: string | null;
  /** Execution ID for dispatcher tracking. */
  executionId: string;
  /** Preferred region (null = let region selector decide). */
  region?: string | null;
  /** Instance/machine type override (null = provider default). */
  instanceType?: string | null;
  /** Backend type preference (default: 'vm'). */
  backend?: CloudBackendType;
  /** Extra tags to apply to the instance. */
  tags?: Record<string, string>;
  /** Cloud-init / user-data configuration. */
  cloudInit: CloudInitConfig;
  /** SSH public key to inject for access. */
  sshPublicKey: string;
  /** Maximum runtime in milliseconds before auto-teardown. */
  maxRuntimeMs: number;
}

// ---------------------------------------------------------------------------
// Cloud-init / user-data configuration
// ---------------------------------------------------------------------------

/**
 * Configuration injected into the instance at boot via cloud-init or user-data.
 * Acceptance Criterion 3: injects repo URL, story spec, golem binary URL,
 * LLM API keys (from secrets manager), coordinator callback URL.
 */
export interface CloudInitConfig {
  /** Repository URL to clone (HTTPS or SSH). */
  repoUrl: string;
  /** JSON-encoded story specification. */
  storySpec: string;
  /** URL to download the golem binary. */
  golemBinaryUrl: string;
  /** Secret references for LLM API keys (resolved at boot from secrets manager). */
  llmApiKeyRefs: Record<string, string>;
  /** Coordinator callback URL for heartbeat and result reporting. */
  coordinatorCallbackUrl: string;
  /** Branch to clone and work on. */
  branch: string;
  /** Executor ID for coordination. */
  executorId: string;
  /** Health check port for readiness probes. */
  healthPort: number;
  /** Additional environment variables. */
  env?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Cost tracking
// ---------------------------------------------------------------------------

/**
 * Per-story cloud spend record.
 * Acceptance Criterion 7: records provider, region, instance type, duration,
 * and estimated cost.
 */
export interface CloudCostRecord {
  /** Unique cost record ID. */
  id: string;
  /** Story ID this cost is attributed to. */
  storyId: string;
  /** PRD ID (null for standalone stories). */
  prdId: string | null;
  /** Cloud provider. */
  provider: CloudProviderType;
  /** Region the instance ran in. */
  region: string;
  /** Instance/machine type. */
  instanceType: string;
  /** When the instance started (ISO 8601). */
  startTime: string;
  /** When the instance was terminated (ISO 8601, null if still running). */
  endTime: string | null;
  /** Duration in milliseconds. */
  durationMs: number;
  /** Estimated cost in USD. */
  estimatedCostUsd: number;
  /** Execution ID for correlation. */
  executionId: string;
  /** Instance ID in the cloud provider. */
  instanceId: string;
  /** Backend type. */
  backend: CloudBackendType;
}

// ---------------------------------------------------------------------------
// Region selection
// ---------------------------------------------------------------------------

/**
 * Strategy for selecting a cloud region.
 * Acceptance Criterion 8: user-preferred list, cheapest-available,
 * closest-to-repo-host.
 */
export type RegionSelectionStrategy =
  | 'user-preferred'
  | 'cheapest-available'
  | 'closest-to-repo-host';

/** Configuration for region selection. */
export interface RegionSelectionConfig {
  /** Active selection strategy. */
  strategy: RegionSelectionStrategy;
  /** User-preferred regions in priority order (for 'user-preferred' strategy). */
  preferredRegions: string[];
  /** Fallback regions if preferred are unavailable. */
  fallbackRegions: string[];
  /** Repository host location hint (for 'closest-to-repo-host' strategy). */
  repoHostRegion?: string;
}

/** A candidate region with cost/latency metadata. */
export interface RegionCandidate {
  /** Region identifier. */
  region: string;
  /** Estimated hourly cost in USD for the target instance type. */
  estimatedHourlyCostUsd: number;
  /** Whether this region is currently available. */
  available: boolean;
  /** Estimated network latency in ms to repo host (null if unknown). */
  latencyMs?: number | null;
}

// ---------------------------------------------------------------------------
// SSH key management
// ---------------------------------------------------------------------------

/**
 * Ephemeral SSH key pair for a single cloud instance.
 * Acceptance Criterion 4: private key held only in coordinator memory.
 */
export interface EphemeralSSHKeyPair {
  /** SSH public key (injected into instance). */
  publicKey: string;
  /** SSH private key (held in coordinator memory only — never persisted). */
  privateKey: string;
  /** Key fingerprint for identification. */
  fingerprint: string;
  /** When this key pair was generated (ISO 8601). */
  generatedAt: string;
  /** Instance ID this key pair is bound to. */
  instanceId?: string;
}

// ---------------------------------------------------------------------------
// Teardown triggers
// ---------------------------------------------------------------------------

/**
 * Reasons for automatic instance teardown.
 * Acceptance Criterion 5: story success, story failure, heartbeat timeout,
 * max_runtime exceeded.
 */
export type TeardownReason =
  | 'story_success'
  | 'story_failure'
  | 'heartbeat_timeout'
  | 'max_runtime_exceeded'
  | 'manual'
  | 'zombie_detected'
  | 'quota_exceeded';

/** Record of an instance teardown event. */
export interface TeardownEvent {
  /** Instance ID that was torn down. */
  instanceId: string;
  /** Why the instance was torn down. */
  reason: TeardownReason;
  /** When the teardown was triggered (ISO 8601). */
  triggeredAt: string;
  /** When the teardown completed (ISO 8601, null if still in progress). */
  completedAt: string | null;
  /** Whether the teardown was successful. */
  success: boolean;
  /** Error message if teardown failed. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Zombie detection
// ---------------------------------------------------------------------------

/**
 * A zombie instance — tagged as e-golem but not tracked by the coordinator.
 * Acceptance Criterion 6: periodic sweep for orphaned instances.
 */
export interface ZombieInstance {
  /** Provider-assigned instance ID. */
  instanceId: string;
  /** Cloud provider. */
  provider: CloudProviderType;
  /** Region. */
  region: string;
  /** Instance tags. */
  tags: Record<string, string>;
  /** When the instance was created. */
  createdAt: string;
  /** When the zombie was detected. */
  detectedAt: string;
  /** Action taken (destroy, alert, ignore). */
  action: 'destroy' | 'alert' | 'ignore';
}

/** Configuration for the zombie instance detector. */
export interface ZombieDetectorConfig {
  /** How often to sweep, in milliseconds. Default: 300_000 (5 minutes). */
  sweepIntervalMs: number;
  /** Whether to auto-destroy detected zombies. */
  autoDestroy: boolean;
  /** Instance tag key used to identify e-golem instances. */
  tagKey: string;
  /** Instance tag value prefix for e-golem instances. */
  tagValuePrefix: string;
}

/** Default zombie detector configuration. */
export const DEFAULT_ZOMBIE_DETECTOR_CONFIG: ZombieDetectorConfig = {
  sweepIntervalMs: 300_000, // 5 minutes
  autoDestroy: true,
  tagKey: 'e-golem',
  tagValuePrefix: 'e-golem-',
};

// ---------------------------------------------------------------------------
// Provider-agnostic error types
// ---------------------------------------------------------------------------

/**
 * Cloud provider error codes.
 * Acceptance Criterion 9: ProvisionFailed, QuotaExceeded, RegionUnavailable,
 * InstanceTerminated, AuthFailed.
 */
export type CloudErrorCode =
  | 'ProvisionFailed'
  | 'QuotaExceeded'
  | 'RegionUnavailable'
  | 'InstanceTerminated'
  | 'AuthFailed'
  | 'NetworkError'
  | 'ConfigurationError'
  | 'TimeoutError'
  | 'UnknownError';

/** Provider-agnostic cloud error with structured metadata. */
export interface CloudProviderError {
  /** Error code for programmatic handling. */
  code: CloudErrorCode;
  /** Human-readable error message. */
  message: string;
  /** Cloud provider that raised the error. */
  provider: CloudProviderType;
  /** Region involved (if applicable). */
  region?: string;
  /** Instance ID involved (if applicable). */
  instanceId?: string;
  /** Whether this error is retryable. */
  retryable: boolean;
  /** Suggested retry delay in milliseconds (null if not retryable). */
  retryDelayMs?: number | null;
  /** Raw provider error for debugging. */
  providerError?: unknown;
}

// ---------------------------------------------------------------------------
// Cost estimation
// ---------------------------------------------------------------------------

/** Input for cost estimation. */
export interface CostEstimateRequest {
  /** Instance/machine type. */
  instanceType: string;
  /** Cloud region. */
  region: string;
  /** Expected duration in milliseconds. */
  estimatedDurationMs: number;
  /** Backend type. */
  backend: CloudBackendType;
}

/** Result of cost estimation. */
export interface CostEstimateResult {
  /** Estimated cost in USD. */
  estimatedCostUsd: number;
  /** Hourly rate for the instance type in this region. */
  hourlyRateUsd: number;
  /** Breakdown by component (compute, storage, network). */
  breakdown: Record<string, number>;
  /** Currency (always 'USD'). */
  currency: 'USD';
}

// ---------------------------------------------------------------------------
// CloudProvider interface — the core abstraction
// ---------------------------------------------------------------------------

/**
 * CloudProvider — the strategy interface for cloud infrastructure.
 * Acceptance Criterion 1: createInstance(), destroyInstance(),
 * getInstanceStatus(), listInstances(), estimateCost().
 *
 * Each cloud provider (AWS, GCP, Azure, etc.) implements this interface
 * to provide VM or container lifecycle management.
 */
export interface CloudProvider {
  /** Cloud provider identifier. */
  readonly providerType: CloudProviderType;

  /** Human-readable name (e.g. "Amazon Web Services"). */
  readonly name: string;

  /** Supported backend types for this provider. */
  readonly supportedBackends: CloudBackendType[];

  /**
   * Create a new cloud instance.
   * @returns The created CloudInstance (status will be 'pending' or 'provisioning').
   * @throws CloudProviderError on failure.
   */
  createInstance(options: CloudInstanceCreateOptions): Promise<CloudInstance>;

  /**
   * Destroy a running or stopped cloud instance.
   * Idempotent — no error if the instance is already terminated.
   * @throws CloudProviderError on failure.
   */
  destroyInstance(instanceId: string): Promise<void>;

  /**
   * Get the current status and metadata of an instance.
   * @returns The CloudInstance or null if not found.
   * @throws CloudProviderError on failure.
   */
  getInstanceStatus(instanceId: string): Promise<CloudInstance | null>;

  /**
   * List all instances managed by this provider, optionally filtered by tags.
   * @param tags — filter by tag key/value pairs. Only instances matching ALL
   *   provided tags are returned.
   * @returns Array of matching CloudInstances.
   * @throws CloudProviderError on failure.
   */
  listInstances(tags?: Record<string, string>): Promise<CloudInstance[]>;

  /**
   * Estimate the cost of running an instance.
   * @returns A cost estimate with hourly rate and breakdown.
   * @throws CloudProviderError on failure.
   */
  estimateCost(request: CostEstimateRequest): Promise<CostEstimateResult>;

  /**
   * List available regions for this provider.
   * @returns Array of region candidates with cost/availability metadata.
   */
  listRegions(instanceType?: string): Promise<RegionCandidate[]>;

  /**
   * Validate provider credentials.
   * @returns true if the credentials are valid and have sufficient permissions.
   */
  validateCredentials(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// CloudExecutor configuration
// ---------------------------------------------------------------------------

/** Configuration for a CloudExecutor instance. */
export interface CloudExecutorConfig {
  /** Cloud provider to use. */
  providerType: CloudProviderType;
  /** Preferred backend type. */
  preferredBackend: CloudBackendType;
  /** Region selection configuration. */
  regionSelection: RegionSelectionConfig;
  /** Default instance/machine type. */
  defaultInstanceType: string;
  /** URL to download the golem binary. */
  golemBinaryUrl: string;
  /** Coordinator callback base URL. */
  coordinatorBaseUrl: string;
  /** Maximum runtime per story in milliseconds (default: 3_600_000 = 1 hour). */
  maxRuntimeMs: number;
  /** Heartbeat timeout before auto-teardown in milliseconds (default: 300_000 = 5min). */
  heartbeatTimeoutMs: number;
  /** Zombie detector configuration. */
  zombieDetector: ZombieDetectorConfig;
  /** Maximum concurrent cloud instances. */
  maxConcurrentInstances: number;
  /** Health check port for golem instances. */
  healthCheckPort: number;
  /** Secret references for LLM API keys. */
  llmApiKeyRefs: Record<string, string>;
}

/** Default CloudExecutor configuration. */
export const DEFAULT_CLOUD_EXECUTOR_CONFIG: CloudExecutorConfig = {
  providerType: 'aws',
  preferredBackend: 'vm',
  regionSelection: {
    strategy: 'user-preferred',
    preferredRegions: ['us-east-1'],
    fallbackRegions: ['us-west-2', 'eu-west-1'],
  },
  defaultInstanceType: 't3.medium',
  golemBinaryUrl: '',
  coordinatorBaseUrl: '',
  maxRuntimeMs: 3_600_000, // 1 hour
  heartbeatTimeoutMs: 300_000, // 5 minutes
  zombieDetector: DEFAULT_ZOMBIE_DETECTOR_CONFIG,
  maxConcurrentInstances: 5,
  healthCheckPort: 8080,
  llmApiKeyRefs: {},
};

// ---------------------------------------------------------------------------
// Instance naming convention
// ---------------------------------------------------------------------------

/** Generate an instance name following the e-golem-{storyId}-{timestamp} convention. */
export function generateInstanceName(storyId: string): string {
  const timestamp = Date.now();
  // Sanitize storyId: replace non-alphanumeric with dashes, truncate
  const sanitized = storyId.replace(/[^a-zA-Z0-9-]/g, '-').substring(0, 40);
  return `e-golem-${sanitized}-${timestamp}`;
}

/** Standard tags applied to all e-golem cloud instances. */
export function generateInstanceTags(
  storyId: string,
  executionId: string,
  prdId?: string | null,
): Record<string, string> {
  const tags: Record<string, string> = {
    'e-golem': 'true',
    'e-golem-story-id': storyId,
    'e-golem-execution-id': executionId,
    'e-golem-created-at': new Date().toISOString(),
  };
  if (prdId) {
    tags['e-golem-prd-id'] = prdId;
  }
  return tags;
}
