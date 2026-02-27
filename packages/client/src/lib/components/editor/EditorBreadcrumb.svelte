<script lang="ts" context="module">
  function kindIcon(kind: string): string {
    switch (kind) {
      case 'class':
        return 'C';
      case 'interface':
        return 'I';
      case 'function':
      case 'arrow_function':
        return 'ƒ';
      case 'method':
        return 'm';
      case 'property':
        return 'p';
      case 'variable':
        return 'v';
      case 'enum':
        return 'E';
      case 'type':
      case 'type_alias':
        return 'T';
      case 'namespace':
        return 'N';
      default:
        return '•';
    }
  }
</script>

<script lang="ts">
  import { editorStore } from '$lib/stores/editor.svelte';
  import { symbolStore } from '$lib/stores/symbols.svelte';
  import { lspStore } from '$lib/stores/lsp.svelte';
  import type { Symbol } from '$lib/workers/treesitter-worker';

  interface PathSegment {
    label: string;
    fullPath: string;
  }

  interface SymbolCrumb {
    name: string;
    kind: string;
    line?: number;
  }

  let pathSegments = $derived(getPathSegments());
  let symbolCrumbs = $derived(getSymbolCrumbs());

  function getPathSegments(): PathSegment[] {
    const tab = editorStore.activeTab;
    if (!tab?.filePath) return [];

    const parts = tab.filePath.split('/').filter(Boolean);
    const segments: PathSegment[] = [];
    let accumulated = '';

    for (const part of parts) {
      accumulated = accumulated ? `${accumulated}/${part}` : `/${part}`;
      segments.push({ label: part, fullPath: accumulated });
    }

    return segments;
  }

  function getSymbolCrumbs(): SymbolCrumb[] {
    const tab = editorStore.activeTab;
    if (!tab) return [];

    const symbols = symbolStore.getSymbols(tab.id);
    if (symbols.length === 0) return [];

    const cursorRow = tab.cursorLine - 1; // 0-indexed
    const path: SymbolCrumb[] = [];

    function find(syms: Symbol[]) {
      for (const sym of syms) {
        if (cursorRow >= sym.startRow && cursorRow <= sym.endRow) {
          path.push({ name: sym.name, kind: sym.kind, line: sym.startRow + 1 });
          if (sym.children) find(sym.children);
          return;
        }
      }
    }

    find(symbols);
    return path;
  }

  function handleSymbolClick(crumb: SymbolCrumb) {
    if (crumb.line != null) {
      // Scroll to the symbol's start line via pending goTo
      const tab = editorStore.activeTab;
      if (tab) {
        editorStore.setPendingGoTo({ line: crumb.line, col: 1 });
      }
    }
  }
</script>

{#if pathSegments.length > 0 || symbolCrumbs.length > 0}
  <div class="breadcrumb-bar" role="navigation" aria-label="File breadcrumb">
    <!-- File path segments -->
    {#each pathSegments as seg, i}
      {#if i > 0}
        <span class="crumb-sep" aria-hidden="true">&rsaquo;</span>
      {/if}
      {#if i === pathSegments.length - 1}
        <span class="crumb crumb-file" title={seg.fullPath}>{seg.label}</span>
      {:else}
        <span class="crumb crumb-dir" title={seg.fullPath}>{seg.label}</span>
      {/if}
    {/each}

    <!-- Symbol crumbs (tree-sitter based) -->
    {#each symbolCrumbs as crumb}
      <span class="crumb-sep" aria-hidden="true">&rsaquo;</span>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <span
        class="crumb crumb-symbol"
        title="{crumb.kind}: {crumb.name}"
        role="button"
        tabindex="0"
        onclick={() => handleSymbolClick(crumb)}
        onkeydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') handleSymbolClick(crumb);
        }}
      >
        <span class="crumb-kind-icon" aria-hidden="true">{kindIcon(crumb.kind)}</span>
        {crumb.name}
      </span>
    {/each}
  </div>
{/if}

<style>
  .breadcrumb-bar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 12px;
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-secondary);
    flex-shrink: 0;
    overflow-x: auto;
    scrollbar-width: none;
    min-height: 22px;
  }
  .breadcrumb-bar::-webkit-scrollbar {
    display: none;
  }

  .crumb {
    white-space: nowrap;
    cursor: default;
    transition: color 0.1s;
  }

  .crumb-dir {
    color: var(--text-tertiary);
  }
  .crumb-dir:hover {
    color: var(--text-secondary);
  }

  .crumb-file {
    color: var(--text-primary);
    font-weight: 600;
  }

  .crumb-symbol {
    color: var(--text-secondary);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }
  .crumb-symbol:hover {
    color: var(--accent-primary);
  }

  .crumb-kind-icon {
    font-size: var(--fs-xxs);
    font-weight: 700;
    color: var(--accent-primary);
    opacity: 0.6;
    width: 12px;
    text-align: center;
    font-family: var(--font-family);
  }

  .crumb-sep {
    color: var(--text-tertiary);
    opacity: 0.4;
    font-size: var(--fs-xxs);
    user-select: none;
  }
</style>
