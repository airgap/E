/**
 * Retry Executor Service
 *
 * Executes async operations with structured retry, exponential backoff,
 * jitter, and circuit breaker protection.
 */

import type {
  RetryConfig,
  RetryPolicy,
  RetryResult,
  RetryAttempt,
  RetryableErrorType,
  CircuitBreakerState,
} from '@e/shared';
import { DEFAULT_RETRY_CONFIG, calculateRetryDelay, classifyError, shouldRetry } from '@e/shared';

class RetryExecutorService {
  private static instance: RetryExecutorService;
  private config: RetryConfig = { ...DEFAULT_RETRY_CONFIG };
  private circuits = new Map<string, CircuitBreakerState>();

  static getInstance(): RetryExecutorService {
    if (!RetryExecutorService.instance) {
      RetryExecutorService.instance = new RetryExecutorService();
    }
    return RetryExecutorService.instance;
  }

  setConfig(config: Partial<RetryConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): RetryConfig {
    return { ...this.config };
  }

  /**
   * Execute an async function with retry logic.
   * @param key Circuit breaker key (e.g., 'anthropic-api')
   * @param fn The function to execute
   * @param policyOverride Override the default policy
   */
  async execute<T>(
    key: string,
    fn: () => Promise<T>,
    policyOverride?: Partial<RetryPolicy>,
  ): Promise<RetryResult<T>> {
    const policy = { ...this.config.default, ...policyOverride };
    const attempts: RetryAttempt[] = [];
    const startTime = Date.now();

    // Check circuit breaker
    if (this.config.circuitBreaker.enabled) {
      const circuit = this.getCircuit(key);
      if (circuit.state === 'open') {
        const elapsed = Date.now() - (circuit.openedAt || 0);
        if (elapsed < this.config.circuitBreaker.resetTimeoutMs) {
          return {
            success: false,
            attempts,
            totalDurationMs: Date.now() - startTime,
            finalError: 'Circuit breaker is open',
            circuitBroken: true,
          };
        }
        // Transition to half-open
        circuit.state = 'half_open';
        circuit.successes = 0;
      }
    }

    let lastError: string | undefined;

    for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
      // Wait before retry (skip first attempt)
      if (attempt > 0) {
        const errorType = lastError ? classifyError({ message: lastError }) : 'unknown';
        const override = this.config.overrides[errorType];
        const effectivePolicy = override ? { ...policy, ...override } : policy;
        const delay = calculateRetryDelay(attempt - 1, effectivePolicy);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      const attemptStart = Date.now();

      try {
        const data = await fn();

        const retryAttempt: RetryAttempt = {
          attempt,
          delayMs: attempt > 0 ? attemptStart - startTime : 0,
          timestamp: attemptStart,
          durationMs: Date.now() - attemptStart,
        };
        attempts.push(retryAttempt);

        // Circuit breaker success
        if (this.config.circuitBreaker.enabled) {
          this.recordCircuitSuccess(key);
        }

        return {
          success: true,
          data,
          attempts,
          totalDurationMs: Date.now() - startTime,
        };
      } catch (err: any) {
        const errorType = classifyError(err);
        lastError = err.message || String(err);

        const retryAttempt: RetryAttempt = {
          attempt,
          delayMs: attempt > 0 ? attemptStart - startTime : 0,
          error: lastError,
          errorType,
          timestamp: attemptStart,
          durationMs: Date.now() - attemptStart,
        };
        attempts.push(retryAttempt);

        // Check if we should retry
        if (!shouldRetry(errorType, attempt, policy)) {
          break;
        }
      }
    }

    // All retries exhausted
    if (this.config.circuitBreaker.enabled) {
      this.recordCircuitFailure(key);
    }

    return {
      success: false,
      attempts,
      totalDurationMs: Date.now() - startTime,
      finalError: lastError,
    };
  }

  /**
   * Get circuit breaker state for a key.
   */
  getCircuitState(key: string): CircuitBreakerState {
    return this.getCircuit(key);
  }

  /**
   * Reset a circuit breaker.
   */
  resetCircuit(key: string): void {
    this.circuits.delete(key);
  }

  /**
   * Get all circuit states.
   */
  getAllCircuits(): Record<string, CircuitBreakerState> {
    const result: Record<string, CircuitBreakerState> = {};
    for (const [key, state] of this.circuits) {
      result[key] = state;
    }
    return result;
  }

  private getCircuit(key: string): CircuitBreakerState {
    if (!this.circuits.has(key)) {
      this.circuits.set(key, { state: 'closed', failures: 0, successes: 0 });
    }
    return this.circuits.get(key)!;
  }

  private recordCircuitSuccess(key: string): void {
    const circuit = this.getCircuit(key);
    circuit.lastSuccessAt = Date.now();
    circuit.failures = 0;

    if (circuit.state === 'half_open') {
      circuit.successes++;
      if (circuit.successes >= this.config.circuitBreaker.successThreshold) {
        circuit.state = 'closed';
      }
    }
  }

  private recordCircuitFailure(key: string): void {
    const circuit = this.getCircuit(key);
    circuit.failures++;
    circuit.lastFailureAt = Date.now();

    if (circuit.failures >= this.config.circuitBreaker.failureThreshold) {
      circuit.state = 'open';
      circuit.openedAt = Date.now();
    }
  }
}

export const retryExecutor = RetryExecutorService.getInstance();
