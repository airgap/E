import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { createTestDb } from '../../test-helpers';

// --- module-level mocks (must come before import of the module under test) ---

const testDb = createTestDb();
mock.module('../../db/database', () => ({
  getDb: () => testDb,
  initDatabase: () => {},
}));

// --- AWS SDK mock ---

/** Build an async-iterable body that yields Bedrock-style chunks. */
function bedrockBody(chunks: any[]): AsyncIterable<any> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) {
        yield { chunk: { bytes: new TextEncoder().encode(JSON.stringify(c)) } };
      }
    },
  };
}

let mockSendFn: (cmd: any) => Promise<any> = async () => ({
  body: bedrockBody([]),
});
let capturedClientConfig: any = null;
let capturedCommandInput: any = null;

mock.module('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: class {
    constructor(config: any) {
      capturedClientConfig = config;
    }
    send = async (cmd: any) => {
      capturedCommandInput = cmd.input;
      return mockSendFn(cmd);
    };
  },
  InvokeModelWithResponseStreamCommand: class {
    input: any;
    constructor(input: any) {
      this.input = input;
    }
  },
}));

import { createBedrockStream, listBedrockModels, checkBedrockHealth } from '../bedrock-provider';

// --------------- helpers ---------------

const originalEnv = { ...process.env };

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

/** A standard Bedrock streaming response for "Hello world". */
function helloWorldChunks() {
  return [
    { type: 'message_start', message: { usage: { input_tokens: 12 } } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: ' world' } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
  ];
}

// =====================================================================
// Tests
// =====================================================================

describe('bedrock-provider: model ID mapping', () => {
  beforeEach(() => {
    clearDb();
    capturedCommandInput = null;
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('maps claude-sonnet-4-6 to Bedrock model ID', async () => {
    mockSendFn = async () => ({ body: bedrockBody(helloWorldChunks()) });

    const stream = createBedrockStream({
      model: 'claude-sonnet-4-6',
      content: 'hi',
      conversationId: 'conv-model-map',
    });
    await drainStream(stream);

    expect(capturedCommandInput.modelId).toBe('anthropic.claude-sonnet-4-6-v1:0');
  });

  test('maps claude-opus-4-6 to Bedrock model ID', async () => {
    mockSendFn = async () => ({ body: bedrockBody(helloWorldChunks()) });

    const stream = createBedrockStream({
      model: 'claude-opus-4-6',
      content: 'hi',
      conversationId: 'conv-model-opus',
    });
    await drainStream(stream);

    expect(capturedCommandInput.modelId).toBe('anthropic.claude-opus-4-6-v1:0');
  });

  test('maps claude-haiku-4-5 to Bedrock model ID', async () => {
    mockSendFn = async () => ({ body: bedrockBody(helloWorldChunks()) });

    const stream = createBedrockStream({
      model: 'claude-haiku-4-5',
      content: 'hi',
      conversationId: 'conv-model-haiku',
    });
    await drainStream(stream);

    expect(capturedCommandInput.modelId).toBe('anthropic.claude-haiku-4-5-v1:0');
  });

  test('passes through full Bedrock model IDs unchanged', async () => {
    mockSendFn = async () => ({ body: bedrockBody(helloWorldChunks()) });

    const stream = createBedrockStream({
      model: 'anthropic.claude-sonnet-4-6-v1:0',
      content: 'hi',
      conversationId: 'conv-model-passthrough',
    });
    await drainStream(stream);

    expect(capturedCommandInput.modelId).toBe('anthropic.claude-sonnet-4-6-v1:0');
  });

  test('defaults to claude-sonnet-4-6 for unknown model names', async () => {
    mockSendFn = async () => ({ body: bedrockBody(helloWorldChunks()) });

    const stream = createBedrockStream({
      model: 'unknown-model',
      content: 'hi',
      conversationId: 'conv-model-default',
    });
    await drainStream(stream);

    expect(capturedCommandInput.modelId).toBe('anthropic.claude-sonnet-4-6-v1:0');
  });

  test('legacy claude-sonnet-3.5 still maps correctly', async () => {
    mockSendFn = async () => ({ body: bedrockBody(helloWorldChunks()) });

    const stream = createBedrockStream({
      model: 'claude-sonnet-3.5',
      content: 'hi',
      conversationId: 'conv-model-legacy',
    });
    await drainStream(stream);

    expect(capturedCommandInput.modelId).toBe('anthropic.claude-3-5-sonnet-20241022-v2:0');
  });
});

describe('bedrock-provider: region configuration', () => {
  beforeEach(() => {
    clearDb();
    capturedClientConfig = null;
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('uses AWS_REGION env var when set', async () => {
    process.env.AWS_REGION = 'eu-west-1';
    mockSendFn = async () => ({ body: bedrockBody(helloWorldChunks()) });

    const stream = createBedrockStream({
      model: 'claude-sonnet-4-6',
      content: 'hi',
      conversationId: 'conv-region-env',
    });
    await drainStream(stream);

    expect(capturedClientConfig.region).toBe('eu-west-1');
  });

  test('defaults to us-east-1 when AWS_REGION is not set', async () => {
    delete process.env.AWS_REGION;
    mockSendFn = async () => ({ body: bedrockBody(helloWorldChunks()) });

    const stream = createBedrockStream({
      model: 'claude-sonnet-4-6',
      content: 'hi',
      conversationId: 'conv-region-default',
    });
    await drainStream(stream);

    expect(capturedClientConfig.region).toBe('us-east-1');
  });
});

describe('bedrock-provider: createBedrockStream', () => {
  beforeEach(() => {
    clearDb();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('returns a ReadableStream', () => {
    mockSendFn = async () => ({ body: bedrockBody([]) });
    const stream = createBedrockStream({
      model: 'claude-sonnet-4-6',
      content: 'Hello',
      conversationId: 'conv-readable',
    });
    expect(stream).toBeInstanceOf(ReadableStream);
  });

  test('emits expected SSE event sequence for a simple completion', async () => {
    mockSendFn = async () => ({ body: bedrockBody(helloWorldChunks()) });

    const stream = createBedrockStream({
      model: 'claude-sonnet-4-6',
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
  });

  test('message_start has correct structure', async () => {
    mockSendFn = async () => ({ body: bedrockBody(helloWorldChunks()) });

    const stream = createBedrockStream({
      model: 'claude-sonnet-4-6',
      content: 'Hi',
      conversationId: 'conv-msg-start',
    });

    const events = await drainStream(stream);
    const msgStart = events.find((e) => e.type === 'message_start');

    expect(msgStart.message.role).toBe('assistant');
    expect(msgStart.message.model).toBe('claude-sonnet-4-6');
    expect(msgStart.message.id).toBeDefined();
  });

  test('content_block_delta events contain streamed text', async () => {
    mockSendFn = async () => ({ body: bedrockBody(helloWorldChunks()) });

    const stream = createBedrockStream({
      model: 'claude-sonnet-4-6',
      content: 'Hi',
      conversationId: 'conv-text-delta',
    });

    const events = await drainStream(stream);
    const deltas = events.filter((e) => e.type === 'content_block_delta');
    const combinedText = deltas.map((d) => d.delta.text).join('');

    expect(combinedText).toBe('Hello world');
  });

  test('message_delta contains token usage', async () => {
    mockSendFn = async () => ({ body: bedrockBody(helloWorldChunks()) });

    const stream = createBedrockStream({
      model: 'claude-sonnet-4-6',
      content: 'Hi',
      conversationId: 'conv-usage',
    });

    const events = await drainStream(stream);
    const msgDelta = events.find((e) => e.type === 'message_delta');

    expect(msgDelta.usage.input_tokens).toBe(12);
    expect(msgDelta.usage.output_tokens).toBe(5);
    expect(msgDelta.delta.stop_reason).toBe('end_turn');
  });

  test('includes system prompt in payload when provided', async () => {
    let capturedBody: any = null;
    mockSendFn = async (cmd: any) => {
      capturedBody = JSON.parse(cmd.input.body);
      return { body: bedrockBody(helloWorldChunks()) };
    };

    const stream = createBedrockStream({
      model: 'claude-sonnet-4-6',
      content: 'Hi',
      conversationId: 'conv-sys-prompt',
      systemPrompt: 'You are a helpful assistant.',
    });
    await drainStream(stream);

    expect(capturedBody.system).toBe('You are a helpful assistant.');
    expect(capturedBody.anthropic_version).toBe('bedrock-2023-05-31');
    expect(capturedBody.max_tokens).toBe(4096);
  });

  test('omits system field when no system prompt provided', async () => {
    let capturedBody: any = null;
    mockSendFn = async (cmd: any) => {
      capturedBody = JSON.parse(cmd.input.body);
      return { body: bedrockBody(helloWorldChunks()) };
    };

    const stream = createBedrockStream({
      model: 'claude-sonnet-4-6',
      content: 'Hi',
      conversationId: 'conv-no-sys',
    });
    await drainStream(stream);

    expect(capturedBody.system).toBeUndefined();
  });

  test('sends user message in correct Bedrock format', async () => {
    let capturedBody: any = null;
    mockSendFn = async (cmd: any) => {
      capturedBody = JSON.parse(cmd.input.body);
      return { body: bedrockBody(helloWorldChunks()) };
    };

    const stream = createBedrockStream({
      model: 'claude-sonnet-4-6',
      content: 'What is 2+2?',
      conversationId: 'conv-msg-format',
    });
    await drainStream(stream);

    const lastMsg = capturedBody.messages[capturedBody.messages.length - 1];
    expect(lastMsg.role).toBe('user');
    expect(lastMsg.content).toEqual([{ type: 'text', text: 'What is 2+2?' }]);
  });
});

describe('bedrock-provider: error handling', () => {
  beforeEach(() => {
    clearDb();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('emits bedrock_error when client.send() throws', async () => {
    mockSendFn = async () => {
      throw new Error('AccessDeniedException: not authorized');
    };

    const stream = createBedrockStream({
      model: 'claude-sonnet-4-6',
      content: 'test',
      conversationId: 'conv-auth-err',
    });

    const events = await drainStream(stream);
    const errEvent = events.find((e) => e.type === 'error');
    expect(errEvent).toBeDefined();
    expect(errEvent.error.type).toBe('bedrock_error');
    expect(errEvent.error.message).toContain('AccessDeniedException');
  });

  test('emits bedrock_error on network failure', async () => {
    mockSendFn = async () => {
      throw new Error('ECONNREFUSED');
    };

    const stream = createBedrockStream({
      model: 'claude-sonnet-4-6',
      content: 'test',
      conversationId: 'conv-net-err',
    });

    const events = await drainStream(stream);
    const errEvent = events.find((e) => e.type === 'error');
    expect(errEvent).toBeDefined();
    expect(errEvent.error.message).toContain('ECONNREFUSED');
  });

  test('stream closes after error (no message_stop)', async () => {
    mockSendFn = async () => {
      throw new Error('throttling');
    };

    const stream = createBedrockStream({
      model: 'claude-sonnet-4-6',
      content: 'test',
      conversationId: 'conv-err-close',
    });

    const events = await drainStream(stream);

    // Should have message_start, content_block_start, then error
    const errEvent = events.find((e) => e.type === 'error');
    expect(errEvent).toBeDefined();

    // Should NOT have message_stop after error
    const stopIdx = events.findIndex((e) => e.type === 'message_stop');
    const errIdx = events.findIndex((e) => e.type === 'error');
    if (stopIdx !== -1) {
      // If message_stop exists, it should be before the error (from the initial emit)
      expect(stopIdx).toBeLessThan(errIdx);
    }
  });
});

describe('bedrock-provider: conversation history', () => {
  beforeEach(() => {
    clearDb();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('loads prior messages from DB and includes in payload', async () => {
    // Seed conversation history
    testDb
      .query('INSERT INTO conversations (id, model, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run('conv-history', 'claude-sonnet-4-6', Date.now(), Date.now());

    testDb
      .query(
        'INSERT INTO messages (id, conversation_id, role, content, model, token_count, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        'msg1',
        'conv-history',
        'user',
        JSON.stringify([{ type: 'text', text: 'Hi' }]),
        'claude-sonnet-4-6',
        5,
        Date.now() - 2000,
      );

    testDb
      .query(
        'INSERT INTO messages (id, conversation_id, role, content, model, token_count, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        'msg2',
        'conv-history',
        'assistant',
        JSON.stringify([{ type: 'text', text: 'Hello!' }]),
        'claude-sonnet-4-6',
        5,
        Date.now() - 1000,
      );

    let capturedBody: any = null;
    mockSendFn = async (cmd: any) => {
      capturedBody = JSON.parse(cmd.input.body);
      return { body: bedrockBody(helloWorldChunks()) };
    };

    const stream = createBedrockStream({
      model: 'claude-sonnet-4-6',
      content: 'How are you?',
      conversationId: 'conv-history',
    });
    await drainStream(stream);

    // Should have 3 messages: prior user, prior assistant, current user
    expect(capturedBody.messages).toHaveLength(3);
    expect(capturedBody.messages[0].role).toBe('user');
    expect(capturedBody.messages[0].content[0].text).toBe('Hi');
    expect(capturedBody.messages[1].role).toBe('assistant');
    expect(capturedBody.messages[1].content[0].text).toBe('Hello!');
    expect(capturedBody.messages[2].role).toBe('user');
    expect(capturedBody.messages[2].content[0].text).toBe('How are you?');
  });

  test('works with fresh conversation (no prior messages)', async () => {
    let capturedBody: any = null;
    mockSendFn = async (cmd: any) => {
      capturedBody = JSON.parse(cmd.input.body);
      return { body: bedrockBody(helloWorldChunks()) };
    };

    const stream = createBedrockStream({
      model: 'claude-sonnet-4-6',
      content: 'First message',
      conversationId: 'conv-fresh',
    });
    await drainStream(stream);

    expect(capturedBody.messages).toHaveLength(1);
    expect(capturedBody.messages[0].content[0].text).toBe('First message');
  });
});

describe('bedrock-provider: DB persistence', () => {
  beforeEach(() => {
    clearDb();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('persists assistant message to DB after streaming', async () => {
    testDb
      .query('INSERT INTO conversations (id, model, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run('conv-persist', 'claude-sonnet-4-6', Date.now(), Date.now());

    mockSendFn = async () => ({ body: bedrockBody(helloWorldChunks()) });

    const stream = createBedrockStream({
      model: 'claude-sonnet-4-6',
      content: 'test',
      conversationId: 'conv-persist',
    });
    await drainStream(stream);

    const rows = testDb
      .query("SELECT * FROM messages WHERE conversation_id = 'conv-persist' AND role = 'assistant'")
      .all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].model).toBe('claude-sonnet-4-6');

    const content = JSON.parse(rows[0].content);
    expect(content[0].text).toBe('Hello world');
  });

  test('stores correct token count', async () => {
    testDb
      .query('INSERT INTO conversations (id, model, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run('conv-tokens', 'claude-sonnet-4-6', Date.now(), Date.now());

    mockSendFn = async () => ({ body: bedrockBody(helloWorldChunks()) });

    const stream = createBedrockStream({
      model: 'claude-sonnet-4-6',
      content: 'test',
      conversationId: 'conv-tokens',
    });
    await drainStream(stream);

    const rows = testDb
      .query(
        "SELECT token_count FROM messages WHERE conversation_id = 'conv-tokens' AND role = 'assistant'",
      )
      .all() as any[];
    expect(rows[0].token_count).toBe(17); // 12 input + 5 output
  });

  test('updates conversation updated_at timestamp', async () => {
    const beforeTime = Date.now();
    testDb
      .query('INSERT INTO conversations (id, model, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run('conv-updated', 'claude-sonnet-4-6', beforeTime, beforeTime - 10000);

    mockSendFn = async () => ({ body: bedrockBody(helloWorldChunks()) });

    const stream = createBedrockStream({
      model: 'claude-sonnet-4-6',
      content: 'test',
      conversationId: 'conv-updated',
    });
    await drainStream(stream);

    const conv = testDb
      .query("SELECT updated_at FROM conversations WHERE id = 'conv-updated'")
      .get() as any;
    expect(conv.updated_at).toBeGreaterThanOrEqual(beforeTime);
  });
});

describe('bedrock-provider: listBedrockModels', () => {
  test('returns Claude 4.x and legacy models', async () => {
    const models = await listBedrockModels();
    const ids = models.map((m) => m.id);

    expect(ids).toContain('claude-opus-4-6');
    expect(ids).toContain('claude-sonnet-4-6');
    expect(ids).toContain('claude-haiku-4-5');
    // Legacy
    expect(ids).toContain('claude-opus-4');
    expect(ids).toContain('claude-sonnet-3.5');
    expect(ids).toContain('claude-haiku-3');
  });
});

describe('bedrock-provider: checkBedrockHealth', () => {
  test('returns true when client can be created', async () => {
    const healthy = await checkBedrockHealth();
    expect(healthy).toBe(true);
  });
});
