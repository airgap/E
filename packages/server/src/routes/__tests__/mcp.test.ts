import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { createTestDb } from '../../test-helpers';

const testDb = createTestDb();
mock.module('../../db/database', () => ({
  getDb: () => testDb,
  initDatabase: () => {},
}));

import { mcpRoutes as app } from '../mcp';

function clearTables() {
  testDb.exec('DELETE FROM mcp_servers');
}

function insertServer(overrides: Record<string, any> = {}) {
  const defaults = {
    name: 'test-server',
    transport: 'stdio',
    command: 'npx',
    args: '["--yes","@test/server"]',
    url: null,
    env: '{}',
    scope: 'project',
    status: 'disconnected',
  };
  const row = { ...defaults, ...overrides };
  testDb
    .query(
      `INSERT INTO mcp_servers (name, transport, command, args, url, env, scope, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(row.name, row.transport, row.command, row.args, row.url, row.env, row.scope, row.status);
}

describe('MCP Routes', () => {
  beforeEach(() => {
    clearTables();
  });

  // ---------------------------------------------------------------
  // GET /servers — List MCP servers
  // ---------------------------------------------------------------
  describe('GET /servers — list servers', () => {
    test('returns empty array when no servers exist', async () => {
      const res = await app.request('/servers');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data).toEqual([]);
    });

    test('returns all servers', async () => {
      insertServer({ name: 'server-a' });
      insertServer({ name: 'server-b' });

      const res = await app.request('/servers');
      const json = await res.json();
      expect(json.data).toHaveLength(2);
    });

    test('maps fields correctly including parsed JSON', async () => {
      insertServer({
        name: 'my-server',
        transport: 'stdio',
        command: 'node',
        args: '["server.js","--port","3000"]',
        url: null,
        env: '{"API_KEY":"secret"}',
        scope: 'local',
        status: 'connected',
      });

      const res = await app.request('/servers');
      const json = await res.json();
      const server = json.data[0];
      expect(server.name).toBe('my-server');
      expect(server.transport).toBe('stdio');
      expect(server.command).toBe('node');
      expect(server.args).toEqual(['server.js', '--port', '3000']);
      expect(server.url).toBeNull();
      expect(server.env).toEqual({ API_KEY: 'secret' });
      expect(server.scope).toBe('local');
      expect(server.status).toBe('connected');
      expect(server.tools).toEqual([]);
      expect(server.resources).toEqual([]);
    });

    test('returns undefined for null args and env', async () => {
      insertServer({
        name: 'minimal',
        args: null as any,
        env: null as any,
      });

      const res = await app.request('/servers');
      const json = await res.json();
      expect(json.data[0].args).toBeUndefined();
      expect(json.data[0].env).toBeUndefined();
    });

    test('handles sse transport with url', async () => {
      insertServer({
        name: 'sse-server',
        transport: 'sse',
        command: null,
        args: null as any,
        url: 'http://localhost:8080/sse',
      });

      const res = await app.request('/servers');
      const json = await res.json();
      const server = json.data[0];
      expect(server.transport).toBe('sse');
      expect(server.command).toBeNull();
      expect(server.url).toBe('http://localhost:8080/sse');
    });
  });

  // ---------------------------------------------------------------
  // POST /servers — Add MCP server
  // ---------------------------------------------------------------
  describe('POST /servers — add server', () => {
    test('creates a stdio server', async () => {
      const res = await app.request('/servers', {
        method: 'POST',
        body: JSON.stringify({
          name: 'new-server',
          transport: 'stdio',
          command: 'npx',
          args: ['--yes', '@modelcontextprotocol/server-filesystem'],
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.ok).toBe(true);

      const row = testDb.query('SELECT * FROM mcp_servers WHERE name = ?').get('new-server') as any;
      expect(row.transport).toBe('stdio');
      expect(row.command).toBe('npx');
      expect(JSON.parse(row.args)).toEqual(['--yes', '@modelcontextprotocol/server-filesystem']);
      expect(row.status).toBe('disconnected');
    });

    test('creates an sse server with url', async () => {
      const res = await app.request('/servers', {
        method: 'POST',
        body: JSON.stringify({
          name: 'remote-server',
          transport: 'sse',
          url: 'http://remote:9090/sse',
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(201);

      const row = testDb
        .query('SELECT * FROM mcp_servers WHERE name = ?')
        .get('remote-server') as any;
      expect(row.transport).toBe('sse');
      expect(row.url).toBe('http://remote:9090/sse');
      expect(row.command).toBeNull();
    });

    test('stores env variables', async () => {
      await app.request('/servers', {
        method: 'POST',
        body: JSON.stringify({
          name: 'env-server',
          transport: 'stdio',
          command: 'node',
          env: { DB_HOST: 'localhost', DB_PORT: '5432' },
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const row = testDb
        .query('SELECT env FROM mcp_servers WHERE name = ?')
        .get('env-server') as any;
      expect(JSON.parse(row.env)).toEqual({ DB_HOST: 'localhost', DB_PORT: '5432' });
    });

    test('defaults scope to local', async () => {
      await app.request('/servers', {
        method: 'POST',
        body: JSON.stringify({
          name: 'scoped-server',
          transport: 'stdio',
          command: 'test',
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const row = testDb
        .query('SELECT scope FROM mcp_servers WHERE name = ?')
        .get('scoped-server') as any;
      expect(row.scope).toBe('local');
    });

    test('accepts custom scope', async () => {
      await app.request('/servers', {
        method: 'POST',
        body: JSON.stringify({
          name: 'global-server',
          transport: 'stdio',
          command: 'test',
          scope: 'global',
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const row = testDb
        .query('SELECT scope FROM mcp_servers WHERE name = ?')
        .get('global-server') as any;
      expect(row.scope).toBe('global');
    });

    test('status defaults to disconnected', async () => {
      await app.request('/servers', {
        method: 'POST',
        body: JSON.stringify({
          name: 'status-server',
          transport: 'stdio',
          command: 'test',
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const row = testDb
        .query('SELECT status FROM mcp_servers WHERE name = ?')
        .get('status-server') as any;
      expect(row.status).toBe('disconnected');
    });

    test('handles null optional fields', async () => {
      await app.request('/servers', {
        method: 'POST',
        body: JSON.stringify({
          name: 'minimal-server',
          transport: 'stdio',
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const row = testDb
        .query('SELECT * FROM mcp_servers WHERE name = ?')
        .get('minimal-server') as any;
      expect(row.command).toBeNull();
      expect(row.args).toBeNull();
      expect(row.url).toBeNull();
      expect(row.env).toBeNull();
    });
  });

  // ---------------------------------------------------------------
  // GET /servers/:name — Get server details
  // ---------------------------------------------------------------
  describe('GET /servers/:name — get server', () => {
    test('returns 404 for non-existent server', async () => {
      const res = await app.request('/servers/nonexistent');
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('Not found');
    });

    test('returns server details', async () => {
      insertServer({
        name: 'detail-server',
        transport: 'stdio',
        command: 'npx',
        args: '["arg1"]',
        env: '{"K":"V"}',
        scope: 'local',
        status: 'connected',
      });

      const res = await app.request('/servers/detail-server');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.name).toBe('detail-server');
      expect(json.data.transport).toBe('stdio');
      expect(json.data.command).toBe('npx');
      expect(json.data.args).toEqual(['arg1']);
      expect(json.data.env).toEqual({ K: 'V' });
      expect(json.data.scope).toBe('local');
      expect(json.data.status).toBe('connected');
    });

    test('returns undefined for null args and env', async () => {
      insertServer({
        name: 'null-fields',
        args: null as any,
        env: null as any,
      });

      const res = await app.request('/servers/null-fields');
      const json = await res.json();
      expect(json.data.args).toBeUndefined();
      expect(json.data.env).toBeUndefined();
    });

    test('returns url for sse transport', async () => {
      insertServer({
        name: 'sse-detail',
        transport: 'sse',
        command: null,
        url: 'http://localhost:3000/sse',
      });

      const res = await app.request('/servers/sse-detail');
      const json = await res.json();
      expect(json.data.url).toBe('http://localhost:3000/sse');
      expect(json.data.command).toBeNull();
    });

    test('does not include tools or resources arrays (unlike list)', async () => {
      insertServer({ name: 'no-extras' });

      const res = await app.request('/servers/no-extras');
      const json = await res.json();
      // The detail endpoint does not add tools/resources
      expect(json.data.tools).toBeUndefined();
      expect(json.data.resources).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------
  // DELETE /servers/:name — Remove MCP server
  // ---------------------------------------------------------------
  describe('DELETE /servers/:name — remove server', () => {
    test('deletes an existing server', async () => {
      insertServer({ name: 'to-delete' });

      const res = await app.request('/servers/to-delete', { method: 'DELETE' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);

      const row = testDb.query('SELECT * FROM mcp_servers WHERE name = ?').get('to-delete');
      expect(row).toBeNull();
    });

    test('returns ok even when server does not exist', async () => {
      const res = await app.request('/servers/ghost', { method: 'DELETE' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
    });

    test('only deletes the targeted server', async () => {
      insertServer({ name: 'keep-me' });
      insertServer({ name: 'delete-me' });

      await app.request('/servers/delete-me', { method: 'DELETE' });

      const remaining = testDb.query('SELECT * FROM mcp_servers').all();
      expect(remaining).toHaveLength(1);
      expect((remaining[0] as any).name).toBe('keep-me');
    });

    test('deleted server no longer appears in list', async () => {
      insertServer({ name: 'ephemeral' });
      await app.request('/servers/ephemeral', { method: 'DELETE' });

      const res = await app.request('/servers');
      const json = await res.json();
      expect(json.data).toHaveLength(0);
    });

    test('deleted server returns 404 on get', async () => {
      insertServer({ name: 'gone' });
      await app.request('/servers/gone', { method: 'DELETE' });

      const res = await app.request('/servers/gone');
      expect(res.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------
  // GET /discover — Discover MCP servers
  // ---------------------------------------------------------------
  describe('GET /discover — discover MCP servers', () => {
    test('returns ok with data array', async () => {
      const res = await app.request('/discover');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
    });
  });

  // ---------------------------------------------------------------
  // POST /import — Bulk import MCP servers
  // ---------------------------------------------------------------
  describe('POST /import — bulk import servers', () => {
    test('returns 400 when servers array is empty', async () => {
      const res = await app.request('/import', {
        method: 'POST',
        body: JSON.stringify({ servers: [] }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('No servers provided');
    });

    test('returns 400 when servers is not an array', async () => {
      const res = await app.request('/import', {
        method: 'POST',
        body: JSON.stringify({ servers: 'not-array' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
    });

    test('returns 400 when servers key is missing', async () => {
      const res = await app.request('/import', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
    });

    test('imports a single server', async () => {
      const res = await app.request('/import', {
        method: 'POST',
        body: JSON.stringify({
          servers: [
            { name: 'imported-server', transport: 'stdio', command: 'npx', args: ['server-pkg'] },
          ],
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.imported).toBe(1);

      const row = testDb
        .query('SELECT * FROM mcp_servers WHERE name = ?')
        .get('imported-server') as any;
      expect(row).toBeDefined();
      expect(row.transport).toBe('stdio');
      expect(row.command).toBe('npx');
      expect(JSON.parse(row.args)).toEqual(['server-pkg']);
      expect(row.scope).toBe('local');
      expect(row.status).toBe('disconnected');
    });

    test('imports multiple servers', async () => {
      const res = await app.request('/import', {
        method: 'POST',
        body: JSON.stringify({
          servers: [
            { name: 'server-a', transport: 'stdio', command: 'node' },
            { name: 'server-b', transport: 'sse', url: 'http://localhost:9090' },
          ],
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await res.json();
      expect(json.data.imported).toBe(2);

      const all = testDb.query('SELECT * FROM mcp_servers').all();
      expect(all).toHaveLength(2);
    });

    test('skips servers without name', async () => {
      const res = await app.request('/import', {
        method: 'POST',
        body: JSON.stringify({
          servers: [
            { name: '', transport: 'stdio', command: 'node' },
            { name: 'valid-server', transport: 'stdio', command: 'node' },
          ],
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await res.json();
      // The server without name is skipped but imported count still increments
      // because the continue check is !server.name (empty string is falsy)
      expect(json.data.imported).toBe(1);
    });

    test('ignores duplicate servers (INSERT OR IGNORE)', async () => {
      insertServer({ name: 'existing-server' });

      const res = await app.request('/import', {
        method: 'POST',
        body: JSON.stringify({
          servers: [
            { name: 'existing-server', transport: 'stdio', command: 'different-command' },
            { name: 'new-server', transport: 'stdio', command: 'npx' },
          ],
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await res.json();
      expect(json.data.imported).toBe(2);

      // The existing server should NOT be overwritten
      const existing = testDb
        .query('SELECT command FROM mcp_servers WHERE name = ?')
        .get('existing-server') as any;
      expect(existing.command).toBe('npx'); // Original command, not 'different-command'
    });

    test('stores env variables for imported servers', async () => {
      await app.request('/import', {
        method: 'POST',
        body: JSON.stringify({
          servers: [
            {
              name: 'env-server',
              transport: 'stdio',
              command: 'node',
              env: { API_KEY: 'test-key', DEBUG: 'true' },
            },
          ],
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const row = testDb
        .query('SELECT env FROM mcp_servers WHERE name = ?')
        .get('env-server') as any;
      expect(JSON.parse(row.env)).toEqual({ API_KEY: 'test-key', DEBUG: 'true' });
    });

    test('handles null optional fields during import', async () => {
      await app.request('/import', {
        method: 'POST',
        body: JSON.stringify({
          servers: [{ name: 'minimal-import', transport: 'sse', url: 'http://remote/sse' }],
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const row = testDb
        .query('SELECT * FROM mcp_servers WHERE name = ?')
        .get('minimal-import') as any;
      expect(row.command).toBeNull();
      expect(row.args).toBeNull();
      expect(row.env).toBeNull();
      expect(row.url).toBe('http://remote/sse');
    });

    test('imported servers appear in server list', async () => {
      await app.request('/import', {
        method: 'POST',
        body: JSON.stringify({
          servers: [{ name: 'listed-server', transport: 'stdio', command: 'npx' }],
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await app.request('/servers');
      const json = await res.json();
      expect(json.data.some((s: any) => s.name === 'listed-server')).toBe(true);
    });

    test('defaults transport to stdio when not provided', async () => {
      await app.request('/import', {
        method: 'POST',
        body: JSON.stringify({
          servers: [{ name: 'default-transport', command: 'node' }],
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const row = testDb
        .query('SELECT transport FROM mcp_servers WHERE name = ?')
        .get('default-transport') as any;
      expect(row.transport).toBe('stdio');
    });
  });
});
