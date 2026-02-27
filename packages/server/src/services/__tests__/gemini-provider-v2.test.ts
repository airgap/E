import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { createTestDb } from '../../test-helpers';

// --- module-level mocks (must come before import of the module under test) ---

const testDb = createTestDb();
mock.module('../../db/database', () => ({
  getDb: () => testDb,
  initDatabase: () => {},
}));

mock.module('../tool-schemas', () => ({
  getAllToolsWithMcp: async () => [],
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

import { createGeminiStreamV2, listGeminiModels } from '../gemini-provider-v2';

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

describe('gemini-provider-v2: getGeminiKey resolution', () => {
  beforeEach(() => {
    clearDb();
    delete process.env.GOOGLE_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
  });

  test('returns null (triggers auth error) when no key anywhere', async () => {
    delete process.env.GOOGLE_API_KEY;

    const stream = createGeminiStreamV2({
      model: 'gemini-2.0-flash',
      content: 'hello',
      conversationId: 'conv-no-key',
    });

    const events = await drainStream(stream);
    const err = events.find((e) => e.type === 'error');
    expect(err).toBeDefined();
    expect(err.error.type).toBe('auth_error');
    expect(err.error.message).toContain('Google API key not configured');
  });

  test('resolves key from GOOGLE_API_KEY env var', async () => {
    process.env.GOOGLE_API_KEY = 'AIza-env-test-key';

    let capturedUrl = '';
    globalThis.fetch = (async (url: string) => {
      capturedUrl = url;
      // Return a minimal Gemini streaming response
      return new Response(
        'data: {"candidates":[{"content":{"parts":[{"text":"hi"}]}}]}\n\ndata: [DONE]\n\n',
        { status: 200 },
      );
    }) as any;

    const stream = createGeminiStreamV2({
      model: 'gemini-2.0-flash',
      content: 'hi',
      conversationId: 'conv-env-key',
    });

    await drainStream(stream);

    expect(capturedUrl).toContain('key=AIza-env-test-key');
  });

  test('resolves key from database settings when env var is absent', async () => {
    delete process.env.GOOGLE_API_KEY;
    testDb
      .query("INSERT INTO settings (key, value) VALUES ('googleApiKey', ?)")
      .run(JSON.stringify('AIza-db-test-key'));

    let capturedUrl = '';
    globalThis.fetch = (async (url: string) => {
      capturedUrl = url;
      return new Response(
        'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}\n\ndata: [DONE]\n\n',
        { status: 200 },
      );
    }) as any;

    const stream = createGeminiStreamV2({
      model: 'gemini-2.0-flash',
      content: 'hi',
      conversationId: 'conv-db-key',
    });

    await drainStream(stream);

    expect(capturedUrl).toContain('key=AIza-db-test-key');
  });

  test('env var takes precedence over database setting', async () => {
    process.env.GOOGLE_API_KEY = 'AIza-env-priority';
    testDb
      .query("INSERT INTO settings (key, value) VALUES ('googleApiKey', ?)")
      .run(JSON.stringify('AIza-db-lower'));

    let capturedUrl = '';
    globalThis.fetch = (async (url: string) => {
      capturedUrl = url;
      return new Response(
        'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}\n\ndata: [DONE]\n\n',
        { status: 200 },
      );
    }) as any;

    const stream = createGeminiStreamV2({
      model: 'gemini-2.0-flash',
      content: 'hi',
      conversationId: 'conv-priority',
    });

    await drainStream(stream);

    expect(capturedUrl).toContain('key=AIza-env-priority');
    expect(capturedUrl).not.toContain('AIza-db-lower');
  });
});

describe('gemini-provider-v2: no-API-key error path', () => {
  beforeEach(() => {
    clearDb();
    delete process.env.GOOGLE_API_KEY;
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('emits auth_error then message_stop then closes stream', async () => {
    const stream = createGeminiStreamV2({
      model: 'gemini-2.0-flash',
      content: 'test',
      conversationId: 'conv-no-key-flow',
    });

    const events = await drainStream(stream);

    expect(events[0].type).toBe('error');
    expect(events[0].error.type).toBe('auth_error');

    expect(events[1].type).toBe('message_stop');

    // Stream should be closed (only 2 events)
    expect(events).toHaveLength(2);
  });
});

describe('gemini-provider-v2: createGeminiStreamV2', () => {
  beforeEach(() => {
    clearDb();
    process.env.GOOGLE_API_KEY = 'AIza-test-stream';
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
  });

  test('returns a ReadableStream', () => {
    const stream = createGeminiStreamV2({
      model: 'gemini-2.0-flash',
      content: 'Hello',
      conversationId: 'conv-readable',
    });
    expect(stream).toBeInstanceOf(ReadableStream);
  });

  test('emits expected SSE event sequence for a simple completion', async () => {
    const sseBody =
      [
        'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}',
        'data: {"candidates":[{"content":{"parts":[{"text":" world"}]}}],"usageMetadata":{"promptTokenCount":8,"candidatesTokenCount":4}}',
      ].join('\n\n') + '\n\n';

    globalThis.fetch = (async () => new Response(sseBody, { status: 200 })) as any;

    const stream = createGeminiStreamV2({
      model: 'gemini-2.0-flash',
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
    expect(msgStart.message.model).toBe('gemini-2.0-flash');

    // Verify deltas contain text
    const deltas = events.filter((e) => e.type === 'content_block_delta');
    const combinedText = deltas.map((d) => d.delta.text).join('');
    expect(combinedText).toBe('Hello world');

    // Verify usage in message_delta
    const msgDelta = events.find((e) => e.type === 'message_delta');
    expect(msgDelta.usage.input_tokens).toBe(8);
    expect(msgDelta.usage.output_tokens).toBe(4);
  });

  test('emits gemini_error when API returns non-ok status', async () => {
    globalThis.fetch = (async () =>
      new Response('{"error":{"message":"Quota exceeded"}}', { status: 429 })) as any;

    const stream = createGeminiStreamV2({
      model: 'gemini-2.0-flash',
      content: 'test',
      conversationId: 'conv-429',
    });

    const events = await drainStream(stream);
    const errEvent = events.find((e) => e.type === 'error');
    expect(errEvent).toBeDefined();
    expect(errEvent.error.type).toBe('gemini_error');
    expect(errEvent.error.message).toContain('429');
  });

  test('emits gemini_error when fetch throws a network error', async () => {
    globalThis.fetch = (async () => {
      throw new Error('ECONNREFUSED');
    }) as any;

    const stream = createGeminiStreamV2({
      model: 'gemini-2.0-flash',
      content: 'test',
      conversationId: 'conv-net-err',
    });

    const events = await drainStream(stream);
    const errEvent = events.find((e) => e.type === 'error');
    expect(errEvent).toBeDefined();
    expect(errEvent.error.type).toBe('gemini_error');
    expect(errEvent.error.message).toContain('ECONNREFUSED');
  });

  test('persists assistant message to DB after streaming', async () => {
    testDb
      .query('INSERT INTO conversations (id, model, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run('conv-persist', 'gemini-2.0-flash', Date.now(), Date.now());

    const sseBody =
      [
        'data: {"candidates":[{"content":{"parts":[{"text":"Saved"}]}}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":2}}',
      ].join('\n\n') + '\n\n';

    globalThis.fetch = (async () => new Response(sseBody, { status: 200 })) as any;

    const stream = createGeminiStreamV2({
      model: 'gemini-2.0-flash',
      content: 'test',
      conversationId: 'conv-persist',
    });

    await drainStream(stream);

    const rows = testDb
      .query("SELECT * FROM messages WHERE conversation_id = 'conv-persist' AND role = 'assistant'")
      .all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].model).toBe('gemini-2.0-flash');
    const content = JSON.parse(rows[0].content);
    expect(content[0].text).toBe('Saved');
    expect(rows[0].token_count).toBe(7); // 5 + 2
  });

  test('sends correct request body to Gemini API', async () => {
    let capturedBody: any = null;
    let capturedUrl = '';

    const sseBody = 'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}\n\n';

    globalThis.fetch = (async (url: string, opts?: any) => {
      capturedUrl = url;
      capturedBody = JSON.parse(opts.body);
      return new Response(sseBody, { status: 200 });
    }) as any;

    const stream = createGeminiStreamV2({
      model: 'gemini-2.0-flash',
      content: 'What is 2+2?',
      conversationId: 'conv-body-check',
      systemPrompt: 'You are a math tutor.',
    });

    await drainStream(stream);

    // URL should include the model name and key
    expect(capturedUrl).toContain('models/gemini-2.0-flash:streamGenerateContent');
    expect(capturedUrl).toContain('alt=sse');
    expect(capturedUrl).toContain('key=AIza-test-stream');

    // Body should have contents array with user message
    expect(capturedBody.contents).toBeDefined();
    const lastContent = capturedBody.contents[capturedBody.contents.length - 1];
    expect(lastContent.role).toBe('user');
    expect(lastContent.parts[0].text).toBe('What is 2+2?');

    // System prompt should be in systemInstruction
    expect(capturedBody.systemInstruction).toBeDefined();
    expect(capturedBody.systemInstruction.parts[0].text).toBe('You are a math tutor.');

    // Generation config
    expect(capturedBody.generationConfig).toBeDefined();
    expect(capturedBody.generationConfig.temperature).toBe(0.7);
  });

  test('includes inline images when provided', async () => {
    let capturedBody: any = null;

    const sseBody = 'data: {"candidates":[{"content":{"parts":[{"text":"I see an image"}]}}]}\n\n';

    globalThis.fetch = (async (_url: string, opts?: any) => {
      capturedBody = JSON.parse(opts.body);
      return new Response(sseBody, { status: 200 });
    }) as any;

    const stream = createGeminiStreamV2({
      model: 'gemini-2.0-flash',
      content: 'Describe this image',
      conversationId: 'conv-images',
      images: [{ mediaType: 'image/png', data: 'iVBORw0KGgo=' }],
    });

    await drainStream(stream);

    const lastContent = capturedBody.contents[capturedBody.contents.length - 1];
    expect(lastContent.parts).toHaveLength(2);
    expect(lastContent.parts[0].text).toBe('Describe this image');
    expect(lastContent.parts[1].inlineData.mimeType).toBe('image/png');
    expect(lastContent.parts[1].inlineData.data).toBe('iVBORw0KGgo=');
  });
});

describe('gemini-provider-v2: toGeminiFunctionDeclarations (tested implicitly via stream)', () => {
  // toGeminiFunctionDeclarations is not exported, but we can test its behavior by
  // providing tools via the mock and checking the request body.
  // Since our mock returns [], the function declarations array will be empty and
  // tools won't be included in the body. We test the no-tools path here.

  beforeEach(() => {
    clearDb();
    process.env.GOOGLE_API_KEY = 'AIza-test-fn';
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
  });

  test('does not include tools when no tools are available', async () => {
    let capturedBody: any = null;

    const sseBody = 'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}\n\n';

    globalThis.fetch = (async (_url: string, opts?: any) => {
      capturedBody = JSON.parse(opts.body);
      return new Response(sseBody, { status: 200 });
    }) as any;

    const stream = createGeminiStreamV2({
      model: 'gemini-2.0-flash',
      content: 'hi',
      conversationId: 'conv-no-tools',
    });

    await drainStream(stream);

    // With empty tools array, the body should NOT have a tools field
    expect(capturedBody.tools).toBeUndefined();
  });
});

describe('gemini-provider-v2: listGeminiModels', () => {
  beforeEach(() => {
    clearDb();
    delete process.env.GOOGLE_API_KEY;
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
  });

  test('returns empty array when no API key is available', async () => {
    const models = await listGeminiModels();
    expect(models).toEqual([]);
  });

  test('returns filtered models that support generateContent', async () => {
    process.env.GOOGLE_API_KEY = 'AIza-list-test';

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          models: [
            {
              name: 'models/gemini-2.0-flash',
              displayName: 'Gemini 2.0 Flash',
              supportedGenerationMethods: ['generateContent', 'countTokens'],
            },
            {
              name: 'models/gemini-1.5-pro',
              displayName: 'Gemini 1.5 Pro',
              supportedGenerationMethods: ['generateContent'],
            },
            {
              name: 'models/text-embedding-004',
              displayName: 'Text Embedding',
              supportedGenerationMethods: ['embedContent'],
            },
          ],
        }),
        { status: 200 },
      )) as any;

    const models = await listGeminiModels();

    const ids = models.map((m) => m.id);
    expect(ids).toContain('gemini-2.0-flash');
    expect(ids).toContain('gemini-1.5-pro');
    expect(ids).not.toContain('text-embedding-004');

    // Check display name mapping
    const flash = models.find((m) => m.id === 'gemini-2.0-flash');
    expect(flash?.name).toBe('Gemini 2.0 Flash');
  });

  test('returns empty array on fetch failure', async () => {
    process.env.GOOGLE_API_KEY = 'AIza-fail-test';

    globalThis.fetch = (async () => {
      throw new Error('Network error');
    }) as any;

    const models = await listGeminiModels();
    expect(models).toEqual([]);
  });

  test('returns empty array when API returns non-ok status', async () => {
    process.env.GOOGLE_API_KEY = 'AIza-500-test';

    globalThis.fetch = (async () => new Response('Server Error', { status: 500 })) as any;

    const models = await listGeminiModels();
    expect(models).toEqual([]);
  });
});
