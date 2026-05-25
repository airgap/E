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
import { dirname, extname, join, resolve } from 'path';
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

/** Walk up from `fromDir` to the nearest directory containing a package.json. */
function findProjectDir(fromDir: string): string | null {
  let dir = resolve(fromDir);
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Discover component manifests for the project nearest `fromFile`: read its
 * direct dependencies and, for each that declares a `componentManifest` field in
 * its package.json, load that file. This is the generic discovery contract — any
 * installed library that ships a manifest is picked up, no per-library E code.
 * Exported for tests.
 */
export function collectComponentManifests(
  fromFile: string,
): Array<{ package: string; manifest: unknown }> {
  const projDir = findProjectDir(dirname(fromFile));
  if (!projDir) return [];
  let pj: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pj = JSON.parse(readFileSync(join(projDir, 'package.json'), 'utf8'));
  } catch {
    return [];
  }
  const deps = Object.keys({ ...pj.dependencies, ...pj.devDependencies });
  const out: Array<{ package: string; manifest: unknown }> = [];
  for (const name of deps) {
    const pkgDir = findPackageDir(projDir, name);
    if (!pkgDir) continue;
    try {
      const dpj = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
      const rel = dpj.componentManifest;
      if (typeof rel !== 'string') continue;
      const file = join(pkgDir, rel);
      if (!existsSync(file)) continue;
      out.push({ package: name, manifest: JSON.parse(readFileSync(file, 'utf8')) });
    } catch {
      // skip an unreadable/invalid dependency manifest
    }
  }
  return out;
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

// Source extensions the in-browser preview can compile itself (.pui/.svelte via
// the svelte compiler, .ts/.pts/… via para-transpile). A library that ships
// these resolves to its SOURCE and is compiled client-side; anything else
// (compiled .js) goes through the parabun bundle path instead.
const SOURCE_EXTS = [
  '.pui',
  '.svelte',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.pts',
  '.ptsx',
  '.pjs',
  '.pjsx',
];

/** Pick a source-ish target from an exports node (string or conditions object). */
function pickSourceTarget(node: unknown): string | undefined {
  if (typeof node === 'string') return node;
  if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    for (const cond of ['source', 'svelte', 'import', 'browser', 'default']) {
      if (typeof o[cond] === 'string') return o[cond] as string;
    }
  }
  return undefined;
}

/** Resolve `./subpath` against an exports map (exact key, then `*` wildcards). */
function resolveFromExports(exportsField: unknown, subpath: string): string | undefined {
  const key = subpath === '' ? '.' : './' + subpath;
  if (!exportsField) return undefined;
  if (typeof exportsField === 'string') return key === '.' ? exportsField : undefined;
  const exps = exportsField as Record<string, unknown>;
  if (exps[key]) return pickSourceTarget(exps[key]);
  for (const pat of Object.keys(exps)) {
    const star = pat.indexOf('*');
    if (star < 0) continue;
    const pre = pat.slice(0, star);
    const post = pat.slice(star + 1);
    if (key.startsWith(pre) && key.endsWith(post) && key.length >= pre.length + post.length) {
      const matched = key.slice(pre.length, key.length - post.length);
      const tgt = pickSourceTarget(exps[pat]);
      if (tgt) return tgt.replace('*', matched);
    }
  }
  return undefined;
}

/**
 * Resolve a bare specifier to a LIBRARY SOURCE FILE (when the installed package
 * ships compilable source via its `exports`/`svelte`/`source` fields), so the
 * preview can compile it client-side. Returns null for packages that ship only
 * compiled JS — those take the parabun bundle path. Exported for tests.
 */
export function resolveComponentSource(
  specifier: string,
  fromFile: string,
): { path: string } | null {
  const segs = specifier.split('/');
  const pkgName = specifier.startsWith('@') ? segs.slice(0, 2).join('/') : segs[0];
  const subpath = (specifier.startsWith('@') ? segs.slice(2) : segs.slice(1)).join('/');
  const pkgDir = findPackageDir(dirname(fromFile), pkgName);
  if (!pkgDir) return null;
  let pj: Record<string, unknown>;
  try {
    pj = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
  let rel = resolveFromExports(pj.exports, subpath);
  if (!rel && subpath === '') {
    rel =
      (typeof pj.svelte === 'string' && pj.svelte) ||
      (typeof pj.source === 'string' && pj.source) ||
      undefined;
  }
  if (!rel) return null;
  const abs = join(pkgDir, rel);
  if (!existsSync(abs) || !SOURCE_EXTS.includes(extname(abs))) return null;
  return { path: abs };
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

// Discover component manifests from the workspace's installed libraries, so the
// designer palette can populate from whatever ships a componentManifest field.
app.post('/manifests', async (c) => {
  let body: { fromFile?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'invalid JSON body' }, 400);
  }
  if (typeof body.fromFile !== 'string') {
    return c.json({ ok: false, error: 'fromFile (string) required' }, 400);
  }
  try {
    return c.json({ ok: true, data: { manifests: collectComponentManifests(body.fromFile) } });
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 500);
  }
});

// Resolve a bare specifier to a library source file (source-shipping libs), so
// the preview can compile it client-side. `{ path: null }` ⇒ not a source lib;
// the client falls back to the bundle path.
app.post('/resolve', async (c) => {
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
  try {
    return c.json({
      ok: true,
      data: { path: resolveComponentSource(specifier, fromFile)?.path ?? null },
    });
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 500);
  }
});

export const puiRoutes = app;
