// Vite plugin wrapper around @lyku/fuse.
//
// Runs the array-method fusion transform over .js / .ts / .jsx /
// .tsx / .pts / .pui sources during dev + build. Drop into any
// Vite config:
//
//   import fuse from "@lyku/fuse/vite-plugin";
//   export default { plugins: [fuse()] };
//
// Options:
//   include  RegExp of ids to transform   (default: /\.(js|ts|jsx|tsx|pts|ptsx)$/)
//   exclude  RegExp of ids to skip         (default: /node_modules/)
//
// The transform is purely syntactic and idempotent, so it composes
// fine before esbuild / the TS transform — it only ever turns
// `arr.map(f).filter(g)` into a loop IIFE, leaving everything else
// byte-identical.

import { lowerFusion } from './index.js';

const DEFAULT_INCLUDE = /\.(js|ts|jsx|tsx|pts|ptsx)$/;
const DEFAULT_EXCLUDE = /node_modules/;
// Cheap pre-filter: only bother running the transform on files that
// actually contain a fusable method name.
const HAS_CHAIN = /\.(map|filter|forEach|reduce|some|every|find|findIndex)\s*\(/;

export default function fuse(options = {}) {
	const include = options.include ?? DEFAULT_INCLUDE;
	const exclude = options.exclude ?? DEFAULT_EXCLUDE;
	return {
		name: 'lyku-fuse',
		enforce: 'pre',
		transform(code, id) {
			if (exclude.test(id)) return null;
			if (!include.test(id)) return null;
			if (!HAS_CHAIN.test(code)) return null;
			const out = lowerFusion(code);
			if (out === code) return null;
			// No sourcemap yet — the transform reshapes line structure,
			// so a faithful map needs per-token tracking. Returning the
			// code alone keeps it correct; map support is a follow-up.
			return { code: out, map: null };
		},
	};
}
