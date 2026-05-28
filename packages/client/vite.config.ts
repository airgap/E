import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

const require = createRequire(import.meta.url);

/**
 * Resolve a dep's directory; if the dep hasn't been installed yet (e.g.
 * lockfile pulled but `bun install` not yet run), fail with an actionable
 * message instead of a raw MODULE_NOT_FOUND. These aliases exist because
 * upstream packages declare peer deps sloppily — see comments below.
 */
function resolveDepDir(packageJsonSpecifier: string): string {
  try {
    return dirname(require.resolve(packageJsonSpecifier));
  } catch (err) {
    const pkg = packageJsonSpecifier.replace(/\/package\.json$/, '');
    throw new Error(
      `vite.config: could not resolve "${pkg}". This usually means the lockfile changed but \`bun install\` hasn't been run.\nRun:\n  bun install\nthen retry the build.\n\nOriginal error: ${(err as Error).message}`,
    );
  }
}
// tiptap-markdown@0.8.10 imports `@tiptap/pm/model` (and friends) but
// only declares `@tiptap/core` as a peer dependency. With bun's default
// install layout, rollup canonicalizes the tiptap-markdown symlink to
// its realpath in ~/.bun/install/cache/links/…, then walks UP looking
// for @tiptap/pm — which doesn't exist relative to the cache dir, so
// the build fails with "Could not resolve @tiptap/pm/model" on both the
// SSR and client passes.
//
// Pin @tiptap/pm/* to the project-resolved location via createRequire so
// vite's resolver always finds it, no matter how bun laid out node_modules.
// @tiptap/pm doesn't expose package.json in its `exports`, so we resolve
// via a real sub-entry (model resolves to model/dist/index.js per its
// exports map) and walk up THREE directories:
//   …/@tiptap/pm/model/dist/index.js → …/@tiptap/pm
let tiptapPmModel: string;
try {
  tiptapPmModel = require.resolve('@tiptap/pm/model');
} catch (err) {
  throw new Error(
    `vite.config: could not resolve "@tiptap/pm". Run \`bun install\` and retry.\n\nOriginal error: ${(err as Error).message}`,
  );
}
const tiptapPmRoot = dirname(dirname(dirname(tiptapPmModel)));

// langium@4.2.1 imports `vscode-languageserver-protocol` (pulled in via
// @mermaid-js/parser) but only declares `vscode-languageserver` as a dep.
// Same walk-up resolution failure shape as @tiptap/pm above.
const vscodeLspProto = resolveDepDir('vscode-languageserver-protocol/package.json');

export default defineConfig({
  plugins: [sveltekit()],
  worker: {
    format: 'es',
  },
  resolve: {
    alias: {
      '@tiptap/pm': tiptapPmRoot,
      'vscode-languageserver-protocol': vscodeLspProto,
    },
  },
  ssr: {
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
