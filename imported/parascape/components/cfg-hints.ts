// Thin per-component hints for the standardized configurator. The engine
// (cfg-derive.ts) auto-derives controls from each component's manifest; hints
// only fill the gaps the manifest can't express:
//   • `options` — real option sets for props the source types loosely as `string`
//   • `children` — initial editable content (also forces a children control)
//   • `samples` — fixed values for complex props (items, definitions) so
//                 structured components still render a live preview
import type { Hints } from './cfg-derive';

// Cartesian chart data: y-values → [{x,y}] points.
const xy = (ys: number[]) => ys.map((y, x) => ({ x, y }));

export const hints: Record<string, Hints> = {
	// Enum props (variant / size / type / color …) are now real unions in the
	// port `$props()` types, so the manifest captures them and the engine derives
	// the selects automatically. Hints below cover only what types can't express:
	// open-ended sets (icon names), curated token subsets (box color/fontSize,
	// link fontSize), initial children text, sample collection data, and notes.
	button: {
		options: {
			iconName: ['', 'settings', 'add-plus', 'external', 'refresh', 'download', 'search'],
		},
		children: 'Submit',
	},
	badge: { children: 'Badge' },
	'status-indicator': { children: 'Status' },
	link: {
		options: { fontSize: ['body-s', 'body-m', 'heading-xs', 'heading-s', 'heading-m'] },
		children: 'Learn more',
	},
	box: {
		options: {
			color: [
				'',
				'text-status-info',
				'text-status-success',
				'text-status-error',
				'text-status-inactive',
				'text-label',
			],
			fontSize: ['', 'body-s', 'body-m', 'heading-s', 'heading-m', 'heading-l', 'display-l'],
		},
		children: 'The quick brown fox.',
	},
	header: { children: 'Section title' },
	checkbox: { children: 'Enable notifications' },
	toggle: { children: 'Wi-Fi' },
	alert: { children: 'Your changes were saved.' },
	container: { children: 'Content sits inside a bordered surface.' },
	'expandable-section': { children: 'The content revealed when the section is expanded.' },
	icon: {
		options: {
			name: [
				'settings',
				'status-positive',
				'status-warning',
				'status-negative',
				'search',
				'external',
				'refresh',
				'add-plus',
				'close',
				'menu',
			],
		},
	},
	// ── structured components: sample data so the preview renders ──
	table: {
		samples: {
			columnDefinitions: [
				{ id: 'name', header: 'Name', cell: (i: { name: string }) => i.name },
				{ id: 'type', header: 'Type', cell: (i: { type: string }) => i.type },
				{ id: 'status', header: 'Status', cell: (i: { status: string }) => i.status },
			],
			items: [
				{ name: 'web-1', type: 't3.medium', status: 'Running' },
				{ name: 'web-2', type: 't3.large', status: 'Stopped' },
				{ name: 'db-1', type: 'r5.xlarge', status: 'Running' },
			],
		},
	},
	cards: {
		samples: {
			items: [
				{ id: '1', name: 'web-1', az: 'us-east-1a' },
				{ id: '2', name: 'web-2', az: 'us-east-1b' },
			],
			cardDefinition: {
				header: (i: { name: string }) => i.name,
				sections: [{ id: 'az', header: 'AZ', content: (i: { az: string }) => i.az }],
			},
		},
	},
	'key-value-pairs': {
		samples: {
			items: [
				{ label: 'Status', value: 'Active' },
				{ label: 'Region', value: 'us-east-1' },
			],
		},
	},
	flashbar: {
		samples: { items: [{ type: 'success', header: 'Done', content: 'Resource created.' }] },
	},
	'radio-group': {
		samples: {
			items: [
				{ value: 'a', label: 'Option A' },
				{ value: 'b', label: 'Option B' },
			],
		},
	},
	// ── list-shaped components: sample collections so the preview renders ──
	tabs: {
		samples: {
			tabs: [
				{ id: 'details', label: 'Details', content: 'Detail content.' },
				{ id: 'logs', label: 'Logs', content: 'Log content.' },
				{ id: 'metrics', label: 'Metrics', content: 'Metric content.' },
			],
		},
	},
	'breadcrumb-group': {
		samples: {
			items: [
				{ text: 'Home', href: '#' },
				{ text: 'Resources', href: '#' },
				{ text: 'Instance i-0abc', href: '#' },
			],
		},
	},
	'segmented-control': {
		samples: {
			selectedId: 'day',
			options: [
				{ id: 'day', text: 'Day' },
				{ id: 'week', text: 'Week' },
				{ id: 'month', text: 'Month' },
			],
		},
	},
	'token-group': {
		samples: {
			items: [
				{ label: 'TypeScript', dismissLabel: 'Remove TypeScript' },
				{ label: 'Svelte', dismissLabel: 'Remove Svelte' },
				{ label: 'Parabun', dismissLabel: 'Remove Parabun' },
			],
		},
	},
	'side-navigation': {
		samples: {
			header: { text: 'Service', href: '#' },
			activeHref: '#/page1',
			items: [
				{ type: 'link', text: 'Page 1', href: '#/page1' },
				{ type: 'link', text: 'Page 2', href: '#/page2' },
				{ type: 'divider' },
				{ type: 'link', text: 'Docs', href: '#', external: true },
			],
		},
	},
	steps: {
		samples: {
			steps: [
				{ header: 'Created instance', status: 'success' },
				{ header: 'Provisioning', status: 'in-progress' },
				{ header: 'Health checks', status: 'pending' },
			],
		},
	},
	'anchor-navigation': {
		samples: {
			activeHref: '#s1',
			anchors: [
				{ text: 'Introduction', href: '#s1', level: 1 },
				{ text: 'Getting started', href: '#s2', level: 1 },
				{ text: 'Configuration', href: '#s3', level: 2 },
				{ text: 'Reference', href: '#s4', level: 1 },
			],
		},
	},
	'button-group': {
		samples: {
			items: [
				{ type: 'icon-button', id: 'copy', text: 'Copy', iconName: 'copy' },
				{ type: 'icon-button', id: 'edit', text: 'Edit', iconName: 'edit' },
				{ type: 'icon-button', id: 'settings', text: 'Settings', iconName: 'settings' },
			],
		},
	},
	// ── charts: sample series/data so the preview renders ──
	'line-chart': {
		samples: {
			height: 220,
			xTitle: 'Time (s)',
			yTitle: 'Requests',
			series: [
				{ title: 'Site A', type: 'line', data: xy([34, 48, 40, 62, 55, 68, 72]) },
				{ title: 'Site B', type: 'line', data: xy([20, 30, 50, 45, 60, 52, 64]) },
			],
		},
	},
	'area-chart': {
		samples: {
			height: 220,
			xTitle: 'Time (s)',
			yTitle: 'Throughput',
			series: [
				{ title: 'Reads', type: 'area', data: xy([18, 26, 30, 24, 38, 44, 40]) },
				{ title: 'Writes', type: 'area', data: xy([8, 12, 16, 14, 20, 18, 26]) },
			],
		},
	},
	'bar-chart': {
		samples: {
			height: 220,
			xTitle: 'Quarter',
			yTitle: 'Revenue ($k)',
			series: [
				{ title: '2024', type: 'bar', data: xy([120, 156, 142, 188]) },
				{ title: '2025', type: 'bar', data: xy([140, 168, 175, 210]) },
			],
		},
	},
	'mixed-line-bar-chart': {
		previewNote:
			'Live preview needs a configured mix of bar + line series — see the code and properties below.',
	},
	'pie-chart': {
		options: { size: ['small', 'medium', 'large'] },
		samples: {
			data: [
				{ title: 'Running', value: 60 },
				{ title: 'Stopped', value: 30 },
				{ title: 'Pending', value: 10 },
			],
		},
	},
	// ── collections with identity-default renderItem: items already shaped ──
	list: {
		samples: {
			items: [
				{ id: '1', content: 'Provision database' },
				{ id: '2', content: 'Configure networking' },
				{ id: '3', content: 'Deploy application' },
			],
		},
	},
	'tree-view': {
		samples: {
			items: [
				{
					content: 'Documents',
					children: [{ content: 'Resume.pdf' }, { content: 'Cover-letter.pdf' }],
				},
				{ content: 'Images', children: [{ content: 'logo.png' }, { content: 'banner.svg' }] },
				{ content: 'README.md' },
			],
		},
	},
	// ── components that can't be driven from plain sample data (need snippets /
	//    render functions / i18n scaffolding): show a note instead of an empty box.
	grid: {
		previewNote:
			'Grid arranges child elements via gridDefinition — see the code and properties below.',
	},
	'column-layout': {
		previewNote:
			'Column Layout splits its children into columns — see the code and properties below.',
	},
	'tag-editor': {
		previewNote:
			'Tag Editor needs key/value autosuggest handlers and i18n strings — see the code and properties below.',
	},
	'tutorial-panel': {
		previewNote:
			'Tutorial Panel renders structured tutorials with tasks and i18n strings — see the code and properties below.',
	},
};
