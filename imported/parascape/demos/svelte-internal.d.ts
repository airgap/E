// Ambient declarations for Svelte 5 internal modules that live-compile
// has to re-resolve in `new Function` (the runes runtime is keyed off
// these specifiers). These modules exist on disk under
// node_modules/svelte/src/internal/* but aren't part of Svelte's
// published types — that's intentional, they're not for end users.
// We import them only to hand them through to compiled .pui modules.
declare module 'svelte/internal/client';
declare module 'svelte/internal/disclose-version';
declare module 'svelte/internal/flags/legacy';
