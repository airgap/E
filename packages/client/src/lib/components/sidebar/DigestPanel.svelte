<script lang="ts">
  import { api } from '$lib/api/client';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { workspaceListStore } from '$lib/stores/projects.svelte';
  import { onMount } from 'svelte';

  interface DigestConversation {
    id: string;
    title: string;
    model: string;
    tokens: number;
    costUsd: number;
  }

  interface DigestData {
    date: string;
    conversations: DigestConversation[];
    gitCommits: string[];
    storiesCompleted: Array<{ title: string; status: string }>;
    loopsRun: number;
    totalCostUsd: number;
    totalTokens: number;
    totalConversations: number;
    summary: string;
  }

  function todayISO(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  let selectedDate = $state(todayISO());
  let loading = $state(false);
  let error = $state<string | null>(null);
  let digest = $state<DigestData | null>(null);
  let showWeek = $state(false);
  let weekData = $state<DigestData[]>([]);
  let weekLoading = $state(false);
  let copySuccess = $state(false);

  function getWorkspacePath(): string | undefined {
    return (
      workspaceListStore.activeWorkspace?.path ||
      (settingsStore.workspacePath !== '.' ? settingsStore.workspacePath : undefined)
    );
  }

  async function loadDigest() {
    loading = true;
    error = null;
    try {
      const res = await api.digest.today(getWorkspacePath(), selectedDate);
      digest = res.data;
    } catch (e: any) {
      error = e?.message || 'Failed to load digest';
    } finally {
      loading = false;
    }
  }

  async function loadWeek() {
    weekLoading = true;
    try {
      const res = await api.digest.week(getWorkspacePath());
      weekData = res.data;
    } catch {
      weekData = [];
    } finally {
      weekLoading = false;
    }
  }

  async function toggleWeek() {
    showWeek = !showWeek;
    if (showWeek && weekData.length === 0) {
      await loadWeek();
    }
  }

  async function copyToClipboard() {
    if (!digest?.summary) return;
    try {
      await navigator.clipboard.writeText(digest.summary);
      copySuccess = true;
      setTimeout(() => (copySuccess = false), 2000);
    } catch {}
  }

  onMount(() => {
    loadDigest();
  });
</script>

<div class="digest-panel">
  <div class="digest-header">
    <h3 class="digest-title">Daily Digest</h3>
    <div class="digest-controls">
      <input type="date" class="date-picker" bind:value={selectedDate} onchange={loadDigest} />
      <button class="btn-refresh" onclick={loadDigest} title="Refresh" disabled={loading}>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M23 4v6h-6M1 20v-6h6" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
      </button>
    </div>
  </div>

  {#if loading}
    <div class="digest-loading">Loading digest...</div>
  {:else if error}
    <div class="digest-error">{error}</div>
  {:else if digest}
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">{digest.totalConversations}</div>
        <div class="stat-label">Conversations</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{(digest.totalTokens / 1000).toFixed(1)}k</div>
        <div class="stat-label">Tokens</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${digest.totalCostUsd.toFixed(2)}</div>
        <div class="stat-label">Cost</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{digest.storiesCompleted.length}</div>
        <div class="stat-label">Stories Done</div>
      </div>
    </div>

    {#if digest.storiesCompleted.length > 0}
      <div class="digest-section">
        <div class="section-title">Work Completed</div>
        <ul class="item-list">
          {#each digest.storiesCompleted as story}
            <li class="item-row">
              <span class="item-check"
                ><svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--accent-success, #10b981)"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"><path d="M20 6L9 17l-5-5" /></svg
                ></span
              >
              <span class="item-text">{story.title}</span>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    {#if digest.gitCommits.length > 0}
      <div class="digest-section">
        <div class="section-title">Git Commits ({digest.gitCommits.length})</div>
        <ul class="item-list">
          {#each digest.gitCommits as commit}
            <li class="item-row">
              <span class="commit-hash">{commit.slice(0, 7)}</span>
              <span class="item-text">{commit.slice(8)}</span>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    {#if digest.totalConversations > 0}
      <div class="digest-section">
        <div class="section-title">Sessions</div>
        <ul class="item-list">
          {#each digest.conversations as conv}
            <li class="item-row conv-row">
              <span class="item-text conv-title">{conv.title}</span>
              <span class="conv-meta">{(conv.tokens / 1000).toFixed(1)}k</span>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    <div class="digest-section">
      <div class="section-title-row">
        <div class="section-title">Summary</div>
        <button
          class="btn-copy"
          class:copied={copySuccess}
          onclick={copyToClipboard}
          title="Copy summary to clipboard"
        >
          {copySuccess ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre class="summary-text">{digest.summary}</pre>
    </div>
  {/if}

  <div class="week-section">
    <button class="btn-week-toggle" onclick={toggleWeek}>
      {showWeek ? 'Hide This Week' : 'View This Week'}
    </button>

    {#if showWeek}
      {#if weekLoading}
        <div class="digest-loading">Loading week...</div>
      {:else}
        <div class="week-list">
          {#each weekData as day}
            <div class="week-day-card">
              <div class="week-day-header">
                <span class="week-day-date">{day.date}</span>
                <span class="week-day-stats">
                  {day.totalConversations} chats · ${day.totalCostUsd.toFixed(2)}
                </span>
              </div>
              {#if day.totalConversations > 0 || day.gitCommits.length > 0 || day.storiesCompleted.length > 0}
                <pre class="week-summary-text">{day.summary}</pre>
              {:else}
                <div class="week-day-empty">No activity</div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .digest-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px;
    height: 100%;
    overflow-y: auto;
  }

  .digest-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .digest-title {
    font-size: var(--fs-base);
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }

  .digest-controls {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .date-picker {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    padding: 3px 6px;
    outline: none;
  }

  .btn-refresh {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: var(--radius-sm);
    color: var(--text-tertiary);
    transition: all var(--transition);
  }
  .btn-refresh:hover:not(:disabled) {
    color: var(--accent-primary);
    background: var(--bg-hover);
  }
  .btn-refresh:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .digest-loading {
    font-size: var(--fs-sm);
    color: var(--text-tertiary);
    padding: 16px 0;
    text-align: center;
  }

  .digest-error {
    font-size: var(--fs-sm);
    color: var(--accent-error);
    padding: 8px 12px;
    background: var(--bg-secondary);
    border-radius: var(--radius-sm);
  }

  .stats-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .stat-card {
    background: var(--bg-secondary);
    border-radius: var(--radius);
    padding: 10px 12px;
    text-align: center;
  }

  .stat-value {
    font-size: var(--fs-xl);
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1.2;
  }

  .stat-label {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-top: 2px;
  }

  .digest-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .section-title {
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .section-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .item-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .item-row {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    font-size: var(--fs-sm);
    color: var(--text-secondary);
  }

  .item-check {
    flex-shrink: 0;
    margin-top: 1px;
    display: flex;
    align-items: center;
  }

  .item-text {
    flex: 1;
    line-height: 1.4;
  }

  .commit-hash {
    font-family: var(--font-family-mono, monospace);
    font-size: var(--fs-xxs);
    color: var(--accent-primary);
    background: var(--bg-secondary);
    padding: 1px 4px;
    border-radius: 3px;
    flex-shrink: 0;
  }

  .conv-row {
    justify-content: space-between;
  }

  .conv-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    flex: 1;
  }

  .conv-meta {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    flex-shrink: 0;
  }

  .btn-copy {
    font-size: var(--fs-xxs);
    font-weight: 600;
    padding: 2px 8px;
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
    color: var(--text-tertiary);
    border: 1px solid var(--border-primary);
    transition: all var(--transition);
  }
  .btn-copy:hover {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
    background: var(--bg-hover);
  }
  .btn-copy.copied {
    color: var(--accent-success, #10b981);
    border-color: var(--accent-success, #10b981);
  }

  .summary-text {
    font-family: var(--font-family-sans);
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    background: var(--bg-secondary);
    border-radius: var(--radius);
    padding: 10px 12px;
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.6;
    margin: 0;
  }

  .week-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
    border-top: 1px solid var(--border-primary);
    padding-top: 12px;
  }

  .btn-week-toggle {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--accent-primary);
    padding: 4px 0;
    text-align: left;
    transition: opacity var(--transition);
  }
  .btn-week-toggle:hover {
    opacity: 0.8;
  }

  .week-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .week-day-card {
    background: var(--bg-secondary);
    border-radius: var(--radius);
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .week-day-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .week-day-date {
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-primary);
  }

  .week-day-stats {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
  }

  .week-summary-text {
    font-family: var(--font-family-sans);
    font-size: var(--fs-xxs);
    color: var(--text-secondary);
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.5;
    margin: 0;
  }

  .week-day-empty {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    font-style: italic;
  }
</style>
