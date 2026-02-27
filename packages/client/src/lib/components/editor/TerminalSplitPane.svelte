<script lang="ts">
  import type { TerminalLayout } from '@e/shared';
  import { terminalStore } from '$lib/stores/terminal.svelte';
  import SplitPane from '../layout/SplitPane.svelte';
  import TerminalInstance from './TerminalInstance.svelte';
  import TerminalSearchBar from './TerminalSearchBar.svelte';

  let {
    layout,
    focusedSessionId,
    active = true,
  } = $props<{
    layout: TerminalLayout;
    focusedSessionId: string;
    active?: boolean;
  }>();

  /** Collect all session IDs from a layout subtree (for ratio identification) */
  function collectSessionIds(node: TerminalLayout): string[] {
    if (node.type === 'leaf') return [node.sessionId];
    return [...collectSessionIds(node.first), ...collectSessionIds(node.second)];
  }

  /** Handle clicking on a pane to focus it */
  function handlePaneClick(sessionId: string) {
    if (focusedSessionId !== sessionId) {
      terminalStore.focusSplit(sessionId);
    }
  }

  /** Handle focus event from terminal (clicking inside xterm) */
  function handlePaneFocus(sessionId: string) {
    if (focusedSessionId !== sessionId) {
      terminalStore.focusSplit(sessionId);
    }
  }
</script>

{#if layout.type === 'leaf'}
  {@const cmdStatus = terminalStore.getCommandStatus(layout.sessionId)}
  {@const isBroadcasting = terminalStore.isBroadcastActiveForSession(layout.sessionId)}
  <!-- Leaf node: render a TerminalInstance with focus indicator -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="split-leaf"
    class:focused={focusedSessionId === layout.sessionId}
    class:broadcasting={isBroadcasting}
    onmousedown={() => handlePaneClick(layout.sessionId)}
    onfocusin={() => handlePaneFocus(layout.sessionId)}
    role="group"
    aria-label={`Terminal pane${focusedSessionId === layout.sessionId ? ', focused' : ''}`}
  >
    {#if terminalStore.isSearchOpen(layout.sessionId)}
      <TerminalSearchBar sessionId={layout.sessionId} />
    {/if}
    <TerminalInstance sessionId={layout.sessionId} {active} />
    {#if cmdStatus}
      <div
        class="exit-code-badge"
        class:success={cmdStatus.exitCode === 0}
        class:failure={cmdStatus.exitCode !== 0}
        title={cmdStatus.exitCode === 0
          ? 'Last command succeeded'
          : `Last command failed (exit code ${cmdStatus.exitCode})`}
        role="status"
        aria-label={cmdStatus.exitCode === 0
          ? 'Last command succeeded'
          : `Last command failed with exit code ${cmdStatus.exitCode}`}
      >
        {#if cmdStatus.exitCode === 0}
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        {:else}
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
          >
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
          <span class="exit-code-num">{cmdStatus.exitCode}</span>
        {/if}
      </div>
    {/if}
  </div>
{:else}
  <!-- Branch node: render SplitPane with two recursive children -->
  {@const firstIds = collectSessionIds(layout.first)}
  {@const secondIds = collectSessionIds(layout.second)}
  <SplitPane
    ratio={layout.ratio}
    direction={layout.direction}
    onRatioChange={(newRatio) => {
      terminalStore.setSplitRatio(firstIds[0], secondIds[0], newRatio);
    }}
  >
    {#snippet first()}
      <svelte:self layout={layout.first} {focusedSessionId} {active} />
    {/snippet}
    {#snippet second()}
      <svelte:self layout={layout.second} {focusedSessionId} {active} />
    {/snippet}
  </SplitPane>
{/if}

<style>
  .split-leaf {
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    position: relative;
    border: 1px solid transparent;
    transition:
      border-color var(--transition),
      box-shadow var(--transition);
  }

  .split-leaf.focused {
    border-color: color-mix(in srgb, var(--accent-primary) 50%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-primary) 20%, transparent);
  }

  .split-leaf.broadcasting {
    border-color: color-mix(in srgb, var(--accent-warning, #ffaa00) 40%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-warning, #ffaa00) 15%, transparent);
  }

  .split-leaf.broadcasting.focused {
    border-color: color-mix(in srgb, var(--accent-warning, #ffaa00) 60%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-warning, #ffaa00) 25%, transparent);
  }

  /* ── Exit code badge (gutter) ── */
  .exit-code-badge {
    position: absolute;
    bottom: 6px;
    right: 10px;
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 2px 6px;
    border-radius: var(--radius-sm, 4px);
    font-size: var(--fs-xxs);
    font-weight: 600;
    font-family: var(--font-family-mono, monospace);
    line-height: 1;
    z-index: 10;
    pointer-events: none;
    opacity: 0.85;
    transition: opacity var(--transition);
  }
  .exit-code-badge.success {
    color: var(--accent-secondary, #00ff88);
    background: color-mix(in srgb, var(--accent-secondary, #00ff88) 15%, transparent);
  }
  .exit-code-badge.failure {
    color: var(--accent-error, #ff3344);
    background: color-mix(in srgb, var(--accent-error, #ff3344) 15%, transparent);
  }
  .exit-code-num {
    font-size: var(--fs-xs);
  }
</style>
