import { describe, it, expect, beforeEach, mock, afterEach } from 'bun:test';
import { getDb } from '../../db/database';
import {
  compactMessages,
  loadConversationHistory,
  getContextLimit,
  getAutoCompactThreshold,
  getRecommendedOptions,
  summarizeWithLLM,
  type CompactionOptions,
} from '../chat-compaction';

describe('Chat Compaction', () => {
  let db: any;

  beforeEach(() => {
    db = getDb();
    // Clean up test conversations
    db.query('DELETE FROM conversations WHERE id LIKE "test-%"').run();
    db.query('DELETE FROM messages WHERE conversation_id LIKE "test-%"').run();
  });

  describe('getContextLimit', () => {
    it('should return correct limits for Claude models', () => {
      expect(getContextLimit('claude-opus-4')).toBe(200000);
      expect(getContextLimit('claude-sonnet-3.5')).toBe(200000);
      expect(getContextLimit('claude-haiku-3')).toBe(200000);
    });

    it('should return correct limits for Ollama models', () => {
      expect(getContextLimit('ollama:llama3.1')).toBe(128000);
      expect(getContextLimit('ollama:qwen2.5')).toBe(32000);
      expect(getContextLimit('ollama:mistral')).toBe(32000);
    });

    it('should return default limit for unknown models', () => {
      expect(getContextLimit('unknown-model')).toBe(200000);
    });
  });

  describe('compactMessages - sliding window', () => {
    it('should not compact when under message limit', () => {
      const messages = [
        { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Hi!' }] },
      ];

      const result = compactMessages(messages, {
        strategy: 'sliding-window',
        maxMessages: 10,
      });

      expect(result.compacted).toBe(false);
      expect(result.messages).toEqual(messages);
      expect(result.originalCount).toBe(2);
      expect(result.compactedCount).toBe(2);
    });

    it('should compact when over message limit', () => {
      const messages = Array.from({ length: 15 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: [{ type: 'text', text: `Message ${i}` }],
      }));

      const result = compactMessages(messages, {
        strategy: 'sliding-window',
        maxMessages: 5,
        createSummary: false,
      });

      expect(result.compacted).toBe(true);
      expect(result.compactedCount).toBe(5);
      expect(result.originalCount).toBe(15);
      expect(result.tokensRemoved).toBeGreaterThan(0);
    });

    it('should create summary when compacting', () => {
      const messages = Array.from({ length: 10 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: [{ type: 'text', text: `Message ${i}` }],
      }));

      const result = compactMessages(messages, {
        strategy: 'sliding-window',
        maxMessages: 3,
        createSummary: true,
      });

      expect(result.compacted).toBe(true);
      expect(result.summary).toBeDefined();
      expect(result.summary).toContain('Previous conversation summary');
      // Summary message + 3 kept messages
      expect(result.compactedCount).toBe(4);
    });
  });

  describe('compactMessages - token-based', () => {
    it('should not compact when under token limit', () => {
      const messages = [
        { role: 'user', content: [{ type: 'text', text: 'Short' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'OK' }] },
      ];

      const result = compactMessages(messages, {
        strategy: 'token-based',
        maxTokens: 1000,
      });

      expect(result.compacted).toBe(false);
      expect(result.messages).toEqual(messages);
    });

    it('should compact based on token limit', () => {
      const messages = Array.from({ length: 20 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: [
          {
            type: 'text',
            text: 'This is a longer message that contains multiple words and should have more tokens'.repeat(
              10,
            ),
          },
        ],
      }));

      const result = compactMessages(messages, {
        strategy: 'token-based',
        maxTokens: 2000,
        createSummary: false,
      });

      expect(result.compacted).toBe(true);
      expect(result.compactedCount).toBeLessThan(result.originalCount);
      expect(result.tokensRemoved).toBeGreaterThan(0);
    });
  });

  describe('compactMessages - smart', () => {
    it('should preserve tool use messages', () => {
      const messages = [
        { role: 'user', content: [{ type: 'text', text: 'Read file' }] },
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'tool1', name: 'Read', input: { file_path: 'test.txt' } },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool1',
              content: 'File contents here',
            },
          ],
        },
        { role: 'assistant', content: [{ type: 'text', text: 'Done' }] },
      ];

      // Add many more regular messages with longer text to exceed token limit
      const manyMessages = [
        ...messages,
        ...Array.from({ length: 20 }, (_, i) => ({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: [{ type: 'text', text: `Regular message ${i}`.repeat(100) }],
        })),
      ];

      const result = compactMessages(manyMessages, {
        strategy: 'smart',
        maxTokens: 500,
        preserveToolUse: true,
        createSummary: false,
      });

      expect(result.compacted).toBe(true);
      // Tool use messages should be in the result
      const toolUseInResult = result.messages.some((m: any) =>
        m.content.some((c: any) => c.type === 'tool_use'),
      );
      expect(toolUseInResult).toBe(true);
    });

    it('should balance important and recent messages', () => {
      const messages = [
        { role: 'system', content: [{ type: 'text', text: 'System message' }] },
        ...Array.from({ length: 30 }, (_, i) => ({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: [{ type: 'text', text: `Message ${i}`.repeat(100) }],
        })),
      ];

      const result = compactMessages(messages, {
        strategy: 'smart',
        maxTokens: 2000,
        preserveToolUse: true,
      });

      expect(result.compacted).toBe(true);
      // System message should be preserved
      const hasSystemMsg = result.messages.some((m: any) => m.role === 'system');
      expect(hasSystemMsg).toBe(true);
    });
  });

  describe('loadConversationHistory', () => {
    it('should load empty history for new conversation', () => {
      const result = loadConversationHistory('test-empty-conv');

      expect(result.messages).toEqual([]);
      expect(result.compacted).toBe(false);
      expect(result.originalCount).toBe(0);
    });

    it('should load and compact conversation from DB', () => {
      // Create test conversation
      db.query(
        `INSERT INTO conversations (id, model, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
      ).run('test-compact-conv', 'claude-sonnet-3.5', Date.now(), Date.now());

      // Add many messages
      for (let i = 0; i < 25; i++) {
        const content = JSON.stringify([
          {
            type: 'text',
            text: `Test message ${i}`.repeat(50), // Make them longer
          },
        ]);
        db.query(
          `INSERT INTO messages (id, conversation_id, role, content, timestamp)
           VALUES (?, ?, ?, ?, ?)`,
        ).run(
          `msg-${i}`,
          'test-compact-conv',
          i % 2 === 0 ? 'user' : 'assistant',
          content,
          Date.now() + i,
        );
      }

      const result = loadConversationHistory('test-compact-conv', {
        strategy: 'sliding-window',
        maxMessages: 10,
        createSummary: true,
      });

      expect(result.originalCount).toBe(25);
      expect(result.compacted).toBe(true);
      expect(result.compactedCount).toBe(11); // 10 messages + 1 summary
      expect(result.summary).toBeDefined();
    });
  });

  describe('getRecommendedOptions', () => {
    it('should return appropriate options for Claude models', () => {
      const opts = getRecommendedOptions('claude-sonnet-3.5');

      expect(opts.strategy).toBe('smart');
      expect(opts.preserveToolUse).toBe(true);
      expect(opts.createSummary).toBe(true);
      expect(opts.maxTokens).toBeGreaterThan(100000);
    });

    it('should return appropriate options for smaller Ollama models', () => {
      const opts = getRecommendedOptions('ollama:qwen2.5');

      expect(opts.maxTokens).toBeLessThan(30000); // 75% of 32000
    });
  });

  describe('edge cases', () => {
    it('should handle empty message array', () => {
      const result = compactMessages([]);

      expect(result.compacted).toBe(false);
      expect(result.messages).toEqual([]);
      expect(result.originalCount).toBe(0);
    });

    it('should handle messages with mixed content types', () => {
      const messages = [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Hello'.repeat(500) },
            { type: 'image', source: { type: 'base64', data: 'abc123' } },
          ],
        },
        { role: 'assistant', content: [{ type: 'text', text: 'I see an image'.repeat(500) }] },
      ];

      const result = compactMessages(messages, {
        strategy: 'token-based',
        maxTokens: 100,
      });

      // Should compact or not based on actual token count
      expect(result.messages.length).toBeGreaterThan(0);
    });

    it('should handle invalid JSON in DB gracefully', () => {
      db.query(
        `INSERT INTO conversations (id, model, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
      ).run('test-invalid-json', 'claude-sonnet-3.5', Date.now(), Date.now());

      db.query(
        `INSERT INTO messages (id, conversation_id, role, content, timestamp)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('msg-bad', 'test-invalid-json', 'user', 'not valid json{', Date.now());

      const result = loadConversationHistory('test-invalid-json');

      // Should skip invalid message
      expect(result.messages).toEqual([]);
    });

    it('should handle unknown compaction strategy', () => {
      const messages = [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }];
      expect(() => compactMessages(messages, { strategy: 'invalid-strategy' as any })).toThrow(
        'Unknown compaction strategy',
      );
    });

    it('should handle messages with string content in token calculation', () => {
      const messages = [
        { role: 'user', content: 'This is a plain string message' },
        { role: 'assistant', content: 'Another string message' },
      ];

      const result = compactMessages(messages, {
        strategy: 'token-based',
        maxTokens: 1000,
      });

      expect(result.compacted).toBe(false);
      expect(result.messages).toEqual(messages);
    });

    it('should handle messages with tool_result content blocks in token calculation', () => {
      const messages = [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool1',
              content: 'The tool result content that should count toward tokens',
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool2',
              content: { key: 'value', nested: { data: true } },
            },
          ],
        },
      ];

      // Should not throw and should calculate tokens correctly
      const result = compactMessages(messages, {
        strategy: 'token-based',
        maxTokens: 100000,
      });

      expect(result.compacted).toBe(false);
      expect(result.originalCount).toBe(2);
    });
  });

  describe('getAutoCompactThreshold', () => {
    const originalEnv = process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE;

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE;
      } else {
        process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = originalEnv;
      }
    });

    it('should compute threshold for claude-opus-4 using ZgH formula', () => {
      // contextWindow = 200000, maxOutputTokens = 32000, cap = 20000
      // effectiveWindow = 200000 - min(32000, 20000) = 180000
      // threshold = 180000 - 13000 = 167000
      const threshold = getAutoCompactThreshold('claude-opus-4');
      expect(threshold).toBe(167000);
    });

    it('should compute threshold for claude-sonnet-4 with different output tokens', () => {
      // contextWindow = 200000, maxOutputTokens = 16000, cap = 20000
      // effectiveWindow = 200000 - min(16000, 20000) = 184000
      // threshold = 184000 - 13000 = 171000
      const threshold = getAutoCompactThreshold('claude-sonnet-4');
      expect(threshold).toBe(171000);
    });

    it('should compute threshold for claude-haiku-4 with smaller output tokens', () => {
      // contextWindow = 200000, maxOutputTokens = 8192, cap = 20000
      // effectiveWindow = 200000 - min(8192, 20000) = 191808
      // threshold = 191808 - 13000 = 178808
      const threshold = getAutoCompactThreshold('claude-haiku-4');
      expect(threshold).toBe(178808);
    });

    it('should compute threshold for small Ollama models', () => {
      // contextWindow = 32000, maxOutputTokens = default 16000, cap = 20000
      // effectiveWindow = 32000 - min(16000, 20000) = 16000
      // threshold = 16000 - 13000 = 3000
      const threshold = getAutoCompactThreshold('ollama:qwen2.5');
      expect(threshold).toBe(3000);
    });

    it('should apply CLAUDE_AUTOCOMPACT_PCT_OVERRIDE env var', () => {
      process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = '50';
      // claude-sonnet-4: effectiveWindow = 184000
      // override = floor(184000 * 0.50) = 92000
      // min(92000, 184000 - 13000 = 171000) = 92000
      const threshold = getAutoCompactThreshold('claude-sonnet-4');
      expect(threshold).toBe(92000);
    });

    it('should cap pct override at effectiveWindow - safety buffer', () => {
      process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = '100';
      // claude-sonnet-4: effectiveWindow = 184000
      // override = floor(184000 * 1.0) = 184000
      // min(184000, 184000 - 13000 = 171000) = 171000
      const threshold = getAutoCompactThreshold('claude-sonnet-4');
      expect(threshold).toBe(171000);
    });

    it('should ignore invalid pct override values', () => {
      process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = 'invalid';
      const threshold = getAutoCompactThreshold('claude-sonnet-4');
      expect(threshold).toBe(171000);
    });

    it('should ignore pct override of 0', () => {
      process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = '0';
      const threshold = getAutoCompactThreshold('claude-sonnet-4');
      expect(threshold).toBe(171000);
    });

    it('should ignore negative pct override', () => {
      process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = '-50';
      const threshold = getAutoCompactThreshold('claude-sonnet-4');
      expect(threshold).toBe(171000);
    });

    it('should use default model limits for unknown models', () => {
      // contextWindow = 200000 (default), maxOutputTokens = 16000 (default)
      // effectiveWindow = 200000 - min(16000, 20000) = 184000
      // threshold = 184000 - 13000 = 171000
      const threshold = getAutoCompactThreshold('some-unknown-model');
      expect(threshold).toBe(171000);
    });
  });

  describe('getContextLimit - partial matching', () => {
    it('should match model names containing a known key', () => {
      // A model string containing 'claude-opus-4' should match
      expect(getContextLimit('some-prefix-claude-opus-4-variant')).toBe(200000);
    });

    it('should match ollama models by substring', () => {
      expect(getContextLimit('ollama:llama3.1:latest')).toBe(128000);
    });
  });

  describe('compactMessages - sliding window with summary', () => {
    it('should not create summary when createSummary is false', () => {
      const messages = Array.from({ length: 10 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: [{ type: 'text', text: `Message ${i}` }],
      }));

      const result = compactMessages(messages, {
        strategy: 'sliding-window',
        maxMessages: 3,
        createSummary: false,
      });

      expect(result.compacted).toBe(true);
      expect(result.summary).toBeUndefined();
      expect(result.compactedCount).toBe(3);
    });

    it('should include tool operations count in summary', () => {
      const messages = [
        { role: 'user', content: [{ type: 'text', text: 'Read file' }] },
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'tu1', name: 'Read', input: {} },
            { type: 'text', text: 'Here is the file content' },
          ],
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'file contents' }],
        },
        ...Array.from({ length: 10 }, (_, i) => ({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: [{ type: 'text', text: `Later message ${i}` }],
        })),
      ];

      const result = compactMessages(messages, {
        strategy: 'sliding-window',
        maxMessages: 3,
        createSummary: true,
      });

      expect(result.compacted).toBe(true);
      expect(result.summary).toBeDefined();
      expect(result.summary).toContain('tool operations');
    });

    it('should include user messages in summary (up to 3)', () => {
      const messages = [
        { role: 'user', content: [{ type: 'text', text: 'User topic alpha' }] },
        { role: 'user', content: [{ type: 'text', text: 'User topic beta' }] },
        ...Array.from({ length: 10 }, (_, i) => ({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: [{ type: 'text', text: `Message ${i}` }],
        })),
      ];

      const result = compactMessages(messages, {
        strategy: 'sliding-window',
        maxMessages: 3,
        createSummary: true,
      });

      expect(result.compacted).toBe(true);
      expect(result.summary).toBeDefined();
      // The summary should reference user topics from the removed messages
      expect(result.summary).toContain('User discussed');
    });

    it('should show more-topics notice when many user messages summarized', () => {
      // Create more than 3 user messages in the dropped portion
      const messages = [
        ...Array.from({ length: 10 }, (_, i) => ({
          role: 'user',
          content: [{ type: 'text', text: `User topic ${i}` }],
        })),
        ...Array.from({ length: 5 }, (_, i) => ({
          role: 'assistant',
          content: [{ type: 'text', text: `Response ${i}` }],
        })),
      ];

      const result = compactMessages(messages, {
        strategy: 'sliding-window',
        maxMessages: 2,
        createSummary: true,
      });

      expect(result.compacted).toBe(true);
      expect(result.summary).toContain('more topics');
    });
  });

  describe('compactMessages - token-based with summary', () => {
    it('should create summary and make room for it within token limit', () => {
      const messages = Array.from({ length: 20 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: [{ type: 'text', text: 'x'.repeat(400) }],
      }));

      const result = compactMessages(messages, {
        strategy: 'token-based',
        maxTokens: 500,
        createSummary: true,
      });

      expect(result.compacted).toBe(true);
      expect(result.summary).toBeDefined();
      // Should have at least the summary message
      expect(result.compactedCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('compactMessages - smart strategy edge cases', () => {
    it('should not compact when under token limit', () => {
      const messages = [
        { role: 'user', content: [{ type: 'text', text: 'Short' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Reply' }] },
      ];

      const result = compactMessages(messages, {
        strategy: 'smart',
        maxTokens: 100000,
        preserveToolUse: true,
      });

      expect(result.compacted).toBe(false);
      expect(result.messages).toEqual(messages);
    });

    it('should not preserve tool use when preserveToolUse is false', () => {
      const messages = [
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tu1', name: 'Read', input: {} }],
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'result' }],
        },
        ...Array.from({ length: 20 }, (_, i) => ({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: [{ type: 'text', text: `Regular message ${i}`.repeat(100) }],
        })),
      ];

      const result = compactMessages(messages, {
        strategy: 'smart',
        maxTokens: 500,
        preserveToolUse: false,
        createSummary: false,
      });

      expect(result.compacted).toBe(true);
      // Tool use messages should NOT be specially preserved
      // They may or may not be in the result depending on recency
    });

    it('should create summary with smart strategy when messages are removed', () => {
      const messages = [
        { role: 'system', content: [{ type: 'text', text: 'System prompt' }] },
        ...Array.from({ length: 30 }, (_, i) => ({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: [{ type: 'text', text: `Message ${i}`.repeat(100) }],
        })),
      ];

      const result = compactMessages(messages, {
        strategy: 'smart',
        maxTokens: 2000,
        preserveToolUse: true,
        createSummary: true,
      });

      expect(result.compacted).toBe(true);
      expect(result.summary).toBeDefined();
      expect(result.summary).toContain('Previous conversation summary');
    });
  });

  describe('loadConversationHistory - nudge normalization', () => {
    it('should normalize nudge content blocks to text blocks', () => {
      db.query(
        `INSERT INTO conversations (id, model, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
      ).run('test-nudge-conv', 'claude-sonnet-3.5', Date.now(), Date.now());

      const nudgeContent = JSON.stringify([
        { type: 'nudge', text: 'Please hurry up' },
        { type: 'text', text: 'Normal text' },
      ]);

      db.query(
        `INSERT INTO messages (id, conversation_id, role, content, timestamp)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('msg-nudge', 'test-nudge-conv', 'user', nudgeContent, Date.now());

      const result = loadConversationHistory('test-nudge-conv');

      expect(result.messages).toHaveLength(1);
      const msg = result.messages[0];
      // Nudge should be normalized to text type
      expect(msg.content[0].type).toBe('text');
      expect(msg.content[0].text).toContain('[User nudge]');
      expect(msg.content[0].text).toContain('Please hurry up');
      // Normal text block should be unchanged
      expect(msg.content[1].type).toBe('text');
      expect(msg.content[1].text).toBe('Normal text');
    });

    it('should handle non-array content in messages', () => {
      db.query(
        `INSERT INTO conversations (id, model, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
      ).run('test-string-content', 'claude-sonnet-3.5', Date.now(), Date.now());

      const plainContent = JSON.stringify('Just a string');

      db.query(
        `INSERT INTO messages (id, conversation_id, role, content, timestamp)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('msg-str', 'test-string-content', 'user', plainContent, Date.now());

      const result = loadConversationHistory('test-string-content');
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe('Just a string');
    });
  });

  describe('summarizeWithLLM', () => {
    it('should return rule-based summary for empty dropped messages', async () => {
      const result = await summarizeWithLLM([], [], 'claude-sonnet-4');

      expect(result.usedLLM).toBe(false);
      expect(result.summaryText).toBe('');
      expect(result.summaryMessage).toBeDefined();
      expect(result.summaryMessage.role).toBe('user');
    });

    it('should build summary message with proper structure', async () => {
      const result = await summarizeWithLLM([], [], 'claude-sonnet-4');

      expect(result.summaryMessage.role).toBe('user');
      expect(Array.isArray(result.summaryMessage.content)).toBe(true);
      expect(result.summaryMessage.content[0].type).toBe('text');
      expect(result.summaryMessage.content[0].text).toContain(
        'continued from a previous conversation',
      );
    });

    it('should fall back to rule-based summary when LLM call fails', async () => {
      // callLlm is imported from llm-oneshot and will likely fail in test env
      // (no actual LLM server), which should trigger the fallback
      const droppedMessages = [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Please help me refactor the code' }],
        },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'Sure, I can help with that' }],
        },
      ];

      const result = await summarizeWithLLM(droppedMessages, [], 'claude-sonnet-4');

      // Should fall back to rule-based when LLM fails
      expect(result.usedLLM).toBe(false);
      expect(result.summaryText).toBeTruthy();
      expect(result.summaryMessage.role).toBe('user');
    });

    it('should include tool operations in rule-based fallback summary', async () => {
      const droppedMessages = [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Read the file' }],
        },
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'tu1', name: 'Read', input: {} },
            { type: 'text', text: 'Here are the contents' },
          ],
        },
      ];

      const result = await summarizeWithLLM(droppedMessages, [], 'claude-sonnet-4');

      expect(result.usedLLM).toBe(false);
      expect(result.summaryText).toContain('tool operations');
    });

    it('should handle messages with array content containing nudge blocks', async () => {
      const droppedMessages = [
        {
          role: 'user',
          content: [
            { type: 'nudge', text: 'hurry up' },
            { type: 'text', text: 'Normal message' },
          ],
        },
      ];

      const result = await summarizeWithLLM(droppedMessages, [], 'claude-sonnet-4');

      // Should not throw, and should produce a summary
      expect(result.summaryMessage).toBeDefined();
    });

    it('should handle messages with string content (non-array)', async () => {
      const droppedMessages = [
        { role: 'user', content: 'Just a plain string' },
        { role: 'assistant', content: 'Reply as string' },
      ];

      const result = await summarizeWithLLM(droppedMessages, [], 'claude-sonnet-4');

      // Should not throw
      expect(result.summaryMessage).toBeDefined();
    });

    it('summary message includes continuation instructions', async () => {
      const result = await summarizeWithLLM([], [], 'claude-sonnet-4');

      const text = result.summaryMessage.content[0].text;
      expect(text).toContain('continue the conversation');
      expect(text).toContain('without asking the user');
    });
  });

  describe('getRecommendedOptions - various models', () => {
    it('should return maxTokens at 75% of context limit', () => {
      const opts = getRecommendedOptions('claude-opus-4');
      expect(opts.maxTokens).toBe(Math.floor(200000 * 0.75));
    });

    it('should return correct options for Ollama llama models', () => {
      const opts = getRecommendedOptions('ollama:llama3.1');
      expect(opts.maxTokens).toBe(Math.floor(128000 * 0.75));
      expect(opts.strategy).toBe('smart');
    });

    it('should return correct options for unknown models (uses default)', () => {
      const opts = getRecommendedOptions('totally-unknown-model');
      expect(opts.maxTokens).toBe(Math.floor(200000 * 0.75));
    });
  });
});
