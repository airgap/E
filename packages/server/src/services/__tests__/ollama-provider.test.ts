import { describe, test, expect, beforeEach, mock, spyOn } from 'bun:test';
import { createTestDb } from '../../test-helpers';

const testDb = createTestDb();
mock.module('../../db/database', () => ({
  getDb: () => testDb,
  initDatabase: () => {},
}));

// Save original fetch so we can restore it
const originalFetch = globalThis.fetch;

import { listOllamaModels, checkOllamaHealth, createOllamaStream } from '../ollama-provider';

function clearDb() {
  testDb.exec('DELETE FROM messages');
  testDb.exec('DELETE FROM conversations');
}

describe('listOllamaModels', () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('returns parsed models from Ollama API', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          models: [
            { name: 'llama3:latest', size: 4_000_000_000, modified_at: '2025-01-01T00:00:00Z' },
            { name: 'mistral:7b', size: 7_000_000_000, modified_at: '2025-02-01T00:00:00Z' },
          ],
        }),
        { status: 200 },
      )) as any;

    const models = await listOllamaModels();
    expect(models).toHaveLength(2);
    expect(models[0]).toEqual({
      name: 'llama3:latest',
      size: 4_000_000_000,
      modified_at: '2025-01-01T00:00:00Z',
    });
    expect(models[1]).toEqual({
      name: 'mistral:7b',
      size: 7_000_000_000,
      modified_at: '2025-02-01T00:00:00Z',
    });
  });

  test('returns empty array when API returns non-ok status', async () => {
    globalThis.fetch = (async () => new Response('Server Error', { status: 500 })) as any;

    const models = await listOllamaModels();
    expect(models).toEqual([]);
  });

  test('returns empty array on fetch error (network failure)', async () => {
    globalThis.fetch = (async () => {
      throw new Error('Connection refused');
    }) as any;

    const models = await listOllamaModels();
    expect(models).toEqual([]);
  });

  test('returns empty array when response has no models field', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({}), { status: 200 })) as any;

    const models = await listOllamaModels();
    expect(models).toEqual([]);
  });

  test('handles models with missing optional fields', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          models: [{ name: 'phi3' }],
        }),
        { status: 200 },
      )) as any;

    const models = await listOllamaModels();
    expect(models).toHaveLength(1);
    expect(models[0]).toEqual({ name: 'phi3', size: 0, modified_at: '' });
  });
});

describe('checkOllamaHealth', () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('returns true when Ollama is reachable and healthy', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ models: [] }), { status: 200 })) as any;

    const healthy = await checkOllamaHealth();
    expect(healthy).toBe(true);
  });

  test('returns false when Ollama returns non-ok status', async () => {
    globalThis.fetch = (async () => new Response('Error', { status: 503 })) as any;

    const healthy = await checkOllamaHealth();
    expect(healthy).toBe(false);
  });

  test('returns false when Ollama is unreachable', async () => {
    globalThis.fetch = (async () => {
      throw new Error('ECONNREFUSED');
    }) as any;

    const healthy = await checkOllamaHealth();
    expect(healthy).toBe(false);
  });
});

describe('createOllamaStream', () => {
  beforeEach(() => {
    clearDb();
    globalThis.fetch = originalFetch;
  });

  test('returns a ReadableStream', () => {
    globalThis.fetch = (async () => new Response('', { status: 200 })) as any;

    const stream = createOllamaStream({
      model: 'llama3',
      content: 'Hello',
      conversationId: 'conv-1',
    });
    expect(stream).toBeInstanceOf(ReadableStream);
  });

  test('emits SSE events for a successful streaming response', async () => {
    // Create a conversation so the DB lookup does not fail
    testDb
      .query('INSERT INTO conversations (id, model, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run('conv-stream-1', 'llama3', Date.now(), Date.now());

    // Build a streaming response body: two chunks and a final done chunk
    const chunks = [
      JSON.stringify({ message: { content: 'Hello' }, done: false }),
      JSON.stringify({ message: { content: ' world' }, done: false }),
      JSON.stringify({
        message: { content: '' },
        done: true,
        prompt_eval_count: 10,
        eval_count: 5,
      }),
    ];
    const body = chunks.join('\n') + '\n';

    globalThis.fetch = (async (url: string) => {
      if (url.includes('/api/chat')) {
        return new Response(body, { status: 200 });
      }
      // For any other calls (like health check in start)
      return new Response('', { status: 200 });
    }) as any;

    const stream = createOllamaStream({
      model: 'llama3',
      content: 'Hi',
      conversationId: 'conv-stream-1',
    });

    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let fullOutput = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fullOutput += decoder.decode(value, { stream: true });
    }

    // Parse out all SSE data events
    const events = fullOutput
      .split('\n\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.replace('data: ', '')));

    // Should have: message_start, content_block_start, content_block_delta(s), content_block_stop, message_delta, message_stop
    const types = events.map((e: any) => e.type);
    expect(types).toContain('message_start');
    expect(types).toContain('content_block_start');
    expect(types).toContain('content_block_delta');
    expect(types).toContain('content_block_stop');
    expect(types).toContain('message_delta');
    expect(types).toContain('message_stop');

    // Check message_start structure
    const messageStart = events.find((e: any) => e.type === 'message_start');
    expect(messageStart.message.role).toBe('assistant');
    expect(messageStart.message.model).toBe('llama3');

    // Check deltas contain the text
    const deltas = events.filter((e: any) => e.type === 'content_block_delta');
    const combinedText = deltas.map((d: any) => d.delta.text).join('');
    expect(combinedText).toBe('Hello world');

    // Check usage in message_delta
    const messageDelta = events.find((e: any) => e.type === 'message_delta');
    expect(messageDelta.usage.input_tokens).toBe(10);
    expect(messageDelta.usage.output_tokens).toBe(5);
  });

  test('emits error event when Ollama API returns non-ok status', async () => {
    globalThis.fetch = (async (url: string) => {
      if (url.includes('/api/chat')) {
        return new Response('Model not found', { status: 404 });
      }
      return new Response('', { status: 200 });
    }) as any;

    const stream = createOllamaStream({
      model: 'nonexistent-model',
      content: 'test',
      conversationId: 'conv-err-1',
    });

    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let fullOutput = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fullOutput += decoder.decode(value, { stream: true });
    }

    const events = fullOutput
      .split('\n\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.replace('data: ', '')));

    // Should contain an error event
    const errorEvent = events.find((e: any) => e.type === 'error');
    expect(errorEvent).toBeDefined();
    expect(errorEvent.error.type).toBe('ollama_error');
    expect(errorEvent.error.message).toContain('404');
  });

  test('emits error event when fetch throws (network error)', async () => {
    // First call for DB is fine, the fetch for /api/chat throws
    globalThis.fetch = (async (url: string) => {
      if (url.includes('/api/chat')) {
        throw new Error('ECONNREFUSED');
      }
      return new Response('', { status: 200 });
    }) as any;

    const stream = createOllamaStream({
      model: 'llama3',
      content: 'test',
      conversationId: 'conv-net-err',
    });

    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let fullOutput = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fullOutput += decoder.decode(value, { stream: true });
    }

    const events = fullOutput
      .split('\n\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.replace('data: ', '')));

    const errorEvent = events.find((e: any) => e.type === 'error');
    expect(errorEvent).toBeDefined();
    expect(errorEvent.error.message).toContain('ECONNREFUSED');
  });

  test('loads conversation history from DB before sending', async () => {
    // Insert a conversation with prior messages
    testDb
      .query('INSERT INTO conversations (id, model, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run('conv-history-1', 'llama3', Date.now(), Date.now());
    testDb
      .query(
        'INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)',
      )
      .run(
        'msg-prev-1',
        'conv-history-1',
        'user',
        JSON.stringify([{ type: 'text', text: 'Earlier question' }]),
        Date.now() - 1000,
      );
    testDb
      .query(
        'INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)',
      )
      .run(
        'msg-prev-2',
        'conv-history-1',
        'assistant',
        JSON.stringify([{ type: 'text', text: 'Earlier answer' }]),
        Date.now() - 500,
      );

    let capturedBody: any = null;
    const doneChunk = JSON.stringify({
      message: { content: 'OK' },
      done: true,
      prompt_eval_count: 5,
      eval_count: 2,
    });

    globalThis.fetch = (async (url: string, opts?: any) => {
      if (url.includes('/api/chat')) {
        capturedBody = JSON.parse(opts.body);
        return new Response(doneChunk + '\n', { status: 200 });
      }
      return new Response('', { status: 200 });
    }) as any;

    const stream = createOllamaStream({
      model: 'llama3',
      content: 'New question',
      conversationId: 'conv-history-1',
    });

    // Consume the stream fully
    const reader = stream.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    // Verify the messages sent to Ollama include history
    expect(capturedBody).toBeDefined();
    expect(capturedBody.messages.length).toBeGreaterThanOrEqual(3);
    expect(capturedBody.messages[0].content).toBe('Earlier question');
    expect(capturedBody.messages[1].content).toBe('Earlier answer');
    expect(capturedBody.messages[2].content).toBe('New question');
  });

  test('includes system prompt when provided', async () => {
    let capturedBody: any = null;
    const doneChunk = JSON.stringify({
      message: { content: 'Hi' },
      done: true,
      prompt_eval_count: 1,
      eval_count: 1,
    });

    globalThis.fetch = (async (url: string, opts?: any) => {
      if (url.includes('/api/chat')) {
        capturedBody = JSON.parse(opts.body);
        return new Response(doneChunk + '\n', { status: 200 });
      }
      return new Response('', { status: 200 });
    }) as any;

    const stream = createOllamaStream({
      model: 'llama3',
      content: 'Hello',
      conversationId: 'conv-sys-1',
      systemPrompt: 'You are a helpful assistant.',
    });

    const reader = stream.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    expect(capturedBody).toBeDefined();
    expect(capturedBody.messages[0]).toEqual({
      role: 'system',
      content: 'You are a helpful assistant.',
    });
  });

  test('persists assistant message to DB after streaming', async () => {
    testDb
      .query('INSERT INTO conversations (id, model, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run('conv-persist-1', 'llama3', Date.now(), Date.now());

    const chunks = [
      JSON.stringify({ message: { content: 'Saved text' }, done: false }),
      JSON.stringify({
        message: { content: '' },
        done: true,
        prompt_eval_count: 3,
        eval_count: 2,
      }),
    ];
    const body = chunks.join('\n') + '\n';

    globalThis.fetch = (async (url: string) => {
      if (url.includes('/api/chat')) {
        return new Response(body, { status: 200 });
      }
      return new Response('', { status: 200 });
    }) as any;

    const stream = createOllamaStream({
      model: 'llama3',
      content: 'test',
      conversationId: 'conv-persist-1',
    });

    const reader = stream.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    // Check that the assistant message was saved
    const rows = testDb
      .query(
        "SELECT * FROM messages WHERE conversation_id = 'conv-persist-1' AND role = 'assistant'",
      )
      .all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].model).toBe('llama3');
    const content = JSON.parse(rows[0].content);
    expect(content[0].text).toBe('Saved text');
    expect(rows[0].token_count).toBe(5); // 3 + 2
  });
});
