// LYK-965: emit a Designer page as a Cloudscape React (TSX) component.
//
// Parascape's component markup is ~1:1 with Cloudscape JSX (same component names
// + prop syntax), so the codegen is mostly: Cloudscape imports, the section band
// as styled <div>s, Columns→ColumnLayout, and {data.path} bindings. Lives in a
// plain .ts (not the .pui) so the JSX-in-template-strings doesn't go through
// para-preprocess. v1 covers presets, component nodes, instances (inlined),
// containers, and bindings; repeaters / actions / free-canvas are TODO notes.
import { SECTION_BY_ID, markupOf } from './sections';
import { componentOpen, identOf, takesContent } from './component-meta';

type Style = { bg: string; padY: number; fg: string; align: string; width: number };
type Node = {
	type: string;
	comp?: string;
	props?: Record<string, string | number | boolean>;
	content?: string;
	bind?: string;
	children?: Node[];
	ref?: string;
	values?: Record<string, string>;
	source?: string;
	style: Style;
};
type Comp = { id: string; name: string; def: Node[]; codeOverride?: string | null };
type Page = { name: string; doc: { sections: Node[]; codeOverride: string | null } };

const CS_OVERRIDE: Record<string, { id: string; ident: string }> = {
	columns: { id: 'column-layout', ident: 'ColumnLayout' },
};
const csIdent = (id: string) => CS_OVERRIDE[id]?.ident ?? identOf(id);
const csImportId = (id: string) => CS_OVERRIDE[id]?.id ?? id;
const isComp = (n: Node) => n.type === 'component';

function reactNode(n: Node, imports: Set<string>, byId: (id?: string) => Comp | undefined): string {
	// preset section → its (near-JSX) markup, normalized
	if (n.type !== 'component' && n.type !== 'instance' && n.type !== 'free' && n.type !== 'repeat') {
		const def = SECTION_BY_ID[n.type];
		if (!def) return `{/* unknown block: ${n.type} */}`;
		for (const id of def.imports) if (id !== 'section') imports.add(id);
		return markupOf(def, n.values ?? {}, false)
			.replace(/<Columns\b/g, '<ColumnLayout')
			.replace(/<\/Columns>/g, '</ColumnLayout>')
			.replace(/\bcols=/g, 'columns=');
	}
	if (n.type === 'instance') {
		const c = byId(n.ref);
		return c
			? c.def.map((d) => reactNode(d, imports, byId)).join('\n')
			: '{/* missing component */}';
	}
	if (n.type === 'repeat') return `{/* TODO: repeater over "${n.source ?? ''}" — map in code */}`;
	if (n.type === 'free')
		return (n.children ?? []).map((c) => reactNode(c, imports, byId)).join('\n');
	// component node
	const comp = n.comp as string;
	imports.add(comp);
	let open = componentOpen(comp, n.props ?? {});
	if (CS_OVERRIDE[comp])
		open = open.replace('<' + identOf(comp), '<' + csIdent(comp)).replace(/\bcols=/g, 'columns=');
	if (!takesContent(comp)) return `${open} />`;
	let inner: string;
	if (n.children && n.children.length)
		inner = '\n' + n.children.map((c) => reactNode(c, imports, byId)).join('\n') + '\n';
	else if (n.bind && n.bind.startsWith('state:')) inner = `{${n.bind.slice(6)}}`;
	else if (n.bind) inner = `{data.${n.bind}}`;
	else inner = n.content ? `{${JSON.stringify(n.content)}}` : '';
	return `${open}>${inner}</${csIdent(comp)}>`;
}

export function reactSourceFor(
	page: Page,
	data: Record<string, unknown>,
	components: Comp[],
): string {
	if (page.doc.codeOverride !== null)
		return `// "${page.name}" is authored as code (.pui). React export covers visual pages.\n`;
	const byId = (id?: string) => (id ? components.find((c) => c.id === id) : undefined);
	const imports = new Set<string>();
	const bands = page.doc.sections.map((s) => {
		const body = reactNode(s, imports, byId)
			.split('\n')
			.map((l) => '\t\t\t\t' + l)
			.join('\n');
		const st = s.style;
		const band = `{{ background: '${st.bg}', padding: '${st.padY}px 24px'${st.fg === 'light' ? ", color: '#fff'" : ''} }}`;
		const inner = `{{ maxWidth: ${st.width ? `'${st.width}px'` : "'none'"}, margin: '0 auto', textAlign: '${st.align}' }}`;
		const cls = st.fg === 'light' ? ' className="awsui-dark-mode"' : '';
		return `\t\t\t<div${cls} style=${band}>\n\t\t\t\t<div style=${inner}>\n${body}\n\t\t\t\t</div>\n\t\t\t</div>`;
	});
	const importLines = [...imports].map(
		(id) => `import ${csIdent(id)} from "@cloudscape-design/components/${csImportId(id)}";`,
	);
	const dataLine = /\{data\./.test(bands.join(''))
		? `\tconst data = ${JSON.stringify(data)};\n`
		: '';
	const fn = (page.name.replace(/[^A-Za-z0-9]/g, '') || 'Page').replace(/^[a-z]/, (c) =>
		c.toUpperCase(),
	);
	return `import React from "react";\nimport "@cloudscape-design/global-styles/index.css";\n${importLines.join('\n')}\n\nexport default function ${fn}() {\n${dataLine}\treturn (\n\t\t<>\n${bands.join('\n')}\n\t\t</>\n\t);\n}\n`;
}

export const __reactExportSelfCheck = isComp; // keep isComp referenced (lint)
