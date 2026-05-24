// Single source of truth for the demo set. Each scenario points at:
//   • cloudscape — the React Cloudscape component (eager-imported so
//     React mounts on first paint, not on tab switch)
//   • parascape  — the .pui Svelte component (likewise)
//   • cs / ps    — the file's RAW source text (via Vite's ?raw query),
//     used both for the syntax-highlighted code pane and for the LOC
//     stats the viewer displays
import type { Component as SvelteComponent } from 'svelte';
import type { ComponentType as ReactComponent } from 'react';

// Cloudscape sides — React components.
import Form_cs from './01-form.cloudscape';
import Table_cs from './02-table.cloudscape';
import Modal_cs from './03-modal.cloudscape';
import Tabs_cs from './04-tabs.cloudscape';
import Cards_cs from './05-cards.cloudscape';
import AppShell_cs from './06-app-shell.cloudscape';
import Tags_cs from './07-tags.cloudscape';
import Timer_cs from './08-timer.cloudscape';
import Cart_cs from './09-cart.cloudscape';
import Async_cs from './10-async.cloudscape';

// Parascape sides — Svelte components.
import Form_ps from './01-form.parascape.pui';
import Table_ps from './02-table.parascape.pui';
import Modal_ps from './03-modal.parascape.pui';
import Tabs_ps from './04-tabs.parascape.pui';
import Cards_ps from './05-cards.parascape.pui';
import AppShell_ps from './06-app-shell.parascape.pui';
import Tags_ps from './07-tags.parascape.pui';
import Timer_ps from './08-timer.parascape.pui';
import Cart_ps from './09-cart.parascape.pui';
import Async_ps from './10-async.parascape.pui';

// Raw source for the code panes + LOC stats.
import Form_cs_src from './01-form.cloudscape.tsx?raw';
import Table_cs_src from './02-table.cloudscape.tsx?raw';
import Modal_cs_src from './03-modal.cloudscape.tsx?raw';
import Tabs_cs_src from './04-tabs.cloudscape.tsx?raw';
import Cards_cs_src from './05-cards.cloudscape.tsx?raw';
import AppShell_cs_src from './06-app-shell.cloudscape.tsx?raw';
import Tags_cs_src from './07-tags.cloudscape.tsx?raw';
import Timer_cs_src from './08-timer.cloudscape.tsx?raw';
import Cart_cs_src from './09-cart.cloudscape.tsx?raw';
import Async_cs_src from './10-async.cloudscape.tsx?raw';

import Form_ps_src from './01-form.parascape.pui?raw';
import Table_ps_src from './02-table.parascape.pui?raw';
import Modal_ps_src from './03-modal.parascape.pui?raw';
import Tabs_ps_src from './04-tabs.parascape.pui?raw';
import Cards_ps_src from './05-cards.parascape.pui?raw';
import AppShell_ps_src from './06-app-shell.parascape.pui?raw';
import Tags_ps_src from './07-tags.parascape.pui?raw';
import Timer_ps_src from './08-timer.parascape.pui?raw';
import Cart_ps_src from './09-cart.parascape.pui?raw';
import Async_ps_src from './10-async.parascape.pui?raw';

export type Scenario = {
	id: string;
	title: string;
	subtitle: string;
	cloudscape: ReactComponent<Record<string, unknown>>;
	parascape: SvelteComponent;
	csSrc: string;
	psSrc: string;
};

export const scenarios: Scenario[] = [
	{
		id: '01-form',
		title: 'Login form',
		subtitle: 'FormField + Input + validation + Button actions',
		cloudscape: Form_cs,
		parascape: Form_ps,
		csSrc: Form_cs_src,
		psSrc: Form_ps_src,
	},
	{
		id: '02-table',
		title: 'Filtered instance table',
		subtitle: 'Table + TextFilter + Header counter + StatusIndicator',
		cloudscape: Table_cs,
		parascape: Table_ps,
		csSrc: Table_cs_src,
		psSrc: Table_ps_src,
	},
	{
		id: '03-modal',
		title: 'Create-resource modal',
		subtitle: 'Modal + FormField + footer actions',
		cloudscape: Modal_cs,
		parascape: Modal_ps,
		csSrc: Modal_cs_src,
		psSrc: Modal_ps_src,
	},
	{
		id: '04-tabs',
		title: 'Order detail with tabs',
		subtitle: 'Tabs + KeyValuePairs + StatusIndicator',
		cloudscape: Tabs_cs,
		parascape: Tabs_ps,
		csSrc: Tabs_cs_src,
		psSrc: Tabs_ps_src,
	},
	{
		id: '05-cards',
		title: 'Cards grid (multi-select)',
		subtitle: 'Cards + selectionType + Badge + Link',
		cloudscape: Cards_cs,
		parascape: Cards_ps,
		csSrc: Cards_cs_src,
		psSrc: Cards_ps_src,
	},
	{
		id: '06-app-shell',
		title: 'App shell',
		subtitle: 'AppLayout + SideNavigation + ContentLayout + HelpPanel',
		cloudscape: AppShell_cs,
		parascape: AppShell_ps,
		csSrc: AppShell_cs_src,
		psSrc: AppShell_ps_src,
	},
	{
		id: '07-tags',
		title: 'Tag pipeline',
		subtitle: '|> threads a value through free functions + methods — no inside-out nesting',
		cloudscape: Tags_cs,
		parascape: Tags_ps,
		csSrc: Tags_cs_src,
		psSrc: Tags_ps_src,
	},
	{
		id: '08-timer',
		title: 'Live timer',
		subtitle: 'Interval effect with cleanup → derived display, progress, status',
		cloudscape: Timer_cs,
		parascape: Timer_ps,
		csSrc: Timer_cs_src,
		psSrc: Timer_ps_src,
	},
	{
		id: '09-cart',
		title: 'Cart totals',
		subtitle: 'List state + derived chain: subtotal → discount → tax → total',
		cloudscape: Cart_cs,
		parascape: Cart_ps,
		csSrc: Cart_cs_src,
		psSrc: Cart_ps_src,
	},
	{
		id: '10-async',
		title: 'Async block',
		subtitle: 'async { … } vs the (async () => { … })() IIFE boilerplate',
		cloudscape: Async_cs,
		parascape: Async_ps,
		csSrc: Async_cs_src,
		psSrc: Async_ps_src,
	},
];
