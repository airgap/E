/**
 * AI Test Generation — generates unit tests for functions using LLM.
 *
 * POST /api/tests/generate
 *   Body: { code, functionName, filePath, language, testFramework? }
 *   Returns: { ok, data: { testCode, testFile, framework } }
 */

import { Hono } from 'hono';
import { callLlm } from '../services/llm-oneshot';
import { basename, dirname, extname, join } from 'path';

const SYSTEM_PROMPT = `You are an expert test writer. Generate comprehensive unit tests for the provided code.

Guidelines:
- Write tests that cover happy paths, edge cases, and error conditions
- Use the specified test framework and style conventions
- Include descriptive test names that explain the expected behavior
- Keep tests focused and isolated
- Use appropriate mocking where needed
- Follow the testing conventions of the project

Return ONLY the test code, no markdown fencing, no explanation. The code should be ready to save directly to a test file.`;

const app = new Hono();

app.post('/generate', async (c) => {
  const body = await c.req.json();
  const { code, functionName, filePath, language, testFramework } = body as {
    code: string;
    functionName?: string;
    filePath: string;
    language?: string;
    testFramework?: string;
  };

  if (!code || !filePath) {
    return c.json({ ok: false, error: 'code and filePath required' }, 400);
  }

  const framework = testFramework || detectFramework(filePath);
  const lang = language || detectLanguage(filePath);

  const userPrompt = [
    `Language: ${lang}`,
    `Test Framework: ${framework}`,
    `Source File: ${filePath}`,
    functionName ? `Function to test: ${functionName}` : '',
    '',
    'Source code:',
    code.slice(0, 8000),
    '',
    `Generate tests using ${framework}. Import from the source file using a relative import.`,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    let testCode = await callLlm({
      system: SYSTEM_PROMPT,
      user: userPrompt,
      timeoutMs: 60_000,
    });

    // Strip markdown fencing if present
    testCode = testCode.replace(/^```\w*\n?/, '').replace(/\n?```\s*$/, '');

    // Determine the test file path
    const testFile = suggestTestFilePath(filePath);

    return c.json({
      ok: true,
      data: { testCode, testFile, framework },
    });
  } catch (err) {
    return c.json(
      {
        ok: false,
        error: `Test generation failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      500,
    );
  }
});

function detectFramework(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if (['.py'].includes(ext)) return 'pytest';
  if (['.rs'].includes(ext)) return 'cargo test';
  if (['.go'].includes(ext)) return 'go test';
  return 'vitest';
}

function detectLanguage(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.ts': 'TypeScript',
    '.tsx': 'TypeScript/React',
    '.js': 'JavaScript',
    '.jsx': 'JavaScript/React',
    '.py': 'Python',
    '.rs': 'Rust',
    '.go': 'Go',
    '.svelte': 'Svelte',
  };
  return map[ext] || 'TypeScript';
}

function suggestTestFilePath(sourcePath: string): string {
  const dir = dirname(sourcePath);
  const ext = extname(sourcePath);
  const name = basename(sourcePath, ext);

  // If already in a __tests__ directory or has .test. in name, use as-is
  if (dir.includes('__tests__') || name.includes('.test') || name.includes('.spec')) {
    return sourcePath;
  }

  // Suggest a .test file in the same directory
  return join(dir, `${name}.test${ext}`);
}

export { app as testGenerateRoutes };
