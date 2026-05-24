import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

import { resolve } from 'node:path';

// `@parascape-design/components/<kebab-name>` mirrors the Cloudscape
// React import shape (`@cloudscape-design/components/<kebab-name>`)
// so the demos' side-by-side panes can use identically-shaped import
// paths. The fork's components live in src/lib/components as
// PascalCase `.pui` files, so kebab → Pascal here and append `.pui`.
// (vite's `resolve.alias` doesn't natively do regex+transform, so a
// tiny plugin is the cleanest path.)
const parascapeDesign = (): Plugin => ({
	name: 'parascape-design-alias',
	enforce: 'pre',
	resolveId(id) {
		const m = /^@parascape-design\/components\/([a-z][a-z0-9-]*)$/.exec(id);
		if (!m) return null;
		const pascal = m[1]
			.split('-')
			.map((s) => s.charAt(0).toUpperCase() + s.slice(1))
			.join('');
		return resolve(__dirname, 'src/lib/components', pascal + '.pui');
	},
});

export default defineConfig({
	plugins: [parascapeDesign(), svelte()],
	server: {
		port: 5273,
		// proxy the Designer's persistence API to the account server (LYK-930)
		// so the browser talks same-origin (no CORS). Start it with
		// `bun run account:server`.
		proxy: {
			'/api': { target: 'http://localhost:8788', changeOrigin: true },
		},
	},
	resolve: {
		alias: {
			// Lets the side-by-side demos under demos/scenarios/*.parascape.pui
			// import .pui components with the same '@components/X.pui' shortcut
			// the conformance suite uses — keeps the demo source code we show
			// identical to what application code would actually write.
			'@components': resolve(__dirname, 'src/lib/components'),
		},
	},
	build: {
		rollupOptions: {
			input: {
				main: resolve(__dirname, 'index.html'),
				demos: resolve(__dirname, 'demos/index.html'),
				components: resolve(__dirname, 'components/index.html'),
				builder: resolve(__dirname, 'builder/index.html'),
				designer: resolve(__dirname, 'designer/index.html'),
				preview: resolve(__dirname, 'preview/index.html'),
				box: resolve(__dirname, 'tests/visual/box-fixture/box.html'),
				wide: resolve(__dirname, 'tests/visual/wide-fixture/wide.html'),
				cp: resolve(__dirname, 'tests/visual/cp-fixture/cp.html'),
				ann: resolve(__dirname, 'tests/visual/ann-fixture/ann.html'),
				chart: resolve(__dirname, 'tests/visual/chart-fixture/chart.html'),
				area: resolve(__dirname, 'tests/visual/area-fixture/area.html'),
				pie: resolve(__dirname, 'tests/visual/pie-fixture/pie.html'),
				popover: resolve(__dirname, 'tests/visual/popover-fixture/popover.html'),
			},
		},
	},
});
