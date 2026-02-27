/**
 * EventBridge — mirrors stream events from claudeManager to active commentator
 * instances so they can observe and narrate in real-time.
 *
 * Design goals:
 *   1. Never slow down the primary stream (all forwarding is fire-and-forget).
 *   2. Support dynamic subscribe/unsubscribe for multiple concurrent workspaces.
 *   3. Resolve workspace filesystem paths to database IDs with caching.
 *   4. Reference-counted subscriptions so multiple SSE clients per workspace work correctly.
 *
 * Usage:
 *   - Commentary route calls `subscribe(workspaceId)` on connect, `unsubscribe` on disconnect.
 *   - `createSSEStream` in claude-process calls `emit(workspacePath, event)` for each event.
 *   - The bridge resolves workspace path → ID and forwards to commentatorService.pushEvent().
 */

import { commentatorService } from './commentator';
import { getDb } from '../db/database';
import type { StreamEvent } from '@e/shared';

/** Event types that carry meaningful signal for commentary narration. */
const BRIDGED_EVENT_TYPES = new Set<string>([
  'message_start',
  'content_block_start',
  'content_block_delta',
  'content_block_stop',
  'message_delta',
  'message_stop',
  'tool_use_start',
  'tool_result',
  'tool_approval_request',
  'error',
  'verification_result',
  'story_update',
  'loop_event',
  'context_warning',
  'artifact_created',
  'agent_note_created',
]);

export class EventBridge {
  /**
   * Reference-counted workspace subscriptions. Each SSE client that connects
   * increments the count; when the last client disconnects, the workspace is
   * fully unsubscribed. This prevents premature unsubscription when multiple
   * clients monitor the same workspace (e.g. commentary panel + Manager View).
   */
  private subscriptionRefs = new Map<string, number>();

  /** Cache: workspace filesystem path → database workspace ID. */
  private pathToIdCache = new Map<string, string>();

  /** Cache: conversationId → workspaceId (resolved from DB). */
  private convToWorkspaceCache = new Map<string, string>();

  // ---------------------------------------------------------------------------
  // Subscription management (AC 4: dynamic subscribe/unsubscribe)
  // ---------------------------------------------------------------------------

  /**
   * Subscribe a workspace to receive bridged stream events.
   * Reference-counted — multiple clients can subscribe to the same workspace.
   * Returns the new reference count.
   */
  subscribe(workspaceId: string): number {
    const current = this.subscriptionRefs.get(workspaceId) ?? 0;
    const next = current + 1;
    this.subscriptionRefs.set(workspaceId, next);
    console.log(
      `[event-bridge] Subscribed workspace ${workspaceId} (refs: ${next}, workspaces: ${this.subscriptionRefs.size})`,
    );
    return next;
  }

  /**
   * Unsubscribe a workspace from bridged stream events.
   * Decrements the reference count; only fully removes the subscription when
   * the last client disconnects (count reaches 0).
   * Returns the remaining reference count.
   */
  unsubscribe(workspaceId: string): number {
    const current = this.subscriptionRefs.get(workspaceId) ?? 0;
    const next = Math.max(0, current - 1);
    if (next === 0) {
      this.subscriptionRefs.delete(workspaceId);
      // Evict cached conversationId mappings pointing to this workspace
      for (const [convId, wsId] of this.convToWorkspaceCache) {
        if (wsId === workspaceId) {
          this.convToWorkspaceCache.delete(convId);
        }
      }
    } else {
      this.subscriptionRefs.set(workspaceId, next);
    }
    console.log(
      `[event-bridge] Unsubscribed workspace ${workspaceId} (refs: ${next}, workspaces: ${this.subscriptionRefs.size})`,
    );
    return next;
  }

  /**
   * Force-unsubscribe a workspace, ignoring reference counts.
   * Used for administrative cleanup (workspace deleted, commentary disabled).
   */
  forceUnsubscribe(workspaceId: string): void {
    this.subscriptionRefs.delete(workspaceId);
    for (const [convId, wsId] of this.convToWorkspaceCache) {
      if (wsId === workspaceId) {
        this.convToWorkspaceCache.delete(convId);
      }
    }
    console.log(`[event-bridge] Force-unsubscribed workspace ${workspaceId}`);
  }

  /**
   * Unsubscribe all workspaces. Use for server shutdown or bulk cleanup.
   * Returns the number of workspaces that were unsubscribed.
   */
  unsubscribeAll(): number {
    const count = this.subscriptionRefs.size;
    this.subscriptionRefs.clear();
    this.convToWorkspaceCache.clear();
    console.log(`[event-bridge] Unsubscribed all workspaces (${count} total)`);
    return count;
  }

  /** Check whether a workspace is currently subscribed. */
  isSubscribed(workspaceId: string): boolean {
    return this.subscriptionRefs.has(workspaceId);
  }

  /** Get the reference count for a specific workspace subscription. */
  getSubscriptionRefCount(workspaceId: string): number {
    return this.subscriptionRefs.get(workspaceId) ?? 0;
  }

  /** Return the number of active workspace subscriptions (unique workspaces). */
  get subscriberCount(): number {
    return this.subscriptionRefs.size;
  }

  /** Return all currently subscribed workspace IDs. */
  getSubscribedWorkspaces(): string[] {
    return [...this.subscriptionRefs.keys()];
  }

  // ---------------------------------------------------------------------------
  // Workspace resolution (cached for performance — AC 3: don't slow down stream)
  // ---------------------------------------------------------------------------

  /**
   * Resolve a workspace filesystem path to its database ID.
   * Results are cached to avoid repeated DB lookups on every event.
   */
  private resolveWorkspaceId(workspacePath: string): string | null {
    const cached = this.pathToIdCache.get(workspacePath);
    if (cached !== undefined) return cached;

    try {
      const db = getDb();
      const row = db.query('SELECT id FROM workspaces WHERE path = ?').get(workspacePath) as {
        id: string;
      } | null;
      if (row) {
        this.pathToIdCache.set(workspacePath, row.id);
        return row.id;
      }
    } catch {
      // DB unavailable — don't cache the miss so we retry next time
    }
    return null;
  }

  /**
   * Resolve a conversationId to its associated workspace ID.
   * Uses conversation → workspace_id from the DB, cached.
   */
  private resolveWorkspaceIdFromConversation(conversationId: string): string | null {
    const cached = this.convToWorkspaceCache.get(conversationId);
    if (cached !== undefined) return cached;

    try {
      const db = getDb();
      // Try workspace_id first (direct FK), fall back to workspace_path lookup
      const conv = db
        .query('SELECT workspace_id, workspace_path FROM conversations WHERE id = ?')
        .get(conversationId) as {
        workspace_id: string | null;
        workspace_path: string | null;
      } | null;

      if (!conv) return null;

      // Prefer workspace_id if set
      if (conv.workspace_id) {
        this.convToWorkspaceCache.set(conversationId, conv.workspace_id);
        return conv.workspace_id;
      }

      // Fall back to resolving workspace_path → workspace_id
      if (conv.workspace_path) {
        const wsId = this.resolveWorkspaceId(conv.workspace_path);
        if (wsId) {
          this.convToWorkspaceCache.set(conversationId, wsId);
          return wsId;
        }
      }
    } catch {
      // DB unavailable
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Event emission (AC 1, 2, 3: hook into stream, mirror events, async)
  // ---------------------------------------------------------------------------

  /**
   * Emit a stream event to any subscribed commentators for the given workspace path.
   *
   * This is completely fire-and-forget — it will never throw, never block,
   * and never interfere with the primary stream (AC 3).
   */
  emit(workspacePath: string, event: StreamEvent): void {
    try {
      // Fast path: skip if no subscriptions at all
      if (this.subscriptionRefs.size === 0) return;

      // Skip event types that don't carry useful signal for commentary
      if (!BRIDGED_EVENT_TYPES.has(event.type)) return;

      const workspaceId = this.resolveWorkspaceId(workspacePath);
      if (!workspaceId) return;

      // Only forward if this workspace is subscribed AND has an active commentator
      if (!this.subscriptionRefs.has(workspaceId)) return;
      if (!commentatorService.isActive(workspaceId)) return;

      commentatorService.pushEvent(workspaceId, event);
    } catch {
      // Never block the primary stream — swallow all errors
    }
  }

  /**
   * Emit a stream event using the conversationId to resolve the workspace.
   * Useful when the workspace path isn't directly available.
   */
  emitByConversation(conversationId: string, event: StreamEvent): void {
    try {
      if (this.subscriptionRefs.size === 0) return;
      if (!BRIDGED_EVENT_TYPES.has(event.type)) return;

      const workspaceId = this.resolveWorkspaceIdFromConversation(conversationId);
      if (!workspaceId) return;

      if (!this.subscriptionRefs.has(workspaceId)) return;
      if (!commentatorService.isActive(workspaceId)) return;

      commentatorService.pushEvent(workspaceId, event);
    } catch {
      // Never block the primary stream
    }
  }

  /**
   * Parse an SSE data string (JSON) and emit it as a stream event.
   * This is the primary integration point with createSSEStream, which
   * produces stringified events.
   *
   * @param workspacePath - Filesystem path of the workspace
   * @param sseData - Raw SSE data string (e.g., `data: {"type":"content_block_delta",...}\n\n`)
   */
  emitRaw(workspacePath: string, sseData: string): void {
    try {
      // Fast path: skip if no subscriptions
      if (this.subscriptionRefs.size === 0) return;

      // Strip SSE framing: "data: {...}\n\n" → "{...}"
      let json = sseData;
      if (json.startsWith('data: ')) {
        json = json.slice(6);
      }
      json = json.trim();
      if (!json) return;

      const event = JSON.parse(json) as StreamEvent;
      this.emit(workspacePath, event);
    } catch {
      // Parse error or any other issue — silently ignore
    }
  }

  // ---------------------------------------------------------------------------
  // Cache management
  // ---------------------------------------------------------------------------

  /** Clear all cached workspace path → ID mappings. */
  clearCache(): void {
    this.pathToIdCache.clear();
    this.convToWorkspaceCache.clear();
  }

  /** Invalidate a specific workspace path from the cache. */
  invalidatePath(workspacePath: string): void {
    this.pathToIdCache.delete(workspacePath);
  }

  /** Invalidate a specific conversation from the cache. */
  invalidateConversation(conversationId: string): void {
    this.convToWorkspaceCache.delete(conversationId);
  }
}

// Persist across Bun --hot reloads
const GLOBAL_KEY = '__e_eventBridge';
export const eventBridge: EventBridge =
  (globalThis as any)[GLOBAL_KEY] ?? ((globalThis as any)[GLOBAL_KEY] = new EventBridge());
