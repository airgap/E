/**
 * /api/docs — CRUD for user-authored long-form documents (the WYSIWYG
 * markdown editor surface). Mirrors agent-notes' shape: workspace-scoped
 * list endpoint, standard get/create/update/delete by id.
 *
 * `content` is the canonical markdown source. The client editor (Tiptap)
 * renders it to HTML in-memory and serialises back on save — the round-
 * trip happens client-side; we just persist the markdown string.
 */
import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { getDb } from '../db/database';
import type { Document, DocumentCreateInput, DocumentUpdateInput } from '@e/shared';

const app = new Hono();

function rowToDoc(row: any): Document {
  return {
    id: row.id,
    workspacePath: row.workspace_path,
    title: row.title,
    content: row.content,
    metadata: row.metadata ? JSON.parse(row.metadata) : {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * GET /api/docs?workspacePath=...
 * List documents for a workspace, most-recently-updated first.
 */
app.get('/', (c) => {
  const workspacePath = c.req.query('workspacePath');
  if (!workspacePath) {
    return c.json({ ok: false, error: 'workspacePath required' }, 400);
  }

  const db = getDb();
  const rows = db
    .query('SELECT * FROM documents WHERE workspace_path = ? ORDER BY updated_at DESC')
    .all(workspacePath) as any[];
  return c.json({ ok: true, data: rows.map(rowToDoc) });
});

/**
 * GET /api/docs/:id
 * Fetch a single document.
 */
app.get('/:id', (c) => {
  const db = getDb();
  const row = db.query('SELECT * FROM documents WHERE id = ?').get(c.req.param('id')) as any;
  if (!row) return c.json({ ok: false, error: 'Document not found' }, 404);
  return c.json({ ok: true, data: rowToDoc(row) });
});

/**
 * POST /api/docs
 * Create a new document. `content` is optional (defaults to empty) so the
 * client can spin up a blank doc and let the editor fill it.
 */
app.post('/', async (c) => {
  const body = (await c.req.json()) as DocumentCreateInput;
  const { workspacePath, title, content } = body;

  if (!workspacePath || !title) {
    return c.json({ ok: false, error: 'workspacePath and title are required' }, 400);
  }

  const db = getDb();
  const id = nanoid(12);
  const now = Date.now();

  db.query(
    `INSERT INTO documents (id, workspace_path, title, content, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, '{}', ?, ?)`,
  ).run(id, workspacePath, title, content ?? '', now, now);

  const row = db.query('SELECT * FROM documents WHERE id = ?').get(id) as any;
  return c.json({ ok: true, data: rowToDoc(row) }, 201);
});

/**
 * PATCH /api/docs/:id
 * Update title / content / metadata. Each field is independently optional;
 * unprovided fields keep their existing values (COALESCE).
 */
app.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const db = getDb();
  const existing = db.query('SELECT id FROM documents WHERE id = ?').get(id) as any;
  if (!existing) return c.json({ ok: false, error: 'Document not found' }, 404);

  const body = (await c.req.json()) as DocumentUpdateInput;
  const { title, content, metadata } = body;

  const now = Date.now();
  db.query(
    `UPDATE documents SET
       title = COALESCE(?, title),
       content = COALESCE(?, content),
       metadata = COALESCE(?, metadata),
       updated_at = ?
     WHERE id = ?`,
  ).run(
    title ?? null,
    content ?? null,
    metadata !== undefined ? JSON.stringify(metadata) : null,
    now,
    id,
  );

  const row = db.query('SELECT * FROM documents WHERE id = ?').get(id) as any;
  return c.json({ ok: true, data: rowToDoc(row) });
});

/**
 * DELETE /api/docs/:id
 */
app.delete('/:id', (c) => {
  const id = c.req.param('id');
  const db = getDb();
  const existing = db.query('SELECT id FROM documents WHERE id = ?').get(id) as any;
  if (!existing) return c.json({ ok: false, error: 'Document not found' }, 404);

  db.query('DELETE FROM documents WHERE id = ?').run(id);
  return c.json({ ok: true });
});

export { app as docsRoutes };
