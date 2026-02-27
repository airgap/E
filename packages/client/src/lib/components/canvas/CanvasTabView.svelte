<script lang="ts">
  import { canvasStore } from '$lib/stores/canvas.svelte';
  import { api } from '$lib/api/client';
  import { onMount } from 'svelte';
  import type { StreamCanvasUpdate } from '@e/shared';
  import CanvasRenderer from './CanvasRenderer.svelte';

  interface Props {
    canvasId: string;
  }

  let { canvasId }: Props = $props();

  let loading = $state(false);
  const canvas = $derived(canvasStore.getById(canvasId));

  // Safe accessors — Svelte 5 reactive prop getters fire before {#if} guards
  // can unmount children, so canvas.* accesses in the template throw when
  // the store briefly yields undefined during a reactive flush.
  const contentType = $derived(canvas?.contentType ?? 'html');
  const content = $derived(canvas?.content ?? '');
  const title = $derived(canvas?.title || 'Untitled Canvas');

  // Fetch from server if not in the local store
  onMount(() => {
    if (!canvas && canvasId) {
      loading = true;
      api.canvas
        .get(canvasId)
        .then((res) => {
          if (res.ok && res.data) {
            const event: StreamCanvasUpdate = {
              type: 'canvas_update',
              canvasId: res.data.id,
              contentType: res.data.contentType as StreamCanvasUpdate['contentType'],
              content: res.data.content,
              title: res.data.title,
              conversationId: res.data.conversationId || '',
            };
            canvasStore.handleUpdate(event);
          }
        })
        .catch(() => {})
        .finally(() => {
          loading = false;
        });
    }
  });
</script>

<div class="canvas-tab-view">
  {#if canvas}
    {#key canvasId}
      <div class="canvas-tab-header">
        <span class="canvas-tab-badge">{contentType}</span>
        <h2 class="canvas-tab-title">{title}</h2>
      </div>
      <div class="canvas-tab-content">
        <CanvasRenderer {contentType} {content} {canvasId} />
      </div>
    {/key}
  {:else}
    <div class="canvas-tab-empty">
      <svg
        width="36"
        height="36"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
        <line x1="3" y1="9" x2="21" y2="9"></line>
        <line x1="9" y1="21" x2="9" y2="9"></line>
      </svg>
      <p>{loading ? 'Loading canvas...' : 'Canvas not found or has been removed.'}</p>
    </div>
  {/if}
</div>

<style>
  .canvas-tab-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--bg-primary);
  }

  .canvas-tab-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 20px;
    border-bottom: 1px solid var(--border-secondary);
    flex-shrink: 0;
  }

  .canvas-tab-badge {
    font-size: var(--fs-xxs);
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent);
    border-radius: 3px;
    padding: 2px 6px;
    flex-shrink: 0;
  }

  .canvas-tab-title {
    margin: 0;
    font-size: var(--fs-lg);
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .canvas-tab-content {
    flex: 1;
    overflow: auto;
    padding: 20px;
  }

  .canvas-tab-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: var(--text-tertiary);
    padding: 40px;
    text-align: center;
  }

  .canvas-tab-empty svg {
    opacity: 0.25;
  }

  .canvas-tab-empty p {
    font-size: var(--fs-base);
    margin: 0;
    opacity: 0.7;
  }
</style>
