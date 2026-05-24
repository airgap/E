// LYK-946: token sets read straight from src/lib/theme.css (Vite ?raw) so the
// Designer's style pickers stay in sync with the canonical palette — no
// hand-maintained mirror. Names only; the swatch CSS resolves `var(--name)`
// against the loaded theme, so swatches follow light/dark automatically.
import css from '../src/lib/theme.css?raw';

const rootBlock = css.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
const names = [...new Set([...rootBlock.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]))];
const pick = (re: RegExp) => names.filter((n) => re.test(n));

// Surface / text / semantic / border colours worth offering as swatches. Skip
// the demos-viewer aliases and pure pointers (they resolve to colours already
// in the list).
export const COLOR_TOKENS = pick(/^--(fg|bg|accent|amber|good|bad|warn|info|border)/).filter(
	(n) => !/^--bg-(button|code|num-pill)/.test(n) && n !== '--fg-link' && n !== '--focus-ring',
);
export const RADIUS_TOKENS = pick(/^--radius-/);
export const SHADOW_TOKENS = pick(/^--shadow-/);
// theme.css has no spacing tokens; offer a consistent px scale instead.
export const SPACE_SCALE = ['4px', '8px', '12px', '16px', '24px', '32px', '48px'];
