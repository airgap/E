<script lang="ts">
  /**
   * LocalHistoryPanel (LYK-1061) — per-file edit revision retention,
   * independent of git. Lists the local-history snapshots captured on
   * every save of the active file (server-side, in /files/write), with
   * preview (diff vs current) and restore.
   *
   * "Active file" is the editor's active tab. Snapshots are keyed by
   * absolute path server-side, so the list tracks whatever file is in
   * focus. When the active tab isn't a file (chat, diff, etc.) we show
   * an empty prompt.
   *
   * Preview opens a read-only diff tab (snapshot → current) using the
   * shared LCS unified-diff helper. Restore writes the snapshot back via
   * the server, which first snapshots the current state so the restore
   * is itself undoable, then refreshes the open buffer.
   */
  import { editorStore } from '$lib/stores/editor.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { uiStore } from '$lib/stores/ui.svelte';
  import { api } from '$lib/api/client';
  import { formatRelativeTime } from '$lib/stores/recent-files.svelte';
  import { unifiedDiff } from '$lib/util/line-diff';

  interface Entry {
    id: number;
    timestamp: number;
    size: number;
  }

  let entries = $state<Entry[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let busyId = $state<number | null>(null);

  // The active file path, or null when the active tab isn't a real file.
  const activeFile = $derived.by(() => {
    const tab = editorStore.activeTab;
    if (!tab || tab.kind === 'diff') return null;
    return tab.filePath || null;
  });

  async function load() {
    const path = activeFile;
    if (!path) {
      entries = [];
      return;
    }
    loading = true;
    error = null;
    try {
      const res = await api.files.historyList(path);
      entries = res.data.entries;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  // Reload whenever the active file changes.
  $effect(() => {
    void activeFile;
    void load();
  });

  /** Best-effort fetch of the current file content for diffing. */
  async function currentContent(path: string): Promise<string> {
    const tab = editorStore.activeTab;
    if (tab && tab.filePath === path && tab.kind !== 'diff') return tab.content;
    try {
      const res = await api.files.read(path);
      return res.data.content;
    } catch {
      return '';
    }
  }

  async function preview(entry: Entry) {
    const path = activeFile;
    if (!path) return;
    busyId = entry.id;
    try {
      const snapRes = await api.files.historyContent(path, entry.id);
      if (!snapRes.ok) throw new Error(snapRes.error || 'Failed to read snapshot');
      const snapshot = snapRes.data.content;
      const current = await currentContent(path);
      // Diff direction: snapshot (old) → current (new), so additions are
      // what the current file has that the snapshot didn't.
      const diff = unifiedDiff(path, snapshot, current);
      editorStore.openDiffTab(`${path} @ ${formatRelativeTime(entry.timestamp)}`, diff, false);
    } catch (e) {
      uiStore.toast(`Preview failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      busyId = null;
    }
  }

  async function restore(entry: Entry) {
    const path = activeFile;
    if (!path) return;
    const ok = confirm(
      `Restore this snapshot from ${formatRelativeTime(entry.timestamp)}?\n\nThe current content is snapshotted first, so you can undo the restore from history.`,
    );
    if (!ok) return;
    busyId = entry.id;
    try {
      const res = await api.files.historyRestore(path, entry.id);
      if (!res.ok) throw new Error(res.error || 'Restore failed');
      await editorStore.refreshFile(path);
      uiStore.toast('Snapshot restored.', 'success');
      await load();
    } catch (e) {
      uiStore.toast(`Restore failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      busyId = null;
    }
  }

  async function clearAll() {
    const path = activeFile;
    if (!path) return;
    if (!confirm('Delete all local history for this file? This cannot be undone.')) return;
    try {
      await api.files.historyClear(path);
      await load();
    } catch (e) {
      uiStore.toast(`Clear failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  }

  function fmtSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  function fileName(path: string): string {
    return path.split('/').pop() ?? path;
  }
</script>

<div class="local-history">
  <header>
    <h3>Local History</h3>
    {#if activeFile && entries.length > 0}
      <button class="link-btn" onclick={clearAll} title="Delete all snapshots for this file">
        Clear
      </button>
    {/if}
  </header>

  {#if !settingsStore.localHistoryEnabled}
    <div class="empty">
      Local history is disabled in settings. Snapshots are still captured; enable to use the panel.
    </div>
  {:else if !activeFile}
    <div class="empty">Open a file to see its local history.</div>
  {:else}
    <div class="file-label" title={activeFile}>{fileName(activeFile)}</div>
    {#if loading}
      <div class="empty">Loading…</div>
    {:else if error}
      <div class="error">{error}</div>
    {:else if entries.length === 0}
      <div class="empty">No snapshots yet. They're captured each time you save.</div>
    {:else}
      <ul class="entries">
        {#each entries as e (e.id)}
          <li>
            <button
              type="button"
              class="entry-main"
              disabled={busyId === e.id}
              onclick={() => preview(e)}
              title="Preview diff vs current"
            >
              <span class="when">{formatRelativeTime(e.timestamp)}</span>
              <span class="size">{fmtSize(e.size)}</span>
            </button>
            <button
              type="button"
              class="restore-btn"
              disabled={busyId === e.id}
              onclick={() => restore(e)}
              title="Restore this version"
            >
              ⤺
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>

<style>
  .local-history {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border-primary);
  }
  header h3 {
    margin: 0;
    font-size: 12px;
    font-weight: 600;
  }
  .link-btn {
    background: none;
    border: none;
    color: var(--accent-primary);
    font: inherit;
    font-size: 11px;
    cursor: pointer;
    padding: 0;
  }
  .file-label {
    padding: 6px 10px;
    font-family: var(--font-family-mono, monospace);
    font-size: 11px;
    color: var(--text-secondary);
    border-bottom: 1px solid var(--border-subtle, var(--border-primary));
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .empty,
  .error {
    padding: 18px 14px;
    color: var(--text-tertiary);
    font-size: 12px;
    text-align: center;
  }
  .error {
    color: var(--accent-error, #ef4444);
  }
  .entries {
    list-style: none;
    margin: 0;
    padding: 4px 0;
    overflow-y: auto;
    flex: 1;
  }
  .entries li {
    display: flex;
    align-items: stretch;
  }
  .entries li:hover {
    background: var(--bg-hover);
  }
  .entry-main {
    flex: 1;
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: none;
    border: none;
    color: inherit;
    font: inherit;
    text-align: left;
    padding: 6px 10px;
    cursor: pointer;
  }
  .when {
    font-size: 12px;
  }
  .size {
    font-size: 10px;
    color: var(--text-tertiary);
  }
  .restore-btn {
    background: none;
    border: none;
    color: var(--text-tertiary);
    cursor: pointer;
    padding: 0 10px;
    font-size: 14px;
  }
  .restore-btn:hover:not(:disabled) {
    color: var(--accent-primary);
  }
  .restore-btn:disabled,
  .entry-main:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
