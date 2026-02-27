import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { getDb } from '../db/database';
import { taskScheduler, CronParser } from '../services/task-scheduler';
import type {
  ScheduledTask,
  ScheduledTaskCreateInput,
  ScheduledTaskUpdateInput,
  ScheduledTaskWithStats,
} from '@e/shared';

const app = new Hono();

/**
 * List all scheduled tasks for a workspace
 */
app.get('/', (c) => {
  const workspaceId = c.req.query('workspaceId');

  if (!workspaceId) {
    return c.json({ ok: false, error: 'workspaceId query parameter required' }, 400);
  }

  const db = getDb();
  const tasks = db
    .query('SELECT * FROM scheduled_tasks WHERE workspace_id = ? ORDER BY created_at DESC')
    .all(workspaceId) as any[];

  const result: ScheduledTaskWithStats[] = tasks.map((t) => {
    // Get execution stats
    const stats = db
      .query(
        `SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
          AVG(CASE WHEN duration_ms IS NOT NULL THEN duration_ms ELSE NULL END) as avg_duration
         FROM scheduled_task_executions
         WHERE task_id = ?`,
      )
      .get(t.id) as any;

    const lastExecution = db
      .query(
        'SELECT status FROM scheduled_task_executions WHERE task_id = ? ORDER BY started_at DESC LIMIT 1',
      )
      .get(t.id) as any;

    return {
      id: t.id,
      workspaceId: t.workspace_id,
      name: t.name,
      description: t.description || '',
      cronExpression: t.cron_expression || undefined,
      intervalMinutes: t.interval_minutes || undefined,
      prompt: t.prompt,
      profileId: t.profile_id || undefined,
      status: t.status,
      retryOnFailure: Boolean(t.retry_on_failure),
      maxRetries: t.max_retries,
      lastRun: t.last_run || undefined,
      nextRun: t.next_run || undefined,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
      totalExecutions: stats?.total || 0,
      successfulExecutions: stats?.successful || 0,
      failedExecutions: stats?.failed || 0,
      lastExecutionStatus: lastExecution?.status || undefined,
      averageDurationMs: stats?.avg_duration || undefined,
    };
  });

  return c.json({ ok: true, data: result });
});

/**
 * Get a single scheduled task by ID
 */
app.get('/:id', (c) => {
  const db = getDb();
  const task = db.query('SELECT * FROM scheduled_tasks WHERE id = ?').get(c.req.param('id')) as any;

  if (!task) {
    return c.json({ ok: false, error: 'Task not found' }, 404);
  }

  const result: ScheduledTask = {
    id: task.id,
    workspaceId: task.workspace_id,
    name: task.name,
    description: task.description || '',
    cronExpression: task.cron_expression || undefined,
    intervalMinutes: task.interval_minutes || undefined,
    prompt: task.prompt,
    profileId: task.profile_id || undefined,
    status: task.status,
    retryOnFailure: Boolean(task.retry_on_failure),
    maxRetries: task.max_retries,
    lastRun: task.last_run || undefined,
    nextRun: task.next_run || undefined,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
  };

  return c.json({ ok: true, data: result });
});

/**
 * Create a new scheduled task
 */
app.post('/', async (c) => {
  const body = (await c.req.json()) as ScheduledTaskCreateInput;

  // Validate input
  if (!body.workspaceId || !body.name || !body.prompt) {
    return c.json({ ok: false, error: 'workspaceId, name, and prompt are required' }, 400);
  }

  // Must have either cron or interval
  if (!body.cronExpression && !body.intervalMinutes) {
    return c.json(
      { ok: false, error: 'Either cronExpression or intervalMinutes is required' },
      400,
    );
  }

  // Validate cron expression if provided
  if (body.cronExpression && !CronParser.isValid(body.cronExpression)) {
    return c.json(
      { ok: false, error: 'Invalid cron expression. Format: "minute hour day month weekday"' },
      400,
    );
  }

  const db = getDb();
  const id = nanoid(12);
  const now = Date.now();

  // Calculate first run time
  let nextRun: number;
  if (body.cronExpression) {
    const next = CronParser.getNextRun(body.cronExpression);
    nextRun = next.getTime();
  } else if (body.intervalMinutes) {
    nextRun = now + body.intervalMinutes * 60 * 1000;
  } else {
    return c.json({ ok: false, error: 'Schedule configuration error' }, 400);
  }

  db.query(
    `INSERT INTO scheduled_tasks (
      id, workspace_id, name, description, cron_expression, interval_minutes,
      prompt, profile_id, status, retry_on_failure, max_retries, next_run,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
  ).run(
    id,
    body.workspaceId,
    body.name,
    body.description || '',
    body.cronExpression || null,
    body.intervalMinutes || null,
    body.prompt,
    body.profileId || null,
    body.retryOnFailure ? 1 : 0,
    body.maxRetries || 3,
    nextRun,
    now,
    now,
  );

  const task = db.query('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as any;

  const result: ScheduledTask = {
    id: task.id,
    workspaceId: task.workspace_id,
    name: task.name,
    description: task.description || '',
    cronExpression: task.cron_expression || undefined,
    intervalMinutes: task.interval_minutes || undefined,
    prompt: task.prompt,
    profileId: task.profile_id || undefined,
    status: task.status,
    retryOnFailure: Boolean(task.retry_on_failure),
    maxRetries: task.max_retries,
    lastRun: task.last_run || undefined,
    nextRun: task.next_run || undefined,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
  };

  return c.json({ ok: true, data: result }, 201);
});

/**
 * Update a scheduled task
 */
app.put('/:id', async (c) => {
  const db = getDb();
  const taskId = c.req.param('id');
  const body = (await c.req.json()) as ScheduledTaskUpdateInput;

  const existing = db.query('SELECT * FROM scheduled_tasks WHERE id = ?').get(taskId) as any;

  if (!existing) {
    return c.json({ ok: false, error: 'Task not found' }, 404);
  }

  // Validate cron expression if being updated
  if (body.cronExpression && !CronParser.isValid(body.cronExpression)) {
    return c.json(
      { ok: false, error: 'Invalid cron expression. Format: "minute hour day month weekday"' },
      400,
    );
  }

  const updates: string[] = [];
  const values: any[] = [];

  if (body.name !== undefined) {
    updates.push('name = ?');
    values.push(body.name);
  }

  if (body.description !== undefined) {
    updates.push('description = ?');
    values.push(body.description);
  }

  if (body.cronExpression !== undefined) {
    updates.push('cron_expression = ?');
    values.push(body.cronExpression || null);
    // Clear interval if setting cron
    updates.push('interval_minutes = ?');
    values.push(null);
  }

  if (body.intervalMinutes !== undefined) {
    updates.push('interval_minutes = ?');
    values.push(body.intervalMinutes || null);
    // Clear cron if setting interval
    updates.push('cron_expression = ?');
    values.push(null);
  }

  if (body.prompt !== undefined) {
    updates.push('prompt = ?');
    values.push(body.prompt);
  }

  if (body.profileId !== undefined) {
    updates.push('profile_id = ?');
    values.push(body.profileId || null);
  }

  if (body.status !== undefined) {
    updates.push('status = ?');
    values.push(body.status);
  }

  if (body.retryOnFailure !== undefined) {
    updates.push('retry_on_failure = ?');
    values.push(body.retryOnFailure ? 1 : 0);
  }

  if (body.maxRetries !== undefined) {
    updates.push('max_retries = ?');
    values.push(body.maxRetries);
  }

  updates.push('updated_at = ?');
  values.push(Date.now());

  values.push(taskId);

  db.query(`UPDATE scheduled_tasks SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  // Recalculate next run if schedule changed
  if (body.cronExpression !== undefined || body.intervalMinutes !== undefined) {
    const updated = db.query('SELECT * FROM scheduled_tasks WHERE id = ?').get(taskId) as any;

    let nextRun: number;
    if (updated.cron_expression) {
      const next = CronParser.getNextRun(updated.cron_expression);
      nextRun = next.getTime();
    } else if (updated.interval_minutes) {
      nextRun = Date.now() + updated.interval_minutes * 60 * 1000;
    } else {
      nextRun = Date.now() + 60 * 60 * 1000; // Default to 1 hour
    }

    db.query('UPDATE scheduled_tasks SET next_run = ? WHERE id = ?').run(nextRun, taskId);
  }

  const task = db.query('SELECT * FROM scheduled_tasks WHERE id = ?').get(taskId) as any;

  const result: ScheduledTask = {
    id: task.id,
    workspaceId: task.workspace_id,
    name: task.name,
    description: task.description || '',
    cronExpression: task.cron_expression || undefined,
    intervalMinutes: task.interval_minutes || undefined,
    prompt: task.prompt,
    profileId: task.profile_id || undefined,
    status: task.status,
    retryOnFailure: Boolean(task.retry_on_failure),
    maxRetries: task.max_retries,
    lastRun: task.last_run || undefined,
    nextRun: task.next_run || undefined,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
  };

  return c.json({ ok: true, data: result });
});

/**
 * Delete a scheduled task
 */
app.delete('/:id', (c) => {
  const db = getDb();
  const taskId = c.req.param('id');

  const existing = db.query('SELECT * FROM scheduled_tasks WHERE id = ?').get(taskId) as any;

  if (!existing) {
    return c.json({ ok: false, error: 'Task not found' }, 404);
  }

  db.query('DELETE FROM scheduled_tasks WHERE id = ?').run(taskId);

  return c.json({ ok: true });
});

/**
 * Pause a scheduled task
 */
app.post('/:id/pause', (c) => {
  const taskId = c.req.param('id');

  try {
    taskScheduler.pauseTask(taskId);
    return c.json({ ok: true });
  } catch (err) {
    return c.json(
      { ok: false, error: err instanceof Error ? err.message : 'Failed to pause task' },
      500,
    );
  }
});

/**
 * Resume a scheduled task
 */
app.post('/:id/resume', (c) => {
  const taskId = c.req.param('id');

  try {
    taskScheduler.resumeTask(taskId);
    return c.json({ ok: true });
  } catch (err) {
    return c.json(
      { ok: false, error: err instanceof Error ? err.message : 'Failed to resume task' },
      500,
    );
  }
});

/**
 * Run a task immediately (ignoring schedule)
 */
app.post('/:id/run', async (c) => {
  const taskId = c.req.param('id');

  try {
    const executionId = await taskScheduler.runTaskNow(taskId);
    return c.json({ ok: true, data: { executionId } });
  } catch (err) {
    return c.json(
      { ok: false, error: err instanceof Error ? err.message : 'Failed to run task' },
      500,
    );
  }
});

/**
 * Get execution history for a task
 */
app.get('/:id/executions', (c) => {
  const taskId = c.req.param('id');
  const limit = parseInt(c.req.query('limit') || '50', 10);

  try {
    const executions = taskScheduler.getExecutions(taskId, limit);
    return c.json({ ok: true, data: executions });
  } catch (err) {
    return c.json(
      { ok: false, error: err instanceof Error ? err.message : 'Failed to get executions' },
      500,
    );
  }
});

export default app;
