/**
 * Commentary History Database Operations
 *
 * Handles storing and retrieving commentary history from the database.
 */

import { getDb } from '../db/database';
import { nanoid } from 'nanoid';
import type { StreamCommentary } from '@e/shared';

export interface CommentaryHistoryEntry {
  id: string;
  workspace_id: string;
  conversation_id: string | null;
  text: string;
  personality: string;
  timestamp: number;
}

/**
 * Check if commentary history storage is enabled for a workspace.
 * Reads from workspace settings.
 */
export function isHistoryEnabled(workspaceId: string): boolean {
  try {
    const db = getDb();
    const workspace = db.query('SELECT settings FROM workspaces WHERE id = ?').get(workspaceId) as {
      settings: string | null;
    } | null;

    if (!workspace || !workspace.settings) {
      // Default to enabled
      return true;
    }

    const settings = JSON.parse(workspace.settings);
    // Default to enabled if not explicitly set
    return settings.commentaryHistoryEnabled !== false;
  } catch (err) {
    console.error('[commentary-history] Failed to check if history enabled:', err);
    // Default to enabled on error
    return true;
  }
}

/**
 * Save a commentary entry to the database.
 * Only saves if history is enabled for the workspace.
 */
export function saveCommentary(commentary: StreamCommentary, conversationId?: string): void {
  try {
    if (!isHistoryEnabled(commentary.workspaceId)) {
      return;
    }

    const db = getDb();
    const id = nanoid(12);

    db.query(
      `INSERT INTO commentary_history (id, workspace_id, conversation_id, text, personality, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      commentary.workspaceId,
      conversationId || null,
      commentary.text,
      commentary.personality,
      commentary.timestamp,
    );
  } catch (err) {
    // Non-critical — log and continue
    console.error('[commentary-history] Failed to save commentary:', err);
  }
}

/**
 * Get commentary history for a workspace.
 * @param workspaceId The workspace ID
 * @param limit Maximum number of entries to return (default 100)
 * @param offset Pagination offset (default 0)
 */
export function getWorkspaceHistory(
  workspaceId: string,
  limit = 100,
  offset = 0,
): CommentaryHistoryEntry[] {
  try {
    const db = getDb();
    const entries = db
      .query(
        `SELECT * FROM commentary_history
         WHERE workspace_id = ?
         ORDER BY timestamp DESC
         LIMIT ? OFFSET ?`,
      )
      .all(workspaceId, limit, offset) as CommentaryHistoryEntry[];

    return entries;
  } catch (err) {
    console.error('[commentary-history] Failed to get workspace history:', err);
    return [];
  }
}

/**
 * Get commentary history for a specific conversation.
 * @param conversationId The conversation ID
 * @param limit Maximum number of entries to return (default 100)
 */
export function getConversationHistory(
  conversationId: string,
  limit = 100,
): CommentaryHistoryEntry[] {
  try {
    const db = getDb();
    const entries = db
      .query(
        `SELECT * FROM commentary_history
         WHERE conversation_id = ?
         ORDER BY timestamp DESC
         LIMIT ?`,
      )
      .all(conversationId, limit) as CommentaryHistoryEntry[];

    return entries;
  } catch (err) {
    console.error('[commentary-history] Failed to get conversation history:', err);
    return [];
  }
}

/**
 * Delete all commentary history for a workspace.
 * Used when user wants to clear history for privacy.
 */
export function clearWorkspaceHistory(workspaceId: string): void {
  try {
    const db = getDb();
    db.query('DELETE FROM commentary_history WHERE workspace_id = ?').run(workspaceId);
    console.log(`[commentary-history] Cleared history for workspace ${workspaceId}`);
  } catch (err) {
    console.error('[commentary-history] Failed to clear workspace history:', err);
    throw err;
  }
}

/**
 * Delete commentary history older than a certain date.
 * @param workspaceId The workspace ID
 * @param olderThan Timestamp — delete entries older than this
 */
export function deleteOldHistory(workspaceId: string, olderThan: number): void {
  try {
    const db = getDb();
    db.query('DELETE FROM commentary_history WHERE workspace_id = ? AND timestamp < ?').run(
      workspaceId,
      olderThan,
    );
  } catch (err) {
    console.error('[commentary-history] Failed to delete old history:', err);
    throw err;
  }
}
