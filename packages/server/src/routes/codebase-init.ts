import { Hono } from 'hono';
import { codebaseInit } from '../services/codebase-init';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

export const codebaseInitRoutes = new Hono();

// Scan a workspace and return profile
codebaseInitRoutes.post('/scan', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const workspacePath = body.workspacePath || '.';
    const result = codebaseInit.scan(workspacePath, body.config);
    return c.json({ ok: true, result });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 400);
  }
});

// Scan and write rules file
codebaseInitRoutes.post('/init', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const workspacePath = body.workspacePath || '.';
    const result = codebaseInit.scan(workspacePath, body.config);

    // Write .e/rules.md
    const eDir = join(workspacePath, '.e');
    mkdirSync(eDir, { recursive: true });
    const rulesPath = join(eDir, 'rules.md');

    if (existsSync(rulesPath) && !body.overwrite) {
      return c.json(
        { ok: false, error: 'rules.md already exists. Set overwrite: true to replace.' },
        409,
      );
    }

    writeFileSync(rulesPath, result.suggestedRulesFile);

    return c.json({ ok: true, result, rulesPath });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 400);
  }
});
