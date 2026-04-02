/**
 * Prompt Caching
 *
 * Leverages Claude API's cache_control markers to cache stable
 * prompt segments (system prompt, tool definitions, conversation prefix).
 */

export interface CacheBreakpoint {
  /** Where in the prompt this breakpoint is */
  position: 'system_prompt' | 'tool_definitions' | 'conversation_prefix' | 'custom';
  /** Cache control type */
  type: 'ephemeral';
  /** Approximate token count of the cached segment */
  estimatedTokens: number;
}

export interface CacheStats {
  /** Total API calls made */
  totalCalls: number;
  /** Calls that hit the cache */
  cacheHits: number;
  /** Calls that missed the cache */
  cacheMisses: number;
  /** Hit rate (0.0 - 1.0) */
  hitRate: number;
  /** Estimated tokens saved from caching */
  tokensSaved: number;
  /** Estimated cost saved in USD */
  costSavedUsd: number;
  /** Cache creation tokens (write cost) */
  cacheCreationTokens: number;
  /** Cache read tokens (read cost) */
  cacheReadTokens: number;
}

export interface CacheConfig {
  /** Enable prompt caching */
  enabled: boolean;
  /** Cache the system prompt */
  cacheSystemPrompt: boolean;
  /** Cache tool definitions */
  cacheToolDefinitions: boolean;
  /** Cache conversation prefix (older messages) */
  cacheConversationPrefix: boolean;
  /** Minimum tokens before enabling prefix caching (too small = not worth it) */
  minPrefixTokens: number;
}

export const DEFAULT_CACHE_CONFIG: CacheConfig = {
  enabled: true,
  cacheSystemPrompt: true,
  cacheToolDefinitions: true,
  cacheConversationPrefix: true,
  minPrefixTokens: 1024,
};

// Claude API cache pricing (per million tokens)
export const CACHE_PRICING = {
  'claude-opus-4-6': { write: 18.75, read: 1.5 }, // 1.25x input write, 0.1x input read
  'claude-sonnet-4-6': { write: 3.75, read: 0.3 },
  'claude-haiku-4-5-20251001': { write: 1.0, read: 0.08 },
} as Record<string, { write: number; read: number }>;

/**
 * Calculate cost savings from cache stats.
 */
export function calculateCacheSavings(
  stats: Pick<CacheStats, 'cacheCreationTokens' | 'cacheReadTokens' | 'tokensSaved'>,
  model: string,
): number {
  const pricing = CACHE_PRICING[model];
  if (!pricing) return 0;

  const writeCost = (stats.cacheCreationTokens / 1_000_000) * pricing.write;
  const readCost = (stats.cacheReadTokens / 1_000_000) * pricing.read;
  // What it would have cost without caching (full input price)
  const inputPrice = model.includes('opus') ? 15.0 : model.includes('haiku') ? 0.8 : 3.0;
  const wouldHaveCost = (stats.tokensSaved / 1_000_000) * inputPrice;

  return wouldHaveCost - writeCost - readCost;
}
