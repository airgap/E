import { Hono } from 'hono';
import { getDb } from '../db/database';
import { claudeManager } from '../services/claude-process';
import { loopOrchestrator } from '../services/loop';
import { prdEvents, type PrdEvent } from './prd/events';
import { cloudBudgetManager } from '../services/cloud-budget-manager';

const app = new Hono();

/**
 * GET /api/manager/overview
 *
 * Returns a cross-workspace aggregated view:
 * - All workspaces with their active agent/loop status
 * - Pending tool approvals across all conversations
 * - Recently completed stories (last 24h)
 * - Active streams/sessions
 */
app.get('/overview', (c) => {
  const db = getDb();
  const since = Date.now() - 24 * 60 * 60 * 1000; // last 24h

  // --- Workspaces ---
  const workspaces = db.query('SELECT * FROM workspaces ORDER BY last_opened DESC').all() as any[];

  // --- Active loops per workspace ---
  const activeLoops = loopOrchestrator.listLoops() as any[];
  const loopsByWorkspace = new Map<string, any[]>();
  for (const loop of activeLoops) {
    if (!loopsByWorkspace.has(loop.workspacePath)) {
      loopsByWorkspace.set(loop.workspacePath, []);
    }
    loopsByWorkspace.get(loop.workspacePath)!.push(loop);
  }

  // --- Active Claude sessions ---
  const sessions = claudeManager.listSessions();
  // sessions: Array<{ id, conversationId, status, streamComplete, bufferedEvents }>

  // Map sessions to conversations to get workspace paths
  const sessionConvIds = sessions.map((s: any) => s.conversationId).filter(Boolean);
  let convMap = new Map<string, any>();
  if (sessionConvIds.length > 0) {
    const placeholders = sessionConvIds.map(() => '?').join(',');
    const convs = db
      .query(`SELECT id, title, workspace_path FROM conversations WHERE id IN (${placeholders})`)
      .all(...sessionConvIds) as any[];
    for (const conv of convs) {
      convMap.set(conv.id, conv);
    }
  }

  // Map sessions per workspace
  const sessionsByWorkspace = new Map<string, any[]>();
  for (const session of sessions as any[]) {
    const conv = convMap.get(session.conversationId);
    const wPath = conv?.workspace_path ?? null;
    if (wPath) {
      if (!sessionsByWorkspace.has(wPath)) {
        sessionsByWorkspace.set(wPath, []);
      }
      sessionsByWorkspace.get(wPath)!.push({
        ...session,
        conversationTitle: conv?.title ?? 'Untitled',
      });
    }
  }

  // --- Pending approvals (tool_approval_request events buffered in active sessions) ---
  // The claudeManager keeps buffered SSE events per session; we scan them for approval requests.
  const pendingApprovals: Array<{
    sessionId: string;
    conversationId: string;
    conversationTitle: string;
    workspacePath: string | null;
    toolCallId: string;
    toolName: string;
    description: string;
  }> = [];

  for (const session of sessions as any[]) {
    if (!session.conversationId || session.streamComplete) continue;
    const conv = convMap.get(session.conversationId);

    // Scan the buffered SSE events for pending approval requests
    // The session's rawSession object holds eventBuffer
    const rawSession = (claudeManager as any).sessions?.get(session.id);
    if (!rawSession?.eventBuffer) continue;

    // Track which toolCallIds have been responded to (tool_result means it was answered)
    const respondedIds = new Set<string>();
    for (const sseData of rawSession.eventBuffer as string[]) {
      if (!sseData.startsWith('data: ')) continue;
      try {
        const evt = JSON.parse(sseData.slice(6));
        if (evt.type === 'tool_result' && evt.toolCallId) {
          respondedIds.add(evt.toolCallId);
        }
      } catch {}
    }

    // Now collect unanswered approval requests
    for (const sseData of rawSession.eventBuffer as string[]) {
      if (!sseData.startsWith('data: ')) continue;
      try {
        const evt = JSON.parse(sseData.slice(6));
        if (
          evt.type === 'tool_approval_request' &&
          evt.toolCallId &&
          !respondedIds.has(evt.toolCallId)
        ) {
          pendingApprovals.push({
            sessionId: session.id,
            conversationId: session.conversationId,
            conversationTitle: conv?.title ?? 'Untitled',
            workspacePath: conv?.workspace_path ?? null,
            toolCallId: evt.toolCallId,
            toolName: evt.toolName ?? 'unknown',
            description: evt.description ?? evt.toolName ?? 'Tool approval needed',
          });
        }
      } catch {}
    }
  }

  // --- Recently completed stories ---
  const completedStories = db
    .query(
      `SELECT ps.id, ps.title, ps.status, ps.workspace_path, ps.updated_at, ps.prd_id,
              p.name as prd_name
       FROM prd_stories ps
       LEFT JOIN prds p ON ps.prd_id = p.id
       WHERE ps.status IN ('completed', 'failed')
         AND ps.updated_at >= ?
       ORDER BY ps.updated_at DESC
       LIMIT 50`,
    )
    .all(since) as any[];

  // --- In-progress stories ---
  // Include executor metadata so Manager View shows which host is executing each story
  const inProgressStories = db
    .query(
      `SELECT ps.id, ps.title, ps.status, ps.workspace_path, ps.updated_at, ps.prd_id,
              ps.conversation_id, ps.attempts, ps.max_attempts,
              ps.executor_id, ps.executor_type, ps.machine_id,
              p.name as prd_name
       FROM prd_stories ps
       LEFT JOIN prds p ON ps.prd_id = p.id
       WHERE ps.status = 'in_progress'
       ORDER BY ps.updated_at DESC
       LIMIT 20`,
    )
    .all() as any[];

  // --- Build workspace status ---
  const workspaceStatuses = workspaces.map((ws: any) => {
    const wsLoops = loopsByWorkspace.get(ws.path) ?? [];
    const wsSessions = sessionsByWorkspace.get(ws.path) ?? [];

    const runningLoops = wsLoops.filter(
      (l: any) => l.status === 'running' || l.status === 'paused',
    );
    const activeSessions = wsSessions.filter((s: any) => !s.streamComplete);

    let agentStatus: 'idle' | 'running' | 'waiting' = 'idle';
    if (activeSessions.length > 0) {
      agentStatus = 'running';
    } else if (runningLoops.length > 0) {
      agentStatus = 'running';
    }

    // Check if any session has pending approvals for this workspace
    const wsPendingApprovals = pendingApprovals.filter((a) => a.workspacePath === ws.path);
    if (wsPendingApprovals.length > 0) {
      agentStatus = 'waiting';
    }

    // Parse settings JSON
    let settings = null;
    if (ws.settings) {
      try {
        settings = typeof ws.settings === 'string' ? JSON.parse(ws.settings) : ws.settings;
      } catch {
        settings = null;
      }
    }

    return {
      id: ws.id,
      name: ws.name,
      path: ws.path,
      agentStatus,
      activeLoops: runningLoops,
      activeSessions: activeSessions,
      pendingApprovals: wsPendingApprovals,
      lastOpened: ws.last_opened,
      settings,
    };
  });

  // --- Counts ---
  const totalPendingApprovals = pendingApprovals.length;
  const totalRunningAgents = (sessions as any[]).filter((s: any) => !s.streamComplete).length;
  const totalActiveLoops = activeLoops.filter(
    (l: any) => l.status === 'running' || l.status === 'paused',
  ).length;

  // --- Cloud cost overview (AC 7) ---
  let costOverview;
  try {
    costOverview = cloudBudgetManager.getManagerCostOverview();
  } catch {
    costOverview = null;
  }

  return c.json({
    ok: true,
    data: {
      workspaces: workspaceStatuses,
      pendingApprovals,
      inProgressStories,
      completedStories,
      costOverview,
      summary: {
        totalWorkspaces: workspaces.length,
        totalPendingApprovals,
        totalRunningAgents,
        totalActiveLoops,
        totalCompletedToday: completedStories.filter((s: any) => s.status === 'completed').length,
      },
    },
  });
});

/**
 * GET /api/manager/events
 * SSE stream of real-time manager events (loop updates, story completions, etc.)
 */
app.get('/events', (c) => {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: Record<string, unknown> = {}) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: event, ...data })}\n\n`),
          );
        } catch {
          // Client disconnected
        }
      };

      // Send initial ping
      send('ping', { ts: Date.now() });

      // Subscribe to loop orchestrator events
      const onLoopEvent = (loopId: string, event: unknown) => {
        send('loop_event', { loopId, event });
      };

      const onStoryUpdate = (loopId: string, story: unknown, status: string) => {
        send('story_update', { loopId, story, status });
      };

      const onLoopStart = (loopId: string) => {
        send('loop_started', { loopId });
      };

      const onLoopDone = (loopId: string) => {
        send('loop_done', { loopId });
      };

      const onPrdChange = (event: PrdEvent) => {
        send('prd_change', event as unknown as Record<string, unknown>);
      };

      // Budget events — forward to Manager View for real-time cost updates (AC 7)
      const onBudgetWarning = (event: unknown) => {
        send('budget_warning', { event });
      };
      const onBudgetExceeded = (event: unknown) => {
        send('budget_exceeded', { event });
      };

      loopOrchestrator.events.on('loop_event', onLoopEvent);
      loopOrchestrator.events.on('story_completed', onStoryUpdate);
      loopOrchestrator.events.on('story_failed', onStoryUpdate);
      loopOrchestrator.events.on('started', onLoopStart);
      loopOrchestrator.events.on('completed', onLoopDone);
      loopOrchestrator.events.on('cancelled', onLoopDone);
      loopOrchestrator.events.on('failed', onLoopDone);
      prdEvents.on('prd_change', onPrdChange);
      cloudBudgetManager.events.on('budget_warning', onBudgetWarning);
      cloudBudgetManager.events.on('budget_exceeded', onBudgetExceeded);

      // Keep-alive ping every 20s
      const pingInterval = setInterval(() => {
        send('ping', { ts: Date.now() });
      }, 20000);

      // Cleanup on close
      const cleanup = () => {
        clearInterval(pingInterval);
        loopOrchestrator.events.off('loop_event', onLoopEvent);
        loopOrchestrator.events.off('story_completed', onStoryUpdate);
        loopOrchestrator.events.off('story_failed', onStoryUpdate);
        loopOrchestrator.events.off('started', onLoopStart);
        loopOrchestrator.events.off('completed', onLoopDone);
        loopOrchestrator.events.off('cancelled', onLoopDone);
        loopOrchestrator.events.off('failed', onLoopDone);
        prdEvents.off('prd_change', onPrdChange);
        cloudBudgetManager.events.off('budget_warning', onBudgetWarning);
        cloudBudgetManager.events.off('budget_exceeded', onBudgetExceeded);
      };

      // Handle client disconnect
      c.req.raw.signal?.addEventListener('abort', () => {
        cleanup();
        try {
          controller.close();
        } catch {}
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

export { app as managerRoutes };
