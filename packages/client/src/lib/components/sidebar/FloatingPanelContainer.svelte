<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { sidebarLayoutStore } from '$lib/stores/sidebarLayout.svelte';
  import FloatingPanel from './FloatingPanel.svelte';

  // --- Viewport resize clamping ---
  function clampPanelsToViewport() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    for (const panel of sidebarLayoutStore.floatingPanels) {
      let clamped = false;
      let newX = panel.x;
      let newY = panel.y;

      if (panel.x + panel.width > vw) {
        newX = Math.max(0, vw - panel.width);
        clamped = true;
      }

      if (panel.y + panel.height > vh) {
        newY = Math.max(0, vh - panel.height);
        clamped = true;
      }

      if (clamped) {
        sidebarLayoutStore.updatePanelPosition(panel.tabId, newX, newY);
      }
    }
  }

  onMount(() => {
    window.addEventListener('resize', clampPanelsToViewport);
  });

  onDestroy(() => {
    window.removeEventListener('resize', clampPanelsToViewport);
  });
</script>

{#each sidebarLayoutStore.floatingPanels as panel (panel.tabId)}
  <FloatingPanel
    tabId={panel.tabId}
    x={panel.x}
    y={panel.y}
    width={panel.width}
    height={panel.height}
  />
{/each}
