<script lang="ts">
  import { searchStore } from '$lib/stores/search.svelte';
  import { api } from '$lib/api/client';
  import { primaryPaneStore } from '$lib/stores/primaryPane.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { workspaceListStore } from '$lib/stores/projects.svelte';
  import { detectLanguage } from '$lib/utils/detect-language';

  let searchInput: HTMLInputElement;
  let debounceTimer: ReturnType<typeof setTimeout>;
  let collapsedFiles = $state<Set<string>>(new Set());
  let showReplace = $state(false);
  let replaceText = $state('');
  let replacing = $state(false);
  let replaceResult = $state<{ count: number; files: number } | null>(null);
  let expandedMatches = $state<Set<string>>(new Set());
  /** Two-phase replace-all: first a dry-run shows impact, then confirm. */
  let previewImpact = $state<{ count: number; files: number } | null>(null);

  function toggleContext(key: string) {
    const next = new Set(expandedMatches);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    expandedMatches = next;
  }

  function replaceOpts() {
    return {
      isRegex: searchStore.isRegex,
      caseSensitive: searchStore.caseSensitive,
      wholeWord: searchStore.wholeWord,
    };
  }

  async function handleReplaceInFile(filePath: string) {
    if (!searchStore.query || replaceText === undefined) return;
    replacing = true;
    replaceResult = null;
    try {
      const res = await api.search.replace(
        searchStore.query,
        replaceText,
        [filePath],
        getRootPath(),
        replaceOpts(),
      );
      if (res.ok) {
        replaceResult = { count: res.data.replacedCount, files: res.data.filesModified };
        // Re-search to update results
        searchStore.search(getRootPath());
      }
    } catch {
      // Silent
    } finally {
      replacing = false;
    }
  }

  /**
   * Two-phase replace-all:
   *   1. First click → dryRun request, show impact summary, await confirmation.
   *   2. Second click → actual write.
   * This stops accidental mass-rewrites by giving the user a clear "commit" step.
   */
  async function handleReplaceAll() {
    if (!searchStore.query || replaceText === undefined) return;
    const allFiles = [...new Set(searchStore.results.map((r) => r.file))];
    if (allFiles.length === 0) return;

    replacing = true;
    replaceResult = null;
    try {
      if (!previewImpact) {
        // Phase 1 — dry run, display impact
        const res = await api.search.replace(
          searchStore.query,
          replaceText,
          allFiles,
          getRootPath(),
          { ...replaceOpts(), dryRun: true },
        );
        if (res.ok) {
          previewImpact = { count: res.data.replacedCount, files: res.data.filesModified };
        }
      } else {
        // Phase 2 — confirmed, actually write
        const res = await api.search.replace(
          searchStore.query,
          replaceText,
          allFiles,
          getRootPath(),
          replaceOpts(),
        );
        if (res.ok) {
          replaceResult = { count: res.data.replacedCount, files: res.data.filesModified };
          previewImpact = null;
          searchStore.search(getRootPath());
        }
      }
    } catch {
      // Silent
    } finally {
      replacing = false;
    }
  }

  function cancelPreview() {
    previewImpact = null;
  }

  /** When any query/toggle changes, invalidate the pending preview — it's no longer accurate. */
  $effect(() => {
    // Track dependencies so the effect reruns on change.
    void searchStore.query;
    void searchStore.isRegex;
    void searchStore.caseSensitive;
    void searchStore.wholeWord;
    void replaceText;
    previewImpact = null;
  });

  function getRootPath(): string {
    return (
      workspaceListStore.activeWorkspace?.path ||
      conversationStore.active?.workspacePath ||
      settingsStore.workspacePath ||
      '.'
    );
  }

  function onInput(e: Event) {
    const value = (e.target as HTMLInputElement).value;
    searchStore.setQuery(value);
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      searchStore.search(getRootPath());
    }, 300);
  }

  function toggleRegex() {
    searchStore.setIsRegex(!searchStore.isRegex);
    if (searchStore.query) {
      searchStore.search(getRootPath());
    }
  }

  function toggleCaseSensitive() {
    searchStore.setCaseSensitive(!searchStore.caseSensitive);
    if (searchStore.query) searchStore.search(getRootPath());
  }

  function toggleWholeWord() {
    searchStore.setWholeWord(!searchStore.wholeWord);
    if (searchStore.query) searchStore.search(getRootPath());
  }

  function toggleFile(path: string) {
    const next = new Set(collapsedFiles);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    collapsedFiles = next;
  }

  async function openMatch(file: string, _line: number) {
    try {
      const res = await api.files.read(file);
      const fileName = file.split('/').pop() ?? file;
      primaryPaneStore.openFileTab(file, res.data.content, detectLanguage(fileName));
    } catch {
      // Silently ignore unreadable files
    }
  }

  function highlightContent(content: string, matchStart: number, matchEnd: number): string {
    const before = content.slice(0, matchStart).replace(/</g, '&lt;');
    const match = content.slice(matchStart, matchEnd).replace(/</g, '&lt;');
    const after = content.slice(matchEnd).replace(/</g, '&lt;');
    return `${before}<mark>${match}</mark>${after}`;
  }
</script>

<div class="search-panel">
  <div class="search-input-row">
    <input
      bind:this={searchInput}
      type="text"
      class="search-input"
      placeholder="Search files..."
      value={searchStore.query}
      oninput={onInput}
      onkeydown={(e) => {
        if (e.key === 'Enter') {
          clearTimeout(debounceTimer);
          searchStore.search(getRootPath());
        }
      }}
    />
    <button
      class="regex-toggle"
      class:active={searchStore.caseSensitive}
      onclick={toggleCaseSensitive}
      title="Match case">Aa</button
    >
    <button
      class="regex-toggle"
      class:active={searchStore.wholeWord}
      onclick={toggleWholeWord}
      title="Match whole word">ab|</button
    >
    <button
      class="regex-toggle"
      class:active={searchStore.isRegex}
      onclick={toggleRegex}
      title="Use regex">.*</button
    >
    <button
      class="replace-toggle"
      class:active={showReplace}
      onclick={() => (showReplace = !showReplace)}
      title="Toggle find & replace"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M11 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6" />
        <path d="M21 3l-9 9" />
        <path d="M15 3h6v6" />
      </svg>
    </button>
  </div>

  {#if showReplace}
    <div class="replace-row">
      <input
        type="text"
        class="search-input replace-input"
        placeholder="Replace with..."
        bind:value={replaceText}
      />
      <button
        class="replace-all-btn"
        class:confirm={previewImpact !== null}
        onclick={handleReplaceAll}
        disabled={replacing || !searchStore.query || searchStore.results.length === 0}
        title={previewImpact ? 'Confirm — write changes' : 'Preview replace all'}
      >
        {#if replacing}
          …
        {:else if previewImpact}
          Confirm
        {:else}
          All
        {/if}
      </button>
    </div>
    {#if previewImpact}
      <div class="replace-preview">
        About to replace <strong>{previewImpact.count}</strong> occurrence{previewImpact.count !== 1
          ? 's'
          : ''}
        across <strong>{previewImpact.files}</strong> file{previewImpact.files !== 1 ? 's' : ''}.
        <button class="link-btn" onclick={cancelPreview}>Cancel</button>
      </div>
    {/if}
    {#if replaceResult}
      <div class="replace-result">
        Replaced {replaceResult.count} occurrence{replaceResult.count !== 1 ? 's' : ''} in {replaceResult.files}
        file{replaceResult.files !== 1 ? 's' : ''}
      </div>
    {/if}
  {/if}

  {#if searchStore.loading}
    <div class="search-status">Searching...</div>
  {:else if searchStore.error}
    <div class="search-status error">{searchStore.error}</div>
  {:else if searchStore.query && searchStore.results.length === 0}
    <div class="search-status">No results found</div>
  {:else if searchStore.results.length > 0}
    <div class="search-summary">
      {searchStore.totalMatches} match{searchStore.totalMatches !== 1 ? 'es' : ''} in {searchStore.fileCount}
      file{searchStore.fileCount !== 1 ? 's' : ''}
      {#if searchStore.truncated}<span class="truncated">(truncated)</span>{/if}
    </div>

    <div class="search-results">
      {#each [...searchStore.groupedResults()] as [filePath, matches]}
        <div class="file-group">
          <div class="file-header-row">
            <button class="file-header" onclick={() => toggleFile(filePath)}>
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                {#if collapsedFiles.has(filePath)}
                  <path d="M9 18l6-6-6-6" />
                {:else}
                  <path d="M6 9l6 6 6-6" />
                {/if}
              </svg>
              <span class="file-name">{filePath}</span>
              <span class="match-count">{matches.length}</span>
            </button>
            {#if showReplace}
              <button
                class="replace-file-btn"
                onclick={() => handleReplaceInFile(matches[0].file)}
                disabled={replacing}
                title="Replace in this file"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M11 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6" />
                  <path d="M21 3l-9 9" />
                  <path d="M15 3h6v6" />
                </svg>
              </button>
            {/if}
          </div>

          {#if !collapsedFiles.has(filePath)}
            <div class="file-matches">
              {#each matches as match}
                {@const ctxKey = `${match.file}:${match.line}`}
                <div class="match-wrap">
                  <button
                    class="match-item"
                    onclick={() => openMatch(match.file, match.line)}
                    title="Line {match.line}"
                  >
                    <span class="line-num">{match.line}</span>
                    <span class="match-content"
                      >{@html highlightContent(
                        match.content.trim(),
                        match.matchStart -
                          (match.content.length - match.content.trimStart().length),
                        match.matchEnd - (match.content.length - match.content.trimStart().length),
                      )}</span
                    >
                  </button>
                  {#if match.context && match.context.length > 0}
                    <button
                      class="context-toggle"
                      onclick={() => toggleContext(ctxKey)}
                      title={expandedMatches.has(ctxKey) ? 'Hide context' : 'Show context'}
                    >
                      {expandedMatches.has(ctxKey) ? '−' : '+'}
                    </button>
                  {/if}
                </div>
                {#if expandedMatches.has(ctxKey) && match.context}
                  <div class="context-lines">
                    {#each match.context as ctx}
                      <div class="context-line" class:is-match={ctx.line === match.line}>
                        <span class="line-num ctx-line-num">{ctx.line}</span>
                        <span class="ctx-content">{ctx.content}</span>
                      </div>
                    {/each}
                  </div>
                {/if}
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .search-panel {
    padding: 8px;
  }

  .search-input-row {
    display: flex;
    gap: 4px;
    margin-bottom: 8px;
  }
  .search-input {
    flex: 1;
    font-size: var(--fs-base);
    font-family: var(--font-family);
    padding: 7px 10px;
    background: var(--bg-input);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    outline: none;
    transition:
      border-color var(--transition),
      box-shadow var(--transition);
  }
  .search-input:focus {
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 3px
      color-mix(in oklab, var(--accent-primary, var(--syn-function)) 18%, transparent);
  }

  .regex-toggle {
    font-size: var(--fs-sm);
    font-family: var(--font-family);
    font-weight: 600;
    min-width: 30px;
    padding: 5px 9px;
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all var(--transition);
  }
  .regex-toggle:hover {
    color: var(--text-primary);
    border-color: var(--border-hover, var(--border-primary));
    background: var(--bg-hover);
  }
  .regex-toggle.active {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
    background: color-mix(in oklab, var(--accent-primary, var(--syn-function)) 14%, transparent);
    box-shadow: 0 0 0 1px var(--accent-primary) inset;
  }

  .search-status {
    padding: 12px 8px;
    font-size: var(--fs-base);
    color: var(--text-tertiary);
    text-align: center;
  }
  .search-status.error {
    color: var(--accent-error);
  }

  .search-summary {
    font-size: var(--fs-sm);
    color: var(--text-tertiary);
    padding: 4px 4px 8px;
  }
  .truncated {
    color: var(--accent-warning);
  }

  .search-results {
    overflow-y: auto;
  }

  .file-group {
    margin-bottom: 2px;
  }
  .file-header {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 5px 6px;
    font-size: var(--fs-base);
    font-weight: 600;
    color: var(--text-primary);
    text-align: left;
    border-radius: var(--radius-sm);
    transition: background var(--transition);
  }
  .file-header:hover {
    background: var(--bg-hover);
  }
  .file-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .match-count {
    font-size: var(--fs-xs);
    font-weight: 700;
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--bg-tertiary);
    color: var(--text-tertiary);
  }

  .file-matches {
    padding-left: 8px;
  }
  .match-item {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    width: 100%;
    padding: 3px 6px;
    font-size: var(--fs-sm);
    text-align: left;
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
    transition: background var(--transition);
    font-family: var(--font-family);
  }
  .match-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .line-num {
    flex-shrink: 0;
    color: var(--text-tertiary);
    min-width: 28px;
    text-align: right;
  }
  .match-content {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .match-content :global(mark) {
    background: rgba(255, 170, 0, 0.3);
    color: var(--text-primary);
    border-radius: 1px;
    padding: 0 1px;
  }

  .replace-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 0;
    transition: all var(--transition);
  }

  .replace-toggle svg {
    width: 15px;
    height: 15px;
  }

  .replace-toggle:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .replace-toggle.active {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
    background: color-mix(in oklab, var(--accent-primary, var(--syn-function)) 14%, transparent);
  }

  /* ── Replace row ── */
  .replace-row {
    display: flex;
    gap: 4px;
    margin-bottom: 6px;
  }

  .replace-input {
    flex: 1;
  }

  .replace-all-btn {
    font-size: var(--fs-sm);
    font-weight: 700;
    letter-spacing: 0.02em;
    padding: 6px 14px;
    min-width: 62px;
    border: 1px solid var(--accent-primary);
    border-radius: var(--radius-sm);
    background: var(--accent-primary);
    color: var(--text-on-accent, #000);
    cursor: pointer;
    white-space: nowrap;
    transition: all var(--transition);
    box-shadow: 0 0 0 3px
      color-mix(in oklab, var(--accent-primary, var(--syn-function)) 16%, transparent);
  }

  .replace-all-btn:hover:not(:disabled) {
    filter: brightness(1.08);
    box-shadow: 0 0 0 3px
      color-mix(in oklab, var(--accent-primary, var(--syn-function)) 28%, transparent);
  }

  .replace-all-btn:active:not(:disabled) {
    filter: brightness(0.95);
  }

  .replace-all-btn:disabled {
    opacity: 0.45;
    cursor: default;
    box-shadow: none;
  }

  .replace-result {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--accent-success, #22c55e);
    padding: 4px 4px 8px;
  }

  .replace-all-btn.confirm {
    background: var(--accent-warning, #e6a817);
    border-color: var(--accent-warning, #e6a817);
    color: #000;
    box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent-warning, #e6a817) 22%, transparent);
  }

  .replace-preview {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    padding: 8px 10px;
    margin: 0 0 8px;
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    background: var(--bg-active);
    border: 1px solid var(--accent-warning, #e6a817);
    border-radius: var(--radius-sm);
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--accent-warning, #e6a817) 18%, transparent);
  }
  .replace-preview strong {
    color: var(--text-primary);
  }

  .link-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    font-size: var(--fs-sm);
    font-weight: 600;
    cursor: pointer;
    padding: 2px 6px;
    margin-left: auto;
    border-radius: var(--radius-sm);
    transition: all var(--transition);
  }
  .link-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  /* ── File header row with replace-in-file ── */
  .file-header-row {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .replace-file-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: none;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    border-radius: var(--radius-sm);
    padding: 0;
    opacity: 0;
    transition: all var(--transition);
  }

  .file-header-row:hover .replace-file-btn {
    opacity: 1;
  }

  .replace-file-btn:hover {
    color: var(--accent-primary);
    background: color-mix(in oklab, var(--accent-primary, var(--syn-function)) 14%, transparent);
  }

  .replace-file-btn svg {
    width: 14px;
    height: 14px;
  }

  /* ── Match wrap with context toggle ── */
  .match-wrap {
    display: flex;
    align-items: flex-start;
  }

  .match-wrap .match-item {
    flex: 1;
  }

  .context-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border: none;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    font-size: var(--fs-xs);
    font-weight: 700;
    border-radius: var(--radius-sm);
    padding: 0;
    margin-top: 2px;
    opacity: 0;
    transition: opacity var(--transition);
  }

  .match-wrap:hover .context-toggle {
    opacity: 1;
  }

  .context-toggle:hover {
    color: var(--accent-primary);
    background: var(--bg-hover);
  }

  /* ── Context lines ── */
  .context-lines {
    padding-left: 16px;
    margin-bottom: 4px;
    border-left: 2px solid var(--border-secondary);
    margin-left: 12px;
  }

  .context-line {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-family: var(--font-family);
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    padding: 0 4px;
    line-height: 1.5;
  }

  .ctx-line-num {
    flex-shrink: 0;
    min-width: 28px;
    text-align: right;
    opacity: 0.5;
  }

  .ctx-content {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
