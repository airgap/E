<script lang="ts">
  import { api } from '$lib/api/client';
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { workspaceListStore } from '$lib/stores/projects.svelte';
  import { primaryPaneStore } from '$lib/stores/primaryPane.svelte';
  import { gitStore } from '$lib/stores/git.svelte';

  function detectLanguage(fileName: string): string {
    const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
    const map: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      py: 'python',
      rs: 'rust',
      go: 'go',
      java: 'java',
      c: 'cpp',
      cpp: 'cpp',
      css: 'css',
      scss: 'css',
      html: 'html',
      svelte: 'html',
      vue: 'html',
      json: 'json',
      md: 'markdown',
      sql: 'sql',
      sh: 'shell',
      yaml: 'yaml',
      yml: 'yaml',
      toml: 'toml',
      txt: 'text',
    };
    return map[ext] || 'text';
  }

  async function openFile(filePath: string) {
    try {
      const res = await api.files.read(filePath);
      const fileName = filePath.split('/').pop() ?? filePath;
      primaryPaneStore.openFileTab(filePath, res.data.content, detectLanguage(fileName));
    } catch (e) {
      // Silently ignore — file may be binary or inaccessible
    }
  }

  interface TreeNode {
    name: string;
    path: string;
    type: 'file' | 'directory';
    children?: TreeNode[];
  }

  let tree = $state<TreeNode[]>([]);
  let expandedDirs = $state<Set<string>>(new Set());
  let loadingDirs = $state<Set<string>>(new Set());
  let loading = $state(false);
  let currentPath = $state('');

  // Reactively reload when active conversation or workspace changes
  $effect(() => {
    const path =
      workspaceListStore.activeWorkspace?.path ||
      conversationStore.active?.workspacePath ||
      settingsStore.workspacePath ||
      '.';
    if (path !== currentPath) {
      currentPath = path;
      loadTree(path);
      // NOTE: Git polling is managed centrally by workspace.svelte.ts.
      // Do NOT call gitStore.startPolling() here — it creates duplicate polls.
    }
  });

  async function loadTree(path: string) {
    loading = true;
    tree = [];
    expandedDirs = new Set();
    loadingDirs = new Set();
    try {
      const res = await api.files.tree(path, 2);
      tree = res.data;
    } catch {}
    loading = false;
  }

  /** Find a node in the tree by its path and update it in-place */
  function updateNodeChildren(
    nodes: TreeNode[],
    targetPath: string,
    children: TreeNode[],
  ): boolean {
    for (const node of nodes) {
      if (node.path === targetPath) {
        node.children = children;
        return true;
      }
      if (node.children && updateNodeChildren(node.children, targetPath, children)) {
        return true;
      }
    }
    return false;
  }

  async function toggleDir(dirPath: string) {
    const next = new Set(expandedDirs);
    if (next.has(dirPath)) {
      next.delete(dirPath);
      expandedDirs = next;
      return;
    }

    next.add(dirPath);
    expandedDirs = next;

    // Check if this directory's children need to be lazy-loaded.
    // A directory at the depth boundary will exist as a node with an empty children array.
    const node = findNode(tree, dirPath);
    if (node && node.type === 'directory' && (!node.children || node.children.length === 0)) {
      // Lazy-load this directory's contents
      const nextLoading = new Set(loadingDirs);
      nextLoading.add(dirPath);
      loadingDirs = nextLoading;
      try {
        const res = await api.files.tree(dirPath, 1);
        updateNodeChildren(tree, dirPath, res.data);
        tree = [...tree]; // trigger reactivity
      } catch {}
      const doneLoading = new Set(loadingDirs);
      doneLoading.delete(dirPath);
      loadingDirs = doneLoading;
    }
  }

  function findNode(nodes: TreeNode[], targetPath: string): TreeNode | undefined {
    for (const node of nodes) {
      if (node.path === targetPath) return node;
      if (node.children) {
        const found = findNode(node.children, targetPath);
        if (found) return found;
      }
    }
    return undefined;
  }

  function getIcon(node: TreeNode): string {
    if (node.type === 'directory')
      return expandedDirs.has(node.path)
        ? 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z'
        : 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z';
    return 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z';
  }
</script>

<div class="file-tree">
  <div class="tree-header">
    <h3>Files</h3>
    {#if currentPath && currentPath !== '.'}
      <span class="tree-path" title={currentPath}
        >{currentPath.split('/').pop() || currentPath}</span
      >
    {/if}
  </div>

  {#if loading}
    <div class="loading">Loading...</div>
  {:else}
    <div class="tree-items">
      {#each tree as node}
        {@render treeNode(node, 0)}
      {/each}
    </div>
  {/if}
</div>

{#snippet treeNode(node: TreeNode, depth: number)}
  <button
    class="tree-item"
    class:directory={node.type === 'directory'}
    style:padding-left="{8 + depth * 16}px"
    draggable="true"
    ondragstart={(e) => {
      if (e.dataTransfer) {
        e.dataTransfer.setData('text/terminal-path', node.path);
        e.dataTransfer.setData('text/plain', node.path);
        e.dataTransfer.effectAllowed = 'copy';
      }
    }}
    onclick={() => {
      if (node.type === 'directory') {
        toggleDir(node.path);
      } else {
        openFile(node.path);
      }
    }}
    ondblclick={() => {
      if (node.type === 'file') {
        openFile(node.path);
      }
    }}
  >
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <path d={getIcon(node)} />
    </svg>
    <span class="node-name truncate">{node.name}</span>
    {#if node.type === 'file'}
      {@const gitStatus = gitStore.getStatus(node.path)}
      {#if gitStatus}
        <span class="git-badge git-{gitStatus.toLowerCase()}">{gitStatus}</span>
      {/if}
    {/if}
  </button>

  {#if node.type === 'directory' && expandedDirs.has(node.path)}
    {#if loadingDirs.has(node.path)}
      <div class="tree-loading" style:padding-left="{8 + (depth + 1) * 16}px">Loading…</div>
    {:else if node.children}
      {#each node.children as child}
        {@render treeNode(child, depth + 1)}
      {/each}
    {/if}
  {/if}
{/snippet}

<style>
  .file-tree {
    padding: 8px;
  }
  .tree-header {
    padding: 4px 4px 8px;
  }
  .tree-header h3 {
    font-size: var(--fs-base);
    font-weight: 600;
    margin: 0;
  }
  .tree-path {
    display: block;
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tree-items {
    overflow-y: auto;
  }

  .tree-item {
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
  .tree-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .tree-item.directory {
    color: var(--text-primary);
  }

  .node-name {
    flex: 1;
    min-width: 0;
  }

  .git-badge {
    flex-shrink: 0;
    font-size: var(--fs-xxs);
    font-weight: 700;
    width: 14px;
    text-align: center;
    line-height: 14px;
    border-radius: 2px;
    font-family: var(--font-family-mono, monospace);
  }
  .git-m {
    color: #e2b93d;
  }
  .git-a {
    color: #73c991;
  }
  .git-d {
    color: #f44747;
  }
  .git-u {
    color: #888;
  }
  .git-r {
    color: #73c991;
  }

  .loading,
  .tree-loading {
    padding: 20px;
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--fs-sm);
  }
  .tree-loading {
    padding: 3px 8px;
    text-align: left;
  }
</style>
