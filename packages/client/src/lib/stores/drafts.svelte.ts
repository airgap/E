/**
 * Draft message store — persists unsent chat input text across tab switches
 * and page refreshes so users don't lose work-in-progress messages.
 *
 * Drafts are keyed by conversation ID (or '__new__' for unsent new-conversation
 * tabs) and stored in localStorage so they survive full page reloads.
 */

const STORAGE_KEY = 'e-chat-drafts';

export interface Draft {
  text: string;
  /** ISO timestamp of last update — used for pruning stale drafts */
  updatedAt: number;
}

/** Key used for tabs that don't have a conversation yet (new chat). */
export const NEW_CHAT_DRAFT_KEY = '__new__';

function loadDrafts(): Record<string, Draft> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    // Prune drafts older than 7 days
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const pruned: Record<string, Draft> = {};
    for (const [key, draft] of Object.entries(parsed)) {
      const d = draft as Draft;
      if (d.updatedAt && d.updatedAt > cutoff && d.text) {
        pruned[key] = d;
      }
    }
    return pruned;
  } catch {
    return {};
  }
}

function saveDrafts(drafts: Record<string, Draft>) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
  } catch {
    // localStorage may be full — silently ignore
  }
}

function createDraftsStore() {
  let drafts = $state<Record<string, Draft>>(loadDrafts());

  function persist() {
    saveDrafts($state.snapshot(drafts));
  }

  return {
    /**
     * Save a draft for a conversation (or new chat).
     * If text is empty, the draft is removed.
     */
    save(conversationId: string | null, text: string) {
      const key = conversationId ?? NEW_CHAT_DRAFT_KEY;
      const trimmed = text;
      if (!trimmed) {
        if (drafts[key]) {
          delete drafts[key];
          persist();
        }
        return;
      }
      drafts[key] = { text: trimmed, updatedAt: Date.now() };
      persist();
    },

    /**
     * Get the draft text for a conversation (or new chat).
     * Returns empty string if no draft exists.
     */
    get(conversationId: string | null): string {
      const key = conversationId ?? NEW_CHAT_DRAFT_KEY;
      return drafts[key]?.text ?? '';
    },

    /**
     * Clear the draft for a conversation (e.g. after sending).
     */
    clear(conversationId: string | null) {
      const key = conversationId ?? NEW_CHAT_DRAFT_KEY;
      if (drafts[key]) {
        delete drafts[key];
        persist();
      }
    },
  };
}

export const draftsStore = createDraftsStore();
