import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { getDb } from '../db/database';
import { calculateCost } from '../services/cost-calculator';
import { summarizeWithLLM } from '../services/chat-compaction';

const app = new Hono();

// List conversations
app.get('/', (c) => {
  const db = getDb();
  const rows = db
    .query(
      `
    SELECT id, title, model, workspace_path, workspace_id, plan_mode, total_tokens, permission_mode, effort,
           created_at, updated_at, compact_summary,
           (SELECT COUNT(*) FROM messages WHERE conversation_id = conversations.id) as message_count
    FROM conversations
    ORDER BY updated_at DESC
  `,
    )
    .all();

  return c.json({
    ok: true,
    data: (rows as any[]).map((r) => ({
      id: r.id,
      title: r.title,
      model: r.model,
      workspacePath: r.workspace_path,
      workspaceId: r.workspace_id || undefined,
      permissionMode: r.permission_mode,
      effort: r.effort,
      messageCount: r.message_count,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      compactSummary: r.compact_summary || undefined,
    })),
  });
});

// Get conversation with messages
app.get('/:id', (c) => {
  const db = getDb();
  const conv = db.query('SELECT * FROM conversations WHERE id = ?').get(c.req.param('id')) as any;
  if (!conv) return c.json({ ok: false, error: 'Not found' }, 404);

  const messages = db
    .query('SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC')
    .all(c.req.param('id'));

  return c.json({
    ok: true,
    data: {
      id: conv.id,
      title: conv.title,
      model: conv.model,
      systemPrompt: conv.system_prompt,
      workspacePath: conv.workspace_path,
      workspaceId: conv.workspace_id || undefined,
      planMode: Boolean(conv.plan_mode),
      planFile: conv.plan_file,
      totalTokens: conv.total_tokens,
      permissionMode: conv.permission_mode,
      effort: conv.effort,
      maxBudgetUsd: conv.max_budget_usd,
      maxTurns: conv.max_turns,
      allowedTools: conv.allowed_tools ? JSON.parse(conv.allowed_tools) : undefined,
      disallowedTools: conv.disallowed_tools ? JSON.parse(conv.disallowed_tools) : undefined,
      cliSessionId: conv.cli_session_id,
      createdAt: conv.created_at,
      updatedAt: conv.updated_at,
      messages: (messages as any[]).map((m) => ({
        id: m.id,
        role: m.role,
        content: JSON.parse(m.content),
        model: m.model,
        tokenCount: m.token_count,
        timestamp: m.timestamp,
      })),
    },
  });
});

// Create conversation
app.post('/', async (c) => {
  const body = await c.req.json();
  const db = getDb();
  const id = nanoid();
  const now = Date.now();

  db.query(
    `
    INSERT INTO conversations (id, title, model, system_prompt, workspace_path,
      plan_mode, permission_mode, effort, max_budget_usd, max_turns, allowed_tools, disallowed_tools,
      created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    id,
    body.title || 'New Conversation',
    body.model || 'claude-sonnet-4-6',
    body.systemPrompt || null,
    body.workspacePath || process.cwd(),
    body.planMode ? 1 : 0,
    body.permissionMode || 'default',
    body.effort || 'high',
    body.maxBudgetUsd ?? null,
    body.maxTurns ?? null,
    body.allowedTools ? JSON.stringify(body.allowedTools) : null,
    body.disallowedTools ? JSON.stringify(body.disallowedTools) : null,
    now,
    now,
  );

  return c.json({ ok: true, data: { id } }, 201);
});

// Update conversation
app.patch('/:id', async (c) => {
  const body = await c.req.json();
  const db = getDb();
  const id = c.req.param('id');

  const updates: string[] = [];
  const values: any[] = [];

  if (body.title !== undefined) {
    updates.push('title = ?');
    values.push(body.title);
  }
  if (body.workspacePath !== undefined) {
    updates.push('workspace_path = ?');
    values.push(body.workspacePath);
  }
  if (body.model !== undefined) {
    updates.push('model = ?');
    values.push(body.model);
  }
  if (body.planMode !== undefined) {
    updates.push('plan_mode = ?');
    values.push(body.planMode ? 1 : 0);
  }
  if (body.planFile !== undefined) {
    updates.push('plan_file = ?');
    values.push(body.planFile);
  }
  if (body.permissionMode !== undefined) {
    updates.push('permission_mode = ?');
    values.push(body.permissionMode);
  }
  if (body.effort !== undefined) {
    updates.push('effort = ?');
    values.push(body.effort);
  }
  if (body.maxBudgetUsd !== undefined) {
    updates.push('max_budget_usd = ?');
    values.push(body.maxBudgetUsd);
  }
  if (body.maxTurns !== undefined) {
    updates.push('max_turns = ?');
    values.push(body.maxTurns);
  }
  if (body.allowedTools !== undefined) {
    updates.push('allowed_tools = ?');
    values.push(JSON.stringify(body.allowedTools));
  }
  if (body.disallowedTools !== undefined) {
    updates.push('disallowed_tools = ?');
    values.push(JSON.stringify(body.disallowedTools));
  }
  if (body.cliSessionId !== undefined) {
    updates.push('cli_session_id = ?');
    values.push(body.cliSessionId);
  }

  updates.push('updated_at = ?');
  values.push(Date.now());
  values.push(id);

  db.query(`UPDATE conversations SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  return c.json({ ok: true });
});

// Get the stored compact summary for a conversation
app.get('/:id/summary', (c) => {
  const db = getDb();
  const conv = db
    .query('SELECT id, title, model, compact_summary FROM conversations WHERE id = ?')
    .get(c.req.param('id')) as any;
  if (!conv) return c.json({ ok: false, error: 'Not found' }, 404);

  return c.json({
    ok: true,
    data: {
      id: conv.id,
      title: conv.title,
      summary: conv.compact_summary || null,
    },
  });
});

// Generate and store a compact summary for a conversation
app.post('/:id/summarize', async (c) => {
  const db = getDb();
  const conversationId = c.req.param('id');

  const conv = db
    .query('SELECT id, title, model, compact_summary FROM conversations WHERE id = ?')
    .get(conversationId) as any;
  if (!conv) return c.json({ ok: false, error: 'Not found' }, 404);

  // Return cached summary if it already exists
  if (conv.compact_summary) {
    return c.json({ ok: true, data: { summary: conv.compact_summary, cached: true } });
  }

  // Load messages from DB
  const rows = db
    .query('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC')
    .all(conversationId) as any[];

  const messages: any[] = [];
  for (const row of rows) {
    try {
      const content = JSON.parse(row.content as string);
      messages.push({ role: row.role, content });
    } catch {
      // skip unparseable messages
    }
  }

  if (messages.length === 0) {
    return c.json({ ok: true, data: { summary: null, cached: false } });
  }

  // Generate LLM summary (falls back to rule-based)
  const result = await summarizeWithLLM(messages, [], conv.model || 'claude-sonnet-4-6');
  const summaryText = result.summaryText;

  // Persist the summary
  db.query('UPDATE conversations SET compact_summary = ?, updated_at = ? WHERE id = ?').run(
    summaryText,
    Date.now(),
    conversationId,
  );

  return c.json({ ok: true, data: { summary: summaryText, cached: false } });
});

// Get cost information for a conversation
app.get('/:id/cost', (c) => {
  const db = getDb();
  const conv = db
    .query('SELECT model, total_tokens FROM conversations WHERE id = ?')
    .get(c.req.param('id')) as any;
  if (!conv) return c.json({ ok: false, error: 'Not found' }, 404);

  // Get per-message token counts for input/output breakdown
  const messages = db
    .query('SELECT role, token_count FROM messages WHERE conversation_id = ?')
    .all(c.req.param('id')) as any[];

  let inputTokens = 0;
  let outputTokens = 0;
  for (const m of messages) {
    if (m.role === 'user') inputTokens += m.token_count || 0;
    else if (m.role === 'assistant') outputTokens += m.token_count || 0;
  }

  // Use total_tokens as fallback and split 30/70 if no per-message data
  if (inputTokens === 0 && outputTokens === 0 && conv.total_tokens > 0) {
    inputTokens = Math.round(conv.total_tokens * 0.3);
    outputTokens = conv.total_tokens - inputTokens;
  }

  const cost = calculateCost(conv.model, inputTokens, outputTokens);

  return c.json({
    ok: true,
    data: {
      model: conv.model,
      totalTokens: conv.total_tokens,
      inputTokens,
      outputTokens,
      estimatedCostUsd: Math.round(cost * 10000) / 10000,
    },
  });
});

// Delete a message (optionally its paired assistant response)
app.delete('/:id/messages/:messageId', (c) => {
  const db = getDb();
  const conversationId = c.req.param('id');
  const messageId = c.req.param('messageId');
  const deletePair = c.req.query('deletePair') === 'true';

  const message = db
    .query('SELECT * FROM messages WHERE id = ? AND conversation_id = ?')
    .get(messageId, conversationId) as any;
  if (!message) return c.json({ ok: false, error: 'Message not found' }, 404);

  if (deletePair && message.role === 'user') {
    // Get all messages ordered by timestamp to find the paired assistant response
    const allMessages = db
      .query(
        'SELECT id, role, timestamp FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC',
      )
      .all(conversationId) as any[];

    const idx = allMessages.findIndex((m: any) => m.id === messageId);
    const idsToDelete = [messageId];

    // If the next message is an assistant message, delete it too
    if (idx + 1 < allMessages.length && allMessages[idx + 1].role === 'assistant') {
      idsToDelete.push(allMessages[idx + 1].id);
    }

    const placeholders = idsToDelete.map(() => '?').join(',');
    db.query(`DELETE FROM messages WHERE id IN (${placeholders})`).run(...idsToDelete);
  } else {
    db.query('DELETE FROM messages WHERE id = ? AND conversation_id = ?').run(
      messageId,
      conversationId,
    );
  }

  // Invalidate CLI session so next message creates a fresh one
  db.query('UPDATE conversations SET cli_session_id = NULL, updated_at = ? WHERE id = ?').run(
    Date.now(),
    conversationId,
  );

  return c.json({ ok: true });
});

// Edit a message: delete it and all subsequent messages (caller resends via stream)
app.put('/:id/messages/:messageId', async (c) => {
  const db = getDb();
  const conversationId = c.req.param('id');
  const messageId = c.req.param('messageId');

  const message = db
    .query('SELECT * FROM messages WHERE id = ? AND conversation_id = ?')
    .get(messageId, conversationId) as any;
  if (!message) return c.json({ ok: false, error: 'Message not found' }, 404);

  // Delete this message and everything after it (by timestamp).
  // The caller will then use sendAndStream to re-insert the edited message + get a new response.
  db.query('DELETE FROM messages WHERE conversation_id = ? AND timestamp >= ?').run(
    conversationId,
    message.timestamp,
  );

  // Invalidate CLI session
  db.query('UPDATE conversations SET cli_session_id = NULL, updated_at = ? WHERE id = ?').run(
    Date.now(),
    conversationId,
  );

  return c.json({ ok: true });
});

// Fork conversation from a specific message
app.post('/:id/fork', async (c) => {
  const db = getDb();
  const conversationId = c.req.param('id');
  const body = await c.req.json();
  const { messageId } = body;

  const conv = db.query('SELECT * FROM conversations WHERE id = ?').get(conversationId) as any;
  if (!conv) return c.json({ ok: false, error: 'Conversation not found' }, 404);

  const targetMsg = db
    .query('SELECT * FROM messages WHERE id = ? AND conversation_id = ?')
    .get(messageId, conversationId) as any;
  if (!targetMsg) return c.json({ ok: false, error: 'Message not found' }, 404);

  // Get all messages up to and including the target
  const messages = db
    .query(
      'SELECT * FROM messages WHERE conversation_id = ? AND timestamp <= ? ORDER BY timestamp ASC',
    )
    .all(conversationId, targetMsg.timestamp) as any[];

  // Create the new conversation
  const newId = nanoid();
  const now = Date.now();
  db.query(
    `
    INSERT INTO conversations (id, title, model, system_prompt, workspace_path, workspace_id,
      plan_mode, permission_mode, effort, max_budget_usd, max_turns,
      allowed_tools, disallowed_tools, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    newId,
    (conv.title || 'Conversation') + ' (fork)',
    conv.model,
    conv.system_prompt,
    conv.workspace_path,
    conv.workspace_id,
    conv.plan_mode,
    conv.permission_mode,
    conv.effort,
    conv.max_budget_usd,
    conv.max_turns,
    conv.allowed_tools,
    conv.disallowed_tools,
    now,
    now,
  );

  // Copy messages with new IDs
  for (const msg of messages) {
    db.query(
      `
      INSERT INTO messages (id, conversation_id, role, content, model, token_count, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(nanoid(), newId, msg.role, msg.content, msg.model, msg.token_count, msg.timestamp);
  }

  return c.json({ ok: true, data: { id: newId } }, 201);
});

// Manual compaction
app.post('/:id/compact', async (c) => {
  const conversationId = c.req.param('id');
  const db = getDb();

  // Get conversation
  const conv = db.query('SELECT * FROM conversations WHERE id = ?').get(conversationId) as any;
  if (!conv) return c.json({ ok: false, error: 'Conversation not found' }, 404);

  // Get all messages
  const rows = db
    .query('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC')
    .all(conversationId) as any[];

  if (rows.length === 0) {
    return c.json({ ok: false, error: 'No messages to compact' }, 400);
  }

  // Parse messages
  const history: any[] = [];
  for (const row of rows) {
    try {
      const content = JSON.parse(row.content);
      const normalized = Array.isArray(content)
        ? content.map((block: any) => {
            if (block.type === 'nudge') {
              return { type: 'text', text: `[User nudge]: ${block.text}` };
            }
            return block;
          })
        : content;
      history.push({ role: row.role, content: normalized });
    } catch (e) {
      console.warn(`[compact] Failed to parse message: ${e}`);
    }
  }

  // Get retention count from settings (default 15)
  let keepCount = 15;
  try {
    const settingRow = db
      .query("SELECT value FROM settings WHERE key = 'compactionRetentionCount'")
      .get() as any;
    if (settingRow) {
      keepCount = JSON.parse(settingRow.value);
    }
  } catch {
    /* use default */
  }

  if (history.length <= keepCount) {
    return c.json(
      {
        ok: false,
        error: `Conversation has ${history.length} messages, need more than ${keepCount} to compact`,
      },
      400,
    );
  }

  const droppedMessages = history.slice(0, -keepCount);
  const keptMessages = history.slice(-keepCount);

  // Generate LLM summary
  const { summaryText, summaryMessage, usedLLM } = await summarizeWithLLM(
    droppedMessages,
    keptMessages,
    conv.model || 'claude-sonnet-4',
  );

  // Replace messages in DB
  db.query('DELETE FROM messages WHERE conversation_id = ?').run(conversationId);

  const compactedMessages = [summaryMessage, ...keptMessages];
  let ts = Date.now();
  for (const msg of compactedMessages) {
    db.query(
      'INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)',
    ).run(nanoid(), conversationId, msg.role, JSON.stringify(msg.content), ts++);
  }

  // Clear CLI session ID so next turn starts fresh with compacted history
  const timestamp = Date.now();
  db.query('UPDATE conversations SET cli_session_id = NULL, updated_at = ? WHERE id = ?').run(
    timestamp,
    conversationId,
  );

  // Record compaction event in history
  db.query(
    `INSERT INTO compaction_history (id, conversation_id, trigger, original_message_count,
     compacted_message_count, dropped_message_count, summary_text, used_llm, retention_count,
     compacted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    nanoid(),
    conversationId,
    'manual',
    history.length,
    compactedMessages.length,
    droppedMessages.length,
    summaryText,
    usedLLM ? 1 : 0,
    keepCount,
    timestamp,
  );

  console.log(
    `[compact:manual] ${conversationId}: ${history.length} → ${compactedMessages.length} messages (LLM=${usedLLM})`,
  );

  return c.json({
    ok: true,
    data: {
      originalCount: history.length,
      compactedCount: compactedMessages.length,
      droppedCount: droppedMessages.length,
      usedLLM,
    },
  });
});

// Get compaction history for a conversation
app.get('/:id/compaction-history', (c) => {
  const conversationId = c.req.param('id');
  const db = getDb();

  const rows = db
    .query(
      `SELECT id, trigger, original_message_count, compacted_message_count, dropped_message_count,
       summary_text, used_llm, retention_count, threshold_pct, compacted_at
       FROM compaction_history
       WHERE conversation_id = ?
       ORDER BY compacted_at DESC`,
    )
    .all(conversationId) as any[];

  const history = rows.map((row) => ({
    id: row.id,
    trigger: row.trigger,
    originalCount: row.original_message_count,
    compactedCount: row.compacted_message_count,
    droppedCount: row.dropped_message_count,
    summaryText: row.summary_text,
    usedLLM: row.used_llm === 1,
    retentionCount: row.retention_count,
    thresholdPct: row.threshold_pct || null,
    compactedAt: row.compacted_at,
  }));

  return c.json({ ok: true, data: history });
});

// Get all recent compaction events (across all conversations)
app.get('/compaction-history/recent', (c) => {
  const db = getDb();
  const limit = parseInt(c.req.query('limit') || '50');

  const rows = db
    .query(
      `SELECT ch.*, c.title as conversation_title
       FROM compaction_history ch
       LEFT JOIN conversations c ON ch.conversation_id = c.id
       ORDER BY ch.compacted_at DESC
       LIMIT ?`,
    )
    .all(limit) as any[];

  const history = rows.map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    conversationTitle: row.conversation_title || 'Untitled',
    trigger: row.trigger,
    originalCount: row.original_message_count,
    compactedCount: row.compacted_message_count,
    droppedCount: row.dropped_message_count,
    summaryText: row.summary_text,
    usedLLM: row.used_llm === 1,
    retentionCount: row.retention_count,
    thresholdPct: row.threshold_pct || null,
    compactedAt: row.compacted_at,
  }));

  return c.json({ ok: true, data: history });
});

// Delete conversation
app.delete('/:id', (c) => {
  const db = getDb();
  db.query('DELETE FROM conversations WHERE id = ?').run(c.req.param('id'));
  return c.json({ ok: true });
});

export { app as conversationRoutes };
