/**
 * Cross-Session Message Service
 *
 * Enables agents in different conversations/workspaces to communicate with each other.
 * Manages message delivery, rate limiting, permissions, and notification via SSE.
 *
 * Design:
 *   - Messages are stored in SQLite for durability and history
 *   - In-memory listeners enable real-time SSE delivery
 *   - Rate limiting prevents message storms between agents
 *   - Workspace-level permissions control send/receive capability
 */

import { EventEmitter } from 'events';
import { nanoid } from 'nanoid';
import { getDb } from '../db/database';
import type {
  CrossSessionMessage,
  CrossSessionSenderContext,
  CrossSessionInfo,
  CrossSessionPermission,
} from '@e/shared';
import { DEFAULT_CROSS_SESSION_RATE_LIMIT } from '@e/shared';
import { claudeManager } from './claude-process';

/**
 * Rate limit tracker: conversationId -> { timestamps of recent sends }
 */
interface RateLimitEntry {
  timestamps: number[];
}

export class CrossSessionService {
  /** EventEmitter for real-time message delivery */
  readonly events = new EventEmitter();

  /** Rate limit state per sender conversation */
  private rateLimits = new Map<string, RateLimitEntry>();

  /** Periodic rate limit cleanup interval */
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor() {
    // Clean up old rate limit entries every 60 seconds
    this.cleanupInterval = setInterval(() => this.cleanupRateLimits(), 60_000);
  }

  // ---------------------------------------------------------------------------
  // Database setup
  // ---------------------------------------------------------------------------

  /**
   * Ensure the cross_session_messages table exists.
   * Called during server startup from initDatabase.
   */
  ensureTable(): void {
    const db = getDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS cross_session_messages (
        id TEXT PRIMARY KEY,
        from_conversation_id TEXT NOT NULL,
        to_conversation_id TEXT NOT NULL,
        content TEXT NOT NULL,
        sender_workspace_id TEXT NOT NULL,
        sender_workspace_name TEXT NOT NULL DEFAULT '',
        sender_conversation_title TEXT NOT NULL DEFAULT '',
        sender_agent_profile TEXT,
        timestamp INTEGER NOT NULL,
        delivered INTEGER NOT NULL DEFAULT 0,
        delivered_at INTEGER,
        created_at INTEGER NOT NULL
      )
    `);

    // Index for quick lookup of messages for a conversation
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_cross_session_to_conv
        ON cross_session_messages(to_conversation_id, timestamp)
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_cross_session_from_conv
        ON cross_session_messages(from_conversation_id, timestamp)
    `);
  }

  // ---------------------------------------------------------------------------
  // List active sessions (AC 1)
  // ---------------------------------------------------------------------------

  /**
   * List all active conversations that can participate in cross-session messaging.
   * Returns conversations that have active Claude sessions running.
   */
  listSessions(excludeConversationId?: string): CrossSessionInfo[] {
    const db = getDb();
    const sessions = claudeManager.listSessions();

    // Get all conversation IDs from active sessions
    const activeConvIds = sessions
      .map((s: any) => s.conversationId)
      .filter((id: string) => id && id !== excludeConversationId);

    if (activeConvIds.length === 0) {
      // Also include recent conversations (last hour) that might not have active sessions
      // but could receive messages when they next resume
      const recentConvs = db
        .query(
          `SELECT c.id, c.title, c.workspace_path, c.workspace_id,
                  w.name as workspace_name, w.id as ws_id, w.settings
           FROM conversations c
           LEFT JOIN workspaces w ON c.workspace_id = w.id OR c.workspace_path = w.path
           WHERE c.updated_at >= ?
           ${excludeConversationId ? 'AND c.id != ?' : ''}
           ORDER BY c.updated_at DESC
           LIMIT 20`,
        )
        .all(
          ...(excludeConversationId
            ? [Date.now() - 3600_000, excludeConversationId]
            : [Date.now() - 3600_000]),
        ) as any[];

      return recentConvs
        .filter((c: any) => this.getPermission(c.settings) !== 'disabled')
        .map((c: any) => ({
          conversationId: c.id,
          title: c.title || 'Untitled',
          workspaceName: c.workspace_name || 'Unknown',
          workspaceId: c.ws_id || c.workspace_id || '',
          status: 'idle' as const,
          canReceive:
            this.getPermission(c.settings) === 'open' ||
            this.getPermission(c.settings) === 'receive_only',
        }));
    }

    // Look up conversation details from DB
    const placeholders = activeConvIds.map(() => '?').join(',');
    const convRows = db
      .query(
        `SELECT c.id, c.title, c.workspace_path, c.workspace_id,
                w.name as workspace_name, w.id as ws_id, w.settings
         FROM conversations c
         LEFT JOIN workspaces w ON c.workspace_id = w.id OR c.workspace_path = w.path
         WHERE c.id IN (${placeholders})`,
      )
      .all(...activeConvIds) as any[];

    const convMap = new Map<string, any>();
    for (const row of convRows) {
      convMap.set(row.id, row);
    }

    // Build session info, also add recent idle conversations
    const result: CrossSessionInfo[] = [];
    const seenIds = new Set<string>();

    // Active sessions first
    for (const session of sessions as any[]) {
      if (!session.conversationId || session.conversationId === excludeConversationId) continue;
      if (seenIds.has(session.conversationId)) continue;
      seenIds.add(session.conversationId);

      const conv = convMap.get(session.conversationId);
      const permission = this.getPermission(conv?.settings);
      if (permission === 'disabled') continue;

      result.push({
        conversationId: session.conversationId,
        title: conv?.title || 'Untitled',
        workspaceName: conv?.workspace_name || 'Unknown',
        workspaceId: conv?.ws_id || conv?.workspace_id || '',
        status: session.streamComplete ? 'idle' : 'running',
        canReceive: permission === 'open' || permission === 'receive_only',
      });
    }

    // Also include recent idle conversations not in active sessions
    const recentConvs = db
      .query(
        `SELECT c.id, c.title, c.workspace_path, c.workspace_id,
                w.name as workspace_name, w.id as ws_id, w.settings
         FROM conversations c
         LEFT JOIN workspaces w ON c.workspace_id = w.id OR c.workspace_path = w.path
         WHERE c.updated_at >= ?
         ${excludeConversationId ? 'AND c.id != ?' : ''}
         ORDER BY c.updated_at DESC
         LIMIT 20`,
      )
      .all(
        ...(excludeConversationId
          ? [Date.now() - 3600_000, excludeConversationId]
          : [Date.now() - 3600_000]),
      ) as any[];

    for (const c of recentConvs) {
      if (seenIds.has(c.id)) continue;
      seenIds.add(c.id);
      const permission = this.getPermission(c.settings);
      if (permission === 'disabled') continue;

      result.push({
        conversationId: c.id,
        title: c.title || 'Untitled',
        workspaceName: c.workspace_name || 'Unknown',
        workspaceId: c.ws_id || c.workspace_id || '',
        status: 'idle',
        canReceive: permission === 'open' || permission === 'receive_only',
      });
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Send message (AC 2, 6, 7)
  // ---------------------------------------------------------------------------

  /**
   * Send a cross-session message from one conversation to another.
   * Validates permissions, applies rate limiting, stores the message,
   * and emits it for real-time delivery.
   */
  sendMessage(
    fromConversationId: string,
    toConversationId: string,
    content: string,
  ): CrossSessionMessage {
    const db = getDb();

    // Validate sender exists and get context
    const fromConv = db
      .query(
        `SELECT c.id, c.title, c.workspace_id, c.workspace_path, c.profile_id,
                w.name as workspace_name, w.id as ws_id, w.settings as ws_settings,
                ap.name as profile_name
         FROM conversations c
         LEFT JOIN workspaces w ON c.workspace_id = w.id OR c.workspace_path = w.path
         LEFT JOIN agent_profiles ap ON c.profile_id = ap.id
         WHERE c.id = ?`,
      )
      .get(fromConversationId) as any;

    if (!fromConv) {
      throw new Error(`Sender conversation ${fromConversationId} not found`);
    }

    // Check sender permission
    const senderPermission = this.getPermission(fromConv.ws_settings);
    if (senderPermission === 'disabled' || senderPermission === 'receive_only') {
      throw new Error(
        `Workspace "${fromConv.workspace_name || 'Unknown'}" does not have permission to send cross-session messages`,
      );
    }

    // Validate receiver exists
    const toConv = db
      .query(
        `SELECT c.id, c.workspace_id, c.workspace_path,
                w.settings as ws_settings, w.name as workspace_name
         FROM conversations c
         LEFT JOIN workspaces w ON c.workspace_id = w.id OR c.workspace_path = w.path
         WHERE c.id = ?`,
      )
      .get(toConversationId) as any;

    if (!toConv) {
      throw new Error(`Target conversation ${toConversationId} not found`);
    }

    // Check receiver permission
    const receiverPermission = this.getPermission(toConv.ws_settings);
    if (receiverPermission === 'disabled' || receiverPermission === 'send_only') {
      throw new Error(
        `Workspace "${toConv.workspace_name || 'Unknown'}" does not accept cross-session messages`,
      );
    }

    // Validate content length
    if (content.length > DEFAULT_CROSS_SESSION_RATE_LIMIT.maxMessageLength) {
      throw new Error(
        `Message exceeds maximum length of ${DEFAULT_CROSS_SESSION_RATE_LIMIT.maxMessageLength} characters`,
      );
    }

    // Rate limiting (AC 7)
    const maxPerMinute = this.getMaxPerMinute(fromConv.ws_settings);
    if (!this.checkRateLimit(fromConversationId, maxPerMinute)) {
      throw new Error(`Rate limit exceeded: maximum ${maxPerMinute} messages per minute`);
    }

    // Build sender context (AC 6)
    const senderContext: CrossSessionSenderContext = {
      workspaceId: fromConv.ws_id || fromConv.workspace_id || '',
      workspaceName: fromConv.workspace_name || 'Unknown',
      conversationTitle: fromConv.title || 'Untitled',
      agentProfile: fromConv.profile_name || undefined,
    };

    // Create the message
    const now = Date.now();
    const message: CrossSessionMessage = {
      id: nanoid(16),
      fromConversationId,
      toConversationId,
      content,
      senderContext,
      timestamp: now,
      delivered: false,
    };

    // Store in database
    db.query(
      `INSERT INTO cross_session_messages (
        id, from_conversation_id, to_conversation_id, content,
        sender_workspace_id, sender_workspace_name, sender_conversation_title,
        sender_agent_profile, timestamp, delivered, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    ).run(
      message.id,
      fromConversationId,
      toConversationId,
      content,
      senderContext.workspaceId,
      senderContext.workspaceName,
      senderContext.conversationTitle,
      senderContext.agentProfile || null,
      now,
      now,
    );

    // Record rate limit
    this.recordSend(fromConversationId);

    // Emit for real-time SSE delivery
    this.events.emit('message', message);
    this.events.emit(`message:${toConversationId}`, message);

    console.log(
      `[cross-session] Message ${message.id}: "${fromConv.title}" -> "${toConv.id}" (${content.length} chars)`,
    );

    return message;
  }

  // ---------------------------------------------------------------------------
  // Receive / deliver messages (AC 3)
  // ---------------------------------------------------------------------------

  /**
   * Get undelivered messages for a conversation.
   */
  getUndeliveredMessages(conversationId: string): CrossSessionMessage[] {
    const db = getDb();
    const rows = db
      .query(
        `SELECT * FROM cross_session_messages
         WHERE to_conversation_id = ? AND delivered = 0
         ORDER BY timestamp ASC`,
      )
      .all(conversationId) as any[];

    return rows.map(this.messageFromRow);
  }

  /**
   * Mark a message as delivered.
   */
  markDelivered(messageId: string): void {
    const db = getDb();
    db.query('UPDATE cross_session_messages SET delivered = 1, delivered_at = ? WHERE id = ?').run(
      Date.now(),
      messageId,
    );
  }

  /**
   * Get message history for a conversation (sent and received).
   */
  getHistory(
    conversationId: string,
    options?: { limit?: number; direction?: 'sent' | 'received' | 'both' },
  ): CrossSessionMessage[] {
    const db = getDb();
    const limit = options?.limit ?? 50;
    const direction = options?.direction ?? 'both';

    let query: string;
    let params: any[];

    switch (direction) {
      case 'sent':
        query = `SELECT * FROM cross_session_messages WHERE from_conversation_id = ? ORDER BY timestamp DESC LIMIT ?`;
        params = [conversationId, limit];
        break;
      case 'received':
        query = `SELECT * FROM cross_session_messages WHERE to_conversation_id = ? ORDER BY timestamp DESC LIMIT ?`;
        params = [conversationId, limit];
        break;
      default:
        query = `SELECT * FROM cross_session_messages
                 WHERE from_conversation_id = ? OR to_conversation_id = ?
                 ORDER BY timestamp DESC LIMIT ?`;
        params = [conversationId, conversationId, limit];
    }

    const rows = db.query(query).all(...params) as any[];
    return rows.map(this.messageFromRow);
  }

  /**
   * Get all cross-session message flow data for the manager view (AC 4).
   * Returns recent messages grouped by workspace.
   */
  getRecentFlow(sinceMs?: number): CrossSessionMessage[] {
    const db = getDb();
    const since = sinceMs ?? Date.now() - 3600_000; // last hour

    const rows = db
      .query(
        `SELECT * FROM cross_session_messages
         WHERE timestamp >= ?
         ORDER BY timestamp DESC
         LIMIT 100`,
      )
      .all(since) as any[];

    return rows.map(this.messageFromRow);
  }

  // ---------------------------------------------------------------------------
  // Permission helpers (AC 5)
  // ---------------------------------------------------------------------------

  /**
   * Parse workspace settings JSON and extract cross-session permission.
   */
  private getPermission(settingsStr: string | null | undefined): CrossSessionPermission {
    if (!settingsStr) return 'open'; // Default: allow cross-session messaging
    try {
      const settings = typeof settingsStr === 'string' ? JSON.parse(settingsStr) : settingsStr;
      return settings.crossSessionPermission || 'open';
    } catch {
      return 'open';
    }
  }

  /**
   * Get the max messages per minute from workspace settings.
   */
  private getMaxPerMinute(settingsStr: string | null | undefined): number {
    if (!settingsStr) return DEFAULT_CROSS_SESSION_RATE_LIMIT.maxPerMinute;
    try {
      const settings = typeof settingsStr === 'string' ? JSON.parse(settingsStr) : settingsStr;
      return settings.crossSessionMaxPerMinute || DEFAULT_CROSS_SESSION_RATE_LIMIT.maxPerMinute;
    } catch {
      return DEFAULT_CROSS_SESSION_RATE_LIMIT.maxPerMinute;
    }
  }

  // ---------------------------------------------------------------------------
  // Rate limiting (AC 7)
  // ---------------------------------------------------------------------------

  /**
   * Check if a conversation can send a message (hasn't exceeded rate limit).
   */
  private checkRateLimit(conversationId: string, maxPerMinute: number): boolean {
    const entry = this.rateLimits.get(conversationId);
    if (!entry) return true;

    const oneMinuteAgo = Date.now() - 60_000;
    const recentSends = entry.timestamps.filter((t) => t > oneMinuteAgo);
    return recentSends.length < maxPerMinute;
  }

  /**
   * Record a send for rate limiting purposes.
   */
  private recordSend(conversationId: string): void {
    let entry = this.rateLimits.get(conversationId);
    if (!entry) {
      entry = { timestamps: [] };
      this.rateLimits.set(conversationId, entry);
    }
    entry.timestamps.push(Date.now());
  }

  /**
   * Clean up old rate limit entries.
   */
  private cleanupRateLimits(): void {
    const oneMinuteAgo = Date.now() - 60_000;
    for (const [convId, entry] of this.rateLimits) {
      entry.timestamps = entry.timestamps.filter((t) => t > oneMinuteAgo);
      if (entry.timestamps.length === 0) {
        this.rateLimits.delete(convId);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // DB row mapping
  // ---------------------------------------------------------------------------

  private messageFromRow(row: any): CrossSessionMessage {
    return {
      id: row.id,
      fromConversationId: row.from_conversation_id,
      toConversationId: row.to_conversation_id,
      content: row.content,
      senderContext: {
        workspaceId: row.sender_workspace_id,
        workspaceName: row.sender_workspace_name,
        conversationTitle: row.sender_conversation_title,
        agentProfile: row.sender_agent_profile || undefined,
      },
      timestamp: row.timestamp,
      delivered: !!row.delivered,
      deliveredAt: row.delivered_at || undefined,
    };
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.rateLimits.clear();
    this.events.removeAllListeners();
  }
}

// Persist across Bun --hot reloads
const GLOBAL_KEY = '__e_crossSessionService';
export const crossSessionService: CrossSessionService =
  (globalThis as any)[GLOBAL_KEY] ?? ((globalThis as any)[GLOBAL_KEY] = new CrossSessionService());
