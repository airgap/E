import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { getDb } from '../db/database';
import { getConversationCanvases } from '../services/tool-executor';

const app = new Hono();

/**
 * GET /api/canvas/item/:canvasId — fetch a single canvas by its ID
 */
app.get('/item/:canvasId', (c) => {
  const canvasId = c.req.param('canvasId');
  const db = getDb();
  const row = db.query('SELECT * FROM canvases WHERE id = ?').get(canvasId) as any;
  if (!row) {
    return c.json({ ok: false, error: 'Canvas not found' }, 404);
  }
  return c.json({
    ok: true,
    data: {
      id: row.id,
      conversationId: row.conversation_id,
      contentType: row.content_type,
      content: row.content,
      title: row.title,
      lastUpdated: row.updated_at,
    },
  });
});

/**
 * GET /api/canvas/:conversationId — list all canvases for a conversation
 */
app.get('/:conversationId', (c) => {
  const conversationId = c.req.param('conversationId');
  const canvases = getConversationCanvases(conversationId);
  return c.json({ ok: true, data: canvases });
});

/**
 * POST /api/canvas — push content to canvas directly (no agent required)
 *
 * Body: { content_type, content, title?, canvas_id?, conversation_id }
 * Returns the canvas data including a canvas_update event payload.
 */
app.post('/', async (c) => {
  const body = await c.req.json();
  const contentType = body.content_type as 'html' | 'svg' | 'mermaid' | 'table';
  const content = body.content as string;
  const title = body.title as string | undefined;
  const canvasId = body.canvas_id as string | undefined;
  const conversationId = body.conversation_id as string | undefined;

  // Validate
  if (!contentType || !['html', 'svg', 'mermaid', 'table'].includes(contentType)) {
    return c.json(
      {
        ok: false,
        error: `Invalid content_type: ${contentType}. Must be html, svg, mermaid, or table`,
      },
      400,
    );
  }
  if (!content) {
    return c.json({ ok: false, error: 'content is required' }, 400);
  }
  if (contentType === 'table') {
    try {
      JSON.parse(content);
    } catch {
      return c.json({ ok: false, error: 'Table content must be valid JSON array' }, 400);
    }
  }

  const id = canvasId || nanoid(12);
  const now = Date.now();

  // Upsert into database
  const db = getDb();
  const existing = db.query('SELECT id FROM canvases WHERE id = ?').get(id) as any;
  if (existing) {
    db.query(
      'UPDATE canvases SET content_type = ?, content = ?, title = ?, conversation_id = COALESCE(?, conversation_id), updated_at = ? WHERE id = ?',
    ).run(contentType, content, title || null, conversationId || null, now, id);
  } else {
    db.query(
      'INSERT INTO canvases (id, conversation_id, content_type, content, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(id, conversationId || null, contentType, content, title || null, now, now);
  }

  const canvasData = {
    id,
    contentType,
    content,
    title,
    conversationId,
    lastUpdated: now,
  };

  return c.json({
    ok: true,
    data: canvasData,
    // Include the SSE event shape so clients can inject directly into canvasStore
    canvasEvent: {
      type: 'canvas_update',
      canvasId: id,
      contentType,
      content,
      title,
      conversationId: conversationId || '',
    },
  });
});

export { app as canvasRoutes };
