<script lang="ts">
  import { editorStore } from '$lib/stores/editor.svelte';
  import { symbolStore } from '$lib/stores/symbols.svelte';
  import { lspStore } from '$lib/stores/lsp.svelte';
  import { api } from '$lib/api/client';
  import type { Symbol as TsSymbol } from '$lib/workers/treesitter-worker';

  /**
   * Unified symbol node used for rendering.
   * LSP and tree-sitter shapes are both normalized to this.
   * endRow is needed for current-symbol highlight (caret-inside test).
   */
  interface OutlineNode {
    name: string;
    kind: string;
    startRow: number;
    startCol: number;
    endRow: number;
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
          endRow: s.range.end?.line ?? s.range.start.line,
          children: s.children ? normalizeLspSymbols(s.children) : undefined,
        };
      }
      // SymbolInformation shape (flat — older servers)
      const start = s.location?.range?.start ?? { line: 0, character: 0 };
      const end = s.location?.range?.end ?? start;
      return {
        name: s.name,
        kind: LSP_KIND_TO_TAG[s.kind] ?? 'variable',
        startRow: start.line,
        startCol: start.character,
        endRow: end.line,
      };
    });
  }

  let lspSymbols = $state<OutlineNode[] | null>(null);
  /** Plugin command-source symbols (LYK-1048). */
  let pluginSymbols = $state<OutlineNode[] | null>(null);
  let pluginSymbolsSource = $state<string | null>(null);
  let lastFetchKey = $state('');
  let lastPluginFetchKey = $state('');

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

  /**
   * Ask the plugin bridge for symbols whenever the active file's content
   * changes. Slotted between LSP and tree-sitter so plugins can fill
   * languages neither the LSP nor the tree-sitter worker handles.
   */
  $effect(() => {
    const tab = editorStore.activeTab;
    if (!tab) {
      pluginSymbols = null;
      pluginSymbolsSource = null;
      return;
    }
    const key = `${tab.id}:${tab.content.length}`;
    if (key === lastPluginFetchKey) return;
    lastPluginFetchKey = key;
    void api.plugins
      .documentSymbols(tab.filePath, tab.content)
      .then((res) => {
        if (editorStore.activeTab?.id !== tab.id) return;
        if (res.ok && res.data?.result?.symbols) {
          pluginSymbols = res.data.result.symbols as OutlineNode[];
          pluginSymbolsSource = res.data.result.source;
        } else {
          pluginSymbols = null;
          pluginSymbolsSource = null;
        }
      })
      .catch(() => {
        pluginSymbols = null;
        pluginSymbolsSource = null;
      });
  });

  /** Fallback to tree-sitter when no LSP symbols are available. */
  function toOutlineNodes(ts: TsSymbol[]): OutlineNode[] {
    return ts.map((s) => ({
      name: s.name,
      kind: s.kind,
      startRow: s.startRow,
      startCol: s.startCol,
      endRow: s.endRow,
      children: s.children ? toOutlineNodes(s.children) : undefined,
    }));
  }

  const rawSymbols = $derived.by<OutlineNode[]>(() => {
    const tab = editorStore.activeTab;
    if (!tab) return [];
    if (lspSymbols && lspSymbols.length > 0) return lspSymbols;
    // Plugin command source slots between LSP and tree-sitter (LYK-1048).
    if (pluginSymbols && pluginSymbols.length > 0) return pluginSymbols;
    return toOutlineNodes(symbolStore.getSymbols(tab.id));
  });

  // ── Sort mode ──
  // Position = file order (default, matches what the editor sees as you scroll).
  // Name = alphabetical, useful for finding a known symbol fast in a big file.
  // Sorting is applied recursively so children of the same parent are also
  // alphabetized when 'name' is active.
  let sortMode = $state<'position' | 'name'>('position');

  function sortTree(nodes: OutlineNode[]): OutlineNode[] {
    if (sortMode === 'position') {
      // Position sort: trust source order, but also recurse into children.
      return nodes.map((n) => ({
        ...n,
        children: n.children ? sortTree(n.children) : undefined,
      }));
    }
    return [...nodes]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((n) => ({
        ...n,
        children: n.children ? sortTree(n.children) : undefined,
      }));
  }
  const symbols = $derived(sortTree(rawSymbols));

  // ── Current-symbol highlight ──
  // Walk the *original (position-ordered)* tree following the caret, mark the
  // deepest containing symbol. Use a key of "startRow:name" to identify the
  // same node in the sorted render tree.
  const currentSymbolKey = $derived.by<string | null>(() => {
    const tab = editorStore.activeTab;
    if (!tab || rawSymbols.length === 0) return null;
    const caret = tab.cursorLine - 1;
    let key: string | null = null;
    function descend(level: OutlineNode[]) {
      for (const sym of level) {
        if (caret >= sym.startRow && caret <= sym.endRow) {
          key = `${sym.startRow}:${sym.name}`;
          if (sym.children) descend(sym.children);
          return;
        }
      }
    }
    descend(rawSymbols);
    return key;
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
    editorStore.setPendingGoTo({ line: node.startRow + 1, col: node.startCol + 1 });
  }

  /** Scroll the highlighted current symbol into view as the caret moves through it. */
  let treeEl: HTMLDivElement | undefined = $state();
  $effect(() => {
    void currentSymbolKey;
    if (!treeEl) return;
    // Defer until DOM updates from the symbol re-render.
    queueMicrotask(() => {
      const el = treeEl?.querySelector('.symbol-item.current');
      if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  });
</script>

<div class="symbol-outline">
  <div class="outline-header">
    <div class="outline-title-row">
      <h3>Outline</h3>
      <div class="sort-toggle" role="tablist" aria-label="Sort symbols">
        <button
          type="button"
          role="tab"
          aria-selected={sortMode === 'position'}
          class:active={sortMode === 'position'}
          title="Sort by position in file"
          onclick={() => (sortMode = 'position')}
        >
          Pos
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={sortMode === 'name'}
          class:active={sortMode === 'name'}
          title="Sort alphabetically"
          onclick={() => (sortMode = 'name')}
        >
          A–Z
        </button>
      </div>
    </div>
    {#if editorStore.activeTab}
      <span class="outline-file">
        {editorStore.activeTab.fileName}
        {#if lspSymbols && lspSymbols.length > 0}
          <span class="outline-source" title="Symbols from language server">LSP</span>
        {:else if pluginSymbols && pluginSymbols.length > 0}
          <span class="outline-source" title={pluginSymbolsSource ?? 'Symbols from a plugin'}>
            PLUGIN
          </span>
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
    <div class="outline-tree" bind:this={treeEl}>
      {#each symbols as sym (sym.startRow + ':' + sym.name)}
        {@render symbolNode(sym, 0)}
      {/each}
    </div>
  {/if}
</div>

{#snippet symbolNode(sym: OutlineNode, depth: number)}
  {@const isCurrent = currentSymbolKey === `${sym.startRow}:${sym.name}`}
  <button
    class="symbol-item"
    class:current={isCurrent}
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
    {#each sym.children as child (child.startRow + ':' + child.name)}
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
  .outline-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
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
    margin-top: 2px;
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

  .sort-toggle {
    display: inline-flex;
    gap: 2px;
    background: var(--bg-active, rgba(255, 255, 255, 0.04));
    padding: 2px;
    border-radius: var(--radius-sm);
  }
  .sort-toggle button {
    font: inherit;
    font-size: var(--fs-xxs);
    font-weight: 600;
    padding: 1px 6px;
    border: none;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    border-radius: 3px;
  }
  .sort-toggle button:hover {
    color: var(--text-secondary);
  }
  .sort-toggle button.active {
    background: var(--bg-elevated, rgba(255, 255, 255, 0.1));
    color: var(--text-primary);
  }

  .outline-empty {
    padding: 20px;
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--fs-sm);
  }

  .outline-tree {
    overflow-y: auto;
    max-height: calc(100vh - 140px);
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
    border: none;
    background: transparent;
    cursor: pointer;
  }
  .symbol-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .symbol-item.current {
    background: var(--bg-selected, rgba(78, 193, 245, 0.15));
    color: var(--accent-fg, var(--text-primary));
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
