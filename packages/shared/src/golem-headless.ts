// ---------------------------------------------------------------------------
// Headless Golem — types for standalone golem binary execution
// ---------------------------------------------------------------------------
// The headless golem is a standalone Bun binary that receives a story spec,
// clones the repo, runs the agent loop, executes quality checks, pushes the
// result branch, and reports back to the coordinator.
// ---------------------------------------------------------------------------

import type { QualityCheckConfig, QualityCheckResult } from './prd.js';

// ---------------------------------------------------------------------------
// Exit codes — numeric exit codes that reflect execution result
// ---------------------------------------------------------------------------

/** Exit code constants for the headless golem process. */
export const GolemExitCode = {
  /** Story completed successfully, all quality checks passed. */
  SUCCESS: 0,
  /** Story implementation failed (agent error or quality check failure). */
  STORY_FAILURE: 1,
  /** Infrastructure failure (clone failed, coordinator unreachable, etc.). */
  INFRA_FAILURE: 2,
  /** Execution timed out. */
  TIMEOUT: 3,
} as const;

export type GolemExitCodeValue = (typeof GolemExitCode)[keyof typeof GolemExitCode];

// ---------------------------------------------------------------------------
// Golem spec — JSON configuration for a headless golem run
// ---------------------------------------------------------------------------

/** LLM configuration for the headless golem. */
export interface GolemLLMConfig {
  /** Anthropic API key (can also be set via ANTHROPIC_API_KEY env var). */
  apiKey?: string;
  /** Model identifier (e.g. "claude-sonnet-4-6"). */
  model: string;
  /** Effort/quality level. */
  effort?: string;
  /** System prompt override for the agent. */
  systemPrompt?: string;
}

/** Story specification for the headless golem. */
export interface GolemStorySpec {
  /** Story ID (used for branch naming and coordination). */
  storyId: string;
  /** Story title. */
  title: string;
  /** Full story description including acceptance criteria. */
  description: string;
  /** Acceptance criteria as individual strings. */
  acceptanceCriteria: string[];
  /** Learnings from previous attempts. */
  learnings?: string[];
  /** PRD ID this story belongs to (null for standalone). */
  prdId?: string | null;
  /** Current attempt number. */
  attempt?: number;
  /** Maximum attempts allowed. */
  maxAttempts?: number;
}

/**
 * Full configuration spec for a headless golem run.
 * Can be provided as a JSON file via --spec or assembled from env vars.
 */
export interface GolemSpec {
  /** Repository URL to clone (HTTPS or SSH). */
  repoUrl: string;
  /** Branch to clone and work from. */
  branch: string;
  /** Story specification. */
  story: GolemStorySpec;
  /** LLM configuration. */
  llm: GolemLLMConfig;
  /** Quality checks to run after agent execution. */
  qualityChecks?: QualityCheckConfig[];
  /** Coordinator callback URL (e.g. "https://e-server.example.com/api/story-coordination"). */
  coordinatorUrl?: string;
  /** Executor ID for this golem instance. */
  executorId?: string;
  /** Machine ID for this golem instance (defaults to hostname). */
  machineId?: string;
  /** Execution timeout in milliseconds (default: 600_000 = 10 minutes). */
  timeoutMs?: number;
  /** Whether to auto-commit on success (default: true). */
  autoCommit?: boolean;
  /** Whether to auto-push to remote (default: true). */
  autoPush?: boolean;
  /** Working directory override (default: temp directory). */
  workDir?: string;
  /** Port for the health check server (default: 8080, 0 to disable). */
  healthPort?: number;
  /** WebSocket URL for streaming logs to coordinator. */
  logStreamUrl?: string;
}

// ---------------------------------------------------------------------------
// Structured log entries — JSON lines format for golem output
// ---------------------------------------------------------------------------

/** Log severity levels. */
export type GolemLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/** Golem execution phase. */
export type GolemPhaseType =
  | 'init'
  | 'clone'
  | 'install'
  | 'agent'
  | 'quality_check'
  | 'commit'
  | 'push'
  | 'report'
  | 'shutdown';

/**
 * Structured log entry — each line of golem output is one of these
 * serialized as JSON (JSON Lines format).
 */
export interface GolemLogEntry {
  /** ISO 8601 timestamp. */
  ts: string;
  /** Log severity level. */
  level: GolemLogLevel;
  /** Execution phase. */
  phase: GolemPhaseType;
  /** Human-readable message. */
  msg: string;
  /** Story ID being executed. */
  storyId?: string;
  /** Executor ID. */
  executorId?: string;
  /** Additional structured data. */
  data?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Golem run status — tracks the current state of a headless golem run
// ---------------------------------------------------------------------------

/** Current status of a headless golem run. */
export type GolemRunPhase =
  | 'initializing'
  | 'cloning'
  | 'installing'
  | 'running_agent'
  | 'waiting_for_human'
  | 'running_checks'
  | 'committing'
  | 'pushing'
  | 'reporting'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Status snapshot of a headless golem run. */
export interface GolemRunStatus {
  /** Current phase. */
  phase: GolemRunPhase;
  /** Story ID being executed. */
  storyId: string;
  /** Executor ID. */
  executorId: string;
  /** When the run started (ISO 8601). */
  startedAt: string;
  /** Elapsed time in milliseconds. */
  elapsedMs: number;
  /** Quality check results so far. */
  qualityResults: QualityCheckResult[];
  /** Whether the run is still active. */
  active: boolean;
  /** Error message if failed. */
  error?: string;
  /** Result branch name. */
  branchName?: string;
  /** Result commit SHA. */
  commitSha?: string;
}

// ---------------------------------------------------------------------------
// Default configuration values
// ---------------------------------------------------------------------------

/** Default configuration for headless golem runs. */
export const GOLEM_DEFAULTS = {
  /** Default execution timeout: 10 minutes. */
  timeoutMs: 600_000,
  /** Default health check port. */
  healthPort: 8080,
  /** Default LLM model. */
  model: 'claude-sonnet-4-6',
  /** Default effort level. */
  effort: 'high',
  /** Default heartbeat interval: 30 seconds. */
  heartbeatIntervalMs: 30_000,
  /** Default result branch prefix. */
  branchPrefix: 'golem/',
} as const;
