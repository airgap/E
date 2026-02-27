<!--
  ChangePreviewPanel.svelte — Multi-file change preview with accept/reject.

  Shows a sidebar file list and stacked diffs with per-file and per-hunk
  accept/reject controls. Used when AI proposes changes the user should review.
-->
<script lang="ts">
  import {
    changePreviewStore,
    type PreviewFile,
    type PreviewHunk,
  } from '$lib/stores/change-preview.svelte';
  import { uiStore } from '$lib/stores/ui.svelte';
  import { primaryPaneStore } from '$lib/stores/primaryPane.svelte';

  let { planId }: { planId: string } = $props();

  const plan = $derived(changePreviewStore.plan);
  const files = $derived(plan?.files ?? []);
  const selected = $derived(changePreviewStore.selectedFile);
  const stats = $derived(changePreviewStore.stats);
  const allDecided = $derived(stats.pending === 0 && stats.total > 0);

  function shortPath(path: string): string {
    const parts = path.split('/');
    return parts.length > 2 ? parts.slice(-2).join('/') : path;
  }

  function statusIcon(status: string): string {
    if (status === 'accepted') return '✓';
    if (status === 'rejected') return '✗';
    return '○';
  }

  function statusClass(status: string): string {
    if (status === 'accepted') return 'accepted';
    if (status === 'rejected') return 'rejected';
    return 'pending';
  }

  async function applyAndClose() {
    const applied = await changePreviewStore.applyAccepted();
    uiStore.toast(`Applied ${applied} file${applied !== 1 ? 's' : ''}`, 'success');
    // Close the change preview tab
    const pane = primaryPaneStore.activePane();
    const tab = pane.tabs.find(
      (t) => t.kind === 'change-preview' && t.changePreviewPlanId === planId,
    );
    if (tab) {
      primaryPaneStore.closeTab(pane.id, tab.id);
    }
  }

  function discardAndClose() {
    changePreviewStore.discard();
    const pane = primaryPaneStore.activePane();
    const tab = pane.tabs.find(
      (t) => t.kind === 'change-preview' && t.changePreviewPlanId === planId,
    );
    if (tab) {
      primaryPaneStore.closeTab(pane.id, tab.id);
    }
  }
</script>

{#if !plan}
  <div class="cp-empty">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
    <p>No change preview active</p>
  </div>
{:else}
  <div class="cp-layout">
    <!-- ── File sidebar ── -->
    <div class="cp-sidebar">
      <div class="cp-sidebar-header">
        <span class="cp-sidebar-title">Files</span>
        <span class="cp-count">{stats.total}</span>
      </div>
      <div class="cp-file-list">
        {#each files as file (file.path)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="cp-file-item {statusClass(file.status)}"
            class:active={file.path === changePreviewStore.selectedFilePath}
            onclick={() => changePreviewStore.selectFile(file.path)}
          >
            <span class="cp-file-status {statusClass(file.status)}">{statusIcon(file.status)}</span>
            <span class="cp-file-name">{shortPath(file.path)}</span>
            <span class="cp-file-stats">
              <span class="cp-added">+{file.linesAdded}</span>
              <span class="cp-removed">-{file.linesRemoved}</span>
            </span>
          </div>
        {/each}
      </div>

      <!-- Bulk actions -->
      <div class="cp-sidebar-actions">
        <button class="cp-bulk-btn accept" onclick={() => changePreviewStore.acceptAll()}>
          Accept All
        </button>
        <button class="cp-bulk-btn reject" onclick={() => changePreviewStore.rejectAll()}>
          Reject All
        </button>
      </div>
    </div>

    <!-- ── Diff content ── -->
    <div class="cp-content">
      {#if plan.summary}
        <div class="cp-summary">{plan.summary}</div>
      {/if}

      {#if selected}
        <div class="cp-file-header">
          <span class="cp-file-path">{selected.path}</span>
          <div class="cp-file-actions">
            <button
              class="cp-action-btn accept"
              class:active={selected.status === 'accepted'}
              onclick={() => changePreviewStore.acceptFile(selected.path)}
              title="Accept all changes in this file"
            >
              ✓ Accept
            </button>
            <button
              class="cp-action-btn reject"
              class:active={selected.status === 'rejected'}
              onclick={() => changePreviewStore.rejectFile(selected.path)}
              title="Reject all changes in this file"
            >
              ✗ Reject
            </button>
          </div>
        </div>

        <div class="cp-diff-body">
          {#each selected.hunks as hunk (hunk.id)}
            <div
              class="cp-hunk"
              class:accepted={hunk.status === 'accepted'}
              class:rejected={hunk.status === 'rejected'}
            >
              <div class="cp-hunk-header">
                <span class="cp-hunk-range">{hunk.header}</span>
                <div class="cp-hunk-actions">
                  <button
                    class="cp-hunk-btn accept"
                    class:active={hunk.status === 'accepted'}
                    onclick={() => changePreviewStore.acceptHunk(selected.path, hunk.id)}
                    title="Accept this hunk">✓</button
                  >
                  <button
                    class="cp-hunk-btn reject"
                    class:active={hunk.status === 'rejected'}
                    onclick={() => changePreviewStore.rejectHunk(selected.path, hunk.id)}
                    title="Reject this hunk">✗</button
                  >
                </div>
              </div>
              {#each hunk.lines as line}
                {@const type = line.startsWith('+')
                  ? 'added'
                  : line.startsWith('-')
                    ? 'removed'
                    : 'context'}
                <div class="cp-diff-line cp-diff-{type}">
                  <span class="cp-line-gutter">
                    {#if type === 'added'}+{:else if type === 'removed'}-{:else}&nbsp;{/if}
                  </span>
                  <span class="cp-line-content">{line.slice(1)}</span>
                </div>
              {/each}
            </div>
          {/each}
        </div>
      {:else}
        <div class="cp-no-selection">
          <p>Select a file from the sidebar to review changes</p>
        </div>
      {/if}

      <!-- ── Bottom action bar ── -->
      <div class="cp-action-bar">
        <div class="cp-action-stats">
          <span class="cp-stat accepted">{stats.accepted} accepted</span>
          <span class="cp-stat rejected">{stats.rejected} rejected</span>
          <span class="cp-stat pending">{stats.pending} pending</span>
        </div>
        <div class="cp-action-buttons">
          <button class="cp-btn discard" onclick={discardAndClose}> Discard All </button>
          <button class="cp-btn apply" disabled={stats.accepted === 0} onclick={applyAndClose}>
            Apply {stats.accepted} File{stats.accepted !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .cp-layout {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .cp-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: var(--text-tertiary);
  }

  .cp-empty svg {
    width: 32px;
    height: 32px;
    opacity: 0.3;
  }

  .cp-empty p {
    font-family: var(--font-family-sans);
    font-size: var(--fs-base);
    margin: 0;
  }

  /* ── Sidebar ── */
  .cp-sidebar {
    width: 240px;
    min-width: 180px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg-secondary);
    border-right: 1px solid var(--border-primary);
  }

  .cp-sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-secondary);
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-primary);
    font-family: var(--font-family-sans);
  }

  .cp-count {
    font-size: 11px;
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    padding: 1px 6px;
    border-radius: 10px;
    font-weight: 500;
  }

  .cp-file-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }

  .cp-file-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    cursor: pointer;
    font-size: var(--fs-sm);
    font-family: var(--font-family);
    color: var(--text-secondary);
    transition: background 0.1s ease;
  }

  .cp-file-item:hover {
    background: var(--bg-hover);
  }

  .cp-file-item.active {
    background: var(--bg-active);
    color: var(--text-primary);
  }

  .cp-file-status {
    width: 14px;
    text-align: center;
    font-size: 12px;
    flex-shrink: 0;
  }

  .cp-file-status.accepted {
    color: #4ade80;
  }
  .cp-file-status.rejected {
    color: #f87171;
  }
  .cp-file-status.pending {
    color: var(--text-tertiary);
  }

  .cp-file-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cp-file-stats {
    flex-shrink: 0;
    font-size: 11px;
    display: flex;
    gap: 4px;
  }

  .cp-added {
    color: #4ade80;
  }
  .cp-removed {
    color: #f87171;
  }

  .cp-sidebar-actions {
    display: flex;
    gap: 4px;
    padding: 6px 8px;
    border-top: 1px solid var(--border-secondary);
  }

  .cp-bulk-btn {
    flex: 1;
    padding: 4px 8px;
    font-size: 11px;
    font-family: var(--font-family-sans);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm, 4px);
    cursor: pointer;
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    transition: all 0.1s ease;
  }

  .cp-bulk-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .cp-bulk-btn.accept:hover {
    border-color: #4ade80;
    color: #4ade80;
  }

  .cp-bulk-btn.reject:hover {
    border-color: #f87171;
    color: #f87171;
  }

  /* ── Content area ── */
  .cp-content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .cp-summary {
    padding: 8px 14px;
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    font-family: var(--font-family-sans);
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-primary);
    flex-shrink: 0;
  }

  .cp-file-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 14px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-primary);
    flex-shrink: 0;
  }

  .cp-file-path {
    font-family: var(--font-family);
    font-size: var(--fs-sm);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cp-file-actions {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }

  .cp-action-btn {
    padding: 3px 10px;
    font-size: 11px;
    font-family: var(--font-family-sans);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm, 4px);
    cursor: pointer;
    background: none;
    color: var(--text-tertiary);
    transition: all 0.1s ease;
  }

  .cp-action-btn:hover,
  .cp-action-btn.active {
    color: var(--text-primary);
  }

  .cp-action-btn.accept:hover,
  .cp-action-btn.accept.active {
    border-color: #4ade80;
    color: #4ade80;
    background: rgba(74, 222, 128, 0.08);
  }

  .cp-action-btn.reject:hover,
  .cp-action-btn.reject.active {
    border-color: #f87171;
    color: #f87171;
    background: rgba(248, 113, 113, 0.08);
  }

  /* ── Diff body ── */
  .cp-diff-body {
    flex: 1;
    overflow: auto;
    font-family: var(--font-family);
    font-size: var(--fs-base);
    background: var(--bg-code);
  }

  .cp-hunk {
    border-bottom: 1px solid var(--border-secondary);
  }

  .cp-hunk.rejected {
    opacity: 0.35;
  }

  .cp-hunk-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 3px 14px;
    background: rgba(96, 165, 250, 0.06);
    border-top: 1px solid rgba(96, 165, 250, 0.12);
    border-bottom: 1px solid rgba(96, 165, 250, 0.12);
    font-size: var(--fs-sm);
  }

  .cp-hunk-range {
    color: #60a5fa;
    font-family: var(--font-family);
    white-space: pre;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .cp-hunk-actions {
    display: flex;
    gap: 2px;
    flex-shrink: 0;
  }

  .cp-hunk-btn {
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm, 4px);
    cursor: pointer;
    background: none;
    color: var(--text-tertiary);
    transition: all 0.1s ease;
  }

  .cp-hunk-btn:hover {
    color: var(--text-primary);
  }

  .cp-hunk-btn.accept:hover,
  .cp-hunk-btn.accept.active {
    border-color: #4ade80;
    color: #4ade80;
  }

  .cp-hunk-btn.reject:hover,
  .cp-hunk-btn.reject.active {
    border-color: #f87171;
    color: #f87171;
  }

  .cp-diff-line {
    display: flex;
    line-height: 1.6;
    white-space: pre;
  }

  .cp-diff-added {
    background: rgba(74, 222, 128, 0.1);
    color: #bbf7d0;
  }

  .cp-diff-removed {
    background: rgba(248, 113, 113, 0.1);
    color: #fecaca;
  }

  .cp-diff-context {
    color: var(--text-secondary);
  }

  .cp-line-gutter {
    width: 24px;
    min-width: 24px;
    text-align: center;
    user-select: none;
    padding: 0 4px;
    opacity: 0.6;
  }

  .cp-diff-added .cp-line-gutter {
    color: #4ade80;
    opacity: 1;
  }

  .cp-diff-removed .cp-line-gutter {
    color: #f87171;
    opacity: 1;
  }

  .cp-line-content {
    flex: 1;
    padding-right: 14px;
    overflow-wrap: anywhere;
  }

  .cp-no-selection {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-tertiary);
    font-family: var(--font-family-sans);
    font-size: var(--fs-base);
  }

  /* ── Bottom action bar ── */
  .cp-action-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 14px;
    background: var(--bg-secondary);
    border-top: 1px solid var(--border-primary);
    flex-shrink: 0;
  }

  .cp-action-stats {
    display: flex;
    gap: 12px;
    font-size: 11px;
    font-family: var(--font-family-sans);
  }

  .cp-stat.accepted {
    color: #4ade80;
  }
  .cp-stat.rejected {
    color: #f87171;
  }
  .cp-stat.pending {
    color: var(--text-tertiary);
  }

  .cp-action-buttons {
    display: flex;
    gap: 8px;
  }

  .cp-btn {
    padding: 5px 14px;
    font-size: var(--fs-sm);
    font-family: var(--font-family-sans);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm, 4px);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .cp-btn.discard {
    background: none;
    color: var(--text-secondary);
  }

  .cp-btn.discard:hover {
    color: #f87171;
    border-color: #f87171;
  }

  .cp-btn.apply {
    background: var(--accent-primary, #00b4ff);
    color: #fff;
    border-color: var(--accent-primary, #00b4ff);
    font-weight: 600;
  }

  .cp-btn.apply:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  .cp-btn.apply:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
