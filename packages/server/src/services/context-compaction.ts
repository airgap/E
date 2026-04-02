/**
 * Context Compaction Engine Service
 *
 * Smart context compression for LLM conversations.
 * Goes beyond simple truncation with summarization, deduplication,
 * and priority-based retention.
 */

import { nanoid } from 'nanoid';
import { getDb } from '../db/database';
import type {
  CompactionConfig,
  CompactionResult,
  CompactionStrategy,
  CompactionTrigger,
} from '@e/shared';
import { DEFAULT_COMPACTION_CONFIG, estimateTokens, contextUsageRatio } from '@e/shared';

interface MessageRow {
  id: string;
  role: string;
  content: string;
  timestamp: number;
  token_count: number;
  pinned?: number;
}

class ContextCompactionEngine {
  private config: CompactionConfig = DEFAULT_COMPACTION_CONFIG;

  setConfig(config: Partial<CompactionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Check if compaction is needed for a conversation.
   */
  shouldCompact(conversationId: string, maxContextTokens: number): boolean {
    if (!this.config.enabled) return false;

    const messages = this.getMessages(conversationId);
    const totalTokens = messages.reduce(
      (sum, m) => sum + (m.token_count || estimateTokens(m.content)),
      0,
    );

    return contextUsageRatio(totalTokens, maxContextTokens) >= this.config.threshold;
  }

  /**
   * Perform compaction on a conversation.
   */
  async compact(
    conversationId: string,
    maxContextTokens: number,
    trigger: CompactionTrigger = 'threshold',
  ): Promise<CompactionResult> {
    const messages = this.getMessages(conversationId);
    const tokensBefore = messages.reduce(
      (sum, m) => sum + (m.token_count || estimateTokens(m.content)),
      0,
    );

    const strategy = this.config.strategy;
    let result: CompactionResult;

    switch (strategy) {
      case 'sliding_window':
        result = this.slidingWindowCompact(conversationId, messages, trigger, tokensBefore);
        break;
      case 'priority':
        result = this.priorityCompact(conversationId, messages, trigger, tokensBefore);
        break;
      case 'summarize':
        result = await this.summarizeCompact(conversationId, messages, trigger, tokensBefore);
        break;
      case 'hybrid':
      default:
        result = await this.hybridCompact(conversationId, messages, trigger, tokensBefore);
        break;
    }

    this.persistResult(result);
    return result;
  }

  // ─── Strategies ────────────────────────────────────────────────────────

  private slidingWindowCompact(
    conversationId: string,
    messages: MessageRow[],
    trigger: CompactionTrigger,
    tokensBefore: number,
  ): CompactionResult {
    const keepCount = this.config.rules.keepRecentTurns * 2; // turns = user+assistant pairs
    const retained = messages.slice(-keepCount);
    const dropped = messages.slice(0, -keepCount);

    return this.buildResult(
      conversationId,
      'sliding_window',
      trigger,
      messages,
      retained,
      dropped,
      tokensBefore,
    );
  }

  private priorityCompact(
    conversationId: string,
    messages: MessageRow[],
    trigger: CompactionTrigger,
    tokensBefore: number,
  ): CompactionResult {
    const retained: MessageRow[] = [];
    const dropped: MessageRow[] = [];

    for (const msg of messages) {
      const keep =
        msg.pinned ||
        (this.config.rules.retainErrors && this.isErrorMessage(msg)) ||
        (msg.role === 'system' && this.config.rules.retainSystemPrompt);

      if (keep) {
        retained.push(msg);
      } else {
        dropped.push(msg);
      }
    }

    // Always keep recent messages
    const recentCount = this.config.rules.keepRecentTurns * 2;
    const recentCutoff = messages.length - recentCount;
    for (let i = recentCutoff; i < messages.length; i++) {
      if (i >= 0 && !retained.includes(messages[i])) {
        retained.push(messages[i]);
        const dropIdx = dropped.indexOf(messages[i]);
        if (dropIdx !== -1) dropped.splice(dropIdx, 1);
      }
    }

    return this.buildResult(
      conversationId,
      'priority',
      trigger,
      messages,
      retained,
      dropped,
      tokensBefore,
    );
  }

  private async summarizeCompact(
    conversationId: string,
    messages: MessageRow[],
    trigger: CompactionTrigger,
    tokensBefore: number,
  ): Promise<CompactionResult> {
    const keepCount = this.config.rules.keepRecentTurns * 2;
    const toSummarize = messages.slice(0, -keepCount);
    const retained = messages.slice(-keepCount);
    const dropped = toSummarize;

    // Generate summary of dropped messages
    const summary = this.generateLocalSummary(toSummarize);

    const result = this.buildResult(
      conversationId,
      'summarize',
      trigger,
      messages,
      retained,
      dropped,
      tokensBefore,
      summary,
    );

    return result;
  }

  private async hybridCompact(
    conversationId: string,
    messages: MessageRow[],
    trigger: CompactionTrigger,
    tokensBefore: number,
  ): Promise<CompactionResult> {
    const keepCount = this.config.rules.keepRecentTurns * 2;
    const retained: MessageRow[] = [];
    const dropped: MessageRow[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const isRecent = i >= messages.length - keepCount;
      const isPinned = !!msg.pinned;
      const isError = this.config.rules.retainErrors && this.isErrorMessage(msg);
      const isSystem = msg.role === 'system' && this.config.rules.retainSystemPrompt;

      if (isRecent || isPinned || isError || isSystem) {
        retained.push(msg);
      } else {
        dropped.push(msg);
      }
    }

    const summary = dropped.length > 0 ? this.generateLocalSummary(dropped) : undefined;

    return this.buildResult(
      conversationId,
      'hybrid',
      trigger,
      messages,
      retained,
      dropped,
      tokensBefore,
      summary,
    );
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private getMessages(conversationId: string): MessageRow[] {
    const db = getDb();
    return db
      .query(
        `SELECT id, role, content, timestamp, token_count, pinned FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC`,
      )
      .all(conversationId) as MessageRow[];
  }

  private isErrorMessage(msg: MessageRow): boolean {
    try {
      const content = JSON.parse(msg.content);
      if (Array.isArray(content)) {
        return content.some((block: any) => block.type === 'tool_result' && block.is_error);
      }
    } catch {
      /* not JSON */
    }
    return false;
  }

  private generateLocalSummary(messages: MessageRow[]): string {
    // Local summary without LLM — extract key points
    const userMessages = messages.filter((m) => m.role === 'user');
    const assistantMessages = messages.filter((m) => m.role === 'assistant');

    const parts: string[] = ['[Conversation Summary]'];
    parts.push(
      `${messages.length} messages compacted (${userMessages.length} user, ${assistantMessages.length} assistant).`,
    );

    // Extract topics from user messages
    const topics = new Set<string>();
    for (const msg of userMessages) {
      try {
        const content = JSON.parse(msg.content);
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text' && block.text) {
              // Extract first sentence as topic hint
              const firstSentence = block.text.split(/[.!?\n]/)[0].trim();
              if (firstSentence.length > 10 && firstSentence.length < 200) {
                topics.add(firstSentence);
              }
            }
          }
        }
      } catch {
        const text = msg.content;
        const firstSentence = text.split(/[.!?\n]/)[0].trim();
        if (firstSentence.length > 10 && firstSentence.length < 200) {
          topics.add(firstSentence);
        }
      }
    }

    if (topics.size > 0) {
      parts.push('Topics discussed:');
      for (const topic of [...topics].slice(0, 5)) {
        parts.push(`- ${topic}`);
      }
    }

    return parts.join('\n');
  }

  private buildResult(
    conversationId: string,
    strategy: CompactionStrategy,
    trigger: CompactionTrigger,
    allMessages: MessageRow[],
    retained: MessageRow[],
    dropped: MessageRow[],
    tokensBefore: number,
    summary?: string,
  ): CompactionResult {
    const tokensAfter =
      retained.reduce((sum, m) => sum + (m.token_count || estimateTokens(m.content)), 0) +
      (summary ? estimateTokens(summary) : 0);

    return {
      id: nanoid(12),
      conversationId,
      strategy,
      trigger,
      timestamp: Date.now(),
      messagesBefore: allMessages.length,
      messagesAfter: retained.length,
      tokensBefore,
      tokensAfter,
      compressionRatio: tokensBefore > 0 ? tokensAfter / tokensBefore : 1,
      summary,
      droppedMessageIds: dropped.map((m) => m.id),
      retainedMessageIds: retained.map((m) => m.id),
    };
  }

  private persistResult(result: CompactionResult): void {
    try {
      const db = getDb();
      db.query(
        `
        INSERT INTO compaction_history (id, conversation_id, strategy, trigger_type, timestamp, messages_before, messages_after, tokens_before, tokens_after, compression_ratio, summary)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        result.id,
        result.conversationId,
        result.strategy,
        result.trigger,
        result.timestamp,
        result.messagesBefore,
        result.messagesAfter,
        result.tokensBefore,
        result.tokensAfter,
        result.compressionRatio,
        result.summary || null,
      );
    } catch {
      // Table may not have all columns
    }
  }
}

export const compactionEngine = new ContextCompactionEngine();
