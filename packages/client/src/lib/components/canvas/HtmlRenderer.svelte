<script lang="ts">
  interface Props {
    content: string;
  }

  let { content }: Props = $props();
</script>

<div class="html-renderer">
  {@html content}
</div>

<style>
  .html-renderer {
    width: 100%;
  }

  /* Apply basic styling to injected HTML */
  .html-renderer :global(h1),
  .html-renderer :global(h2),
  .html-renderer :global(h3),
  .html-renderer :global(h4) {
    margin-top: 0;
    margin-bottom: 8px;
    color: var(--text-primary);
  }

  .html-renderer :global(p) {
    margin: 8px 0;
    color: var(--text-secondary);
  }

  .html-renderer :global(a) {
    color: var(--accent-primary);
    text-decoration: none;
  }

  .html-renderer :global(a:hover) {
    text-decoration: underline;
  }

  .html-renderer :global(ul),
  .html-renderer :global(ol) {
    margin: 8px 0;
    padding-left: 24px;
  }

  .html-renderer :global(li) {
    margin: 4px 0;
    color: var(--text-secondary);
  }

  .html-renderer :global(code) {
    font-family: var(--font-family-mono, monospace);
    background: var(--bg-tertiary);
    padding: 2px 4px;
    border-radius: 3px;
    font-size: var(--fs-xs);
    color: var(--accent-primary);
  }

  .html-renderer :global(pre) {
    background: var(--bg-tertiary);
    padding: 12px;
    border-radius: var(--radius-sm);
    overflow-x: auto;
    margin: 8px 0;
  }

  .html-renderer :global(pre code) {
    background: none;
    padding: 0;
  }
</style>
