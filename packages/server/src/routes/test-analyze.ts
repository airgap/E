/**
 * Test Analysis Routes — finds affected tests and provides test-related analysis.
 *
 * POST /api/tests/affected — Find test files affected by changed files
 * POST /api/tests/run — Run a specific test file or test name
 */

import { Hono } from 'hono';
import { findAffectedTests } from '../services/test-analyzer';

const app = new Hono();

/**
 * Find test files affected by a set of changed files.
 * Uses import graph analysis to find direct and transitive dependencies.
 */
app.post('/affected', async (c) => {
  const body = await c.req.json();
  const { rootPath, changedFiles, maxDepth } = body as {
    rootPath: string;
    changedFiles: string[];
    maxDepth?: number;
  };

  if (!rootPath || !changedFiles || !Array.isArray(changedFiles)) {
    return c.json({ ok: false, error: 'rootPath and changedFiles[] required' }, 400);
  }

  try {
    const affected = await findAffectedTests(rootPath, changedFiles, maxDepth ?? 5);
    return c.json({ ok: true, data: { affected, total: affected.length } });
  } catch (err) {
    return c.json(
      {
        ok: false,
        error: `Analysis failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      500,
    );
  }
});

/**
 * Run a specific test. Spawns the test runner for the given file/test.
 * Returns the command that was executed (actual execution happens in terminal).
 */
app.post('/run', async (c) => {
  const body = await c.req.json();
  const { rootPath, testFile, testName, framework } = body as {
    rootPath: string;
    testFile: string;
    testName?: string;
    framework?: string;
  };

  if (!rootPath || !testFile) {
    return c.json({ ok: false, error: 'rootPath and testFile required' }, 400);
  }

  // Detect test framework and build command
  const cmd = buildTestCommand(testFile, testName, framework);

  return c.json({ ok: true, data: { command: cmd, testFile, testName } });
});

/**
 * Build a test runner command for the given file/test.
 */
function buildTestCommand(testFile: string, testName?: string, framework?: string): string {
  const fw = framework || detectFramework(testFile);

  switch (fw) {
    case 'vitest':
      return testName
        ? `npx vitest run ${testFile} -t "${testName}"`
        : `npx vitest run ${testFile}`;
    case 'jest':
      return testName ? `npx jest ${testFile} -t "${testName}"` : `npx jest ${testFile}`;
    case 'mocha':
      return testName ? `npx mocha ${testFile} --grep "${testName}"` : `npx mocha ${testFile}`;
    case 'pytest':
      return testName
        ? `python -m pytest ${testFile} -k "${testName}" -v`
        : `python -m pytest ${testFile} -v`;
    case 'bun':
      return testName ? `bun test ${testFile} -t "${testName}"` : `bun test ${testFile}`;
    default:
      return `npx vitest run ${testFile}`;
  }
}

function detectFramework(testFile: string): string {
  if (testFile.endsWith('.py')) return 'pytest';
  // Default to vitest for JS/TS (most common in modern projects)
  return 'vitest';
}

export { app as testAnalyzeRoutes };
