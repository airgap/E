/**
 * Multi-Provider Fallback Service
 *
 * Tracks provider health and automatically falls back through
 * a configured chain when a provider fails.
 */

import { EventEmitter } from 'events';
import type {
  ProviderName,
  ProviderHealth,
  FallbackChainConfig,
  FallbackAttempt,
  FallbackResult,
  StreamFallbackEvent,
} from '@e/shared';
import { DEFAULT_FALLBACK_CHAIN_CONFIG } from '@e/shared';

class ProviderFallbackService extends EventEmitter {
  private static instance: ProviderFallbackService;
  private config: FallbackChainConfig = { ...DEFAULT_FALLBACK_CHAIN_CONFIG };
  private health = new Map<ProviderName, ProviderHealth>();
  private healthCheckInterval?: ReturnType<typeof setInterval>;

  static getInstance(): ProviderFallbackService {
    if (!ProviderFallbackService.instance) {
      ProviderFallbackService.instance = new ProviderFallbackService();
    }
    return ProviderFallbackService.instance;
  }

  setConfig(config: Partial<FallbackChainConfig>): void {
    this.config = { ...this.config, ...config };
    if (this.config.enabled) this.startHealthChecks();
    else this.stopHealthChecks();
  }

  getConfig(): FallbackChainConfig {
    return { ...this.config };
  }

  /**
   * Record a provider success.
   */
  recordSuccess(provider: ProviderName, latencyMs: number): void {
    const h = this.getHealth(provider);
    h.status = 'healthy';
    h.latencyMs = latencyMs;
    h.lastChecked = Date.now();
    h.consecutiveFailures = 0;
    this.health.set(provider, h);
  }

  /**
   * Record a provider failure.
   */
  recordFailure(provider: ProviderName, error: string): void {
    const h = this.getHealth(provider);
    h.consecutiveFailures++;
    h.lastError = error;
    h.lastChecked = Date.now();

    if (h.consecutiveFailures >= this.config.failureThreshold) {
      h.status = 'down';
    } else {
      h.status = 'degraded';
    }
    this.health.set(provider, h);

    this.emitEvent('health_check', { provider, status: h.status });
  }

  /**
   * Get the next available provider from the chain.
   * Skips providers that are down and within their cooldown period.
   */
  getNextProvider(startIdx = 0): { provider: ProviderName; model: string; index: number } | null {
    if (!this.config.enabled) {
      const first = this.config.chain[0];
      return first ? { provider: first.provider, model: first.model, index: 0 } : null;
    }

    for (let i = startIdx; i < this.config.chain.length; i++) {
      const link = this.config.chain[i];
      const h = this.getHealth(link.provider);

      if (h.status === 'down') {
        // Check cooldown
        const elapsed = Date.now() - h.lastChecked;
        if (elapsed < this.config.cooldownSeconds * 1000) continue;
        // Cooldown expired — allow retry
        h.status = 'unknown';
        this.health.set(link.provider, h);
      }

      return { provider: link.provider, model: link.model, index: i };
    }

    return null;
  }

  /**
   * Execute a request with automatic fallback.
   */
  async executeWithFallback<T>(
    fn: (provider: ProviderName, model: string) => Promise<T>,
  ): Promise<FallbackResult & { data?: T }> {
    const attempts: FallbackAttempt[] = [];
    const startTime = Date.now();
    let currentIdx = 0;

    while (currentIdx < this.config.chain.length) {
      const next = this.getNextProvider(currentIdx);
      if (!next) break;

      const link = this.config.chain[next.index];
      let retryCount = 0;

      while (retryCount <= link.maxRetries) {
        const attemptStart = Date.now();
        try {
          const data = await fn(next.provider, next.model);

          const attempt: FallbackAttempt = {
            provider: next.provider,
            model: next.model,
            attempt: retryCount,
            success: true,
            latencyMs: Date.now() - attemptStart,
            timestamp: attemptStart,
          };
          attempts.push(attempt);
          this.recordSuccess(next.provider, attempt.latencyMs);

          return {
            provider: next.provider,
            model: next.model,
            attempts,
            totalLatencyMs: Date.now() - startTime,
            fellBack: next.index > 0,
            data,
          };
        } catch (err: any) {
          const attempt: FallbackAttempt = {
            provider: next.provider,
            model: next.model,
            attempt: retryCount,
            success: false,
            latencyMs: Date.now() - attemptStart,
            error: err.message,
            timestamp: attemptStart,
          };
          attempts.push(attempt);
          retryCount++;
        }
      }

      // All retries exhausted for this provider
      this.recordFailure(next.provider, attempts[attempts.length - 1]?.error || 'unknown');
      this.emitEvent('fallback', { provider: next.provider, error: 'exhausted retries' });
      currentIdx = next.index + 1;
    }

    // All providers exhausted
    this.emitEvent('exhausted', { provider: 'anthropic' as ProviderName });
    return {
      provider: this.config.chain[0]?.provider || 'anthropic',
      model: this.config.chain[0]?.model || 'unknown',
      attempts,
      totalLatencyMs: Date.now() - startTime,
      fellBack: true,
    };
  }

  /**
   * Get health status for all providers.
   */
  getAllHealth(): ProviderHealth[] {
    return this.config.chain.map((link) => this.getHealth(link.provider));
  }

  private getHealth(provider: ProviderName): ProviderHealth {
    return (
      this.health.get(provider) || {
        provider,
        status: 'unknown',
        lastChecked: 0,
        consecutiveFailures: 0,
      }
    );
  }

  private startHealthChecks(): void {
    this.stopHealthChecks();
    this.healthCheckInterval = setInterval(() => {
      // Passive health check — status decays over time if no requests
      for (const link of this.config.chain) {
        const h = this.getHealth(link.provider);
        if (h.status === 'down') {
          const elapsed = Date.now() - h.lastChecked;
          if (elapsed > this.config.cooldownSeconds * 1000) {
            h.status = 'unknown';
            this.health.set(link.provider, h);
          }
        }
      }
    }, this.config.healthCheckIntervalSeconds * 1000);
  }

  private stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }
  }

  private emitEvent(
    event: StreamFallbackEvent['event'],
    data: Partial<StreamFallbackEvent['data']>,
  ): void {
    this.emit('fallback_event', { type: 'fallback_event', event, data });
  }
}

export const providerFallback = ProviderFallbackService.getInstance();
