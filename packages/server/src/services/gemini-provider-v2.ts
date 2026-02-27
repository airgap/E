/**
 * Google Gemini provider V2 - streaming generateContent with tool calling
 *
 * Supports gemini-2.0-flash, gemini-2.0-flash-lite, gemini-1.5-pro,
 * gemini-1.5-flash, etc.
 *
 * Gemini uses a different message format from OpenAI/Anthropic:
 *  - Messages are `contents` with `parts` (not `messages` with `content`)
 *  - Roles are `user` / `model` (not `user` / `assistant`)
 *  - Tools are `functionDeclarations` inside a `tools` array
 *  - Tool calls come back as `functionCall` parts
 *  - Tool results go back as `functionResponse` parts with role `user`
 */

import { nanoid } from 'nanoid';
import { getDb } from '../db/database';
import { getAllToolsWithMcp, type ToolSchema } from './tool-schemas';
import { executeTool } from './tool-executor';
import { loadConversationHistory, getRecommendedOptions } from './chat-compaction';
import { extractFilePath, extractEditLineHint } from '@e/shared';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

function getGeminiKey(): string | null {
  if (process.env.GOOGLE_API_KEY) return process.env.GOOGLE_API_KEY;
  try {
    const db = getDb();
    const row = db.query("SELECT value FROM settings WHERE key = 'googleApiKey'").get() as any;
    if (row) return JSON.parse(row.value) || null;
  } catch {}
  return null;
}

/**
 * Convert our ToolSchema[] to Gemini's functionDeclarations format.
 * Gemini uses JSON Schema for parameters but without the wrapper type:'object' wrapper
 * on the top level — it wants the properties directly inside `parameters`.
 */
function toGeminiFunctionDeclarations(tools: ToolSchema[]) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: {
      type: 'object',
      properties: tool.input_schema.properties,
      required: tool.input_schema.required || [],
    },
  }));
}

export interface GeminiStreamOptions {
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

export function createGeminiStreamV2(opts: GeminiStreamOptions): ReadableStream {
  const encoder = new TextEncoder();
  const messageId = nanoid();

  return new ReadableStream({
    async start(controller) {
      const apiKey = getGeminiKey();
      if (!apiKey) {
        controller.enqueue(
          encoder.encode(
            `data: {"type":"error","error":{"type":"auth_error","message":"Google API key not configured. Add it in Settings → Security."}}\n\n`,
          ),
        );
        controller.enqueue(encoder.encode(`data: {"type":"message_stop"}\n\n`));
        controller.close();
        return;
      }

      // Gemini `contents` array — alternating user/model turns
      const contents: Array<{ role: string; parts: any[] }> = [];

      try {
        const compactionOptions = getRecommendedOptions(`gemini:${opts.model}`);
        const history = loadConversationHistory(opts.conversationId, compactionOptions);

        if (history.compacted) {
          console.log(
            `[gemini-v2] Compacted conversation: ${history.originalCount} → ${history.compactedCount} messages, removed ~${history.tokensRemoved} tokens`,
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

        for (const msg of history.messages) {
          // Gemini roles: 'user' | 'model'
          const role = msg.role === 'assistant' ? 'model' : 'user';
          let text = '';
          if (Array.isArray(msg.content)) {
            text = msg.content
              .filter((b: any) => b.type === 'text')
              .map((b: any) => b.text)
              .join('\n');
          } else {
            text = String(msg.content);
          }
          if (text) contents.push({ role, parts: [{ text }] });
        }
      } catch (e) {
        console.error('[gemini-v2] Failed to load conversation history:', e);
      }

      // Build current user message (with optional images)
      const userParts: any[] = [{ text: opts.content }];
      if (opts.images && opts.images.length > 0) {
        for (const img of opts.images) {
          userParts.push({ inlineData: { mimeType: img.mediaType, data: img.data } });
        }
      }
      contents.push({ role: 'user', parts: userParts });

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
        const tools = await getAllToolsWithMcp(opts.allowedTools, opts.disallowedTools);
        const functionDeclarations = toGeminiFunctionDeclarations(tools);

        while (maxIterations-- > 0) {
          const body: any = {
            contents,
            generationConfig: {
              temperature: 0.7,
            },
          };

          if (opts.systemPrompt) {
            body.systemInstruction = { parts: [{ text: opts.systemPrompt }] };
          }

          if (functionDeclarations.length > 0) {
            body.tools = [{ functionDeclarations }];
          }

          const url = `${GEMINI_API_BASE}/models/${opts.model}:streamGenerateContent?alt=sse&key=${apiKey}`;

          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });

          if (!res.ok) {
            const errText = await res.text().catch(() => res.statusText);
            throw new Error(`Gemini error ${res.status}: ${errText}`);
          }

          const reader = res.body!.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          const pendingFunctionCalls: Array<{
            name: string;
            args: Record<string, unknown>;
            callId: string;
          }> = [];

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const data = line.slice(6).trim();
              if (!data || data === '[DONE]') continue;

              try {
                const chunk = JSON.parse(data);

                // Token usage
                if (chunk.usageMetadata) {
                  promptTokens = chunk.usageMetadata.promptTokenCount || 0;
                  completionTokens = chunk.usageMetadata.candidatesTokenCount || 0;
                }

                const parts = chunk.candidates?.[0]?.content?.parts || [];
                for (const part of parts) {
                  // Text part
                  if (part.text) {
                    fullText += part.text;
                    controller.enqueue(
                      encoder.encode(
                        `data: ${JSON.stringify({
                          type: 'content_block_delta',
                          index: 0,
                          delta: { type: 'text_delta', text: part.text },
                        })}\n\n`,
                      ),
                    );
                  }

                  // Function call part
                  if (part.functionCall) {
                    pendingFunctionCalls.push({
                      name: part.functionCall.name,
                      args: part.functionCall.args || {},
                      callId: nanoid(),
                    });
                  }
                }
              } catch {
                /* skip unparseable */
              }
            }
          }

          // No function calls → done
          if (pendingFunctionCalls.length === 0) {
            break;
          }

          // Add the model's function-call turn to contents
          contents.push({
            role: 'model',
            parts: pendingFunctionCalls.map((fc) => ({
              functionCall: { name: fc.name, args: fc.args },
            })),
          });

          // Execute tools
          const functionResponseParts: any[] = [];
          for (const fc of pendingFunctionCalls) {
            const result = await executeTool(fc.name, fc.args, opts.workspacePath);

            functionResponseParts.push({
              functionResponse: {
                name: fc.name,
                response: { content: result.content },
              },
            });

            // Emit tool_result event for UI (including Follow Along hints)
            const gemFilePath = extractFilePath(fc.args) || undefined;
            let gemEditLine: number | undefined;
            if (gemFilePath && fc.name) {
              try {
                const { readFileSync } = await import('fs');
                const fContent = readFileSync(gemFilePath, 'utf-8');
                gemEditLine = extractEditLineHint(fc.name, fc.args, fContent);
              } catch {
                gemEditLine = extractEditLineHint(fc.name, fc.args);
              }
            }
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'tool_result',
                  toolCallId: fc.callId,
                  toolName: fc.name,
                  filePath: gemFilePath,
                  editLineHint: gemEditLine,
                  result: result.content,
                  isError: result.is_error,
                })}\n\n`,
              ),
            );
          }

          // Add function responses as user turn
          contents.push({ role: 'user', parts: functionResponseParts });
        }
      } catch (err) {
        const msg = String(err).replace(/"/g, '\\"');
        controller.enqueue(
          encoder.encode(
            `data: {"type":"error","error":{"type":"gemini_error","message":"${msg}"}}\n\n`,
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
        console.error('[gemini-v2] Failed to save assistant message:', e);
      }
    },
  });
}

export async function listGeminiModels(): Promise<Array<{ id: string; name: string }>> {
  const apiKey = getGeminiKey();
  if (!apiKey) return [];

  try {
    const res = await fetch(`${GEMINI_API_BASE}/models?key=${apiKey}`);
    if (!res.ok) return [];

    const data = (await res.json()) as any;
    // Filter to models that support generateContent
    const chatModels = (data.models || [])
      .filter((m: any) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m: any) => {
        // m.name is like "models/gemini-2.0-flash"
        const id = m.name.replace('models/', '');
        return { id, name: m.displayName || id };
      })
      .sort((a: any, b: any) => a.id.localeCompare(b.id));

    return chatModels;
  } catch {
    return [];
  }
}
