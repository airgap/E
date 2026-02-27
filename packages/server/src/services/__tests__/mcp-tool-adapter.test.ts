import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { EventEmitter } from 'events';
import { createTestDb } from '../../test-helpers';

const testDb = createTestDb();
mock.module('../../db/database', () => ({
  getDb: () => testDb,
  initDatabase: () => {},
}));

// Configurable mock for child_process.spawn
type MockProc = {
  stdin: { write: (data: string) => void; end: () => void };
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: () => void;
} & EventEmitter;

let spawnMockFn: ((cmd: string, args: string[], opts: any) => MockProc) | null = null;

function createMockProc(): MockProc {
  const emitter = new EventEmitter() as MockProc;
  emitter.stdin = {
    write: () => {},
    end: () => {},
  };
  emitter.stdout = new EventEmitter();
  emitter.stderr = new EventEmitter();
  emitter.kill = () => {};
  return emitter;
}

mock.module('child_process', () => ({
  spawn: (cmd: string, args: string[], opts: any) => {
    if (spawnMockFn) return spawnMockFn(cmd, args, opts);
    return createMockProc();
  },
}));

import { getDb } from '../../db/database';
import {
  getMcpServers,
  isMcpTool,
  mcpToolsToSchemas,
  clearMcpToolCache,
  discoverAllMcpTools,
  getCachedMcpTools,
  executeMcpTool,
  type MCPServerConfig,
  type MCPToolInfo,
} from '../mcp-tool-adapter';

describe('MCP Tool Adapter', () => {
  let db: any;

  beforeEach(() => {
    db = testDb;
    // Clean up any existing MCP servers
    db.query('DELETE FROM mcp_servers').run();
    spawnMockFn = null;
  });

  afterEach(() => {
    clearMcpToolCache();
  });

  describe('getMcpServers', () => {
    it('should return empty array when no servers configured', () => {
      const servers = getMcpServers();
      expect(servers).toEqual([]);
    });

    it('should return configured MCP servers', () => {
      // Insert test server
      db.query(
        `
        INSERT INTO mcp_servers (name, transport, command, args, env)
        VALUES (?, ?, ?, ?, ?)
      `,
      ).run(
        'test-filesystem',
        'stdio',
        'echo',
        JSON.stringify(['test']),
        JSON.stringify({ TEST_ENV: 'value' }),
      );

      const servers = getMcpServers();
      expect(servers).toHaveLength(1);
      expect(servers[0]).toMatchObject({
        name: 'test-filesystem',
        transport: 'stdio',
        command: 'echo',
        args: ['test'],
        env: { TEST_ENV: 'value' },
      });
    });

    it('should handle multiple servers', () => {
      db.query(
        `
        INSERT INTO mcp_servers (name, transport, command)
        VALUES ('filesystem', 'stdio', 'npx')
      `,
      ).run();

      db.query(
        `
        INSERT INTO mcp_servers (name, transport, command)
        VALUES ('database', 'stdio', 'npx')
      `,
      ).run();

      const servers = getMcpServers();
      expect(servers).toHaveLength(2);
      expect(servers.map((s) => s.name)).toContain('filesystem');
      expect(servers.map((s) => s.name)).toContain('database');
    });
  });

  describe('isMcpTool', () => {
    it('should return true for MCP tool names', () => {
      expect(isMcpTool('mcp__filesystem__read_file')).toBe(true);
      expect(isMcpTool('mcp__database__query')).toBe(true);
      expect(isMcpTool('mcp__github__create_issue')).toBe(true);
    });

    it('should return false for built-in tool names', () => {
      expect(isMcpTool('Read')).toBe(false);
      expect(isMcpTool('Write')).toBe(false);
      expect(isMcpTool('Bash')).toBe(false);
    });

    it('should return false for invalid names', () => {
      expect(isMcpTool('')).toBe(false);
      expect(isMcpTool('mcp_invalid')).toBe(false);
      expect(isMcpTool('custom_tool')).toBe(false);
    });
  });

  describe('mcpToolsToSchemas', () => {
    it('should convert MCP tools to Anthropic schema format', () => {
      const mcpTools: MCPToolInfo[] = [
        {
          serverName: 'filesystem',
          toolName: 'read_file',
          fullName: 'mcp__filesystem__read_file',
          description: 'Read a file from the filesystem',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'File path' },
            },
            required: ['path'],
          },
          isDangerous: false,
        },
        {
          serverName: 'database',
          toolName: 'execute_query',
          fullName: 'mcp__database__execute_query',
          description: 'Execute SQL query',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'SQL query' },
            },
            required: ['query'],
          },
          isDangerous: true,
        },
      ];

      const schemas = mcpToolsToSchemas(mcpTools);

      expect(schemas).toHaveLength(2);

      expect(schemas[0]).toMatchObject({
        name: 'mcp__filesystem__read_file',
        description: 'Read a file from the filesystem',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path' },
          },
          required: ['path'],
        },
      });

      expect(schemas[1]).toMatchObject({
        name: 'mcp__database__execute_query',
        description: 'Execute SQL query',
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'SQL query' },
          },
          required: ['query'],
        },
      });
    });

    it('should provide default schema when inputSchema is missing', () => {
      const mcpTools: MCPToolInfo[] = [
        {
          serverName: 'test',
          toolName: 'simple_tool',
          fullName: 'mcp__test__simple_tool',
          description: 'A simple tool',
          inputSchema: undefined as any,
          isDangerous: false,
        },
      ];

      const schemas = mcpToolsToSchemas(mcpTools);

      expect(schemas[0].input_schema).toEqual({
        type: 'object',
        properties: {},
        required: [],
      });
    });

    it('should use fallback description when description is missing', () => {
      const mcpTools: MCPToolInfo[] = [
        {
          serverName: 'test',
          toolName: 'unnamed_tool',
          fullName: 'mcp__test__unnamed_tool',
          description: '',
          inputSchema: { type: 'object', properties: {}, required: [] },
          isDangerous: false,
        },
      ];

      const schemas = mcpToolsToSchemas(mcpTools);

      expect(schemas[0].description).toBe('unnamed_tool from test');
    });
  });

  describe('clearMcpToolCache', () => {
    it('should clear the tool cache', () => {
      // This is a simple test to ensure the function doesn't throw
      expect(() => clearMcpToolCache()).not.toThrow();
    });
  });

  describe('Tool naming format', () => {
    it('should follow mcp__server__tool convention', () => {
      const toolInfo: MCPToolInfo = {
        serverName: 'my-server',
        toolName: 'my_tool',
        fullName: 'mcp__my-server__my_tool',
        description: 'Test tool',
        inputSchema: { type: 'object', properties: {}, required: [] },
        isDangerous: false,
      };

      expect(toolInfo.fullName).toMatch(/^mcp__[^_]+__.+$/);
      expect(isMcpTool(toolInfo.fullName)).toBe(true);
    });
  });

  describe('Integration with tool-schemas', () => {
    it('should integrate with getFilteredTools pattern', async () => {
      // This tests that MCP tools can be filtered like built-in tools
      const mcpTools: MCPToolInfo[] = [
        {
          serverName: 'test',
          toolName: 'tool1',
          fullName: 'mcp__test__tool1',
          description: 'Tool 1',
          inputSchema: { type: 'object', properties: {}, required: [] },
          isDangerous: false,
        },
        {
          serverName: 'test',
          toolName: 'tool2',
          fullName: 'mcp__test__tool2',
          description: 'Tool 2',
          inputSchema: { type: 'object', properties: {}, required: [] },
          isDangerous: true,
        },
      ];

      let schemas = mcpToolsToSchemas(mcpTools);

      // Test allowed tools filter
      const allowedTools = ['mcp__test__tool1'];
      schemas = schemas.filter((s) => allowedTools.includes(s.name));
      expect(schemas).toHaveLength(1);
      expect(schemas[0].name).toBe('mcp__test__tool1');

      // Test disallowed tools filter
      schemas = mcpToolsToSchemas(mcpTools);
      const disallowedTools = ['mcp__test__tool2'];
      schemas = schemas.filter((s) => !disallowedTools.includes(s.name));
      expect(schemas).toHaveLength(1);
      expect(schemas[0].name).toBe('mcp__test__tool1');
    });
  });

  describe('Server configuration validation', () => {
    it('should handle servers with minimal config', () => {
      db.query(
        `
        INSERT INTO mcp_servers (name, transport, command)
        VALUES (?, ?, ?)
      `,
      ).run('minimal-server', 'stdio', 'echo');

      const servers = getMcpServers();
      const server = servers.find((s) => s.name === 'minimal-server')!;
      expect(server).toBeDefined();
      expect(server.name).toBe('minimal-server');
      expect(server.transport).toBe('stdio');
      expect(server.command).toBe('echo');
    });

    it('should handle servers with full config', () => {
      db.query(
        `
        INSERT INTO mcp_servers (name, transport, command, args, env, url)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      ).run(
        'full-server',
        'stdio',
        'npx',
        JSON.stringify(['-y', '@modelcontextprotocol/server-filesystem', '/tmp']),
        JSON.stringify({ NODE_ENV: 'production', DEBUG: 'mcp:*' }),
        null,
      );

      const servers = getMcpServers();
      expect(servers[0]).toMatchObject({
        name: 'full-server',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
        env: { NODE_ENV: 'production', DEBUG: 'mcp:*' },
      });
    });
  });

  describe('discoverAllMcpTools', () => {
    it('should return empty array when no servers configured', async () => {
      const tools = await discoverAllMcpTools();
      expect(tools).toEqual([]);
    });

    it('should skip non-stdio servers', async () => {
      db.query(
        `INSERT INTO mcp_servers (name, transport, url)
         VALUES (?, ?, ?)`,
      ).run('sse-server', 'sse', 'http://localhost:3000/sse');

      const tools = await discoverAllMcpTools();
      expect(tools).toEqual([]);
    });

    it('should skip servers without a command', async () => {
      db.query(
        `INSERT INTO mcp_servers (name, transport)
         VALUES (?, ?)`,
      ).run('no-command-server', 'stdio');

      const tools = await discoverAllMcpTools();
      expect(tools).toEqual([]);
    });

    it('should discover tools from a mocked MCP server process', async () => {
      db.query(
        `INSERT INTO mcp_servers (name, transport, command, args)
         VALUES (?, ?, ?, ?)`,
      ).run('test-server', 'stdio', 'node', JSON.stringify(['server.js']));

      spawnMockFn = () => {
        const proc = createMockProc();

        // Simulate MCP server response after a short delay
        setTimeout(() => {
          // Send initialize response
          const initResponse = JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: { name: 'test-server', version: '1.0.0' },
            },
          });
          proc.stdout.emit('data', Buffer.from(initResponse + '\n'));

          // Send tools/list response
          const toolsResponse = JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            result: {
              tools: [
                {
                  name: 'read_file',
                  description: 'Read a file',
                  inputSchema: {
                    type: 'object',
                    properties: { path: { type: 'string' } },
                    required: ['path'],
                  },
                },
                {
                  name: 'write_file',
                  description: 'Write a file',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      path: { type: 'string' },
                      content: { type: 'string' },
                    },
                    required: ['path', 'content'],
                  },
                },
              ],
            },
          });
          proc.stdout.emit('data', Buffer.from(toolsResponse + '\n'));

          // Simulate process close
          setTimeout(() => proc.emit('close'), 50);
        }, 150);

        return proc;
      };

      const tools = await discoverAllMcpTools();
      expect(tools).toHaveLength(2);
      expect(tools[0].serverName).toBe('test-server');
      expect(tools[0].toolName).toBe('read_file');
      expect(tools[0].fullName).toBe('mcp__test-server__read_file');
      expect(tools[0].description).toBe('Read a file');
      expect(tools[0].inputSchema).toEqual({
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      });
      expect(tools[1].toolName).toBe('write_file');
      expect(tools[1].fullName).toBe('mcp__test-server__write_file');
    });

    it('should discover tools from multiple servers', async () => {
      db.query(
        `INSERT INTO mcp_servers (name, transport, command)
         VALUES (?, ?, ?)`,
      ).run('server-a', 'stdio', 'node');

      db.query(
        `INSERT INTO mcp_servers (name, transport, command)
         VALUES (?, ?, ?)`,
      ).run('server-b', 'stdio', 'python');

      spawnMockFn = (cmd: string) => {
        const proc = createMockProc();
        const toolName = cmd === 'node' ? 'tool_a' : 'tool_b';
        const serverLabel = cmd === 'node' ? 'server-a' : 'server-b';

        setTimeout(() => {
          const toolsResponse = JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            result: {
              tools: [
                {
                  name: toolName,
                  description: `Tool from ${serverLabel}`,
                  inputSchema: { type: 'object', properties: {}, required: [] },
                },
              ],
            },
          });
          proc.stdout.emit('data', Buffer.from(toolsResponse + '\n'));
          setTimeout(() => proc.emit('close'), 50);
        }, 150);

        return proc;
      };

      const tools = await discoverAllMcpTools();
      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.toolName)).toContain('tool_a');
      expect(tools.map((t) => t.toolName)).toContain('tool_b');
    });

    it('should handle spawn errors gracefully', async () => {
      db.query(
        `INSERT INTO mcp_servers (name, transport, command)
         VALUES (?, ?, ?)`,
      ).run('failing-server', 'stdio', 'nonexistent-binary');

      spawnMockFn = () => {
        const proc = createMockProc();
        setTimeout(() => proc.emit('error', new Error('ENOENT: command not found')), 10);
        return proc;
      };

      const tools = await discoverAllMcpTools();
      expect(tools).toEqual([]);
    });

    it('should handle process closing with no output', async () => {
      db.query(
        `INSERT INTO mcp_servers (name, transport, command)
         VALUES (?, ?, ?)`,
      ).run('silent-server', 'stdio', 'echo');

      spawnMockFn = () => {
        const proc = createMockProc();
        setTimeout(() => proc.emit('close'), 50);
        return proc;
      };

      const tools = await discoverAllMcpTools();
      expect(tools).toEqual([]);
    });

    it('should handle invalid JSON in server output', async () => {
      db.query(
        `INSERT INTO mcp_servers (name, transport, command)
         VALUES (?, ?, ?)`,
      ).run('garbled-server', 'stdio', 'echo');

      spawnMockFn = () => {
        const proc = createMockProc();
        setTimeout(() => {
          proc.stdout.emit('data', Buffer.from('not valid json\n'));
          proc.stdout.emit('data', Buffer.from('{also invalid\n'));
          setTimeout(() => proc.emit('close'), 50);
        }, 50);
        return proc;
      };

      const tools = await discoverAllMcpTools();
      expect(tools).toEqual([]);
    });

    it('should handle response without tools array', async () => {
      db.query(
        `INSERT INTO mcp_servers (name, transport, command)
         VALUES (?, ?, ?)`,
      ).run('empty-tools-server', 'stdio', 'node');

      spawnMockFn = () => {
        const proc = createMockProc();
        setTimeout(() => {
          const response = JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            result: {},
          });
          proc.stdout.emit('data', Buffer.from(response + '\n'));
          setTimeout(() => proc.emit('close'), 50);
        }, 150);
        return proc;
      };

      const tools = await discoverAllMcpTools();
      expect(tools).toEqual([]);
    });
  });

  describe('getCachedMcpTools', () => {
    it('should return tools and cache them', async () => {
      db.query(
        `INSERT INTO mcp_servers (name, transport, command)
         VALUES (?, ?, ?)`,
      ).run('cache-server', 'stdio', 'node');

      let callCount = 0;
      spawnMockFn = () => {
        callCount++;
        const proc = createMockProc();
        setTimeout(() => {
          const toolsResponse = JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            result: {
              tools: [
                {
                  name: 'cached_tool',
                  description: 'A cacheable tool',
                  inputSchema: { type: 'object', properties: {}, required: [] },
                },
              ],
            },
          });
          proc.stdout.emit('data', Buffer.from(toolsResponse + '\n'));
          setTimeout(() => proc.emit('close'), 50);
        }, 150);
        return proc;
      };

      // First call should discover tools
      const tools1 = await getCachedMcpTools();
      expect(tools1).toHaveLength(1);
      expect(tools1[0].toolName).toBe('cached_tool');
      expect(callCount).toBe(1);

      // Second call should use cache (spawn should not be called again)
      const tools2 = await getCachedMcpTools();
      expect(tools2).toHaveLength(1);
      expect(callCount).toBe(1); // Still 1 — used cache
    });

    it('should re-discover after cache is cleared', async () => {
      db.query(
        `INSERT INTO mcp_servers (name, transport, command)
         VALUES (?, ?, ?)`,
      ).run('recache-server', 'stdio', 'node');

      let callCount = 0;
      spawnMockFn = () => {
        callCount++;
        const proc = createMockProc();
        setTimeout(() => {
          const toolsResponse = JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            result: {
              tools: [
                {
                  name: 'tool_v' + callCount,
                  description: 'Tool version ' + callCount,
                  inputSchema: { type: 'object', properties: {}, required: [] },
                },
              ],
            },
          });
          proc.stdout.emit('data', Buffer.from(toolsResponse + '\n'));
          setTimeout(() => proc.emit('close'), 50);
        }, 150);
        return proc;
      };

      await getCachedMcpTools();
      expect(callCount).toBe(1);

      clearMcpToolCache();

      const tools2 = await getCachedMcpTools();
      expect(callCount).toBe(2);
      expect(tools2[0].toolName).toBe('tool_v2');
    });
  });

  describe('executeMcpTool', () => {
    it('should return error for non-MCP tool names', async () => {
      const result = await executeMcpTool('Read', { path: '/tmp/test' });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain('Not an MCP tool');
    });

    it('should return error when server is not found', async () => {
      const result = await executeMcpTool('mcp__nonexistent__tool', { key: 'value' });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain('MCP server not found');
    });

    it('should return error for non-stdio server', async () => {
      db.query(
        `INSERT INTO mcp_servers (name, transport, url)
         VALUES (?, ?, ?)`,
      ).run('sse-exec-server', 'sse', 'http://localhost:3000');

      const result = await executeMcpTool('mcp__sse-exec-server__some_tool', {});
      expect(result.is_error).toBe(true);
      expect(result.content).toContain('Only stdio transport supported');
    });

    it('should execute an MCP tool and return result', async () => {
      db.query(
        `INSERT INTO mcp_servers (name, transport, command, args)
         VALUES (?, ?, ?, ?)`,
      ).run('exec-server', 'stdio', 'node', JSON.stringify(['server.js']));

      spawnMockFn = () => {
        const proc = createMockProc();
        setTimeout(() => {
          // init response
          const initResp = JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: { protocolVersion: '2024-11-05' },
          });
          proc.stdout.emit('data', Buffer.from(initResp + '\n'));

          // tool call response
          const toolResp = JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            result: {
              content: [{ type: 'text', text: 'File contents here' }],
            },
          });
          proc.stdout.emit('data', Buffer.from(toolResp + '\n'));
          setTimeout(() => proc.emit('close', 0), 50);
        }, 150);
        return proc;
      };

      const result = await executeMcpTool('mcp__exec-server__read_file', { path: '/tmp/test.txt' });
      expect(result.is_error).toBeFalsy();
      expect(result.content).toBe('File contents here');
    });

    it('should handle MCP error responses', async () => {
      db.query(
        `INSERT INTO mcp_servers (name, transport, command)
         VALUES (?, ?, ?)`,
      ).run('error-server', 'stdio', 'node');

      spawnMockFn = () => {
        const proc = createMockProc();
        setTimeout(() => {
          const errorResp = JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            error: { code: -32600, message: 'Invalid request' },
          });
          proc.stdout.emit('data', Buffer.from(errorResp + '\n'));
          setTimeout(() => proc.emit('close', 1), 50);
        }, 150);
        return proc;
      };

      const result = await executeMcpTool('mcp__error-server__bad_tool', {});
      expect(result.is_error).toBe(true);
      expect(result.content).toContain('MCP Error');
      expect(result.content).toContain('Invalid request');
    });

    it('should handle multiple content blocks in tool result', async () => {
      db.query(
        `INSERT INTO mcp_servers (name, transport, command)
         VALUES (?, ?, ?)`,
      ).run('multi-content-server', 'stdio', 'node');

      spawnMockFn = () => {
        const proc = createMockProc();
        setTimeout(() => {
          const toolResp = JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            result: {
              content: [
                { type: 'text', text: 'Line 1' },
                { type: 'text', text: 'Line 2' },
                { type: 'image', data: 'base64data' },
              ],
            },
          });
          proc.stdout.emit('data', Buffer.from(toolResp + '\n'));
          setTimeout(() => proc.emit('close', 0), 50);
        }, 150);
        return proc;
      };

      const result = await executeMcpTool('mcp__multi-content-server__tool', {});
      expect(result.content).toContain('Line 1');
      expect(result.content).toContain('Line 2');
    });

    it('should handle no response from tool', async () => {
      db.query(
        `INSERT INTO mcp_servers (name, transport, command)
         VALUES (?, ?, ?)`,
      ).run('no-resp-server', 'stdio', 'node');

      spawnMockFn = () => {
        const proc = createMockProc();
        setTimeout(() => {
          // Process exits without sending any tool response
          proc.emit('close', 0);
        }, 50);
        return proc;
      };

      const result = await executeMcpTool('mcp__no-resp-server__silent_tool', {});
      expect(result.is_error).toBe(true);
      expect(result.content).toContain('No response from MCP tool');
    });

    it('should handle process spawn error during execution', async () => {
      db.query(
        `INSERT INTO mcp_servers (name, transport, command)
         VALUES (?, ?, ?)`,
      ).run('spawn-fail-server', 'stdio', 'nonexistent');

      spawnMockFn = () => {
        const proc = createMockProc();
        setTimeout(() => proc.emit('error', new Error('spawn ENOENT')), 10);
        return proc;
      };

      const result = await executeMcpTool('mcp__spawn-fail-server__tool', {});
      expect(result.is_error).toBe(true);
      expect(result.content).toContain('Failed to execute MCP tool');
    });

    it('should handle string content in tool result', async () => {
      db.query(
        `INSERT INTO mcp_servers (name, transport, command)
         VALUES (?, ?, ?)`,
      ).run('string-content-server', 'stdio', 'node');

      spawnMockFn = () => {
        const proc = createMockProc();
        setTimeout(() => {
          const toolResp = JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            result: {
              content: 'plain string result',
            },
          });
          proc.stdout.emit('data', Buffer.from(toolResp + '\n'));
          setTimeout(() => proc.emit('close', 0), 50);
        }, 150);
        return proc;
      };

      const result = await executeMcpTool('mcp__string-content-server__tool', {});
      expect(result.content).toBe('plain string result');
    });

    it('should handle result with no content field', async () => {
      db.query(
        `INSERT INTO mcp_servers (name, transport, command)
         VALUES (?, ?, ?)`,
      ).run('no-content-server', 'stdio', 'node');

      spawnMockFn = () => {
        const proc = createMockProc();
        setTimeout(() => {
          const toolResp = JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            result: { status: 'ok', data: [1, 2, 3] },
          });
          proc.stdout.emit('data', Buffer.from(toolResp + '\n'));
          setTimeout(() => proc.emit('close', 0), 50);
        }, 150);
        return proc;
      };

      const result = await executeMcpTool('mcp__no-content-server__tool', {});
      // Should JSON.stringify the result
      expect(result.content).toContain('status');
      expect(result.content).toContain('ok');
    });

    it('should pass server env to spawned process', async () => {
      db.query(
        `INSERT INTO mcp_servers (name, transport, command, env)
         VALUES (?, ?, ?, ?)`,
      ).run('env-server', 'stdio', 'node', JSON.stringify({ API_KEY: 'secret123' }));

      let capturedEnv: any = null;
      spawnMockFn = (_cmd: string, _args: string[], opts: any) => {
        capturedEnv = opts.env;
        const proc = createMockProc();
        setTimeout(() => proc.emit('close', 0), 50);
        return proc;
      };

      await executeMcpTool('mcp__env-server__tool', {});
      expect(capturedEnv).toBeDefined();
      expect(capturedEnv.API_KEY).toBe('secret123');
    });
  });
});
