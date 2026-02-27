# Chat Compaction

## Overview

Chat compaction is a system for managing conversation history length to prevent context window overflow. As conversations grow longer, older messages are summarized or removed while preserving important context.

## Why Compaction?

**Problem**: Long conversations can exceed model context windows, causing:

- Request failures due to token limits
- Slower responses as context grows
- Higher costs for processing unnecessary history

**Solution**: Automatically compact conversation history by:

- Keeping recent messages with full content
- Summarizing or removing older messages
- Preserving important context (tool use, system messages)
- Respecting provider-specific context limits

## Features

✅ **Automatic Compaction** - Triggers when conversations approach context limits
✅ **Multiple Strategies** - Sliding window, token-based, or smart compaction
✅ **Context Preservation** - Always keeps tool use and system messages
✅ **Summary Generation** - Creates concise summaries of removed content
✅ **Provider-Aware** - Respects different context windows (Claude: 200K, Llama: 128K, etc.)
✅ **Manual Control** - API endpoints for on-demand compaction
✅ **Client Notifications** - Informs users when compaction occurs

## Compaction Strategies

### 1. Sliding Window (`sliding-window`)

Keeps the last N messages, discards older ones.

**Best for**: Simple conversations where recent context is most important

**Parameters**:

- `maxMessages`: Number of messages to keep (default: 20)

**Example**:

```typescript
{
  strategy: 'sliding-window',
  maxMessages: 20,
  createSummary: true
}
```

### 2. Token-Based (`token-based`)

Keeps recent messages until token limit is reached.

**Best for**: Respecting strict token budgets

**Parameters**:

- `maxTokens`: Maximum tokens to retain (default: 100,000)

**Example**:

```typescript
{
  strategy: 'token-based',
  maxTokens: 50000,
  createSummary: true
}
```

### 3. Smart Compaction (`smart`) **[RECOMMENDED]**

Intelligently preserves important messages while removing less critical ones.

**Best for**: Production use - balances context quality with token efficiency

**Logic**:

1. Always preserve system messages
2. Always preserve tool use/result pairs (if `preserveToolUse: true`)
3. Fill remaining space with recent messages
4. Create summary of removed content

**Parameters**:

- `maxTokens`: Maximum tokens to retain (default: 100,000)
- `preserveToolUse`: Keep tool-related messages (default: true)

**Example**:

```typescript
{
  strategy: 'smart',
  maxTokens: 100000,
  preserveToolUse: true,
  createSummary: true
}
```

## Context Limits by Provider

| Provider    | Model      | Context Limit | Recommended Max Tokens (75%) |
| ----------- | ---------- | ------------- | ---------------------------- |
| **Claude**  | Opus 4     | 200,000       | 150,000                      |
| **Claude**  | Sonnet 3.5 | 200,000       | 150,000                      |
| **Claude**  | Haiku 3    | 200,000       | 150,000                      |
| **Ollama**  | llama3.1   | 128,000       | 96,000                       |
| **Ollama**  | llama3.2   | 128,000       | 96,000                       |
| **Ollama**  | qwen2.5    | 32,000        | 24,000                       |
| **Ollama**  | mistral    | 32,000        | 24,000                       |
| **Default** | Unknown    | 100,000       | 75,000                       |

## How It Works

### Automatic Compaction (Bedrock & Ollama V2)

1. **Provider loads conversation**

   ```typescript
   const compactionOptions = getRecommendedOptions(`bedrock:${opts.model}`);
   const history = loadConversationHistory(opts.conversationId, compactionOptions);
   ```

2. **Compaction decision**
   - If total tokens > 75% of context limit → compact
   - Otherwise → use full history

3. **Compaction process**
   - Separate important messages (system, tool use)
   - Keep recent messages up to token limit
   - Summarize removed messages
   - Create summary message

4. **Client notification**
   ```json
   {
     "type": "compaction_info",
     "original_count": 50,
     "compacted_count": 20,
     "tokens_removed": 25000,
     "summary": "[Previous conversation summary: User discussed file operations...]"
   }
   ```

### Manual Compaction (API)

Check if compaction is needed:

```bash
GET /api/compaction/:conversationId/status
```

Response:

```json
{
  "ok": true,
  "needs_compaction": true,
  "original_count": 50,
  "compacted_count": 20,
  "tokens_removed": 25000,
  "context_limit": 200000,
  "recommended_max_tokens": 150000
}
```

Preview compaction without persisting:

```bash
POST /api/compaction/:conversationId/compact
{
  "strategy": "smart",
  "maxTokens": 100000,
  "preserveToolUse": true,
  "createSummary": true
}
```

Apply compaction to database:

```bash
POST /api/compaction/:conversationId/apply
{
  "strategy": "smart",
  "maxTokens": 100000
}
```

## Token Estimation

The system uses a simple estimation: **1 token ≈ 4 characters**

This is a rough approximation. For production use, consider integrating:

- `tiktoken` for OpenAI-style tokenization
- `anthropic-tokenizer` for Claude-specific counting

## Examples

### Example 1: Long Conversation with Tool Use

**Before compaction (50 messages, ~150K tokens)**:

```
[user] Read config.json
[assistant] <tool_use: Read>
[user] <tool_result: {...}>
[assistant] The config shows...
... 46 more messages ...
```

**After smart compaction (21 messages, ~75K tokens)**:

```
[user] [Previous conversation summary: User read config files and asked about settings (3 tool operations). Assistant explained configuration options...]
[user] Read config.json
[assistant] <tool_use: Read>  ← Preserved (tool use)
[user] <tool_result: {...}>    ← Preserved (tool result)
[assistant] The config shows... ← Preserved (tool result)
... recent 16 messages ...
```

**Savings**: 29 messages removed, ~75K tokens saved

### Example 2: Sliding Window for Simple Chat

**Before** (30 messages):

```
[user] Hello
[assistant] Hi!
[user] What's the weather?
[assistant] I don't have weather data
... 26 more messages ...
```

**After sliding window (maxMessages: 10)**:

```
[user] [Previous conversation summary: User greeted and asked about weather...]
... last 10 messages ...
```

## Best Practices

### 1. Use Smart Strategy for Production

```typescript
const options = getRecommendedOptions(model);
// Returns: { strategy: 'smart', maxTokens: <75% of limit>, preserveToolUse: true }
```

### 2. Monitor Compaction Events

Listen for `compaction_info` events in the SSE stream:

```typescript
stream.addEventListener('message', (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'compaction_info') {
    console.log(`Compacted: ${data.original_count} → ${data.compacted_count} messages`);
    console.log(`Summary: ${data.summary}`);
  }
});
```

### 3. Preserve Tool Use for Debugging

Always set `preserveToolUse: true` when using tools:

```typescript
{
  strategy: 'smart',
  preserveToolUse: true,  // Keep tool execution history
  createSummary: true
}
```

### 4. Adjust for Model Context Windows

Smaller models need more aggressive compaction:

```typescript
// qwen2.5 (32K context) - compact more aggressively
const options = getRecommendedOptions('ollama:qwen2.5');
// Returns maxTokens: 24000 (75% of 32000)

// Claude Opus (200K context) - less aggressive
const options = getRecommendedOptions('claude-opus-4');
// Returns maxTokens: 150000 (75% of 200000)
```

### 5. Manual Compaction for Long-Running Conversations

For conversations that will run for hours/days:

```typescript
// Periodically check and compact
const status = await fetch(`/api/compaction/${convId}/status`);
if (status.needs_compaction) {
  await fetch(`/api/compaction/${convId}/apply`, {
    method: 'POST',
    body: JSON.stringify({ strategy: 'smart' }),
  });
}
```

## Summary Message Format

When `createSummary: true`, a summary message is prepended:

```
[user] [Previous conversation summary: User discussed file operations and database queries. Assistant provided code examples and debugging help (5 tool operations were performed). User asked about performance optimization...]
```

This helps the model understand prior context without including full message history.

## Performance Considerations

### Token Counting Overhead

- **Current**: Simple character-based estimation (~1ms per message)
- **Impact**: Negligible for most conversations (<100 messages)

### Compaction Speed

- **Sliding window**: O(n) - very fast
- **Token-based**: O(n) - fast (single pass)
- **Smart**: O(n²) - acceptable for <1000 messages

### Database Impact

- **Loading**: Single query for all messages
- **Applying**: Deletes + bulk inserts (transactional)

## Troubleshooting

### Messages Not Compacting

**Issue**: Conversation still has many messages after compaction

**Causes**:

- All messages are marked important (system/tool use)
- Token limit is too high
- Messages are actually within limit

**Solution**:

```bash
# Check status
curl /api/compaction/:convId/status

# Try more aggressive options
curl -X POST /api/compaction/:convId/compact \
  -d '{"strategy": "token-based", "maxTokens": 10000}'
```

### Tool Use Context Lost

**Issue**: Model forgets tool execution results

**Cause**: `preserveToolUse: false`

**Solution**:

```typescript
{
  strategy: 'smart',
  preserveToolUse: true  // Always true for tool-calling conversations
}
```

### Compaction Too Aggressive

**Issue**: Losing important context

**Solution**:

```typescript
// Increase token limit
{
  strategy: 'smart',
  maxTokens: 200000,  // Use more of context window
  preserveToolUse: true
}

// Or use sliding window with more messages
{
  strategy: 'sliding-window',
  maxMessages: 50  // Keep more history
}
```

## Future Enhancements

- [ ] Semantic summarization using LLM
- [ ] User-controlled retention rules
- [ ] Per-conversation compaction preferences
- [ ] Automatic re-compaction when approaching limits
- [ ] Compaction metrics and analytics
- [ ] Real token counting (tiktoken/anthropic-tokenizer)
- [ ] Compression ratio optimization

## Related

- [Tool Calling Implementation](./tool-calling-implementation.md)
- [MCP Integration](./mcp-integration.md)
- [Provider Feature Matrix](./provider-feature-matrix.md)
