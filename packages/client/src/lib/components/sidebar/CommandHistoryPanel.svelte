<script lang="ts">
  import { commandHistoryStore, type CommandHistoryEntry } from '$lib/stores/commandHistory.svelte';
  import { terminalStore } from '$lib/stores/terminal.svelte';
  import { terminalConnectionManager } from '$lib/services/terminal-connection';

  function formatTime(ts: number): string {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const isToday =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    if (isToday) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return (
      d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
      ' ' +
      d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    );
  }

  function formatDuration(start: number, end: number): string {
    if (!end || !start) return '';
    const ms = end - start;
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const min = Math.floor(ms / 60000);
    const sec = Math.round((ms % 60000) / 1000);
    return `${min}m ${sec}s`;
  }

  function rerunCommand(entry: CommandHistoryEntry) {
    // Send command to active terminal session
    const sid = terminalStore.activeSessionId;
    if (sid) {
      terminalConnectionManager.write(sid, entry.command + '\n');
    }
  }

  function copyCommand(entry: CommandHistoryEntry) {
    navigator.clipboard.writeText(entry.command).catch(() => {});
  }
</script>

<div class="command-history-panel">
  <!-- Search -->
  <div class="history-search">
    <input
      class="search-input"
      type="text"
      placeholder="Search commands..."
      value={commandHistoryStore.searchQuery}
      oninput={(e) => commandHistoryStore.setSearch((e.target as HTMLInputElement).value)}
    />
  </div>

  <!-- Filters -->
  <div class="history-filters">
    {#each ['all', 'success', 'failed', 'starred'] as filter}
      <button
        class="filter-btn"
        class:active={commandHistoryStore.filterStatus === filter}
        onclick={() =>
          commandHistoryStore.setFilter(filter as 'all' | 'success' | 'failed' | 'starred')}
      >
        {filter === 'all'
          ? 'All'
          : filter === 'success'
            ? 'OK'
            : filter === 'failed'
              ? 'Failed'
              : 'Starred'}
      </button>
    {/each}
  </div>

  <!-- Entries -->
  <div class="history-entries">
    {#if commandHistoryStore.filteredEntries.length === 0}
      <div class="empty-state">
        {#if commandHistoryStore.allEntries.length === 0}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <p>No commands yet</p>
          <p class="empty-hint">Commands from terminal sessions will appear here</p>
        {:else}
          <p>No matching commands</p>
        {/if}
      </div>
    {:else}
      {#each commandHistoryStore.filteredEntries as entry (entry.blockId)}
        <div class="history-entry" class:failed={entry.exitCode !== null && entry.exitCode !== 0}>
          <!-- Command text -->
          <div class="entry-command">
            <code class="command-text">{entry.command}</code>
          </div>

          <!-- Metadata row -->
          <div class="entry-meta">
            <!-- Exit code badge -->
            {#if entry.exitCode !== null}
              <span
                class="exit-badge"
                class:exit-ok={entry.exitCode === 0}
                class:exit-fail={entry.exitCode !== 0}
                title="Exit code: {entry.exitCode}"
              >
                {entry.exitCode === 0 ? '✓' : `✗ ${entry.exitCode}`}
              </span>
            {:else}
              <span class="exit-badge exit-running" title="Running">…</span>
            {/if}

            <!-- Time -->
            <span class="entry-time" title={new Date(entry.startedAt).toLocaleString()}>
              {formatTime(entry.startedAt)}
            </span>

            <!-- Duration -->
            {#if entry.finishedAt}
              <span class="entry-duration">
                {formatDuration(entry.startedAt, entry.finishedAt)}
              </span>
            {/if}

            <!-- Actions -->
            <div class="entry-actions">
              <button
                class="action-btn star-btn"
                class:starred={entry.starred}
                onclick={() => commandHistoryStore.toggleStar(entry.blockId)}
                title={entry.starred ? 'Unstar' : 'Star'}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill={entry.starred ? 'currentColor' : 'none'}
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <polygon
                    points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
                  />
                </svg>
              </button>
              <button class="action-btn" onclick={() => copyCommand(entry)} title="Copy">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </button>
              <button class="action-btn" onclick={() => rerunCommand(entry)} title="Re-run">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .command-history-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    font-size: var(--fs-sm);
  }

  /* ── Search ── */
  .history-search {
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .search-input {
    width: 100%;
    padding: 5px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font-size: var(--fs-sm);
    font-family: inherit;
  }

  .search-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  /* ── Filters ── */
  .history-filters {
    display: flex;
    gap: 4px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .filter-btn {
    padding: 2px 8px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: transparent;
    color: var(--text-muted);
    font-size: var(--fs-xxs);
    font-weight: 600;
    cursor: pointer;
    transition: all 0.12s;
  }

  .filter-btn:hover {
    color: var(--text);
    background: var(--bg-hover);
  }

  .filter-btn.active {
    color: var(--accent);
    border-color: var(--accent);
    background: rgba(var(--accent-rgb, 99, 102, 241), 0.1);
  }

  /* ── Entries ── */
  .history-entries {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .history-entry {
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    transition: background 0.1s;
  }

  .history-entry:hover {
    background: var(--bg-hover);
  }

  .history-entry.failed {
    border-left: 2px solid var(--text-danger, #ef4444);
  }

  /* ── Command text ── */
  .entry-command {
    margin-bottom: 4px;
  }

  .command-text {
    font-family: var(--font-mono, monospace);
    font-size: var(--fs-xs);
    color: var(--text);
    word-break: break-all;
    white-space: pre-wrap;
    line-height: 1.4;
  }

  /* ── Meta row ── */
  .entry-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--fs-xxs);
    color: var(--text-muted);
  }

  .exit-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 16px;
    padding: 0 4px;
    border-radius: 3px;
    font-size: var(--fs-xxs);
    font-weight: 700;
    font-family: monospace;
  }

  .exit-ok {
    background: rgba(34, 197, 94, 0.15);
    color: #22c55e;
  }

  .exit-fail {
    background: rgba(239, 68, 68, 0.15);
    color: #ef4444;
  }

  .exit-running {
    background: rgba(234, 179, 8, 0.15);
    color: #eab308;
  }

  .entry-time {
    white-space: nowrap;
  }

  .entry-duration {
    white-space: nowrap;
    opacity: 0.7;
  }

  /* ── Actions ── */
  .entry-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-left: auto;
    opacity: 0;
    transition: opacity 0.1s;
  }

  .history-entry:hover .entry-actions {
    opacity: 1;
  }

  .action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: 3px;
    padding: 0;
    transition: all 0.12s;
  }

  .action-btn svg {
    width: 12px;
    height: 12px;
  }

  .action-btn:hover {
    color: var(--text);
    background: var(--bg-active);
  }

  .star-btn.starred {
    color: #eab308;
    opacity: 1;
  }

  /* ── Empty state ── */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 40px 20px;
    color: var(--text-muted);
    text-align: center;
  }

  .empty-state svg {
    width: 32px;
    height: 32px;
    opacity: 0.3;
  }

  .empty-state p {
    margin: 0;
    font-size: var(--fs-sm);
  }

  .empty-hint {
    font-size: var(--fs-xxs);
    opacity: 0.6;
  }
</style>
