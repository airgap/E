import { describe, test, expect } from 'bun:test';
import {
  parseMcpToolName,
  isMcpToolDangerous,
  isMcpFileWriteTool,
  extractFilePath,
  extractEditLineHint,
} from '../mcp-tools';

// ── parseMcpToolName ──

describe('parseMcpToolName', () => {
  describe('non-MCP (built-in) tool names', () => {
    test('returns isMcp false for a plain tool name', () => {
      const result = parseMcpToolName('Read');
      expect(result.isMcp).toBe(false);
      expect(result.serverName).toBeNull();
      expect(result.toolName).toBe('Read');
      expect(result.displayName).toBe('Read');
      expect(result.renderAs).toBeNull();
      expect(result.rawName).toBe('Read');
    });

    test('returns isMcp false for an empty string', () => {
      const result = parseMcpToolName('');
      expect(result.isMcp).toBe(false);
      expect(result.toolName).toBe('');
      expect(result.displayName).toBe('');
    });

    test('returns isMcp false for a name starting with "mcp_" (single underscore)', () => {
      const result = parseMcpToolName('mcp_something');
      expect(result.isMcp).toBe(false);
      expect(result.toolName).toBe('mcp_something');
    });

    test('returns isMcp false for "mcp__" with only one segment after prefix', () => {
      const result = parseMcpToolName('mcp__server-only');
      expect(result.isMcp).toBe(false);
      expect(result.toolName).toBe('mcp__server-only');
      expect(result.displayName).toBe('mcp__server-only');
    });

    test('returns isMcp false for names that contain mcp__ but do not start with it', () => {
      const result = parseMcpToolName('xmcp__server__tool');
      expect(result.isMcp).toBe(false);
      expect(result.toolName).toBe('xmcp__server__tool');
    });
  });

  describe('MCP tool names with known tools', () => {
    test('parses desktop-commander read_file correctly', () => {
      const result = parseMcpToolName('mcp__desktop-commander__read_file');
      expect(result.isMcp).toBe(true);
      expect(result.rawName).toBe('mcp__desktop-commander__read_file');
      expect(result.serverName).toBe('desktop-commander');
      expect(result.toolName).toBe('read_file');
      expect(result.displayName).toBe('Read');
      expect(result.renderAs).toBe('Read');
    });

    test('parses write_file as Write', () => {
      const result = parseMcpToolName('mcp__desktop-commander__write_file');
      expect(result.toolName).toBe('write_file');
      expect(result.displayName).toBe('Write');
      expect(result.renderAs).toBe('Write');
    });

    test('parses edit_block as Edit', () => {
      const result = parseMcpToolName('mcp__desktop-commander__edit_block');
      expect(result.toolName).toBe('edit_block');
      expect(result.displayName).toBe('Edit');
      expect(result.renderAs).toBe('Edit');
    });

    test('parses start_process as Bash/Process', () => {
      const result = parseMcpToolName('mcp__desktop-commander__start_process');
      expect(result.displayName).toBe('Process');
      expect(result.renderAs).toBe('Bash');
    });

    test('parses brave_web_search correctly', () => {
      const result = parseMcpToolName('mcp__brave-search__brave_web_search');
      expect(result.isMcp).toBe(true);
      expect(result.serverName).toBe('brave-search');
      expect(result.toolName).toBe('brave_web_search');
      expect(result.displayName).toBe('Web Search');
      expect(result.renderAs).toBe('WebSearch');
    });

    test('parses puppeteer_navigate as WebFetch/Navigate', () => {
      const result = parseMcpToolName('mcp__puppeteer__puppeteer_navigate');
      expect(result.serverName).toBe('puppeteer');
      expect(result.displayName).toBe('Navigate');
      expect(result.renderAs).toBe('WebFetch');
    });

    test('parses github search_code correctly', () => {
      const result = parseMcpToolName('mcp__github__search_code');
      expect(result.serverName).toBe('github');
      expect(result.toolName).toBe('search_code');
      expect(result.displayName).toBe('Search Code');
      expect(result.renderAs).toBe('Grep');
    });

    test('parses create_or_update_file correctly', () => {
      const result = parseMcpToolName('mcp__github__create_or_update_file');
      expect(result.displayName).toBe('Update File');
      expect(result.renderAs).toBe('Write');
    });

    test('parses cloudflare workers_list correctly', () => {
      const result = parseMcpToolName('mcp__cloudflare__workers_list');
      expect(result.displayName).toBe('List Workers');
      expect(result.renderAs).toBe('Read');
    });

    test('parses d1_database_query as Bash', () => {
      const result = parseMcpToolName('mcp__cloudflare__d1_database_query');
      expect(result.displayName).toBe('D1 Query');
      expect(result.renderAs).toBe('Bash');
    });

    test('parses memory search_nodes correctly', () => {
      const result = parseMcpToolName('mcp__memory__search_nodes');
      expect(result.displayName).toBe('Search Nodes');
      expect(result.renderAs).toBe('Grep');
    });
  });

  describe('MCP tool names with unknown tools', () => {
    test('uses tool name as display name when tool is unknown', () => {
      const result = parseMcpToolName('mcp__my-server__custom_tool');
      expect(result.isMcp).toBe(true);
      expect(result.serverName).toBe('my-server');
      expect(result.toolName).toBe('custom_tool');
      expect(result.displayName).toBe('custom_tool');
      expect(result.renderAs).toBeNull();
    });

    test('handles unknown tool from known server', () => {
      const result = parseMcpToolName('mcp__desktop-commander__some_future_tool');
      expect(result.isMcp).toBe(true);
      expect(result.serverName).toBe('desktop-commander');
      expect(result.toolName).toBe('some_future_tool');
      expect(result.displayName).toBe('some_future_tool');
      expect(result.renderAs).toBeNull();
    });
  });

  describe('edge cases in parsing', () => {
    test('handles tool name containing double underscores', () => {
      const result = parseMcpToolName('mcp__server__tool__with__extra');
      expect(result.isMcp).toBe(true);
      expect(result.serverName).toBe('server');
      // Parts after server are rejoined with __
      expect(result.toolName).toBe('tool__with__extra');
    });

    test('handles server name with hyphens', () => {
      const result = parseMcpToolName('mcp__my-complex-server-name__read_file');
      expect(result.isMcp).toBe(true);
      expect(result.serverName).toBe('my-complex-server-name');
      expect(result.toolName).toBe('read_file');
      expect(result.displayName).toBe('Read');
    });

    test('handles empty server name segment', () => {
      const result = parseMcpToolName('mcp____tool_name');
      expect(result.isMcp).toBe(true);
      expect(result.serverName).toBe('');
      expect(result.toolName).toBe('tool_name');
    });

    test('handles empty tool name segment', () => {
      const result = parseMcpToolName('mcp__server__');
      expect(result.isMcp).toBe(true);
      expect(result.serverName).toBe('server');
      expect(result.toolName).toBe('');
    });

    test('preserves rawName in result', () => {
      const raw = 'mcp__desktop-commander__read_file';
      const result = parseMcpToolName(raw);
      expect(result.rawName).toBe(raw);
    });

    test('preserves rawName for non-MCP tools', () => {
      const result = parseMcpToolName('Write');
      expect(result.rawName).toBe('Write');
    });
  });
});

// ── isMcpToolDangerous ──

describe('isMcpToolDangerous', () => {
  describe('returns true for dangerous MCP tools', () => {
    const dangerousTools = [
      'write_file',
      'edit_block',
      'create_file',
      'move_file',
      'create_directory',
      'create_or_update_file',
      'start_process',
      'execute_command',
      'interact_with_process',
      'force_terminate',
      'kill_process',
      'puppeteer_evaluate',
      'create_entities',
      'create_relations',
      'delete_entities',
      'delete_relations',
    ];

    for (const tool of dangerousTools) {
      test(`${tool} is dangerous`, () => {
        expect(isMcpToolDangerous(`mcp__any-server__${tool}`)).toBe(true);
      });
    }
  });

  describe('returns false for non-dangerous MCP tools', () => {
    const safeTools = [
      'read_file',
      'read_multiple_files',
      'list_directory',
      'get_file_info',
      'read_process_output',
      'brave_web_search',
      'search_code',
      'get_file_contents',
      'search_nodes',
      'open_nodes',
      'read_graph',
      'workers_list',
    ];

    for (const tool of safeTools) {
      test(`${tool} is not dangerous`, () => {
        expect(isMcpToolDangerous(`mcp__some-server__${tool}`)).toBe(false);
      });
    }
  });

  describe('returns false for non-MCP tools', () => {
    test('built-in Read is not dangerous', () => {
      expect(isMcpToolDangerous('Read')).toBe(false);
    });

    test('built-in Write is not dangerous (only checks MCP tools)', () => {
      expect(isMcpToolDangerous('Write')).toBe(false);
    });

    test('built-in Bash is not dangerous (only checks MCP tools)', () => {
      expect(isMcpToolDangerous('Bash')).toBe(false);
    });

    test('empty string is not dangerous', () => {
      expect(isMcpToolDangerous('')).toBe(false);
    });
  });

  test('dangerous check works regardless of server name', () => {
    expect(isMcpToolDangerous('mcp__server-a__write_file')).toBe(true);
    expect(isMcpToolDangerous('mcp__server-b__write_file')).toBe(true);
    expect(isMcpToolDangerous('mcp__completely-different__write_file')).toBe(true);
  });

  test('returns false for malformed mcp prefix', () => {
    expect(isMcpToolDangerous('mcp__write_file')).toBe(false);
    expect(isMcpToolDangerous('mcp_server__write_file')).toBe(false);
  });
});

// ── isMcpFileWriteTool ──

describe('isMcpFileWriteTool', () => {
  describe('returns true for file-write MCP tools', () => {
    const writeTools = [
      'write_file',
      'edit_block',
      'create_file',
      'move_file',
      'create_or_update_file',
    ];

    for (const tool of writeTools) {
      test(`${tool} is a file write tool`, () => {
        expect(isMcpFileWriteTool(`mcp__any-server__${tool}`)).toBe(true);
      });
    }
  });

  describe('returns false for non-file-write MCP tools', () => {
    const nonWriteTools = [
      'read_file',
      'list_directory',
      'start_process',
      'kill_process',
      'brave_web_search',
      'create_directory',
      'create_entities',
      'delete_entities',
    ];

    for (const tool of nonWriteTools) {
      test(`${tool} is not a file write tool`, () => {
        expect(isMcpFileWriteTool(`mcp__some-server__${tool}`)).toBe(false);
      });
    }
  });

  describe('returns false for non-MCP tools', () => {
    test('built-in Write is not detected', () => {
      expect(isMcpFileWriteTool('Write')).toBe(false);
    });

    test('built-in Edit is not detected', () => {
      expect(isMcpFileWriteTool('Edit')).toBe(false);
    });

    test('empty string returns false', () => {
      expect(isMcpFileWriteTool('')).toBe(false);
    });
  });

  test('file write check works regardless of server name', () => {
    expect(isMcpFileWriteTool('mcp__server-a__write_file')).toBe(true);
    expect(isMcpFileWriteTool('mcp__server-b__edit_block')).toBe(true);
    expect(isMcpFileWriteTool('mcp__any__create_file')).toBe(true);
  });

  test('some dangerous tools are not file write tools', () => {
    // start_process is dangerous but not a file write
    expect(isMcpToolDangerous('mcp__s__start_process')).toBe(true);
    expect(isMcpFileWriteTool('mcp__s__start_process')).toBe(false);

    // kill_process is dangerous but not a file write
    expect(isMcpToolDangerous('mcp__s__kill_process')).toBe(true);
    expect(isMcpFileWriteTool('mcp__s__kill_process')).toBe(false);
  });

  test('all file write tools are also dangerous', () => {
    const writeTools = [
      'write_file',
      'edit_block',
      'create_file',
      'move_file',
      'create_or_update_file',
    ];
    for (const tool of writeTools) {
      const name = `mcp__server__${tool}`;
      expect(isMcpFileWriteTool(name)).toBe(true);
      expect(isMcpToolDangerous(name)).toBe(true);
    }
  });
});

// ── extractFilePath ──

describe('extractFilePath', () => {
  test('extracts file_path parameter', () => {
    expect(extractFilePath({ file_path: '/home/user/file.txt' })).toBe('/home/user/file.txt');
  });

  test('extracts path parameter', () => {
    expect(extractFilePath({ path: '/tmp/data.json' })).toBe('/tmp/data.json');
  });

  test('extracts filePath parameter (camelCase)', () => {
    expect(extractFilePath({ filePath: '/var/log/app.log' })).toBe('/var/log/app.log');
  });

  test('extracts source parameter', () => {
    expect(extractFilePath({ source: '/src/index.ts' })).toBe('/src/index.ts');
  });

  test('extracts destination parameter', () => {
    expect(extractFilePath({ destination: '/dist/bundle.js' })).toBe('/dist/bundle.js');
  });

  test('prefers file_path over path (priority order)', () => {
    expect(
      extractFilePath({
        file_path: '/first.txt',
        path: '/second.txt',
      }),
    ).toBe('/first.txt');
  });

  test('prefers path over filePath (priority order)', () => {
    expect(
      extractFilePath({
        path: '/second.txt',
        filePath: '/third.txt',
      }),
    ).toBe('/second.txt');
  });

  test('prefers filePath over source (priority order)', () => {
    expect(
      extractFilePath({
        filePath: '/third.txt',
        source: '/fourth.txt',
      }),
    ).toBe('/third.txt');
  });

  test('prefers source over destination (priority order)', () => {
    expect(
      extractFilePath({
        source: '/fourth.txt',
        destination: '/fifth.txt',
      }),
    ).toBe('/fourth.txt');
  });

  test('returns null when no matching key is present', () => {
    expect(extractFilePath({ command: 'ls', args: ['-la'] })).toBeNull();
  });

  test('returns null for empty object', () => {
    expect(extractFilePath({})).toBeNull();
  });

  test('skips non-string values', () => {
    expect(extractFilePath({ path: 123 })).toBeNull();
    expect(extractFilePath({ file_path: null })).toBeNull();
    expect(extractFilePath({ filePath: undefined })).toBeNull();
    expect(extractFilePath({ source: true })).toBeNull();
    expect(extractFilePath({ destination: ['a', 'b'] })).toBeNull();
  });

  test('skips empty string values', () => {
    expect(extractFilePath({ path: '' })).toBeNull();
  });

  test('falls through to next candidate when first is non-string', () => {
    expect(
      extractFilePath({
        file_path: 42,
        path: '/valid/path.txt',
      }),
    ).toBe('/valid/path.txt');
  });

  test('handles paths with spaces', () => {
    expect(extractFilePath({ path: '/home/user/my documents/file.txt' })).toBe(
      '/home/user/my documents/file.txt',
    );
  });

  test('handles Windows-style paths', () => {
    expect(extractFilePath({ path: 'C:\\Users\\user\\file.txt' })).toBe(
      'C:\\Users\\user\\file.txt',
    );
  });

  test('ignores extra unknown keys', () => {
    expect(
      extractFilePath({
        command: 'cat',
        flags: '--verbose',
        path: '/the/file.txt',
        output: '/dev/null',
      }),
    ).toBe('/the/file.txt');
  });
});

// ── extractEditLineHint ──

describe('extractEditLineHint', () => {
  test('returns 1 for write_file tool', () => {
    expect(extractEditLineHint('write_file', { content: 'hello' })).toBe(1);
  });

  test('returns 1 for Write tool', () => {
    expect(extractEditLineHint('Write', { content: 'hello' })).toBe(1);
  });

  test('returns 1 for create_file tool', () => {
    expect(extractEditLineHint('create_file', { content: 'hello' })).toBe(1);
  });

  test('finds old_string position in file content for Edit tool', () => {
    const fileContent = 'line one\nline two\nline three\nline four\n';
    const result = extractEditLineHint(
      'Edit',
      { old_string: 'line three', new_string: 'line THREE' },
      fileContent,
    );
    expect(result).toBe(3); // "line three" starts on line 3
  });

  test('finds old_string at first line', () => {
    const fileContent = 'first line\nsecond line\n';
    const result = extractEditLineHint('edit_file', { old_string: 'first line' }, fileContent);
    expect(result).toBe(1);
  });

  test('finds oldText for str_replace_editor', () => {
    const fileContent = 'a\nb\nc\n';
    const result = extractEditLineHint('str_replace_editor', { oldText: 'c' }, fileContent);
    expect(result).toBe(3);
  });

  test('finds search field for edit_block tool', () => {
    const fileContent = 'line1\nline2\ntarget\n';
    const result = extractEditLineHint('edit_block', { search: 'target' }, fileContent);
    expect(result).toBe(3);
  });

  test('falls back to line number param when old_string not found', () => {
    const result = extractEditLineHint(
      'Edit',
      { old_string: 'nonexistent', line: 42 },
      'some content',
    );
    expect(result).toBe(42);
  });

  test('falls back to line_number param', () => {
    const result = extractEditLineHint('edit_file', { line_number: 10 });
    expect(result).toBe(10);
  });

  test('falls back to lineNumber param', () => {
    const result = extractEditLineHint('edit_file', { lineNumber: 7 });
    expect(result).toBe(7);
  });

  test('falls back to start_line param', () => {
    const result = extractEditLineHint('edit_file', { start_line: 15 });
    expect(result).toBe(15);
  });

  test('parses string line number', () => {
    const result = extractEditLineHint('edit_file', { line: '25' });
    expect(result).toBe(25);
  });

  test('returns undefined for unknown tool', () => {
    expect(extractEditLineHint('Bash', { command: 'ls' })).toBeUndefined();
  });

  test('returns undefined for edit tool with no useful info', () => {
    expect(extractEditLineHint('Edit', {})).toBeUndefined();
  });

  test('returns undefined when old_string not in file and no line params', () => {
    expect(extractEditLineHint('Edit', { old_string: 'missing' }, 'no match here')).toBeUndefined();
  });

  test('returns undefined when fileContent not provided and no line params', () => {
    expect(extractEditLineHint('Edit', { old_string: 'something' })).toBeUndefined();
  });
});
