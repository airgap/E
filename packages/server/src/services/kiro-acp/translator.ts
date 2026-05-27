/**
 * kiro-acp/translator.ts — translates Kiro ACP `session/update` notifications
 * into the Anthropic-streaming-SSE event shape the chat UI already consumes
 * (same shape we produce from Claude Code's stream_event events). This means
 * no client-side changes are required to render Kiro responses — the
 * existing message_start / content_block_* / message_delta / message_stop
 * pipeline just works.
 *
 * We emit a synthetic `message_start` once per turn (on the FIRST update we
 * see for that turn) so the client opens a new assistant message; subsequent
 * `agent_message_chunk`s become incremental text deltas inside content
 * block index 0; the turn closes with `message_delta` + `message_stop` when
 * the manager observes the prompt Promise resolve.
 */
import { nanoid } from 'nanoid';
import type { KiroSessionUpdate } from './client';

export interface TurnState {
  /** Whether we've already emitted message_start for the current turn. */
  started: boolean;
  /** Whether the text content block is open. */
  textBlockOpen: boolean;
  /** Assistant message id surfaced to the UI for this turn. */
  messageId: string;
}

export function newTurnState(): TurnState {
  return { started: false, textBlockOpen: false, messageId: nanoid() };
}

/**
 * Translate a single Kiro session/update into one or more Anthropic-style
 * SSE event JSON strings. Caller is responsible for prefixing `data: ` and
 * the SSE event delimiter when writing to the wire.
 */
export function translateKiroUpdate(
  update: KiroSessionUpdate,
  state: TurnState,
  modelHint?: string,
): string[] {
  const events: string[] = [];

  // Lazily open a message + text block on the first update of the turn so
  // every update path below can just emit deltas without bookkeeping.
  const ensureStarted = (): void => {
    if (!state.started) {
      events.push(
        JSON.stringify({
          type: 'message_start',
          message: {
            id: state.messageId,
            role: 'assistant',
            model: modelHint ?? 'kiro',
          },
        }),
      );
      state.started = true;
    }
  };
  const ensureTextBlock = (): void => {
    ensureStarted();
    if (!state.textBlockOpen) {
      events.push(
        JSON.stringify({
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        }),
      );
      state.textBlockOpen = true;
    }
  };

  switch (update.sessionUpdate) {
    case 'agent_message_chunk': {
      // Streaming text from the agent.
      const text = update.content?.type === 'text' ? (update.content.text ?? '') : '';
      if (text) {
        ensureTextBlock();
        events.push(
          JSON.stringify({
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text },
          }),
        );
      }
      break;
    }
    case 'agent_thought_chunk': {
      // Kiro's "thinking" — surface as a thinking content block. Speculative;
      // protocol naming may differ. The text path is harmless if absent.
      const text = update.content?.type === 'text' ? (update.content.text ?? '') : '';
      if (text) {
        ensureStarted();
        events.push(
          JSON.stringify({
            type: 'content_block_start',
            index: 1,
            content_block: { type: 'thinking', thinking: '' },
          }),
        );
        events.push(
          JSON.stringify({
            type: 'content_block_delta',
            index: 1,
            delta: { type: 'thinking_delta', thinking: text },
          }),
        );
        events.push(JSON.stringify({ type: 'content_block_stop', index: 1 }));
      }
      break;
    }
    // tool_call / tool_call_update path: emit a tool_use content block. Kiro
    // tool semantics differ from Claude's; this is best-effort and may need
    // refinement once we see real tool call payloads in the wild.
    case 'tool_call': {
      ensureStarted();
      const u = update as any;
      events.push(
        JSON.stringify({
          type: 'content_block_start',
          index: 2,
          content_block: {
            type: 'tool_use',
            id: u.toolCallId || nanoid(),
            name: u.toolName || u.name || 'unknown',
          },
        }),
      );
      events.push(
        JSON.stringify({
          type: 'content_block_delta',
          index: 2,
          delta: {
            type: 'input_json_delta',
            partial_json: JSON.stringify(u.input || u.arguments || {}),
          },
        }),
      );
      events.push(JSON.stringify({ type: 'content_block_stop', index: 2 }));
      break;
    }
    default:
      // Unknown sessionUpdate kind — log + drop so protocol additions don't
      // crash the stream. UI doesn't get the event; nothing breaks.
      console.debug('[kiro-acp:translator] dropping unknown update:', update.sessionUpdate);
      break;
  }

  return events;
}

/**
 * Emit the end-of-turn events the UI expects after the prompt Promise
 * resolves. Closes any open content block + emits message_delta + message_stop.
 */
export function endTurnEvents(state: TurnState, stopReason: string = 'end_turn'): string[] {
  const events: string[] = [];
  if (state.textBlockOpen) {
    events.push(JSON.stringify({ type: 'content_block_stop', index: 0 }));
    state.textBlockOpen = false;
  }
  // If the turn produced ZERO updates, we still need to bracket the UI with
  // a (synthetic) message_start so the chat doesn't dangle in "thinking".
  if (!state.started) {
    events.push(
      JSON.stringify({
        type: 'message_start',
        message: { id: state.messageId, role: 'assistant', model: 'kiro' },
      }),
    );
    state.started = true;
  }
  events.push(
    JSON.stringify({
      type: 'message_delta',
      delta: { stop_reason: stopReason },
      usage: { input_tokens: 0, output_tokens: 0 },
    }),
  );
  events.push(JSON.stringify({ type: 'message_stop' }));
  return events;
}
