<script lang="ts">
  import type { Artifact } from '@e/shared';
  import { artifactsStore } from '$lib/stores/artifacts.svelte';
  import { renderMarkdown } from '$lib/utils/markdown';

  let { artifact }: { artifact: Artifact } = $props();

  let expanded = $state(false);
  let renderedContent = $state('');

  $effect(() => {
    if (expanded && artifact.content) {
      // Render plan/walkthrough as markdown, show diff/screenshot raw
      if (artifact.type === 'plan' || artifact.type === 'walkthrough') {
        renderMarkdown(artifact.content).then((html) => {
          renderedContent = html;
        });
      } else {
        renderedContent = '';
      }
    }
  });

  function toggleExpand() {
    expanded = !expanded;
  }

  async function togglePin() {
    await artifactsStore.togglePin(artifact.id);
  }

  const typeIconPaths: Record<string, string> = {
    plan: 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2 M15 2H9a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1z',
    diff: 'M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z',
    screenshot:
      'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    walkthrough: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  };
  const defaultIconPath = 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6';

  const typeLabels: Record<string, string> = {
    plan: 'Plan',
    diff: 'Diff',
    screenshot: 'Screenshot',
    walkthrough: 'Walkthrough',
  };
</script>

<div class="artifact-card" class:expanded>
  <!-- Header row -->
  <button class="artifact-header" onclick={toggleExpand}>
    <span class="artifact-icon"
      ><svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"><path d={typeIconPaths[artifact.type] ?? defaultIconPath} /></svg
      ></span
    >
    <span class="artifact-type-badge">{typeLabels[artifact.type] ?? artifact.type}</span>
    <span class="artifact-title">{artifact.title}</span>
    <span class="artifact-chevron" class:rotated={expanded}>
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

  <!-- Pin button -->
  <button
    class="artifact-pin-btn"
    class:pinned={artifact.pinned}
    onclick={togglePin}
    title={artifact.pinned ? 'Unpin artifact' : 'Pin artifact'}
  >
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill={artifact.pinned ? 'currentColor' : 'none'}
      stroke="currentColor"
      stroke-width="2"
    >
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
      <circle cx="12" cy="10" r="3"></circle>
    </svg>
  </button>

  <!-- Expandable body -->
  {#if expanded}
    <div class="artifact-body">
      {#if artifact.type === 'diff'}
        <pre class="artifact-diff">{artifact.content}</pre>
      {:else if artifact.type === 'plan' || artifact.type === 'walkthrough'}
        {#if renderedContent}
          <div class="prose artifact-prose">{@html renderedContent}</div>
        {:else}
          <pre class="artifact-raw">{artifact.content}</pre>
        {/if}
      {:else}
        <pre class="artifact-raw">{artifact.content}</pre>
      {/if}
    </div>
  {/if}
</div>

<style>
  .artifact-card {
    position: relative;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius);
    overflow: hidden;
    transition: border-color var(--transition);
  }

  .artifact-card:hover {
    border-color: var(--border-primary);
  }

  .artifact-card.expanded {
    border-color: var(--accent-primary);
  }

  .artifact-header {
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
    padding-right: 32px; /* room for pin button */
  }

  .artifact-header:hover {
    background: var(--bg-hover);
  }

  .artifact-icon {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    color: var(--text-tertiary);
  }

  .artifact-type-badge {
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

  .artifact-title {
    font-size: var(--fs-base);
    font-weight: 600;
    color: var(--text-primary);
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .artifact-chevron {
    flex-shrink: 0;
    color: var(--text-tertiary);
    transition: transform var(--transition);
    display: flex;
    align-items: center;
  }

  .artifact-chevron.rotated {
    transform: rotate(180deg);
  }

  .artifact-pin-btn {
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

  .artifact-pin-btn:hover {
    color: var(--accent-primary);
    border-color: var(--border-primary);
    background: var(--bg-hover);
  }

  .artifact-pin-btn.pinned {
    color: var(--accent-primary);
  }

  .artifact-body {
    border-top: 1px solid var(--border-secondary);
    padding: 12px;
    max-height: 400px;
    overflow-y: auto;
  }

  .artifact-diff {
    font-family: var(--font-family-mono, monospace);
    font-size: var(--fs-sm);
    line-height: 1.5;
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-all;
    margin: 0;
  }

  .artifact-raw {
    font-family: var(--font-family-mono, monospace);
    font-size: var(--fs-sm);
    line-height: 1.5;
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0;
  }

  .artifact-prose {
    font-family: var(--font-family-sans);
    font-size: var(--fs-base);
    line-height: 1.7;
    color: var(--text-primary);
  }

  .artifact-prose :global(p) {
    margin-bottom: 8px;
  }
  .artifact-prose :global(p:last-child) {
    margin-bottom: 0;
  }
  .artifact-prose :global(ul),
  .artifact-prose :global(ol) {
    padding-left: 18px;
    margin-bottom: 8px;
  }
  .artifact-prose :global(li) {
    margin-bottom: 3px;
  }
  .artifact-prose :global(h1),
  .artifact-prose :global(h2),
  .artifact-prose :global(h3) {
    margin: 12px 0 6px;
    color: var(--accent-primary);
    font-size: 1em;
    font-weight: 700;
  }
  .artifact-prose :global(code) {
    font-family: var(--font-family-mono, monospace);
    font-size: var(--fs-xs);
    background: var(--bg-secondary);
    padding: 1px 4px;
    border-radius: 3px;
  }
  .artifact-prose :global(pre) {
    background: var(--bg-secondary);
    border-radius: var(--radius-sm);
    padding: 8px;
    overflow-x: auto;
    margin: 8px 0;
  }
</style>
