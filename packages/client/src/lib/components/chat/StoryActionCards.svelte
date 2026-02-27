<script lang="ts">
  import type { Message } from '@e/shared';
  import { parseStoryActions, type StoryAction } from '$lib/utils/story-parser';
  import { loopStore } from '$lib/stores/loop.svelte';
  import { uiStore } from '$lib/stores/ui.svelte';
  import { uuid } from '$lib/utils/uuid';
  import { api } from '$lib/api/client';

  let { message } = $props<{ message: Message }>();

  let appliedActions = $state<Set<number>>(new Set());
  let applyingIndex = $state<number | null>(null);

  // Extract text from all text content blocks
  let fullText = $derived(
    (message.content as any[])
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text as string)
      .join('\n'),
  );

  let actions = $derived(parseStoryActions(fullText));

  function actionTypeLabel(action: StoryAction): string {
    switch (action.type) {
      case 'add':
        return 'ADD';
      case 'edit':
        return 'EDIT';
      case 'remove':
        return 'REMOVE';
    }
  }

  function actionTypeColor(action: StoryAction): string {
    switch (action.type) {
      case 'add':
        return 'var(--accent-secondary, #22c55e)';
      case 'edit':
        return 'var(--accent-primary)';
      case 'remove':
        return 'var(--accent-error)';
    }
  }

  function actionTitle(action: StoryAction): string {
    if (action.type === 'add') return action.title;
    if (action.type === 'edit') return action.title || `Edit story ${action.storyId}`;
    return `Remove story ${action.storyId}`;
  }

  function actionDetail(action: StoryAction): string {
    if (action.type === 'add') {
      const parts = [];
      if (action.description) parts.push(action.description);
      if (action.acceptanceCriteria.length > 0) {
        parts.push(`${action.acceptanceCriteria.length} criteria`);
      }
      parts.push(`Priority: ${action.priority}`);
      return parts.join(' · ');
    }
    if (action.type === 'edit') {
      const parts = [];
      if (action.description) parts.push(action.description);
      if (action.priority) parts.push(`Priority: ${action.priority}`);
      if (action.acceptanceCriteria && action.acceptanceCriteria.length > 0) {
        parts.push(`${action.acceptanceCriteria.length} criteria`);
      }
      return parts.join(' · ') || 'Update story fields';
    }
    return action.reason;
  }

  async function applyAction(action: StoryAction, index: number) {
    const prdId = loopStore.planPrdId;
    if (!prdId) {
      uiStore.toast('No PRD linked to this planning session', 'error');
      return;
    }

    applyingIndex = index;
    try {
      if (action.type === 'add') {
        await api.prds.addStory(prdId, {
          title: action.title,
          description: action.description,
          acceptanceCriteria: action.acceptanceCriteria,
          priority: action.priority,
        });
        uiStore.toast(`Added story: ${action.title}`, 'success');
      } else if (action.type === 'edit') {
        const updates: Record<string, any> = {};
        if (action.title) updates.title = action.title;
        if (action.description) updates.description = action.description;
        if (action.priority) updates.priority = action.priority;
        if (action.acceptanceCriteria && action.acceptanceCriteria.length > 0) {
          updates.acceptanceCriteria = action.acceptanceCriteria.map((desc) => ({
            id: uuid().slice(0, 8),
            description: desc,
            passed: false,
          }));
        }
        await api.prds.updateStory(prdId, action.storyId, updates);
        uiStore.toast(`Updated story: ${action.storyId}`, 'success');
      } else if (action.type === 'remove') {
        await api.prds.deleteStory(prdId, action.storyId);
        uiStore.toast(`Removed story: ${action.storyId}`, 'success');
      }

      appliedActions = new Set([...appliedActions, index]);
      // Refresh the PRD in the loop store
      await loopStore.loadPrd(prdId);
    } catch (err) {
      uiStore.toast(`Failed to apply: ${err}`, 'error');
    } finally {
      applyingIndex = null;
    }
  }

  async function applyAll() {
    for (let i = 0; i < actions.length; i++) {
      if (!appliedActions.has(i)) {
        await applyAction(actions[i], i);
      }
    }
  }

  // Auto-apply actions when edit mode is 'unlocked'
  let autoApplied = $state<Set<number>>(new Set());
  $effect(() => {
    if (loopStore.editMode !== 'unlocked') return;
    for (let i = 0; i < actions.length; i++) {
      if (!appliedActions.has(i) && !autoApplied.has(i)) {
        autoApplied = new Set([...autoApplied, i]);
        applyAction(actions[i], i);
      }
    }
  });
</script>

{#if actions.length > 0}
  <div class="story-actions">
    <div class="actions-header">
      <span class="actions-label"
        >{loopStore.editMode === 'unlocked' ? 'Applied' : 'Proposed'} Changes ({actions.length})</span
      >
      {#if actions.length > 1 && appliedActions.size < actions.length}
        <button class="btn-apply-all" onclick={applyAll} disabled={applyingIndex !== null}>
          Apply All
        </button>
      {/if}
    </div>
    {#each actions as action, i}
      <div class="action-card" class:applied={appliedActions.has(i)}>
        <div class="action-badge" style:background={actionTypeColor(action)}>
          {actionTypeLabel(action)}
        </div>
        <div class="action-body">
          <div class="action-title">{actionTitle(action)}</div>
          <div class="action-detail">{actionDetail(action)}</div>
        </div>
        <div class="action-controls">
          {#if appliedActions.has(i)}
            <span class="applied-badge">Applied</span>
          {:else}
            <button
              class="btn-apply"
              onclick={() => applyAction(action, i)}
              disabled={applyingIndex !== null}
            >
              {applyingIndex === i ? '...' : 'Apply'}
            </button>
          {/if}
        </div>
      </div>
    {/each}
  </div>
{/if}

<style>
  .story-actions {
    margin: 4px 28px 12px;
    border: 1px solid var(--border-primary);
    border-radius: var(--radius);
    overflow: hidden;
    background: var(--bg-secondary);
  }
  .actions-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    background: var(--bg-tertiary);
    border-bottom: 1px solid var(--border-primary);
  }
  .actions-label {
    font-size: var(--fs-xxs);
    font-weight: 700;
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
    color: var(--text-tertiary);
  }
  .btn-apply-all {
    font-size: var(--fs-xxs);
    font-weight: 600;
    padding: 2px 10px;
    border-radius: var(--radius-sm);
    background: var(--accent-primary);
    color: var(--text-on-accent);
    cursor: pointer;
    transition: opacity var(--transition);
  }
  .btn-apply-all:hover:not(:disabled) {
    opacity: 0.9;
  }
  .btn-apply-all:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .action-card {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-secondary);
    transition: opacity var(--transition);
  }
  .action-card:last-child {
    border-bottom: none;
  }
  .action-card.applied {
    opacity: 0.5;
  }

  .action-badge {
    font-size: var(--fs-xxs);
    font-weight: 700;
    letter-spacing: 0.5px;
    padding: 2px 6px;
    border-radius: 2px;
    color: var(--text-on-accent, #fff);
    flex-shrink: 0;
  }

  .action-body {
    flex: 1;
    min-width: 0;
  }
  .action-title {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .action-detail {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-top: 1px;
  }

  .action-controls {
    flex-shrink: 0;
  }
  .btn-apply {
    font-size: var(--fs-xxs);
    font-weight: 600;
    padding: 3px 10px;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--accent-primary);
    border: 1px solid var(--accent-primary);
    cursor: pointer;
    transition: all var(--transition);
  }
  .btn-apply:hover:not(:disabled) {
    background: var(--bg-active);
  }
  .btn-apply:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .applied-badge {
    font-size: var(--fs-xxs);
    font-weight: 600;
    color: var(--accent-secondary, #22c55e);
    letter-spacing: 0.3px;
  }
</style>
