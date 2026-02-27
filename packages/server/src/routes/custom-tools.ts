import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { getDb } from '../db/database';

export const customToolRoutes = new Hono();

/**
 * Validate handler commands against a blocklist of dangerous patterns.
 * This is defense-in-depth — CSRF + CORS should prevent external creation,
 * but we also block obviously malicious commands.
 */
function isCommandSafe(command: string): { safe: boolean; reason?: string } {
  const normalized = command.toLowerCase().trim();
  const dangerousPatterns = [
    /curl\s.*\|\s*(ba)?sh/, // curl | sh / curl | bash
    /wget\s.*\|\s*(ba)?sh/, // wget | sh / wget | bash
    /\beval\s/, // eval
    />\s*\/dev\/sd/, // write to block devices
    /rm\s+-rf\s+[\/~]/, // rm -rf / or ~
    /mkfs/, // format drives
    /dd\s+if=/, // raw disk write
    /:\(\)\s*\{.*\|.*&\s*\}\s*;/, // fork bomb
    /chmod\s+-R\s+777\s+\//, // open everything
    />\s*\/etc\//, // write to /etc
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(normalized)) {
      return { safe: false, reason: 'Command contains a blocked dangerous pattern' };
    }
  }

  return { safe: true };
}

function ensureTable() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_tools (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      input_schema TEXT NOT NULL DEFAULT '{}',
      handler_type TEXT NOT NULL DEFAULT 'shell',
      handler_command TEXT NOT NULL,
      workspace_path TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}

ensureTable();

interface CustomTool {
  id: string;
  name: string;
  description: string;
  input_schema: string;
  handler_type: string;
  handler_command: string;
  workspace_path: string | null;
  enabled: number;
  created_at: number;
  updated_at: number;
}

function rowToTool(row: CustomTool) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    inputSchema: (() => {
      try {
        return JSON.parse(row.input_schema);
      } catch {
        return {};
      }
    })(),
    handlerType: row.handler_type,
    handlerCommand: row.handler_command,
    workspacePath: row.workspace_path,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /custom-tools
customToolRoutes.get('/', async (c) => {
  const workspacePath = c.req.query('workspacePath');
  const db = getDb();

  let rows: CustomTool[];
  if (workspacePath) {
    rows = db
      .query(
        'SELECT * FROM custom_tools WHERE workspace_path = ? OR workspace_path IS NULL ORDER BY created_at ASC',
      )
      .all(workspacePath) as CustomTool[];
  } else {
    rows = db.query('SELECT * FROM custom_tools ORDER BY created_at ASC').all() as CustomTool[];
  }

  return c.json({ ok: true, data: rows.map(rowToTool) });
});

// POST /custom-tools
customToolRoutes.post('/', async (c) => {
  let body: {
    name: string;
    description: string;
    inputSchema?: any;
    handlerType?: string;
    handlerCommand: string;
    workspacePath?: string;
  };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const {
    name,
    description,
    inputSchema = {},
    handlerType = 'shell',
    handlerCommand,
    workspacePath,
  } = body;

  if (!name || typeof name !== 'string') {
    return c.json({ ok: false, error: 'name is required' }, 400);
  }
  if (!description || typeof description !== 'string') {
    return c.json({ ok: false, error: 'description is required' }, 400);
  }
  if (!handlerCommand || typeof handlerCommand !== 'string') {
    return c.json({ ok: false, error: 'handlerCommand is required' }, 400);
  }

  // Validate the command isn't obviously dangerous
  const cmdCheck = isCommandSafe(handlerCommand);
  if (!cmdCheck.safe) {
    return c.json({ ok: false, error: cmdCheck.reason }, 400);
  }

  // Require explicit confirmation header for creating tools with shell commands
  const confirmed = c.req.header('X-Confirm-Dangerous');
  if (!confirmed) {
    return c.json(
      { ok: false, error: 'Custom tool creation requires X-Confirm-Dangerous header' },
      400,
    );
  }

  const db = getDb();
  const id = nanoid(12);
  const now = Date.now();

  try {
    db.query(
      `
      INSERT INTO custom_tools (id, name, description, input_schema, handler_type, handler_command, workspace_path, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `,
    ).run(
      id,
      name,
      description,
      JSON.stringify(inputSchema),
      handlerType,
      handlerCommand,
      workspacePath ?? null,
      now,
      now,
    );
  } catch (err: any) {
    if (err?.message?.includes('UNIQUE')) {
      return c.json({ ok: false, error: `A tool named "${name}" already exists` }, 409);
    }
    return c.json({ ok: false, error: err?.message ?? 'Failed to create tool' }, 500);
  }

  const row = db.query('SELECT * FROM custom_tools WHERE id = ?').get(id) as CustomTool;
  return c.json({ ok: true, data: rowToTool(row) }, 201);
});

// GET /custom-tools/:id
customToolRoutes.get('/:id', async (c) => {
  const { id } = c.req.param();
  const db = getDb();

  const row = db.query('SELECT * FROM custom_tools WHERE id = ?').get(id) as CustomTool | null;
  if (!row) {
    return c.json({ ok: false, error: 'Tool not found' }, 404);
  }

  return c.json({ ok: true, data: rowToTool(row) });
});

// PATCH /custom-tools/:id
customToolRoutes.patch('/:id', async (c) => {
  const { id } = c.req.param();
  const db = getDb();

  const existing = db.query('SELECT * FROM custom_tools WHERE id = ?').get(id) as CustomTool | null;
  if (!existing) {
    return c.json({ ok: false, error: 'Tool not found' }, 404);
  }

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
  if (body.inputSchema !== undefined) {
    updates.push('input_schema = ?');
    values.push(JSON.stringify(body.inputSchema));
  }
  if (body.handlerType !== undefined) {
    updates.push('handler_type = ?');
    values.push(body.handlerType);
  }
  if (body.handlerCommand !== undefined) {
    // Validate the command isn't obviously dangerous
    const cmdCheck = isCommandSafe(body.handlerCommand);
    if (!cmdCheck.safe) {
      return c.json({ ok: false, error: cmdCheck.reason }, 400);
    }
    // Require explicit confirmation header for updating shell commands
    const confirmed = c.req.header('X-Confirm-Dangerous');
    if (!confirmed) {
      return c.json(
        { ok: false, error: 'Updating handler commands requires X-Confirm-Dangerous header' },
        400,
      );
    }
    updates.push('handler_command = ?');
    values.push(body.handlerCommand);
  }
  if (body.workspacePath !== undefined) {
    updates.push('workspace_path = ?');
    values.push(body.workspacePath ?? null);
  }
  if (body.enabled !== undefined) {
    updates.push('enabled = ?');
    values.push(body.enabled ? 1 : 0);
  }

  if (updates.length === 0) {
    return c.json({ ok: true, data: rowToTool(existing) });
  }

  updates.push('updated_at = ?');
  values.push(Date.now());
  values.push(id);

  try {
    db.query(`UPDATE custom_tools SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  } catch (err: any) {
    if (err?.message?.includes('UNIQUE')) {
      return c.json({ ok: false, error: `A tool with that name already exists` }, 409);
    }
    return c.json({ ok: false, error: err?.message ?? 'Failed to update tool' }, 500);
  }

  const updated = db.query('SELECT * FROM custom_tools WHERE id = ?').get(id) as CustomTool;
  return c.json({ ok: true, data: rowToTool(updated) });
});

// DELETE /custom-tools/:id
customToolRoutes.delete('/:id', async (c) => {
  const { id } = c.req.param();
  const db = getDb();

  const existing = db.query('SELECT id FROM custom_tools WHERE id = ?').get(id);
  if (!existing) {
    return c.json({ ok: false, error: 'Tool not found' }, 404);
  }

  db.query('DELETE FROM custom_tools WHERE id = ?').run(id);
  return c.json({ ok: true });
});

// POST /custom-tools/:id/test
customToolRoutes.post('/:id/test', async (c) => {
  const { id } = c.req.param();
  const db = getDb();

  const row = db.query('SELECT * FROM custom_tools WHERE id = ?').get(id) as CustomTool | null;
  if (!row) {
    return c.json({ ok: false, error: 'Tool not found' }, 404);
  }

  let body: { input?: Record<string, any> };
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const input = body.input ?? {};
  const start = Date.now();

  try {
    const proc = Bun.spawn(['sh', '-c', row.handler_command], {
      env: { ...process.env, TOOL_INPUT: JSON.stringify(input) },
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const [stdoutText, stderrText, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    const duration = Date.now() - start;
    const output = (stdoutText + (stderrText ? `\nSTDERR:\n${stderrText}` : '')).trim();

    return c.json({
      ok: true,
      data: {
        output,
        exitCode: exitCode ?? 0,
        duration,
      },
    });
  } catch (err: any) {
    const duration = Date.now() - start;
    return c.json({
      ok: false,
      data: {
        output: err?.message ?? 'Failed to run command',
        exitCode: 1,
        duration,
      },
    });
  }
});
