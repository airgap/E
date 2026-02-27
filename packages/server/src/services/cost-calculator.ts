/**
 * Simple pricing table for Claude models (per million tokens).
 * Prices as of early 2026.
 *
 * Bedrock pricing is the same as direct Anthropic API for on-demand usage.
 * Bedrock models are prefixed with "bedrock:" in the model name.
 */
const PRICING: Record<string, { input: number; output: number }> = {
  // Direct Anthropic API models
  'claude-opus-4-6': { input: 15.0, output: 75.0 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-sonnet-4-5-20250929': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4.0 },

  // AWS Bedrock models (prefixed with "bedrock:")
  'bedrock:claude-opus-4': { input: 15.0, output: 75.0 },
  'bedrock:claude-sonnet-4': { input: 3.0, output: 15.0 },
  'bedrock:claude-sonnet-3.5': { input: 3.0, output: 15.0 },
  'bedrock:claude-haiku-3': { input: 0.25, output: 1.25 },

  // Bedrock full model IDs
  'bedrock:anthropic.claude-3-opus-20240229-v1:0': { input: 15.0, output: 75.0 },
  'bedrock:anthropic.claude-3-5-sonnet-20241022-v2:0': { input: 3.0, output: 15.0 },
  'bedrock:anthropic.claude-3-haiku-20240307-v1:0': { input: 0.25, output: 1.25 },
};

// Fallback for unrecognized models — use Sonnet pricing
const DEFAULT_PRICING = { input: 3.0, output: 15.0 };

export function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  // Ollama models are local — free
  if (model.startsWith('ollama:')) return 0;
  const pricing = PRICING[model] || DEFAULT_PRICING;
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

export function getModelPricing(model: string): { input: number; output: number } {
  return PRICING[model] || DEFAULT_PRICING;
}
