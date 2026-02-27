/**
 * Test output parser — detects and parses structured test results from
 * terminal command output (Vitest, Jest, pytest).
 *
 * Returns per-test file/line/status data for the editor gutter.
 */

import { randomUUID } from 'crypto';
import type { TestResult, TestRunResult, TestStatus } from '@e/shared';

// ────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────

/**
 * Attempt to parse test results from command output.
 * Returns null if the output doesn't look like test output.
 */
export function parseTestOutput(
  output: string,
  commandText: string | null,
  cwd: string,
): TestRunResult | null {
  // Fast-reject: only analyze commands that look like test invocations
  if (commandText && !isTestCommand(commandText)) return null;

  // If no command text, check if output itself looks like test output
  if (!commandText && !looksLikeTestOutput(output)) return null;

  // Try parsers in order of specificity
  return (
    parseVitestJsonOutput(output, cwd) ??
    parseJestJsonOutput(output, cwd) ??
    parseVitestVerboseOutput(output, cwd) ??
    parsePytestOutput(output, cwd) ??
    null
  );
}

// ────────────────────────────────────────────────────────────
// Command detection
// ────────────────────────────────────────────────────────────

const TEST_COMMAND_PATTERNS = [
  /\bvitest\b/,
  /\bjest\b/,
  /\bpytest\b/,
  /\bpython\s+.*-m\s+pytest\b/,
  /\bnpm\s+(?:run\s+)?test\b/,
  /\byarn\s+(?:run\s+)?test\b/,
  /\bpnpm\s+(?:run\s+)?test\b/,
  /\bbun\s+test\b/,
  /\bmake\s+test\b/,
  /\bnpx\s+(?:vitest|jest)\b/,
  /\bcargo\s+test\b/,
  /\bgo\s+test\b/,
];

function isTestCommand(commandText: string): boolean {
  const lower = commandText.toLowerCase().trim();
  return TEST_COMMAND_PATTERNS.some((p) => p.test(lower));
}

function looksLikeTestOutput(output: string): boolean {
  // Quick heuristic: does it look like Vitest/Jest/pytest output?
  return (
    /Tests?\s+\d+\s+(?:passed|failed)/i.test(output) ||
    /\b(?:PASS|FAIL)\s+\S+\.(?:test|spec)\./i.test(output) ||
    /={3,}\s*(?:test session starts|FAILURES)/i.test(output) ||
    /Test Suites?:\s+\d+/i.test(output)
  );
}

// ────────────────────────────────────────────────────────────
// Vitest JSON reporter
// ────────────────────────────────────────────────────────────

interface VitestJsonReport {
  testResults?: VitestTestFile[];
  numTotalTests?: number;
  numPassedTests?: number;
  numFailedTests?: number;
  numPendingTests?: number;
  success?: boolean;
  startTime?: number;
}

interface VitestTestFile {
  name: string; // absolute file path
  assertionResults?: VitestAssertionResult[];
  status?: string;
}

interface VitestAssertionResult {
  ancestorTitles?: string[];
  title?: string;
  status?: string; // 'passed' | 'failed' | 'pending' | 'skipped'
  duration?: number;
  location?: { line: number; column: number };
  failureMessages?: string[];
}

function parseVitestJsonOutput(output: string, cwd: string): TestRunResult | null {
  // Vitest/Jest JSON reporter wraps everything in a single JSON object
  const jsonBlock = extractJsonBlock(output);
  if (!jsonBlock) return null;

  let report: VitestJsonReport;
  try {
    report = JSON.parse(jsonBlock);
  } catch {
    return null;
  }

  // Must have testResults array to be a valid test report
  if (!report.testResults || !Array.isArray(report.testResults)) return null;

  const results: TestResult[] = [];

  for (const file of report.testResults) {
    if (!file.assertionResults) continue;
    const filePath = resolveFilePath(file.name, cwd);

    for (const assertion of file.assertionResults) {
      const testName = [...(assertion.ancestorTitles ?? []), assertion.title ?? '']
        .filter(Boolean)
        .join(' > ');

      if (!testName) continue;

      const line = assertion.location?.line ?? 1;
      const status = mapStatus(assertion.status);

      results.push({
        testName,
        status,
        filePath,
        line,
        duration: assertion.duration,
        errorMessage: assertion.failureMessages?.filter(Boolean).join('\n') || undefined,
      });
    }
  }

  if (results.length === 0) return null;

  return buildTestRunResult(results, 'vitest', report.startTime);
}

// ────────────────────────────────────────────────────────────
// Jest JSON reporter (structurally similar but with slight differences)
// ────────────────────────────────────────────────────────────

function parseJestJsonOutput(output: string, cwd: string): TestRunResult | null {
  // Jest JSON format is very similar to Vitest, the Vitest parser covers it.
  // This is a fallback for Jest-specific quirks.
  // For now, the Vitest parser handles both.
  return null;
}

// ────────────────────────────────────────────────────────────
// Vitest / Jest verbose console output
// ────────────────────────────────────────────────────────────

function parseVitestVerboseOutput(output: string, cwd: string): TestRunResult | null {
  const lines = output.split('\n');

  // Detect Vitest/Jest output by looking for PASS/FAIL file headers
  const fileHeaderRe = /^\s*(PASS|FAIL|RUNS?)\s+(.+\.(?:test|spec)\.\w+)/;
  // Test line patterns:
  //   ✓ test name (5ms)        — vitest/jest pass
  //   × test name              — vitest/jest fail
  //   ○ skipped test name      — vitest/jest skip
  //   ✕ test name              — alt fail marker
  const testLineRe = /^\s*([✓✔√×✕✗○◌·])\s+(.+?)(?:\s+\((\d+)\s*m?s\))?\s*$/;
  // Also match text-based markers:
  //   ✓ or √ or PASS => passed
  //   × or ✕ or ✗ or FAIL => failed
  //   ○ or - or skipped => skipped
  const textTestLineRe = /^\s*(pass|fail|skip(?:ped)?)\s+(.+?)(?:\s+\((\d+)\s*m?s\))?\s*$/i;

  const results: TestResult[] = [];
  let currentFile = '';
  let describeStack: string[] = [];
  let foundAnyFile = false;

  for (const line of lines) {
    // File header
    const fileMatch = line.match(fileHeaderRe);
    if (fileMatch) {
      currentFile = resolveFilePath(fileMatch[2].trim(), cwd);
      describeStack = [];
      foundAnyFile = true;
      continue;
    }

    // Describe block (indented with ▸ or >)
    const describeMatch = line.match(/^\s{2,}(▸|>|❯)\s+(.+)$/);
    if (describeMatch) {
      // Determine nesting depth from indentation
      const indent = line.search(/\S/);
      const depth = Math.floor(indent / 2) - 1;
      describeStack = describeStack.slice(0, Math.max(0, depth));
      describeStack.push(describeMatch[2].trim());
      continue;
    }

    if (!currentFile) continue;

    // Test result line (symbol-based)
    const testMatch = line.match(testLineRe) || line.match(textTestLineRe);
    if (testMatch) {
      const marker = testMatch[1];
      const testTitle = testMatch[2].trim();
      const duration = testMatch[3] ? parseInt(testMatch[3]) : undefined;

      let status: TestStatus;
      if (/[✓✔√]|^pass$/i.test(marker)) status = 'passed';
      else if (/[×✕✗]|^fail$/i.test(marker)) status = 'failed';
      else status = 'skipped';

      const testName = [...describeStack, testTitle].join(' > ');

      results.push({
        testName,
        status,
        filePath: currentFile,
        line: 1, // Verbose output doesn't include line numbers
        duration,
      });
    }
  }

  if (!foundAnyFile || results.length === 0) return null;

  // Try to resolve line numbers by scanning test files (best-effort)
  resolveLineNumbers(results);

  return buildTestRunResult(results, 'vitest');
}

// ────────────────────────────────────────────────────────────
// pytest verbose output
// ────────────────────────────────────────────────────────────

function parsePytestOutput(output: string, cwd: string): TestRunResult | null {
  // pytest verbose lines look like:
  //   tests/test_foo.py::TestClass::test_method PASSED   [ 33%]
  //   tests/test_foo.py::test_function FAILED             [ 66%]
  //   tests/test_foo.py::test_skip SKIPPED (reason)       [100%]
  const pytestLineRe = /^\s*(\S+\.py)::(\S+)\s+(PASSED|FAILED|SKIPPED|ERROR|XFAIL|XPASS)(?:\s.*)?$/;

  // Check for pytest session header
  if (!/={3,}\s*test session starts/i.test(output)) return null;

  const lines = output.split('\n');
  const results: TestResult[] = [];

  for (const line of lines) {
    const match = line.match(pytestLineRe);
    if (!match) continue;

    const filePath = resolveFilePath(match[1], cwd);
    const testName = match[2].replace(/::/g, ' > ');
    const rawStatus = match[3];

    let status: TestStatus;
    switch (rawStatus) {
      case 'PASSED':
      case 'XPASS':
        status = 'passed';
        break;
      case 'FAILED':
      case 'ERROR':
        status = 'failed';
        break;
      default:
        status = 'skipped';
        break;
    }

    results.push({
      testName,
      status,
      filePath,
      line: 1, // pytest doesn't include line numbers in verbose output
    });
  }

  if (results.length === 0) return null;

  // Extract summary line for duration: "====== 5 passed in 1.23s ======"
  const summaryMatch = output.match(
    /={3,}\s*(?:(\d+)\s+passed)?(?:,?\s*(\d+)\s+failed)?(?:,?\s*(\d+)\s+skipped)?.*?(?:in\s+([\d.]+)s)?\s*={3,}/,
  );
  const totalDuration = summaryMatch?.[4] ? parseFloat(summaryMatch[4]) * 1000 : 0;

  return buildTestRunResult(results, 'pytest', undefined, totalDuration);
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function extractJsonBlock(text: string): string | null {
  // Find the outermost { ... } JSON block in the output
  // Test runner JSON is typically the entire output or a large portion
  const firstBrace = text.indexOf('{');
  if (firstBrace === -1) return null;

  let depth = 0;
  let lastBrace = -1;
  for (let i = firstBrace; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) {
        lastBrace = i;
        break;
      }
    }
  }

  if (lastBrace === -1) return null;

  const candidate = text.slice(firstBrace, lastBrace + 1);
  // Quick sanity check: must contain "testResults" to be a test report
  if (!candidate.includes('testResults') && !candidate.includes('test_results')) return null;

  return candidate;
}

function resolveFilePath(rawPath: string, cwd: string): string {
  if (!rawPath) return rawPath;
  // Already absolute
  if (rawPath.startsWith('/')) return rawPath;
  // Strip leading ./ if present
  const clean = rawPath.replace(/^\.\//, '');
  return `${cwd.replace(/\/$/, '')}/${clean}`;
}

function mapStatus(raw: string | undefined): TestStatus {
  switch (raw?.toLowerCase()) {
    case 'passed':
      return 'passed';
    case 'failed':
      return 'failed';
    case 'skipped':
      return 'skipped';
    case 'pending':
    case 'todo':
      return 'pending';
    default:
      return 'pending';
  }
}

/**
 * Best-effort line number resolution for verbose output parsers.
 * Groups results by file and tries to read the test file to find
 * `it(`, `test(`, `describe(` patterns matching the test name.
 *
 * This is a heuristic — it won't be perfect, but it's better than line 1.
 */
function resolveLineNumbers(results: TestResult[]): void {
  const { readFileSync } = require('fs') as typeof import('fs');

  // Group by file
  const byFile = new Map<string, TestResult[]>();
  for (const r of results) {
    if (r.line !== 1) continue; // Already has a real line number
    const arr = byFile.get(r.filePath) ?? [];
    arr.push(r);
    byFile.set(r.filePath, arr);
  }

  for (const [filePath, fileResults] of byFile) {
    let fileContent: string;
    try {
      fileContent = readFileSync(filePath, 'utf-8');
    } catch {
      continue; // Can't read the file, leave line as 1
    }

    const fileLines = fileContent.split('\n');

    for (const result of fileResults) {
      // Extract the innermost test title (last segment after " > ")
      const parts = result.testName.split(' > ');
      const testTitle = parts[parts.length - 1];
      if (!testTitle) continue;

      // Escape special regex characters in test title
      const escaped = testTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      // Look for it('title', test('title', etc.
      const testDefRe = new RegExp(`(?:it|test|describe)\\s*\\(\\s*(['"\`])${escaped}\\1`);

      for (let i = 0; i < fileLines.length; i++) {
        if (testDefRe.test(fileLines[i])) {
          result.line = i + 1; // 1-based
          break;
        }
      }
    }
  }
}

function buildTestRunResult(
  results: TestResult[],
  runner: TestRunResult['runner'],
  startTime?: number,
  totalDuration?: number,
): TestRunResult {
  const passed = results.filter((r) => r.status === 'passed').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const skipped = results.filter((r) => r.status === 'skipped' || r.status === 'pending').length;

  const duration = totalDuration ?? results.reduce((sum, r) => sum + (r.duration ?? 0), 0);

  return {
    id: randomUUID(),
    timestamp: startTime ?? Date.now(),
    runner,
    sessionId: '', // Filled in by terminal-session-manager
    blockId: '', // Filled in by terminal-session-manager
    results,
    summary: {
      total: results.length,
      passed,
      failed,
      skipped,
      duration,
    },
  };
}
