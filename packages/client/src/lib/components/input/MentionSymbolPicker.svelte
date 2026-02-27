<script lang="ts">
  import { symbolStore } from '$lib/stores/symbols.svelte';
  import { editorStore } from '$lib/stores/editor.svelte';
  import { onMount } from 'svelte';
  import type { Symbol } from '$lib/workers/treesitter-worker';

  interface SymbolItem {
    name: string;
    kind: string;
    filePath: string;
    fileName: string;
    startRow: number;
    startCol: number;
  }

  let { onSelect, onClose } = $props<{
    onSelect: (item: SymbolItem) => void;
    onClose: () => void;
  }>();

  let searchQuery = $state('');
  let selectedIndex = $state(0);
  let searchInput = $state<HTMLInputElement>();

  onMount(() => {
    searchInput?.focus();
  });

  function flattenSymbols(syms: Symbol[], filePath: string, fileName: string): SymbolItem[] {
    const result: SymbolItem[] = [];
    for (const sym of syms) {
      result.push({
        name: sym.name,
        kind: sym.kind,
        filePath,
        fileName,
        startRow: sym.startRow,
        startCol: sym.startCol,
      });
      if (sym.children) {
        result.push(...flattenSymbols(sym.children, filePath, fileName));
      }
    }
    return result;
  }

  let allSymbols = $derived.by(() => {
    const items: SymbolItem[] = [];
    for (const [fileId, syms] of symbolStore.symbolsByFile) {
      const tab = editorStore.tabs.find((t) => t.id === fileId);
      const filePath = tab?.filePath || fileId;
      const fileName = tab?.fileName || fileId.split('/').pop() || fileId;
      items.push(...flattenSymbols(syms, filePath, fileName));
    }
    return items;
  });

  let filtered = $derived(
    searchQuery.trim()
      ? allSymbols.filter(
          (s) =>
            s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            s.kind.toLowerCase().includes(searchQuery.toLowerCase()),
        )
      : allSymbols,
  );

  function kindIcon(kind: string): string {
    switch (kind) {
      case 'function':
        return 'ƒ';
      case 'class':
        return 'C';
      case 'method':
        return 'm';
      case 'variable':
        return 'v';
      case 'type':
        return 'T';
      case 'interface':
        return 'I';
      case 'import':
        return '↗';
      case 'property':
        return 'p';
      default:
        return '·';
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, filtered.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
    } else if (e.key === 'Enter' && filtered[selectedIndex]) {
      e.preventDefault();
      onSelect(filtered[selectedIndex]);
    } else if (e.key === 'Escape') {
      onClose();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="symbol-picker" onclick={(e) => e.stopPropagation()}>
  <div class="picker-header">
    <span class="picker-title"
      ><svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg
      > Select Symbol</span
    >
    <button class="picker-close" onclick={onClose}>×</button>
  </div>
  <div class="search-wrap">
    <input
      bind:this={searchInput}
      bind:value={searchQuery}
      oninput={() => (selectedIndex = 0)}
      placeholder="Search symbols..."
      class="search-input"
    />
  </div>
  <div class="picker-list">
    {#if filtered.length === 0}
      <div class="picker-empty">
        {allSymbols.length === 0
          ? 'No symbols parsed yet — open a file in the editor first'
          : 'No symbols match'}
      </div>
    {:else}
      {#each filtered as sym, i}
        <button
          class="picker-item"
          class:selected={i === selectedIndex}
          onclick={() => onSelect(sym)}
          onmouseenter={() => (selectedIndex = i)}
        >
          <span class="sym-kind" data-kind={sym.kind}>{kindIcon(sym.kind)}</span>
          <span class="sym-name">{sym.name}</span>
          <span class="sym-file">{sym.fileName}:{sym.startRow + 1}</span>
        </button>
      {/each}
    {/if}
  </div>
</div>

<style>
  .symbol-picker {
    position: absolute;
    bottom: 100%;
    left: 24px;
    right: 24px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
    z-index: 100;
    display: flex;
    flex-direction: column;
    max-height: 340px;
  }

  .picker-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px 4px;
    border-bottom: 1px solid var(--border-primary);
  }

  .picker-title {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--accent-primary);
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .picker-close {
    color: var(--text-tertiary);
    font-size: var(--fs-xl);
    line-height: 1;
    padding: 0 4px;
  }
  .picker-close:hover {
    color: var(--text-primary);
  }

  .search-wrap {
    padding: 6px 8px;
    border-bottom: 1px solid var(--border-primary);
  }

  .search-input {
    width: 100%;
    font-size: var(--fs-sm);
    padding: 5px 10px;
    background: var(--bg-input);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    outline: none;
  }
  .search-input:focus {
    border-color: var(--accent-primary);
  }

  .picker-list {
    overflow-y: auto;
    flex: 1;
    padding: 4px;
  }

  .picker-empty {
    padding: 12px;
    color: var(--text-tertiary);
    font-size: var(--fs-sm);
    text-align: center;
  }

  .picker-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 12px;
    border-radius: var(--radius-sm);
    text-align: left;
    font-size: var(--fs-sm);
    transition: background var(--transition);
    color: var(--text-secondary);
  }
  .picker-item:hover,
  .picker-item.selected {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .sym-kind {
    font-family: var(--font-family-mono, monospace);
    font-size: var(--fs-xs);
    font-weight: 700;
    width: 16px;
    text-align: center;
    flex-shrink: 0;
    color: var(--accent-primary);
  }

  .sym-name {
    font-weight: 500;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sym-file {
    color: var(--text-tertiary);
    font-size: var(--fs-xs);
    flex-shrink: 0;
    font-family: var(--font-family-mono, monospace);
  }
</style>
