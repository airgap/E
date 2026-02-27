import { Hono } from 'hono';
import { getDb } from '../db/database';
import { calculateCost } from '../services/cost-calculator';

const app = new Hono();

// GET /costs/summary
app.get('/summary', (c) => {
  const db = getDb();

  const workspacePath = c.req.query('workspacePath');
  const since = c.req.query('since');
  const until = c.req.query('until');

  // Build WHERE clause for conversations
  const conditions: string[] = [];
  const params: any[] = [];

  if (workspacePath) {
    conditions.push('workspace_path = ?');
    params.push(workspacePath);
  }
  if (since) {
    conditions.push('updated_at >= ?');
    params.push(Number(since));
  }
  if (until) {
    conditions.push('updated_at <= ?');
    params.push(Number(until));
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const conversations = db
    .query(
      `SELECT id, title, model, total_tokens, updated_at
       FROM conversations
       ${where}
       ORDER BY updated_at DESC`,
    )
    .all(...params) as any[];

  // Accumulators
  let totalCostUsd = 0;
  let totalTokens = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  const byModelMap = new Map<string, { costUsd: number; tokens: number; conversations: number }>();
  const byDayMap = new Map<string, { costUsd: number; tokens: number }>();
  const topConversations: Array<{
    id: string;
    title: string;
    costUsd: number;
    tokens: number;
    model: string;
    updatedAt: number;
  }> = [];

  for (const conv of conversations) {
    // Get per-message token counts for this conversation
    const messages = db
      .query('SELECT role, token_count FROM messages WHERE conversation_id = ?')
      .all(conv.id) as any[];

    let convInput = 0;
    let convOutput = 0;
    for (const m of messages) {
      if (m.role === 'user') convInput += m.token_count || 0;
      else if (m.role === 'assistant') convOutput += m.token_count || 0;
    }

    // 30/70 split fallback when no per-message data
    if (convInput === 0 && convOutput === 0 && conv.total_tokens > 0) {
      convInput = Math.round(conv.total_tokens * 0.3);
      convOutput = conv.total_tokens - convInput;
    }

    const convTokens = convInput + convOutput;
    const convCost = calculateCost(conv.model, convInput, convOutput);

    // Global totals
    totalCostUsd += convCost;
    totalTokens += convTokens;
    inputTokens += convInput;
    outputTokens += convOutput;

    // byModel
    const modelEntry = byModelMap.get(conv.model) ?? { costUsd: 0, tokens: 0, conversations: 0 };
    modelEntry.costUsd += convCost;
    modelEntry.tokens += convTokens;
    modelEntry.conversations += 1;
    byModelMap.set(conv.model, modelEntry);

    // byDay — derive date string from updated_at using SQLite unixepoch helper
    const dayRow = db
      .query(`SELECT strftime('%Y-%m-%d', ?, 'unixepoch') as day`)
      .get(conv.updated_at / 1000) as any;
    const day: string = dayRow.day;
    const dayEntry = byDayMap.get(day) ?? { costUsd: 0, tokens: 0 };
    dayEntry.costUsd += convCost;
    dayEntry.tokens += convTokens;
    byDayMap.set(day, dayEntry);

    // topConversations (collect all, sort and slice later)
    topConversations.push({
      id: conv.id,
      title: conv.title,
      costUsd: convCost,
      tokens: convTokens,
      model: conv.model,
      updatedAt: conv.updated_at,
    });
  }

  // Sort topConversations by cost descending and take top 10
  topConversations.sort((a, b) => b.costUsd - a.costUsd);

  // Build sorted byDay array
  const byDay = Array.from(byDayMap.entries())
    .map(([date, v]) => ({ date, costUsd: v.costUsd, tokens: v.tokens }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Build byModel array
  const byModel = Array.from(byModelMap.entries()).map(([model, v]) => ({
    model,
    costUsd: v.costUsd,
    tokens: v.tokens,
    conversations: v.conversations,
  }));

  return c.json({
    ok: true,
    data: {
      totalCostUsd,
      totalTokens,
      inputTokens,
      outputTokens,
      conversationCount: conversations.length,
      byModel,
      byDay,
      topConversations: topConversations.slice(0, 10),
    },
  });
});

export { app as costRoutes };
