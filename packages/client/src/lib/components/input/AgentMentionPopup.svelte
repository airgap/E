<script lang="ts">
  /**
   * Agent @-mention autocomplete. Shows when the user's chat input starts
   * with `@<partial-handle>` and no whitespace has been typed yet — analogous
   * to VS Code's chat-participant picker. Emits a `select` event carrying the
   * chosen agent definition; the parent (ChatInput) is responsible for
   * rewriting the text and stashing the agent handle for the next send.
   */
  import { agentRegistryStore, type AgentDefinition } from '$lib/stores/agentRegistry.svelte';
  import { onMount } from 'svelte';

  let {
    query,
    onselect,
    onclose,
  }: {
    query: string;
    onselect: (agent: AgentDefinition) => void;
    onclose: () => void;
  } = $props();

  let selectedIndex = $state(0);

  onMount(() => {
    void agentRegistryStore.ensureLoaded();
  });

  let matches = $derived(agentRegistryStore.search(query, 6));

  $effect(() => {
    void matches;
    selectedIndex = 0;
  });

  export function handleKeydown(e: KeyboardEvent): boolean {
    if (matches.length === 0) return false;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % matches.length;
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = (selectedIndex - 1 + matches.length) % matches.length;
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      onselect(matches[selectedIndex]);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onclose();
      return true;
    }
    return false;
  }
</script>

{#if matches.length > 0}
  <div class="agent-popup" role="listbox" aria-label="Agents">
    <div class="popup-header">Chat with an agent</div>
    {#each matches as agent, i (agent.handle)}
      <button
        class="agent-row"
        class:selected={i === selectedIndex}
        onmouseenter={() => (selectedIndex = i)}
        onclick={() => onselect(agent)}
        role="option"
        aria-selected={i === selectedIndex}
      >
        <span class="agent-icon">{agent.icon}</span>
        <span class="agent-body">
          <span class="agent-name">
            @{agent.handle}
            <span class="agent-display">{agent.name}</span>
          </span>
          <span class="agent-desc">{agent.description}</span>
        </span>
      </button>
    {/each}
  </div>
{/if}

<style>
  .agent-popup {
    position: absolute;
    bottom: 100%;
    left: 0;
    right: 0;
    margin-bottom: 6px;
    background: var(--bg-elevated, var(--bg-secondary));
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-lg, 0 8px 32px rgba(0, 0, 0, 0.35));
    overflow: hidden;
    z-index: 40;
    /* Short scale-and-fade entrance — matches the peek panel's feel. */
    animation: agentPopupIn 120ms ease-out;
    transform-origin: bottom left;
  }
  .popup-header {
    padding: 6px 12px;
    font-family: var(--font-family-sans, sans-serif);
    font-size: var(--fs-xxs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-tertiary);
    border-bottom: 1px solid var(--border-primary);
    background: var(--bg-active);
  }
  .agent-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    width: 100%;
    padding: 8px 12px;
    background: transparent;
    border: none;
    border-left: 2px solid transparent;
    text-align: left;
    cursor: pointer;
    transition:
      background 100ms ease-out,
      border-color 100ms ease-out;
  }
  .agent-row:hover,
  .agent-row.selected {
    background: var(--bg-hover);
    border-left-color: var(--accent-primary, var(--syn-function));
  }
  .agent-icon {
    font-size: 18px;
    line-height: 1;
    color: var(--accent-primary, var(--syn-function));
    padding-top: 2px;
  }
  .agent-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .agent-name {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-family: var(--font-family);
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-primary);
  }
  .agent-display {
    font-family: var(--font-family-sans, sans-serif);
    font-weight: 400;
    color: var(--text-tertiary);
    font-size: var(--fs-xs);
  }
  .agent-desc {
    font-family: var(--font-family-sans, sans-serif);
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  @keyframes agentPopupIn {
    from {
      opacity: 0;
      transform: translateY(4px) scale(0.97);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .agent-popup {
      animation: none;
    }
  }
</style>
