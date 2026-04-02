/**
 * Swarm Coordinator Mailbox / Permission Queue
 *
 * Workers request permission from the leader via a mailbox
 * before executing dangerous operations. Uses atomic claim
 * to prevent multiple workers from handling the same request.
 */

import { nanoid } from 'nanoid';
import { getDb } from '../db/database';
import type {
  SwarmMailboxMessage,
  MailboxMessageType,
  PermissionRequest,
  PermissionRiskLevel,
  AutoApprovalRule,
} from '@e/shared';
import { DEFAULT_AUTO_APPROVAL_RULES, PERMISSION_TIMEOUT_MS } from '@e/shared';

class SwarmMailboxService {
  private static instance: SwarmMailboxService;
  private autoRules: AutoApprovalRule[] = [...DEFAULT_AUTO_APPROVAL_RULES];
  private timeoutTimers = new Map<string, ReturnType<typeof setTimeout>>();

  static getInstance(): SwarmMailboxService {
    if (!SwarmMailboxService.instance) {
      SwarmMailboxService.instance = new SwarmMailboxService();
    }
    return SwarmMailboxService.instance;
  }

  /**
   * Send a message to the mailbox.
   */
  send(
    groupId: string,
    fromAgentId: string,
    toAgentId: string,
    type: MailboxMessageType,
    payload: PermissionRequest | Record<string, unknown>,
  ): SwarmMailboxMessage {
    const id = nanoid(12);
    const now = Date.now();

    const msg: SwarmMailboxMessage = {
      id,
      groupId,
      fromAgentId,
      toAgentId,
      type,
      payload,
      claimed: false,
      timestamp: now,
    };

    const db = getDb();
    db.query(
      `INSERT INTO swarm_mailbox (id, group_id, from_agent_id, to_agent_id, type, payload_json, claimed, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
    ).run(id, groupId, fromAgentId, toAgentId, type, JSON.stringify(payload), now);

    // Auto-approve if matches rules
    if (type === 'permission_request') {
      const req = payload as PermissionRequest;
      if (this.shouldAutoApprove(req)) {
        this.respond(id, 'leader', 'permission_granted', {});
        return { ...msg, claimed: true, claimedBy: 'leader' };
      }

      // Set timeout for auto-deny
      this.timeoutTimers.set(
        id,
        setTimeout(() => {
          this.respond(id, 'system', 'permission_denied', { reason: 'timeout' });
          this.timeoutTimers.delete(id);
        }, PERMISSION_TIMEOUT_MS),
      );
    }

    return msg;
  }

  /**
   * Atomically claim a message (prevents duplicate processing).
   */
  claim(messageId: string, claimerId: string): boolean {
    const db = getDb();
    const result = db
      .query('UPDATE swarm_mailbox SET claimed = 1, claimed_by = ? WHERE id = ? AND claimed = 0')
      .run(claimerId, messageId);
    return result.changes > 0;
  }

  /**
   * Respond to a message (e.g., grant/deny permission).
   */
  respond(
    messageId: string,
    responderId: string,
    responseType: MailboxMessageType,
    payload: Record<string, unknown>,
  ): SwarmMailboxMessage | null {
    const db = getDb();
    const original = db.query('SELECT * FROM swarm_mailbox WHERE id = ?').get(messageId) as any;
    if (!original) return null;

    // Clear timeout if exists
    const timer = this.timeoutTimers.get(messageId);
    if (timer) {
      clearTimeout(timer);
      this.timeoutTimers.delete(messageId);
    }

    // Claim original
    this.claim(messageId, responderId);

    // Send response
    const response = this.send(
      original.group_id,
      responderId,
      original.from_agent_id,
      responseType,
      payload,
    );

    // Link response
    db.query('UPDATE swarm_mailbox SET response_id = ? WHERE id = ?').run(response.id, messageId);

    return response;
  }

  /**
   * Get pending messages for an agent.
   */
  getPending(agentId: string, groupId?: string): SwarmMailboxMessage[] {
    const db = getDb();
    let query = 'SELECT * FROM swarm_mailbox WHERE to_agent_id = ? AND claimed = 0';
    const params: any[] = [agentId];
    if (groupId) {
      query += ' AND group_id = ?';
      params.push(groupId);
    }
    query += ' ORDER BY timestamp ASC';

    return (db.query(query).all(...params) as any[]).map(this.rowToMessage);
  }

  /**
   * Get all messages in a group.
   */
  getGroupMessages(groupId: string): SwarmMailboxMessage[] {
    const db = getDb();
    return (
      db
        .query('SELECT * FROM swarm_mailbox WHERE group_id = ? ORDER BY timestamp ASC')
        .all(groupId) as any[]
    ).map(this.rowToMessage);
  }

  /**
   * Set auto-approval rules.
   */
  setAutoRules(rules: AutoApprovalRule[]): void {
    this.autoRules = rules;
  }

  private shouldAutoApprove(req: PermissionRequest): boolean {
    const riskLevels: PermissionRiskLevel[] = ['low', 'medium', 'high', 'critical'];
    return this.autoRules.some((rule) => {
      const toolMatch =
        req.tool === rule.toolPattern ||
        (rule.toolPattern.includes('*') && req.tool.startsWith(rule.toolPattern.replace('*', '')));
      const riskOk = riskLevels.indexOf(req.riskLevel) <= riskLevels.indexOf(rule.maxRiskLevel);
      return toolMatch && riskOk;
    });
  }

  private rowToMessage(row: any): SwarmMailboxMessage {
    return {
      id: row.id,
      groupId: row.group_id,
      fromAgentId: row.from_agent_id,
      toAgentId: row.to_agent_id,
      type: row.type,
      payload: JSON.parse(row.payload_json),
      claimed: !!row.claimed,
      claimedBy: row.claimed_by || undefined,
      responseId: row.response_id || undefined,
      timestamp: row.timestamp,
    };
  }
}

export const swarmMailbox = SwarmMailboxService.getInstance();
