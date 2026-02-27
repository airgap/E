<!-- @deprecated Use WorkPanel.svelte instead. This component is no longer mounted. -->
<script lang="ts">
  import { taskStore } from '$lib/stores/tasks.svelte';
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { api } from '$lib/api/client';
  import { onMount } from 'svelte';

  let newSubject = $state('');

  onMount(async () => {
    try {
      const res = await api.tasks.list(conversationStore.activeId ?? undefined);
      taskStore.setTasks(res.data);
    } catch {}
  });

  async function addTask() {
    if (!newSubject.trim()) return;
    const res = await api.tasks.create({
      subject: newSubject.trim(),
      description: '',
      conversationId: conversationStore.activeId ?? undefined,
    });
    taskStore.addTask({
      id: res.data.id,
      subject: newSubject.trim(),
      description: '',
      status: 'pending',
      blocks: [],
      blockedBy: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    newSubject = '';
  }

  async function toggleStatus(taskId: string, currentStatus: string) {
    const next =
      currentStatus === 'pending'
        ? 'in_progress'
        : currentStatus === 'in_progress'
          ? 'completed'
          : 'pending';
    await api.tasks.update(taskId, { status: next });
    taskStore.updateTask(taskId, { status: next as any });
  }

  async function deleteTask(taskId: string) {
    await api.tasks.delete(taskId);
    taskStore.removeTask(taskId);
  }

  const statusIcons: Record<string, string> = {
    pending: 'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2z',
    in_progress: 'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zM12 6v6l4 2',
    completed: 'M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4L12 14.01l-3-3',
  };
</script>

<div class="task-panel">
  <div class="task-header">
    <h3>Tasks</h3>
    <span class="task-count">{taskStore.count}</span>
  </div>

  <div class="add-task">
    <input
      type="text"
      bind:value={newSubject}
      placeholder="Add a task..."
      onkeydown={(e) => e.key === 'Enter' && addTask()}
    />
  </div>

  <div class="task-sections">
    {#if taskStore.inProgress.length > 0}
      <div class="section">
        <div class="section-label">In Progress</div>
        {#each taskStore.inProgress as task (task.id)}
          <div class="task-item in-progress">
            <button class="status-btn" onclick={() => toggleStatus(task.id, task.status)}>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d={statusIcons[task.status]} />
              </svg>
            </button>
            <div class="task-info">
              <span class="task-subject">{task.subject}</span>
              {#if task.activeForm}
                <span class="task-active">{task.activeForm}</span>
              {/if}
            </div>
            <button class="delete-btn" onclick={() => deleteTask(task.id)}>x</button>
          </div>
        {/each}
      </div>
    {/if}

    {#if taskStore.pending.length > 0}
      <div class="section">
        <div class="section-label">Pending</div>
        {#each taskStore.pending as task (task.id)}
          <div class="task-item pending" class:blocked={taskStore.isBlocked(task.id)}>
            <button class="status-btn" onclick={() => toggleStatus(task.id, task.status)}>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d={statusIcons[task.status]} />
              </svg>
            </button>
            <span class="task-subject">{task.subject}</span>
            <button class="delete-btn" onclick={() => deleteTask(task.id)}>x</button>
          </div>
        {/each}
      </div>
    {/if}

    {#if taskStore.completed.length > 0}
      <div class="section">
        <div class="section-label">Completed</div>
        {#each taskStore.completed as task (task.id)}
          <div class="task-item completed">
            <button class="status-btn" onclick={() => toggleStatus(task.id, task.status)}>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d={statusIcons[task.status]} />
              </svg>
            </button>
            <span class="task-subject">{task.subject}</span>
            <button class="delete-btn" onclick={() => deleteTask(task.id)}>x</button>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .task-panel {
    padding: 8px;
  }

  .task-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 4px 8px;
  }
  .task-header h3 {
    font-size: var(--fs-base);
    font-weight: 600;
  }
  .task-count {
    font-size: var(--fs-xs);
    padding: 1px 6px;
    background: var(--bg-tertiary);
    border-radius: 10px;
    color: var(--text-tertiary);
  }

  .add-task {
    margin-bottom: 8px;
  }
  .add-task input {
    width: 100%;
    font-size: var(--fs-sm);
    padding: 6px 8px;
  }

  .section-label {
    font-size: var(--fs-xxs);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-tertiary);
    padding: 6px 4px 4px;
  }

  .task-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 4px;
    border-radius: var(--radius-sm);
    font-size: var(--fs-sm);
  }
  .task-item:hover {
    background: var(--bg-hover);
  }

  .task-subject {
    flex: 1;
    color: var(--text-primary);
  }
  .completed .task-subject {
    text-decoration: line-through;
    color: var(--text-tertiary);
  }
  .blocked .task-subject {
    color: var(--text-tertiary);
  }

  .task-active {
    font-size: var(--fs-xxs);
    color: var(--accent-primary);
    animation: pulse 2s infinite;
  }

  .task-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .status-btn {
    display: flex;
    width: 24px;
    height: 24px;
    align-items: center;
    justify-content: center;
    color: var(--text-tertiary);
    flex-shrink: 0;
  }
  .in-progress .status-btn {
    color: var(--accent-primary);
  }
  .completed .status-btn {
    color: var(--accent-secondary);
  }

  .delete-btn {
    display: none;
    width: 24px;
    height: 24px;
    font-size: var(--fs-xxs);
    align-items: center;
    justify-content: center;
    color: var(--text-tertiary);
    border-radius: 3px;
  }
  .task-item:hover .delete-btn {
    display: flex;
  }
  .delete-btn:hover {
    background: var(--accent-error);
    color: var(--text-on-accent);
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }
</style>
