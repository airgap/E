<script lang="ts">
  import type { MessageContent } from '@e/shared';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { chirpEngine } from '$lib/audio/chirp-engine';
  import ThinkingBlock from './ThinkingBlock.svelte';
  import ToolCallBlock from './ToolCallBlock.svelte';
  import { renderMarkdownPartial } from '$lib/utils/markdown';

  function uiClick() {
    if (settingsStore.soundEnabled) chirpEngine.uiClick();
  }

  let {
    taskBlock,
    children,
    toolResults = [],
  } = $props<{
    taskBlock: MessageContent & { type: 'tool_use' };
    children: MessageContent[];
    toolResults?: Array<{ tool_use_id: string; content: string; is_error?: boolean }>;
  }>();

  let expanded = $state(false);

  function getDescription(): string {
    const input = taskBlock.input as any;
    return input?.description || input?.prompt?.slice(0, 80) || 'Sub-agent';
  }

  function childToolCalls() {
    return children.filter((b: MessageContent) => b.type === 'tool_use') as Array<
      MessageContent & { type: 'tool_use' }
    >;
  }

  function findResult(toolId: string) {
    return toolResults.find(
      (r: { tool_use_id: string; content: string; is_error?: boolean }) => r.tool_use_id === toolId,
    );
  }
</script>

<div class="agent-group">
  <button
    class="agent-header"
    onclick={() => {
      expanded = !expanded;
      uiClick();
    }}
  >
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      class:rotated={expanded}
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
    <svg
      class="agent-icon"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
    <span class="agent-label">Agent</span>
    <span class="agent-desc truncate">{getDescription()}</span>
    <span class="agent-count"
      >{childToolCalls().length} tool call{childToolCalls().length !== 1 ? 's' : ''}</span
    >
  </button>

  {#if expanded}
    <div class="agent-body">
      {#each children as block}
        {#if block.type === 'thinking' && settingsStore.showThinkingBlocks}
          <ThinkingBlock content={block.thinking} />
        {:else if block.type === 'text' && block.text}
          <div class="prose">{@html renderMarkdownPartial(block.text)}</div>
        {:else if block.type === 'tool_use'}
          <ToolCallBlock
            toolName={block.name}
            input={block.input}
            toolCallId={block.id}
            result={findResult(block.id)}
          />
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  .agent-group {
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    overflow: hidden;
    font-size: var(--fs-base);
    border-left: 2px solid var(--accent-secondary);
  }

  .agent-header {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 6px 10px;
    background: var(--bg-tertiary);
    transition: background var(--transition);
    color: var(--text-primary);
  }
  .agent-header:hover {
    background: var(--bg-hover);
  }

  .agent-icon {
    color: var(--accent-secondary);
  }

  .agent-label {
    font-weight: 700;
    font-size: var(--fs-sm);
    letter-spacing: 0.5px;
    text-transform: uppercase;
    color: var(--accent-secondary);
  }

  .agent-desc {
    color: var(--text-tertiary);
    font-size: var(--fs-sm);
    flex: 1;
    min-width: 0;
    text-align: left;
  }

  .agent-count {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    padding: 1px 6px;
    background: var(--bg-primary);
    border: 1px solid var(--border-secondary);
    border-radius: 3px;
    white-space: nowrap;
  }

  svg {
    transition: transform var(--transition);
  }
  .rotated {
    transform: rotate(90deg);
  }

  .agent-body {
    border-top: 1px solid var(--border-secondary);
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: var(--bg-primary);
  }

  .prose {
    line-height: 1.7;
    color: var(--text-primary);
    font-family: var(--font-family-sans);
    font-size: var(--font-size-sans);
    font-weight: 500;
  }
</style>
