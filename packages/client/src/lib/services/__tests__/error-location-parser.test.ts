import { describe, test, expect } from 'vitest';
import {
  parseTypeScriptErrors,
  parseEslintErrors,
  parsePythonTracebacks,
  parseRustErrors,
  parseGoErrors,
  parseGenericErrors,
  parseAll,
} from '../error-location-parser';

// ── TypeScript / JavaScript ──

describe('parseTypeScriptErrors', () => {
  test('parses tsc parenthesized format: file.ts(line,col): error ...', () => {
    const result = parseTypeScriptErrors(
      "src/foo.ts(12,5): error TS2322: Type 'x' is not assignable to type 'y'.",
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      file: 'src/foo.ts',
      line: 12,
      col: 5,
      message: "error TS2322: Type 'x' is not assignable to type 'y'.",
      source: 'typescript',
    });
  });

  test('parses tsc colon format: file.ts:line:col - error ...', () => {
    const result = parseTypeScriptErrors(
      "src/foo.ts:12:5 - error TS2322: Type 'x' is not assignable to type 'y'.",
    );
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe('src/foo.ts');
    expect(result[0].line).toBe(12);
    expect(result[0].col).toBe(5);
    expect(result[0].source).toBe('typescript');
  });

  test('parses Node.js stack trace', () => {
    const result = parseTypeScriptErrors('    at Object.<anonymous> (/home/user/src/foo.ts:12:5)');
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe('/home/user/src/foo.ts');
    expect(result[0].line).toBe(12);
    expect(result[0].col).toBe(5);
    expect(result[0].message).toBeUndefined();
  });

  test('parses esbuild/vite style: file.ts:line:col', () => {
    const result = parseTypeScriptErrors('  src/components/App.tsx:42:10');
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe('src/components/App.tsx');
    expect(result[0].line).toBe(42);
    expect(result[0].col).toBe(10);
  });

  test('parses esbuild style with message', () => {
    const result = parseTypeScriptErrors('src/foo.ts:12:5: Unexpected token');
    expect(result).toHaveLength(1);
    expect(result[0].message).toBe('Unexpected token');
  });

  test('handles multiple errors in text', () => {
    const text = ['src/a.ts(1,1): error TS1: first', 'src/b.tsx(2,3): error TS2: second'].join(
      '\n',
    );
    const result = parseTypeScriptErrors(text);
    expect(result).toHaveLength(2);
  });

  test('handles .vue and .svelte extensions', () => {
    const result = parseTypeScriptErrors('src/App.svelte(5,10): error TS1: oops');
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe('src/App.svelte');
  });

  test('returns empty for non-matching text', () => {
    expect(parseTypeScriptErrors('just some normal text')).toEqual([]);
  });
});

// ── ESLint / Biome ──

describe('parseEslintErrors', () => {
  test('parses ESLint default formatter with file header + indented errors', () => {
    const text = [
      '/home/user/src/foo.ts',
      '  12:5  error  Unexpected any  @typescript-eslint/no-explicit-any',
      '  20:1  warning  Missing return type  @typescript-eslint/explicit-function-return-type',
    ].join('\n');

    const result = parseEslintErrors(text);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      file: '/home/user/src/foo.ts',
      line: 12,
      col: 5,
      message: 'Unexpected any',
      source: 'eslint',
    });
    expect(result[1].line).toBe(20);
  });

  test('parses ESLint compact format: file:line:col: message', () => {
    const result = parseEslintErrors(
      'src/foo.ts:12:5: Unexpected any [Error/@typescript-eslint/no-explicit-any]',
    );
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe('src/foo.ts');
    expect(result[0].line).toBe(12);
    expect(result[0].col).toBe(5);
  });

  test('resets current file on non-matching non-empty line', () => {
    const text = [
      '/home/user/src/foo.ts',
      'some random line',
      '  12:5  error  Should not match  rule',
    ].join('\n');

    const result = parseEslintErrors(text);
    // The indented line should not match because currentFile was reset
    expect(result).toHaveLength(0);
  });

  test('handles multiple files in sequence', () => {
    const text = [
      '/home/user/src/a.ts',
      '  1:1  error  First error  rule-a',
      '',
      '/home/user/src/b.ts',
      '  2:2  error  Second error  rule-b',
    ].join('\n');

    const result = parseEslintErrors(text);
    expect(result).toHaveLength(2);
    expect(result[0].file).toBe('/home/user/src/a.ts');
    expect(result[1].file).toBe('/home/user/src/b.ts');
  });

  test('returns empty for non-matching text', () => {
    expect(parseEslintErrors('no errors here')).toEqual([]);
  });
});

// ── Python ──

describe('parsePythonTracebacks', () => {
  test('parses standard Python traceback', () => {
    const text = [
      'Traceback (most recent call last):',
      '  File "/home/user/app.py", line 42, in main',
      '    some_function()',
      "TypeError: 'NoneType' object is not callable",
    ].join('\n');

    const result = parsePythonTracebacks(text);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      file: '/home/user/app.py',
      line: 42,
      message: "TypeError: 'NoneType' object is not callable",
      source: 'python',
    });
  });

  test('parses pytest short format', () => {
    const result = parsePythonTracebacks('app/test_foo.py:42: AssertionError');
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe('app/test_foo.py');
    expect(result[0].line).toBe(42);
    expect(result[0].message).toBe('AssertionError');
  });

  test('handles traceback without error class message', () => {
    const text = [
      '  File "/home/user/app.py", line 10, in func',
      '    x = foo()',
      '    bar(x)',
    ].join('\n');

    const result = parsePythonTracebacks(text);
    expect(result).toHaveLength(1);
    expect(result[0].message).toBeUndefined();
  });

  test('returns empty for non-matching text', () => {
    expect(parsePythonTracebacks('no python errors')).toEqual([]);
  });
});

// ── Rust ──

describe('parseRustErrors', () => {
  test('parses rust compiler error with arrow location', () => {
    const text = ['error[E0308]: mismatched types', '  --> src/main.rs:12:5'].join('\n');

    const result = parseRustErrors(text);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      file: 'src/main.rs',
      line: 12,
      col: 5,
      message: 'mismatched types',
      source: 'rust',
    });
  });

  test('parses warning with arrow location', () => {
    const text = ['warning: unused variable', '  --> src/lib.rs:5:9'].join('\n');

    const result = parseRustErrors(text);
    expect(result).toHaveLength(1);
    expect(result[0].message).toBe('unused variable');
  });

  test('handles arrow without preceding error/warning', () => {
    const result = parseRustErrors('  --> src/main.rs:1:1');
    expect(result).toHaveLength(1);
    expect(result[0].message).toBeUndefined();
  });

  test('handles multiple errors', () => {
    const text = [
      'error[E0308]: first error',
      '  --> src/a.rs:1:1',
      'error[E0308]: second error',
      '  --> src/b.rs:2:2',
    ].join('\n');

    const result = parseRustErrors(text);
    expect(result).toHaveLength(2);
  });

  test('returns empty for non-matching text', () => {
    expect(parseRustErrors('no rust errors')).toEqual([]);
  });
});

// ── Go ──

describe('parseGoErrors', () => {
  test('parses go compiler error with col', () => {
    const result = parseGoErrors('./main.go:12:5: undefined: foo');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      file: 'main.go',
      line: 12,
      col: 5,
      message: 'undefined: foo',
      source: 'go',
    });
  });

  test('parses go error without col', () => {
    const result = parseGoErrors('main.go:12: cannot use x (type int) as type string');
    expect(result).toHaveLength(1);
    expect(result[0].col).toBeUndefined();
    expect(result[0].message).toContain('cannot use x');
  });

  test('handles multiple go errors', () => {
    const text = ['./main.go:1:1: first error', './util.go:2:2: second error'].join('\n');

    const result = parseGoErrors(text);
    expect(result).toHaveLength(2);
  });

  test('returns empty for non-matching text', () => {
    expect(parseGoErrors('no go errors')).toEqual([]);
  });
});

// ── Generic ──

describe('parseGenericErrors', () => {
  test('parses generic file:line:col pattern', () => {
    const result = parseGenericErrors('config.yaml:10:3');
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe('config.yaml');
    expect(result[0].line).toBe(10);
    expect(result[0].col).toBe(3);
    expect(result[0].source).toBe('generic');
  });

  test('parses file:line without col', () => {
    const result = parseGenericErrors('script.sh:42');
    expect(result).toHaveLength(1);
    expect(result[0].col).toBeUndefined();
  });

  test('matches many file extensions', () => {
    const extensions = ['py', 'rs', 'go', 'rb', 'java', 'c', 'cpp', 'json', 'toml'];
    for (const ext of extensions) {
      const result = parseGenericErrors(`file.${ext}:10`);
      expect(result).toHaveLength(1);
    }
  });

  test('returns empty for text without file:line patterns', () => {
    expect(parseGenericErrors('just some text')).toEqual([]);
  });
});

// ── Combined parseAll ──

describe('parseAll', () => {
  test('deduplicates results from multiple parsers', () => {
    // This matches both TypeScript parser and generic parser
    const text = 'src/foo.ts:12:5: some error';
    const result = parseAll(text);

    // Should only appear once (TypeScript parser takes priority)
    const fooCounts = result.filter((r) => r.file === 'src/foo.ts' && r.line === 12);
    expect(fooCounts).toHaveLength(1);
  });

  test('specific parsers take priority over generic', () => {
    const text = 'src/foo.ts:12:5: some error';
    const result = parseAll(text);

    const entry = result.find((r) => r.file === 'src/foo.ts');
    // Should be from typescript parser, not generic
    expect(entry?.source).toBe('typescript');
  });

  test('combines results from different parsers', () => {
    const text = [
      "src/foo.ts(1,1): error TS2322: Type 'x' is not assignable",
      './main.go:5:3: undefined: bar',
    ].join('\n');

    const result = parseAll(text);
    expect(result.length).toBeGreaterThanOrEqual(2);

    const tsResult = result.find((r) => r.source === 'typescript');
    const goResult = result.find((r) => r.source === 'go');
    expect(tsResult).toBeDefined();
    expect(goResult).toBeDefined();
  });

  test('returns empty for text with no errors', () => {
    expect(parseAll('Everything is fine, no errors here.')).toEqual([]);
  });

  test('handles empty string', () => {
    expect(parseAll('')).toEqual([]);
  });
});
