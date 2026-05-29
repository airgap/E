<script lang="ts">
  /**
   * FindWidget (LYK-982) — floating find/replace overlay for both
   * editor surfaces. Lives top-right inside the editor box; CodeEditor
   * and CanvasEditor pass in the live EditorView and a bound `open`
   * flag.
   *
   * Toggles: regex, case-sensitive, whole-word, in-selection. Match
   * count is computed by iterating SearchQuery.getCursor() over the
   * document (capped at MATCH_COUNT_CAP to keep huge docs responsive).
   *
   * Query + toggle persistence: written to localStorage under
   * `e-find-widget-v1` on every change so re-opening Cmd-F prefills
   * with the previous query.
   *
   * Keyboard inside the widget: Enter = next, Shift+Enter = prev,
   * Esc = close + refocus editor, Tab moves to Replace input when in
   * replace mode.
   */
  import { tick } from 'svelte';
  import { EditorView } from '@codemirror/view';
  import {
    SearchQuery,
    setSearchQuery,
    findNext,
    findPrevious,
    replaceNext as cmReplaceNext,
    replaceAll as cmReplaceAll,
  } from '@codemirror/search';

  interface Props {
    view: EditorView | null;
    open: boolean;
    /** Show the replace row when true. Cmd+Alt+F flips this on. */
    replaceMode?: boolean;
  }

  let { view, open = $bindable(false), replaceMode = $bindable(false) }: Props = $props();

  const STORAGE_KEY = 'e-find-widget-v1';
  const MATCH_COUNT_CAP = 5000;

  interface Persisted {
    query: string;
    replace: string;
    caseSensitive: boolean;
    regexp: boolean;
    wholeWord: boolean;
  }
  function loadPersisted(): Persisted {
    if (typeof localStorage === 'undefined')
      return { query: '', replace: '', caseSensitive: false, regexp: false, wholeWord: false };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw)
        return { query: '', replace: '', caseSensitive: false, regexp: false, wholeWord: false };
      const parsed = JSON.parse(raw);
      return {
        query: String(parsed.query ?? ''),
        replace: String(parsed.replace ?? ''),
        caseSensitive: !!parsed.caseSensitive,
        regexp: !!parsed.regexp,
        wholeWord: !!parsed.wholeWord,
      };
    } catch {
      return { query: '', replace: '', caseSensitive: false, regexp: false, wholeWord: false };
    }
  }
  function savePersisted(p: Persisted) {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
    } catch {
      // ignore quota
    }
  }

  const initial = loadPersisted();
  let query = $state(initial.query);
  let replace = $state(initial.replace);
  let caseSensitive = $state(initial.caseSensitive);
  let regexp = $state(initial.regexp);
  let wholeWord = $state(initial.wholeWord);
  let inSelection = $state(false);
  /**
   * Selection range captured when inSelection is toggled on. We can't
   * re-derive it later because successive Replace calls mutate the
   * selection — caching here is the only way to keep the original
   * scope honest.
   */
  let lockedRange = $state<{ from: number; to: number } | null>(null);

  let matchCount = $state(0);
  let currentMatchIndex = $state(0);
  let queryError = $state<string | null>(null);

  let queryInputEl: HTMLInputElement | null = $state(null);
  let replaceInputEl: HTMLInputElement | null = $state(null);

  /** Build the SearchQuery the editor should run. */
  function buildQuery(): SearchQuery {
    return new SearchQuery({
      search: query,
      caseSensitive,
      regexp,
      wholeWord,
      replace,
    });
  }

  /** Push the current query into the editor's search state. */
  function applyQuery() {
    if (!view || !query) return;
    const sq = buildQuery();
    if (!sq.valid) {
      queryError = 'Invalid regex';
      return;
    }
    queryError = null;
    view.dispatch({ effects: setSearchQuery.of(sq) });
  }

  /** Count matches up to MATCH_COUNT_CAP and figure out the active index. */
  function recomputeMatches() {
    if (!view || !query) {
      matchCount = 0;
      currentMatchIndex = 0;
      return;
    }
    const sq = buildQuery();
    if (!sq.valid) {
      matchCount = 0;
      currentMatchIndex = 0;
      return;
    }
    const range = inSelection && lockedRange ? lockedRange : null;
    const cursor = sq.getCursor(view.state, range?.from, range?.to) as Iterator<{
      from: number;
      to: number;
    }>;
    const matches: Array<{ from: number; to: number }> = [];
    let count = 0;
    while (count < MATCH_COUNT_CAP) {
      const next = cursor.next();
      if (next.done) break;
      matches.push(next.value);
      count++;
    }
    matchCount = count;
    if (count === 0) {
      currentMatchIndex = 0;
      return;
    }
    const head = view.state.selection.main.head;
    let active = matches.findIndex((m) => m.from >= head);
    if (active === -1) active = matches.length - 1;
    currentMatchIndex = active + 1;
  }

  function persist() {
    savePersisted({ query, replace, caseSensitive, regexp, wholeWord });
  }

  /** Reflect changes into both the editor's search state and storage. */
  $effect(() => {
    // Touch every reactive input so this effect rebuilds the query
    // whenever the user types or toggles a flag.
    void query;
    void replace;
    void caseSensitive;
    void regexp;
    void wholeWord;
    void inSelection;
    if (!open) return;
    applyQuery();
    recomputeMatches();
    persist();
  });

  $effect(() => {
    if (!open || !view) return;
    // Defer focus so the input is mounted.
    tick().then(() => {
      queryInputEl?.focus();
      queryInputEl?.select();
    });
    // Snapshot the current selection if in-selection mode is desired
    // and the editor has a non-empty selection.
    const sel = view.state.selection.main;
    if (!sel.empty) {
      inSelection = false; // user opts in explicitly; don't auto-engage
    }
    applyQuery();
    recomputeMatches();
  });

  function close() {
    open = false;
    queryError = null;
    if (view) {
      // Restore focus so subsequent typing goes back to the editor.
      view.focus();
    }
  }

  async function next() {
    if (!view) return;
    findNext(view);
    await tick();
    recomputeMatches();
  }
  async function prev() {
    if (!view) return;
    findPrevious(view);
    await tick();
    recomputeMatches();
  }
  async function doReplaceNext() {
    if (!view) return;
    cmReplaceNext(view);
    await tick();
    recomputeMatches();
  }
  async function doReplaceAll() {
    if (!view) return;
    cmReplaceAll(view);
    await tick();
    recomputeMatches();
  }

  function toggleInSelection() {
    if (!view) return;
    if (inSelection) {
      inSelection = false;
      lockedRange = null;
    } else {
      const main = view.state.selection.main;
      if (main.empty) {
        // No useful selection — flash an error rather than silently no-op.
        queryError = 'Select text first';
        setTimeout(() => (queryError = null), 1500);
        return;
      }
      lockedRange = { from: main.from, to: main.to };
      inSelection = true;
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) void prev();
      else void next();
    }
  }
</script>

{#if open}
  <div class="find-widget" role="search" aria-label="Find in editor" onkeydown={onKeydown}>
    <div class="find-row">
      <input
        bind:this={queryInputEl}
        bind:value={query}
        type="text"
        class="find-input"
        class:error={queryError !== null}
        placeholder="Find"
        spellcheck="false"
        aria-label="Find"
      />
      <span class="counter" aria-live="polite">
        {#if queryError}
          <span class="counter-error">{queryError}</span>
        {:else if matchCount === 0 && query}
          0 results
        {:else if matchCount > 0}
          {currentMatchIndex} of {matchCount}{matchCount === MATCH_COUNT_CAP ? '+' : ''}
        {/if}
      </span>
      <div class="toggles" role="group" aria-label="Find options">
        <button
          type="button"
          class:active={caseSensitive}
          title="Match Case (Alt+C)"
          onclick={() => (caseSensitive = !caseSensitive)}
          aria-pressed={caseSensitive}>Aa</button
        >
        <button
          type="button"
          class:active={wholeWord}
          title="Match Whole Word (Alt+W)"
          onclick={() => (wholeWord = !wholeWord)}
          aria-pressed={wholeWord}>ab</button
        >
        <button
          type="button"
          class:active={regexp}
          title="Use Regular Expression (Alt+R)"
          onclick={() => (regexp = !regexp)}
          aria-pressed={regexp}>.*</button
        >
        <button
          type="button"
          class:active={inSelection}
          title="Find in selection (Alt+L)"
          onclick={toggleInSelection}
          aria-pressed={inSelection}>⎘</button
        >
      </div>
      <div class="nav">
        <button
          type="button"
          title="Previous (Shift+Enter)"
          onclick={() => void prev()}
          aria-label="Previous match">↑</button
        >
        <button
          type="button"
          title="Next (Enter)"
          onclick={() => void next()}
          aria-label="Next match">↓</button
        >
        <button
          type="button"
          title={replaceMode ? 'Hide Replace' : 'Toggle Replace (Cmd+Alt+F)'}
          onclick={() => (replaceMode = !replaceMode)}
          aria-pressed={replaceMode}
          aria-label="Toggle replace">⇄</button
        >
        <button type="button" title="Close (Esc)" onclick={close} aria-label="Close find widget"
          >✕</button
        >
      </div>
    </div>
    {#if replaceMode}
      <div class="replace-row">
        <input
          bind:this={replaceInputEl}
          bind:value={replace}
          type="text"
          class="find-input"
          placeholder="Replace"
          spellcheck="false"
          aria-label="Replace"
        />
        <div class="nav">
          <button type="button" title="Replace next" onclick={() => void doReplaceNext()}>
            Replace
          </button>
          <button type="button" title="Replace all" onclick={() => void doReplaceAll()}>
            All
          </button>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .find-widget {
    position: absolute;
    top: 6px;
    right: 14px;
    z-index: 20;
    background: var(--bg-primary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    padding: 6px 8px;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
    font-family: var(--font-family-sans, system-ui, sans-serif);
    font-size: 12px;
    min-width: 380px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .find-row,
  .replace-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .find-input {
    flex: 1;
    background: var(--bg-secondary);
    color: var(--text-primary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    padding: 3px 6px;
    font: inherit;
    font-family: var(--font-family-mono, ui-monospace, monospace);
    font-size: 11px;
    min-width: 0;
  }
  .find-input.error {
    border-color: var(--accent-error, #ef4444);
  }
  .counter {
    color: var(--text-tertiary);
    font-size: 10px;
    min-width: 56px;
    text-align: right;
    white-space: nowrap;
  }
  .counter-error {
    color: var(--accent-error, #ef4444);
  }
  .toggles,
  .nav {
    display: flex;
    gap: 2px;
  }
  .toggles button,
  .nav button {
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid transparent;
    border-radius: 3px;
    padding: 2px 6px;
    font: inherit;
    font-size: 11px;
    cursor: pointer;
    line-height: 1;
  }
  .toggles button:hover,
  .nav button:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .toggles button.active {
    background: var(--accent-primary);
    border-color: var(--accent-primary);
    color: #fff;
  }
</style>
