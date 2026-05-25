// Para browser-lowering chain for the in-browser preview (LYK-970).
//
// VENDORED from Parascape's demos/*.js — the JS fallback for the lowerings the
// parabun runtime does natively. The published @lyku/para-preprocess only STUBS
// these (match, |>, leading-dot, async {}, inline-markup) for the type checker,
// so without them E's preview can't compile `.pui` that uses Para sugar in its
// script (signal/derived/effect alone work). Running this chain before
// parabunPreprocess makes the preview compile the SAME syntax the real build does.
//
// Fusion (demos/lower-fusion.js) is intentionally omitted — it's an optimization
// that pulls in @lyku/fuse; chains compile + run correctly unfused in a preview.
//
// PROPER FIX (not done here — it's an outward-facing republish of a core
// package): move these into @lyku/para-preprocess so Parascape + E both consume
// them and neither vendors a copy.
import type { PreprocessorGroup } from 'svelte/compiler';
// Vendored JS passes are @ts-nocheck (transpiled blobs); imports resolve as any.
import lowerAsyncBlock from './lower-async-block.js';
import lowerPipeline from './lower-pipeline.js';
import lowerLeadingDot from './lower-leading-dot.js';
import lowerMatch from './lower-match.js';
import paraInlineSnippets from './para-inline-snippets.js';

/**
 * The Para lowering passes to run BEFORE parabunPreprocess, in this order
 * (matches Parascape's svelte.config so the preview compiles like the build):
 * async-block → pipeline → leading-dot → match → inline-snippets.
 */
export function paraLoweringChain(): PreprocessorGroup[] {
  return [
    lowerAsyncBlock(),
    lowerPipeline(),
    lowerLeadingDot(),
    lowerMatch(),
    paraInlineSnippets(),
  ] as PreprocessorGroup[];
}
