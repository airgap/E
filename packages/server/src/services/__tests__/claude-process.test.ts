import { describe, test, expect, beforeEach, mock, spyOn } from 'bun:test';
import { createTestDb } from '../../test-helpers';

const testDb = createTestDb();
mock.module('../../db/database', () => ({
  getDb: () => testDb,
  initDatabase: () => {},
}));

// NOTE: We intentionally do NOT mock '../cli-provider', '../../middleware/sandbox', or
// '../code-verifier' because Bun's mock.module is global and would contaminate their own tests.
// These modules are safe to use as-is since they don't make network calls.
mock.module('../mcp-config', () => ({
  generateMcpConfig: () => null,
}));

import { translateCliEvent, claudeManager } from '../claude-process';

describe('translateCliEvent', () => {
  test('returns empty array for system event', () => {
    const events = translateCliEvent({ type: 'system', subtype: 'init', session_id: 'abc' });
    expect(events).toEqual([]);
  });

  test('returns empty array for unknown event type', () => {
    const events = translateCliEvent({ type: 'unknown_type' });
    expect(events).toEqual([]);
  });

  test('translates assistant text message', () => {
    const events = translateCliEvent({
      type: 'assistant',
      message: {
        id: 'msg-1',
        model: 'claude-sonnet-4-5-20250929',
        content: [{ type: 'text', text: 'Hello world' }],
      },
    });

    const parsed = events.map((e) => JSON.parse(e));

    // message_start
    expect(parsed[0].type).toBe('message_start');
    expect(parsed[0].message.role).toBe('assistant');
    expect(parsed[0].message.model).toBe('claude-sonnet-4-5-20250929');

    // content_block_start
    expect(parsed[1].type).toBe('content_block_start');
    expect(parsed[1].index).toBe(0);
    expect(parsed[1].content_block.type).toBe('text');

    // content_block_delta
    expect(parsed[2].type).toBe('content_block_delta');
    expect(parsed[2].delta.type).toBe('text_delta');
    expect(parsed[2].delta.text).toBe('Hello world');

    // content_block_stop
    expect(parsed[3].type).toBe('content_block_stop');
    expect(parsed[3].index).toBe(0);
  });

  test('translates assistant thinking block', () => {
    const events = translateCliEvent({
      type: 'assistant',
      message: {
        content: [{ type: 'thinking', thinking: 'Let me think...' }],
      },
    });

    const parsed = events.map((e) => JSON.parse(e));
    // Skip message_start (index 0)
    expect(parsed[1].content_block.type).toBe('thinking');
    expect(parsed[2].delta.type).toBe('thinking_delta');
    expect(parsed[2].delta.thinking).toBe('Let me think...');
  });

  test('translates assistant tool_use block', () => {
    const events = translateCliEvent({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'tool-1',
            name: 'Bash',
            input: { command: 'ls' },
          },
        ],
      },
    });

    const parsed = events.map((e) => JSON.parse(e));
    expect(parsed[1].content_block.type).toBe('tool_use');
    expect(parsed[1].content_block.name).toBe('Bash');
    expect(parsed[1].content_block.id).toBe('tool-1');
    expect(parsed[2].delta.type).toBe('input_json_delta');
    expect(JSON.parse(parsed[2].delta.partial_json)).toEqual({ command: 'ls' });
  });

  test('translates multiple content blocks', () => {
    const events = translateCliEvent({
      type: 'assistant',
      message: {
        content: [
          { type: 'thinking', thinking: 'hmm' },
          { type: 'text', text: 'Here is the answer' },
        ],
      },
    });

    const parsed = events.map((e) => JSON.parse(e));
    // message_start + (start,delta,stop) * 2 = 7 events
    expect(parsed).toHaveLength(7);
    expect(parsed[1].index).toBe(0);
    expect(parsed[4].index).toBe(1);
  });

  test('translates result event with usage', () => {
    const events = translateCliEvent({
      type: 'result',
      subtype: 'success',
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 10,
        cache_read_input_tokens: 5,
      },
    });

    const parsed = events.map((e) => JSON.parse(e));
    expect(parsed).toHaveLength(2);
    expect(parsed[0].type).toBe('message_delta');
    expect(parsed[0].delta.stop_reason).toBe('end_turn');
    expect(parsed[0].usage.input_tokens).toBe(100);
    expect(parsed[0].usage.output_tokens).toBe(50);
    expect(parsed[0].usage.cache_creation_input_tokens).toBe(10);
    expect(parsed[0].usage.cache_read_input_tokens).toBe(5);
    expect(parsed[1].type).toBe('message_stop');
  });

  test('handles result with defaults', () => {
    const events = translateCliEvent({ type: 'result' });
    const parsed = events.map((e) => JSON.parse(e));
    expect(parsed[0].delta.stop_reason).toBe('end_turn');
    expect(parsed[0].usage.input_tokens).toBe(0);
    expect(parsed[0].usage.output_tokens).toBe(0);
  });

  test('handles assistant event with no message', () => {
    const events = translateCliEvent({ type: 'assistant' });
    expect(events).toEqual([]);
  });

  test('preserves parent_tool_use_id', () => {
    const events = translateCliEvent({
      type: 'assistant',
      parent_tool_use_id: 'parent-1',
      message: {
        content: [{ type: 'text', text: 'nested' }],
      },
    });

    const parsed = events.map((e) => JSON.parse(e));
    for (const evt of parsed) {
      expect(evt.parent_tool_use_id).toBe('parent-1');
    }
  });

  test('handles empty content array', () => {
    const events = translateCliEvent({
      type: 'assistant',
      message: { content: [] },
    });
    const parsed = events.map((e) => JSON.parse(e));
    // Only message_start
    expect(parsed).toHaveLength(1);
    expect(parsed[0].type).toBe('message_start');
  });

  test('assigns id when message has none', () => {
    const events = translateCliEvent({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'hi' }] },
    });
    const parsed = JSON.parse(events[0]);
    expect(parsed.message.id).toBeTruthy();
    expect(parsed.message.model).toBe('unknown');
  });
});

describe('ClaudeProcessManager', () => {
  test('createSession returns a session id', async () => {
    const sessionId = await claudeManager.createSession('conv-test-1');
    expect(sessionId).toBeTruthy();
    expect(typeof sessionId).toBe('string');
  });

  test('createSession stores session with correct defaults', async () => {
    const sessionId = await claudeManager.createSession('conv-test-2');
    const session = claudeManager.getSession(sessionId);
    expect(session).toBeDefined();
    expect(session!.conversationId).toBe('conv-test-2');
    expect(session!.status).toBe('idle');
  });

  test('createSession stores options', async () => {
    const sessionId = await claudeManager.createSession('conv-test-3', {
      model: 'claude-opus-4-6',
      systemPrompt: 'Be helpful',
      workspacePath: '/tmp',
      effort: 'high',
      maxBudgetUsd: 5.0,
      maxTurns: 10,
      allowedTools: ['Read'],
      disallowedTools: ['Bash'],
      resumeSessionId: 'cli-sess-1',
    });
    const session = claudeManager.getSession(sessionId);
    expect(session!.model).toBe('claude-opus-4-6');
    expect(session!.systemPrompt).toBe('Be helpful');
    expect(session!.workspacePath).toBe('/tmp');
    expect(session!.effort).toBe('high');
    expect(session!.maxBudgetUsd).toBe(5.0);
    expect(session!.maxTurns).toBe(10);
    expect(session!.allowedTools).toEqual(['Read']);
    expect(session!.disallowedTools).toEqual(['Bash']);
    expect(session!.cliSessionId).toBe('cli-sess-1');
  });

  test('getSession returns undefined for unknown id', () => {
    expect(claudeManager.getSession('nonexistent')).toBeUndefined();
  });

  test('listSessions returns all sessions', async () => {
    const id1 = await claudeManager.createSession('conv-list-1');
    const id2 = await claudeManager.createSession('conv-list-2');
    const sessions = claudeManager.listSessions();
    const ids = sessions.map((s) => s.id);
    expect(ids).toContain(id1);
    expect(ids).toContain(id2);
  });

  test('terminateSession removes session', async () => {
    const sessionId = await claudeManager.createSession('conv-term-1');
    expect(claudeManager.getSession(sessionId)).toBeDefined();
    claudeManager.terminateSession(sessionId);
    expect(claudeManager.getSession(sessionId)).toBeUndefined();
  });

  test('terminateSession does nothing for unknown id', () => {
    // Should not throw
    claudeManager.terminateSession('nonexistent');
  });

  test('cancelGeneration does nothing for unknown id', () => {
    // Should not throw
    claudeManager.cancelGeneration('nonexistent');
  });

  test('sendMessage throws for unknown session', async () => {
    try {
      await claudeManager.sendMessage('nonexistent', 'hello');
      expect(true).toBe(false); // Should not reach here
    } catch (e: any) {
      expect(e.message).toContain('not found');
    }
  });

  test('sendMessage throws for terminated session', async () => {
    const sessionId = await claudeManager.createSession('conv-term-2');
    claudeManager.terminateSession(sessionId);

    // Re-create to test terminated state manually
    const sessionId2 = await claudeManager.createSession('conv-term-3');
    const session = claudeManager.getSession(sessionId2);
    session!.status = 'terminated';

    try {
      await claudeManager.sendMessage(sessionId2, 'hello');
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e.message).toContain('terminated');
    }
  });

  test('writeStdin returns false for unknown session', () => {
    const result = claudeManager.writeStdin('nonexistent', 'some data');
    expect(result).toBe(false);
  });

  test('writeStdin returns false for session without cliProcess', async () => {
    const sessionId = await claudeManager.createSession('conv-stdin-1');
    const result = claudeManager.writeStdin(sessionId, 'some data');
    expect(result).toBe(false);
  });

  test('cancelGeneration emits cancel event on active session', async () => {
    const sessionId = await claudeManager.createSession('conv-cancel-1');
    const session = claudeManager.getSession(sessionId);
    let cancelEmitted = false;
    session!.emitter.once('cancel', () => {
      cancelEmitted = true;
    });
    claudeManager.cancelGeneration(sessionId);
    expect(cancelEmitted).toBe(true);
  });

  test('terminateSession clears cleanup timers', async () => {
    const sessionId = await claudeManager.createSession('conv-cleanup-timer-1');
    // Terminate should not throw even if there's no cleanup timer
    claudeManager.terminateSession(sessionId);
    expect(claudeManager.getSession(sessionId)).toBeUndefined();
  });

  test('listSessions returns correct fields', async () => {
    const sessionId = await claudeManager.createSession('conv-list-fields-1');
    const sessions = claudeManager.listSessions();
    const session = sessions.find((s) => s.id === sessionId);
    expect(session).toBeDefined();
    expect(session!.conversationId).toBe('conv-list-fields-1');
    expect(session!.status).toBe('idle');
    expect(session!.streamComplete).toBe(false);
    expect(session!.bufferedEvents).toBe(0);
  });

  test('reconnectStream returns null for unknown session', () => {
    const stream = claudeManager.reconnectStream('nonexistent');
    expect(stream).toBeNull();
  });

  test('reconnectStream returns stream for running session with empty event buffer', async () => {
    // Running sessions (not yet complete) should return a live stream even if
    // no events have buffered yet — the stream may have just started.
    const sessionId = await claudeManager.createSession('conv-reconnect-empty');
    const stream = claudeManager.reconnectStream(sessionId);
    expect(stream).toBeInstanceOf(ReadableStream);
  });

  test('reconnectStream returns null for completed session with empty event buffer', async () => {
    const sessionId = await claudeManager.createSession('conv-reconnect-empty-complete');
    const session = claudeManager.getSession(sessionId)!;
    session.streamComplete = true;
    const stream = claudeManager.reconnectStream(sessionId);
    expect(stream).toBeNull();
  });

  test('reconnectStream replays buffered events for completed stream', async () => {
    const sessionId = await claudeManager.createSession('conv-reconnect-1');
    const session = claudeManager.getSession(sessionId)!;

    // Manually populate event buffer and mark complete
    session.eventBuffer.push('data: {"type":"message_start"}\n\n');
    session.eventBuffer.push('data: {"type":"content_block_delta","delta":{"text":"hello"}}\n\n');
    session.eventBuffer.push('data: {"type":"message_stop"}\n\n');
    session.streamComplete = true;

    const stream = claudeManager.reconnectStream(sessionId);
    expect(stream).not.toBeNull();

    // Read all events from the reconnection stream
    const reader = stream!.getReader();
    const decoder = new TextDecoder();
    let allData = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      allData += decoder.decode(value, { stream: true });
    }

    expect(allData).toContain('message_start');
    expect(allData).toContain('content_block_delta');
    expect(allData).toContain('message_stop');
  });

  test('createSession initializes eventBuffer and streamComplete', async () => {
    const sessionId = await claudeManager.createSession('conv-init-check');
    const session = claudeManager.getSession(sessionId)!;
    expect(session.eventBuffer).toEqual([]);
    expect(session.streamComplete).toBe(false);
  });

  test('sendMessage sets session status to running before spawning', async () => {
    // Insert a conversation so DB operations don't fail
    testDb
      .query(
        "INSERT OR IGNORE INTO conversations (id, title, model, created_at, updated_at) VALUES ('conv-status-1', 'Test', 'claude-sonnet-4-5-20250929', ?, ?)",
      )
      .run(Date.now(), Date.now());

    const sessionId = await claudeManager.createSession('conv-status-1');
    const stream = await claudeManager.sendMessage(sessionId, 'hello');
    // The stream is returned, meaning the process was spawned (or an error stream was created)
    expect(stream).toBeDefined();
    expect(stream instanceof ReadableStream).toBe(true);

    // Clean up
    claudeManager.terminateSession(sessionId);
  });
});

// ============================================================================
// reconnectStream — comprehensive tests
// ============================================================================
describe('reconnectStream', () => {
  test('returns null for unknown session', () => {
    expect(claudeManager.reconnectStream('nonexistent-reconnect')).toBeNull();
  });

  test('returns null for completed session with no buffered events', async () => {
    const sessionId = await claudeManager.createSession('conv-reconnect-no-events');
    const session = claudeManager.getSession(sessionId)!;
    session.streamComplete = true;
    session.eventBuffer = [];

    expect(claudeManager.reconnectStream(sessionId)).toBeNull();
  });

  test('returns ReadableStream for idle session with empty buffer (not complete)', async () => {
    // Session just started, no events yet but stream is not complete
    const sessionId = await claudeManager.createSession('conv-reconnect-idle');
    const session = claudeManager.getSession(sessionId)!;
    session.streamComplete = false;
    session.eventBuffer = [];

    const stream = claudeManager.reconnectStream(sessionId);
    expect(stream).toBeInstanceOf(ReadableStream);
  });

  test('replays all buffered events for completed session', async () => {
    const sessionId = await claudeManager.createSession('conv-reconnect-replay');
    const session = claudeManager.getSession(sessionId)!;

    const events = [
      'data: {"type":"message_start","message":{"id":"m1","role":"assistant"}}\n\n',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello world"}}\n\n',
      'data: {"type":"content_block_stop","index":0}\n\n',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":10,"output_tokens":5}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ];

    session.eventBuffer = [...events];
    session.streamComplete = true;

    const stream = claudeManager.reconnectStream(sessionId)!;
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let allData = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      allData += decoder.decode(value, { stream: true });
    }

    // All events should be present in the output
    expect(allData).toContain('message_start');
    expect(allData).toContain('content_block_start');
    expect(allData).toContain('Hello world');
    expect(allData).toContain('content_block_stop');
    expect(allData).toContain('message_delta');
    expect(allData).toContain('message_stop');
  });

  test('replays events and then sends new events for running session', async () => {
    const sessionId = await claudeManager.createSession('conv-reconnect-live');
    const session = claudeManager.getSession(sessionId)!;

    // Initial buffered events
    session.eventBuffer = [
      'data: {"type":"message_start","message":{"id":"m1","role":"assistant"}}\n\n',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
    ];
    session.streamComplete = false;

    const stream = claudeManager.reconnectStream(sessionId)!;
    const reader = stream.getReader();
    const decoder = new TextDecoder();

    // Read the first batch (buffered events + possibly a ping)
    let allData = '';
    const { done: done1, value: value1 } = await reader.read();
    if (!done1 && value1) {
      allData += decoder.decode(value1, { stream: true });
    }

    // Should have received at least message_start
    expect(allData).toContain('message_start');

    // Now simulate new events arriving while connected
    session.eventBuffer.push(
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"new text"}}\n\n',
    );

    // Wait for the 100ms poll interval to pick up the new event
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Read more data
    const { done: done2, value: value2 } = await reader.read();
    if (!done2 && value2) {
      allData += decoder.decode(value2, { stream: true });
    }

    // Now mark stream complete
    session.streamComplete = true;

    // Wait for poll to detect completion and close
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Drain remaining
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) allData += decoder.decode(value, { stream: true });
    }

    expect(allData).toContain('new text');
  });

  test('closes when client cancels via reader.cancel()', async () => {
    const sessionId = await claudeManager.createSession('conv-reconnect-cancel');
    const session = claudeManager.getSession(sessionId)!;
    session.streamComplete = false;
    session.eventBuffer = ['data: {"type":"ping"}\n\n'];

    const stream = claudeManager.reconnectStream(sessionId)!;
    const reader = stream.getReader();

    // Read the initial event
    await reader.read();

    // Cancel the reader (simulates client disconnect / page navigation)
    await reader.cancel();

    // Should not throw — cleanup intervals should be cleared
  });

  test('preserves event ordering during replay', async () => {
    const sessionId = await claudeManager.createSession('conv-reconnect-order');
    const session = claudeManager.getSession(sessionId)!;

    // Add events in specific order
    for (let i = 0; i < 10; i++) {
      session.eventBuffer.push(
        `data: {"type":"content_block_delta","index":0,"sequence":${i}}\n\n`,
      );
    }
    session.streamComplete = true;

    const stream = claudeManager.reconnectStream(sessionId)!;
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let allData = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      allData += decoder.decode(value, { stream: true });
    }

    // Check ordering is preserved
    for (let i = 0; i < 10; i++) {
      expect(allData).toContain(`"sequence":${i}`);
    }

    // Verify ordering by checking positions
    let lastPos = -1;
    for (let i = 0; i < 10; i++) {
      const pos = allData.indexOf(`"sequence":${i}`);
      expect(pos).toBeGreaterThan(lastPos);
      lastPos = pos;
    }
  });

  test('handles large event buffers', async () => {
    const sessionId = await claudeManager.createSession('conv-reconnect-large');
    const session = claudeManager.getSession(sessionId)!;

    // Simulate a large buffer (100 events)
    for (let i = 0; i < 100; i++) {
      session.eventBuffer.push(
        `data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"chunk-${i} "}}\n\n`,
      );
    }
    session.streamComplete = true;

    const stream = claudeManager.reconnectStream(sessionId)!;
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let allData = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      allData += decoder.decode(value, { stream: true });
    }

    // All 100 events should be present
    for (let i = 0; i < 100; i++) {
      expect(allData).toContain(`chunk-${i}`);
    }
  });

  test('handles empty event buffer with running session', async () => {
    const sessionId = await claudeManager.createSession('conv-reconnect-empty-running');
    const session = claudeManager.getSession(sessionId)!;
    session.streamComplete = false;
    session.eventBuffer = [];

    const stream = claudeManager.reconnectStream(sessionId)!;
    expect(stream).toBeInstanceOf(ReadableStream);

    // Mark complete immediately so the polling loop closes
    session.streamComplete = true;

    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let allData = '';

    // Wait for poll to detect completion
    await new Promise((resolve) => setTimeout(resolve, 200));

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) allData += decoder.decode(value, { stream: true });
    }

    // Should at minimum contain a ping from the keep-alive interval,
    // or just close cleanly
  });

  test('buffers events added after reconnection starts', async () => {
    const sessionId = await claudeManager.createSession('conv-reconnect-buffered-after');
    const session = claudeManager.getSession(sessionId)!;
    session.streamComplete = false;
    session.eventBuffer = ['data: {"type":"message_start","message":{"id":"m1"}}\n\n'];

    const stream = claudeManager.reconnectStream(sessionId)!;
    const reader = stream.getReader();
    const decoder = new TextDecoder();

    // First read gets the replayed event
    const result1 = await reader.read();
    const data1 = decoder.decode(result1.value, { stream: true });
    expect(data1).toContain('message_start');

    // Push new events after replay
    session.eventBuffer.push(
      'data: {"type":"content_block_delta","index":0,"delta":{"text":"hello"}}\n\n',
    );
    session.eventBuffer.push('data: {"type":"message_stop"}\n\n');
    session.streamComplete = true;

    // Wait for poll to pick up new events
    await new Promise((resolve) => setTimeout(resolve, 200));

    let allData = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) allData += decoder.decode(value, { stream: true });
    }

    expect(allData).toContain('content_block_delta');
    expect(allData).toContain('message_stop');
  });
});

// ============================================================================
// createLightweightSession
// ============================================================================
describe('createLightweightSession', () => {
  test('creates session with correct defaults', () => {
    const sessionId = claudeManager.createLightweightSession('conv-lightweight-1');
    const session = claudeManager.getSession(sessionId);

    expect(session).toBeDefined();
    expect(session!.conversationId).toBe('conv-lightweight-1');
    expect(session!.status).toBe('running');
    expect(session!.eventBuffer).toEqual([]);
    expect(session!.streamComplete).toBe(false);
    expect(session!.pendingNudges).toEqual([]);
  });

  test('creates unique session IDs', () => {
    const id1 = claudeManager.createLightweightSession('conv-lw-unique-1');
    const id2 = claudeManager.createLightweightSession('conv-lw-unique-2');
    expect(id1).not.toBe(id2);
  });

  test('session appears in listSessions', () => {
    const sessionId = claudeManager.createLightweightSession('conv-lw-list');
    const sessions = claudeManager.listSessions();
    const found = sessions.find((s) => s.id === sessionId);

    expect(found).toBeDefined();
    expect(found!.conversationId).toBe('conv-lw-list');
    expect(found!.status).toBe('running');
    expect(found!.bufferedEvents).toBe(0);
  });
});

// ============================================================================
// wrapProviderStream
// ============================================================================
describe('wrapProviderStream', () => {
  test('passes through all events from provider stream', async () => {
    const sessionId = claudeManager.createLightweightSession('conv-wrap-1');
    const encoder = new TextEncoder();

    const providerStream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode('data: {"type":"message_start","message":{"id":"m1"}}\n\n'),
        );
        controller.enqueue(
          encoder.encode(
            'data: {"type":"content_block_delta","index":0,"delta":{"text":"hello"}}\n\n',
          ),
        );
        controller.enqueue(encoder.encode('data: {"type":"message_stop"}\n\n'));
        controller.close();
      },
    });

    const wrappedStream = claudeManager.wrapProviderStream(sessionId, providerStream);
    const reader = wrappedStream.getReader();
    const decoder = new TextDecoder();
    let allData = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      allData += decoder.decode(value, { stream: true });
    }

    expect(allData).toContain('message_start');
    expect(allData).toContain('hello');
    expect(allData).toContain('message_stop');
  });

  test('buffers SSE events for reconnection', async () => {
    const sessionId = claudeManager.createLightweightSession('conv-wrap-buffer');
    const encoder = new TextEncoder();

    const providerStream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode('data: {"type":"message_start","message":{"id":"m1"}}\n\n'),
        );
        controller.enqueue(encoder.encode('data: {"type":"message_stop"}\n\n'));
        controller.close();
      },
    });

    const wrappedStream = claudeManager.wrapProviderStream(sessionId, providerStream);
    const reader = wrappedStream.getReader();

    // Drain the stream
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    // Check that events were buffered
    const session = claudeManager.getSession(sessionId)!;
    expect(session.eventBuffer.length).toBeGreaterThan(0);
    expect(session.streamComplete).toBe(true);

    // Verify buffered events contain the expected data
    const bufferContent = session.eventBuffer.join('');
    expect(bufferContent).toContain('message_start');
    expect(bufferContent).toContain('message_stop');
  });

  test('marks session as complete when provider stream ends', async () => {
    const sessionId = claudeManager.createLightweightSession('conv-wrap-complete');
    const encoder = new TextEncoder();

    const providerStream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"ping"}\n\n'));
        controller.close();
      },
    });

    const wrappedStream = claudeManager.wrapProviderStream(sessionId, providerStream);
    const reader = wrappedStream.getReader();

    // Drain the stream
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    const session = claudeManager.getSession(sessionId)!;
    expect(session.streamComplete).toBe(true);
    expect(session.status).toBe('idle');
  });

  test('returns unwrapped stream for unknown session', async () => {
    const encoder = new TextEncoder();
    const providerStream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"ping"}\n\n'));
        controller.close();
      },
    });

    const result = claudeManager.wrapProviderStream('nonexistent-wrap', providerStream);

    // Should return the original stream (fallback)
    expect(result).toBeInstanceOf(ReadableStream);

    const reader = result.getReader();
    const decoder = new TextDecoder();
    let allData = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      allData += decoder.decode(value, { stream: true });
    }
    expect(allData).toContain('ping');
  });

  test('handles provider stream error gracefully', async () => {
    const sessionId = claudeManager.createLightweightSession('conv-wrap-error');

    const providerStream = new ReadableStream({
      start(controller) {
        controller.error(new Error('Provider crashed'));
      },
    });

    const wrappedStream = claudeManager.wrapProviderStream(sessionId, providerStream);
    const reader = wrappedStream.getReader();
    const decoder = new TextDecoder();
    let allData = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) allData += decoder.decode(value, { stream: true });
    }

    // Should have buffered an error event
    const session = claudeManager.getSession(sessionId)!;
    expect(session.streamComplete).toBe(true);
    const errorEvent = session.eventBuffer.find((e) => e.includes('"stream_error"'));
    expect(errorEvent).toBeTruthy();
  });

  test('supports reconnection after wrapping', async () => {
    const sessionId = claudeManager.createLightweightSession('conv-wrap-reconnect');
    const encoder = new TextEncoder();

    const providerStream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode('data: {"type":"message_start","message":{"id":"m1"}}\n\n'),
        );
        controller.enqueue(
          encoder.encode(
            'data: {"type":"content_block_delta","index":0,"delta":{"text":"wrapped"}}\n\n',
          ),
        );
        controller.enqueue(encoder.encode('data: {"type":"message_stop"}\n\n'));
        controller.close();
      },
    });

    const wrappedStream = claudeManager.wrapProviderStream(sessionId, providerStream);
    const reader = wrappedStream.getReader();

    // Drain the original stream
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    // Now reconnect and verify buffered events are replayed
    const reconnectStream = claudeManager.reconnectStream(sessionId);
    expect(reconnectStream).not.toBeNull();

    const reconnectReader = reconnectStream!.getReader();
    const decoder = new TextDecoder();
    let allData = '';

    while (true) {
      const { done, value } = await reconnectReader.read();
      if (done) break;
      allData += decoder.decode(value, { stream: true });
    }

    expect(allData).toContain('message_start');
    expect(allData).toContain('wrapped');
    expect(allData).toContain('message_stop');
  });
});

// ============================================================================
// Session lifecycle and cleanup
// ============================================================================
describe('session lifecycle', () => {
  test('session pendingNudges initializes empty', async () => {
    const sessionId = await claudeManager.createSession('conv-nudge-init');
    const session = claudeManager.getSession(sessionId)!;
    expect(session.pendingNudges).toEqual([]);
  });

  test('queueNudge adds nudge to session', async () => {
    const sessionId = await claudeManager.createSession('conv-nudge-queue');
    claudeManager.queueNudge(sessionId, 'Please also handle edge cases');
    const session = claudeManager.getSession(sessionId)!;
    expect(session.pendingNudges).toContain('Please also handle edge cases');
  });

  test('queueNudge returns false for unknown session', () => {
    const result = claudeManager.queueNudge('nonexistent-nudge', 'test');
    expect(result).toBe(false);
  });

  test('multiple nudges accumulate', async () => {
    const sessionId = await claudeManager.createSession('conv-nudge-multi');
    claudeManager.queueNudge(sessionId, 'First nudge');
    claudeManager.queueNudge(sessionId, 'Second nudge');
    const session = claudeManager.getSession(sessionId)!;
    expect(session.pendingNudges).toEqual(['First nudge', 'Second nudge']);
  });

  test('session emitter is an EventEmitter', async () => {
    const sessionId = await claudeManager.createSession('conv-emitter');
    const session = claudeManager.getSession(sessionId)!;
    expect(session.emitter).toBeDefined();
    expect(typeof session.emitter.emit).toBe('function');
    expect(typeof session.emitter.on).toBe('function');
  });

  test('listSessions includes bufferedEvents count', async () => {
    const sessionId = await claudeManager.createSession('conv-list-buffer');
    const session = claudeManager.getSession(sessionId)!;
    session.eventBuffer = ['event1\n\n', 'event2\n\n', 'event3\n\n'];

    const sessions = claudeManager.listSessions();
    const found = sessions.find((s) => s.id === sessionId);
    expect(found!.bufferedEvents).toBe(3);
  });

  test('listSessions reflects streamComplete status', async () => {
    const sessionId = await claudeManager.createSession('conv-list-complete');
    const session = claudeManager.getSession(sessionId)!;
    session.streamComplete = true;

    const sessions = claudeManager.listSessions();
    const found = sessions.find((s) => s.id === sessionId);
    expect(found!.streamComplete).toBe(true);
  });
});

describe('translateCliEvent edge cases', () => {
  test('handles tool_use block with missing id and name', () => {
    const events = translateCliEvent({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', input: { foo: 'bar' } }],
      },
    });

    const parsed = events.map((e) => JSON.parse(e));
    // content_block_start should have fallback values
    expect(parsed[1].content_block.type).toBe('tool_use');
    expect(parsed[1].content_block.id).toBeTruthy(); // nanoid fallback
    expect(parsed[1].content_block.name).toBe('unknown');
  });

  test('handles tool_use block with empty input', () => {
    const events = translateCliEvent({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: 'tu-1', name: 'Read' }],
      },
    });

    const parsed = events.map((e) => JSON.parse(e));
    expect(parsed[2].delta.type).toBe('input_json_delta');
    expect(JSON.parse(parsed[2].delta.partial_json)).toEqual({});
  });

  test('handles text block with empty text', () => {
    const events = translateCliEvent({
      type: 'assistant',
      message: {
        content: [{ type: 'text' }],
      },
    });

    const parsed = events.map((e) => JSON.parse(e));
    expect(parsed[2].delta.text).toBe('');
  });

  test('handles thinking block with empty thinking', () => {
    const events = translateCliEvent({
      type: 'assistant',
      message: {
        content: [{ type: 'thinking' }],
      },
    });

    const parsed = events.map((e) => JSON.parse(e));
    expect(parsed[2].delta.thinking).toBe('');
  });

  test('result event with custom stop_reason', () => {
    const events = translateCliEvent({
      type: 'result',
      stop_reason: 'max_tokens',
      usage: { input_tokens: 10, output_tokens: 20 },
    });

    const parsed = events.map((e) => JSON.parse(e));
    expect(parsed[0].delta.stop_reason).toBe('max_tokens');
  });

  test('result event preserves zero cache token counts', () => {
    const events = translateCliEvent({
      type: 'result',
      usage: {
        input_tokens: 5,
        output_tokens: 3,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    });

    const parsed = events.map((e) => JSON.parse(e));
    expect(parsed[0].usage.cache_creation_input_tokens).toBe(0);
    expect(parsed[0].usage.cache_read_input_tokens).toBe(0);
  });

  test('ignores unknown content block types', () => {
    const events = translateCliEvent({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'before' },
          { type: 'unknown_block_type', data: 'something' },
          { type: 'text', text: 'after' },
        ],
      },
    });

    const parsed = events.map((e) => JSON.parse(e));
    // message_start + 3 for first text + 0 for unknown + 3 for second text = 7
    expect(parsed).toHaveLength(7);
    // First text at index 0
    expect(parsed[1].index).toBe(0);
    // Second text at index 2 (the unknown block at index 1 produces no events)
    expect(parsed[4].index).toBe(2);
  });

  test('parent_tool_use_id defaults to null when not provided', () => {
    const events = translateCliEvent({
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'test' }],
      },
    });

    const parsed = events.map((e) => JSON.parse(e));
    expect(parsed[0].parent_tool_use_id).toBeNull();
  });

  test('handles assistant with mixed content blocks', () => {
    const events = translateCliEvent({
      type: 'assistant',
      message: {
        id: 'msg-mixed',
        model: 'claude-opus-4-6',
        content: [
          { type: 'thinking', thinking: 'Let me think about this...' },
          { type: 'text', text: 'I have an answer' },
          {
            type: 'tool_use',
            id: 'tool-2',
            name: 'Write',
            input: { path: '/tmp/test.txt', content: 'hello' },
          },
        ],
      },
    });

    const parsed = events.map((e) => JSON.parse(e));
    // message_start + 3*thinking + 3*text + 3*tool_use = 10
    expect(parsed).toHaveLength(10);
    expect(parsed[0].type).toBe('message_start');
    expect(parsed[0].message.id).toBe('msg-mixed');

    // thinking block
    expect(parsed[1].content_block.type).toBe('thinking');
    // text block
    expect(parsed[4].content_block.type).toBe('text');
    // tool_use block
    expect(parsed[7].content_block.type).toBe('tool_use');
    expect(parsed[7].content_block.name).toBe('Write');
  });

  test('result event without cache tokens defaults to 0', () => {
    const events = translateCliEvent({
      type: 'result',
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const parsed = events.map((e) => JSON.parse(e));
    expect(parsed[0].usage.cache_creation_input_tokens).toBe(0);
    expect(parsed[0].usage.cache_read_input_tokens).toBe(0);
  });

  test('handles result event with partial usage object', () => {
    const events = translateCliEvent({
      type: 'result',
      stop_reason: 'tool_use',
      usage: { input_tokens: 42 },
    });

    const parsed = events.map((e) => JSON.parse(e));
    expect(parsed[0].delta.stop_reason).toBe('tool_use');
    expect(parsed[0].usage.input_tokens).toBe(42);
    expect(parsed[0].usage.output_tokens).toBe(0);
  });

  test('handles multiple tool_use blocks in single assistant event', () => {
    const events = translateCliEvent({
      type: 'assistant',
      message: {
        id: 'msg-multi-tool',
        model: 'claude-sonnet-4',
        content: [
          { type: 'tool_use', id: 'tu-1', name: 'Read', input: { file_path: '/a.ts' } },
          {
            type: 'tool_use',
            id: 'tu-2',
            name: 'Write',
            input: { file_path: '/b.ts', content: 'x' },
          },
          { type: 'tool_use', id: 'tu-3', name: 'Bash', input: { command: 'ls' } },
        ],
      },
    });

    const parsed = events.map((e) => JSON.parse(e));
    // message_start + 3 * (start + delta + stop) = 10
    expect(parsed).toHaveLength(10);

    // Verify each tool_use block at correct indices
    expect(parsed[1].content_block.name).toBe('Read');
    expect(parsed[1].index).toBe(0);
    expect(parsed[4].content_block.name).toBe('Write');
    expect(parsed[4].index).toBe(1);
    expect(parsed[7].content_block.name).toBe('Bash');
    expect(parsed[7].index).toBe(2);
  });

  test('handles assistant event with only text, no thinking or tool_use', () => {
    const events = translateCliEvent({
      type: 'assistant',
      message: {
        id: 'msg-text-only',
        model: 'claude-haiku-4',
        content: [
          { type: 'text', text: 'First paragraph.' },
          { type: 'text', text: 'Second paragraph.' },
        ],
      },
    });

    const parsed = events.map((e) => JSON.parse(e));
    // message_start + 2 * (start + delta + stop) = 7
    expect(parsed).toHaveLength(7);
    expect(parsed[2].delta.text).toBe('First paragraph.');
    expect(parsed[5].delta.text).toBe('Second paragraph.');
  });

  test('handles user event type (no output expected)', () => {
    const events = translateCliEvent({
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: 'result text' }],
      },
    });

    // user events fall through to default case and produce no events
    expect(events).toEqual([]);
  });

  test('parent_tool_use_id is correctly propagated to all sub-events', () => {
    const events = translateCliEvent({
      type: 'assistant',
      parent_tool_use_id: 'parent-xyz',
      message: {
        id: 'msg-nested',
        content: [
          { type: 'thinking', thinking: 'thinking inside tool' },
          { type: 'text', text: 'nested response' },
          { type: 'tool_use', id: 'tu-inner', name: 'Read', input: { file_path: '/x' } },
        ],
      },
    });

    const parsed = events.map((e) => JSON.parse(e));
    // ALL 10 events should have parent_tool_use_id = 'parent-xyz'
    expect(parsed).toHaveLength(10);
    for (const evt of parsed) {
      expect(evt.parent_tool_use_id).toBe('parent-xyz');
    }
  });
});

// ============================================================================
// Additional ClaudeProcessManager tests
// ============================================================================
describe('ClaudeProcessManager - additional lifecycle', () => {
  test('queueNudge returns true for existing session', async () => {
    const sessionId = await claudeManager.createSession('conv-nudge-ret');
    const result = claudeManager.queueNudge(sessionId, 'Test nudge');
    expect(result).toBe(true);
  });

  test('queueNudge accumulates multiple nudges in order', async () => {
    const sessionId = await claudeManager.createSession('conv-nudge-order');
    claudeManager.queueNudge(sessionId, 'First');
    claudeManager.queueNudge(sessionId, 'Second');
    claudeManager.queueNudge(sessionId, 'Third');

    const session = claudeManager.getSession(sessionId)!;
    expect(session.pendingNudges).toEqual(['First', 'Second', 'Third']);
  });

  test('createSession with no options uses defaults', async () => {
    const sessionId = await claudeManager.createSession('conv-defaults');
    const session = claudeManager.getSession(sessionId)!;

    expect(session.model).toBeUndefined();
    expect(session.systemPrompt).toBeUndefined();
    expect(session.workspacePath).toBeUndefined();
    expect(session.effort).toBeUndefined();
    expect(session.maxBudgetUsd).toBeUndefined();
    expect(session.maxTurns).toBeUndefined();
    expect(session.allowedTools).toBeUndefined();
    expect(session.disallowedTools).toBeUndefined();
    expect(session.cliSessionId).toBeUndefined();
    expect(session.pendingNudges).toEqual([]);
    expect(session.eventBuffer).toEqual([]);
    expect(session.streamComplete).toBe(false);
  });

  test('terminateSession kills cliProcess if present', async () => {
    const sessionId = await claudeManager.createSession('conv-term-proc');
    const session = claudeManager.getSession(sessionId)!;

    // Mock a cliProcess with a kill method
    let killCalled = false;
    session.cliProcess = {
      pid: 12345,
      stdout: new ReadableStream(),
      stderr: null,
      write: () => {},
      kill: () => {
        killCalled = true;
      },
      exited: Promise.resolve(0),
      exitCode: null,
    } as any;

    claudeManager.terminateSession(sessionId);
    expect(killCalled).toBe(true);
    expect(claudeManager.getSession(sessionId)).toBeUndefined();
  });

  test('writeStdin returns true when cliProcess.write succeeds', async () => {
    const sessionId = await claudeManager.createSession('conv-stdin-ok');
    const session = claudeManager.getSession(sessionId)!;

    let writtenData = '';
    session.cliProcess = {
      pid: 12345,
      stdout: new ReadableStream(),
      stderr: null,
      write: (data: string) => {
        writtenData = data;
      },
      kill: () => {},
      exited: Promise.resolve(0),
      exitCode: null,
    } as any;

    const result = claudeManager.writeStdin(sessionId, 'test input');
    expect(result).toBe(true);
    expect(writtenData).toBe('test input');
  });

  test('writeStdin returns false when cliProcess.write throws', async () => {
    const sessionId = await claudeManager.createSession('conv-stdin-fail');
    const session = claudeManager.getSession(sessionId)!;

    session.cliProcess = {
      pid: 12345,
      stdout: new ReadableStream(),
      stderr: null,
      write: () => {
        throw new Error('stdin closed');
      },
      kill: () => {},
      exited: Promise.resolve(0),
      exitCode: null,
    } as any;

    const result = claudeManager.writeStdin(sessionId, 'test input');
    expect(result).toBe(false);
  });

  test('clearStaleSessionIds clears all CLI session IDs from DB', () => {
    // Insert conversations with cli_session_id set
    testDb
      .query(
        "INSERT OR IGNORE INTO conversations (id, title, model, cli_session_id, created_at, updated_at) VALUES ('conv-stale-1', 'Test 1', 'claude-sonnet-4', 'old-session-1', ?, ?)",
      )
      .run(Date.now(), Date.now());
    testDb
      .query(
        "INSERT OR IGNORE INTO conversations (id, title, model, cli_session_id, created_at, updated_at) VALUES ('conv-stale-2', 'Test 2', 'claude-sonnet-4', 'old-session-2', ?, ?)",
      )
      .run(Date.now(), Date.now());

    // Verify they have session IDs
    const before1 = testDb
      .query("SELECT cli_session_id FROM conversations WHERE id = 'conv-stale-1'")
      .get() as any;
    expect(before1.cli_session_id).toBe('old-session-1');

    // Clear stale sessions
    claudeManager.clearStaleSessionIds();

    // Verify they are now cleared
    const after1 = testDb
      .query("SELECT cli_session_id FROM conversations WHERE id = 'conv-stale-1'")
      .get() as any;
    const after2 = testDb
      .query("SELECT cli_session_id FROM conversations WHERE id = 'conv-stale-2'")
      .get() as any;
    expect(after1.cli_session_id).toBeNull();
    expect(after2.cli_session_id).toBeNull();
  });

  test('createLightweightSession sets status to running', () => {
    const sessionId = claudeManager.createLightweightSession('conv-lw-status');
    const session = claudeManager.getSession(sessionId)!;
    expect(session.status).toBe('running');
  });

  test('createLightweightSession has no cliProcess', () => {
    const sessionId = claudeManager.createLightweightSession('conv-lw-noproc');
    const session = claudeManager.getSession(sessionId)!;
    expect(session.cliProcess).toBeUndefined();
  });

  test('multiple sessions for same conversation are independent', async () => {
    const session1 = await claudeManager.createSession('conv-shared');
    const session2 = await claudeManager.createSession('conv-shared');

    expect(session1).not.toBe(session2);

    const s1 = claudeManager.getSession(session1)!;
    const s2 = claudeManager.getSession(session2)!;

    expect(s1.conversationId).toBe(s2.conversationId);
    expect(s1.id).not.toBe(s2.id);

    // Terminate one should not affect the other
    claudeManager.terminateSession(session1);
    expect(claudeManager.getSession(session1)).toBeUndefined();
    expect(claudeManager.getSession(session2)).toBeDefined();
  });

  test('cancelGeneration does not change session status directly', async () => {
    const sessionId = await claudeManager.createSession('conv-cancel-status');
    const session = claudeManager.getSession(sessionId)!;
    expect(session.status).toBe('idle');

    // Cancel should emit the event but status is changed by the event handler,
    // not by cancelGeneration itself
    claudeManager.cancelGeneration(sessionId);
    // Status remains idle since no stream handler is listening to change it
    expect(session.status).toBe('idle');
  });

  test('reconnectStream with completed session replays and closes', async () => {
    const sessionId = await claudeManager.createSession('conv-reconnect-complete-close');
    const session = claudeManager.getSession(sessionId)!;

    session.eventBuffer = [
      'data: {"type":"message_start","message":{"id":"m1","role":"assistant"}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ];
    session.streamComplete = true;

    const stream = claudeManager.reconnectStream(sessionId)!;
    expect(stream).not.toBeNull();

    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let allData = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      allData += decoder.decode(value, { stream: true });
    }

    expect(allData).toContain('message_start');
    expect(allData).toContain('message_stop');
  });

  test('wrapProviderStream handles stream with non-SSE data', async () => {
    const sessionId = claudeManager.createLightweightSession('conv-wrap-non-sse');
    const encoder = new TextEncoder();

    const providerStream = new ReadableStream({
      start(controller) {
        // Some data that isn't SSE formatted
        controller.enqueue(encoder.encode('plain text without data: prefix\n'));
        controller.enqueue(encoder.encode('data: {"type":"message_stop"}\n\n'));
        controller.close();
      },
    });

    const wrappedStream = claudeManager.wrapProviderStream(sessionId, providerStream);
    const reader = wrappedStream.getReader();

    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    const session = claudeManager.getSession(sessionId)!;
    // Only the SSE-formatted line should be buffered
    const sseEvents = session.eventBuffer.filter((e) => e.includes('message_stop'));
    expect(sseEvents.length).toBe(1);
    // Non-SSE data should NOT be in the buffer
    const nonSse = session.eventBuffer.filter((e) => e.includes('plain text'));
    expect(nonSse.length).toBe(0);
  });
});
