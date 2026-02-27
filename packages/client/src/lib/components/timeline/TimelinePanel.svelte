<script lang="ts">
  import { timelineStore } from '$lib/stores/timeline.svelte';
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { editorStore } from '$lib/stores/editor.svelte';
  import { gitStore } from '$lib/stores/git.svelte';
  import { api } from '$lib/api/client';
  import { onMount } from 'svelte';
  import TimelineStepComponent from './TimelineStep.svelte';
  import type { MessageContent } from '@e/shared';

  let { conversationId }: { conversationId: string } = $props();

  let detailBlock = $state<MessageContent | null>(null);
  let restoring = $state(false);
  let restoreResult = $state<'success' | 'error' | null>(null);
  let filterKind = $state<string>('all');
  let scrollContainer = $state<HTMLDivElement | null>(null);

  // Confirmation dialog state
  let confirmRestore = $state<{
    snapshotId: string;
    stepLabel: string;
    stepId: string;
  } | null>(null);

  let workspacePath = $state<string | undefined>(undefined);

  const filteredSteps = $derived(
    filterKind === 'all'
      ? timelineStore.steps
      : timelineStore.steps.filter((s) => s.kind === filterKind),
  );

  onMount(async () => {
    // Load the conversation and build timeline
    try {
      const res = await api.conversations.get(conversationId);
      if (res.data) {
        workspacePath = res.data.workspacePath;
        timelineStore.loadFromConversation(res.data);
        // Also load snapshots if workspace is known
        if (res.data.workspacePath) {
          timelineStore.loadSnapshots(res.data.workspacePath);
        }
      }
    } catch (e) {
      console.error('[TimelinePanel] Failed to load conversation:', e);
    }
  });

  // Update detail view when selection changes
  $effect(() => {
    const step = timelineStore.selectedStep;
    if (!step) {
      detailBlock = null;
      return;
    }
    // Load the conversation to get the content block
    const conv = conversationStore.active;
    if (conv) {
      detailBlock = timelineStore.getBlockContent(conv, step);
    } else {
      // Fetch it
      api.conversations
        .get(conversationId)
        .then((res) => {
          if (res.data) {
            detailBlock = timelineStore.getBlockContent(res.data, step);
          }
        })
        .catch(() => {
          detailBlock = null;
        });
    }
  });

  function requestRestore(snapshotId: string) {
    // Find the step with this snapshot to show its label
    const step = timelineStore.steps.find((s) => s.snapshotId === snapshotId);
    confirmRestore = {
      snapshotId,
      stepLabel: step?.label ?? 'this point',
      stepId: step?.id ?? '',
    };
  }

  function cancelRestore() {
    confirmRestore = null;
  }

  async function executeRestore() {
    if (!confirmRestore || restoring) return;
    const { snapshotId } = confirmRestore;
    confirmRestore = null;
    restoring = true;
    restoreResult = null;

    const ok = await timelineStore.restoreToSnapshot(snapshotId);
    restoreResult = ok ? 'success' : 'error';
    restoring = false;

    // On success, refresh open editor tabs and git status
    if (ok) {
      // Refresh all open editor tabs
      for (const tab of editorStore.tabs) {
        if (tab.filePath) {
          editorStore.refreshFile(tab.filePath);
        }
      }
      // Refresh git status
      if (workspacePath) {
        gitStore.refresh(workspacePath);
      }
    }

    // Auto-dismiss after 4s
    setTimeout(() => {
      restoreResult = null;
    }, 4000);
  }

  function formatBlock(block: MessageContent): string {
    switch (block.type) {
      case 'text':
        return block.text;
      case 'thinking':
        return block.thinking;
      case 'tool_use':
        return `Tool: ${block.name}\n\nInput:\n${JSON.stringify(block.input, null, 2)}`;
      case 'tool_result':
        return block.content;
      case 'nudge':
        return block.text;
      default:
        return JSON.stringify(block, null, 2);
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (confirmRestore) {
      if (e.key === 'Escape') {
        cancelRestore();
        e.preventDefault();
      } else if (e.key === 'Enter') {
        executeRestore();
        e.preventDefault();
      }
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault();
      timelineStore.selectPrevious();
    } else if (e.key === 'ArrowDown' || e.key === 'j') {
      e.preventDefault();
      timelineStore.selectNext();
    } else if (e.key === 'Escape') {
      timelineStore.selectStep(null);
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="timeline-panel" onkeydown={handleKeydown} tabindex="-1">
  <!-- Header -->
  <div class="timeline-header">
    <h3 class="timeline-title">AI Step-Through</h3>
    <div class="timeline-stats">
      <span class="stat" title="Total steps">{timelineStore.stats.totalSteps} steps</span>
      <span class="stat" title="Tool calls">{timelineStore.stats.toolCalls} tools</span>
      <span class="stat" title="File edits">{timelineStore.stats.fileEdits} edits</span>
      {#if timelineStore.stats.errors > 0}
        <span class="stat stat-error" title="Errors">{timelineStore.stats.errors} errors</span>
      {/if}
      {#if timelineStore.stats.snapshotsAvailable > 0}
        <span class="stat stat-snap" title="Undo points available">
          {timelineStore.stats.snapshotsAvailable} snapshots
        </span>
      {/if}
    </div>
  </div>

  <!-- Filter bar -->
  <div class="timeline-filters">
    <button
      class="filter-btn"
      class:active={filterKind === 'all'}
      onclick={() => (filterKind = 'all')}
    >
      All
    </button>
    <button
      class="filter-btn"
      class:active={filterKind === 'thinking'}
      onclick={() => (filterKind = 'thinking')}
    >
      Thinking
    </button>
    <button
      class="filter-btn"
      class:active={filterKind === 'tool_call'}
      onclick={() => (filterKind = 'tool_call')}
    >
      Tools
    </button>
    <button
      class="filter-btn"
      class:active={filterKind === 'text'}
      onclick={() => (filterKind = 'text')}
    >
      Text
    </button>
    <button
      class="filter-btn"
      class:active={filterKind === 'user_message'}
      onclick={() => (filterKind = 'user_message')}
    >
      User
    </button>
  </div>

  <!-- Restore notification -->
  {#if restoreResult}
    <div
      class="restore-notice"
      class:success={restoreResult === 'success'}
      class:error={restoreResult === 'error'}
    >
      {#if restoreResult === 'success'}
        Workspace restored successfully — open files have been refreshed
      {:else}
        Restore failed — check git state for conflicts
      {/if}
    </div>
  {/if}

  <!-- Confirmation dialog -->
  {#if confirmRestore}
    <div class="confirm-overlay">
      <div class="confirm-dialog">
        <div class="confirm-icon">&#9888;</div>
        <h4 class="confirm-title">Undo to this point?</h4>
        <p class="confirm-desc">
          This will revert your workspace to the state before
          <strong>{confirmRestore.stepLabel}</strong>. Uncommitted changes will be lost.
        </p>
        <div class="confirm-actions">
          <button class="confirm-cancel" onclick={cancelRestore}>Cancel</button>
          <button class="confirm-proceed" onclick={executeRestore} disabled={restoring}>
            {restoring ? 'Restoring...' : 'Undo to this point'}
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Main content: timeline + detail split -->
  <div class="timeline-body">
    <!-- Step list -->
    <div class="timeline-list" bind:this={scrollContainer}>
      {#if timelineStore.steps.length === 0}
        <div class="timeline-empty">
          <p>No timeline data</p>
          <p class="timeline-empty-sub">Open a conversation to replay its steps</p>
        </div>
      {:else if filteredSteps.length === 0}
        <div class="timeline-empty">
          <p>No steps match filter</p>
        </div>
      {:else}
        {#each filteredSteps as step (step.id)}
          <TimelineStepComponent
            {step}
            selected={timelineStore.selectedStepId === step.id}
            onselect={(id) => timelineStore.selectStep(id)}
            onrestore={requestRestore}
          />
        {/each}
      {/if}
    </div>

    <!-- Detail pane -->
    {#if detailBlock}
      <div class="timeline-detail">
        <div class="detail-header">
          <span class="detail-title">{timelineStore.selectedStep?.label ?? 'Detail'}</span>
          {#if timelineStore.selectedStep?.hasSnapshot}
            <button
              class="detail-undo-btn"
              onclick={() =>
                timelineStore.selectedStep?.snapshotId &&
                requestRestore(timelineStore.selectedStep.snapshotId)}
            >
              ↩ Undo to here
            </button>
          {/if}
          <button class="detail-close" onclick={() => timelineStore.selectStep(null)}>✕</button>
        </div>
        <pre class="detail-content">{formatBlock(detailBlock)}</pre>
      </div>
    {/if}
  </div>
</div>

<style>
  .timeline-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--bg-primary);
    outline: none;
    position: relative;
  }

  /* ── Header ── */
  .timeline-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border-primary);
    flex-shrink: 0;
  }

  .timeline-title {
    font-size: var(--fs-base);
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }

  .timeline-stats {
    display: flex;
    gap: 10px;
  }

  .stat {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    font-family: var(--ff-mono);
  }

  .stat-error {
    color: var(--accent-error, #e74c3c);
  }

  .stat-snap {
    color: var(--accent-warning, #f0ad4e);
  }

  /* ── Filters ── */
  .timeline-filters {
    display: flex;
    gap: 4px;
    padding: 6px 14px;
    border-bottom: 1px solid var(--border-secondary);
    flex-shrink: 0;
    overflow-x: auto;
  }

  .filter-btn {
    font-size: var(--fs-xs);
    padding: 3px 10px;
    border-radius: 12px;
    border: 1px solid var(--border-primary);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    white-space: nowrap;
    transition:
      background var(--transition),
      border-color var(--transition),
      color var(--transition);
  }

  .filter-btn:hover {
    background: var(--bg-tertiary);
  }

  .filter-btn.active {
    background: var(--accent-primary);
    color: var(--text-on-accent, #fff);
    border-color: var(--accent-primary);
  }

  /* ── Restore notice ── */
  .restore-notice {
    padding: 8px 14px;
    font-size: var(--fs-xs);
    text-align: center;
    flex-shrink: 0;
    font-weight: 500;
  }

  .restore-notice.success {
    background: color-mix(in srgb, var(--accent-success, #2ecc71) 15%, transparent);
    color: var(--accent-success, #2ecc71);
  }

  .restore-notice.error {
    background: color-mix(in srgb, var(--accent-error, #e74c3c) 15%, transparent);
    color: var(--accent-error, #e74c3c);
  }

  /* ── Confirmation overlay ── */
  .confirm-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 50;
    backdrop-filter: blur(2px);
  }

  .confirm-dialog {
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: 10px;
    padding: 24px;
    max-width: 380px;
    width: 90%;
    text-align: center;
    box-shadow: var(--shadow-lg, 0 8px 32px rgba(0, 0, 0, 0.3));
  }

  .confirm-icon {
    font-size: 32px;
    margin-bottom: 8px;
    color: var(--accent-warning, #f0ad4e);
  }

  .confirm-title {
    font-size: var(--fs-base);
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 8px;
  }

  .confirm-desc {
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    margin: 0 0 16px;
    line-height: 1.5;
  }

  .confirm-desc strong {
    color: var(--text-primary);
  }

  .confirm-actions {
    display: flex;
    gap: 8px;
    justify-content: center;
  }

  .confirm-cancel,
  .confirm-proceed {
    padding: 6px 16px;
    border-radius: 6px;
    font-size: var(--fs-sm);
    cursor: pointer;
    transition:
      background var(--transition),
      border-color var(--transition);
  }

  .confirm-cancel {
    background: transparent;
    border: 1px solid var(--border-primary);
    color: var(--text-secondary);
  }

  .confirm-cancel:hover {
    background: var(--bg-tertiary);
  }

  .confirm-proceed {
    background: var(--accent-warning, #f0ad4e);
    border: 1px solid var(--accent-warning, #f0ad4e);
    color: #000;
    font-weight: 600;
  }

  .confirm-proceed:hover {
    filter: brightness(1.1);
  }

  .confirm-proceed:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  /* ── Body ── */
  .timeline-body {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .timeline-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px 6px;
    min-width: 0;
  }

  .timeline-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
    color: var(--text-tertiary);
    text-align: center;
  }

  .timeline-empty p {
    margin: 0;
    font-size: var(--fs-sm);
  }

  .timeline-empty-sub {
    margin-top: 4px;
    font-size: var(--fs-xs);
    opacity: 0.7;
  }

  /* ── Detail pane ── */
  .timeline-detail {
    width: 40%;
    min-width: 200px;
    max-width: 50%;
    border-left: 1px solid var(--border-primary);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    flex-shrink: 0;
  }

  .detail-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-secondary);
    flex-shrink: 0;
  }

  .detail-title {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-primary);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .detail-undo-btn {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 4px;
    border: 1px solid var(--accent-warning, #f0ad4e);
    background: color-mix(in srgb, var(--accent-warning, #f0ad4e) 10%, transparent);
    color: var(--accent-warning, #f0ad4e);
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    transition:
      background var(--transition),
      filter var(--transition);
  }

  .detail-undo-btn:hover {
    background: color-mix(in srgb, var(--accent-warning, #f0ad4e) 25%, transparent);
  }

  .detail-close {
    background: none;
    border: none;
    color: var(--text-tertiary);
    cursor: pointer;
    font-size: 14px;
    padding: 2px 6px;
    border-radius: 4px;
    flex-shrink: 0;
    transition: background var(--transition);
  }

  .detail-close:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .detail-content {
    flex: 1;
    overflow: auto;
    padding: 12px;
    margin: 0;
    font-size: var(--fs-xs);
    font-family: var(--ff-mono);
    color: var(--text-secondary);
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
    background: var(--bg-secondary);
  }
</style>
