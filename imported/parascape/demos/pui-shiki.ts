// Shiki highlighter wired to the parabun TextMate grammars.
//
// Grammars copied from /raid/parabun/editors/vscode/parabun/syntaxes/
// into demos/grammars/. The .pui grammar (source.pui) embeds
// source.ts for `<script>` blocks; the parabun-ts grammar (source.pts)
// is the same TypeScript surface plus Para keywords / operators
// (`signal`, `derived`, `effect`, `pure`, `match`, `..!`, `..&`,
// `..=`, `|>`); the parabun-inject grammar injects those Para tokens
// into source.ts so a `<script lang="ts">` block in a .pui file gets
// them too.
//
// Shiki uses the `name` field of each grammar as the lookup id, but
// the bundled VS Code grammars carry display names (`"Para UI
// Component"`, `"Parabun TypeScript"`). We wrap each grammar with a
// short id (`pui`, `pts`, `ptsx`, plus the injects) before handing it
// to Shiki — the internal scope-name references (`source.ts`,
// `source.pts`, …) still resolve because those use the scope field,
// which we leave untouched.
import { createHighlighter, type Highlighter } from 'shiki';

import puiGrammar from './grammars/pui.tmLanguage.json';
import ptsGrammar from './grammars/pts.tmLanguage.json';
import ptsxGrammar from './grammars/ptsx.tmLanguage.json';
import puiPtsInject from './grammars/pui-pts-inject.tmLanguage.json';
import parabunInject from './grammars/parabun-inject.tmLanguage.json';
import { findPipelineChains } from './lower-pipeline.js';
import { lowerLeadingDot } from './lower-leading-dot.js';
import { lowerFusion, findFusableChains } from './lower-fusion.js';

// Cast helpers — Shiki's `LanguageRegistration` type is wider than
// the JSON shape, so we just trust the runtime-loaded grammar.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lang = (id: string, grammar: any) => ({ ...grammar, name: id });

let highlighterPromise: Promise<Highlighter> | null = null;
let resolvedHighlighter: Highlighter | null = null;

// Dual-theme rendering. Shiki emits `color: <light-color>;
// --shiki-dark: <dark-color>` on every token; the demo viewer's
// stylesheet swaps `color: var(--shiki-dark)` when the host
// document is in dark mode (data-theme="dark"). One Shiki render
// covers both themes — no recompute on toggle.
const DUAL_THEMES = { light: 'github-light', dark: 'github-dark' } as const;

function init(): Promise<Highlighter> {
	if (highlighterPromise) return highlighterPromise;
	highlighterPromise = createHighlighter({
		themes: [DUAL_THEMES.light, DUAL_THEMES.dark],
		langs: [
			'typescript',
			'tsx',
			'javascript',
			'jsx',
			// Custom Para grammars. Order matters: source.pts depends on
			// source.ts; source.pui depends on source.ts + source.js;
			// the injects layer on top of source.ts.
			lang('pts', ptsGrammar),
			lang('ptsx', ptsxGrammar),
			lang('pui', puiGrammar),
			lang('pui-pts-inject', puiPtsInject),
			lang('parabun-inject', parabunInject),
		],
	}).then((hl) => {
		resolvedHighlighter = hl;
		return hl;
	});
	return highlighterPromise;
}

// Kick off init so by the time the viewer mounts the highlighter is
// usually ready and the first frame doesn't flash unhighlighted.
init().catch((e) => console.error('[pui-shiki] init failed:', e));

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Annotate fusable chains in the source with a `data-fused`
// decoration carrying its single-loop form, so the DemoPane can show
// a hover tooltip. Fusion is a Para-only optimization, so this is
// gated to the `pui` pane — the React/Cloudscape side runs its method
// chains as written and gets no fusion annotation. Two sources of
// chains, both Para-only:
//
//   1. `|>` pipeline chains — found in the displayed source, where
//      they still read as `x |> .map(f) |> .filter(g)`. Desugared +
//      leading-dot-expanded + fused for the tooltip.
//   2. Direct method chains (`x.map(f).filter(g)…`) — Para fuses these
//      too, even without `|>`.
//
// Ranges are de-overlapped (a `|>` chain that's already been caught
// won't be double-annotated as a direct chain), sorted by start.
function fusionDecorations(src: string, lang: 'pui' | 'tsx') {
	type Deco = { start: number; end: number; fused: string };
	const decos: Deco[] = [];
	if (lang !== 'pui') return [];
	// A chain's range can begin at the newline ending the previous line
	// (e.g. `derived tags =\n\t\traw |> …`), which would drag that line
	// into the decoration / box. Trim to the non-whitespace bounds so the
	// decoration starts at the first real token.
	const trim = (start: number, end: number): [number, number] => {
		while (start < end && /\s/.test(src[start])) start++;
		while (end > start && /\s/.test(src[end - 1])) end--;
		return [start, end];
	};
	try {
		// `readable: true` — the tooltip is display-only, so use legible
		// temp names (arr/out/i/x, `it` for placeholder lambdas) instead of
		// the hygienic `__`-prefixed ones the real compile path emits.
		for (const c of findPipelineChains(src)) {
			// The `.map(.trim())` placeholder form is still present at
			// this point; expand leading-dots before fusing, else the
			// fuser sees `.trim()` as a callable and emits unparseable
			// `(.trim())(it, …)`.
			const [start, end] = trim(c.start, c.end);
			decos.push({
				start,
				end,
				fused: lowerFusion(lowerLeadingDot(c.lowered, { readable: true }), {
					readable: true,
				}).trim(),
			});
		}
		for (const c of findFusableChains(src, { readable: true })) {
			const [start, end] = trim(c.start, c.end);
			decos.push({ start, end, fused: c.fused.trim() });
		}
	} catch {
		// Best-effort — a malformed mid-edit source shouldn't blow up
		// the whole highlight.
		return [];
	}
	// De-overlap: sort by start, drop any range that intersects one
	// already kept.
	decos.sort((a, b) => a.start - b.start);
	const kept: Deco[] = [];
	let lastEnd = -1;
	for (const d of decos) {
		if (d.start < lastEnd) continue;
		kept.push(d);
		lastEnd = d.end;
	}
	return kept.map((d) => ({
		start: d.start,
		end: d.end,
		properties: { class: 'pipeline-fused', 'data-fused': d.fused },
	}));
}

// Teaching POIs for the intro demo: a hotspot on the first `signal`
// and the first `derived`, each with a one-line explanation. Only the
// first non-property occurrence of each keyword is marked.
const CONCEPT_COPY: Record<string, string> = {
	signal:
		'Reactive state. Reading it — in a derived or the markup — subscribes; assigning re-runs everything that read it.',
	derived:
		'A cached computation. It re-runs only when a signal it read changes, and you read it like a plain value.',
};
function firstTokenRange(src: string, kw: string): { start: number; end: number } | null {
	const m = new RegExp(`(?:^|[^\\w$.])(${kw})\\b`).exec(src);
	if (!m) return null;
	const start = m.index + m[0].length - kw.length;
	return { start, end: start + kw.length };
}
function conceptDecorations(src: string) {
	const out = [];
	for (const kw of ['signal', 'derived']) {
		const r = firstTokenRange(src, kw);
		if (r)
			out.push({
				start: r.start,
				end: r.end,
				properties: {
					class: 'poi-concept',
					'data-poi-label': kw,
					'data-poi-text': CONCEPT_COPY[kw],
				},
			});
	}
	return out;
}

function decorationsFor(src: string, lang: 'pui' | 'tsx', opts?: { concepts?: boolean }) {
	const fusion = fusionDecorations(src, lang);
	if (opts?.concepts && lang === 'pui') return [...fusion, ...conceptDecorations(src)];
	return fusion;
}

/**
 * Highlight synchronously. If the highlighter hasn't finished init,
 * returns escaped raw source so the page renders without blocking.
 */
export function highlightSync(
	src: string,
	lang: 'pui' | 'tsx',
	opts?: { concepts?: boolean },
): string {
	if (!resolvedHighlighter) return `<pre class="shiki"><code>${esc(src)}</code></pre>`;
	return resolvedHighlighter.codeToHtml(src, {
		lang,
		themes: DUAL_THEMES,
		defaultColor: false,
		decorations: decorationsFor(src, lang, opts),
	});
}

/** Async highlight. `await ready` once at module init to be safe. */
export async function highlight(
	src: string,
	lang: 'pui' | 'tsx',
	opts?: { concepts?: boolean },
): Promise<string> {
	const hl = await init();
	return hl.codeToHtml(src, {
		lang,
		themes: DUAL_THEMES,
		defaultColor: false,
		decorations: decorationsFor(src, lang, opts),
	});
}

export const ready: Promise<Highlighter> = init();
