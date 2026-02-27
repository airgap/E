import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { getDb } from '../db/database';
import type { Artifact, ArtifactCreateInput, ArtifactUpdateInput } from '@e/shared';

const app = new Hono();

function rowToArtifact(row: any): Artifact {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    messageId: row.message_id || undefined,
    type: row.type,
    title: row.title,
    content: row.content,
    metadata: row.metadata ? JSON.parse(row.metadata) : {},
    pinned: Boolean(row.pinned),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * GET /api/artifacts?conversationId=...
 * List all artifacts for a conversation.
 */
app.get('/', (c) => {
  const conversationId = c.req.query('conversationId');
  if (!conversationId) {
    return c.json({ ok: false, error: 'conversationId required' }, 400);
  }

  const db = getDb();
  const rows = db
    .query(
      `SELECT * FROM artifacts WHERE conversation_id = ? ORDER BY pinned DESC, created_at DESC`,
    )
    .all(conversationId) as any[];

  return c.json({ ok: true, data: rows.map(rowToArtifact) });
});

/**
 * GET /api/artifacts/:id
 * Get a single artifact.
 */
app.get('/:id', (c) => {
  const db = getDb();
  const row = db.query('SELECT * FROM artifacts WHERE id = ?').get(c.req.param('id')) as any;
  if (!row) return c.json({ ok: false, error: 'Artifact not found' }, 404);
  return c.json({ ok: true, data: rowToArtifact(row) });
});

/**
 * POST /api/artifacts
 * Create a new artifact.
 */
app.post('/', async (c) => {
  const body = (await c.req.json()) as ArtifactCreateInput;
  const { conversationId, messageId, type, title, content, metadata } = body;

  if (!conversationId || !type || !title || content === undefined) {
    return c.json(
      { ok: false, error: 'conversationId, type, title, and content are required' },
      400,
    );
  }

  const db = getDb();
  const conv = db.query('SELECT id FROM conversations WHERE id = ?').get(conversationId) as any;
  if (!conv) return c.json({ ok: false, error: 'Conversation not found' }, 404);

  const id = nanoid(12);
  const now = Date.now();
  db.query(
    `INSERT INTO artifacts (id, conversation_id, message_id, type, title, content, metadata, pinned, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(
    id,
    conversationId,
    messageId || null,
    type,
    title,
    content,
    JSON.stringify(metadata || {}),
    now,
    now,
  );

  const row = db.query('SELECT * FROM artifacts WHERE id = ?').get(id) as any;
  return c.json({ ok: true, data: rowToArtifact(row) }, 201);
});

/**
 * PATCH /api/artifacts/:id
 * Update an artifact (title, content, metadata, pinned).
 */
app.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const db = getDb();
  const existing = db.query('SELECT * FROM artifacts WHERE id = ?').get(id) as any;
  if (!existing) return c.json({ ok: false, error: 'Artifact not found' }, 404);

  const body = (await c.req.json()) as ArtifactUpdateInput;
  const { title, content, metadata, pinned } = body;

  const now = Date.now();
  db.query(
    `UPDATE artifacts SET
       title = COALESCE(?, title),
       content = COALESCE(?, content),
       metadata = COALESCE(?, metadata),
       pinned = COALESCE(?, pinned),
       updated_at = ?
     WHERE id = ?`,
  ).run(
    title ?? null,
    content ?? null,
    metadata !== undefined ? JSON.stringify(metadata) : null,
    pinned !== undefined ? (pinned ? 1 : 0) : null,
    now,
    id,
  );

  const row = db.query('SELECT * FROM artifacts WHERE id = ?').get(id) as any;
  return c.json({ ok: true, data: rowToArtifact(row) });
});

/**
 * DELETE /api/artifacts/:id
 * Delete an artifact.
 */
app.delete('/:id', (c) => {
  const id = c.req.param('id');
  const db = getDb();
  const existing = db.query('SELECT id FROM artifacts WHERE id = ?').get(id) as any;
  if (!existing) return c.json({ ok: false, error: 'Artifact not found' }, 404);

  db.query('DELETE FROM artifacts WHERE id = ?').run(id);
  return c.json({ ok: true });
});

export { app as artifactRoutes };
