import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { getDb } from '../db/database';
import { webhookExecutor, validateWebhookAuth } from '../services/webhook-executor';
import type { Webhook, WebhookCreateInput, WebhookUpdateInput, WebhookWithStats } from '@e/shared';

const app = new Hono();

// ─── Helper: convert DB row to Webhook ───────────────────────────────────────

function webhookFromRow(row: any): Webhook {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description || '',
    authMethod: row.auth_method,
    secret: row.secret,
    promptTemplate: row.prompt_template,
    profileId: row.profile_id || undefined,
    status: row.status,
    maxPerMinute: row.max_per_minute,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Generate a cryptographically random secret token ────────────────────────

function generateSecret(): string {
  return nanoid(48);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MANAGEMENT ROUTES (authenticated, under /api/webhooks)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * List all webhooks for a workspace (with stats)
 */
app.get('/', (c) => {
  const workspaceId = c.req.query('workspaceId');

  if (!workspaceId) {
    return c.json({ ok: false, error: 'workspaceId query parameter required' }, 400);
  }

  const db = getDb();
  const rows = db
    .query('SELECT * FROM webhooks WHERE workspace_id = ? ORDER BY created_at DESC')
    .all(workspaceId) as any[];

  const result: WebhookWithStats[] = rows.map((row) => {
    const stats = db
      .query(
        `SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
          AVG(CASE WHEN response_time_ms IS NOT NULL THEN response_time_ms ELSE NULL END) as avg_response
         FROM webhook_executions
         WHERE webhook_id = ?`,
      )
      .get(row.id) as any;

    const lastExecution = db
      .query(
        'SELECT status, started_at FROM webhook_executions WHERE webhook_id = ? ORDER BY started_at DESC LIMIT 1',
      )
      .get(row.id) as any;

    const webhook = webhookFromRow(row);

    return {
      ...webhook,
      // Mask the secret — only show first 8 chars
      secret: webhook.secret.slice(0, 8) + '...',
      totalExecutions: stats?.total || 0,
      successfulExecutions: stats?.successful || 0,
      failedExecutions: stats?.failed || 0,
      lastExecutionStatus: lastExecution?.status || undefined,
      lastExecutionAt: lastExecution?.started_at || undefined,
      averageResponseTimeMs: stats?.avg_response || undefined,
    };
  });

  return c.json({ ok: true, data: result });
});

/**
 * Get a single webhook by ID
 */
app.get('/:id', (c) => {
  const db = getDb();
  const row = db.query('SELECT * FROM webhooks WHERE id = ?').get(c.req.param('id')) as any;

  if (!row) {
    return c.json({ ok: false, error: 'Webhook not found' }, 404);
  }

  const webhook = webhookFromRow(row);
  return c.json({
    ok: true,
    data: {
      ...webhook,
      // Mask the secret in responses
      secret: webhook.secret.slice(0, 8) + '...',
    },
  });
});

/**
 * Get the full secret for a webhook (for copy-to-clipboard)
 */
app.get('/:id/secret', (c) => {
  const db = getDb();
  const row = db.query('SELECT secret FROM webhooks WHERE id = ?').get(c.req.param('id')) as any;

  if (!row) {
    return c.json({ ok: false, error: 'Webhook not found' }, 404);
  }

  return c.json({ ok: true, data: { secret: row.secret } });
});

/**
 * Create a new webhook
 */
app.post('/', async (c) => {
  const body = (await c.req.json()) as WebhookCreateInput;

  if (!body.workspaceId || !body.name || !body.promptTemplate) {
    return c.json({ ok: false, error: 'workspaceId, name, and promptTemplate are required' }, 400);
  }

  const db = getDb();
  const id = nanoid(12);
  const secret = generateSecret();
  const now = Date.now();

  db.query(
    `INSERT INTO webhooks (
      id, workspace_id, name, description, auth_method, secret,
      prompt_template, profile_id, status, max_per_minute, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'enabled', ?, ?, ?)`,
  ).run(
    id,
    body.workspaceId,
    body.name,
    body.description || '',
    body.authMethod || 'bearer',
    secret,
    body.promptTemplate,
    body.profileId || null,
    body.maxPerMinute || 10,
    now,
    now,
  );

  const row = db.query('SELECT * FROM webhooks WHERE id = ?').get(id) as any;
  const webhook = webhookFromRow(row);

  return c.json(
    {
      ok: true,
      data: {
        ...webhook,
        // Return full secret on creation (only time)
        secret: webhook.secret,
      },
    },
    201,
  );
});

/**
 * Update a webhook
 */
app.put('/:id', async (c) => {
  const db = getDb();
  const webhookId = c.req.param('id');
  const body = (await c.req.json()) as WebhookUpdateInput;

  const existing = db.query('SELECT * FROM webhooks WHERE id = ?').get(webhookId) as any;
  if (!existing) {
    return c.json({ ok: false, error: 'Webhook not found' }, 404);
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
  if (body.authMethod !== undefined) {
    updates.push('auth_method = ?');
    values.push(body.authMethod);
  }
  if (body.promptTemplate !== undefined) {
    updates.push('prompt_template = ?');
    values.push(body.promptTemplate);
  }
  if (body.profileId !== undefined) {
    updates.push('profile_id = ?');
    values.push(body.profileId || null);
  }
  if (body.status !== undefined) {
    updates.push('status = ?');
    values.push(body.status);
  }
  if (body.maxPerMinute !== undefined) {
    updates.push('max_per_minute = ?');
    values.push(body.maxPerMinute);
  }
  if (body.regenerateSecret) {
    updates.push('secret = ?');
    values.push(generateSecret());
  }

  updates.push('updated_at = ?');
  values.push(Date.now());
  values.push(webhookId);

  db.query(`UPDATE webhooks SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const row = db.query('SELECT * FROM webhooks WHERE id = ?').get(webhookId) as any;
  const webhook = webhookFromRow(row);

  return c.json({
    ok: true,
    data: {
      ...webhook,
      secret: webhook.secret.slice(0, 8) + '...',
    },
  });
});

/**
 * Delete a webhook
 */
app.delete('/:id', (c) => {
  const db = getDb();
  const webhookId = c.req.param('id');

  const existing = db.query('SELECT * FROM webhooks WHERE id = ?').get(webhookId) as any;
  if (!existing) {
    return c.json({ ok: false, error: 'Webhook not found' }, 404);
  }

  // Delete executions first (cascade might handle this but be explicit)
  db.query('DELETE FROM webhook_executions WHERE webhook_id = ?').run(webhookId);
  db.query('DELETE FROM webhooks WHERE id = ?').run(webhookId);

  return c.json({ ok: true });
});

/**
 * Get execution history for a webhook
 */
app.get('/:id/executions', (c) => {
  const webhookId = c.req.param('id');
  const limit = parseInt(c.req.query('limit') || '50', 10);

  try {
    const executions = webhookExecutor.getExecutions(webhookId, limit);
    return c.json({ ok: true, data: executions });
  } catch (err) {
    return c.json(
      { ok: false, error: err instanceof Error ? err.message : 'Failed to get executions' },
      500,
    );
  }
});

/**
 * Test a webhook by sending a simulated payload
 */
app.post('/:id/test', async (c) => {
  const db = getDb();
  const webhookId = c.req.param('id');

  const row = db.query('SELECT * FROM webhooks WHERE id = ?').get(webhookId) as any;
  if (!row) {
    return c.json({ ok: false, error: 'Webhook not found' }, 404);
  }

  const webhook = webhookFromRow(row);

  // Create a test payload
  const testPayload = JSON.stringify({
    test: true,
    timestamp: new Date().toISOString(),
    message: 'This is a test invocation from the webhook settings UI',
    webhook: { id: webhook.id, name: webhook.name },
  });

  try {
    const execution = await webhookExecutor.processWebhook(webhook, testPayload, 'test-ui');
    return c.json({ ok: true, data: { executionId: execution.id, status: execution.status } });
  } catch (err) {
    return c.json(
      { ok: false, error: err instanceof Error ? err.message : 'Test execution failed' },
      500,
    );
  }
});

export default app;

// ═══════════════════════════════════════════════════════════════════════════════
// INBOUND WEBHOOK ROUTE (external-facing, token-authenticated)
// Mounted separately at /api/webhooks/inbound/:id
// ═══════════════════════════════════════════════════════════════════════════════

export const webhookInboundApp = new Hono();

/**
 * POST /api/webhooks/inbound/:id
 *
 * Accepts authenticated webhook payloads from external services.
 * Authentication: Bearer token or HMAC-SHA256 signature.
 * Does NOT require CSRF or session auth — authenticated by webhook secret.
 */
webhookInboundApp.post('/:id', async (c) => {
  const db = getDb();
  const webhookId = c.req.param('id');

  // Look up webhook
  const row = db.query('SELECT * FROM webhooks WHERE id = ?').get(webhookId) as any;

  if (!row) {
    return c.json({ ok: false, error: 'Webhook not found' }, 404);
  }

  const webhook = webhookFromRow(row);

  // Check if webhook is enabled
  if (webhook.status !== 'enabled') {
    return c.json({ ok: false, error: 'Webhook is disabled' }, 403);
  }

  // Get raw body for HMAC verification
  const rawBody = await c.req.text();

  // Authenticate the request
  const isAuthenticated = validateWebhookAuth(webhook, {
    authHeader: c.req.header('Authorization'),
    signatureHeader: c.req.header('X-Webhook-Signature') || c.req.header('X-Hub-Signature-256'),
    rawBody,
  });

  if (!isAuthenticated) {
    return c.json({ ok: false, error: 'Unauthorized: invalid authentication' }, 401);
  }

  // Get source info for logging
  const source = c.req.header('X-Forwarded-For') || c.req.header('User-Agent') || 'unknown';

  // Process the webhook
  try {
    const execution = await webhookExecutor.processWebhook(webhook, rawBody, source);

    if (execution.status === 'rate_limited') {
      return c.json(
        {
          ok: false,
          error: execution.errorMessage,
          executionId: execution.id,
        },
        429,
      );
    }

    return c.json(
      {
        ok: true,
        data: {
          executionId: execution.id,
          status: execution.status,
          message: 'Webhook accepted and processing',
        },
      },
      202,
    );
  } catch (err) {
    console.error(`[webhook] Error processing inbound webhook ${webhookId}:`, err);
    return c.json(
      {
        ok: false,
        error: 'Internal server error processing webhook',
      },
      500,
    );
  }
});
