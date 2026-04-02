/**
 * Swarm Coordinator Mailbox / Permission Queue
 *
 * Workers request permission from the leader via a mailbox
 * before executing dangerous operations. Uses atomic claim
 * to prevent multiple workers from handling the same request.
 */

export type MailboxMessageType =
  | 'permission_request'
  | 'permission_granted'
  | 'permission_denied'
  | 'status_update'
  | 'result'
  | 'task_assignment'
  | 'error_report';

export type PermissionRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface PermissionRequest {
  /** What tool/action the worker wants to execute */
  action: string;
  /** Tool name */
  tool: string;
  /** Tool arguments (sanitized) */
  args: Record<string, unknown>;
  /** Risk assessment */
  riskLevel: PermissionRiskLevel;
  /** Worker's reasoning for why this action is needed */
  reasoning: string;
}

export interface SwarmMailboxMessage {
  id: string;
  groupId: string;
  fromAgentId: string;
  /** 'leader' or a specific agent ID */
  toAgentId: string;
  type: MailboxMessageType;
  payload: PermissionRequest | Record<string, unknown>;
  /** Whether this message has been claimed (atomic) */
  claimed: boolean;
  /** Who claimed it */
  claimedBy?: string;
  timestamp: number;
  /** Response to this message (for request/response pairs) */
  responseId?: string;
}

/** Auto-approval rules for low-risk actions */
export interface AutoApprovalRule {
  /** Tool name pattern (glob) */
  toolPattern: string;
  /** Maximum risk level to auto-approve */
  maxRiskLevel: PermissionRiskLevel;
}

export const DEFAULT_AUTO_APPROVAL_RULES: AutoApprovalRule[] = [
  { toolPattern: 'read_file', maxRiskLevel: 'low' },
  { toolPattern: 'glob', maxRiskLevel: 'low' },
  { toolPattern: 'grep', maxRiskLevel: 'low' },
];

/** Timeout before auto-denying unanswered permission requests */
export const PERMISSION_TIMEOUT_MS = 30_000;

export interface StreamMailboxEvent {
  type: 'mailbox_event';
  groupId: string;
  event:
    | 'message_sent'
    | 'message_claimed'
    | 'permission_granted'
    | 'permission_denied'
    | 'timeout';
  data: {
    messageId: string;
    fromAgentId: string;
    toAgentId: string;
    messageType: MailboxMessageType;
    riskLevel?: PermissionRiskLevel;
  };
}
