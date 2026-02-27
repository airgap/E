import { Hono } from 'hono';
import {
  loadConversationHistory,
  getRecommendedOptions,
  needsCompaction,
  compactMessages,
  getContextLimit,
  type CompactionOptions,
} from '../services/chat-compaction';
import { getDb } from '../db/database';

const app = new Hono();

/**
 * GET /api/compaction/:conversationId/status
 * Check if a conversation needs compaction
 */
app.get('/:conversationId/status', (c) => {
  const conversationId = c.req.param('conversationId');

  try {
    const db = getDb();
    const conv = db
      .query('SELECT model FROM conversations WHERE id = ?')
      .get(conversationId) as any;

    if (!conv) {
      return c.json({ ok: false, error: 'Conversation not found' }, 404);
    }

    const recommended = getRecommendedOptions(conv.model);
    const history = loadConversationHistory(conversationId, {
      ...recommended,
      createSummary: false,
    });

    return c.json({
      ok: true,
      needs_compaction: history.compacted,
      original_count: history.originalCount,
      compacted_count: history.compactedCount,
      tokens_removed: history.tokensRemoved,
      context_limit: getContextLimit(conv.model),
      recommended_max_tokens: recommended.maxTokens,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[compaction] Status check failed:', msg);
    return c.json({ ok: false, error: msg }, 500);
  }
});

/**
 * POST /api/compaction/:conversationId/compact
 * Manually trigger compaction with custom options
 */
app.post('/:conversationId/compact', async (c) => {
  const conversationId = c.req.param('conversationId');
  const body = await c.req.json();

  try {
    const db = getDb();
    const conv = db
      .query('SELECT model FROM conversations WHERE id = ?')
      .get(conversationId) as any;

    if (!conv) {
      return c.json({ ok: false, error: 'Conversation not found' }, 404);
    }

    // Parse compaction options from request
    const options: CompactionOptions = {
      maxTokens: body.maxTokens,
      maxMessages: body.maxMessages,
      strategy: body.strategy || 'smart',
      preserveToolUse: body.preserveToolUse !== false,
      createSummary: body.createSummary !== false,
    };

    // If no options provided, use recommended for model
    if (!body.maxTokens && !body.maxMessages) {
      Object.assign(options, getRecommendedOptions(conv.model));
    }

    const history = loadConversationHistory(conversationId, options);

    return c.json({
      ok: true,
      compacted: history.compacted,
      original_count: history.originalCount,
      compacted_count: history.compactedCount,
      tokens_removed: history.tokensRemoved,
      summary: history.summary,
      preview: history.messages.slice(0, 5).map((m: any) => ({
        role: m.role,
        content_preview: Array.isArray(m.content)
          ? m.content
              .filter((b: any) => b.type === 'text')
              .map((b: any) => b.text?.substring(0, 100))
              .join(' ')
          : String(m.content).substring(0, 100),
      })),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[compaction] Manual compaction failed:', msg);
    return c.json({ ok: false, error: msg }, 500);
  }
});

/**
 * POST /api/compaction/:conversationId/apply
 * Apply compaction and persist to database
 */
app.post('/:conversationId/apply', async (c) => {
  const conversationId = c.req.param('conversationId');
  const body = await c.req.json();

  try {
    const db = getDb();
    const conv = db
      .query('SELECT model FROM conversations WHERE id = ?')
      .get(conversationId) as any;

    if (!conv) {
      return c.json({ ok: false, error: 'Conversation not found' }, 404);
    }

    // Parse compaction options from request
    const options: CompactionOptions = {
      maxTokens: body.maxTokens,
      maxMessages: body.maxMessages,
      strategy: body.strategy || 'smart',
      preserveToolUse: body.preserveToolUse !== false,
      createSummary: body.createSummary !== false,
    };

    // If no options provided, use recommended for model
    if (!body.maxTokens && !body.maxMessages) {
      Object.assign(options, getRecommendedOptions(conv.model));
    }

    const history = loadConversationHistory(conversationId, options);

    if (!history.compacted) {
      return c.json({
        ok: true,
        compacted: false,
        message: 'No compaction needed',
      });
    }

    // Delete old messages and insert compacted ones
    db.query('DELETE FROM messages WHERE conversation_id = ?').run(conversationId);

    let timestamp = Date.now();
    for (const msg of history.messages) {
      const content = JSON.stringify(msg.content);
      db.query(
        `INSERT INTO messages (id, conversation_id, role, content, timestamp)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(crypto.randomUUID(), conversationId, msg.role, content, timestamp);
      timestamp += 1; // Ensure ordering
    }

    return c.json({
      ok: true,
      compacted: true,
      original_count: history.originalCount,
      compacted_count: history.compactedCount,
      tokens_removed: history.tokensRemoved,
      summary: history.summary,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[compaction] Apply compaction failed:', msg);
    return c.json({ ok: false, error: msg }, 500);
  }
});

/**
 * GET /api/compaction/models
 * Get context limits for all supported models
 */
app.get('/models', (c) => {
  const models = [
    { model: 'claude-opus-4', limit: getContextLimit('claude-opus-4') },
    { model: 'claude-sonnet-3.5', limit: getContextLimit('claude-sonnet-3.5') },
    { model: 'claude-haiku-3', limit: getContextLimit('claude-haiku-3') },
    { model: 'ollama:llama3.1', limit: getContextLimit('ollama:llama3.1') },
    { model: 'ollama:llama3.2', limit: getContextLimit('ollama:llama3.2') },
    { model: 'ollama:qwen2.5', limit: getContextLimit('ollama:qwen2.5') },
    { model: 'ollama:mistral', limit: getContextLimit('ollama:mistral') },
  ];

  return c.json({ ok: true, models });
});

export default app;
