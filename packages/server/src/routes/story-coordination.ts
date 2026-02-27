import { Hono } from 'hono';
import { storyCoordinator } from '../services/story-coordinator';
import type {
  StoryClaimRequest,
  StoryHeartbeatRequest,
  StoryResultReport,
  AvailableStoriesRequest,
  CoordinationEvent,
  GolemQuestion,
} from '@e/shared';

// ---------------------------------------------------------------------------
// In-memory question store — golems park questions here while waiting for
// a human response. Keyed by questionId. Cleared when answered.
// ---------------------------------------------------------------------------
interface StoredQuestion extends GolemQuestion {
  resolve: (answer: string) => void;
}

const pendingQuestions = new Map<string, StoredQuestion>();

const app = new Hono();

// ---------------------------------------------------------------------------
// POST /claim — Claim a story for execution
// ---------------------------------------------------------------------------
// Remote golems call this to atomically claim a story. The coordinator
// performs compare-and-swap on the story status, dependency validation,
// and lease creation in a single SQLite transaction.
// ---------------------------------------------------------------------------
app.post('/claim', async (c) => {
  try {
    const body = await c.req.json<StoryClaimRequest>();

    if (
      !body.storyId ||
      !body.executorId ||
      !body.executorType ||
      !body.machineId ||
      !body.assignedBranch
    ) {
      return c.json(
        {
          ok: false,
          error:
            'Missing required fields: storyId, executorId, executorType, machineId, assignedBranch',
        },
        400,
      );
    }

    const result = storyCoordinator.claimStory(body);

    if (result.claimed) {
      return c.json({ ok: true, data: result }, 200);
    } else {
      // 409 Conflict for concurrent claim attempts, 400 for other rejections
      const status = result.currentExecutorId ? 409 : 400;
      return c.json({ ok: false, data: result, error: result.reason }, status);
    }
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /:storyId/heartbeat — Renew heartbeat for a claimed story
// ---------------------------------------------------------------------------
// Executors call this periodically (default every 60s) to extend their lease.
// If the executor fails to heartbeat before the lease expires (default 5min),
// the coordinator releases the story and marks it for retry.
// ---------------------------------------------------------------------------
app.post('/:storyId/heartbeat', async (c) => {
  try {
    const storyId = c.req.param('storyId');
    const body = await c.req.json<StoryHeartbeatRequest>();

    if (!body.executorId) {
      return c.json({ ok: false, error: 'Missing required field: executorId' }, 400);
    }

    const result = storyCoordinator.renewHeartbeat(storyId, body);

    if (result.renewed) {
      return c.json({ ok: true, data: result }, 200);
    } else {
      const status = result.reason === 'lease_expired' ? 410 : 400;
      return c.json({ ok: false, data: result, error: result.reason }, status);
    }
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /:storyId/result — Report execution result
// ---------------------------------------------------------------------------
// Executors call this when they complete (or fail) a story execution.
// The coordinator validates the executor holds the lease, updates the
// story status, releases the lease, and optionally triggers merge-back.
// ---------------------------------------------------------------------------
app.post('/:storyId/result', async (c) => {
  try {
    const storyId = c.req.param('storyId');
    const body = await c.req.json<StoryResultReport>();

    if (!body.executorId || !body.status) {
      return c.json({ ok: false, error: 'Missing required fields: executorId, status' }, 400);
    }

    const validStatuses = ['success', 'failure', 'timeout', 'cancelled'];
    if (!validStatuses.includes(body.status)) {
      return c.json(
        {
          ok: false,
          error: `Invalid status: ${body.status}. Must be one of: ${validStatuses.join(', ')}`,
        },
        400,
      );
    }

    const result = storyCoordinator.reportResult(storyId, body);

    if (result.accepted) {
      return c.json({ ok: true, data: result }, 200);
    } else {
      return c.json({ ok: false, data: result, error: result.reason }, 400);
    }
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /available — List stories available for claiming
// ---------------------------------------------------------------------------
// Remote golems poll this endpoint to discover stories they can work on.
// Returns stories that are pending/failed_timeout, have attempts remaining,
// are not research-only, and have all dependencies met.
// ---------------------------------------------------------------------------
app.get('/available', (c) => {
  try {
    const request: AvailableStoriesRequest = {
      workspacePath: c.req.query('workspacePath') || undefined,
      prdId: c.req.query('prdId') || undefined,
      executorType: c.req.query('executorType') || undefined,
    };

    const stories = storyCoordinator.getAvailableStories(request);
    return c.json({ ok: true, data: stories });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /leases — List active leases (monitoring)
// ---------------------------------------------------------------------------
app.get('/leases', (c) => {
  try {
    const leases = storyCoordinator.getActiveLeases();
    return c.json({ ok: true, data: leases });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// DELETE /:storyId/lease — Force-release a lease (admin)
// ---------------------------------------------------------------------------
app.delete('/:storyId/lease', (c) => {
  try {
    const storyId = c.req.param('storyId');
    const released = storyCoordinator.forceReleaseLease(storyId);

    if (released) {
      return c.json({ ok: true, data: { released: true } });
    } else {
      return c.json({ ok: false, error: 'No active lease found for this story' }, 404);
    }
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /config — Get coordination configuration
// ---------------------------------------------------------------------------
app.get('/config', (c) => {
  return c.json({ ok: true, data: storyCoordinator.getConfig() });
});

// ---------------------------------------------------------------------------
// PUT /config — Update coordination configuration
// ---------------------------------------------------------------------------
app.put('/config', async (c) => {
  try {
    const body = await c.req.json();
    storyCoordinator.updateConfig(body);
    return c.json({ ok: true, data: storyCoordinator.getConfig() });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /pending-questions — List all pending (unanswered) golem questions
// ---------------------------------------------------------------------------
// The Manager Panel polls this to show golem assistance requests.
// ---------------------------------------------------------------------------
app.get('/pending-questions', (c) => {
  try {
    const questions = Array.from(pendingQuestions.values())
      .filter((q) => !q.answer)
      // Strip the resolve function from the response
      .map(({ resolve: _r, ...q }) => q);
    return c.json({ ok: true, data: questions });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /:storyId/question — Golem submits a question, pauses for answer
// ---------------------------------------------------------------------------
// Body: { executorId, question, context? }
// Returns: { questionId } immediately; golem should then poll GET below.
// ---------------------------------------------------------------------------
app.post('/:storyId/question', async (c) => {
  try {
    const storyId = c.req.param('storyId');
    const body = await c.req.json<{ executorId: string; question: string; context?: string }>();

    if (!body.executorId || !body.question) {
      return c.json({ ok: false, error: 'Missing required fields: executorId, question' }, 400);
    }

    const questionId = crypto.randomUUID();

    // Wrap in a promise so the answer resolves async
    const questionEntry = await new Promise<StoredQuestion>((resolve) => {
      const entry: StoredQuestion = {
        questionId,
        storyId,
        executorId: body.executorId,
        question: body.question,
        context: body.context,
        askedAt: Date.now(),
        resolve: (answer: string) => {
          entry.answer = answer;
          entry.answeredAt = Date.now();
          resolve(entry);
        },
      };
      pendingQuestions.set(questionId, entry);
      // Don't wait for the promise — return the ID immediately
      resolve(entry);
    });

    // Emit SSE event so the Manager Panel knows immediately
    const event: CoordinationEvent = {
      type: 'story_question',
      storyId,
      executorId: body.executorId,
      timestamp: Date.now(),
      data: {
        questionId,
        question: body.question,
        context: body.context,
      },
    };
    storyCoordinator.events.emit('coordination_event', event);

    return c.json({ ok: true, data: { questionId } }, 200);
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /:storyId/question/:questionId — Poll for answer
// ---------------------------------------------------------------------------
// Golem polls this every 5 seconds. Returns answered:false until the user
// responds, then answered:true with the answer string.
// ---------------------------------------------------------------------------
app.get('/:storyId/question/:questionId', (c) => {
  try {
    const questionId = c.req.param('questionId');
    const entry = pendingQuestions.get(questionId);

    if (!entry) {
      return c.json({ ok: false, error: 'Question not found' }, 404);
    }

    if (entry.answer !== undefined) {
      // Clean up after the golem reads the answer
      pendingQuestions.delete(questionId);
      return c.json({
        ok: true,
        data: { answered: true, answer: entry.answer, answeredAt: entry.answeredAt },
      });
    }

    return c.json({ ok: true, data: { answered: false } });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /:storyId/question/:questionId/answer — User submits an answer
// ---------------------------------------------------------------------------
// Body: { answer }
// ---------------------------------------------------------------------------
app.post('/:storyId/question/:questionId/answer', async (c) => {
  try {
    const storyId = c.req.param('storyId');
    const questionId = c.req.param('questionId');
    const body = await c.req.json<{ answer: string }>();

    if (!body.answer) {
      return c.json({ ok: false, error: 'Missing required field: answer' }, 400);
    }

    const entry = pendingQuestions.get(questionId);
    if (!entry) {
      return c.json({ ok: false, error: 'Question not found (may already be answered)' }, 404);
    }

    if (entry.answer !== undefined) {
      return c.json({ ok: false, error: 'Question already answered' }, 409);
    }

    // Resolve — the golem's next poll will pick this up
    entry.resolve(body.answer);

    // Emit SSE event so the UI can update
    const event: CoordinationEvent = {
      type: 'story_answered',
      storyId,
      executorId: entry.executorId,
      timestamp: Date.now(),
      data: { questionId, answer: body.answer },
    };
    storyCoordinator.events.emit('coordination_event', event);

    return c.json({ ok: true, data: { accepted: true } });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /events — SSE endpoint for real-time coordination events
// ---------------------------------------------------------------------------
app.get('/events', (c) => {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const handler = (event: CoordinationEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          /* client disconnected */
        }
      };

      storyCoordinator.events.on('coordination_event', handler);

      // Ping to keep connection alive
      const pingInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`data: {"type":"ping","timestamp":${Date.now()}}\n\n`));
        } catch {
          clearInterval(pingInterval);
        }
      }, 15000);

      // Clean up on abort
      c.req.raw.signal.addEventListener('abort', () => {
        storyCoordinator.events.off('coordination_event', handler);
        clearInterval(pingInterval);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
});

export { app as storyCoordinationRoutes };
