<script lang="ts">
  /**
   * Ghost tab icon that follows the cursor during cross-component panel drags.
   * Shows the tab's icon + label floating near the mouse pointer with a
   * semi-transparent appearance.
   */
  import { panelDragStore } from '$lib/stores/panelDrag.svelte';
  import { getTabDef } from '$lib/config/sidebarTabs';

  const drag = $derived(panelDragStore.drag);
  const tabDef = $derived(drag ? getTabDef(drag.tabId) : null);
</script>

{#if drag && tabDef}
  <div class="drag-overlay" style="left: {drag.mouseX + 12}px; top: {drag.mouseY - 12}px;">
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d={tabDef.icon} />
    </svg>
    <span class="drag-label">{tabDef.label}</span>
  </div>
{/if}

<style>
  .drag-overlay {
    position: fixed;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    background: var(--bg-elevated);
    border: 1px solid var(--accent-primary);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-lg), var(--shadow-glow-sm);
    color: var(--accent-primary);
    font-size: var(--fs-xs);
    font-weight: 600;
    white-space: nowrap;
    pointer-events: none;
    z-index: 9999;
    opacity: 0.9;
  }

  .drag-label {
    color: var(--text-primary);
  }
</style>
