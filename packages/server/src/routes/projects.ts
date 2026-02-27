import { Hono } from 'hono';
import { getDb } from '../db/database';
import { randomUUID } from 'crypto';
import { getSandboxConfig } from '../middleware/sandbox';

const app = new Hono();

// List all workspaces
app.get('/', (c) => {
  const db = getDb();
  const rows = db.query('SELECT * FROM workspaces ORDER BY last_opened DESC').all() as any[];
  const workspaces = rows.map((r) => ({
    id: r.id,
    name: r.name,
    path: r.path,
    lastOpened: r.last_opened,
    settings: r.settings ? JSON.parse(r.settings) : undefined,
    createdAt: r.created_at,
  }));
  return c.json({ ok: true, data: workspaces });
});

// Create workspace
app.post('/', async (c) => {
  const body = await c.req.json();
  const { name, path, settings } = body;
  if (!name || !path) return c.json({ ok: false, error: 'name and path required' }, 400);

  const db = getDb();
  const id = randomUUID();
  const now = Date.now();

  try {
    db.query(
      'INSERT INTO workspaces (id, name, path, last_opened, settings, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, name, path, now, settings ? JSON.stringify(settings) : null, now);
    return c.json({ ok: true, data: { id } });
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) {
      return c.json({ ok: false, error: 'A workspace with this path already exists' }, 409);
    }
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// Get workspace
app.get('/:id', (c) => {
  const db = getDb();
  const row = db.query('SELECT * FROM workspaces WHERE id = ?').get(c.req.param('id')) as any;
  if (!row) return c.json({ ok: false, error: 'Workspace not found' }, 404);

  return c.json({
    ok: true,
    data: {
      id: row.id,
      name: row.name,
      path: row.path,
      lastOpened: row.last_opened,
      settings: row.settings ? JSON.parse(row.settings) : undefined,
      createdAt: row.created_at,
    },
  });
});

// Update workspace
app.patch('/:id', async (c) => {
  const body = await c.req.json();
  const db = getDb();
  const id = c.req.param('id');

  const sets: string[] = [];
  const values: any[] = [];

  if (body.name !== undefined) {
    sets.push('name = ?');
    values.push(body.name);
  }
  if (body.settings !== undefined) {
    // Merge settings with existing settings instead of replacing
    const workspace = db.query('SELECT settings FROM workspaces WHERE id = ?').get(id) as any;
    if (!workspace) return c.json({ ok: false, error: 'Workspace not found' }, 404);

    const existingSettings = workspace.settings ? JSON.parse(workspace.settings) : {};
    const mergedSettings = { ...existingSettings, ...body.settings };

    sets.push('settings = ?');
    values.push(JSON.stringify(mergedSettings));
  }
  if (sets.length === 0) return c.json({ ok: true });

  values.push(id);
  db.query(`UPDATE workspaces SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return c.json({ ok: true });
});

// Delete workspace
app.delete('/:id', (c) => {
  const db = getDb();
  const id = c.req.param('id');
  // Unlink conversations from this workspace
  db.query('UPDATE conversations SET workspace_id = NULL WHERE workspace_id = ?').run(id);
  db.query('DELETE FROM workspaces WHERE id = ?').run(id);
  return c.json({ ok: true });
});

// Open workspace (update last_opened timestamp)
app.post('/:id/open', (c) => {
  const db = getDb();
  db.query('UPDATE workspaces SET last_opened = ? WHERE id = ?').run(Date.now(), c.req.param('id'));
  return c.json({ ok: true });
});

// Get sandbox config for a workspace by path
app.get('/sandbox/config', (c) => {
  const workspacePath = c.req.query('path');
  if (!workspacePath) return c.json({ ok: false, error: 'path required' }, 400);
  const config = getSandboxConfig(workspacePath);
  return c.json({ ok: true, data: config });
});

// Update sandbox config for a workspace
app.put('/sandbox/config', async (c) => {
  const body = await c.req.json();
  const { workspacePath, enabled, allowedPaths, blockedCommands } = body;
  if (!workspacePath) return c.json({ ok: false, error: 'workspacePath required' }, 400);

  const db = getDb();
  const workspace = db.query(`SELECT * FROM workspaces WHERE path = ?`).get(workspacePath) as any;
  if (!workspace) return c.json({ ok: false, error: 'Workspace not found' }, 404);

  const settings = workspace.settings ? JSON.parse(workspace.settings) : {};
  settings.sandbox = {
    enabled: enabled !== undefined ? enabled : true,
    allowedPaths: allowedPaths || [workspacePath],
    blockedCommands: blockedCommands || [],
  };

  db.query(`UPDATE workspaces SET settings = ? WHERE id = ?`).run(
    JSON.stringify(settings),
    workspace.id,
  );

  return c.json({ ok: true });
});

export { app as workspaceRoutes };
