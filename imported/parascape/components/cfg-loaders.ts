// Lazy loaders for every ported component, keyed by kebab id — built from a
// glob so the standardized configurator can render ANY component without a
// hand-maintained import registry. Vite code-splits each into its own chunk,
// loaded on demand when a component's detail page is opened.
const mods = import.meta.glob('../src/lib/components/*.pui');

const kebab = (n: string): string =>
	n
		.replace(/([a-z0-9])([A-Z])/g, '$1-$2')
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
		.toLowerCase();

export const loaders: Record<string, () => Promise<{ default: unknown }>> = {};
for (const p in mods) {
	const base = p
		.split('/')
		.pop()!
		.replace(/\.pui$/, '');
	loaders[kebab(base)] = mods[p] as () => Promise<{ default: unknown }>;
}

export const hasLive = (id: string): boolean => id in loaders;
