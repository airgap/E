import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { AgentKernel } from '../services/agent-kernel';
import { getDb } from '../db/database';
import { broadcastMessageUpdate } from './message-sync';

const app = new Hono();

const BASE_SYSTEM_PROMPT = `You are E, an expert AI coding assistant. Fulfill requests accurately and concisely. Use tools when needed.`;

app.post('/:conversationId', async (c) => {
  const conversationId = c.req.param('conversationId');
  const body = await c.req.json();
  const { content } = body;

  const db = getDb();
  const conv = db.query('SELECT * FROM conversations WHERE id = ?').get(conversationId) as any;
  if (!conv) return c.json({ ok: false, error: 'Conversation not found' }, 404);

  // Load prior messages BEFORE saving the new one so we get a clean history
  const priorMessages = db
    .query(
      `SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC LIMIT 100`,
    )
    .all(conversationId) as { role: string; content: string }[];

  // 1. Save user message
  const userMsgId = nanoid();
  db.query(
    `INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, 'user', ?, ?)`,
  ).run(userMsgId, conversationId, JSON.stringify([{ type: 'text', text: content }]), Date.now());
  broadcastMessageUpdate(conversationId, userMsgId, 'user');

  // 2. Determine provider configuration
  const cliProviderRow = db
    .query("SELECT value FROM settings WHERE key = 'cliProvider'")
    .get() as any;
  const cliProvider = cliProviderRow ? JSON.parse(cliProviderRow.value) : 'claude';
  const useExternalCli =
    cliProvider === 'claude' && !conv.model?.includes('gemini') && !conv.model?.includes('bedrock');

  const kernel = new AgentKernel({
    sessionId: conversationId,
    workspacePath: conv.workspace_path,
    useExternalCli,
    yolo: false,
  });

  const assistantMsgId = nanoid();
  let fullAssistantText = '';

  const sseStream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (type: string, data: any) => {
        controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      // 3. Emit sequence required by Svelte 5 GUI
      send('message_start', {
        type: 'message_start',
        message: { id: assistantMsgId, role: 'assistant', content: [] },
      });

      send('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      });

      kernel.on('event', (ev) => {
        if (ev.type === 'thinking') {
          // Send as thinking delta if supported, otherwise just update text
          send('content_block_delta', {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'thinking_delta', thinking: ev.data?.message || 'Thinking...' },
          });
        } else if (ev.type === 'text') {
          fullAssistantText += ev.data.text;
          send('content_block_delta', {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: ev.data.text },
          });
        } else if (ev.type === 'tool_call') {
          send('content_block_stop', {
            type: 'content_block_stop',
            index: 0,
            content_block: ev.data.tool,
          });
        } else if (ev.type === 'tool_result') {
          send('tool_result', ev.data);
        } else if (ev.type === 'stop') {
          try {
            db.query(
              `INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, 'assistant', ?, ?)`,
            ).run(
              assistantMsgId,
              conversationId,
              JSON.stringify([{ type: 'text', text: fullAssistantText }]),
              Date.now(),
            );
            db.query('UPDATE conversations SET updated_at = ? WHERE id = ?').run(
              Date.now(),
              conversationId,
            );
            broadcastMessageUpdate(conversationId, assistantMsgId, 'assistant');
          } catch (e) {
            console.error('[stream] DB Error:', e);
          }

          send('message_stop', { type: 'message_stop', usage: ev.data.usage });
          controller.close();
        } else if (ev.type === 'error') {
          send('error', { message: ev.data.message });
          controller.close();
        }
      });

      // Build history-aware prompt so follow-up messages have full context.
      // This is necessary because the kernel is stateless — each call starts fresh.
      let promptWithHistory = content;
      if (priorMessages.length > 0) {
        const lines: string[] = ['<conversation_history>'];
        for (const msg of priorMessages) {
          let text = '';
          try {
            const blocks = JSON.parse(msg.content) as Array<{ type: string; text?: string }>;
            text = blocks
              .filter((b) => b.type === 'text')
              .map((b) => b.text ?? '')
              .join('');
          } catch {
            text = msg.content;
          }
          // Truncate individual messages to keep prompt manageable
          const role = msg.role === 'user' ? 'User' : 'Assistant';
          lines.push(`${role}: ${text.length > 4000 ? text.slice(0, 4000) + '…' : text}`);
        }
        lines.push('</conversation_history>');
        lines.push('');
        lines.push(content);
        promptWithHistory = lines.join('\n');
      }

      try {
        await kernel.run(promptWithHistory, conv.model, conv.system_prompt || BASE_SYSTEM_PROMPT);
      } catch (err: any) {
        send('error', { message: err.message });
        controller.close();
      }
    },
  });

  return new Response(sseStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Session-Id': conversationId,
    },
  });
});

// Cancel active generation
app.post('/:conversationId/cancel', (c) => {
  return c.json({ ok: true });
});

// List active sessions (kernel-based; no persistent sessions)
app.get('/sessions', (c) => {
  return c.json({ ok: true, data: [] });
});

export { app as streamRoutes };
