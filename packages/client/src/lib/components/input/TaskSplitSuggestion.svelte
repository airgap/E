<script lang="ts">
  import type { DetectedTask } from '$lib/utils/task-detector';

  let {
    tasks,
    onConfirm,
    onConfirmAndLoop,
    onDismiss,
    onToggleTask,
    onEditTask,
  }: {
    tasks: DetectedTask[];
    onConfirm: (tasks: DetectedTask[]) => void;
    onConfirmAndLoop: (tasks: DetectedTask[]) => void;
    onDismiss: () => void;
    onToggleTask: (index: number) => void;
    onEditTask: (index: number, newText: string) => void;
  } = $props();

  let editingIndex = $state<number | null>(null);
  let editValue = $state('');

  let selectedCount = $derived(tasks.filter((t) => t.selected).length);

  function startEdit(index: number) {
    editingIndex = index;
    editValue = tasks[index].text;
  }

  function commitEdit() {
    if (editingIndex !== null && editValue.trim()) {
      onEditTask(editingIndex, editValue.trim());
    }
    editingIndex = null;
  }

  function handleEditKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitEdit();
    } else if (e.key === 'Escape') {
      editingIndex = null;
    }
  }
</script>

<div class="task-split">
  <div class="task-split-header">
    <span class="task-badge">TASKS</span>
    <span class="task-count">Detected {tasks.length} tasks</span>
    <div class="task-actions">
      <button class="btn-create" disabled={selectedCount === 0} onclick={() => onConfirm(tasks)}>
        Create Stories
      </button>
      <button
        class="btn-loop"
        disabled={selectedCount === 0}
        onclick={() => onConfirmAndLoop(tasks)}
      >
        & Loop
      </button>
      <button class="btn-dismiss" onclick={onDismiss} title="Send as-is">×</button>
    </div>
  </div>
  <div class="task-list">
    {#each tasks as task, i}
      <label class="task-item" class:deselected={!task.selected}>
        <input type="checkbox" checked={task.selected} onchange={() => onToggleTask(i)} />
        {#if editingIndex === i}
          <input
            class="task-edit-input"
            type="text"
            bind:value={editValue}
            onblur={commitEdit}
            onkeydown={handleEditKeydown}
            autofocus
          />
        {:else}
          <span class="task-text" ondblclick={() => startEdit(i)}>{task.text}</span>
        {/if}
      </label>
    {/each}
  </div>
</div>

<style>
  .task-split {
    margin-bottom: 8px;
    padding: 8px 12px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    border-left: 3px solid var(--accent-primary);
    border-radius: var(--radius-sm);
    font-size: var(--fs-sm);
  }
  .task-split-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }
  .task-badge {
    font-size: var(--fs-xxs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 1px 6px;
    background: var(--bg-active);
    color: var(--accent-primary);
    border-radius: var(--radius-sm);
  }
  .task-count {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    flex: 1;
  }
  .task-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .btn-create {
    font-size: var(--fs-xxs);
    font-weight: 600;
    padding: 2px 10px;
    border-radius: var(--radius-sm);
    background: var(--accent-primary);
    color: var(--text-on-accent);
    cursor: pointer;
    transition: opacity var(--transition);
  }
  .btn-create:hover:not(:disabled) {
    opacity: 0.9;
  }
  .btn-create:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .btn-loop {
    font-size: var(--fs-xxs);
    font-weight: 600;
    padding: 2px 10px;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--accent-primary);
    border: 1px solid var(--accent-primary);
    cursor: pointer;
    transition: all var(--transition);
  }
  .btn-loop:hover:not(:disabled) {
    background: var(--bg-active);
  }
  .btn-loop:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .btn-dismiss {
    color: var(--text-tertiary);
    font-size: var(--fs-lg);
    padding: 0 4px;
    margin-left: 4px;
    cursor: pointer;
    transition: color var(--transition);
  }
  .btn-dismiss:hover {
    color: var(--text-primary);
  }

  .task-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .task-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 4px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: opacity var(--transition);
  }
  .task-item:hover {
    background: var(--bg-active);
  }
  .task-item.deselected {
    opacity: 0.4;
  }
  .task-item input[type='checkbox'] {
    accent-color: var(--accent-primary);
    width: 12px;
    height: 12px;
    flex-shrink: 0;
    cursor: pointer;
  }
  .task-text {
    flex: 1;
    color: var(--text-primary);
    font-size: var(--fs-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: text;
  }
  .task-edit-input {
    flex: 1;
    font-size: var(--fs-xs);
    padding: 1px 4px;
    border: 1px solid var(--accent-primary);
    border-radius: var(--radius-sm);
    background: var(--bg-primary);
    color: var(--text-primary);
    outline: none;
  }
</style>
