import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { createTestDb } from '../../test-helpers';

// --- module-level mocks (must come before import of the module under test) ---

const testDb = createTestDb();
mock.module('../../db/database', () => ({
  getDb: () => testDb,
  initDatabase: () => {},
}));

mock.module('../tool-schemas', () => ({
  getToolDefinitions: () => [],
  getAllToolsWithMcp: async () => [
    {
      name: 'Read',
      description: 'Read a file',
      input_schema: {
        type: 'object',
        properties: { file_path: { type: 'string' } },
        required: ['file_path'],
      },
    },
  ],
  requiresApproval: (name: string) => ['Bash', 'Write', 'Edit'].includes(name),
  shouldRequireApproval: () => 'allow',
  loadPermissionRules: () => [],
  loadTerminalCommandPolicy: () => 'auto',
  extractToolInputForMatching: (input: any) => input,
}));

let mockToolResult = { content: 'file contents here', is_error: false };
mock.module('../tool-executor', () => ({
  executeTool: async () => mockToolResult,
}));

mock.module('../chat-compaction', () => ({
  loadConversationHistory: () => ({ messages: [], compacted: false }),
  getRecommendedOptions: () => ({ maxTokens: 100000, maxMessages: 20 }),
}));

mock.module('../pattern-detection', () => ({
  recordToolUsage: () => {},
}));

// --- AWS SDK mock ---

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
let capturedCommandInput: any = null;
let sendCallCount = 0;
let allCapturedBodies: any[] = [];

mock.module('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: class {
    constructor(_config: any) {}
    send = async (cmd: any) => {
      capturedCommandInput = cmd.input;
      sendCallCount++;
      try {
        allCapturedBodies.push(JSON.parse(cmd.input.body));
      } catch {}
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

import {
  createBedrockStreamV2,
  listBedrockModels,
  checkBedrockHealth,
} from '../bedrock-provider-v2';

// --------------- helpers ---------------

const originalEnv = { ...process.env };

function clearDb() {
  testDb.exec('DELETE FROM messages');
  testDb.exec('DELETE FROM conversations');
  testDb.exec('DELETE FROM settings');
}

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

/** Simple text-only response chunks. */
function textChunks(text: string = 'Hello world') {
  const words = text.split(' ');
  return [
    { type: 'message_start', message: { usage: { input_tokens: 15 } } },
    ...words.map((w, i) => ({
      type: 'content_block_start',
      content_block: { type: 'text', text: '' },
      ...(i > 0 ? {} : {}),
    })),
    ...words.map((w) => ({
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: w + ' ' },
    })),
    { type: 'content_block_stop' },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 8 } },
  ];
}

/** Simple completion with one text block. */
function simpleCompletionChunks() {
  return [
    { type: 'message_start', message: { usage: { input_tokens: 10 } } },
    { type: 'content_block_start', content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: ' world' } },
    { type: 'content_block_stop' },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
  ];
}

/** Chunks that include a tool_use block, ending with stop_reason: tool_use. */
function toolUseChunks() {
  return [
    { type: 'message_start', message: { usage: { input_tokens: 20 } } },
    {
      type: 'content_block_start',
      content_block: { type: 'text', text: '' },
    },
    {
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'Let me read that file.' },
    },
    { type: 'content_block_stop' },
    {
      type: 'content_block_start',
      content_block: {
        type: 'tool_use',
        id: 'tool_abc123',
        name: 'Read',
      },
    },
    {
      type: 'content_block_delta',
      delta: { type: 'input_json_delta', partial_json: '{"file_' },
    },
    {
      type: 'content_block_delta',
      delta: { type: 'input_json_delta', partial_json: 'path":"/tmp/test.txt"}' },
    },
    { type: 'content_block_stop' },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 12 } },
  ];
}

// =====================================================================
// Tests
// =====================================================================

describe('bedrock-provider-v2: basic streaming', () => {
  beforeEach(() => {
    clearDb();
    sendCallCount = 0;
    allCapturedBodies = [];
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('returns a ReadableStream', () => {
    mockSendFn = async () => ({ body: bedrockBody([]) });
    const stream = createBedrockStreamV2({
      model: 'claude-sonnet-4-6',
      content: 'Hello',
      conversationId: 'conv-readable',
    });
    expect(stream).toBeInstanceOf(ReadableStream);
  });

  test('emits complete SSE event sequence', async () => {
    mockSendFn = async () => ({ body: bedrockBody(simpleCompletionChunks()) });

    const stream = createBedrockStreamV2({
      model: 'claude-sonnet-4-6',
      content: 'Hi',
      conversationId: 'conv-sse-v2',
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

  test('streams text content correctly', async () => {
    mockSendFn = async () => ({ body: bedrockBody(simpleCompletionChunks()) });

    const stream = createBedrockStreamV2({
      model: 'claude-sonnet-4-6',
      content: 'Hi',
      conversationId: 'conv-text-v2',
    });

    const events = await drainStream(stream);
    const deltas = events.filter((e) => e.type === 'content_block_delta');
    const text = deltas.map((d) => d.delta.text).join('');

    expect(text).toBe('Hello world');
  });

  test('reports token usage', async () => {
    mockSendFn = async () => ({ body: bedrockBody(simpleCompletionChunks()) });

    const stream = createBedrockStreamV2({
      model: 'claude-sonnet-4-6',
      content: 'Hi',
      conversationId: 'conv-usage-v2',
    });

    const events = await drainStream(stream);
    const msgDelta = events.find((e) => e.type === 'message_delta');

    expect(msgDelta.usage.input_tokens).toBe(10);
    expect(msgDelta.usage.output_tokens).toBe(5);
  });
});

describe('bedrock-provider-v2: tool calling', () => {
  beforeEach(() => {
    clearDb();
    sendCallCount = 0;
    allCapturedBodies = [];
    mockToolResult = { content: 'file contents here', is_error: false };
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('handles tool_use response and continues conversation', async () => {
    let callNum = 0;
    mockSendFn = async () => {
      callNum++;
      if (callNum === 1) {
        // First call: model wants to use a tool
        return { body: bedrockBody(toolUseChunks()) };
      }
      // Second call: model responds after tool result
      return { body: bedrockBody(simpleCompletionChunks()) };
    };

    const stream = createBedrockStreamV2({
      model: 'claude-sonnet-4-6',
      content: 'Read /tmp/test.txt',
      conversationId: 'conv-tool-call',
    });

    const events = await drainStream(stream);

    // Should have tool_result event
    const toolResult = events.find((e) => e.type === 'tool_result');
    expect(toolResult).toBeDefined();
    expect(toolResult.toolName).toBe('Read');
    expect(toolResult.result).toBe('file contents here');
    expect(toolResult.isError).toBe(false);

    // Should have called the API twice (initial + after tool result)
    expect(sendCallCount).toBe(2);
  });

  test('emits tool_result with error flag when tool fails', async () => {
    mockToolResult = { content: 'ENOENT: file not found', is_error: true };

    let callNum = 0;
    mockSendFn = async () => {
      callNum++;
      if (callNum === 1) return { body: bedrockBody(toolUseChunks()) };
      return { body: bedrockBody(simpleCompletionChunks()) };
    };

    const stream = createBedrockStreamV2({
      model: 'claude-sonnet-4-6',
      content: 'Read /nonexistent',
      conversationId: 'conv-tool-err',
    });

    const events = await drainStream(stream);
    const toolResult = events.find((e) => e.type === 'tool_result');

    expect(toolResult.isError).toBe(true);
    expect(toolResult.result).toContain('ENOENT');
  });

  test('sends tool results back to model as user message', async () => {
    let callNum = 0;
    mockSendFn = async () => {
      callNum++;
      if (callNum === 1) return { body: bedrockBody(toolUseChunks()) };
      return { body: bedrockBody(simpleCompletionChunks()) };
    };

    const stream = createBedrockStreamV2({
      model: 'claude-sonnet-4-6',
      content: 'Read something',
      conversationId: 'conv-tool-result-msg',
    });
    await drainStream(stream);

    // Second API call should include tool_result in messages
    expect(allCapturedBodies.length).toBeGreaterThanOrEqual(2);
    const secondCall = allCapturedBodies[1];
    const lastMsg = secondCall.messages[secondCall.messages.length - 1];

    expect(lastMsg.role).toBe('user');
    expect(lastMsg.content[0].type).toBe('tool_result');
    expect(lastMsg.content[0].tool_use_id).toBe('tool_abc123');
  });

  test('respects max iteration limit to prevent infinite loops', async () => {
    // Always return tool_use to try to loop forever
    mockSendFn = async () => ({ body: bedrockBody(toolUseChunks()) });

    const stream = createBedrockStreamV2({
      model: 'claude-sonnet-4-6',
      content: 'infinite loop',
      conversationId: 'conv-max-iter',
    });

    const events = await drainStream(stream);

    // Should stop after 10 iterations max
    expect(sendCallCount).toBeLessThanOrEqual(10);

    // Should still close cleanly with message_stop
    const stop = events.find((e) => e.type === 'message_stop');
    expect(stop).toBeDefined();
  });
});

describe('bedrock-provider-v2: request payload', () => {
  beforeEach(() => {
    clearDb();
    sendCallCount = 0;
    allCapturedBodies = [];
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('includes tools in payload', async () => {
    mockSendFn = async () => ({ body: bedrockBody(simpleCompletionChunks()) });

    const stream = createBedrockStreamV2({
      model: 'claude-sonnet-4-6',
      content: 'test',
      conversationId: 'conv-tools-payload',
    });
    await drainStream(stream);

    const body = allCapturedBodies[0];
    expect(body.tools).toBeDefined();
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].name).toBe('Read');
  });

  test('includes system prompt when provided', async () => {
    mockSendFn = async () => ({ body: bedrockBody(simpleCompletionChunks()) });

    const stream = createBedrockStreamV2({
      model: 'claude-sonnet-4-6',
      content: 'test',
      conversationId: 'conv-sys-v2',
      systemPrompt: 'Be concise.',
    });
    await drainStream(stream);

    expect(allCapturedBodies[0].system).toBe('Be concise.');
  });

  test('uses correct Bedrock API version', async () => {
    mockSendFn = async () => ({ body: bedrockBody(simpleCompletionChunks()) });

    const stream = createBedrockStreamV2({
      model: 'claude-sonnet-4-6',
      content: 'test',
      conversationId: 'conv-api-ver',
    });
    await drainStream(stream);

    expect(allCapturedBodies[0].anthropic_version).toBe('bedrock-2023-05-31');
  });

  test('maps model names to Bedrock IDs correctly', async () => {
    mockSendFn = async () => ({ body: bedrockBody(simpleCompletionChunks()) });

    const stream = createBedrockStreamV2({
      model: 'claude-opus-4-6',
      content: 'test',
      conversationId: 'conv-model-v2',
    });
    await drainStream(stream);

    expect(capturedCommandInput.modelId).toBe('anthropic.claude-opus-4-6-v1:0');
  });
});

describe('bedrock-provider-v2: image support', () => {
  beforeEach(() => {
    clearDb();
    allCapturedBodies = [];
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('includes images in user message when provided', async () => {
    mockSendFn = async () => ({ body: bedrockBody(simpleCompletionChunks()) });

    const stream = createBedrockStreamV2({
      model: 'claude-sonnet-4-6',
      content: 'Describe this image',
      conversationId: 'conv-images',
      images: [{ mediaType: 'image/png', data: 'base64encodeddata' }],
    });
    await drainStream(stream);

    const body = allCapturedBodies[0];
    const userMsg = body.messages[body.messages.length - 1];

    expect(userMsg.content).toHaveLength(2);
    expect(userMsg.content[0].type).toBe('text');
    expect(userMsg.content[0].text).toBe('Describe this image');
    expect(userMsg.content[1].type).toBe('image');
    expect(userMsg.content[1].source.type).toBe('base64');
    expect(userMsg.content[1].source.media_type).toBe('image/png');
    expect(userMsg.content[1].source.data).toBe('base64encodeddata');
  });
});

describe('bedrock-provider-v2: error handling', () => {
  beforeEach(() => {
    clearDb();
    sendCallCount = 0;
    allCapturedBodies = [];
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('emits bedrock_error on API failure', async () => {
    mockSendFn = async () => {
      throw new Error('ValidationException: max_tokens too large');
    };

    const stream = createBedrockStreamV2({
      model: 'claude-sonnet-4-6',
      content: 'test',
      conversationId: 'conv-api-err-v2',
    });

    const events = await drainStream(stream);
    const errEvent = events.find((e) => e.type === 'error');

    expect(errEvent).toBeDefined();
    expect(errEvent.error.type).toBe('bedrock_error');
    expect(errEvent.error.message).toContain('ValidationException');
  });

  test('emits bedrock_error on credential failure', async () => {
    mockSendFn = async () => {
      throw new Error('CredentialsProviderError: Could not load credentials');
    };

    const stream = createBedrockStreamV2({
      model: 'claude-sonnet-4-6',
      content: 'test',
      conversationId: 'conv-cred-err',
    });

    const events = await drainStream(stream);
    const errEvent = events.find((e) => e.type === 'error');

    expect(errEvent).toBeDefined();
    expect(errEvent.error.message).toContain('CredentialsProviderError');
  });
});

describe('bedrock-provider-v2: DB persistence', () => {
  beforeEach(() => {
    clearDb();
    sendCallCount = 0;
    allCapturedBodies = [];
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('persists assistant text to DB after streaming', async () => {
    testDb
      .query('INSERT INTO conversations (id, model, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run('conv-persist-v2', 'claude-sonnet-4-6', Date.now(), Date.now());

    mockSendFn = async () => ({ body: bedrockBody(simpleCompletionChunks()) });

    const stream = createBedrockStreamV2({
      model: 'claude-sonnet-4-6',
      content: 'test',
      conversationId: 'conv-persist-v2',
    });
    await drainStream(stream);

    const rows = testDb
      .query(
        "SELECT * FROM messages WHERE conversation_id = 'conv-persist-v2' AND role = 'assistant'",
      )
      .all() as any[];
    expect(rows).toHaveLength(1);

    const content = JSON.parse(rows[0].content);
    expect(content[0].text).toBe('Hello world');
  });
});

describe('bedrock-provider-v2: listBedrockModels', () => {
  test('returns Claude 4.x models', async () => {
    const models = await listBedrockModels();
    const ids = models.map((m) => m.id);

    expect(ids).toContain('claude-opus-4-6');
    expect(ids).toContain('claude-sonnet-4-6');
    expect(ids).toContain('claude-haiku-4-5');
  });
});

describe('bedrock-provider-v2: checkBedrockHealth', () => {
  test('returns true when client can be created', async () => {
    expect(await checkBedrockHealth()).toBe(true);
  });
});
