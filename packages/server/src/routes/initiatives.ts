import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { getDb } from '../db/database';

export const initiativeRoutes = new Hono();

function ensureTable() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS initiatives (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      workspace_paths TEXT NOT NULL DEFAULT '[]',
      prd_ids TEXT NOT NULL DEFAULT '[]',
      color TEXT NOT NULL DEFAULT '#6366f1',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}

ensureTable();

interface InitiativeRow {
  id: string;
  name: string;
  description: string;
  status: string;
  workspace_paths: string;
  prd_ids: string;
  color: string;
  created_at: number;
  updated_at: number;
}

function rowToInitiative(row: InitiativeRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    workspacePaths: (() => {
      try {
        return JSON.parse(row.workspace_paths);
      } catch {
        return [];
      }
    })(),
    prdIds: (() => {
      try {
        return JSON.parse(row.prd_ids);
      } catch {
        return [];
      }
    })(),
    color: row.color,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /initiatives
initiativeRoutes.get('/', (c) => {
  const db = getDb();
  const rows = db
    .query('SELECT * FROM initiatives ORDER BY created_at DESC')
    .all() as InitiativeRow[];
  return c.json({ ok: true, data: rows.map(rowToInitiative) });
});

// POST /initiatives
initiativeRoutes.post('/', async (c) => {
  let body: {
    name: string;
    description?: string;
    workspacePaths?: string[];
    prdIds?: string[];
    color?: string;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const { name, description = '', workspacePaths = [], prdIds = [], color = '#6366f1' } = body;
  if (!name || typeof name !== 'string') {
    return c.json({ ok: false, error: 'name is required' }, 400);
  }

  const db = getDb();
  const id = nanoid(12);
  const now = Date.now();

  db.query(
    `
    INSERT INTO initiatives (id, name, description, status, workspace_paths, prd_ids, color, created_at, updated_at)
    VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)
  `,
  ).run(
    id,
    name,
    description,
    JSON.stringify(workspacePaths),
    JSON.stringify(prdIds),
    color,
    now,
    now,
  );

  const row = db.query('SELECT * FROM initiatives WHERE id = ?').get(id) as InitiativeRow;
  return c.json({ ok: true, data: rowToInitiative(row) }, 201);
});

// GET /initiatives/:id
initiativeRoutes.get('/:id', (c) => {
  const { id } = c.req.param();
  const db = getDb();

  const row = db.query('SELECT * FROM initiatives WHERE id = ?').get(id) as InitiativeRow | null;
  if (!row) return c.json({ ok: false, error: 'Initiative not found' }, 404);

  const initiative = rowToInitiative(row);

  // Fetch linked PRD names
  let prdNames: Array<{ id: string; name: string }> = [];
  if (initiative.prdIds.length > 0) {
    try {
      const placeholders = initiative.prdIds.map(() => '?').join(', ');
      const prdRows = db
        .query(`SELECT id, name FROM prds WHERE id IN (${placeholders})`)
        .all(...initiative.prdIds) as Array<{ id: string; name: string }>;
      prdNames = prdRows;
    } catch {
      // prds table may not exist yet
    }
  }

  // Fetch workspace names (use path basename as name)
  const workspaceNames = initiative.workspacePaths.map((p: string) => ({
    path: p,
    name: p.split('/').filter(Boolean).pop() ?? p,
  }));

  return c.json({
    ok: true,
    data: {
      ...initiative,
      prdDetails: prdNames,
      workspaceDetails: workspaceNames,
    },
  });
});

// PATCH /initiatives/:id
initiativeRoutes.patch('/:id', async (c) => {
  const { id } = c.req.param();
  const db = getDb();

  const existing = db
    .query('SELECT * FROM initiatives WHERE id = ?')
    .get(id) as InitiativeRow | null;
  if (!existing) return c.json({ ok: false, error: 'Initiative not found' }, 404);

  let body: Record<string, any>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
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
  if (body.status !== undefined) {
    updates.push('status = ?');
    values.push(body.status);
  }
  if (body.workspacePaths !== undefined) {
    updates.push('workspace_paths = ?');
    values.push(JSON.stringify(body.workspacePaths));
  }
  if (body.prdIds !== undefined) {
    updates.push('prd_ids = ?');
    values.push(JSON.stringify(body.prdIds));
  }
  if (body.color !== undefined) {
    updates.push('color = ?');
    values.push(body.color);
  }

  if (updates.length === 0) {
    return c.json({ ok: true, data: rowToInitiative(existing) });
  }

  updates.push('updated_at = ?');
  values.push(Date.now());
  values.push(id);

  db.query(`UPDATE initiatives SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const updated = db.query('SELECT * FROM initiatives WHERE id = ?').get(id) as InitiativeRow;
  return c.json({ ok: true, data: rowToInitiative(updated) });
});

// DELETE /initiatives/:id
initiativeRoutes.delete('/:id', (c) => {
  const { id } = c.req.param();
  const db = getDb();

  const existing = db.query('SELECT id FROM initiatives WHERE id = ?').get(id);
  if (!existing) return c.json({ ok: false, error: 'Initiative not found' }, 404);

  db.query('DELETE FROM initiatives WHERE id = ?').run(id);
  return c.json({ ok: true });
});

// POST /initiatives/:id/workspaces — add workspace path
initiativeRoutes.post('/:id/workspaces', async (c) => {
  const { id } = c.req.param();
  const db = getDb();

  const row = db.query('SELECT * FROM initiatives WHERE id = ?').get(id) as InitiativeRow | null;
  if (!row) return c.json({ ok: false, error: 'Initiative not found' }, 404);

  let body: { workspacePath: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const { workspacePath } = body;
  if (!workspacePath) return c.json({ ok: false, error: 'workspacePath is required' }, 400);

  const paths: string[] = (() => {
    try {
      return JSON.parse(row.workspace_paths);
    } catch {
      return [];
    }
  })();
  if (!paths.includes(workspacePath)) {
    paths.push(workspacePath);
    db.query('UPDATE initiatives SET workspace_paths = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(paths),
      Date.now(),
      id,
    );
  }

  return c.json({ ok: true });
});

// DELETE /initiatives/:id/workspaces — remove workspace path
initiativeRoutes.delete('/:id/workspaces', async (c) => {
  const { id } = c.req.param();
  const db = getDb();

  const row = db.query('SELECT * FROM initiatives WHERE id = ?').get(id) as InitiativeRow | null;
  if (!row) return c.json({ ok: false, error: 'Initiative not found' }, 404);

  let body: { workspacePath: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const { workspacePath } = body;
  if (!workspacePath) return c.json({ ok: false, error: 'workspacePath is required' }, 400);

  const paths: string[] = (() => {
    try {
      return JSON.parse(row.workspace_paths);
    } catch {
      return [];
    }
  })();
  const filtered = paths.filter((p) => p !== workspacePath);
  db.query('UPDATE initiatives SET workspace_paths = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(filtered),
    Date.now(),
    id,
  );

  return c.json({ ok: true });
});

// POST /initiatives/:id/prds — add PRD
initiativeRoutes.post('/:id/prds', async (c) => {
  const { id } = c.req.param();
  const db = getDb();

  const row = db.query('SELECT * FROM initiatives WHERE id = ?').get(id) as InitiativeRow | null;
  if (!row) return c.json({ ok: false, error: 'Initiative not found' }, 404);

  let body: { prdId: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const { prdId } = body;
  if (!prdId) return c.json({ ok: false, error: 'prdId is required' }, 400);

  const ids: string[] = (() => {
    try {
      return JSON.parse(row.prd_ids);
    } catch {
      return [];
    }
  })();
  if (!ids.includes(prdId)) {
    ids.push(prdId);
    db.query('UPDATE initiatives SET prd_ids = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(ids),
      Date.now(),
      id,
    );
  }

  return c.json({ ok: true });
});

// DELETE /initiatives/:id/prds — remove PRD
initiativeRoutes.delete('/:id/prds', async (c) => {
  const { id } = c.req.param();
  const db = getDb();

  const row = db.query('SELECT * FROM initiatives WHERE id = ?').get(id) as InitiativeRow | null;
  if (!row) return c.json({ ok: false, error: 'Initiative not found' }, 404);

  let body: { prdId: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const { prdId } = body;
  if (!prdId) return c.json({ ok: false, error: 'prdId is required' }, 400);

  const ids: string[] = (() => {
    try {
      return JSON.parse(row.prd_ids);
    } catch {
      return [];
    }
  })();
  const filtered = ids.filter((p) => p !== prdId);
  db.query('UPDATE initiatives SET prd_ids = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(filtered),
    Date.now(),
    id,
  );

  return c.json({ ok: true });
});

// GET /initiatives/:id/progress — aggregate story progress across linked PRDs
initiativeRoutes.get('/:id/progress', (c) => {
  const { id } = c.req.param();
  const db = getDb();

  const row = db.query('SELECT * FROM initiatives WHERE id = ?').get(id) as InitiativeRow | null;
  if (!row) return c.json({ ok: false, error: 'Initiative not found' }, 404);

  const prdIds: string[] = (() => {
    try {
      return JSON.parse(row.prd_ids);
    } catch {
      return [];
    }
  })();

  let total = 0;
  let pending = 0;
  let in_progress = 0;
  let completed = 0;
  let failed = 0;

  if (prdIds.length > 0) {
    try {
      const placeholders = prdIds.map(() => '?').join(', ');
      const storyRows = db
        .query(`SELECT status FROM prd_stories WHERE prd_id IN (${placeholders})`)
        .all(...prdIds) as Array<{ status: string }>;

      total = storyRows.length;
      for (const s of storyRows) {
        if (s.status === 'pending') pending++;
        else if (s.status === 'in_progress') in_progress++;
        else if (s.status === 'completed') completed++;
        else if (s.status === 'failed') failed++;
      }
    } catch {
      // prd_stories table may not exist
    }
  }

  const percentComplete = total > 0 ? Math.round((completed / total) * 100) : 0;

  return c.json({
    ok: true,
    data: { total, pending, in_progress, completed, failed, percentComplete },
  });
});
