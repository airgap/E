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
import { pickProvider } from '../graph/providers';
import type { ProviderContext } from '../graph/types';
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

      const provider = pickProvider(ctx);
      if (!provider) return null;

      let graph;
      try {
        graph = await provider.build(ctx);
      } catch (err) {
        console.warn('[graph-popover] provider.build failed:', err);
        return null;
      }
      if (!graph) return null;

      return {
        pos,
        above: true,
        strictSide: false,
        arrow: false,
        create() {
          const host = document.createElement('div');
          host.className = 'cm-graph-popover-host';
          // Inert until the mount completes; the Svelte component is
          // responsible for its own layout state ("Laying out…" placeholder).
          const component = mount(RelationGraphView, {
            target: host,
            props: { graph },
          });
          return {
            dom: host,
            destroy() {
              try {
                unmount(component);
              } catch {
                /* component already unmounted */
              }
            },
          };
        },
      };
    },
    { hoverTime: 400 },
  );
}
