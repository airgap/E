import { Hono } from 'hono';
import { impactAnalysis } from '../services/impact-analysis';

export const impactAnalysisRoutes = new Hono();

// Analyze impact of changed files
impactAnalysisRoutes.post('/analyze', async (c) => {
  try {
    const body = await c.req.json();
    const result = impactAnalysis.analyze(body.changedFiles, body.workspacePath || '.');
    return c.json({ ok: true, result });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 400);
  }
});

// Analyze impact from git diff (uncommitted changes)
impactAnalysisRoutes.post('/analyze-diff', async (c) => {
  try {
    const body = await c.req.json();
    const workspacePath = body.workspacePath || '.';

    // Get changed files from git
    const proc = Bun.spawnSync(['git', 'diff', '--name-only', 'HEAD'], { cwd: workspacePath });
    const stagedProc = Bun.spawnSync(['git', 'diff', '--name-only', '--cached'], {
      cwd: workspacePath,
    });

    const changed = [
      ...proc.stdout.toString().trim().split('\n'),
      ...stagedProc.stdout.toString().trim().split('\n'),
    ].filter(Boolean);

    const result = impactAnalysis.analyze([...new Set(changed)], workspacePath);
    return c.json({ ok: true, result });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 400);
  }
});

// Set config
impactAnalysisRoutes.post('/config', async (c) => {
  const body = await c.req.json();
  impactAnalysis.setConfig(body);
  return c.json({ ok: true });
});
