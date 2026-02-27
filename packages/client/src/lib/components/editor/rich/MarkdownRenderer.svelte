<script lang="ts">
  import { renderMarkdown } from '$lib/utils/markdown';

  let { data } = $props<{ data: string }>();

  const rendered = $derived(renderMarkdown(data));
</script>

<div class="markdown-renderer">
  <div class="markdown-body">
    {@html rendered}
  </div>
</div>

<style>
  .markdown-renderer {
    border: var(--ht-border-width, 1px) var(--ht-border-style, solid)
      color-mix(in srgb, var(--text-tertiary, #6e7681) 20%, transparent);
    border-radius: var(--ht-radius, 4px);
    overflow: hidden;
    background: var(--bg-primary, #0d1117);
    max-height: 600px;
    overflow-y: auto;
    transition: border-color var(--ht-transition-speed, 125ms) ease;
  }

  .markdown-body {
    padding: 12px 16px;
    font-size: var(--fs-sans-base);
    line-height: 1.6;
    color: var(--text-primary, #c9d1d9);
  }

  .markdown-body :global(h1),
  .markdown-body :global(h2),
  .markdown-body :global(h3) {
    margin: 16px 0 8px;
    color: var(--text-primary, #c9d1d9);
    font-weight: 600;
  }

  .markdown-body :global(h1) {
    font-size: 1.5em;
    border-bottom: 1px solid color-mix(in srgb, var(--text-tertiary, #6e7681) 20%, transparent);
    padding-bottom: 4px;
  }

  .markdown-body :global(h2) {
    font-size: 1.25em;
  }

  .markdown-body :global(code) {
    padding: 2px 5px;
    border-radius: 3px;
    background: color-mix(in srgb, var(--bg-secondary, #161b22) 80%, transparent);
    font-family: var(--font-family-mono, monospace);
    font-size: 0.9em;
  }

  .markdown-body :global(pre) {
    padding: 10px;
    border-radius: var(--radius-sm, 4px);
    background: var(--bg-secondary, #161b22);
    overflow-x: auto;
    font-size: var(--fs-sm);
  }

  .markdown-body :global(pre code) {
    padding: 0;
    background: none;
  }

  .markdown-body :global(a) {
    color: var(--accent-primary, #00b4ff);
    text-decoration: none;
  }

  .markdown-body :global(a:hover) {
    text-decoration: underline;
  }

  .markdown-body :global(blockquote) {
    margin: 8px 0;
    padding: 4px 12px;
    border-left: 3px solid var(--text-tertiary, #6e7681);
    color: var(--text-secondary, #8b949e);
  }

  .markdown-body :global(ul),
  .markdown-body :global(ol) {
    padding-left: 20px;
    margin: 8px 0;
  }

  .markdown-body :global(table) {
    border-collapse: collapse;
    width: 100%;
    margin: 8px 0;
  }

  .markdown-body :global(th),
  .markdown-body :global(td) {
    padding: 4px 8px;
    border: 1px solid color-mix(in srgb, var(--text-tertiary, #6e7681) 20%, transparent);
    text-align: left;
  }

  .markdown-body :global(th) {
    background: color-mix(in srgb, var(--bg-secondary, #161b22) 60%, transparent);
    font-weight: 600;
  }
</style>
