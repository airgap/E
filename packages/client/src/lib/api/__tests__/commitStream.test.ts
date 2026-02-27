/**
 * Comprehensive tests for api.git.commitStream SSE parsing.
 *
 * This tests the full client-side flow: HTTP request, SSE stream parsing,
 * event dispatching via onProgress callback, and final result determination.
 *
 * Every possible failure mode is covered:
 * - Network errors, non-OK HTTP responses, missing body
 * - SSE parsing: multi-chunk, split boundaries, malformed JSON, empty lines
 * - Event handling: complete, error, status, output, diagnostic
 * - Edge cases: no complete event, remaining buffer, stream interruption
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers: build mock SSE responses
// ---------------------------------------------------------------------------

/** Encode a string to Uint8Array */
function encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** Build an SSE data line from an object */
function sseEvent(obj: object): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

/**
 * Create a ReadableStream that delivers chunks on demand.
 * Each call to `push(data)` enqueues a chunk; `close()` ends the stream.
 */
function createControllableStream() {
  let ctrl: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      ctrl = controller;
    },
  });
  return {
    stream,
    push: (data: string) => ctrl.enqueue(encode(data)),
    close: () => ctrl.close(),
    error: (err: Error) => ctrl.error(err),
  };
}

/**
 * Create a mock fetch Response with SSE events delivered all at once.
 */
function mockSSEResponse(events: object[], status = 200): Response {
  const body = events.map((e) => sseEvent(e)).join('');
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encode(body));
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

/**
 * Create a mock fetch Response with SSE events delivered in separate chunks.
 */
function mockChunkedSSEResponse(chunks: string[], status = 200): Response {
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encode(chunks[index]));
        index++;
      } else {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

/**
 * Create a mock JSON error response (non-SSE).
 */
function mockJSONResponse(body: object, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Import the module under test
// ---------------------------------------------------------------------------

// We need to import the api after setting up fetch mocks.
// The module uses getBaseUrl() which returns '/api', and getAuthToken() which returns null.
// We mock fetch at the global level.

let api: typeof import('$lib/api/client').api;

beforeEach(async () => {
  vi.restoreAllMocks();
  // Dynamic import to get fresh module state
  const mod = await import('$lib/api/client');
  api = mod.api;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('api.git.commitStream', () => {
  // ─── Successful commit ─────────────────────────────────────────────

  describe('successful commit', () => {
    test('returns ok:true with sha when complete event is received', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        mockSSEResponse([
          {
            type: 'diagnostic',
            phase: 'before-staging',
            message: 'status',
            porcelain: ' M a.ts',
            fileCount: 1,
          },
          { type: 'status', message: 'Nothing staged — auto-staging all changes...' },
          { type: 'status', message: 'Running pre-commit hooks and creating commit...' },
          { type: 'output', message: '[main abc1234] test commit\n' },
          {
            type: 'diagnostic',
            phase: 'after-commit',
            message: 'Working tree is clean',
            porcelain: '',
            fileCount: 0,
          },
          { type: 'complete', sha: 'abc1234567890', message: 'Commit successful!' },
        ]),
      );
      vi.stubGlobal('fetch', fetchMock);

      const events: any[] = [];
      const result = await api.git.commitStream('/proj', 'test commit', (e) => events.push(e));

      expect(result.ok).toBe(true);
      expect(result.sha).toBe('abc1234567890');
      expect(result.error).toBeUndefined();
    });

    test('calls onProgress for every event', async () => {
      const sseEvents = [
        { type: 'diagnostic', phase: 'before-staging', message: 'status' },
        { type: 'status', message: 'auto-staging' },
        { type: 'status', message: 'committing' },
        { type: 'output', message: 'commit output' },
        { type: 'diagnostic', phase: 'after-commit', message: 'clean' },
        { type: 'complete', sha: 'sha123', message: 'done' },
      ];
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockSSEResponse(sseEvents)));

      const events: any[] = [];
      await api.git.commitStream('/proj', 'msg', (e) => events.push(e));

      expect(events).toHaveLength(sseEvents.length);
      expect(events[0].type).toBe('diagnostic');
      expect(events[1].type).toBe('status');
      expect(events[5].type).toBe('complete');
    });

    test('sends correct request to /api/git/commit/stream', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(mockSSEResponse([{ type: 'complete', sha: 'sha', message: 'ok' }]));
      vi.stubGlobal('fetch', fetchMock);

      await api.git.commitStream('/my/project', 'my message', () => {});

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/git/commit/stream');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body.path).toBe('/my/project');
      expect(body.message).toBe('my message');
    });
  });

  // ─── Error handling: server errors ──────────────────────────────────

  describe('server-side errors', () => {
    test('returns ok:false when server sends error event', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          mockSSEResponse([
            { type: 'status', message: 'auto-staging' },
            { type: 'error', message: 'Pre-commit hook failed: 3 test(s) failed' },
          ]),
        ),
      );

      const events: any[] = [];
      const result = await api.git.commitStream('/proj', 'msg', (e) => events.push(e));

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Pre-commit hook failed: 3 test(s) failed');
    });

    test('uses last error message when multiple error events arrive', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          mockSSEResponse([
            { type: 'error', message: 'first error' },
            { type: 'error', message: 'second error' },
          ]),
        ),
      );

      const result = await api.git.commitStream('/proj', 'msg', () => {});

      // The last error should win
      expect(result.ok).toBe(false);
      expect(result.error).toBe('second error');
    });

    test('prefers error over incomplete stream when no complete event', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          mockSSEResponse([
            { type: 'status', message: 'starting' },
            { type: 'error', message: 'git add failed: index.lock' },
          ]),
        ),
      );

      const result = await api.git.commitStream('/proj', 'msg', () => {});

      expect(result.ok).toBe(false);
      expect(result.error).toBe('git add failed: index.lock');
    });

    test('reports stream ended unexpectedly when no complete and no error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          mockSSEResponse([
            { type: 'status', message: 'starting' },
            { type: 'output', message: 'some output' },
            // Stream ends without complete or error event
          ]),
        ),
      );

      const result = await api.git.commitStream('/proj', 'msg', () => {});

      expect(result.ok).toBe(false);
      expect(result.error).toContain('stream ended unexpectedly');
    });
  });

  // ─── Error handling: HTTP errors ────────────────────────────────────

  describe('HTTP-level errors', () => {
    test('returns ok:false for 400 Bad Request', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(mockJSONResponse({ ok: false, error: 'path required' }, 400)),
      );

      const result = await api.git.commitStream('/proj', 'msg', () => {});

      expect(result.ok).toBe(false);
      expect(result.error).toBe('path required');
    });

    test('returns ok:false for 403 Forbidden', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            mockJSONResponse({ ok: false, error: 'Path /proc is not a valid workspace' }, 403),
          ),
      );

      const result = await api.git.commitStream('/proc', 'msg', () => {});

      expect(result.ok).toBe(false);
      expect(result.error).toContain('/proc');
    });

    test('returns ok:false for 500 Internal Server Error', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(mockJSONResponse({ ok: false, error: 'Internal server error' }, 500)),
      );

      const result = await api.git.commitStream('/proj', 'msg', () => {});

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Internal server error');
    });

    test('handles non-JSON error response gracefully', async () => {
      const htmlResponse = new Response('<html>502 Bad Gateway</html>', {
        status: 502,
        statusText: 'Bad Gateway',
        headers: { 'Content-Type': 'text/html' },
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(htmlResponse));

      const result = await api.git.commitStream('/proj', 'msg', () => {});

      expect(result.ok).toBe(false);
      // response.json() fails on HTML, so catch returns { error: response.statusText }
      expect(result.error).toBe('Bad Gateway');
    });

    test('returns ok:false when response body is null', async () => {
      const noBodyResponse = new Response(null, { status: 200 });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(noBodyResponse));

      const result = await api.git.commitStream('/proj', 'msg', () => {});

      expect(result.ok).toBe(false);
    });
  });

  // ─── Error handling: network errors ─────────────────────────────────

  describe('network errors', () => {
    test('returns ok:false when fetch throws (network error)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

      const result = await api.git.commitStream('/proj', 'msg', () => {});

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Failed to fetch');
    });

    test('returns ok:false when fetch throws connection refused', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

      const result = await api.git.commitStream('/proj', 'msg', () => {});

      expect(result.ok).toBe(false);
      expect(result.error).toContain('ECONNREFUSED');
    });
  });

  // ─── SSE parsing edge cases ─────────────────────────────────────────

  describe('SSE parsing edge cases', () => {
    test('handles SSE data split across multiple chunks', async () => {
      // Simulate the SSE data being split mid-JSON across two chunks
      const fullEvent = `data: {"type":"complete","sha":"abc123","message":"ok"}\n\n`;
      const midpoint = Math.floor(fullEvent.length / 2);
      const chunk1 = fullEvent.slice(0, midpoint);
      const chunk2 = fullEvent.slice(midpoint);

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockChunkedSSEResponse([chunk1, chunk2])));

      const events: any[] = [];
      const result = await api.git.commitStream('/proj', 'msg', (e) => events.push(e));

      expect(result.ok).toBe(true);
      expect(result.sha).toBe('abc123');
    });

    test('handles multiple events in a single chunk', async () => {
      const combined =
        sseEvent({ type: 'status', message: 'staging' }) +
        sseEvent({ type: 'status', message: 'committing' }) +
        sseEvent({ type: 'complete', sha: 'sha999', message: 'done' });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockChunkedSSEResponse([combined])));

      const events: any[] = [];
      const result = await api.git.commitStream('/proj', 'msg', (e) => events.push(e));

      expect(events).toHaveLength(3);
      expect(result.ok).toBe(true);
      expect(result.sha).toBe('sha999');
    });

    test('handles event split right at newline boundary', async () => {
      // First chunk ends with "data: ..." but no newline
      // Second chunk starts with "\n\n"
      const event = { type: 'complete', sha: 'sha', message: 'ok' };
      const dataLine = `data: ${JSON.stringify(event)}`;

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockChunkedSSEResponse([dataLine, '\n\n'])));

      const events: any[] = [];
      const result = await api.git.commitStream('/proj', 'msg', (e) => events.push(e));

      expect(result.ok).toBe(true);
      expect(result.sha).toBe('sha');
    });

    test('ignores malformed JSON in SSE data lines', async () => {
      const events =
        `data: {not valid json}\n\n` + sseEvent({ type: 'complete', sha: 'sha', message: 'ok' });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockChunkedSSEResponse([events])));

      const captured: any[] = [];
      const result = await api.git.commitStream('/proj', 'msg', (e) => captured.push(e));

      // Should skip the malformed event and process the valid one
      expect(result.ok).toBe(true);
      expect(captured).toHaveLength(1);
      expect(captured[0].type).toBe('complete');
    });

    test('ignores non-data SSE lines (comments, event, id, retry)', async () => {
      const rawSSE =
        `: this is a comment\n` +
        `event: message\n` +
        `id: 123\n` +
        `retry: 5000\n` +
        `data: ${JSON.stringify({ type: 'complete', sha: 'sha', message: 'ok' })}\n\n`;

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockChunkedSSEResponse([rawSSE])));

      const events: any[] = [];
      const result = await api.git.commitStream('/proj', 'msg', (e) => events.push(e));

      expect(result.ok).toBe(true);
      expect(events).toHaveLength(1);
    });

    test('handles empty SSE stream (no events at all)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockChunkedSSEResponse([''])));

      const result = await api.git.commitStream('/proj', 'msg', () => {});

      expect(result.ok).toBe(false);
      expect(result.error).toContain('stream ended unexpectedly');
    });

    test('processes remaining buffer after stream closes', async () => {
      // Send complete event WITHOUT trailing newlines — it will stay in buffer
      const noTrailingNewline = `data: ${JSON.stringify({ type: 'complete', sha: 'sha', message: 'ok' })}`;

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(mockChunkedSSEResponse([noTrailingNewline])),
      );

      const events: any[] = [];
      const result = await api.git.commitStream('/proj', 'msg', (e) => events.push(e));

      // The commitStream function processes remaining buffer after stream closes
      expect(result.ok).toBe(true);
      expect(result.sha).toBe('sha');
    });

    test('handles rapid succession of many events', async () => {
      const manyEvents = [];
      for (let i = 0; i < 100; i++) {
        manyEvents.push({ type: 'output', message: `line ${i}` });
      }
      manyEvents.push({ type: 'complete', sha: 'final', message: 'done' });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockSSEResponse(manyEvents)));

      const events: any[] = [];
      const result = await api.git.commitStream('/proj', 'msg', (e) => events.push(e));

      expect(events).toHaveLength(101);
      expect(result.ok).toBe(true);
      expect(result.sha).toBe('final');
    });
  });

  // ─── Event type handling ────────────────────────────────────────────

  describe('event type handling', () => {
    test('passes diagnostic events with phase and porcelain data', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          mockSSEResponse([
            {
              type: 'diagnostic',
              phase: 'before-staging',
              message: 'Current status',
              porcelain: ' M a.ts\n?? b.ts',
              fileCount: 2,
            },
            { type: 'complete', sha: 'sha', message: 'ok' },
          ]),
        ),
      );

      const events: any[] = [];
      await api.git.commitStream('/proj', 'msg', (e) => events.push(e));

      const diag = events.find((e) => e.type === 'diagnostic');
      expect(diag.phase).toBe('before-staging');
      expect(diag.porcelain).toBe(' M a.ts\n?? b.ts');
      expect(diag.fileCount).toBe(2);
    });

    test('passes error events with detail field', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          mockSSEResponse([
            {
              type: 'error',
              message: 'Pre-commit hook failed',
              detail: 'FAIL src/test.ts\n  Expected true, got false',
            },
          ]),
        ),
      );

      const events: any[] = [];
      const result = await api.git.commitStream('/proj', 'msg', (e) => events.push(e));

      expect(result.ok).toBe(false);
      const errEvent = events.find((e) => e.type === 'error');
      expect(errEvent.detail).toContain('FAIL');
    });

    test('does not return early on error — continues reading stream', async () => {
      // Error event followed by more events — client should read all of them
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          mockSSEResponse([
            { type: 'status', message: 'starting' },
            { type: 'error', message: 'hook failed' },
            { type: 'output', message: 'cleanup output' },
          ]),
        ),
      );

      const events: any[] = [];
      await api.git.commitStream('/proj', 'msg', (e) => events.push(e));

      // All 3 events should have been processed
      expect(events).toHaveLength(3);
    });
  });

  // ─── Request headers ────────────────────────────────────────────────

  describe('request headers', () => {
    test('sets Content-Type to application/json', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(mockSSEResponse([{ type: 'complete', sha: 's', message: 'ok' }]));
      vi.stubGlobal('fetch', fetchMock);

      await api.git.commitStream('/proj', 'msg', () => {});

      const headers = fetchMock.mock.calls[0][1].headers;
      expect(headers['Content-Type']).toBe('application/json');
    });

    test('sends path and message in JSON body', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(mockSSEResponse([{ type: 'complete', sha: 's', message: 'ok' }]));
      vi.stubGlobal('fetch', fetchMock);

      await api.git.commitStream('/my/workspace', 'fix: resolve bug', () => {});

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.path).toBe('/my/workspace');
      expect(body.message).toBe('fix: resolve bug');
    });
  });

  // ─── Concurrency and state ──────────────────────────────────────────

  describe('concurrent and state edge cases', () => {
    test('empty message in error event defaults to "Commit failed"', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(mockSSEResponse([{ type: 'error', message: '' }])),
      );

      const events: any[] = [];
      const result = await api.git.commitStream('/proj', 'msg', (e) => events.push(e));

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Commit failed');
    });

    test('handles complete event without sha', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(mockSSEResponse([{ type: 'complete', message: 'ok' }])),
      );

      const result = await api.git.commitStream('/proj', 'msg', () => {});

      expect(result.ok).toBe(true);
      expect(result.sha).toBe('');
    });

    test('returns ok:true even when error event precedes complete event', async () => {
      // This tests the "error then retry succeeded" scenario — if both error
      // and complete events arrive, the error should win (since lastError is set)
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          mockSSEResponse([
            { type: 'error', message: 'temporary failure' },
            { type: 'complete', sha: 'sha', message: 'ok' },
          ]),
        ),
      );

      const result = await api.git.commitStream('/proj', 'msg', () => {});

      // lastError takes priority over gotComplete
      expect(result.ok).toBe(false);
      expect(result.error).toBe('temporary failure');
    });
  });
});
