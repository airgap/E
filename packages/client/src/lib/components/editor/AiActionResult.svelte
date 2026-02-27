<!--
  AiActionResult.svelte — Floating result panel for inline AI code actions.

  Shows above/below the editor when an AI action completes.
  Displays the result with copy and dismiss controls.
-->
<script lang="ts">
  import { aiActionsStore } from '$lib/stores/ai-actions.svelte';

  const action = $derived(aiActionsStore.activeAction);
  const visible = $derived(action !== null);

  const actionLabels: Record<string, string> = {
    explain: 'Explanation',
    optimize: 'Optimized',
    simplify: 'Simplified',
    'generate-test': 'Generated Tests',
    'fix-diagnostic': 'Fix',
    document: 'Documented',
    custom: 'Result',
  };

  let copied = $state(false);

  async function copyResult() {
    if (!action?.result) return;
    try {
      await navigator.clipboard.writeText(action.result);
      copied = true;
      setTimeout(() => {
        copied = false;
      }, 1500);
    } catch {
      // Clipboard may not be available
    }
  }
</script>

{#if visible && action}
  <div class="ai-action-result" class:error={action.status === 'error'}>
    <div class="result-header">
      <span class="result-label">
        {#if action.status === 'running'}
          <span class="spinner"></span>
          Running {actionLabels[action.action] ?? action.action}...
        {:else if action.status === 'error'}
          Error: {action.error}
        {:else}
          {actionLabels[action.action] ?? action.action}
        {/if}
      </span>
      <div class="result-actions">
        {#if action.status === 'completed'}
          <button
            class="result-btn"
            class:copied
            onclick={copyResult}
            title={copied ? 'Copied!' : 'Copy result'}
          >
            {#if copied}
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            {:else}
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            {/if}
          </button>
        {/if}
        <button
          class="result-btn dismiss"
          onclick={() => aiActionsStore.clearActive()}
          title="Dismiss"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
    {#if action.status === 'completed' && action.result}
      <div class="result-content">
        <pre>{action.result}</pre>
      </div>
    {/if}
  </div>
{/if}

<style>
  .ai-action-result {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    max-height: 40%;
    background: var(--bg-secondary, #161b22);
    border-top: 1px solid var(--border-primary, #30363d);
    z-index: 20;
    display: flex;
    flex-direction: column;
    animation: slideUp 0.15s ease-out;
  }

  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .ai-action-result.error {
    border-top-color: var(--accent-error, #ff3344);
  }

  .result-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    border-bottom: 1px solid var(--border-secondary, #21262d);
    min-height: 32px;
  }

  .result-label {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-primary, #c9d1d9);
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .error .result-label {
    color: var(--accent-error, #ff3344);
  }

  .spinner {
    width: 12px;
    height: 12px;
    border: 2px solid var(--text-tertiary, #484f58);
    border-top-color: var(--accent-primary, #00b4ff);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .result-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .result-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    background: none;
    color: var(--text-tertiary, #484f58);
    cursor: pointer;
    border-radius: var(--radius-sm, 4px);
    transition:
      color 0.15s ease,
      background 0.15s ease;
  }

  .result-btn:hover {
    color: var(--text-primary, #c9d1d9);
    background: color-mix(in srgb, var(--text-primary, #c9d1d9) 10%, transparent);
  }

  .result-btn.copied {
    color: var(--accent-secondary, #00ff88);
  }

  .result-btn.dismiss:hover {
    color: var(--accent-error, #ff3344);
  }

  .result-content {
    overflow: auto;
    padding: 8px 12px;
    flex: 1;
    min-height: 0;
  }

  .result-content pre {
    margin: 0;
    font-family: var(--font-family-mono, monospace);
    font-size: var(--fs-sm);
    color: var(--text-primary, #c9d1d9);
    white-space: pre-wrap;
    word-wrap: break-word;
    line-height: 1.5;
  }
</style>
