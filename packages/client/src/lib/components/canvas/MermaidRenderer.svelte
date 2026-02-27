<script lang="ts">
  import { onMount } from 'svelte';

  interface Props {
    content: string;
    canvasId: string;
  }

  let { content, canvasId }: Props = $props();
  let container = $state<HTMLDivElement>();
  let renderError = $state<string | null>(null);

  onMount(async () => {
    try {
      // Skip render if content is empty (can happen during reactive flush)
      if (!content?.trim()) return;

      // Dynamically import mermaid
      const mermaid = await import('mermaid');

      // Initialize mermaid
      mermaid.default.initialize({
        startOnLoad: false,
        theme: 'base',
        themeVariables: {
          primaryColor: '#6366f1',
          primaryTextColor: '#fff',
          primaryBorderColor: '#4f46e5',
          lineColor: '#94a3b8',
          secondaryColor: '#8b5cf6',
          tertiaryColor: '#ec4899',
        },
      });

      // Render the diagram
      const id = (canvasId ?? '') || Math.random().toString(36).slice(2, 10);
      const { svg } = await mermaid.default.render(`mermaid-${id}`, content);
      if (container) {
        container.innerHTML = svg;
      }
    } catch (error) {
      console.error('[MermaidRenderer] Error rendering diagram:', error);
      renderError = error instanceof Error ? error.message : 'Failed to render diagram';
    }
  });
</script>

<div class="mermaid-renderer">
  {#if renderError}
    <div class="error-message">
      <strong>Error rendering Mermaid diagram:</strong>
      <pre>{renderError}</pre>
    </div>
  {:else}
    <div bind:this={container} class="mermaid-container"></div>
  {/if}
</div>

<style>
  .mermaid-renderer {
    width: 100%;
  }

  .mermaid-container {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100px;
  }

  .mermaid-container :global(svg) {
    max-width: 100%;
    height: auto;
  }

  .error-message {
    padding: 12px;
    background: color-mix(in srgb, var(--accent-error) 10%, transparent);
    border: 1px solid var(--accent-error);
    border-radius: var(--radius-sm);
    color: var(--text-error);
    font-size: var(--fs-sm);
  }

  .error-message strong {
    display: block;
    margin-bottom: 8px;
  }

  .error-message pre {
    font-family: var(--font-family-mono, monospace);
    font-size: var(--fs-xs);
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0;
  }
</style>
