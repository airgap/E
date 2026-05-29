/**
 * Runtime state for plugin-contributed sidebar tree views (LYK-1041).
 *
 * The plugin's iframe pushes its tree nodes through `ui.setTreeData` on
 * the RPC bridge; this store holds the latest set per (pluginId, viewId)
 * composite key. The PluginTreeView component reads through here when
 * its sidebar tab activates.
 *
 * State is non-persisted — when a plugin disables / reloads, it
 * re-publishes from scratch.
 */
import type { TreeViewNode } from '@e/shared';

function key(pluginId: string, viewId: string): string {
  return `${pluginId}.${viewId}`;
}

function createPluginTreeViewsStore() {
  let byView = $state<Record<string, TreeViewNode[]>>({});

  return {
    nodesFor(pluginId: string, viewId: string): TreeViewNode[] {
      return byView[key(pluginId, viewId)] ?? [];
    },
    setNodes(pluginId: string, viewId: string, nodes: TreeViewNode[]) {
      byView = { ...byView, [key(pluginId, viewId)]: nodes };
    },
    /** Drop every view for a plugin (called when the plugin disables). */
    clearForPlugin(pluginId: string) {
      const prefix = `${pluginId}.`;
      const next: Record<string, TreeViewNode[]> = {};
      for (const [k, v] of Object.entries(byView)) {
        if (!k.startsWith(prefix)) next[k] = v;
      }
      byView = next;
    },
  };
}

export const pluginTreeViewsStore = createPluginTreeViewsStore();
