/**
 * Model Router Service
 *
 * Analyzes task complexity and auto-routes to the cheapest sufficient model.
 */

import type { ComplexitySignal, ModelRouterConfig } from '@e/shared';
import { analyzeComplexity, DEFAULT_MODEL_ROUTER_CONFIG } from '@e/shared';

class ModelRouterService {
  private static instance: ModelRouterService;
  private config: ModelRouterConfig = { ...DEFAULT_MODEL_ROUTER_CONFIG };
  private routingHistory: Array<{ input: string; signal: ComplexitySignal; timestamp: number }> =
    [];

  static getInstance(): ModelRouterService {
    if (!ModelRouterService.instance) {
      ModelRouterService.instance = new ModelRouterService();
    }
    return ModelRouterService.instance;
  }

  setConfig(config: Partial<ModelRouterConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): ModelRouterConfig {
    return { ...this.config };
  }

  /**
   * Route a user message to the best model.
   * Returns the original model if routing is disabled or confidence is low.
   */
  route(input: string, currentModel?: string): ComplexitySignal {
    // Skip routing for non-Anthropic providers — they use a single model
    const isNonAnthropic =
      currentModel?.startsWith('ollama:') ||
      currentModel?.startsWith('openai:') ||
      currentModel?.startsWith('gemini:');

    if (!this.config.enabled || this.config.forceModel || isNonAnthropic) {
      return {
        complexity: 'medium',
        confidence: 1,
        signals: isNonAnthropic ? ['non_anthropic_provider'] : ['forced'],
        recommendedModel: this.config.forceModel || currentModel || this.config.models.sonnet,
        tier: 'sonnet',
      };
    }

    const signal = analyzeComplexity(input, this.config);

    // Track for analytics
    this.routingHistory.push({
      input: input.slice(0, 200),
      signal,
      timestamp: Date.now(),
    });
    if (this.routingHistory.length > 100) {
      this.routingHistory = this.routingHistory.slice(-50);
    }

    return signal;
  }

  /**
   * Get routing statistics.
   */
  getStats(): {
    total: number;
    byTier: Record<string, number>;
    byComplexity: Record<string, number>;
  } {
    const byTier: Record<string, number> = {};
    const byComplexity: Record<string, number> = {};

    for (const entry of this.routingHistory) {
      byTier[entry.signal.tier] = (byTier[entry.signal.tier] || 0) + 1;
      byComplexity[entry.signal.complexity] = (byComplexity[entry.signal.complexity] || 0) + 1;
    }

    return { total: this.routingHistory.length, byTier, byComplexity };
  }
}

export const modelRouter = ModelRouterService.getInstance();
