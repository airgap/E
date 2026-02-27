<script lang="ts">
  import { api } from '$lib/api/client';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';

  type Period = 'today' | '7d' | '30d' | 'all';

  interface ModelStat {
    model: string;
    costUsd: number;
    tokens: number;
    conversations: number;
  }

  interface DayStat {
    date: string;
    costUsd: number;
    tokens: number;
  }

  interface TopConversation {
    id: string;
    title: string;
    costUsd: number;
    tokens: number;
    model: string;
    updatedAt: number;
  }

  interface CostSummary {
    totalCostUsd: number;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    conversationCount: number;
    byModel: ModelStat[];
    byDay: DayStat[];
    topConversations: TopConversation[];
  }

  let period = $state<Period>('7d');
  let loading = $state(false);
  let data = $state<CostSummary | null>(null);
  let error = $state<string | null>(null);

  const PERIODS: Array<{ id: Period; label: string }> = [
    { id: 'today', label: 'Today' },
    { id: '7d', label: '7 days' },
    { id: '30d', label: '30 days' },
    { id: 'all', label: 'All time' },
  ];

  function getSinceTimestamp(p: Period): number | undefined {
    const now = Date.now();
    switch (p) {
      case 'today': {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d.getTime();
      }
      case '7d':
        return now - 7 * 24 * 60 * 60 * 1000;
      case '30d':
        return now - 30 * 24 * 60 * 60 * 1000;
      case 'all':
      default:
        return undefined;
    }
  }

  async function loadData() {
    loading = true;
    error = null;
    try {
      const workspacePath = settingsStore.workspacePath || '.';
      const since = getSinceTimestamp(period);
      const res = await api.costs.summary({ workspacePath, since });
      data = res.data;
    } catch (e: any) {
      error = e?.message || 'Failed to load cost data';
    } finally {
      loading = false;
    }
  }

  async function selectPeriod(p: Period) {
    period = p;
    await loadData();
  }

  onMount(() => {
    loadData();
  });

  // Helper functions
  function formatCost(usd: number): string {
    if (usd === 0) return '$0.00';
    if (usd < 0.01) return `$${usd.toFixed(4)}`;
    if (usd < 1) return `$${usd.toFixed(4)}`;
    return `$${usd.toFixed(2)}`;
  }

  function formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toString();
  }

  function formatDate(iso: string): string {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function shortModelName(model: string): string {
    // Strip vendor prefix and version info for compactness
    return model
      .replace(/^claude-/, '')
      .replace(/-\d{8}$/, '')
      .replace(/-20\d{6}$/, '');
  }

  // Derived: max model cost for bar scaling
  let maxModelCost = $derived(
    data ? Math.max(...data.byModel.map((m) => m.costUsd), 0.000001) : 0.000001,
  );

  // Derived: days to show in chart (last 7 or 14 depending on period)
  let chartDays = $derived((): DayStat[] => {
    if (!data) return [];
    const limit = period === '30d' || period === 'all' ? 14 : 7;
    return data.byDay.slice(-limit);
  });

  let maxDayCost = $derived(
    chartDays().length > 0 ? Math.max(...chartDays().map((d) => d.costUsd), 0.000001) : 0.000001,
  );

  let avgCostPerConv = $derived(
    data && data.conversationCount > 0 ? data.totalCostUsd / data.conversationCount : 0,
  );

  let topConvs = $derived(data ? data.topConversations.slice(0, 5) : []);
</script>

<div class="cost-panel">
  <!-- Period selector -->
  <div class="period-row">
    {#each PERIODS as p}
      <button
        class="period-chip"
        class:active={period === p.id}
        onclick={() => selectPeriod(p.id)}
        disabled={loading}
      >
        {p.label}
      </button>
    {/each}
  </div>

  {#if loading}
    <div class="loading-state">
      <span class="loading-text">Loading...</span>
    </div>
  {:else if error}
    <div class="error-state">
      <span class="error-text">{error}</span>
      <button class="retry-btn" onclick={loadData}>Retry</button>
    </div>
  {:else if !data}
    <div class="empty-state">No data available</div>
  {:else}
    <!-- Summary cards -->
    <div class="summary-grid">
      <div class="summary-card">
        <div class="card-label">Total Cost</div>
        <div class="card-value accent">{formatCost(data.totalCostUsd)}</div>
      </div>
      <div class="summary-card">
        <div class="card-label">Total Tokens</div>
        <div class="card-value">{formatTokens(data.totalTokens)}</div>
        <div class="card-sub">
          {formatTokens(data.inputTokens)}in / {formatTokens(data.outputTokens)}out
        </div>
      </div>
      <div class="summary-card">
        <div class="card-label">Conversations</div>
        <div class="card-value">{data.conversationCount}</div>
      </div>
      <div class="summary-card">
        <div class="card-label">Avg / Conv</div>
        <div class="card-value">{formatCost(avgCostPerConv)}</div>
      </div>
    </div>

    <!-- By Model -->
    {#if data.byModel.length > 0}
      <div class="section">
        <div class="section-label">By Model</div>
        <div class="model-list">
          {#each data.byModel as m}
            <div class="model-row">
              <div class="model-name" title={m.model}>{shortModelName(m.model)}</div>
              <div class="model-bar-wrap">
                <div
                  class="model-bar"
                  style:width="{Math.max((m.costUsd / maxModelCost) * 100, 2)}%"
                ></div>
              </div>
              <div class="model-cost">{formatCost(m.costUsd)}</div>
              <div class="model-tokens">{formatTokens(m.tokens)}</div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Spending by Day -->
    {#if chartDays().length > 0}
      <div class="section">
        <div class="section-label">Spending by Day</div>
        <div class="day-chart">
          {#each chartDays() as day}
            <div class="day-col" title="{formatDate(day.date)}: {formatCost(day.costUsd)}">
              <div class="day-bar-wrap">
                <div
                  class="day-bar"
                  style:height="{Math.max(
                    (day.costUsd / maxDayCost) * 100,
                    day.costUsd > 0 ? 2 : 0,
                  )}%"
                ></div>
              </div>
              <div class="day-label">{formatDate(day.date)}</div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Top Conversations -->
    {#if topConvs.length > 0}
      <div class="section">
        <div class="section-label">Top Conversations</div>
        <div class="conv-list">
          {#each topConvs as conv}
            <button
              class="conv-row"
              onclick={() => goto(`/conversation/${conv.id}`)}
              title="Open conversation"
            >
              <div class="conv-info">
                <div class="conv-title truncate">{conv.title || 'Untitled'}</div>
                <div class="conv-meta">
                  <span class="conv-model">{shortModelName(conv.model)}</span>
                  <span class="conv-tokens">{formatTokens(conv.tokens)}</span>
                </div>
              </div>
              <div class="conv-cost">{formatCost(conv.costUsd)}</div>
            </button>
          {/each}
        </div>
      </div>
    {:else}
      <div class="empty-state">No conversations in this period</div>
    {/if}
  {/if}
</div>

<style>
  .cost-panel {
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    height: 100%;
    overflow-y: auto;
    font-family: var(--font-family);
  }

  /* Period chips */
  .period-row {
    display: flex;
    gap: 2px;
  }
  .period-chip {
    flex: 1;
    padding: 5px 6px;
    font-size: var(--fs-xxs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: var(--text-tertiary);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    cursor: pointer;
    transition: all var(--transition);
    font-family: var(--font-family);
  }
  .period-chip:hover:not(:disabled) {
    color: var(--text-primary);
    border-color: var(--border-secondary);
  }
  .period-chip.active {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
    background: var(--bg-hover);
  }
  .period-chip:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Loading / error / empty */
  .loading-state,
  .empty-state {
    padding: 24px 0;
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--fs-sm);
  }
  .loading-text {
    color: var(--text-tertiary);
    font-size: var(--fs-sm);
    animation: pulse 1.4s ease-in-out infinite;
  }
  .error-state {
    padding: 16px;
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: center;
  }
  .error-text {
    font-size: var(--fs-xs);
    color: var(--accent-error);
  }
  .retry-btn {
    font-size: var(--fs-xs);
    padding: 4px 12px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all var(--transition);
    font-family: var(--font-family);
  }
  .retry-btn:hover {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
  }

  /* Summary grid */
  .summary-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
  }
  .summary-card {
    padding: 8px 10px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .card-label {
    font-size: var(--fs-xxs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-tertiary);
  }
  .card-value {
    font-size: var(--fs-lg);
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1.2;
    font-family: var(--font-family);
  }
  .card-value.accent {
    color: var(--accent-primary);
  }
  .card-sub {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    font-family: var(--font-family);
  }

  /* Sections */
  .section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .section-label {
    font-size: var(--fs-xxs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-tertiary);
    padding: 0 2px;
  }

  /* By model */
  .model-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .model-row {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--fs-xs);
  }
  .model-name {
    width: 88px;
    flex-shrink: 0;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--fs-xxs);
  }
  .model-bar-wrap {
    flex: 1;
    height: 6px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    overflow: hidden;
  }
  .model-bar {
    height: 100%;
    background: var(--accent-primary);
    transition: width 0.4s ease;
    min-width: 2px;
  }
  .model-cost {
    width: 52px;
    flex-shrink: 0;
    text-align: right;
    font-size: var(--fs-xs);
    color: var(--text-primary);
    font-family: var(--font-family);
  }
  .model-tokens {
    width: 40px;
    flex-shrink: 0;
    text-align: right;
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    font-family: var(--font-family);
  }

  /* Day chart */
  .day-chart {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 72px;
    padding-bottom: 20px;
    position: relative;
  }
  .day-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    height: 100%;
    position: relative;
    cursor: default;
  }
  .day-bar-wrap {
    flex: 1;
    width: 100%;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    min-height: 0;
  }
  .day-bar {
    width: 100%;
    background: var(--accent-primary);
    opacity: 0.75;
    min-height: 1px;
    transition: height 0.35s ease;
  }
  .day-col:hover .day-bar {
    opacity: 1;
  }
  .day-label {
    position: absolute;
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    white-space: nowrap;
    font-family: var(--font-family);
    line-height: 18px;
  }

  /* Top conversations */
  .conv-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .conv-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 8px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    cursor: pointer;
    transition: background var(--transition);
    text-align: left;
    width: 100%;
    font-family: var(--font-family);
  }
  .conv-row:hover {
    background: var(--bg-hover);
    border-color: var(--border-secondary);
  }
  .conv-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .conv-title {
    font-size: var(--fs-xs);
    color: var(--text-primary);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .conv-meta {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .conv-model {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    padding: 0 4px;
  }
  .conv-tokens {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    font-family: var(--font-family);
  }
  .conv-cost {
    font-size: var(--fs-sm);
    font-weight: 700;
    color: var(--accent-primary);
    flex-shrink: 0;
    font-family: var(--font-family);
  }

  .truncate {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.4;
    }
  }
</style>
