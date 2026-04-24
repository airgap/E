<script lang="ts">
  /**
   * Primary-pane view for a single commit. Shows metadata (author, date,
   * parents, subject, body) plus a per-file diff list. Each file expands
   * into a unified diff inline.
   */
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import UnifiedDiffView from './UnifiedDiffView.svelte';
  import FileIcon from '$lib/components/icons/FileIcon.svelte';

  let {
    sha,
    workspacePath,
  }: {
    sha: string;
    workspacePath: string;
  } = $props();

  interface CommitData {
    sha: string;
    parents: string[];
    author: string;
    email: string;
    timestamp: number;
    subject: string;
    body: string;
    files: Array<{ path: string; additions: number; deletions: number }>;
  }

  let data = $state<CommitData | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let expanded = $state<Record<string, string>>({}); // path → diff content
  let loadingFile = $state<Record<string, boolean>>({});

  async function load() {
    loading = true;
    error = null;
    try {
      const res = await api.git.showCommit(workspacePath, sha);
      if (res.ok) {
        data = res.data;
      } else {
        error = (res as { error?: string }).error ?? 'git show failed';
      }
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  onMount(load);

  $effect(() => {
    void sha;
    void workspacePath;
    data = null;
    expanded = {};
    load();
  });

  async function toggle(path: string) {
    if (expanded[path] !== undefined) {
      const next = { ...expanded };
      delete next[path];
      expanded = next;
      return;
    }
    loadingFile = { ...loadingFile, [path]: true };
    try {
      const res = await api.git.showCommitDiff(workspacePath, sha, path);
      if (res.ok) {
        expanded = { ...expanded, [path]: res.data.diff };
      }
    } finally {
      const next = { ...loadingFile };
      delete next[path];
      loadingFile = next;
    }
  }

  function formatTime(ts: number): string {
    if (!ts) return '';
    return new Date(ts * 1000).toLocaleString();
  }
</script>

<div class="commit-view">
  {#if loading && !data}
    <div class="status">Loading commit…</div>
  {:else if error}
    <div class="status error">{error}</div>
  {:else if data}
    <header class="commit-header">
      <h1 class="subject">{data.subject}</h1>
      {#if data.body}
        <pre class="body">{data.body}</pre>
      {/if}
      <div class="meta">
        <span class="author">
          <strong>{data.author}</strong>
          <span class="email">&lt;{data.email}&gt;</span>
        </span>
        <span class="sep">·</span>
        <span class="date">{formatTime(data.timestamp)}</span>
        <span class="sep">·</span>
        <span class="sha" title={data.sha}>{data.sha.slice(0, 10)}</span>
      </div>
      {#if data.parents.length > 0}
        <div class="parents">
          <span class="parents-label">Parents:</span>
          {#each data.parents as p}
            <code class="parent-sha">{p.slice(0, 10)}</code>
          {/each}
        </div>
      {/if}
    </header>

    <section class="files">
      <div class="files-header">
        {data.files.length} file{data.files.length === 1 ? '' : 's'} changed
        <span class="totals">
          <span class="ins">+{data.files.reduce((s, f) => s + f.additions, 0)}</span>
          <span class="del">−{data.files.reduce((s, f) => s + f.deletions, 0)}</span>
        </span>
      </div>
      {#each data.files as file (file.path)}
        <div class="file-row">
          <button class="file-header" onclick={() => toggle(file.path)}>
            <span class="chev" class:open={expanded[file.path] !== undefined}>▸</span>
            <FileIcon name={file.path.split('/').pop() ?? file.path} size={14} />
            <span class="path" title={file.path}>{file.path}</span>
            <span class="stats">
              <span class="ins">+{file.additions}</span>
              <span class="del">−{file.deletions}</span>
            </span>
          </button>
          {#if loadingFile[file.path]}
            <div class="file-loading">Loading diff…</div>
          {:else if expanded[file.path] !== undefined}
            <div class="file-diff">
              <UnifiedDiffView diffContent={expanded[file.path]} fileName={file.path} />
            </div>
          {/if}
        </div>
      {/each}
    </section>
  {/if}
</div>

<style>
  .commit-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow-y: auto;
    font-size: var(--fs-sm);
    background: var(--bg-primary);
  }
  .status {
    padding: 24px;
    text-align: center;
    color: var(--text-tertiary);
  }
  .status.error {
    color: var(--accent-error);
  }

  .commit-header {
    padding: 16px 20px 14px;
    border-bottom: 1px solid var(--border-primary);
  }
  .subject {
    font-size: var(--fs-lg);
    font-weight: 700;
    margin: 0 0 8px;
    color: var(--text-primary);
  }
  .body {
    margin: 0 0 12px;
    padding: 0;
    font-family: var(--font-family);
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    white-space: pre-wrap;
    word-wrap: break-word;
  }
  .meta {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-family-sans, sans-serif);
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    flex-wrap: wrap;
  }
  .email {
    color: var(--text-tertiary);
    font-family: var(--font-family);
  }
  .sha {
    font-family: var(--font-family);
    color: var(--text-secondary);
    padding: 1px 6px;
    border-radius: var(--radius-sm);
    background: var(--bg-tertiary);
  }
  .sep {
    opacity: 0.5;
  }
  .parents {
    margin-top: 8px;
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
  }
  .parents-label {
    margin-right: 6px;
  }
  .parent-sha {
    font-family: var(--font-family);
    padding: 1px 6px;
    margin-right: 4px;
    border-radius: var(--radius-sm);
    background: var(--bg-tertiary);
    color: var(--text-secondary);
  }

  .files {
    padding: 8px 0 24px;
  }
  .files-header {
    padding: 8px 20px;
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .totals {
    display: inline-flex;
    gap: 6px;
  }
  .ins {
    color: var(--git-added, #22c55e);
    font-weight: 600;
  }
  .del {
    color: var(--git-deleted, #ef4444);
    font-weight: 600;
  }

  .file-row {
    border-top: 1px solid var(--border-secondary);
  }
  .file-header {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 20px;
    background: transparent;
    border: none;
    color: var(--text-primary);
    font-size: var(--fs-sm);
    text-align: left;
    cursor: pointer;
    transition: background 100ms ease-out;
  }
  .file-header:hover {
    background: var(--bg-hover);
  }
  .chev {
    display: inline-block;
    font-size: 10px;
    line-height: 1;
    color: var(--text-tertiary);
    transition: transform 120ms ease-out;
    width: 12px;
  }
  .chev.open {
    transform: rotate(90deg);
  }
  .path {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-family);
  }
  .stats {
    display: inline-flex;
    gap: 6px;
    font-size: var(--fs-xs);
  }
  .file-loading {
    padding: 10px 20px;
    color: var(--text-tertiary);
    font-size: var(--fs-xs);
  }
  .file-diff {
    padding: 0 0 12px;
    background: var(--bg-secondary);
  }
</style>
