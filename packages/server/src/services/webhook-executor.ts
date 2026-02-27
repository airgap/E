import { EventEmitter } from 'events';
import { nanoid } from 'nanoid';
import { getDb } from '../db/database';
import { claudeManager } from './claude-process';
import type { Webhook, WebhookExecution, StreamWebhookEvent } from '@e/shared';

/**
 * Rate limiter that tracks invocations per webhook per minute window.
 */
class RateLimiter {
  /** Map of webhookId -> array of invocation timestamps */
  private windows = new Map<string, number[]>();

  /**
   * Check if a webhook has exceeded its rate limit.
   * Also prunes old entries beyond the 1-minute window.
   */
  isRateLimited(webhookId: string, maxPerMinute: number): boolean {
    const now = Date.now();
    const windowStart = now - 60_000;

    let timestamps = this.windows.get(webhookId) || [];
    // Prune old entries
    timestamps = timestamps.filter((t) => t > windowStart);
    this.windows.set(webhookId, timestamps);

    return timestamps.length >= maxPerMinute;
  }

  /**
   * Record an invocation for rate limiting.
   */
  record(webhookId: string): void {
    const timestamps = this.windows.get(webhookId) || [];
    timestamps.push(Date.now());
    this.windows.set(webhookId, timestamps);
  }
}

/**
 * Validates webhook authentication.
 */
export function validateWebhookAuth(
  webhook: Webhook,
  request: {
    authHeader?: string;
    signatureHeader?: string;
    rawBody: string;
  },
): boolean {
  if (webhook.authMethod === 'bearer') {
    // Bearer token: check Authorization header
    const expected = `Bearer ${webhook.secret}`;
    return request.authHeader === expected;
  }

  if (webhook.authMethod === 'hmac-sha256') {
    // HMAC-SHA256: check X-Webhook-Signature header
    if (!request.signatureHeader) return false;

    const hmac = new Bun.CryptoHasher('sha256', webhook.secret);
    hmac.update(request.rawBody);
    const expectedSig = hmac.digest('hex');

    // Support "sha256=<hex>" format (GitHub-style) or plain hex
    const providedSig = request.signatureHeader.replace(/^sha256=/, '');
    return providedSig === expectedSig;
  }

  return false;
}

/**
 * Manages webhook execution — processes inbound payloads,
 * handles rate limiting, creates conversations, and runs agent prompts.
 */
class WebhookExecutor {
  readonly events = new EventEmitter();
  private rateLimiter = new RateLimiter();

  /**
   * Process an inbound webhook request.
   * Returns the execution record for the response.
   */
  async processWebhook(
    webhook: Webhook,
    payload: string,
    source?: string,
  ): Promise<WebhookExecution> {
    const db = getDb();
    const executionId = nanoid(12);
    const now = Date.now();
    const payloadSize = new TextEncoder().encode(payload).byteLength;

    // Check rate limiting
    if (this.rateLimiter.isRateLimited(webhook.id, webhook.maxPerMinute)) {
      const execution: WebhookExecution = {
        id: executionId,
        webhookId: webhook.id,
        status: 'rate_limited',
        httpStatus: 429,
        payloadSize,
        source,
        responseTimeMs: Date.now() - now,
        startedAt: now,
        completedAt: Date.now(),
        errorMessage: `Rate limit exceeded (max ${webhook.maxPerMinute}/min)`,
      };

      db.query(
        `INSERT INTO webhook_executions (id, webhook_id, status, http_status, payload_size, source, response_time_ms, started_at, completed_at, error_message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        execution.id,
        execution.webhookId,
        execution.status,
        execution.httpStatus,
        execution.payloadSize,
        execution.source || null,
        execution.responseTimeMs || null,
        execution.startedAt,
        execution.completedAt || null,
        execution.errorMessage || null,
      );

      this.emitEvent(webhook.id, 'rate_limited', {
        executionId,
        message: execution.errorMessage!,
      });

      return execution;
    }

    // Record the invocation for rate limiting
    this.rateLimiter.record(webhook.id);

    // Create execution record
    db.query(
      `INSERT INTO webhook_executions (id, webhook_id, status, http_status, payload_size, source, started_at)
       VALUES (?, ?, 'running', 202, ?, ?, ?)`,
    ).run(executionId, webhook.id, payloadSize, source || null, now);

    this.emitEvent(webhook.id, 'triggered', {
      executionId,
      message: `Webhook "${webhook.name}" triggered`,
    });

    // Execute asynchronously — don't block the HTTP response
    this.executeAsync(webhook, executionId, payload, now).catch((err) => {
      console.error(`[webhook] Async execution error for ${webhook.id}:`, err);
    });

    return {
      id: executionId,
      webhookId: webhook.id,
      status: 'running',
      httpStatus: 202,
      payloadSize,
      source,
      startedAt: now,
    };
  }

  /**
   * Execute the webhook prompt asynchronously.
   */
  private async executeAsync(
    webhook: Webhook,
    executionId: string,
    payload: string,
    startedAt: number,
  ): Promise<void> {
    const db = getDb();
    let conversationId: string | null = null;
    let success = false;
    let errorMessage: string | null = null;

    try {
      // Get workspace info
      const workspace = db
        .query('SELECT * FROM workspaces WHERE id = ?')
        .get(webhook.workspaceId) as any;

      if (!workspace) {
        throw new Error(`Workspace ${webhook.workspaceId} not found`);
      }

      // Build prompt from template, injecting payload
      let prompt = webhook.promptTemplate;
      // Replace {{payload}} with the actual payload JSON
      prompt = prompt.replace(/\{\{payload\}\}/g, payload);

      // Create conversation
      conversationId = nanoid();
      const model = 'claude-sonnet-4-6';
      const now = Date.now();

      db.query(
        `INSERT INTO conversations (id, title, model, workspace_path, workspace_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        conversationId,
        `[Webhook] ${webhook.name}`,
        model,
        workspace.path,
        webhook.workspaceId,
        now,
        now,
      );

      // Update execution with conversation ID
      db.query(`UPDATE webhook_executions SET conversation_id = ? WHERE id = ?`).run(
        conversationId,
        executionId,
      );

      // Add user message
      db.query(
        `INSERT INTO messages (id, conversation_id, role, content, timestamp)
         VALUES (?, ?, 'user', ?, ?)`,
      ).run(nanoid(), conversationId, JSON.stringify([{ type: 'text', text: prompt }]), now);

      // Get agent profile if specified
      let systemPrompt: string | undefined;

      if (webhook.profileId) {
        const profile = db
          .query('SELECT * FROM agent_profiles WHERE id = ?')
          .get(webhook.profileId) as any;
        if (profile) {
          systemPrompt = profile.system_prompt;
        }
      }

      // Spawn Claude session
      const sessionId = await claudeManager.createSession(conversationId, {
        model,
        workspacePath: workspace.path,
        effort: 'high',
        systemPrompt,
      });

      // Send message and wait for completion
      const stream = await claudeManager.sendMessage(sessionId, prompt);
      const reader = stream.getReader();

      // Read stream to completion (timeout after 30 minutes)
      const TIMEOUT_MS = 30 * 60 * 1000;

      while (true) {
        if (Date.now() - startedAt > TIMEOUT_MS) {
          throw new Error('Webhook execution timed out after 30 minutes');
        }

        const result = await reader.read();
        if (result.done) break;
      }

      success = true;
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[webhook] Execution failed for ${webhook.id}:`, err);
    }

    // Update execution record
    const completedAt = Date.now();
    const responseTimeMs = completedAt - startedAt;

    db.query(
      `UPDATE webhook_executions
       SET status = ?, http_status = ?, completed_at = ?, response_time_ms = ?, error_message = ?, conversation_id = ?
       WHERE id = ?`,
    ).run(
      success ? 'success' : 'failed',
      success ? 200 : 500,
      completedAt,
      responseTimeMs,
      errorMessage,
      conversationId,
      executionId,
    );

    // Emit completion event
    this.emitEvent(webhook.id, success ? 'completed' : 'failed', {
      executionId,
      conversationId: conversationId || undefined,
      message: success
        ? `Webhook completed in ${responseTimeMs}ms`
        : `Webhook failed: ${errorMessage}`,
    });

    console.log(
      `[webhook] "${webhook.name}" ${success ? 'completed' : 'failed'} in ${responseTimeMs}ms`,
    );
  }

  /**
   * Get execution history for a webhook
   */
  getExecutions(webhookId: string, limit: number = 50): WebhookExecution[] {
    const db = getDb();
    const rows = db
      .query(
        `SELECT * FROM webhook_executions
         WHERE webhook_id = ?
         ORDER BY started_at DESC
         LIMIT ?`,
      )
      .all(webhookId, limit) as any[];

    return rows.map(this.executionFromRow);
  }

  private executionFromRow(row: any): WebhookExecution {
    return {
      id: row.id,
      webhookId: row.webhook_id,
      conversationId: row.conversation_id || undefined,
      status: row.status,
      httpStatus: row.http_status,
      payloadSize: row.payload_size,
      source: row.source || undefined,
      responseTimeMs: row.response_time_ms || undefined,
      startedAt: row.started_at,
      completedAt: row.completed_at || undefined,
      errorMessage: row.error_message || undefined,
    };
  }

  private emitEvent(
    webhookId: string,
    event: StreamWebhookEvent['event'],
    data: StreamWebhookEvent['data'],
  ): void {
    const evt: StreamWebhookEvent = {
      type: 'webhook_event',
      webhookId,
      event,
      data,
    };
    this.events.emit('webhook_event', evt);
  }
}

export const webhookExecutor = new WebhookExecutor();
