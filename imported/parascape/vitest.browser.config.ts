import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { resolve } from 'node:path';

// Browser-mode conformance path. Identical pipeline to vitest.config.ts
// (same svelte plugin → .pui lowering, same aliases, same adapter
// jsxInject, same setup) — the ONLY change is the runtime: a real
// chromium via the Playwright provider instead of jsdom. This makes
// the interaction tier verifiable (real focus / keyboard / portals /
// layout that jsdom structurally cannot reproduce). The jsdom config
// stays as the fast structural path; this is the slower behavioral one.
export default defineConfig({
	plugins: [svelte(), svelteTesting()],
	resolve: {
		// One svelte instance — split copies → lifecycle_function_unavailable.
		dedupe: ['svelte'],
		// Force svelte's CLIENT export — otherwise the test transform picked
		// the server build → "mount(...) is not available on the server".
		conditions: ['browser', 'svelte', 'import', 'default'],
		alias: {
			'@conformance': resolve(__dirname, 'tests/conformance'),
			'@components': resolve(__dirname, 'src/lib/components'),
			'@cloudscape': resolve(__dirname, 'src/lib/cloudscape'),
		},
	},
	esbuild: {
		jsxFactory: '__pui_h',
		jsxFragment: '__pui_Fragment',
		jsxInject: `import { h as __pui_h, Fragment as __pui_Fragment } from '@conformance/adapter'`,
	},
	// Browser mode pre-bundles deps with esbuild, which does NOT run the
	// svelte plugin — so @testing-library/svelte-core's runes module
	// (props.svelte.js) leaked `$state`. Exclude the svelte-aware deps so
	// the plugin compiles their .svelte(.js) sources.
	optimizeDeps: {
		exclude: ['@testing-library/svelte', '@testing-library/svelte-core'],
	},
	test: {
		globals: true,
		setupFiles: ['tests/conformance/setup.ts'],
		include: ['tests/conformance/**/*.test.{ts,tsx}'],
		css: false,
		browser: {
			enabled: true,
			provider: 'playwright',
			headless: true,
			screenshotFailures: false,
			instances: [{ browser: 'chromium' }],
		},
	},
});
