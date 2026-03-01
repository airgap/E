#!/usr/bin/env bun
/**
 * E CLI — First-party CLI provider for the E Agent Platform.
 *
 * This CLI implements the same streaming JSON protocol used by Claude Code,
 * allowing it to be used as a drop-in "CLI Provider" for the E GUI while
 * providing multi-model support (Google Gemini, Anthropic Claude) via direct APIs.
 *
 * Protocol (JSONL on stdout):
 *   {"type":"system","subtype":"init","model":"..."}
 *   {"type":"assistant","message":{"id":"...","role":"assistant","content":[...]}}
 *   {"type":"result","subtype":"success","stop_reason":"end_turn","usage":{...}}
 */

import { parseArgs } from 'util';
import { nanoid } from 'nanoid';
import { createGeminiStreamV2 } from '../services/gemini-provider-v2';
import { createBedrockStream } from '../services/bedrock-provider';
import { executeTool } from '../services/tool-executor';

// --- CLI Args Parsing ---
const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    prompt: { type: 'string', short: 'p' },
    model: { type: 'string' },
    'system-prompt': { type: 'string' },
    'output-format': { type: 'string', default: 'stream-json' },
    resume: { type: 'string', short: 'r' },
    'mcp-config': { type: 'string' },
    yolo: { type: 'boolean', default: false },
    sandbox: { type: 'string', default: 'on' },
  },
  strict: false,
});

const prompt = String(values.prompt || positionals.join(' '));
const model = String(values.model || 'gemini:gemini-2.0-flash'); // Default to Google's free tier
const systemPrompt = String(
  values['system-prompt'] || 'You are E, an autonomous AI coding assistant.',
);
const outputFormat = String(values['output-format']);
const sessionId = String(values.resume || nanoid());

if (!prompt) {
  console.error('Usage: e-cli -p "your prompt" [--model model] [--system-prompt text]');
  process.exit(1);
}

// --- Protocol Helpers ---
function emit(event: any) {
  if (outputFormat === 'stream-json') {
    process.stdout.write(JSON.stringify(event) + '\n');
  } else {
    // Human-readable fallback
    if (event.type === 'assistant' && event.message?.content) {
      for (const block of event.message.content) {
        if (block.type === 'text') process.stdout.write(block.text);
        if (block.type === 'tool_use') process.stdout.write(`\n[Tool: ${block.name}]\n`);
      }
    }
  }
}

// --- Main Execution ---
async function main() {
  emit({ type: 'system', subtype: 'init', model, sessionId });

  const isGemini = model.startsWith('gemini:');
  const isClaude = model.startsWith('claude:') || model.startsWith('bedrock:');

  const streamOpts: any = {
    conversationId: sessionId,
    model: model.split(':').pop() || model,
    systemPrompt,
    allowedTools: [], // All tools allowed by default in CLI
    disallowedTools: [],
    // Direct prompts for one-shot or starting a session
    messages: [{ role: 'user', content: prompt }],
  };

  try {
    let stream: ReadableStream;
    if (isGemini) {
      // Note: Gemini provider handles its own history loading via conversationId
      stream = createGeminiStreamV2({
        ...streamOpts,
        prompt, // Gemini provider often expects the raw current prompt
      });
    } else if (isClaude) {
      stream = createBedrockStream({
        model: streamOpts.model,
        content: prompt,
        conversationId: sessionId,
        systemPrompt,
      });
    } else {
      throw new Error(`Unsupported model prefix: ${model}`);
    }

    // Process the stream
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let currentAssistantMessage: any = {
      id: nanoid(),
      role: 'assistant',
      content: [],
    };

    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;

        const dataStr = line.slice(6).trim();
        if (!dataStr) continue;

        try {
          const data = JSON.parse(dataStr);

          if (data.type === 'content_block_delta') {
            if (data.delta.type === 'text_delta') {
              const text = data.delta.text;
              emit({
                type: 'assistant',
                message: {
                  ...currentAssistantMessage,
                  content: [{ type: 'text', text }],
                },
              });
            }
          }

          if (data.type === 'message_stop') {
            emit({
              type: 'result',
              subtype: 'success',
              stop_reason: 'end_turn',
              usage: data.usage || { input_tokens: 0, output_tokens: 0 },
            });
          }

          // Handle tool calls (important for agentic behavior)
          if (data.type === 'content_block_stop' && data.content_block?.type === 'tool_use') {
            const tool = data.content_block;
            emit({
              type: 'assistant',
              message: {
                ...currentAssistantMessage,
                content: [tool],
              },
            });

            // First-party CLI executes tools immediately
            const result = await executeTool(tool.name, tool.input, process.cwd());
            emit({
              type: 'tool_result',
              tool_use_id: tool.id,
              content: result.content,
              is_error: result.is_error,
            });
          }
        } catch (parseErr) {
          // If JSON is incomplete, put it back in buffer and wait for more
          buffer = line + '\n' + buffer;
          break;
        }
      }
    }
  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(1);
  }
}

main();
