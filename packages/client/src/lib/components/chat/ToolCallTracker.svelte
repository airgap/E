<script lang="ts">
  import { streamStore } from '$lib/stores/stream.svelte';
  import { parseMcpToolName } from '@e/shared';

  // Track tool calls as they come in
  let toolCalls = $derived.by(() => {
    const calls: Array<{
      id: string;
      name: string;
      status: 'pending' | 'running' | 'completed' | 'error';
      duration?: number;
    }> = [];

    for (const block of streamStore.contentBlocks) {
      if (block.type === 'tool_use') {
        const result = streamStore.toolResults.get(block.id);
        let status: 'pending' | 'running' | 'completed' | 'error';
        if (result) {
          // During active streaming, treat errors as "completed with warning"
          // rather than a hard error, since Claude often retries.
          // Only show as error when the stream is done.
          status = result.isError ? 'error' : 'completed';
        } else {
          status = streamStore.status === 'streaming' && block.id ? 'running' : 'pending';
        }
        calls.push({
          id: block.id,
          name: block.name,
          status,
          duration: result?.duration,
        });
      }
    }

    return calls;
  });

  let totalTools = $derived(toolCalls.length);
  let completedTools = $derived(toolCalls.filter((t) => t.status === 'completed').length);
  let erroredTools = $derived(toolCalls.filter((t) => t.status === 'error').length);
  let runningTools = $derived(toolCalls.filter((t) => t.status === 'running').length);
  let progressPercent = $derived(
    totalTools > 0 ? Math.round((completedTools / totalTools) * 100) : 0,
  );
</script>

{#if totalTools > 0}
  <div class="tool-tracker">
    <div class="tracker-header">
      <div class="tracker-title">
        <span class="tool-label">TOOL EXECUTION</span>
        <span class="tool-count">
          {completedTools}/{totalTools}
          {#if erroredTools > 0}
            <span class="error-count">{erroredTools} error{erroredTools !== 1 ? 's' : ''}</span>
          {/if}
        </span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width: {progressPercent}%">
          {#if progressPercent > 10}
            <span class="progress-text">{progressPercent}%</span>
          {/if}
        </div>
      </div>
    </div>

    {#if totalTools > 5}
      <!-- Compact view for many tools -->
      <div class="tracker-summary">
        <div class="summary-stat completed">
          <span class="stat-icon">✓</span>
          <span class="stat-label">Completed</span>
          <span class="stat-value">{completedTools}</span>
        </div>
        {#if runningTools > 0}
          <div class="summary-stat running">
            <span class="stat-icon">⟳</span>
            <span class="stat-label">Running</span>
            <span class="stat-value">{runningTools}</span>
          </div>
        {/if}
        {#if erroredTools > 0}
          <div class="summary-stat error">
            <span class="stat-icon">✕</span>
            <span class="stat-label">Errors</span>
            <span class="stat-value">{erroredTools}</span>
          </div>
        {/if}
      </div>
    {:else}
      <!-- Detailed view for fewer tools -->
      <div class="tracker-list">
        {#each toolCalls as tool (tool.id)}
          <div
            class="tool-item"
            class:completed={tool.status === 'completed'}
            class:error={tool.status === 'error'}
            class:running={tool.status === 'running'}
          >
            <span
              class="tool-status-icon"
              class:completed={tool.status === 'completed'}
              class:error={tool.status === 'error'}
              class:running={tool.status === 'running'}
            >
              {#if tool.status === 'completed'}
                ✓
              {:else if tool.status === 'error'}
                ✕
              {:else if tool.status === 'running'}
                <span class="spinner"></span>
              {:else}
                ○
              {/if}
            </span>
            <span class="tool-name">{parseMcpToolName(tool.name).displayName}</span>
            {#if tool.duration}
              <span class="tool-duration">{(tool.duration / 1000).toFixed(1)}s</span>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .tool-tracker {
    margin: 12px 0;
    padding: 12px;
    background: var(--bg-tertiary);
    border-left: 2px solid var(--accent-primary);
    border-radius: var(--radius-sm);
    animation: slideInUp 0.3s ease-out;
  }

  .tracker-header {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .tracker-title {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: var(--fs-sm);
  }

  .tool-label {
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--accent-primary);
  }

  .tool-count {
    font-size: var(--fs-base);
    font-weight: 600;
    color: var(--text-secondary);
  }

  .error-count {
    margin-left: 8px;
    color: var(--accent-error, #ff3344);
    font-weight: 700;
  }

  .progress-bar {
    width: 100%;
    height: 4px;
    background: var(--bg-secondary);
    border-radius: 2px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--accent-primary), var(--accent-secondary));
    transition: width 0.3s ease-out;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding-right: 4px;
    position: relative;
  }

  .progress-text {
    font-size: var(--fs-xxs);
    font-weight: 700;
    color: var(--text-on-accent);
    opacity: 0.8;
  }

  /* Summary view for many tools */
  .tracker-summary {
    display: flex;
    gap: 12px;
    margin-top: 8px;
    justify-content: space-between;
  }

  .summary-stat {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    background: var(--bg-primary);
    border-radius: var(--radius-sm);
    font-size: var(--fs-sm);
  }

  .stat-icon {
    font-size: var(--fs-md);
    font-weight: 700;
  }

  .summary-stat.completed {
    color: var(--accent-secondary, #00ff88);
  }

  .summary-stat.running {
    color: var(--accent-primary, #00b4ff);
  }

  .summary-stat.error {
    color: var(--accent-error, #ff3344);
  }

  .stat-label {
    color: var(--text-tertiary);
  }

  .stat-value {
    font-weight: 700;
    color: var(--text-primary);
    margin-left: 4px;
  }

  /* Detailed list view */
  .tracker-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 8px;
  }

  .tool-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    background: var(--bg-primary);
    border-radius: var(--radius-sm);
    font-size: var(--fs-sm);
    transition: all 0.3s ease;
  }

  .tool-item.completed {
    opacity: 0.7;
  }

  .tool-item.error {
    background: rgba(255, 50, 50, 0.05);
    transition: background 0.3s ease;
  }

  .tool-status-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    font-weight: 700;
    font-size: var(--fs-sm);
    flex-shrink: 0;
  }

  .tool-status-icon.completed {
    color: var(--accent-secondary, #00ff88);
  }

  .tool-status-icon.running {
    color: var(--accent-primary, #00b4ff);
  }

  .tool-status-icon.error {
    color: var(--accent-error, #ff3344);
  }

  .spinner {
    display: inline-block;
    width: 12px;
    height: 12px;
    border: 2px solid var(--accent-primary);
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .tool-name {
    flex: 1;
    color: var(--text-primary);
    font-weight: 500;
  }

  .tool-duration {
    color: var(--text-tertiary);
    font-size: var(--fs-xs);
    font-family: var(--font-family);
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @keyframes slideInUp {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
