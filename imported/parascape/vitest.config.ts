import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { resolve } from 'node:path';

// The svelte plugin auto-reads svelte.config.js → extensions:['.svelte',
// '.pui'] + parabunPreprocess. So .pui compiles here EXACTLY as in the
// pixel-verified app/build — same lowering, same output. That identity
// is what makes Cloudscape's own tests a valid behavioral oracle.
// vitest 3 (Vite 6) matches vite-plugin-svelte v7's Environment API.
//
// esbuild.jsx*: Cloudscape tests are .tsx authored as `render(<Comp/>)`.
// We compile that JSX to the adapter's `h()` descriptor (NOT React) so
// the codemod never hand-parses JSX. jsxInject auto-imports h/Fragment
// into every conformance file.
export default defineConfig({
	plugins: [svelte(), svelteTesting()],
	resolve: {
		alias: {
			'@conformance': resolve(__dirname, 'tests/conformance'),
			'@components': resolve(__dirname, 'src/lib/components'),
			'@cloudscape': resolve(__dirname, 'src/lib/cloudscape'),
		},
	},
	esbuild: {
		// Force the CLASSIC transform: tsconfig.json sets `jsx: react-jsx`
		// (automatic runtime), which esbuild/Vite otherwise honors and
		// compiles `<Comp/>` to React `_jsx(...)` elements — making the
		// descriptor's `component` a React element object instead of the
		// .pui component, so the harness throws "Component_1 is not a
		// function". `jsx: 'transform'` makes jsxFactory/jsxInject apply.
		jsx: 'transform',
		jsxFactory: '__pui_h',
		jsxFragment: '__pui_Fragment',
		jsxInject: `import { h as __pui_h, Fragment as __pui_Fragment } from '@conformance/adapter'`,
	},
	test: {
		// Cloudscape tests use describe/test/expect/vi as jest-style
		// globals — globals:true keeps them adaptation-free.
		globals: true,
		environment: 'jsdom',
		setupFiles: ['tests/conformance/setup.ts'],
		include: ['tests/conformance/**/*.test.{ts,tsx}'],
		css: false,
		// 1.5 s per-test cap. The DateRangePicker / Calendar / other
		// open-state suites use testing-library `waitFor` against a
		// dropdown that the structural skeletons don't render; without
		// a cap, each waitFor sits at its 5 s default and the entire
		// scoreboard takes >10 min. 1.5 s lets the failures land
		// quickly while still leaving headroom for genuine async work.
		testTimeout: 1500,
		hookTimeout: 5000,
	},
});
