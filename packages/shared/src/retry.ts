/**
 * Multi-Turn Retry with Exponential Backoff
 *
 * Structured retry framework for API calls and tool execution.
 * Supports exponential backoff, jitter, circuit breakers, and
 * per-error-type retry policies.
 */

export type RetryableErrorType =
  | 'rate_limit' // 429
  | 'server_error' // 500+
  | 'timeout' // Request timeout
  | 'network' // Connection failed
  | 'overloaded' // 529 overloaded
  | 'auth_expired' // Token expired, refresh needed
  | 'unknown';

export interface RetryPolicy {
  /** Maximum number of retry attempts */
  maxRetries: number;
  /** Initial delay in ms */
  initialDelayMs: number;
  /** Maximum delay in ms (caps exponential growth) */
  maxDelayMs: number;
  /** Backoff multiplier (2 = double each time) */
  backoffMultiplier: number;
  /** Add random jitter (0.0 - 1.0, fraction of delay) */
  jitterFraction: number;
  /** Error types to retry on (empty = all) */
  retryOn: RetryableErrorType[];
  /** Error types to never retry on */
  neverRetryOn: RetryableErrorType[];
}

export interface CircuitBreakerConfig {
  /** Enable circuit breaker */
  enabled: boolean;
  /** Failures before opening circuit */
  failureThreshold: number;
  /** Time in ms before attempting to close circuit */
  resetTimeoutMs: number;
  /** Successes needed in half-open to close circuit */
  successThreshold: number;
}

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerState {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureAt?: number;
  lastSuccessAt?: number;
  openedAt?: number;
}

export interface RetryAttempt {
  attempt: number;
  delayMs: number;
  error?: string;
  errorType?: RetryableErrorType;
  timestamp: number;
  durationMs: number;
}

export interface RetryResult<T> {
  success: boolean;
  data?: T;
  attempts: RetryAttempt[];
  totalDurationMs: number;
  finalError?: string;
  circuitBroken?: boolean;
}

export interface RetryConfig {
  /** Default retry policy */
  default: RetryPolicy;
  /** Per-error-type overrides */
  overrides: Partial<Record<RetryableErrorType, Partial<RetryPolicy>>>;
  /** Circuit breaker configuration */
  circuitBreaker: CircuitBreakerConfig;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitterFraction: 0.25,
  retryOn: ['rate_limit', 'server_error', 'timeout', 'network', 'overloaded'],
  neverRetryOn: [],
};

export const DEFAULT_CIRCUIT_BREAKER: CircuitBreakerConfig = {
  enabled: true,
  failureThreshold: 5,
  resetTimeoutMs: 60000,
  successThreshold: 2,
};

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  default: DEFAULT_RETRY_POLICY,
  overrides: {
    rate_limit: { initialDelayMs: 5000, maxRetries: 5 },
    overloaded: { initialDelayMs: 10000, maxRetries: 3 },
    auth_expired: { maxRetries: 1, initialDelayMs: 0 },
  },
  circuitBreaker: DEFAULT_CIRCUIT_BREAKER,
};

/**
 * Calculate delay for a retry attempt with exponential backoff + jitter.
 */
export function calculateRetryDelay(attempt: number, policy: RetryPolicy): number {
  const exponential = policy.initialDelayMs * Math.pow(policy.backoffMultiplier, attempt);
  const capped = Math.min(exponential, policy.maxDelayMs);
  const jitter = capped * policy.jitterFraction * Math.random();
  return Math.round(capped + jitter);
}

/**
 * Classify an error into a retryable error type.
 */
export function classifyError(error: any): RetryableErrorType {
  if (!error) return 'unknown';

  const status = error.status || error.statusCode || error.code;
  if (status === 429) return 'rate_limit';
  if (status === 529) return 'overloaded';
  if (status === 401 || status === 403) return 'auth_expired';
  if (status >= 500) return 'server_error';

  const msg = String(error.message || error).toLowerCase();
  if (msg.includes('timeout') || msg.includes('timed out')) return 'timeout';
  if (msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('network'))
    return 'network';
  if (msg.includes('rate') && msg.includes('limit')) return 'rate_limit';
  if (msg.includes('overloaded')) return 'overloaded';

  return 'unknown';
}

/**
 * Determine if an error should be retried given a policy.
 */
export function shouldRetry(
  errorType: RetryableErrorType,
  attempt: number,
  policy: RetryPolicy,
): boolean {
  if (attempt >= policy.maxRetries) return false;
  if (policy.neverRetryOn.includes(errorType)) return false;
  if (policy.retryOn.length > 0 && !policy.retryOn.includes(errorType)) return false;
  return true;
}
