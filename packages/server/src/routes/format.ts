/**
 * format.ts — Server route for external formatter fallback.
 *
 * POST /api/format
 *
 * Runs an external formatter (Prettier, Black, gofmt, rustfmt, etc.)
 * on a file when LSP formatting is not available.
 */

import { Hono } from 'hono';
import { spawn } from 'child_process';
import { readFile, writeFile } from 'fs/promises';
import { findFormatterForLanguage, detectFormatters } from '../services/formatter-detector';

const app = new Hono();

/**
 * POST /format — Format a file using an external formatter.
 *
 * Body: { filePath: string, language: string, workspacePath: string }
 * Returns: { ok: true, data: { formatted: true, formatter: string } }
 */
app.post('/', async (c) => {
  let body: {
    filePath: string;
    language: string;
    workspacePath: string;
  };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const { filePath, language, workspacePath } = body;

  if (!filePath || !language || !workspacePath) {
    return c.json({ ok: false, error: 'filePath, language, and workspacePath are required' }, 400);
  }

  const formatter = findFormatterForLanguage(workspacePath, language);
  if (!formatter) {
    return c.json(
      {
        ok: false,
        error: `No formatter found for language: ${language}`,
      },
      404,
    );
  }

  try {
    // Read original content for backup
    const originalContent = await readFile(filePath, 'utf-8');

    // Run the formatter
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(formatter.command, [...formatter.args, filePath], {
        cwd: workspacePath,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 15_000,
      });

      let stderr = '';
      proc.stderr?.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`${formatter.name} exited with code ${code}: ${stderr.slice(0, 500)}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to spawn ${formatter.name}: ${err.message}`));
      });
    });

    return c.json({
      ok: true,
      data: { formatted: true, formatter: formatter.name },
    });
  } catch (err: any) {
    return c.json(
      {
        ok: false,
        error: err?.message || 'Formatting failed',
      },
      500,
    );
  }
});

/**
 * GET /format/formatters — List available formatters for a workspace.
 */
app.get('/formatters', (c) => {
  const workspacePath = c.req.query('workspacePath');
  if (!workspacePath) {
    return c.json({ ok: false, error: 'workspacePath query param required' }, 400);
  }

  const formatters = detectFormatters(workspacePath);
  return c.json({
    ok: true,
    data: {
      formatters: formatters.map((f) => ({
        name: f.name,
        languages: f.languages,
      })),
    },
  });
});

export { app as formatRoutes };
