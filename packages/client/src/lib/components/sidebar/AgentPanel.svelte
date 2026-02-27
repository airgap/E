<script lang="ts">
  import { streamStore } from '$lib/stores/stream.svelte';

  interface Agent {
    id: string;
    type: string;
    description: string;
    status: 'running' | 'completed' | 'error';
  }

  // Derive agents from Task tool_use blocks in the current stream
  const agents = $derived.by<Agent[]>(() => {
    const blocks = streamStore.contentBlocks;
    const results = streamStore.toolResults;
    const isStreaming = streamStore.status === 'streaming' || streamStore.status === 'tool_pending';

    return blocks
      .filter((b) => b.type === 'tool_use' && b.name === 'Task')
      .map((b) => {
        if (b.type !== 'tool_use') return null;
        const result = results.get(b.id);
        let status: Agent['status'];
        if (result) {
          status = result.isError ? 'error' : 'completed';
        } else {
          status = isStreaming ? 'running' : 'completed';
        }
        const input = b.input as Record<string, unknown>;
        return {
          id: b.id,
          type: (input.subagent_type as string) || 'agent',
          description: (input.description as string) || (input.prompt as string) || '',
          status,
        };
      })
      .filter((a): a is Agent => a !== null);
  });

  function statusColor(status: string): string {
    switch (status) {
      case 'running':
        return 'var(--accent-primary)';
      case 'completed':
        return 'var(--accent-secondary)';
      case 'error':
        return 'var(--accent-error)';
      default:
        return 'var(--text-tertiary)';
    }
  }
</script>

<div class="agent-panel">
  <div class="agent-header">
    <h3>Agents</h3>
    <span class="agent-count">{agents.filter((a) => a.status === 'running').length} active</span>
  </div>

  <div class="agent-list">
    {#each agents as agent (agent.id)}
      <div class="agent-item">
        <div class="agent-item-header">
          <span class="agent-dot" style:background={statusColor(agent.status)}></span>
          <span class="agent-type">{agent.type}</span>
          <span class="agent-status-label">{agent.status}</span>
        </div>
        {#if agent.description}
          <div class="agent-desc truncate">{agent.description}</div>
        {/if}
      </div>
    {:else}
      <div class="empty">No agents running</div>
    {/each}
  </div>
</div>

<style>
  .agent-panel {
    padding: 8px;
  }
  .agent-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 4px 8px;
  }
  .agent-header h3 {
    font-size: var(--fs-base);
    font-weight: 600;
  }
  .agent-count {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
  }

  .agent-list {
    overflow-y: auto;
  }

  .agent-item {
    padding: 8px;
    border-radius: var(--radius-sm);
    margin-bottom: 4px;
    background: var(--bg-tertiary);
  }

  .agent-item-header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
  }

  .agent-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .agent-type {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-primary);
  }
  .agent-status-label {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    margin-left: auto;
  }
  .agent-desc {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
  }
  .empty {
    padding: 20px;
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--fs-sm);
  }
</style>
