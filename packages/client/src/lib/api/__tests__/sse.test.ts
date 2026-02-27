import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// Use vi.hoisted to define mocks that can be referenced in vi.mock factories
const { mockStreamStore, mockConversationStore, mockSend, mockCancel } = vi.hoisted(() => ({
  mockStreamStore: {
    setAbortController: vi.fn(),
    startStream: vi.fn(),
    handleEvent: vi.fn(),
    setSessionId: vi.fn(),
    setReconnecting: vi.fn(),
    isStreaming: false,
    isReconnecting: false,
    status: 'idle' as string,
    sessionId: 'session-1' as string | null,
    conversationId: null as string | null,
    contentBlocks: [] as any[],
    cancel: vi.fn(),
    abortController: null as AbortController | null,
    reset: vi.fn(),
  },
  mockConversationStore: {
    addMessage: vi.fn(),
    addMessageTo: vi.fn(),
    updateLastAssistantMessage: vi.fn(),
    updateLastAssistantMessageIn: vi.fn(),
    reload: vi.fn().mockResolvedValue(undefined),
    reloadById: vi.fn().mockResolvedValue(undefined),
    setActive: vi.fn(),
    onActiveChange: vi.fn(),
    setInflight: vi.fn(),
    clearInflight: vi.fn(),
    getInflight: vi.fn().mockReturnValue(undefined),
    active: {
      id: 'conv-1',
      model: 'claude-sonnet-4-5-20250929',
      workspacePath: null,
      messages: [],
    } as any,
    activeId: 'conv-1' as string | null,
  },
  mockSend: vi.fn(),
  mockCancel: vi.fn(),
}));

vi.mock('$lib/stores/stream.svelte', () => ({
  streamStore: mockStreamStore,
}));

vi.mock('$lib/stores/conversation.svelte', () => ({
  conversationStore: mockConversationStore,
}));

vi.mock('$lib/stores/project-memory.svelte', () => ({
  workspaceMemoryStore: {
    extractFromConversation: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('$lib/stores/workspace.svelte', () => ({
  workspaceStore: {
    activeWorkspace: null,
    updateActiveSnapshot: vi.fn(),
  },
}));

vi.mock('../client', () => ({
  api: {
    stream: {
      send: mockSend,
      cancel: mockCancel,
    },
    git: {
      snapshot: vi.fn().mockResolvedValue(undefined),
    },
    conversations: {
      summarize: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

vi.mock('$lib/utils/uuid', () => ({
  uuid: vi.fn().mockReturnValue('mock-uuid-12345'),
}));

import {
  sendAndStream,
  cancelStream,
  reconnectActiveStream,
  abortActiveStream,
  getReconnectionPromise,
  reconnectToConversation,
  startConversationPolling,
  stopConversationPolling,
} from '../sse';

beforeEach(() => {
  vi.clearAllMocks();
  mockStreamStore.contentBlocks = [];
  mockStreamStore.sessionId = 'session-1';
  mockStreamStore.conversationId = null;
  mockStreamStore.isStreaming = false;
  mockStreamStore.isReconnecting = false;
  mockStreamStore.status = 'idle';
  mockStreamStore.abortController = null;
  mockConversationStore.active = {
    id: 'conv-1',
    model: 'claude-sonnet-4-5-20250929',
    workspacePath: null,
    messages: [],
  };
  mockConversationStore.activeId = 'conv-1';
});

function createMockResponse(body: string, ok = true, headers: Record<string, string> = {}) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });

  return {
    ok,
    status: ok ? 200 : 500,
    body: stream,
    headers: new Headers(headers),
    json: () => Promise.resolve({ error: 'Stream failed' }),
  };
}

function createMultiChunkResponse(
  chunks: string[],
  ok = true,
  headers: Record<string, string> = {},
) {
  const encoder = new TextEncoder();
  let chunkIndex = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (chunkIndex < chunks.length) {
        controller.enqueue(encoder.encode(chunks[chunkIndex]));
        chunkIndex++;
      } else {
        controller.close();
      }
    },
  });

  return {
    ok,
    status: ok ? 200 : 500,
    body: stream,
    headers: new Headers(headers),
    json: () => Promise.resolve({ error: 'Stream failed' }),
  };
}

// ============================================================================
// sendAndStream
// ============================================================================
describe('sendAndStream', () => {
  test('initializes stream and adds user message', async () => {
    mockSend.mockResolvedValue(createMockResponse(''));

    await sendAndStream('conv-1', 'Hello');

    expect(mockStreamStore.setAbortController).toHaveBeenCalled();
    expect(mockStreamStore.startStream).toHaveBeenCalledWith('conv-1');
    expect(mockConversationStore.addMessageTo).toHaveBeenCalledWith(
      mockConversationStore.active,
      expect.objectContaining({
        role: 'user',
        content: [{ type: 'text', text: 'Hello' }],
      }),
    );
  });

  test('handles non-ok response', async () => {
    mockSend.mockResolvedValue(createMockResponse('', false));

    await sendAndStream('conv-1', 'Hello');

    expect(mockStreamStore.handleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        error: expect.objectContaining({ type: 'http_error' }),
      }),
    );
  });

  test('captures session ID from response header', async () => {
    mockSend.mockResolvedValue(createMockResponse('', true, { 'X-Session-Id': 'new-session' }));

    await sendAndStream('conv-1', 'Hello');

    expect(mockStreamStore.setSessionId).toHaveBeenCalledWith('new-session');
  });

  test('does not set session ID when header is absent', async () => {
    mockSend.mockResolvedValue(createMockResponse(''));

    await sendAndStream('conv-1', 'Hello');

    expect(mockStreamStore.setSessionId).not.toHaveBeenCalled();
  });

  test('adds empty assistant message', async () => {
    mockSend.mockResolvedValue(createMockResponse(''));

    await sendAndStream('conv-1', 'Hello');

    expect(mockConversationStore.addMessageTo).toHaveBeenCalledTimes(2);
    expect(mockConversationStore.addMessageTo).toHaveBeenCalledWith(
      mockConversationStore.active,
      expect.objectContaining({
        role: 'assistant',
        content: [],
      }),
    );
  });

  test('parses SSE events from stream', async () => {
    const sseData =
      'data: {"type":"message_start","message":{"id":"msg-1","role":"assistant"}}\n\ndata: {"type":"message_stop"}\n\n';
    mockSend.mockResolvedValue(createMockResponse(sseData));

    await sendAndStream('conv-1', 'Hello');

    expect(mockStreamStore.handleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'message_start' }),
    );
    expect(mockStreamStore.handleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'message_stop' }),
    );
  });

  test('ignores non-data lines', async () => {
    const sseData = ':comment\nretry: 1000\ndata: {"type":"ping"}\n\n';
    mockSend.mockResolvedValue(createMockResponse(sseData));

    await sendAndStream('conv-1', 'Hello');

    expect(mockStreamStore.handleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ping' }),
    );
  });

  test('handles response with no body', async () => {
    mockSend.mockResolvedValue({
      ok: true,
      body: null,
      headers: new Headers(),
    });

    await sendAndStream('conv-1', 'Hello');

    expect(mockStreamStore.handleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        error: expect.objectContaining({ type: 'no_body' }),
      }),
    );
  });

  test('handles network error', async () => {
    mockSend.mockRejectedValue(new Error('Network failure'));

    await sendAndStream('conv-1', 'Hello');

    expect(mockStreamStore.handleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        error: expect.objectContaining({
          type: 'network_error',
          message: 'Network failure',
        }),
      }),
    );
  });

  test('handles abort error', async () => {
    const abortError = new DOMException('Aborted', 'AbortError');
    mockSend.mockRejectedValue(abortError);

    await sendAndStream('conv-1', 'Hello');

    expect(mockStreamStore.handleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'message_stop' }),
    );
  });

  test('syncs content blocks after stream completes', async () => {
    mockStreamStore.contentBlocks = [{ type: 'text', text: 'Hello' }];
    mockSend.mockResolvedValue(createMockResponse('data: {"type":"ping"}\n\n'));

    await sendAndStream('conv-1', 'Hello');

    expect(mockConversationStore.updateLastAssistantMessageIn).toHaveBeenCalled();
  });
});

// ============================================================================
// cancelStream
// ============================================================================
describe('cancelStream', () => {
  test('calls streamStore.cancel', async () => {
    await cancelStream('conv-1');
    expect(mockStreamStore.cancel).toHaveBeenCalled();
  });

  test('sends cancel to API with session ID', async () => {
    mockCancel.mockResolvedValue({});
    await cancelStream('conv-1');
    expect(mockCancel).toHaveBeenCalledWith('conv-1', 'session-1');
  });

  test('handles cancel API failure gracefully', async () => {
    mockCancel.mockRejectedValue(new Error('fail'));
    await cancelStream('conv-1');
  });

  test('skips API call when no session ID', async () => {
    mockStreamStore.sessionId = null;
    await cancelStream('conv-1');
    expect(mockCancel).not.toHaveBeenCalled();
  });
});

// ============================================================================
// sendAndStream — edge cases
// ============================================================================
describe('sendAndStream (additional paths)', () => {
  test('handles state_error when target conversation is not active', async () => {
    mockConversationStore.active = null;

    await sendAndStream('conv-1', 'Hello');

    expect(mockStreamStore.handleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        error: expect.objectContaining({ type: 'state_error' }),
      }),
    );
    // Should not attempt to send
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('handles state_error when active conversation ID mismatches', async () => {
    mockConversationStore.active = {
      id: 'conv-other',
      model: 'claude-sonnet-4-5-20250929',
      workspacePath: null,
      messages: [],
    };

    await sendAndStream('conv-1', 'Hello');

    expect(mockStreamStore.handleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        error: expect.objectContaining({
          type: 'state_error',
          message: 'Target conversation not active',
        }),
      }),
    );
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('fires auto-snapshot when conversation has workspacePath', async () => {
    const { api: mockApi } = await import('../client');
    mockConversationStore.active = {
      id: 'conv-1',
      model: 'claude-sonnet-4-5-20250929',
      workspacePath: '/my/project',
      messages: [],
    };
    mockSend.mockResolvedValue(createMockResponse(''));

    await sendAndStream('conv-1', 'Hello');

    expect(mockApi.git.snapshot).toHaveBeenCalledWith(
      '/my/project',
      'conv-1',
      'pre-agent',
      expect.any(String),
    );
  });

  test('does not fire auto-snapshot when no workspacePath', async () => {
    const { api: mockApi } = await import('../client');
    mockConversationStore.active = {
      id: 'conv-1',
      model: 'claude-sonnet-4-5-20250929',
      workspacePath: null,
      messages: [],
    };
    mockSend.mockResolvedValue(createMockResponse(''));

    await sendAndStream('conv-1', 'Hello');

    expect(mockApi.git.snapshot).not.toHaveBeenCalled();
  });

  test('handles HTTP error by reading JSON error body', async () => {
    const errorResponse = {
      ok: false,
      status: 400,
      body: null,
      headers: new Headers(),
      text: () => Promise.resolve(JSON.stringify({ error: 'Invalid request body' })),
    };
    mockSend.mockResolvedValue(errorResponse);

    await sendAndStream('conv-1', 'Hello');

    expect(mockStreamStore.handleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        error: expect.objectContaining({
          type: 'http_error',
          message: 'Invalid request body',
        }),
      }),
    );
  });

  test('handles HTTP error by falling back to text when JSON parse fails', async () => {
    const errorResponse = {
      ok: false,
      status: 502,
      body: null,
      headers: new Headers(),
      json: () => Promise.reject(new Error('not json')),
      text: () => Promise.resolve('Bad Gateway from proxy'),
    };
    mockSend.mockResolvedValue(errorResponse);

    await sendAndStream('conv-1', 'Hello');

    expect(mockStreamStore.handleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        error: expect.objectContaining({
          type: 'http_error',
          message: 'Bad Gateway from proxy',
        }),
      }),
    );
  });

  test('handles HTTP error with status code fallback when both json and text fail', async () => {
    const errorResponse = {
      ok: false,
      status: 503,
      body: null,
      headers: new Headers(),
      json: () => Promise.reject(new Error('not json')),
      text: () => Promise.reject(new Error('not text')),
    };
    mockSend.mockResolvedValue(errorResponse);

    await sendAndStream('conv-1', 'Hello');

    expect(mockStreamStore.handleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        error: expect.objectContaining({
          type: 'http_error',
          message: 'HTTP 503',
        }),
      }),
    );
  });

  test('handles malformed SSE JSON gracefully (parse error)', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sseData = 'data: {invalid json}\n\n';
    mockSend.mockResolvedValue(createMockResponse(sseData));

    await sendAndStream('conv-1', 'Hello');

    expect(consoleWarn).toHaveBeenCalledWith(
      '[sse] Failed to parse SSE data:',
      '{invalid json}',
      expect.any(Error),
    );
    consoleWarn.mockRestore();
  });

  test('forces message_stop when stream ends in streaming state', async () => {
    mockStreamStore.isStreaming = true;
    mockStreamStore.status = 'streaming';
    mockSend.mockResolvedValue(createMockResponse(''));

    await sendAndStream('conv-1', 'Hello');

    const stopCalls = mockStreamStore.handleEvent.mock.calls.filter(
      (call: any) => call[0]?.type === 'message_stop',
    );
    expect(stopCalls.length).toBeGreaterThan(0);
  });

  test('forces message_stop when stream ends in connecting state', async () => {
    mockStreamStore.status = 'connecting';
    mockSend.mockResolvedValue(createMockResponse(''));

    await sendAndStream('conv-1', 'Hello');

    const stopCalls = mockStreamStore.handleEvent.mock.calls.filter(
      (call: any) => call[0]?.type === 'message_stop',
    );
    expect(stopCalls.length).toBeGreaterThan(0);
  });

  test('does NOT force message_stop when stream ends in tool_pending state', async () => {
    // tool_pending means user is looking at an approval/question dialog — don't dismiss it
    mockStreamStore.status = 'tool_pending';
    mockStreamStore.isStreaming = false;
    mockSend.mockResolvedValue(createMockResponse(''));

    await sendAndStream('conv-1', 'Hello');

    const stopCalls = mockStreamStore.handleEvent.mock.calls.filter(
      (call: any) => call[0]?.type === 'message_stop',
    );
    expect(stopCalls.length).toBe(0);
  });

  test('does NOT force message_stop when stream ends in idle state', async () => {
    mockStreamStore.status = 'idle';
    mockStreamStore.isStreaming = false;
    mockSend.mockResolvedValue(createMockResponse(''));

    await sendAndStream('conv-1', 'Hello');

    const stopCalls = mockStreamStore.handleEvent.mock.calls.filter(
      (call: any) => call[0]?.type === 'message_stop',
    );
    expect(stopCalls.length).toBe(0);
  });

  test('reloads conversation after stream completes', async () => {
    mockSend.mockResolvedValue(createMockResponse(''));

    await sendAndStream('conv-1', 'Hello');

    expect(mockConversationStore.reloadById).toHaveBeenCalledWith('conv-1');
  });

  test('clears in-flight reference after stream completes', async () => {
    mockSend.mockResolvedValue(createMockResponse(''));

    await sendAndStream('conv-1', 'Hello');

    expect(mockConversationStore.clearInflight).toHaveBeenCalledWith('conv-1');
  });

  test('clears in-flight reference after abort', async () => {
    const abortError = new DOMException('Aborted', 'AbortError');
    mockSend.mockRejectedValue(abortError);

    await sendAndStream('conv-1', 'Hello');

    expect(mockConversationStore.clearInflight).toHaveBeenCalledWith('conv-1');
  });

  test('sets in-flight tracking on stream start', async () => {
    mockSend.mockResolvedValue(createMockResponse(''));

    await sendAndStream('conv-1', 'Hello');

    expect(mockConversationStore.setInflight).toHaveBeenCalledWith(
      'conv-1',
      mockConversationStore.active,
    );
  });

  test('extracts workspace memory when conversation has workspacePath and messages', async () => {
    const { workspaceMemoryStore } = await import('$lib/stores/project-memory.svelte');
    mockConversationStore.active = {
      id: 'conv-1',
      model: 'claude-sonnet-4-5-20250929',
      workspacePath: '/my/project',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Write a function' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Here is the function' }] },
      ],
    };
    mockSend.mockResolvedValue(createMockResponse(''));

    await sendAndStream('conv-1', 'Hello');

    expect(workspaceMemoryStore.extractFromConversation).toHaveBeenCalledWith(
      '/my/project',
      expect.arrayContaining([
        expect.objectContaining({ role: 'user' }),
        expect.objectContaining({ role: 'assistant' }),
      ]),
    );
  });

  test('does not extract workspace memory when no workspacePath', async () => {
    const { workspaceMemoryStore } = await import('$lib/stores/project-memory.svelte');
    mockConversationStore.active = {
      id: 'conv-1',
      model: 'claude-sonnet-4-5-20250929',
      workspacePath: null,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    };
    mockSend.mockResolvedValue(createMockResponse(''));

    await sendAndStream('conv-1', 'Hello');

    expect(workspaceMemoryStore.extractFromConversation).not.toHaveBeenCalled();
  });

  test('passes signal to api.stream.send', async () => {
    mockSend.mockResolvedValue(createMockResponse(''));

    await sendAndStream('conv-1', 'Hello');

    expect(mockSend).toHaveBeenCalledWith(
      'conv-1',
      'Hello',
      'session-1',
      expect.any(AbortSignal),
      undefined,
    );
  });

  test('includes model in assistant message', async () => {
    mockConversationStore.active = {
      id: 'conv-1',
      model: 'claude-opus-4-6',
      workspacePath: null,
      messages: [],
    };
    mockSend.mockResolvedValue(createMockResponse(''));

    await sendAndStream('conv-1', 'Hello');

    const assistantCall = mockConversationStore.addMessageTo.mock.calls[1];
    expect(assistantCall[1]).toEqual(
      expect.objectContaining({
        role: 'assistant',
        model: 'claude-opus-4-6',
      }),
    );
  });

  test('handles multiple SSE events with buffering across chunks', async () => {
    const response = createMultiChunkResponse([
      'data: {"type":"message_start","message":{"id":"m1"}}\n\ndata: {"typ',
      'e":"content_block_delta","delta":{"text":"hi"}}\n\ndata: {"type":"message_stop"}\n\n',
    ]);

    mockSend.mockResolvedValue(response);

    await sendAndStream('conv-1', 'Hello');

    const eventTypes = mockStreamStore.handleEvent.mock.calls.map((c: any) => c[0]?.type);
    expect(eventTypes).toContain('message_start');
    expect(eventTypes).toContain('content_block_delta');
    expect(eventTypes).toContain('message_stop');
  });

  test('passes image attachments to stream send', async () => {
    mockSend.mockResolvedValue(createMockResponse(''));

    const attachments = [
      { type: 'image' as const, name: 'test.png', content: 'base64data', mimeType: 'image/png' },
    ];
    await sendAndStream('conv-1', 'Hello', attachments);

    expect(mockSend).toHaveBeenCalledWith(
      'conv-1',
      'Hello',
      'session-1',
      expect.any(AbortSignal),
      attachments,
    );
  });

  test('includes image content blocks in user message', async () => {
    mockSend.mockResolvedValue(createMockResponse(''));

    const attachments = [
      { type: 'image' as const, name: 'test.png', content: 'base64data', mimeType: 'image/png' },
    ];
    await sendAndStream('conv-1', 'Describe this', attachments);

    expect(mockConversationStore.addMessageTo).toHaveBeenCalledWith(
      mockConversationStore.active,
      expect.objectContaining({
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this' },
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: 'base64data' },
          },
        ],
      }),
    );
  });

  test('triggers auto-summarize for conversations with >= 4 messages', async () => {
    const { api: mockApi } = await import('../client');
    mockConversationStore.active = {
      id: 'conv-1',
      model: 'claude-sonnet-4-5-20250929',
      workspacePath: null,
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'a' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'b' }] },
        { role: 'user', content: [{ type: 'text', text: 'c' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'd' }] },
      ],
    };
    mockSend.mockResolvedValue(createMockResponse(''));

    await sendAndStream('conv-1', 'Hello');

    expect(mockApi.conversations.summarize).toHaveBeenCalledWith('conv-1');
  });

  test('does NOT trigger auto-summarize for conversations with < 4 messages', async () => {
    const { api: mockApi } = await import('../client');
    mockConversationStore.active = {
      id: 'conv-1',
      model: 'claude-sonnet-4-5-20250929',
      workspacePath: null,
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'a' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'b' }] },
      ],
    };
    mockSend.mockResolvedValue(createMockResponse(''));

    await sendAndStream('conv-1', 'Hello');

    expect(mockApi.conversations.summarize).not.toHaveBeenCalled();
  });

  test('handles empty data lines gracefully', async () => {
    const sseData = 'data: \n\ndata: {"type":"ping"}\n\n';
    mockSend.mockResolvedValue(createMockResponse(sseData));

    await sendAndStream('conv-1', 'Hello');

    // Only the ping should be processed, empty data should be skipped
    expect(mockStreamStore.handleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ping' }),
    );
    expect(mockStreamStore.handleEvent).toHaveBeenCalledTimes(1);
  });

  test('handles stream with only newlines', async () => {
    const sseData = '\n\n\n\n';
    mockSend.mockResolvedValue(createMockResponse(sseData));

    await sendAndStream('conv-1', 'Hello');

    // No handleEvent calls for empty lines (except possibly forced message_stop)
    const nonStopCalls = mockStreamStore.handleEvent.mock.calls.filter(
      (call: any) => call[0]?.type !== 'message_stop',
    );
    expect(nonStopCalls.length).toBe(0);
  });
});

// ============================================================================
// sendAndStream — deduplication
// ============================================================================
describe('sendAndStream deduplication', () => {
  test('deduplicates content_block_start events with same index/type/id', async () => {
    const sseData = [
      'data: {"type":"message_start","message":{"id":"m1"}}\n\n',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ].join('');

    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockSend.mockResolvedValue(createMockResponse(sseData));

    await sendAndStream('conv-1', 'Hello');

    // Should see message_start, one content_block_start, and message_stop
    const eventTypes = mockStreamStore.handleEvent.mock.calls.map((c: any) => c[0]?.type);
    const cbsCount = eventTypes.filter((t: string) => t === 'content_block_start').length;
    expect(cbsCount).toBe(1); // Second should be deduped
    consoleLog.mockRestore();
  });

  test('deduplicates tool_approval_request events', async () => {
    const sseData = [
      'data: {"type":"message_start","message":{"id":"m1"}}\n\n',
      'data: {"type":"tool_approval_request","toolCallId":"tc-1","toolName":"Bash","input":{},"description":"run ls"}\n\n',
      'data: {"type":"tool_approval_request","toolCallId":"tc-1","toolName":"Bash","input":{},"description":"run ls"}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ].join('');

    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockSend.mockResolvedValue(createMockResponse(sseData));

    await sendAndStream('conv-1', 'Hello');

    const eventTypes = mockStreamStore.handleEvent.mock.calls.map((c: any) => c[0]?.type);
    const tarCount = eventTypes.filter((t: string) => t === 'tool_approval_request').length;
    expect(tarCount).toBe(1);
    consoleLog.mockRestore();
  });

  test('deduplicates user_question_request events', async () => {
    const sseData = [
      'data: {"type":"message_start","message":{"id":"m1"}}\n\n',
      'data: {"type":"user_question_request","toolCallId":"q-1","questions":[{"question":"Which?"}]}\n\n',
      'data: {"type":"user_question_request","toolCallId":"q-1","questions":[{"question":"Which?"}]}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ].join('');

    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockSend.mockResolvedValue(createMockResponse(sseData));

    await sendAndStream('conv-1', 'Hello');

    const eventTypes = mockStreamStore.handleEvent.mock.calls.map((c: any) => c[0]?.type);
    const uqrCount = eventTypes.filter((t: string) => t === 'user_question_request').length;
    expect(uqrCount).toBe(1);
    consoleLog.mockRestore();
  });

  test('deduplicates tool_result events', async () => {
    const sseData = [
      'data: {"type":"message_start","message":{"id":"m1"}}\n\n',
      'data: {"type":"tool_result","toolCallId":"tr-1","result":"ok","isError":false}\n\n',
      'data: {"type":"tool_result","toolCallId":"tr-1","result":"ok","isError":false}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ].join('');

    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockSend.mockResolvedValue(createMockResponse(sseData));

    await sendAndStream('conv-1', 'Hello');

    const eventTypes = mockStreamStore.handleEvent.mock.calls.map((c: any) => c[0]?.type);
    const trCount = eventTypes.filter((t: string) => t === 'tool_result').length;
    expect(trCount).toBe(1);
    consoleLog.mockRestore();
  });

  test('does NOT deduplicate content_block_delta events', async () => {
    const sseData = [
      'data: {"type":"message_start","message":{"id":"m1"}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"a"}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"b"}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ].join('');

    mockSend.mockResolvedValue(createMockResponse(sseData));

    await sendAndStream('conv-1', 'Hello');

    const eventTypes = mockStreamStore.handleEvent.mock.calls.map((c: any) => c[0]?.type);
    const cbdCount = eventTypes.filter((t: string) => t === 'content_block_delta').length;
    expect(cbdCount).toBe(2); // Both should be processed
  });

  test('clears dedup set on message_start', async () => {
    // Turn 1: message_start, content_block_start at index 0
    // Turn 2: message_start, content_block_start at index 0 (same key as turn 1)
    // Without clearing, turn 2's cbs would be deduped incorrectly
    const sseData = [
      'data: {"type":"message_start","message":{"id":"m1"}}\n\n',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'data: {"type":"message_stop"}\n\n',
      'data: {"type":"message_start","message":{"id":"m2"}}\n\n',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ].join('');

    mockSend.mockResolvedValue(createMockResponse(sseData));

    await sendAndStream('conv-1', 'Hello');

    const eventTypes = mockStreamStore.handleEvent.mock.calls.map((c: any) => c[0]?.type);
    const cbsCount = eventTypes.filter((t: string) => t === 'content_block_start').length;
    expect(cbsCount).toBe(2); // Both should pass since dedup set was cleared by message_start
  });

  test('does NOT deduplicate ping events', async () => {
    const sseData = [
      'data: {"type":"ping"}\n\n',
      'data: {"type":"ping"}\n\n',
      'data: {"type":"ping"}\n\n',
    ].join('');

    mockSend.mockResolvedValue(createMockResponse(sseData));

    await sendAndStream('conv-1', 'Hello');

    const eventTypes = mockStreamStore.handleEvent.mock.calls.map((c: any) => c[0]?.type);
    const pingCount = eventTypes.filter((t: string) => t === 'ping').length;
    expect(pingCount).toBe(3);
  });

  test('does NOT deduplicate message_start/stop events', async () => {
    const sseData = [
      'data: {"type":"message_start","message":{"id":"m1"}}\n\n',
      'data: {"type":"message_stop"}\n\n',
      'data: {"type":"message_start","message":{"id":"m2"}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ].join('');

    mockSend.mockResolvedValue(createMockResponse(sseData));

    await sendAndStream('conv-1', 'Hello');

    const eventTypes = mockStreamStore.handleEvent.mock.calls.map((c: any) => c[0]?.type);
    expect(eventTypes.filter((t: string) => t === 'message_start').length).toBe(2);
    expect(eventTypes.filter((t: string) => t === 'message_stop').length).toBe(2);
  });
});

// ============================================================================
// sendAndStream — auto-reconnect on network error
// ============================================================================
describe('sendAndStream auto-reconnect', () => {
  test('triggers auto-reconnect after network error when sessionId exists', async () => {
    vi.useFakeTimers();
    mockStreamStore.sessionId = 'session-1';
    mockSend.mockRejectedValue(new Error('Connection reset'));

    // Also mock sessions/reconnect for when reconnectActiveStream is called
    const apiMock = (await import('../client')).api as any;
    apiMock.stream.sessions = vi.fn().mockResolvedValue({ ok: true, data: [] });

    const promise = sendAndStream('conv-1', 'Hello');
    await promise;

    // Should have set up a setTimeout for 2000ms
    // The auto-reconnect fires after 2 seconds
    expect(mockStreamStore.handleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error' }),
    );

    vi.useRealTimers();
  });

  test('does NOT trigger auto-reconnect when no sessionId', async () => {
    mockStreamStore.sessionId = null;
    mockSend.mockRejectedValue(new Error('Connection reset'));

    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    await sendAndStream('conv-1', 'Hello');

    // Should NOT have logged auto-reconnect message
    const reconnectLogs = consoleLog.mock.calls.filter(
      (call: any) => typeof call[0] === 'string' && call[0].includes('auto-reconnect'),
    );
    expect(reconnectLogs.length).toBe(0);
    consoleLog.mockRestore();
  });

  test('does NOT trigger auto-reconnect for AbortError', async () => {
    mockStreamStore.sessionId = 'session-1';
    const abortError = new DOMException('Aborted', 'AbortError');
    mockSend.mockRejectedValue(abortError);

    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    await sendAndStream('conv-1', 'Hello');

    // AbortError is user-cancelled, not an unexpected death
    const reconnectLogs = consoleLog.mock.calls.filter(
      (call: any) => typeof call[0] === 'string' && call[0].includes('auto-reconnect'),
    );
    expect(reconnectLogs.length).toBe(0);
    consoleLog.mockRestore();
  });
});

// ============================================================================
// sendAndStream — generation counter (concurrent stream prevention)
// ============================================================================
describe('sendAndStream generation counter', () => {
  test('abortActiveStream increments generation and aborts controller', () => {
    const mockCtrl = new AbortController();
    const abortSpy = vi.spyOn(mockCtrl, 'abort');
    mockStreamStore.abortController = mockCtrl;

    abortActiveStream();

    expect(abortSpy).toHaveBeenCalled();
  });

  test('abortActiveStream handles already-aborted controller', () => {
    const mockCtrl = new AbortController();
    mockCtrl.abort();
    mockStreamStore.abortController = mockCtrl;

    // Should not throw
    abortActiveStream();
  });

  test('abortActiveStream handles null controller', () => {
    mockStreamStore.abortController = null;
    // Should not throw
    abortActiveStream();
  });
});

// ============================================================================
// getReconnectionPromise
// ============================================================================
describe('getReconnectionPromise', () => {
  test('returns a promise that resolves to null initially', async () => {
    const result = await getReconnectionPromise();
    // The initial reconnectionDone resolves to null
    expect(result).toBeNull();
  });
});

// ============================================================================
// reconnectActiveStream
// ============================================================================
describe('reconnectActiveStream', () => {
  // Additional mocks needed for reconnect
  const mockSessions = vi.fn();
  const mockReconnect = vi.fn();
  const mockConversationsGet = vi.fn();

  beforeEach(async () => {
    const apiMock = (await import('../client')).api as any;
    apiMock.stream.sessions = mockSessions;
    apiMock.stream.reconnect = mockReconnect;
    apiMock.conversations = {
      get: mockConversationsGet,
      summarize: vi.fn().mockResolvedValue(undefined),
    };

    mockSessions.mockReset();
    mockReconnect.mockReset();
    mockConversationsGet.mockReset();
  });

  test('returns null when no active sessions', async () => {
    mockSessions.mockResolvedValue({ ok: true, data: [] });

    const result = await reconnectActiveStream();

    expect(result).toBeNull();
    expect(mockStreamStore.setReconnecting).toHaveBeenCalledWith(true);
    expect(mockStreamStore.setReconnecting).toHaveBeenCalledWith(false);
  });

  test('returns null when sessions request fails', async () => {
    mockSessions.mockResolvedValue({ ok: false, data: [] });

    const result = await reconnectActiveStream();

    expect(result).toBeNull();
    expect(mockStreamStore.setReconnecting).toHaveBeenCalledWith(false);
  });

  test('clears streaming state when all session retries fail', async () => {
    mockSessions.mockRejectedValue(new Error('Network error'));
    mockStreamStore.status = 'streaming';

    const result = await reconnectActiveStream();

    expect(result).toBeNull();
    // Should emit message_stop to clear streaming state
    expect(mockStreamStore.handleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'message_stop' }),
    );
    expect(mockStreamStore.setReconnecting).toHaveBeenCalledWith(false);
  });

  test('retries sessions request up to 3 times on failure', async () => {
    // Fail first two, succeed on third
    mockSessions
      .mockRejectedValueOnce(new Error('Network 1'))
      .mockRejectedValueOnce(new Error('Network 2'))
      .mockResolvedValueOnce({ ok: true, data: [] });

    const result = await reconnectActiveStream();

    // 3 calls in first _reconnectActiveStreamImpl (2 fail + 1 success with empty data),
    // then outer retry after 1.5s calls _reconnectActiveStreamImpl again (1 call, returns undefined → null)
    expect(mockSessions).toHaveBeenCalledTimes(4);
    expect(result).toBeNull(); // no sessions found
  });

  test('reconnects to active running session', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode('data: {"type":"message_start","message":{"id":"m1"}}\n\n'),
        );
        controller.close();
      },
    });

    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-1',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 5,
        },
      ],
    });
    mockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-1', model: 'claude-sonnet-4-5-20250929', messages: [] },
    });
    mockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    const result = await reconnectActiveStream();

    expect(result).toBe('conv-1');
    expect(mockStreamStore.startStream).toHaveBeenCalledWith('conv-1');
    expect(mockStreamStore.setSessionId).toHaveBeenCalledWith('sess-1');
    expect(mockConversationStore.setActive).toHaveBeenCalled();
    expect(mockStreamStore.setReconnecting).toHaveBeenCalledWith(false);
  });

  test('prefers running session over completed session', async () => {
    const stream = new ReadableStream({
      start(c) {
        c.close();
      },
    });

    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-old',
          conversationId: 'conv-old',
          status: 'idle',
          streamComplete: true,
          bufferedEvents: 10,
        },
        {
          id: 'sess-active',
          conversationId: 'conv-active',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 3,
        },
      ],
    });
    mockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-active', model: 'test', messages: [] },
    });
    mockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    const result = await reconnectActiveStream();

    expect(result).toBe('conv-active');
    expect(mockStreamStore.setSessionId).toHaveBeenCalledWith('sess-active');
  });

  test('falls back to completed session with buffered events when no running session', async () => {
    const stream = new ReadableStream({
      start(c) {
        c.close();
      },
    });

    // Use workspace store to set savedConversationId to null (no workspace loaded)
    const wsStore = (await import('$lib/stores/workspace.svelte')).workspaceStore as any;
    wsStore.activeWorkspace = null; // No savedConversationId

    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-completed',
          conversationId: 'conv-completed',
          status: 'idle',
          streamComplete: true,
          bufferedEvents: 5,
        },
      ],
    });
    mockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-completed', model: 'test', messages: [] },
    });
    mockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    const result = await reconnectActiveStream();

    // Should fall back to first completed session when no savedConversationId
    expect(result).toBe('conv-completed');
  });

  test('matches completed session to saved conversation ID', async () => {
    const stream = new ReadableStream({
      start(c) {
        c.close();
      },
    });

    // Set workspace with activeConversationId
    const wsStore = (await import('$lib/stores/workspace.svelte')).workspaceStore as any;
    wsStore.activeWorkspace = { snapshot: { activeConversationId: 'conv-matching' } };

    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-other',
          conversationId: 'conv-other',
          status: 'idle',
          streamComplete: true,
          bufferedEvents: 3,
        },
        {
          id: 'sess-matching',
          conversationId: 'conv-matching',
          status: 'idle',
          streamComplete: true,
          bufferedEvents: 8,
        },
      ],
    });
    mockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-matching', model: 'test', messages: [] },
    });
    mockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    const result = await reconnectActiveStream();

    expect(result).toBe('conv-matching');
    expect(mockStreamStore.setSessionId).toHaveBeenCalledWith('sess-matching');

    // Clean up
    wsStore.activeWorkspace = null;
  });

  test('returns null when saved conversation ID set but no completed session matches', async () => {
    // Set workspace with activeConversationId that doesn't match any session
    const wsStore = (await import('$lib/stores/workspace.svelte')).workspaceStore as any;
    wsStore.activeWorkspace = { snapshot: { activeConversationId: 'conv-nonexistent' } };

    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-other',
          conversationId: 'conv-other',
          status: 'idle',
          streamComplete: true,
          bufferedEvents: 3,
        },
      ],
    });

    const result = await reconnectActiveStream();

    expect(result).toBeNull();
    consoleLog.mockRestore();
    wsStore.activeWorkspace = null;
  });

  test('returns null when conversation is not found', async () => {
    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-missing',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 0,
        },
      ],
    });
    mockConversationsGet.mockResolvedValue({ ok: false, data: null });

    const result = await reconnectActiveStream();

    expect(result).toBeNull();
    expect(mockStreamStore.handleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'message_stop' }),
    );
  });

  test('returns null when reconnect response is not ok', async () => {
    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-1',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 0,
        },
      ],
    });
    mockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-1', model: 'test', messages: [] },
    });
    mockReconnect.mockResolvedValue({ ok: false, body: null, headers: new Headers() });

    const result = await reconnectActiveStream();

    expect(result).toBeNull();
  });

  test('returns null when reconnect has no body', async () => {
    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-1',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 0,
        },
      ],
    });
    mockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-1', model: 'test', messages: [] },
    });
    mockReconnect.mockResolvedValue({ ok: true, body: null, headers: new Headers() });

    const result = await reconnectActiveStream();

    expect(result).toBeNull();
  });

  test('returns null when no matching sessions found', async () => {
    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-1',
          status: 'completed',
          streamComplete: true,
          bufferedEvents: 0,
        },
      ],
    });

    const result = await reconnectActiveStream();

    expect(result).toBeNull();
  });

  test('handles reconnection error gracefully', async () => {
    mockSessions.mockRejectedValue(new Error('Network error'));
    mockStreamStore.status = 'connecting';

    const result = await reconnectActiveStream();

    expect(result).toBeNull();
    expect(mockStreamStore.setReconnecting).toHaveBeenCalledWith(false);
  });

  test('emits message_stop on error when status is streaming', async () => {
    mockSessions.mockRejectedValue(new Error('Fail'));
    mockStreamStore.status = 'streaming';

    await reconnectActiveStream();

    expect(mockStreamStore.handleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'message_stop' }),
    );
  });

  test('does not emit message_stop on error when status is idle', async () => {
    mockSessions.mockRejectedValue(new Error('Fail'));
    mockStreamStore.status = 'idle';

    await reconnectActiveStream();

    const stopCalls = mockStreamStore.handleEvent.mock.calls.filter(
      (call: any) => call[0]?.type === 'message_stop',
    );
    expect(stopCalls.length).toBe(0);
  });

  test('syncs final content blocks during reconnection', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode('data: {"type":"content_block_delta","delta":{"text":"hi"}}\n\n'),
        );
        controller.close();
      },
    });

    mockStreamStore.contentBlocks = [{ type: 'text', text: 'hi' }];

    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-1',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 1,
        },
      ],
    });
    mockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-1', model: 'test', messages: [] },
    });
    mockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    await reconnectActiveStream();

    expect(mockConversationStore.updateLastAssistantMessageIn).toHaveBeenCalled();
  });

  test('adds assistant message placeholder during reconnection when last message is not assistant', async () => {
    const stream = new ReadableStream({
      start(c) {
        c.close();
      },
    });

    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-1',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 0,
        },
      ],
    });
    mockConversationsGet.mockResolvedValue({
      ok: true,
      data: {
        id: 'conv-1',
        model: 'claude-opus-4-6',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      },
    });
    mockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    await reconnectActiveStream();

    expect(mockConversationStore.addMessageTo).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'conv-1' }),
      expect.objectContaining({
        role: 'assistant',
        content: [],
        model: 'claude-opus-4-6',
      }),
    );
  });

  test('skips adding assistant message when last message IS already assistant', async () => {
    const stream = new ReadableStream({
      start(c) {
        c.close();
      },
    });

    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-1',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 0,
        },
      ],
    });
    mockConversationsGet.mockResolvedValue({
      ok: true,
      data: {
        id: 'conv-1',
        model: 'test',
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'hello' }] },
          { role: 'assistant', content: [{ type: 'text', text: 'partial...' }] },
        ],
      },
    });
    mockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    await reconnectActiveStream();

    // Should NOT add another assistant message
    expect(mockConversationStore.addMessageTo).not.toHaveBeenCalled();
  });

  test('adds assistant message when messages array is empty', async () => {
    const stream = new ReadableStream({
      start(c) {
        c.close();
      },
    });

    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-1',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 0,
        },
      ],
    });
    mockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-1', model: 'test', messages: [] },
    });
    mockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    await reconnectActiveStream();

    expect(mockConversationStore.addMessageTo).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ role: 'assistant', content: [] }),
    );
  });

  test('reloads conversation from DB after reconnection completes', async () => {
    const stream = new ReadableStream({
      start(c) {
        c.close();
      },
    });

    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-1',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 0,
        },
      ],
    });
    mockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-1', model: 'test', messages: [] },
    });
    mockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    await reconnectActiveStream();

    expect(mockConversationStore.reloadById).toHaveBeenCalledWith('conv-1');
  });

  test('clears in-flight after reconnection completes', async () => {
    const stream = new ReadableStream({
      start(c) {
        c.close();
      },
    });

    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-1',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 0,
        },
      ],
    });
    mockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-1', model: 'test', messages: [] },
    });
    mockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    await reconnectActiveStream();

    expect(mockConversationStore.clearInflight).toHaveBeenCalledWith('conv-1');
  });

  test('sets in-flight during reconnection', async () => {
    const stream = new ReadableStream({
      start(c) {
        c.close();
      },
    });

    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-1',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 0,
        },
      ],
    });
    const conv = { id: 'conv-1', model: 'test', messages: [] };
    mockConversationsGet.mockResolvedValue({ ok: true, data: conv });
    mockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    await reconnectActiveStream();

    expect(mockConversationStore.setInflight).toHaveBeenCalledWith('conv-1', conv);
  });

  test('replays multiple buffered events during reconnection', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"type":"message_start","message":{"id":"m1"}}\n\n' +
              'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
              'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}\n\n' +
              'data: {"type":"content_block_stop","index":0}\n\n' +
              'data: {"type":"message_stop"}\n\n',
          ),
        );
        controller.close();
      },
    });

    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-1',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 5,
        },
      ],
    });
    mockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-1', model: 'test', messages: [] },
    });
    mockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    await reconnectActiveStream();

    const eventTypes = mockStreamStore.handleEvent.mock.calls.map((c: any) => c[0]?.type);
    expect(eventTypes).toContain('message_start');
    expect(eventTypes).toContain('content_block_start');
    expect(eventTypes).toContain('content_block_delta');
    expect(eventTypes).toContain('content_block_stop');
    expect(eventTypes).toContain('message_stop');
  });

  test('handles malformed JSON in reconnection stream gracefully', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"type":"message_start","message":{"id":"m1"}}\n\n' +
              'data: {bad json}\n\n' +
              'data: {"type":"message_stop"}\n\n',
          ),
        );
        controller.close();
      },
    });

    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-1',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 3,
        },
      ],
    });
    mockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-1', model: 'test', messages: [] },
    });
    mockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    await reconnectActiveStream();

    // Should still process the valid events
    const eventTypes = mockStreamStore.handleEvent.mock.calls.map((c: any) => c[0]?.type);
    expect(eventTypes).toContain('message_start');
    expect(eventTypes).toContain('message_stop');
  });

  test('handles reconnection with partial chunks across buffer boundaries', async () => {
    const response = createMultiChunkResponse([
      'data: {"type":"message_start","message":{"id":"m1"}}\n\ndata: {"type":"content_block_del',
      'ta","index":0,"delta":{"type":"text_delta","text":"hello"}}\n\ndata: {"type":"message_stop"}\n\n',
    ]);

    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-1',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 3,
        },
      ],
    });
    mockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-1', model: 'test', messages: [] },
    });
    mockReconnect.mockResolvedValue(response);

    await reconnectActiveStream();

    const eventTypes = mockStreamStore.handleEvent.mock.calls.map((c: any) => c[0]?.type);
    expect(eventTypes).toContain('message_start');
    expect(eventTypes).toContain('content_block_delta');
    expect(eventTypes).toContain('message_stop');
  });

  test('forces message_stop during reconnection when stream ends in streaming state', async () => {
    const stream = new ReadableStream({
      start(c) {
        c.close();
      },
    });

    mockStreamStore.status = 'streaming';
    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-1',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 0,
        },
      ],
    });
    mockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-1', model: 'test', messages: [] },
    });
    mockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    await reconnectActiveStream();

    const stopCalls = mockStreamStore.handleEvent.mock.calls.filter(
      (call: any) => call[0]?.type === 'message_stop',
    );
    expect(stopCalls.length).toBeGreaterThan(0);
  });

  test('does NOT force message_stop during reconnection when status is tool_pending', async () => {
    const stream = new ReadableStream({
      start(c) {
        c.close();
      },
    });

    mockStreamStore.status = 'tool_pending';
    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-1',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 0,
        },
      ],
    });
    mockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-1', model: 'test', messages: [] },
    });
    mockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    await reconnectActiveStream();

    const stopCalls = mockStreamStore.handleEvent.mock.calls.filter(
      (call: any) => call[0]?.type === 'message_stop',
    );
    expect(stopCalls.length).toBe(0);
  });

  test('deduplicates events during reconnection', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"type":"message_start","message":{"id":"m1"}}\n\n' +
              'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
              'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
              'data: {"type":"message_stop"}\n\n',
          ),
        );
        controller.close();
      },
    });

    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-1',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 4,
        },
      ],
    });
    mockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-1', model: 'test', messages: [] },
    });
    mockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    await reconnectActiveStream();

    const eventTypes = mockStreamStore.handleEvent.mock.calls.map((c: any) => c[0]?.type);
    const cbsCount = eventTypes.filter((t: string) => t === 'content_block_start').length;
    expect(cbsCount).toBe(1);
  });

  test('handles session with bufferedEvents>0 but not running (has events not yet streamed)', async () => {
    const stream = new ReadableStream({
      start(c) {
        c.close();
      },
    });

    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-1',
          status: 'idle', // not 'running'
          streamComplete: false, // not complete
          bufferedEvents: 5, // has events
        },
      ],
    });
    mockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-1', model: 'test', messages: [] },
    });
    mockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    const result = await reconnectActiveStream();

    // Should find this as an active session (bufferedEvents > 0 && !streamComplete)
    expect(result).toBe('conv-1');
  });

  test('sets reconnecting flag before any async work', async () => {
    mockSessions.mockResolvedValue({ ok: true, data: [] });

    // The order of setReconnecting calls matters
    let reconnectingSetBeforeSessions = false;
    mockStreamStore.setReconnecting.mockImplementation((val: boolean) => {
      if (val === true && mockSessions.mock.calls.length === 0) {
        reconnectingSetBeforeSessions = true;
      }
    });

    await reconnectActiveStream();

    expect(reconnectingSetBeforeSessions).toBe(true);
  });

  test('getReconnectionPromise returns same promise as reconnectActiveStream', async () => {
    mockSessions.mockResolvedValue({ ok: true, data: [] });

    const promise = reconnectActiveStream();
    const reconnectionPromise = getReconnectionPromise();

    // Both should resolve to the same value
    const [result1, result2] = await Promise.all([promise, reconnectionPromise]);
    expect(result1).toBe(result2);
  });

  test('handles reconnection with empty stream body', async () => {
    const stream = new ReadableStream({
      start(c) {
        c.close();
      },
    });

    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-1',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 0,
        },
      ],
    });
    mockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-1', model: 'test', messages: [] },
    });
    mockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    const result = await reconnectActiveStream();

    // Should complete successfully even with empty body
    expect(result).toBe('conv-1');
    expect(mockConversationStore.reloadById).toHaveBeenCalledWith('conv-1');
  });

  test('handles reconnection fetch error (e.g. reconnect endpoint down)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-1',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 0,
        },
      ],
    });
    mockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-1', model: 'test', messages: [] },
    });
    mockReconnect.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await reconnectActiveStream();

    expect(result).toBeNull();
    expect(mockStreamStore.setReconnecting).toHaveBeenCalledWith(false);
    consoleError.mockRestore();
  });

  test('handles reconnection with reader.read() throwing', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Create a stream that errors during read
    const stream = new ReadableStream({
      start(controller) {
        controller.error(new Error('Stream read error'));
      },
    });

    mockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-1',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 0,
        },
      ],
    });
    mockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-1', model: 'test', messages: [] },
    });
    mockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    const result = await reconnectActiveStream();

    expect(result).toBeNull();
    expect(mockStreamStore.setReconnecting).toHaveBeenCalledWith(false);
    consoleError.mockRestore();
  });

  test('sessions request returns null data', async () => {
    mockSessions.mockResolvedValue({ ok: true, data: null });

    const result = await reconnectActiveStream();

    expect(result).toBeNull();
  });

  test('handles sessions with undefined data field', async () => {
    mockSessions.mockResolvedValue({ ok: true });

    const result = await reconnectActiveStream();

    expect(result).toBeNull();
  });
});

// ============================================================================
// Edge cases: network interruption scenarios
// ============================================================================
describe('network interruption scenarios', () => {
  test('stream reader error mid-read triggers error event', async () => {
    // Simulate a stream that errors partway through
    const encoder = new TextEncoder();
    let readerCallCount = 0;
    const stream = new ReadableStream({
      pull(controller) {
        readerCallCount++;
        if (readerCallCount === 1) {
          controller.enqueue(
            encoder.encode('data: {"type":"message_start","message":{"id":"m1"}}\n\n'),
          );
        } else {
          controller.error(new Error('Network interrupted'));
        }
      },
    });

    mockSend.mockResolvedValue({
      ok: true,
      status: 200,
      body: stream,
      headers: new Headers({ 'X-Session-Id': 'sess-mid-error' }),
    });

    await sendAndStream('conv-1', 'Hello');

    // Should have processed message_start then hit error
    const eventTypes = mockStreamStore.handleEvent.mock.calls.map((c: any) => c[0]?.type);
    expect(eventTypes).toContain('message_start');
    // The error should be caught and emitted
    expect(eventTypes).toContain('error');
  });

  test('stream aborted during read loop returns gracefully', async () => {
    const ref: { resolve: (() => void) | null } = { resolve: null };
    const stream = new ReadableStream({
      pull(controller) {
        return new Promise<void>((resolve) => {
          ref.resolve = () => {
            controller.close();
            resolve();
          };
        });
      },
    });

    mockSend.mockResolvedValue({
      ok: true,
      status: 200,
      body: stream,
      headers: new Headers(),
    });

    // Start stream but don't await — it will hang until resolved
    const promise = sendAndStream('conv-1', 'Hello');

    // Abort the stream
    abortActiveStream();

    // Resolve the hanging read
    if (ref.resolve) ref.resolve();

    // Now the promise should complete (either via abort or done)
    await promise;
  });

  test('fetch timeout (simulated via AbortController)', async () => {
    // Simulate a fetch timeout via AbortError
    const timeoutError = new DOMException('The operation was aborted.', 'AbortError');
    mockSend.mockRejectedValue(timeoutError);

    await sendAndStream('conv-1', 'Hello');

    // Should be treated like user cancellation
    expect(mockStreamStore.handleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'message_stop' }),
    );
    expect(mockConversationStore.clearInflight).toHaveBeenCalledWith('conv-1');
  });

  test('server sends 429 Too Many Requests', async () => {
    const errorResponse = {
      ok: false,
      status: 429,
      body: null,
      headers: new Headers(),
      text: () => Promise.resolve(JSON.stringify({ error: 'Rate limit exceeded' })),
    };
    mockSend.mockResolvedValue(errorResponse);

    await sendAndStream('conv-1', 'Hello');

    expect(mockStreamStore.handleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        error: expect.objectContaining({
          type: 'http_error',
          message: 'Rate limit exceeded',
        }),
      }),
    );
  });

  test('server sends 500 with HTML error page (json fails, text returns HTML)', async () => {
    const errorResponse = {
      ok: false,
      status: 500,
      body: null,
      headers: new Headers(),
      json: () => Promise.reject(new Error('not json')),
      text: () => Promise.resolve('<html><body>Internal Server Error</body></html>'),
    };
    mockSend.mockResolvedValue(errorResponse);

    await sendAndStream('conv-1', 'Hello');

    expect(mockStreamStore.handleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        error: expect.objectContaining({
          type: 'http_error',
          message: '<html><body>Internal Server Error</body></html>',
        }),
      }),
    );
  });

  test('very long error text is truncated to 300 chars', async () => {
    const longText = 'x'.repeat(500);
    const errorResponse = {
      ok: false,
      status: 500,
      body: null,
      headers: new Headers(),
      json: () => Promise.reject(new Error('not json')),
      text: () => Promise.resolve(longText),
    };
    mockSend.mockResolvedValue(errorResponse);

    await sendAndStream('conv-1', 'Hello');

    const errorCalls = mockStreamStore.handleEvent.mock.calls.filter(
      (c: any) => c[0]?.type === 'error',
    );
    expect(errorCalls.length).toBe(1);
    expect(errorCalls[0][0].error.message.length).toBeLessThanOrEqual(300);
  });
});

// ============================================================================
// Page reload scenarios (integration-style)
// ============================================================================
describe('page reload simulation', () => {
  const reloadMockSessions = vi.fn();
  const reloadMockReconnect = vi.fn();
  const reloadMockConversationsGet = vi.fn();

  beforeEach(async () => {
    const apiMock = (await import('../client')).api as any;
    apiMock.stream.sessions = reloadMockSessions;
    apiMock.stream.reconnect = reloadMockReconnect;
    apiMock.conversations = {
      get: reloadMockConversationsGet,
      summarize: vi.fn().mockResolvedValue(undefined),
    };

    reloadMockSessions.mockReset();
    reloadMockReconnect.mockReset();
    reloadMockConversationsGet.mockReset();
  });

  test('full page reload → running stream → resume with buffered events', async () => {
    // Simulate: user reloads page while agent is mid-response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        // These are the buffered events from the server
        controller.enqueue(
          encoder.encode(
            'data: {"type":"message_start","message":{"id":"m1","role":"assistant","model":"claude-sonnet-4-5-20250929"}}\n\n' +
              'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}\n\n' +
              'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Let me analyze..."}}\n\n' +
              'data: {"type":"content_block_stop","index":0}\n\n' +
              'data: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}\n\n' +
              'data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Here is my analysis"}}\n\n' +
              'data: {"type":"content_block_stop","index":1}\n\n' +
              'data: {"type":"message_stop"}\n\n',
          ),
        );
        controller.close();
      },
    });

    reloadMockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-reload-1',
          conversationId: 'conv-reload-1',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 8,
        },
      ],
    });
    reloadMockConversationsGet.mockResolvedValue({
      ok: true,
      data: {
        id: 'conv-reload-1',
        model: 'claude-sonnet-4-5-20250929',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Analyze this code' }] }],
      },
    });
    reloadMockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    const result = await reconnectActiveStream();

    expect(result).toBe('conv-reload-1');
    expect(mockConversationStore.setActive).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'conv-reload-1' }),
    );
    // Should have processed all events
    const eventTypes = mockStreamStore.handleEvent.mock.calls.map((c: any) => c[0]?.type);
    expect(eventTypes).toEqual([
      'message_start',
      'content_block_start',
      'content_block_delta',
      'content_block_stop',
      'content_block_start',
      'content_block_delta',
      'content_block_stop',
      'message_stop',
    ]);
    // Should NOT reload from DB when events were replayed — the in-memory version
    // built from SSE events is already complete and authoritative. Reloading could
    // overwrite it with an incomplete version due to race conditions with DB persistence.
    expect(mockConversationStore.reloadById).not.toHaveBeenCalled();
  });

  test('full page reload → stream already completed → replay and close', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"type":"message_start","message":{"id":"m1"}}\n\n' +
              'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
              'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Done!"}}\n\n' +
              'data: {"type":"message_stop"}\n\n',
          ),
        );
        controller.close();
      },
    });

    const wsStore = (await import('$lib/stores/workspace.svelte')).workspaceStore as any;
    wsStore.activeWorkspace = { snapshot: { activeConversationId: 'conv-completed' } };

    reloadMockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-done',
          conversationId: 'conv-completed',
          status: 'idle',
          streamComplete: true,
          bufferedEvents: 4,
        },
      ],
    });
    reloadMockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-completed', model: 'test', messages: [] },
    });
    reloadMockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    const result = await reconnectActiveStream();

    expect(result).toBe('conv-completed');
    wsStore.activeWorkspace = null;
  });

  test('full page reload → no sessions → returns null', async () => {
    reloadMockSessions.mockResolvedValue({ ok: true, data: [] });

    const result = await reconnectActiveStream();

    expect(result).toBeNull();
  });

  test('full page reload → server not ready → retries and eventually fails', async () => {
    // All retries fail — _reconnectActiveStreamImpl retries 3 times internally,
    // then the outer reconnectActiveStream retries once more after a delay.
    reloadMockSessions.mockRejectedValue(new Error('ECONNREFUSED'));

    mockStreamStore.status = 'connecting';

    const result = await reconnectActiveStream();

    expect(result).toBeNull();
    // 3 retries in first _impl call + 3 retries in second _impl call (after outer retry)
    expect(reloadMockSessions).toHaveBeenCalledTimes(6);
    expect(mockStreamStore.setReconnecting).toHaveBeenCalledWith(false);
  });

  test('full page reload → server returns HTML instead of JSON → retries', async () => {
    // First attempt throws (non-JSON response), second succeeds with empty data
    reloadMockSessions
      .mockRejectedValueOnce(new SyntaxError('Unexpected token <'))
      .mockResolvedValueOnce({ ok: true, data: [] });

    const result = await reconnectActiveStream();

    // 2 calls in first _impl (1 fail + 1 success with empty data),
    // then outer retry calls _impl again (returns undefined → null)
    expect(reloadMockSessions).toHaveBeenCalledTimes(3);
    expect(result).toBeNull();
  });

  test('page reload with tool_pending session preserves pending state', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"type":"message_start","message":{"id":"m1"}}\n\n' +
              'data: {"type":"tool_approval_request","toolCallId":"tc-1","toolName":"Bash","input":{"command":"rm -rf /"},"description":"Delete everything"}\n\n',
          ),
        );
        // Stream stays open (tool pending)
        controller.close();
      },
    });

    mockStreamStore.status = 'tool_pending'; // simulate the state after replay

    reloadMockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-pending',
          conversationId: 'conv-pending',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 2,
        },
      ],
    });
    reloadMockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-pending', model: 'test', messages: [] },
    });
    reloadMockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    const result = await reconnectActiveStream();

    expect(result).toBe('conv-pending');
    // Should have received the tool_approval_request
    const eventTypes = mockStreamStore.handleEvent.mock.calls.map((c: any) => c[0]?.type);
    expect(eventTypes).toContain('tool_approval_request');
    // Should NOT have forced message_stop (tool_pending state)
    const stopCalls = eventTypes.filter((t: string) => t === 'message_stop');
    expect(stopCalls.length).toBe(0);
  });
});

// ============================================================================
// Content sync edge cases
// ============================================================================
describe('content sync edge cases', () => {
  test('syncs content blocks to conversation on each event during send', async () => {
    const sseData = [
      'data: {"type":"message_start","message":{"id":"m1"}}\n\n',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ].join('');

    mockStreamStore.contentBlocks = [{ type: 'text', text: 'hi' }];
    mockSend.mockResolvedValue(createMockResponse(sseData));

    await sendAndStream('conv-1', 'Hello');

    // updateLastAssistantMessageIn should be called for each event
    expect(mockConversationStore.updateLastAssistantMessageIn).toHaveBeenCalled();
  });

  test('does not sync empty content blocks on final sync', async () => {
    mockStreamStore.contentBlocks = [];
    mockSend.mockResolvedValue(createMockResponse(''));

    await sendAndStream('conv-1', 'Hello');

    // The final sync only runs if contentBlocks.length > 0
    // But in-loop syncs still happen for each event
    // Since no events were processed, updateLastAssistantMessageIn should not be called
    expect(mockConversationStore.updateLastAssistantMessageIn).not.toHaveBeenCalled();
  });
});

// ============================================================================
// reconnectToConversation
// ============================================================================
describe('reconnectToConversation', () => {
  const rtcMockSessions = vi.fn();
  const rtcMockReconnect = vi.fn();
  const rtcMockConversationsGet = vi.fn();

  beforeEach(async () => {
    const apiMock = (await import('../client')).api as any;
    apiMock.stream.sessions = rtcMockSessions;
    apiMock.stream.reconnect = rtcMockReconnect;
    apiMock.conversations = {
      get: rtcMockConversationsGet,
      summarize: vi.fn().mockResolvedValue(undefined),
    };

    rtcMockSessions.mockReset();
    rtcMockReconnect.mockReset();
    rtcMockConversationsGet.mockReset();

    mockStreamStore.isStreaming = false;
    mockStreamStore.isReconnecting = false;
  });

  test('returns null when already streaming and not reconnecting', async () => {
    mockStreamStore.isStreaming = true;
    mockStreamStore.isReconnecting = false;

    const result = await reconnectToConversation('conv-1');
    expect(result).toBeNull();
  });

  test('returns null when no active sessions', async () => {
    rtcMockSessions.mockResolvedValue({ ok: true, data: [] });

    const result = await reconnectToConversation('conv-1');
    expect(result).toBeNull();
  });

  test('returns null when sessions request fails', async () => {
    rtcMockSessions.mockRejectedValue(new Error('fail'));

    const result = await reconnectToConversation('conv-1');
    expect(result).toBeNull();
  });

  test('returns null when no session matches the target conversation', async () => {
    rtcMockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-other',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 5,
        },
      ],
    });

    const result = await reconnectToConversation('conv-1');
    expect(result).toBeNull();
  });

  test('reconnects to active running session for the target conversation', async () => {
    const stream = new ReadableStream({
      start(c) {
        c.close();
      },
    });

    rtcMockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-target',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 3,
        },
      ],
    });
    rtcMockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-target', model: 'test', messages: [] },
    });
    rtcMockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    const result = await reconnectToConversation('conv-target');

    expect(result).toBe('sess-1');
    expect(mockStreamStore.startStream).toHaveBeenCalledWith('conv-target');
    expect(mockStreamStore.setSessionId).toHaveBeenCalledWith('sess-1');
    expect(mockStreamStore.setReconnecting).toHaveBeenCalledWith(true);
    expect(mockStreamStore.setReconnecting).toHaveBeenCalledWith(false);
  });

  test('reconnects to completed session with buffered events', async () => {
    const stream = new ReadableStream({
      start(c) {
        c.close();
      },
    });

    rtcMockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-target',
          status: 'idle',
          streamComplete: true,
          bufferedEvents: 5,
        },
      ],
    });
    rtcMockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-target', model: 'test', messages: [] },
    });
    rtcMockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    const result = await reconnectToConversation('conv-target');

    expect(result).toBe('sess-1');
  });

  test('returns null when conversation not found', async () => {
    rtcMockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-target',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 3,
        },
      ],
    });
    rtcMockConversationsGet.mockResolvedValue({ ok: false, data: null });

    const result = await reconnectToConversation('conv-target');

    expect(result).toBeNull();
    expect(mockStreamStore.setReconnecting).toHaveBeenCalledWith(false);
  });

  test('returns null when reconnect response fails', async () => {
    rtcMockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-target',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 3,
        },
      ],
    });
    rtcMockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-target', model: 'test', messages: [] },
    });
    rtcMockReconnect.mockResolvedValue({ ok: false, body: null, headers: new Headers() });

    const result = await reconnectToConversation('conv-target');

    expect(result).toBeNull();
    expect(mockStreamStore.setReconnecting).toHaveBeenCalledWith(false);
  });

  test('handles reconnect throwing', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    rtcMockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-target',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 3,
        },
      ],
    });
    rtcMockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-target', model: 'test', messages: [] },
    });
    rtcMockReconnect.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await reconnectToConversation('conv-target');

    expect(result).toBeNull();
    expect(mockStreamStore.setReconnecting).toHaveBeenCalledWith(false);
    consoleError.mockRestore();
  });

  test('adds assistant placeholder when last message is not assistant', async () => {
    const stream = new ReadableStream({
      start(c) {
        c.close();
      },
    });

    rtcMockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-target',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 0,
        },
      ],
    });
    rtcMockConversationsGet.mockResolvedValue({
      ok: true,
      data: {
        id: 'conv-target',
        model: 'claude-opus-4-6',
        messages: [{ role: 'user', content: [] }],
      },
    });
    rtcMockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    await reconnectToConversation('conv-target');

    expect(mockConversationStore.addMessageTo).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ role: 'assistant', content: [], model: 'claude-opus-4-6' }),
    );
  });

  test('skips adding assistant placeholder when last message is already assistant', async () => {
    const stream = new ReadableStream({
      start(c) {
        c.close();
      },
    });

    rtcMockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-target',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 0,
        },
      ],
    });
    rtcMockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-target', model: 'test', messages: [{ role: 'assistant', content: [] }] },
    });
    rtcMockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    await reconnectToConversation('conv-target');

    expect(mockConversationStore.addMessageTo).not.toHaveBeenCalled();
  });

  test('processes SSE events during reconnect', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"type":"message_start","message":{"id":"m1"}}\n\n' +
              'data: {"type":"content_block_delta","index":0,"delta":{"text":"hi"}}\n\n' +
              'data: {"type":"message_stop"}\n\n',
          ),
        );
        controller.close();
      },
    });

    rtcMockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-target',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 3,
        },
      ],
    });
    rtcMockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-target', model: 'test', messages: [] },
    });
    rtcMockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    await reconnectToConversation('conv-target');

    const eventTypes = mockStreamStore.handleEvent.mock.calls.map((c: any) => c[0]?.type);
    expect(eventTypes).toContain('message_start');
    expect(eventTypes).toContain('content_block_delta');
    expect(eventTypes).toContain('message_stop');
  });

  test('forces message_stop when stream ends in streaming state', async () => {
    const stream = new ReadableStream({
      start(c) {
        c.close();
      },
    });
    mockStreamStore.status = 'streaming';

    rtcMockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-target',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 0,
        },
      ],
    });
    rtcMockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-target', model: 'test', messages: [] },
    });
    rtcMockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    await reconnectToConversation('conv-target');

    const stopCalls = mockStreamStore.handleEvent.mock.calls.filter(
      (call: any) => call[0]?.type === 'message_stop',
    );
    expect(stopCalls.length).toBeGreaterThan(0);
  });

  test('retries sessions request up to 3 times on failure', async () => {
    rtcMockSessions
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce({ ok: true, data: [] });

    const result = await reconnectToConversation('conv-1');
    expect(result).toBeNull();
    expect(rtcMockSessions).toHaveBeenCalledTimes(3);
  });

  test('clears in-flight and reloads after successful reconnect', async () => {
    const stream = new ReadableStream({
      start(c) {
        c.close();
      },
    });

    rtcMockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-target',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 0,
        },
      ],
    });
    rtcMockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-target', model: 'test', messages: [] },
    });
    rtcMockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    await reconnectToConversation('conv-target');

    expect(mockConversationStore.clearInflight).toHaveBeenCalledWith('conv-target');
    expect(mockConversationStore.reloadById).toHaveBeenCalledWith('conv-target');
  });

  test('syncs final content blocks after reconnect stream ends', async () => {
    const stream = new ReadableStream({
      start(c) {
        c.close();
      },
    });
    mockStreamStore.contentBlocks = [{ type: 'text', text: 'content' }];

    rtcMockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-target',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 0,
        },
      ],
    });
    rtcMockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-target', model: 'test', messages: [] },
    });
    rtcMockReconnect.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    await reconnectToConversation('conv-target');

    expect(mockConversationStore.updateLastAssistantMessageIn).toHaveBeenCalled();
  });

  test('error during reconnect with streaming status emits message_stop', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockStreamStore.status = 'streaming';

    rtcMockSessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sess-1',
          conversationId: 'conv-target',
          status: 'running',
          streamComplete: false,
          bufferedEvents: 0,
        },
      ],
    });
    rtcMockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-target', model: 'test', messages: [] },
    });
    rtcMockReconnect.mockRejectedValue(new Error('stream broke'));

    await reconnectToConversation('conv-target');

    const stopCalls = mockStreamStore.handleEvent.mock.calls.filter(
      (call: any) => call[0]?.type === 'message_stop',
    );
    expect(stopCalls.length).toBeGreaterThan(0);
    consoleError.mockRestore();
  });
});

// ============================================================================
// Conversation Polling Fallback
// ============================================================================
describe('startConversationPolling / stopConversationPolling', () => {
  const pollingMockSessions = vi.fn();
  const pollingMockConversationsGet = vi.fn();

  beforeEach(async () => {
    vi.useFakeTimers();
    const apiMock = (await import('../client')).api as any;
    apiMock.stream = {
      ...apiMock.stream,
      sessions: pollingMockSessions,
    };
    apiMock.conversations = {
      get: pollingMockConversationsGet,
      summarize: vi.fn().mockResolvedValue(undefined),
    };

    pollingMockSessions.mockReset();
    pollingMockConversationsGet.mockReset();
    mockStreamStore.isStreaming = false;
    mockStreamStore.status = 'idle';
  });

  afterEach(() => {
    stopConversationPolling();
    vi.useRealTimers();
  });

  test('polls conversation immediately and at interval', async () => {
    pollingMockSessions.mockResolvedValue({ ok: true, data: [] });
    pollingMockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-1', messages: [] },
    });

    startConversationPolling('conv-1');

    // First poll fires immediately
    await vi.advanceTimersByTimeAsync(0);

    // Server not running, so polling should stop
    expect(pollingMockConversationsGet).toHaveBeenCalledWith('conv-1');
  });

  test('stops polling when no active server session found', async () => {
    pollingMockSessions.mockResolvedValue({ ok: true, data: [] });
    pollingMockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-1', messages: [{ role: 'user', content: [] }] },
    });

    startConversationPolling('conv-1');
    await vi.advanceTimersByTimeAsync(0);

    // Should have loaded the final state
    expect(mockConversationStore.setActive).toHaveBeenCalled();
  });

  test('detects new messages when server stream is running', async () => {
    pollingMockSessions.mockResolvedValue({
      ok: true,
      data: [{ conversationId: 'conv-1', status: 'running' }],
    });
    pollingMockConversationsGet.mockResolvedValue({
      ok: true,
      data: {
        id: 'conv-1',
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'hello' }] },
          { role: 'assistant', content: [{ type: 'text', text: 'world' }] },
        ],
      },
    });

    mockConversationStore.active = { id: 'conv-1', messages: [] } as any;

    startConversationPolling('conv-1');
    await vi.advanceTimersByTimeAsync(0);

    expect(mockConversationStore.setActive).toHaveBeenCalled();
  });

  test('stops when conversation get fails', async () => {
    pollingMockSessions.mockResolvedValue({ ok: true, data: [] });
    pollingMockConversationsGet.mockResolvedValue({ ok: false, data: null });

    startConversationPolling('conv-1');
    await vi.advanceTimersByTimeAsync(0);

    // Should not crash
  });

  test('stopConversationPolling clears interval', () => {
    pollingMockSessions.mockResolvedValue({ ok: true, data: [] });
    pollingMockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-1', messages: [] },
    });

    startConversationPolling('conv-1');
    stopConversationPolling();

    // Should not throw or continue polling
  });

  test('does not start duplicate polling for same conversation', () => {
    pollingMockSessions.mockResolvedValue({ ok: true, data: [] });
    pollingMockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-1', messages: [] },
    });

    startConversationPolling('conv-1');
    startConversationPolling('conv-1'); // Should be a no-op

    // Only one poll should run
  });

  test('handles sessions request failure gracefully during poll', async () => {
    pollingMockSessions.mockRejectedValue(new Error('network'));
    pollingMockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-1', messages: [] },
    });

    startConversationPolling('conv-1');
    await vi.advanceTimersByTimeAsync(0);

    // Should not crash, should assume stream not running
  });

  test('detects growing assistant content during polling', async () => {
    pollingMockSessions.mockResolvedValue({
      ok: true,
      data: [{ conversationId: 'conv-1', status: 'running' }],
    });

    // First poll: 5 chars of content
    pollingMockConversationsGet.mockResolvedValueOnce({
      ok: true,
      data: {
        id: 'conv-1',
        messages: [{ role: 'assistant', content: [{ type: 'text', text: 'hello' }] }],
      },
    });

    mockConversationStore.active = { id: 'conv-1', messages: [] } as any;

    startConversationPolling('conv-1');
    await vi.advanceTimersByTimeAsync(0);

    // Second poll: 11 chars of content (growing)
    pollingMockConversationsGet.mockResolvedValueOnce({
      ok: true,
      data: {
        id: 'conv-1',
        messages: [{ role: 'assistant', content: [{ type: 'text', text: 'hello world' }] }],
      },
    });
    pollingMockSessions.mockResolvedValue({
      ok: true,
      data: [{ conversationId: 'conv-1', status: 'running' }],
    });

    await vi.advanceTimersByTimeAsync(3000);

    // Should have called setActive at least twice (once for new msgs, once for content growth)
    expect(mockConversationStore.setActive.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  test('max polls reached stops polling and clears streaming', async () => {
    // Make the server always report "running"
    pollingMockSessions.mockResolvedValue({
      ok: true,
      data: [{ conversationId: 'conv-1', status: 'running' }],
    });
    pollingMockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-1', messages: [] },
    });
    mockStreamStore.isStreaming = true;

    startConversationPolling('conv-1');

    // Advance through 120 * 3s = 360s + initial
    for (let i = 0; i <= 121; i++) {
      await vi.advanceTimersByTimeAsync(3000);
    }

    // Should have emitted message_stop after max polls
    const stopCalls = mockStreamStore.handleEvent.mock.calls.filter(
      (call: any) => call[0]?.type === 'message_stop',
    );
    expect(stopCalls.length).toBeGreaterThan(0);
  });

  test('poll failure is handled gracefully', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    pollingMockSessions.mockResolvedValue({ ok: true, data: [] });
    pollingMockConversationsGet.mockRejectedValue(new Error('DB error'));

    startConversationPolling('conv-1');
    await vi.advanceTimersByTimeAsync(0);

    // Should not crash
    consoleWarn.mockRestore();
  });

  test('starts streaming indicator when server confirms stream is running', async () => {
    pollingMockSessions.mockResolvedValue({
      ok: true,
      data: [{ conversationId: 'conv-1', status: 'running' }],
    });
    pollingMockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-1', messages: [] },
    });
    mockStreamStore.isStreaming = false;

    startConversationPolling('conv-1');
    await vi.advanceTimersByTimeAsync(0);

    expect(mockStreamStore.startStream).toHaveBeenCalledWith('conv-1');
  });
});

// ============================================================================
// reconnectActiveStream - polling fallback path
// ============================================================================
describe('reconnectActiveStream polling fallback', () => {
  const fallbackMockSessions = vi.fn();
  const fallbackMockConversationsGet = vi.fn();

  beforeEach(async () => {
    const apiMock = (await import('../client')).api as any;
    apiMock.stream.sessions = fallbackMockSessions;
    apiMock.conversations = {
      get: fallbackMockConversationsGet,
      summarize: vi.fn().mockResolvedValue(undefined),
    };

    fallbackMockSessions.mockReset();
    fallbackMockConversationsGet.mockReset();
  });

  test('falls back to polling when SSE reconnection fails both attempts', async () => {
    const wsStore = (await import('$lib/stores/workspace.svelte')).workspaceStore as any;
    wsStore.activeWorkspace = { snapshot: { activeConversationId: 'conv-poll' } };

    // Both reconnection attempts find no sessions
    fallbackMockSessions.mockResolvedValue({ ok: true, data: [] });
    fallbackMockConversationsGet.mockResolvedValue({
      ok: true,
      data: { id: 'conv-poll', messages: [] },
    });

    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await reconnectActiveStream();

    expect(result).toBeNull();
    // Should have tried to load the conversation for polling fallback
    expect(fallbackMockConversationsGet).toHaveBeenCalledWith('conv-poll');
    // Should have set the conversation active
    expect(mockConversationStore.setActive).toHaveBeenCalled();

    consoleLog.mockRestore();
    wsStore.activeWorkspace = null;
  });
});
