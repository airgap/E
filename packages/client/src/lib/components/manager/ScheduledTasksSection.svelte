<script lang="ts">
  import { scheduledTasksApi } from '$lib/api/scheduled-tasks';
  import { onMount } from 'svelte';
  import type { ScheduledTaskWithStats } from '@e/shared';

  interface Props {
    workspaceId: string;
    workspaceName: string;
  }

  let { workspaceId, workspaceName }: Props = $props();

  let tasks = $state<ScheduledTaskWithStats[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);

  async function loadTasks() {
    loading = true;
    error = null;
    try {
      tasks = await scheduledTasksApi.list(workspaceId);
    } catch (e: any) {
      error = e?.message ?? 'Failed to load tasks';
    } finally {
      loading = false;
    }
  }

  async function pauseTask(taskId: string) {
    try {
      await scheduledTasksApi.pause(taskId);
      await loadTasks();
    } catch (e: any) {
      error = e?.message ?? 'Failed to pause task';
    }
  }

  async function resumeTask(taskId: string) {
    try {
      await scheduledTasksApi.resume(taskId);
      await loadTasks();
    } catch (e: any) {
      error = e?.message ?? 'Failed to resume task';
    }
  }

  async function runTask(taskId: string) {
    try {
      await scheduledTasksApi.runNow(taskId);
      await loadTasks();
    } catch (e: any) {
      error = e?.message ?? 'Failed to run task';
    }
  }

  function formatNextRun(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = timestamp - now.getTime();

    // If less than 1 hour, show minutes
    if (diff < 60 * 60 * 1000) {
      const minutes = Math.floor(diff / (60 * 1000));
      return minutes <= 0 ? 'now' : `in ${minutes}m`;
    }

    // If less than 24 hours, show hours
    if (diff < 24 * 60 * 60 * 1000) {
      const hours = Math.floor(diff / (60 * 60 * 1000));
      return `in ${hours}h`;
    }

    // Otherwise show date
    return date.toLocaleDateString();
  }

  function formatSchedule(task: ScheduledTaskWithStats): string {
    if (task.cronExpression) {
      return `Cron: ${task.cronExpression}`;
    }
    if (task.intervalMinutes) {
      if (task.intervalMinutes < 60) {
        return `Every ${task.intervalMinutes}m`;
      }
      const hours = task.intervalMinutes / 60;
      if (hours === 24) return 'Daily';
      if (hours % 24 === 0) return `Every ${hours / 24}d`;
      return `Every ${hours}h`;
    }
    return 'Unknown';
  }

  onMount(() => {
    loadTasks();
    // Refresh every 30 seconds
    const interval = setInterval(loadTasks, 30_000);
    return () => clearInterval(interval);
  });
</script>

{#if loading}
  <div class="loading">Loading tasks...</div>
{:else if error}
  <div class="error">{error}</div>
{:else if tasks.length > 0}
  <div class="tasks-list">
    {#each tasks as task (task.id)}
      <div class="task-card" class:paused={task.status === 'paused'}>
        <div class="task-header">
          <span class="task-name">{task.name}</span>
          <div class="task-controls">
            {#if task.status === 'active'}
              <button class="control-btn" onclick={() => pauseTask(task.id)} title="Pause task">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <rect x="6" y="4" width="4" height="16"></rect>
                  <rect x="14" y="4" width="4" height="16"></rect>
                </svg>
              </button>
            {:else}
              <button class="control-btn" onclick={() => resumeTask(task.id)} title="Resume task">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polygon points="5 3 19 12 5 21 5 3"></polygon>
                </svg>
              </button>
            {/if}
            <button class="control-btn" onclick={() => runTask(task.id)} title="Run now">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
            </button>
          </div>
        </div>
        <div class="task-info">
          <span class="task-schedule">{formatSchedule(task)}</span>
          {#if task.nextRun && task.status === 'active'}
            <span class="task-next">Next: {formatNextRun(task.nextRun)}</span>
          {/if}
        </div>
        {#if task.totalExecutions > 0}
          <div class="task-stats">
            <span class="stat">
              {task.totalExecutions} run{task.totalExecutions !== 1 ? 's' : ''}
            </span>
            {#if task.lastExecutionStatus}
              <span
                class="stat-badge"
                class:success={task.lastExecutionStatus === 'success'}
                class:failed={task.lastExecutionStatus === 'failed'}
              >
                {task.lastExecutionStatus}
              </span>
            {/if}
          </div>
        {/if}
      </div>
    {/each}
  </div>
{:else}
  <div class="empty">No scheduled tasks for this workspace</div>
{/if}

<style>
  .loading,
  .error,
  .empty {
    padding: 12px;
    font-size: 13px;
    color: var(--text-secondary);
    text-align: center;
  }

  .error {
    color: var(--accent-error);
  }

  .tasks-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .task-card {
    padding: 10px;
    background: var(--bg-secondary);
    border-radius: 6px;
    border: 1px solid var(--border-primary);
    transition: all 0.2s ease;
  }

  .task-card.paused {
    opacity: 0.6;
  }

  .task-card:hover {
    background: var(--bg-tertiary);
  }

  .task-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }

  .task-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
  }

  .task-controls {
    display: flex;
    gap: 4px;
  }

  .control-btn {
    padding: 4px;
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
  }

  .control-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .task-info {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--text-secondary);
    margin-bottom: 4px;
  }

  .task-schedule {
    font-family: var(--font-mono);
  }

  .task-next {
    color: var(--accent-primary);
  }

  .task-stats {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--text-tertiary);
  }

  .stat-badge {
    padding: 2px 6px;
    border-radius: 3px;
    font-weight: 500;
    text-transform: uppercase;
    font-size: 10px;
  }

  .stat-badge.success {
    background: var(--accent-success, #10b981);
    color: white;
  }

  .stat-badge.failed {
    background: var(--accent-error);
    color: white;
  }
</style>
