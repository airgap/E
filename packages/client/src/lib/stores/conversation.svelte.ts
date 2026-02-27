import type { Message, Conversation, ConversationSummary, MessageContent } from '@e/shared';
import { api } from '$lib/api/client';

export const DRAFT_ID = '__draft__';

function createConversationStore() {
  let conversations = $state<ConversationSummary[]>([]);
  let active = $state<Conversation | null>(null);
  let loading = $state(false);
  let draft = $state<ConversationSummary | null>(null);
  let onActiveChangeCallbacks: Array<(conv: Conversation | null) => void> = [];

  /**
   * Conversations currently being written to by an active stream.
   * When navigating back to a conversation with an in-flight stream,
   * we use this reference instead of loading from DB (which wouldn't
   * have the partial assistant response yet).
   */
  let inflightConversations = new Map<string, Conversation>();

  return {
    get list() {
      return conversations;
    },
    get active() {
      return active;
    },
    get loading() {
      return loading;
    },
    get activeId() {
      return active?.id ?? null;
    },
    get draft() {
      return draft;
    },

    setList(list: ConversationSummary[]) {
      conversations = list;
    },
    setActive(conv: Conversation | null) {
      active = conv;
      // Clear draft when a real conversation becomes active
      if (conv) draft = null;
      // Notify listeners (e.g. workspace store persists the active conversation id)
      for (const cb of onActiveChangeCallbacks) cb(conv);
    },

    /** Register a callback fired whenever the active conversation changes. */
    onActiveChange(cb: (conv: Conversation | null) => void) {
      onActiveChangeCallbacks.push(cb);
    },
    setLoading(v: boolean) {
      loading = v;
    },

    /** Register a conversation being actively written to by a stream. */
    setInflight(id: string, conv: Conversation) {
      inflightConversations.set(id, conv);
    },
    /** Unregister when stream completes. */
    clearInflight(id: string) {
      inflightConversations.delete(id);
    },
    /** Get the in-flight conversation reference, if any. */
    getInflight(id: string): Conversation | undefined {
      return inflightConversations.get(id);
    },

    /** Create a draft placeholder that appears in the conversation list. */
    createDraft() {
      const now = Date.now();
      draft = {
        id: DRAFT_ID,
        title: 'New conversation',
        createdAt: now,
        updatedAt: now,
        messageCount: 0,
        model: '',
      };
    },

    /** Clear the draft placeholder without replacing it. */
    clearDraft() {
      draft = null;
    },

    addMessage(msg: Message) {
      if (!active) return;
      active.messages = [...active.messages, msg];
      active.updatedAt = Date.now();
      const idx = conversations.findIndex((c) => c.id === active!.id);
      if (idx >= 0) {
        conversations[idx] = {
          ...conversations[idx],
          messageCount: active.messages.length,
          updatedAt: active.updatedAt,
        };
      }
    },

    /** Add a message to a specific conversation (even if it's not the active one). */
    addMessageTo(conv: Conversation, msg: Message) {
      conv.messages = [...conv.messages, msg];
      conv.updatedAt = Date.now();
      // Keep the summary list's messageCount in sync
      const idx = conversations.findIndex((c) => c.id === conv.id);
      if (idx >= 0) {
        conversations[idx] = {
          ...conversations[idx],
          messageCount: conv.messages.length,
          updatedAt: conv.updatedAt,
        };
      }
      // If this is the active conversation, trigger reactivity by
      // assigning a new object (same-reference assignment won't trigger Svelte 5 updates)
      if (active && active.id === conv.id) {
        active = { ...conv };
      }
    },

    updateLastAssistantMessage(content: MessageContent[]) {
      if (!active) return;
      const msgs = active.messages;
      const last = msgs[msgs.length - 1];
      if (last?.role === 'assistant') {
        last.content = content;
        active.messages = [...msgs];
      }
    },

    /** Update the last assistant message in a specific conversation. */
    updateLastAssistantMessageIn(conv: Conversation, content: MessageContent[]) {
      const msgs = conv.messages;
      const last = msgs[msgs.length - 1];
      if (last?.role === 'assistant') {
        last.content = content;
        conv.messages = [...msgs];
        // If this is the active conversation, trigger reactivity by
        // assigning a new object (same-reference assignment won't trigger Svelte 5 updates)
        if (active && active.id === conv.id) {
          active = { ...conv };
        }
      }
    },

    setPlanMode(enabled: boolean) {
      if (active) active = { ...active, planMode: enabled };
    },

    updateTitle(title: string) {
      if (active) active.title = title;
      const idx = conversations.findIndex((c) => c.id === active?.id);
      if (idx >= 0) conversations[idx].title = title;
    },

    removeConversation(id: string) {
      conversations = conversations.filter((c) => c.id !== id);
      if (active?.id === id) active = null;
    },

    prependConversation(summary: ConversationSummary) {
      draft = null; // Draft is replaced by the real conversation
      conversations = [summary, ...conversations];
    },

    /** Delete a message (and optionally its paired assistant response). */
    async deleteMessage(messageId: string, deletePair = false) {
      if (!active) return;
      const convId = active.id;

      // Optimistic local removal
      const msgIndex = active.messages.findIndex((m) => m.id === messageId);
      if (msgIndex === -1) return;

      const msg = active.messages[msgIndex];
      const newMessages = [...active.messages];

      if (deletePair && msg.role === 'user') {
        const nextMsg = newMessages[msgIndex + 1];
        if (nextMsg && nextMsg.role === 'assistant') {
          newMessages.splice(msgIndex, 2);
        } else {
          newMessages.splice(msgIndex, 1);
        }
      } else {
        newMessages.splice(msgIndex, 1);
      }

      active = { ...active, messages: newMessages };

      const idx = conversations.findIndex((c) => c.id === convId);
      if (idx >= 0) {
        conversations[idx] = { ...conversations[idx], messageCount: newMessages.length };
      }

      await api.conversations.deleteMessage(convId, messageId, deletePair);
    },

    /** Edit a message: truncate conversation from that point. Caller should then resend via sendAndStream. */
    async editMessage(messageId: string, newContent: string): Promise<boolean> {
      if (!active) return false;
      const convId = active.id;

      const msgIndex = active.messages.findIndex((m) => m.id === messageId);
      if (msgIndex === -1) return false;

      // Truncate: keep only messages before the edited one.
      // sendAndStream will add the new user message optimistically.
      const newMessages = active.messages.slice(0, msgIndex);
      active = { ...active, messages: newMessages };

      const idx = conversations.findIndex((c) => c.id === convId);
      if (idx >= 0) {
        conversations[idx] = { ...conversations[idx], messageCount: newMessages.length };
      }

      // Server-side: delete the message and everything after it
      await api.conversations.editMessage(convId, messageId);
      return true;
    },

    /** Fork conversation from a specific message. Returns new conversation ID. */
    async forkFromMessage(messageId: string): Promise<string | null> {
      if (!active) return null;
      const convId = active.id;

      try {
        const res = await api.conversations.fork(convId, messageId);
        if (!res.ok || !res.data) return null;

        // Load the new conversation and add to list
        const convRes = await api.conversations.get(res.data.id);
        if (convRes.ok && convRes.data) {
          this.prependConversation({
            id: convRes.data.id,
            title: convRes.data.title,
            createdAt: convRes.data.createdAt,
            updatedAt: convRes.data.updatedAt,
            messageCount: convRes.data.messages.length,
            model: convRes.data.model,
          });
        }
        return res.data.id;
      } catch (e) {
        console.warn('[conversationStore] Failed to fork:', e);
        return null;
      }
    },

    /** Reload the active conversation from the server DB. */
    async reload() {
      if (!active) return;
      try {
        const res = await api.conversations.get(active.id);
        if (res.ok && res.data) {
          const conv = res.data as Conversation;
          const idx = conversations.findIndex((c) => c.id === active!.id);
          if (idx >= 0) {
            conversations[idx] = {
              ...conversations[idx],
              messageCount: conv.messages.length,
              updatedAt: conv.updatedAt,
            };
          }
          active = conv;
        }
      } catch (e) {
        console.warn('[conversationStore] Failed to reload:', e);
      }
    },

    /** Reload a specific conversation by ID. Updates active if it matches. */
    async reloadById(id: string) {
      try {
        const res = await api.conversations.get(id);
        if (res.ok && res.data) {
          const conv = res.data as Conversation;
          if (active && active.id === id) {
            active = conv;
          }
          // Sync summary list's messageCount with the authoritative DB data
          const idx = conversations.findIndex((c) => c.id === id);
          if (idx >= 0) {
            conversations[idx] = {
              ...conversations[idx],
              messageCount: conv.messages.length,
              updatedAt: conv.updatedAt,
            };
          }
        }
      } catch (e) {
        console.warn('[conversationStore] Failed to reload:', e);
      }
    },
  };
}

export const conversationStore = createConversationStore();
