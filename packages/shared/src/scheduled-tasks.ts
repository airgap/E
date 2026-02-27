// --- Scheduled Task Types ---

export type ScheduledTaskStatus = 'active' | 'paused' | 'disabled';

export type ScheduledTaskExecutionStatus = 'running' | 'success' | 'failed' | 'cancelled';

/**
 * A scheduled task that runs at specified intervals
 */
export interface ScheduledTask {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  /** Cron expression (e.g., "0 9 * * *" for daily at 9am) */
  cronExpression?: string;
  /** Simple interval in minutes (alternative to cron) */
  intervalMinutes?: number;
  /** The prompt/action to execute */
  prompt: string;
  /** Optional agent profile to use */
  profileId?: string;
  /** Task status */
  status: ScheduledTaskStatus;
  /** Whether to retry on failure */
  retryOnFailure: boolean;
  /** Maximum number of retries */
  maxRetries: number;
  /** Last execution timestamp */
  lastRun?: number;
  /** Next scheduled execution timestamp */
  nextRun?: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * A single execution of a scheduled task
 */
export interface ScheduledTaskExecution {
  id: string;
  taskId: string;
  conversationId?: string;
  status: ScheduledTaskExecutionStatus;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  errorMessage?: string;
  outputSummary?: string;
}

/**
 * Input for creating a scheduled task
 */
export interface ScheduledTaskCreateInput {
  workspaceId: string;
  name: string;
  description?: string;
  cronExpression?: string;
  intervalMinutes?: number;
  prompt: string;
  profileId?: string;
  retryOnFailure?: boolean;
  maxRetries?: number;
}

/**
 * Input for updating a scheduled task
 */
export interface ScheduledTaskUpdateInput {
  name?: string;
  description?: string;
  cronExpression?: string;
  intervalMinutes?: number;
  prompt?: string;
  profileId?: string;
  status?: ScheduledTaskStatus;
  retryOnFailure?: boolean;
  maxRetries?: number;
}

/**
 * Scheduled task with execution statistics
 */
export interface ScheduledTaskWithStats extends ScheduledTask {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  lastExecutionStatus?: ScheduledTaskExecutionStatus;
  averageDurationMs?: number;
}

/**
 * Stream event for scheduled task execution updates
 */
export interface StreamScheduledTaskEvent {
  type: 'scheduled_task_event';
  taskId: string;
  event: 'started' | 'completed' | 'failed';
  data: {
    executionId: string;
    conversationId?: string;
    message?: string;
  };
}
