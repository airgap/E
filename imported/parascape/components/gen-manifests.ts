// Manifest generator — parses each .pui component's `$props()` type block
// with the TypeScript compiler API and emits components/manifests.json:
// one entry per component with its props (name, type, default, optional,
// kind). Drives the docs props tables / playground and the AI builder.
//
//   bun components/gen-manifests.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve(import.meta.dirname, '..');
const COMP_DIR = path.join(ROOT, 'src/lib/components');
const OUT = path.join(import.meta.dirname, 'manifests.json');

type PropKind = 'value' | 'event' | 'slot';
type PropInfo = {
	name: string;
	type: string;
	default: string | null;
	optional: boolean;
	bindable: boolean;
	kind: PropKind;
};
type Manifest = { id: string; name: string; props: PropInfo[] };

const kebab = (n: string) =>
	n
		.replace(/([a-z0-9])([A-Z])/g, '$1-$2')
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
		.toLowerCase();

// Pull the `let { … }: { … } = $props();` statement out of a script body.
function extractPropsStatement(script: string): string | null {
	const pi = script.indexOf('$props(');
	if (pi < 0) return null;
	const lets = [...script.matchAll(/\blet\s*\{/g)].map((m) => m.index!).filter((i) => i < pi);
	if (!lets.length) return null;
	const start = lets[lets.length - 1];
	let end = script.indexOf(')', pi) + 1;
	if (script[end] === ';') end++;
	let stmt = script.slice(start, end).trim();
	if (!stmt.endsWith(';')) stmt += ';';
	return stmt;
}

function classify(name: string, type: string): PropKind {
	if (type.includes('Snippet')) return 'slot';
	if (/^on[A-Z]/.test(name) && /=>|\bFunction\b/.test(type)) return 'event';
	return 'value';
}

function parseComponent(file: string): Manifest | null {
	const src = fs.readFileSync(file, 'utf8');
	const scriptMatch = src.match(/<script[^>]*>([\s\S]*?)<\/script>/);
	if (!scriptMatch) return null;
	const stmt = extractPropsStatement(scriptMatch[1]);
	if (!stmt)
		return { id: kebab(path.basename(file, '.pui')), name: path.basename(file, '.pui'), props: [] };

	const sf = ts.createSourceFile('p.ts', stmt, ts.ScriptTarget.Latest, true);
	const decl = (sf.statements[0] as ts.VariableStatement)?.declarationList?.declarations?.[0];
	if (!decl) return null;
	const binding = decl.name; // ObjectBindingPattern
	const typeNode = decl.type; // TypeLiteralNode

	// defaults from the destructure
	const defaults = new Map<string, { def: string | null; bindable: boolean }>();
	if (ts.isObjectBindingPattern(binding)) {
		for (const el of binding.elements) {
			const nm = (el.propertyName ?? el.name).getText(sf);
			if (!el.initializer) {
				defaults.set(nm, { def: null, bindable: false });
				continue;
			}
			const initTxt = el.initializer.getText(sf);
			const bindable = /^\$bindable\(/.test(initTxt);
			const def = bindable ? initTxt.replace(/^\$bindable\(([\s\S]*)\)$/, '$1') || '' : initTxt;
			defaults.set(nm, { def: def === 'undefined' ? null : def, bindable });
		}
	}

	const props: PropInfo[] = [];
	if (typeNode && ts.isTypeLiteralNode(typeNode)) {
		for (const m of typeNode.members) {
			if (!ts.isPropertySignature(m) || !m.name) continue;
			const name = m.name.getText(sf);
			if (name.startsWith('[')) continue; // index signature
			const type = m.type ? m.type.getText(sf).replace(/\s+/g, ' ') : 'unknown';
			const d = defaults.get(name) ?? { def: null, bindable: false };
			props.push({
				name,
				type,
				default: d.def,
				optional: !!m.questionToken,
				bindable: d.bindable,
				kind: classify(name, type),
			});
		}
	}
	return { id: kebab(path.basename(file, '.pui')), name: path.basename(file, '.pui'), props };
}

const files = fs.readdirSync(COMP_DIR).filter((f) => f.endsWith('.pui'));
const manifests: Record<string, Manifest> = {};
let propCount = 0;
for (const f of files) {
	const m = parseComponent(path.join(COMP_DIR, f));
	if (m) {
		manifests[m.id] = m;
		propCount += m.props.length;
	}
}
fs.writeFileSync(OUT, JSON.stringify(manifests, null, 2) + '\n');
console.log(`Wrote ${OUT}: ${Object.keys(manifests).length} components, ${propCount} props.`);
