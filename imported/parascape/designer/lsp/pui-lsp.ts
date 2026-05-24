// LYK-964: the browser Code Mode's language intelligence for `.pui`.
//
// Runs the SAME reactive/escape engine as the desktop VS Code LSP — the escape
// analysis comes from `@lyku/para-preprocess` (`buildEscapeChecker`, literally the
// code the build + the VS Code transform use), and the reactive-dependents +
// hover analyzers are ported from `editors/lsp/parabun-lsp.ts` (the desktop LSP).
// Everything here is PURE string analysis: no TypeScript program, no Bun.Transpiler,
// no Node/Bun APIs — so it bundles into a web worker. (The TS-program semantic
// diagnostics + Bun.Transpiler parse errors the desktop LSP also has are not
// portable; the Designer still compiles via live-compile for the hard parse error.)
import { buildEscapeChecker } from '@lyku/para-preprocess';

// LSP severities (1 Error · 2 Warning · 3 Information · 4 Hint).
export type Severity = 1 | 2 | 3 | 4;
export type Diagnostic = {
	severity: Severity;
	message: string;
	line: number;
	col: number;
	endCol: number;
	source: string;
};
export type ReactiveDependent = {
	kind: 'derived' | 'effect' | 'when' | 'binding';
	label: string;
	line: number;
};
export type HoverCard = { md: string };

// --- shared text helpers (ported from parabun-lsp.ts) ---
function stripLineCommentForScan(s: string): string {
	const i = s.indexOf('//');
	if (i < 0) return s;
	if (i > 0 && s[i - 1] === ':') return s; // crude `://` URL guard
	return s.slice(0, i);
}
function getWordAt(line: string, col: number): string {
	let start = col;
	let end = col;
	while (start > 0 && /\w/.test(line[start - 1])) start--;
	while (end < line.length && /\w/.test(line[end])) end++;
	return line.slice(start, end);
}
// Replace string/template/comment bodies with spaces so structural scans don't
// trip on `{#if}` etc. inside literals. Length-preserving (offsets stay valid).
function maskStringsAndComments(src: string): string {
	const out = src.split('');
	let i = 0;
	const n = src.length;
	const blank = (a: number, b: number) => {
		for (let k = a; k < b && k < n; k++) if (out[k] !== '\n') out[k] = ' ';
	};
	while (i < n) {
		const c = src[i];
		if (c === '/' && src[i + 1] === '/') {
			let j = i + 2;
			while (j < n && src[j] !== '\n') j++;
			blank(i, j);
			i = j;
		} else if (c === '/' && src[i + 1] === '*') {
			let j = i + 2;
			while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++;
			blank(i, Math.min(j + 2, n));
			i = j + 2;
		} else if (c === '"' || c === "'" || c === '`') {
			let j = i + 1;
			while (j < n && src[j] !== c) {
				if (src[j] === '\\') j++;
				j++;
			}
			blank(i + 1, j);
			i = j + 1;
		} else i++;
	}
	return out.join('');
}

// Identifiers brought into scope by `import` statements — default, namespace
// (`* as X`), and named (`{ A, B as C }`). A `<Tag>` whose name is imported here
// is known regardless of the palette (covers `Section`, component modules, and
// any hand-import), so the unknown-component check only flags real typos.
function importedIdents(masked: string): Set<string> {
	const out = new Set<string>();
	const re = /\bimport\s+([^;]+?)\s+from\b/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(masked)) !== null) {
		let clause = m[1].trim();
		const named = clause.match(/\{([^}]*)\}/);
		if (named) {
			for (const part of named[1].split(',')) {
				const id = part
					.trim()
					.split(/\s+as\s+/)
					.pop()
					?.trim();
				if (id && /^[A-Za-z_$][\w$]*$/.test(id)) out.add(id);
			}
			clause = clause.slice(0, named.index).replace(/,\s*$/, '').trim();
		}
		const ns = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
		if (ns) out.add(ns[1]);
		else {
			const def = clause.replace(/,.*$/, '').trim();
			if (/^[A-Za-z_$][\w$]*$/.test(def)) out.add(def);
		}
	}
	return out;
}

// All `signal NAME` declarations: name + the line/col of the name.
function signalDecls(src: string): { name: string; line: number; col: number }[] {
	const out: { name: string; line: number; col: number }[] = [];
	const lines = src.split('\n');
	const re = /^(\s*)signal\s+([A-Za-z_$][\w$]*)/;
	for (let i = 0; i < lines.length; i++) {
		const m = re.exec(lines[i]);
		if (m) out.push({ name: m[2], line: i, col: m[1].length + 'signal '.length });
	}
	return out;
}

// --- reactive-dependents (ported byte-faithfully from parabun-lsp.ts) ---
export function reactiveDependents(content: string, name: string): ReactiveDependent[] {
	const lines = content.split('\n');
	const ref = new RegExp(`(?<![\\w$])${name}(?![\\w$])`);
	const derivedDecl = /\b(?:export\s+)?derived\s+([A-Za-z_$][\w$]*)\s*[:=]/;
	const whenRe = /\bwhen\b(\s+not\b)?\s*([^\n{]*?)\s*\{/;
	const out: ReactiveDependent[] = [];
	const seen = new Set<string>();
	const add = (kind: ReactiveDependent['kind'], label: string, line: number) => {
		const k = kind + ':' + line;
		if (!seen.has(k)) {
			seen.add(k);
			out.push({ kind, label, line });
		}
	};
	for (let i = 0; i < lines.length; i++) {
		const t = stripLineCommentForScan(lines[i]);
		const dm = derivedDecl.exec(t);
		if (dm && dm[1] !== name && ref.test(t.slice(dm.index + dm[0].length)))
			add('derived', `derived ${dm[1]}`, i);
		const wm = whenRe.exec(t);
		if (wm && ref.test(wm[2] ?? ''))
			add('when', `when${wm[1] ? ' not' : ''} ${(wm[2] || '').trim()}`.trim(), i);
		if ((/~>/.test(t) || /(?<![-=<])->/.test(t)) && ref.test(t))
			add('binding', 'reactive binding (~> / ->)', i);
	}
	const effRe = /\beffect\s*\{/g;
	let em: RegExpExecArray | null;
	while ((em = effRe.exec(content)) !== null) {
		const open = content.indexOf('{', em.index);
		if (open < 0) break;
		let depth = 0;
		let end = content.length;
		for (let p = open; p < content.length; p++) {
			if (content[p] === '{') depth++;
			else if (content[p] === '}' && --depth === 0) {
				end = p;
				break;
			}
		}
		if (ref.test(content.slice(open + 1, end)))
			add('effect', 'effect { … }', content.slice(0, em.index).split('\n').length - 1);
	}
	out.sort((a, b) => a.line - b.line);
	return out;
}

// --- diagnostics ---
const BLOCK_OPEN = /\{#(if|each|await|key|snippet)\b/g;
const BLOCK_CLOSE = /\{\/(if|each|await|key|snippet)\}/g;
const RUNE = /\$(state|derived|effect)\b/g; // $props/$bindable are kept in .pui
const ESCAPE_KW = /\b(export|provide|inject|setContext|getContext|signalOf)\b/;

export function diagnostics(content: string, knownComponents: string[] = []): Diagnostic[] {
	const out: Diagnostic[] = [];
	const lines = content.split('\n');
	const masked = maskStringsAndComments(content);
	const maskedLines = masked.split('\n');
	const decls = signalDecls(content);
	const declNames = decls.map((d) => d.name);
	const escapes = declNames.length ? buildEscapeChecker(content) : () => false;

	// signal-level checks
	for (const d of decls) {
		const raw = lines[d.line];
		// trailing comment on a `signal` line → the lowering pulls it inside $state(...)
		const eq = raw.indexOf('=');
		const cmt = raw.indexOf('//', eq < 0 ? 0 : eq);
		if (eq >= 0 && cmt > eq) {
			out.push({
				severity: 2,
				message:
					'Trailing comment on a `signal` line breaks lowering — it gets pulled inside `$state(...)`. Move it to its own line above.',
				line: d.line,
				col: cmt,
				endCol: raw.length,
				source: 'pui',
			});
		}
		// escape → the heavier @lyku/para-signals bridge (and a build break if it can't resolve)
		if (escapes(d.name)) {
			out.push({
				severity: 2,
				message: `Signal \`${d.name}\` escapes to the \`@lyku/para-signals\` bridge (a keyword like \`export\`/\`provide\`/\`inject\` precedes its name on some line — even in a comment). This is heavier than a local cell and breaks the build if that import is unresolved.`,
				line: d.line,
				col: d.col,
				endCol: d.col + d.name.length,
				source: 'pui',
			});
		}
	}

	// escape-trigger lines: pinpoint WHERE a signal is forced onto the bridge
	for (let i = 0; i < lines.length; i++) {
		if (!ESCAPE_KW.test(lines[i])) continue;
		for (const d of decls) {
			if (!escapes(d.name)) continue;
			const m = new RegExp(
				`\\b(export|provide|inject|setContext|getContext|signalOf)\\b[^\\n]*\\b${d.name}\\b`,
			).exec(lines[i]);
			if (m) {
				const at = lines[i].indexOf(d.name, m.index);
				out.push({
					severity: 4,
					message: `This line forces signal \`${d.name}\` onto the para bridge (keyword precedes the name). Reword so they don't share a line.`,
					line: i,
					col: m.index,
					endCol: at >= 0 ? at + d.name.length : lines[i].length,
					source: 'pui',
				});
			}
		}
	}

	// Svelte runes — soft-lint per .pui rune policy (warn, never block)
	for (let i = 0; i < maskedLines.length; i++) {
		RUNE.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = RUNE.exec(maskedLines[i])) !== null) {
			out.push({
				severity: 2,
				message: `Prefer Para \`${m[1]}\` over the Svelte rune \`$${m[1]}\` in .pui. ($props/$bindable are fine.)`,
				line: i,
				col: m.index,
				endCol: m.index + m[0].length,
				source: 'pui',
			});
		}
	}

	// template block balance (#if/#each/#await/#key/#snippet vs their /closers)
	const stack: { kw: string; line: number; col: number }[] = [];
	for (let i = 0; i < maskedLines.length; i++) {
		const merged: { idx: number; open: boolean; kw: string }[] = [];
		BLOCK_OPEN.lastIndex = 0;
		BLOCK_CLOSE.lastIndex = 0;
		let o: RegExpExecArray | null;
		while ((o = BLOCK_OPEN.exec(maskedLines[i])) !== null)
			merged.push({ idx: o.index, open: true, kw: o[1] });
		let c: RegExpExecArray | null;
		while ((c = BLOCK_CLOSE.exec(maskedLines[i])) !== null)
			merged.push({ idx: c.index, open: false, kw: c[1] });
		merged.sort((a, b) => a.idx - b.idx);
		for (const t of merged) {
			if (t.open) stack.push({ kw: t.kw, line: i, col: t.idx });
			else {
				const top = stack.pop();
				if (!top)
					out.push({
						severity: 1,
						message: `\`{/${t.kw}}\` has no matching \`{#${t.kw}}\`.`,
						line: i,
						col: t.idx,
						endCol: t.idx + t.kw.length + 3,
						source: 'pui',
					});
				else if (top.kw !== t.kw)
					out.push({
						severity: 1,
						message: `\`{/${t.kw}}\` closes a \`{#${top.kw}}\` block.`,
						line: i,
						col: t.idx,
						endCol: t.idx + t.kw.length + 3,
						source: 'pui',
					});
			}
		}
	}
	for (const open of stack)
		out.push({
			severity: 1,
			message: `\`{#${open.kw}}\` is never closed (missing \`{/${open.kw}}\`).`,
			line: open.line,
			col: open.col,
			endCol: open.col + open.kw.length + 2,
			source: 'pui',
		});

	// unknown component tags (PascalCase opens not in the known set). "Known" =
	// the palette/project set OR anything the source imports OR a `svelte:*` special.
	if (knownComponents.length) {
		const known = new Set(knownComponents);
		for (const id of importedIdents(masked)) known.add(id);
		const tagRe = /<([A-Z][A-Za-z0-9]*)\b/g;
		for (let i = 0; i < maskedLines.length; i++) {
			tagRe.lastIndex = 0;
			let t: RegExpExecArray | null;
			while ((t = tagRe.exec(maskedLines[i])) !== null) {
				if (!known.has(t[1]))
					out.push({
						severity: 1,
						message: `Unknown component \`<${t[1]}>\` — not imported, and not a known Parascape/Cloudscape or project component.`,
						line: i,
						col: t.index + 1,
						endCol: t.index + 1 + t[1].length,
						source: 'pui',
					});
			}
		}
	}

	out.sort((a, b) => a.line - b.line || a.col - b.col);
	return out;
}

// --- hover (curated keyword/operator docs + reactive-dependents, ported) ---
const KEYWORD_DOC: Record<string, string> = {
	signal:
		'### `signal` — reactive binding\n\n`signal NAME = RHS` declares a reactive signal. Bare reads rewrite to `.get()`, assignments to `.set(...)`. If `RHS` reads another signal it auto-promotes to `derived`.',
	derived:
		'### `derived` — computed signal\n\n`derived NAME = EXPR` (or `derived NAME { … return … }`) is a read-only signal recomputed when its signal reads change.',
	effect:
		'### `effect` — reactive side effect\n\n`effect { … }` re-runs when the signals it reads change. Return a function to clean up before the next run / on destroy.',
	when: '### `when` — conditional reactive effect\n\n`when COND { … }` runs the body whenever `COND` (a signal expression) becomes truthy. `when not COND { … }` for the negation.',
	pure: '### `pure` — purity modifier\n\nMarks a function pure (no `this`, no outer mutation); enables inlining at `|>` call sites.',
	memo: '### `memo` — memoized pure function\n\n`memo name(args) { … }` caches by arity (singleton / Map / nested Map). Implies `pure`.',
	fun: '### `fun` — shorthand for `function`\n\nDesugars to `function` at parse time.',
};
const OP_DOC: { op: string; md: string }[] = [
	{
		op: '|>',
		md: '### `|>` — pipeline operator\n\n`x |> f |> g` → `g(f(x))`. Pure single-return functions inline at the call site.',
	},
	{
		op: '..!',
		md: '### `..!` — catch operator\n\n`p ..! (err) => fallback` → `p.catch((err) => fallback)`.',
	},
	{
		op: '..&',
		md: '### `..&` — finally operator\n\n`p ..& () => cleanup()` → `p.finally(() => cleanup())`.',
	},
];

export function hoverAt(content: string, line: number, character: number): HoverCard | null {
	const lines = content.split('\n');
	if (line < 0 || line >= lines.length) return null;
	const lineText = lines[line];
	// operators take precedence (a small window around the cursor)
	const around = lineText.slice(Math.max(0, character - 2), character + 2);
	for (const { op, md } of OP_DOC) if (around.includes(op)) return { md };

	const word = getWordAt(lineText, character);
	if (!word) return null;
	// keyword docs
	if (KEYWORD_DOC[word]) {
		// only treat `signal`/`derived`/`effect`/`when` as a keyword in declarator position
		return { md: KEYWORD_DOC[word] };
	}
	// a signal/derived NAME → reactive-dependents card
	const isReactiveName = new RegExp(
		`(?:^|\\n)\\s*(?:export\\s+)?(?:signal|derived)\\s+${word}\\b`,
	).test(content);
	if (isReactiveName) {
		const deps = reactiveDependents(content, word);
		const head = `### \`${word}\` — reactive\n`;
		if (!deps.length) return { md: head + '\nNo static reactive dependents found in this file.' };
		const body = deps
			.map((d) => `- **${d.kind}** \`${d.label}\` _(line ${d.line + 1})_`)
			.join('\n');
		return {
			md: `${head}\n**Read by ${deps.length} reactive construct${deps.length > 1 ? 's' : ''}** _(static, single-file approximation)_:\n\n${body}`,
		};
	}
	return null;
}
