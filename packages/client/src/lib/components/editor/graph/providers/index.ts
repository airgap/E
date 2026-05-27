/**
 * Provider registry. The hover extension iterates this list in order and
 * uses the first provider whose `supports()` returns true. Add Phase 2/3
 * providers here as they land.
 */
import type { RelationProvider } from '../types';
import { moduleDepsProvider } from './module-deps';

export const PROVIDERS: RelationProvider[] = [
  moduleDepsProvider,
  // Phase 2 — coming next:
  // reactiveProvider,
  // componentTreeProvider,
  // Phase 3:
  // callGraphProvider,
  // dataflowProvider,
];

export function pickProvider(ctx: import('../types').ProviderContext): RelationProvider | null {
  for (const p of PROVIDERS) {
    if (p.supports(ctx)) return p;
  }
  return null;
}
