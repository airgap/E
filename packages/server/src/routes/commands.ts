import { Hono } from 'hono';
import { getDb } from '../db/database';
import { writeFile, stat } from 'fs/promises';
import { join } from 'path';

const app = new Hono();

/**
 * Execute a slash command that requires backend processing.
 * Currently supports /compact, /init, and /e-init.
 */
app.post('/:conversationId/execute', async (c) => {
  const conversationId = c.req.param('conversationId');
  const body = await c.req.json();
  const { command } = body;

  const db = getDb();
  const conv = db.query('SELECT * FROM conversations WHERE id = ?').get(conversationId) as any;
  if (!conv) return c.json({ ok: false, error: 'Conversation not found' }, 404);

  switch (command) {
    case 'compact': {
      // Compact is handled by sending /compact as a message to the CLI
      // The CLI handles this natively via the slash command
      return c.json({ ok: true, data: { action: 'send_message', message: '/compact' } });
    }

    case 'init': {
      // Init creates a CLAUDE.md in the project directory
      const cwd = conv.workspace_path || process.cwd();
      const proc = Bun.spawn(['claude', '/init'], {
        cwd,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const output = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;
      return c.json({
        ok: exitCode === 0,
        data: { output: output.trim() },
        error: exitCode !== 0 ? `Process exited with code ${exitCode}` : undefined,
      });
    }

    case 'e-init': {
      // Creates an E.md file in the project directory
      const cwd = conv.workspace_path || process.cwd();
      const eMdPath = join(cwd, 'E.md');
      try {
        await stat(eMdPath);
        return c.json({
          ok: false,
          error: 'E.md already exists in this project',
        });
      } catch {
        // File doesn't exist, create it
      }
      const defaultContent = `# E.md — Project Guide\n\n## Overview\n\nDescribe your project here.\n\n## Conventions\n\n- List coding conventions\n- Style guidelines\n- Naming patterns\n\n## Architecture\n\n- Key architectural decisions\n- Important patterns\n\n## Common Patterns\n\n- Frequently used patterns in this codebase\n`;
      await writeFile(eMdPath, defaultContent, 'utf-8');
      return c.json({
        ok: true,
        data: { output: `Created E.md in ${cwd}`, path: eMdPath },
      });
    }

    default:
      return c.json({ ok: false, error: `Unknown command: ${command}` }, 400);
  }
});

export { app as commandRoutes };
