/**
 * Timeline store — derives a step-by-step replay of AI actions from
 * conversation messages. Each step represents a discrete action (thinking,
 * writing text, using a tool, receiving a result) and links back to
 * the original message and content block.
 *
 * The timeline can be browsed to understand what the AI did and in what order,
 * and supports "undo to this point" via git snapshots.
 */

import type { Message, MessageContent, Conversation } from '@e/shared';
import { api } from '$lib/api/client';

// ── Types ────────────────────────────────────────────────────────────────

export type TimelineStepKind =
  | 'thinking'
  | 'text'
  | 'tool_call'
  | 'tool_result'
  | 'user_message'
  | 'nudge'
  | 'error'
  | 'snapshot';

export interface TimelineStep {
  id: string;
  kind: TimelineStepKind;
  /** Index within the parent message's content array */
  blockIndex: number;
  /** The parent message ID */
  messageId: string;
  /** Timestamp (from the message) */
  timestamp: number;
  /** Human-readable label */
  label: string;
  /** Detailed content preview (truncated) */
  preview: string;
  /** For tool_call: the tool name */
  toolName?: string;
  /** For tool_call: the tool call id */
  toolCallId?: string;
  /** For tool_result: whether it errored */
  isError?: boolean;
  /** For tool_call: file path if it's a file operation */
  filePath?: string;
  /** Duration in ms (for tool results) */
  duration?: number;
  /** Associated git snapshot ID (for undo-to-point) */
  snapshotId?: string;
  /** Whether this step has a git snapshot available */
  hasSnapshot: boolean;
}

export interface TimelineSnapshot {
  id: string;
  headSha: string;
  stashSha: string | null;
  reason: string;
  hasChanges: boolean;
  messageId: string | null;
  createdAt: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function truncate(s: string, max = 120): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}

function extractFilePath(input: Record<string, unknown>): string | undefined {
  // Common patterns for file paths in tool inputs
  const candidates = ['file_path', 'path', 'filePath', 'filename', 'file'];
  for (const key of candidates) {
    const val = input[key];
    if (typeof val === 'string' && val.length > 0) return val;
  }
  return undefined;
}

function labelForTool(name: string, input: Record<string, unknown>): string {
  const fp = extractFilePath(input);
  const fileName = fp?.split('/').pop();
  switch (name) {
    case 'Write':
    case 'write_file':
    case 'create_file':
      return fileName ? `Write ${fileName}` : 'Write file';
    case 'Edit':
    case 'edit_file':
    case 'str_replace_editor':
      return fileName ? `Edit ${fileName}` : 'Edit file';
    case 'Read':
    case 'read_file':
      return fileName ? `Read ${fileName}` : 'Read file';
    case 'Bash':
    case 'execute_command':
      return `Run command`;
    case 'Glob':
    case 'search_files':
      return 'Search files';
    case 'Grep':
      return 'Search code';
    case 'WebFetch':
      return 'Fetch URL';
    case 'WebSearch':
      return 'Web search';
    case 'Task':
      return 'Launch sub-agent';
    case 'TodoWrite':
      return 'Update tasks';
    default:
      return name;
  }
}

function previewForBlock(block: MessageContent): string {
  switch (block.type) {
    case 'text':
      return truncate(block.text.trim());
    case 'thinking':
      return truncate(block.thinking.trim());
    case 'tool_use':
      return truncate(JSON.stringify(block.input).slice(0, 200));
    case 'tool_result':
      return truncate(block.content);
    case 'nudge':
      return truncate(block.text);
    default:
      return '';
  }
}

let stepCounter = 0;
function nextStepId(): string {
  return `ts_${++stepCounter}`;
}

// ── Build timeline from messages ─────────────────────────────────────────

function buildTimeline(messages: Message[]): TimelineStep[] {
  const steps: TimelineStep[] = [];

  for (const msg of messages) {
    if (msg.role === 'user') {
      // Check if it's a simple user message or has nudge content
      const hasNudge = msg.content.some((b) => b.type === 'nudge');
      const textContent = msg.content.find((b) => b.type === 'text');

      if (hasNudge) {
        for (const block of msg.content) {
          if (block.type === 'nudge') {
            steps.push({
              id: nextStepId(),
              kind: 'nudge',
              blockIndex: msg.content.indexOf(block),
              messageId: msg.id,
              timestamp: msg.timestamp,
              label: 'User feedback',
              preview: previewForBlock(block),
              hasSnapshot: false,
            });
          }
        }
      } else if (textContent && textContent.type === 'text') {
        steps.push({
          id: nextStepId(),
          kind: 'user_message',
          blockIndex: 0,
          messageId: msg.id,
          timestamp: msg.timestamp,
          label: 'User message',
          preview: previewForBlock(textContent),
          hasSnapshot: false,
        });
      }

      // Also process tool results in user messages
      for (let i = 0; i < msg.content.length; i++) {
        const block = msg.content[i];
        if (block.type === 'tool_result') {
          steps.push({
            id: nextStepId(),
            kind: 'tool_result',
            blockIndex: i,
            messageId: msg.id,
            timestamp: msg.timestamp,
            label: 'Tool result',
            preview: previewForBlock(block),
            toolCallId: block.tool_use_id,
            isError: block.is_error ?? false,
            hasSnapshot: false,
          });
        }
      }
    } else if (msg.role === 'assistant') {
      for (let i = 0; i < msg.content.length; i++) {
        const block = msg.content[i];

        switch (block.type) {
          case 'thinking':
            steps.push({
              id: nextStepId(),
              kind: 'thinking',
              blockIndex: i,
              messageId: msg.id,
              timestamp: msg.timestamp,
              label: 'Thinking',
              preview: previewForBlock(block),
              hasSnapshot: false,
            });
            break;

          case 'text':
            steps.push({
              id: nextStepId(),
              kind: 'text',
              blockIndex: i,
              messageId: msg.id,
              timestamp: msg.timestamp,
              label: 'Response',
              preview: previewForBlock(block),
              hasSnapshot: false,
            });
            break;

          case 'tool_use': {
            const fp = extractFilePath(block.input as Record<string, unknown>);
            steps.push({
              id: nextStepId(),
              kind: 'tool_call',
              blockIndex: i,
              messageId: msg.id,
              timestamp: msg.timestamp,
              label: labelForTool(block.name, block.input as Record<string, unknown>),
              preview: previewForBlock(block),
              toolName: block.name,
              toolCallId: block.id,
              filePath: fp,
              hasSnapshot: false,
            });
            break;
          }
        }
      }
    }
  }

  return steps;
}

// ── Store ────────────────────────────────────────────────────────────────

function createTimelineStore() {
  let steps = $state<TimelineStep[]>([]);
  let selectedStepId = $state<string | null>(null);
  let conversationId = $state<string | null>(null);
  let snapshots = $state<TimelineSnapshot[]>([]);
  let loading = $state(false);
  let snapshotsLoading = $state(false);

  const selectedStep = $derived(
    selectedStepId ? (steps.find((s) => s.id === selectedStepId) ?? null) : null,
  );

  // Group consecutive steps by message for visual nesting
  const groupedByMessage = $derived.by(() => {
    const groups: Array<{ messageId: string; steps: TimelineStep[] }> = [];
    let currentGroup: { messageId: string; steps: TimelineStep[] } | null = null;

    for (const step of steps) {
      if (!currentGroup || currentGroup.messageId !== step.messageId) {
        currentGroup = { messageId: step.messageId, steps: [] };
        groups.push(currentGroup);
      }
      currentGroup.steps.push(step);
    }

    return groups;
  });

  // Summary stats
  const stats = $derived({
    totalSteps: steps.length,
    toolCalls: steps.filter((s) => s.kind === 'tool_call').length,
    fileEdits: steps.filter(
      (s) =>
        s.kind === 'tool_call' &&
        ['Write', 'Edit', 'write_file', 'edit_file', 'str_replace_editor', 'create_file'].includes(
          s.toolName ?? '',
        ),
    ).length,
    errors: steps.filter((s) => s.isError).length,
    thinkingBlocks: steps.filter((s) => s.kind === 'thinking').length,
    snapshotsAvailable: snapshots.length,
  });

  const FILE_EDIT_TOOLS = new Set([
    'Write',
    'Edit',
    'write_file',
    'edit_file',
    'create_file',
    'str_replace_editor',
  ]);

  function attachSnapshots() {
    if (snapshots.length === 0) return;

    // Match snapshots to steps by messageId (exact match)
    const byMsg = new Map<string, TimelineSnapshot>();
    for (const snap of snapshots) {
      if (snap.messageId) byMsg.set(snap.messageId, snap);
    }

    // Sort snapshots by creation time for nearest-prior matching
    const sortedSnaps = [...snapshots].sort((a, b) => a.createdAt - b.createdAt);

    steps = steps.map((step) => {
      // Exact match by messageId
      const exact = byMsg.get(step.messageId);
      if (exact) {
        return { ...step, hasSnapshot: true, snapshotId: exact.id };
      }

      // For file-editing tool calls, find the nearest snapshot created before this step
      if (step.kind === 'tool_call' && FILE_EDIT_TOOLS.has(step.toolName ?? '')) {
        let nearest: TimelineSnapshot | null = null;
        for (const snap of sortedSnaps) {
          if (snap.createdAt <= step.timestamp) {
            nearest = snap;
          } else {
            break;
          }
        }
        if (nearest) {
          return { ...step, hasSnapshot: true, snapshotId: nearest.id };
        }
      }

      return step;
    });
  }

  return {
    get steps() {
      return steps;
    },
    get selectedStepId() {
      return selectedStepId;
    },
    get selectedStep() {
      return selectedStep;
    },
    get conversationId() {
      return conversationId;
    },
    get snapshots() {
      return snapshots;
    },
    get loading() {
      return loading;
    },
    get snapshotsLoading() {
      return snapshotsLoading;
    },
    get groupedByMessage() {
      return groupedByMessage;
    },
    get stats() {
      return stats;
    },

    /** Build timeline from a conversation's messages */
    loadFromConversation(conv: Conversation) {
      conversationId = conv.id;
      stepCounter = 0;
      steps = buildTimeline(conv.messages);
      selectedStepId = null;
      // Re-attach snapshots if already loaded
      attachSnapshots();
    },

    /** Load available git snapshots for a workspace */
    async loadSnapshots(workspacePath: string) {
      snapshotsLoading = true;
      try {
        const res = await api.git.snapshots(workspacePath);
        snapshots = (res.data ?? []).map((s: any) => ({
          id: s.id,
          headSha: s.headSha,
          stashSha: s.stashSha,
          reason: s.reason,
          hasChanges: s.hasChanges,
          messageId: s.messageId,
          createdAt: s.createdAt,
        }));
        attachSnapshots();
      } catch {
        snapshots = [];
      }
      snapshotsLoading = false;
    },

    selectStep(stepId: string | null) {
      selectedStepId = stepId;
    },

    /** Navigate to previous step */
    selectPrevious() {
      if (steps.length === 0) return;
      if (!selectedStepId) {
        selectedStepId = steps[0].id;
        return;
      }
      const idx = steps.findIndex((s) => s.id === selectedStepId);
      if (idx > 0) selectedStepId = steps[idx - 1].id;
    },

    /** Navigate to next step */
    selectNext() {
      if (steps.length === 0) return;
      if (!selectedStepId) {
        selectedStepId = steps[0].id;
        return;
      }
      const idx = steps.findIndex((s) => s.id === selectedStepId);
      if (idx < steps.length - 1) selectedStepId = steps[idx + 1].id;
    },

    /** Restore workspace to the state at a given snapshot */
    async restoreToSnapshot(snapshotId: string): Promise<boolean> {
      try {
        const res = await api.git.restoreSnapshot(snapshotId);
        return res.data?.restored ?? false;
      } catch {
        return false;
      }
    },

    /** Get the content block for a step */
    getBlockContent(conv: Conversation, step: TimelineStep): MessageContent | null {
      const msg = conv.messages.find((m) => m.id === step.messageId);
      if (!msg) return null;
      return msg.content[step.blockIndex] ?? null;
    },

    clear() {
      steps = [];
      selectedStepId = null;
      conversationId = null;
      snapshots = [];
    },
  };
}

export const timelineStore = createTimelineStore();
