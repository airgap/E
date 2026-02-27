/**
 * Message Synchronization Store
 *
 * Subscribes to real-time message updates via SSE for cross-device synchronization.
 * When a message is added or updated on another device, this store reloads the
 * conversation to ensure all devices stay in sync.
 */

import { conversationStore } from './conversation.svelte';
import { getBaseUrl } from '$lib/api/client';

interface MessageUpdateEvent {
  type: 'message_updated';
  conversationId: string;
  messageId: string;
  role: string;
  timestamp: number;
}

function createMessageSyncStore() {
  /** Current SSE connection */
  let evtSource: EventSource | null = null;

  /** Conversation currently subscribed to */
  let subscribedConvId: string | null = null;

  /** Last message update timestamp to debounce rapid updates */
  let lastUpdateTime = 0;
  const UPDATE_DEBOUNCE_MS = 300; // Wait 300ms before reloading

  return {
    /**
     * Subscribe to message updates for a specific conversation.
     * Automatically reloads the conversation when messages are updated on other devices.
     */
    subscribe(conversationId: string) {
      // Don't re-subscribe to the same conversation
      if (subscribedConvId === conversationId && evtSource) return;

      // Clean up previous subscription
      this.unsubscribe();

      subscribedConvId = conversationId;

      try {
        evtSource = new EventSource(
          `${getBaseUrl()}/message-sync/${encodeURIComponent(conversationId)}`,
        );

        evtSource.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data) as MessageUpdateEvent;

            // Ignore ping keepalive events
            if (data.type !== 'message_updated') return;

            // Debounce rapid updates (e.g., during streaming)
            const now = Date.now();
            if (now - lastUpdateTime < UPDATE_DEBOUNCE_MS) return;
            lastUpdateTime = now;

            // Only reload if this conversation is currently active
            const activeConv = conversationStore.active;
            if (activeConv && activeConv.id === data.conversationId) {
              console.log(
                `[message-sync] Message ${data.messageId} updated on another device, reloading conversation`,
              );
              conversationStore.reloadById(data.conversationId);
            }
          } catch {
            // Ignore parse errors
          }
        };

        evtSource.onerror = () => {
          // EventSource will auto-reconnect on error
          console.warn('[message-sync] SSE connection error, will auto-reconnect');
        };

        console.log(`[message-sync] Subscribed to conversation ${conversationId}`);
      } catch (err) {
        console.error('[message-sync] Failed to subscribe:', err);
      }
    },

    /**
     * Unsubscribe from the current conversation's message updates.
     */
    unsubscribe() {
      if (evtSource) {
        evtSource.close();
        evtSource = null;
      }
      subscribedConvId = null;
      console.log('[message-sync] Unsubscribed from message updates');
    },

    /**
     * Get the currently subscribed conversation ID.
     */
    get subscribedConversationId() {
      return subscribedConvId;
    },
  };
}

export const messageSyncStore = createMessageSyncStore();
