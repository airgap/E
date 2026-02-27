import { describe, test, expect } from 'vitest';
import { convertVsCodeSnippets } from '../vscode-snippet-converter';
import type { VsCodeSnippet } from '../vscode-snippet-converter';

describe('convertVsCodeSnippets', () => {
  test('returns empty array for empty input', () => {
    expect(convertVsCodeSnippets({})).toEqual([]);
  });

  test('converts a simple snippet with string prefix and string body', () => {
    const input: Record<string, VsCodeSnippet> = {
      Print: {
        prefix: 'log',
        body: 'console.log($1);$0',
        description: 'Log output',
      },
    };
    const result = convertVsCodeSnippets(input);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      prefix: 'log',
      body: 'console.log($1);${}',
      description: 'Log output',
    });
  });

  test('converts body array to newline-joined string', () => {
    const input: Record<string, VsCodeSnippet> = {
      'For Loop': {
        prefix: 'for',
        body: ['for (let ${1:i} = 0; ${1:i} < ${2:length}; ${1:i}++) {', '\t$0', '}'],
        description: 'For loop',
      },
    };
    const result = convertVsCodeSnippets(input);
    expect(result).toHaveLength(1);
    expect(result[0].body).toBe('for (let ${1:i} = 0; ${1:i} < ${2:length}; ${1:i}++) {\n\t${}\n}');
  });

  test('expands multi-prefix snippet into separate entries', () => {
    const input: Record<string, VsCodeSnippet> = {
      'Arrow Function': {
        prefix: ['af', 'arrow', 'fn'],
        body: 'const ${1:name} = ($2) => {$0};',
      },
    };
    const result = convertVsCodeSnippets(input);
    expect(result).toHaveLength(3);
    expect(result[0].prefix).toBe('af');
    expect(result[1].prefix).toBe('arrow');
    expect(result[2].prefix).toBe('fn');
    // All share the same body
    expect(result[0].body).toBe(result[1].body);
    expect(result[1].body).toBe(result[2].body);
  });

  test('uses snippet name as description when description is missing', () => {
    const input: Record<string, VsCodeSnippet> = {
      'My Snippet': {
        prefix: 'ms',
        body: 'hello',
      },
    };
    const result = convertVsCodeSnippets(input);
    expect(result[0].description).toBe('My Snippet');
  });

  test('replaces $0 with ${} for CodeMirror final cursor', () => {
    const input: Record<string, VsCodeSnippet> = {
      Test: {
        prefix: 't',
        body: 'before $0 after',
      },
    };
    const result = convertVsCodeSnippets(input);
    expect(result[0].body).toBe('before ${} after');
  });

  test('replaces multiple $0 occurrences', () => {
    const input: Record<string, VsCodeSnippet> = {
      Multi: {
        prefix: 'm',
        body: '$0 middle $0',
      },
    };
    const result = convertVsCodeSnippets(input);
    expect(result[0].body).toBe('${} middle ${}');
  });

  test('strips $TM_* template variables', () => {
    const input: Record<string, VsCodeSnippet> = {
      TM: {
        prefix: 'tm',
        body: 'file: $TM_FILENAME, dir: $TM_DIRECTORY',
      },
    };
    const result = convertVsCodeSnippets(input);
    expect(result[0].body).toBe('file: , dir: ');
    expect(result[0].body).not.toContain('$TM_');
  });

  test('strips ${TM_*} template variables with defaults', () => {
    const input: Record<string, VsCodeSnippet> = {
      TMBrace: {
        prefix: 'tmb',
        body: 'name: ${TM_FILENAME:untitled}',
      },
    };
    const result = convertVsCodeSnippets(input);
    expect(result[0].body).toBe('name: ');
    expect(result[0].body).not.toContain('TM_FILENAME');
  });

  test('preserves normal tab stop variables', () => {
    const input: Record<string, VsCodeSnippet> = {
      Tabs: {
        prefix: 'tabs',
        body: '${1:first} ${2:second}',
      },
    };
    const result = convertVsCodeSnippets(input);
    expect(result[0].body).toBe('${1:first} ${2:second}');
  });

  test('skips entries with missing prefix', () => {
    const input = {
      'No Prefix': {
        body: 'hello',
      },
    } as unknown as Record<string, VsCodeSnippet>;
    const result = convertVsCodeSnippets(input);
    expect(result).toHaveLength(0);
  });

  test('skips entries with missing body', () => {
    const input = {
      'No Body': {
        prefix: 'nb',
      },
    } as unknown as Record<string, VsCodeSnippet>;
    const result = convertVsCodeSnippets(input);
    expect(result).toHaveLength(0);
  });

  test('handles a mix of valid and invalid entries', () => {
    const input: Record<string, VsCodeSnippet> = {
      Valid: {
        prefix: 'v',
        body: 'valid',
      },
      Invalid: {} as VsCodeSnippet,
      'Also Valid': {
        prefix: 'av',
        body: 'also valid',
        description: 'Second valid entry',
      },
    };
    const result = convertVsCodeSnippets(input);
    expect(result).toHaveLength(2);
    expect(result[0].prefix).toBe('v');
    expect(result[1].prefix).toBe('av');
  });

  test('handles combined $0 and $TM_* in same body', () => {
    const input: Record<string, VsCodeSnippet> = {
      Combined: {
        prefix: 'c',
        body: '// $TM_FILENAME\nfunction ${1:name}() {\n\t$0\n}',
      },
    };
    const result = convertVsCodeSnippets(input);
    expect(result[0].body).toBe('// \nfunction ${1:name}() {\n\t${}\n}');
  });
});
