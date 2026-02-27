<script lang="ts">
  import type { TimelineStep } from '$lib/stores/timeline.svelte';

  let {
    step,
    selected = false,
    onselect,
    onrestore,
  }: {
    step: TimelineStep;
    selected?: boolean;
    onselect?: (stepId: string) => void;
    onrestore?: (snapshotId: string) => void;
  } = $props();

  const iconMap: Record<string, string> = {
    thinking: '🧠',
    text: '💬',
    tool_call: '🔧',
    tool_result: '📋',
    user_message: '👤',
    nudge: '📢',
    error: '❌',
    snapshot: '📸',
  };

  function kindClass(kind: string): string {
    switch (kind) {
      case 'thinking':
        return 'step-thinking';
      case 'text':
        return 'step-text';
      case 'tool_call':
        return 'step-tool';
      case 'tool_result':
        return step.isError ? 'step-error' : 'step-result';
      case 'user_message':
        return 'step-user';
      case 'nudge':
        return 'step-nudge';
      default:
        return '';
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="timeline-step {kindClass(step.kind)}"
  class:selected
  onclick={() => onselect?.(step.id)}
>
  <div class="step-connector">
    <div class="step-dot" class:has-snapshot={step.hasSnapshot}></div>
    <div class="step-line"></div>
  </div>

  <div class="step-content">
    <div class="step-header">
      <span class="step-icon">{iconMap[step.kind] ?? '•'}</span>
      <span class="step-label">{step.label}</span>
      {#if step.toolName}
        <span class="step-tool-badge">{step.toolName}</span>
      {/if}
      {#if step.isError}
        <span class="step-error-badge">Error</span>
      {/if}
      {#if step.hasSnapshot}
        <button
          class="step-restore-btn"
          title="Restore to this point"
          onclick={(e) => {
            e.stopPropagation();
            step.snapshotId && onrestore?.(step.snapshotId);
          }}
        >
          ↩ Undo
        </button>
      {/if}
    </div>

    {#if selected && step.preview}
      <div class="step-preview">
        {step.preview}
      </div>
    {/if}

    {#if step.filePath}
      <div class="step-file">
        {step.filePath.split('/').pop()}
      </div>
    {/if}
  </div>
</div>

<style>
  .timeline-step {
    display: flex;
    gap: 10px;
    cursor: pointer;
    padding: 4px 8px 4px 0;
    border-radius: 6px;
    transition:
      background var(--transition),
      border-color var(--transition);
    border: 1px solid transparent;
    min-height: 32px;
  }

  .timeline-step:hover {
    background: var(--bg-tertiary);
  }

  .timeline-step.selected {
    background: var(--bg-secondary);
    border-color: var(--accent-primary);
  }

  /* ── Connector line + dot ── */
  .step-connector {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 20px;
    flex-shrink: 0;
    padding-top: 6px;
  }

  .step-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--text-tertiary);
    flex-shrink: 0;
    z-index: 1;
    transition: background var(--transition);
  }

  .step-dot.has-snapshot {
    background: var(--accent-warning, #f0ad4e);
    box-shadow: 0 0 6px var(--accent-warning, #f0ad4e);
  }

  .step-thinking .step-dot {
    background: var(--accent-secondary, #9b59b6);
  }
  .step-text .step-dot {
    background: var(--accent-primary);
  }
  .step-tool .step-dot {
    background: var(--accent-info, #3498db);
  }
  .step-result .step-dot {
    background: var(--accent-success, #2ecc71);
  }
  .step-error .step-dot {
    background: var(--accent-error, #e74c3c);
  }
  .step-user .step-dot {
    background: var(--text-secondary);
  }
  .step-nudge .step-dot {
    background: var(--accent-warning, #f0ad4e);
  }

  .step-line {
    width: 2px;
    flex: 1;
    background: var(--border-secondary);
    margin-top: 2px;
  }

  /* Last step has no line extending below */
  .timeline-step:last-child .step-line {
    background: transparent;
  }

  /* ── Content ── */
  .step-content {
    flex: 1;
    min-width: 0;
    padding-top: 2px;
  }

  .step-header {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--fs-sm);
    line-height: 1.4;
  }

  .step-icon {
    font-size: 12px;
    flex-shrink: 0;
  }

  .step-label {
    font-weight: 500;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .step-tool-badge {
    font-size: 10px;
    padding: 1px 5px;
    border-radius: 3px;
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    font-family: var(--ff-mono);
    white-space: nowrap;
  }

  .step-error-badge {
    font-size: 10px;
    padding: 1px 5px;
    border-radius: 3px;
    background: color-mix(in srgb, var(--accent-error, #e74c3c) 20%, transparent);
    color: var(--accent-error, #e74c3c);
    font-weight: 600;
  }

  .step-restore-btn {
    margin-left: auto;
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 3px;
    border: 1px solid var(--border-primary);
    background: transparent;
    color: var(--accent-warning, #f0ad4e);
    cursor: pointer;
    white-space: nowrap;
    transition:
      background var(--transition),
      border-color var(--transition);
  }

  .step-restore-btn:hover {
    background: color-mix(in srgb, var(--accent-warning, #f0ad4e) 15%, transparent);
    border-color: var(--accent-warning, #f0ad4e);
  }

  .step-preview {
    margin-top: 4px;
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 80px;
    overflow: hidden;
    padding: 6px 8px;
    background: var(--bg-primary);
    border-radius: 4px;
    border: 1px solid var(--border-secondary);
    font-family: var(--ff-mono);
  }

  .step-file {
    margin-top: 2px;
    font-size: 10px;
    color: var(--text-tertiary);
    font-family: var(--ff-mono);
  }
</style>
