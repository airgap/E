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
  import { api } from '$lib/api/client';
  import type { Symbol } from '$lib/workers/treesitter-worker';

  interface PathSegment {
    label: string;
    fullPath: string;
  }

  interface DirEntry {
    name: string;
    path: string;
    type: 'file' | 'directory';
  }

  /**
   * Each symbol crumb carries the list of *siblings at its own scope level*,
   * which the picker pops open. Siblings include the crumb itself so the
   * popover stays useful even when the caret is precisely on this symbol.
   */
  interface SymbolCrumb {
    name: string;
    kind: string;
    line: number;
    siblings: Array<{ name: string; kind: string; line: number }>;
  }

  let pathSegments = $derived(getPathSegments());
  let symbolCrumbs = $derived(getSymbolCrumbs());

  /** Which symbol crumb's sibling picker is open, or null. Keyed by index. */
  let openPickerIndex = $state<number | null>(null);
  /** Which path crumb's sibling picker is open, or null. Keyed by index. */
  let openPathPickerIndex = $state<number | null>(null);
  /** Lazily-loaded sibling entries for the open path crumb. */
  let pathSiblings = $state<DirEntry[]>([]);
  let pathSiblingsLoading = $state(false);
  let barEl: HTMLDivElement | undefined = $state();

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

  /**
   * Walk the symbol tree along the cursor row. For each containing symbol
   * along the path we also capture the sibling list at that depth, so the
   * picker can show "all things at this scope" — the standard breadcrumb-
   * picker behaviour from VS Code etc.
   */
  function getSymbolCrumbs(): SymbolCrumb[] {
    const tab = editorStore.activeTab;
    if (!tab) return [];
    const symbols = symbolStore.getSymbols(tab.id);
    if (symbols.length === 0) return [];
    const cursorRow = tab.cursorLine - 1; // 0-indexed
    const path: SymbolCrumb[] = [];

    function siblingsOf(siblings: Symbol[]) {
      return siblings.map((s) => ({ name: s.name, kind: s.kind, line: s.startRow + 1 }));
    }

    function descend(level: Symbol[]) {
      for (const sym of level) {
        if (cursorRow >= sym.startRow && cursorRow <= sym.endRow) {
          path.push({
            name: sym.name,
            kind: sym.kind,
            line: sym.startRow + 1,
            siblings: siblingsOf(level),
          });
          if (sym.children) descend(sym.children);
          return;
        }
      }
    }

    descend(symbols);
    return path;
  }

  function jumpToLine(line: number) {
    editorStore.setPendingGoTo({ line, col: 1 });
  }

  function togglePicker(i: number) {
    openPickerIndex = openPickerIndex === i ? null : i;
    openPathPickerIndex = null;
  }
  function selectSibling(crumb: { line: number }) {
    openPickerIndex = null;
    jumpToLine(crumb.line);
  }

  /**
   * Parent directory of a path segment — the scope whose entries are this
   * segment's siblings. For segment i that's segment i-1's fullPath; the
   * first segment's parent is the filesystem root, which we skip (listing
   * "/" isn't useful and the picker would be noise).
   */
  function parentDirOf(i: number): string | null {
    if (i <= 0) return null;
    return pathSegments[i - 1].fullPath;
  }

  /** Open (or close) the sibling picker for a path crumb, loading entries. */
  async function togglePathPicker(i: number) {
    openPickerIndex = null;
    if (openPathPickerIndex === i) {
      openPathPickerIndex = null;
      return;
    }
    const parent = parentDirOf(i);
    if (!parent) return;
    openPathPickerIndex = i;
    pathSiblings = [];
    pathSiblingsLoading = true;
    try {
      // depth 1 = immediate children only; that's the sibling set.
      const res = await api.files.tree(parent, 1);
      const entries = Array.isArray(res.data) ? res.data : [];
      pathSiblings = entries
        .map((e: any) => ({ name: e.name, path: e.path, type: e.type }))
        .sort((a: DirEntry, b: DirEntry) => {
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
    } catch {
      pathSiblings = [];
    } finally {
      pathSiblingsLoading = false;
    }
  }

  /** Selecting a sibling: open files; drill into directories. */
  async function selectPathSibling(entry: DirEntry, crumbIndex: number) {
    if (entry.type === 'file') {
      openPathPickerIndex = null;
      void editorStore.openFile(entry.path, false);
      return;
    }
    // Directory: re-list its children in place so the user can navigate down.
    pathSiblingsLoading = true;
    try {
      const res = await api.files.tree(entry.path, 1);
      const entries = Array.isArray(res.data) ? res.data : [];
      pathSiblings = entries
        .map((e: any) => ({ name: e.name, path: e.path, type: e.type }))
        .sort((a: DirEntry, b: DirEntry) => {
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
    } catch {
      pathSiblings = [];
    } finally {
      pathSiblingsLoading = false;
    }
  }

  // ── Outside-click + Escape to close picker ──
  function onDocPointerDown(e: PointerEvent) {
    if (openPickerIndex === null && openPathPickerIndex === null) return;
    if (barEl && e.target instanceof Node && barEl.contains(e.target)) return;
    openPickerIndex = null;
    openPathPickerIndex = null;
  }
  function onDocKeyDown(e: KeyboardEvent) {
    if ((openPickerIndex !== null || openPathPickerIndex !== null) && e.key === 'Escape') {
      e.preventDefault();
      openPickerIndex = null;
      openPathPickerIndex = null;
    }
  }
  $effect(() => {
    if (typeof document === 'undefined') return;
    document.addEventListener('pointerdown', onDocPointerDown, true);
    document.addEventListener('keydown', onDocKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown, true);
      document.removeEventListener('keydown', onDocKeyDown, true);
    };
  });

  // Close pickers if the underlying crumb list changes (caret moved into a
  // different scope, or the file switched) — the indexes wouldn't be
  // referring to the same crumb anymore.
  $effect(() => {
    void symbolCrumbs;
    void pathSegments;
    openPickerIndex = null;
    openPathPickerIndex = null;
  });
</script>

{#if pathSegments.length > 0 || symbolCrumbs.length > 0}
  <div class="breadcrumb-bar" role="navigation" aria-label="File breadcrumb" bind:this={barEl}>
    <!-- File path segments. Each segment past the first opens a picker of
         its siblings (entries in the parent dir): files open, dirs drill in.
         The first segment has no listable parent, so it stays a label. -->
    {#each pathSegments as seg, i (i)}
      {#if i > 0}
        <span class="crumb-sep" aria-hidden="true">&rsaquo;</span>
      {/if}
      {#if i === 0}
        <span class="crumb crumb-dir" title={seg.fullPath}>{seg.label}</span>
      {:else}
        <span class="crumb-slot">
          <button
            type="button"
            class="crumb crumb-path-btn"
            class:crumb-file={i === pathSegments.length - 1}
            class:crumb-dir={i !== pathSegments.length - 1}
            class:open={openPathPickerIndex === i}
            title="{seg.fullPath} — click for siblings"
            aria-haspopup="menu"
            aria-expanded={openPathPickerIndex === i}
            onclick={() => togglePathPicker(i)}
          >
            {seg.label}
          </button>
          {#if openPathPickerIndex === i}
            <div class="picker" role="menu" aria-label="Siblings of {seg.label}">
              {#if pathSiblingsLoading}
                <div class="picker-loading">Loading…</div>
              {:else if pathSiblings.length === 0}
                <div class="picker-loading">No entries</div>
              {:else}
                {#each pathSiblings as entry (entry.path)}
                  <button
                    type="button"
                    class="picker-item"
                    class:current={entry.name === seg.label}
                    role="menuitem"
                    onclick={() => selectPathSibling(entry, i)}
                  >
                    <span class="crumb-kind-icon" aria-hidden="true">
                      {entry.type === 'directory' ? '▸' : '·'}
                    </span>
                    <span class="picker-name">{entry.name}</span>
                  </button>
                {/each}
              {/if}
            </div>
          {/if}
        </span>
      {/if}
    {/each}

    <!-- Symbol crumbs (tree-sitter based, with sibling picker) -->
    {#each symbolCrumbs as crumb, i (i)}
      <span class="crumb-sep" aria-hidden="true">&rsaquo;</span>
      <span class="crumb-slot">
        <button
          type="button"
          class="crumb crumb-symbol"
          class:open={openPickerIndex === i}
          title="{crumb.kind}: {crumb.name} — click for siblings"
          aria-haspopup="menu"
          aria-expanded={openPickerIndex === i}
          onclick={() => togglePicker(i)}
        >
          <span class="crumb-kind-icon" aria-hidden="true">{kindIcon(crumb.kind)}</span>
          {crumb.name}
        </button>

        {#if openPickerIndex === i}
          <div class="picker" role="menu" aria-label="Siblings of {crumb.name}">
            {#each crumb.siblings as sib (sib.line)}
              <button
                type="button"
                class="picker-item"
                class:current={sib.line === crumb.line}
                role="menuitem"
                onclick={() => selectSibling(sib)}
              >
                <span class="crumb-kind-icon" aria-hidden="true">{kindIcon(sib.kind)}</span>
                <span class="picker-name">{sib.name}</span>
                <span class="picker-line">:{sib.line}</span>
              </button>
            {/each}
          </div>
        {/if}
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
    position: relative;
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

  .crumb-path-btn {
    appearance: none;
    border: none;
    background: transparent;
    font: inherit;
    font-size: var(--fs-xs);
    cursor: pointer;
    padding: 1px 4px;
    border-radius: 3px;
  }
  .crumb-path-btn:hover,
  .crumb-path-btn.open {
    color: var(--accent-primary);
    background: var(--bg-hover, rgba(255, 255, 255, 0.06));
  }

  .picker-loading {
    padding: 6px 10px;
    color: var(--text-tertiary);
    font-size: var(--fs-xxs);
  }

  .crumb-slot {
    position: relative;
    display: inline-flex;
    align-items: center;
  }

  .crumb-symbol {
    appearance: none;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--fs-xs);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 1px 4px;
    border-radius: 3px;
  }
  .crumb-symbol:hover,
  .crumb-symbol.open {
    color: var(--accent-primary);
    background: var(--bg-hover, rgba(255, 255, 255, 0.06));
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

  .picker {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    min-width: 180px;
    max-height: 280px;
    overflow-y: auto;
    padding: 4px 0;
    background: var(--bg-elevated, #232327);
    border: 1px solid var(--border-strong, rgba(255, 255, 255, 0.12));
    border-radius: 4px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    z-index: 1000;
  }
  .picker-item {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 4px 10px;
    background: transparent;
    border: none;
    color: var(--text-primary, #e6e6e6);
    font: inherit;
    font-size: var(--fs-xs);
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
  }
  .picker-item:hover {
    background: var(--bg-selected, rgba(78, 193, 245, 0.18));
  }
  .picker-item.current {
    color: var(--accent-fg, var(--accent-primary));
  }
  .picker-name {
    flex: 1;
  }
  .picker-line {
    color: var(--text-tertiary);
    font-size: var(--fs-xxs);
  }
</style>
