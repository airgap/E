/**
 * AWS Bedrock provider — streams chat completions from AWS Bedrock Claude models
 * and translates them into the same SSE event format as claude-process.ts.
 *
 * Bedrock API: Uses @aws-sdk/client-bedrock-runtime
 */

import { nanoid } from 'nanoid';
import { getDb } from '../db/database';
import {
  BedrockRuntimeClient,
  InvokeModelWithResponseStreamCommand,
} from '@aws-sdk/client-bedrock-runtime';

const DEFAULT_REGION = 'us-east-1';

function getBedrockClient(): BedrockRuntimeClient {
  const region = process.env.AWS_REGION || DEFAULT_REGION;
  return new BedrockRuntimeClient({ region });
}

/**
 * Map user-friendly model names to Bedrock model IDs
 */
function getBedrockModelId(model: string): string {
  const modelMap: Record<string, string> = {
    'claude-opus-4': 'anthropic.claude-3-opus-20240229-v1:0',
    'claude-sonnet-4': 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    'claude-sonnet-3.5': 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    'claude-haiku-3': 'anthropic.claude-3-haiku-20240307-v1:0',
  };

  // If already a full model ID, return as-is
  if (model.startsWith('anthropic.claude-')) {
    return model;
  }

  // Otherwise map or default to Sonnet 3.5
  return modelMap[model] || 'anthropic.claude-3-5-sonnet-20241022-v2:0';
}

export async function listBedrockModels(): Promise<Array<{ name: string; id: string }>> {
  return [
    { name: 'Claude Opus 3', id: 'claude-opus-4' },
    { name: 'Claude Sonnet 3.5', id: 'claude-sonnet-3.5' },
    { name: 'Claude Haiku 3', id: 'claude-haiku-3' },
  ];
}

export async function checkBedrockHealth(): Promise<boolean> {
  try {
    // Simple health check - try to create a client
    const client = getBedrockClient();
    return !!client;
  } catch {
    return false;
  }
}

/**
 * Send a message to AWS Bedrock and return a ReadableStream of SSE events
 * in the same format as claude-process.ts produces.
 */
export function createBedrockStream(opts: {
  model: string;
  content: string;
  conversationId: string;
  systemPrompt?: string;
}): ReadableStream {
  const encoder = new TextEncoder();
  const messageId = nanoid();

  return new ReadableStream({
    async start(controller) {
      const messages: Array<{ role: string; content: Array<{ type: string; text: string }> }> = [];

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
              if (text) {
                messages.push({
                  role: row.role === 'user' ? 'user' : 'assistant',
                  content: [{ type: 'text', text }],
                });
              }
            } else {
              messages.push({
                role: row.role === 'user' ? 'user' : 'assistant',
                content: [{ type: 'text', text: String(parsed) }],
              });
            }
          } catch {
            messages.push({
              role: row.role === 'user' ? 'user' : 'assistant',
              content: [{ type: 'text', text: row.content }],
            });
          }
        }
      } catch {
        /* fresh conversation */
      }

      // Add current user message
      messages.push({
        role: 'user',
        content: [{ type: 'text', text: opts.content }],
      });

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
      let inputTokens = 0;
      let outputTokens = 0;

      try {
        const client = getBedrockClient();
        const modelId = getBedrockModelId(opts.model);

        // Prepare the payload for Bedrock
        const payload: any = {
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 4096,
          messages,
        };

        // Add system prompt if provided
        if (opts.systemPrompt) {
          payload.system = opts.systemPrompt;
        }

        const command = new InvokeModelWithResponseStreamCommand({
          contentType: 'application/json',
          body: JSON.stringify(payload),
          modelId,
        });

        const apiResponse = await client.send(command);

        // Process the response stream
        for await (const item of apiResponse.body!) {
          if (!item.chunk?.bytes) continue;

          const chunk = JSON.parse(new TextDecoder().decode(item.chunk.bytes));

          // Handle different chunk types
          if (chunk.type === 'content_block_delta' && chunk.delta?.text) {
            const text = chunk.delta.text;
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
          } else if (chunk.type === 'message_start' && chunk.message?.usage) {
            inputTokens = chunk.message.usage.input_tokens || 0;
          } else if (chunk.type === 'message_delta' && chunk.usage) {
            outputTokens = chunk.usage.output_tokens || 0;
          }
        }
      } catch (err) {
        const msg = String(err).replace(/"/g, '\\"');
        console.error('[bedrock] Error:', err);
        controller.enqueue(
          encoder.encode(
            `data: {"type":"error","error":{"type":"bedrock_error","message":"${msg}"}}\n\n`,
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
              input_tokens: inputTokens,
              output_tokens: outputTokens,
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
          inputTokens + outputTokens,
          Date.now(),
        );
        db.query('UPDATE conversations SET updated_at = ? WHERE id = ?').run(
          Date.now(),
          opts.conversationId,
        );
      } catch (e) {
        console.error('[bedrock] Failed to save assistant message:', e);
      }
    },
  });
}
