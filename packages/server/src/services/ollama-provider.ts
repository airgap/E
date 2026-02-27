/**
 * Ollama provider — streams chat completions from a local Ollama instance
 * and translates them into the same SSE event format as claude-process.ts.
 *
 * Ollama API: POST http://localhost:11434/api/chat
 */

import { nanoid } from 'nanoid';
import { getDb } from '../db/database';

const DEFAULT_OLLAMA_BASE = 'http://localhost:11434';

function getOllamaBase(): string {
  return process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE;
}

export async function listOllamaModels(): Promise<
  Array<{ name: string; size: number; modified_at: string }>
> {
  try {
    const res = await fetch(`${getOllamaBase()}/api/tags`);
    if (!res.ok) return [];
    const data = (await res.json()) as any;
    return (data.models || []).map((m: any) => ({
      name: m.name,
      size: m.size || 0,
      modified_at: m.modified_at || '',
    }));
  } catch {
    return [];
  }
}

export async function checkOllamaHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${getOllamaBase()}/api/tags`);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Send a message to Ollama and return a ReadableStream of SSE events
 * in the same format as claude-process.ts produces.
 */
export function createOllamaStream(opts: {
  model: string;
  content: string;
  conversationId: string;
  systemPrompt?: string;
}): ReadableStream {
  const encoder = new TextEncoder();
  const messageId = nanoid();

  return new ReadableStream({
    async start(controller) {
      const messages: Array<{ role: string; content: string }> = [];

      // Load conversation history from DB
      try {
        const db = getDb();
        const rows = db
          .query(
            'SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC',
          )
          .all(opts.conversationId) as any[];
        for (const row of rows) {
          try {
            const parsed = JSON.parse(row.content);
            // Extract text content from the structured format
            if (Array.isArray(parsed)) {
              const text = parsed
                .filter((b: any) => b.type === 'text')
                .map((b: any) => b.text)
                .join('\n');
              if (text) messages.push({ role: row.role, content: text });
            } else {
              messages.push({ role: row.role, content: String(parsed) });
            }
          } catch {
            messages.push({ role: row.role, content: row.content });
          }
        }
      } catch {
        /* fresh conversation */
      }

      if (opts.systemPrompt) {
        messages.unshift({ role: 'system', content: opts.systemPrompt });
      }
      messages.push({ role: 'user', content: opts.content });

      // Emit message_start
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            type: 'message_start',
            message: { id: messageId, role: 'assistant', model: opts.model },
          })}\n\n`,
        ),
      );

      // Emit content_block_start
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'text', text: '' },
          })}\n\n`,
        ),
      );

      let fullText = '';
      let promptTokens = 0;
      let completionTokens = 0;

      try {
        const res = await fetch(`${getOllamaBase()}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: opts.model,
            messages,
            stream: true,
          }),
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => res.statusText);
          throw new Error(`Ollama error ${res.status}: ${errText}`);
        }

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const chunk = JSON.parse(line);

              if (chunk.message?.content) {
                const text = chunk.message.content;
                fullText += text;
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: 'content_block_delta',
                      index: 0,
                      delta: { type: 'text_delta', text },
                    })}\n\n`,
                  ),
                );
              }

              // Ollama sends token counts in the final chunk
              if (chunk.done) {
                promptTokens = chunk.prompt_eval_count || 0;
                completionTokens = chunk.eval_count || 0;
              }
            } catch {
              /* skip unparseable */
            }
          }
        }
      } catch (err) {
        const msg = String(err).replace(/"/g, '\\"');
        controller.enqueue(
          encoder.encode(
            `data: {"type":"error","error":{"type":"ollama_error","message":"${msg}"}}\n\n`,
          ),
        );
        controller.close();
        return;
      }

      // content_block_stop
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`),
      );

      // message_delta with usage
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            type: 'message_delta',
            delta: { stop_reason: 'end_turn' },
            usage: {
              input_tokens: promptTokens,
              output_tokens: completionTokens,
            },
          })}\n\n`,
        ),
      );

      // message_stop
      controller.enqueue(encoder.encode(`data: {"type":"message_stop"}\n\n`));
      controller.close();

      // Persist assistant message to DB
      try {
        const db = getDb();
        const msgId = nanoid();
        db.query(
          `INSERT INTO messages (id, conversation_id, role, content, model, token_count, timestamp)
           VALUES (?, ?, 'assistant', ?, ?, ?, ?)`,
        ).run(
          msgId,
          opts.conversationId,
          JSON.stringify([{ type: 'text', text: fullText }]),
          opts.model,
          promptTokens + completionTokens,
          Date.now(),
        );
        db.query('UPDATE conversations SET updated_at = ? WHERE id = ?').run(
          Date.now(),
          opts.conversationId,
        );
      } catch (e) {
        console.error('[ollama] Failed to save assistant message:', e);
      }
    },
  });
}
