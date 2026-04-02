/**
 * Context Compaction Engine
 *
 * Smart context compression for LLM conversations. Goes beyond simple
 * truncation with strategies for summarization, deduplication, and
 * priority-based retention.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type CompactionStrategy =
  | 'summarize' // LLM-based summarization of older messages
  | 'sliding_window' // Keep N most recent messages verbatim
  | 'priority' // Keep messages tagged as important
  | 'hybrid'; // Summarize old + keep recent + retain pinned

export type CompactionTrigger =
  | 'threshold' // Context window percentage reached
  | 'manual' // User-initiated
  | 'turn_count' // After N turns
  | 'token_budget'; // Approaching token limit

export interface CompactionRule {
  /** Messages older than N turns get summarized */
  summarizeAfterTurns: number;
  /** Always keep the system prompt */
  retainSystemPrompt: boolean;
  /** Always keep messages containing tool results with errors */
  retainErrors: boolean;
  /** Always keep messages the user pinned */
  retainPinned: boolean;
  /** Keep the last N user-assistant turn pairs verbatim */
  keepRecentTurns: number;
  /** Maximum summary length in tokens (approximate) */
  maxSummaryTokens: number;
}

export interface CompactionResult {
  id: string;
  conversationId: string;
  strategy: CompactionStrategy;
  trigger: CompactionTrigger;
  timestamp: number;
  /** Messages before compaction */
  messagesBefore: number;
  /** Messages after compaction */
  messagesAfter: number;
  /** Estimated tokens before */
  tokensBefore: number;
  /** Estimated tokens after */
  tokensAfter: number;
  /** Compression ratio (0.0 - 1.0, lower = more compressed) */
  compressionRatio: number;
  /** The generated summary (if strategy involves summarization) */
  summary?: string;
  /** IDs of messages that were compacted away */
  droppedMessageIds: string[];
  /** IDs of messages retained verbatim */
  retainedMessageIds: string[];
}

export interface CompactionConfig {
  /** Whether auto-compaction is enabled */
  enabled: boolean;
  /** Default strategy */
  strategy: CompactionStrategy;
  /** Context window usage threshold to trigger (0.0 - 1.0) */
  threshold: number;
  /** Rules for what to retain */
  rules: CompactionRule;
  /** Model for summarization (use a fast/cheap model) */
  summaryModel: string;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_COMPACTION_RULES: CompactionRule = {
  summarizeAfterTurns: 10,
  retainSystemPrompt: true,
  retainErrors: true,
  retainPinned: true,
  keepRecentTurns: 5,
  maxSummaryTokens: 500,
};

export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  enabled: true,
  strategy: 'hybrid',
  threshold: 0.75,
  rules: DEFAULT_COMPACTION_RULES,
  summaryModel: 'claude-haiku-4-5-20251001',
};

// ─── Token Estimation ────────────────────────────────────────────────────────

/**
 * Rough token count estimate. ~4 chars per token for English.
 * Good enough for threshold detection; exact counts come from the API.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Calculate context window usage as a ratio.
 */
export function contextUsageRatio(currentTokens: number, maxTokens: number): number {
  if (maxTokens <= 0) return 0;
  return Math.min(1.0, currentTokens / maxTokens);
}
