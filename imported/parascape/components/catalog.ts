// Catalog metadata for the Parascape components site. Descriptions are
// original one-liners written for this catalog (not copied from any
// upstream docs) — they summarise what each ported .pui component does.
// `id` is the kebab-case module name under @parascape-design/components.

export type CatalogItem = { name: string; id: string; blurb: string };
export type CatalogGroup = { category: string; items: CatalogItem[] };

export const catalog: CatalogGroup[] = [
	{
		category: 'Layout & structure',
		items: [
			{
				name: 'App Layout',
				id: 'app-layout',
				blurb: 'Page frame with collapsible navigation, tools, and content regions.',
			},
			{
				name: 'Content Layout',
				id: 'content-layout',
				blurb: 'Header band sitting above the main content area.',
			},
			{
				name: 'Container',
				id: 'container',
				blurb: 'A bordered surface that groups related content under a header.',
			},
			{ name: 'Grid', id: 'grid', blurb: 'Twelve-column responsive grid for arranging content.' },
			{
				name: 'Column Layout',
				id: 'column-layout',
				blurb: 'Evenly sized columns with optional dividers.',
			},
			{
				name: 'Space Between',
				id: 'space-between',
				blurb: 'Consistent spacing between stacked or inline children.',
			},
			{ name: 'Box', id: 'box', blurb: 'Low-level primitive for spacing, color, and typography.' },
			{
				name: 'Split Panel',
				id: 'split-panel',
				blurb: 'A panel that docks to the bottom or side of the app shell.',
			},
			{ name: 'Divider', id: 'divider', blurb: 'A thin horizontal rule between sections.' },
		],
	},
	{
		category: 'Navigation',
		items: [
			{
				name: 'Side Navigation',
				id: 'side-navigation',
				blurb: 'Vertical navigation list with sections, links, and groups.',
			},
			{
				name: 'Top Navigation',
				id: 'top-navigation',
				blurb: 'Global top bar with title, search, and utility menus.',
			},
			{ name: 'Breadcrumb Group', id: 'breadcrumb-group', blurb: 'Hierarchical breadcrumb trail.' },
			{ name: 'Tabs', id: 'tabs', blurb: 'Switch between panels of content.' },
			{
				name: 'Anchor Navigation',
				id: 'anchor-navigation',
				blurb: 'In-page anchor links that track scroll position.',
			},
			{ name: 'Pagination', id: 'pagination', blurb: 'Page through a long list or table.' },
			{ name: 'Wizard', id: 'wizard', blurb: 'Multi-step flow with navigation and validation.' },
			{ name: 'Steps', id: 'steps', blurb: 'Ordered list showing progress through steps.' },
		],
	},
	{
		category: 'Buttons & actions',
		items: [
			{ name: 'Button', id: 'button', blurb: 'Primary, normal, link, and icon button variants.' },
			{
				name: 'Button Dropdown',
				id: 'button-dropdown',
				blurb: 'A button that opens a menu of actions.',
			},
			{
				name: 'Button Group',
				id: 'button-group',
				blurb: 'A row of grouped icon and text buttons.',
			},
			{ name: 'Link', id: 'link', blurb: 'Inline or standalone hyperlink.' },
			{
				name: 'Copy to Clipboard',
				id: 'copy-to-clipboard',
				blurb: 'Button that copies text and confirms the copy.',
			},
		],
	},
	{
		category: 'Forms & inputs',
		items: [
			{ name: 'Form', id: 'form', blurb: 'Form wrapper with header, actions, and error summary.' },
			{
				name: 'Form Field',
				id: 'form-field',
				blurb: 'Label, description, constraint, and error around a control.',
			},
			{ name: 'Input', id: 'input', blurb: 'Single-line text field.' },
			{ name: 'Textarea', id: 'textarea', blurb: 'Multi-line text field.' },
			{ name: 'Select', id: 'select', blurb: 'Single-choice dropdown.' },
			{ name: 'Multiselect', id: 'multiselect', blurb: 'Multi-choice dropdown with token chips.' },
			{ name: 'Autosuggest', id: 'autosuggest', blurb: 'Text field with a suggestion dropdown.' },
			{
				name: 'Prompt Input',
				id: 'prompt-input',
				blurb: 'Chat-style growing input with a send action.',
			},
			{ name: 'Checkbox', id: 'checkbox', blurb: 'A single on/off control.' },
			{ name: 'Radio Group', id: 'radio-group', blurb: 'Choose one option from a set.' },
			{ name: 'Tiles', id: 'tiles', blurb: 'Selectable cards behaving as a radio group.' },
			{ name: 'Toggle', id: 'toggle', blurb: 'An on/off switch.' },
			{
				name: 'Segmented Control',
				id: 'segmented-control',
				blurb: 'Single-choice segmented toggle.',
			},
			{ name: 'Slider', id: 'slider', blurb: 'Pick a number along a range.' },
			{ name: 'Date Input', id: 'date-input', blurb: 'Typed date entry.' },
			{ name: 'Date Picker', id: 'date-picker', blurb: 'Date entry with a calendar popover.' },
			{
				name: 'Date Range Picker',
				id: 'date-range-picker',
				blurb: 'Pick an absolute or relative date/time range.',
			},
			{ name: 'Time Input', id: 'time-input', blurb: 'Typed time entry.' },
			{ name: 'Calendar', id: 'calendar', blurb: 'Month grid for date selection.' },
			{ name: 'File Upload', id: 'file-upload', blurb: 'Choose files and list the selection.' },
			{ name: 'Tag Editor', id: 'tag-editor', blurb: 'Edit a set of key/value tags.' },
			{ name: 'Attribute Editor', id: 'attribute-editor', blurb: 'Add and remove rows of fields.' },
			{ name: 'Text Filter', id: 'text-filter', blurb: 'Free-text filter input for collections.' },
			{
				name: 'Property Filter',
				id: 'property-filter',
				blurb: 'Token-based query builder for collections.',
			},
			{
				name: 'Collection Preferences',
				id: 'collection-preferences',
				blurb: 'Page size, columns, and content preferences dialog.',
			},
		],
	},
	{
		category: 'Data display',
		items: [
			{ name: 'Table', id: 'table', blurb: 'Sortable, selectable rows of structured data.' },
			{ name: 'Cards', id: 'cards', blurb: 'A responsive grid of selectable cards.' },
			{ name: 'List', id: 'list', blurb: 'A simple ordered or unordered item list.' },
			{ name: 'Tree View', id: 'tree-view', blurb: 'Expandable hierarchical tree.' },
			{
				name: 'Key-Value Pairs',
				id: 'key-value-pairs',
				blurb: 'Label and value pairs laid out in columns.',
			},
			{ name: 'Text Content', id: 'text-content', blurb: 'Styled long-form text block.' },
			{
				name: 'Code Editor',
				id: 'code-editor',
				blurb: 'Embedded code editor with syntax highlighting.',
			},
		],
	},
	{
		category: 'Charts',
		items: [
			{ name: 'Area Chart', id: 'area-chart', blurb: 'Filled-area time-series chart.' },
			{ name: 'Bar Chart', id: 'bar-chart', blurb: 'Vertical or horizontal bar chart.' },
			{ name: 'Line Chart', id: 'line-chart', blurb: 'Line time-series chart.' },
			{
				name: 'Mixed Line/Bar Chart',
				id: 'mixed-line-bar-chart',
				blurb: 'Combined line and bar series.',
			},
			{ name: 'Pie Chart', id: 'pie-chart', blurb: 'Pie or donut chart.' },
		],
	},
	{
		category: 'Feedback & status',
		items: [
			{ name: 'Alert', id: 'alert', blurb: 'Inline info, success, warning, or error message.' },
			{ name: 'Flashbar', id: 'flashbar', blurb: 'Stacked page-level notifications.' },
			{ name: 'Progress Bar', id: 'progress-bar', blurb: 'Determinate or indeterminate progress.' },
			{ name: 'Spinner', id: 'spinner', blurb: 'Compact loading indicator.' },
			{
				name: 'Status Indicator',
				id: 'status-indicator',
				blurb: 'Colored status label with an icon.',
			},
			{ name: 'Badge', id: 'badge', blurb: 'A small count or label pill.' },
			{ name: 'Token Group', id: 'token-group', blurb: 'A group of removable token chips.' },
			{ name: 'Popover', id: 'popover', blurb: 'Click- or hover-triggered popover with content.' },
			{ name: 'Modal', id: 'modal', blurb: 'Centered dialog overlay.' },
			{ name: 'Help Panel', id: 'help-panel', blurb: 'Contextual help shown in the tools drawer.' },
		],
	},
	{
		category: 'Utilities',
		items: [
			{ name: 'Icon', id: 'icon', blurb: 'Renders a named or custom SVG icon.' },
			{ name: 'Header', id: 'header', blurb: 'Section header with description and actions.' },
			{
				name: 'Expandable Section',
				id: 'expandable-section',
				blurb: 'Collapsible content section.',
			},
			{ name: 'Hotspot', id: 'hotspot', blurb: 'Anchor point for an onboarding annotation.' },
			{
				name: 'Tutorial Panel',
				id: 'tutorial-panel',
				blurb: 'Lists onboarding tutorials in the tools drawer.',
			},
		],
	},
];

export const allItems: CatalogItem[] = catalog.flatMap((g) => g.items);
