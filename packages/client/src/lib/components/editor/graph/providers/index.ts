/**
 * Provider registry. The hover extension fetches a graph from EACH
 * supporting provider and stacks the results in one popover, so a .pui
 * file's hover can show its module-deps AND reactive AND component-tree
 * graphs together.
 *
 * Order matters for the stack visually — most file-structural first
 * (module deps), then domain-specific (reactive / components / call /
 * dataflow as they land).
 */
import type { RelationProvider, ProviderContext } from '../types';
import { moduleDepsProvider } from './module-deps';
import { reactiveProvider } from './reactive';
import { componentTreeProvider } from './component-tree';
import { callGraphProvider } from './call-graph';
import { dataflowProvider } from './dataflow';

export const PROVIDERS: RelationProvider[] = [
  moduleDepsProvider,
  reactiveProvider,
  componentTreeProvider,
  callGraphProvider,
  dataflowProvider,
];

/** First-supporting provider (legacy single-pick path; kept for tests). */
export function pickProvider(ctx: ProviderContext): RelationProvider | null {
  for (const p of PROVIDERS) {
    if (p.supports(ctx)) return p;
  }
  return null;
}

/** All providers that claim to support this context. */
export function pickAllProviders(ctx: ProviderContext): RelationProvider[] {
  return PROVIDERS.filter((p) => p.supports(ctx));
}
