import { Hono } from 'hono';
import { commentatorService, PERSONALITY_PROMPTS } from '../services/commentator';
import { eventBridge } from '../services/event-bridge';
import { getDb } from '../db/database';
import type {
  StreamCommentary,
  CommentaryPersonality,
  CommentaryVerbosity,
  CommentarySettings,
} from '@e/shared';
import { DEFAULT_COMMENTARY_SETTINGS, VALID_VERBOSITY_VALUES, migrateVerbosity } from '@e/shared';

const app = new Hono();

/** All valid personality values (used for query-param validation). */
const VALID_PERSONALITIES = Object.keys(PERSONALITY_PROMPTS) as CommentaryPersonality[];

/** Read the user's preferred commentary personality from global settings, if any. */
function getUserPreferredPersonality(): CommentaryPersonality | undefined {
  try {
    const db = getDb();
    const row = db
      .query('SELECT value FROM settings WHERE key = ?')
      .get('commentaryPersonality') as { value: string } | null;
    if (row) {
      const parsed = JSON.parse(row.value) as string;
      if (VALID_PERSONALITIES.includes(parsed as CommentaryPersonality)) {
        return parsed as CommentaryPersonality;
      }
    }
  } catch {
    /* settings unavailable — fall through */
  }
  return undefined;
}

/**
 * Resolve the full commentary settings for a workspace.
 * Reads from the workspace's JSON settings column and applies defaults.
 * Handles migration from legacy verbosity values ('low'|'medium'|'high').
 */
function getWorkspaceCommentarySettings(workspaceId: string): CommentarySettings {
  try {
    const db = getDb();
    const row = db.query('SELECT settings FROM workspaces WHERE id = ?').get(workspaceId) as {
      settings: string | null;
    } | null;
    if (row && row.settings) {
      const settings = JSON.parse(row.settings);
      return {
        enabled:
          settings.commentaryEnabled !== undefined
            ? Boolean(settings.commentaryEnabled)
            : DEFAULT_COMMENTARY_SETTINGS.enabled,
        personality:
          settings.commentaryPersonality &&
          VALID_PERSONALITIES.includes(settings.commentaryPersonality)
            ? (settings.commentaryPersonality as CommentaryPersonality)
            : DEFAULT_COMMENTARY_SETTINGS.personality,
        verbosity: settings.commentaryVerbosity
          ? migrateVerbosity(settings.commentaryVerbosity)
          : DEFAULT_COMMENTARY_SETTINGS.verbosity,
      };
    }
  } catch {
    /* DB unavailable or parse error — fall through */
  }
  return { ...DEFAULT_COMMENTARY_SETTINGS };
}

// ---------------------------------------------------------------------------
// Commentary Status Endpoint (for multi-workspace monitoring)
// ---------------------------------------------------------------------------

app.get('/status', (c) => {
  try {
    const commentators = commentatorService.getStatus();
    const subscribedWorkspaces = eventBridge.getSubscribedWorkspaces();

    return c.json({
      ok: true,
      data: {
        activeCommentators: commentators,
        subscribedWorkspaces,
        totalActive: commentatorService.activeCount,
        totalSubscribed: eventBridge.subscriberCount,
      },
    });
  } catch (err) {
    console.error('[commentary] Failed to get status:', err);
    return c.json({ ok: false, error: 'Failed to get commentary status' }, 500);
  }
});

// ---------------------------------------------------------------------------
// Commentary Settings Endpoints
// ---------------------------------------------------------------------------

app.get('/:workspaceId/settings', (c) => {
  const workspaceId = c.req.param('workspaceId');

  try {
    const db = getDb();
    const workspace = db.query('SELECT id FROM workspaces WHERE id = ?').get(workspaceId) as any;
    if (!workspace) {
      return c.json({ ok: false, error: 'Workspace not found' }, 404);
    }

    const commentarySettings = getWorkspaceCommentarySettings(workspaceId);
    return c.json({ ok: true, data: commentarySettings });
  } catch (err) {
    console.error('[commentary] Failed to get settings:', err);
    return c.json({ ok: false, error: 'Failed to get commentary settings' }, 500);
  }
});

app.put('/:workspaceId/settings', async (c) => {
  const workspaceId = c.req.param('workspaceId');

  try {
    const body = await c.req.json();
    const db = getDb();

    const workspace = db
      .query('SELECT id, settings FROM workspaces WHERE id = ?')
      .get(workspaceId) as any;
    if (!workspace) {
      return c.json({ ok: false, error: 'Workspace not found' }, 404);
    }

    const settingsUpdate: Record<string, unknown> = {};

    if (body.enabled !== undefined) {
      settingsUpdate.commentaryEnabled = Boolean(body.enabled);
    }

    if (body.personality !== undefined) {
      if (!VALID_PERSONALITIES.includes(body.personality as CommentaryPersonality)) {
        return c.json(
          {
            ok: false,
            error: `Invalid personality. Valid values: ${VALID_PERSONALITIES.join(', ')}`,
          },
          400,
        );
      }
      settingsUpdate.commentaryPersonality = body.personality;
    }

    if (body.verbosity !== undefined) {
      if (!VALID_VERBOSITY_VALUES.includes(body.verbosity as CommentaryVerbosity)) {
        return c.json(
          {
            ok: false,
            error: `Invalid verbosity. Valid values: ${VALID_VERBOSITY_VALUES.join(', ')}`,
          },
          400,
        );
      }
      settingsUpdate.commentaryVerbosity = body.verbosity;
    }

    if (Object.keys(settingsUpdate).length === 0) {
      const current = getWorkspaceCommentarySettings(workspaceId);
      return c.json({ ok: true, data: current });
    }

    const existingSettings = workspace.settings ? JSON.parse(workspace.settings) : {};
    const mergedSettings = { ...existingSettings, ...settingsUpdate };

    db.query('UPDATE workspaces SET settings = ? WHERE id = ?').run(
      JSON.stringify(mergedSettings),
      workspaceId,
    );

    // If commentary was just disabled, force-stop and cleanup
    if (settingsUpdate.commentaryEnabled === false) {
      commentatorService.forceStopCommentary(workspaceId);
      eventBridge.forceUnsubscribe(workspaceId);
    }

    // If verbosity was updated and commentator is active, update it live
    if (settingsUpdate.commentaryVerbosity && commentatorService.isActive(workspaceId)) {
      commentatorService.setVerbosity(
        workspaceId,
        settingsUpdate.commentaryVerbosity as CommentaryVerbosity,
      );
    }

    const updatedSettings = getWorkspaceCommentarySettings(workspaceId);
    return c.json({ ok: true, data: updatedSettings });
  } catch (err) {
    console.error('[commentary] Failed to update settings:', err);
    return c.json({ ok: false, error: 'Failed to update commentary settings' }, 500);
  }
});

// ---------------------------------------------------------------------------
// Commentary History Endpoints
// ---------------------------------------------------------------------------

app.get('/conversation/:conversationId', (c) => {
  const conversationId = c.req.param('conversationId');
  const limit = Math.min(parseInt(c.req.query('limit') || '100', 10), 1000);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  try {
    const db = getDb();
    const rows = db
      .query(
        `SELECT id, workspace_id, conversation_id, text, personality, timestamp
         FROM commentary_history
         WHERE conversation_id = ?
         ORDER BY timestamp DESC
         LIMIT ? OFFSET ?`,
      )
      .all(conversationId, limit, offset) as any[];

    const history = rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      conversationId: row.conversation_id,
      text: row.text,
      personality: row.personality,
      timestamp: row.timestamp,
    }));

    return c.json({ history });
  } catch (err) {
    console.error('[commentary] Failed to fetch conversation history:', err);
    return c.json({ error: 'Failed to fetch commentary history', history: [] }, 500);
  }
});

app.get('/:workspaceId/history', (c) => {
  const workspaceId = c.req.param('workspaceId');
  const limit = Math.min(parseInt(c.req.query('limit') || '100', 10), 1000);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  try {
    const db = getDb();
    const rows = db
      .query(
        `SELECT id, workspace_id, conversation_id, text, personality, timestamp
         FROM commentary_history
         WHERE workspace_id = ?
         ORDER BY timestamp DESC
         LIMIT ? OFFSET ?`,
      )
      .all(workspaceId, limit, offset) as any[];

    const history = rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      conversationId: row.conversation_id,
      text: row.text,
      personality: row.personality,
      timestamp: row.timestamp,
    }));

    return c.json({ history });
  } catch (err) {
    console.error('[commentary] Failed to fetch history:', err);
    return c.json({ error: 'Failed to fetch commentary history', history: [] }, 500);
  }
});

app.delete('/:workspaceId/history', (c) => {
  const workspaceId = c.req.param('workspaceId');

  try {
    const db = getDb();
    db.query('DELETE FROM commentary_history WHERE workspace_id = ?').run(workspaceId);
    return c.json({ ok: true, data: { success: true } });
  } catch (err) {
    console.error('[commentary] Failed to clear history:', err);
    return c.json({ ok: false, error: 'Failed to clear commentary history' }, 500);
  }
});

// ---------------------------------------------------------------------------
// Commentary Export Endpoint
// ---------------------------------------------------------------------------

/**
 * GET /commentary/:workspaceId/export — Export commentary history.
 *
 * Query params:
 *   format    — 'markdown' | 'json' (default: 'json')
 *   startTime — optional epoch ms lower bound
 *   endTime   — optional epoch ms upper bound
 *   limit     — max entries (default: 5000, max: 10000)
 *
 * Returns the exported content with appropriate Content-Type headers.
 */
app.get('/:workspaceId/export', (c) => {
  const workspaceId = c.req.param('workspaceId');
  const format = c.req.query('format') || 'json';
  const startTime = c.req.query('startTime') ? parseInt(c.req.query('startTime')!, 10) : undefined;
  const endTime = c.req.query('endTime') ? parseInt(c.req.query('endTime')!, 10) : undefined;
  const limit = Math.min(parseInt(c.req.query('limit') || '5000', 10), 10000);

  if (format !== 'markdown' && format !== 'json') {
    return c.json({ ok: false, error: 'Invalid format. Valid values: markdown, json' }, 400);
  }

  try {
    const db = getDb();

    // Build query with optional time range filtering
    let sql =
      'SELECT id, workspace_id, conversation_id, text, personality, timestamp FROM commentary_history WHERE workspace_id = ?';
    const params: (string | number)[] = [workspaceId];

    if (startTime !== undefined) {
      sql += ' AND timestamp >= ?';
      params.push(startTime);
    }
    if (endTime !== undefined) {
      sql += ' AND timestamp <= ?';
      params.push(endTime);
    }

    sql += ' ORDER BY timestamp ASC LIMIT ?';
    params.push(limit);

    const rows = db.query(sql).all(...params) as any[];

    if (rows.length === 0) {
      return c.json(
        { ok: false, error: 'No commentary entries found for the given criteria' },
        404,
      );
    }

    const entries = rows.map((row: any) => ({
      id: row.id as string,
      workspaceId: row.workspace_id as string,
      conversationId: row.conversation_id as string | null,
      text: row.text as string,
      personality: row.personality as string,
      timestamp: row.timestamp as number,
      timestampISO: new Date(row.timestamp as number).toISOString(),
    }));

    // Resolve workspace name
    const workspace = db
      .query('SELECT workspace_path FROM workspaces WHERE id = ?')
      .get(workspaceId) as { workspace_path: string } | null;
    const workspaceName = workspace?.workspace_path?.split('/').pop() || 'Unknown Workspace';

    // Build metadata
    const timestamps = entries.map((e) => e.timestamp);
    const minTime = Math.min(...timestamps);
    const maxTime = Math.max(...timestamps);

    const personalityCounts: Record<string, number> = {};
    for (const entry of entries) {
      personalityCounts[entry.personality] = (personalityCounts[entry.personality] || 0) + 1;
    }
    const primaryPersonality =
      Object.entries(personalityCounts).sort(([, a], [, b]) => b - a)[0]?.[0] || 'unknown';

    const metadata = {
      workspaceName,
      workspaceId,
      personality: primaryPersonality,
      exportDate: new Date().toISOString(),
      totalEntries: entries.length,
      timeRange: {
        start: new Date(minTime).toISOString(),
        end: new Date(maxTime).toISOString(),
      },
    };

    const dateStr = new Date().toISOString().split('T')[0];

    if (format === 'markdown') {
      let md = `# Commentary Export\n\n`;
      md += `**Workspace:** ${metadata.workspaceName}\n\n`;
      md += `**Personality:** ${primaryPersonality.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())}\n\n`;
      md += `**Exported:** ${metadata.exportDate}\n\n`;
      md += `**Time Range:** ${new Date(minTime).toLocaleString()} — ${new Date(maxTime).toLocaleString()}\n\n`;
      md += `**Total Entries:** ${metadata.totalEntries}\n\n`;
      md += `---\n\n`;
      md += `## Commentary Timeline\n\n`;

      for (const entry of entries) {
        const time = new Date(entry.timestamp).toLocaleString();
        const personality = entry.personality
          .replace(/_/g, ' ')
          .replace(/\b\w/g, (l: string) => l.toUpperCase());
        md += `### ${time}\n`;
        md += `**Personality:** ${personality}\n\n`;
        md += `> ${entry.text}\n\n`;
      }

      return new Response(md, {
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': `attachment; filename="commentary-${dateStr}.md"`,
        },
      });
    }

    // JSON format (default)
    const exportData = { metadata, entries };

    return new Response(JSON.stringify(exportData, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="commentary-${dateStr}.json"`,
      },
    });
  } catch (err) {
    console.error('[commentary] Failed to export history:', err);
    return c.json({ ok: false, error: 'Failed to export commentary history' }, 500);
  }
});

// ---------------------------------------------------------------------------
// SSE Commentary Stream
// ---------------------------------------------------------------------------

app.get('/:workspaceId', (c) => {
  const workspaceId = c.req.param('workspaceId');

  const commentarySettings = getWorkspaceCommentarySettings(workspaceId);

  const rawPersonality = c.req.query('personality');
  let personality: CommentaryPersonality;
  if (rawPersonality && VALID_PERSONALITIES.includes(rawPersonality as CommentaryPersonality)) {
    personality = rawPersonality as CommentaryPersonality;
  } else {
    personality =
      commentarySettings.personality ??
      getUserPreferredPersonality() ??
      DEFAULT_COMMENTARY_SETTINGS.personality;
  }

  const conversationId = c.req.query('conversationId') || undefined;

  let refsAcquired = false;

  if (commentarySettings.enabled) {
    // Pass verbosity from workspace settings to the commentator
    commentatorService.startCommentary(
      workspaceId,
      personality,
      conversationId,
      commentarySettings.verbosity,
    );
    commentatorService.acquireRef(workspaceId);
    eventBridge.subscribe(workspaceId);
    refsAcquired = true;
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const handler = (commentary: StreamCommentary) => {
        if (commentary.workspaceId === workspaceId) {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(commentary)}\n\n`));
          } catch {
            /* client disconnected */
          }
        }
      };

      commentatorService.events.on('commentary', handler);

      const pingInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`data: {"type":"ping"}\n\n`));
        } catch {
          clearInterval(pingInterval);
        }
      }, 15000);

      c.req.raw.signal.addEventListener('abort', () => {
        commentatorService.events.off('commentary', handler);
        clearInterval(pingInterval);

        if (refsAcquired) {
          eventBridge.unsubscribe(workspaceId);
          const remainingRefs = commentatorService.releaseRef(workspaceId);

          if (remainingRefs === 0) {
            commentatorService.stopCommentary(workspaceId);
          }
        }

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

export { app as commentaryRoutes };
