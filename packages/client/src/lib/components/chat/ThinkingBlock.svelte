<script lang="ts">
  import { chirpEngine } from '$lib/audio/chirp-engine';
  import { settingsStore } from '$lib/stores/settings.svelte';

  let { content, streaming = false } = $props<{ content: string; streaming?: boolean }>();
  let collapsed = $state(true);

  function uiClick() {
    if (settingsStore.soundEnabled) chirpEngine.uiClick();
  }
</script>

<div class="thinking-block" class:streaming>
  <button
    class="thinking-header"
    onclick={() => {
      collapsed = !collapsed;
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
      class:rotated={!collapsed}
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
    <span class="thinking-label">
      {#if streaming}
        Thinking...
      {:else}
        Thinking ({content.length} chars)
      {/if}
    </span>
  </button>

  {#if !collapsed}
    <div class="thinking-content">
      <pre>{content}</pre>
    </div>
  {/if}
</div>

<style>
  .thinking-block {
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  .thinking-header {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 6px 10px;
    font-size: var(--fs-sm);
    color: var(--text-tertiary);
    background: var(--bg-tertiary);
    transition: background var(--transition);
  }
  .thinking-header:hover {
    background: var(--bg-hover);
  }

  .thinking-label {
    font-style: italic;
  }

  svg {
    transition: transform var(--transition);
  }
  .rotated {
    transform: rotate(90deg);
  }

  .thinking-content {
    padding: 10px;
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    max-height: 300px;
    overflow-y: auto;
    background: var(--bg-primary);
  }

  .thinking-content pre {
    white-space: pre-wrap;
    word-break: break-word;
    font-size: var(--fs-sm);
    line-height: 1.5;
    background: none;
    padding: 0;
  }

  .streaming .thinking-label::after {
    content: '';
    display: inline-block;
    width: 8px;
    height: 8px;
    background: var(--accent-primary);
    border-radius: 50%;
    margin-left: 6px;
    animation: pulse 1s infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.3;
    }
  }
</style>
