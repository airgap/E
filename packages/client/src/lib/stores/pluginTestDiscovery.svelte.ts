/**
 * pluginTestDiscovery.svelte.ts — caches the latest plugin test
 * discovery tree across the app so the gutter (LYK-1015) and any
 * future call-site UI can resolve a (file, line) coordinate to a
 * plugin-specific test id.
 *
 * The Test Explorer panel populates this on its own discovery call;
 * other surfaces read through `testIdAt(file, line)`. When nothing has
 * been discovered yet, lookups return null and callers degrade
 * gracefully (e.g. the gutter prompts the user to open the explorer).
 */

interface DiscoveredNode {
  id: string;
  label: string;
  type: 'suite' | 'test';
  file?: string;
  line?: number;
  children?: DiscoveredNode[];
}

interface DiscoveryGroup {
  source: string;
  tree: DiscoveredNode[];
}

function createPluginTestDiscoveryStore() {
  let groups = $state<DiscoveryGroup[]>([]);

  function walk(nodes: DiscoveredNode[], visit: (n: DiscoveredNode) => void) {
    for (const n of nodes) {
      visit(n);
      if (n.children) walk(n.children, visit);
    }
  }

  return {
    get groups() {
      return groups;
    },
    /** Replace the cached tree (called from TestExplorerPanel after discovery). */
    setGroups(next: DiscoveryGroup[]) {
      groups = next;
    },
    /**
     * Find the test id at a given (file, line). Discovery emits 0-indexed
     * lines; the gutter passes 1-indexed line numbers, so we tolerate
     * both off-by-one orientations.
     */
    testIdAt(file: string, line1Based: number): string | null {
      let hit: string | null = null;
      for (const g of groups) {
        walk(g.tree, (n) => {
          if (hit) return;
          if (n.type !== 'test') return;
          if (n.file !== file) return;
          if (n.line === line1Based || n.line === line1Based - 1) hit = n.id;
        });
        if (hit) return hit;
      }
      return null;
    },
    /** True iff at least one group has been discovered. */
    hasAny(): boolean {
      return groups.length > 0;
    },
  };
}

export const pluginTestDiscoveryStore = createPluginTestDiscoveryStore();
