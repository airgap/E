<script lang="ts">
  import { api } from '$lib/api/client';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { onMount } from 'svelte';

  interface TreeNode {
    name: string;
    path: string;
    type: 'file' | 'directory';
    children?: TreeNode[];
  }

  let { onSelect, onClose } = $props<{
    onSelect: (path: string) => void;
    onClose: () => void;
  }>();

  let searchQuery = $state('');
  let searchResults = $state<{ file: string; relativePath: string }[]>([]);
  let treeNodes = $state<TreeNode[]>([]);
  let loading = $state(false);
  let selectedIndex = $state(0);
  let searchTimeout = $state<ReturnType<typeof setTimeout> | null>(null);
  let searchInput = $state<HTMLInputElement>();

  const workspacePath = $derived(settingsStore.workspacePath || '');

  onMount(async () => {
    searchInput?.focus();
    await loadTree();
  });

  async function loadTree() {
    if (!workspacePath) return;
    loading = true;
    try {
      const res = await api.files.tree(workspacePath, 2);
      treeNodes = (res.data as TreeNode[]) || [];
    } catch {
      treeNodes = [];
    } finally {
      loading = false;
    }
  }

  async function doSearch(q: string) {
    if (!q.trim() || !workspacePath) {
      searchResults = [];
      return;
    }
    loading = true;
    try {
      const res = await api.search.query(q, workspacePath, false, 30);
      // Deduplicate by file path
      const seen = new Set<string>();
      searchResults = [];
      for (const r of res.data.results) {
        if (!seen.has(r.file)) {
          seen.add(r.file);
          searchResults.push({ file: r.file, relativePath: r.relativePath });
        }
      }
    } catch {
      searchResults = [];
    } finally {
      loading = false;
    }
    selectedIndex = 0;
  }

  function handleSearchInput() {
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => doSearch(searchQuery), 250);
    selectedIndex = 0;
  }

  function flattenTree(nodes: TreeNode[], depth = 0): { node: TreeNode; depth: number }[] {
    const result: { node: TreeNode; depth: number }[] = [];
    for (const node of nodes) {
      result.push({ node, depth });
      if (node.type === 'directory' && node.children) {
        result.push(...flattenTree(node.children, depth + 1));
      }
    }
    return result;
  }

  let displayItems = $derived(
    searchQuery.trim()
      ? searchResults.map((r) => ({ label: r.relativePath, path: r.file, isDir: false, depth: 0 }))
      : flattenTree(treeNodes).map(({ node, depth }) => ({
          label: node.name,
          path: node.path,
          isDir: node.type === 'directory',
          depth,
        })),
  );

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, displayItems.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
    } else if (e.key === 'Enter' && displayItems[selectedIndex]) {
      e.preventDefault();
      const item = displayItems[selectedIndex];
      if (!item.isDir) onSelect(item.path);
    } else if (e.key === 'Escape') {
      onClose();
    }
  }

  function selectItem(path: string, isDir: boolean) {
    if (!isDir) onSelect(path);
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="file-picker" onclick={(e) => e.stopPropagation()}>
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
        stroke-linejoin="round"
        ><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path
          d="M14 2v6h6"
        /></svg
      > Select File</span
    >
    <button class="picker-close" onclick={onClose}>×</button>
  </div>
  <div class="search-wrap">
    <input
      bind:this={searchInput}
      bind:value={searchQuery}
      oninput={handleSearchInput}
      placeholder="Search files..."
      class="search-input"
    />
  </div>
  <div class="picker-list">
    {#if loading}
      <div class="picker-loading">Loading...</div>
    {:else if displayItems.length === 0}
      <div class="picker-empty">No files found</div>
    {:else}
      {#each displayItems as item, i}
        <button
          class="picker-item"
          class:selected={i === selectedIndex}
          class:is-dir={item.isDir}
          style="padding-left: {12 + item.depth * 14}px"
          onclick={() => selectItem(item.path, item.isDir)}
          onmouseenter={() => (selectedIndex = i)}
          disabled={item.isDir}
        >
          <span class="item-icon"
            >{#if item.isDir}<svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                ><path
                  d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
                /></svg
              >{:else}<svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                ><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path
                  d="M14 2v6h6"
                /></svg
              >{/if}</span
          >
          <span class="item-label">{item.label}</span>
        </button>
      {/each}
    {/if}
  </div>
</div>

<style>
  .file-picker {
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

  .picker-loading,
  .picker-empty {
    padding: 12px;
    color: var(--text-tertiary);
    font-size: var(--fs-sm);
    text-align: center;
  }

  .picker-item {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 5px 12px;
    border-radius: var(--radius-sm);
    text-align: left;
    font-size: var(--fs-sm);
    transition: background var(--transition);
    color: var(--text-secondary);
  }
  .picker-item:hover:not(:disabled),
  .picker-item.selected:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .picker-item.is-dir {
    color: var(--text-tertiary);
    cursor: default;
    opacity: 0.7;
  }

  .item-icon {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    color: var(--text-tertiary);
  }

  .item-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
