/**
 * Commentary History Loader
 *
 * Helpers to load and manage persisted commentary history.
 */

import { api } from '$lib/api/client';
import type { CommentaryEntry } from './commentary.svelte';

export interface CommentaryHistoryEntry {
  id: string;
  workspace_id: string;
  conversation_id: string | null;
  text: string;
  personality: string;
  timestamp: number;
}

/**
 * Load commentary history for a workspace from the database.
 */
export async function loadWorkspaceHistory(
  workspaceId: string,
  limit = 100,
  offset = 0,
): Promise<CommentaryEntry[]> {
  try {
    const response = await api.commentary.getWorkspaceHistory(workspaceId, limit, offset);

    if (response.ok && response.data.history) {
      return response.data.history.map((entry) => ({
        text: entry.text,
        timestamp: entry.timestamp,
        personality: entry.personality,
        workspaceId: entry.workspace_id,
      }));
    }
    return [];
  } catch (err) {
    console.error('[commentary-history] Failed to load workspace history:', err);
    return [];
  }
}

/**
 * Load commentary history for a conversation from the database.
 */
export async function loadConversationHistory(
  conversationId: string,
  limit = 100,
): Promise<CommentaryEntry[]> {
  try {
    const response = await api.commentary.getConversationHistory(conversationId, limit);

    if (response.ok && response.data.history) {
      return response.data.history.map((entry) => ({
        text: entry.text,
        timestamp: entry.timestamp,
        personality: entry.personality,
        workspaceId: entry.workspace_id,
      }));
    }
    return [];
  } catch (err) {
    console.error('[commentary-history] Failed to load conversation history:', err);
    return [];
  }
}

/**
 * Clear all commentary history for a workspace.
 */
export async function clearWorkspaceHistory(workspaceId: string): Promise<void> {
  try {
    await api.commentary.clearHistory(workspaceId);
  } catch (err) {
    console.error('[commentary-history] Failed to clear workspace history:', err);
    throw err;
  }
}
