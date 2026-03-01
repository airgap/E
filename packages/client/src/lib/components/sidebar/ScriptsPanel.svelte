<script lang="ts">
  import { onMount } from 'svelte';
  import { taskRunnerStore } from '$lib/stores/task-runner.svelte';
  import { terminalStore } from '$lib/stores/terminal.svelte';
  import { workspaceStore } from '$lib/stores/workspace.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import type { WorkspaceTask } from '@e/shared';

  /** Resolve the current workspace path from available sources */
  function getWorkspacePath(): string | null {
    return workspaceStore.activeWorkspace?.workspacePath || settingsStore.workspacePath || null;
  }

  /** Load tasks on mount */
  onMount(() => {
    const wsPath = getWorkspacePath();
    if (wsPath) {
      taskRunnerStore.loadTasks(wsPath);
    }
  });

  /** Reactively reload tasks when workspace changes */
  $effect(() => {
    const wsPath = getWorkspacePath();
    if (wsPath && wsPath !== taskRunnerStore.workspacePath) {
      taskRunnerStore.loadTasks(wsPath);
    }
  });

  function runTask(task: WorkspaceTask) {
    taskRunnerStore.recordRecentTask(task.id);
    terminalStore.open();
    terminalStore.createTaskTab(task.execution, task.execution);
  }

  function refreshTasks() {
    taskRunnerStore.refreshTasks();
  }

  // Group tasks by source for display
  const groupedTasks = $derived.by(() => {
    const sorted = taskRunnerStore.sortedTasks;
    const hasRecent = sorted.some((t) => taskRunnerStore.isRecent(t.id));
    const recent: WorkspaceTask[] = [];
    const pkgTasks: WorkspaceTask[] = [];
    const makeTasks: WorkspaceTask[] = [];

    for (const task of sorted) {
      if (hasRecent && taskRunnerStore.isRecent(task.id)) {
        recent.push(task);
      } else if (task.source === 'package.json') {
        pkgTasks.push(task);
      } else if (task.source === 'Makefile') {
        makeTasks.push(task);
      }
    }

    return { recent, pkgTasks, makeTasks };
  });

  const pmLabel = $derived(taskRunnerStore.packageManager ?? 'npm');
</script>

<div class="scripts-panel">
  <!-- Header -->
  <div class="panel-header">
    <span class="panel-title">Scripts</span>
    <button
      class="refresh-btn"
      onclick={refreshTasks}
      title="Refresh task list"
      aria-label="Refresh task list"
      disabled={taskRunnerStore.loading}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        class:spinning={taskRunnerStore.loading}
      >
        <polyline points="23 4 23 10 17 10" />
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
      </svg>
    </button>
  </div>

  <!-- Content -->
  <div class="panel-content">
    {#if taskRunnerStore.loading && taskRunnerStore.tasks.length === 0}
      <div class="empty-state">
        <p>Loading tasks...</p>
      </div>
    {:else if !taskRunnerStore.hasTasks}
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
        <p>No scripts found</p>
        <p class="empty-hint">Add scripts to package.json or targets to a Makefile</p>
      </div>
    {:else}
      {@const groups = groupedTasks}

      <!-- Recent -->
      {#if groups.recent.length > 0}
        <div class="task-group">
          <div class="group-header">
            <svg class="group-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span>Recent</span>
          </div>
          {#each groups.recent as task (task.id)}
            <button
              class="task-row"
              onclick={() => runTask(task)}
              title={task.execution}
            >
              <svg class="play-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              <span class="task-name">{task.name}</span>
              <span class="task-source">
                {task.source === 'package.json' ? pmLabel : 'make'}
              </span>
            </button>
          {/each}
        </div>
      {/if}

      <!-- npm / package manager scripts -->
      {#if groups.pkgTasks.length > 0}
        <div class="task-group">
          <div class="group-header">
            <svg class="group-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20 21v-2a4 4 0 0 0-3-3.87M4 21v-2a4 4 0 0 1 3-3.87" />
              <rect x="2" y="2" width="20" height="8" rx="2" />
            </svg>
            <span>{pmLabel} scripts</span>
            <span class="group-count">{groups.pkgTasks.length}</span>
          </div>
          {#each groups.pkgTasks as task (task.id)}
            <button
              class="task-row"
              onclick={() => runTask(task)}
              title={task.execution}
            >
              <svg class="play-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              <div class="task-info">
                <span class="task-name">{task.name}</span>
                <span class="task-command">{task.command}</span>
              </div>
            </button>
          {/each}
        </div>
      {/if}

      <!-- Makefile targets -->
      {#if groups.makeTasks.length > 0}
        <div class="task-group">
          <div class="group-header">
            <svg class="group-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
            </svg>
            <span>Makefile targets</span>
            <span class="group-count">{groups.makeTasks.length}</span>
          </div>
          {#each groups.makeTasks as task (task.id)}
            <button
              class="task-row"
              onclick={() => runTask(task)}
              title={task.execution}
            >
              <svg class="play-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              <span class="task-name">{task.name}</span>
            </button>
          {/each}
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .scripts-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    font-size: var(--fs-sm);
  }

  /* ── Header ── */
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .panel-title {
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .refresh-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 4px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    padding: 0;
    transition: color 0.12s, background 0.12s;
  }

  .refresh-btn svg {
    width: 13px;
    height: 13px;
  }

  .refresh-btn:hover {
    color: var(--text);
    background: var(--bg-hover);
  }

  .refresh-btn:disabled {
    opacity: 0.4;
    cursor: default;
    pointer-events: none;
  }

  .spinning {
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  /* ── Content ── */
  .panel-content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
  }

  /* ── Groups ── */
  .task-group {
    padding-bottom: 4px;
    border-bottom: 1px solid var(--border);
  }

  .task-group:last-child {
    border-bottom: none;
  }

  .group-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px 4px;
    font-size: var(--fs-xxs);
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .group-icon {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
    opacity: 0.6;
  }

  .group-count {
    margin-left: auto;
    font-weight: 500;
    opacity: 0.5;
    font-size: var(--fs-xxs);
  }

  /* ── Task rows ── */
  .task-row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 5px 10px 5px 16px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--fs-xs);
    cursor: pointer;
    text-align: left;
    transition: background 0.1s, color 0.1s;
  }

  .task-row:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .play-icon {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
    opacity: 0;
    color: var(--accent);
    transition: opacity 0.1s;
  }

  .task-row:hover .play-icon {
    opacity: 1;
  }

  .task-info {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: 1px;
  }

  .task-name {
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .task-command {
    color: var(--text-muted);
    font-size: var(--fs-xxs);
    font-family: var(--font-mono, monospace);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    opacity: 0.7;
  }

  .task-source {
    margin-left: auto;
    color: var(--text-muted);
    font-size: var(--fs-xxs);
    opacity: 0.5;
    flex-shrink: 0;
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
