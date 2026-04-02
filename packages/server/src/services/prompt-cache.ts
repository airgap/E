/**
 * Prompt Cache Manager
 *
 * Tracks Claude API prompt caching statistics and manages
 * cache_control breakpoint placement for optimal cache hits.
 */

import { nanoid } from 'nanoid';
import { getDb } from '../db/database';
import type { CacheStats, CacheConfig } from '@e/shared';
import { DEFAULT_CACHE_CONFIG, calculateCacheSavings } from '@e/shared';

class PromptCacheService {
  private static instance: PromptCacheService;
  private config: CacheConfig = { ...DEFAULT_CACHE_CONFIG };

  static getInstance(): PromptCacheService {
    if (!PromptCacheService.instance) {
      PromptCacheService.instance = new PromptCacheService();
    }
    return PromptCacheService.instance;
  }

  setConfig(config: Partial<CacheConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): CacheConfig {
    return { ...this.config };
  }

  /**
   * Record a cache event (hit or miss) for a conversation.
   */
  recordCacheEvent(
    conversationId: string,
    model: string,
    hit: boolean,
    cacheCreationTokens: number,
    cacheReadTokens: number,
    tokensSaved: number,
  ): void {
    const db = getDb();
    const existing = db
      .query('SELECT * FROM prompt_cache_stats WHERE conversation_id = ?')
      .get(conversationId) as any;

    if (existing) {
      db.query(
        `UPDATE prompt_cache_stats
         SET total_calls = total_calls + 1,
             cache_hits = cache_hits + ?,
             cache_misses = cache_misses + ?,
             cache_creation_tokens = cache_creation_tokens + ?,
             cache_read_tokens = cache_read_tokens + ?,
             tokens_saved = tokens_saved + ?,
             updated_at = ?
         WHERE conversation_id = ?`,
      ).run(
        hit ? 1 : 0,
        hit ? 0 : 1,
        cacheCreationTokens,
        cacheReadTokens,
        tokensSaved,
        Date.now(),
        conversationId,
      );
    } else {
      db.query(
        `INSERT INTO prompt_cache_stats (id, conversation_id, model, total_calls, cache_hits, cache_misses,
         cache_creation_tokens, cache_read_tokens, tokens_saved, cost_saved_usd, updated_at)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, 0, ?)`,
      ).run(
        nanoid(12),
        conversationId,
        model,
        hit ? 1 : 0,
        hit ? 0 : 1,
        cacheCreationTokens,
        cacheReadTokens,
        tokensSaved,
        Date.now(),
      );
    }
  }

  /**
   * Get cache stats for a conversation.
   */
  getStats(conversationId: string): CacheStats | null {
    const db = getDb();
    const row = db
      .query('SELECT * FROM prompt_cache_stats WHERE conversation_id = ?')
      .get(conversationId) as any;
    if (!row) return null;

    const totalCalls = row.total_calls;
    const cacheHits = row.cache_hits;
    return {
      totalCalls,
      cacheHits,
      cacheMisses: row.cache_misses,
      hitRate: totalCalls > 0 ? cacheHits / totalCalls : 0,
      tokensSaved: row.tokens_saved,
      costSavedUsd: calculateCacheSavings(
        {
          cacheCreationTokens: row.cache_creation_tokens,
          cacheReadTokens: row.cache_read_tokens,
          tokensSaved: row.tokens_saved,
        },
        row.model,
      ),
      cacheCreationTokens: row.cache_creation_tokens,
      cacheReadTokens: row.cache_read_tokens,
    };
  }

  /**
   * Get aggregate stats across all conversations.
   */
  getAggregateStats(): CacheStats {
    const db = getDb();
    const row = db
      .query(
        `SELECT
          SUM(total_calls) as total_calls,
          SUM(cache_hits) as cache_hits,
          SUM(cache_misses) as cache_misses,
          SUM(tokens_saved) as tokens_saved,
          SUM(cache_creation_tokens) as cache_creation_tokens,
          SUM(cache_read_tokens) as cache_read_tokens
        FROM prompt_cache_stats`,
      )
      .get() as any;

    const totalCalls = row?.total_calls || 0;
    const cacheHits = row?.cache_hits || 0;
    return {
      totalCalls,
      cacheHits,
      cacheMisses: row?.cache_misses || 0,
      hitRate: totalCalls > 0 ? cacheHits / totalCalls : 0,
      tokensSaved: row?.tokens_saved || 0,
      costSavedUsd: row?.cost_saved_usd || 0,
      cacheCreationTokens: row?.cache_creation_tokens || 0,
      cacheReadTokens: row?.cache_read_tokens || 0,
    };
  }

  /**
   * Determine which cache breakpoints to apply based on config and token counts.
   */
  getCacheBreakpoints(
    systemPromptTokens: number,
    toolDefinitionTokens: number,
    conversationPrefixTokens: number,
  ): Array<{ position: string; type: 'ephemeral' }> {
    const breakpoints: Array<{ position: string; type: 'ephemeral' }> = [];

    if (this.config.cacheSystemPrompt && systemPromptTokens > 0) {
      breakpoints.push({ position: 'system_prompt', type: 'ephemeral' });
    }
    if (this.config.cacheToolDefinitions && toolDefinitionTokens > 0) {
      breakpoints.push({ position: 'tool_definitions', type: 'ephemeral' });
    }
    if (
      this.config.cacheConversationPrefix &&
      conversationPrefixTokens >= this.config.minPrefixTokens
    ) {
      breakpoints.push({ position: 'conversation_prefix', type: 'ephemeral' });
    }

    return breakpoints;
  }
}

export const promptCache = PromptCacheService.getInstance();
