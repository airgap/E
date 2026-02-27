// ---------------------------------------------------------------------------
// SSH/Tailscale Remote Executor — shared types
// ---------------------------------------------------------------------------
// Types for dispatching story execution to pre-configured remote machines
// via SSH or Tailscale. Supports persistent build servers and on-demand hosts.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Remote host configuration
// ---------------------------------------------------------------------------

/** Authentication method for SSH connections. */
export type SSHAuthMethod = 'key-file' | 'agent-forwarding';

/**
 * Configuration for a single remote host.
 * AC2: hostname, port, user, SSH key path or agent forwarding,
 * max_concurrent_stories, capability_tags.
 */
export interface RemoteHostConfig {
  /** Unique identifier for this host (e.g. "build-01", "gpu-runner"). */
  id: string;
  /** Hostname or IP address (e.g. "192.168.1.50", "build-server.tail1234.ts.net"). */
  hostname: string;
  /** SSH port (default: 22). */
  port: number;
  /** SSH username. */
  user: string;
  /** Authentication method. */
  authMethod: SSHAuthMethod;
  /** Path to SSH private key file (for 'key-file' auth). */
  keyPath?: string;
  /** Maximum number of concurrent stories this host can execute. */
  maxConcurrentStories: number;
  /** Capability tags for matching stories to hosts (e.g. "has-gpu", "high-memory"). */
  capabilityTags: string[];
  /** Optional labels for display (e.g. "Build Server 1"). */
  label?: string;
  /** Whether this host is enabled for scheduling. */
  enabled: boolean;
  /** Path to the golem binary on the remote host. */
  golemBinaryPath: string;
  /** Working directory on the remote host for golem execution. */
  workDir: string;
}

/** Default values for remote host configuration. */
export const DEFAULT_REMOTE_HOST_CONFIG: Omit<RemoteHostConfig, 'id' | 'hostname' | 'user'> = {
  port: 22,
  authMethod: 'key-file',
  maxConcurrentStories: 2,
  capabilityTags: [],
  enabled: true,
  golemBinaryPath: '/usr/local/bin/e-golem',
  workDir: '/tmp/e-golem',
};

// ---------------------------------------------------------------------------
// Host health status
// ---------------------------------------------------------------------------

/** Health status of a remote host. */
export type RemoteHostHealthStatus = 'healthy' | 'unhealthy' | 'unknown' | 'checking';

/** Full health status snapshot of a remote host. */
export interface RemoteHostHealth {
  /** Host ID. */
  hostId: string;
  /** Current health status. */
  status: RemoteHostHealthStatus;
  /** Number of currently active stories on this host. */
  activeStories: number;
  /** Available story slots (maxConcurrentStories - activeStories). */
  availableSlots: number;
  /** Last successful health check timestamp (ISO 8601). */
  lastCheckAt: string | null;
  /** Last health check error message. */
  lastError: string | null;
  /** Round-trip time of last SSH ping in milliseconds. */
  latencyMs: number | null;
  /** Whether the golem binary exists on the remote host. */
  golemAvailable: boolean;
  /** System load average (1 minute) if available. */
  loadAverage: number | null;
}

// ---------------------------------------------------------------------------
// Remote execution tracking
// ---------------------------------------------------------------------------

/** Tracks a story execution on a remote host. */
export interface RemoteExecution {
  /** Execution ID for dispatcher correlation. */
  executionId: string;
  /** Story ID being executed. */
  storyId: string;
  /** Host ID where the story is running. */
  hostId: string;
  /** Remote PID of the golem process. */
  remotePid: number | null;
  /** Phase of the remote golem execution. */
  phase: string;
  /** When the execution started (ISO 8601). */
  startedAt: string;
  /** Elapsed time in milliseconds. */
  elapsedMs: number;
  /** Whether the execution is still active. */
  active: boolean;
  /** Log tail from the remote process. */
  logTail: string[];
}

// ---------------------------------------------------------------------------
// SSH Remote Executor configuration
// ---------------------------------------------------------------------------

/** Full configuration for the SSHRemoteExecutor. */
export interface SSHRemoteExecutorConfig {
  /** List of remote hosts to dispatch to. */
  hosts: RemoteHostConfig[];
  /** Health check interval in milliseconds (default: 30_000 = 30s). */
  healthCheckIntervalMs: number;
  /** SSH connection timeout in milliseconds (default: 10_000 = 10s). */
  connectionTimeoutMs: number;
  /** Coordinator callback base URL for remote golems. */
  coordinatorBaseUrl: string;
  /** URL to download the golem binary for bootstrapping. */
  golemBinaryUrl: string;
  /** Default timeout per story in milliseconds. */
  defaultTimeoutMs: number;
  /** Secret references for LLM API keys. */
  llmApiKeyRefs: Record<string, string>;
  /** Whether to stream logs back in real-time via SSH tunnel. */
  enableLogStreaming: boolean;
  /** Whether to auto-failover on host failure. */
  enableFailover: boolean;
}

/** Default SSH Remote Executor configuration. */
export const DEFAULT_SSH_REMOTE_EXECUTOR_CONFIG: SSHRemoteExecutorConfig = {
  hosts: [],
  healthCheckIntervalMs: 30_000,
  connectionTimeoutMs: 10_000,
  coordinatorBaseUrl: '',
  golemBinaryUrl: '',
  defaultTimeoutMs: 600_000,
  llmApiKeyRefs: {},
  enableLogStreaming: true,
  enableFailover: true,
};
