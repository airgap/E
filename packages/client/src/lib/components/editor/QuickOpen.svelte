<script lang="ts">
  import { uiStore } from '$lib/stores/ui.svelte';
  import { editorStore } from '$lib/stores/editor.svelte';
  import { api } from '$lib/api/client';
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';

  interface FileEntry {
    name: string;
    path: string;
    relativePath: string;
    type: 'file' | 'directory';
    children?: FileEntry[];
  }

  let query = $state('');
  let results = $state<FileEntry[]>([]);
  let selectedIndex = $state(0);
  let allFiles = $state<FileEntry[]>([]);
  let input: HTMLInputElement;

  function flattenTree(entries: FileEntry[]): FileEntry[] {
    const flat: FileEntry[] = [];
    function walk(items: FileEntry[]) {
      for (const item of items) {
        if (item.type === 'file') flat.push(item);
        if (item.children) walk(item.children);
      }
    }
    walk(entries);
    return flat;
  }

  function fuzzyMatch(query: string, text: string): boolean {
    const q = query.toLowerCase();
    const t = text.toLowerCase();
    let qi = 0;
    for (let ti = 0; ti < t.length && qi < q.length; ti++) {
      if (t[ti] === q[qi]) qi++;
    }
    return qi === q.length;
  }

  function fuzzyScore(query: string, text: string): number {
    const q = query.toLowerCase();
    const t = text.toLowerCase();
    let score = 0;
    let qi = 0;
    let lastMatch = -1;
    for (let ti = 0; ti < t.length && qi < q.length; ti++) {
      if (t[ti] === q[qi]) {
        score += 1;
        // Bonus for consecutive matches
        if (lastMatch === ti - 1) score += 2;
        // Bonus for matching at start or after separator
        if (ti === 0 || t[ti - 1] === '/' || t[ti - 1] === '.') score += 3;
        lastMatch = ti;
        qi++;
      }
    }
    return qi === q.length ? score : -1;
  }

  $effect(() => {
    if (uiStore.activeModal === 'quick-open') {
      loadFiles();
      setTimeout(() => input?.focus(), 50);
    }
  });

  $effect(() => {
    if (query.trim()) {
      const scored = allFiles
        .map((f) => ({ file: f, score: fuzzyScore(query, f.relativePath || f.name) }))
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score);
      results = scored.slice(0, 50).map((s) => s.file);
    } else {
      // Show recently-opened or all files
      results = allFiles.slice(0, 50);
    }
    selectedIndex = 0;
  });

  async function loadFiles() {
    const path = conversationStore.active?.workspacePath || settingsStore.workspacePath || '.';
    try {
      const res = await api.files.tree(path, 6);
      allFiles = flattenTree(res.data);
    } catch {
      allFiles = [];
    }
  }

  function openSelected() {
    if (results.length === 0) return;
    const file = results[selectedIndex];
    if (file) {
      editorStore.openFile(file.path, false);
      close();
    }
  }

  function close() {
    query = '';
    uiStore.closeModal();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, results.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      openSelected();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }
</script>

{#if uiStore.activeModal === 'quick-open'}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="quick-open-overlay" onclick={close} onkeydown={handleKeydown}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="quick-open" onclick={(e) => e.stopPropagation()}>
      <input
        bind:this={input}
        bind:value={query}
        class="quick-open-input"
        placeholder="Search files..."
        onkeydown={handleKeydown}
      />
      <div class="quick-open-results">
        {#each results as file, i (file.path)}
          <button
            class="result-item"
            class:selected={i === selectedIndex}
            onclick={() => {
              selectedIndex = i;
              openSelected();
            }}
            onmouseenter={() => (selectedIndex = i)}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            </svg>
            <span class="result-name">{file.name}</span>
            <span class="result-path">{file.relativePath || file.path}</span>
          </button>
        {/each}
        {#if results.length === 0 && query}
          <div class="no-results">No files match "{query}"</div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .quick-open-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    justify-content: center;
    padding-top: 15vh;
    z-index: 100;
  }

  .quick-open {
    width: 520px;
    max-height: 420px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .quick-open-input {
    width: 100%;
    padding: 12px 16px;
    font-size: var(--fs-md);
    font-family: var(--font-family);
    background: var(--bg-input);
    border: none;
    border-bottom: 1px solid var(--border-primary);
    color: var(--text-primary);
    outline: none;
  }
  .quick-open-input::placeholder {
    color: var(--text-tertiary);
  }

  .quick-open-results {
    flex: 1;
    overflow-y: auto;
    padding: 4px;
  }

  .result-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 12px;
    font-size: var(--fs-base);
    color: var(--text-secondary);
    text-align: left;
    border-radius: var(--radius-sm);
    transition: background var(--transition);
  }
  .result-item:hover,
  .result-item.selected {
    background: var(--bg-active);
    color: var(--text-primary);
  }

  .result-name {
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
  }

  .result-path {
    flex: 1;
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: right;
  }

  .no-results {
    padding: 20px;
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--fs-base);
  }
</style>
