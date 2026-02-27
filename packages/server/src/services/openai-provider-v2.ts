/**
 * OpenAI provider V2 - streaming chat completions with tool calling
 *
 * Supports GPT-4o, GPT-4o-mini, GPT-4-turbo, o1, o3-mini, etc.
 * Uses the OpenAI Chat Completions API with SSE streaming.
 */

import { nanoid } from 'nanoid';
import { getDb } from '../db/database';
import { getAllToolsWithMcp, toOllamaFunctions } from './tool-schemas';
import { executeTool } from './tool-executor';
import { loadConversationHistory, getRecommendedOptions } from './chat-compaction';
import { extractFilePath, extractEditLineHint } from '@e/shared';

const OPENAI_API_BASE = 'https://api.openai.com/v1';

function getOpenAIKey(): string | null {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  try {
    const db = getDb();
    const row = db.query("SELECT value FROM settings WHERE key = 'openaiApiKey'").get() as any;
    if (row) return JSON.parse(row.value) || null;
  } catch {}
  return null;
}

// Models known to support tool/function calling
const TOOL_CAPABLE_MODELS = ['gpt-4', 'gpt-4o', 'gpt-3.5-turbo', 'o1', 'o3'];

function supportsTools(modelName: string): boolean {
  return TOOL_CAPABLE_MODELS.some((m) => modelName.includes(m));
}

export interface OpenAIStreamOptions {
  model: string;
  content: string;
  conversationId: string;
  systemPrompt?: string;
  workspacePath?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  images?: Array<{
    mediaType: string;
    data: string; // base64
  }>;
}

export function createOpenAIStreamV2(opts: OpenAIStreamOptions): ReadableStream {
  const encoder = new TextEncoder();
  const messageId = nanoid();

  return new ReadableStream({
    async start(controller) {
      const apiKey = getOpenAIKey();
      if (!apiKey) {
        controller.enqueue(
          encoder.encode(
            `data: {"type":"error","error":{"type":"auth_error","message":"OpenAI API key not configured. Add it in Settings → Security."}}\n\n`,
          ),
        );
        controller.enqueue(encoder.encode(`data: {"type":"message_stop"}\n\n`));
        controller.close();
        return;
      }

      // Build messages array from conversation history
      const messages: Array<{ role: string; content: any }> = [];

      try {
        const compactionOptions = getRecommendedOptions(`openai:${opts.model}`);
        const history = loadConversationHistory(opts.conversationId, compactionOptions);

        if (history.compacted) {
          console.log(
            `[openai-v2] Compacted conversation: ${history.originalCount} → ${history.compactedCount} messages, removed ~${history.tokensRemoved} tokens`,
          );
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: 'compaction_info',
                original_count: history.originalCount,
                compacted_count: history.compactedCount,
                tokens_removed: history.tokensRemoved,
                summary: history.summary,
              })}\n\n`,
            ),
          );
        }

        // Convert to OpenAI message format
        for (const msg of history.messages) {
          // Map 'assistant' role; OpenAI uses 'assistant' not 'model'
          const role = msg.role === 'assistant' ? 'assistant' : 'user';
          if (Array.isArray(msg.content)) {
            const text = msg.content
              .filter((b: any) => b.type === 'text')
              .map((b: any) => b.text)
              .join('\n');
            if (text) messages.push({ role, content: text });
          } else {
            messages.push({ role, content: String(msg.content) });
          }
        }
      } catch (e) {
        console.error('[openai-v2] Failed to load conversation history:', e);
      }

      // Build current user message (with optional images)
      let userContent: any = opts.content;
      if (opts.images && opts.images.length > 0) {
        userContent = [
          { type: 'text', text: opts.content },
          ...opts.images.map((img) => ({
            type: 'image_url',
            image_url: { url: `data:${img.mediaType};base64,${img.data}` },
          })),
        ];
      }
      messages.push({ role: 'user', content: userContent });

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
      let maxIterations = 10;

      try {
        const useTools = supportsTools(opts.model);
        const tools = useTools
          ? await getAllToolsWithMcp(opts.allowedTools, opts.disallowedTools)
          : [];

        // Main agentic loop
        while (maxIterations-- > 0) {
          const body: any = {
            model: opts.model,
            messages,
            stream: true,
            stream_options: { include_usage: true },
          };

          if (opts.systemPrompt) {
            body.messages = [{ role: 'system', content: opts.systemPrompt }, ...body.messages];
          }

          if (tools.length > 0) {
            // OpenAI uses the same function format as Ollama
            body.tools = toOllamaFunctions(tools);
            body.tool_choice = 'auto';
          }

          const res = await fetch(`${OPENAI_API_BASE}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
          });

          if (!res.ok) {
            const errText = await res.text().catch(() => res.statusText);
            throw new Error(`OpenAI error ${res.status}: ${errText}`);
          }

          const reader = res.body!.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          // Accumulate streamed tool call fragments
          const toolCallAccum: Record<number, { id: string; name: string; arguments: string }> = {};
          let finishReason: string | null = null;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const data = line.slice(6).trim();
              if (data === '[DONE]') continue;

              try {
                const chunk = JSON.parse(data);

                // Usage is in the final chunk when stream_options.include_usage is set
                if (chunk.usage) {
                  promptTokens = chunk.usage.prompt_tokens || 0;
                  completionTokens = chunk.usage.completion_tokens || 0;
                }

                const delta = chunk.choices?.[0]?.delta;
                if (!delta) continue;

                finishReason = chunk.choices?.[0]?.finish_reason || finishReason;

                // Text content
                if (delta.content) {
                  fullText += delta.content;
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({
                        type: 'content_block_delta',
                        index: 0,
                        delta: { type: 'text_delta', text: delta.content },
                      })}\n\n`,
                    ),
                  );
                }

                // Tool call fragments — accumulate across chunks
                if (delta.tool_calls) {
                  for (const tc of delta.tool_calls) {
                    const idx = tc.index ?? 0;
                    if (!toolCallAccum[idx]) {
                      toolCallAccum[idx] = { id: tc.id || '', name: '', arguments: '' };
                    }
                    if (tc.id) toolCallAccum[idx].id = tc.id;
                    if (tc.function?.name) toolCallAccum[idx].name += tc.function.name;
                    if (tc.function?.arguments)
                      toolCallAccum[idx].arguments += tc.function.arguments;
                  }
                }
              } catch {
                /* skip unparseable chunks */
              }
            }
          }

          const toolCalls = Object.values(toolCallAccum);

          // No tool calls → done
          if (toolCalls.length === 0 || finishReason === 'stop') {
            break;
          }

          // Add the assistant's tool-call message to history
          messages.push({
            role: 'assistant',
            content: null,
            // @ts-ignore — tool_calls field required by OpenAI
            tool_calls: toolCalls.map((tc) => ({
              id: tc.id || nanoid(),
              type: 'function',
              function: { name: tc.name, arguments: tc.arguments },
            })),
          } as any);

          // Execute tools and collect results
          const toolResultMessages: any[] = [];
          for (const tc of toolCalls) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(tc.arguments || '{}');
            } catch {}

            const result = await executeTool(tc.name, args, opts.workspacePath);

            toolResultMessages.push({
              role: 'tool',
              tool_call_id: tc.id || nanoid(),
              content: result.content,
            });

            // Emit tool_result event for UI (including Follow Along hints)
            const oaiFilePath = extractFilePath(args) || undefined;
            let oaiEditLine: number | undefined;
            if (oaiFilePath && tc.name) {
              try {
                const { readFileSync } = await import('fs');
                const fc = readFileSync(oaiFilePath, 'utf-8');
                oaiEditLine = extractEditLineHint(tc.name, args, fc);
              } catch {
                oaiEditLine = extractEditLineHint(tc.name, args);
              }
            }
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'tool_result',
                  toolCallId: tc.id || nanoid(),
                  toolName: tc.name,
                  filePath: oaiFilePath,
                  editLineHint: oaiEditLine,
                  result: result.content,
                  isError: result.is_error,
                })}\n\n`,
              ),
            );
          }

          messages.push(...toolResultMessages);
        }
      } catch (err) {
        const msg = String(err).replace(/"/g, '\\"');
        controller.enqueue(
          encoder.encode(
            `data: {"type":"error","error":{"type":"openai_error","message":"${msg}"}}\n\n`,
          ),
        );
        controller.close();
        return;
      }

      // content_block_stop
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`),
      );

      // message_delta with token usage
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            type: 'message_delta',
            delta: { stop_reason: 'end_turn' },
            usage: { input_tokens: promptTokens, output_tokens: completionTokens },
          })}\n\n`,
        ),
      );

      // message_stop
      controller.enqueue(encoder.encode(`data: {"type":"message_stop"}\n\n`));
      controller.close();

      // Persist to DB
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
        console.error('[openai-v2] Failed to save assistant message:', e);
      }
    },
  });
}

export async function listOpenAIModels(): Promise<Array<{ id: string; name: string }>> {
  const apiKey = getOpenAIKey();
  if (!apiKey) return [];

  try {
    const res = await fetch(`${OPENAI_API_BASE}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return [];

    const data = (await res.json()) as any;
    // Filter to chat-capable models and sort by id
    const chatModels = (data.data || [])
      .filter((m: any) => {
        const id: string = m.id || '';
        return (
          id.startsWith('gpt-') ||
          id.startsWith('o1') ||
          id.startsWith('o3') ||
          id.startsWith('chatgpt')
        );
      })
      .sort((a: any, b: any) => b.id.localeCompare(a.id))
      .map((m: any) => ({ id: m.id, name: m.id }));

    return chatModels;
  } catch {
    return [];
  }
}
