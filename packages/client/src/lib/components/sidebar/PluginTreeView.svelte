<script lang="ts">
  /**
   * PluginTreeView (LYK-1041) — renders the latest tree-data set a
   * plugin has pushed for a given (pluginId, viewId) into the sidebar
   * tab area. Clicking a row toggles its children when it has any,
   * and (independently) fires the row's optional plugin command via
   * the existing dispatchPluginCommand path.
   *
   * Expand/collapse state is local to this mount — restarting the tab
   * resets it. Persisting per-(pluginId, viewId, nodeId) would require
   * a stable id contract from plugin authors that v1 isn't enforcing.
   */
  import { pluginTreeViewsStore } from '$lib/stores/pluginTreeViews.svelte';
  import { dispatchPluginCommand } from '$lib/stores/pluginBridge';
  import type { TreeViewNode } from '@e/shared';

  let { pluginId, viewId }: { pluginId: string; viewId: string } = $props();

  const nodes = $derived(pluginTreeViewsStore.nodesFor(pluginId, viewId));

  // Local expand state, separate from the manifest's `expanded` default.
  let manuallyToggled = $state<Record<string, boolean>>({});

  function isExpanded(node: TreeViewNode): boolean {
    const k = node.id;
    if (k in manuallyToggled) return manuallyToggled[k];
    return node.expanded === true;
  }
  function toggle(node: TreeViewNode) {
    manuallyToggled = { ...manuallyToggled, [node.id]: !isExpanded(node) };
  }
  function activate(node: TreeViewNode, e: MouseEvent) {
    e.stopPropagation();
    if (node.command) {
      dispatchPluginCommand({ pluginId, command: node.command });
    }
  }
</script>

<div class="tree-view">
  {#if nodes.length === 0}
    <div class="tree-empty">No data yet. The plugin will populate this view.</div>
  {:else}
    <ul class="tree-root">
      {#each nodes as node (node.id)}
        {@render row(node, 0)}
      {/each}
    </ul>
  {/if}
</div>

{#snippet row(node: TreeViewNode, depth: number)}
  {@const hasChildren = !!node.children && node.children.length > 0}
  {@const open = isExpanded(node)}
  <li class="tree-node">
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div
      class="tree-row"
      class:has-command={!!node.command}
      style:padding-left="{8 + depth * 14}px"
      role="treeitem"
      tabindex="0"
      aria-selected="false"
      aria-expanded={hasChildren ? open : undefined}
      onclick={() => hasChildren && toggle(node)}
      onkeydown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && hasChildren) {
          e.preventDefault();
          toggle(node);
        }
      }}
    >
      <span class="tree-caret" class:visible={hasChildren} class:open>
        {hasChildren ? '▸' : ''}
      </span>
      {#if node.icon}
        <span class="tree-icon">{node.icon}</span>
      {/if}
      <span class="tree-label">{node.label}</span>
      {#if node.command}
        <button class="tree-cmd-btn" title="Run {node.command}" onclick={(e) => activate(node, e)}>
          ▷
        </button>
      {/if}
    </div>
    {#if hasChildren && open}
      <ul class="tree-children">
        {#each node.children as c (c.id)}
          {@render row(c, depth + 1)}
        {/each}
      </ul>
    {/if}
  </li>
{/snippet}

<style>
  .tree-view {
    padding: 6px 0;
    overflow-y: auto;
  }
  .tree-empty {
    padding: 24px 16px;
    color: var(--text-tertiary);
    font-size: var(--fs-sm);
    text-align: center;
  }
  .tree-root,
  .tree-children {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .tree-node {
    margin: 0;
  }
  .tree-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    font-size: var(--fs-sm);
    color: var(--text-primary);
    cursor: pointer;
    border-radius: var(--radius-sm);
  }
  .tree-row:hover {
    background: var(--bg-hover);
  }
  .tree-caret {
    width: 12px;
    color: var(--text-tertiary);
    font-size: var(--fs-xxs);
    transition: transform 80ms ease;
    visibility: hidden;
  }
  .tree-caret.visible {
    visibility: visible;
  }
  .tree-caret.open {
    transform: rotate(90deg);
  }
  .tree-icon {
    width: 16px;
    text-align: center;
    font-size: var(--fs-xs);
    color: var(--text-secondary);
  }
  .tree-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tree-cmd-btn {
    background: none;
    border: none;
    color: var(--text-tertiary);
    cursor: pointer;
    padding: 0 4px;
    font-size: var(--fs-xs);
    border-radius: var(--radius-sm);
  }
  .tree-cmd-btn:hover {
    color: var(--accent-primary);
    background: var(--bg-active);
  }
</style>
