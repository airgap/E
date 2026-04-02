/**
 * Multi-Provider Fallback Chains
 *
 * Automatically failover between providers when one is down.
 * Supports Anthropic → Bedrock → OpenAI → Ollama chains.
 */

export type ProviderName = 'anthropic' | 'bedrock' | 'openai' | 'google' | 'ollama' | 'custom';

export type ProviderStatus = 'healthy' | 'degraded' | 'down' | 'unknown';

export interface ProviderHealth {
  provider: ProviderName;
  status: ProviderStatus;
  latencyMs?: number;
  lastChecked: number;
  consecutiveFailures: number;
  lastError?: string;
}

export interface FallbackChainLink {
  provider: ProviderName;
  model: string;
  /** Max retries before moving to next provider */
  maxRetries: number;
  /** Only use this provider for these complexity tiers */
  tiers?: ('simple' | 'medium' | 'complex')[];
}

export interface FallbackChainConfig {
  /** Enable automatic fallback */
  enabled: boolean;
  /** Ordered list of providers to try */
  chain: FallbackChainLink[];
  /** Health check interval (seconds) */
  healthCheckIntervalSeconds: number;
  /** Consecutive failures before marking provider as down */
  failureThreshold: number;
  /** Seconds to wait before retrying a down provider */
  cooldownSeconds: number;
  /** Timeout per provider attempt (ms) */
  timeoutMs: number;
}

export const DEFAULT_FALLBACK_CHAIN_CONFIG: FallbackChainConfig = {
  enabled: false,
  chain: [
    { provider: 'anthropic', model: 'claude-sonnet-4-6', maxRetries: 2 },
    { provider: 'bedrock', model: 'anthropic.claude-sonnet-4-6', maxRetries: 1 },
    { provider: 'openai', model: 'gpt-4o', maxRetries: 1 },
  ],
  healthCheckIntervalSeconds: 60,
  failureThreshold: 3,
  cooldownSeconds: 120,
  timeoutMs: 30000,
};

export interface FallbackAttempt {
  provider: ProviderName;
  model: string;
  attempt: number;
  success: boolean;
  latencyMs: number;
  error?: string;
  timestamp: number;
}

export interface FallbackResult {
  /** Which provider ultimately handled the request */
  provider: ProviderName;
  model: string;
  /** All attempts made */
  attempts: FallbackAttempt[];
  /** Total time including all retries */
  totalLatencyMs: number;
  /** Whether a fallback was needed */
  fellBack: boolean;
}

export interface StreamFallbackEvent {
  type: 'fallback_event';
  event: 'attempt' | 'fallback' | 'exhausted' | 'health_check';
  data: {
    provider: ProviderName;
    model?: string;
    error?: string;
    status?: ProviderStatus;
    attempt?: number;
  };
}
