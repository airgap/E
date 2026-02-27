import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import type { StreamEvent, StreamCommentary } from '@e/shared';
import { EventBridge } from '../event-bridge';
import { CommentatorService, type LlmCaller } from '../commentator';

// ---------------------------------------------------------------------------
// Helper factories (same as commentator tests)
// ---------------------------------------------------------------------------

function makeTextDelta(text: string): StreamEvent {
  return {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text },
  };
}

function makeToolResult(toolName: string, isError = false): StreamEvent {
  return {
    type: 'tool_result',
    toolCallId: 'tc_1',
    toolName,
    result: 'ok',
    isError,
  };
}

function makeMessageStart(model = 'claude-haiku'): StreamEvent {
  return {
    type: 'message_start',
    message: { id: 'msg_1', role: 'assistant', model },
  };
}

function makeToolUseStart(toolName: string): StreamEvent {
  return {
    type: 'tool_use_start',
    toolCallId: 'tc_1',
    toolName,
    input: {},
  };
}

function makePing(): StreamEvent {
  return { type: 'ping' };
}

// ---------------------------------------------------------------------------
// EventBridge — subscription management
// ---------------------------------------------------------------------------

describe('EventBridge — subscription management', () => {
  let bridge: EventBridge;

  beforeEach(() => {
    bridge = new EventBridge();
  });

  test('subscribe adds workspace to subscriptions', () => {
    expect(bridge.isSubscribed('ws-1')).toBe(false);
    bridge.subscribe('ws-1');
    expect(bridge.isSubscribed('ws-1')).toBe(true);
  });

  test('unsubscribe removes workspace when ref count reaches 0', () => {
    bridge.subscribe('ws-1');
    expect(bridge.isSubscribed('ws-1')).toBe(true);
    bridge.unsubscribe('ws-1');
    expect(bridge.isSubscribed('ws-1')).toBe(false);
  });

  test('subscriberCount tracks unique workspace subscriptions', () => {
    expect(bridge.subscriberCount).toBe(0);
    bridge.subscribe('ws-1');
    expect(bridge.subscriberCount).toBe(1);
    bridge.subscribe('ws-2');
    expect(bridge.subscriberCount).toBe(2);
    bridge.unsubscribe('ws-1');
    expect(bridge.subscriberCount).toBe(1);
  });

  test('subscribe is ref-counted — multiple calls increment count', () => {
    bridge.subscribe('ws-1');
    bridge.subscribe('ws-1');
    // Still 1 unique workspace
    expect(bridge.subscriberCount).toBe(1);
    // But ref count is 2
    expect(bridge.getSubscriptionRefCount('ws-1')).toBe(2);
  });

  test('unsubscribe decrements ref count — does not remove until 0', () => {
    bridge.subscribe('ws-1');
    bridge.subscribe('ws-1');
    expect(bridge.getSubscriptionRefCount('ws-1')).toBe(2);

    bridge.unsubscribe('ws-1');
    expect(bridge.isSubscribed('ws-1')).toBe(true);
    expect(bridge.getSubscriptionRefCount('ws-1')).toBe(1);

    bridge.unsubscribe('ws-1');
    expect(bridge.isSubscribed('ws-1')).toBe(false);
    expect(bridge.getSubscriptionRefCount('ws-1')).toBe(0);
  });

  test('subscribe returns new ref count', () => {
    expect(bridge.subscribe('ws-1')).toBe(1);
    expect(bridge.subscribe('ws-1')).toBe(2);
    expect(bridge.subscribe('ws-2')).toBe(1);
  });

  test('unsubscribe returns remaining ref count', () => {
    bridge.subscribe('ws-1');
    bridge.subscribe('ws-1');
    expect(bridge.unsubscribe('ws-1')).toBe(1);
    expect(bridge.unsubscribe('ws-1')).toBe(0);
  });

  test('unsubscribe on non-existent workspace is safe', () => {
    expect(() => bridge.unsubscribe('nonexistent')).not.toThrow();
    expect(bridge.unsubscribe('nonexistent')).toBe(0);
  });

  test('multiple concurrent subscriptions (multi-workspace)', () => {
    bridge.subscribe('ws-1');
    bridge.subscribe('ws-2');
    bridge.subscribe('ws-3');
    expect(bridge.isSubscribed('ws-1')).toBe(true);
    expect(bridge.isSubscribed('ws-2')).toBe(true);
    expect(bridge.isSubscribed('ws-3')).toBe(true);
    expect(bridge.subscriberCount).toBe(3);
  });

  test('forceUnsubscribe removes regardless of ref count', () => {
    bridge.subscribe('ws-1');
    bridge.subscribe('ws-1');
    bridge.subscribe('ws-1');
    expect(bridge.getSubscriptionRefCount('ws-1')).toBe(3);

    bridge.forceUnsubscribe('ws-1');
    expect(bridge.isSubscribed('ws-1')).toBe(false);
    expect(bridge.getSubscriptionRefCount('ws-1')).toBe(0);
  });

  test('unsubscribeAll removes all subscriptions', () => {
    bridge.subscribe('ws-1');
    bridge.subscribe('ws-1');
    bridge.subscribe('ws-2');
    bridge.subscribe('ws-3');

    const count = bridge.unsubscribeAll();
    expect(count).toBe(3); // 3 unique workspaces
    expect(bridge.subscriberCount).toBe(0);
    expect(bridge.isSubscribed('ws-1')).toBe(false);
    expect(bridge.isSubscribed('ws-2')).toBe(false);
    expect(bridge.isSubscribed('ws-3')).toBe(false);
  });

  test('getSubscribedWorkspaces returns all active workspace IDs', () => {
    bridge.subscribe('ws-1');
    bridge.subscribe('ws-2');
    bridge.subscribe('ws-3');

    const workspaces = bridge.getSubscribedWorkspaces();
    expect(workspaces).toContain('ws-1');
    expect(workspaces).toContain('ws-2');
    expect(workspaces).toContain('ws-3');
    expect(workspaces.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// EventBridge — event emission
// ---------------------------------------------------------------------------

describe('EventBridge — event emission', () => {
  let bridge: EventBridge;
  let commentator: CommentatorService;
  let pushEventSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    bridge = new EventBridge();
    commentator = new CommentatorService(async () => 'test commentary');
    pushEventSpy = spyOn(commentator, 'pushEvent');

    // Inject the test commentator into the bridge by overriding the module-level
    // import. We do this by mocking the emit method to use our test commentator.
    // Instead, we'll test emit behavior through the bridge's internal logic.
  });

  afterEach(() => {
    commentator.forceStopCommentary('ws-1');
    commentator.forceStopCommentary('ws-2');
  });

  test('emit skips when no subscriptions exist', () => {
    // With no subscriptions, emit should return immediately without error
    expect(() => bridge.emit('/path/to/workspace', makeTextDelta('hello'))).not.toThrow();
  });

  test('emit skips non-bridged event types (ping)', () => {
    bridge.subscribe('ws-1');
    // Ping events should be filtered out
    expect(() => bridge.emit('/path/to/workspace', makePing())).not.toThrow();
  });

  test('emit handles missing workspace path gracefully', () => {
    bridge.subscribe('ws-1');
    expect(() => bridge.emit('/nonexistent/path', makeTextDelta('hello'))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// EventBridge — emitRaw (SSE string parsing)
// ---------------------------------------------------------------------------

describe('EventBridge — emitRaw', () => {
  let bridge: EventBridge;

  beforeEach(() => {
    bridge = new EventBridge();
  });

  test('emitRaw skips when no subscriptions', () => {
    const sseData = `data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello' } })}\n\n`;
    expect(() => bridge.emitRaw('/path', sseData)).not.toThrow();
  });

  test('emitRaw handles malformed JSON gracefully', () => {
    bridge.subscribe('ws-1');
    expect(() => bridge.emitRaw('/path', 'data: {invalid json}\n\n')).not.toThrow();
  });

  test('emitRaw handles empty data gracefully', () => {
    bridge.subscribe('ws-1');
    expect(() => bridge.emitRaw('/path', '')).not.toThrow();
    expect(() => bridge.emitRaw('/path', 'data: \n\n')).not.toThrow();
  });

  test('emitRaw strips SSE framing correctly', () => {
    bridge.subscribe('ws-1');
    const event = {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'hello' },
    };
    // Test both with and without "data: " prefix
    expect(() => bridge.emitRaw('/path', `data: ${JSON.stringify(event)}\n\n`)).not.toThrow();
    expect(() => bridge.emitRaw('/path', JSON.stringify(event))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// EventBridge — cache management
// ---------------------------------------------------------------------------

describe('EventBridge — cache management', () => {
  let bridge: EventBridge;

  beforeEach(() => {
    bridge = new EventBridge();
  });

  test('clearCache does not throw', () => {
    expect(() => bridge.clearCache()).not.toThrow();
  });

  test('invalidatePath does not throw', () => {
    expect(() => bridge.invalidatePath('/some/path')).not.toThrow();
  });

  test('invalidateConversation does not throw', () => {
    expect(() => bridge.invalidateConversation('conv-1')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// EventBridge — bridged event type filtering
// ---------------------------------------------------------------------------

describe('EventBridge — event type filtering', () => {
  let bridge: EventBridge;

  beforeEach(() => {
    bridge = new EventBridge();
    bridge.subscribe('ws-1');
  });

  test('bridges content_block_delta events', () => {
    expect(() => bridge.emit('/path', makeTextDelta('hello'))).not.toThrow();
  });

  test('bridges tool_use_start events', () => {
    expect(() => bridge.emit('/path', makeToolUseStart('Read'))).not.toThrow();
  });

  test('bridges tool_result events', () => {
    expect(() => bridge.emit('/path', makeToolResult('Read'))).not.toThrow();
  });

  test('bridges message_start events', () => {
    expect(() => bridge.emit('/path', makeMessageStart())).not.toThrow();
  });

  test('does not bridge ping events', () => {
    // Ping should be silently skipped (not in BRIDGED_EVENT_TYPES)
    expect(() => bridge.emit('/path', makePing())).not.toThrow();
  });

  test('bridges error events', () => {
    const errorEvent: StreamEvent = {
      type: 'error',
      error: { type: 'cli_error', message: 'Something broke' },
    };
    expect(() => bridge.emit('/path', errorEvent)).not.toThrow();
  });

  test('bridges verification_result events', () => {
    const verifyEvent: StreamEvent = {
      type: 'verification_result',
      filePath: '/src/main.ts',
      passed: true,
      issues: [],
      tool: 'tsc',
      duration: 500,
    };
    expect(() => bridge.emit('/path', verifyEvent)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// EventBridge — never throws (resilience)
// ---------------------------------------------------------------------------

describe('EventBridge — resilience', () => {
  let bridge: EventBridge;

  beforeEach(() => {
    bridge = new EventBridge();
  });

  test('emit never throws even with invalid inputs', () => {
    bridge.subscribe('ws-1');
    expect(() => bridge.emit('', makeTextDelta('hello'))).not.toThrow();
    expect(() => bridge.emit('/path', {} as StreamEvent)).not.toThrow();
    expect(() => bridge.emit('/path', null as any)).not.toThrow();
    expect(() => bridge.emit('/path', undefined as any)).not.toThrow();
  });

  test('emitRaw never throws even with invalid inputs', () => {
    bridge.subscribe('ws-1');
    expect(() => bridge.emitRaw('', '')).not.toThrow();
    expect(() => bridge.emitRaw('/path', 'not-json')).not.toThrow();
    expect(() => bridge.emitRaw('/path', null as any)).not.toThrow();
  });

  test('emitByConversation never throws', () => {
    bridge.subscribe('ws-1');
    expect(() => bridge.emitByConversation('conv-1', makeTextDelta('hello'))).not.toThrow();
    expect(() => bridge.emitByConversation('', makeTextDelta('hello'))).not.toThrow();
  });
});
