<script lang="ts">
  import { api } from '$lib/api/client';
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { uiStore } from '$lib/stores/ui.svelte';
  import { streamStore } from '$lib/stores/stream.svelte';

  let {
    conversationId,
    messageId,
    role,
  }: {
    conversationId: string;
    messageId: string;
    role: string;
  } = $props();

  let status = $state<'idle' | 'loading' | 'success'>('idle');

  const VISIBLE_ROLES = new Set(['user', 'assistant']);

  async function handleFork() {
    if (status !== 'idle') return;
    status = 'loading';

    try {
      const newId = await conversationStore.forkFromMessage(messageId);
      if (!newId) {
        status = 'idle';
        return;
      }

      status = 'success';

      // Navigate to the new conversation after a brief success flash
      setTimeout(async () => {
        conversationStore.setLoading(true);
        try {
          const res = await api.conversations.get(newId);
          conversationStore.setActive(res.data);
          if (!streamStore.isStreaming || streamStore.conversationId === newId) {
            streamStore.reset();
          }
        } finally {
          conversationStore.setLoading(false);
          status = 'idle';
        }
      }, 900);
    } catch (e) {
      console.warn('[ConversationBranchButton] Fork failed:', e);
      status = 'idle';
    }
  }
</script>

{#if VISIBLE_ROLES.has(role)}
  <button
    class="branch-btn"
    class:loading={status === 'loading'}
    class:success={status === 'success'}
    onclick={handleFork}
    disabled={status !== 'idle'}
    title="Branch conversation from this message"
    aria-label="Branch conversation from this message"
  >
    {#if status === 'loading'}
      <span class="branch-label">Branching...</span>
    {:else if status === 'success'}
      <span class="branch-label"
        ><svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          ><circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><path
            d="M6 21V9a9 9 0 0 0 9 9"
          /></svg
        > Forked</span
      >
    {:else}
      <span class="branch-icon"
        ><svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          ><circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><path
            d="M6 21V9a9 9 0 0 0 9 9"
          /></svg
        ></span
      >
    {/if}
  </button>
{/if}

<style>
  .branch-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    font-size: var(--fs-md);
    line-height: 1;
    opacity: 0;
    transition:
      opacity 0.15s ease,
      background 0.15s ease,
      color 0.15s ease;
    flex-shrink: 0;

    /*
     * Visibility is controlled by the parent. Add this rule to the parent's
     * stylesheet to reveal the button on hover:
     *
     *   .message-bubble:hover :global(.branch-btn) { opacity: 1; }
     */
  }

  .branch-btn:hover:not(:disabled) {
    background: var(--bg-secondary, rgba(128, 128, 128, 0.15));
    color: var(--text-primary);
  }

  .branch-btn:disabled {
    cursor: default;
  }

  .branch-btn.loading {
    width: auto;
    padding: 0 6px;
    opacity: 1;
    color: var(--text-secondary);
    font-size: var(--fs-xs);
  }

  .branch-btn.success {
    width: auto;
    padding: 0 6px;
    opacity: 1;
    color: var(--accent, #4a9eff);
    font-size: var(--fs-xs);
  }

  .branch-label {
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }

  .branch-icon {
    display: flex;
    align-items: center;
  }
</style>
