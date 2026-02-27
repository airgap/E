import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  worker: {
    format: 'es',
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
