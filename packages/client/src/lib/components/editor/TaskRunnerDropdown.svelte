<script lang="ts">
  import { onMount } from 'svelte';
  import { taskRunnerStore } from '$lib/stores/task-runner.svelte';
  import { terminalStore } from '$lib/stores/terminal.svelte';
  import { workspaceStore } from '$lib/stores/workspace.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import type { WorkspaceTask } from '@e/shared';

  let dropdownOpen = $state(false);

  /** Get the current workspace path from available sources */
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

  function toggleDropdown(e: MouseEvent) {
    e.stopPropagation();
    dropdownOpen = !dropdownOpen;
  }

  function closeDropdown() {
    dropdownOpen = false;
  }

  function runTask(task: WorkspaceTask) {
    dropdownOpen = false;

    // Record this task as recently run
    taskRunnerStore.recordRecentTask(task.id);

    // Open terminal panel and create a task tab with the command
    // The command will be sent to the terminal after the session connects
    terminalStore.open();
    terminalStore.createTaskTab(task.execution, task.execution);
  }

  function refreshTasks(e: MouseEvent) {
    e.stopPropagation();
    taskRunnerStore.refreshTasks();
  }

  /**
   * Keyboard navigation within the task dropdown (WAI-ARIA menu pattern).
   */
  function onTaskDropdownKeydown(e: KeyboardEvent) {
    const items = Array.from(
      document.querySelectorAll('.task-dropdown .task-option'),
    ) as HTMLElement[];
    if (items.length === 0) return;

    const currentIndex = items.findIndex((el) => el === document.activeElement);

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const next = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
        items[next].focus();
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const prev = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
        items[prev].focus();
        break;
      }
      case 'Home': {
        e.preventDefault();
        items[0].focus();
        break;
      }
      case 'End': {
        e.preventDefault();
        items[items.length - 1].focus();
        break;
      }
      case 'Escape': {
        e.preventDefault();
        e.stopPropagation();
        closeDropdown();
        break;
      }
    }
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
</script>

<svelte:window onclick={closeDropdown} />

<div class="task-runner-wrapper">
  <button
    class="action-btn"
    class:active={dropdownOpen}
    onclick={toggleDropdown}
    title="Run task"
    aria-label="Run task"
    aria-haspopup="menu"
    aria-expanded={dropdownOpen}
    onkeydown={(e) => {
      if (e.key === 'Escape' && dropdownOpen) {
        e.preventDefault();
        e.stopPropagation();
        closeDropdown();
      } else if ((e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') && !dropdownOpen) {
        e.preventDefault();
        dropdownOpen = true;
        requestAnimationFrame(() => {
          const firstItem = document.querySelector('.task-dropdown .task-option') as HTMLElement;
          firstItem?.focus();
        });
      }
    }}
  >
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  </button>

  {#if dropdownOpen}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="task-dropdown"
      role="menu"
      aria-label="Available tasks"
      onclick={(e) => e.stopPropagation()}
      onkeydown={onTaskDropdownKeydown}
    >
      <div class="dropdown-header">
        <span class="dropdown-title">Tasks</span>
        <button
          class="refresh-btn"
          onclick={refreshTasks}
          title="Refresh task list"
          aria-label="Refresh task list"
          disabled={taskRunnerStore.loading}
        >
          <svg
            width="12"
            height="12"
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

      {#if taskRunnerStore.loading && taskRunnerStore.tasks.length === 0}
        <div class="dropdown-empty">Loading tasks...</div>
      {:else if !taskRunnerStore.hasTasks}
        <div class="dropdown-empty">No tasks found</div>
        <div class="dropdown-hint">Add scripts to package.json or targets to a Makefile</div>
      {:else}
        {@const groups = groupedTasks}

        {#if groups.recent.length > 0}
          <div class="task-group-label">Recent</div>
          {#each groups.recent as task (task.id)}
            <button
              class="task-option"
              role="menuitem"
              onclick={() => runTask(task)}
              title={task.execution}
            >
              <svg
                class="task-icon"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span class="task-name">{task.name}</span>
              <span class="task-source"
                >{task.source === 'package.json'
                  ? (taskRunnerStore.packageManager ?? 'npm')
                  : 'make'}</span
              >
            </button>
          {/each}
          <div class="task-separator"></div>
        {/if}

        {#if groups.pkgTasks.length > 0}
          <div class="task-group-label">
            {taskRunnerStore.packageManager ?? 'npm'} scripts
          </div>
          {#each groups.pkgTasks as task (task.id)}
            <button
              class="task-option"
              role="menuitem"
              onclick={() => runTask(task)}
              title={task.execution}
            >
              <svg
                class="task-icon"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              <span class="task-name">{task.name}</span>
              <span class="task-command" title={task.command}>{task.command}</span>
            </button>
          {/each}
        {/if}

        {#if groups.makeTasks.length > 0}
          {#if groups.pkgTasks.length > 0}
            <div class="task-separator"></div>
          {/if}
          <div class="task-group-label">Makefile targets</div>
          {#each groups.makeTasks as task (task.id)}
            <button
              class="task-option"
              role="menuitem"
              onclick={() => runTask(task)}
              title={task.execution}
            >
              <svg
                class="task-icon"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              <span class="task-name">{task.name}</span>
            </button>
          {/each}
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  .task-runner-wrapper {
    position: relative;
    display: flex;
    align-items: center;
  }

  .action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: var(--radius-sm);
    border: none;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    transition:
      color var(--transition),
      background var(--transition);
    padding: 0;
  }
  .action-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }
  .action-btn.active {
    color: var(--accent-primary);
    background: var(--bg-active);
  }
  .action-btn svg {
    width: 14px;
    height: 14px;
  }

  .task-dropdown {
    position: absolute;
    top: 100%;
    right: 0;
    z-index: 100;
    min-width: 240px;
    max-width: 360px;
    max-height: 400px;
    overflow-y: auto;
    background: var(--bg-elevated);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg, 0 8px 24px rgba(0, 0, 0, 0.4));
    padding: 4px;
    margin-top: 2px;
  }

  .dropdown-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 8px;
    border-bottom: 1px solid var(--border-secondary);
    margin-bottom: 4px;
  }

  .dropdown-title {
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
    width: 20px;
    height: 20px;
    border-radius: var(--radius-sm);
    border: none;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    transition:
      color var(--transition),
      background var(--transition);
    padding: 0;
  }
  .refresh-btn:hover {
    color: var(--text-primary);
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
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .dropdown-empty {
    padding: 12px 10px 4px;
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    text-align: center;
  }

  .dropdown-hint {
    padding: 2px 10px 12px;
    font-size: var(--fs-sans-xxs);
    color: var(--text-quaternary, var(--text-tertiary));
    text-align: center;
    opacity: 0.7;
  }

  .task-group-label {
    padding: 6px 10px 2px;
    font-size: var(--fs-sans-xxs);
    font-weight: 600;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .task-separator {
    height: 1px;
    background: var(--border-secondary);
    margin: 4px 6px;
  }

  .task-option {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 5px 10px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--fs-xs);
    cursor: pointer;
    text-align: left;
    transition:
      background var(--transition),
      color var(--transition);
    white-space: nowrap;
  }
  .task-option:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .task-icon {
    flex-shrink: 0;
    opacity: 0.5;
  }
  .task-option:hover .task-icon {
    opacity: 0.8;
    color: var(--accent-secondary);
  }

  .task-name {
    font-weight: 500;
    flex-shrink: 0;
  }

  .task-command {
    color: var(--text-tertiary);
    font-size: var(--fs-sans-xxs);
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }

  .task-source {
    color: var(--text-tertiary);
    font-size: var(--fs-sans-xxs);
    opacity: 0.7;
    flex-shrink: 0;
  }
</style>
