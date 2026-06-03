/**
 * graph-popover.ts — CM6 hoverTooltip extension that surfaces a popover
 * DAG of relations centered on the cursor (Phase 1 = module imports).
 *
 * The actual diagram component (`RelationGraphView.svelte`) is mounted
 * into the tooltip body via Svelte 5's `mount()`. CM6 owns positioning;
 * we own the contents and cleanup.
 *
 * Runs alongside lsp-hover — both extensions can return tooltips for the
 * same hover; CM6 stacks them. The graph popover is opt-in cheap: the
 * provider's `supports()` is a sync extension check, so we early-out on
 * unrelated files without a server round-trip.
 */

import { hoverTooltip, type Tooltip } from '@codemirror/view';
import { mount, unmount } from 'svelte';
import { fileUriField } from './file-uri-field';
import { pickAllProviders } from '../graph/providers';
import type { ProviderContext, RelationGraph } from '../graph/types';
import RelationGraphView from '../graph/RelationGraphView.svelte';

/**
 * Strip `file://` scheme so the provider sees plain filesystem paths (the
 * extension classifier doesn't care about the scheme, but downstream
 * navigation handlers prefer paths).
 */
function uriToPath(uri: string): string {
  if (uri.startsWith('file://')) {
    try {
      return decodeURIComponent(uri.slice(7));
    } catch {
      return uri.slice(7);
    }
  }
  return uri;
}

export function graphPopoverExtension(workspacePath: string) {
  return hoverTooltip(
    async (view, pos): Promise<Tooltip | null> => {
      const uri = view.state.field(fileUriField, false) || '';
      const filePath = uriToPath(uri);
      if (!filePath) return null;

      const doc = view.state.doc.toString();
      const lineInfo = view.state.doc.lineAt(pos);
      const ctx: ProviderContext = {
        filePath,
        workspacePath,
        pos,
        doc,
        line: lineInfo.number - 1, // CM6 lines are 1-indexed; ProviderContext is 0
        column: pos - lineInfo.from,
      };

      // The file dependency (module-deps) graph is no longer a code-hover
      // graph — it belongs to the file as a whole and is surfaced from the
      // pane tab / file-list row (see fileDepGraphHover). Code hover keeps the
      // cursor-relative graphs (reactive, component tree, call graph, dataflow).
      const providers = pickAllProviders(ctx).filter((pr) => pr.kind !== 'import');
      if (providers.length === 0) return null;

      // Fan out: run every applicable provider in parallel. A provider that
      // returns null is silently skipped (e.g. a .pui file with no reactive
      // primitives still wants the module-deps graph shown alone).
      const settled = await Promise.allSettled(providers.map((p) => p.build(ctx)));
      const graphs: RelationGraph[] = [];
      for (const r of settled) {
        if (r.status === 'fulfilled' && r.value) graphs.push(r.value);
        else if (r.status === 'rejected') {
          console.warn('[graph-popover] provider.build failed:', r.reason);
        }
      }
      if (graphs.length === 0) return null;

      return {
        pos,
        above: true,
        strictSide: false,
        arrow: false,
        create() {
          const host = document.createElement('div');
          host.className = 'cm-graph-popover-host';
          host.style.display = 'flex';
          host.style.flexDirection = 'column';
          host.style.gap = '4px';
          // Mount one RelationGraphView per graph, stacked vertically. Each
          // component manages its own layout-loading state independently.
          const mounted = graphs.map((graph) => {
            const slot = document.createElement('div');
            host.appendChild(slot);
            return mount(RelationGraphView, { target: slot, props: { graph } });
          });
          return {
            dom: host,
            destroy() {
              for (const m of mounted) {
                try {
                  unmount(m);
                } catch {
                  /* already unmounted */
                }
              }
            },
          };
        },
      };
    },
    { hoverTime: 400 },
  );
}
