/**
 * Cross-Session Messaging Store
 *
 * Manages cross-session messages for the active conversation.
 * Subscribes to SSE events for real-time delivery and provides
 * methods for listing sessions and sending messages.
 */

import { api } from '$lib/api/client';

interface CrossSessionMessage {
  id: string;
  fromConversationId: string;
  toConversationId: string;
  content: string;
  senderContext: {
    workspaceId: string;
    workspaceName: string;
    conversationTitle: string;
    agentProfile?: string;
  };
  timestamp: number;
  delivered: boolean;
}

interface SessionInfo {
  conversationId: string;
  title: string;
  workspaceName: string;
  workspaceId: string;
  status: 'idle' | 'running' | 'waiting';
  canReceive: boolean;
}

function createCrossSessionStore() {
  /** Messages received in the active conversation */
  let messages = $state<CrossSessionMessage[]>([]);

  /** Available sessions for cross-session messaging */
  let sessions = $state<SessionInfo[]>([]);

  /** Current SSE connection */
  let evtSource: EventSource | null = null;

  /** Conversation currently subscribed to */
  let subscribedConvId: string | null = null;

  /** Recent cross-session flow for Manager View */
  let recentFlow = $state<CrossSessionMessage[]>([]);

  /** Manager View SSE connection */
  let managerEvtSource: EventSource | null = null;

  return {
    get messages() {
      return messages;
    },
    get sessions() {
      return sessions;
    },
    get recentFlow() {
      return recentFlow;
    },

    /**
     * Subscribe to cross-session messages for a specific conversation.
     * Sets up an SSE connection that delivers messages in real time.
     */
    subscribe(conversationId: string) {
      // Don't re-subscribe to the same conversation
      if (subscribedConvId === conversationId && evtSource) return;

      // Clean up previous subscription
      this.unsubscribe();

      subscribedConvId = conversationId;

      try {
        evtSource = new EventSource(
          `/api/cross-session/events/${encodeURIComponent(conversationId)}`,
        );

        evtSource.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            if (data.type === 'cross_session_message' && data.message) {
              const msg = data.message as CrossSessionMessage;
              // Avoid duplicates
              if (!messages.some((m) => m.id === msg.id)) {
                messages = [...messages, msg];
              }
            }
          } catch {
            // Ignore parse errors
          }
        };

        evtSource.onerror = () => {
          // EventSource will auto-reconnect
        };
      } catch {
        // EventSource not available
      }
    },

    /**
     * Unsubscribe from cross-session messages.
     */
    unsubscribe() {
      if (evtSource) {
        evtSource.close();
        evtSource = null;
      }
      subscribedConvId = null;
      messages = [];
    },

    /**
     * Load available sessions for cross-session messaging.
     */
    async loadSessions(excludeId?: string) {
      try {
        const res = await api.crossSession.listSessions(excludeId);
        sessions = res.data;
      } catch {
        sessions = [];
      }
    },

    /**
     * Send a cross-session message.
     */
    async sendMessage(
      fromConversationId: string,
      toConversationId: string,
      content: string,
    ): Promise<CrossSessionMessage | null> {
      try {
        const res = await api.crossSession.send(fromConversationId, toConversationId, content);
        return res.data as CrossSessionMessage;
      } catch (err) {
        console.error('[cross-session] Failed to send message:', err);
        return null;
      }
    },

    /**
     * Mark a message as delivered.
     */
    async markDelivered(messageId: string) {
      try {
        await api.crossSession.markDelivered(messageId);
        messages = messages.map((m) => (m.id === messageId ? { ...m, delivered: true } : m));
      } catch {
        // Ignore errors
      }
    },

    /**
     * Subscribe to the global cross-session flow for Manager View.
     */
    subscribeFlow() {
      if (managerEvtSource) return;

      // Load initial flow data
      this.loadFlow();

      try {
        managerEvtSource = new EventSource('/api/cross-session/events');

        managerEvtSource.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            if (data.type === 'cross_session_message' && data.message) {
              const msg = data.message as CrossSessionMessage;
              if (!recentFlow.some((m) => m.id === msg.id)) {
                recentFlow = [msg, ...recentFlow].slice(0, 50);
              }
            }
          } catch {
            // Ignore parse errors
          }
        };
      } catch {
        // EventSource not available
      }
    },

    /**
     * Unsubscribe from the global cross-session flow.
     */
    unsubscribeFlow() {
      if (managerEvtSource) {
        managerEvtSource.close();
        managerEvtSource = null;
      }
      recentFlow = [];
    },

    /**
     * Load recent cross-session flow data.
     */
    async loadFlow() {
      try {
        const res = await api.crossSession.getFlow();
        recentFlow = res.data;
      } catch {
        recentFlow = [];
      }
    },

    /**
     * Get the count of undelivered messages for a conversation.
     */
    get undeliveredCount(): number {
      return messages.filter((m) => !m.delivered).length;
    },

    /**
     * Reset all state.
     */
    reset() {
      this.unsubscribe();
      this.unsubscribeFlow();
      sessions = [];
    },
  };
}

export const crossSessionStore = createCrossSessionStore();
