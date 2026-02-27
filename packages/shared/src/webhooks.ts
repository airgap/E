// --- Webhook Types ---

export type WebhookAuthMethod = 'bearer' | 'hmac-sha256';

export type WebhookStatus = 'enabled' | 'disabled';

export type WebhookExecutionStatus = 'success' | 'failed' | 'rate_limited' | 'running';

/**
 * A configured webhook that triggers agent actions on inbound HTTP events
 */
export interface Webhook {
  id: string;
  workspaceId: string;
  /** Human-readable name for this webhook */
  name: string;
  /** Optional description */
  description: string;
  /** Authentication method */
  authMethod: WebhookAuthMethod;
  /** Secret token for authentication (bearer token or HMAC signing key) */
  secret: string;
  /** The prompt template to execute when triggered. Use {{payload}} for injected JSON. */
  promptTemplate: string;
  /** Optional agent profile to use for execution */
  profileId?: string;
  /** Whether this webhook is active */
  status: WebhookStatus;
  /** Max invocations per minute (rate limiting) */
  maxPerMinute: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * A single invocation of a webhook
 */
export interface WebhookExecution {
  id: string;
  webhookId: string;
  conversationId?: string;
  status: WebhookExecutionStatus;
  /** HTTP status code returned to caller */
  httpStatus: number;
  /** Size of the inbound payload in bytes */
  payloadSize: number;
  /** Source IP or user-agent of the caller */
  source?: string;
  /** Time from request to response in ms */
  responseTimeMs?: number;
  startedAt: number;
  completedAt?: number;
  errorMessage?: string;
}

/**
 * Input for creating a webhook
 */
export interface WebhookCreateInput {
  workspaceId: string;
  name: string;
  description?: string;
  authMethod?: WebhookAuthMethod;
  promptTemplate: string;
  profileId?: string;
  maxPerMinute?: number;
}

/**
 * Input for updating a webhook
 */
export interface WebhookUpdateInput {
  name?: string;
  description?: string;
  authMethod?: WebhookAuthMethod;
  promptTemplate?: string;
  profileId?: string;
  status?: WebhookStatus;
  maxPerMinute?: number;
  /** Set to true to regenerate the secret */
  regenerateSecret?: boolean;
}

/**
 * Webhook with execution statistics
 */
export interface WebhookWithStats extends Webhook {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  lastExecutionStatus?: WebhookExecutionStatus;
  lastExecutionAt?: number;
  averageResponseTimeMs?: number;
}

/**
 * Stream event for webhook execution updates
 */
export interface StreamWebhookEvent {
  type: 'webhook_event';
  webhookId: string;
  event: 'triggered' | 'completed' | 'failed' | 'rate_limited';
  data: {
    executionId: string;
    conversationId?: string;
    message?: string;
  };
}
