import { nanoid } from 'nanoid';
import { getDb } from '../../db/database';

export interface TranslateOptions {
  /**
   * Whether the CLI is being run with `--include-partial-messages`. When true:
   *   - `stream_event` envelopes are unwrapped and the inner event is emitted
   *     (they're already in Anthropic SSE format).
   *   - The redundant `assistant` aggregation event is SKIPPED — its content
   *     was already streamed incrementally via stream_event deltas.
   *   - `result` no longer emits a synthetic `message_stop` (stream_event
   *     already emitted one).
   * When false (default), behaves as before: aggregate `assistant` becomes a
   * single content_block_{start,delta,stop} burst per block, and `result`
   * emits both `message_delta` and `message_stop`.
   */
  partialMessages?: boolean;
}

/**
 * Translates Claude CLI stream-json events into Anthropic API-style SSE events.
 *
 * CLI format (relevant subset):
 *   {"type":"system","subtype":"init", ...}
 *   {"type":"system","subtype":"hook_started"|"hook_response", hook_name, ...}
 *   {"type":"stream_event","event":{"type":"...","..."}}      // --include-partial-messages
 *   {"type":"assistant","message":{"content":[...],"model":"...", ...}, ...}
 *   {"type":"result","subtype":"success","usage":{...}, ...}
 *
 * API format we produce (Anthropic streaming SSE):
 *   {"type":"message_start","message":{"id":"...","role":"assistant","model":"..."}}
 *   {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}
 *   {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"..."}}
 *   {"type":"content_block_stop","index":0}
 *   {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{...}}
 *   {"type":"message_stop"}
 *   {"type":"hook_event","subtype":"hook_started"|"hook_response", ...}   // --include-hook-events
 */
export function translateCliEvent(event: any, opts: TranslateOptions = {}): string[] {
  const events: string[] = [];
  const parentId = event.parent_tool_use_id || null;
  const partial = opts.partialMessages === true;

  switch (event.type) {
    case 'system': {
      // Hook lifecycle (when --include-hook-events is on): surface them so the
      // UI can render PreToolUse / PostToolUse / SessionStart / Stop etc.
      if (event.subtype === 'hook_started' || event.subtype === 'hook_response') {
        events.push(
          JSON.stringify({
            type: 'hook_event',
            subtype: event.subtype,
            hook_id: event.hook_id,
            hook_name: event.hook_name,
            hook_event: event.hook_event,
            outcome: event.outcome,
            exit_code: event.exit_code,
            session_id: event.session_id,
            parent_tool_use_id: parentId,
          }),
        );
      }
      // Init / status / others — nothing to emit (manager reads metadata).
      break;
    }

    case 'stream_event': {
      // The inner `event` IS the Anthropic streaming SSE payload — just pass
      // through. Carry parent_tool_use_id through for sub-agent contexts.
      const inner = event.event;
      if (inner && typeof inner === 'object') {
        events.push(JSON.stringify({ ...inner, parent_tool_use_id: parentId }));
      }
      break;
    }

    case 'assistant': {
      // With --include-partial-messages on, the assistant's content was already
      // streamed incrementally via stream_event content_block_delta events. The
      // aggregate `assistant` event is redundant; emitting it would double the
      // text in the client.
      if (partial) break;

      const msg = event.message;
      if (!msg) break;

      // Emit message_start
      events.push(
        JSON.stringify({
          type: 'message_start',
          message: {
            id: msg.id || nanoid(),
            role: 'assistant',
            model: msg.model || 'unknown',
          },
          parent_tool_use_id: parentId,
        }),
      );

      // Emit content blocks in their original order
      const content = msg.content || [];
      for (let i = 0; i < content.length; i++) {
        const block = content[i];

        if (block.type === 'text') {
          events.push(
            JSON.stringify({
              type: 'content_block_start',
              index: i,
              content_block: { type: 'text', text: '' },
              parent_tool_use_id: parentId,
            }),
          );
          events.push(
            JSON.stringify({
              type: 'content_block_delta',
              index: i,
              delta: { type: 'text_delta', text: block.text || '' },
              parent_tool_use_id: parentId,
            }),
          );
          events.push(
            JSON.stringify({
              type: 'content_block_stop',
              index: i,
              parent_tool_use_id: parentId,
            }),
          );
        } else if (block.type === 'thinking') {
          events.push(
            JSON.stringify({
              type: 'content_block_start',
              index: i,
              content_block: { type: 'thinking', thinking: '' },
              parent_tool_use_id: parentId,
            }),
          );
          events.push(
            JSON.stringify({
              type: 'content_block_delta',
              index: i,
              delta: { type: 'thinking_delta', thinking: block.thinking || '' },
              parent_tool_use_id: parentId,
            }),
          );
          events.push(
            JSON.stringify({
              type: 'content_block_stop',
              index: i,
              parent_tool_use_id: parentId,
            }),
          );
        } else if (block.type === 'tool_use') {
          events.push(
            JSON.stringify({
              type: 'content_block_start',
              index: i,
              content_block: {
                type: 'tool_use',
                id: block.id || nanoid(),
                name: block.name || 'unknown',
              },
              parent_tool_use_id: parentId,
            }),
          );
          events.push(
            JSON.stringify({
              type: 'content_block_delta',
              index: i,
              delta: {
                type: 'input_json_delta',
                partial_json: JSON.stringify(block.input || {}),
              },
              parent_tool_use_id: parentId,
            }),
          );
          events.push(
            JSON.stringify({
              type: 'content_block_stop',
              index: i,
              parent_tool_use_id: parentId,
            }),
          );
        }
      }
      break;
    }

    case 'result': {
      // Emit message_delta with usage info
      const usage = event.usage || {};
      events.push(
        JSON.stringify({
          type: 'message_delta',
          delta: { stop_reason: event.stop_reason || 'end_turn' },
          usage: {
            input_tokens: usage.input_tokens || 0,
            output_tokens: usage.output_tokens || 0,
            cache_creation_input_tokens: usage.cache_creation_input_tokens || 0,
            cache_read_input_tokens: usage.cache_read_input_tokens || 0,
          },
        }),
      );

      // Emit message_stop ONLY when partials are off — with --include-partial-
      // messages, stream_event has already emitted message_stop and emitting a
      // second one would confuse the client's turn-state tracking.
      if (!partial) {
        events.push(JSON.stringify({ type: 'message_stop' }));
      }
      break;
    }

    default:
      // Unknown event type — skip
      break;
  }

  return events;
}

/**
 * Parse and store <artifact> XML blocks from assistant message text content.
 * Returns an array of SSE event strings for each extracted artifact so the
 * client can update the Artifacts panel in real time.
 *
 * Supported format:
 * <artifact type="plan|diff|screenshot|walkthrough" title="...">
 * ...content...
 * </artifact>
 */
export function extractAndStoreArtifacts(
  conversationId: string,
  messageId: string,
  content: any[],
): string[] {
  const sseEvents: string[] = [];
  const db = getDb();

  const artifactRegex = /<artifact\s+type="([^"]+)"\s+title="([^"]+)">([\s\S]*?)<\/artifact>/gi;

  for (const block of content) {
    if (block.type !== 'text' || !block.text) continue;

    let match: RegExpExecArray | null;
    artifactRegex.lastIndex = 0;
    while ((match = artifactRegex.exec(block.text)) !== null) {
      const [, rawType, title, artifactContent] = match;
      const validTypes = ['plan', 'diff', 'screenshot', 'walkthrough'];
      const type = validTypes.includes(rawType) ? rawType : 'plan';

      try {
        const id = nanoid(12);
        const now = Date.now();
        db.query(
          `INSERT INTO artifacts (id, conversation_id, message_id, type, title, content, metadata, pinned, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, '{}', 0, ?, ?)`,
        ).run(id, conversationId, messageId, type, title.trim(), artifactContent.trim(), now, now);

        const artifactEvent = JSON.stringify({
          type: 'artifact_created',
          artifact: {
            id,
            conversationId,
            messageId,
            type,
            title: title.trim(),
            content: artifactContent.trim(),
            metadata: {},
            pinned: false,
            createdAt: now,
            updatedAt: now,
          },
        });
        sseEvents.push(`data: ${artifactEvent}\n\n`);
        console.log(`[artifacts] Stored artifact "${title}" (${type}) from message ${messageId}`);
      } catch (err) {
        console.error('[artifacts] Failed to store artifact:', err);
      }
    }
  }

  return sseEvents;
}
