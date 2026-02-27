import type { StreamEvent, Conversation, Attachment, ImageContent } from '@e/shared';
import { streamStore } from '$lib/stores/stream.svelte';
import { conversationStore } from '$lib/stores/conversation.svelte';
import { workspaceStore } from '$lib/stores/workspace.svelte';
import { workspaceMemoryStore } from '$lib/stores/project-memory.svelte';
import { api } from './client';
import { uuid } from '$lib/utils/uuid';
import { processDeviceAction } from '$lib/device/tauri-device';

/**
 * Generation counter to prevent duplicate processing from HMR or concurrent streams.
 * Each sendAndStream/reconnect call increments this. If a reader loop detects that
 * the generation has changed (because a new stream started or HMR triggered), it
 * stops processing to avoid duplicate messages.
 */
let streamGeneration = 0;

/**
 * Abort any currently active stream. Called before starting a new stream or
 * during HMR cleanup to ensure only one reader loop is active at a time.
 */
export function abortActiveStream(): void {
  streamGeneration++;
  if (streamStore.abortController) {
    try {
      streamStore.abortController.abort();
    } catch {
      // Already aborted
    }
  }
}

/**
 * Connect to SSE stream for a conversation.
 * Uses fetch() instead of EventSource to support POST with body.
 *
 * IMPORTANT: This function captures a reference to the target conversation
 * at stream start and routes ALL updates through it, regardless of whether
 * the user switches to a different conversation during streaming.
 */
export async function sendAndStream(
  conversationId: string,
  content: string,
  attachments?: Attachment[],
  messageMetadata?: { isVoiceMessage?: boolean },
): Promise<void> {
  // Stop any active polling fallback — we're starting a fresh stream
  stopConversationPolling();

  // Abort any existing stream to prevent duplicate readers
  abortActiveStream();

  const myGeneration = streamGeneration;
  // console.log('[sse] Starting stream for conversation:', conversationId, 'gen:', myGeneration);
  const abortController = new AbortController();
  streamStore.setAbortController(abortController);
  streamStore.startStream(conversationId);

  // Capture a reference to the conversation we're streaming to.
  // This reference stays valid even if the user switches conversations.
  const targetConversation = conversationStore.active;
  if (!targetConversation || targetConversation.id !== conversationId) {
    streamStore.handleEvent({
      type: 'error',
      error: { type: 'state_error', message: 'Target conversation not active' },
    });
    return;
  }

  // Track as in-flight so navigating back finds the partial response
  conversationStore.setInflight(conversationId, targetConversation);

  // Pre-generate the assistant message ID so snapshots can link to it
  const assistantMsgIdForSnapshot = uuid();

  // Auto-snapshot before agent runs (fire-and-forget), linked to the upcoming assistant message
  const wsPath = targetConversation.workspacePath;
  if (wsPath) {
    api.git
      .snapshot(wsPath, conversationId, 'pre-agent', assistantMsgIdForSnapshot)
      .catch(() => {});
  }

  // Build user message content blocks (text + optional images)
  const userContentBlocks: Array<any> = [{ type: 'text', text: content }];
  if (attachments?.length) {
    for (const att of attachments) {
      if (att.type === 'image' && att.content && att.mimeType) {
        userContentBlocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: att.mimeType,
            data: att.content,
          },
        } satisfies ImageContent);
      }
    }
  }

  // Add user message to the target conversation
  conversationStore.addMessageTo(targetConversation, {
    id: uuid(),
    role: 'user',
    content: userContentBlocks,
    timestamp: Date.now(),
    isVoiceMessage: messageMetadata?.isVoiceMessage,
  });

  try {
    const response = await api.stream.send(
      conversationId,
      content,
      streamStore.sessionId,
      abortController.signal,
      attachments,
    );

    if (!response.ok) {
      let errMsg = `HTTP ${response.status}`;
      try {
        const text = await response.text();
        try {
          const body = JSON.parse(text);
          errMsg = body.error || errMsg;
        } catch {
          errMsg = text.slice(0, 300) || errMsg;
        }
      } catch {
        /* use status */
      }
      streamStore.handleEvent({ type: 'error', error: { type: 'http_error', message: errMsg } });
      return;
    }

    // Capture session ID from response header
    const newSessionId = response.headers.get('X-Session-Id');
    if (newSessionId) {
      streamStore.setSessionId(newSessionId);
    }

    // Add empty assistant message to the target conversation (using pre-generated ID for snapshot linkage)
    conversationStore.addMessageTo(targetConversation, {
      id: assistantMsgIdForSnapshot,
      role: 'assistant',
      content: [],
      timestamp: Date.now(),
      model: targetConversation.model,
    });

    const reader = response.body?.getReader();
    // console.log('[sse] Got reader:', !!reader);
    if (!reader) {
      streamStore.handleEvent({
        type: 'error',
        error: { type: 'no_body', message: 'No response body' },
      });
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    // Track seen event signatures for deduplication (safety net for HMR/reconnect races)
    const seenEvents = new Set<string>();

    while (true) {
      // Check if a newer stream has superseded this one (e.g. HMR triggered reconnect)
      if (myGeneration !== streamGeneration) {
        console.log('[sse] Stream superseded by newer generation, stopping reader');
        reader.cancel().catch(() => {});
        return; // Exit without cleaning up — the new stream owns state now
      }

      // console.log('[sse] Reading chunk...');
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (!data) continue;

        // Clear dedup set on new message_start — indices reset each turn, so
        // text/thinking blocks at index 0 in turn 2 would otherwise collide
        // with turn 1's keys and get incorrectly dropped.
        if (data.includes('"message_start"')) {
          seenEvents.clear();
        }

        // Skip duplicate events (can happen during HMR race conditions)
        // Use the raw JSON string as a fingerprint for content_block_start and tool events
        const eventKey = deduplicationKey(data);
        if (eventKey && seenEvents.has(eventKey)) {
          console.log('[sse] Skipping duplicate event:', data.slice(0, 80));
          continue;
        }
        if (eventKey) seenEvents.add(eventKey);

        try {
          const event: StreamEvent = JSON.parse(data);

          // Check if this is a tool_result event that might contain a device action
          if (event.type === 'tool_result') {
            const content =
              typeof event.result === 'string' ? event.result : JSON.stringify(event.result);
            const deviceActionResult = await processDeviceAction(content);

            if (deviceActionResult.shouldProcess) {
              if (deviceActionResult.error) {
                // Replace the tool result with an error message
                event.result = `Error: ${deviceActionResult.error}`;
              } else if (deviceActionResult.result) {
                // Process the device action result
                const { type, data } = deviceActionResult.result;

                if (type === 'screenshot' || type === 'camera') {
                  // Add the captured image as an image content block
                  const imageContent: ImageContent = {
                    type: 'image',
                    source: {
                      type: 'base64',
                      media_type: data.mimeType,
                      data: data.data,
                    },
                  };

                  // Update the event result to include success message + image path
                  event.result = `${type === 'screenshot' ? 'Screenshot' : 'Photo'} captured successfully${data.path ? ` and saved to ${data.path}` : ''}.`;

                  // Add the image to the conversation (this will be handled by the stream store)
                  // We'll append it as a separate content block
                  streamStore.contentBlocks.push(imageContent);
                } else if (type === 'location') {
                  // Format location data as a readable message
                  const loc = data;
                  event.result = `Location: ${loc.latitude.toFixed(6)}°, ${loc.longitude.toFixed(6)}°${loc.timezone ? `\nTimezone: ${loc.timezone}` : ''}${loc.locality ? `\nLocality: ${loc.locality}` : ''}\nAccuracy: ~${Math.round(loc.accuracy)}m`;
                } else if (type === 'displays') {
                  // Format displays list
                  event.result = `Available displays:\n${data.join('\n')}`;
                }
              }
            }
          }

          streamStore.handleEvent(event);

          // Sync content blocks to the target conversation's assistant message
          conversationStore.updateLastAssistantMessageIn(targetConversation, [
            ...streamStore.contentBlocks,
          ]);
        } catch (parseErr) {
          console.warn('[sse] Failed to parse SSE data:', data, parseErr);
        }
      }
    }

    // If superseded while processing the final batch, bail out
    if (myGeneration !== streamGeneration) return;

    // Final sync from stream store
    if (streamStore.contentBlocks.length > 0) {
      conversationStore.updateLastAssistantMessageIn(targetConversation, [
        ...streamStore.contentBlocks,
      ]);
    }

    // Ensure streaming state is cleared when the SSE connection closes.
    // The message_stop event should have already done this, but if it was
    // lost (e.g. stream closed before the event was flushed), clean up.
    // Do NOT reset tool_pending — approval/question dialogs are still live
    // and waiting for user input. They will resolve themselves.
    if (streamStore.isStreaming || streamStore.status === 'connecting') {
      streamStore.handleEvent({ type: 'message_stop' } as any);
    }

    // Stream complete — clear the in-flight reference before reloading from DB.
    // The server has persisted the full message now, so the DB version is authoritative.
    conversationStore.clearInflight(conversationId);

    // Reload conversation from DB only if the stream produced no content blocks.
    // This handles cases where the stream produced no content_block events (e.g.
    // /compact, /init) but the server still saved an assistant message. If content
    // blocks were produced, the in-memory version is already complete — reloading
    // from DB could overwrite it with an incomplete version if there's a race
    // between stream completion and DB persistence.
    if (streamStore.contentBlocks.length === 0) {
      await conversationStore.reloadById(conversationId);
    }

    // Auto-extract workspace memories from this conversation
    const convWorkspacePath = targetConversation.workspacePath;
    if (convWorkspacePath) {
      const msgs = targetConversation.messages ?? [];
      // Take last 10 messages for extraction (avoid processing huge histories)
      const recent = msgs.slice(-10).map((m) => ({
        role: m.role,
        content: Array.isArray(m.content)
          ? m.content
              .filter((b: any) => b.type === 'text')
              .map((b: any) => b.text)
              .join('\n')
          : String(m.content),
      }));
      if (recent.length > 0) {
        workspaceMemoryStore.extractFromConversation(convWorkspacePath, recent).catch(() => {});
      }
    }

    // Auto-generate a compact summary for this conversation (background, fire-and-forget).
    // Only runs when there are enough messages to warrant a summary (>= 4 messages).
    // The summarize endpoint is idempotent — if a summary already exists it returns it cached.
    const msgCount = targetConversation.messages?.length ?? 0;
    if (msgCount >= 4) {
      api.conversations.summarize(conversationId).catch(() => {});
    }
  } catch (err) {
    // If superseded by a newer stream, don't touch state
    if (myGeneration !== streamGeneration) return;

    if ((err as Error).name === 'AbortError') {
      // User cancelled — server persists partial content, clear in-flight
      conversationStore.clearInflight(conversationId);
      streamStore.handleEvent({ type: 'message_stop' } as any);
    } else {
      streamStore.handleEvent({
        type: 'error',
        error: { type: 'network_error', message: (err as Error).message },
      });

      // Auto-reconnect: if the stream died unexpectedly (not user-cancelled),
      // try to reconnect after a short delay. The server buffers all events,
      // so reconnection will replay any missed data.
      if (streamStore.sessionId) {
        console.log('[sse] Stream died unexpectedly, attempting auto-reconnect in 2s...');
        setTimeout(() => {
          // Only reconnect if no newer stream has started
          if (myGeneration === streamGeneration) {
            reconnectActiveStream().catch(() => {});
          }
        }, 2000);
      }
    }
  }
}

/**
 * Promise that resolves when the reconnection attempt completes.
 * Other code (e.g. ConversationList auto-restore) can await this to avoid
 * race conditions where they skip loading because reconnection is in progress
 * but then reconnection fails, leaving no conversation loaded.
 */
let reconnectionDone: Promise<string | null> = Promise.resolve(null);

/** Get the promise for the current reconnection attempt. */
export function getReconnectionPromise(): Promise<string | null> {
  return reconnectionDone;
}

/**
 * Check for active streaming sessions and reconnect if found.
 * Called on page load to resume displaying in-progress streams.
 * Returns the conversation ID of the reconnected session, or null.
 *
 * If the first attempt finds no sessions, retries once after a short delay.
 * This handles the case where the server session hasn't fully initialized yet
 * (e.g. the provider stream just started and no events have been buffered).
 */
export async function reconnectActiveStream(): Promise<string | null> {
  const doReconnect = async (): Promise<string | null> => {
    const result = await _reconnectActiveStreamImpl();
    if (result) {
      stopConversationPolling();
      return result;
    }

    // Retry once after a longer delay — the server session may not have been
    // ready (e.g. Vite HMR restart during lint-staged can take 3-5s).
    const gen = streamGeneration;
    await new Promise((r) => setTimeout(r, 1500));
    if (gen !== streamGeneration) return null; // superseded
    console.log('[sse:reconnect] Retrying reconnection after delay…');
    const retryResult = await _reconnectActiveStreamImpl();
    if (retryResult) {
      stopConversationPolling();
      return retryResult;
    }

    // SSE reconnection failed both attempts — fall back to conversation
    // polling.  The server may have already finished and persisted the
    // response to the DB, or it may still be running. Polling will
    // detect either case and update the UI.
    const savedConvId = workspaceStore.activeWorkspace?.snapshot.activeConversationId;
    if (savedConvId) {
      console.log('[sse:reconnect] SSE reconnection failed, falling back to conversation polling');
      // Load the conversation immediately so the user sees their history
      try {
        const convRes = await api.conversations.get(savedConvId);
        if (convRes.ok && convRes.data) {
          conversationStore.setActive(convRes.data);
        }
      } catch {
        // Non-critical
      }
      startConversationPolling(savedConvId);
    }

    return null;
  };
  reconnectionDone = doReconnect();
  return reconnectionDone;
}

async function _reconnectActiveStreamImpl(): Promise<string | null> {
  // Abort any existing stream reader to prevent duplicate processing
  abortActiveStream();
  const myGeneration = streamGeneration;

  // Signal reconnection intent synchronously BEFORE any awaits so concurrent
  // code (e.g. ConversationList auto-restore) knows not to call
  // streamStore.reset() and wipe out state we're about to rebuild.
  streamStore.setReconnecting(true);

  try {
    // Retry the sessions check — on page load or after HMR (e.g. lint-staged
    // reformatting source files during a commit) the backend may not be ready,
    // returning non-JSON (HTML / no content-type).  Use exponential backoff
    // with enough attempts to survive a full Vite server restart (~3-5s).
    const SESSION_RETRY_COUNT = 3;
    const SESSION_RETRY_BASE_MS = 400;
    let sessionsRes: Awaited<ReturnType<typeof api.stream.sessions>> | null = null;
    for (let attempt = 0; attempt < SESSION_RETRY_COUNT; attempt++) {
      try {
        sessionsRes = await api.stream.sessions();
        break; // success
      } catch (err) {
        // Only log a warning on the last attempt to reduce noise
        if (attempt === SESSION_RETRY_COUNT - 1) {
          console.warn(
            `[sse:reconnect] Sessions request failed after ${SESSION_RETRY_COUNT} attempts:`,
            err,
          );
        }
        if (attempt < SESSION_RETRY_COUNT - 1) {
          await new Promise((r) => setTimeout(r, SESSION_RETRY_BASE_MS * Math.pow(2, attempt)));
        }
      }
    }
    if (!sessionsRes || !sessionsRes.ok || !sessionsRes.data.length) {
      console.log(
        '[sse:reconnect] No active sessions found',
        sessionsRes ? `(${sessionsRes.data?.length ?? 0} sessions)` : '(all requests failed)',
      );
      // If all session retries failed and we were streaming, clear streaming
      // state so the UI doesn't get stuck in a "streaming" indicator.
      if (!sessionsRes) {
        const s = streamStore.status;
        if (s === 'streaming' || s === 'connecting') {
          streamStore.handleEvent({ type: 'message_stop' } as any);
        }
      }
      streamStore.setReconnecting(false);
      return null;
    }

    console.log(
      '[sse:reconnect] Server reports sessions:',
      sessionsRes.data.map(
        (s) =>
          `${s.id.slice(0, 8)}… conv=${s.conversationId.slice(0, 8)}… status=${s.status} complete=${s.streamComplete} events=${s.bufferedEvents}`,
      ),
    );

    // Find a session that's still running or just completed with buffered events
    const active = sessionsRes.data.find(
      (s) => s.status === 'running' || (s.bufferedEvents > 0 && !s.streamComplete),
    );

    // For completed sessions, prefer one that matches the user's last conversation.
    // Fall back to the most recent completed session with events — don't silently
    // discard valid sessions just because the savedConversationId doesn't match.
    // Exclude cancelled sessions — they should not be reconnected to.
    const savedConversationId = workspaceStore.activeWorkspace?.snapshot.activeConversationId;
    const completedCandidates = sessionsRes.data.filter(
      (s) => s.streamComplete && s.bufferedEvents > 0 && !s.cancelled,
    );
    const justCompleted =
      completedCandidates.find((s) => s.conversationId === savedConversationId) ||
      completedCandidates[0] ||
      null;

    const target = active || justCompleted;
    if (!target) {
      console.log(
        '[sse:reconnect] Sessions exist but none matched reconnection criteria',
        'savedConvId:',
        savedConversationId,
      );
      streamStore.setReconnecting(false);
      return null;
    }

    // Check if superseded before continuing
    if (myGeneration !== streamGeneration) {
      console.log('[sse:reconnect] Superseded before reconnect fetch');
      streamStore.setReconnecting(false);
      return null;
    }

    console.log(
      `[sse:reconnect] Connecting to session ${target.id.slice(0, 8)}… ` +
        `(conv=${target.conversationId.slice(0, 8)}… status=${target.status} events=${target.bufferedEvents})`,
    );

    streamStore.startStream(target.conversationId);
    streamStore.setSessionId(target.id);

    // Load the conversation so the UI can display it
    const convRes = await api.conversations.get(target.conversationId);
    if (!convRes.ok || !convRes.data) {
      console.warn('[sse:reconnect] Failed to load conversation:', target.conversationId);
      streamStore.handleEvent({ type: 'message_stop' } as any);
      streamStore.setReconnecting(false);
      return null;
    }
    conversationStore.setActive(convRes.data);
    const targetConversation = convRes.data as Conversation;

    const abortController = new AbortController();
    streamStore.setAbortController(abortController);
    const response = await api.stream.reconnect(target.id, abortController.signal);
    if (!response.ok || !response.body) {
      console.warn(
        '[sse:reconnect] Reconnect endpoint returned',
        response.status,
        response.statusText,
      );
      streamStore.handleEvent({ type: 'message_stop' } as any);
      streamStore.setReconnecting(false);
      return null;
    }

    console.log('[sse:reconnect] SSE stream opened, replaying events…');

    // Track as in-flight so navigating back finds the partial response
    conversationStore.setInflight(target.conversationId, targetConversation);

    // Check if the conversation already has a partial assistant message at the end
    // (from periodic DB flushes during streaming). If so, reuse it; otherwise add
    // an empty placeholder that we'll build up from replayed events.
    const lastMsg = targetConversation.messages?.[targetConversation.messages.length - 1];
    if (!lastMsg || lastMsg.role !== 'assistant') {
      conversationStore.addMessageTo(targetConversation, {
        id: uuid(),
        role: 'assistant',
        content: [],
        timestamp: Date.now(),
        model: targetConversation.model,
      });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const seenEvents = new Set<string>();
    let eventCount = 0;

    while (true) {
      // Check if a newer stream has superseded this reconnection
      if (myGeneration !== streamGeneration) {
        console.log('[sse:reconnect] Superseded by newer generation, stopping reader');
        reader.cancel().catch(() => {});
        streamStore.setReconnecting(false);
        return target.conversationId;
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (!data) continue;

        // Clear dedup set on new message_start — indices reset each turn
        if (data.includes('"message_start"')) {
          seenEvents.clear();
        }

        // Skip duplicate events
        const eventKey = deduplicationKey(data);
        if (eventKey && seenEvents.has(eventKey)) continue;
        if (eventKey) seenEvents.add(eventKey);

        try {
          const event: StreamEvent = JSON.parse(data);
          streamStore.handleEvent(event);
          conversationStore.updateLastAssistantMessageIn(targetConversation, [
            ...streamStore.contentBlocks,
          ]);
          eventCount++;
        } catch {
          // Non-JSON line
        }
      }
    }

    console.log(`[sse:reconnect] Stream ended after ${eventCount} events`);

    // If superseded, bail
    if (myGeneration !== streamGeneration) {
      streamStore.setReconnecting(false);
      return target.conversationId;
    }

    // Final sync
    if (streamStore.contentBlocks.length > 0) {
      conversationStore.updateLastAssistantMessageIn(targetConversation, [
        ...streamStore.contentBlocks,
      ]);
    }

    // Ensure streaming state is cleared when the SSE connection closes.
    // Do NOT reset tool_pending — approval/question dialogs are still live.
    const s = streamStore.status;
    if (s === 'streaming' || s === 'connecting') {
      streamStore.handleEvent({ type: 'message_stop' } as any);
    }

    // Stream complete — clear in-flight before reloading the authoritative DB version.
    conversationStore.clearInflight(target.conversationId);

    // Reload conversation from DB only if no events were replayed.
    // If events were replayed, the in-memory version built from SSE events is
    // already complete and authoritative — reloading from DB could overwrite it
    // with an incomplete version if there's a race between stream completion and
    // DB persistence. If no events were replayed, reload to pick up any assistant
    // message that was saved but produced no streaming events (e.g. /compact).
    if (eventCount === 0) {
      await conversationStore.reloadById(target.conversationId);
    }
    streamStore.setReconnecting(false);

    return target.conversationId;
  } catch (err) {
    console.error('[sse:reconnect] Reconnection failed:', err);
    const errStatus = streamStore.status;
    if (errStatus === 'streaming' || errStatus === 'connecting') {
      streamStore.handleEvent({ type: 'message_stop' } as any);
    }
    streamStore.setReconnecting(false);
    return null;
  }
}

/**
 * Check if the server has an active streaming session for a specific conversation
 * and reconnect to it if found. This handles the case where a user navigates to
 * a conversation that's being actively streamed to (e.g., by a golem loop or
 * another agent) but the client doesn't have an in-flight reference.
 *
 * Returns the session ID if reconnection was initiated, or null if no active
 * session was found for that conversation.
 */
export async function reconnectToConversation(conversationId: string): Promise<string | null> {
  const doReconnect = async (): Promise<string | null> => {
    return _reconnectToConversationImpl(conversationId);
  };
  reconnectionDone = doReconnect();
  return reconnectionDone;
}

async function _reconnectToConversationImpl(targetConversationId: string): Promise<string | null> {
  // Don't interrupt an existing active stream
  if (streamStore.isStreaming && !streamStore.isReconnecting) {
    return null;
  }

  try {
    // Check if the server has any active sessions (with retry for HMR restarts)
    let sessionsRes: Awaited<ReturnType<typeof api.stream.sessions>> | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        sessionsRes = await api.stream.sessions();
        break;
      } catch {
        if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
    if (!sessionsRes?.ok || !sessionsRes.data.length) {
      return null;
    }

    // Find an active or recently-completed session for THIS conversation
    // Exclude cancelled sessions from reconnection
    const target =
      sessionsRes.data.find(
        (s) =>
          s.conversationId === targetConversationId &&
          (s.status === 'running' || (s.bufferedEvents > 0 && !s.streamComplete)),
      ) ||
      sessionsRes.data.find(
        (s) =>
          s.conversationId === targetConversationId &&
          s.streamComplete &&
          s.bufferedEvents > 0 &&
          !s.cancelled,
      );

    if (!target) {
      return null;
    }

    console.log(
      '[sse] Found active session for conversation:',
      targetConversationId,
      'session:',
      target.id,
    );

    // Abort any existing stream reader to prevent duplicate processing
    abortActiveStream();
    const myGeneration = streamGeneration;

    streamStore.setReconnecting(true);
    streamStore.startStream(targetConversationId);
    streamStore.setSessionId(target.id);

    // Load the conversation so the UI can display it
    const convRes = await api.conversations.get(targetConversationId);
    if (!convRes.ok || !convRes.data) {
      streamStore.handleEvent({ type: 'message_stop' } as any);
      streamStore.setReconnecting(false);
      return null;
    }
    conversationStore.setActive(convRes.data);
    const targetConversation = convRes.data as Conversation;

    const abortController = new AbortController();
    streamStore.setAbortController(abortController);
    const response = await api.stream.reconnect(target.id, abortController.signal);
    if (!response.ok || !response.body) {
      streamStore.handleEvent({ type: 'message_stop' } as any);
      streamStore.setReconnecting(false);
      return null;
    }

    // Track as in-flight so navigating back finds the partial response
    conversationStore.setInflight(targetConversationId, targetConversation);

    // Check if the conversation already has a partial assistant message at the end
    const lastMsg = targetConversation.messages?.[targetConversation.messages.length - 1];
    if (!lastMsg || lastMsg.role !== 'assistant') {
      conversationStore.addMessageTo(targetConversation, {
        id: uuid(),
        role: 'assistant',
        content: [],
        timestamp: Date.now(),
        model: targetConversation.model,
      });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const seenEvents = new Set<string>();

    while (true) {
      if (myGeneration !== streamGeneration) {
        reader.cancel().catch(() => {});
        streamStore.setReconnecting(false);
        return target.id;
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (!data) continue;

        if (data.includes('"message_start"')) {
          seenEvents.clear();
        }

        const eventKey = deduplicationKey(data);
        if (eventKey && seenEvents.has(eventKey)) continue;
        if (eventKey) seenEvents.add(eventKey);

        try {
          const event: StreamEvent = JSON.parse(data);
          streamStore.handleEvent(event);
          conversationStore.updateLastAssistantMessageIn(targetConversation, [
            ...streamStore.contentBlocks,
          ]);
        } catch {
          // Non-JSON line
        }
      }
    }

    if (myGeneration !== streamGeneration) {
      streamStore.setReconnecting(false);
      return target.id;
    }

    // Final sync
    if (streamStore.contentBlocks.length > 0) {
      conversationStore.updateLastAssistantMessageIn(targetConversation, [
        ...streamStore.contentBlocks,
      ]);
    }

    const s = streamStore.status;
    if (s === 'streaming' || s === 'connecting') {
      streamStore.handleEvent({ type: 'message_stop' } as any);
    }

    conversationStore.clearInflight(targetConversationId);
    // Only reload from DB if no content blocks were produced during reconnection.
    // If content was streamed, the in-memory version is already complete and
    // reloading could overwrite it with an incomplete DB version due to race
    // conditions between stream completion and DB persistence.
    if (streamStore.contentBlocks.length === 0) {
      await conversationStore.reloadById(targetConversationId);
    }
    streamStore.setReconnecting(false);

    return target.id;
  } catch (err) {
    console.error('[sse] Reconnect to conversation failed:', err);
    const errStatus = streamStore.status;
    if (errStatus === 'streaming' || errStatus === 'connecting') {
      streamStore.handleEvent({ type: 'message_stop' } as any);
    }
    streamStore.setReconnecting(false);
    return null;
  }
}

// ── Conversation Polling Fallback ──────────────────────────────────────────
// When SSE reconnection fails (server session gone, proxy issue, etc.),
// fall back to periodically polling the conversation from the DB.
// The server persists messages when the stream completes, so this picks
// them up even if the real-time SSE channel can't be re-established.

let pollingInterval: ReturnType<typeof setInterval> | null = null;
let pollingConversationId: string | null = null;

/**
 * Start polling a conversation for updates. Used as a fallback when SSE
 * reconnection fails — checks the DB periodically for new messages until
 * the stream completes.
 */
export function startConversationPolling(conversationId: string): void {
  // Don't start duplicate polling
  if (pollingInterval && pollingConversationId === conversationId) return;
  stopConversationPolling();

  pollingConversationId = conversationId;
  let lastMessageCount = conversationStore.active?.messages?.length ?? 0;
  let lastAssistantContentLength = 0;
  let pollCount = 0;
  let streamConfirmedRunning = false;
  const MAX_POLLS = 120; // 120 × 3s = 6 minutes max
  const POLL_INTERVAL_MS = 3000;

  console.log(`[sse:poll] Starting conversation polling for ${conversationId.slice(0, 8)}…`);

  // Don't set streaming state yet — the first poll will determine whether
  // the server stream is actually still running.  Setting it prematurely
  // causes a false "Streaming" indicator for already-complete conversations.

  const poll = async () => {
    pollCount++;
    if (pollCount > MAX_POLLS) {
      console.log('[sse:poll] Max polls reached, stopping');
      if (streamStore.isStreaming) {
        streamStore.handleEvent({ type: 'message_stop' } as any);
      }
      stopConversationPolling();
      return;
    }

    try {
      // Check if the server has an active session for this conversation
      let serverStreamRunning = false;
      try {
        const sessionsRes = await api.stream.sessions();
        serverStreamRunning = sessionsRes?.ok
          ? sessionsRes.data.some(
              (s) => s.conversationId === conversationId && s.status === 'running',
            )
          : false;
      } catch {
        // Can't check sessions — assume not running
      }

      // Fetch the latest conversation state from DB
      const res = await api.conversations.get(conversationId);
      if (!res.ok || !res.data) return;

      const conv = res.data as Conversation;
      const newMsgCount = conv.messages?.length ?? 0;

      // If the server stream is running and we haven't shown streaming yet, show it now
      if (serverStreamRunning && !streamConfirmedRunning) {
        streamConfirmedRunning = true;
        if (!streamStore.isStreaming) {
          streamStore.startStream(conversationId);
        }
      }

      // Check if new messages appeared
      if (newMsgCount > lastMessageCount) {
        console.log(`[sse:poll] New messages detected: ${lastMessageCount} → ${newMsgCount}`);
        lastMessageCount = newMsgCount;
        conversationStore.setActive(conv);
      }

      // Check the last assistant message for content growth (partial flushes)
      const lastMsg = conv.messages?.[conv.messages.length - 1];
      if (lastMsg?.role === 'assistant') {
        const contentLen = Array.isArray(lastMsg.content)
          ? lastMsg.content.reduce(
              (acc: number, b: any) => acc + (b.text?.length ?? b.thinking?.length ?? 0),
              0,
            )
          : 0;

        if (contentLen > lastAssistantContentLength) {
          lastAssistantContentLength = contentLen;
          conversationStore.setActive(conv);
        }
      }

      // If the server stream is NOT running, the conversation in DB is
      // authoritative.  Load it and stop polling.
      if (!serverStreamRunning) {
        console.log('[sse:poll] No active server session — loading final conversation state');
        conversationStore.setActive(conv);
        if (streamStore.isStreaming) {
          streamStore.handleEvent({ type: 'message_stop' } as any);
        }
        stopConversationPolling();
        return;
      }
    } catch (err) {
      console.warn('[sse:poll] Poll failed:', err);
    }
  };

  // First poll immediately
  poll();
  pollingInterval = setInterval(poll, POLL_INTERVAL_MS);
}

/** Stop conversation polling if active. */
export function stopConversationPolling(): void {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
    pollingConversationId = null;
    console.log('[sse:poll] Polling stopped');
  }
}

export async function cancelStream(conversationId: string): Promise<void> {
  stopConversationPolling();
  streamStore.cancel();
  if (streamStore.sessionId) {
    try {
      await api.stream.cancel(conversationId, streamStore.sessionId);
    } catch {
      // Best effort
    }
  }
}

/**
 * Generate a deduplication key for SSE events that should not be duplicated.
 * Returns null for events that are inherently idempotent or should always be processed.
 *
 * We only deduplicate events that would cause visible duplication:
 * - content_block_start: duplicate would create an extra content block
 * - tool_approval_request / user_question_request: duplicate would show two dialogs
 * - tool_result: duplicate would add two results
 *
 * We do NOT deduplicate:
 * - content_block_delta: these are append-only and must all be processed
 * - message_start/stop: these are state transitions
 * - ping: harmless
 */
function deduplicationKey(rawData: string): string | null {
  try {
    // Quick check for event types that need deduplication
    if (rawData.includes('"content_block_start"')) {
      const evt = JSON.parse(rawData);
      // Use index + block type + id (for tool_use) as key
      const block = evt.content_block || {};
      return `cbs:${evt.index}:${block.type}:${block.id || ''}:${block.name || ''}`;
    }
    if (rawData.includes('"tool_approval_request"')) {
      const evt = JSON.parse(rawData);
      return `tar:${evt.toolCallId}`;
    }
    if (rawData.includes('"user_question_request"')) {
      const evt = JSON.parse(rawData);
      return `uqr:${evt.toolCallId}`;
    }
    if (rawData.includes('"tool_result"')) {
      const evt = JSON.parse(rawData);
      return `tr:${evt.toolCallId}`;
    }
  } catch {
    // Parse failed — don't deduplicate
  }
  return null;
}

/**
 * HMR cleanup & reconnection: When Vite performs Hot Module Replacement, abort
 * any active stream reader to prevent orphaned loops from processing events into
 * stale state, then reconnect to the server's buffered event stream.
 */
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    console.log('[sse:hmr] Module disposing — aborting active stream');
    abortActiveStream();
  });

  // After HMR, if an active session exists (sessionId preserved in stream store),
  // reconnect to the server's event buffer so the stream resumes seamlessly.
  if (streamStore.sessionId) {
    console.log('[sse:hmr] Active session detected after HMR, reconnecting...');
    // Short delay lets the dispose/abort settle before we reconnect
    setTimeout(() => reconnectActiveStream().catch(() => {}), 200);
  }
}
