// LYK-967: generate a Parascape-shaped manifest + catalog for @lyku/si-bits, so
// the Designer can treat Lyku's component library as a pluggable ComponentLibrary
// (the second one, after Cloudscape). si-bits has no manifest of its own, so we
// derive it from source: the barrel (src/index.ts) lists modules, each module's
// index.ts names the component + its file, and the file's `$props()` type gives
// the prop surface (parsed with the TS AST — regex is too fragile across 300+
// hand-authored components).
//
// Output mirrors components/{manifests.json,catalog.ts}:
//   components/si-bits/manifest.json  Record<id, { id, name, props: PropRow[] }>
//   components/si-bits/catalog.ts     CatalogGroup[] + allItems
//
// Run:  bun scripts/gen-sibits-manifest.ts [si-bits-src-dir]
import ts from 'typescript';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const SRC = process.argv[2] ?? '/raid/lyku/libs/si-bits/src';
const OUT_DIR = join(import.meta.dir, '..', 'components', 'si-bits');

type PropRow = {
	name: string;
	type: string;
	default: string | null;
	optional: boolean;
	bindable: boolean;
	kind: string;
};
type Manifest = { id: string; name: string; props: PropRow[] };

const kebab = (s: string) =>
	s
		.replace(/([a-z0-9])([A-Z])/g, '$1-$2')
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
		.toLowerCase();
const printer = ts.createPrinter({ removeComments: true });
const sf = (code: string) => ts.createSourceFile('m.ts', code, ts.ScriptTarget.Latest, true);
const scriptOf = (src: string) =>
	[...src.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
const typeText = (node: ts.TypeNode, src: ts.SourceFile) =>
	printer.printNode(ts.EmitHint.Unspecified, node, src).replace(/\s+/g, ' ').trim();

function kindOf(type: string): string {
	if (/(^|\b)Snippet(<|\b)/.test(type)) return 'snippet';
	if (/=>/.test(type) || /^\((?!\s*\))/.test(type)) return 'event';
	return 'value';
}

// resolve the type node passed to $props() — `let {…}: T = $props()`, `$props<T>()`,
// or an untyped `const {…} = $props()` (no T, props inferred from the binding). T
// may be an inline `{…}` literal or a local interface/type alias.
function propsType(
	src: ts.SourceFile,
): { type?: ts.TypeNode; binding?: ts.ObjectBindingPattern } | null {
	let found: { type?: ts.TypeNode; binding?: ts.ObjectBindingPattern } | null = null;
	const visit = (n: ts.Node) => {
		if (found) return;
		if (ts.isCallExpression(n) && n.expression.getText(src) === '$props') {
			const decl = n.parent;
			const binding =
				ts.isVariableDeclaration(decl) && ts.isObjectBindingPattern(decl.name)
					? decl.name
					: undefined;
			if (n.typeArguments?.length) found = { type: n.typeArguments[0], binding };
			else if (ts.isVariableDeclaration(decl)) found = { type: decl.type, binding };
		}
		if (!found) ts.forEachChild(n, visit);
	};
	visit(src);
	if (!found) return null;
	// deref a type reference to a local interface / type alias
	if (found.type && ts.isTypeReferenceNode(found.type)) {
		const name = found.type.typeName.getText(src);
		let resolved: ts.TypeNode | null = null;
		ts.forEachChild(src, (n) => {
			if (ts.isInterfaceDeclaration(n) && n.name.text === name)
				resolved = ts.factory.createTypeLiteralNode(n.members);
			else if (ts.isTypeAliasDeclaration(n) && n.name.text === name) resolved = n.type;
		});
		if (resolved) return { type: resolved, binding: found.binding };
	}
	return found;
}

// prop name -> default literal / bindable flag, from the destructuring pattern.
function defaults(binding: ts.ObjectBindingPattern | undefined, src: ts.SourceFile) {
	const out = new Map<string, { default: string | null; bindable: boolean }>();
	if (!binding) return out;
	for (const el of binding.elements) {
		if (!ts.isBindingElement(el) || el.dotDotDotToken) continue;
		const key = (el.propertyName ?? el.name).getText(src);
		let def: string | null = null;
		let bindable = false;
		if (el.initializer) {
			if (
				ts.isCallExpression(el.initializer) &&
				el.initializer.expression.getText(src) === '$bindable'
			) {
				bindable = true;
				def = el.initializer.arguments[0]?.getText(src) ?? null;
			} else def = el.initializer.getText(src);
		}
		out.set(key, { default: def, bindable });
	}
	return out;
}

function propsFrom(
	type: ts.TypeNode,
	binding: ts.ObjectBindingPattern | undefined,
	src: ts.SourceFile,
): PropRow[] {
	if (!ts.isTypeLiteralNode(type)) return [];
	const defs = defaults(binding, src);
	const rows: PropRow[] = [];
	for (const m of type.members) {
		if (!ts.isPropertySignature(m) || !m.name) continue;
		if (ts.isComputedPropertyName(m.name)) continue; // skip `[key: string]`
		const name = ts.isStringLiteral(m.name) ? m.name.text : m.name.getText(src);
		const tp = m.type ? typeText(m.type, src) : 'any';
		const d = defs.get(name);
		rows.push({
			name,
			type: tp,
			default: d?.default ?? null,
			optional: !!m.questionToken,
			bindable: d?.bindable ?? false,
			kind: kindOf(tp),
		});
	}
	return rows;
}

// Untyped `const {…} = $props()` — infer prop names from the destructure, and
// the type from the default literal so simple props stay inspector-editable.
function propsFromBinding(binding: ts.ObjectBindingPattern, src: ts.SourceFile): PropRow[] {
	const rows: PropRow[] = [];
	for (const el of binding.elements) {
		if (!ts.isBindingElement(el) || el.dotDotDotToken) continue;
		const name = (el.propertyName ?? el.name).getText(src);
		let bindable = false;
		let def: string | null = null;
		let init = el.initializer;
		if (init && ts.isCallExpression(init) && init.expression.getText(src) === '$bindable') {
			bindable = true;
			init = init.arguments[0];
		}
		if (init) def = init.getText(src);
		const type =
			init && (init.kind === ts.SyntaxKind.TrueKeyword || init.kind === ts.SyntaxKind.FalseKeyword)
				? 'boolean'
				: init && ts.isNumericLiteral(init)
					? 'number'
					: init && ts.isStringLiteralLike(init)
						? 'string'
						: 'any';
		rows.push({
			name,
			type,
			default: def,
			optional: true,
			bindable,
			kind: name === 'children' ? 'snippet' : kindOf(type),
		});
	}
	return rows;
}

// each `export { default as Name } from './File'` in a module index.ts
function moduleComponents(indexPath: string): { name: string; file: string }[] {
	if (!existsSync(indexPath)) return [];
	const src = sf(readFileSync(indexPath, 'utf8'));
	const out: { name: string; file: string }[] = [];
	ts.forEachChild(src, (n) => {
		if (!ts.isExportDeclaration(n) || !n.exportClause || !ts.isNamedExports(n.exportClause)) return;
		const spec =
			n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier) ? n.moduleSpecifier.text : '';
		if (!/\.(svelte|pui)$/.test(spec)) return; // only component re-exports
		for (const e of n.exportClause.elements) {
			if ((e.propertyName?.text ?? 'default') === 'default')
				out.push({ name: e.name.text, file: spec });
		}
	});
	return out;
}

// ---- drive from the barrel ----
const barrel = sf(readFileSync(join(SRC, 'index.ts'), 'utf8'));
const modules: string[] = [];
ts.forEachChild(barrel, (n) => {
	if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
		const m = n.moduleSpecifier.text.match(/^\.\/(.+)$/);
		if (m && !n.exportClause) modules.push(m[1]); // `export * from './X'`
	}
});

const manifest: Record<string, Manifest> = {};
const items: { name: string; id: string; blurb: string }[] = [];
let parsed = 0;
let noProps = 0;
let skipped = 0;

for (const mod of modules) {
	const comps = moduleComponents(join(SRC, mod, 'index.ts'));
	if (!comps.length) {
		skipped++;
		continue;
	}
	for (const { name, file } of comps) {
		const filePath = join(SRC, mod, file);
		if (!existsSync(filePath)) {
			skipped++;
			continue;
		}
		const id = kebab(name);
		if (manifest[id]) continue;
		let props: PropRow[] = [];
		try {
			const src = sf(scriptOf(readFileSync(filePath, 'utf8')));
			const pt = propsType(src);
			if (pt?.type) props = propsFrom(pt.type, pt.binding, src);
			else if (pt?.binding) props = propsFromBinding(pt.binding, src);
		} catch {
			/* unparseable script — ship the component with no editable props */
		}
		if (props.length) parsed++;
		else noProps++;
		manifest[id] = { id, name, props };
		items.push({ name, id, blurb: '' });
	}
}

items.sort((a, b) => a.name.localeCompare(b.name));
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const catalogTs =
	`// AUTO-GENERATED by scripts/gen-sibits-manifest.ts — do not edit by hand.\n` +
	`// Source: @lyku/si-bits (${items.length} components).\n` +
	`import type { CatalogGroup, CatalogItem } from "../catalog";\n\n` +
	`export const catalog: CatalogGroup[] = [\n  {\n    category: "si-bits",\n    items: ${JSON.stringify(items, null, 6).replace(/\n/g, '\n    ')},\n  },\n];\n\n` +
	`export const allItems: CatalogItem[] = catalog.flatMap(g => g.items);\n`;
writeFileSync(join(OUT_DIR, 'catalog.ts'), catalogTs);

console.log(
	`si-bits manifest: ${items.length} components (${parsed} with props, ${noProps} prop-less, ${skipped} skipped non-components)`,
);
console.log(`  → ${join(OUT_DIR, 'manifest.json')}`);
console.log(`  → ${join(OUT_DIR, 'catalog.ts')}`);
