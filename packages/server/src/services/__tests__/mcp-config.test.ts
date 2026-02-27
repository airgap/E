import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { createTestDb } from '../../test-helpers';

const testDb = createTestDb();
mock.module('../../db/database', () => ({
  getDb: () => testDb,
  initDatabase: () => {},
}));

// Mock node:fs (used by mcp-config.ts) to capture file writes.
// Using 'node:fs' avoids contaminating the bare 'fs' specifier used by other modules.
let writtenPath = '';
let writtenContent = '';
mock.module('node:fs', () => ({
  writeFileSync: (path: string, content: string) => {
    writtenPath = path;
    writtenContent = content;
  },
  mkdirSync: () => {},
  // Passthrough for functions used by other modules that import from node:fs
  existsSync: (path: string) => false,
  readFileSync: (path: string) => {
    throw new Error(`ENOENT: no such file or directory, open '${path}'`);
  },
  readdirSync: (path: string) => {
    throw new Error(`ENOENT: no such file or directory, scandir '${path}'`);
  },
}));

import { generateMcpConfig } from '../mcp-config';

function clearServers() {
  testDb.exec('DELETE FROM mcp_servers');
}

function insertServer(overrides: Record<string, any> = {}) {
  const defaults = {
    name: 'test-server',
    transport: 'stdio',
    command: 'node',
    args: JSON.stringify(['server.js']),
    url: null,
    env: JSON.stringify({}),
    scope: 'project',
    status: 'disconnected',
  };
  const row = { ...defaults, ...overrides };
  testDb
    .query(
      'INSERT INTO mcp_servers (name, transport, command, args, url, env, scope, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(row.name, row.transport, row.command, row.args, row.url, row.env, row.scope, row.status);
}

describe('generateMcpConfig', () => {
  beforeEach(() => {
    clearServers();
    writtenPath = '';
    writtenContent = '';
  });

  test('returns config path even when no user servers exist (built-in ask-user always included)', () => {
    const result = generateMcpConfig();
    expect(result).toContain('mcp-config.json');
    const config = JSON.parse(writtenContent);
    expect(Object.keys(config.mcpServers)).toHaveLength(1);
    expect(config.mcpServers['e-ask-user']).toBeDefined();
  });

  test('generates config for stdio server', () => {
    insertServer({
      name: 'my-server',
      transport: 'stdio',
      command: 'node',
      args: JSON.stringify(['index.js', '--flag']),
    });

    const result = generateMcpConfig();
    expect(result).toBeTruthy();

    const config = JSON.parse(writtenContent);
    expect(config.mcpServers['my-server']).toBeDefined();
    expect(config.mcpServers['my-server'].command).toBe('node');
    expect(config.mcpServers['my-server'].args).toEqual(['index.js', '--flag']);
  });

  test('generates config for SSE server', () => {
    insertServer({
      name: 'sse-server',
      transport: 'sse',
      command: null,
      args: null,
      url: 'http://localhost:8080/sse',
    });

    generateMcpConfig();
    const config = JSON.parse(writtenContent);
    expect(config.mcpServers['sse-server'].url).toBe('http://localhost:8080/sse');
    expect(config.mcpServers['sse-server'].type).toBe('sse');
  });

  test('generates config for HTTP server', () => {
    insertServer({
      name: 'http-server',
      transport: 'http',
      command: null,
      args: null,
      url: 'http://localhost:9090/api',
    });

    generateMcpConfig();
    const config = JSON.parse(writtenContent);
    expect(config.mcpServers['http-server'].url).toBe('http://localhost:9090/api');
    expect(config.mcpServers['http-server'].type).toBe('http');
  });

  test('includes env vars', () => {
    insertServer({
      name: 'env-server',
      env: JSON.stringify({ API_KEY: 'secret', DEBUG: 'true' }),
    });

    generateMcpConfig();
    const config = JSON.parse(writtenContent);
    expect(config.mcpServers['env-server'].env).toEqual({ API_KEY: 'secret', DEBUG: 'true' });
  });

  test('handles invalid JSON in args gracefully', () => {
    insertServer({
      name: 'bad-args',
      args: 'not json',
    });

    generateMcpConfig();
    const config = JSON.parse(writtenContent);
    expect(config.mcpServers['bad-args'].args).toEqual([]);
  });

  test('handles invalid JSON in env gracefully', () => {
    insertServer({
      name: 'bad-env',
      env: '{bad json}',
    });

    generateMcpConfig();
    const config = JSON.parse(writtenContent);
    expect(config.mcpServers['bad-env'].env).toBeUndefined();
  });

  test('generates config for multiple servers', () => {
    insertServer({ name: 'server-a', transport: 'stdio', command: 'python' });
    insertServer({
      name: 'server-b',
      transport: 'sse',
      command: null,
      url: 'http://localhost:3000',
    });

    generateMcpConfig();
    const config = JSON.parse(writtenContent);
    expect(Object.keys(config.mcpServers)).toHaveLength(3); // 2 user servers + e-ask-user
    expect(config.mcpServers['server-a']).toBeDefined();
    expect(config.mcpServers['server-b']).toBeDefined();
    expect(config.mcpServers['e-ask-user']).toBeDefined();
  });

  test('returns config file path', () => {
    insertServer({ name: 'test' });
    const result = generateMcpConfig();
    expect(result).toContain('.e');
    expect(result).toContain('mcp-config.json');
  });

  test('writes formatted JSON', () => {
    insertServer({ name: 'test' });
    generateMcpConfig();
    expect(writtenContent).toContain('\n');
  });
});
