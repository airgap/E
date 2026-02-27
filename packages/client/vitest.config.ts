import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte({ hot: false })],
  resolve: {
    alias: {
      $lib: new URL('./src/lib', import.meta.url).pathname,
      '@e/shared': new URL('../shared/src', import.meta.url).pathname,
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'happy-dom',
    globals: true,
    coverage: {
      include: ['src/lib/**/*.ts'],
      exclude: [
        'src/lib/**/*.test.ts',
        'src/lib/**/*.svelte.ts',
        'src/lib/ambient-fx/**', // WebGL shaders & canvas rendering
        'src/lib/workers/**', // Web Workers (tree-sitter)
        'src/lib/audio/**', // Audio engine
        'src/lib/components/editor/extensions/**', // LSP extensions (need runtime LSP)
        'src/lib/components/editor/e-cm-theme.ts', // CodeMirror theme (runtime dep)
        'src/lib/components/editor/language-map.ts', // Static mapping (tested via highlight.ts)
        'src/lib/services/terminal-connection.ts', // WebSocket + xterm.js (browser-only runtime)
        'src/lib/services/commentary-tts.ts', // Web Speech API + audio playback (browser-only)
      ],
    },
  },
});
