// @lyku/fuse — array-method chain fusion for JavaScript / TypeScript.
//
// A source-to-source transform that collapses chains of Array
// methods into a single for-loop, eliminating the intermediate
// arrays each `.map()` / `.filter()` would otherwise allocate.
// Neither V8 nor JSC fuses these chains on its own, so the win is
// real: ~5-6x on a map→filter→map→reduce over 2M elements (see
// bench.mjs), purely from killing the throwaway intermediates.
//
// It is NOT tied to any language extension — it operates on plain
// `arr.map(f).filter(g)` method chains, whoever wrote them. (Para's
// `|>` pipeline operator desugars TO these chains, so fused Para
// pipelines fall out for free, but the transform itself doesn't
// know `|>` exists.)
//
// Recognises chains of the form
//
//   PRODUCER.map(f).filter(g).map(h)            // transforms only
//   PRODUCER.map(f).filter(g).reduce(r, init)   // ending in a terminal
//
// and rewrites them to a single for-loop wrapped in an IIFE. The
// fundamental win is: one pass over the source array, no intermediate
// arrays allocated for each `.map()` / `.filter()` stage.
//
// Patterns handled
//
//   transform stages (can repeat): map, filter
//
//   terminal stages (at most one, at the end):
//     forEach, reduce, some, every, find, findIndex
//
// Anything else terminates the fusable prefix. So
//
//   xs.map(f).filter(g).sort()   →   sort() not fusable
//
// becomes
//
//   ( IIFE that does the .map + .filter as one loop ).sort()
//
// Callbacks are passed through unchanged. We don't try to substitute
// arrow parameters at the source level (text-level rewrites of
// `(x) => x.trim()` are bug-prone when `x` shadows or collides);
// modern engines inline small one-call-site arrow callbacks so the
// runtime result is equivalent to a hand-written loop.
//
// What's intentionally out of scope
//
//   - flatMap  → would need a nested sub-loop, breaks the linear model
//   - chains shorter than 2 stages → nothing to fuse
//   - non-arrow callbacks like `arr.map(parseInt)` → still passes
//     through, but the synthesized loop calls them once per iter,
//     same as native behaviour
//   - sort / reverse / concat / slice / etc. → not fusable; they
//     stop the prefix
//
// The lowering is iterative: find the first fusable chain, rewrite,
// re-scan from the rewrite's tail.

const TRANSFORM = new Set(['map', 'filter']);
const TERMINAL = new Set(['forEach', 'reduce', 'some', 'every', 'find', 'findIndex']);

const isIdentStart = (c) =>
	(c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || c === '$';
const isIdentCont = (c) => isIdentStart(c) || (c >= '0' && c <= '9');

function skipString(src, i) {
	const q = src[i];
	i++;
	while (i < src.length) {
		const c = src[i];
		if (c === '\\') {
			i += 2;
			continue;
		}
		if (c === q) return i + 1;
		i++;
	}
	return i;
}

function skipTemplate(src, i) {
	i++;
	while (i < src.length) {
		const c = src[i];
		if (c === '\\') {
			i += 2;
			continue;
		}
		if (c === '`') return i + 1;
		if (c === '$' && src[i + 1] === '{') {
			i = skipBalanced(src, i + 1);
			continue;
		}
		i++;
	}
	return i;
}

function skipBalanced(src, i) {
	const open = src[i];
	const close = open === '(' ? ')' : open === '[' ? ']' : '}';
	let depth = 1;
	i++;
	while (i < src.length && depth > 0) {
		const c = src[i];
		if (c === '"' || c === "'") {
			i = skipString(src, i);
			continue;
		}
		if (c === '`') {
			i = skipTemplate(src, i);
			continue;
		}
		if (c === '/' && src[i + 1] === '/') {
			while (i < src.length && src[i] !== '\n') i++;
			continue;
		}
		if (c === '/' && src[i + 1] === '*') {
			i += 2;
			while (i < src.length - 1 && !(src[i] === '*' && src[i + 1] === '/')) i++;
			i += 2;
			continue;
		}
		if (c === '(' || c === '[' || c === '{') depth++;
		else if (c === ')' || c === ']' || c === '}') depth--;
		i++;
	}
	return i;
}

// Split a comma-separated argument list at top-level commas. Returns
// the argument source strings (with their original whitespace).
function splitArgs(argsSrc) {
	const out = [];
	let buf = '';
	let i = 0;
	while (i < argsSrc.length) {
		const c = argsSrc[i];
		if (c === '"' || c === "'") {
			const end = skipString(argsSrc, i);
			buf += argsSrc.slice(i, end);
			i = end;
			continue;
		}
		if (c === '`') {
			const end = skipTemplate(argsSrc, i);
			buf += argsSrc.slice(i, end);
			i = end;
			continue;
		}
		if (c === '(' || c === '[' || c === '{') {
			const end = skipBalanced(argsSrc, i);
			buf += argsSrc.slice(i, end);
			i = end;
			continue;
		}
		if (c === ',') {
			out.push(buf);
			buf = '';
			i++;
			continue;
		}
		buf += c;
		i++;
	}
	if (buf.length > 0 || out.length > 0) out.push(buf);
	return out.map((s) => s.trim());
}

// At `src[dotPos] === '.'`, read a single `.method(args)` call.
// Returns null if this isn't a method-call form (e.g. `.length` with
// no parens).
function readMethodCall(src, dotPos) {
	let j = dotPos + 1;
	while (j < src.length && isIdentCont(src[j])) j++;
	const name = src.slice(dotPos + 1, j);
	if (name.length === 0) return null;
	let k = j;
	while (k < src.length && /\s/.test(src[k])) k++;
	if (src[k] !== '(') return null;
	const argsEnd = skipBalanced(src, k);
	const args = src.slice(k + 1, argsEnd - 1);
	return { name, args: args.trim(), end: argsEnd };
}

// Read a chain of `.method(args)` calls starting at `startPos`. The
// caller positions startPos AT the first `.` (or immediately after
// the producer expression, including any trailing whitespace).
function parseChain(src, startPos) {
	const stages = [];
	let i = startPos;
	while (i < src.length) {
		while (i < src.length && /\s/.test(src[i])) i++;
		if (src[i] !== '.') break;
		const call = readMethodCall(src, i);
		if (!call) break;
		stages.push(call);
		i = call.end;
	}
	return { stages, end: i };
}

// Of the chain's stages, take the longest prefix that's all
// TRANSFORM (with at most one TERMINAL at the very end).
function longestFusablePrefix(stages) {
	const out = [];
	for (let i = 0; i < stages.length; i++) {
		const s = stages[i];
		if (TRANSFORM.has(s.name)) {
			out.push(s);
			continue;
		}
		if (TERMINAL.has(s.name)) {
			out.push(s);
			break;
		}
		break;
	}
	return out;
}

// Walk backward from the producerEnd offset to find the start of the
// producer expression. Mirrors lower-pipeline's findLHSStart.
function findProducerStart(src, producerEnd) {
	let i = producerEnd - 1;
	let depth = 0;
	while (i >= 0 && /\s/.test(src[i])) i--;
	const stopAtTopLevel = new Set([';', ',', '?', ':']);
	while (i >= 0) {
		const c = src[i];
		if (c === ')' || c === ']' || c === '}') {
			depth++;
			i--;
			continue;
		}
		if (c === '(' || c === '[' || c === '{') {
			if (depth === 0) return i + 1;
			depth--;
			i--;
			continue;
		}
		if (depth > 0) {
			i--;
			continue;
		}
		if (c === '"' || c === "'") {
			const q = c;
			i--;
			while (i >= 0) {
				if (src[i] === q && src[i - 1] !== '\\') {
					i--;
					break;
				}
				i--;
			}
			continue;
		}
		if (c === '`') {
			i--;
			while (i >= 0 && src[i] !== '`') i--;
			i--;
			continue;
		}
		if (stopAtTopLevel.has(c)) return i + 1;
		// `=>` arrow head — the producer begins AFTER the arrow, not at
		// the `>`. Without this, walking back from `txns` in
		// `() => txns.filter(...)` would stop at the `=` and leave the
		// `>` glued to the producer (`> txns`).
		if (c === '>' && src[i - 1] === '=') return i + 1;
		if (c === '=') {
			const prev = src[i - 1];
			if (prev === '=' || prev === '!' || prev === '<' || prev === '>') {
				i--;
				continue;
			}
			return i + 1;
		}
		if (isIdentCont(c)) {
			let j = i;
			while (j >= 0 && isIdentCont(src[j])) j--;
			const word = src.slice(j + 1, i + 1);
			if (
				word === 'return' ||
				word === 'await' ||
				word === 'yield' ||
				word === 'throw' ||
				word === 'typeof' ||
				word === 'new' ||
				word === 'delete' ||
				word === 'void' ||
				word === 'in' ||
				word === 'of' ||
				word === 'instanceof'
			) {
				return i + 1;
			}
			i = j;
			continue;
		}
		i--;
	}
	return 0;
}

// Temp-variable name sets for the synthesised loop. The default is
// `__`-prefixed (hygienic) so the names can't collide with user
// identifiers in compiled output. The `readable` set swaps in bare
// names for display contexts (demos / tooltips) where legibility beats
// collision-safety — do NOT use it for code that actually runs against
// arbitrary user source.
const HYGIENIC_NAMES = {
	src: '__src',
	out: '__out',
	i: '__i',
	x: '__x',
	acc: '__acc',
	start: '__start',
};
const READABLE_NAMES = { src: 'arr', out: 'out', i: 'i', x: 'x', acc: 'acc', start: 'start' };

// ── Callback inlining ───────────────────────────────────────────────
// A stage callback is either a named reference (`clean`) — which has to
// stay a call, exactly like native `.map(clean)` would — or an inline
// arrow with an expression body (`(it) => it.length > 0`), which we
// splice straight into the loop. Inlining matters: the IIFE form
// `((it) => it.length > 0)(x, i, arr)` creates and calls a function
// every iteration, which is the per-element overhead fusion exists to
// remove. We only inline the provably-safe shape (simple identifier
// params; an expression body with no `{`, no nested `=>`/`function`;
// no more params than the loop supplies) and fall back to the call for
// everything else.

// Index of the top-level `=>` (outside strings / brackets), or -1.
function findTopLevelArrow(s) {
	let i = 0;
	let depth = 0;
	while (i < s.length) {
		const c = s[i];
		if (c === '"' || c === "'") {
			i = skipString(s, i);
			continue;
		}
		if (c === '`') {
			i = skipTemplate(s, i);
			continue;
		}
		if (c === '(' || c === '[' || c === '{') depth++;
		else if (c === ')' || c === ']' || c === '}') depth--;
		else if (depth === 0 && c === '=' && s[i + 1] === '>') return i;
		i++;
	}
	return -1;
}

// Parse `params => expr` into { params, body }, or null if it isn't a
// plain expression-bodied arrow with identifier params.
function parseSimpleArrow(s) {
	s = s.trim();
	if (/^async\b/.test(s)) return null;
	const arrow = findTopLevelArrow(s);
	if (arrow < 0) return null;
	let head = s.slice(0, arrow).trim();
	const body = s.slice(arrow + 2).trim();
	if (body === '' || body[0] === '{') return null; // block body
	if (head[0] === '(') {
		if (head[head.length - 1] !== ')') return null;
		head = head.slice(1, -1).trim();
	}
	const params = head === '' ? [] : head.split(',').map((p) => p.trim());
	for (const p of params) {
		if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(p)) return null; // no destructuring / defaults / types
	}
	return { params, body };
}

// Replace whole-identifier occurrences of `name` with `repl`, skipping
// strings / templates / comments and property accesses (`.name`).
function substituteIdent(body, name, repl) {
	if (!name || name === repl) return body;
	let out = '';
	let i = 0;
	while (i < body.length) {
		const c = body[i];
		if (c === '"' || c === "'") {
			const e = skipString(body, i);
			out += body.slice(i, e);
			i = e;
			continue;
		}
		if (c === '`') {
			const e = skipTemplate(body, i);
			out += body.slice(i, e);
			i = e;
			continue;
		}
		if (c === '/' && body[i + 1] === '/') {
			const nl = body.indexOf('\n', i);
			const e = nl < 0 ? body.length : nl;
			out += body.slice(i, e);
			i = e;
			continue;
		}
		if (c === '/' && body[i + 1] === '*') {
			const e = body.indexOf('*/', i + 2);
			const s2 = e < 0 ? body.length : e + 2;
			out += body.slice(i, s2);
			i = s2;
			continue;
		}
		if (isIdentStart(c)) {
			let j = i + 1;
			while (j < body.length && isIdentCont(body[j])) j++;
			const word = body.slice(i, j);
			const prev = out.replace(/\s+$/, '').slice(-1);
			out += word === name && prev !== '.' ? repl : word;
			i = j;
			continue;
		}
		out += c;
		i++;
	}
	return out;
}

// Find the sole top-level comparison operator in `s` (outside strings /
// brackets), or null if there are zero, more than one, or any top-level
// logical / ternary / assignment operator that would make a flip
// unsafe. Used to turn a filter guard's `!(a > b)` into `a <= b`.
function soleTopLevelComparison(s) {
	const cmp = [];
	let depth = 0;
	let i = 0;
	while (i < s.length) {
		const c = s[i];
		const c2 = s[i + 1];
		const c3 = s[i + 2];
		if (c === '"' || c === "'") {
			i = skipString(s, i);
			continue;
		}
		if (c === '`') {
			i = skipTemplate(s, i);
			continue;
		}
		if (c === '(' || c === '[' || c === '{') {
			depth++;
			i++;
			continue;
		}
		if (c === ')' || c === ']' || c === '}') {
			depth--;
			i++;
			continue;
		}
		if (depth > 0) {
			i++;
			continue;
		}
		// Top level: anything below makes a clean flip unsafe → bail.
		if (c === '&' && c2 === '&') return null;
		if (c === '|' && c2 === '|') return null;
		if (c === '?' && c2 === '?') return null; // ??
		if (c === '?' && c2 === '.') {
			i += 2;
			continue;
		} // ?. optional chaining — fine
		if (c === '?' || c === ':') return null; // ternary
		// Shifts are not comparisons — skip the whole operator.
		if (c === '<' && c2 === '<') {
			i += 2;
			continue;
		}
		if (c === '>' && c2 === '>') {
			i += c3 === '>' ? 3 : 2;
			continue;
		}
		// Comparison operators (3-char first).
		if ((c === '=' && c2 === '=' && c3 === '=') || (c === '!' && c2 === '=' && c3 === '=')) {
			cmp.push({ start: i, text: s.slice(i, i + 3) });
			i += 3;
			continue;
		}
		if (
			(c === '=' && c2 === '=') ||
			(c === '!' && c2 === '=') ||
			(c === '<' && c2 === '=') ||
			(c === '>' && c2 === '=')
		) {
			cmp.push({ start: i, text: s.slice(i, i + 2) });
			i += 2;
			continue;
		}
		if (c === '<' || c === '>') {
			cmp.push({ start: i, text: c });
			i++;
			continue;
		}
		if (c === '=') return null; // assignment / arrow — bail
		i++;
	}
	return cmp.length === 1 ? cmp[0] : null;
}

// Negate a predicate for a skip/return guard. A lone comparison flips
// its operator (`x.length > 0` → `x.length <= 0`); everything else keeps
// the always-correct `!(...)` wrapper.
const FLIP_CMP = {
	'>': '<=',
	'<': '>=',
	'>=': '<',
	'<=': '>',
	'===': '!==',
	'!==': '===',
	'==': '!=',
	'!=': '==',
};
function negate(pred) {
	pred = pred.trim();
	const op = soleTopLevelComparison(pred);
	if (op)
		return pred.slice(0, op.start) + FLIP_CMP[op.text] + pred.slice(op.start + op.text.length);
	return `!(${pred})`;
}

// Apply a callback to positional argument expressions — inlined when
// safe, otherwise a call `(cb)(...args)`.
function applyCb(cb, args) {
	const a = parseSimpleArrow(cb);
	if (a && a.params.length <= args.length && !/[{]|=>|\bfunction\b/.test(a.body)) {
		let body = a.body;
		for (let k = 0; k < a.params.length; k++) body = substituteIdent(body, a.params[k], args[k]);
		return body;
	}
	// A bare reference (`clean`, `obj.fn`) is called directly; only wrap a
	// compound callee (an arrow we couldn't inline, a `?:`, etc.) in parens.
	const callee = isSimpleRef(cb) ? cb.trim() : `(${cb})`;
	return `${callee}(${args.join(', ')})`;
}

// A reference that can be called without wrapping parens — an identifier
// with optional `.prop` / `?.prop` / `[…]` access chains.
function isSimpleRef(s) {
	return /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\?\.[A-Za-z_$][\w$]*|\[[^\]]*\])*$/.test(s.trim());
}

// Render the per-stage body for a TRANSFORM step. The synthesised loop
// iterates with `n.src` / `n.x` / `n.i`, so callbacks get the usual
// `(value, index, source)` triple.
function transformBody(stage, n) {
	if (stage.name === 'map') {
		return `\n\t\t${n.x} = ${applyCb(stage.args, [n.x, n.i, n.src])};`;
	}
	if (stage.name === 'filter') {
		return `\n\t\tif (${negate(applyCb(stage.args, [n.x, n.i, n.src]))}) continue;`;
	}
	return '';
}

// Build the full IIFE that replaces the chain. `producer` is the
// source expression preceding the first `.method()` call; `stages` is
// the fusable prefix; `n` is the temp-name set.
function synthesize(producer, stages, n) {
	const last = stages[stages.length - 1];
	const isTerminal = TERMINAL.has(last.name);
	const xforms = isTerminal ? stages.slice(0, -1) : stages;
	const xformsBody = xforms.map((s) => transformBody(s, n)).join('');

	if (!isTerminal) {
		return (
			`((${n.src}) => {\n` +
			`\tconst ${n.out} = [];\n` +
			`\tfor (let ${n.i} = 0; ${n.i} < ${n.src}.length; ${n.i}++) {\n` +
			`\t\tlet ${n.x} = ${n.src}[${n.i}];` +
			xformsBody +
			`\n\t\t${n.out}.push(${n.x});\n` +
			`\t}\n` +
			`\treturn ${n.out};\n` +
			`})(${producer})`
		);
	}

	switch (last.name) {
		case 'forEach':
			return (
				`((${n.src}) => {\n` +
				`\tfor (let ${n.i} = 0; ${n.i} < ${n.src}.length; ${n.i}++) {\n` +
				`\t\tlet ${n.x} = ${n.src}[${n.i}];` +
				xformsBody +
				`\n\t\t${applyCb(last.args, [n.x, n.i, n.src])};\n` +
				`\t}\n` +
				`})(${producer})`
			);
		case 'reduce': {
			const args = splitArgs(last.args);
			const cb = args[0] ?? '() => undefined';
			const hasInit = args.length >= 2;
			const init = hasInit ? args[1] : 'undefined';
			// Native .reduce without an initial value uses the first
			// element AS the accumulator and starts at index 1. The
			// emitted loop handles both forms.
			return (
				`((${n.src}) => {\n` +
				`\tlet ${n.acc} = ${init};\n` +
				`\tlet ${n.start} = 0;\n` +
				(hasInit
					? ''
					: `\tif (${n.src}.length > 0) { ${n.acc} = ${n.src}[0]; ${n.start} = 1; }\n`) +
				`\tfor (let ${n.i} = ${n.start}; ${n.i} < ${n.src}.length; ${n.i}++) {\n` +
				`\t\tlet ${n.x} = ${n.src}[${n.i}];` +
				xformsBody +
				`\n\t\t${n.acc} = ${applyCb(cb, [n.acc, n.x, n.i, n.src])};\n` +
				`\t}\n` +
				`\treturn ${n.acc};\n` +
				`})(${producer})`
			);
		}
		case 'some':
			return (
				`((${n.src}) => {\n` +
				`\tfor (let ${n.i} = 0; ${n.i} < ${n.src}.length; ${n.i}++) {\n` +
				`\t\tlet ${n.x} = ${n.src}[${n.i}];` +
				xformsBody +
				`\n\t\tif (${applyCb(last.args, [n.x, n.i, n.src])}) return true;\n` +
				`\t}\n` +
				`\treturn false;\n` +
				`})(${producer})`
			);
		case 'every':
			return (
				`((${n.src}) => {\n` +
				`\tfor (let ${n.i} = 0; ${n.i} < ${n.src}.length; ${n.i}++) {\n` +
				`\t\tlet ${n.x} = ${n.src}[${n.i}];` +
				xformsBody +
				`\n\t\tif (${negate(applyCb(last.args, [n.x, n.i, n.src]))}) return false;\n` +
				`\t}\n` +
				`\treturn true;\n` +
				`})(${producer})`
			);
		case 'find':
			return (
				`((${n.src}) => {\n` +
				`\tfor (let ${n.i} = 0; ${n.i} < ${n.src}.length; ${n.i}++) {\n` +
				`\t\tlet ${n.x} = ${n.src}[${n.i}];` +
				xformsBody +
				`\n\t\tif (${applyCb(last.args, [n.x, n.i, n.src])}) return ${n.x};\n` +
				`\t}\n` +
				`\treturn undefined;\n` +
				`})(${producer})`
			);
		case 'findIndex':
			return (
				`((${n.src}) => {\n` +
				`\tfor (let ${n.i} = 0; ${n.i} < ${n.src}.length; ${n.i}++) {\n` +
				`\t\tlet ${n.x} = ${n.src}[${n.i}];` +
				xformsBody +
				`\n\t\tif (${applyCb(last.args, [n.x, n.i, n.src])}) return ${n.i};\n` +
				`\t}\n` +
				`\treturn -1;\n` +
				`})(${producer})`
			);
	}
	return `${producer}${last.args}`;
}

// Find every fusable chain in the source, replacing each with its
// synthesised loop. Iterative: rewrite the leftmost chain, re-scan
// from after the rewrite, repeat. The replacement is a self-contained
// IIFE so it can sit in any expression position the original chain did.
export function lowerFusion(src, opts) {
	const names = opts?.readable ? READABLE_NAMES : HYGIENIC_NAMES;
	for (let safety = 0; safety < 4096; safety++) {
		const hit = findNextFusableChain(src, 0, names);
		if (!hit) return src;
		src = src.slice(0, hit.start) + hit.replacement + src.slice(hit.end);
		// move on past the rewritten span on the next pass — but we
		// just restart from 0 since the scanner is cheap and the
		// IIFE doesn't contain further fusable chains in its
		// generated form.
	}
	return src;
}

function findNextFusableChain(src, from, names = HYGIENIC_NAMES) {
	let i = from;
	while (i < src.length) {
		const c = src[i];
		if (c === '"' || c === "'") {
			i = skipString(src, i);
			continue;
		}
		if (c === '`') {
			i = skipTemplate(src, i);
			continue;
		}
		if (c === '/' && src[i + 1] === '/') {
			while (i < src.length && src[i] !== '\n') i++;
			continue;
		}
		if (c === '/' && src[i + 1] === '*') {
			i += 2;
			while (i < src.length - 1 && !(src[i] === '*' && src[i + 1] === '/')) i++;
			i += 2;
			continue;
		}
		if (c !== '.') {
			i++;
			continue;
		}
		// `.` candidate — must follow ), ], or an identifier char to
		// belong to a method call. Walk back past whitespace first so a
		// multi-line chain (where `.filter` sits on its own line) still
		// qualifies. Number-literal decimal points (`3.14`) get rejected
		// downstream by readMethodCall (no `(` follows the digits).
		let p = i - 1;
		while (p >= 0 && /\s/.test(src[p])) p--;
		const prev = p >= 0 ? src[p] : '';
		if (prev !== ')' && prev !== ']' && !isIdentCont(prev)) {
			i++;
			continue;
		}
		// Try to read a chain starting here.
		const chain = parseChain(src, i);
		if (chain.stages.length === 0) {
			i++;
			continue;
		}
		const fusable = longestFusablePrefix(chain.stages);
		if (fusable.length < 2) {
			i++;
			continue;
		}
		// Walk back to the producer.
		const producerStart = findProducerStart(src, i);
		if (producerStart < 0 || producerStart >= i) {
			i++;
			continue;
		}
		const producer = src.slice(producerStart, i).trim();
		if (producer.length === 0) {
			i++;
			continue;
		}
		const chainEnd = fusable[fusable.length - 1].end;
		const replacement = synthesize(producer, fusable, names);
		return { start: producerStart, end: chainEnd, replacement };
	}
	return null;
}

// Report every fusable chain in the source WITHOUT rewriting — for
// editors / tooltips that want to show "this chain fuses to <loop>".
// Returns `{ start, end, original, fused }` per chain, in source
// order, with non-overlapping ranges (we skip past each match).
export function findFusableChains(src, opts) {
	const names = opts?.readable ? READABLE_NAMES : HYGIENIC_NAMES;
	const out = [];
	let from = 0;
	for (let safety = 0; safety < 4096; safety++) {
		const hit = findNextFusableChain(src, from, names);
		if (!hit) break;
		out.push({
			start: hit.start,
			end: hit.end,
			original: src.slice(hit.start, hit.end),
			fused: hit.replacement,
		});
		from = hit.end;
	}
	return out;
}
