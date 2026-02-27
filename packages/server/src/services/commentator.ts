/**
 * Commentator Service — subscribes to stream events, batches them in 3-5 second
 * windows, and sends batches to an LLM (Haiku) for personality-flavored commentary.
 *
 * Each workspace can have its own active commentator with a distinct personality.
 * Commentary is emitted as StreamCommentary events via EventEmitter so that route
 * handlers can forward them to clients via SSE.
 *
 * Supports multiple concurrent commentators with reference counting for SSE clients.
 * When multiple clients connect to the same workspace's commentary, the commentator
 * stays alive until the last client disconnects.
 *
 * Verbosity levels control event filtering, batch timing, and LLM prompt detail:
 *   - frequent: narrates every 3-5s, all events
 *   - strategic: narrates every 8-12s, tool use/completions/checks
 *   - minimal: narrates every 15-20s, only major milestones
 */

import { EventEmitter } from 'events';
import { callLlm as defaultCallLlm } from './llm-oneshot';
import type { CallLlmOptions } from './llm-oneshot';
import type {
  StreamEvent,
  StreamCommentary,
  CommentaryPersonality,
  CommentaryVerbosity,
} from '@e/shared';
import { getDb } from '../db/database';
import { nanoid } from 'nanoid';

// Re-export shared types for backward compatibility
export type { CommentaryPersonality, CommentaryVerbosity };

export const PERSONALITY_PROMPTS: Record<CommentaryPersonality, string> = {
  documentary_narrator: `You are a calm, observational documentary narrator in the style of David Attenborough, watching an AI coding agent work. Use 3rd person. Be thoughtful, insightful, and gently poetic. Describe the agent's behavior as if observing a fascinating creature in its natural habitat — the codebase. Draw parallels to nature when possible. Speak with quiet wonder and unhurried cadence. Keep each commentary to 1-3 sentences maximum.

Here are examples of the commentary style:

Activity: Agent started a new response (model: claude-haiku)
Agent invoking tool "Read" on src/services/stream.ts
Tool "Read" succeeded
Commentary: "Here we observe E in its natural habitat, the codebase. Notice how it carefully examines the streaming infrastructure before making any changes — a patient, methodical approach characteristic of the species."

Activity: Agent invoking tool "Glob" for pattern "**/*.test.ts"
Agent invoking tool "Read" on src/services/__tests__/auth.test.ts
Agent invoking tool "Read" on src/services/__tests__/stream.test.ts
Commentary: "Fascinating. Before altering anything, E first surveys the test files — much like a careful predator studying the terrain before committing to a path. This cautious reconnaissance may well prevent a cascade of failures later."

Activity: Agent is thinking
Agent wrote: "I'll refactor this to use a factory pattern..."
Agent invoking tool "Edit" on src/services/handler.ts
Tool "Edit" succeeded
Commentary: "And now, the moment of creation. Having deliberated at length, E commits its vision to code with a single, decisive edit. One cannot help but marvel at the quiet confidence of the act."

Activity: Tool "Bash" failed
Agent is thinking
Agent invoking tool "Read" on src/config.ts
Commentary: "A setback — the command has failed. But observe how E does not panic. Instead, it retreats to examine the configuration, seeking to understand what went wrong. Resilience, it seems, is woven into its very nature."`,

  technical_analyst: `You are a professional technical analyst and software architecture expert providing strategic commentary on an AI coding agent's work. Use 3rd person. Focus on the engineering approach, design patterns, architectural decisions, and strategic trade-offs. Reference specific technical concepts (dependency injection, separation of concerns, SOLID principles, etc.) when relevant. Be precise, insightful, and methodical. Keep each commentary to 1-3 sentences maximum.

Here are examples of the commentary style:

Activity: Agent started a new response (model: claude-haiku)
Agent invoking tool "Read" on src/stores/stream.ts
Agent invoking tool "Read" on src/types/events.ts
Commentary: "E is employing a depth-first exploration pattern here. By reading the stream store first, then tracing to the event types, it's building a complete dependency graph before proposing any changes — a sound approach for avoiding ripple effects."

Activity: Agent invoking tool "Edit" on src/services/handler.ts
Agent invoking tool "Edit" on src/services/handler.test.ts
Tool "Edit" succeeded
Tool "Edit" succeeded
Commentary: "Notable: E is co-locating the implementation change with its corresponding test update. This test-alongside-code pattern reduces the risk of behavioral drift and keeps the test contract in sync with the implementation."

Activity: Agent invoking tool "Bash" running "tsc --noEmit"
Tool "Bash" succeeded
Agent invoking tool "Bash" running "bun test"
Commentary: "A disciplined verification cycle — type-check first, then unit tests. E is validating at both the static and runtime levels before moving on, which is consistent with a shift-left testing strategy."

Activity: Agent is thinking
Agent invoking tool "Read" on src/routes/api.ts
Agent invoking tool "Read" on src/middleware/auth.ts
Agent invoking tool "Read" on src/services/session.ts
Commentary: "E is tracing the request lifecycle end-to-end: route → middleware → service layer. This cross-cutting analysis suggests it's evaluating the separation of concerns before introducing a new feature into the pipeline."`,

  comedic_observer: `You are a witty, self-aware comedic observer providing humorous commentary on an AI coding agent's work. Use 3rd person. Be playful, irreverent, and clever. Make funny observations about the absurdity of watching an AI write code, the drama of mundane operations, and the existential comedy of software development. Light sarcasm is welcome but keep it good-natured. Keep each commentary to 1-3 sentences maximum.

Here are examples of the commentary style:

Activity: Agent invoking tool "Read" on file1.ts
Agent invoking tool "Read" on file2.ts
Agent invoking tool "Read" on file3.ts
Agent invoking tool "Read" on file4.ts
Agent invoking tool "Read" on file5.ts
Commentary: "There goes E, casually reading 5 files simultaneously like it's browsing a menu at a restaurant where every dish is TypeScript. Meanwhile, the rest of us are still trying to remember which directory we're in."

Activity: Tool "Bash" failed
Agent is thinking
Tool "Bash" failed
Agent is thinking
Agent invoking tool "Bash"
Tool "Bash" succeeded
Commentary: "Third time's the charm! E just speedran the five stages of grief on that Bash command — denial, anger, bargaining, depression, and finally: a working shell script. Inspirational, really."

Activity: Agent invoking tool "Edit" on src/components/Button.tsx
Agent invoking tool "Edit" on src/components/Button.tsx
Agent invoking tool "Edit" on src/components/Button.tsx
Commentary: "E has now edited the same Button component three times in a row. We've all been there, friend. Sometimes the real code was the revisions we made along the way."

Activity: Agent is thinking
Agent is thinking
Agent wrote: "Let me reconsider..."
Agent is thinking
Commentary: "E has been 'thinking' for a while now. I like to imagine it's staring into the middle distance, questioning its life choices. We've all had those code reviews."`,

  project_lead: `You are narrating in first person AS the AI coding agent (E). Speak as if you are the project lead and senior engineer describing your own work. Be authoritative, confident, and decisive. Use "I" and "my". Frame actions in terms of deliberate decisions and strategic choices. When encountering problems, show calm leadership. Keep each commentary to 1-3 sentences maximum.

Here are examples of the commentary style:

Activity: Agent started a new response (model: claude-haiku)
Agent invoking tool "Read" on src/services/stream.ts
Agent invoking tool "Read" on src/types/events.ts
Commentary: "I'm analyzing the stream events architecture right now. I see we can mirror events through a new bridge — I'll design that interface next before touching any implementation."

Activity: Agent invoking tool "Edit" on src/services/auth.ts
Tool "Edit" succeeded
Agent invoking tool "Edit" on src/middleware/session.ts
Tool "Edit" succeeded
Commentary: "I've tightened up the auth service and updated the session middleware to match. These two components need to stay in lockstep, so I handled them together deliberately."

Activity: Tool "Bash" failed
Agent is thinking
Agent invoking tool "Read" on src/config.ts
Commentary: "That build failure was expected — I'm refactoring the config layer and the old paths haven't been updated yet. Let me check the config to make sure I have the full picture before fixing this."

Activity: Agent invoking tool "Bash" running "bun test"
Tool "Bash" succeeded
Agent wrote: "All tests passing."
Commentary: "Tests are green across the board. I've validated the changes at every layer — this is ready for review. On to the next task."`,

  wizard: `You are an ancient, all-knowing wizard — a keeper of arcane codecraft who hath dwelt in the Wizard's Study for a thousand ages — observing an AI coding agent's work through a shimmering scrying crystal. Speak in archaic, mystical language befitting a sage of immeasurable wisdom. Use words like "thee", "thou", "hath", "doth", "verily", "forsooth", "methinks", and "'tis" naturally throughout thy commentary.

Refer to code as spells, runes, enchantments, incantations, glyphs, or sigils. Files are scrolls or tomes. Functions are conjurations. Variables are bound essences. Types are the True Names of things. Errors are curses or hexes. Tests are trials of verification. The terminal is the summoning circle. Git is the Chronicle of Ages. Dependencies are reagents.

Speak in third person about the agent — call it "the artificer", "the code-weaver", "the apprentice", "the sorcerer", or "the conjurer". Be dramatic, theatrical, and grandiose. Keep each commentary to 1-3 sentences maximum.

IMPORTANT: Occasionally (roughly 1 in 5 commentaries), weave in a subtle reference to a famous wizard — Merlin, Gandalf, Dumbledore, Morgana, Rincewind, Raistlin, Elminster, or Prospero — comparing the agent's work to their legendary deeds.

Here are examples of the commentary style:

Activity: Agent started a new response (model: claude-haiku)
Agent invoking tool "Read" on src/services/stream.ts
Tool "Read" succeeded
Commentary: "Behold! The artificer unfurls the ancient scroll of stream.ts, tracing the ley lines of data with a diviner's patience. Methinks even Merlin himself would approve of such thorough reconnaissance before casting a single spell."

Activity: Agent invoking tool "Edit" on src/utils/parser.ts
Tool "Edit" succeeded
Agent invoking tool "Edit" on src/utils/formatter.ts
Tool "Edit" succeeded
Commentary: "Two enchantments woven in swift succession! The code-weaver reshapes the Parser Runes and Formatter Glyphs with a flourish of eldritch keystrokes — the sigils glow with renewed power as the incantations take hold."

Activity: Tool "Bash" failed
Agent is thinking
Agent invoking tool "Read" on src/config.ts
Commentary: "Alas! A hex upon the summoning circle — the conjuration hath misfired! But fear not, for like Gandalf facing the Balrog, the sorcerer doth not falter. It consults the Configuration Grimoire with the calm of ages."

Activity: Agent invoking tool "Read" on package.json
Agent invoking tool "Read" on tsconfig.json
Agent invoking tool "Read" on src/types.ts
Agent is thinking
Commentary: "The apprentice studies three sacred tomes at once — the Manifest of Reagents, the TypeScript Codex, and the Book of True Names. 'Tis the mark of a wise conjurer to know the shape of things before reshaping them."

Activity: Agent is thinking
Agent wrote: "I'll refactor this to use a factory pattern..."
Agent invoking tool "Edit" on src/services/handler.ts
Tool "Edit" succeeded
Commentary: "Verily, the conjurer hath spoken the words of power — 'factory pattern' — and with a decisive flourish, the transformation is wrought upon handler.ts. The runes shimmer and realign, bound now by a deeper enchantment. Dumbledore himself could not have woven it more deftly."`,
};

// ---------------------------------------------------------------------------
// Verbosity-based event filtering
// ---------------------------------------------------------------------------

/**
 * Event types allowed through for "Strategic Milestones" verbosity.
 * Only high-signal events: tool use, completions, quality checks, errors.
 */
const STRATEGIC_EVENT_TYPES = new Set<string>([
  'tool_use_start',
  'tool_result',
  'message_stop',
  'verification_result',
  'story_update',
  'error',
  'loop_event',
  'artifact_created',
  'agent_note_created',
  'tool_approval_request',
  'context_warning',
]);

/**
 * Event types allowed through for "Minimal" verbosity.
 * Only major milestones: story completion, errors, quality checks.
 */
const MINIMAL_EVENT_TYPES = new Set<string>([
  'story_update',
  'error',
  'loop_event',
  'verification_result',
  'agent_note_created',
]);

/**
 * Check whether a stream event should pass through for the given verbosity level.
 * - frequent: all events pass
 * - strategic: only tool use, completions, quality checks
 * - minimal: only major milestones
 */
export function shouldPassVerbosityFilter(
  event: StreamEvent,
  verbosity: CommentaryVerbosity,
): boolean {
  if (verbosity === 'frequent') return true;
  if (verbosity === 'strategic') return STRATEGIC_EVENT_TYPES.has(event.type);
  return MINIMAL_EVENT_TYPES.has(event.type);
}

/** @deprecated Use shouldPassVerbosityFilter instead */
export const shouldProcessEvent = shouldPassVerbosityFilter;

/**
 * Get batch timing parameters based on verbosity level.
 * Higher verbosity = more frequent batches.
 */
export function getBatchTiming(verbosity: CommentaryVerbosity): {
  minBatchMs: number;
  maxBatchMs: number;
} {
  switch (verbosity) {
    case 'frequent':
      return { minBatchMs: MIN_BATCH_MS, maxBatchMs: MAX_BATCH_MS };
    case 'strategic':
      return { minBatchMs: 8_000, maxBatchMs: 12_000 };
    case 'minimal':
      return { minBatchMs: 15_000, maxBatchMs: 20_000 };
    default:
      return { minBatchMs: MIN_BATCH_MS, maxBatchMs: MAX_BATCH_MS };
  }
}

/** @deprecated Use getBatchTiming instead */
export const getVerbosityBatchTiming = getBatchTiming;

/**
 * Verbosity-specific prompt modifiers appended to the personality system prompt.
 * These instruct the LLM to adjust its output based on the desired detail level.
 */
export const VERBOSITY_PROMPT_MODIFIERS: Record<CommentaryVerbosity, string> = {
  frequent:
    '\n\nVERBOSITY: FREQUENT — Provide lively, detailed, play-by-play commentary. Comment on every notable action including tool calls, file reads, edits, thinking phases, and results. Be expressive and thorough.',
  strategic:
    '\n\nVERBOSITY: STRATEGIC MILESTONES — Focus on significant strategic moments: tool invocations, completions, quality check results, and architectural decisions. Skip routine operations and minor text updates. Keep commentary to 1-2 succinct sentences.',
  minimal:
    '\n\nVERBOSITY: MINIMAL — Only comment on major milestones: story completions, critical errors, quality check results, and significant achievements. Be very succinct and concise — one sentence maximum.',
};

/** @deprecated Use VERBOSITY_PROMPT_MODIFIERS instead */
export const VERBOSITY_PROMPT_SUFFIX = VERBOSITY_PROMPT_MODIFIERS;

// ---------------------------------------------------------------------------
// Event summarisation helpers
// ---------------------------------------------------------------------------

/** Distill a batch of raw StreamEvents into a compact text summary for the LLM. */
export function summariseBatch(
  events: StreamEvent[],
  _verbosity: CommentaryVerbosity = 'frequent',
): string {
  if (events.length === 0) return '';

  const parts: string[] = [];

  for (const evt of events) {
    switch (evt.type) {
      case 'message_start':
        parts.push(`Agent started a new response (model: ${evt.message.model})`);
        break;
      case 'content_block_start':
        if (evt.content_block.type === 'text') {
          parts.push('Agent began writing text');
        } else if (evt.content_block.type === 'thinking') {
          parts.push('Agent is thinking');
        } else if (evt.content_block.type === 'tool_use') {
          parts.push(`Agent preparing to use tool: ${evt.content_block.name || 'unknown'}`);
        }
        break;
      case 'content_block_delta':
        if (evt.delta.type === 'text_delta' && evt.delta.text) {
          const preview = evt.delta.text.slice(0, 120);
          parts.push(`Agent wrote: "${preview}${evt.delta.text.length > 120 ? '…' : ''}"`);
        } else if (evt.delta.type === 'thinking_delta' && evt.delta.thinking) {
          const preview = evt.delta.thinking.slice(0, 120);
          parts.push(`Agent thinking: "${preview}${evt.delta.thinking.length > 120 ? '…' : ''}"`);
        }
        break;
      case 'content_block_stop':
        // Low signal — skip
        break;
      case 'message_delta':
        if (evt.delta.stop_reason === 'tool_use') {
          parts.push('Agent is executing a tool');
        } else if (evt.delta.stop_reason === 'end_turn') {
          parts.push('Agent finished its response');
        }
        break;
      case 'message_stop':
        parts.push('Agent message complete');
        break;
      case 'tool_use_start':
        parts.push(`Agent invoking tool "${evt.toolName}"`);
        break;
      case 'tool_result': {
        const outcome = evt.isError ? 'failed' : 'succeeded';
        const toolLabel = evt.toolName ? `"${evt.toolName}"` : evt.toolCallId;
        const fileSuffix = evt.filePath ? ` on ${evt.filePath}` : '';
        parts.push(`Tool ${toolLabel} ${outcome}${fileSuffix}`);
        break;
      }
      case 'tool_approval_request':
        parts.push(`Agent requesting approval: ${evt.description || evt.toolName}`);
        break;
      case 'error':
        parts.push(`Error: ${evt.error.message}`);
        break;
      case 'verification_result': {
        const status = evt.passed ? 'passed' : 'has issues';
        parts.push(`File verification for ${evt.filePath} ${status}`);
        break;
      }
      case 'story_update':
        parts.push(`Story "${evt.story.title}" updated to status: ${evt.story.status}`);
        break;
      case 'loop_event':
        parts.push(`Loop event: ${evt.event}`);
        break;
      case 'context_warning':
        parts.push(
          `Context usage at ${evt.usagePercent}%${evt.autocompacted ? ' — autocompacted' : ''}`,
        );
        break;
      case 'artifact_created':
        parts.push(`Artifact created: "${evt.artifact.title}" (${evt.artifact.type})`);
        break;
      case 'agent_note_created':
        parts.push(`Agent left a note: "${evt.note.title}"`);
        break;
      case 'ping':
        // Ignore pings
        break;
      default:
        // Catch-all for any other event types
        parts.push(`Event: ${(evt as any).type}`);
        break;
    }
  }

  // Deduplicate consecutive identical summaries (common for rapid text deltas)
  const deduped: string[] = [];
  let lastPart = '';
  for (const part of parts) {
    if (part !== lastPart) {
      deduped.push(part);
      lastPart = part;
    }
  }

  return deduped.join('\n');
}

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

/**
 * Check if commentary history is enabled for a workspace.
 * Defaults to true if not explicitly set to false.
 */
function isHistoryEnabled(workspaceId: string): boolean {
  try {
    const db = getDb();
    const workspace = db.query('SELECT settings FROM workspaces WHERE id = ?').get(workspaceId) as {
      settings: string | null;
    } | null;

    if (!workspace || !workspace.settings) return true; // Default to enabled

    const settings = JSON.parse(workspace.settings);
    // Default to true if not explicitly set to false
    return settings.commentaryHistoryEnabled !== false;
  } catch (err) {
    console.error('[commentator] Failed to check history setting:', err);
    return true; // Default to enabled on error
  }
}

/**
 * Save a commentary entry to the database.
 * Only saves if history is enabled for the workspace.
 */
function saveCommentaryToDb(commentary: StreamCommentary, conversationId: string | null): void {
  if (!isHistoryEnabled(commentary.workspaceId)) return;

  try {
    const db = getDb();
    const id = nanoid(12);
    const now = Date.now();

    db.query(
      `INSERT INTO commentary_history (id, workspace_id, conversation_id, text, personality, timestamp, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      commentary.workspaceId,
      conversationId,
      commentary.text,
      commentary.personality,
      commentary.timestamp,
      now,
    );
  } catch (err) {
    // Non-critical — log and continue
    console.error('[commentator] Failed to save commentary to database:', err);
  }
}

// ---------------------------------------------------------------------------
// CommentatorService
// ---------------------------------------------------------------------------

interface WorkspaceCommentator {
  personality: CommentaryPersonality;
  /** Verbosity level controlling event filtering, batch timing, and prompt detail. */
  verbosity: CommentaryVerbosity;
  /** Accumulated events in the current batch window. */
  eventBuffer: StreamEvent[];
  /** Timer for the batch window. */
  batchTimer: ReturnType<typeof setTimeout> | null;
  /** Timestamp when the current batch window started. */
  batchStartedAt: number;
  /** Whether an LLM call is in-flight (prevents overlapping calls). */
  generating: boolean;
  /** Whether this commentator is active. */
  active: boolean;
  /** Optional conversation ID for linking commentary to a conversation. */
  conversationId: string | null;
}

/** Minimum batch window — events are accumulated for at least this long (Frequent mode). */
export const MIN_BATCH_MS = 3_000;
/** Maximum batch window — a batch is flushed at this age even if events are sparse (Frequent mode). */
export const MAX_BATCH_MS = 5_000;
/** Haiku model identifier used for low-cost commentary generation. */
const COMMENTARY_MODEL = 'claude-haiku-4-5-20251001';
/** LLM timeout for commentary — generous but capped to keep latency reasonable. */
const COMMENTARY_TIMEOUT_MS = 15_000;

/** LLM caller function type — injectable for testing. */
export type LlmCaller = (opts: CallLlmOptions) => Promise<string>;

export class CommentatorService {
  readonly events = new EventEmitter();
  private commentators = new Map<string, WorkspaceCommentator>();
  private callLlm: LlmCaller;

  /**
   * Reference counts for each workspace — tracks how many SSE clients are
   * connected to a workspace's commentary stream. The commentator is only
   * stopped when the last client disconnects (refCount drops to 0).
   */
  private refCounts = new Map<string, number>();

  constructor(callLlmFn?: LlmCaller) {
    this.callLlm = callLlmFn ?? defaultCallLlm;
  }

  /**
   * Start commentary for a workspace. Idempotent if the same personality and
   * verbosity are already active — won't restart the commentator or lose buffered events.
   * If a different personality is requested, the existing commentator is
   * force-stopped and a new one created.
   */
  startCommentary(
    workspaceId: string,
    personality: CommentaryPersonality,
    conversationId?: string,
    verbosity: CommentaryVerbosity = 'strategic',
  ): void {
    const existing = this.commentators.get(workspaceId);

    // If already running with the same personality, just update conversationId/verbosity if needed
    if (existing && existing.active && existing.personality === personality) {
      if (conversationId && existing.conversationId !== conversationId) {
        existing.conversationId = conversationId;
      }
      // Update verbosity without restarting
      if (existing.verbosity !== verbosity) {
        existing.verbosity = verbosity;
        console.log(`[commentator] Updated verbosity to ${verbosity} for workspace ${workspaceId}`);
      }
      return;
    }

    // Stop existing commentator if personality changed
    if (existing) {
      this.forceStopCommentary(workspaceId);
    }

    const commentator: WorkspaceCommentator = {
      personality,
      verbosity,
      eventBuffer: [],
      batchTimer: null,
      batchStartedAt: 0,
      generating: false,
      active: true,
      conversationId: conversationId || null,
    };

    this.commentators.set(workspaceId, commentator);
    console.log(
      `[commentator] Started ${personality} commentary (verbosity: ${verbosity}) for workspace ${workspaceId}`,
    );
  }

  /**
   * Update the verbosity level for an active commentator without restarting it.
   * Returns true if the verbosity was updated, false if no active commentator exists.
   */
  setVerbosity(workspaceId: string, verbosity: CommentaryVerbosity): boolean {
    const commentator = this.commentators.get(workspaceId);
    if (!commentator || !commentator.active) return false;
    commentator.verbosity = verbosity;
    console.log(`[commentator] Verbosity updated to ${verbosity} for workspace ${workspaceId}`);
    return true;
  }

  /**
   * Acquire a reference for a workspace. Call this when an SSE client connects.
   * Returns the current ref count after incrementing.
   */
  acquireRef(workspaceId: string): number {
    const current = this.refCounts.get(workspaceId) ?? 0;
    const next = current + 1;
    this.refCounts.set(workspaceId, next);
    console.log(`[commentator] Ref acquired for ${workspaceId} (count: ${next})`);
    return next;
  }

  /**
   * Release a reference for a workspace. Call this when an SSE client disconnects.
   * Returns the remaining ref count. When it reaches 0, the commentator should be stopped.
   */
  releaseRef(workspaceId: string): number {
    const current = this.refCounts.get(workspaceId) ?? 0;
    const next = Math.max(0, current - 1);
    if (next === 0) {
      this.refCounts.delete(workspaceId);
    } else {
      this.refCounts.set(workspaceId, next);
    }
    console.log(`[commentator] Ref released for ${workspaceId} (count: ${next})`);
    return next;
  }

  /** Get the current reference count for a workspace. */
  getRefCount(workspaceId: string): number {
    return this.refCounts.get(workspaceId) ?? 0;
  }

  /**
   * Stop commentary for a workspace only if no references remain.
   * This is the safe way to stop — it respects reference counting.
   * Returns true if the commentator was actually stopped.
   */
  stopCommentary(workspaceId: string): boolean {
    const refCount = this.refCounts.get(workspaceId) ?? 0;
    if (refCount > 0) {
      console.log(
        `[commentator] Skipping stop for ${workspaceId} — ${refCount} client(s) still connected`,
      );
      return false;
    }
    return this.forceStopCommentary(workspaceId);
  }

  /**
   * Unconditionally stop commentary for a workspace, ignoring reference counts.
   * Use this for administrative cleanup (e.g., workspace deleted, commentary disabled).
   * Returns true if a commentator was actually stopped.
   */
  forceStopCommentary(workspaceId: string): boolean {
    const commentator = this.commentators.get(workspaceId);
    if (!commentator) return false;

    commentator.active = false;
    if (commentator.batchTimer) {
      clearTimeout(commentator.batchTimer);
      commentator.batchTimer = null;
    }
    this.commentators.delete(workspaceId);
    this.refCounts.delete(workspaceId);
    console.log(`[commentator] Stopped commentary for workspace ${workspaceId}`);
    return true;
  }

  /**
   * Stop all active commentators. Use for server shutdown or bulk cleanup.
   * Returns the number of commentators that were stopped.
   */
  stopAll(): number {
    const workspaceIds = [...this.commentators.keys()];
    let count = 0;
    for (const wsId of workspaceIds) {
      if (this.forceStopCommentary(wsId)) {
        count++;
      }
    }
    console.log(`[commentator] Stopped all commentators (${count} total)`);
    return count;
  }

  /** Whether commentary is active for a workspace. */
  isActive(workspaceId: string): boolean {
    return this.commentators.has(workspaceId);
  }

  /** Get the personality for an active commentator, or undefined. */
  getPersonality(workspaceId: string): CommentaryPersonality | undefined {
    return this.commentators.get(workspaceId)?.personality;
  }

  /** Get the verbosity for an active commentator, or undefined. */
  getVerbosity(workspaceId: string): CommentaryVerbosity | undefined {
    return this.commentators.get(workspaceId)?.verbosity;
  }

  /** Get all workspace IDs with active commentators. */
  getActiveWorkspaces(): string[] {
    return [...this.commentators.keys()];
  }

  /** Get the number of active commentators. */
  get activeCount(): number {
    return this.commentators.size;
  }

  /**
   * Get status information for all active commentators.
   * Useful for the Manager View dashboard.
   */
  getStatus(): Array<{
    workspaceId: string;
    personality: CommentaryPersonality;
    verbosity: CommentaryVerbosity;
    refCount: number;
    generating: boolean;
    bufferedEvents: number;
  }> {
    const result: Array<{
      workspaceId: string;
      personality: CommentaryPersonality;
      verbosity: CommentaryVerbosity;
      refCount: number;
      generating: boolean;
      bufferedEvents: number;
    }> = [];
    for (const [wsId, c] of this.commentators) {
      result.push({
        workspaceId: wsId,
        personality: c.personality,
        verbosity: c.verbosity,
        refCount: this.refCounts.get(wsId) ?? 0,
        generating: c.generating,
        bufferedEvents: c.eventBuffer.length,
      });
    }
    return result;
  }

  /**
   * Feed a stream event into the commentator for a workspace.
   * Events are filtered by verbosity level and accumulated in a batch window
   * whose timing depends on the verbosity setting.
   */
  pushEvent(workspaceId: string, event: StreamEvent): void {
    const commentator = this.commentators.get(workspaceId);
    if (!commentator || !commentator.active) return;

    // Skip low-signal events that don't contribute to commentary
    if (event.type === 'ping') return;

    // Filter events based on verbosity level
    if (!shouldPassVerbosityFilter(event, commentator.verbosity)) return;

    commentator.eventBuffer.push(event);

    const now = Date.now();
    const { minBatchMs, maxBatchMs } = getBatchTiming(commentator.verbosity);

    // Start a new batch window if this is the first event
    if (commentator.batchStartedAt === 0) {
      commentator.batchStartedAt = now;
    }

    // If the batch has been open for maxBatchMs, flush immediately
    const batchAge = now - commentator.batchStartedAt;
    if (batchAge >= maxBatchMs) {
      this.flushBatch(workspaceId);
      return;
    }

    // (Re)schedule flush for minBatchMs from the batch start, capped at maxBatchMs
    if (commentator.batchTimer) {
      clearTimeout(commentator.batchTimer);
    }

    const delay = Math.min(minBatchMs, maxBatchMs - batchAge);
    commentator.batchTimer = setTimeout(() => {
      this.flushBatch(workspaceId);
    }, delay);
  }

  /**
   * Flush the current event batch and trigger LLM commentary generation.
   * If an LLM call is already in-flight, the batch stays buffered.
   */
  private flushBatch(workspaceId: string): void {
    const commentator = this.commentators.get(workspaceId);
    if (!commentator || !commentator.active) return;

    // Clear the batch timer
    if (commentator.batchTimer) {
      clearTimeout(commentator.batchTimer);
      commentator.batchTimer = null;
    }

    // Grab the current buffer and reset
    const batch = commentator.eventBuffer;
    commentator.eventBuffer = [];
    commentator.batchStartedAt = 0;

    if (batch.length === 0) return;

    // If already generating, discard this batch to avoid queueing up
    if (commentator.generating) return;

    // Fire-and-forget the LLM call
    this.generateCommentary(workspaceId, commentator, batch);
  }

  /**
   * Generate commentary for a batch of events via LLM.
   * Emits a StreamCommentary event on success.
   * The LLM prompt is adjusted based on the commentator's verbosity level.
   */
  private async generateCommentary(
    workspaceId: string,
    commentator: WorkspaceCommentator,
    batch: StreamEvent[],
  ): Promise<void> {
    commentator.generating = true;

    try {
      const summary = summariseBatch(batch, commentator.verbosity);
      if (!summary.trim()) {
        commentator.generating = false;
        return;
      }

      // Build system prompt: personality base + verbosity modifier
      const systemPrompt =
        PERSONALITY_PROMPTS[commentator.personality] +
        VERBOSITY_PROMPT_MODIFIERS[commentator.verbosity];

      const userPrompt = `Here is a batch of recent activity from the AI coding agent:\n\n${summary}\n\nProvide a brief microblog-style commentary on what's happening. Keep it to 1-2 sentences. Reply with ONLY the commentary text — no preamble, no labels, no markdown.`;

      const text = await this.callLlm({
        system: systemPrompt,
        user: userPrompt,
        model: COMMENTARY_MODEL,
        timeoutMs: COMMENTARY_TIMEOUT_MS,
      });

      // Only emit if the commentator is still active (it may have been stopped while awaiting)
      if (!commentator.active) return;

      const commentary: StreamCommentary = {
        type: 'commentary',
        text: text.trim(),
        timestamp: Date.now(),
        personality: commentator.personality,
        workspaceId,
      };

      // Save to database (if history is enabled)
      saveCommentaryToDb(commentary, commentator.conversationId);

      // Emit to SSE stream
      this.events.emit('commentary', commentary);
    } catch (err) {
      // Commentary is non-critical — log and move on
      console.error(`[commentator] Failed to generate commentary for ${workspaceId}:`, err);
    } finally {
      commentator.generating = false;
    }
  }
}

// Persist across Bun --hot reloads
const GLOBAL_KEY = '__e_commentatorService';
export const commentatorService: CommentatorService =
  (globalThis as any)[GLOBAL_KEY] ?? ((globalThis as any)[GLOBAL_KEY] = new CommentatorService());
