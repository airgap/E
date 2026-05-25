// In-browser eval + mount harness for compiled `.pui` components (LYK-970).
//
// compilePui gives us Svelte-5 client JS — an ES module that imports
// `svelte/internal/client` and `export default`s the component, AND preserves
// the component's own imports (`./Icon.pui`, `../x.styles.js`, …). To render a
// non-trivial component we resolve that import graph: read each dep from the
// workspace, compile `.pui`/`.svelte` deps recursively, eval `.js`/`.json`, and
// feed the resolved modules into the parent before mounting.
//
// Resolution is async (file reads + compile); eval is sync (each module's
// imports are pre-resolved into a map, then `new Function` runs it). The whole
// graph shares E's ONE `svelte/internal/client` instance so `mount` can drive it.
import { mount, unmount } from 'svelte';
// svelte/internal/client ships no .d.ts (it's the runtime the compiler targets);
// resolves fine at build/runtime. We only need the namespace to hand to the
// evaluated modules, so the `any` is intentional.
// @ts-expect-error - no declaration file for svelte internal
import * as SvelteInternalClient from 'svelte/internal/client';
import { compilePui } from './pui-compile';
import { transpile } from '@lyku/para-transpile';

type AnyModule = Record<string, unknown> & { default?: unknown };

const BUILTINS: Record<string, AnyModule> = {
  'svelte/internal/client': SvelteInternalClient as AnyModule,
  'svelte/internal/disclose-version': {},
  svelte: { mount, unmount } as AnyModule,
};

export class PuiResolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PuiResolveError';
  }
}

export type ReadFile = (path: string) => Promise<string | null>;

// ── path helpers (posix) ──
function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i <= 0 ? '/' : p.slice(0, i);
}
function joinResolve(fromDir: string, spec: string): string {
  const parts = `${fromDir}/${spec}`.split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return '/' + out.join('/');
}

const COMPILE_EXTS = ['.pui', '.svelte'];
// Para/TS module deps transpiled via @lyku/para-transpile (strips TS types AND
// lowers Para syntax — |>, match, pure, signal/derived/effect, …).
const TRANSPILE_EXTS = ['.ts', '.tsx', '.mts', '.cts', '.pts', '.ptsx', '.pjs', '.pjsx'];
const CANDIDATE_EXTS = ['.pui', '.svelte', '.ts', '.pts', '.js', '.mjs', '.json'];

/** Resolve a relative specifier to an existing file path (trying extensions). */
async function resolveFile(
  fromDir: string,
  spec: string,
  read: ReadFile,
): Promise<{ path: string; source: string } | null> {
  const base = joinResolve(fromDir, spec);
  const tries = /\.[a-z0-9]+$/i.test(base) ? [base] : CANDIDATE_EXTS.map((e) => base + e);
  for (const path of tries) {
    const source = await read(path);
    if (source !== null) return { path, source };
  }
  return null;
}

// ── import scanning + rewrite (Svelte client output has predictable, single-line imports) ──
const IMPORT_RE =
  /^[ \t]*import\b[^'"]*['"]([^'"]+)['"];?[ \t]*$|^[ \t]*import\s+['"]([^'"]+)['"];?[ \t]*$/gm;

function scanSpecifiers(code: string): string[] {
  const out = new Set<string>();
  for (const m of code.matchAll(IMPORT_RE)) out.add(m[1] ?? m[2]);
  return [...out];
}

function rewriteModule(code: string): string {
  let body = code;
  body = body.replace(/^[ \t]*import\s+['"][^'"]+['"];?[ \t]*$/gm, '');
  body = body.replace(
    /^[ \t]*import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"];?[ \t]*$/gm,
    (_m, n, src) => `const ${n} = __req(${JSON.stringify(src)});`,
  );
  body = body.replace(
    /^[ \t]*import\s+\{([^}]*)\}\s+from\s+['"]([^'"]+)['"];?[ \t]*$/gm,
    (_m, names, src) =>
      `const {${names.replace(/\s+as\s+/g, ': ')}} = __req(${JSON.stringify(src)});`,
  );
  body = body.replace(
    /^[ \t]*import\s+([A-Za-z_$][\w$]*)\s*,\s*\{([^}]*)\}\s+from\s+['"]([^'"]+)['"];?[ \t]*$/gm,
    (_m, def, names, src) =>
      `const __m = __req(${JSON.stringify(src)}); const ${def} = __dflt(__m); const {${names.replace(/\s+as\s+/g, ': ')}} = __m;`,
  );
  body = body.replace(
    /^[ \t]*import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"];?[ \t]*$/gm,
    (_m, n, src) => `const ${n} = __dflt(__req(${JSON.stringify(src)}));`,
  );
  body = body.replace(/^[ \t]*export\s+default\s+/m, 'var __default = ');
  body = body.replace(/^[ \t]*export\s+(?=(?:const|let|var|function|class)\b)/gm, '');
  body = body.replace(/^[ \t]*export\s+\{[^}]*\};?[ \t]*$/gm, '');
  return `${body}\nreturn typeof __default !== "undefined" ? __default : undefined;`;
}

function evalModule(js: string, req: (s: string) => AnyModule): AnyModule {
  const dflt = (m: AnyModule) => (m && 'default' in m ? m.default : m);
  // eslint-disable-next-line no-new-func
  const factory = new Function('__req', '__dflt', rewriteModule(js));
  const def = factory(req, dflt);
  return { default: def } as AnyModule;
}

interface Graph {
  read: ReadFile;
  cache: Map<string, AnyModule>;
  visiting: Set<string>;
  css: string[];
}

/** Resolve one module (by absolute path) to its namespace, recursing through imports. */
async function loadModule(path: string, source: string, g: Graph): Promise<AnyModule> {
  const cached = g.cache.get(path);
  if (cached) return cached;
  if (g.visiting.has(path)) return { default: undefined }; // cycle — best-effort
  g.visiting.add(path);

  const ext = path.slice(path.lastIndexOf('.'));
  if (ext === '.json') {
    const mod = { default: JSON.parse(source) } as AnyModule;
    g.cache.set(path, mod);
    g.visiting.delete(path);
    return mod;
  }

  // .pui/.svelte → svelte compile; .ts/.pts/… → para-transpile; .js/.mjs as-is.
  let js = source;
  if (COMPILE_EXTS.includes(ext)) {
    const r = await compilePui(source, path.slice(path.lastIndexOf('/') + 1));
    if (!r.ok || !r.js) {
      throw new PuiResolveError(`${path}: ${r.error?.message ?? 'compile failed'}`);
    }
    js = r.js;
    if (r.css) g.css.push(r.css);
  } else if (TRANSPILE_EXTS.includes(ext)) {
    try {
      js = transpile(source);
    } catch (e) {
      throw new PuiResolveError(`${path}: ${(e as Error).message}`);
    }
  }

  // Pre-resolve every import this module needs.
  const dir = dirname(path);
  const deps: Record<string, AnyModule> = {};
  for (const spec of scanSpecifiers(js)) {
    if (BUILTINS[spec]) {
      deps[spec] = BUILTINS[spec];
    } else if (spec.startsWith('.')) {
      if (/\.(css|scss|sass|less)$/i.test(spec)) {
        deps[spec] = {}; // scoped/side-effect styles — skip in preview
        continue;
      }
      const found = await resolveFile(dir, spec, g.read);
      if (!found) throw new PuiResolveError(`Cannot resolve "${spec}" from ${path}`);
      deps[spec] = await loadModule(found.path, found.source, g);
    } else {
      throw new PuiResolveError(`Unsupported import "${spec}" (bare module) in preview`);
    }
  }

  const mod = evalModule(js, (s: string) => deps[s] ?? { default: undefined });
  g.cache.set(path, mod);
  g.visiting.delete(path);
  return mod;
}

export interface PuiMountHandle {
  destroy(): void;
}

export interface PuiMountOptions {
  /** Compiled client JS for the root file (already produced by compilePui). */
  rootJs: string;
  /** Root component's scoped CSS, if any. */
  rootCss?: string;
  /** Absolute path of the root `.pui` (for resolving its relative imports). */
  filePath: string;
  /** Reads a workspace file; returns null if it doesn't exist. */
  readFile: ReadFile;
}

/**
 * Resolve the root component's import graph, eval it, inject CSS, and mount.
 * Async (reads + compiles deps). Throws PuiResolveError with a path-tagged
 * message on unresolved/failed deps — the caller shows it.
 */
export async function mountPui(
  target: HTMLElement,
  opts: PuiMountOptions,
): Promise<PuiMountHandle> {
  const g: Graph = { read: opts.readFile, cache: new Map(), visiting: new Set(), css: [] };

  // Resolve the root's deps, then eval the root JS directly (its source is the
  // live buffer, already compiled to opts.rootJs).
  const dir = dirname(opts.filePath);
  const deps: Record<string, AnyModule> = {};
  for (const spec of scanSpecifiers(opts.rootJs)) {
    if (BUILTINS[spec]) {
      deps[spec] = BUILTINS[spec];
    } else if (spec.startsWith('.')) {
      if (/\.(css|scss|sass|less)$/i.test(spec)) {
        deps[spec] = {};
        continue;
      }
      const found = await resolveFile(dir, spec, opts.readFile);
      if (!found) throw new PuiResolveError(`Cannot resolve "${spec}" from ${opts.filePath}`);
      deps[spec] = await loadModule(found.path, found.source, g);
    } else {
      throw new PuiResolveError(`Unsupported import "${spec}" (bare module) in preview`);
    }
  }

  const rootMod = evalModule(opts.rootJs, (s: string) => deps[s] ?? { default: undefined });
  const Component = rootMod.default;
  if (typeof Component !== 'function') {
    throw new PuiResolveError('Compiled .pui has no default-exported component');
  }

  const styleEls: HTMLStyleElement[] = [];
  const allCss = [...(opts.rootCss ? [opts.rootCss] : []), ...g.css];
  for (const css of allCss) {
    const el = document.createElement('style');
    el.textContent = css;
    target.appendChild(el);
    styleEls.push(el);
  }

  const instance = mount(Component as Parameters<typeof mount>[0], { target });

  return {
    destroy() {
      try {
        unmount(instance);
      } catch {
        // already torn down
      }
      for (const el of styleEls) el.remove();
    },
  };
}
