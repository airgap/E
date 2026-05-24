// Shared light / dark / auto theme controller for the whole Parascape site.
// One localStorage key + one applier so every entry (home, demos, components,
// builder, designer) stays in sync: change the theme on any page and the
// others pick it up — same tab via subscribers, other tabs via the `storage`
// event, next navigation via localStorage. "auto" follows the OS through
// prefers-color-scheme and tracks live changes.
//
// State is reflected onto the document so CSS can cascade:
//   <html data-theme="light|dark">          drives our --bg-*/--fg-* tokens (theme.css)
//   <html data-theme-pref="light|dark|auto"> the user's raw choice
//   <body class="awsui-dark-mode">           drives the vendored Cloudscape tokens
//
// The `awsui-dark-mode` class must live on <body> (not <html>): Cloudscape's
// light token defaults are authored on `body { … }`, so a class on an ancestor
// of <body> would lose the cascade and components would stay light. The
// no-flash inline script in each index.html applies the same three attributes
// before first paint; this module re-applies idempotently and keeps the
// SiteNav toggle label in sync via subscribers.

export type Theme = 'light' | 'dark' | 'auto';
export type Resolved = 'light' | 'dark';

export const THEMES: Theme[] = ['light', 'dark', 'auto'];
const KEY = 'parascape-theme';

const isBrowser = typeof document !== 'undefined';
const subs = new Set<(t: Theme, r: Resolved) => void>();
let current: Theme = 'auto';

function systemDark(): boolean {
	return isBrowser && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Resolve "auto" to a concrete light/dark using the OS preference. */
export function resolve(t: Theme = current): Resolved {
	return t === 'auto' ? (systemDark() ? 'dark' : 'light') : t;
}

function apply(t: Theme): void {
	if (!isBrowser) return;
	const r = resolve(t);
	const root = document.documentElement;
	root.setAttribute('data-theme', r);
	root.setAttribute('data-theme-pref', t);
	document.body?.classList.toggle('awsui-dark-mode', r === 'dark');
	for (const cb of subs) cb(t, r);
}

let started = false;

/** Idempotent: read the persisted choice, apply it, and wire OS + cross-tab sync. */
export function initTheme(): void {
	if (!isBrowser || started) return;
	started = true;
	try {
		const saved = localStorage.getItem(KEY) as Theme | null;
		if (saved && THEMES.includes(saved)) current = saved;
	} catch {}
	apply(current);
	// Track OS changes; apply() is harmless when not in auto.
	window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
		if (current === 'auto') apply('auto');
	});
	// Mirror a theme change made on another tab/page of the same origin.
	window.addEventListener('storage', (e) => {
		if (e.key === KEY && e.newValue && THEMES.includes(e.newValue as Theme)) {
			current = e.newValue as Theme;
			apply(current);
		}
	});
}

export function getTheme(): Theme {
	return current;
}

export function setTheme(t: Theme): void {
	current = t;
	try {
		localStorage.setItem(KEY, t);
	} catch {}
	apply(t);
}

/** Advance light → dark → auto → light and persist. Returns the new choice. */
export function cycleTheme(): Theme {
	setTheme(THEMES[(THEMES.indexOf(current) + 1) % THEMES.length]!);
	return current;
}

/** Subscribe to theme changes; called immediately with the current state. Returns an unsubscribe. */
export function subscribe(cb: (t: Theme, r: Resolved) => void): () => void {
	subs.add(cb);
	if (isBrowser) cb(current, resolve(current));
	return () => {
		subs.delete(cb);
	};
}
