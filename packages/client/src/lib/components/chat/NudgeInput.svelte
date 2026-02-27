<script lang="ts">
  import { streamStore } from '$lib/stores/stream.svelte';
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { uiStore } from '$lib/stores/ui.svelte';
  import { api } from '$lib/api/client';

  let text = $state('');
  let sending = $state(false);
  let textarea: HTMLTextAreaElement;

  async function sendNudge() {
    const content = text.trim();
    if (!content || sending) return;

    const conversationId = conversationStore.activeId;
    const sessionId = streamStore.sessionId;
    if (!conversationId || !sessionId) return;

    sending = true;
    try {
      await api.stream.nudge(conversationId, sessionId, content);
      text = '';
      uiStore.toast('Nudge queued for next agent turn', 'info');
    } catch (err) {
      uiStore.toast('Failed to send nudge', 'error');
    } finally {
      sending = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendNudge();
    }
  }

  function autoResize() {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
  }
</script>

<div class="nudge-input-wrap">
  <div class="nudge-label">
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
    </svg>
    Nudge agent
  </div>
  <div class="nudge-row">
    <textarea
      bind:this={textarea}
      bind:value={text}
      onkeydown={handleKeydown}
      oninput={autoResize}
      placeholder="Send feedback without stopping the stream…"
      rows="1"
      disabled={sending}
    ></textarea>
    <button
      class="nudge-send"
      onclick={sendNudge}
      disabled={!text.trim() || sending}
      title="Send nudge (Enter)"
    >
      {#if sending}
        <span class="spinner"></span>
      {:else}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <line x1="22" y1="2" x2="11" y2="13"></line>
          <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
        </svg>
      {/if}
    </button>
  </div>
</div>

<style>
  .nudge-input-wrap {
    margin: 8px 28px 4px;
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
    overflow: hidden;
    animation: nudgeFadeIn 0.18s ease-out;
  }

  @keyframes nudgeFadeIn {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .nudge-label {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    font-size: var(--fs-xxs);
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--accent-primary);
    opacity: 0.7;
    border-bottom: 1px solid var(--border-primary);
    background: var(--bg-tertiary);
  }

  .nudge-row {
    display: flex;
    align-items: flex-end;
    gap: 0;
  }

  textarea {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    padding: 8px 10px;
    font-size: var(--fs-base);
    font-family: var(--font-family-sans);
    color: var(--text-primary);
    resize: none;
    line-height: 1.5;
    min-height: 36px;
    max-height: 120px;
    overflow-y: auto;
  }

  textarea::placeholder {
    color: var(--text-tertiary);
    font-style: italic;
  }

  textarea:disabled {
    opacity: 0.5;
  }

  .nudge-send {
    flex-shrink: 0;
    width: 34px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-left: 1px solid var(--border-primary);
    color: var(--accent-primary);
    cursor: pointer;
    transition: all var(--transition);
    opacity: 0.7;
  }

  .nudge-send:hover:not(:disabled) {
    opacity: 1;
    background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
  }

  .nudge-send:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .spinner {
    width: 12px;
    height: 12px;
    border: 2px solid var(--border-secondary);
    border-top-color: var(--accent-primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    display: block;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
