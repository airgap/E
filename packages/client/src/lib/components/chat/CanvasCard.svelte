<script lang="ts">
  import type { CanvasState } from '$lib/stores/canvas.svelte';
  import CanvasRenderer from '../canvas/CanvasRenderer.svelte';
  import { primaryPaneStore } from '$lib/stores/primaryPane.svelte';

  let { canvas }: { canvas: CanvasState } = $props();

  let expanded = $state(false);

  function toggleExpand() {
    expanded = !expanded;
  }

  function openInTab() {
    primaryPaneStore.openCanvasTab(canvas.id, canvas.title || 'Canvas');
  }
</script>

<div class="canvas-card" class:expanded>
  <!-- Header row -->
  <button class="canvas-header" onclick={toggleExpand}>
    <span class="canvas-icon">
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
        <line x1="3" y1="9" x2="21" y2="9"></line>
        <line x1="9" y1="21" x2="9" y2="9"></line>
      </svg>
    </span>
    <span class="canvas-type-badge">{canvas.contentType}</span>
    <span class="canvas-title">{canvas.title || 'Canvas'}</span>
    <span class="canvas-chevron" class:rotated={expanded}>
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    </span>
  </button>

  <!-- Open button -->
  <button class="canvas-open-btn" onclick={openInTab} title="Open in tab">
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"></path>
    </svg>
  </button>

  <!-- Expandable preview -->
  {#if expanded}
    <div class="canvas-body">
      <CanvasRenderer
        contentType={canvas.contentType}
        content={canvas.content}
        canvasId={canvas.id}
      />
    </div>
  {/if}
</div>

<style>
  .canvas-card {
    position: relative;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius);
    overflow: hidden;
    transition: border-color var(--transition);
    margin: 8px 0;
  }

  .canvas-card:hover {
    border-color: var(--border-primary);
  }

  .canvas-card.expanded {
    border-color: var(--accent-primary);
  }

  .canvas-header {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 12px;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    color: var(--text-primary);
    transition: background var(--transition);
    padding-right: 32px; /* room for open button */
  }

  .canvas-header:hover {
    background: var(--bg-hover);
  }

  .canvas-icon {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    color: var(--text-tertiary);
  }

  .canvas-type-badge {
    font-size: var(--fs-xxs);
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent);
    border-radius: var(--radius-sm);
    padding: 1px 6px;
    flex-shrink: 0;
  }

  .canvas-title {
    font-size: var(--fs-base);
    font-weight: 600;
    color: var(--text-primary);
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .canvas-chevron {
    flex-shrink: 0;
    color: var(--text-tertiary);
    transition: transform var(--transition);
    display: flex;
    align-items: center;
  }

  .canvas-chevron.rotated {
    transform: rotate(180deg);
  }

  .canvas-open-btn {
    position: absolute;
    top: 6px;
    right: 8px;
    width: 22px;
    height: 22px;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid transparent;
    cursor: pointer;
    color: var(--text-tertiary);
    transition: all var(--transition);
    padding: 0;
  }

  .canvas-open-btn:hover {
    color: var(--accent-primary);
    border-color: var(--border-primary);
    background: var(--bg-hover);
  }

  .canvas-body {
    border-top: 1px solid var(--border-secondary);
    padding: 12px;
    max-height: 400px;
    overflow: auto;
    background: var(--bg-secondary);
  }
</style>
