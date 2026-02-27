import { Hono } from 'hono';
import { getDb } from '../db/database';
import { discoverMcpConfigs } from '../services/mcp-discovery';
import type { DiscoveredMcpServer } from '@e/shared';

const app = new Hono();

// List MCP servers
app.get('/servers', (c) => {
  const db = getDb();
  const rows = db.query('SELECT * FROM mcp_servers').all() as any[];
  return c.json({
    ok: true,
    data: rows.map((r) => ({
      name: r.name,
      transport: r.transport,
      command: r.command,
      args: r.args ? JSON.parse(r.args) : undefined,
      url: r.url,
      env: r.env ? JSON.parse(r.env) : undefined,
      scope: r.scope,
      status: r.status,
      tools: [],
      resources: [],
    })),
  });
});

// Add MCP server
app.post('/servers', async (c) => {
  const body = await c.req.json();
  const db = getDb();

  db.query(
    `
    INSERT INTO mcp_servers (name, transport, command, args, url, env, scope, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'disconnected')
  `,
  ).run(
    body.name,
    body.transport,
    body.command || null,
    body.args ? JSON.stringify(body.args) : null,
    body.url || null,
    body.env ? JSON.stringify(body.env) : null,
    body.scope || 'local',
  );

  return c.json({ ok: true }, 201);
});

// Remove MCP server
app.delete('/servers/:name', (c) => {
  const db = getDb();
  db.query('DELETE FROM mcp_servers WHERE name = ?').run(c.req.param('name'));
  return c.json({ ok: true });
});

// Get MCP server details
app.get('/servers/:name', (c) => {
  const db = getDb();
  const row = db.query('SELECT * FROM mcp_servers WHERE name = ?').get(c.req.param('name')) as any;
  if (!row) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({
    ok: true,
    data: {
      name: row.name,
      transport: row.transport,
      command: row.command,
      args: row.args ? JSON.parse(row.args) : undefined,
      url: row.url,
      env: row.env ? JSON.parse(row.env) : undefined,
      scope: row.scope,
      status: row.status,
    },
  });
});

// ── MCP Import/Discovery ──

// Discover MCP servers from external tool configs
app.get('/discover', (c) => {
  try {
    const sources = discoverMcpConfigs();
    return c.json({ ok: true, data: sources });
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 500);
  }
});

// Bulk import selected MCP servers
app.post('/import', async (c) => {
  const body = await c.req.json();
  const servers: DiscoveredMcpServer[] = body.servers;

  if (!Array.isArray(servers) || servers.length === 0) {
    return c.json({ ok: false, error: 'No servers provided' }, 400);
  }

  const db = getDb();
  let imported = 0;

  for (const server of servers) {
    if (!server.name) continue;
    try {
      db.query(
        `
        INSERT OR IGNORE INTO mcp_servers (name, transport, command, args, url, env, scope, status)
        VALUES (?, ?, ?, ?, ?, ?, 'local', 'disconnected')
      `,
      ).run(
        server.name,
        server.transport || 'stdio',
        server.command || null,
        server.args ? JSON.stringify(server.args) : null,
        server.url || null,
        server.env ? JSON.stringify(server.env) : null,
      );
      imported++;
    } catch {
      // Duplicate or other error — skip
    }
  }

  return c.json({ ok: true, data: { imported } }, 201);
});

export { app as mcpRoutes };
