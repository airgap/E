import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type PluginOption } from 'vite';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Fallback resolver for bun's isolated install layout.
 *
 * Bun puts every package at `node_modules/.bun/<pkg>@<ver>/node_modules/<pkg>`
 * and creates symlinks in per-workspace node_modules. When a package's source
 * imports a peer dependency it forgot to declare (tiptap-markdown wants
 * @tiptap/pm, langium wants vscode-languageserver-protocol +
 * vscode-languageserver-types, etc.), rollup canonicalizes the importer to
 * its realpath in `~/.bun/install/cache/links/…` and then walks UP looking
 * for the missing dep — which doesn't exist relative to the cache dir.
 *
 * This plugin runs as an enforce:'pre' resolver: it lets vite's own
 * resolver try first via `this.resolve(skipSelf: true)`, and only if that
 * returns null does it look the package up in `node_modules/.bun/` and
 * point vite at the realpath. That covers every sloppily-declared peer
 * dep in the workspace without us having to enumerate them.
 *
 * Defensive: skips relative/absolute ids, virtual ids (\0), node:* and
 * data: URIs. Caches successful lookups so we don't hit the filesystem
 * once per import call site.
 */
function bunDotBunFallbackResolver(): PluginOption {
  const root = fileURLToPath(new URL('.', import.meta.url));
  const dotBun = resolvePath(root, '../../node_modules/.bun');
  // pkg → resolved dir, or null if known-missing
  const cache = new Map<string, string | null>();
  // pkg → parsed package.json (lazy)
  const pkgJsonCache = new Map<string, Record<string, unknown> | null>();

  function lookup(pkg: string): string | null {
    if (cache.has(pkg)) return cache.get(pkg) ?? null;
    if (!existsSync(dotBun)) {
      cache.set(pkg, null);
      return null;
    }
    // Package name → bun's dir prefix: `@scope/name` becomes `@scope+name`,
    // `name` stays `name`. Bun then appends `@<version>+<hash>`.
    const prefix = pkg.replace('/', '+') + '@';
    let entries: string[];
    try {
      entries = readdirSync(dotBun);
    } catch {
      cache.set(pkg, null);
      return null;
    }
    // Pick the highest-versioned match (alphabetic sort is fine for
    // semver `@x.y.z`; if multiple major versions are installed, the
    // last one wins. That's the same heuristic node would use.)
    const matches = entries.filter((e) => e.startsWith(prefix)).sort();
    for (let i = matches.length - 1; i >= 0; i--) {
      const candidate = resolvePath(dotBun, matches[i], 'node_modules', pkg);
      try {
        if (statSync(candidate).isDirectory()) {
          cache.set(pkg, candidate);
          return candidate;
        }
      } catch {
        /* try next */
      }
    }
    cache.set(pkg, null);
    return null;
  }

  function readPkgJson(pkgDir: string): Record<string, unknown> | null {
    if (pkgJsonCache.has(pkgDir)) return pkgJsonCache.get(pkgDir) ?? null;
    try {
      const json = JSON.parse(readFileSync(resolvePath(pkgDir, 'package.json'), 'utf-8'));
      pkgJsonCache.set(pkgDir, json);
      return json;
    } catch {
      pkgJsonCache.set(pkgDir, null);
      return null;
    }
  }

  /**
   * Resolve a subpath against a package's `exports` field if present.
   * Handles the common shapes:
   *   - "./x": "./dist/x.js"
   *   - "./x": { import: "./x.mjs", require: "./x.cjs", default: "./x.js" }
   *   - "./x": { types: …, import: { browser: …, default: … } } (recurses)
   * Falls through to literal subpath join if no exports match.
   */
  function resolveExportsSubpath(pkgDir: string, subpath: string): string {
    const pkgJson = readPkgJson(pkgDir);
    const exports = pkgJson?.exports as unknown;
    if (exports && typeof exports === 'object' && !Array.isArray(exports)) {
      const key = '.' + subpath; // "/state" → "./state"
      const entry = (exports as Record<string, unknown>)[key];
      const target = pickConditionalTarget(entry);
      if (target) return resolvePath(pkgDir, target);
    }
    // No exports match — fall back to a literal join. Vite's downstream
    // load will append common extensions (.js/.mjs/index.js) itself.
    return resolvePath(pkgDir, subpath.slice(1));
  }

  function pickConditionalTarget(entry: unknown): string | null {
    if (!entry) return null;
    if (typeof entry === 'string') return entry;
    if (typeof entry !== 'object' || Array.isArray(entry)) return null;
    const rec = entry as Record<string, unknown>;
    // Prefer ESM-flavored conditions; "default" is the catch-all.
    for (const key of ['import', 'module', 'browser', 'default', 'require']) {
      const v = rec[key];
      const picked = pickConditionalTarget(v);
      if (picked) return picked;
    }
    return null;
  }

  return {
    name: 'bun-dotbun-fallback-resolver',
    enforce: 'pre',
    async resolveId(id, importer) {
      // Bail on anything that isn't a bare specifier.
      if (
        !id ||
        id.startsWith('\0') ||
        id.startsWith('.') ||
        id.startsWith('/') ||
        id.startsWith('node:') ||
        id.startsWith('data:') ||
        /^[A-Za-z]:[\\/]/.test(id)
      ) {
        return null;
      }
      // Let vite's normal resolver have first crack. skipSelf prevents
      // infinite recursion.
      const tried = await this.resolve(id, importer, { skipSelf: true });
      if (tried) return tried;

      // Vite couldn't resolve it. Split into <pkg>[/<subpath>] and look up.
      const m = id.match(/^((?:@[^/]+\/)?[^/]+)(\/.*)?$/);
      if (!m) return null;
      const [, pkg, subpath = ''] = m;
      const pkgDir = lookup(pkg);
      if (!pkgDir) return null;
      // For bare package imports, return the package directory and let
      // vite handle main/module/exports resolution itself.
      // For subpath imports (e.g. @tiptap/pm/state), the file we hand
      // back must be a real file path — vite's load step opens it raw
      // and EISDIRs on a directory. Walk the exports map to find the
      // actual file.
      return subpath ? resolveExportsSubpath(pkgDir, subpath) : pkgDir;
    },
  };
}

export default defineConfig({
  plugins: [bunDotBunFallbackResolver(), sveltekit()],
  worker: {
    format: 'es',
  },
  ssr: {
    // tiptap-markdown@0.8.10 imports `@tiptap/pm/*` but only declares
    // `@tiptap/core` as a peer dep. noExternal routes it through vite's
    // resolver (which our fallback plugin now backs up) instead of
    // marking it external in the SSR bundle.
    noExternal: ['tiptap-markdown'],
  },
  server: {
    host: true,
    port: 3333,
    watch: {
      // Git operations (stage, commit, reset) modify .git/ internals.
      // Without this, committing via Smart Staging triggers HMR reloads
      // that abort in-flight fetch requests and reset client state.
      ignored: ['**/.git/**'],
    },
    proxy: {
      // Non-streaming /api/stream endpoints (e.g., /api/stream/sessions)
      // must be proxied with normal JSON handling
      '/api/stream/sessions': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
      '/api/stream/reconnect': {
        target: 'http://localhost:3002',
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
        configure: (proxy) => {
          proxy.on('proxyRes', (_proxyRes, _req, res) => {
            (res as any).flushHeaders?.();
          });
        },
      },
      // SSE streaming endpoints — disable proxy timeout and buffering
      // so the connection stays open for the full duration of the response.
      // Only flush headers for GET requests (actual SSE streams); POST
      // requests (e.g., /answer) need normal header forwarding.
      '/api/stream': {
        target: 'http://localhost:3002',
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
        configure: (proxy) => {
          proxy.on('proxyRes', (_proxyRes, req, res) => {
            if (req.method === 'GET') {
              (res as any).flushHeaders?.();
            }
          });
        },
      },
      // Git commit/push streams can be long-lived (pre-commit hooks may run
      // typecheck, tests, etc.) — same SSE-friendly config as /api/stream.
      '/api/git/commit/stream': {
        target: 'http://localhost:3002',
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
        configure: (proxy) => {
          proxy.on('proxyRes', (_proxyRes, _req, res) => {
            (res as any).flushHeaders?.();
          });
        },
      },
      '/api/git/push/stream': {
        target: 'http://localhost:3002',
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
        configure: (proxy) => {
          proxy.on('proxyRes', (_proxyRes, _req, res) => {
            (res as any).flushHeaders?.();
          });
        },
      },
      '/api': {
        target: 'http://localhost:3002',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
