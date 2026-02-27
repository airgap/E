// ---------------------------------------------------------------------------
// Distributed Story Coordination Protocol
// ---------------------------------------------------------------------------
// Types and interfaces for atomic story claiming, lease-based locking,
// heartbeat renewal, and result reporting across distributed golems.
// The E server (coordinator) is the single source of truth.
// ---------------------------------------------------------------------------

import type { StoryStatus, QualityCheckResult } from './prd.js';

// ---------------------------------------------------------------------------
// Executor metadata — tracks which executor is working on a story
// ---------------------------------------------------------------------------

/** Metadata about the executor currently assigned to a story. */
export interface StoryExecutorMetadata {
  /** Unique ID of the executor instance (e.g. session ID, agent ID). */
  executorId: string;
  /** Type of executor (e.g. "local-worktree", "remote-ssh", "cloud-vm"). */
  executorType: string;
  /** Machine/VM identifier where the executor is running. */
  machineId: string;
  /** Timestamp when the executor started working on the story. */
  startedAt: number;
  /** Timestamp of the last heartbeat from the executor. */
  lastHeartbeat: number;
  /** Git branch name assigned for this story's work. */
  assignedBranch: string;
  /** Timestamp when the lease expires if no heartbeat is received. */
  leaseExpiresAt: number;
}

// ---------------------------------------------------------------------------
// Coordination configuration
// ---------------------------------------------------------------------------

/** Configuration for the story coordination protocol. */
export interface CoordinationConfig {
  /** How often executors should send heartbeats, in milliseconds. Default: 60_000 (60s). */
  heartbeatIntervalMs: number;
  /** How long before a lease expires without a heartbeat, in milliseconds. Default: 300_000 (5min). */
  leaseExpiryMs: number;
  /** Maximum number of retry attempts for timed-out stories. Default: 2. */
  maxTimeoutRetries: number;
}

/** Default coordination configuration. */
export const DEFAULT_COORDINATION_CONFIG: CoordinationConfig = {
  heartbeatIntervalMs: 60_000,
  leaseExpiryMs: 300_000,
  maxTimeoutRetries: 2,
};

// ---------------------------------------------------------------------------
// Story claim protocol
// ---------------------------------------------------------------------------

/** Request to claim a story for execution. */
export interface StoryClaimRequest {
  /** Story ID to claim. */
  storyId: string;
  /** Unique ID of the executor instance. */
  executorId: string;
  /** Type of executor (e.g. "local-worktree", "remote-ssh"). */
  executorType: string;
  /** Machine/VM identifier. */
  machineId: string;
  /** Git branch name to use for this story. */
  assignedBranch: string;
}

/** Response from a story claim attempt. */
export interface StoryClaimResponse {
  /** Whether the claim was successful. */
  claimed: boolean;
  /** If claimed, the lease expiry timestamp. */
  leaseExpiresAt?: number;
  /** If not claimed, the reason. */
  reason?: string;
  /** If not claimed due to conflict, the ID of the executor that holds the lease. */
  currentExecutorId?: string;
  /** Unmet dependency story IDs (if claim rejected due to dependencies). */
  unmetDependencies?: string[];
}

// ---------------------------------------------------------------------------
// Heartbeat protocol
// ---------------------------------------------------------------------------

/** Request to renew a heartbeat for a claimed story. */
export interface StoryHeartbeatRequest {
  /** Unique ID of the executor sending the heartbeat. */
  executorId: string;
  /** Optional progress update (0-100). */
  progress?: number;
  /** Optional status message. */
  message?: string;
}

/** Response from a heartbeat renewal. */
export interface StoryHeartbeatResponse {
  /** Whether the heartbeat was accepted. */
  renewed: boolean;
  /** New lease expiry timestamp (if renewed). */
  leaseExpiresAt?: number;
  /** If not renewed, the reason (e.g. "lease_expired", "wrong_executor"). */
  reason?: string;
}

// ---------------------------------------------------------------------------
// Result reporting protocol
// ---------------------------------------------------------------------------

/** Request to report the result of a story execution. */
export interface StoryResultReport {
  /** Unique ID of the executor reporting. */
  executorId: string;
  /** Outcome status. */
  status: 'success' | 'failure' | 'timeout' | 'cancelled';
  /** Git branch name where the work was done. */
  branchName?: string;
  /** Git commit SHA (if auto-committed). */
  commitSha?: string;
  /** Execution logs. */
  logs?: string[];
  /** Wall-clock duration in milliseconds. */
  durationMs?: number;
  /** Quality check results. */
  qualityResults?: QualityCheckResult[];
  /** Agent output text. */
  agentOutput?: string;
  /** Agent error message. */
  agentError?: string;
  /** Learnings from this execution attempt. */
  learnings?: string[];
  /** Conversation ID if one was created. */
  conversationId?: string;
  /** Agent/session ID used. */
  agentId?: string;
}

/** Response from reporting a story result. */
export interface StoryResultResponse {
  /** Whether the result was accepted. */
  accepted: boolean;
  /** New story status after processing the result. */
  newStatus?: StoryStatus;
  /** If not accepted, the reason. */
  reason?: string;
  /** Whether a merge-back workflow was triggered. */
  mergeTriggered?: boolean;
}

// ---------------------------------------------------------------------------
// Available stories query
// ---------------------------------------------------------------------------

/** Request to list stories available for claiming. */
export interface AvailableStoriesRequest {
  /** Workspace path to filter by. */
  workspacePath?: string;
  /** PRD ID to filter by. */
  prdId?: string;
  /** Executor type filter (only return stories this executor type can handle). */
  executorType?: string;
}

/** A story that is available for claiming. */
export interface AvailableStory {
  /** Story ID. */
  id: string;
  /** Story title. */
  title: string;
  /** Story description. */
  description: string;
  /** Priority. */
  priority: string;
  /** PRD ID (null for standalone). */
  prdId: string | null;
  /** Workspace path. */
  workspacePath: string;
  /** Acceptance criteria descriptions. */
  acceptanceCriteria: string[];
  /** Learnings from previous attempts. */
  learnings: string[];
  /** Current attempt count. */
  attempts: number;
  /** Maximum attempts allowed. */
  maxAttempts: number;
  /** Stories this story depends on. */
  dependsOn: string[];
}

// ---------------------------------------------------------------------------
// Coordination events (for SSE/real-time updates)
// ---------------------------------------------------------------------------

/** Events emitted by the story coordinator. */
export type CoordinationEventType =
  | 'story_claimed'
  | 'story_heartbeat'
  | 'story_completed'
  | 'story_failed'
  | 'story_timeout'
  | 'story_released'
  | 'merge_triggered'
  | 'story_question'
  | 'story_answered';

/** A coordination event payload. */
export interface CoordinationEvent {
  type: CoordinationEventType;
  storyId: string;
  executorId?: string;
  executorType?: string;
  machineId?: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Human assistance protocol — golems can request user input when blocked
// ---------------------------------------------------------------------------

/** A question submitted by a golem that needs a human response. */
export interface GolemQuestion {
  /** Unique question ID. */
  questionId: string;
  /** Story being worked on. */
  storyId: string;
  /** Executor that asked the question. */
  executorId: string;
  /** The question text. */
  question: string;
  /** Optional context/background to help the user answer. */
  context?: string;
  /** When the question was asked (Unix ms). */
  askedAt: number;
  /** When the question was answered (Unix ms), if answered. */
  answeredAt?: number;
  /** The answer, if answered. */
  answer?: string;
}
