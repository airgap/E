// --- Cross-Session Messaging Types ---
// Enables agents in different conversations/workspaces to communicate with each other.

/**
 * Permission mode for cross-session messaging on a workspace
 */
export type CrossSessionPermission = 'open' | 'send_only' | 'receive_only' | 'disabled';

/**
 * A cross-session message sent from one agent/conversation to another
 */
export interface CrossSessionMessage {
  id: string;
  /** The conversation that sent the message */
  fromConversationId: string;
  /** The conversation that should receive the message */
  toConversationId: string;
  /** The content of the message */
  content: string;
  /** Sender context for display */
  senderContext: CrossSessionSenderContext;
  /** When the message was sent */
  timestamp: number;
  /** Whether the receiving agent has consumed the message */
  delivered: boolean;
  /** When the message was delivered/consumed */
  deliveredAt?: number;
}

/**
 * Context about the sender included with every cross-session message
 */
export interface CrossSessionSenderContext {
  /** Workspace ID the sender belongs to */
  workspaceId: string;
  /** Workspace name for display */
  workspaceName: string;
  /** Conversation title */
  conversationTitle: string;
  /** Agent profile name if one is active */
  agentProfile?: string;
}

/**
 * Information about an active session, returned by list_sessions
 */
export interface CrossSessionInfo {
  /** Conversation ID (used for addressing messages) */
  conversationId: string;
  /** Conversation title */
  title: string;
  /** Workspace name */
  workspaceName: string;
  /** Workspace ID */
  workspaceId: string;
  /** Agent status */
  status: 'idle' | 'running' | 'waiting';
  /** Whether this session can receive messages */
  canReceive: boolean;
}

/**
 * Input for sending a cross-session message
 */
export interface CrossSessionSendInput {
  /** Target conversation ID */
  toConversationId: string;
  /** Message content */
  content: string;
}

/**
 * Rate limit configuration for cross-session messaging
 */
export interface CrossSessionRateLimit {
  /** Max messages per minute per sender conversation */
  maxPerMinute: number;
  /** Max message length in characters */
  maxMessageLength: number;
}

/** Default rate limits */
export const DEFAULT_CROSS_SESSION_RATE_LIMIT: CrossSessionRateLimit = {
  maxPerMinute: 10,
  maxMessageLength: 4000,
};

/**
 * SSE event emitted when a cross-session message is sent or received
 */
export interface StreamCrossSessionMessage {
  type: 'cross_session_message';
  message: CrossSessionMessage;
}

/**
 * Cross-session settings stored in workspace settings
 */
export interface CrossSessionSettings {
  /** Whether cross-session messaging is enabled for this workspace */
  permission: CrossSessionPermission;
  /** Max messages per minute (defaults to 10) */
  maxPerMinute: number;
}

/** Default cross-session settings */
export const DEFAULT_CROSS_SESSION_SETTINGS: CrossSessionSettings = {
  permission: 'open',
  maxPerMinute: 10,
};
