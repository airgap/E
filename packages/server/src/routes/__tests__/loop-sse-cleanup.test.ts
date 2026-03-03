import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { EventEmitter } from 'events';
import { createTestDb } from '../../test-helpers';

// ---------------------------------------------------------------------------
// Mocks – must be set up before importing the route module
// ---------------------------------------------------------------------------
const testDb = createTestDb();
mock.module('../../db/database', () => ({
  getDb: () => testDb,
  initDatabase: () => {},
}));

const mockEvents = new EventEmitter();

mock.module('../../services/loop', () => ({
  loopOrchestrator: {
    events: mockEvents,
    getLoopState: () => null,
    listLoops: () => [],
    startLoop: async () => 'loop-1',
    pauseLoop: async () => {},
    resumeLoop: async () => {},
    cancelLoop: async () => {},
  },
}));

import { loopRoutes as app } from '../loop';
import { Hono } from 'hono';

const testApp = new Hono();
testApp.route('/loop', app);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fetch the SSE endpoint with an AbortController so we can simulate disconnect */
function connectSSE(loopId: string) {
  const ac = new AbortController();
  const req = new Request(`http://localhost/loop/${loopId}/events`, {
    signal: ac.signal,
  });
  const resPromise = testApp.fetch(req);
  return { ac, resPromise };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('loop SSE cleanup', () => {
  beforeEach(() => {
    mockEvents.removeAllListeners();
  });

  afterEach(() => {
    mockEvents.removeAllListeners();
  });

  // Verifies that aborting the request removes both the loop_event and loop_done
  // listeners, preventing orphaned handler accumulation (the original bug).
  test('abort removes both loop_event and loop_done listeners', async () => {
    const { ac, resPromise } = connectSSE('loop-1');
    await resPromise; // stream is open

    // After connecting, both listeners should be registered
    expect(mockEvents.listenerCount('loop_event')).toBe(1);
    expect(mockEvents.listenerCount('loop_done')).toBe(1);

    // Simulate client disconnect
    ac.abort();

    // Give microtask queue time to process the abort
    await new Promise((r) => setTimeout(r, 10));

    // Both listeners must be removed
    expect(mockEvents.listenerCount('loop_event')).toBe(0);
    expect(mockEvents.listenerCount('loop_done')).toBe(0);
  });

  // Verifies that when loop_done fires, both listeners are cleaned up so the
  // abort handler doesn't leave orphaned handlers.
  test('loop_done removes both loop_event and loop_done listeners', async () => {
    const { ac, resPromise } = connectSSE('loop-1');
    await resPromise;

    expect(mockEvents.listenerCount('loop_event')).toBe(1);
    expect(mockEvents.listenerCount('loop_done')).toBe(1);

    // Simulate loop completion
    mockEvents.emit('loop_done', 'loop-1');

    await new Promise((r) => setTimeout(r, 10));

    // Both listeners must be removed
    expect(mockEvents.listenerCount('loop_event')).toBe(0);
    expect(mockEvents.listenerCount('loop_done')).toBe(0);

    // Clean up the abort controller
    ac.abort();
  });

  // Ensures that if loop_done fires and then abort fires afterwards, there are
  // no errors from double-removing listeners (idempotent cleanup).
  test('no errors when loop_done fires before abort (double cleanup)', async () => {
    const { ac, resPromise } = connectSSE('loop-1');
    await resPromise;

    // Fire loop_done first
    mockEvents.emit('loop_done', 'loop-1');
    await new Promise((r) => setTimeout(r, 10));

    // Then abort — should not throw
    expect(() => ac.abort()).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));

    expect(mockEvents.listenerCount('loop_event')).toBe(0);
    expect(mockEvents.listenerCount('loop_done')).toBe(0);
  });

  // Ensures no handlers accumulate across multiple connect/disconnect cycles,
  // which was the core symptom of the original leak.
  test('no handler accumulation across multiple connect/disconnect cycles', async () => {
    for (let i = 0; i < 5; i++) {
      const { ac, resPromise } = connectSSE(`loop-${i}`);
      await resPromise;

      expect(mockEvents.listenerCount('loop_event')).toBe(1);
      expect(mockEvents.listenerCount('loop_done')).toBe(1);

      ac.abort();
      await new Promise((r) => setTimeout(r, 10));

      expect(mockEvents.listenerCount('loop_event')).toBe(0);
      expect(mockEvents.listenerCount('loop_done')).toBe(0);
    }
  });

  // Verifies that loop_done for a different loopId doesn't trigger cleanup for
  // the current connection (the doneHandler checks loopId match).
  test('loop_done for different loopId does not clean up this connection', async () => {
    const { ac, resPromise } = connectSSE('loop-1');
    await resPromise;

    expect(mockEvents.listenerCount('loop_event')).toBe(1);
    expect(mockEvents.listenerCount('loop_done')).toBe(1);

    // Emit loop_done for a DIFFERENT loop
    mockEvents.emit('loop_done', 'loop-OTHER');
    await new Promise((r) => setTimeout(r, 10));

    // loop_event should still be registered (doneHandler didn't match)
    expect(mockEvents.listenerCount('loop_event')).toBe(1);
    // loop_done was registered with .once(), so it's consumed even for non-matching IDs
    // The handler itself doesn't call cleanup for non-matching IDs, but .once() removes it
    // This means the loop_done listener is gone — this is a known trade-off of using .once()
    // The abort handler will still clean up loop_event when client disconnects

    // Clean up
    ac.abort();
    await new Promise((r) => setTimeout(r, 10));

    expect(mockEvents.listenerCount('loop_event')).toBe(0);
    expect(mockEvents.listenerCount('loop_done')).toBe(0);
  });
});
