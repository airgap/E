<script lang="ts">
  import { streamStore } from '$lib/stores/stream.svelte';
  import { conversationStore } from '$lib/stores/conversation.svelte';

  interface TodoItem {
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
    activeForm: string;
  }

  /**
   * Derive the current todo list from the most recent TodoWrite tool call.
   * Checks streaming contentBlocks first (for live in-flight updates),
   * then falls back to persisted conversation messages.
   */
  const todos = $derived.by((): TodoItem[] => {
    // 1. Check streaming content blocks (most recent first) for live updates
    const blocks = streamStore.contentBlocks;
    for (let i = blocks.length - 1; i >= 0; i--) {
      const block = blocks[i];
      if (block.type === 'tool_use' && block.name === 'TodoWrite') {
        const input = block.input as { todos?: TodoItem[] };
        if (input.todos && Array.isArray(input.todos) && input.todos.length > 0) {
          return input.todos;
        }
      }
    }

    // 2. Fall back to persisted conversation messages
    const messages = conversationStore.active?.messages ?? [];
    for (let m = messages.length - 1; m >= 0; m--) {
      const msg = messages[m];
      if (msg.role !== 'assistant') continue;
      const content = msg.content;
      for (let c = content.length - 1; c >= 0; c--) {
        const block = content[c];
        if (block.type === 'tool_use' && block.name === 'TodoWrite') {
          const input = block.input as { todos?: TodoItem[] };
          if (input.todos && Array.isArray(input.todos) && input.todos.length > 0) {
            return input.todos;
          }
        }
      }
    }

    return [];
  });

  const hasTodos = $derived(todos.length > 0);

  const stats = $derived.by(() => {
    let completed = 0;
    let inProgress = 0;
    let pending = 0;
    for (const t of todos) {
      if (t.status === 'completed') completed++;
      else if (t.status === 'in_progress') inProgress++;
      else pending++;
    }
    return { completed, inProgress, pending, total: todos.length };
  });

  /** The currently active task (in_progress) — shown prominently */
  const activeTask = $derived(todos.find((t) => t.status === 'in_progress'));
</script>

{#if hasTodos}
  <div class="conversation-todos">
    <div class="todos-header">
      <span class="todos-title">Tasks</span>
      <span class="todos-progress">
        <span class="progress-done">{stats.completed}</span>
        <span class="progress-sep">/</span>
        <span class="progress-total">{stats.total}</span>
      </span>
      {#if activeTask}
        <span class="active-task-label">{activeTask.activeForm}</span>
      {/if}
    </div>

    <div class="todos-list">
      {#each todos as todo (todo.content)}
        <div
          class="todo-item"
          class:is-pending={todo.status === 'pending'}
          class:is-in-progress={todo.status === 'in_progress'}
          class:is-completed={todo.status === 'completed'}
        >
          <span class="todo-status-icon">
            {#if todo.status === 'completed'}
              <svg
                class="icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            {:else if todo.status === 'in_progress'}
              <span class="spinner"></span>
            {:else}
              <span class="pending-dot"></span>
            {/if}
          </span>
          <span class="todo-text">
            {#if todo.status === 'in_progress'}
              {todo.activeForm}
            {:else}
              {todo.content}
            {/if}
          </span>
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .conversation-todos {
    margin: 0 16px 6px;
    border: 1px solid var(--border-primary);
    background: var(--bg-secondary);
    position: sticky;
    top: 0;
    z-index: 5;
    max-height: 220px;
    overflow-y: auto;
  }

  .todos-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border-primary);
    background: var(--bg-tertiary);
  }

  .todos-title {
    font-size: var(--fs-xxs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--accent-info);
  }

  .todos-progress {
    font-size: var(--fs-xxs);
    font-family: var(--font-family);
    color: var(--text-tertiary);
  }

  .progress-done {
    color: var(--accent-secondary);
    font-weight: 700;
  }

  .progress-sep {
    opacity: 0.5;
  }

  .progress-total {
    color: var(--text-tertiary);
  }

  .active-task-label {
    font-size: var(--fs-xxs);
    color: var(--accent-primary);
    font-style: italic;
    margin-left: auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 50%;
  }

  .todos-list {
    padding: 4px 0;
  }

  .todo-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 10px;
    font-size: var(--fs-xs);
    line-height: 1.4;
    transition: opacity 0.15s ease;
  }

  .todo-item.is-completed {
    opacity: 0.5;
  }

  .todo-item.is-pending {
    color: var(--text-tertiary);
  }

  .todo-item.is-in-progress {
    color: var(--accent-primary);
    font-weight: 600;
  }

  .todo-status-icon {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .icon {
    width: 14px;
    height: 14px;
    color: var(--accent-secondary);
  }

  .pending-dot {
    display: block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    border: 1px solid var(--text-tertiary);
  }

  .spinner {
    display: block;
    width: 12px;
    height: 12px;
    border: 2px solid var(--accent-primary);
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .todo-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
