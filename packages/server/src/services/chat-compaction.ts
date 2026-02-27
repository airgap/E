/**
 * Chat compaction service for managing conversation history length
 *
 * Strategies:
 * 1. Token-based compaction - Keep recent messages, summarize old ones
 * 2. Sliding window - Keep last N messages with full content
 * 3. Smart retention - Always keep system messages, important context
 * 4. Provider-specific limits - Different providers have different context windows
 */

import { getDb } from '../db/database';
import { callLlm } from './llm-oneshot';
import type { Message } from '@e/shared';

export interface CompactionOptions {
  /** Maximum number of tokens to retain (default: 100000) */
  maxTokens?: number;
  /** Maximum number of messages to keep uncompressed (default: 20) */
  maxMessages?: number;
  /** Strategy: 'sliding-window' | 'token-based' | 'smart' (default: 'smart') */
  strategy?: 'sliding-window' | 'token-based' | 'smart';
  /** Whether to preserve tool use messages (default: true) */
  preserveToolUse?: boolean;
  /** Whether to create summary message (default: true) */
  createSummary?: boolean;
}

export interface CompactedHistory {
  messages: any[];
  summary?: string;
  compacted: boolean;
  originalCount: number;
  compactedCount: number;
  tokensRemoved: number;
}

export interface LLMSummaryResult {
  /** The summary text (extracted from <summary>...</summary> if present). */
  summaryText: string;
  /** The user message to prepend to the compacted history. */
  summaryMessage: any;
  /** Whether an actual LLM call was made (false = fell back to rule-based). */
  usedLLM: boolean;
}

/**
 * Model context window sizes (input tokens).
 * Mirrors Claude Code's model registry.
 */
const CONTEXT_WINDOW: Record<string, number> = {
  // Claude 4 family
  'claude-opus-4': 200000,
  'claude-opus-4-6': 200000,
  'claude-sonnet-4': 200000,
  'claude-sonnet-4-5': 200000,
  'claude-sonnet-4-6': 200000,
  'claude-sonnet-4-5-20250929': 200000,
  'claude-haiku-4': 200000,
  'claude-haiku-4-5': 200000,
  'claude-haiku-4-5-20251001': 200000,
  // Claude 3.x family
  'claude-sonnet-3.5': 200000,
  'claude-sonnet-3-5': 200000,
  'claude-haiku-3': 200000,
  // Ollama local
  'ollama:llama3.1': 128000,
  'ollama:llama3.2': 128000,
  'ollama:qwen2.5': 32000,
  'ollama:mistral': 32000,
  default: 200000,
};

/**
 * Max output token limits per model.
 * Used in Claude Code's threshold formula.
 */
const MAX_OUTPUT_TOKENS: Record<string, number> = {
  'claude-opus-4': 32000,
  'claude-opus-4-6': 32000,
  'claude-sonnet-4': 16000,
  'claude-sonnet-4-5': 16000,
  'claude-sonnet-4-6': 16000,
  'claude-sonnet-4-5-20250929': 16000,
  'claude-haiku-4': 8192,
  'claude-haiku-4-5': 8192,
  'claude-haiku-4-5-20251001': 8192,
  'claude-sonnet-3.5': 8192,
  'claude-haiku-3': 4096,
  default: 16000,
};

// Mirrors Claude Code's compaction constants exactly
const OUTPUT_TOKEN_CAP = 20000; // QE1 — cap on the output-token reserve
const SAFETY_BUFFER = 13000; // iSA — subtracted from effective window

/**
 * Provider context window limits (in tokens) — kept for backwards compatibility
 * with the existing compaction API routes.
 */
const CONTEXT_LIMITS: Record<string, number> = CONTEXT_WINDOW;

/**
 * Estimate token count for a message (rough approximation)
 * Real implementation should use tiktoken or similar
 */
function estimateTokens(content: string): number {
  // Rough estimate: 1 token ≈ 4 characters
  return Math.ceil(content.length / 4);
}

/**
 * Get context window limit for a model
 */
export function getContextLimit(model: string): number {
  if (CONTEXT_WINDOW[model]) return CONTEXT_WINDOW[model];
  for (const [key, limit] of Object.entries(CONTEXT_WINDOW)) {
    if (key !== 'default' && model.includes(key)) return limit;
  }
  return CONTEXT_WINDOW.default;
}

/**
 * Get max output token limit for a model
 */
function getMaxOutputTokens(model: string): number {
  if (MAX_OUTPUT_TOKENS[model]) return MAX_OUTPUT_TOKENS[model];
  for (const [key, limit] of Object.entries(MAX_OUTPUT_TOKENS)) {
    if (key !== 'default' && model.includes(key)) return limit;
  }
  return MAX_OUTPUT_TOKENS.default;
}

/**
 * Compute the token count at which autocompaction triggers.
 *
 * Mirrors Claude Code's ZgH() formula exactly:
 *   effectiveWindow = contextWindow - min(maxOutputTokens, 20000)
 *   threshold = effectiveWindow - 13000
 *
 * Supports CLAUDE_AUTOCOMPACT_PCT_OVERRIDE env var (0-100) to override as a
 * percentage of the effective window (same as Claude Code).
 */
export function getAutoCompactThreshold(model: string): number {
  const contextWindow = getContextLimit(model);
  const maxOut = getMaxOutputTokens(model);
  const outputReserve = Math.min(maxOut, OUTPUT_TOKEN_CAP);
  const effectiveWindow = contextWindow - outputReserve;

  // Support env var override (same as Claude Code's CLAUDE_AUTOCOMPACT_PCT_OVERRIDE)
  const pctOverride = process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE;
  if (pctOverride) {
    const pct = parseFloat(pctOverride);
    if (!isNaN(pct) && pct > 0 && pct <= 100) {
      const overrideThreshold = Math.floor(effectiveWindow * (pct / 100));
      return Math.min(overrideThreshold, effectiveWindow - SAFETY_BUFFER);
    }
  }

  return effectiveWindow - SAFETY_BUFFER;
}

/**
 * Claude Code's exact compaction prompt (DCI function in their source).
 * Produces a structured LLM-generated summary of the conversation.
 */
const COMPACTION_SYSTEM_PROMPT = `You are a helpful AI assistant tasked with summarizing conversations.`;

const COMPACTION_USER_PROMPT = `Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions.
This summary should be thorough in capturing technical details, code patterns, and architectural decisions that would be essential for continuing development work without losing context.

Your summary should include:
1. Primary Request and Intent — what the user is trying to accomplish
2. Key Technical Concepts — languages, frameworks, patterns discussed
3. Files and Code Sections — file names, key functions, important code snippets verbatim
4. Errors and Fixes — any errors encountered and how they were resolved
5. Problem Solving — approach and decisions made
6. All user messages — capture the user's exact words for important requests
7. Pending Tasks — work that was started but not completed
8. Current Work — the most recent files/code being worked on with full snippets
9. Optional Next Step — verbatim quote from the most recent message about what to do next

IMPORTANT: Do NOT use any tools. Respond with ONLY a <summary>...</summary> block containing your structured summary.`;

/**
 * Produce an LLM-generated summary of the dropped messages.
 * Routes through the configured CLI provider via callLlm.
 * Falls back to the rule-based summary if the call fails.
 */
export async function summarizeWithLLM(
  droppedMessages: any[],
  keptMessages: any[],
  model: string,
): Promise<LLMSummaryResult> {
  if (droppedMessages.length === 0) {
    const summary = buildRuleBasedSummary(droppedMessages);
    return {
      summaryText: summary,
      summaryMessage: buildSummaryMessage(summary, false),
      usedLLM: false,
    };
  }

  try {
    // Serialize the dropped conversation into a text block for the user prompt.
    // CLI providers only accept a single prompt string, so we flatten the
    // multi-message conversation into a readable format.
    const conversationText = droppedMessages
      .map((m: any) => {
        const text = Array.isArray(m.content)
          ? m.content
              .map((block: any) => {
                if (block.type === 'nudge') return `[User nudge]: ${block.text}`;
                if (block.type === 'text') return block.text;
                return '';
              })
              .filter(Boolean)
              .join('\n')
          : String(m.content);
        return `[${m.role}]: ${text}`;
      })
      .join('\n\n');

    const userPrompt = `Here is the conversation to summarize:\n\n${conversationText}\n\n${COMPACTION_USER_PROMPT}`;

    let summaryText = await callLlm({
      system: COMPACTION_SYSTEM_PROMPT,
      user: userPrompt,
      model,
      timeoutMs: 60_000,
    });

    // Extract content from <summary>...</summary> tags if present
    const match = summaryText.match(/<summary>([\s\S]*?)<\/summary>/i);
    if (match) summaryText = match[1].trim();

    if (!summaryText) {
      throw new Error('Empty summary from LLM');
    }

    console.log(`[compaction] LLM summary generated (${summaryText.length} chars)`);
    return { summaryText, summaryMessage: buildSummaryMessage(summaryText, true), usedLLM: true };
  } catch (err) {
    console.error('[compaction] LLM summarization failed, falling back to rule-based:', err);
    const summary = buildRuleBasedSummary(droppedMessages);
    return {
      summaryText: summary,
      summaryMessage: buildSummaryMessage(summary, false),
      usedLLM: false,
    };
  }
}

/**
 * Build the framed summary user message that gets prepended to the compacted history.
 * Mirrors Claude Code's SRH() function.
 */
function buildSummaryMessage(summaryText: string, hasKeptMessages: boolean): any {
  let text = `This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\n${summaryText}`;
  if (hasKeptMessages) {
    text += `\n\nRecent messages are preserved verbatim below.`;
  }
  text += `\n\nPlease continue the conversation from where we left off without asking the user any further questions. Continue with the last task that you were asked to work on.`;
  return {
    role: 'user',
    content: [{ type: 'text', text }],
  };
}

/** Rule-based summary fallback — concatenates text from dropped messages. */
function buildRuleBasedSummary(messages: any[]): string {
  const parts: string[] = [];
  let toolCount = 0;
  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'text' && block.text) {
          parts.push(`[${msg.role}]: ${block.text.slice(0, 300)}`);
        } else if (block.type === 'tool_use') {
          toolCount++;
        }
      }
    }
  }
  if (toolCount > 0) parts.push(`(${toolCount} tool operations were performed)`);
  return parts.join('\n');
}

/**
 * Calculate total tokens in message array
 */
function calculateTotalTokens(messages: any[]): number {
  let total = 0;
  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'text' && block.text) {
          total += estimateTokens(block.text);
        } else if (block.type === 'tool_result' && block.content) {
          total += estimateTokens(
            typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
          );
        }
      }
    } else if (typeof msg.content === 'string') {
      total += estimateTokens(msg.content);
    }
  }
  return total;
}

/**
 * Check if a message is important and should be preserved
 */
function isImportantMessage(msg: any): boolean {
  // Preserve system messages
  if (msg.role === 'system') return true;

  // Preserve messages with tool use
  if (Array.isArray(msg.content)) {
    for (const block of msg.content) {
      if (block.type === 'tool_use' || block.type === 'tool_result') {
        return true;
      }
    }
  }

  return false;
}

/**
 * Create a summary message from a range of messages
 */
function createSummaryMessage(messages: any[]): any {
  const userMessages: string[] = [];
  const assistantMessages: string[] = [];
  let toolUsageCount = 0;

  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'text' && block.text) {
          if (msg.role === 'user') {
            userMessages.push(block.text);
          } else if (msg.role === 'assistant') {
            assistantMessages.push(block.text);
          }
        } else if (block.type === 'tool_use') {
          toolUsageCount++;
        }
      }
    }
  }

  const summaryParts = [];

  if (userMessages.length > 0) {
    summaryParts.push(`User discussed: ${userMessages.slice(0, 3).join('; ')}`);
    if (userMessages.length > 3) {
      summaryParts.push(`(and ${userMessages.length - 3} more topics)`);
    }
  }

  if (assistantMessages.length > 0) {
    summaryParts.push(`Assistant provided: ${assistantMessages.slice(0, 2).join('; ')}`);
    if (assistantMessages.length > 2) {
      summaryParts.push(`(and ${assistantMessages.length - 2} more responses)`);
    }
  }

  if (toolUsageCount > 0) {
    summaryParts.push(`${toolUsageCount} tool operations were performed`);
  }

  const summaryText = summaryParts.join('. ') + '.';

  return {
    role: 'user',
    content: [
      {
        type: 'text',
        text: `[Previous conversation summary: ${summaryText}]`,
      },
    ],
  };
}

/**
 * Compact messages using sliding window strategy
 * Keeps the last N messages, discards older ones
 */
function compactSlidingWindow(
  messages: any[],
  maxMessages: number,
  createSummary: boolean,
): CompactedHistory {
  if (messages.length <= maxMessages) {
    return {
      messages,
      compacted: false,
      originalCount: messages.length,
      compactedCount: messages.length,
      tokensRemoved: 0,
    };
  }

  const keptMessages = messages.slice(-maxMessages);
  const removedMessages = messages.slice(0, -maxMessages);
  const tokensRemoved = calculateTotalTokens(removedMessages);

  let finalMessages = keptMessages;
  let summary: string | undefined;

  if (createSummary && removedMessages.length > 0) {
    const summaryMsg = createSummaryMessage(removedMessages);
    summary = summaryMsg.content[0].text;
    finalMessages = [summaryMsg, ...keptMessages];
  }

  return {
    messages: finalMessages,
    summary,
    compacted: true,
    originalCount: messages.length,
    compactedCount: finalMessages.length,
    tokensRemoved,
  };
}

/**
 * Compact messages based on token limit
 * Keeps recent messages until token limit is reached
 */
function compactTokenBased(
  messages: any[],
  maxTokens: number,
  createSummary: boolean,
): CompactedHistory {
  const totalTokens = calculateTotalTokens(messages);

  if (totalTokens <= maxTokens) {
    return {
      messages,
      compacted: false,
      originalCount: messages.length,
      compactedCount: messages.length,
      tokensRemoved: 0,
    };
  }

  // Work backwards from most recent messages
  const keptMessages: any[] = [];
  let currentTokens = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const msgTokens = calculateTotalTokens([msg]);

    if (currentTokens + msgTokens <= maxTokens) {
      keptMessages.unshift(msg);
      currentTokens += msgTokens;
    } else {
      break;
    }
  }

  const removedMessages = messages.slice(0, messages.length - keptMessages.length);
  const tokensRemoved = calculateTotalTokens(removedMessages);

  let finalMessages = keptMessages;
  let summary: string | undefined;

  if (createSummary && removedMessages.length > 0) {
    const summaryMsg = createSummaryMessage(removedMessages);
    const summaryTokens = calculateTotalTokens([summaryMsg]);

    // Make room for summary if needed
    while (currentTokens + summaryTokens > maxTokens && finalMessages.length > 1) {
      const removed = finalMessages.shift()!;
      currentTokens -= calculateTotalTokens([removed]);
    }

    summary = summaryMsg.content[0].text;
    finalMessages = [summaryMsg, ...finalMessages];
  }

  return {
    messages: finalMessages,
    summary,
    compacted: true,
    originalCount: messages.length,
    compactedCount: finalMessages.length,
    tokensRemoved,
  };
}

/**
 * Smart compaction - preserves important messages, compacts the rest
 */
function compactSmart(
  messages: any[],
  maxTokens: number,
  preserveToolUse: boolean,
  createSummary: boolean,
): CompactedHistory {
  const totalTokens = calculateTotalTokens(messages);

  if (totalTokens <= maxTokens) {
    return {
      messages,
      compacted: false,
      originalCount: messages.length,
      compactedCount: messages.length,
      tokensRemoved: 0,
    };
  }

  // Separate important and regular messages
  const importantMessages: any[] = [];
  const regularMessages: any[] = [];

  for (const msg of messages) {
    if (isImportantMessage(msg) && preserveToolUse) {
      importantMessages.push(msg);
    } else {
      regularMessages.push(msg);
    }
  }

  // Always keep important messages
  const importantTokens = calculateTotalTokens(importantMessages);
  const remainingTokens = maxTokens - importantTokens;

  // Fill remaining space with recent regular messages
  const keptRegular: any[] = [];
  let currentTokens = 0;

  for (let i = regularMessages.length - 1; i >= 0; i--) {
    const msg = regularMessages[i];
    const msgTokens = calculateTotalTokens([msg]);

    if (currentTokens + msgTokens <= remainingTokens) {
      keptRegular.unshift(msg);
      currentTokens += msgTokens;
    } else {
      break;
    }
  }

  // Merge important and kept regular messages in chronological order
  const allKept = [...importantMessages, ...keptRegular].sort((a, b) => {
    // Maintain original order
    const aIdx = messages.indexOf(a);
    const bIdx = messages.indexOf(b);
    return aIdx - bIdx;
  });

  const removedCount = messages.length - allKept.length;
  const removedMessages = messages.filter((m) => !allKept.includes(m));
  const tokensRemoved = calculateTotalTokens(removedMessages);

  let finalMessages = allKept;
  let summary: string | undefined;

  if (createSummary && removedMessages.length > 0) {
    const summaryMsg = createSummaryMessage(removedMessages);
    summary = summaryMsg.content[0].text;
    finalMessages = [summaryMsg, ...allKept];
  }

  return {
    messages: finalMessages,
    summary,
    compacted: removedCount > 0,
    originalCount: messages.length,
    compactedCount: finalMessages.length,
    tokensRemoved,
  };
}

/**
 * Compact conversation history based on specified strategy
 */
export function compactMessages(
  messages: any[],
  options: CompactionOptions = {},
): CompactedHistory {
  const {
    maxTokens = 100000,
    maxMessages = 20,
    strategy = 'smart',
    preserveToolUse = true,
    createSummary = true,
  } = options;

  if (messages.length === 0) {
    return {
      messages: [],
      compacted: false,
      originalCount: 0,
      compactedCount: 0,
      tokensRemoved: 0,
    };
  }

  switch (strategy) {
    case 'sliding-window':
      return compactSlidingWindow(messages, maxMessages, createSummary);
    case 'token-based':
      return compactTokenBased(messages, maxTokens, createSummary);
    case 'smart':
      return compactSmart(messages, maxTokens, preserveToolUse, createSummary);
    default:
      throw new Error(`Unknown compaction strategy: ${strategy}`);
  }
}

/**
 * Load conversation history from DB with optional compaction
 */
export function loadConversationHistory(
  conversationId: string,
  options: CompactionOptions = {},
): CompactedHistory {
  const db = getDb();
  const rows = db
    .query('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC')
    .all(conversationId) as any[];

  const messages: any[] = [];

  for (const row of rows) {
    try {
      const content = JSON.parse(row.content);
      // Normalize nudge content blocks → text blocks so they are safe
      // to send to any provider (Anthropic, OpenAI, Gemini, Bedrock).
      const normalized = Array.isArray(content)
        ? content.map((block: any) => {
            if (block.type === 'nudge') {
              return { type: 'text', text: `[User nudge]: ${block.text}` };
            }
            return block;
          })
        : content;
      messages.push({
        role: row.role,
        content: normalized,
      });
    } catch (e) {
      console.warn(`[chat-compaction] Failed to parse message: ${e}`);
    }
  }

  return compactMessages(messages, options);
}

/**
 * Get recommended compaction options for a model
 */
export function getRecommendedOptions(model: string): CompactionOptions {
  const contextLimit = getContextLimit(model);

  // Reserve 25% for system prompt and current request
  const maxTokens = Math.floor(contextLimit * 0.75);

  return {
    maxTokens,
    strategy: 'smart',
    preserveToolUse: true,
    createSummary: true,
  };
}

/**
 * Check if conversation needs compaction
 */
export function needsCompaction(conversationId: string, model: string): boolean {
  const recommended = getRecommendedOptions(model);
  const history = loadConversationHistory(conversationId, { ...recommended, createSummary: false });
  return history.compacted;
}
