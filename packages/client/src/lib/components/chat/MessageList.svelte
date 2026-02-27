<script lang="ts">
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import MessageBubble from './MessageBubble.svelte';
  import StreamingMessage from './StreamingMessage.svelte';
  import StoryActionCards from './StoryActionCards.svelte';
  import SpriteAnimation from '$lib/components/ui/SpriteAnimation.svelte';
  import { streamStore } from '$lib/stores/stream.svelte';
  import { loopStore } from '$lib/stores/loop.svelte';
  import { scrollStore } from '$lib/stores/scroll.svelte';
  import { uiStore } from '$lib/stores/ui.svelte';
  import { hasStoryActions } from '$lib/utils/story-parser';
  import { sendAndStream } from '$lib/api/sse';
  import { api } from '$lib/api/client';
  import { tick } from 'svelte';
  import NudgeInput from './NudgeInput.svelte';
  import { voiceStore } from '$lib/stores/voice.svelte';
  import { ttsStore } from '$lib/services/tts.svelte';

  // Check if the current conversation is a planning conversation with edits enabled
  let isPlanningWithEdits = $derived(
    loopStore.allowEdits &&
      loopStore.planConversationId === conversationStore.activeId &&
      conversationStore.active?.title?.startsWith('[Plan]'),
  );

  // ── Message action handlers ──

  async function handleEdit(messageId: string, newText: string) {
    if (!conversationStore.active) return;
    const isStreamingHere =
      streamStore.isStreaming && streamStore.conversationId === conversationStore.activeId;
    if (isStreamingHere) return;

    const convId = conversationStore.active.id;
    const success = await conversationStore.editMessage(messageId, newText);
    if (success) {
      // Reset stream session so a fresh CLI session is created
      streamStore.reset();
      await sendAndStream(convId, newText);
    }
  }

  async function handleDelete(messageId: string) {
    if (!conversationStore.active) return;
    const isStreamingHere =
      streamStore.isStreaming && streamStore.conversationId === conversationStore.activeId;
    if (isStreamingHere) return;

    const msg = conversationStore.active.messages.find((m) => m.id === messageId);
    if (!msg) return;

    const deletePair = msg.role === 'user';
    await conversationStore.deleteMessage(messageId, deletePair);
    uiStore.toast('Message deleted', 'info');
  }

  async function handleFork(messageId: string) {
    if (!conversationStore.active) return;

    const newId = await conversationStore.forkFromMessage(messageId);
    if (newId) {
      uiStore.toast('Conversation forked', 'success');
      conversationStore.setLoading(true);
      try {
        const res = await api.conversations.get(newId);
        conversationStore.setActive(res.data);
        streamStore.reset();
      } finally {
        conversationStore.setLoading(false);
      }
    }
  }

  let scrollContainer: HTMLDivElement;
  let userScrolled = $state(false);
  let scrollPending = false;

  function handleScroll() {
    if (!scrollContainer || scrollPending) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
    userScrolled = scrollHeight - scrollTop - clientHeight > 60;
    // Broadcast scroll offset for ambient effects (star sphere rotation)
    scrollStore.set(scrollTop);
  }

  async function scrollToBottom() {
    if (userScrolled) return;
    if (scrollPending) return;
    scrollPending = true;
    await tick();
    await tick(); // double tick to let DOM fully settle
    if (scrollContainer) {
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    }
    scrollPending = false;
  }

  // Track the conversation ID so we can detect actual switches
  let lastConversationId: string | null | undefined = undefined;

  // Single effect that watches conversation identity, messages, and streaming content
  $effect(() => {
    // Touch reactive deps
    const id = conversationStore.active?.id ?? null;
    const _msgs = conversationStore.active?.messages?.length;
    const _blocks = streamStore.contentBlocks.length;
    const _status = streamStore.status;

    // When the conversation actually changes, reset scroll state
    if (id !== lastConversationId) {
      lastConversationId = id;
      userScrolled = false;
      scrollPending = false;
    }

    scrollToBottom();
  });

  // Auto-speak assistant responses when voice mode is enabled with auto-speak
  let lastSpokenMessageId: string | null = null;
  $effect(() => {
    if (!settingsStore.voiceAutoSpeak || !voiceStore.enabled) return;
    if (streamStore.isStreaming) return; // Wait for stream to complete

    const lastMessage = conversationStore.active?.messages.at(-1);
    if (!lastMessage || lastMessage.role !== 'assistant') return;
    if (lastMessage.id === lastSpokenMessageId) return; // Already spoke this one

    // Get text content from the message
    const textContent = lastMessage.content
      .filter((c: any) => c.type === 'text' && !c.parentToolUseId)
      .map((c: any) => c.text)
      .join(' ')
      .trim();

    if (textContent) {
      lastSpokenMessageId = lastMessage.id;
      ttsStore.speak(textContent, lastMessage.id);
    }
  });
</script>

<div class="message-list" bind:this={scrollContainer} onscroll={handleScroll}>
  {#if !conversationStore.active || conversationStore.active.messages.length === 0}
    <div class="empty-state">
      <div class="empty-icon">
        <SpriteAnimation size={48} class="empty-sprite" />
      </div>
      <p>Start a conversation to begin.</p>
      <div class="shortcuts">
        <kbd>Ctrl+K</kbd> PALETTE
        <kbd>Ctrl+/</kbd> SIDEBAR
        <kbd>/</kbd> COMMANDS
      </div>
    </div>
  {:else}
    {@const msgs = conversationStore.active.messages}
    {#each msgs as message, i (message.id)}
      {@const isStreamingHere =
        streamStore.isStreaming && streamStore.conversationId === conversationStore.activeId}
      {#if !(isStreamingHere && i === msgs.length - 1 && message.role === 'assistant')}
        <MessageBubble
          {message}
          conversationId={conversationStore.activeId ?? undefined}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onFork={handleFork}
        />
        {#if isPlanningWithEdits && message.role === 'assistant'}
          <StoryActionCards {message} />
        {/if}
      {/if}
    {/each}

    {#if streamStore.isStreaming && streamStore.conversationId === conversationStore.activeId}
      <StreamingMessage />
      <NudgeInput />
    {/if}

    {#if streamStore.compactBoundary && streamStore.conversationId === conversationStore.activeId}
      {@const b = streamStore.compactBoundary}
      <div class="compact-boundary">
        <div class="compact-boundary-line"></div>
        <div class="compact-boundary-label">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <polyline points="1 4 1 10 7 10"></polyline>
            <polyline points="23 20 23 14 17 14"></polyline>
            <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"></path>
          </svg>
          Conversation compacted · {b.pre_tokens.toLocaleString()} tokens → summary
        </div>
        <div class="compact-boundary-line"></div>
      </div>
    {:else if streamStore.contextWarning && !streamStore.contextWarning.autocompacted && streamStore.conversationId === conversationStore.activeId}
      {@const w = streamStore.contextWarning}
      <div class="context-warning">
        <span class="context-warning-icon"
          ><svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><path
              d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
            /><line x1="12" y1="9" x2="12" y2="13" /><line
              x1="12"
              y1="17"
              x2="12.01"
              y2="17"
            /></svg
          ></span
        >
        <span class="context-warning-text">
          Context window is {w.usagePercent}% full ({w.inputTokens.toLocaleString()} / {w.contextLimit.toLocaleString()}
          tokens). Auto-compact will trigger soon.
        </span>
      </div>
    {/if}

    {#if streamStore.status === 'error' && streamStore.error}
      <div class="stream-error">
        <span class="error-label">ERROR</span>
        <span class="error-message">{streamStore.error}</span>
      </div>
    {/if}
  {/if}

  {#if userScrolled}
    <button
      class="scroll-bottom"
      onclick={() => {
        userScrolled = false;
        scrollToBottom();
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M12 5v14M5 12l7 7 7-7" />
      </svg>
    </button>
  {/if}
</div>

<style>
  .message-list {
    height: 100%;
    overflow-y: auto;
    padding: 20px 0;
    padding-bottom: var(--input-overlay-h, 80px);
    position: relative;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-tertiary);
    gap: 16px;
    text-align: center;
    padding: 20px;
    animation: fadeIn 0.5s linear;
  }
  .empty-state p {
    font-size: var(--fs-md);
    max-width: 420px;
    color: var(--text-secondary);
    line-height: 1.6;
    letter-spacing: 0.2px;
    font-weight: 500;
  }
  .empty-icon {
    opacity: 0.5;
    filter: drop-shadow(var(--shadow-glow));
  }
  .shortcuts {
    display: flex;
    gap: 20px;
    font-size: var(--fs-sm);
    margin-top: 12px;
    color: var(--text-secondary);
    letter-spacing: var(--ht-label-spacing);
    font-weight: 600;
  }
  .shortcuts kbd {
    background: var(--bg-tertiary);
    padding: 2px 8px;
    border-radius: var(--radius-sm);
    font-size: var(--fs-xs);
    font-family: var(--font-family);
    margin-right: 5px;
    border: 1px solid var(--border-primary);
    color: var(--accent-primary);
  }

  .compact-boundary {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 16px 28px;
    color: var(--text-tertiary);
  }
  .compact-boundary-line {
    flex: 1;
    height: 1px;
    background: linear-gradient(to right, transparent, var(--border-primary), transparent);
  }
  .compact-boundary-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: var(--ht-label-spacing, 0.06em);
    white-space: nowrap;
    color: var(--accent-primary);
    opacity: 0.65;
  }

  .context-warning {
    margin: 4px 28px 8px;
    padding: 8px 14px;
    background: rgba(255, 170, 0, 0.07);
    border-left: 2px solid rgba(255, 170, 0, 0.5);
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    gap: 8px;
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  }
  .context-warning-icon {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }
  .context-warning-text {
    letter-spacing: 0.01em;
  }

  .stream-error {
    margin: 8px 28px;
    padding: 12px 16px;
    background: rgba(255, 50, 50, 0.08);
    border-left: 2px solid var(--error, #ff3232);
    font-size: var(--fs-base);
    color: var(--text-primary);
    display: flex;
    align-items: baseline;
    gap: 10px;
  }
  .error-label {
    font-size: var(--fs-xs);
    font-weight: 700;
    letter-spacing: 1px;
    color: var(--error, #ff3232);
    flex-shrink: 0;
  }
  .error-message {
    word-break: break-word;
    color: var(--text-secondary);
  }

  .scroll-bottom {
    position: sticky;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    width: 32px;
    height: 32px;
    border-radius: var(--radius);
    background: var(--bg-elevated);
    border: 1px solid var(--border-primary);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent-primary);
    cursor: pointer;
    transition: all var(--transition);
  }
  .scroll-bottom:hover {
    background: var(--bg-active);
    border-color: var(--accent-primary);
    box-shadow: var(--shadow-glow-sm);
    transform: translateX(-50%);
  }
</style>
