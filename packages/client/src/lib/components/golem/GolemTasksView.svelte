<script lang="ts">
  import { golemsStore, type GolemStatus } from '$lib/stores/golems.svelte';
  import GolemTaskColumn from './GolemTaskColumn.svelte';

  let { loopId }: { loopId: string } = $props();

  let golem = $derived(golemsStore.golems.find((g) => g.id === loopId) ?? null);
  let taskConversations = $derived(golem?.taskConversations ?? []);

  function getStatusLabel(status: GolemStatus['status']): string {
    switch (status) {
      case 'running':
        return 'Active';
      case 'paused':
        return 'Paused';
      case 'completed':
        return 'Complete';
      case 'completed_with_failures':
        return 'Partial';
      case 'failed':
        return 'Failed';
      case 'cancelled':
        return 'Cancelled';
      default:
        return 'Idle';
    }
  }

  function getStatusClass(status: GolemStatus['status']): string {
    switch (status) {
      case 'running':
        return 'status-running';
      case 'paused':
        return 'status-paused';
      case 'completed':
        return 'status-completed';
      case 'failed':
        return 'status-failed';
      case 'cancelled':
        return 'status-cancelled';
      default:
        return 'status-idle';
    }
  }

  function formatElapsed(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }
</script>

<div class="golem-tasks-view">
  <!-- Header bar -->
  <div class="tasks-header">
    <div class="header-left">
      <span class="golem-label">{golem?.label ?? 'Golem'}</span>
      {#if golem}
        <span class="golem-status {getStatusClass(golem.status)}"
          >{getStatusLabel(golem.status)}</span
        >
      {/if}
    </div>
    <div class="header-right">
      {#if golem}
        <span class="task-count">
          {taskConversations.length} active task{taskConversations.length !== 1 ? 's' : ''}
        </span>
        <span class="separator">|</span>
        <span class="progress-info">{golem.storiesCompleted}/{golem.totalStories} stories</span>
        <span class="separator">|</span>
        <span class="elapsed">{formatElapsed(golem.elapsedMs)}</span>
      {/if}
    </div>
  </div>

  <!-- Task columns -->
  {#if taskConversations.length === 0}
    <div class="tasks-empty">
      {#if golem?.status === 'running'}
        <div class="empty-icon">
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <path
              d="M12 2a4 4 0 0 0-4 4v1H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2V6a4 4 0 0 0-4-4z"
            />
            <circle cx="9" cy="13" r="1.5" />
            <circle cx="15" cy="13" r="1.5" />
          </svg>
        </div>
        <p class="empty-title">Waiting for tasks to start...</p>
        <p class="empty-hint">
          The golem is running. Task streams will appear here as stories are dispatched.
        </p>
      {:else if golem?.status === 'paused'}
        <div class="empty-icon paused">
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <rect x="6" y="4" width="4" height="16" />
            <rect x="14" y="4" width="4" height="16" />
          </svg>
        </div>
        <p class="empty-title">Golem is paused</p>
        <p class="empty-hint">Resume the golem from the sidebar to continue working.</p>
      {:else}
        <p class="empty-title">No active tasks</p>
        <p class="empty-hint">
          {#if golem}
            The golem has finished. {golem.storiesCompleted} stories completed.
          {:else}
            No golem found for this loop.
          {/if}
        </p>
      {/if}
    </div>
  {:else}
    <div class="tasks-columns" style:--col-count={taskConversations.length}>
      {#each taskConversations as tc (tc.storyId)}
        <GolemTaskColumn conversationId={tc.conversationId} storyTitle={tc.storyTitle} />
      {/each}
    </div>
  {/if}
</div>

<style>
  .golem-tasks-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }

  /* ── Header ── */
  .tasks-header {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 14px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-primary);
    gap: 12px;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .golem-label {
    font-size: var(--fs-sm);
    font-weight: 700;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .golem-status {
    font-size: var(--fs-xxs);
    padding: 1px 6px;
    font-weight: 700;
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
    border: 1px solid;
    flex-shrink: 0;
  }

  .status-running {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
  }

  .status-paused {
    color: var(--accent-warning);
    border-color: var(--accent-warning);
    background: color-mix(in srgb, var(--accent-warning) 10%, transparent);
  }

  .status-completed {
    color: var(--accent-secondary);
    border-color: var(--accent-secondary);
    background: color-mix(in srgb, var(--accent-secondary) 10%, transparent);
  }

  .status-failed {
    color: var(--accent-error);
    border-color: var(--accent-error);
    background: color-mix(in srgb, var(--accent-error) 10%, transparent);
  }

  .status-cancelled,
  .status-idle {
    color: var(--text-tertiary);
    border-color: var(--border-secondary);
    background: var(--bg-tertiary);
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    flex-shrink: 0;
  }

  .task-count {
    font-weight: 600;
    color: var(--accent-primary);
  }

  .separator {
    opacity: 0.3;
  }

  .progress-info {
    font-weight: 600;
  }

  .elapsed {
    font-family: var(--font-mono, monospace);
  }

  /* ── Empty state ── */
  .tasks-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 40px 24px;
    text-align: center;
  }

  .empty-icon {
    color: var(--text-tertiary);
    opacity: 0.4;
    animation: emptyFloat 4s ease-in-out infinite;
  }

  .empty-icon.paused {
    animation: none;
    opacity: 0.3;
  }

  @keyframes emptyFloat {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-6px);
    }
  }

  .empty-title {
    font-size: var(--fs-md);
    font-weight: 700;
    color: var(--text-secondary);
    margin: 0;
  }

  .empty-hint {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    line-height: 1.5;
    max-width: 300px;
    margin: 0;
  }

  /* ── Task columns ── */
  .tasks-columns {
    flex: 1;
    display: flex;
    flex-direction: row;
    min-height: 0;
    overflow-x: auto;
  }

  .tasks-columns > :global(*) {
    flex: 1;
    min-width: 350px;
  }
</style>
