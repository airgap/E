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
import { existsSync, readFileSync, readdirSync, mkdirSync, mkdtempSync, rmSync } from 'fs';
import { dirname, extname, join, resolve } from 'path';
import { tmpdir, homedir } from 'os';

const app = new Hono();

/**
 * Cache for libraries E installed from a release tarball / zip (not via npm).
 * Searched by the resolver alongside the workspace node_modules, so a library
 * imported from a GitHub release works exactly like an installed dependency.
 * Overridable via E_LIBRARIES_DIR (used by tests).
 */
function externalLibDir(): string {
  return process.env.E_LIBRARIES_DIR || join(homedir(), '.e', 'libraries');
}

/**
 * Find a package dir: walk up the workspace node_modules, then fall back to the
 * external-library cache (libraries installed from a release tarball).
 */
function findPackageDir(fromDir: string, pkgName: string): string | null {
  let dir = resolve(fromDir);
  for (;;) {
    const cand = join(dir, 'node_modules', pkgName);
    if (existsSync(join(cand, 'package.json'))) return cand;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const cached = join(externalLibDir(), pkgName);
  return existsSync(join(cached, 'package.json')) ? cached : null;
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
/** Read a package's componentManifest, if it declares + ships one. */
function readManifestAt(
  pkgDir: string,
  name: string,
): { package: string; manifest: unknown } | null {
  try {
    const dpj = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
    const rel = dpj.componentManifest;
    if (typeof rel !== 'string') return null;
    const file = join(pkgDir, rel);
    if (!existsSync(file)) return null;
    return { package: name, manifest: JSON.parse(readFileSync(file, 'utf8')) };
  } catch {
    return null;
  }
}

/** Every installed external-cache package (handles `@scope/<name>` dirs). */
function externalPackageDirs(): Array<{ name: string; dir: string }> {
  const root = externalLibDir();
  if (!existsSync(root)) return [];
  const out: Array<{ name: string; dir: string }> = [];
  for (const entry of readdirSync(root)) {
    if (entry.startsWith('@')) {
      try {
        for (const sub of readdirSync(join(root, entry)))
          out.push({ name: `${entry}/${sub}`, dir: join(root, entry, sub) });
      } catch {
        // not a scope dir
      }
    } else {
      out.push({ name: entry, dir: join(root, entry) });
    }
  }
  return out;
}

export function collectComponentManifests(
  fromFile: string,
): Array<{ package: string; manifest: unknown }> {
  const out: Array<{ package: string; manifest: unknown }> = [];
  const seen = new Set<string>();
  const add = (m: { package: string; manifest: unknown } | null) => {
    if (m && !seen.has(m.package)) {
      seen.add(m.package);
      out.push(m);
    }
  };

  // 1. the project's declared dependencies
  const projDir = findProjectDir(dirname(fromFile));
  if (projDir) {
    let pj: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } =
      {};
    try {
      pj = JSON.parse(readFileSync(join(projDir, 'package.json'), 'utf8'));
    } catch {
      // no/unreadable project package.json
    }
    for (const name of Object.keys({ ...pj.dependencies, ...pj.devDependencies })) {
      const pkgDir = findPackageDir(projDir, name);
      if (pkgDir) add(readManifestAt(pkgDir, name));
    }
  }

  // 2. libraries installed from release tarballs (the external cache)
  for (const { name, dir } of externalPackageDirs()) add(readManifestAt(dir, name));

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

type ConditionPicker = (node: unknown) => string | undefined;

/** Picks the SOURCE target (source/svelte) — for client-side compilation. */
const pickSourceTarget: ConditionPicker = (node) => {
  if (typeof node === 'string') return node;
  if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    for (const cond of ['source', 'svelte', 'import', 'browser', 'default']) {
      if (typeof o[cond] === 'string') return o[cond] as string;
    }
  }
  return undefined;
};

/** Picks the runnable JS target (import/browser/default) — for the bundler. */
const pickJsTarget: ConditionPicker = (node) => {
  if (typeof node === 'string') return node;
  if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    for (const cond of ['import', 'browser', 'module', 'default', 'svelte']) {
      if (typeof o[cond] === 'string') return o[cond] as string;
    }
  }
  return undefined;
};

/** Resolve `./subpath` against an exports map (exact key, then `*` wildcards). */
function resolveFromExports(
  exportsField: unknown,
  subpath: string,
  pick: ConditionPicker,
): string | undefined {
  const key = subpath === '' ? '.' : './' + subpath;
  if (!exportsField) return undefined;
  if (typeof exportsField === 'string') return key === '.' ? exportsField : undefined;
  const exps = exportsField as Record<string, unknown>;
  if (exps[key]) return pick(exps[key]);
  for (const pat of Object.keys(exps)) {
    const star = pat.indexOf('*');
    if (star < 0) continue;
    const pre = pat.slice(0, star);
    const post = pat.slice(star + 1);
    if (key.startsWith(pre) && key.endsWith(post) && key.length >= pre.length + post.length) {
      const matched = key.slice(pre.length, key.length - post.length);
      const tgt = pick(exps[pat]);
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
  let rel = resolveFromExports(pj.exports, subpath, pickSourceTarget);
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

/**
 * Resolve a bare specifier to a runnable JS entry to hand the bundler: the
 * package's `exports` (JS condition) for the subpath, else a naive join +
 * extension probe (packages without exports). Returns null if nothing exists.
 * Exported for tests.
 */
export function resolveBundleEntry(specifier: string, fromFile: string): string | null {
  const segs = specifier.split('/');
  const pkgName = specifier.startsWith('@') ? segs.slice(0, 2).join('/') : segs[0];
  const subpath = (specifier.startsWith('@') ? segs.slice(2) : segs.slice(1)).join('/');
  const pkgDir = findPackageDir(dirname(fromFile), pkgName);
  if (!pkgDir) return null;

  let entry: string | null = null;
  try {
    const pj = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
    const rel = resolveFromExports(pj.exports, subpath, pickJsTarget);
    if (rel) entry = join(pkgDir, rel);
  } catch {
    // no/unreadable package.json exports — fall through to naive resolution
  }
  if (!entry) entry = subpath ? join(pkgDir, subpath) : pickEntry(pkgDir);
  if (!entry) return null;
  if (subpath && !existsSync(entry)) {
    entry =
      ['.js', '.mjs', '.ts', '/index.js', '/index.mjs'].map((s) => entry + s).find(existsSync) ??
      entry;
  }
  return existsSync(entry) ? entry : null;
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

  const pkgName = specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0];
  const pkgDir = findPackageDir(dirname(fromFile), pkgName);
  if (!pkgDir)
    return c.json({ ok: false, error: `package "${pkgName}" not found in node_modules` }, 404);

  const entry = resolveBundleEntry(specifier, fromFile);
  if (!entry) return c.json({ ok: false, error: `cannot resolve entry for "${specifier}"` }, 404);

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

/**
 * Install a component library from an `npm pack` tarball (local path or http(s)
 * URL — e.g. a GitHub release asset) into the external-library cache, so it
 * resolves like an installed dependency. The tarball's name comes from its own
 * package.json. Exported for tests.
 */
export async function installLibraryFromTarball(
  source: string,
): Promise<{ name: string; dir: string }> {
  let tgz = source;
  let tmpDl: string | undefined;
  if (/^https?:\/\//i.test(source)) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`download failed (${res.status}) for ${source}`);
    tmpDl = join(tmpdir(), `e-lib-${Date.now()}-${Math.random().toString(36).slice(2)}.tgz`);
    await Bun.write(tmpDl, await res.arrayBuffer());
    tgz = tmpDl;
  }
  try {
    if (!existsSync(tgz)) throw new Error(`tarball not found: ${tgz}`);
    // Read the name from package/package.json (npm-pack layout) without a full extract.
    const nameProc = Bun.spawn(['tar', '-xzOf', tgz, 'package/package.json'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const pjText = await new Response(nameProc.stdout).text();
    if ((await nameProc.exited) !== 0)
      throw new Error('not an npm-pack tarball (no package/package.json)');
    const name = JSON.parse(pjText).name;
    if (typeof name !== 'string' || !name) throw new Error('tarball package.json has no name');

    const dest = join(externalLibDir(), name);
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    const ex = Bun.spawn(['tar', '-xzf', tgz, '-C', dest, '--strip-components=1'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if ((await ex.exited) !== 0)
      throw new Error(`extract failed: ${(await new Response(ex.stderr).text()).slice(0, 300)}`);
    return { name, dir: dest };
  } finally {
    if (tmpDl) rmSync(tmpDl, { force: true });
  }
}

// Install a component library from a release tarball (URL or local path) into
// the external cache — the no-npm path: publish a GitHub release, import here.
app.post('/libraries', async (c) => {
  let body: { source?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'invalid JSON body' }, 400);
  }
  if (typeof body.source !== 'string') {
    return c.json({ ok: false, error: 'source (tarball path or URL) required' }, 400);
  }
  try {
    const { name } = await installLibraryFromTarball(body.source);
    return c.json({ ok: true, data: { name } });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 422);
  }
});

// List libraries installed into the external cache.
app.get('/libraries', (c) => {
  const libraries = externalPackageDirs().map(({ name, dir }) => {
    let version = '';
    let hasManifest = false;
    try {
      const pj = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      version = typeof pj.version === 'string' ? pj.version : '';
      hasManifest = typeof pj.componentManifest === 'string';
    } catch {
      // unreadable package
    }
    return { name, version, hasManifest };
  });
  return c.json({ ok: true, data: { libraries } });
});

// Remove an installed external library.
app.delete('/libraries', async (c) => {
  let body: { name?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'invalid JSON body' }, 400);
  }
  if (typeof body.name !== 'string') return c.json({ ok: false, error: 'name required' }, 400);
  rmSync(join(externalLibDir(), body.name), { recursive: true, force: true });
  return c.json({ ok: true });
});

export const puiRoutes = app;
