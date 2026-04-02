/**
 * Telemetry & Usage Analytics
 *
 * Privacy-first, local-only telemetry. All data stays on-device
 * unless user explicitly configures an export endpoint.
 */

export type TelemetryEventType =
  | 'session_start'
  | 'session_end'
  | 'conversation_created'
  | 'message_sent'
  | 'tool_invoked'
  | 'tool_error'
  | 'model_used'
  | 'tokens_consumed'
  | 'loop_started'
  | 'loop_completed'
  | 'story_completed'
  | 'story_failed'
  | 'feature_used'
  | 'flag_evaluated'
  | 'error'
  | 'compaction_triggered'
  | 'dream_completed'
  | 'kairos_action'
  | 'swarm_task_completed'
  | 'buddy_interaction';

export interface TelemetryEvent {
  id: string;
  type: TelemetryEventType;
  timestamp: number;
  /** Event-specific payload (no PII) */
  data: Record<string, string | number | boolean>;
  /** Session identifier (random, not user-identifying) */
  sessionId: string;
}

export interface TelemetryDailySummary {
  date: string; // YYYY-MM-DD
  sessionCount: number;
  messageCount: number;
  toolInvocations: number;
  toolErrors: number;
  tokensConsumed: number;
  estimatedCostUsd: number;
  loopsRun: number;
  storiesCompleted: number;
  storiesFailed: number;
  topTools: { tool: string; count: number }[];
  topModels: { model: string; count: number }[];
  featuresUsed: string[];
}

export interface TelemetryConfig {
  /** Enable telemetry collection */
  enabled: boolean;
  /** Days to retain events (0 = forever) */
  retentionDays: number;
  /** Optional export endpoint URL */
  exportEndpoint?: string;
  /** Export interval in minutes (if endpoint configured) */
  exportIntervalMinutes: number;
  /** Event types to collect (empty = all) */
  enabledEvents: TelemetryEventType[];
}

export const DEFAULT_TELEMETRY_CONFIG: TelemetryConfig = {
  enabled: false,
  retentionDays: 30,
  exportIntervalMinutes: 60,
  enabledEvents: [],
};
