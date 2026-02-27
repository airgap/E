<script lang="ts">
  import { changesStore } from '$lib/stores/changes.svelte';
  import { api } from '$lib/api/client';
  import { primaryPaneStore } from '$lib/stores/primaryPane.svelte';
  import { streamStore } from '$lib/stores/stream.svelte';

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
      html: 'html',
      svelte: 'html',
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
    } catch {
      // Silently ignore
    }
  }
</script>

{#if changesStore.visible && changesStore.hasChanges}
  <div class="change-summary">
    <div class="summary-header">
      <div class="summary-title">
        <span class="title-text">Agent Changes</span>
        <span class="summary-stats">
          <span class="stat files"
            >{changesStore.stats.totalFiles} file{changesStore.stats.totalFiles !== 1
              ? 's'
              : ''}</span
          >
          <span class="stat added">+{changesStore.stats.totalAdded}</span>
          <span class="stat removed">-{changesStore.stats.totalRemoved}</span>
        </span>
      </div>
      <div class="summary-actions">
        <button class="action-btn accept-all" onclick={() => changesStore.acceptAll()}>
          Accept All
        </button>
        <button class="action-btn dismiss" onclick={() => changesStore.dismiss()}> Dismiss </button>
      </div>
    </div>

    <div class="change-list">
      {#each changesStore.groups as group (group.path)}
        {@const verification = streamStore.verifications.get(group.path)}
        <div
          class="change-group"
          class:accepted={group.status === 'accepted'}
          class:rejected={group.status === 'rejected'}
        >
          <div class="group-header">
            <button class="file-path" onclick={() => openFile(group.path)} title="Open in editor">
              {group.path.split('/').pop()}
              <span class="full-path">{group.path}</span>
            </button>
            <div class="group-stats">
              {#if verification}
                {#if verification.passed}
                  <span class="verify-badge passed" title="Syntax check passed">OK</span>
                {:else}
                  <span
                    class="verify-badge failed"
                    title={verification.issues
                      .map((issue: { message: string }) => issue.message)
                      .join('; ')}
                  >
                    {verification.issues.length} issue{verification.issues.length !== 1 ? 's' : ''}
                  </span>
                {/if}
              {/if}
              <span class="stat added">+{group.linesAdded}</span>
              <span class="stat removed">-{group.linesRemoved}</span>
              <span class="change-count"
                >{group.changes.length} change{group.changes.length !== 1 ? 's' : ''}</span
              >
            </div>
          </div>

          <div class="group-tools">
            {#each group.changes as change (change.toolCallId)}
              <span class="tool-badge">{change.toolName}</span>
            {/each}
          </div>

          {#each group.changes as change (change.toolCallId)}
            {#if change.reasoning}
              <div class="change-reasoning">
                <span class="reasoning-label">Why:</span>
                <span class="reasoning-text"
                  >{change.reasoning.length > 200
                    ? change.reasoning.slice(-200) + '...'
                    : change.reasoning}</span
                >
              </div>
            {/if}
          {/each}

          {#if group.status === 'pending'}
            <div class="group-actions">
              <button
                class="verdict-btn accept"
                onclick={() => changesStore.setGroupStatus(group.path, 'accepted')}
              >
                Accept
              </button>
              <button
                class="verdict-btn reject"
                onclick={() => changesStore.setGroupStatus(group.path, 'rejected')}
              >
                Reject
              </button>
            </div>
          {:else}
            <div
              class="verdict-label"
              class:accepted={group.status === 'accepted'}
              class:rejected={group.status === 'rejected'}
            >
              {group.status}
            </div>
          {/if}
        </div>
      {/each}
    </div>

    {#if changesStore.stats.pending === 0}
      <div class="review-complete">
        Review complete: {changesStore.stats.accepted} accepted, {changesStore.stats.rejected} rejected
      </div>
    {/if}
  </div>
{/if}

<style>
  .change-summary {
    margin: 8px 16px;
    border: 1px solid var(--border-primary);
    background: var(--bg-secondary);
  }
  .summary-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border-primary);
    background: var(--bg-tertiary);
  }
  .summary-title {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .title-text {
    font-size: var(--fs-sm);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--accent-primary);
  }
  .summary-stats {
    display: flex;
    gap: 8px;
    font-size: var(--fs-xs);
    font-family: var(--font-family);
  }
  .stat.files {
    color: var(--text-secondary);
  }
  .stat.added {
    color: var(--accent-secondary);
  }
  .stat.removed {
    color: var(--accent-error);
  }
  .summary-actions {
    display: flex;
    gap: 6px;
  }
  .action-btn {
    font-size: var(--fs-xxs);
    padding: 3px 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border: 1px solid var(--border-secondary);
    background: var(--bg-primary);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .action-btn.accept-all {
    border-color: var(--accent-secondary);
    color: var(--accent-secondary);
  }
  .action-btn.accept-all:hover {
    background: var(--accent-secondary);
    color: var(--bg-primary);
  }
  .action-btn.dismiss:hover {
    color: var(--text-primary);
  }
  .change-list {
    max-height: 300px;
    overflow-y: auto;
  }
  .change-group {
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-primary);
    transition: opacity 0.15s ease;
  }
  .change-group.accepted {
    opacity: 0.6;
  }
  .change-group.rejected {
    opacity: 0.4;
  }
  .group-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .file-path {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-primary);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    text-align: left;
  }
  .file-path:hover {
    color: var(--accent-primary);
  }
  .full-path {
    display: block;
    font-size: var(--fs-xxs);
    font-weight: 400;
    color: var(--text-tertiary);
    font-family: var(--font-family);
  }
  .group-stats {
    display: flex;
    gap: 6px;
    font-size: var(--fs-xxs);
    font-family: var(--font-family);
    align-items: center;
  }
  .change-count {
    color: var(--text-tertiary);
  }
  .group-tools {
    display: flex;
    gap: 4px;
    margin-top: 4px;
    flex-wrap: wrap;
  }
  .tool-badge {
    font-size: var(--fs-xxs);
    padding: 1px 6px;
    background: var(--bg-primary);
    border: 1px solid var(--border-secondary);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .group-actions {
    display: flex;
    gap: 4px;
    margin-top: 6px;
  }
  .verdict-btn {
    font-size: var(--fs-xxs);
    padding: 2px 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border: 1px solid var(--border-secondary);
    background: none;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .verdict-btn.accept {
    color: var(--accent-secondary);
    border-color: var(--accent-secondary);
  }
  .verdict-btn.accept:hover {
    background: var(--accent-secondary);
    color: var(--bg-primary);
  }
  .verdict-btn.reject {
    color: var(--accent-error);
    border-color: var(--accent-error);
  }
  .verdict-btn.reject:hover {
    background: var(--accent-error);
    color: var(--bg-primary);
  }
  .verdict-label {
    font-size: var(--fs-xxs);
    text-transform: uppercase;
    letter-spacing: 1px;
    font-weight: 700;
    margin-top: 4px;
  }
  .verdict-label.accepted {
    color: var(--accent-secondary);
  }
  .verdict-label.rejected {
    color: var(--accent-error);
  }
  .change-reasoning {
    margin-top: 4px;
    padding: 4px 8px;
    background: var(--bg-primary);
    border-left: 2px solid var(--accent-primary);
    font-size: var(--fs-xs);
    line-height: 1.4;
  }
  .reasoning-label {
    font-weight: 700;
    color: var(--accent-primary);
    margin-right: 4px;
    font-size: var(--fs-xxs);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .reasoning-text {
    color: var(--text-secondary);
  }
  .verify-badge {
    font-size: var(--fs-xxs);
    padding: 1px 6px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .verify-badge.passed {
    color: var(--accent-secondary);
    border: 1px solid var(--accent-secondary);
  }
  .verify-badge.failed {
    color: var(--accent-error);
    border: 1px solid var(--accent-error);
    background: rgba(255, 50, 50, 0.1);
  }
  .review-complete {
    padding: 8px 12px;
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    text-align: center;
    background: var(--bg-tertiary);
  }
</style>
