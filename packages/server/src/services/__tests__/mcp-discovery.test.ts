import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { homedir } from 'os';
import { join } from 'path';

// Track what the mocked fs functions return
let existsSyncResults: Record<string, boolean> = {};
let readFileSyncResults: Record<string, string> = {};
let readdirSyncResults: Record<string, string[]> = {};

mock.module('node:fs', () => ({
  existsSync: (path: string) => existsSyncResults[path] ?? false,
  readFileSync: (path: string, _encoding?: string) => {
    if (readFileSyncResults[path] !== undefined) return readFileSyncResults[path];
    throw new Error(`ENOENT: no such file or directory, open '${path}'`);
  },
  readdirSync: (path: string) => {
    if (readdirSyncResults[path] !== undefined) return readdirSyncResults[path];
    throw new Error(`ENOENT: no such file or directory, scandir '${path}'`);
  },
}));

import { discoverMcpConfigs } from '../mcp-discovery';

const home = homedir();

function resetMocks() {
  existsSyncResults = {};
  readFileSyncResults = {};
  readdirSyncResults = {};
}

function setConfigFile(path: string, data: any) {
  existsSyncResults[path] = true;
  readFileSyncResults[path] = JSON.stringify(data);
}

describe('discoverMcpConfigs', () => {
  beforeEach(() => {
    resetMocks();
  });

  test('returns empty array when no config files exist', () => {
    const results = discoverMcpConfigs();
    expect(results).toEqual([]);
  });

  test('discovers Claude Desktop config (Linux path)', () => {
    const configPath = join(home, '.config', 'Claude', 'claude_desktop_config.json');
    setConfigFile(configPath, {
      mcpServers: {
        'my-server': {
          command: 'node',
          args: ['server.js'],
        },
      },
    });

    const results = discoverMcpConfigs();
    const claudeDesktop = results.find((r) => r.source === 'Claude Desktop');
    expect(claudeDesktop).toBeDefined();
    expect(claudeDesktop!.configPath).toBe(configPath);
    expect(claudeDesktop!.servers).toHaveLength(1);
    expect(claudeDesktop!.servers[0].name).toBe('my-server');
    expect(claudeDesktop!.servers[0].command).toBe('node');
    expect(claudeDesktop!.servers[0].args).toEqual(['server.js']);
    expect(claudeDesktop!.servers[0].transport).toBe('stdio');
  });

  test('discovers Claude Desktop config (macOS path)', () => {
    const configPath = join(
      home,
      'Library',
      'Application Support',
      'Claude',
      'claude_desktop_config.json',
    );
    setConfigFile(configPath, {
      mcpServers: {
        mac_server: { command: 'python3', args: ['main.py'] },
      },
    });

    const results = discoverMcpConfigs();
    const claudeDesktop = results.find(
      (r) => r.source === 'Claude Desktop' && r.configPath === configPath,
    );
    expect(claudeDesktop).toBeDefined();
    expect(claudeDesktop!.servers[0].name).toBe('mac_server');
  });

  test('discovers Claude Code configs', () => {
    const settingsPath = join(home, '.claude', 'settings.json');
    setConfigFile(settingsPath, {
      mcpServers: {
        'code-server': { command: 'npx', args: ['my-mcp'] },
      },
    });

    const results = discoverMcpConfigs();
    const claudeCode = results.find((r) => r.source === 'Claude Code');
    expect(claudeCode).toBeDefined();
    expect(claudeCode!.servers[0].name).toBe('code-server');
    expect(claudeCode!.servers[0].transport).toBe('stdio');
  });

  test('discovers Claude Code settings.local.json', () => {
    const localPath = join(home, '.claude', 'settings.local.json');
    setConfigFile(localPath, {
      mcpServers: {
        'local-server': { command: 'deno', args: ['run', 'server.ts'] },
      },
    });

    const results = discoverMcpConfigs();
    const match = results.find((r) => r.source === 'Claude Code' && r.configPath === localPath);
    expect(match).toBeDefined();
    expect(match!.servers[0].name).toBe('local-server');
  });

  test('discovers Cursor config', () => {
    const configPath = join(home, '.cursor', 'mcp.json');
    setConfigFile(configPath, {
      mcpServers: {
        'cursor-server': { command: 'node', args: ['cursor-mcp.js'] },
      },
    });

    const results = discoverMcpConfigs();
    const cursor = results.find((r) => r.source === 'Cursor');
    expect(cursor).toBeDefined();
    expect(cursor!.servers[0].name).toBe('cursor-server');
  });

  test('discovers Gemini config', () => {
    const configPath = join(home, '.gemini', 'settings.json');
    setConfigFile(configPath, {
      mcpServers: {
        'gemini-server': { command: 'python', args: ['-m', 'mcp_server'] },
      },
    });

    const results = discoverMcpConfigs();
    const gemini = results.find((r) => r.source === 'Gemini');
    expect(gemini).toBeDefined();
    expect(gemini!.servers[0].name).toBe('gemini-server');
  });

  test('discovers Windsurf config', () => {
    const configPath = join(home, '.codeium', 'windsurf', 'mcp_config.json');
    setConfigFile(configPath, {
      mcpServers: {
        'windsurf-server': { command: 'node', args: ['ws.js'] },
      },
    });

    const results = discoverMcpConfigs();
    const windsurf = results.find((r) => r.source === 'Windsurf');
    expect(windsurf).toBeDefined();
    expect(windsurf!.servers[0].name).toBe('windsurf-server');
  });

  // ── Transport inference ──

  test('infers stdio transport for command-based server', () => {
    const configPath = join(home, '.cursor', 'mcp.json');
    setConfigFile(configPath, {
      mcpServers: {
        stdio: { command: 'node', args: ['index.js'] },
      },
    });

    const results = discoverMcpConfigs();
    expect(results[0].servers[0].transport).toBe('stdio');
  });

  test('infers sse transport when type is sse', () => {
    const configPath = join(home, '.cursor', 'mcp.json');
    setConfigFile(configPath, {
      mcpServers: {
        'sse-server': { type: 'sse', url: 'http://localhost:3000/sse' },
      },
    });

    const results = discoverMcpConfigs();
    expect(results[0].servers[0].transport).toBe('sse');
  });

  test('infers http transport when type is http', () => {
    const configPath = join(home, '.cursor', 'mcp.json');
    setConfigFile(configPath, {
      mcpServers: {
        'http-server': { type: 'http', url: 'http://localhost:3000/api' },
      },
    });

    const results = discoverMcpConfigs();
    expect(results[0].servers[0].transport).toBe('http');
  });

  test('infers sse transport from url containing /sse', () => {
    const configPath = join(home, '.cursor', 'mcp.json');
    setConfigFile(configPath, {
      mcpServers: {
        'url-sse': { url: 'http://localhost:8080/sse' },
      },
    });

    const results = discoverMcpConfigs();
    expect(results[0].servers[0].transport).toBe('sse');
  });

  test('infers http transport from url without /sse', () => {
    const configPath = join(home, '.cursor', 'mcp.json');
    setConfigFile(configPath, {
      mcpServers: {
        'url-http': { url: 'http://localhost:8080/api' },
      },
    });

    const results = discoverMcpConfigs();
    expect(results[0].servers[0].transport).toBe('http');
  });

  test('defaults to stdio transport when no type or url', () => {
    const configPath = join(home, '.cursor', 'mcp.json');
    setConfigFile(configPath, {
      mcpServers: {
        basic: { command: 'my-binary' },
      },
    });

    const results = discoverMcpConfigs();
    expect(results[0].servers[0].transport).toBe('stdio');
  });

  // ── Server property parsing ──

  test('parses server with all properties', () => {
    const configPath = join(home, '.cursor', 'mcp.json');
    setConfigFile(configPath, {
      mcpServers: {
        full: {
          command: 'node',
          args: ['server.js', '--port', '3000'],
          url: 'http://localhost:3000',
          env: { API_KEY: 'secret', DEBUG: '1' },
        },
      },
    });

    const results = discoverMcpConfigs();
    const server = results[0].servers[0];
    expect(server.name).toBe('full');
    expect(server.command).toBe('node');
    expect(server.args).toEqual(['server.js', '--port', '3000']);
    expect(server.url).toBe('http://localhost:3000');
    expect(server.env).toEqual({ API_KEY: 'secret', DEBUG: '1' });
  });

  test('sets undefined for missing optional properties', () => {
    const configPath = join(home, '.cursor', 'mcp.json');
    setConfigFile(configPath, {
      mcpServers: {
        minimal: {},
      },
    });

    const results = discoverMcpConfigs();
    const server = results[0].servers[0];
    expect(server.command).toBeUndefined();
    expect(server.args).toBeUndefined();
    expect(server.url).toBeUndefined();
    expect(server.env).toBeUndefined();
  });

  test('ignores non-array args', () => {
    const configPath = join(home, '.cursor', 'mcp.json');
    setConfigFile(configPath, {
      mcpServers: {
        'bad-args': { command: 'node', args: 'not-an-array' },
      },
    });

    const results = discoverMcpConfigs();
    expect(results[0].servers[0].args).toBeUndefined();
  });

  test('ignores non-object env', () => {
    const configPath = join(home, '.cursor', 'mcp.json');
    setConfigFile(configPath, {
      mcpServers: {
        'bad-env': { command: 'node', env: 'not-an-object' },
      },
    });

    const results = discoverMcpConfigs();
    expect(results[0].servers[0].env).toBeUndefined();
  });

  // ── Multiple servers in one config ──

  test('discovers multiple servers from a single config', () => {
    const configPath = join(home, '.config', 'Claude', 'claude_desktop_config.json');
    setConfigFile(configPath, {
      mcpServers: {
        'server-a': { command: 'node', args: ['a.js'] },
        'server-b': { command: 'python', args: ['b.py'] },
        'server-c': { url: 'http://localhost:9090/sse' },
      },
    });

    const results = discoverMcpConfigs();
    const source = results.find((r) => r.source === 'Claude Desktop');
    expect(source).toBeDefined();
    expect(source!.servers).toHaveLength(3);
    const names = source!.servers.map((s) => s.name);
    expect(names).toContain('server-a');
    expect(names).toContain('server-b');
    expect(names).toContain('server-c');
  });

  // ── Edge cases: invalid data ──

  test('skips config with no mcpServers key', () => {
    const configPath = join(home, '.cursor', 'mcp.json');
    setConfigFile(configPath, { someOtherKey: 'value' });

    const results = discoverMcpConfigs();
    expect(results).toEqual([]);
  });

  test('skips config where mcpServers is not an object', () => {
    const configPath = join(home, '.cursor', 'mcp.json');
    setConfigFile(configPath, { mcpServers: 'not-an-object' });

    const results = discoverMcpConfigs();
    expect(results).toEqual([]);
  });

  test('skips config where mcpServers is null', () => {
    const configPath = join(home, '.cursor', 'mcp.json');
    setConfigFile(configPath, { mcpServers: null });

    const results = discoverMcpConfigs();
    expect(results).toEqual([]);
  });

  test('skips server entries that are not objects', () => {
    const configPath = join(home, '.cursor', 'mcp.json');
    setConfigFile(configPath, {
      mcpServers: {
        good: { command: 'node' },
        bad: null,
        worse: 'string',
        terrible: 42,
      },
    });

    const results = discoverMcpConfigs();
    expect(results[0].servers).toHaveLength(1);
    expect(results[0].servers[0].name).toBe('good');
  });

  test('handles invalid JSON in config file gracefully', () => {
    const configPath = join(home, '.cursor', 'mcp.json');
    existsSyncResults[configPath] = true;
    readFileSyncResults[configPath] = '{ invalid json !!!';

    const results = discoverMcpConfigs();
    expect(results).toEqual([]);
  });

  // ── VS Code scanning ──

  test('discovers VS Code user settings', () => {
    const settingsPath = join(home, '.config', 'Code', 'User', 'settings.json');
    setConfigFile(settingsPath, {
      mcpServers: {
        'vscode-server': { command: 'node', args: ['vsc.js'] },
      },
    });

    const results = discoverMcpConfigs();
    const vscode = results.find((r) => r.source === 'VS Code');
    expect(vscode).toBeDefined();
    expect(vscode!.configPath).toBe(settingsPath);
    expect(vscode!.servers[0].name).toBe('vscode-server');
  });

  test('discovers VS Code workspace storage configs', () => {
    const storagePath = join(home, '.config', 'Code', 'User', 'workspaceStorage');
    existsSyncResults[storagePath] = true;
    readdirSyncResults[storagePath] = ['workspace-abc123'];

    const mcpPath = join(storagePath, 'workspace-abc123', 'mcp', 'mcp-servers.json');
    setConfigFile(mcpPath, {
      mcpServers: {
        'ws-server': { command: 'node', args: ['workspace.js'] },
      },
    });

    const results = discoverMcpConfigs();
    const vscode = results.find((r) => r.source === 'VS Code' && r.configPath === mcpPath);
    expect(vscode).toBeDefined();
    expect(vscode!.servers[0].name).toBe('ws-server');
  });

  test('scans multiple VS Code workspace directories', () => {
    const storagePath = join(home, '.config', 'Code', 'User', 'workspaceStorage');
    existsSyncResults[storagePath] = true;
    readdirSyncResults[storagePath] = ['ws-1', 'ws-2'];

    const mcpPath1 = join(storagePath, 'ws-1', 'mcp', 'mcp-servers.json');
    const mcpPath2 = join(storagePath, 'ws-2', 'mcp', 'mcp-servers.json');

    setConfigFile(mcpPath1, {
      mcpServers: { 'server-1': { command: 'cmd1' } },
    });
    setConfigFile(mcpPath2, {
      mcpServers: { 'server-2': { command: 'cmd2' } },
    });

    const results = discoverMcpConfigs();
    const vscodeResults = results.filter((r) => r.source === 'VS Code');
    expect(vscodeResults).toHaveLength(2);
  });

  test('skips VS Code workspace dirs with no mcp config', () => {
    const storagePath = join(home, '.config', 'Code', 'User', 'workspaceStorage');
    existsSyncResults[storagePath] = true;
    readdirSyncResults[storagePath] = ['ws-empty'];
    // No config file for ws-empty

    const results = discoverMcpConfigs();
    const vscodeResults = results.filter((r) => r.source === 'VS Code');
    expect(vscodeResults).toHaveLength(0);
  });

  // ── Multiple sources at once ──

  test('discovers from multiple sources simultaneously', () => {
    // Claude Desktop
    const claudeDesktopPath = join(home, '.config', 'Claude', 'claude_desktop_config.json');
    setConfigFile(claudeDesktopPath, {
      mcpServers: { desktop: { command: 'node' } },
    });

    // Cursor
    const cursorPath = join(home, '.cursor', 'mcp.json');
    setConfigFile(cursorPath, {
      mcpServers: { cursor: { command: 'python' } },
    });

    // Gemini
    const geminiPath = join(home, '.gemini', 'settings.json');
    setConfigFile(geminiPath, {
      mcpServers: { gemini: { command: 'deno' } },
    });

    const results = discoverMcpConfigs();
    const sources = results.map((r) => r.source);
    expect(sources).toContain('Claude Desktop');
    expect(sources).toContain('Cursor');
    expect(sources).toContain('Gemini');
  });
});
