import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { createTestDb } from '../../test-helpers';

const testDb = createTestDb();
mock.module('../../db/database', () => ({
  getDb: () => testDb,
  initDatabase: () => {},
}));

// Mock the mcp-tool-adapter module
let mockCachedMcpTools: any[] = [];
let mockGetCachedMcpToolsError: Error | null = null;

mock.module('../mcp-tool-adapter', () => ({
  getCachedMcpTools: async () => {
    if (mockGetCachedMcpToolsError) throw mockGetCachedMcpToolsError;
    return mockCachedMcpTools;
  },
  mcpToolsToSchemas: (tools: any[]) =>
    tools.map((t: any) => ({
      name: t.fullName,
      description: t.description || `${t.toolName} from ${t.serverName}`,
      input_schema: t.inputSchema || { type: 'object', properties: {}, required: [] },
    })),
  isMcpTool: (name: string) => name.startsWith('mcp__'),
}));

// Mock the shared module for isMcpToolDangerous
mock.module('@e/shared', () => ({
  isMcpToolDangerous: (name: string) => {
    // Simulate: tools containing "write_file" or "execute_command" are dangerous
    const dangerousPatterns = ['write_file', 'execute_command', 'create_file'];
    return dangerousPatterns.some((p) => name.includes(p));
  },
}));

import {
  getToolDefinitions,
  requiresApproval,
  getFilteredTools,
  getAllToolsWithMcp,
  toOllamaFunctions,
} from '../tool-schemas';
import type { ToolSchema } from '../tool-schemas';

describe('tool-schemas', () => {
  beforeEach(() => {
    mockCachedMcpTools = [];
    mockGetCachedMcpToolsError = null;
  });

  // ── getToolDefinitions ──

  describe('getToolDefinitions', () => {
    test('returns an array of tool schemas', () => {
      const tools = getToolDefinitions();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });

    test('includes expected built-in tools', () => {
      const tools = getToolDefinitions();
      const names = tools.map((t) => t.name);
      expect(names).toContain('Read');
      expect(names).toContain('Write');
      expect(names).toContain('Edit');
      expect(names).toContain('Glob');
      expect(names).toContain('Grep');
      expect(names).toContain('Bash');
      expect(names).toContain('WebFetch');
      expect(names).toContain('WebSearch');
      expect(names).toContain('NotebookEdit');
    });

    test('each tool has required schema fields', () => {
      const tools = getToolDefinitions();
      for (const tool of tools) {
        expect(tool.name).toBeDefined();
        expect(typeof tool.name).toBe('string');
        expect(tool.name.length).toBeGreaterThan(0);

        expect(tool.description).toBeDefined();
        expect(typeof tool.description).toBe('string');
        expect(tool.description.length).toBeGreaterThan(0);

        expect(tool.input_schema).toBeDefined();
        expect(tool.input_schema.type).toBe('object');
        expect(tool.input_schema.properties).toBeDefined();
        expect(typeof tool.input_schema.properties).toBe('object');
      }
    });

    test('each tool has a required array (if present) with valid entries', () => {
      const tools = getToolDefinitions();
      for (const tool of tools) {
        if (tool.input_schema.required) {
          expect(Array.isArray(tool.input_schema.required)).toBe(true);
          for (const req of tool.input_schema.required) {
            expect(Object.keys(tool.input_schema.properties)).toContain(req);
          }
        }
      }
    });

    test('Read tool has correct schema', () => {
      const tools = getToolDefinitions();
      const readTool = tools.find((t) => t.name === 'Read')!;
      expect(readTool).toBeDefined();
      expect(readTool.input_schema.required).toContain('file_path');
      expect(readTool.input_schema.properties.file_path).toBeDefined();
      expect(readTool.input_schema.properties.file_path.type).toBe('string');
      expect(readTool.input_schema.properties.offset).toBeDefined();
      expect(readTool.input_schema.properties.limit).toBeDefined();
    });

    test('Write tool has correct schema', () => {
      const tools = getToolDefinitions();
      const writeTool = tools.find((t) => t.name === 'Write')!;
      expect(writeTool).toBeDefined();
      expect(writeTool.input_schema.required).toEqual(['file_path', 'content']);
      expect(writeTool.input_schema.properties.file_path).toBeDefined();
      expect(writeTool.input_schema.properties.content).toBeDefined();
    });

    test('Edit tool has correct schema', () => {
      const tools = getToolDefinitions();
      const editTool = tools.find((t) => t.name === 'Edit')!;
      expect(editTool).toBeDefined();
      expect(editTool.input_schema.required).toEqual(['file_path', 'old_string', 'new_string']);
      expect(editTool.input_schema.properties.replace_all).toBeDefined();
      expect(editTool.input_schema.properties.replace_all.type).toBe('boolean');
    });

    test('Bash tool has correct schema', () => {
      const tools = getToolDefinitions();
      const bashTool = tools.find((t) => t.name === 'Bash')!;
      expect(bashTool).toBeDefined();
      expect(bashTool.input_schema.required).toEqual(['command']);
      expect(bashTool.input_schema.properties.command).toBeDefined();
      expect(bashTool.input_schema.properties.timeout).toBeDefined();
      expect(bashTool.input_schema.properties.description).toBeDefined();
    });

    test('Grep tool has enum for output_mode', () => {
      const tools = getToolDefinitions();
      const grepTool = tools.find((t) => t.name === 'Grep')!;
      expect(grepTool.input_schema.properties.output_mode.enum).toEqual([
        'content',
        'files_with_matches',
        'count',
      ]);
    });

    test('NotebookEdit tool has enum for cell_type and edit_mode', () => {
      const tools = getToolDefinitions();
      const nbTool = tools.find((t) => t.name === 'NotebookEdit')!;
      expect(nbTool.input_schema.properties.cell_type.enum).toEqual(['code', 'markdown']);
      expect(nbTool.input_schema.properties.edit_mode.enum).toEqual([
        'replace',
        'insert',
        'delete',
      ]);
    });

    test('WebSearch tool has array items type for domains', () => {
      const tools = getToolDefinitions();
      const wsTool = tools.find((t) => t.name === 'WebSearch')!;
      expect(wsTool.input_schema.properties.allowed_domains.items).toEqual({ type: 'string' });
      expect(wsTool.input_schema.properties.blocked_domains.items).toEqual({ type: 'string' });
    });
  });

  // ── requiresApproval ──

  describe('requiresApproval', () => {
    test('returns true for Write', () => {
      expect(requiresApproval('Write')).toBe(true);
    });

    test('returns true for Edit', () => {
      expect(requiresApproval('Edit')).toBe(true);
    });

    test('returns true for Bash', () => {
      expect(requiresApproval('Bash')).toBe(true);
    });

    test('returns true for NotebookEdit', () => {
      expect(requiresApproval('NotebookEdit')).toBe(true);
    });

    test('returns false for Read', () => {
      expect(requiresApproval('Read')).toBe(false);
    });

    test('returns false for Glob', () => {
      expect(requiresApproval('Glob')).toBe(false);
    });

    test('returns false for Grep', () => {
      expect(requiresApproval('Grep')).toBe(false);
    });

    test('returns false for WebFetch', () => {
      expect(requiresApproval('WebFetch')).toBe(false);
    });

    test('returns false for WebSearch', () => {
      expect(requiresApproval('WebSearch')).toBe(false);
    });

    test('returns true for dangerous MCP tools', () => {
      expect(requiresApproval('mcp__filesystem__write_file')).toBe(true);
      expect(requiresApproval('mcp__server__execute_command')).toBe(true);
      expect(requiresApproval('mcp__test__create_file')).toBe(true);
    });

    test('returns false for non-dangerous MCP tools', () => {
      expect(requiresApproval('mcp__filesystem__read_file')).toBe(false);
      expect(requiresApproval('mcp__server__list_items')).toBe(false);
    });

    test('returns false for unknown non-MCP tool names', () => {
      expect(requiresApproval('SomeUnknownTool')).toBe(false);
    });
  });

  // ── getFilteredTools ──

  describe('getFilteredTools', () => {
    test('returns all tools when no filters provided', () => {
      const all = getToolDefinitions();
      const filtered = getFilteredTools();
      expect(filtered).toEqual(all);
    });

    test('returns all tools when both filters are undefined', () => {
      const all = getToolDefinitions();
      const filtered = getFilteredTools(undefined, undefined);
      expect(filtered).toEqual(all);
    });

    test('returns all tools when both filters are empty arrays', () => {
      const all = getToolDefinitions();
      const filtered = getFilteredTools([], []);
      expect(filtered).toEqual(all);
    });

    test('filters to only allowed tools', () => {
      const filtered = getFilteredTools(['Read', 'Write']);
      expect(filtered).toHaveLength(2);
      expect(filtered.map((t) => t.name)).toEqual(['Read', 'Write']);
    });

    test('filters out disallowed tools', () => {
      const all = getToolDefinitions();
      const filtered = getFilteredTools(undefined, ['Bash', 'Write']);
      expect(filtered).toHaveLength(all.length - 2);
      expect(filtered.map((t) => t.name)).not.toContain('Bash');
      expect(filtered.map((t) => t.name)).not.toContain('Write');
    });

    test('applies both allowed and disallowed filters', () => {
      const filtered = getFilteredTools(['Read', 'Write', 'Bash'], ['Bash']);
      expect(filtered).toHaveLength(2);
      expect(filtered.map((t) => t.name)).toEqual(['Read', 'Write']);
    });

    test('returns empty array when no allowed tools match', () => {
      const filtered = getFilteredTools(['NonExistentTool']);
      expect(filtered).toHaveLength(0);
    });

    test('returns all tools when disallowed list contains no matching tools', () => {
      const all = getToolDefinitions();
      const filtered = getFilteredTools(undefined, ['NonExistentTool']);
      expect(filtered).toHaveLength(all.length);
    });

    test('allowed filter with single tool', () => {
      const filtered = getFilteredTools(['Grep']);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('Grep');
    });
  });

  // ── toOllamaFunctions ──

  describe('toOllamaFunctions', () => {
    test('converts tool schemas to Ollama function format', () => {
      const tools = getToolDefinitions();
      const functions = toOllamaFunctions(tools);

      expect(functions.length).toBe(tools.length);
      for (let i = 0; i < functions.length; i++) {
        expect(functions[i].type).toBe('function');
        expect(functions[i].function.name).toBe(tools[i].name);
        expect(functions[i].function.description).toBe(tools[i].description);
        expect(functions[i].function.parameters).toEqual(tools[i].input_schema);
      }
    });

    test('wraps each tool in { type: "function", function: { ... } }', () => {
      const tools: ToolSchema[] = [
        {
          name: 'TestTool',
          description: 'A test tool',
          input_schema: {
            type: 'object',
            properties: {
              arg: { type: 'string', description: 'An argument' },
            },
            required: ['arg'],
          },
        },
      ];

      const result = toOllamaFunctions(tools);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        type: 'function',
        function: {
          name: 'TestTool',
          description: 'A test tool',
          parameters: {
            type: 'object',
            properties: {
              arg: { type: 'string', description: 'An argument' },
            },
            required: ['arg'],
          },
        },
      });
    });

    test('returns empty array for empty input', () => {
      const result = toOllamaFunctions([]);
      expect(result).toEqual([]);
    });

    test('preserves enum fields in parameters', () => {
      const tools: ToolSchema[] = [
        {
          name: 'EnumTool',
          description: 'Tool with enum',
          input_schema: {
            type: 'object',
            properties: {
              mode: {
                type: 'string',
                description: 'Mode',
                enum: ['fast', 'slow'],
              },
            },
          },
        },
      ];

      const result = toOllamaFunctions(tools);
      expect(result[0].function.parameters.properties.mode.enum).toEqual(['fast', 'slow']);
    });

    test('works with real tool definitions', () => {
      const tools = getToolDefinitions();
      const functions = toOllamaFunctions(tools);

      // Find the Grep function and verify enum is preserved
      const grepFn = functions.find((f) => f.function.name === 'Grep');
      expect(grepFn).toBeDefined();
      expect(grepFn!.function.parameters.properties.output_mode.enum).toEqual([
        'content',
        'files_with_matches',
        'count',
      ]);
    });
  });

  // ── getAllToolsWithMcp ──

  describe('getAllToolsWithMcp', () => {
    test('returns built-in tools when no MCP tools are available', async () => {
      mockCachedMcpTools = [];
      const tools = await getAllToolsWithMcp();
      const builtIn = getToolDefinitions();
      expect(tools).toEqual(builtIn);
    });

    test('combines built-in and MCP tools', async () => {
      mockCachedMcpTools = [
        {
          serverName: 'filesystem',
          toolName: 'read_file',
          fullName: 'mcp__filesystem__read_file',
          description: 'Read a file',
          inputSchema: {
            type: 'object',
            properties: { path: { type: 'string', description: 'Path' } },
            required: ['path'],
          },
          isDangerous: false,
        },
      ];

      const tools = await getAllToolsWithMcp();
      const builtIn = getToolDefinitions();
      expect(tools.length).toBe(builtIn.length + 1);

      const mcpTool = tools.find((t) => t.name === 'mcp__filesystem__read_file');
      expect(mcpTool).toBeDefined();
      expect(mcpTool!.description).toBe('Read a file');
    });

    test('applies allowed filter to combined tools', async () => {
      mockCachedMcpTools = [
        {
          serverName: 'test',
          toolName: 'my_tool',
          fullName: 'mcp__test__my_tool',
          description: 'My MCP tool',
          inputSchema: { type: 'object', properties: {}, required: [] },
          isDangerous: false,
        },
      ];

      const tools = await getAllToolsWithMcp(['Read', 'mcp__test__my_tool']);
      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name)).toContain('Read');
      expect(tools.map((t) => t.name)).toContain('mcp__test__my_tool');
    });

    test('applies disallowed filter to combined tools', async () => {
      mockCachedMcpTools = [
        {
          serverName: 'test',
          toolName: 'dangerous_tool',
          fullName: 'mcp__test__dangerous_tool',
          description: 'Dangerous',
          inputSchema: { type: 'object', properties: {}, required: [] },
          isDangerous: true,
        },
      ];

      const tools = await getAllToolsWithMcp(undefined, ['mcp__test__dangerous_tool', 'Bash']);
      const names = tools.map((t) => t.name);
      expect(names).not.toContain('mcp__test__dangerous_tool');
      expect(names).not.toContain('Bash');
      expect(names).toContain('Read');
    });

    test('applies both allowed and disallowed filters', async () => {
      mockCachedMcpTools = [
        {
          serverName: 'srv',
          toolName: 'tool_a',
          fullName: 'mcp__srv__tool_a',
          description: 'Tool A',
          inputSchema: { type: 'object', properties: {}, required: [] },
          isDangerous: false,
        },
        {
          serverName: 'srv',
          toolName: 'tool_b',
          fullName: 'mcp__srv__tool_b',
          description: 'Tool B',
          inputSchema: { type: 'object', properties: {}, required: [] },
          isDangerous: false,
        },
      ];

      const tools = await getAllToolsWithMcp(
        ['Read', 'mcp__srv__tool_a', 'mcp__srv__tool_b'],
        ['mcp__srv__tool_b'],
      );
      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name)).toContain('Read');
      expect(tools.map((t) => t.name)).toContain('mcp__srv__tool_a');
    });

    test('falls back to built-in tools when MCP discovery fails', async () => {
      mockGetCachedMcpToolsError = new Error('Connection refused');

      const tools = await getAllToolsWithMcp();
      const builtIn = getToolDefinitions();
      expect(tools).toEqual(builtIn);
    });

    test('handles multiple MCP tools from different servers', async () => {
      mockCachedMcpTools = [
        {
          serverName: 'filesystem',
          toolName: 'read_file',
          fullName: 'mcp__filesystem__read_file',
          description: 'Read a file',
          inputSchema: { type: 'object', properties: {}, required: [] },
          isDangerous: false,
        },
        {
          serverName: 'database',
          toolName: 'query',
          fullName: 'mcp__database__query',
          description: 'Run a query',
          inputSchema: { type: 'object', properties: {}, required: [] },
          isDangerous: false,
        },
        {
          serverName: 'github',
          toolName: 'create_issue',
          fullName: 'mcp__github__create_issue',
          description: 'Create issue',
          inputSchema: { type: 'object', properties: {}, required: [] },
          isDangerous: false,
        },
      ];

      const tools = await getAllToolsWithMcp();
      const builtIn = getToolDefinitions();
      expect(tools.length).toBe(builtIn.length + 3);
    });

    test('returns empty when allowed filter matches nothing', async () => {
      mockCachedMcpTools = [];
      const tools = await getAllToolsWithMcp(['NonExistentTool']);
      expect(tools).toHaveLength(0);
    });

    test('returns no filters applied when empty arrays given', async () => {
      mockCachedMcpTools = [];
      const tools = await getAllToolsWithMcp([], []);
      const builtIn = getToolDefinitions();
      expect(tools).toEqual(builtIn);
    });
  });
});
