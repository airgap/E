<script lang="ts">
  import { onMount } from 'svelte';
  import MermaidRenderer from './MermaidRenderer.svelte';
  import TableRenderer from './TableRenderer.svelte';
  import HtmlRenderer from './HtmlRenderer.svelte';
  import SvgRenderer from './SvgRenderer.svelte';

  interface Props {
    contentType: 'html' | 'svg' | 'mermaid' | 'table';
    content: string;
    canvasId: string;
    onInteraction?: (
      type: 'click' | 'hover',
      elementId?: string,
      coords?: { x: number; y: number },
    ) => void;
  }

  let { contentType, content, canvasId, onInteraction }: Props = $props();

  function handleClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    const elementId = target.id || target.getAttribute('data-id') || undefined;
    const coords = { x: event.clientX, y: event.clientY };
    onInteraction?.('click', elementId, coords);
  }

  function handleMouseOver(event: MouseEvent) {
    const target = event.target as HTMLElement;
    const elementId = target.id || target.getAttribute('data-id') || undefined;
    const coords = { x: event.clientX, y: event.clientY };
    onInteraction?.('hover', elementId, coords);
  }
</script>

<div
  class="canvas-renderer"
  role="region"
  aria-label={`Canvas: ${contentType}`}
  onclick={handleClick}
  onmouseover={handleMouseOver}
>
  {#if contentType === 'mermaid'}
    <MermaidRenderer {content} {canvasId} />
  {:else if contentType === 'table'}
    <TableRenderer {content} />
  {:else if contentType === 'html'}
    <HtmlRenderer {content} />
  {:else if contentType === 'svg'}
    <SvgRenderer {content} />
  {:else}
    <div class="error">Unknown content type: {contentType}</div>
  {/if}
</div>

<style>
  .canvas-renderer {
    width: 100%;
    min-height: 100px;
  }

  .error {
    padding: 16px;
    background: var(--bg-error);
    color: var(--text-error);
    border-radius: var(--radius-sm);
    font-size: var(--fs-sm);
  }
</style>
