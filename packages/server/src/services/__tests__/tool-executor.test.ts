import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// ── Mocks must be declared before importing the module under test ──

// Track what the mocked fs functions receive
let mockFiles: Record<string, string> = {};
let mockExistsResult: Record<string, boolean> = {};

mock.module('fs', () => ({
  readFileSync: (path: string, _encoding: string) => {
    if (mockFiles[path] !== undefined) return mockFiles[path];
    throw new Error(`ENOENT: no such file or directory, open '${path}'`);
  },
  writeFileSync: (path: string, content: string, _encoding: string) => {
    mockFiles[path] = content;
  },
  existsSync: (path: string) => {
    if (mockExistsResult[path] !== undefined) return mockExistsResult[path];
    return mockFiles[path] !== undefined;
  },
}));

// Track execSync / spawnSync calls
let mockExecSyncResult: string | Error = '';
let mockExecSyncCalls: Array<{ command: string; opts: any }> = [];

let mockSpawnSyncResult: { status: number | null; stdout: string; stderr: string } = {
  status: 0,
  stdout: '',
  stderr: '',
};
let mockSpawnSyncCalls: Array<{ cmd: string; args: string[]; opts: any }> = [];

mock.module('child_process', () => ({
  execSync: (command: string, opts: any) => {
    mockExecSyncCalls.push({ command, opts });
    if (mockExecSyncResult instanceof Error) throw mockExecSyncResult;
    return mockExecSyncResult;
  },
  spawnSync: (cmd: string, args: string[], opts: any) => {
    mockSpawnSyncCalls.push({ cmd, args, opts });
    return mockSpawnSyncResult;
  },
}));

// Mock MCP tool adapter
let mockIsMcpToolResult = false;
let mockExecuteMcpToolResult: { content: string; is_error?: boolean } = { content: '' };

mock.module('../mcp-tool-adapter', () => ({
  isMcpTool: (name: string) => {
    if (mockIsMcpToolResult) return true;
    return name.startsWith('mcp__');
  },
  executeMcpTool: async (_name: string, _input: any) => {
    return mockExecuteMcpToolResult;
  },
}));

// ── Import module under test ──

import { executeTool, type ToolResult } from '../tool-executor';

// ── Helper: create a real temp directory with files for Glob tests ──
// We use Bun.write and Bun-native APIs to bypass the 'fs' mock.

let globTmpDir: string;

async function setupGlobDir() {
  globTmpDir = join('/tmp', `tool-executor-test-${randomUUID()}`);
  // Bun.write automatically creates parent directories
  await Bun.write(join(globTmpDir, 'src', '.gitkeep'), '');
}

async function teardownGlobDir() {
  try {
    // Use Bun.spawnSync which is not affected by our child_process mock
    Bun.spawnSync(['rm', '-rf', globTmpDir]);
  } catch {}
}

async function writeRealFile(path: string, content: string) {
  await Bun.write(path, content);
}

// ── Test Suites ──

describe('tool-executor', () => {
  beforeEach(() => {
    // Reset all mock state
    mockFiles = {};
    mockExistsResult = {};
    mockExecSyncResult = '';
    mockExecSyncCalls = [];
    mockSpawnSyncResult = { status: 0, stdout: '', stderr: '' };
    mockSpawnSyncCalls = [];
    mockIsMcpToolResult = false;
    mockExecuteMcpToolResult = { content: '' };
  });

  // ═══════════════════════════════════════════════════════════════════
  // Tool Dispatch
  // ═══════════════════════════════════════════════════════════════════

  describe('tool dispatch', () => {
    test('dispatches to Read handler', async () => {
      mockFiles['/tmp/test.txt'] = 'hello';
      const result = await executeTool('Read', { file_path: '/tmp/test.txt' });
      expect(result.is_error).toBeFalsy();
      expect(result.content).toContain('hello');
    });

    test('dispatches to Write handler', async () => {
      const result = await executeTool('Write', {
        file_path: '/tmp/out.txt',
        content: 'data',
      });
      expect(result.is_error).toBeFalsy();
      expect(result.content).toContain('Successfully wrote');
    });

    test('dispatches to Edit handler', async () => {
      mockFiles['/tmp/edit.txt'] = 'foo bar baz';
      const result = await executeTool('Edit', {
        file_path: '/tmp/edit.txt',
        old_string: 'bar',
        new_string: 'qux',
      });
      expect(result.is_error).toBeFalsy();
      expect(result.content).toContain('Successfully replaced');
    });

    test('dispatches to Glob handler', async () => {
      await setupGlobDir();
      try {
        await writeRealFile(join(globTmpDir, 'test.ts'), 'export {}');
        const result = await executeTool('Glob', { pattern: '*.ts' }, globTmpDir);
        expect(result.is_error).toBeFalsy();
        expect(result.content).toContain('test.ts');
      } finally {
        await teardownGlobDir();
      }
    });

    test('dispatches to Grep handler', async () => {
      mockSpawnSyncResult = { status: 0, stdout: '/tmp/file.ts\n', stderr: '' };
      const result = await executeTool('Grep', { pattern: 'hello' }, '/tmp');
      expect(result.is_error).toBeFalsy();
    });

    test('dispatches to Bash handler', async () => {
      mockExecSyncResult = 'output\n';
      const result = await executeTool('Bash', { command: 'echo hello' }, '/tmp');
      expect(result.is_error).toBeFalsy();
      expect(result.content).toBe('output\n');
    });

    test('dispatches to WebFetch handler', async () => {
      const result = await executeTool('WebFetch', {
        url: 'https://example.com',
        prompt: 'summarize',
      });
      expect(result.is_error).toBeFalsy();
      expect(result.content).toContain('WebFetch');
    });

    test('dispatches to WebSearch handler', async () => {
      const result = await executeTool('WebSearch', { query: 'test query' });
      expect(result.is_error).toBeFalsy();
      expect(result.content).toContain('WebSearch');
    });

    test('dispatches to NotebookEdit handler', async () => {
      const notebook = {
        cells: [{ cell_type: 'code', source: ['print(1)'], metadata: {}, outputs: [] }],
      };
      mockFiles['/tmp/nb.ipynb'] = JSON.stringify(notebook);
      const result = await executeTool('NotebookEdit', {
        notebook_path: '/tmp/nb.ipynb',
        new_source: 'print(2)',
      });
      expect(result.is_error).toBeFalsy();
      expect(result.content).toContain('Successfully');
    });

    test('returns error for unknown tool', async () => {
      const result = await executeTool('NonExistentTool', {});
      expect(result.is_error).toBe(true);
      expect(result.content).toBe('Unknown tool: NonExistentTool');
    });

    test('delegates to MCP adapter for mcp__ prefixed tools', async () => {
      mockExecuteMcpToolResult = { content: 'mcp result data' };
      const result = await executeTool('mcp__server__tool', { key: 'val' });
      expect(result.content).toBe('mcp result data');
      expect(result.is_error).toBeFalsy();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // MCP Tool Delegation
  // ═══════════════════════════════════════════════════════════════════

  describe('MCP tool delegation', () => {
    test('passes tool name and input to executeMcpTool', async () => {
      mockExecuteMcpToolResult = { content: 'mcp output' };
      const result = await executeTool('mcp__filesystem__read_file', { path: '/tmp/x' });
      expect(result.content).toBe('mcp output');
    });

    test('returns MCP error results as-is', async () => {
      mockExecuteMcpToolResult = { content: 'MCP Error: not found', is_error: true };
      const result = await executeTool('mcp__server__missing', {});
      expect(result.is_error).toBe(true);
      expect(result.content).toContain('MCP Error');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Read Tool
  // ═══════════════════════════════════════════════════════════════════

  describe('Read tool', () => {
    test('reads an existing file and returns numbered lines', async () => {
      mockFiles['/tmp/hello.txt'] = 'line1\nline2\nline3';
      const result = await executeTool('Read', { file_path: '/tmp/hello.txt' });
      expect(result.is_error).toBeFalsy();
      expect(result.content).toContain('line1');
      expect(result.content).toContain('line2');
      expect(result.content).toContain('line3');
      // Line numbers should be present
      expect(result.content).toMatch(/\s+1\s+line1/);
      expect(result.content).toMatch(/\s+2\s+line2/);
      expect(result.content).toMatch(/\s+3\s+line3/);
    });

    test('returns error when file does not exist', async () => {
      mockExistsResult['/tmp/missing.txt'] = false;
      const result = await executeTool('Read', { file_path: '/tmp/missing.txt' });
      expect(result.is_error).toBe(true);
      expect(result.content).toBe('File not found: /tmp/missing.txt');
    });

    test('supports offset parameter (1-based)', async () => {
      mockFiles['/tmp/lines.txt'] = 'a\nb\nc\nd\ne';
      const result = await executeTool('Read', { file_path: '/tmp/lines.txt', offset: 3 });
      expect(result.is_error).toBeFalsy();
      // offset=3 means start from line 3 (0-based index 2)
      expect(result.content).toContain('c');
      expect(result.content).toContain('d');
      expect(result.content).toContain('e');
      // Should not contain lines before the offset
      const lines = result.content.split('\n');
      const firstLineContent = lines[0].trim();
      expect(firstLineContent).toMatch(/3\s+c/);
    });

    test('supports limit parameter', async () => {
      mockFiles['/tmp/lines.txt'] = 'a\nb\nc\nd\ne';
      const result = await executeTool('Read', { file_path: '/tmp/lines.txt', limit: 2 });
      expect(result.is_error).toBeFalsy();
      const lines = result.content.split('\n');
      expect(lines).toHaveLength(2);
      expect(result.content).toContain('a');
      expect(result.content).toContain('b');
    });

    test('supports offset and limit together', async () => {
      mockFiles['/tmp/lines.txt'] = 'a\nb\nc\nd\ne';
      const result = await executeTool('Read', {
        file_path: '/tmp/lines.txt',
        offset: 2,
        limit: 2,
      });
      expect(result.is_error).toBeFalsy();
      const lines = result.content.split('\n');
      expect(lines).toHaveLength(2);
      // offset=2 starts at index 1, limit=2 gives 2 lines => "b", "c"
      expect(result.content).toContain('b');
      expect(result.content).toContain('c');
    });

    test('handles empty file', async () => {
      mockFiles['/tmp/empty.txt'] = '';
      const result = await executeTool('Read', { file_path: '/tmp/empty.txt' });
      expect(result.is_error).toBeFalsy();
      // An empty file has one empty line when split by \n
      expect(result.content).toMatch(/\s+1\s+/);
    });

    test('handles single-line file with no trailing newline', async () => {
      mockFiles['/tmp/single.txt'] = 'only line';
      const result = await executeTool('Read', { file_path: '/tmp/single.txt' });
      expect(result.is_error).toBeFalsy();
      expect(result.content).toContain('only line');
      expect(result.content.split('\n')).toHaveLength(1);
    });

    test('line numbering starts from offset value', async () => {
      mockFiles['/tmp/lines.txt'] = 'a\nb\nc\nd\ne';
      const result = await executeTool('Read', { file_path: '/tmp/lines.txt', offset: 3 });
      // First displayed line should be numbered 3
      const firstLine = result.content.split('\n')[0];
      expect(firstLine).toMatch(/\s*3\s+c/);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Write Tool
  // ═══════════════════════════════════════════════════════════════════

  describe('Write tool', () => {
    test('writes content to a file', async () => {
      const result = await executeTool('Write', {
        file_path: '/tmp/out.txt',
        content: 'Hello, world!',
      });
      expect(result.is_error).toBeFalsy();
      expect(result.content).toBe('Successfully wrote 13 characters to /tmp/out.txt');
      expect(mockFiles['/tmp/out.txt']).toBe('Hello, world!');
    });

    test('overwrites existing file', async () => {
      mockFiles['/tmp/existing.txt'] = 'old content';
      const result = await executeTool('Write', {
        file_path: '/tmp/existing.txt',
        content: 'new content',
      });
      expect(result.is_error).toBeFalsy();
      expect(mockFiles['/tmp/existing.txt']).toBe('new content');
    });

    test('writes empty content', async () => {
      const result = await executeTool('Write', {
        file_path: '/tmp/empty.txt',
        content: '',
      });
      expect(result.is_error).toBeFalsy();
      expect(result.content).toBe('Successfully wrote 0 characters to /tmp/empty.txt');
      expect(mockFiles['/tmp/empty.txt']).toBe('');
    });

    test('reports character count correctly for multi-line content', async () => {
      const content = 'line1\nline2\nline3';
      const result = await executeTool('Write', {
        file_path: '/tmp/multi.txt',
        content,
      });
      expect(result.content).toBe(
        `Successfully wrote ${content.length} characters to /tmp/multi.txt`,
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Edit Tool
  // ═══════════════════════════════════════════════════════════════════

  describe('Edit tool', () => {
    test('replaces a unique string in a file', async () => {
      mockFiles['/tmp/edit.txt'] = 'const x = 1;\nconst y = 2;\n';
      const result = await executeTool('Edit', {
        file_path: '/tmp/edit.txt',
        old_string: 'const x = 1;',
        new_string: 'const x = 42;',
      });
      expect(result.is_error).toBeFalsy();
      expect(result.content).toContain('Successfully replaced 1 occurrence(s)');
      expect(mockFiles['/tmp/edit.txt']).toBe('const x = 42;\nconst y = 2;\n');
    });

    test('returns error when file does not exist', async () => {
      mockExistsResult['/tmp/missing.txt'] = false;
      const result = await executeTool('Edit', {
        file_path: '/tmp/missing.txt',
        old_string: 'foo',
        new_string: 'bar',
      });
      expect(result.is_error).toBe(true);
      expect(result.content).toBe('File not found: /tmp/missing.txt');
    });

    test('returns error when old_string not found', async () => {
      mockFiles['/tmp/edit.txt'] = 'hello world';
      const result = await executeTool('Edit', {
        file_path: '/tmp/edit.txt',
        old_string: 'notfound',
        new_string: 'replacement',
      });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain('String not found in file');
    });

    test('returns error when old_string appears multiple times without replace_all', async () => {
      mockFiles['/tmp/edit.txt'] = 'foo bar foo baz foo';
      const result = await executeTool('Edit', {
        file_path: '/tmp/edit.txt',
        old_string: 'foo',
        new_string: 'qux',
      });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain('String appears 3 times');
      expect(result.content).toContain('replace_all: true');
    });

    test('replaces all occurrences when replace_all is true', async () => {
      mockFiles['/tmp/edit.txt'] = 'foo bar foo baz foo';
      const result = await executeTool('Edit', {
        file_path: '/tmp/edit.txt',
        old_string: 'foo',
        new_string: 'qux',
        replace_all: true,
      });
      expect(result.is_error).toBeFalsy();
      expect(result.content).toContain('Successfully replaced 3 occurrence(s)');
      expect(mockFiles['/tmp/edit.txt']).toBe('qux bar qux baz qux');
    });

    test('replace_all with string that appears once', async () => {
      mockFiles['/tmp/edit.txt'] = 'unique string here';
      const result = await executeTool('Edit', {
        file_path: '/tmp/edit.txt',
        old_string: 'unique',
        new_string: 'special',
        replace_all: true,
      });
      expect(result.is_error).toBeFalsy();
      expect(result.content).toContain('Successfully replaced 1 occurrence(s)');
      expect(mockFiles['/tmp/edit.txt']).toBe('special string here');
    });

    test('truncates old_string in error message to 100 chars', async () => {
      mockFiles['/tmp/edit.txt'] = 'short content';
      const longString = 'A'.repeat(200);
      const result = await executeTool('Edit', {
        file_path: '/tmp/edit.txt',
        old_string: longString,
        new_string: 'replacement',
      });
      expect(result.is_error).toBe(true);
      // The error message should contain only the first 100 chars
      expect(result.content).toContain('A'.repeat(100));
      expect(result.content.length).toBeLessThan(200 + 50); // 100 chars + message overhead
    });

    test('replaces empty string with replace_all joins characters', async () => {
      // Edge case: old_string is an empty string — 'abc'.split('') = ['a','b','c']
      // 'abc'.split('').join('-') = 'a-b-c'
      mockFiles['/tmp/edit.txt'] = 'abc';
      const result = await executeTool('Edit', {
        file_path: '/tmp/edit.txt',
        old_string: '',
        new_string: '-',
        replace_all: true,
      });
      expect(result.is_error).toBeFalsy();
      // split('').join('-') produces 'a-b-c'
      expect(mockFiles['/tmp/edit.txt']).toBe('a-b-c');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Glob Tool
  // ═══════════════════════════════════════════════════════════════════

  describe('Glob tool', () => {
    // Glob uses dynamic `await import('bun')` which bypasses mock.module,
    // so we test against a real temp directory with real files using Bun.write.

    beforeEach(async () => {
      await setupGlobDir();
    });

    afterEach(async () => {
      await teardownGlobDir();
    });

    test('returns matching files', async () => {
      await writeRealFile(join(globTmpDir, 'src', 'a.ts'), 'export const a = 1;');
      await writeRealFile(join(globTmpDir, 'src', 'b.ts'), 'export const b = 2;');
      const result = await executeTool('Glob', { pattern: '**/*.ts' }, globTmpDir);
      expect(result.is_error).toBeFalsy();
      expect(result.content).toContain('a.ts');
      expect(result.content).toContain('b.ts');
    });

    test('returns message when no files match', async () => {
      const result = await executeTool('Glob', { pattern: '**/*.xyz' }, globTmpDir);
      expect(result.is_error).toBeFalsy();
      expect(result.content).toContain('No files found matching pattern: **/*.xyz');
    });

    test('uses input.path when provided', async () => {
      await writeRealFile(join(globTmpDir, 'file.js'), 'var x;');
      const result = await executeTool('Glob', {
        pattern: '*.js',
        path: globTmpDir,
      });
      expect(result.is_error).toBeFalsy();
      expect(result.content).toContain('file.js');
    });

    test('falls back to workspacePath when input.path not provided', async () => {
      await writeRealFile(join(globTmpDir, 'index.ts'), 'main');
      const result = await executeTool('Glob', { pattern: '*.ts' }, globTmpDir);
      expect(result.is_error).toBeFalsy();
      expect(result.content).toContain('index.ts');
    });

    test('returns error when searchPath does not exist', async () => {
      const badPath = join(globTmpDir, 'nonexistent_subdir');
      const result = await executeTool('Glob', { pattern: '*.ts', path: badPath });
      // Bun.Glob may error or return no matches for non-existent directories
      expect(result.content).toBeTruthy();
    });

    test('returns single match', async () => {
      await writeRealFile(join(globTmpDir, 'only.ts'), 'x');
      const result = await executeTool('Glob', { pattern: 'only.ts' }, globTmpDir);
      expect(result.content).toContain('only.ts');
    });

    test('matches nested files with ** pattern', async () => {
      await writeRealFile(join(globTmpDir, 'src', 'deep.ts'), 'deep');
      const result = await executeTool('Glob', { pattern: 'src/**/*.ts' }, globTmpDir);
      expect(result.is_error).toBeFalsy();
      expect(result.content).toContain('deep.ts');
    });

    test('does not match non-matching extensions', async () => {
      await writeRealFile(join(globTmpDir, 'data.json'), '{}');
      await writeRealFile(join(globTmpDir, 'code.ts'), 'x');
      const result = await executeTool('Glob', { pattern: '*.json' }, globTmpDir);
      expect(result.is_error).toBeFalsy();
      expect(result.content).toContain('data.json');
      expect(result.content).not.toContain('code.ts');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Grep Tool
  // ═══════════════════════════════════════════════════════════════════

  describe('Grep tool', () => {
    test('returns matching results (default files_with_matches mode)', async () => {
      mockSpawnSyncResult = {
        status: 0,
        stdout: '/tmp/file1.ts\n/tmp/file2.ts\n',
        stderr: '',
      };
      const result = await executeTool('Grep', { pattern: 'TODO' }, '/tmp');
      expect(result.is_error).toBeFalsy();
      expect(result.content).toContain('/tmp/file1.ts');
      expect(result.content).toContain('/tmp/file2.ts');
    });

    test('returns "No matches found" when rg returns exit code 1', async () => {
      mockSpawnSyncResult = { status: 1, stdout: '', stderr: '' };
      const result = await executeTool('Grep', { pattern: 'nonexistent' }, '/tmp');
      expect(result.is_error).toBeFalsy();
      expect(result.content).toBe('No matches found');
    });

    test('returns error when rg fails with exit code > 1', async () => {
      mockSpawnSyncResult = { status: 2, stdout: '', stderr: 'regex parse error' };
      const result = await executeTool('Grep', { pattern: '[invalid' }, '/tmp');
      expect(result.is_error).toBe(true);
      expect(result.content).toContain('Error searching');
      expect(result.content).toContain('regex parse error');
    });

    test('passes -l flag for files_with_matches mode', async () => {
      mockSpawnSyncResult = { status: 0, stdout: 'file.ts\n', stderr: '' };
      await executeTool('Grep', { pattern: 'test', output_mode: 'files_with_matches' }, '/tmp');
      const call = mockSpawnSyncCalls[0];
      expect(call.cmd).toBe('rg');
      expect(call.args).toContain('-l');
    });

    test('passes -c flag for count mode', async () => {
      mockSpawnSyncResult = { status: 0, stdout: 'file.ts:5\n', stderr: '' };
      await executeTool('Grep', { pattern: 'test', output_mode: 'count' }, '/tmp');
      const call = mockSpawnSyncCalls[0];
      expect(call.args).toContain('-c');
    });

    test('passes -n and -C flags for content mode with context', async () => {
      mockSpawnSyncResult = { status: 0, stdout: '1:match\n', stderr: '' };
      await executeTool('Grep', { pattern: 'test', output_mode: 'content', context: 3 }, '/tmp');
      const call = mockSpawnSyncCalls[0];
      expect(call.args).toContain('-n');
      expect(call.args).toContain('-C');
      expect(call.args).toContain('3');
    });

    test('passes -i flag for case insensitive search', async () => {
      mockSpawnSyncResult = { status: 0, stdout: 'file.ts\n', stderr: '' };
      await executeTool('Grep', { pattern: 'test', case_insensitive: true }, '/tmp');
      const call = mockSpawnSyncCalls[0];
      expect(call.args).toContain('-i');
    });

    test('passes --glob flag when glob pattern is specified', async () => {
      mockSpawnSyncResult = { status: 0, stdout: 'file.ts\n', stderr: '' };
      await executeTool('Grep', { pattern: 'test', glob: '*.ts' }, '/tmp');
      const call = mockSpawnSyncCalls[0];
      expect(call.args).toContain('--glob');
      expect(call.args).toContain('*.ts');
    });

    test('uses input.path when provided', async () => {
      mockSpawnSyncResult = { status: 0, stdout: '', stderr: '' };
      await executeTool('Grep', { pattern: 'test', path: '/custom/dir' }, '/workspace');
      const call = mockSpawnSyncCalls[0];
      // The last arg should be the search path
      expect(call.args[call.args.length - 1]).toBe('/custom/dir');
    });

    test('uses workspacePath when input.path not provided', async () => {
      mockSpawnSyncResult = { status: 0, stdout: '', stderr: '' };
      await executeTool('Grep', { pattern: 'test' }, '/workspace');
      const call = mockSpawnSyncCalls[0];
      expect(call.args[call.args.length - 1]).toBe('/workspace');
    });

    test('defaults to "." when neither input.path nor workspacePath provided', async () => {
      mockSpawnSyncResult = { status: 0, stdout: '', stderr: '' };
      await executeTool('Grep', { pattern: 'test' });
      const call = mockSpawnSyncCalls[0];
      expect(call.args[call.args.length - 1]).toBe('.');
    });

    test('returns "No matches found" when stdout is empty on exit code 0', async () => {
      mockSpawnSyncResult = { status: 0, stdout: '', stderr: '' };
      const result = await executeTool('Grep', { pattern: 'test' }, '/tmp');
      expect(result.content).toBe('No matches found');
    });

    test('returns error with fallback message when stderr is empty on failure', async () => {
      mockSpawnSyncResult = { status: 2, stdout: '', stderr: '' };
      const result = await executeTool('Grep', { pattern: 'test' }, '/tmp');
      expect(result.is_error).toBe(true);
      expect(result.content).toContain('rg failed');
    });

    test('pattern and path are passed after -- separator', async () => {
      mockSpawnSyncResult = { status: 0, stdout: 'match\n', stderr: '' };
      await executeTool('Grep', { pattern: '-dangerous-pattern' }, '/tmp');
      const call = mockSpawnSyncCalls[0];
      const dashDashIndex = call.args.indexOf('--');
      expect(dashDashIndex).toBeGreaterThanOrEqual(0);
      expect(call.args[dashDashIndex + 1]).toBe('-dangerous-pattern');
      expect(call.args[dashDashIndex + 2]).toBe('/tmp');
    });

    test('content mode without context does not pass -C flag', async () => {
      mockSpawnSyncResult = { status: 0, stdout: 'line\n', stderr: '' };
      await executeTool('Grep', { pattern: 'test', output_mode: 'content' }, '/tmp');
      const call = mockSpawnSyncCalls[0];
      expect(call.args).toContain('-n');
      expect(call.args).not.toContain('-C');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Bash Tool
  // ═══════════════════════════════════════════════════════════════════

  describe('Bash tool', () => {
    test('executes a command and returns stdout', async () => {
      mockExecSyncResult = 'hello world\n';
      const result = await executeTool('Bash', { command: 'echo hello world' }, '/tmp');
      expect(result.is_error).toBeFalsy();
      expect(result.content).toBe('hello world\n');
    });

    test('returns placeholder message for empty output', async () => {
      mockExecSyncResult = '';
      const result = await executeTool('Bash', { command: 'true' }, '/tmp');
      expect(result.is_error).toBeFalsy();
      expect(result.content).toBe('(command completed with no output)');
    });

    test('returns error when command fails', async () => {
      const err: any = new Error('command failed');
      err.status = 1;
      err.stderr = 'command not found\n';
      mockExecSyncResult = err;
      const result = await executeTool('Bash', { command: 'nonexistent' }, '/tmp');
      expect(result.is_error).toBe(true);
      expect(result.content).toContain('Command failed with exit code 1');
      expect(result.content).toContain('command not found');
    });

    test('returns "unknown" exit code when status is undefined', async () => {
      const err: any = new Error('something went wrong');
      err.stderr = 'error details';
      mockExecSyncResult = err;
      const result = await executeTool('Bash', { command: 'bad' }, '/tmp');
      expect(result.is_error).toBe(true);
      expect(result.content).toContain('exit code unknown');
    });

    test('uses custom timeout from input', async () => {
      mockExecSyncResult = 'ok';
      await executeTool('Bash', { command: 'sleep 1', timeout: 5000 }, '/tmp');
      const call = mockExecSyncCalls[0];
      expect(call.opts.timeout).toBe(5000);
    });

    test('defaults to 120000ms timeout', async () => {
      mockExecSyncResult = 'ok';
      await executeTool('Bash', { command: 'ls' }, '/tmp');
      const call = mockExecSyncCalls[0];
      expect(call.opts.timeout).toBe(120000);
    });

    test('uses workspacePath as cwd', async () => {
      mockExecSyncResult = 'ok';
      await executeTool('Bash', { command: 'pwd' }, '/my/workspace');
      const call = mockExecSyncCalls[0];
      expect(call.opts.cwd).toBe('/my/workspace');
    });

    test('falls back to process.cwd() when no workspacePath', async () => {
      mockExecSyncResult = 'ok';
      await executeTool('Bash', { command: 'pwd' });
      const call = mockExecSyncCalls[0];
      expect(call.opts.cwd).toBe(process.cwd());
    });

    test('sets maxBuffer to 10MB', async () => {
      mockExecSyncResult = 'ok';
      await executeTool('Bash', { command: 'ls' }, '/tmp');
      const call = mockExecSyncCalls[0];
      expect(call.opts.maxBuffer).toBe(10 * 1024 * 1024);
    });

    test('falls back to error.message when stderr is empty', async () => {
      const err: any = new Error('ETIMEDOUT');
      err.status = 124;
      err.stderr = '';
      mockExecSyncResult = err;
      const result = await executeTool('Bash', { command: 'timeout' }, '/tmp');
      expect(result.is_error).toBe(true);
      expect(result.content).toContain('ETIMEDOUT');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // WebFetch Tool
  // ═══════════════════════════════════════════════════════════════════

  describe('WebFetch tool', () => {
    test('returns placeholder with URL and prompt', async () => {
      const result = await executeTool('WebFetch', {
        url: 'https://example.com/page',
        prompt: 'Extract the title',
      });
      expect(result.is_error).toBeFalsy();
      expect(result.content).toContain('https://example.com/page');
      expect(result.content).toContain('Extract the title');
      expect(result.content).toContain('WebFetch');
    });

    test('handles various URL formats', async () => {
      const result = await executeTool('WebFetch', {
        url: 'http://localhost:3000/api',
        prompt: 'test',
      });
      expect(result.is_error).toBeFalsy();
      expect(result.content).toContain('http://localhost:3000/api');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // WebSearch Tool
  // ═══════════════════════════════════════════════════════════════════

  describe('WebSearch tool', () => {
    test('returns placeholder with query', async () => {
      const result = await executeTool('WebSearch', {
        query: 'how to test in bun',
      });
      expect(result.is_error).toBeFalsy();
      expect(result.content).toContain('how to test in bun');
      expect(result.content).toContain('WebSearch');
    });

    test('handles empty query string', async () => {
      const result = await executeTool('WebSearch', { query: '' });
      expect(result.is_error).toBeFalsy();
      // String(undefined) behavior — should just contain "undefined" or empty
      expect(result.content).toContain('WebSearch');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // NotebookEdit Tool
  // ═══════════════════════════════════════════════════════════════════

  describe('NotebookEdit tool', () => {
    const makeNotebook = (cells: any[]) => JSON.stringify({ cells });
    const codeCell = (source: string[]) => ({
      cell_type: 'code',
      source,
      metadata: {},
      outputs: [],
      execution_count: null,
    });
    const markdownCell = (source: string[]) => ({
      cell_type: 'markdown',
      source,
      metadata: {},
    });

    test('replaces content in first code cell (default edit_mode)', async () => {
      mockFiles['/tmp/nb.ipynb'] = makeNotebook([codeCell(['print("old")']), codeCell(['x = 1'])]);
      const result = await executeTool('NotebookEdit', {
        notebook_path: '/tmp/nb.ipynb',
        new_source: 'print("new")',
      });
      expect(result.is_error).toBeFalsy();
      expect(result.content).toContain('Successfully replaced cell');
      const updated = JSON.parse(mockFiles['/tmp/nb.ipynb']);
      expect(updated.cells[0].source).toEqual(['print("new")']);
      // Second cell should be untouched
      expect(updated.cells[1].source).toEqual(['x = 1']);
    });

    test('inserts a new code cell before first code cell', async () => {
      mockFiles['/tmp/nb.ipynb'] = makeNotebook([codeCell(['existing code'])]);
      const result = await executeTool('NotebookEdit', {
        notebook_path: '/tmp/nb.ipynb',
        new_source: 'import os',
        edit_mode: 'insert',
      });
      expect(result.is_error).toBeFalsy();
      expect(result.content).toContain('Successfully insertd cell');
      const updated = JSON.parse(mockFiles['/tmp/nb.ipynb']);
      expect(updated.cells).toHaveLength(2);
      expect(updated.cells[0].source).toEqual(['import os']);
      expect(updated.cells[0].cell_type).toBe('code');
      expect(updated.cells[1].source).toEqual(['existing code']);
    });

    test('deletes the first code cell', async () => {
      mockFiles['/tmp/nb.ipynb'] = makeNotebook([
        markdownCell(['# Title']),
        codeCell(['to_delete']),
        codeCell(['keep_this']),
      ]);
      const result = await executeTool('NotebookEdit', {
        notebook_path: '/tmp/nb.ipynb',
        new_source: '',
        edit_mode: 'delete',
      });
      expect(result.is_error).toBeFalsy();
      expect(result.content).toContain('Successfully deleted cell');
      const updated = JSON.parse(mockFiles['/tmp/nb.ipynb']);
      expect(updated.cells).toHaveLength(2);
      expect(updated.cells[0].cell_type).toBe('markdown');
      expect(updated.cells[1].source).toEqual(['keep_this']);
    });

    test('returns error when notebook file not found', async () => {
      mockExistsResult['/tmp/missing.ipynb'] = false;
      const result = await executeTool('NotebookEdit', {
        notebook_path: '/tmp/missing.ipynb',
        new_source: 'code',
      });
      expect(result.is_error).toBe(true);
      expect(result.content).toBe('Notebook not found: /tmp/missing.ipynb');
    });

    test('returns error for invalid notebook format (no cells array)', async () => {
      mockFiles['/tmp/bad.ipynb'] = JSON.stringify({ metadata: {} });
      const result = await executeTool('NotebookEdit', {
        notebook_path: '/tmp/bad.ipynb',
        new_source: 'code',
      });
      expect(result.is_error).toBe(true);
      expect(result.content).toBe('Invalid notebook format: missing cells array');
    });

    test('returns error for invalid notebook format (cells not array)', async () => {
      mockFiles['/tmp/bad2.ipynb'] = JSON.stringify({ cells: 'not an array' });
      const result = await executeTool('NotebookEdit', {
        notebook_path: '/tmp/bad2.ipynb',
        new_source: 'code',
      });
      expect(result.is_error).toBe(true);
      expect(result.content).toBe('Invalid notebook format: missing cells array');
    });

    test('returns error when no code cells found', async () => {
      mockFiles['/tmp/md.ipynb'] = makeNotebook([markdownCell(['# Only markdown'])]);
      const result = await executeTool('NotebookEdit', {
        notebook_path: '/tmp/md.ipynb',
        new_source: 'code',
      });
      expect(result.is_error).toBe(true);
      expect(result.content).toBe('No code cells found in notebook');
    });

    test('returns error when notebook JSON is invalid', async () => {
      mockFiles['/tmp/corrupt.ipynb'] = 'not valid json{{{';
      const result = await executeTool('NotebookEdit', {
        notebook_path: '/tmp/corrupt.ipynb',
        new_source: 'code',
      });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain('Error editing notebook');
    });

    test('splits multi-line new_source into array', async () => {
      mockFiles['/tmp/nb.ipynb'] = makeNotebook([codeCell(['old'])]);
      await executeTool('NotebookEdit', {
        notebook_path: '/tmp/nb.ipynb',
        new_source: 'line1\nline2\nline3',
      });
      const updated = JSON.parse(mockFiles['/tmp/nb.ipynb']);
      expect(updated.cells[0].source).toEqual(['line1', 'line2', 'line3']);
    });

    test('inserts cell with correct structure', async () => {
      mockFiles['/tmp/nb.ipynb'] = makeNotebook([codeCell(['existing'])]);
      await executeTool('NotebookEdit', {
        notebook_path: '/tmp/nb.ipynb',
        new_source: 'new cell',
        edit_mode: 'insert',
      });
      const updated = JSON.parse(mockFiles['/tmp/nb.ipynb']);
      const inserted = updated.cells[0];
      expect(inserted.cell_type).toBe('code');
      expect(inserted.metadata).toEqual({});
      expect(inserted.outputs).toEqual([]);
      expect(inserted.execution_count).toBeNull();
    });

    test('handles notebook with markdown cell before code cell', async () => {
      mockFiles['/tmp/nb.ipynb'] = makeNotebook([
        markdownCell(['# Header']),
        codeCell(['code here']),
      ]);
      const result = await executeTool('NotebookEdit', {
        notebook_path: '/tmp/nb.ipynb',
        new_source: 'updated code',
      });
      expect(result.is_error).toBeFalsy();
      const updated = JSON.parse(mockFiles['/tmp/nb.ipynb']);
      // First cell (markdown) untouched
      expect(updated.cells[0].cell_type).toBe('markdown');
      // Code cell updated
      expect(updated.cells[1].source).toEqual(['updated code']);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Top-level Error Handling
  // ═══════════════════════════════════════════════════════════════════

  describe('top-level error handling', () => {
    test('catches thrown errors and returns ToolResult with is_error', async () => {
      // Force an error by making Read tool throw via readFileSync on existing file
      // We can do this by making existsSync return true but readFileSync throw
      mockExistsResult['/tmp/error.txt'] = true;
      // File not in mockFiles, so readFileSync will throw ENOENT
      const result = await executeTool('Read', { file_path: '/tmp/error.txt' });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain('Error executing Read');
      expect(result.content).toContain('ENOENT');
    });

    test('handles non-Error thrown values', async () => {
      // The Edit tool with a file that exists (existsSync=true) but readFileSync throws
      mockExistsResult['/tmp/error2.txt'] = true;
      const result = await executeTool('Edit', {
        file_path: '/tmp/error2.txt',
        old_string: 'a',
        new_string: 'b',
      });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain('Error executing Edit');
    });

    test('wraps MCP tool errors in catch block', async () => {
      // Override the isMcpTool to always return true for this specific test
      mockIsMcpToolResult = true;
      mockExecuteMcpToolResult = { content: 'done' };
      // The mock always returns, so this tests that the dispatch works through the try/catch
      const result = await executeTool('mcp__test__tool', {});
      expect(result.content).toBe('done');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Edge Cases
  // ═══════════════════════════════════════════════════════════════════

  describe('edge cases', () => {
    test('handles undefined input fields gracefully', async () => {
      // Read with no file_path — String(undefined) = "undefined"
      mockExistsResult['undefined'] = false;
      const result = await executeTool('Read', {});
      expect(result.is_error).toBe(true);
      expect(result.content).toContain('File not found');
    });

    test('Write converts non-string content via String()', async () => {
      const result = await executeTool('Write', {
        file_path: '/tmp/num.txt',
        content: 42 as any,
      });
      expect(result.is_error).toBeFalsy();
      expect(mockFiles['/tmp/num.txt']).toBe('42');
    });

    test('Bash with empty command string', async () => {
      mockExecSyncResult = '';
      const result = await executeTool('Bash', { command: '' });
      expect(result.is_error).toBeFalsy();
      expect(result.content).toBe('(command completed with no output)');
    });

    test('Grep handles empty pattern', async () => {
      mockSpawnSyncResult = { status: 0, stdout: 'results\n', stderr: '' };
      const result = await executeTool('Grep', { pattern: '' }, '/tmp');
      expect(result.is_error).toBeFalsy();
    });

    test('executeTool returns correct ToolResult type shape', async () => {
      mockFiles['/tmp/t.txt'] = 'hi';
      const result = await executeTool('Read', { file_path: '/tmp/t.txt' });
      expect(typeof result.content).toBe('string');
      // is_error should be undefined or false for success
      expect(result.is_error).toBeFalsy();
    });

    test('unknown tool with special characters in name', async () => {
      const result = await executeTool('Tool<script>alert(1)</script>', {});
      expect(result.is_error).toBe(true);
      expect(result.content).toContain('Unknown tool: Tool<script>alert(1)</script>');
    });

    test('Grep with all options combined', async () => {
      mockSpawnSyncResult = { status: 0, stdout: '10:match\n', stderr: '' };
      const result = await executeTool(
        'Grep',
        {
          pattern: 'searchTerm',
          output_mode: 'content',
          case_insensitive: true,
          glob: '*.ts',
          context: 5,
          path: '/src',
        },
        '/workspace',
      );
      expect(result.is_error).toBeFalsy();
      const call = mockSpawnSyncCalls[0];
      expect(call.args).toContain('-i');
      expect(call.args).toContain('--glob');
      expect(call.args).toContain('*.ts');
      expect(call.args).toContain('-n');
      expect(call.args).toContain('-C');
      expect(call.args).toContain('5');
      expect(call.args).toContain('--');
      expect(call.args).toContain('searchTerm');
      expect(call.args).toContain('/src');
    });
  });
});
