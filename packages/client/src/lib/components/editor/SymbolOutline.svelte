<script lang="ts">
  import { editorStore } from '$lib/stores/editor.svelte';
  import { symbolStore } from '$lib/stores/symbols.svelte';
  import type { Symbol } from '$lib/workers/treesitter-worker';

  let symbols = $derived(
    editorStore.activeTab ? symbolStore.getSymbols(editorStore.activeTab.id) : [],
  );

  const kindIcons: Record<string, string> = {
    function: 'f',
    class: 'C',
    method: 'm',
    variable: 'v',
    type: 'T',
    interface: 'I',
    import: 'i',
    property: 'p',
  };

  const kindColors: Record<string, string> = {
    function: 'var(--syn-function)',
    class: 'var(--syn-type)',
    method: 'var(--syn-function)',
    variable: 'var(--syn-variable)',
    type: 'var(--syn-type)',
    interface: 'var(--syn-type)',
    import: 'var(--syn-comment)',
    property: 'var(--syn-variable)',
  };
</script>

<div class="symbol-outline">
  <div class="outline-header">
    <h3>Outline</h3>
    {#if editorStore.activeTab}
      <span class="outline-file">{editorStore.activeTab.fileName}</span>
    {/if}
  </div>

  {#if !editorStore.activeTab}
    <div class="outline-empty">No file open</div>
  {:else if symbols.length === 0}
    <div class="outline-empty">No symbols found</div>
  {:else}
    <div class="outline-tree">
      {#each symbols as sym}
        {@render symbolNode(sym, 0)}
      {/each}
    </div>
  {/if}
</div>

{#snippet symbolNode(sym: Symbol, depth: number)}
  <button
    class="symbol-item"
    style:padding-left="{8 + depth * 14}px"
    title="{sym.kind}: {sym.name} (line {sym.startRow + 1})"
    onclick={() => {
      if (editorStore.activeTab) {
        editorStore.setCursorPosition(editorStore.activeTab.id, sym.startRow + 1, sym.startCol + 1);
      }
    }}
  >
    <span class="symbol-kind" style:color={kindColors[sym.kind]}>
      {kindIcons[sym.kind] || '?'}
    </span>
    <span class="symbol-name">{sym.name}</span>
    <span class="symbol-line">:{sym.startRow + 1}</span>
  </button>
  {#if sym.children}
    {#each sym.children as child}
      {@render symbolNode(child, depth + 1)}
    {/each}
  {/if}
{/snippet}

<style>
  .symbol-outline {
    padding: 8px;
  }

  .outline-header {
    padding: 4px 4px 8px;
  }
  .outline-header h3 {
    font-size: var(--fs-base);
    font-weight: 600;
    margin: 0;
  }
  .outline-file {
    display: block;
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .outline-empty {
    padding: 20px;
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--fs-sm);
  }

  .outline-tree {
    overflow-y: auto;
  }

  .symbol-item {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 3px 8px;
    border-radius: var(--radius-sm);
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    text-align: left;
    transition: background var(--transition);
  }
  .symbol-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .symbol-kind {
    font-family: var(--font-family);
    font-weight: 700;
    font-size: var(--fs-xs);
    width: 16px;
    text-align: center;
    flex-shrink: 0;
  }

  .symbol-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .symbol-line {
    font-family: var(--font-family);
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    flex-shrink: 0;
  }
</style>
