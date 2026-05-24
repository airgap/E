// Manifest-driven helpers for placing raw Parascape components (and editing
// their props) in the Designer. Mirrors the Builder's component handling,
// sourced from the generated components/manifests.json. Kept separate so the
// Designer can add individual components alongside the preset sections.

import manifests from '../components/manifests.json';
import { allItems } from '../components/catalog';

export type PropRow = {
	name: string;
	type: string;
	default: string | null;
	optional: boolean;
	bindable: boolean;
	kind: string;
};
type Manifest = { id: string; name: string; props: PropRow[] };
const M = manifests as Record<string, Manifest>;

export const allComponents = allItems; // [{ name, id, blurb }]

const pascal = (id: string) =>
	id
		.split('-')
		.map((s) => s.charAt(0).toUpperCase() + s.slice(1))
		.join('');

export const identOf = (id: string): string => M[id]?.name ?? pascal(id);
export const displayName = (id: string): string => allItems.find((i) => i.id === id)?.name ?? id;
export const takesContent = (id: string): boolean =>
	(M[id]?.props ?? []).some((p) => p.name === 'children');
export const propMeta = (id: string, name: string): PropRow | undefined =>
	(M[id]?.props ?? []).find((p) => p.name === name);

export const isUnion = (p: PropRow): boolean =>
	/^('[^']*'\s*\|\s*)+'[^']*'$/.test(p.type.trim()) || p.type.trim() === 'boolean';
export const unionOptions = (type: string): string[] =>
	type
		.split('|')
		.map((s) => s.trim().replace(/^'|'$/g, ''))
		.filter(Boolean);
// Props the inspector can edit: simple value props (string/number/boolean) + unions.
export const editableProps = (id: string): PropRow[] =>
	(M[id]?.props ?? []).filter(
		(p) => (p.kind === 'value' && /^(string|number|boolean)$/.test(p.type.trim())) || isUnion(p),
	);

// Sensible defaults so a freshly-dropped component renders something.
export const seed: Record<
	string,
	{ content?: string; props?: Record<string, string | number | boolean> }
> = {
	header: { content: 'Section title' },
	box: { content: 'Some text' },
	container: { content: 'Container body' },
	alert: { content: 'Alert message', props: { type: 'info' } },
	button: { content: 'Click me', props: { variant: 'primary' } },
	badge: { content: 'badge' },
	'status-indicator': { content: 'Available', props: { type: 'success' } },
	link: { content: 'A link', props: { href: '#' } },
	'progress-bar': { props: { value: 42 } },
	spinner: {},
	divider: {},
	checkbox: { content: 'Enable' },
	toggle: { content: 'On' },
	input: { props: { value: '', placeholder: 'Type…' } },
	textarea: { props: { value: '' } },
	'expandable-section': { content: 'Hidden content', props: { headerText: 'Section' } },
};

function fmtAttr(name: string, value: string | number | boolean, p: PropRow | undefined): string {
	if (value === '' || value === undefined) return '';
	if (typeof value === 'boolean') return value ? `${name}` : '';
	if (typeof value === 'number') return `${name}={${value}}`;
	const t = (p?.type ?? 'string').trim();
	if (t === 'number') return `${name}={${value}}`;
	return `${name}="${String(value).replace(/"/g, '&quot;')}"`;
}

// The opening tag without the closing `>` (or self-close), e.g.
// `<Container header="…"`. Lets callers build container markup with arbitrary
// nested children (the Designer's recursive renderer uses this).
export function componentOpen(
	id: string,
	props: Record<string, string | number | boolean>,
): string {
	const ident = identOf(id);
	const attrs = Object.entries(props ?? {})
		.map(([k, v]) => fmtAttr(k, v, propMeta(id, k)))
		.filter(Boolean)
		.join(' ');
	return attrs ? `<${ident} ${attrs}` : `<${ident}`;
}

// Just the component element markup, e.g. `<Button variant="primary">Click</Button>`.
// `editable` wraps the content in a `<span data-pf="content">` marker so the
// Designer's in-place editor can target it; export leaves it bare.
export function componentTag(
	id: string,
	props: Record<string, string | number | boolean>,
	content: string,
	editable = false,
): string {
	const ident = identOf(id);
	const attrs = Object.entries(props ?? {})
		.map(([k, v]) => fmtAttr(k, v, propMeta(id, k)))
		.filter(Boolean)
		.join(' ');
	const open = attrs ? `<${ident} ${attrs}` : `<${ident}`;
	if (!(takesContent(id) && content)) return `${open} />`;
	const inner = editable ? `<span class="pf" data-pf="content">${content}</span>` : content;
	return `${open}>${inner}</${ident}>`;
}

// A single raw component as a compilable .pui module (for live preview).
export function componentSource(
	id: string,
	props: Record<string, string | number | boolean>,
	content: string,
	editable = false,
): string {
	return `<script lang="pts">\n\timport ${identOf(id)} from '@parascape-design/components/${id}';\n<\/script>\n\n${componentTag(id, props, content, editable)}\n`;
}
