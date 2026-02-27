<script lang="ts">
  import type { RichContentEntry } from '$lib/stores/terminal.svelte';
  import type { RichTableData, RichErrorData, RichDiffData } from '@e/shared';
  import DataTable from './rich/DataTable.svelte';
  import JsonExplorer from './rich/JsonExplorer.svelte';
  import ErrorRenderer from './rich/ErrorRenderer.svelte';
  import DiffRenderer from './rich/DiffRenderer.svelte';
  import MarkdownRenderer from './rich/MarkdownRenderer.svelte';
  import ImagePreview from './rich/ImagePreview.svelte';
  import ProgressBar from './rich/ProgressBar.svelte';

  let { entries, blockId } = $props<{
    entries: RichContentEntry[];
    blockId: string;
  }>();
</script>

<div class="rich-block-content">
  {#each entries as entry, i (i)}
    {#if entry.contentType === 'table'}
      <DataTable data={entry.data} />
    {:else if entry.contentType === 'json'}
      <JsonExplorer data={entry.data} />
    {:else if entry.contentType === 'error'}
      <ErrorRenderer data={entry.data} />
    {:else if entry.contentType === 'diff'}
      <DiffRenderer data={entry.data} />
    {:else if entry.contentType === 'markdown'}
      <MarkdownRenderer data={entry.data} />
    {:else if entry.contentType === 'image'}
      <ImagePreview data={entry.data} />
    {:else if entry.contentType === 'progress'}
      <ProgressBar data={entry.data} />
    {:else}
      <pre class="rich-fallback">{entry.data}</pre>
    {/if}
  {/each}
</div>

<style>
  .rich-block-content {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
    font-family: var(--font-family-mono, monospace);
    font-size: var(--fs-sm);
  }

  .rich-fallback {
    margin: 0;
    padding: 8px;
    color: var(--text-secondary, #8b949e);
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
