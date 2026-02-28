<script lang="ts">
  import type { Message, MessageContent, StreamEvent } from '@e/shared';
  import { api } from '$lib/api/client';
  import { onMount, onDestroy } from 'svelte';
  import MessageBubble from '../chat/MessageBubble.svelte';

  let { conversationId, storyTitle } = $props<{
    conversationId: string;
    storyTitle: string;
  }>();

  // --- Local stream state (independent from singleton streamStore) ---
  let messages = $state<Message[]>([]);
  let isStreaming = $state(false);
  let streamStatus = $state<'idle' | 'connecting' | 'streaming' | 'done' | 'error'>('idle');
  let streamError = $state<string | null>(null);
  let abortController = $state<AbortController | null>(null);
  let scrollEl = $state<HTMLDivElement | null>(null);
  let autoScroll = $state(true);

  // Polling for session discovery
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let pollAttempts = 0;
  const MAX_POLL_ATTEMPTS = 15; // 30 seconds

  // --- Stream event processor (local-only, does not touch global stores) ---
  function applyStreamEvent(
    event: StreamEvent,
    blocks: MessageContent[],
    offsetRef: { value: number },
  ): void {
    switch (event.type) {
      case 'message_start':
        offsetRef.value = blocks.length;
        break;

      case 'content_block_start': {
        const pid = (event as any).parent_tool_use_id;
        if (event.content_block.type === 'text') {
          blocks.push({
            type: 'text',
            text: event.content_block.text ?? '',
            parentToolUseId: pid,
          });
        } else if (event.content_block.type === 'thinking') {
          blocks.push({
            type: 'thinking',
            thinking: event.content_block.thinking ?? '',
            parentToolUseId: pid,
          });
        } else if (event.content_block.type === 'tool_use') {
          blocks.push({
            type: 'tool_use',
            id: event.content_block.id ?? '',
            name: event.content_block.name ?? '',
            input: {},
            parentToolUseId: pid,
          });
        }
        break;
      }

      case 'content_block_delta': {
        const idx = offsetRef.value + event.index;
        if (idx < 0 || idx >= blocks.length) break;
        const prev = blocks[idx];
        if (event.delta.type === 'text_delta' && prev.type === 'text') {
          blocks[idx] = { ...prev, text: prev.text + (event.delta.text ?? '') };
        } else if (event.delta.type === 'thinking_delta' && prev.type === 'thinking') {
          blocks[idx] = {
            ...prev,
            thinking: prev.thinking + (event.delta.thinking ?? ''),
          };
        } else if (event.delta.type === 'input_json_delta' && prev.type === 'tool_use') {
          try {
            blocks[idx] = { ...prev, input: JSON.parse(event.delta.partial_json ?? '{}') };
          } catch {
            // Partial JSON not yet parseable
          }
        }
        break;
      }

      case 'message_stop':
        // Stream turn complete
        break;

      case 'tool_result':
        // Track tool results — update the corresponding tool_use block
        if (event.toolCallId) {
          const toolIdx = blocks.findIndex(
            (b) => b.type === 'tool_use' && b.id === event.toolCallId,
          );
          if (toolIdx >= 0) {
            blocks[toolIdx] = { ...blocks[toolIdx] };
          }
        }
        break;
    }
  }

  // --- Scroll management ---
  function scrollToBottom() {
    if (scrollEl && autoScroll) {
      requestAnimationFrame(() => {
        scrollEl!.scrollTop = scrollEl!.scrollHeight;
      });
    }
  }

  function onScroll() {
    if (!scrollEl) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollEl;
    // Auto-scroll if user is near the bottom (within 100px)
    autoScroll = scrollHeight - scrollTop - clientHeight < 100;
  }

  // --- Stream connection ---
  async function connectToStream(): Promise<void> {
    streamStatus = 'connecting';
    streamError = null;

    try {
      // 1. Load existing conversation messages from DB
      const convRes = await api.conversations.get(conversationId);
      if (convRes.ok && convRes.data) {
        messages = convRes.data.messages ?? [];
      }

      // 2. Find an active SSE session for this conversation
      const sessionsRes = await api.stream.sessions();
      if (!sessionsRes.ok) {
        streamStatus = messages.length > 0 ? 'done' : 'idle';
        return;
      }

      const session = sessionsRes.data.find(
        (s) =>
          s.conversationId === conversationId &&
          (s.status === 'running' || (s.bufferedEvents > 0 && !s.streamComplete)),
      );

      // Also check for just-completed sessions with buffered events
      const completedSession =
        !session &&
        sessionsRes.data.find(
          (s) =>
            s.conversationId === conversationId &&
            s.streamComplete &&
            s.bufferedEvents > 0 &&
            !s.cancelled,
        );

      const targetSession = session || completedSession;
      if (!targetSession) {
        // No active session — show static messages
        streamStatus = messages.length > 0 ? 'done' : 'idle';
        return;
      }

      // 3. Connect SSE reader
      isStreaming = true;
      streamStatus = 'streaming';
      const ctrl = new AbortController();
      abortController = ctrl;

      const response = await api.stream.reconnect(targetSession.id, ctrl.signal);
      if (!response.ok || !response.body) {
        isStreaming = false;
        streamStatus = 'error';
        streamError = `Reconnect failed: ${response.status}`;
        return;
      }

      // 4. Build local content blocks from SSE events
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const localBlocks: MessageContent[] = [];
      const indexOffset = { value: 0 };

      // Ensure there's an assistant placeholder at the end
      const lastMsg = messages[messages.length - 1];
      if (!lastMsg || lastMsg.role !== 'assistant') {
        messages = [
          ...messages,
          {
            id: `streaming-${conversationId}`,
            role: 'assistant',
            content: [],
            timestamp: Date.now(),
          },
        ];
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (!data) continue;

          try {
            const event: StreamEvent = JSON.parse(data);
            applyStreamEvent(event, localBlocks, indexOffset);

            // Update the last assistant message with current blocks
            messages = [
              ...messages.slice(0, -1),
              {
                ...messages[messages.length - 1],
                content: [...localBlocks],
              },
            ];
            scrollToBottom();
          } catch {
            // Non-JSON line
          }
        }
      }

      // Stream ended — reload from DB for authoritative final version
      isStreaming = false;
      streamStatus = 'done';
      const finalRes = await api.conversations.get(conversationId);
      if (finalRes.ok && finalRes.data) {
        messages = finalRes.data.messages ?? [];
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        // Expected — component unmounting
        return;
      }
      console.error(`[GolemTaskColumn] Stream error for ${conversationId}:`, err);
      isStreaming = false;
      streamStatus = 'error';
      streamError = (err as Error).message;
    }
  }

  // --- Polling for late-appearing sessions ---
  function startSessionPolling() {
    if (pollTimer) return;
    pollAttempts = 0;
    pollTimer = setInterval(async () => {
      pollAttempts++;
      if (pollAttempts >= MAX_POLL_ATTEMPTS) {
        stopPolling();
        streamStatus = messages.length > 0 ? 'done' : 'idle';
        return;
      }

      try {
        // First try to load any messages that appeared
        if (messages.length === 0) {
          const convRes = await api.conversations.get(conversationId);
          if (convRes.ok && convRes.data?.messages?.length) {
            messages = convRes.data.messages;
          }
        }

        const sessionsRes = await api.stream.sessions();
        if (!sessionsRes.ok) return;

        const session = sessionsRes.data.find(
          (s) => s.conversationId === conversationId && s.status === 'running',
        );
        if (session) {
          stopPolling();
          await connectToStream();
        }
      } catch {
        // Non-critical
      }
    }, 2000);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  // --- Lifecycle ---
  onMount(async () => {
    // Try to connect immediately
    await connectToStream();

    // If no active stream found but status is idle, start polling
    // (conversation may not exist yet — executor hasn't created it)
    if (streamStatus === 'idle') {
      startSessionPolling();
    }
  });

  onDestroy(() => {
    stopPolling();
    if (abortController) {
      try {
        abortController.abort();
      } catch {
        // Already aborted
      }
    }
  });

  // Re-connect when conversationId changes
  $effect(() => {
    // Capture the reactive dependency
    const _convId = conversationId;
    // Skip initial mount (handled by onMount)
    if (streamStatus === 'idle' && messages.length === 0 && !pollTimer) return;
    // The actual reconnect is triggered by conversationId change
  });
</script>

<div class="task-column">
  <div class="column-header">
    <div class="column-title" title={storyTitle}>{storyTitle}</div>
    <div class="column-status">
      {#if streamStatus === 'streaming'}
        <span class="status-dot streaming"></span>
        <span class="status-label">Streaming</span>
      {:else if streamStatus === 'connecting'}
        <span class="status-dot connecting"></span>
        <span class="status-label">Connecting...</span>
      {:else if streamStatus === 'done'}
        <span class="status-dot done"></span>
        <span class="status-label">Complete</span>
      {:else if streamStatus === 'error'}
        <span class="status-dot error"></span>
        <span class="status-label">Error</span>
      {:else}
        <span class="status-dot idle"></span>
        <span class="status-label">Waiting...</span>
      {/if}
    </div>
  </div>

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="column-messages" bind:this={scrollEl} onscroll={onScroll}>
    {#if messages.length === 0 && streamStatus === 'idle'}
      <div class="column-empty">
        <div class="empty-spinner"></div>
        <span>Waiting for agent to start...</span>
      </div>
    {:else if messages.length === 0 && streamStatus === 'error'}
      <div class="column-empty error">
        <span>Failed to connect: {streamError}</span>
      </div>
    {:else}
      {#each messages as message (message.id)}
        <MessageBubble {message} {conversationId} />
      {/each}
      {#if isStreaming}
        <div class="streaming-indicator">
          <span class="streaming-dot"></span>
          <span class="streaming-dot"></span>
          <span class="streaming-dot"></span>
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .task-column {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    height: 100%;
    border-right: 1px solid var(--border-primary);
    overflow: hidden;
  }

  .task-column:last-child {
    border-right: none;
  }

  /* ── Column header ── */
  .column-header {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 12px;
    background: var(--bg-tertiary);
    border-bottom: 1px solid var(--border-primary);
  }

  .column-title {
    font-size: var(--fs-sm);
    font-weight: 700;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .column-status {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }

  .status-dot.streaming {
    background: var(--accent-primary);
    animation: statusPulse 1.5s ease-in-out infinite;
  }

  .status-dot.connecting {
    background: var(--accent-warning);
    animation: statusPulse 1s ease-in-out infinite;
  }

  .status-dot.done {
    background: var(--accent-secondary);
  }

  .status-dot.error {
    background: var(--accent-error);
  }

  .status-dot.idle {
    background: var(--text-tertiary);
    opacity: 0.5;
  }

  @keyframes statusPulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.3;
    }
  }

  .status-label {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
    font-weight: 600;
  }

  /* ── Messages area ── */
  .column-messages {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .column-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: var(--text-tertiary);
    font-size: var(--fs-sm);
    padding: 24px;
    text-align: center;
  }

  .column-empty.error {
    color: var(--accent-error);
  }

  .empty-spinner {
    width: 20px;
    height: 20px;
    border: 2px solid var(--border-secondary);
    border-top-color: var(--accent-primary);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* ── Streaming indicator ── */
  .streaming-indicator {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 12px;
  }

  .streaming-dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--accent-primary);
    animation: streamingBounce 1.4s ease-in-out infinite;
  }

  .streaming-dot:nth-child(2) {
    animation-delay: 0.2s;
  }

  .streaming-dot:nth-child(3) {
    animation-delay: 0.4s;
  }

  @keyframes streamingBounce {
    0%,
    80%,
    100% {
      transform: scale(0.6);
      opacity: 0.4;
    }
    40% {
      transform: scale(1);
      opacity: 1;
    }
  }
</style>
