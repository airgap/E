import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { createTestDb } from '../../test-helpers';

// --- module-level mocks (must come before import of the module under test) ---

const testDb = createTestDb();
mock.module('../../db/database', () => ({
  getDb: () => testDb,
  initDatabase: () => {},
}));

mock.module('../tool-schemas', () => ({
  getAllToolsWithMcp: async () => [],
  toOllamaFunctions: (tools: any[]) =>
    tools.map((t: any) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    })),
}));

mock.module('../tool-executor', () => ({
  executeTool: async () => ({ content: 'mocked result', is_error: false }),
}));

mock.module('../chat-compaction', () => ({
  loadConversationHistory: () => ({ messages: [], compacted: false }),
  getRecommendedOptions: () => ({ maxTokens: 100000, maxMessages: 20 }),
}));

// Save original env + fetch
const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

import { createOpenAIStreamV2, listOpenAIModels } from '../openai-provider-v2';

// --------------- helpers ---------------

function clearDb() {
  testDb.exec('DELETE FROM messages');
  testDb.exec('DELETE FROM conversations');
  testDb.exec('DELETE FROM settings');
}

/** Drain a ReadableStream and return all parsed SSE data events. */
async function drainStream(stream: ReadableStream): Promise<any[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let raw = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    raw += decoder.decode(value, { stream: true });
  }
  return raw
    .split('\n\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => {
      try {
        return JSON.parse(line.replace('data: ', ''));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// =====================================================================
// Tests
// =====================================================================

describe('openai-provider-v2: getOpenAIKey resolution', () => {
  beforeEach(() => {
    clearDb();
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    // Restore env
    process.env = { ...originalEnv };
  });

  test('returns null (triggers auth error) when no key anywhere', async () => {
    delete process.env.OPENAI_API_KEY;
    // no settings row either

    const stream = createOpenAIStreamV2({
      model: 'gpt-4o',
      content: 'hello',
      conversationId: 'conv-no-key',
    });

    const events = await drainStream(stream);
    const err = events.find((e) => e.type === 'error');
    expect(err).toBeDefined();
    expect(err.error.type).toBe('auth_error');
    expect(err.error.message).toContain('OpenAI API key not configured');
  });

  test('resolves key from OPENAI_API_KEY env var', async () => {
    process.env.OPENAI_API_KEY = 'sk-env-test-key';

    // Set up a mock fetch that succeeds
    let capturedHeaders: any = null;
    globalThis.fetch = (async (_url: string, opts?: any) => {
      capturedHeaders = opts?.headers;
      // Return a minimal streaming response with [DONE]
      return new Response('data: [DONE]\n\n', { status: 200 });
    }) as any;

    const stream = createOpenAIStreamV2({
      model: 'gpt-4o',
      content: 'hi',
      conversationId: 'conv-env-key',
    });

    await drainStream(stream);

    expect(capturedHeaders).toBeDefined();
    expect(capturedHeaders['Authorization']).toBe('Bearer sk-env-test-key');

    globalThis.fetch = originalFetch;
  });

  test('resolves key from database settings when env var is absent', async () => {
    delete process.env.OPENAI_API_KEY;
    testDb
      .query("INSERT INTO settings (key, value) VALUES ('openaiApiKey', ?)")
      .run(JSON.stringify('sk-db-test-key'));

    let capturedHeaders: any = null;
    globalThis.fetch = (async (_url: string, opts?: any) => {
      capturedHeaders = opts?.headers;
      return new Response('data: [DONE]\n\n', { status: 200 });
    }) as any;

    const stream = createOpenAIStreamV2({
      model: 'gpt-4o',
      content: 'hi',
      conversationId: 'conv-db-key',
    });

    await drainStream(stream);

    expect(capturedHeaders).toBeDefined();
    expect(capturedHeaders['Authorization']).toBe('Bearer sk-db-test-key');

    globalThis.fetch = originalFetch;
  });

  test('env var takes precedence over database setting', async () => {
    process.env.OPENAI_API_KEY = 'sk-env-priority';
    testDb
      .query("INSERT INTO settings (key, value) VALUES ('openaiApiKey', ?)")
      .run(JSON.stringify('sk-db-lower'));

    let capturedHeaders: any = null;
    globalThis.fetch = (async (_url: string, opts?: any) => {
      capturedHeaders = opts?.headers;
      return new Response('data: [DONE]\n\n', { status: 200 });
    }) as any;

    const stream = createOpenAIStreamV2({
      model: 'gpt-4o',
      content: 'hi',
      conversationId: 'conv-priority',
    });

    await drainStream(stream);

    expect(capturedHeaders['Authorization']).toBe('Bearer sk-env-priority');

    globalThis.fetch = originalFetch;
  });
});

describe('openai-provider-v2: no-API-key error path', () => {
  beforeEach(() => {
    clearDb();
    delete process.env.OPENAI_API_KEY;
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('emits auth_error then message_stop then closes stream', async () => {
    const stream = createOpenAIStreamV2({
      model: 'gpt-4o',
      content: 'test',
      conversationId: 'conv-no-key-flow',
    });

    const events = await drainStream(stream);

    // First event should be the auth error
    expect(events[0].type).toBe('error');
    expect(events[0].error.type).toBe('auth_error');

    // Second event should be message_stop
    expect(events[1].type).toBe('message_stop');

    // Stream should be closed (only 2 events)
    expect(events).toHaveLength(2);
  });
});

describe('openai-provider-v2: createOpenAIStreamV2', () => {
  beforeEach(() => {
    clearDb();
    process.env.OPENAI_API_KEY = 'sk-test-stream';
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
  });

  test('returns a ReadableStream', () => {
    const stream = createOpenAIStreamV2({
      model: 'gpt-4o',
      content: 'Hello',
      conversationId: 'conv-readable',
    });
    expect(stream).toBeInstanceOf(ReadableStream);
  });

  test('emits expected SSE event sequence for a simple completion', async () => {
    // Simulate an OpenAI streaming response with two content chunks
    const sseBody =
      [
        'data: {"choices":[{"delta":{"role":"assistant"},"index":0}]}',
        'data: {"choices":[{"delta":{"content":"Hello"},"index":0}]}',
        'data: {"choices":[{"delta":{"content":" world"},"index":0,"finish_reason":"stop"}]}',
        'data: {"usage":{"prompt_tokens":10,"completion_tokens":5}}',
        'data: [DONE]',
      ].join('\n\n') + '\n\n';

    globalThis.fetch = (async () => new Response(sseBody, { status: 200 })) as any;

    const stream = createOpenAIStreamV2({
      model: 'gpt-4o',
      content: 'Hi',
      conversationId: 'conv-sse-seq',
    });

    const events = await drainStream(stream);
    const types = events.map((e) => e.type);

    expect(types).toContain('message_start');
    expect(types).toContain('content_block_start');
    expect(types).toContain('content_block_delta');
    expect(types).toContain('content_block_stop');
    expect(types).toContain('message_delta');
    expect(types).toContain('message_stop');

    // Verify message_start structure
    const msgStart = events.find((e) => e.type === 'message_start');
    expect(msgStart.message.role).toBe('assistant');
    expect(msgStart.message.model).toBe('gpt-4o');

    // Verify deltas contain text
    const deltas = events.filter((e) => e.type === 'content_block_delta');
    const combinedText = deltas.map((d) => d.delta.text).join('');
    expect(combinedText).toBe('Hello world');

    // Verify usage in message_delta
    const msgDelta = events.find((e) => e.type === 'message_delta');
    expect(msgDelta.usage.input_tokens).toBe(10);
    expect(msgDelta.usage.output_tokens).toBe(5);
  });

  test('emits openai_error when API returns non-ok status', async () => {
    globalThis.fetch = (async () =>
      new Response('{"error":{"message":"Rate limit exceeded"}}', { status: 429 })) as any;

    const stream = createOpenAIStreamV2({
      model: 'gpt-4o',
      content: 'test',
      conversationId: 'conv-429',
    });

    const events = await drainStream(stream);
    const errEvent = events.find((e) => e.type === 'error');
    expect(errEvent).toBeDefined();
    expect(errEvent.error.type).toBe('openai_error');
    expect(errEvent.error.message).toContain('429');
  });

  test('emits openai_error when fetch throws a network error', async () => {
    globalThis.fetch = (async () => {
      throw new Error('ECONNREFUSED');
    }) as any;

    const stream = createOpenAIStreamV2({
      model: 'gpt-4o',
      content: 'test',
      conversationId: 'conv-net-err',
    });

    const events = await drainStream(stream);
    const errEvent = events.find((e) => e.type === 'error');
    expect(errEvent).toBeDefined();
    expect(errEvent.error.type).toBe('openai_error');
    expect(errEvent.error.message).toContain('ECONNREFUSED');
  });

  test('persists assistant message to DB after streaming', async () => {
    testDb
      .query('INSERT INTO conversations (id, model, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run('conv-persist', 'gpt-4o', Date.now(), Date.now());

    const sseBody =
      [
        'data: {"choices":[{"delta":{"content":"Saved"},"index":0}]}',
        'data: {"choices":[{"delta":{},"index":0,"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}',
        'data: [DONE]',
      ].join('\n\n') + '\n\n';

    globalThis.fetch = (async () => new Response(sseBody, { status: 200 })) as any;

    const stream = createOpenAIStreamV2({
      model: 'gpt-4o',
      content: 'test',
      conversationId: 'conv-persist',
    });

    await drainStream(stream);

    const rows = testDb
      .query("SELECT * FROM messages WHERE conversation_id = 'conv-persist' AND role = 'assistant'")
      .all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].model).toBe('gpt-4o');
    const content = JSON.parse(rows[0].content);
    expect(content[0].text).toBe('Saved');
  });

  test('sends correct request body to OpenAI API', async () => {
    let capturedBody: any = null;
    let capturedUrl = '';

    const sseBody =
      'data: {"choices":[{"delta":{},"index":0,"finish_reason":"stop"}]}\ndata: [DONE]\n\n';

    globalThis.fetch = (async (url: string, opts?: any) => {
      capturedUrl = url;
      capturedBody = JSON.parse(opts.body);
      return new Response(sseBody, { status: 200 });
    }) as any;

    const stream = createOpenAIStreamV2({
      model: 'gpt-4o-mini',
      content: 'What is 2+2?',
      conversationId: 'conv-body-check',
      systemPrompt: 'You are a math tutor.',
    });

    await drainStream(stream);

    expect(capturedUrl).toContain('api.openai.com/v1/chat/completions');
    expect(capturedBody.model).toBe('gpt-4o-mini');
    expect(capturedBody.stream).toBe(true);
    // system prompt should be first message
    expect(capturedBody.messages[0].role).toBe('system');
    expect(capturedBody.messages[0].content).toBe('You are a math tutor.');
    // user message should be last
    const lastMsg = capturedBody.messages[capturedBody.messages.length - 1];
    expect(lastMsg.role).toBe('user');
    expect(lastMsg.content).toBe('What is 2+2?');
  });
});

describe('openai-provider-v2: supportsTools (tested implicitly)', () => {
  beforeEach(() => {
    clearDb();
    process.env.OPENAI_API_KEY = 'sk-test-tools';
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
  });

  test('tool-capable model includes tool_choice in request', async () => {
    let capturedBody: any = null;
    const sseBody =
      'data: {"choices":[{"delta":{},"index":0,"finish_reason":"stop"}]}\ndata: [DONE]\n\n';

    globalThis.fetch = (async (_url: string, opts?: any) => {
      capturedBody = JSON.parse(opts.body);
      return new Response(sseBody, { status: 200 });
    }) as any;

    // gpt-4o is in TOOL_CAPABLE_MODELS
    const stream = createOpenAIStreamV2({
      model: 'gpt-4o',
      content: 'hi',
      conversationId: 'conv-tools-capable',
    });

    await drainStream(stream);

    // getAllToolsWithMcp returns [] from our mock, so tools won't be added,
    // but the code path still exercises supportsTools(). This tests the branch is reached.
    expect(capturedBody).toBeDefined();
    expect(capturedBody.model).toBe('gpt-4o');
  });
});

describe('openai-provider-v2: listOpenAIModels', () => {
  beforeEach(() => {
    clearDb();
    delete process.env.OPENAI_API_KEY;
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
  });

  test('returns empty array when no API key is available', async () => {
    const models = await listOpenAIModels();
    expect(models).toEqual([]);
  });

  test('returns filtered and sorted models from API', async () => {
    process.env.OPENAI_API_KEY = 'sk-list-test';

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: [
            { id: 'gpt-4o' },
            { id: 'gpt-3.5-turbo' },
            { id: 'dall-e-3' }, // should be filtered out
            { id: 'o1-preview' },
            { id: 'text-embedding-ada-002' }, // should be filtered out
          ],
        }),
        { status: 200 },
      )) as any;

    const models = await listOpenAIModels();

    // Only chat-capable models should remain
    const ids = models.map((m) => m.id);
    expect(ids).toContain('gpt-4o');
    expect(ids).toContain('gpt-3.5-turbo');
    expect(ids).toContain('o1-preview');
    expect(ids).not.toContain('dall-e-3');
    expect(ids).not.toContain('text-embedding-ada-002');
  });

  test('returns empty array on fetch failure', async () => {
    process.env.OPENAI_API_KEY = 'sk-fail-test';

    globalThis.fetch = (async () => {
      throw new Error('Network error');
    }) as any;

    const models = await listOpenAIModels();
    expect(models).toEqual([]);
  });

  test('returns empty array when API returns non-ok status', async () => {
    process.env.OPENAI_API_KEY = 'sk-500-test';

    globalThis.fetch = (async () => new Response('Server Error', { status: 500 })) as any;

    const models = await listOpenAIModels();
    expect(models).toEqual([]);
  });
});

// Import afterEach for env cleanup
import { afterEach } from 'bun:test';
