<script lang="ts">
  import { editorStore } from '$lib/stores/editor.svelte';
  import { symbolStore } from '$lib/stores/symbols.svelte';
  import { lspStore } from '$lib/stores/lsp.svelte';
  import type { Symbol as TsSymbol } from '$lib/workers/treesitter-worker';

  /**
   * Unified symbol node used for rendering.
   * LSP and tree-sitter shapes are both normalized to this.
   */
  interface OutlineNode {
    name: string;
    kind: string;
    startRow: number;
    startCol: number;
    children?: OutlineNode[];
  }

  // LSP SymbolKind (spec numeric values) → our short kind tags.
  // https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#symbolKind
  const LSP_KIND_TO_TAG: Record<number, string> = {
    1: 'file',
    2: 'module',
    3: 'namespace',
    4: 'package',
    5: 'class',
    6: 'method',
    7: 'property',
    8: 'property', // Field
    9: 'method', // Constructor
    10: 'type', // Enum
    11: 'interface',
    12: 'function',
    13: 'variable',
    14: 'variable', // Constant
    15: 'variable', // String
    16: 'variable', // Number
    17: 'variable', // Boolean
    18: 'variable', // Array
    19: 'variable', // Object
    20: 'property', // Key
    21: 'variable', // Null
    22: 'variable', // EnumMember
    23: 'type', // Struct
    24: 'type', // Event
    25: 'function', // Operator
    26: 'type', // TypeParameter
  };

  function normalizeLspSymbols(symbols: any[]): OutlineNode[] {
    return symbols.map((s) => {
      // DocumentSymbol shape (preferred — hierarchical)
      if (s.range && s.range.start) {
        return {
          name: s.name,
          kind: LSP_KIND_TO_TAG[s.kind] ?? 'variable',
          startRow: s.range.start.line,
          startCol: s.range.start.character,
          children: s.children ? normalizeLspSymbols(s.children) : undefined,
        };
      }
      // SymbolInformation shape (flat — older servers)
      const start = s.location?.range?.start ?? { line: 0, character: 0 };
      return {
        name: s.name,
        kind: LSP_KIND_TO_TAG[s.kind] ?? 'variable',
        startRow: start.line,
        startCol: start.character,
      };
    });
  }

  let lspSymbols = $state<OutlineNode[] | null>(null);
  let lastFetchKey = $state('');

  /** Kick off a fresh LSP documentSymbol request whenever the active tab or its content changes. */
  $effect(() => {
    const tab = editorStore.activeTab;
    if (!tab) {
      lspSymbols = null;
      return;
    }
    if (!lspStore.isConnected(tab.language)) {
      lspSymbols = null;
      return;
    }
    const key = `${tab.id}:${tab.content.length}`;
    if (key === lastFetchKey) return;
    lastFetchKey = key;
    lspStore
      .documentSymbols(tab.language, tab.filePath)
      .then((raw) => {
        if (editorStore.activeTab?.id !== tab.id) return; // tab switched while awaiting
        lspSymbols = raw.length ? normalizeLspSymbols(raw) : [];
      })
      .catch(() => {
        lspSymbols = [];
      });
  });

  /** Fallback to tree-sitter when no LSP symbols are available. */
  function toOutlineNodes(ts: TsSymbol[]): OutlineNode[] {
    return ts.map((s) => ({
      name: s.name,
      kind: s.kind,
      startRow: s.startRow,
      startCol: s.startCol,
      children: s.children ? toOutlineNodes(s.children) : undefined,
    }));
  }

  let symbols = $derived.by<OutlineNode[]>(() => {
    const tab = editorStore.activeTab;
    if (!tab) return [];
    if (lspSymbols && lspSymbols.length > 0) return lspSymbols;
    return toOutlineNodes(symbolStore.getSymbols(tab.id));
  });

  const kindIcons: Record<string, string> = {
    function: 'f',
    class: 'C',
    method: 'm',
    variable: 'v',
    type: 'T',
    interface: 'I',
    import: 'i',
    property: 'p',
    module: 'M',
    namespace: 'N',
    package: 'P',
    file: 'F',
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
    module: 'var(--syn-type)',
    namespace: 'var(--syn-type)',
    package: 'var(--syn-type)',
    file: 'var(--syn-comment)',
  };

  function jumpTo(node: OutlineNode) {
    const tab = editorStore.activeTab;
    if (!tab) return;
    // Route through the pending-goto mechanism so the editor scrolls and places the cursor.
    editorStore.setPendingGoTo({ line: node.startRow + 1, col: node.startCol + 1 });
  }
</script>

<div class="symbol-outline">
  <div class="outline-header">
    <h3>Outline</h3>
    {#if editorStore.activeTab}
      <span class="outline-file">
        {editorStore.activeTab.fileName}
        {#if lspSymbols && lspSymbols.length > 0}
          <span class="outline-source" title="Symbols from language server">LSP</span>
        {:else if editorStore.activeTab && symbols.length > 0}
          <span class="outline-source" title="Symbols from tree-sitter (LSP unavailable)">TS</span>
        {/if}
      </span>
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

{#snippet symbolNode(sym: OutlineNode, depth: number)}
  <button
    class="symbol-item"
    style:padding-left="{8 + depth * 14}px"
    title="{sym.kind}: {sym.name} (line {sym.startRow + 1})"
    onclick={() => jumpTo(sym)}
  >
    <span class="symbol-kind" style:color={kindColors[sym.kind] ?? 'var(--text-tertiary)'}>
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
  .outline-source {
    display: inline-block;
    margin-left: 6px;
    padding: 0 4px;
    font-size: var(--fs-xxs);
    font-weight: 700;
    border-radius: 2px;
    background: var(--bg-active);
    color: var(--text-secondary);
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
