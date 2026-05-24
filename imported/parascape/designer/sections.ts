// Section library for the Parascape site Designer. Each section is a Wix-style
// content block whose *content* is composed from real Parascape (Cloudscape)
// component ports — the designer compiles it live via the demos' live-compiler
// and stacks the sections vertically. The styled wrapper around each section
// (background / padding / alignment / width) is plain CSS owned by the
// designer; only the inner content is a compiled .pui component.

export type Field = { key: string; label: string; multiline?: boolean };

export type SectionStyle = {
	bg: string; // background color (or 'transparent')
	fg: string; // 'inherit' | 'light' (for dark backgrounds)
	padY: number; // vertical padding (px)
	align: 'left' | 'center' | 'right';
	width: number | 0; // content max-width (px); 0 = full bleed
};

export type SectionDef = {
	id: string;
	name: string;
	blurb: string;
	imports: string[]; // kebab component ids used in the markup
	fields: Field[];
	defaults: Record<string, string>;
	style: SectionStyle;
	// `fld(key)` yields the field's rendered text — escaped plain text for export,
	// or a `<span data-pf>` marker for the in-place editor (see markupOf).
	markup: (f: Record<string, string>, fld: (key: string) => string) => string;
};

const pascal = (id: string) =>
	id
		.split('-')
		.map((s) => s.charAt(0).toUpperCase() + s.slice(1))
		.join('');

// Escape user text so it is inert inside .pui markup (no template/expression
// or tag injection). `{` `}` start Svelte expressions; `<` starts a tag.
export const esc = (s: string) =>
	String(s ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/\{/g, '&#123;')
		.replace(/\}/g, '&#125;')
		.replace(/`/g, '&#96;');

const sty = (over: Partial<SectionStyle>): SectionStyle => ({
	bg: 'transparent',
	fg: 'inherit',
	padY: 64,
	align: 'center',
	width: 1040,
	...over,
});

export const SECTIONS: SectionDef[] = [
	{
		id: 'hero',
		name: 'Hero',
		blurb: 'Big headline, subtext, and a primary call to action.',
		// Centered hero headline uses <Box variant="h1">, not <Header>: Cloudscape's
		// Header is a left-aligned title-bar (flex row + text-align:start reset) and
		// won't center. Box is a plain heading block that honours the band's alignment.
		imports: ['space-between', 'box', 'button'],
		fields: [
			{ key: 'title', label: 'Headline' },
			{ key: 'subtitle', label: 'Subtext', multiline: true },
			{ key: 'cta', label: 'Button label' },
		],
		defaults: {
			title: 'Build it in .pui',
			subtitle:
				'A Cloudscape-grade design system, composed visually. Every block here is a real Parascape component.',
			cta: 'Get started',
		},
		style: sty({ padY: 96, bg: '#0f1b2d', fg: 'light' }),
		markup: (f, fld) => `<SpaceBetween size="l">
	<Box variant="h1">${fld('title')}</Box>
	<Box variant="p" fontSize="heading-s">${fld('subtitle')}</Box>
	<Box><Button variant="primary">${fld('cta')}</Button></Box>
</SpaceBetween>`,
	},
	{
		id: 'text',
		name: 'Text',
		blurb: 'A heading and a paragraph of body copy.',
		imports: ['space-between', 'header', 'box'],
		fields: [
			{ key: 'heading', label: 'Heading' },
			{ key: 'body', label: 'Body', multiline: true },
		],
		defaults: {
			heading: 'About this section',
			body: 'Replace this with your own copy. The heading and text are rendered by the ported Header and Box components.',
		},
		style: sty({ align: 'left', width: 760 }),
		markup: (f, fld) => `<SpaceBetween size="s">
	<Header variant="h2">${fld('heading')}</Header>
	<Box variant="p" color="text-body-secondary">${fld('body')}</Box>
</SpaceBetween>`,
	},
	{
		id: 'features',
		name: 'Feature columns',
		blurb: 'Three side-by-side features in a column layout.',
		imports: ['columns', 'space-between', 'header', 'box'],
		fields: [
			{ key: 't1', label: 'Feature 1 title' },
			{ key: 'b1', label: 'Feature 1 text', multiline: true },
			{ key: 't2', label: 'Feature 2 title' },
			{ key: 'b2', label: 'Feature 2 text', multiline: true },
			{ key: 't3', label: 'Feature 3 title' },
			{ key: 'b3', label: 'Feature 3 text', multiline: true },
		],
		defaults: {
			t1: 'Fast',
			b1: 'Signals over hooks — fine-grained reactivity with no virtual DOM.',
			t2: 'Familiar',
			b2: 'The Cloudscape component API you already know, ported to .pui.',
			t3: 'Composable',
			b3: 'Drop components onto a page and wire them up visually.',
		},
		style: sty({ width: 1040 }),
		markup: (f, fld) => `<Columns cols={3} gap="32px" align="left">
	<SpaceBetween size="xs"><Header variant="h3">${fld('t1')}</Header><Box variant="p" color="text-body-secondary">${fld('b1')}</Box></SpaceBetween>
	<SpaceBetween size="xs"><Header variant="h3">${fld('t2')}</Header><Box variant="p" color="text-body-secondary">${fld('b2')}</Box></SpaceBetween>
	<SpaceBetween size="xs"><Header variant="h3">${fld('t3')}</Header><Box variant="p" color="text-body-secondary">${fld('b3')}</Box></SpaceBetween>
</Columns>`,
	},
	{
		id: 'stats',
		name: 'Stats band',
		blurb: 'Three big numbers with labels.',
		imports: ['columns', 'box'],
		fields: [
			{ key: 'v1', label: 'Stat 1 value' },
			{ key: 'l1', label: 'Stat 1 label' },
			{ key: 'v2', label: 'Stat 2 value' },
			{ key: 'l2', label: 'Stat 2 label' },
			{ key: 'v3', label: 'Stat 3 value' },
			{ key: 'l3', label: 'Stat 3 label' },
		],
		defaults: {
			v1: '74',
			l1: 'components',
			v2: '1:1',
			l2: 'Cloudscape API',
			v3: '0',
			l3: 'React hooks',
		},
		// Transparent so the big numbers sit on the page background and keep correct
		// contrast in both light and dark themes. (A fixed light band would show
		// light theme-coloured text on a light surface in dark mode.)
		style: sty({}),
		markup: (f, fld) => `<Columns cols={3} gap="24px">
	<Box textAlign="center"><Box variant="h1" fontSize="display-l" fontWeight="bold">${fld('v1')}</Box><Box variant="p" color="text-body-secondary">${fld('l1')}</Box></Box>
	<Box textAlign="center"><Box variant="h1" fontSize="display-l" fontWeight="bold">${fld('v2')}</Box><Box variant="p" color="text-body-secondary">${fld('l2')}</Box></Box>
	<Box textAlign="center"><Box variant="h1" fontSize="display-l" fontWeight="bold">${fld('v3')}</Box><Box variant="p" color="text-body-secondary">${fld('l3')}</Box></Box>
</Columns>`,
	},
	{
		id: 'image',
		name: 'Image',
		blurb: 'An uploaded image from your media library.',
		imports: [],
		fields: [
			{ key: 'src', label: 'Image URL' },
			{ key: 'alt', label: 'Alt text (required for accessibility)' },
		],
		defaults: { src: '', alt: '' },
		style: sty({ padY: 32 }),
		markup: (f) =>
			`<img src="${esc(f.src).replace(/"/g, '&quot;')}" alt="${esc(f.alt).replace(/"/g, '&quot;')}" style="max-width:100%;height:auto;display:block;margin:0 auto;border-radius:8px" />`,
	},
	{
		id: 'cta',
		name: 'Call to action',
		blurb: 'A centered heading with a button.',
		// Centered heading → <Box variant="h2"> (see Hero note); Header won't center.
		imports: ['space-between', 'button', 'box'],
		fields: [
			{ key: 'title', label: 'Heading' },
			{ key: 'cta', label: 'Button label' },
		],
		defaults: { title: 'Ready to try it?', cta: 'Open the Builder' },
		style: sty({ padY: 72, bg: '#006ce0', fg: 'light' }),
		markup: (f, fld) => `<SpaceBetween size="m">
	<Box variant="h2">${fld('title')}</Box>
	<Box><Button variant="primary">${fld('cta')}</Button></Box>
</SpaceBetween>`,
	},
	{
		id: 'footer',
		name: 'Footer',
		blurb: 'A small footer line.',
		imports: ['box'],
		fields: [{ key: 'text', label: 'Footer text' }],
		defaults: {
			text: 'Parascape — the Cloudscape Design System, ported to .pui.',
		},
		style: sty({ padY: 28, bg: '#0f1b2d', fg: 'light' }),
		markup: (f, fld) => `<Box fontSize="body-s">${fld('text')}</Box>`,
	},
];

export const SECTION_BY_ID: Record<string, SectionDef> = Object.fromEntries(
	SECTIONS.map((s) => [s.id, s]),
);

export function importLine(id: string): string {
	return `\timport ${pascal(id)} from '@parascape-design/components/${id}';`;
}

// Render a section's markup. `editable` wraps each field value in a
// `<span class="pf" data-pf="key">` marker so the Designer can map a
// double-clicked text node back to the field it came from; export leaves
// the markup as plain escaped text.
export function markupOf(
	def: SectionDef,
	values: Record<string, string>,
	editable = false,
): string {
	const v = { ...def.defaults, ...values };
	const fld = editable
		? (k: string) => `<span class="pf" data-pf="${k}">${esc(v[k] ?? '')}</span>`
		: (k: string) => esc(v[k] ?? '');
	return def.markup(v, fld);
}

// A single section's content as a compilable .pui module (for live preview).
export function sectionSource(
	def: SectionDef,
	values: Record<string, string>,
	editable = false,
): string {
	const imports = def.imports.map(importLine).join('\n');
	return `<script lang="pts">\n${imports}\n<\/script>\n\n${markupOf(def, values, editable)}\n`;
}
