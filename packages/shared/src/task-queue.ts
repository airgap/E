/**
 * Background Task Queue with Priority
 *
 * Priority-based work queue for background processing.
 * High-urgency tasks preempt low-priority background work.
 */

export type TaskQueuePriority = 'critical' | 'high' | 'normal' | 'low' | 'idle';

export type QueuedTaskStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout';

export interface QueuedTask {
  id: string;
  /** Task name/type */
  name: string;
  /** Priority level */
  priority: TaskQueuePriority;
  /** Current status */
  status: QueuedTaskStatus;
  /** Arbitrary task payload */
  payload: Record<string, unknown>;
  /** Maximum execution time (ms) */
  timeoutMs: number;
  /** Number of retry attempts */
  retries: number;
  maxRetries: number;
  /** Result data (on completion) */
  result?: Record<string, unknown>;
  /** Error message (on failure) */
  error?: string;
  /** When this task was queued */
  createdAt: number;
  /** When execution started */
  startedAt?: number;
  /** When execution completed/failed */
  completedAt?: number;
  /** Who/what queued this task */
  source?: string;
  /** Group ID for related tasks */
  groupId?: string;
}

export interface TaskQueueConfig {
  /** Maximum concurrent running tasks */
  maxConcurrent: number;
  /** Maximum queue depth */
  maxQueueSize: number;
  /** Default timeout per task (ms) */
  defaultTimeoutMs: number;
  /** Default max retries */
  defaultMaxRetries: number;
  /** Process interval (ms) — how often to check for new work */
  processIntervalMs: number;
  /** Whether to allow preemption (high priority pauses low priority) */
  allowPreemption: boolean;
}

export const PRIORITY_VALUES: Record<TaskQueuePriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
  idle: 4,
};

export const DEFAULT_TASK_QUEUE_CONFIG: TaskQueueConfig = {
  maxConcurrent: 3,
  maxQueueSize: 100,
  defaultTimeoutMs: 300000, // 5 minutes
  defaultMaxRetries: 2,
  processIntervalMs: 1000,
  allowPreemption: true,
};

export interface TaskQueueStats {
  queued: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
  avgWaitTimeMs: number;
  avgExecutionTimeMs: number;
}

export interface StreamTaskQueueEvent {
  type: 'task_queue_event';
  event: 'queued' | 'started' | 'completed' | 'failed' | 'cancelled' | 'preempted';
  data: {
    taskId: string;
    name: string;
    priority: TaskQueuePriority;
    error?: string;
  };
}
