import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { getDb } from '../db/database';

const app = new Hono();

// List tasks (optionally filtered by conversation)
app.get('/', (c) => {
  const db = getDb();
  const conversationId = c.req.query('conversationId');

  let rows;
  if (conversationId) {
    rows = db
      .query(
        'SELECT * FROM tasks WHERE conversation_id = ? AND status != ? ORDER BY created_at ASC',
      )
      .all(conversationId, 'deleted');
  } else {
    rows = db.query('SELECT * FROM tasks WHERE status != ? ORDER BY created_at ASC').all('deleted');
  }

  return c.json({
    ok: true,
    data: (rows as any[]).map(taskFromRow),
  });
});

// Get single task
app.get('/:id', (c) => {
  const db = getDb();
  const row = db.query('SELECT * FROM tasks WHERE id = ?').get(c.req.param('id')) as any;
  if (!row) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true, data: taskFromRow(row) });
});

// Create task
app.post('/', async (c) => {
  const body = await c.req.json();
  const db = getDb();
  const id = nanoid(8);
  const now = Date.now();

  db.query(
    `
    INSERT INTO tasks (id, conversation_id, subject, description, active_form, status, metadata, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)
  `,
  ).run(
    id,
    body.conversationId || null,
    body.subject,
    body.description,
    body.activeForm || null,
    body.metadata ? JSON.stringify(body.metadata) : '{}',
    now,
    now,
  );

  return c.json({ ok: true, data: { id } }, 201);
});

// Update task
app.patch('/:id', async (c) => {
  const body = await c.req.json();
  const db = getDb();
  const id = c.req.param('id');

  const existing = db.query('SELECT * FROM tasks WHERE id = ?').get(id) as any;
  if (!existing) return c.json({ ok: false, error: 'Not found' }, 404);

  const updates: string[] = [];
  const values: any[] = [];

  if (body.status !== undefined) {
    updates.push('status = ?');
    values.push(body.status);
  }
  if (body.subject !== undefined) {
    updates.push('subject = ?');
    values.push(body.subject);
  }
  if (body.description !== undefined) {
    updates.push('description = ?');
    values.push(body.description);
  }
  if (body.activeForm !== undefined) {
    updates.push('active_form = ?');
    values.push(body.activeForm);
  }
  if (body.owner !== undefined) {
    updates.push('owner = ?');
    values.push(body.owner);
  }

  if (body.addBlocks) {
    const current = JSON.parse(existing.blocks);
    const merged = [...new Set([...current, ...body.addBlocks])];
    updates.push('blocks = ?');
    values.push(JSON.stringify(merged));
  }
  if (body.addBlockedBy) {
    const current = JSON.parse(existing.blocked_by);
    const merged = [...new Set([...current, ...body.addBlockedBy])];
    updates.push('blocked_by = ?');
    values.push(JSON.stringify(merged));
  }
  if (body.metadata) {
    const current = existing.metadata ? JSON.parse(existing.metadata) : {};
    const merged = { ...current };
    for (const [k, v] of Object.entries(body.metadata)) {
      if (v === null) delete merged[k];
      else merged[k] = v;
    }
    updates.push('metadata = ?');
    values.push(JSON.stringify(merged));
  }

  updates.push('updated_at = ?');
  values.push(Date.now());
  values.push(id);

  db.query(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const updated = db.query('SELECT * FROM tasks WHERE id = ?').get(id);
  return c.json({ ok: true, data: taskFromRow(updated as any) });
});

// Delete task
app.delete('/:id', (c) => {
  const db = getDb();
  db.query("UPDATE tasks SET status = 'deleted', updated_at = ? WHERE id = ?").run(
    Date.now(),
    c.req.param('id'),
  );
  return c.json({ ok: true });
});

function taskFromRow(row: any) {
  return {
    id: row.id,
    subject: row.subject,
    description: row.description,
    activeForm: row.active_form,
    status: row.status,
    owner: row.owner,
    blocks: JSON.parse(row.blocks || '[]'),
    blockedBy: JSON.parse(row.blocked_by || '[]'),
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export { app as taskRoutes };
