import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { getDb } from '../db/database';
import type { AgentNote, AgentNoteCreateInput, AgentNoteUpdateInput } from '@e/shared';

const app = new Hono();

function rowToNote(row: any): AgentNote {
  return {
    id: row.id,
    workspacePath: row.workspace_path,
    conversationId: row.conversation_id || undefined,
    storyId: row.story_id || undefined,
    title: row.title,
    content: row.content,
    category: row.category,
    status: row.status,
    metadata: row.metadata ? JSON.parse(row.metadata) : {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * GET /api/agent-notes?workspacePath=...&status=...&category=...
 * List agent notes for a workspace, with optional filters.
 */
app.get('/', (c) => {
  const workspacePath = c.req.query('workspacePath');
  if (!workspacePath) {
    return c.json({ ok: false, error: 'workspacePath required' }, 400);
  }

  const status = c.req.query('status');
  const category = c.req.query('category');

  const db = getDb();
  let sql = 'SELECT * FROM agent_notes WHERE workspace_path = ?';
  const params: any[] = [workspacePath];

  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }
  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }

  sql += ' ORDER BY created_at DESC';

  const rows = db.query(sql).all(...params) as any[];
  return c.json({ ok: true, data: rows.map(rowToNote) });
});

/**
 * GET /api/agent-notes/unread-count?workspacePath=...
 * Quick count of unread notes (for sidebar badge).
 */
app.get('/unread-count', (c) => {
  const workspacePath = c.req.query('workspacePath');
  if (!workspacePath) {
    return c.json({ ok: false, error: 'workspacePath required' }, 400);
  }

  const db = getDb();
  const row = db
    .query(
      "SELECT COUNT(*) as count FROM agent_notes WHERE workspace_path = ? AND status = 'unread'",
    )
    .get(workspacePath) as any;

  return c.json({ ok: true, data: { count: row?.count ?? 0 } });
});

/**
 * GET /api/agent-notes/:id
 * Get a single agent note.
 */
app.get('/:id', (c) => {
  const db = getDb();
  const row = db.query('SELECT * FROM agent_notes WHERE id = ?').get(c.req.param('id')) as any;
  if (!row) return c.json({ ok: false, error: 'Agent note not found' }, 404);
  return c.json({ ok: true, data: rowToNote(row) });
});

/**
 * POST /api/agent-notes
 * Create a new agent note.
 */
app.post('/', async (c) => {
  const body = (await c.req.json()) as AgentNoteCreateInput;
  const { workspacePath, conversationId, storyId, title, content, category, metadata } = body;

  if (!workspacePath || !title || content === undefined) {
    return c.json({ ok: false, error: 'workspacePath, title, and content are required' }, 400);
  }

  const db = getDb();
  const id = nanoid(12);
  const now = Date.now();

  db.query(
    `INSERT INTO agent_notes (id, workspace_path, conversation_id, story_id, title, content, category, status, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'unread', ?, ?, ?)`,
  ).run(
    id,
    workspacePath,
    conversationId || null,
    storyId || null,
    title,
    content,
    category || 'general',
    JSON.stringify(metadata || {}),
    now,
    now,
  );

  const row = db.query('SELECT * FROM agent_notes WHERE id = ?').get(id) as any;
  return c.json({ ok: true, data: rowToNote(row) }, 201);
});

/**
 * PATCH /api/agent-notes/mark-read
 * Mark all unread notes as read for a workspace.
 * NOTE: Must be defined before /:id to avoid matching "mark-read" as an id.
 */
app.patch('/mark-read', async (c) => {
  const body = (await c.req.json()) as { workspacePath: string };
  if (!body.workspacePath) {
    return c.json({ ok: false, error: 'workspacePath required' }, 400);
  }

  const db = getDb();
  const now = Date.now();
  const result = db
    .query(
      "UPDATE agent_notes SET status = 'read', updated_at = ? WHERE workspace_path = ? AND status = 'unread'",
    )
    .run(now, body.workspacePath);

  return c.json({ ok: true, data: { updated: result.changes } });
});

/**
 * PATCH /api/agent-notes/:id
 * Update an agent note (title, content, category, status, metadata).
 */
app.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const db = getDb();
  const existing = db.query('SELECT * FROM agent_notes WHERE id = ?').get(id) as any;
  if (!existing) return c.json({ ok: false, error: 'Agent note not found' }, 404);

  const body = (await c.req.json()) as AgentNoteUpdateInput;
  const { title, content, category, status, metadata } = body;

  const now = Date.now();
  db.query(
    `UPDATE agent_notes SET
       title = COALESCE(?, title),
       content = COALESCE(?, content),
       category = COALESCE(?, category),
       status = COALESCE(?, status),
       metadata = COALESCE(?, metadata),
       updated_at = ?
     WHERE id = ?`,
  ).run(
    title ?? null,
    content ?? null,
    category ?? null,
    status ?? null,
    metadata !== undefined ? JSON.stringify(metadata) : null,
    now,
    id,
  );

  const row = db.query('SELECT * FROM agent_notes WHERE id = ?').get(id) as any;
  return c.json({ ok: true, data: rowToNote(row) });
});

/**
 * DELETE /api/agent-notes/:id
 * Delete an agent note.
 */
app.delete('/:id', (c) => {
  const id = c.req.param('id');
  const db = getDb();
  const existing = db.query('SELECT id FROM agent_notes WHERE id = ?').get(id) as any;
  if (!existing) return c.json({ ok: false, error: 'Agent note not found' }, 404);

  db.query('DELETE FROM agent_notes WHERE id = ?').run(id);
  return c.json({ ok: true });
});

export { app as agentNoteRoutes };
