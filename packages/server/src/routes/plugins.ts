/**
 * /api/plugins — install, list, enable/disable, uninstall.
 * /plugins/<id>/<path> — serve a plugin's static assets to its sandboxed
 *                       iframe. Path-traversal-safe via pluginAssetPath.
 *
 * Install accepts a multipart/form-data POST with a single `zip` field
 * (the .zip file). Returns the parsed InstalledPlugin or a list of
 * manifest / extraction error strings.
 */
import { Hono } from 'hono';
import { readFileSync, existsSync, statSync } from 'node:fs';
import {
  listPlugins,
  installFromZip,
  uninstallPlugin,
  setEnabled,
  pluginAssetPath,
} from '../services/plugins';

const api = new Hono();

api.get('/list', (c) => {
  return c.json({ ok: true, data: listPlugins() });
});

api.post('/install', async (c) => {
  let buf: Buffer;
  try {
    const formData = await c.req.formData();
    const file = formData.get('zip');
    if (!file || typeof file === 'string') {
      return c.json({ ok: false, error: 'missing "zip" file field' }, 400);
    }
    buf = Buffer.from(await (file as File).arrayBuffer());
  } catch (err) {
    return c.json(
      {
        ok: false,
        error: `failed to read upload: ${err instanceof Error ? err.message : String(err)}`,
      },
      400,
    );
  }
  const result = installFromZip(buf);
  if (result.errors.length > 0) {
    return c.json({ ok: false, errors: result.errors }, 400);
  }
  return c.json({ ok: true, data: result.plugin });
});

api.delete('/:id', (c) => {
  const res = uninstallPlugin(c.req.param('id'));
  if (!res.ok) return c.json({ ok: false, error: res.error ?? 'failed' }, 400);
  return c.json({ ok: true });
});

api.patch('/:id/enabled', async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'invalid JSON body' }, 400);
  }
  if (typeof body?.enabled !== 'boolean') {
    return c.json({ ok: false, error: 'body.enabled must be a boolean' }, 400);
  }
  const res = setEnabled(c.req.param('id'), body.enabled);
  if (!res.ok) return c.json({ ok: false, error: res.error ?? 'failed' }, 400);
  return c.json({ ok: true });
});

// ── Static asset surface ───────────────────────────────────────────────
//
// Mounted at /plugins (NOT /api/plugins) so iframe srcs look like
// `/plugins/my-id/panel.html`. Path-traversal-safe via pluginAssetPath —
// any request that resolves outside the plugin's install dir 404s.

const assets = new Hono();
assets.get('/:id/*', (c) => {
  const id = c.req.param('id');
  // Hono's wildcard match. URL example: /plugins/my-id/sub/file.html
  // c.req.path will be the full path; strip the prefix.
  const path = c.req.path.replace(/^\/plugins\/[^/]+\//, '');
  const abs = pluginAssetPath(id, path);
  if (!abs) return c.text('not found', 404);
  if (!existsSync(abs)) return c.text('not found', 404);
  const st = statSync(abs);
  if (!st.isFile()) return c.text('not found', 404);
  const body = readFileSync(abs);
  // Crude content-type guess. Plugins ship static assets — the common
  // cases (html / css / js / png / svg / json) are covered; everything
  // else gets application/octet-stream and the iframe handles it.
  const ext = abs.toLowerCase().split('.').pop() ?? '';
  const ct: Record<string, string> = {
    html: 'text/html; charset=utf-8',
    css: 'text/css; charset=utf-8',
    js: 'application/javascript; charset=utf-8',
    mjs: 'application/javascript; charset=utf-8',
    json: 'application/json; charset=utf-8',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    woff: 'font/woff',
    woff2: 'font/woff2',
    md: 'text/markdown; charset=utf-8',
    txt: 'text/plain; charset=utf-8',
  };
  return c.body(body, 200, { 'Content-Type': ct[ext] ?? 'application/octet-stream' });
});

export { api as pluginRoutes, assets as pluginAssetRoutes };
