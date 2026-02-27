// ---------------------------------------------------------------------------
// GolemExecutor — strategy interface for story execution
// ---------------------------------------------------------------------------
// Defines the extension point that all executors (local, remote, cloud) plug
// into.  The Golem Dispatcher selects the appropriate executor based on a
// configured strategy and delegates story execution to it.
// ---------------------------------------------------------------------------

import type { QualityCheckConfig, QualityCheckResult } from './prd.js';

// ---------------------------------------------------------------------------
// Execution context — everything an executor needs to run a story
// ---------------------------------------------------------------------------

/** LLM provider configuration for the executor. */
export interface ExecutorLLMConfig {
  /** Model identifier (e.g. "claude-sonnet-4-20250514"). */
  model: string;
  /** Effort/quality level (e.g. "high", "low"). */
  effort: string;
}

/** Resource constraints for a single execution. */
export interface ExecutorResourceConstraints {
  /** Maximum wall-clock time for the execution in milliseconds. */
  maxDurationMs: number;
  /** Optional memory limit in MB. */
  maxMemoryMb?: number;
  /** Optional CPU core limit. */
  maxCpuCores?: number;
}

/**
 * Everything an executor needs to run a single story execution.
 * Carries repo context, the pre-built prompt, LLM config, quality checks,
 * and resource constraints.
 */
export interface ExecutionContext {
  /** Unique execution ID (for tracking, cancellation, and status queries). */
  executionId: string;
  /** Repository URL — local filesystem path or remote git URL. */
  repoUrl: string;
  /** Branch name to work on. */
  branch: string;
  /** Absolute path to the workspace root. */
  workspacePath: string;

  // --- Story spec ---
  /** Story ID being executed. */
  storyId: string;
  /** Story title (for logging, conversation naming). */
  storyTitle: string;
  /** PRD ID the story belongs to (null for standalone stories). */
  prdId: string | null;

  // --- Prompt ---
  /** Pre-built user prompt for the agent (includes story description, AC, learnings). */
  prompt: string;
  /** Optional system prompt override. */
  systemPrompt?: string;

  // --- Configuration ---
  /** LLM provider configuration. */
  llmConfig: ExecutorLLMConfig;
  /** References to secrets the executor may need (key names only — not values). */
  secretsRefs: Record<string, string>;
  /** Resource constraints for this execution. */
  resourceConstraints: ExecutorResourceConstraints;
  /** Quality checks to run after agent execution. */
  qualityChecks: QualityCheckConfig[];
  /** Whether to auto-commit on success. */
  autoCommit: boolean;
  /** Execution timeout in milliseconds (alias for resourceConstraints.maxDurationMs). */
  timeout: number;
}

// ---------------------------------------------------------------------------
// Execution result — what the executor returns after running a story
// ---------------------------------------------------------------------------

/** Outcome status of an execution. */
export type ExecutionStatus = 'success' | 'failure' | 'timeout' | 'cancelled';

/** Optional cost metadata from the execution. */
export interface ExecutionCostMetadata {
  /** Number of input tokens consumed. */
  inputTokens?: number;
  /** Number of output tokens produced. */
  outputTokens?: number;
  /** Model used for execution. */
  model?: string;
  /** Estimated cost in USD. */
  estimatedCost?: number;
}

/**
 * Result of a single story execution.
 * Contains everything the runner needs to evaluate pass/fail and handle
 * retry/fix-up logic.
 */
export interface ExecutionResult {
  /** Overall outcome status. */
  status: ExecutionStatus;
  /** Git branch the work was done on (null if no branch). */
  branchName: string | null;
  /** Commit SHA if auto-commit succeeded (null otherwise). */
  commitSha: string | null;
  /** Execution log lines. */
  logs: string[];
  /** Wall-clock duration of the execution in milliseconds. */
  duration: number;
  /** Optional cost tracking metadata. */
  costMetadata?: ExecutionCostMetadata;
  /** Raw agent output text. */
  agentOutput: string;
  /** Agent error message (null if no error). */
  agentError: string | null;
  /** Quality check results (raw — not baseline-diffed). */
  qualityResults: QualityCheckResult[];
  /** Conversation ID created for this execution (null if none). */
  conversationId: string | null;
  /** Agent/session ID used for this execution (null if none). */
  agentId: string | null;
}

// ---------------------------------------------------------------------------
// Executor status & capabilities
// ---------------------------------------------------------------------------

/** Current status of an executor or a specific execution. */
export type ExecutorStatusType = 'idle' | 'busy' | 'executing' | 'offline' | 'error';

/** Status snapshot for a running (or completed) execution. */
export interface ExecutorStatus {
  /** Current status. */
  status: ExecutorStatusType;
  /** Execution ID this status refers to (null if executor-level status). */
  executionId: string | null;
  /** Human-readable status message. */
  message: string;
  /** Progress percentage 0-100 (null if unknown). */
  progress: number | null;
  /** Timestamp of this status snapshot. */
  timestamp: number;
}

/** What an executor is capable of. */
export interface ExecutorCapabilities {
  /** Whether this executor can run stories locally (same machine). */
  supportsLocal: boolean;
  /** Whether this executor can run stories on a remote machine. */
  supportsRemote: boolean;
  /** Whether this executor supports worktree-isolated execution. */
  supportsWorktrees: boolean;
  /** Maximum concurrent executions (0 = unlimited). */
  maxConcurrency: number;
  /** Supported LLM models. Empty array = all models. */
  supportedModels: string[];
  /** Whether this executor can run quality checks. */
  supportsQualityChecks: boolean;
  /** Whether this executor supports auto-commit. */
  supportsAutoCommit: boolean;
}

/** Metadata about a registered executor type. */
export interface ExecutorInfo {
  /** Unique type identifier (e.g. "local-worktree", "remote-ssh"). */
  type: string;
  /** Human-readable name. */
  name: string;
  /** Description of what this executor does. */
  description: string;
  /** Capabilities of this executor type. */
  capabilities: ExecutorCapabilities;
}

// ---------------------------------------------------------------------------
// GolemExecutor — the strategy interface
// ---------------------------------------------------------------------------

/**
 * Strategy interface for story execution.
 * Implementations handle the mechanics of running an agent on a story:
 * creating conversations, spawning agents, reading streams, running quality
 * checks, and optionally committing.
 *
 * The Golem Dispatcher selects the appropriate executor and delegates to it.
 */
export interface GolemExecutor {
  /** Unique type identifier for this executor. */
  readonly type: string;

  /** Human-readable name. */
  readonly name: string;

  /**
   * Whether this executor can handle the given execution context.
   * Used by the dispatcher to filter eligible executors.
   */
  canExecute(context: ExecutionContext): boolean;

  /**
   * Execute a story. Returns when the execution is complete (or fails/times out).
   * The caller is responsible for interpreting the result and handling retries.
   */
  execute(context: ExecutionContext): Promise<ExecutionResult>;

  /**
   * Cancel a running execution by its execution ID.
   * No-op if the execution is already complete or unknown.
   */
  cancel(executionId: string): Promise<void>;

  /**
   * Get the current status of an execution or the executor itself.
   * Pass null to get executor-level status, or an execution ID for a specific run.
   */
  getStatus(executionId?: string): ExecutorStatus;

  /**
   * Describe the capabilities of this executor.
   */
  getCapabilities(): ExecutorCapabilities;
}

// ---------------------------------------------------------------------------
// Dispatcher strategy types
// ---------------------------------------------------------------------------

/**
 * Strategy for how the Golem Dispatcher selects an executor.
 * - local-only: always use the local executor (default for now)
 * - round-robin: rotate among available executors
 * - cost-optimized: prefer the cheapest available executor
 * - latency-optimized: prefer the fastest available executor
 * - manual: explicit executor type selection per execution
 */
export type DispatchStrategy =
  | 'local-only'
  | 'round-robin'
  | 'cost-optimized'
  | 'latency-optimized'
  | 'manual';
