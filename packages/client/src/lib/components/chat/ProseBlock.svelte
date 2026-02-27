<script lang="ts">
  import { mount, unmount } from 'svelte';
  import CodeBlock from './CodeBlock.svelte';

  let { html, class: extraClass = '' } = $props<{
    html: string;
    class?: string;
  }>();

  let container = $state<HTMLDivElement>();

  // Track mounted CodeBlock instances for cleanup
  let mounted: Array<ReturnType<typeof mount>> = [];

  // Tooltip state
  let tooltip = $state<{ text: string; x: number; y: number } | null>(null);
  let tooltipTimeout: ReturnType<typeof setTimeout> | null = null;

  function hydrate() {
    // Clean up previous mounts
    for (const m of mounted) {
      unmount(m);
    }
    mounted = [];

    if (!container) return;

    // Replace .code-block-wrapper placeholders with live CodeBlock components
    const wrappers = container.querySelectorAll<HTMLElement>('.code-block-wrapper');
    for (const wrapper of wrappers) {
      const encoded = wrapper.dataset.code ?? '';
      const language = wrapper.dataset.language ?? 'text';
      let code = '';
      try {
        code = decodeURIComponent(escape(atob(encoded)));
      } catch {
        code = encoded;
      }

      // Replace the placeholder with a real mount point
      const host = document.createElement('div');
      host.className = 'code-block-host';
      wrapper.replaceWith(host);

      const instance = mount(CodeBlock, {
        target: host,
        props: { code, language },
      });
      mounted.push(instance);
    }

    // Wire inline code hover tooltips
    const inlineCodes = container.querySelectorAll<HTMLElement>('code:not(.code-inner)');
    for (const el of inlineCodes) {
      el.addEventListener('mouseenter', handleCodeEnter);
      el.addEventListener('mouseleave', handleCodeLeave);
      el.addEventListener('mousemove', handleCodeMove);
    }
  }

  function handleCodeEnter(e: MouseEvent) {
    const el = e.currentTarget as HTMLElement;
    const text = el.textContent ?? '';
    const lines = text.split('\n').length;
    const chars = text.length;
    const words = text.trim().split(/\s+/).filter(Boolean).length;

    tooltipTimeout = setTimeout(() => {
      const rect = el.getBoundingClientRect();
      tooltip = {
        text: `${chars} chars · ${words} word${words !== 1 ? 's' : ''} · ${lines} line${lines !== 1 ? 's' : ''}`,
        x: rect.left + rect.width / 2,
        y: rect.top - 6,
      };
    }, 400);
  }

  function handleCodeLeave() {
    if (tooltipTimeout) clearTimeout(tooltipTimeout);
    tooltip = null;
  }

  function handleCodeMove(e: MouseEvent) {
    if (tooltip) {
      tooltip = { ...tooltip, x: e.clientX, y: e.clientY - 30 };
    }
  }

  // Re-run hydration when html changes
  $effect(() => {
    // Reading html here makes this reactive to its changes
    void html;
    // Wait a tick for the DOM to reflect the new html
    requestAnimationFrame(() => {
      hydrate();
    });

    return () => {
      for (const m of mounted) {
        unmount(m);
      }
      mounted = [];
    };
  });
</script>

<!-- Tooltip -->
{#if tooltip}
  <div
    class="inline-code-tooltip"
    style="left: {tooltip.x}px; top: {tooltip.y}px;"
    aria-hidden="true"
  >
    {tooltip.text}
  </div>
{/if}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="prose {extraClass}" bind:this={container}>
  {@html html}
</div>

<style>
  .prose {
    line-height: 1.7;
    color: var(--text-primary);
    font-family: var(--font-family-sans);
    font-size: var(--font-size-sans);
    font-weight: 500;
  }

  .prose :global(p) {
    margin-bottom: 10px;
  }
  .prose :global(p:last-child) {
    margin-bottom: 0;
  }
  .prose :global(ul),
  .prose :global(ol) {
    padding-left: 20px;
    margin-bottom: 10px;
  }
  .prose :global(li) {
    margin-bottom: 4px;
  }
  .prose :global(h1),
  .prose :global(h2),
  .prose :global(h3) {
    margin: 20px 0 10px;
    font-family: var(--font-family-sans);
    color: var(--accent-primary);
    letter-spacing: var(--ht-label-spacing);
    text-transform: var(--ht-label-transform);
  }
  .prose :global(h1) {
    font-size: 1.4em;
    font-weight: var(--ht-prose-heading-weight);
  }
  .prose :global(h2) {
    font-size: 1.2em;
    font-weight: var(--ht-prose-heading-weight);
  }
  .prose :global(h3) {
    font-size: 1.05em;
    font-weight: var(--ht-prose-heading-weight);
  }
  .prose :global(blockquote) {
    border-left: 2px solid var(--accent-primary);
    padding-left: 14px;
    color: var(--text-secondary);
    margin: 10px 0;
    font-style: normal;
  }
  .prose :global(table) {
    border-collapse: collapse;
    width: 100%;
    margin: 10px 0;
  }
  .prose :global(th),
  .prose :global(td) {
    border: 1px solid var(--border-primary);
    padding: 8px 14px;
    text-align: left;
  }
  .prose :global(th) {
    background: var(--bg-tertiary);
    font-weight: 700;
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
    font-size: var(--fs-sm);
  }
  .prose :global(hr) {
    border: none;
    border-top: 1px solid var(--border-primary);
    margin: 20px 0;
  }
  .prose :global(strong) {
    font-weight: 700;
    color: var(--accent-primary);
  }
  .prose :global(em) {
    color: var(--text-secondary);
  }
  .prose :global(a) {
    color: var(--accent-primary);
    text-decoration: none;
    border-bottom: 1px solid color-mix(in srgb, var(--accent-primary) 40%, transparent);
    transition:
      border-color var(--transition),
      opacity var(--transition);
  }
  .prose :global(a:hover) {
    border-bottom-color: var(--accent-primary);
    opacity: 0.85;
  }

  /* Inline code */
  .prose :global(code) {
    font-family: var(--font-family);
    font-size: 0.875em;
    background: color-mix(in srgb, var(--accent-primary) 8%, var(--bg-tertiary));
    color: var(--accent-primary);
    padding: 1px 5px;
    border-radius: 4px;
    border: 1px solid color-mix(in srgb, var(--accent-primary) 20%, transparent);
    cursor: default;
    transition:
      background var(--transition),
      border-color var(--transition);
  }
  .prose :global(code:hover) {
    background: color-mix(in srgb, var(--accent-primary) 14%, var(--bg-tertiary));
    border-color: color-mix(in srgb, var(--accent-primary) 35%, transparent);
  }

  /* Code block host wrapper spacing */
  .prose :global(.code-block-host) {
    margin: 12px 0;
  }

  /* Inline code tooltip */
  .inline-code-tooltip {
    position: fixed;
    z-index: 9999;
    transform: translate(-50%, -100%);
    background: var(--bg-elevated);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    padding: 3px 8px;
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    white-space: nowrap;
    pointer-events: none;
    box-shadow: var(--shadow-lg, 0 4px 12px rgba(0, 0, 0, 0.3));
    animation: fadeIn 0.1s linear;
  }
</style>
