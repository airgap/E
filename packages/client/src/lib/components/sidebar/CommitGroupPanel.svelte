<script lang="ts">
  import { commitGroupsStore, type CommitGroup } from '$lib/stores/commitGroups.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { gitStore } from '$lib/stores/git.svelte';

  let editingMessage = $state<string | null>(null);

  let workspacePath = $derived(settingsStore.workspacePath || '');
  let locked = $derived(gitStore.indexLocked);

  let smartCommitting = $state(false);

  async function handleSuggest() {
    if (!workspacePath) return;
    await commitGroupsStore.suggest(workspacePath);
  }

  async function handleSmartCommit() {
    if (!workspacePath || smartCommitting) return;
    smartCommitting = true;
    try {
      await commitGroupsStore.smartCommit(workspacePath);
    } finally {
      smartCommitting = false;
    }
  }

  async function handleCommitGroup(groupId: string) {
    if (!workspacePath) return;
    await commitGroupsStore.commitGroup(workspacePath, groupId);
  }

  async function handleCommitAll() {
    if (!workspacePath) return;
    await commitGroupsStore.commitAll(workspacePath);
  }

  function statusIcon(status: CommitGroup['status']): string {
    switch (status) {
      case 'pending':
        return 'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2z';
      case 'committing':
        return 'M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83';
      case 'committed':
        return 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11';
      case 'failed':
        return 'M18 6L6 18M6 6l12 12';
    }
  }
</script>

<div class="commit-group-panel">
  <!-- Header -->
  <div class="cg-header">
    <span class="cg-title">Smart Staging</span>
    {#if commitGroupsStore.hasGroups}
      <button class="cg-clear-btn" onclick={() => commitGroupsStore.clear()} title="Clear groups">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    {/if}
  </div>

  <!-- Loading state -->
  {#if commitGroupsStore.loading}
    <div class="cg-loading">
      <svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path
          d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"
        />
      </svg>
      <span>{commitGroupsStore.statusMessage || 'Analyzing changes…'}</span>
    </div>

    <!-- Error state -->
  {:else if commitGroupsStore.error}
    <div class="cg-error">
      <span>{commitGroupsStore.error}</span>
      <button class="cg-retry-btn" onclick={handleSuggest}>Retry</button>
    </div>

    <!-- No groups yet -->
  {:else if !commitGroupsStore.hasGroups}
    <div class="cg-empty">
      <p>AI groups your changes into logical commits</p>
      <div class="cg-empty-actions">
        <button class="cg-suggest-btn" onclick={handleSuggest} disabled={!workspacePath || locked}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M15 4V2" />
            <path d="M15 16v-2" />
            <path d="M8 9h2" />
            <path d="M20 9h2" />
            <path d="M17.8 11.8L19 13" />
            <path d="M15 9h0" />
            <path d="M17.8 6.2L19 5" />
            <path d="M3 21l9-9" />
            <path d="M12.2 6.2L11 5" />
          </svg>
          Suggest Groups
        </button>
        <button
          class="cg-smart-commit-btn"
          onclick={handleSmartCommit}
          disabled={!workspacePath || locked || smartCommitting}
          title="Analyze, group, and commit all changes in one go"
        >
          {#if smartCommitting}
            <svg
              class="spin"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"
              />
            </svg>
          {:else}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
          {/if}
          Smart Commit
        </button>
      </div>
    </div>

    <!-- Groups list -->
  {:else}
    <div class="cg-groups">
      {#each commitGroupsStore.groups as group (group.id)}
        <div
          class="cg-group"
          class:committed={group.status === 'committed'}
          class:failed={group.status === 'failed'}
        >
          <!-- Group header -->
          <div class="cg-group-header">
            <svg
              class="cg-status-icon"
              class:spin={group.status === 'committing'}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d={statusIcon(group.status)} />
            </svg>
            <span class="cg-group-name">{group.name}</span>
            <span class="cg-file-count">{group.files.length}</span>
            {#if group.status === 'pending'}
              <button
                class="cg-remove-group"
                onclick={() => commitGroupsStore.removeGroup(group.id)}
                title="Remove group"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            {/if}
          </div>

          <!-- Reason -->
          <div class="cg-reason">{group.reason}</div>

          <!-- Commit message (editable) -->
          {#if group.status === 'pending'}
            <div class="cg-message-row">
              <input
                class="cg-message-input"
                type="text"
                placeholder="Commit message..."
                value={group.message}
                oninput={(e) =>
                  commitGroupsStore.setMessage(group.id, (e.target as HTMLInputElement).value)}
              />
            </div>
          {:else}
            <div class="cg-message-display">{group.message}</div>
          {/if}

          <!-- File list -->
          <div class="cg-files">
            {#each group.files as file}
              <div class="cg-file">
                <span class="cg-file-name" title={file}>{file}</span>
                {#if group.status === 'pending'}
                  <button
                    class="cg-file-remove"
                    onclick={() => commitGroupsStore.removeFile(group.id, file)}
                    title="Remove from group"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </button>
                {/if}
              </div>
            {/each}
          </div>

          <!-- Error -->
          {#if group.error}
            <div class="cg-group-error">{group.error}</div>
          {/if}

          <!-- Per-group commit button -->
          {#if group.status === 'pending'}
            <button
              class="cg-commit-one"
              onclick={() => handleCommitGroup(group.id)}
              disabled={!group.message.trim() || locked}
            >
              Commit this group
            </button>
          {/if}
        </div>
      {/each}
    </div>

    <!-- Bottom actions -->
    {#if commitGroupsStore.pendingGroups.length > 0}
      <div class="cg-bottom-actions">
        {#if commitGroupsStore.commitProgress}
          <div class="cg-progress">
            Committing {commitGroupsStore.commitProgress.current} / {commitGroupsStore
              .commitProgress.total}…
          </div>
        {:else}
          <button
            class="cg-commit-all"
            onclick={handleCommitAll}
            disabled={commitGroupsStore.pendingGroups.some((g) => !g.message.trim()) || locked}
          >
            Commit all ({commitGroupsStore.pendingGroups.length} groups)
          </button>
        {/if}
      </div>
    {:else if commitGroupsStore.allCommitted}
      <div class="cg-done">All groups committed</div>
    {/if}
  {/if}
</div>

<style>
  .commit-group-panel {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: var(--fs-sm);
  }

  /* ── Header ── */
  .cg-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 0;
  }

  .cg-title {
    font-weight: 600;
    font-size: var(--fs-xs);
    color: var(--text);
  }

  .cg-clear-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: 3px;
    padding: 0;
  }

  .cg-clear-btn:hover {
    color: var(--text);
    background: var(--bg-hover);
  }

  .cg-clear-btn svg {
    width: 12px;
    height: 12px;
  }

  /* ── Loading ── */
  .cg-loading {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 0;
    color: var(--text-muted);
    font-size: var(--fs-xs);
  }

  .cg-loading svg {
    width: 16px;
    height: 16px;
  }

  /* ── Error ── */
  .cg-error {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px;
    background: rgba(239, 68, 68, 0.1);
    border-radius: 4px;
    color: var(--text-danger, #ef4444);
    font-size: var(--fs-xs);
  }

  .cg-retry-btn {
    padding: 2px 8px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: transparent;
    color: var(--text);
    font-size: var(--fs-xxs);
    cursor: pointer;
    white-space: nowrap;
  }

  /* ── Empty ── */
  .cg-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 8px 0;
    text-align: center;
  }

  .cg-empty p {
    margin: 0;
    font-size: var(--fs-xxs);
    color: var(--text-muted);
  }

  .cg-empty-actions {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    justify-content: center;
  }

  .cg-suggest-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px;
    border: 1px solid var(--accent);
    border-radius: 4px;
    background: transparent;
    color: var(--accent);
    font-size: var(--fs-xs);
    font-weight: 600;
    cursor: pointer;
    transition: all 0.12s;
  }

  .cg-suggest-btn:hover:not(:disabled) {
    background: rgba(var(--accent-rgb, 99, 102, 241), 0.1);
  }

  .cg-suggest-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .cg-suggest-btn svg {
    width: 14px;
    height: 14px;
  }

  .cg-smart-commit-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px;
    border: none;
    border-radius: 4px;
    background: var(--accent);
    color: white;
    font-size: var(--fs-xs);
    font-weight: 600;
    cursor: pointer;
    transition: all 0.12s;
  }

  .cg-smart-commit-btn:hover:not(:disabled) {
    opacity: 0.9;
  }

  .cg-smart-commit-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .cg-smart-commit-btn svg {
    width: 14px;
    height: 14px;
  }

  /* ── Groups ── */
  .cg-groups {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .cg-group {
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px;
    background: var(--bg);
    transition: opacity 0.2s;
  }

  .cg-group.committed {
    opacity: 0.5;
    border-color: rgba(34, 197, 94, 0.3);
  }

  .cg-group.failed {
    border-color: rgba(239, 68, 68, 0.4);
  }

  .cg-group-header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
  }

  .cg-status-icon {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    color: var(--text-muted);
  }

  .cg-group.committed .cg-status-icon {
    color: #22c55e;
  }

  .cg-group.failed .cg-status-icon {
    color: #ef4444;
  }

  .cg-group-name {
    font-weight: 600;
    font-size: var(--fs-xs);
    color: var(--text);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cg-file-count {
    font-size: var(--fs-xxs);
    color: var(--text-muted);
    background: var(--bg-hover);
    padding: 0 5px;
    border-radius: 8px;
    font-weight: 600;
  }

  .cg-remove-group {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: 3px;
    padding: 0;
  }

  .cg-remove-group:hover {
    color: var(--text-danger, #ef4444);
    background: rgba(239, 68, 68, 0.1);
  }

  .cg-remove-group svg {
    width: 10px;
    height: 10px;
  }

  /* ── Reason ── */
  .cg-reason {
    font-size: var(--fs-xxs);
    color: var(--text-muted);
    margin-bottom: 6px;
    line-height: 1.3;
  }

  /* ── Message ── */
  .cg-message-row {
    margin-bottom: 6px;
  }

  .cg-message-input {
    width: 100%;
    padding: 4px 6px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--bg);
    color: var(--text);
    font-size: var(--fs-xs);
    font-family: var(--font-mono, monospace);
  }

  .cg-message-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .cg-message-display {
    font-family: var(--font-mono, monospace);
    font-size: var(--fs-xxs);
    color: var(--text-muted);
    margin-bottom: 6px;
    padding: 3px 6px;
    background: var(--bg-hover);
    border-radius: 3px;
  }

  /* ── Files ── */
  .cg-files {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .cg-file {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 4px;
    border-radius: 3px;
  }

  .cg-file:hover {
    background: var(--bg-hover);
  }

  .cg-file-name {
    font-family: var(--font-mono, monospace);
    font-size: var(--fs-xxs);
    color: var(--text);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cg-file-remove {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: 2px;
    padding: 0;
    opacity: 0;
    transition: opacity 0.1s;
  }

  .cg-file:hover .cg-file-remove {
    opacity: 1;
  }

  .cg-file-remove:hover {
    color: var(--text-danger, #ef4444);
  }

  .cg-file-remove svg {
    width: 10px;
    height: 10px;
  }

  /* ── Group error ── */
  .cg-group-error {
    font-size: var(--fs-xxs);
    color: var(--text-danger, #ef4444);
    padding: 4px;
    margin-top: 4px;
  }

  /* ── Per-group commit ── */
  .cg-commit-one {
    width: 100%;
    margin-top: 6px;
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: transparent;
    color: var(--text);
    font-size: var(--fs-xxs);
    cursor: pointer;
    transition: all 0.12s;
  }

  .cg-commit-one:hover:not(:disabled) {
    background: var(--bg-hover);
    border-color: var(--accent);
    color: var(--accent);
  }

  .cg-commit-one:disabled {
    opacity: 0.4;
    cursor: default;
  }

  /* ── Bottom actions ── */
  .cg-bottom-actions {
    padding: 8px 0 0;
    border-top: 1px solid var(--border);
  }

  .cg-commit-all {
    width: 100%;
    padding: 6px 12px;
    border: none;
    border-radius: 4px;
    background: var(--accent);
    color: white;
    font-size: var(--fs-xs);
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.12s;
  }

  .cg-commit-all:hover:not(:disabled) {
    opacity: 0.9;
  }

  .cg-commit-all:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .cg-progress {
    text-align: center;
    font-size: var(--fs-xs);
    color: var(--accent);
    padding: 4px 0;
  }

  .cg-done {
    text-align: center;
    font-size: var(--fs-xs);
    color: #22c55e;
    padding: 6px 0;
    font-weight: 600;
  }

  /* ── Animations ── */
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .spin {
    animation: spin 1s linear infinite;
  }
</style>
