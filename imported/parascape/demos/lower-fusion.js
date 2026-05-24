// Svelte preprocess wrapper around @lyku/fuse.
//
// The fusion transform itself lives in packages/fuse/index.js — it's
// language-agnostic and ships as a standalone module. This file only
// adapts it to the Svelte preprocess interface for the demo build
// (and re-exports the transform fns so the rest of demos/ can import
// from one place).

import { lowerFusion, findFusableChains } from '../packages/fuse/index.js';

export { lowerFusion, findFusableChains };

// Svelte PreprocessorGroup. Runs in the same shape as the other
// demos/lower-*.js passes — script-only, .pui / .svelte only.
export default function lowerFusionPreprocess() {
	return {
		name: 'lower-fusion',
		script({ content, filename }) {
			if (!filename?.endsWith('.pui') && !filename?.endsWith('.svelte')) return;
			// Quick rejection — only consider files that have a fusable
			// method call somewhere.
			if (!/\.(map|filter|forEach|reduce|some|every|find|findIndex)\s*\(/.test(content)) return;
			const out = lowerFusion(content);
			if (out === content) return;
			return { code: out };
		},
	};
}

export { lowerFusionPreprocess };
