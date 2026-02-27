<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { terminalConnectionManager } from '$lib/services/terminal-connection';
  import { terminalStore } from '$lib/stores/terminal.svelte';

  let { sessionId } = $props<{ sessionId: string }>();

  let query = $state('');
  let useRegex = $state(false);
  let caseSensitive = $state(false);
  let resultIndex = $state(-1);
  let resultCount = $state(0);
  let inputEl: HTMLInputElement | undefined = $state(undefined);

  /** Decoration colors for search highlights */
  const DECORATIONS = {
    matchBackground: '#e8a10030',
    matchBorder: '#e8a10000',
    matchOverviewRuler: '#e8a100',
    activeMatchBackground: '#e8a100aa',
    activeMatchBorder: '#e8a100',
    activeMatchColorOverviewRuler: '#e8a100',
  } as const;

  let unsubResults: (() => void) | undefined;

  onMount(() => {
    // Focus input on mount
    requestAnimationFrame(() => {
      inputEl?.focus();
    });

    // Listen for search result changes
    unsubResults = terminalConnectionManager.onSearchResults(sessionId, (results) => {
      resultIndex = results.resultIndex;
      resultCount = results.resultCount;
    });
  });

  onDestroy(() => {
    unsubResults?.();
    terminalConnectionManager.clearSearch(sessionId);
  });

  function doSearch(direction: 'next' | 'previous' = 'next') {
    if (!query) {
      terminalConnectionManager.clearSearch(sessionId);
      resultIndex = -1;
      resultCount = 0;
      return;
    }
    const opts = {
      regex: useRegex,
      caseSensitive,
      decorations: DECORATIONS,
    };
    if (direction === 'next') {
      terminalConnectionManager.search(sessionId, query, opts);
    } else {
      terminalConnectionManager.searchPrevious(sessionId, query, opts);
    }
  }

  function findNext() {
    if (!query) return;
    doSearch('next');
  }

  function findPrevious() {
    if (!query) return;
    doSearch('previous');
  }

  function close() {
    terminalStore.closeSearchForSession(sessionId);
    terminalConnectionManager.clearSearch(sessionId);
    terminalConnectionManager.focus(sessionId);
  }

  function onInputChange() {
    doSearch('previous');
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      findNext();
    } else if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      findPrevious();
    } else if (e.key === 'ArrowDown' && !e.shiftKey) {
      e.preventDefault();
      findNext();
    } else if (e.key === 'ArrowUp' && !e.shiftKey) {
      e.preventDefault();
      findPrevious();
    } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
      // Toggle close when pressing the open shortcut again
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }

  function toggleRegex() {
    useRegex = !useRegex;
    if (query) doSearch('previous');
  }

  function toggleCaseSensitive() {
    caseSensitive = !caseSensitive;
    if (query) doSearch('previous');
  }

  /** Formatted match count display */
  const matchDisplay = $derived(
    query ? (resultCount > 0 ? `${resultIndex + 1} of ${resultCount}` : 'No results') : '',
  );

  /** Announce search results count to screen readers via the store's aria-live region */
  $effect(() => {
    if (!query) return;
    if (resultCount > 0) {
      terminalStore.announce(
        `${resultCount} result${resultCount === 1 ? '' : 's'} found, showing result ${resultIndex + 1} of ${resultCount}`,
      );
    } else {
      terminalStore.announce('No results found');
    }
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="terminal-search-bar" onkeydown={onKeydown} role="search" aria-label="Find in terminal">
  <div class="search-icon">
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  </div>

  <input
    type="text"
    bind:this={inputEl}
    bind:value={query}
    oninput={onInputChange}
    placeholder="Find in terminal..."
    class="search-input"
    spellcheck="false"
    autocomplete="off"
    aria-label="Search term"
    aria-describedby="search-match-count-{sessionId}"
  />

  <button
    class="search-toggle"
    class:active={useRegex}
    onclick={toggleRegex}
    title="Use regular expression"
    aria-label="Use regular expression"
    aria-pressed={useRegex}
  >
    .*
  </button>

  <button
    class="search-toggle"
    class:active={caseSensitive}
    onclick={toggleCaseSensitive}
    title="Match case"
    aria-label="Match case"
    aria-pressed={caseSensitive}
  >
    Aa
  </button>

  <span
    class="match-count"
    class:no-results={query && resultCount === 0}
    id="search-match-count-{sessionId}"
    role="status"
    aria-live="polite"
    aria-atomic="true"
  >
    {matchDisplay}
  </span>

  <button
    class="search-nav-btn"
    onclick={findPrevious}
    disabled={!query || resultCount === 0}
    title="Previous match (Shift+Enter)"
    aria-label="Previous match"
  >
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
    >
      <polyline points="18 15 12 9 6 15" />
    </svg>
  </button>

  <button
    class="search-nav-btn"
    onclick={findNext}
    disabled={!query || resultCount === 0}
    title="Next match (Enter)"
    aria-label="Next match"
  >
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  </button>

  <button
    class="search-close-btn"
    onclick={close}
    title="Close search (Escape)"
    aria-label="Close search"
  >
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
    >
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  </button>
</div>

<style>
  .terminal-search-bar {
    position: absolute;
    top: 4px;
    right: 16px;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 3px 6px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
    font-size: var(--fs-xs);
    max-width: calc(100% - 32px);
  }

  .search-icon {
    display: flex;
    align-items: center;
    color: var(--text-tertiary);
    flex-shrink: 0;
    margin-right: 2px;
  }

  .search-input {
    flex: 1;
    min-width: 100px;
    max-width: 200px;
    height: 22px;
    padding: 0 6px;
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    background: var(--bg-primary);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    outline: none;
    transition: border-color var(--transition);
  }
  .search-input:focus {
    border-color: var(--accent-primary);
  }
  .search-input::placeholder {
    color: var(--text-quaternary, var(--text-tertiary));
    opacity: 0.6;
  }

  .search-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 24px;
    height: 22px;
    padding: 0 4px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-tertiary);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    font-weight: 600;
    cursor: pointer;
    transition:
      color var(--transition),
      background var(--transition),
      border-color var(--transition);
    flex-shrink: 0;
  }
  .search-toggle:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }
  .search-toggle.active {
    color: var(--accent-primary);
    background: var(--bg-active);
    border-color: var(--accent-primary);
  }
  .search-toggle:focus-visible,
  .search-nav-btn:focus-visible,
  .search-close-btn:focus-visible {
    outline: 2px solid var(--border-focus);
    outline-offset: -1px;
  }

  .match-count {
    min-width: 56px;
    text-align: center;
    color: var(--text-secondary);
    font-size: var(--fs-sans-xs);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    flex-shrink: 0;
    padding: 0 4px;
  }
  .match-count.no-results {
    color: var(--accent-error, #ff4444);
  }

  .search-nav-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    transition:
      color var(--transition),
      background var(--transition);
    padding: 0;
    flex-shrink: 0;
  }
  .search-nav-btn:hover:not(:disabled) {
    color: var(--text-primary);
    background: var(--bg-hover);
  }
  .search-nav-btn:disabled {
    opacity: 0.3;
    cursor: default;
  }

  .search-close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    transition:
      color var(--transition),
      background var(--transition);
    padding: 0;
    margin-left: 2px;
    flex-shrink: 0;
  }
  .search-close-btn:hover {
    color: var(--accent-error, #ff4444);
    background: var(--bg-hover);
  }
</style>
