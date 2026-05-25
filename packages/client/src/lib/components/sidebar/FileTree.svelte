<script lang="ts">
  import { api } from '$lib/api/client';
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { workspaceListStore } from '$lib/stores/projects.svelte';
  import { primaryPaneStore } from '$lib/stores/primaryPane.svelte';
  import { gitStore } from '$lib/stores/git.svelte';
  import { uiStore } from '$lib/stores/ui.svelte';
  import FileIcon from '$lib/components/icons/FileIcon.svelte';
  import ContextMenu, { type ContextMenuItem } from '$lib/components/ui/ContextMenu.svelte';

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
      scss: 'scss',
      sass: 'sass',
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

  // ── context menu + file operations ──
  const parentOf = (p: string) => p.slice(0, p.lastIndexOf('/')) || currentPath;

  let ctx = $state<{ x: number; y: number; node: TreeNode | null } | null>(null);
  let renamingPath = $state<string | null>(null);
  let renameValue = $state('');
  // A pending new file/folder under `parent`; rendered as an inline input row.
  let creating = $state<{ parent: string; type: 'file' | 'directory' } | null>(null);
  let createValue = $state('');

  /** Reload a directory's children in place; reload the top level when the dir
   *  isn't a node in the tree (e.g. a root-level op). */
  async function refreshDir(dirPath: string) {
    try {
      if (dirPath && dirPath !== currentPath && findNode(tree, dirPath)) {
        const res = await api.files.tree(dirPath, 1);
        updateNodeChildren(tree, dirPath, res.data);
        tree = [...tree];
      } else {
        const res = await api.files.tree(currentPath, 2);
        tree = res.data;
      }
    } catch {
      /* best-effort refresh */
    }
  }

  function ensureExpanded(dirPath: string) {
    if (dirPath && dirPath !== currentPath && !expandedDirs.has(dirPath)) {
      expandedDirs = new Set(expandedDirs).add(dirPath);
    }
  }

  function openMenu(e: MouseEvent, node: TreeNode | null) {
    e.preventDefault();
    e.stopPropagation();
    ctx = { x: e.clientX, y: e.clientY, node };
  }

  // ── rename ──
  function beginRename(node: TreeNode) {
    renamingPath = node.path;
    renameValue = node.name;
  }
  async function commitRename(node: TreeNode) {
    if (renamingPath !== node.path) return; // already committed/cancelled (Enter+blur both fire)
    const name = renameValue.trim();
    renamingPath = null;
    if (!name || name === node.name || name.includes('/')) return;
    const newPath = `${parentOf(node.path)}/${name}`;
    const res = await api.files.rename(node.path, newPath);
    if (!res.ok) {
      uiStore.toast(
        `Rename failed: ${(res as { error?: string }).error ?? 'unknown error'}`,
        'error',
      );
      return;
    }
    if (expandedDirs.has(node.path)) {
      const next = new Set(expandedDirs);
      next.delete(node.path);
      next.add(newPath);
      expandedDirs = next;
    }
    primaryPaneStore.renameFileTab(node.path, newPath);
    await refreshDir(parentOf(node.path));
  }

  // ── create ──
  function beginCreate(parent: string, type: 'file' | 'directory') {
    ensureExpanded(parent);
    creating = { parent, type };
    createValue = '';
  }
  async function commitCreate() {
    const c = creating;
    const name = createValue.trim();
    creating = null;
    if (!c || !name || name.includes('/')) return;
    const path = `${c.parent}/${name}`;
    const res = c.type === 'file' ? await api.files.create(path, '') : await api.files.mkdir(path);
    if (!res.ok) {
      uiStore.toast(
        `Create failed: ${(res as { error?: string }).error ?? 'already exists?'}`,
        'error',
      );
      return;
    }
    await refreshDir(c.parent);
    if (c.type === 'file') openFile(path);
  }

  // ── delete ──
  async function deleteNode(node: TreeNode) {
    const ok = confirm(
      `Delete ${node.type === 'directory' ? 'folder' : 'file'} "${node.name}"?` +
        (node.type === 'directory' ? '\nThis removes everything inside it.' : ''),
    );
    if (!ok) return;
    const res = await api.files.delete(node.path);
    if (!res.ok) {
      uiStore.toast(
        `Delete failed: ${(res as { error?: string }).error ?? 'unknown error'}`,
        'error',
      );
      return;
    }
    primaryPaneStore.closeFileTabByPath(node.path);
    await refreshDir(parentOf(node.path));
  }

  async function copyPath(node: TreeNode) {
    try {
      await navigator.clipboard.writeText(node.path);
      uiStore.toast('Path copied', 'success', 1500);
    } catch {
      uiStore.toast('Copy failed', 'error');
    }
  }

  // Svelte action: focus + select an inline input as soon as it mounts.
  function focusInput(el: HTMLInputElement) {
    el.focus();
    el.select();
  }

  /** Build the menu for a node (or the tree background when node is null). */
  function menuItems(node: TreeNode | null): ContextMenuItem[] {
    const dir =
      node && node.type === 'directory' ? node.path : node ? parentOf(node.path) : currentPath;
    const items: ContextMenuItem[] = [
      { label: 'New File…', action: () => beginCreate(dir, 'file') },
      { label: 'New Folder…', action: () => beginCreate(dir, 'directory') },
    ];
    if (node) {
      items.push(
        { kind: 'separator' },
        { label: 'Rename…', shortcut: 'F2', action: () => beginRename(node) },
        { label: 'Delete', danger: true, action: () => deleteNode(node) },
        { kind: 'separator' },
        { label: 'Copy Path', action: () => copyPath(node) },
      );
    }
    return items;
  }
</script>

<div class="file-tree">
  {#if currentPath && currentPath !== '.'}
    <div class="tree-header">
      <span class="tree-path" title={currentPath}
        >{currentPath.split('/').pop() || currentPath}</span
      >
    </div>
  {/if}

  {#if loading}
    <div class="loading">Loading...</div>
  {:else}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="tree-items" oncontextmenu={(e) => openMenu(e, null)}>
      {#if creating && creating.parent === currentPath}
        {@render createRow(0)}
      {/if}
      {#each tree as node}
        {@render treeNode(node, 0)}
      {/each}
    </div>
  {/if}
</div>

{#snippet treeNode(node: TreeNode, depth: number)}
  {@const gitStatus =
    node.type === 'file' ? gitStore.getStatus(node.path) : gitStore.getDirStatus(node.path)}
  {@const ignored = !gitStatus && gitStore.isIgnored(node.path)}
  {#if renamingPath === node.path}
    <div class="tree-item tree-edit" style:padding-left="{8 + depth * 16}px">
      <FileIcon name={renameValue || node.name} directory={node.type === 'directory'} size={16} />
      <input
        class="tree-input"
        bind:value={renameValue}
        use:focusInput
        onkeydown={(e) => {
          if (e.key === 'Enter') commitRename(node);
          else if (e.key === 'Escape') {
            renameValue = node.name;
            renamingPath = null;
          }
        }}
        onblur={() => commitRename(node)}
      />
    </div>
  {:else}
    <button
      class="tree-item"
      class:directory={node.type === 'directory'}
      class:git-status={!!gitStatus}
      class:ignored
      data-git-status={gitStatus ?? ''}
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
      oncontextmenu={(e) => openMenu(e, node)}
    >
      <FileIcon
        name={node.name}
        directory={node.type === 'directory'}
        open={node.type === 'directory' && expandedDirs.has(node.path)}
        size={16}
      />
      <span class="node-name truncate">{node.name}</span>
      {#if gitStatus}
        <span class="git-badge git-{gitStatus.toLowerCase()}">{gitStatus}</span>
      {/if}
    </button>
  {/if}

  {#if node.type === 'directory' && expandedDirs.has(node.path)}
    {#if creating && creating.parent === node.path}
      {@render createRow(depth + 1)}
    {/if}
    {#if loadingDirs.has(node.path)}
      <div class="tree-loading" style:padding-left="{8 + (depth + 1) * 16}px">Loading…</div>
    {:else if node.children}
      {#each node.children as child}
        {@render treeNode(child, depth + 1)}
      {/each}
    {/if}
  {/if}
{/snippet}

{#snippet createRow(depth: number)}
  <div class="tree-item tree-edit" style:padding-left="{8 + depth * 16}px">
    <FileIcon name={createValue || 'new'} directory={creating?.type === 'directory'} size={16} />
    <input
      class="tree-input"
      placeholder={creating?.type === 'directory' ? 'folder name' : 'file name'}
      bind:value={createValue}
      use:focusInput
      onkeydown={(e) => {
        if (e.key === 'Enter') commitCreate();
        else if (e.key === 'Escape') creating = null;
      }}
      onblur={() => commitCreate()}
    />
  </div>
{/snippet}

{#if ctx}
  <ContextMenu items={menuItems(ctx.node)} x={ctx.x} y={ctx.y} onClose={() => (ctx = null)} />
{/if}

<style>
  .file-tree {
    padding: 8px;
  }
  .tree-header {
    padding: 4px 4px 8px;
  }
  .tree-path {
    display: block;
    font-size: var(--fs-sm);
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
    /* Tracked files and directories alike render at full foreground strength —
       only gitignored entries dim (see .ignored below). */
    color: var(--text-primary);
    text-align: left;
    transition: background var(--transition);
  }
  .tree-item:hover {
    background: var(--bg-hover);
  }
  .tree-item.ignored .node-name {
    color: var(--text-tertiary);
  }
  .tree-item.ignored :global(.file-icon) {
    opacity: 0.55;
  }

  .node-name {
    flex: 1;
    min-width: 0;
  }

  .tree-edit {
    cursor: default;
  }
  .tree-input {
    flex: 1;
    min-width: 0;
    padding: 1px 4px;
    border: 1px solid var(--accent, #58a6ff);
    border-radius: var(--radius-sm);
    background: var(--bg-elevated, rgba(255, 255, 255, 0.04));
    color: var(--text-primary);
    font-size: var(--fs-sm);
    font-family: inherit;
    outline: none;
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
    color: var(--git-modified, #e2b93d);
  }
  .git-a {
    color: var(--git-added, #73c991);
  }
  .git-d {
    color: var(--git-deleted, #f44747);
  }
  .git-u {
    color: var(--git-untracked, #6fb5ff);
  }
  .git-r {
    color: var(--git-renamed, #73c991);
  }

  /* Tint the whole row's filename to match git status so the state is visible
     without squinting at the 14px badge. Directories roll up their children's
     worst status via the same mechanism. */
  .tree-item.git-status[data-git-status='M'] .node-name {
    color: var(--git-modified, #e2b93d);
  }
  .tree-item.git-status[data-git-status='A'] .node-name {
    color: var(--git-added, #73c991);
  }
  .tree-item.git-status[data-git-status='D'] .node-name {
    color: var(--git-deleted, #f44747);
    text-decoration: line-through;
    text-decoration-color: var(--git-deleted, #f44747);
  }
  .tree-item.git-status[data-git-status='U'] .node-name {
    color: var(--git-untracked, #6fb5ff);
  }
  .tree-item.git-status[data-git-status='R'] .node-name {
    color: var(--git-renamed, #73c991);
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
