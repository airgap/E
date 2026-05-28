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
import {
  fetchRegistry,
  getRegistryUrl,
  setRegistryUrl,
  installFromRegistry,
} from '../services/plugin-registry';
import { runDiagnosticsForFile } from '../services/plugin-diagnostics';
import { runHoverForFile } from '../services/plugin-hovers';
import { runFormatForFile } from '../services/plugin-formatter';
import { runDocumentSymbolsForFile } from '../services/plugin-document-symbols';
import { isAbsolute } from 'node:path';
import type { PluginRegistryEntry } from '@e/shared';

const api = new Hono();

api.get('/list', (c) => {
  return c.json({ ok: true, data: listPlugins() });
});

// ── Registry ──────────────────────────────────────────────────────────

api.get('/registry/config', (c) => {
  return c.json({ ok: true, data: { url: getRegistryUrl() } });
});

api.patch('/registry/config', async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'invalid JSON' }, 400);
  }
  // null clears the url; any other shape must be a string.
  if (body?.url !== null && typeof body?.url !== 'string') {
    return c.json({ ok: false, error: 'body.url must be a string or null' }, 400);
  }
  const res = setRegistryUrl(body.url);
  if (!res.ok) return c.json({ ok: false, error: res.error ?? 'failed' }, 400);
  return c.json({ ok: true });
});

api.get('/registry', async (c) => {
  const force = c.req.query('force') === '1' || c.req.query('force') === 'true';
  const res = await fetchRegistry({ force });
  if (!res.ok) return c.json({ ok: false, errors: res.errors ?? ['fetch failed'] }, 400);
  return c.json({
    ok: true,
    data: { index: res.index, fetchedAt: res.fetchedAt, fromCache: res.fromCache ?? false },
  });
});

api.post('/registry/install', async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'invalid JSON' }, 400);
  }
  // Accept either { entry: {…} } (preferred — caller has the entry already)
  // or { id: '…' } (we look it up in the cached registry).
  let entry: PluginRegistryEntry | undefined = body?.entry;
  if (!entry && typeof body?.id === 'string') {
    const reg = await fetchRegistry();
    if (!reg.ok) {
      return c.json({ ok: false, errors: reg.errors ?? ['registry not available'] }, 400);
    }
    entry = reg.index!.entries.find((e) => e.id === body.id);
    if (!entry) {
      return c.json({ ok: false, error: `entry not found for id "${body.id}"` }, 404);
    }
  }
  if (!entry) {
    return c.json({ ok: false, error: 'body must include entry or id' }, 400);
  }
  const res = await installFromRegistry(entry);
  if (res.errors.length > 0) return c.json({ ok: false, errors: res.errors }, 400);
  return c.json({ ok: true, data: res.plugin });
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

// ── Diagnostics ────────────────────────────────────────────────────────
//
// POST /api/plugins/diagnostics { path } — runs every command-source
// diagnostics contribution that matches the file's extension across
// enabled plugins, concatenating results. The client invokes this on
// save (and on demand from the Problems panel "rerun" action).

api.post('/diagnostics', async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'invalid JSON body' }, 400);
  }
  const path = body?.path;
  if (typeof path !== 'string' || !isAbsolute(path)) {
    return c.json({ ok: false, error: 'body.path must be an absolute file path' }, 400);
  }
  const items = await runDiagnosticsForFile(path);
  return c.json({ ok: true, data: { path, diagnostics: items } });
});

// ── Hovers ─────────────────────────────────────────────────────────────
//
// POST /api/plugins/hover { path, line, character } — runs every
// command-source hover contribution that matches the file and returns
// any non-empty markdown blobs. The CM6 hover extension on the client
// renders them as a sandboxed tooltip.

api.post('/hover', async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'invalid JSON body' }, 400);
  }
  const path = body?.path;
  const line = body?.line;
  const character = body?.character;
  if (typeof path !== 'string' || !isAbsolute(path)) {
    return c.json({ ok: false, error: 'body.path must be an absolute file path' }, 400);
  }
  if (!Number.isInteger(line) || line < 0) {
    return c.json({ ok: false, error: 'body.line must be a non-negative integer' }, 400);
  }
  if (!Number.isInteger(character) || character < 0) {
    return c.json({ ok: false, error: 'body.character must be a non-negative integer' }, 400);
  }
  const results = await runHoverForFile(path, line, character);
  return c.json({ ok: true, data: { results } });
});

// LYK-1046: invoke command-source formatters for `path` with `content`.
// First plugin whose formatter binary returns non-empty stdout wins.
api.post('/format', async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'invalid JSON body' }, 400);
  }
  const path = body?.path;
  const content = body?.content;
  if (typeof path !== 'string' || !isAbsolute(path)) {
    return c.json({ ok: false, error: 'body.path must be an absolute file path' }, 400);
  }
  if (typeof content !== 'string') {
    return c.json({ ok: false, error: 'body.content must be a string' }, 400);
  }
  const result = await runFormatForFile(path, content);
  return c.json({ ok: true, data: { result } });
});

// LYK-1048: command-source document symbols. First plugin whose binary
// emits a non-empty JSON array of normalized symbols wins.
api.post('/document-symbols', async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'invalid JSON body' }, 400);
  }
  const path = body?.path;
  const content = body?.content;
  if (typeof path !== 'string' || !isAbsolute(path)) {
    return c.json({ ok: false, error: 'body.path must be an absolute file path' }, 400);
  }
  if (typeof content !== 'string') {
    return c.json({ ok: false, error: 'body.content must be a string' }, 400);
  }
  const result = await runDocumentSymbolsForFile(path, content);
  return c.json({ ok: true, data: { result } });
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
