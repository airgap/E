<script lang="ts">
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { spatialViewportStore, type PanelRole } from '$lib/stores/spatialViewport.svelte';
  import { computeSpatialTransform, computePerspectiveOrigin } from '$lib/spatial/layout';
  import { uiStore } from '$lib/stores/ui.svelte';
  import { sidebarLayoutStore } from '$lib/stores/sidebarLayout.svelte';
  import { terminalStore } from '$lib/stores/terminal.svelte';
  import type { Snippet } from 'svelte';

  let {
    sidebarLeft,
    mainContent,
    terminal,
    sidebarRight,
  }: {
    sidebarLeft: Snippet;
    mainContent: Snippet;
    terminal: Snippet;
    sidebarRight: Snippet;
  } = $props();

  const config = $derived({
    parallaxIntensity: settingsStore.spatialParallaxIntensity,
    dofBlur: settingsStore.spatialDofBlur,
    depthGap: settingsStore.spatialDepthGap,
    pointerX: spatialViewportStore.pointerX,
    pointerY: spatialViewportStore.pointerY,
  });

  const perspectiveOrigin = $derived(
    computePerspectiveOrigin(
      spatialViewportStore.pointerX,
      spatialViewportStore.pointerY,
      settingsStore.spatialParallaxIntensity,
    ),
  );

  function getTransform(panel: PanelRole) {
    return computeSpatialTransform(panel, spatialViewportStore.focusedPanel, config);
  }

  const leftTransform = $derived(getTransform('sidebar-left'));
  const mainTransform = $derived(getTransform('main-content'));
  const termTransform = $derived(getTransform('terminal'));
  const rightTransform = $derived(getTransform('sidebar-right'));

  const hasLeft = $derived(uiStore.sidebarOpen && !!sidebarLayoutStore.leftColumn);
  const hasRight = $derived(!!sidebarLayoutStore.rightColumn);
  const hasTerminal = $derived(terminalStore.isOpen);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="spatial-scene"
  style:perspective="1200px"
  style:perspective-origin={perspectiveOrigin}
  onpointermove={spatialViewportStore.handlePointerMove}
>
  <div class="spatial-stage">
    {#if hasLeft}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="spatial-panel spatial-panel-sidebar-left"
        class:focused={spatialViewportStore.focusedPanel === 'sidebar-left'}
        style:transform={leftTransform.transform}
        style:filter={leftTransform.filter}
        style:opacity={leftTransform.opacity}
        style:z-index={leftTransform.zIndex}
        onclick={() => spatialViewportStore.focusPanel('sidebar-left')}
      >
        {@render sidebarLeft()}
      </div>
    {/if}

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="spatial-panel spatial-panel-main"
      class:focused={spatialViewportStore.focusedPanel === 'main-content'}
      style:transform={mainTransform.transform}
      style:filter={mainTransform.filter}
      style:opacity={mainTransform.opacity}
      style:z-index={mainTransform.zIndex}
      onclick={() => spatialViewportStore.focusPanel('main-content')}
    >
      {@render mainContent()}
    </div>

    {#if hasTerminal}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="spatial-panel spatial-panel-terminal"
        class:focused={spatialViewportStore.focusedPanel === 'terminal'}
        style:transform={termTransform.transform}
        style:filter={termTransform.filter}
        style:opacity={termTransform.opacity}
        style:z-index={termTransform.zIndex}
        style:transform-style="flat"
        onclick={() => spatialViewportStore.focusPanel('terminal')}
      >
        {@render terminal()}
      </div>
    {/if}

    {#if hasRight}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="spatial-panel spatial-panel-sidebar-right"
        class:focused={spatialViewportStore.focusedPanel === 'sidebar-right'}
        style:transform={rightTransform.transform}
        style:filter={rightTransform.filter}
        style:opacity={rightTransform.opacity}
        style:z-index={rightTransform.zIndex}
        onclick={() => spatialViewportStore.focusPanel('sidebar-right')}
      >
        {@render sidebarRight()}
      </div>
    {/if}
  </div>
</div>

<style>
  .spatial-scene {
    flex: 1;
    overflow: hidden;
    position: relative;
  }

  .spatial-stage {
    transform-style: preserve-3d;
    width: 100%;
    height: 100%;
    display: grid;
    grid-template-columns: 1fr 3fr 1fr;
    grid-template-rows: 70% 30%;
    gap: 4px;
    padding: 4px;
  }

  .spatial-panel {
    will-change: transform, filter, opacity;
    backface-visibility: hidden;
    transition:
      transform 400ms cubic-bezier(0.4, 0, 0.2, 1),
      filter 400ms cubic-bezier(0.4, 0, 0.2, 1),
      opacity 400ms cubic-bezier(0.4, 0, 0.2, 1);
    background: var(--bg-glass);
    border-radius: var(--ht-radius-lg, 12px);
    overflow: hidden;
    border: 1px solid var(--border-secondary);
    cursor: pointer;
    min-width: 0;
    min-height: 0;
  }

  .spatial-panel.focused {
    cursor: default;
    border-color: var(--border-primary);
  }

  .spatial-panel-sidebar-left {
    grid-column: 1;
    grid-row: 1 / -1;
  }

  .spatial-panel-main {
    grid-column: 2;
    grid-row: 1;
  }

  .spatial-panel-terminal {
    grid-column: 2;
    grid-row: 2;
  }

  .spatial-panel-sidebar-right {
    grid-column: 3;
    grid-row: 1 / -1;
  }

  /* When no sidebars, main content spans full width */
  .spatial-panel-main:first-child {
    grid-column: 1 / -1;
  }

  .spatial-panel-terminal:last-child {
    grid-column: 1 / -1;
  }
</style>
