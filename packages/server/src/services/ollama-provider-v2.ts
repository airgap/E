/**
 * Ollama provider V2 - with experimental tool calling and image support
 *
 * Note: Tool calling and vision support depends on the model.
 * Supported models: llama3.1, llama3.2-vision, qwen2.5, etc.
 */

import { nanoid } from 'nanoid';
import { getDb } from '../db/database';
import { getAllToolsWithMcp, toOllamaFunctions } from './tool-schemas';
import { executeTool } from './tool-executor';
import { recordToolUsage } from './pattern-detection';
import { loadConversationHistory, getRecommendedOptions } from './chat-compaction';
import { extractFilePath, extractEditLineHint } from '@e/shared';

const DEFAULT_OLLAMA_BASE = 'http://localhost:11434';

function getOllamaBase(): string {
  return process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE;
}

// Models known to support tool calling
const TOOL_CAPABLE_MODELS = ['llama3.1', 'llama3.2', 'qwen2.5', 'mistral', 'mixtral'];

// Models known to support vision
const VISION_CAPABLE_MODELS = ['llama3.2-vision', 'llava', 'bakllava'];

function supportsTools(modelName: string): boolean {
  return TOOL_CAPABLE_MODELS.some((m) => modelName.includes(m));
}

function supportsVision(modelName: string): boolean {
  return VISION_CAPABLE_MODELS.some((m) => modelName.includes(m));
}

export interface OllamaStreamOptions {
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

export function createOllamaStreamV2(opts: OllamaStreamOptions): ReadableStream {
  const encoder = new TextEncoder();
  const messageId = nanoid();

  return new ReadableStream({
    async start(controller) {
      const messages: Array<{ role: string; content: string; images?: string[] }> = [];

      // Load conversation history with compaction
      try {
        const compactionOptions = getRecommendedOptions(`ollama:${opts.model}`);
        const history = loadConversationHistory(opts.conversationId, compactionOptions);

        // Log compaction results if it occurred
        if (history.compacted) {
          console.log(
            `[ollama-v2] Compacted conversation: ${history.originalCount} → ${history.compactedCount} messages, removed ~${history.tokensRemoved} tokens`,
          );

          // Emit compaction event to client
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

        // Convert compacted messages to Ollama format
        for (const msg of history.messages) {
          if (Array.isArray(msg.content)) {
            const text = msg.content
              .filter((b: any) => b.type === 'text')
              .map((b: any) => b.text)
              .join('\n');
            if (text) messages.push({ role: msg.role, content: text });
          } else {
            messages.push({ role: msg.role, content: String(msg.content) });
          }
        }
      } catch (e) {
        console.error('[ollama-v2] Failed to load conversation history:', e);
      }

      // Build current message
      const currentMessage: any = {
        role: 'user',
        content: opts.content,
      };

      // Add images if model supports vision
      if (opts.images && opts.images.length > 0 && supportsVision(opts.model)) {
        currentMessage.images = opts.images.map((img) => img.data);
      } else if (opts.images && opts.images.length > 0) {
        console.warn(
          `[ollama] Model ${opts.model} does not support images. Images will be ignored.`,
        );
      }

      messages.push(currentMessage);

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
        // Check if model supports tool calling
        const useTools = supportsTools(opts.model);
        const tools = useTools
          ? await getAllToolsWithMcp(opts.allowedTools, opts.disallowedTools)
          : [];

        // Main conversation loop
        while (maxIterations-- > 0) {
          const body: any = {
            model: opts.model,
            messages,
            stream: true,
          };

          // Add system prompt
          if (opts.systemPrompt) {
            body.system = opts.systemPrompt;
          }

          // Add tools if supported
          if (tools.length > 0) {
            body.tools = toOllamaFunctions(tools);
          }

          const res = await fetch(`${getOllamaBase()}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });

          if (!res.ok) {
            const errText = await res.text().catch(() => res.statusText);
            throw new Error(`Ollama error ${res.status}: ${errText}`);
          }

          const reader = res.body!.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let toolCalls: any[] = [];

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

                // Handle text content
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

                // Handle tool calls
                if (chunk.message?.tool_calls) {
                  toolCalls.push(...chunk.message.tool_calls);
                }

                // Track tokens
                if (chunk.done) {
                  promptTokens = chunk.prompt_eval_count || 0;
                  completionTokens = chunk.eval_count || 0;
                }
              } catch {
                /* skip unparseable */
              }
            }
          }

          // If no tool calls, we're done
          if (toolCalls.length === 0) {
            break;
          }

          // Execute tools
          const toolResults: any[] = [];
          for (const toolCall of toolCalls) {
            const result = await executeTool(
              toolCall.function.name,
              toolCall.function.arguments,
              opts.workspacePath,
            );

            // Record tool usage for pattern detection
            recordToolUsage(
              opts.conversationId,
              toolCall.function.name,
              toolCall.function.arguments,
              opts.workspacePath,
            );

            toolResults.push({
              role: 'tool',
              content: result.content,
            });

            // Emit tool result event (use camelCase to match StreamToolResult)
            const ollamaArgs = toolCall.function.arguments;
            const ollamaFilePath = extractFilePath(ollamaArgs) || undefined;
            let ollamaEditLine: number | undefined;
            if (ollamaFilePath && toolCall.function.name) {
              try {
                const { readFileSync } = await import('fs');
                const fc = readFileSync(ollamaFilePath, 'utf-8');
                ollamaEditLine = extractEditLineHint(toolCall.function.name, ollamaArgs, fc);
              } catch {
                ollamaEditLine = extractEditLineHint(toolCall.function.name, ollamaArgs);
              }
            }
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'tool_result',
                  toolCallId: toolCall.id || nanoid(),
                  toolName: toolCall.function.name,
                  filePath: ollamaFilePath,
                  editLineHint: ollamaEditLine,
                  result: result.content,
                  isError: result.is_error,
                })}\n\n`,
              ),
            );
          }

          // Add tool results to messages
          if (toolResults.length > 0) {
            messages.push(...toolResults);
          } else {
            break;
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
        console.error('[ollama-v2] Failed to save assistant message:', e);
      }
    },
  });
}

export async function listOllamaModels(): Promise<
  Array<{
    name: string;
    size: number;
    modified_at: string;
    supports_tools?: boolean;
    supports_vision?: boolean;
  }>
> {
  try {
    const res = await fetch(`${getOllamaBase()}/api/tags`);
    if (!res.ok) return [];
    const data = (await res.json()) as any;
    return (data.models || []).map((m: any) => ({
      name: m.name,
      size: m.size || 0,
      modified_at: m.modified_at || '',
      supports_tools: supportsTools(m.name),
      supports_vision: supportsVision(m.name),
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
