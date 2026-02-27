import type { StreamEvent, MessageContent } from '@e/shared';
import { extractEditLineHint } from '@e/shared';
import { editorStore, detectLanguage } from './editor.svelte';
import { primaryPaneStore } from './primaryPane.svelte';
import { api } from '$lib/api/client';
import { changesStore } from './changes.svelte';

export type StreamStatus =
  | 'idle'
  | 'connecting'
  | 'streaming'
  | 'tool_pending'
  | 'error'
  | 'cancelled';

interface PendingApproval {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  description: string;
}

export interface StreamSnapshot {
  status: StreamStatus;
  sessionId: string | null;
  partialText: string;
  partialThinking: string;
  contentBlocks: MessageContent[];
  pendingApprovals: PendingApproval[];
  tokenUsage: { input: number; output: number };
  error: string | null;
  abortController: AbortController | null;
  toolResults: Map<string, { result: string; isError: boolean; duration?: number }>;
  indexOffset: number;
  currentParentId: string | null;
}

// CRITICAL: Export $state variables directly for proper Svelte 5 reactivity
// Components must import streamState and read properties directly, not through streamStore getters
// This ensures $derived.by() and other reactivity can properly track changes
export const streamState = {
  status: $state<StreamStatus>('idle'),
  sessionId: $state<string | null>(null),
  partialText: $state(''),
  partialThinking: $state(''),
  contentBlocks: $state<MessageContent[]>([]),
  currentBlockIndex: $state(-1),
  currentBlockType: $state<string>(''),
  pendingApprovals: $state<PendingApproval[]>([]),
  tokenUsage: $state({ input: 0, output: 0 }),
  error: $state<string | null>(null),
  abortController: $state<AbortController | null>(null),
  toolResults: $state<Map<string, { result: string; isError: boolean; duration?: number }>>(
    new Map(),
  ),
  verifications: $state<Map<string, { passed: boolean; issues: any[]; tool: string }>>(new Map()),
  indexOffset: 0,
  currentParentId: $state<string | null>(null),
};

function createStreamStore() {
  const state = streamState;

  return {
    // Maintain backward compatibility with getter-based access
    // But internally reference the exported state
    get status() {
      return state.status;
    },
    get sessionId() {
      return state.sessionId;
    },
    get partialText() {
      return state.partialText;
    },
    get partialThinking() {
      return state.partialThinking;
    },
    get contentBlocks() {
      return state.contentBlocks;
    },
    get pendingApprovals() {
      return state.pendingApprovals;
    },
    get tokenUsage() {
      return state.tokenUsage;
    },
    get error() {
      return state.error;
    },
    get isStreaming() {
      return state.status === 'streaming' || state.status === 'connecting';
    },
    get abortController() {
      return state.abortController;
    },
    get toolResults() {
      return state.toolResults;
    },
    get verifications() {
      return state.verifications;
    },

    setSessionId(id: string) {
      state.sessionId = id;
    },
    setAbortController(ctrl: AbortController) {
      state.abortController = ctrl;
    },

    startStream() {
      state.status = 'connecting';
      state.partialText = '';
      state.partialThinking = '';
      state.contentBlocks = [];
      state.currentBlockIndex = -1;
      state.error = null;
      state.toolResults = new Map();
      state.verifications = new Map();
      state.indexOffset = 0;
      state.currentParentId = null;
      changesStore.startTracking();
    },

    handleEvent(event: StreamEvent) {
      console.log(
        '[streamStore.handleEvent] Processing:',
        event.type,
        'contentBlocks.length:',
        state.contentBlocks.length,
      );
      switch (event.type) {
        case 'message_start':
          state.status = 'streaming';
          state.indexOffset = state.contentBlocks.length;
          state.currentParentId = (event as any).parent_tool_use_id || null;
          break;

        case 'content_block_start': {
          state.currentBlockIndex = event.index;
          state.currentBlockType = event.content_block.type;
          const pid = (event as any).parent_tool_use_id || state.currentParentId || undefined;
          if (event.content_block.type === 'text') {
            state.contentBlocks = [
              ...state.contentBlocks,
              { type: 'text', text: event.content_block.text ?? '', parentToolUseId: pid },
            ];
            console.log('[streamStore] Added text block, new length:', state.contentBlocks.length);
          } else if (event.content_block.type === 'thinking') {
            state.contentBlocks = [
              ...state.contentBlocks,
              {
                type: 'thinking',
                thinking: event.content_block.thinking ?? '',
                parentToolUseId: pid,
              },
            ];
            console.log(
              '[streamStore] Added thinking block, new length:',
              state.contentBlocks.length,
            );
          } else if (event.content_block.type === 'tool_use') {
            state.contentBlocks = [
              ...state.contentBlocks,
              {
                type: 'tool_use',
                id: event.content_block.id ?? '',
                name: event.content_block.name ?? '',
                input: {},
                parentToolUseId: pid,
              },
            ];
            console.log(
              '[streamStore] Added tool_use block, new length:',
              state.contentBlocks.length,
            );
          }
          break;
        }

        case 'content_block_delta': {
          const idx = state.indexOffset + event.index;
          if (idx < 0 || idx >= state.contentBlocks.length) break;
          const block = { ...state.contentBlocks[idx] };

          if (event.delta.type === 'text_delta' && block.type === 'text') {
            block.text += event.delta.text ?? '';
            state.partialText += event.delta.text ?? '';
            console.log('[streamStore] Updated text delta, block index:', idx);
          } else if (event.delta.type === 'thinking_delta' && block.type === 'thinking') {
            block.thinking += event.delta.thinking ?? '';
            state.partialThinking += event.delta.thinking ?? '';
            console.log('[streamStore] Updated thinking delta, block index:', idx);
          } else if (event.delta.type === 'input_json_delta' && block.type === 'tool_use') {
            try {
              block.input = JSON.parse(event.delta.partial_json ?? '{}');
              console.log('[streamStore] Updated tool_use input, block index:', idx);
            } catch {
              // Partial JSON not yet parseable
            }
          }

          state.contentBlocks = [
            ...state.contentBlocks.slice(0, idx),
            block,
            ...state.contentBlocks.slice(idx + 1),
          ];
          break;
        }

        case 'content_block_stop':
          state.currentBlockIndex = -1;
          state.currentBlockType = '';
          break;

        case 'message_delta':
          if (event.usage) {
            state.tokenUsage = {
              input: event.usage.input_tokens,
              output: event.usage.output_tokens,
            };
          }
          break;

        case 'message_stop':
          state.status = 'idle';
          state.partialText = '';
          state.partialThinking = '';
          changesStore.stopTracking();
          break;

        case 'tool_approval_request':
          state.status = 'tool_pending';
          state.pendingApprovals = [
            ...state.pendingApprovals,
            {
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              input: event.input,
              description: event.description,
            },
          ];
          break;

        case 'tool_result': {
          const newResults = new Map(state.toolResults);
          newResults.set(event.toolCallId, {
            result: event.result,
            isError: event.isError,
            duration: event.duration,
          });
          state.toolResults = newResults;

          if (!event.isError && event.toolName) {
            const fileWriteTools = [
              'write_file',
              'edit_file',
              'create_file',
              'str_replace_editor',
              'Write',
              'Edit',
            ];
            if (fileWriteTools.includes(event.toolName) && event.filePath) {
              // Follow Along: derive the edit line before refresh so we can use
              // the pre-edit content to locate `old_string`.
              if (editorStore.followAlong) {
                let editLine = event.editLineHint;
                if (!editLine && event.toolCallId) {
                  for (let i = state.contentBlocks.length - 1; i >= 0; i--) {
                    const block = state.contentBlocks[i];
                    if (block.type === 'tool_use' && block.id === event.toolCallId) {
                      const tab = editorStore.tabs.find((t) => t.filePath === event.filePath);
                      editLine = extractEditLineHint(
                        event.toolName || block.name,
                        block.input as Record<string, unknown>,
                        tab?.content,
                      );
                      break;
                    }
                  }
                }
                if (editLine) {
                  editorStore.setFollowAlongTarget({
                    filePath: event.filePath,
                    line: editLine,
                  });
                }
                // Open the file as a tab in the primary pane (standard tab split)
                const filePath = event.filePath;
                const fileName = filePath.split('/').pop() ?? filePath;
                const language = detectLanguage(fileName);
                api.files
                  .read(filePath)
                  .then((res) => {
                    primaryPaneStore.openFileTab(filePath, res.data.content, language);
                  })
                  .catch(() => {
                    // File may not be readable — skip
                  });
              }

              // Refresh both editor-pane tabs and primary-pane file tabs
              editorStore.refreshFile(event.filePath);
              primaryPaneStore.refreshFileTab(event.filePath);

              let reasoning = '';
              for (let i = state.contentBlocks.length - 1; i >= 0; i--) {
                const block = state.contentBlocks[i];
                if (block.type === 'tool_use' && block.id === event.toolCallId) {
                  for (let j = i - 1; j >= 0; j--) {
                    const prev = state.contentBlocks[j];
                    if (prev.type === 'text' && prev.text) {
                      reasoning = prev.text.trim().slice(-500);
                      break;
                    }
                    if (prev.type === 'thinking' && prev.thinking) {
                      reasoning = prev.thinking.trim().slice(-500);
                      break;
                    }
                  }
                  break;
                }
              }

              changesStore.recordChange({
                path: event.filePath,
                toolName: event.toolName,
                toolCallId: event.toolCallId,
                summary: event.result?.slice(0, 500) || '',
                reasoning,
              });
            }
          }

          state.pendingApprovals = state.pendingApprovals.filter(
            (a) => a.toolCallId !== event.toolCallId,
          );
          if (state.pendingApprovals.length === 0 && state.status === 'tool_pending') {
            state.status = 'streaming';
          }
          break;
        }

        case 'verification_result': {
          const newVerifications = new Map(state.verifications);
          newVerifications.set(event.filePath, {
            passed: event.passed,
            issues: event.issues,
            tool: event.tool,
          });
          state.verifications = newVerifications;
          break;
        }

        case 'error':
          state.status = 'error';
          state.error = event.error.message;
          break;

        case 'ping':
          break;
      }
    },

    resolveApproval(toolCallId: string) {
      state.pendingApprovals = state.pendingApprovals.filter((a) => a.toolCallId !== toolCallId);
      if (state.pendingApprovals.length === 0) state.status = 'streaming';
    },

    cancel() {
      if (state.abortController) {
        state.abortController.abort();
        state.abortController = null;
      }
      state.status = 'cancelled';
      state.partialText = '';
      state.partialThinking = '';
    },

    reset() {
      state.status = 'idle';
      state.partialText = '';
      state.partialThinking = '';
      state.contentBlocks = [];
      state.currentBlockIndex = -1;
      state.pendingApprovals = [];
      state.toolResults = new Map();
      state.verifications = new Map();
      state.error = null;
      state.abortController = null;
      state.indexOffset = 0;
      state.currentParentId = null;
    },

    captureState(): StreamSnapshot {
      return {
        status: state.status,
        sessionId: state.sessionId,
        partialText: state.partialText,
        partialThinking: state.partialThinking,
        contentBlocks: [...state.contentBlocks],
        pendingApprovals: [...state.pendingApprovals],
        tokenUsage: { ...state.tokenUsage },
        error: state.error,
        abortController: state.abortController,
        toolResults: new Map(state.toolResults),
        indexOffset: state.indexOffset,
        currentParentId: state.currentParentId,
      };
    },

    restoreState(snapshot: StreamSnapshot | null) {
      if (!snapshot) {
        this.reset();
        return;
      }
      state.status = snapshot.status;
      state.sessionId = snapshot.sessionId;
      state.partialText = snapshot.partialText;
      state.partialThinking = snapshot.partialThinking;
      state.contentBlocks = snapshot.contentBlocks;
      state.currentBlockIndex = -1;
      state.currentBlockType = '';
      state.pendingApprovals = snapshot.pendingApprovals;
      state.tokenUsage = snapshot.tokenUsage;
      state.error = snapshot.error;
      state.abortController = snapshot.abortController;
      state.toolResults = snapshot.toolResults;
      state.indexOffset = snapshot.indexOffset;
      state.currentParentId = snapshot.currentParentId;
    },
  };
}

export const streamStore = createStreamStore();
