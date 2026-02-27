import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { getDb } from '../db/database';
import { BUILT_IN_PROFILES } from '@e/shared';
import type { AgentProfile } from '@e/shared';

const app = new Hono();

function rowToProfile(row: any): AgentProfile {
  return {
    id: row.id,
    name: row.name,
    description: row.description || undefined,
    isBuiltIn: false,
    permissionMode: row.permission_mode,
    allowedTools: JSON.parse(row.allowed_tools || '[]'),
    disallowedTools: JSON.parse(row.disallowed_tools || '[]'),
    systemPrompt: row.system_prompt || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// List all profiles (built-in + custom)
app.get('/', (c) => {
  const db = getDb();
  const rows = db.query('SELECT * FROM agent_profiles ORDER BY created_at ASC').all() as any[];
  const custom = rows.map(rowToProfile);
  return c.json({ ok: true, data: [...BUILT_IN_PROFILES, ...custom] });
});

// Get a single profile
app.get('/:id', (c) => {
  const id = c.req.param('id');

  // Check built-ins first
  const builtIn = BUILT_IN_PROFILES.find((p) => p.id === id);
  if (builtIn) return c.json({ ok: true, data: builtIn });

  const db = getDb();
  const row = db.query('SELECT * FROM agent_profiles WHERE id = ?').get(id) as any;
  if (!row) return c.json({ ok: false, error: 'Profile not found' }, 404);

  return c.json({ ok: true, data: rowToProfile(row) });
});

// Create a custom profile
app.post('/', async (c) => {
  const body = await c.req.json();
  const { name, description, permissionMode, allowedTools, disallowedTools, systemPrompt } = body;

  if (!name) return c.json({ ok: false, error: 'name is required' }, 400);
  if (!permissionMode) return c.json({ ok: false, error: 'permissionMode is required' }, 400);

  const db = getDb();
  const id = nanoid();
  const now = Date.now();

  db.query(
    `
    INSERT INTO agent_profiles (id, name, description, permission_mode, allowed_tools, disallowed_tools, system_prompt, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    id,
    name,
    description || null,
    permissionMode,
    JSON.stringify(allowedTools || []),
    JSON.stringify(disallowedTools || []),
    systemPrompt || null,
    now,
    now,
  );

  const profile: AgentProfile = {
    id,
    name,
    description: description || undefined,
    isBuiltIn: false,
    permissionMode,
    allowedTools: allowedTools || [],
    disallowedTools: disallowedTools || [],
    systemPrompt: systemPrompt || undefined,
    createdAt: now,
    updatedAt: now,
  };

  return c.json({ ok: true, data: profile }, 201);
});

// Update a custom profile
app.patch('/:id', async (c) => {
  const id = c.req.param('id');

  // Built-ins cannot be edited
  if (BUILT_IN_PROFILES.some((p) => p.id === id)) {
    return c.json({ ok: false, error: 'Built-in profiles cannot be modified' }, 400);
  }

  const db = getDb();
  const existing = db.query('SELECT * FROM agent_profiles WHERE id = ?').get(id) as any;
  if (!existing) return c.json({ ok: false, error: 'Profile not found' }, 404);

  const body = await c.req.json();
  const now = Date.now();

  const name = body.name ?? existing.name;
  const description = 'description' in body ? body.description : existing.description;
  const permissionMode = body.permissionMode ?? existing.permission_mode;
  const allowedTools = body.allowedTools ?? JSON.parse(existing.allowed_tools || '[]');
  const disallowedTools = body.disallowedTools ?? JSON.parse(existing.disallowed_tools || '[]');
  const systemPrompt = 'systemPrompt' in body ? body.systemPrompt : existing.system_prompt;

  db.query(
    `
    UPDATE agent_profiles
    SET name = ?, description = ?, permission_mode = ?, allowed_tools = ?, disallowed_tools = ?, system_prompt = ?, updated_at = ?
    WHERE id = ?
  `,
  ).run(
    name,
    description || null,
    permissionMode,
    JSON.stringify(allowedTools),
    JSON.stringify(disallowedTools),
    systemPrompt || null,
    now,
    id,
  );

  const profile: AgentProfile = {
    id,
    name,
    description: description || undefined,
    isBuiltIn: false,
    permissionMode,
    allowedTools,
    disallowedTools,
    systemPrompt: systemPrompt || undefined,
    createdAt: existing.created_at,
    updatedAt: now,
  };

  return c.json({ ok: true, data: profile });
});

// Delete a custom profile
app.delete('/:id', (c) => {
  const id = c.req.param('id');

  // Built-ins cannot be deleted
  if (BUILT_IN_PROFILES.some((p) => p.id === id)) {
    return c.json({ ok: false, error: 'Built-in profiles cannot be deleted' }, 400);
  }

  const db = getDb();
  const existing = db.query('SELECT id FROM agent_profiles WHERE id = ?').get(id) as any;
  if (!existing) return c.json({ ok: false, error: 'Profile not found' }, 404);

  db.query('DELETE FROM agent_profiles WHERE id = ?').run(id);

  return c.json({ ok: true });
});

export { app as profileRoutes };
