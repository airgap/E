// Designer support routes (LYK-970). Bundle a bare npm specifier for the
// in-browser `.pui` preview, on demand. The `.pui`/`.svelte`/`.ts` graph is
// resolved + compiled client-side (fast, per-keystroke); only bare module
// specifiers (component libs, @lyku/para-* runtime, …) come here, where we
// bundle them from the workspace's installed node_modules.
//
// Bundling runs through PARABUN (not vanilla bun) — its multithreaded /
// hardware-accelerated bundler. svelte is kept EXTERNAL so the bundled dep uses
// E's single svelte instance (same reason the eval harness shares one), and the
// client's eval harness resolves those externals.
import { Hono } from 'hono';
import { existsSync, readFileSync, rmSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { tmpdir } from 'os';

const app = new Hono();

/** Walk up from `fromDir` to find node_modules/<pkgName> with a package.json. */
function findPackageDir(fromDir: string, pkgName: string): string | null {
  let dir = resolve(fromDir);
  for (;;) {
    const cand = join(dir, 'node_modules', pkgName);
    if (existsSync(join(cand, 'package.json'))) return cand;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Resolve a package's main ESM entry (browser/import/module/main). */
function pickEntry(pkgDir: string): string | null {
  try {
    const pj = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
    const root = pj.exports?.['.'] ?? pj.exports;
    let entry: string | undefined;
    if (typeof root === 'string') entry = root;
    else if (root && typeof root === 'object') {
      entry =
        root.browser ??
        root.import ??
        root.module ??
        root.default ??
        (typeof root.node === 'string' ? root.node : undefined);
    }
    const resolved: string = entry ?? pj.module ?? pj.main ?? 'index.js';
    return join(pkgDir, resolved);
  } catch {
    return null;
  }
}

app.post('/bundle', async (c) => {
  let body: { specifier?: string; fromFile?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'invalid JSON body' }, 400);
  }
  const { specifier, fromFile } = body;
  if (typeof specifier !== 'string' || typeof fromFile !== 'string') {
    return c.json({ ok: false, error: 'specifier and fromFile (strings) required' }, 400);
  }

  const segs = specifier.split('/');
  const pkgName = specifier.startsWith('@') ? segs.slice(0, 2).join('/') : segs[0];
  const subpath = (specifier.startsWith('@') ? segs.slice(2) : segs.slice(1)).join('/');

  const pkgDir = findPackageDir(dirname(fromFile), pkgName);
  if (!pkgDir)
    return c.json({ ok: false, error: `package "${pkgName}" not found in node_modules` }, 404);

  let entry = subpath ? join(pkgDir, subpath) : pickEntry(pkgDir);
  if (!entry) return c.json({ ok: false, error: `cannot resolve entry for "${specifier}"` }, 422);
  if (subpath && !existsSync(entry)) {
    entry =
      ['.js', '.mjs', '.ts', '/index.js', '/index.mjs'].map((s) => entry + s).find(existsSync) ??
      entry;
  }
  if (!existsSync(entry)) return c.json({ ok: false, error: `entry not found: ${entry}` }, 404);

  const outFile = join(
    tmpdir(),
    `e-pui-bundle-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`,
  );
  try {
    const proc = Bun.spawn(
      [
        'parabun',
        'build',
        entry,
        '--format=esm',
        '--target=browser',
        '--external=svelte',
        '--external=svelte/*',
        `--outfile=${outFile}`,
      ],
      { cwd: pkgDir, stdout: 'pipe', stderr: 'pipe' },
    );
    const code = await proc.exited;
    if (code !== 0) {
      const err = await new Response(proc.stderr).text();
      return c.json({ ok: false, error: `parabun build failed: ${err.slice(0, 800)}` }, 422);
    }
    const js = await Bun.file(outFile).text();
    return c.json({ ok: true, data: { js } });
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 500);
  } finally {
    try {
      rmSync(outFile, { force: true });
    } catch {
      // best-effort cleanup
    }
  }
});

export const puiRoutes = app;
