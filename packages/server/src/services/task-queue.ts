/**
 * Background Task Queue Service
 *
 * Priority-based work queue. Tasks are processed by priority order,
 * with optional preemption for critical tasks.
 */

import { EventEmitter } from 'events';
import { nanoid } from 'nanoid';
import type {
  QueuedTask,
  QueuedTaskStatus,
  TaskQueuePriority,
  TaskQueueConfig,
  TaskQueueStats,
  StreamTaskQueueEvent,
} from '@e/shared';
import { PRIORITY_VALUES, DEFAULT_TASK_QUEUE_CONFIG } from '@e/shared';

type TaskHandler = (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;

class TaskQueueService extends EventEmitter {
  private static instance: TaskQueueService;
  private config: TaskQueueConfig = { ...DEFAULT_TASK_QUEUE_CONFIG };
  private queue: QueuedTask[] = [];
  private running = new Map<string, QueuedTask>();
  private completed: QueuedTask[] = [];
  private handlers = new Map<string, TaskHandler>();
  private processInterval?: ReturnType<typeof setInterval>;

  static getInstance(): TaskQueueService {
    if (!TaskQueueService.instance) {
      TaskQueueService.instance = new TaskQueueService();
    }
    return TaskQueueService.instance;
  }

  /**
   * Start processing the queue.
   */
  start(): void {
    if (this.processInterval) return;
    this.processInterval = setInterval(() => this.process(), this.config.processIntervalMs);
  }

  /**
   * Stop processing.
   */
  stop(): void {
    if (this.processInterval) {
      clearInterval(this.processInterval);
      this.processInterval = undefined;
    }
  }

  /**
   * Register a handler for a task type.
   */
  registerHandler(name: string, handler: TaskHandler): void {
    this.handlers.set(name, handler);
  }

  /**
   * Enqueue a task.
   */
  enqueue(
    name: string,
    payload: Record<string, unknown> = {},
    priority: TaskQueuePriority = 'normal',
    opts?: { timeoutMs?: number; maxRetries?: number; groupId?: string; source?: string },
  ): QueuedTask {
    if (this.queue.length >= this.config.maxQueueSize) {
      throw new Error(`Queue full (max ${this.config.maxQueueSize})`);
    }

    const task: QueuedTask = {
      id: nanoid(12),
      name,
      priority,
      status: 'queued',
      payload,
      timeoutMs: opts?.timeoutMs || this.config.defaultTimeoutMs,
      retries: 0,
      maxRetries: opts?.maxRetries ?? this.config.defaultMaxRetries,
      createdAt: Date.now(),
      source: opts?.source,
      groupId: opts?.groupId,
    };

    this.queue.push(task);
    this.sortQueue();
    this.emitEvent('queued', task);

    return task;
  }

  /**
   * Cancel a queued or running task.
   */
  cancel(taskId: string): boolean {
    // Check queue
    const qIdx = this.queue.findIndex((t) => t.id === taskId);
    if (qIdx >= 0) {
      const task = this.queue.splice(qIdx, 1)[0];
      task.status = 'cancelled';
      task.completedAt = Date.now();
      this.completed.push(task);
      this.emitEvent('cancelled', task);
      return true;
    }

    // Check running
    const running = this.running.get(taskId);
    if (running) {
      running.status = 'cancelled';
      running.completedAt = Date.now();
      this.running.delete(taskId);
      this.completed.push(running);
      this.emitEvent('cancelled', running);
      return true;
    }

    return false;
  }

  /**
   * Get a task by ID.
   */
  getTask(taskId: string): QueuedTask | undefined {
    return (
      this.queue.find((t) => t.id === taskId) ||
      this.running.get(taskId) ||
      this.completed.find((t) => t.id === taskId)
    );
  }

  /**
   * Get all tasks.
   */
  getAllTasks(): QueuedTask[] {
    return [...this.queue, ...Array.from(this.running.values()), ...this.completed.slice(-50)];
  }

  /**
   * Get queue stats.
   */
  getStats(): TaskQueueStats {
    const completedTasks = this.completed.filter((t) => t.status === 'completed');
    const failedTasks = this.completed.filter((t) => t.status === 'failed');
    const cancelledTasks = this.completed.filter((t) => t.status === 'cancelled');

    const avgWait =
      completedTasks.length > 0
        ? completedTasks.reduce((sum, t) => sum + ((t.startedAt || t.createdAt) - t.createdAt), 0) /
          completedTasks.length
        : 0;
    const avgExec =
      completedTasks.length > 0
        ? completedTasks.reduce((sum, t) => sum + ((t.completedAt || 0) - (t.startedAt || 0)), 0) /
          completedTasks.length
        : 0;

    return {
      queued: this.queue.length,
      running: this.running.size,
      completed: completedTasks.length,
      failed: failedTasks.length,
      cancelled: cancelledTasks.length,
      avgWaitTimeMs: Math.round(avgWait),
      avgExecutionTimeMs: Math.round(avgExec),
    };
  }

  setConfig(config: Partial<TaskQueueConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): TaskQueueConfig {
    return { ...this.config };
  }

  private async process(): Promise<void> {
    // Check for timed-out tasks
    for (const [id, task] of this.running) {
      if (task.startedAt && Date.now() - task.startedAt > task.timeoutMs) {
        task.status = 'timeout';
        task.error = 'Task timed out';
        task.completedAt = Date.now();
        this.running.delete(id);
        this.completed.push(task);
        this.emitEvent('failed', task);
      }
    }

    // Process queue
    while (this.running.size < this.config.maxConcurrent && this.queue.length > 0) {
      const task = this.queue.shift();
      if (!task) break;

      const handler = this.handlers.get(task.name);
      if (!handler) {
        task.status = 'failed';
        task.error = `No handler registered for task type: ${task.name}`;
        task.completedAt = Date.now();
        this.completed.push(task);
        this.emitEvent('failed', task);
        continue;
      }

      task.status = 'running';
      task.startedAt = Date.now();
      this.running.set(task.id, task);
      this.emitEvent('started', task);

      // Execute async
      handler(task.payload)
        .then((result) => {
          task.status = 'completed';
          task.result = result;
          task.completedAt = Date.now();
          this.running.delete(task.id);
          this.completed.push(task);
          this.emitEvent('completed', task);
        })
        .catch((err) => {
          task.retries++;
          if (task.retries <= task.maxRetries) {
            // Re-queue for retry
            task.status = 'queued';
            task.startedAt = undefined;
            this.running.delete(task.id);
            this.queue.push(task);
            this.sortQueue();
          } else {
            task.status = 'failed';
            task.error = err.message;
            task.completedAt = Date.now();
            this.running.delete(task.id);
            this.completed.push(task);
            this.emitEvent('failed', task);
          }
        });
    }

    // Trim completed history
    if (this.completed.length > 200) {
      this.completed = this.completed.slice(-100);
    }
  }

  private sortQueue(): void {
    this.queue.sort((a, b) => {
      const pa = PRIORITY_VALUES[a.priority] ?? 2;
      const pb = PRIORITY_VALUES[b.priority] ?? 2;
      if (pa !== pb) return pa - pb;
      return a.createdAt - b.createdAt;
    });
  }

  private emitEvent(event: StreamTaskQueueEvent['event'], task: QueuedTask): void {
    this.emit('task_queue_event', {
      type: 'task_queue_event',
      event,
      data: { taskId: task.id, name: task.name, priority: task.priority, error: task.error },
    } satisfies StreamTaskQueueEvent);
  }
}

export const taskQueue = TaskQueueService.getInstance();
