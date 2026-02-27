<script lang="ts">
  import { onMount } from 'svelte';
  import { artifactsStore } from '$lib/stores/artifacts.svelte';
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import type { Artifact } from '@e/shared';

  let filter = $state<'all' | 'plan' | 'diff' | 'screenshot' | 'walkthrough' | 'report' | 'pinned'>(
    'all',
  );

  let conversationId = $derived(conversationStore.activeId);

  let filteredArtifacts = $derived.by(() => {
    const all = artifactsStore.artifacts;
    if (filter === 'pinned') return all.filter((a) => a.pinned);
    if (filter === 'all') return all;
    return all.filter((a) => a.type === filter);
  });

  // Load when conversation changes
  $effect(() => {
    if (conversationId) {
      artifactsStore.load(conversationId);
    } else {
      artifactsStore.clear();
    }
  });

  const typeIconPaths: Record<string, string> = {
    plan: 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2 M15 2H9a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1z',
    diff: 'M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z',
    screenshot:
      'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    walkthrough: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
    report:
      'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8',
  };
  const defaultIconPath = 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6';
  const pinIconPath = 'M12 17l-5 3 1.5-5.6L4 10.5l5.8-.5L12 5l2.2 5 5.8.5-4.5 3.9L17 20z';

  const typeLabels: Record<string, string> = {
    plan: 'Plan',
    diff: 'Diff',
    screenshot: 'Screenshot',
    walkthrough: 'Walkthrough',
    report: 'Report',
  };

  let expandedId = $state<string | null>(null);

  function toggleExpand(id: string) {
    expandedId = expandedId === id ? null : id;
  }

  async function togglePin(artifact: Artifact) {
    await artifactsStore.togglePin(artifact.id);
  }

  async function deleteArtifact(artifact: Artifact) {
    await artifactsStore.remove(artifact.id);
    if (expandedId === artifact.id) expandedId = null;
  }

  function formatDate(ts: number) {
    return new Date(ts).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
</script>

<div class="artifacts-panel">
  <div class="panel-header">
    <span class="panel-title">Artifacts</span>
    <span class="panel-count">{artifactsStore.count}</span>
  </div>

  <!-- Filter tabs -->
  <div class="filter-tabs">
    {#each ['all', 'pinned', 'plan', 'diff', 'walkthrough', 'screenshot', 'report'] as f}
      <button
        class="filter-tab"
        class:active={filter === f}
        onclick={() => (filter = f as typeof filter)}
      >
        {#if f === 'all'}All
        {:else if f === 'pinned'}<svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"><path d={pinIconPath} /></svg
          > Pinned
        {:else}<svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"><path d={typeIconPaths[f] ?? defaultIconPath} /></svg
          >
          {typeLabels[f] ?? f}
        {/if}
      </button>
    {/each}
  </div>

  <!-- Artifact list -->
  <div class="artifact-list">
    {#if artifactsStore.loading}
      <div class="empty-state">Loading...</div>
    {:else if !conversationId}
      <div class="empty-state">Open a conversation to see its artifacts.</div>
    {:else if filteredArtifacts.length === 0}
      <div class="empty-state">
        {#if filter === 'pinned'}
          No pinned artifacts yet. Pin artifacts for quick reference.
        {:else if filter === 'all'}
          No artifacts yet. Agents emit artifacts using <code>&lt;artifact&gt;</code> blocks.
        {:else}
          No {filter} artifacts in this conversation.
        {/if}
      </div>
    {:else}
      {#each filteredArtifacts as artifact (artifact.id)}
        <div class="artifact-item" class:expanded={expandedId === artifact.id}>
          <!-- Header row -->
          <div class="artifact-item-header">
            <button
              class="artifact-expand-btn"
              onclick={() => toggleExpand(artifact.id)}
              title="Expand artifact"
            >
              <span class="artifact-icon"
                ><svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  ><path d={typeIconPaths[artifact.type] ?? defaultIconPath} /></svg
                ></span
              >
              <span class="artifact-type-badge">{typeLabels[artifact.type] ?? artifact.type}</span>
              <span class="artifact-name">{artifact.title}</span>
              <span class="artifact-chevron" class:rotated={expandedId === artifact.id}>
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </span>
            </button>
            <div class="artifact-actions">
              <button
                class="artifact-action-btn"
                class:active={artifact.pinned}
                onclick={() => togglePin(artifact)}
                title={artifact.pinned ? 'Unpin' : 'Pin for quick reference'}
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill={artifact.pinned ? 'currentColor' : 'none'}
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                  <circle cx="12" cy="10" r="3"></circle>
                </svg>
              </button>
              <button
                class="artifact-action-btn danger"
                onclick={() => deleteArtifact(artifact)}
                title="Delete artifact"
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path d="M18 6L6 18M6 6l12 12"></path>
                </svg>
              </button>
            </div>
          </div>

          <!-- Meta row -->
          <div class="artifact-meta">
            <span class="artifact-date">{formatDate(artifact.createdAt)}</span>
            {#if artifact.pinned}
              <span class="artifact-pinned-badge"
                ><svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"><path d={pinIconPath} /></svg
                > Pinned</span
              >
            {/if}
          </div>

          <!-- Expanded content -->
          {#if expandedId === artifact.id}
            <div class="artifact-content">
              {#if artifact.type === 'diff'}
                <pre class="artifact-diff">{artifact.content}</pre>
              {:else}
                <pre class="artifact-raw">{artifact.content}</pre>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .artifacts-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .panel-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 14px 8px;
    border-bottom: 1px solid var(--border-secondary);
    flex-shrink: 0;
  }

  .panel-title {
    font-size: var(--fs-sm);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-secondary);
  }

  .panel-count {
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-tertiary);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    border-radius: 10px;
    padding: 0 6px;
    min-width: 18px;
    text-align: center;
  }

  .filter-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border-secondary);
    flex-shrink: 0;
  }

  .filter-tab {
    font-size: var(--fs-xs);
    font-weight: 600;
    padding: 3px 8px;
    border-radius: var(--radius-sm);
    background: transparent;
    border: 1px solid var(--border-secondary);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all var(--transition);
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }

  .filter-tab:hover {
    border-color: var(--border-primary);
    color: var(--text-primary);
  }

  .filter-tab.active {
    background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }

  .artifact-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
  }

  .empty-state {
    color: var(--text-tertiary);
    font-size: var(--fs-sm);
    text-align: center;
    padding: 24px 16px;
    line-height: 1.6;
  }

  .empty-state code {
    font-family: var(--font-family-mono, monospace);
    font-size: var(--fs-xs);
    background: var(--bg-tertiary);
    padding: 1px 4px;
    border-radius: 3px;
    color: var(--accent-primary);
  }

  .artifact-item {
    border-bottom: 1px solid var(--border-secondary);
    transition: background var(--transition);
  }

  .artifact-item:hover {
    background: var(--bg-hover);
  }

  .artifact-item.expanded {
    background: var(--bg-hover);
  }

  .artifact-item-header {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 8px 0 0;
  }

  .artifact-expand-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    padding: 8px 10px;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    color: var(--text-primary);
    min-width: 0;
  }

  .artifact-icon {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    color: var(--text-tertiary);
  }

  .artifact-type-badge {
    font-size: var(--fs-xxs);
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent);
    border-radius: 3px;
    padding: 1px 5px;
    flex-shrink: 0;
  }

  .artifact-name {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-primary);
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .artifact-chevron {
    flex-shrink: 0;
    color: var(--text-tertiary);
    transition: transform var(--transition);
    display: flex;
    align-items: center;
  }

  .artifact-chevron.rotated {
    transform: rotate(180deg);
  }

  .artifact-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  .artifact-action-btn {
    width: 20px;
    height: 20px;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid transparent;
    cursor: pointer;
    color: var(--text-tertiary);
    transition: all var(--transition);
    padding: 0;
  }

  .artifact-action-btn:hover {
    color: var(--accent-primary);
    border-color: var(--border-primary);
    background: var(--bg-secondary);
  }

  .artifact-action-btn.active {
    color: var(--accent-primary);
  }

  .artifact-action-btn.danger:hover {
    color: var(--accent-error);
    border-color: var(--accent-error);
  }

  .artifact-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px 6px;
  }

  .artifact-date {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
  }

  .artifact-pinned-badge {
    font-size: var(--fs-xxs);
    color: var(--accent-primary);
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 3px;
  }

  .artifact-content {
    padding: 0 10px 10px;
    max-height: 300px;
    overflow-y: auto;
  }

  .artifact-diff {
    font-family: var(--font-family-mono, monospace);
    font-size: var(--fs-xs);
    line-height: 1.5;
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-all;
    background: var(--bg-secondary);
    border-radius: var(--radius-sm);
    padding: 8px;
    margin: 0;
  }

  .artifact-raw {
    font-family: var(--font-family-mono, monospace);
    font-size: var(--fs-xs);
    line-height: 1.5;
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-word;
    background: var(--bg-secondary);
    border-radius: var(--radius-sm);
    padding: 8px;
    margin: 0;
  }
</style>
