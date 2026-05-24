// Curated starter templates for the Designer (LYK-937). A template is just a
// list of section specs (a preset section id + optional value/style overrides);
// the Designer turns each spec into a real Section node with a fresh key. Used
// two ways: "New page" (a whole page from a template) and "Insert" (drop the
// template's section group into the current page).
import type { SectionStyle } from './sections';

export type TemplateSpec = {
	type: string;
	values?: Record<string, string>;
	style?: Partial<SectionStyle>;
};
export type Template = { id: string; name: string; blurb: string; sections: TemplateSpec[] };

export const TEMPLATES: Template[] = [
	{
		id: 'landing',
		name: 'Landing page',
		blurb: 'Hero · features · stats · CTA · footer',
		sections: [
			{ type: 'hero' },
			{ type: 'features' },
			{ type: 'stats' },
			{ type: 'cta' },
			{ type: 'footer' },
		],
	},
	{
		id: 'marketing',
		name: 'Marketing',
		blurb: 'Hero · story · features · CTA · footer',
		sections: [
			{
				type: 'hero',
				values: {
					title: 'Ship faster with .pui',
					subtitle: 'A Cloudscape-grade design system you compose visually — no React overhead.',
					cta: 'Start free',
				},
			},
			{
				type: 'text',
				values: {
					heading: 'Why teams switch',
					body: 'Fine-grained reactivity, the component API you already know, and visual composition.',
				},
				style: { align: 'left', width: 760 },
			},
			{ type: 'features' },
			{ type: 'cta', values: { title: 'See it in action', cta: 'Open the Designer' } },
			{ type: 'footer' },
		],
	},
	{
		id: 'about',
		name: 'About / content',
		blurb: 'Intro · stats · section · footer',
		sections: [
			{
				type: 'text',
				values: { heading: 'About us', body: 'Tell your story here.' },
				style: { align: 'left', width: 760 },
			},
			{ type: 'stats' },
			{
				type: 'text',
				values: { heading: 'Our approach', body: 'Replace this with your own copy.' },
				style: { align: 'left', width: 760 },
			},
			{ type: 'footer' },
		],
	},
	{
		id: 'blank',
		name: 'Blank page',
		blurb: 'Start from an empty canvas',
		sections: [],
	},
];
