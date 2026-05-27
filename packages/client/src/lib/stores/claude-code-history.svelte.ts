/**
 * Client-side store for the Claude Code history feature. Holds:
 *   - the conversation list for the active workspace (loaded on open)
 *   - the currently-viewing conversation (full message list) for the
 *     read-only viewer modal
 *
 * Off by default (gated by settings.showClaudeCodeHistory). The settings
 * gate is checked at the UI level — this store is happy to fetch anytime.
 */
import { api } from '$lib/api/client';

interface CCSummary {
  id: string;
  title: string;
  updatedAt: number;
  messageCount: number;
}

interface CCMessage {
  role: 'user' | 'assistant' | 'system';
  text: string;
  timestamp?: number;
}

interface CCConversation {
  id: string;
  title: string;
  updatedAt: number;
  messages: CCMessage[];
}

function createStore() {
  let summaries = $state<CCSummary[]>([]);
  let loading = $state(false);
  let lastWorkspace = $state<string | null>(null);

  let viewing = $state<CCConversation | null>(null);
  let viewingLoading = $state(false);
  let viewingError = $state<string | null>(null);

  return {
    get summaries() {
      return summaries;
    },
    get loading() {
      return loading;
    },
    get viewing() {
      return viewing;
    },
    get viewingLoading() {
      return viewingLoading;
    },
    get viewingError() {
      return viewingError;
    },

    /**
     * Load the conversation list for a workspace. Memoised on workspace
     * path — repeated calls for the same workspace are no-ops unless
     * refresh=true.
     */
    async loadList(workspacePath: string, opts: { refresh?: boolean } = {}) {
      if (!workspacePath) {
        summaries = [];
        lastWorkspace = null;
        return;
      }
      if (!opts.refresh && lastWorkspace === workspacePath && summaries.length > 0) return;
      loading = true;
      try {
        const res = await api.claudeCode.list(workspacePath);
        if (res.ok) {
          summaries = res.data;
          lastWorkspace = workspacePath;
        }
      } catch (err) {
        console.warn('[cc-history] list failed:', err);
        summaries = [];
      } finally {
        loading = false;
      }
    },

    /** Load + retain a single full conversation. Used by the viewer modal. */
    async loadViewing(workspacePath: string, id: string) {
      viewing = null;
      viewingError = null;
      viewingLoading = true;
      try {
        const res = await api.claudeCode.get(workspacePath, id);
        if (res.ok) {
          viewing = res.data;
        } else {
          viewingError = 'Conversation not found';
        }
      } catch (err) {
        viewingError = err instanceof Error ? err.message : String(err);
      } finally {
        viewingLoading = false;
      }
    },

    clearViewing() {
      viewing = null;
      viewingError = null;
    },
  };
}

export const claudeCodeHistoryStore = createStore();
