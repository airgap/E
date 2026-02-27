import { EventEmitter } from 'events';
import { nanoid } from 'nanoid';
import { getDb } from '../db/database';
import { claudeManager } from './claude-process';
import type { ScheduledTask, ScheduledTaskExecution, StreamScheduledTaskEvent } from '@e/shared';

/*
 * Simple cron parser that supports common patterns.
 * Format: "minute hour day month weekday"
 * Supports numbers, wildcards, steps, ranges, and lists.
 *
 * Examples:
 * - "0 9 * * *" for daily at 9am
 * - "* /30 * * * *" for every 30 minutes
 * - "0 0 * * 1" for every Monday at midnight
 */
class CronParser {
  /**
   * Calculate the next run time for a cron expression
   */
  static getNextRun(cronExpression: string, after: Date = new Date()): Date {
    const parts = cronExpression.trim().split(/\s+/);
    if (parts.length !== 5) {
      throw new Error('Cron expression must have 5 parts: minute hour day month weekday');
    }

    const [minutePart, hourPart, dayPart, monthPart, weekdayPart] = parts;

    // Start from the next minute
    const next = new Date(after);
    next.setSeconds(0);
    next.setMilliseconds(0);
    next.setMinutes(next.getMinutes() + 1);

    // Try up to 4 years in the future (prevent infinite loops)
    const maxAttempts = 365 * 4 * 24 * 60;
    let attempts = 0;

    while (attempts < maxAttempts) {
      const minute = next.getMinutes();
      const hour = next.getHours();
      const day = next.getDate();
      const month = next.getMonth() + 1; // JS months are 0-indexed
      const weekday = next.getDay(); // 0 = Sunday

      if (
        this.matchesPart(minute, minutePart, 0, 59) &&
        this.matchesPart(hour, hourPart, 0, 23) &&
        this.matchesPart(day, dayPart, 1, 31) &&
        this.matchesPart(month, monthPart, 1, 12) &&
        this.matchesPart(weekday, weekdayPart, 0, 6)
      ) {
        return next;
      }

      // Increment by one minute and try again
      next.setMinutes(next.getMinutes() + 1);
      attempts++;
    }

    throw new Error('Could not find next run time for cron expression');
  }

  /**
   * Check if a value matches a cron expression part
   */
  private static matchesPart(value: number, part: string, min: number, max: number): boolean {
    // Wildcard
    if (part === '*') return true;

    // Step values (e.g., */5)
    if (part.startsWith('*/')) {
      const step = parseInt(part.slice(2), 10);
      return value % step === 0;
    }

    // Range (e.g., 1-5)
    if (part.includes('-')) {
      const [start, end] = part.split('-').map((n) => parseInt(n, 10));
      return value >= start && value <= end;
    }

    // List (e.g., 1,3,5)
    if (part.includes(',')) {
      const values = part.split(',').map((n) => parseInt(n, 10));
      return values.includes(value);
    }

    // Single value
    return value === parseInt(part, 10);
  }

  /**
   * Validate a cron expression
   */
  static isValid(cronExpression: string): boolean {
    try {
      const parts = cronExpression.trim().split(/\s+/);
      if (parts.length !== 5) return false;

      // Try to get next run - if it throws, expression is invalid
      this.getNextRun(cronExpression);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Manages scheduled task execution. Singleton instance.
 * Checks for tasks to run every minute and spawns agents as needed.
 */
class TaskScheduler {
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  readonly events = new EventEmitter();
  private running = false;

  constructor() {
    // Initialize on startup
    this.start();
  }

  /**
   * Start the scheduler - begins checking for tasks to run
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    console.log('[scheduler] Starting task scheduler');

    // Check for tasks to run every minute
    this.checkInterval = setInterval(() => {
      this.checkAndRunTasks().catch((err) => {
        console.error('[scheduler] Error checking tasks:', err);
      });
    }, 60_000); // Check every minute

    // Also check immediately on startup
    this.checkAndRunTasks().catch((err) => {
      console.error('[scheduler] Error checking tasks on startup:', err);
    });
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    console.log('[scheduler] Stopped task scheduler');
  }

  /**
   * Check for tasks that should run now and execute them
   */
  private async checkAndRunTasks(): Promise<void> {
    const db = getDb();
    const now = Date.now();

    // Find active tasks that should run now
    const tasks = db
      .query(
        `SELECT * FROM scheduled_tasks
         WHERE status = 'active'
         AND (next_run IS NULL OR next_run <= ?)
         ORDER BY next_run ASC`,
      )
      .all(now) as any[];

    console.log(`[scheduler] Found ${tasks.length} tasks to process`);

    for (const taskRow of tasks) {
      try {
        const task = this.taskFromRow(taskRow);
        await this.executeTask(task);
      } catch (err) {
        console.error(`[scheduler] Error executing task ${taskRow.id}:`, err);
      }
    }
  }

  /**
   * Execute a scheduled task by creating a conversation and sending the prompt
   */
  private async executeTask(task: ScheduledTask): Promise<void> {
    const db = getDb();
    const executionId = nanoid(12);
    const now = Date.now();

    console.log(`[scheduler] Executing task "${task.name}" (${task.id})`);

    // Create execution record
    db.query(
      `INSERT INTO scheduled_task_executions (id, task_id, status, started_at)
       VALUES (?, ?, 'running', ?)`,
    ).run(executionId, task.id, now);

    // Emit start event
    this.emitEvent(task.id, 'started', {
      executionId,
      message: `Started execution of "${task.name}"`,
    });

    let conversationId: string | null = null;
    let success = false;
    let errorMessage: string | null = null;

    try {
      // Get workspace info
      const workspace = db
        .query('SELECT * FROM workspaces WHERE id = ?')
        .get(task.workspaceId) as any;

      if (!workspace) {
        throw new Error(`Workspace ${task.workspaceId} not found`);
      }

      // Create conversation
      conversationId = nanoid();
      const model = 'claude-sonnet-4-6';

      db.query(
        `INSERT INTO conversations (id, title, model, workspace_path, workspace_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        conversationId,
        `[Scheduled] ${task.name}`,
        model,
        workspace.path,
        task.workspaceId,
        now,
        now,
      );

      // Update execution with conversation ID
      db.query(`UPDATE scheduled_task_executions SET conversation_id = ? WHERE id = ?`).run(
        conversationId,
        executionId,
      );

      // Add user message
      db.query(
        `INSERT INTO messages (id, conversation_id, role, content, timestamp)
         VALUES (?, ?, 'user', ?, ?)`,
      ).run(nanoid(), conversationId, JSON.stringify([{ type: 'text', text: task.prompt }]), now);

      // Get agent profile if specified
      let systemPrompt: string | undefined;
      let effort = 'high';

      if (task.profileId) {
        const profile = db
          .query('SELECT * FROM agent_profiles WHERE id = ?')
          .get(task.profileId) as any;
        if (profile) {
          systemPrompt = profile.system_prompt;
          // Profiles don't have effort, use default 'high'
        }
      }

      // Spawn Claude session
      const sessionId = await claudeManager.createSession(conversationId, {
        model,
        workspacePath: workspace.path,
        effort,
        systemPrompt,
      });

      // Send message and wait for completion
      const stream = await claudeManager.sendMessage(sessionId, task.prompt);
      const reader = stream.getReader();

      // Read stream to completion (timeout after 30 minutes)
      const TIMEOUT_MS = 30 * 60 * 1000;
      const startTime = Date.now();

      while (true) {
        if (Date.now() - startTime > TIMEOUT_MS) {
          throw new Error('Task execution timed out after 30 minutes');
        }

        const result = await reader.read();
        if (result.done) break;

        // We don't need to process the chunks, just consume the stream
      }

      success = true;
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[scheduler] Task execution failed:`, err);
    }

    // Update execution record
    const completedAt = Date.now();
    const durationMs = completedAt - now;

    db.query(
      `UPDATE scheduled_task_executions
       SET status = ?, completed_at = ?, duration_ms = ?, error_message = ?
       WHERE id = ?`,
    ).run(success ? 'success' : 'failed', completedAt, durationMs, errorMessage, executionId);

    // Update task's last run time and calculate next run
    const nextRun = this.calculateNextRun(task);

    db.query(
      `UPDATE scheduled_tasks SET last_run = ?, next_run = ?, updated_at = ? WHERE id = ?`,
    ).run(now, nextRun, Date.now(), task.id);

    // Emit completion event
    this.emitEvent(task.id, success ? 'completed' : 'failed', {
      executionId,
      conversationId: conversationId || undefined,
      message: success ? `Completed execution in ${durationMs}ms` : `Failed: ${errorMessage}`,
    });

    console.log(
      `[scheduler] Task "${task.name}" ${success ? 'completed' : 'failed'} in ${durationMs}ms`,
    );
  }

  /**
   * Calculate the next run time for a task
   */
  private calculateNextRun(task: ScheduledTask): number {
    if (task.cronExpression) {
      try {
        const next = CronParser.getNextRun(task.cronExpression);
        return next.getTime();
      } catch (err) {
        console.error(
          `[scheduler] Error calculating next run for cron "${task.cronExpression}":`,
          err,
        );
        // Fall back to 1 hour from now
        return Date.now() + 60 * 60 * 1000;
      }
    } else if (task.intervalMinutes) {
      return Date.now() + task.intervalMinutes * 60 * 1000;
    } else {
      // No schedule defined - shouldn't happen, but default to 1 hour
      console.warn(`[scheduler] Task ${task.id} has no cron or interval`);
      return Date.now() + 60 * 60 * 1000;
    }
  }

  /**
   * Manually trigger a task to run now (ignores schedule)
   */
  async runTaskNow(taskId: string): Promise<string> {
    const db = getDb();
    const taskRow = db.query('SELECT * FROM scheduled_tasks WHERE id = ?').get(taskId) as any;

    if (!taskRow) {
      throw new Error(`Task ${taskId} not found`);
    }

    const task = this.taskFromRow(taskRow);
    await this.executeTask(task);

    // Return the execution ID (last one created)
    const execution = db
      .query(
        'SELECT id FROM scheduled_task_executions WHERE task_id = ? ORDER BY started_at DESC LIMIT 1',
      )
      .get(taskId) as any;

    return execution?.id || '';
  }

  /**
   * Pause a task (sets status to paused)
   */
  pauseTask(taskId: string): void {
    const db = getDb();
    db.query(`UPDATE scheduled_tasks SET status = 'paused', updated_at = ? WHERE id = ?`).run(
      Date.now(),
      taskId,
    );
    console.log(`[scheduler] Paused task ${taskId}`);
  }

  /**
   * Resume a task (sets status to active and calculates next run)
   */
  resumeTask(taskId: string): void {
    const db = getDb();
    const taskRow = db.query('SELECT * FROM scheduled_tasks WHERE id = ?').get(taskId) as any;

    if (!taskRow) {
      throw new Error(`Task ${taskId} not found`);
    }

    const task = this.taskFromRow(taskRow);
    const nextRun = this.calculateNextRun(task);

    db.query(
      `UPDATE scheduled_tasks SET status = 'active', next_run = ?, updated_at = ? WHERE id = ?`,
    ).run(nextRun, Date.now(), taskId);

    console.log(`[scheduler] Resumed task ${taskId}, next run: ${new Date(nextRun)}`);
  }

  /**
   * Get execution history for a task
   */
  getExecutions(taskId: string, limit: number = 50): ScheduledTaskExecution[] {
    const db = getDb();
    const rows = db
      .query(
        `SELECT * FROM scheduled_task_executions
         WHERE task_id = ?
         ORDER BY started_at DESC
         LIMIT ?`,
      )
      .all(taskId, limit) as any[];

    return rows.map(this.executionFromRow);
  }

  private taskFromRow(row: any): ScheduledTask {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      name: row.name,
      description: row.description || '',
      cronExpression: row.cron_expression || undefined,
      intervalMinutes: row.interval_minutes || undefined,
      prompt: row.prompt,
      profileId: row.profile_id || undefined,
      status: row.status,
      retryOnFailure: Boolean(row.retry_on_failure),
      maxRetries: row.max_retries,
      lastRun: row.last_run || undefined,
      nextRun: row.next_run || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private executionFromRow(row: any): ScheduledTaskExecution {
    return {
      id: row.id,
      taskId: row.task_id,
      conversationId: row.conversation_id || undefined,
      status: row.status,
      startedAt: row.started_at,
      completedAt: row.completed_at || undefined,
      durationMs: row.duration_ms || undefined,
      errorMessage: row.error_message || undefined,
      outputSummary: row.output_summary || undefined,
    };
  }

  private emitEvent(
    taskId: string,
    event: StreamScheduledTaskEvent['event'],
    data: StreamScheduledTaskEvent['data'],
  ): void {
    const evt: StreamScheduledTaskEvent = {
      type: 'scheduled_task_event',
      taskId,
      event,
      data,
    };
    this.events.emit('scheduled_task_event', evt);
  }
}

export const taskScheduler = new TaskScheduler();
export { CronParser };
