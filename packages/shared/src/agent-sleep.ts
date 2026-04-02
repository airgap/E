/**
 * Agent Sleep / Self-Resume
 *
 * Allows agents to persist state and resume execution on events.
 * Agents can "sleep" between actions instead of busy-waiting.
 */

export type SleepState = 'sleeping' | 'resumed' | 'expired' | 'cancelled';

export type SleepTrigger =
  | 'timer' // Wake after N seconds
  | 'file_change' // Wake when files change
  | 'webhook' // Wake on inbound webhook
  | 'git_push' // Wake on git push/pull
  | 'schedule' // Wake at a specific time
  | 'manual'; // Wake by user action

export interface SleepWakeCondition {
  trigger: SleepTrigger;
  /** Timer: seconds to sleep */
  delaySeconds?: number;
  /** File change: glob patterns to watch */
  watchPatterns?: string[];
  /** Schedule: ISO 8601 timestamp to wake at */
  wakeAt?: string;
  /** Webhook: expected webhook name/id */
  webhookId?: string;
}

export interface AgentCheckpoint {
  id: string;
  agentId: string;
  conversationId?: string;
  /** Serialized agent context (messages, current task, etc.) */
  stateJson: string;
  /** What should wake this agent */
  wakeCondition: SleepWakeCondition;
  state: SleepState;
  createdAt: number;
  expiresAt: number;
  resumedAt?: number;
  /** Workspace this agent was working in */
  workspacePath: string;
  /** Why the agent went to sleep */
  reason?: string;
}

export interface SleepConfig {
  /** Default expiry for sleeping agents (hours) */
  defaultExpiryHours: number;
  /** Maximum number of concurrent sleeping agents */
  maxSleepingAgents: number;
  /** Auto-expire check interval (minutes) */
  expiryCheckIntervalMinutes: number;
}

export const DEFAULT_SLEEP_CONFIG: SleepConfig = {
  defaultExpiryHours: 24,
  maxSleepingAgents: 10,
  expiryCheckIntervalMinutes: 5,
};

export interface StreamSleepEvent {
  type: 'sleep_event';
  checkpointId: string;
  event: 'sleeping' | 'waking' | 'resumed' | 'expired' | 'cancelled';
  data: {
    agentId?: string;
    trigger?: SleepTrigger;
    reason?: string;
  };
}
