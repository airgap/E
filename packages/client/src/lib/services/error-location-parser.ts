/**
 * error-location-parser.ts — Parse error locations from terminal output.
 *
 * Supports:
 * - TypeScript / JavaScript (tsc, node, esbuild, swc, vite)
 * - ESLint / Biome
 * - Python tracebacks
 * - Rust (rustc, cargo)
 * - Go (go build, go vet)
 * - Generic `file:line:col` patterns
 *
 * Each parser returns an array of ErrorLocation objects. The `parseAll()`
 * convenience function runs every parser and deduplicates results.
 */

// ── Types ──

export interface ErrorLocation {
  /** Absolute or relative file path */
  file: string;
  /** 1-based line number */
  line: number;
  /** 1-based column number (optional) */
  col?: number;
  /** Error/warning message text */
  message?: string;
  /** Which parser found this */
  source: 'typescript' | 'eslint' | 'python' | 'rust' | 'go' | 'generic';
}

// ── TypeScript / JavaScript ──

/**
 * TypeScript compiler (`tsc`) and bundler errors:
 *   src/foo.ts(12,5): error TS2322: Type 'x' is not assignable to type 'y'.
 *   src/foo.ts:12:5 - error TS2322: Type 'x' is not assignable to type 'y'.
 *
 * Also matches esbuild/vite style:
 *   ✘ [ERROR] ... [plugin:vite:...]
 *   src/foo.ts:12:5:
 *
 * And Node.js stack traces:
 *   at Object.<anonymous> (/home/user/src/foo.ts:12:5)
 */
const TS_PARENS_RE =
  /^([^\s()]+\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts|vue|svelte))\((\d+),(\d+)\):\s*(.*)/;
const TS_COLON_RE =
  /^([^\s()]+\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts|vue|svelte)):(\d+):(\d+)\s*[-–—]\s*(.*)/;
const NODE_STACK_RE = /at\s+.*\(([^\s()]+\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)):(\d+):(\d+)\)/;
const ESBUILD_RE =
  /^\s*([^\s()]+\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts|vue|svelte)):(\d+):(\d+)(?::?\s*(.*))?$/;

export function parseTypeScriptErrors(text: string): ErrorLocation[] {
  const results: ErrorLocation[] = [];
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // tsc parenthesized format: file.ts(line,col): error ...
    let m = TS_PARENS_RE.exec(line);
    if (m) {
      results.push({
        file: m[1],
        line: parseInt(m[2], 10),
        col: parseInt(m[3], 10),
        message: m[4].trim(),
        source: 'typescript',
      });
      continue;
    }

    // tsc colon format: file.ts:line:col - error ...
    m = TS_COLON_RE.exec(line);
    if (m) {
      results.push({
        file: m[1],
        line: parseInt(m[2], 10),
        col: parseInt(m[3], 10),
        message: m[4].trim(),
        source: 'typescript',
      });
      continue;
    }

    // Node.js stack trace: at ... (file.ts:line:col)
    m = NODE_STACK_RE.exec(line);
    if (m) {
      results.push({
        file: m[1],
        line: parseInt(m[2], 10),
        col: parseInt(m[3], 10),
        source: 'typescript',
      });
      continue;
    }

    // esbuild/vite style: file.ts:line:col
    m = ESBUILD_RE.exec(line);
    if (m) {
      results.push({
        file: m[1],
        line: parseInt(m[2], 10),
        col: parseInt(m[3], 10),
        message: m[4]?.trim() || undefined,
        source: 'typescript',
      });
    }
  }

  return results;
}

// ── ESLint / Biome ──

/**
 * ESLint default formatter:
 *   /home/user/src/foo.ts
 *     12:5  error  Unexpected any  @typescript-eslint/no-explicit-any
 *
 * ESLint compact/stylish:
 *   src/foo.ts:12:5: Unexpected any [Error/@typescript-eslint/no-explicit-any]
 *
 * Biome:
 *   src/foo.ts:12:5 lint/suspicious/noExplicitAny ━━━━━━━━━━
 */
const ESLINT_FILE_HEADER_RE = /^(\/[^\s]+\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts|vue|svelte))\s*$/;
const ESLINT_INDENT_RE = /^\s+(\d+):(\d+)\s+(error|warning)\s+(.*?)(?:\s{2,}(.*))?$/;
const ESLINT_COMPACT_RE =
  /^([^\s]+\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts|vue|svelte)):(\d+):(\d+):\s*(.*)/;

export function parseEslintErrors(text: string): ErrorLocation[] {
  const results: ErrorLocation[] = [];
  const lines = text.split('\n');
  let currentFile: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // File header line (absolute path alone on a line)
    const fileMatch = ESLINT_FILE_HEADER_RE.exec(line);
    if (fileMatch) {
      currentFile = fileMatch[1];
      continue;
    }

    // Indented error line under a file header
    if (currentFile) {
      const indentMatch = ESLINT_INDENT_RE.exec(line);
      if (indentMatch) {
        results.push({
          file: currentFile,
          line: parseInt(indentMatch[1], 10),
          col: parseInt(indentMatch[2], 10),
          message: indentMatch[4].trim(),
          source: 'eslint',
        });
        continue;
      }
      // Reset current file if we hit a non-matching, non-empty line
      if (line.trim() && !line.startsWith(' ')) {
        currentFile = null;
      }
    }

    // Compact format: file:line:col: message
    const compactMatch = ESLINT_COMPACT_RE.exec(line);
    if (compactMatch) {
      results.push({
        file: compactMatch[1],
        line: parseInt(compactMatch[2], 10),
        col: parseInt(compactMatch[3], 10),
        message: compactMatch[4].trim(),
        source: 'eslint',
      });
    }
  }

  return results;
}

// ── Python ──

/**
 * Python tracebacks:
 *   File "/home/user/app.py", line 42, in main
 *     some_function()
 *   TypeError: 'NoneType' object is not callable
 *
 * Also pytest:
 *   app/test_foo.py:42: AssertionError
 */
const PYTHON_FILE_RE = /File "([^"]+)", line (\d+)/;
const PYTEST_RE = /^([^\s]+\.py):(\d+):\s*(.*)/;

export function parsePythonTracebacks(text: string): ErrorLocation[] {
  const results: ErrorLocation[] = [];
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Standard Python traceback
    const m = PYTHON_FILE_RE.exec(line);
    if (m) {
      // Try to get the error message from lines after the source line
      let message: string | undefined;
      // Look ahead for the actual error (skip the source code line)
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const ahead = lines[j].trim();
        if (ahead && !ahead.startsWith('File ') && !ahead.startsWith('^')) {
          // Check if this looks like an error class (e.g. "TypeError: ...")
          if (/^[A-Z]\w*(Error|Exception|Warning):/.test(ahead)) {
            message = ahead;
            break;
          }
        }
      }

      results.push({
        file: m[1],
        line: parseInt(m[2], 10),
        message,
        source: 'python',
      });
      continue;
    }

    // pytest short format: file.py:line: ErrorType
    const pm = PYTEST_RE.exec(line);
    if (pm) {
      results.push({
        file: pm[1],
        line: parseInt(pm[2], 10),
        message: pm[3].trim(),
        source: 'python',
      });
    }
  }

  return results;
}

// ── Rust ──

/**
 * Rust compiler:
 *   error[E0308]: mismatched types
 *    --> src/main.rs:12:5
 *
 * Cargo test:
 *   test result: FAILED. 1 failed;
 *   --- src/lib.rs:42:5
 */
const RUST_ARROW_RE = /^\s*--> ([^\s]+):(\d+):(\d+)/;
const RUST_ERROR_RE = /^(error|warning)(?:\[E\d+\])?:\s*(.*)/;

export function parseRustErrors(text: string): ErrorLocation[] {
  const results: ErrorLocation[] = [];
  const lines = text.split('\n');
  let currentMessage: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Error/warning header: error[E0308]: mismatched types
    const errMatch = RUST_ERROR_RE.exec(line.trim());
    if (errMatch) {
      currentMessage = errMatch[2].trim();
      continue;
    }

    // Arrow location: --> src/main.rs:12:5
    const arrowMatch = RUST_ARROW_RE.exec(line);
    if (arrowMatch) {
      results.push({
        file: arrowMatch[1],
        line: parseInt(arrowMatch[2], 10),
        col: parseInt(arrowMatch[3], 10),
        message: currentMessage,
        source: 'rust',
      });
      currentMessage = undefined;
    }
  }

  return results;
}

// ── Go ──

/**
 * Go compiler:
 *   ./main.go:12:5: undefined: foo
 *   main.go:12: cannot use x (type int) as type string
 *
 * Go vet / golint:
 *   main.go:12:5: assignment copies lock value
 */
const GO_ERROR_RE = /^\.?\/?([\w/.@_-]+\.go):(\d+)(?::(\d+))?:\s*(.*)/;

export function parseGoErrors(text: string): ErrorLocation[] {
  const results: ErrorLocation[] = [];
  const lines = text.split('\n');

  for (const line of lines) {
    const m = GO_ERROR_RE.exec(line.trim());
    if (m) {
      results.push({
        file: m[1],
        line: parseInt(m[2], 10),
        col: m[3] ? parseInt(m[3], 10) : undefined,
        message: m[4].trim(),
        source: 'go',
      });
    }
  }

  return results;
}

// ── Generic file:line:col ──

/**
 * Catches any remaining file:line or file:line:col patterns not matched
 * by the language-specific parsers above. Requires a recognizable file
 * extension to avoid false positives.
 */
const GENERIC_FILE_LINE_RE =
  /(?:^|\s)([\w./@_-]+\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts|py|rs|go|rb|java|kt|c|cpp|h|hpp|cs|swift|lua|sh|bash|zsh|yml|yaml|toml|json|svelte|vue|astro)):(\d+)(?::(\d+))?/;

export function parseGenericErrors(text: string): ErrorLocation[] {
  const results: ErrorLocation[] = [];
  const lines = text.split('\n');

  for (const line of lines) {
    const m = GENERIC_FILE_LINE_RE.exec(line);
    if (m) {
      results.push({
        file: m[1],
        line: parseInt(m[2], 10),
        col: m[3] ? parseInt(m[3], 10) : undefined,
        source: 'generic',
      });
    }
  }

  return results;
}

// ── Combined Parser ──

/**
 * Run all language-specific parsers and deduplicate results.
 *
 * Results are ordered by source specificity (language-specific first,
 * generic last) and deduplicated by file+line+col.
 */
export function parseAll(text: string): ErrorLocation[] {
  // Run specific parsers first (higher priority)
  const specific = [
    ...parseTypeScriptErrors(text),
    ...parseEslintErrors(text),
    ...parsePythonTracebacks(text),
    ...parseRustErrors(text),
    ...parseGoErrors(text),
  ];

  // Run generic parser for anything missed
  const generic = parseGenericErrors(text);

  // Deduplicate: specific parsers take priority
  const seen = new Set<string>();
  const results: ErrorLocation[] = [];

  for (const loc of specific) {
    const key = `${loc.file}:${loc.line}:${loc.col ?? 0}`;
    if (!seen.has(key)) {
      seen.add(key);
      results.push(loc);
    }
  }

  for (const loc of generic) {
    const key = `${loc.file}:${loc.line}:${loc.col ?? 0}`;
    if (!seen.has(key)) {
      seen.add(key);
      results.push(loc);
    }
  }

  return results;
}
