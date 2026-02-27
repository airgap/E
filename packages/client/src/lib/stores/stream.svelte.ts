import type { StreamEvent, MessageContent } from '@e/shared';
import { isMcpFileWriteTool, extractEditLineHint } from '@e/shared';
import { editorStore, detectLanguage } from './editor.svelte';
import { primaryPaneStore } from './primaryPane.svelte';
import { api } from '$lib/api/client';
import { artifactsStore } from './artifacts.svelte';
import { agentNotesStore } from './agent-notes.svelte';
import { canvasStore } from './canvas.svelte';
import { handleAgentTerminalEvent, resetAgentTerminal } from '$lib/services/agent-terminal';

// Context key for Svelte 5 context API - ensures proper reactivity tracking
export const STREAM_CONTEXT_KEY = Symbol('streamStore');

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

export interface PendingQuestion {
  toolCallId: string;
  questions: Array<{
    question: string;
    header?: string;
    options?: Array<{ label: string; description?: string }>;
    multiSelect?: boolean;
  }>;
}

export interface StreamSnapshot {
  status: StreamStatus;
  sessionId: string | null;
  conversationId: string | null;
  partialText: string;
  partialThinking: string;
  contentBlocks: MessageContent[];
  pendingApprovals: PendingApproval[];
  pendingQuestions: PendingQuestion[];
  tokenUsage: { input: number; output: number };
  error: string | null;
  abortController: AbortController | null;
  toolResults: Map<string, { result: string; isError: boolean; duration?: number }>;
  indexOffset: number;
  currentParentId: string | null;
}

function createStreamStore() {
  let status = $state<StreamStatus>('idle');
  /** True while reconnectActiveStream() is running — prevents other code from
   *  calling reset() and wiping out state being rebuilt from replayed events. */
  let reconnecting = $state(false);
  let sessionId = $state<string | null>(null);
  let conversationId = $state<string | null>(null);
  let partialText = $state('');
  let partialThinking = $state('');
  let contentBlocks = $state<MessageContent[]>([]);
  let currentBlockIndex = $state(-1);
  let currentBlockType = $state<string>('');
  let pendingApprovals = $state<PendingApproval[]>([]);
  let pendingQuestions = $state<PendingQuestion[]>([]);
  let tokenUsage = $state({ input: 0, output: 0 });
  let error = $state<string | null>(null);
  let abortController = $state<AbortController | null>(null);
  let toolResults = $state<Map<string, { result: string; isError: boolean; duration?: number }>>(
    new Map(),
  );
  let verifications = $state<
    Map<
      string,
      {
        passed: boolean;
        issues: Array<{ severity: string; line?: number; message: string; rule?: string }>;
      }
    >
  >(new Map());
  let contextWarning = $state<{
    inputTokens: number;
    contextLimit: number;
    usagePercent: number;
    autocompacted: boolean;
  } | null>(null);
  let compactBoundary = $state<{
    trigger: 'auto' | 'manual';
    pre_tokens: number;
    context_limit: number;
  } | null>(null);
  // Offset for mapping event indices to contentBlocks array positions.
  // Reset to contentBlocks.length on each message_start so sub-agent
  // events with index=0 map to the correct position in the flat array.
  let indexOffset = 0;
  let currentParentId = $state<string | null>(null);

  return {
    get status() {
      return status;
    },
    get sessionId() {
      return sessionId;
    },
    get conversationId() {
      return conversationId;
    },
    get partialText() {
      return partialText;
    },
    get partialThinking() {
      return partialThinking;
    },
    get contentBlocks() {
      return contentBlocks;
    },
    get pendingApprovals() {
      return pendingApprovals;
    },
    get pendingQuestions() {
      return pendingQuestions;
    },
    get tokenUsage() {
      return tokenUsage;
    },
    get error() {
      return error;
    },
    get isStreaming() {
      return (
        status === 'streaming' ||
        status === 'connecting' ||
        status === 'tool_pending' ||
        reconnecting
      );
    },
    get isReconnecting() {
      return reconnecting;
    },
    setReconnecting(v: boolean) {
      reconnecting = v;
    },
    get abortController() {
      return abortController;
    },
    get toolResults() {
      return toolResults;
    },
    get verifications() {
      return verifications;
    },
    get contextWarning() {
      return contextWarning;
    },
    get compactBoundary() {
      return compactBoundary;
    },

    setSessionId(id: string) {
      sessionId = id;
    },
    setConversationId(id: string) {
      conversationId = id;
    },
    setAbortController(ctrl: AbortController) {
      abortController = ctrl;
    },

    startStream(targetConversationId?: string) {
      status = 'connecting';
      partialText = '';
      partialThinking = '';
      contentBlocks = [];
      currentBlockIndex = -1;
      error = null;
      toolResults = new Map();
      pendingQuestions = [];
      indexOffset = 0;
      currentParentId = null;
      contextWarning = null;
      compactBoundary = null;
      if (targetConversationId) conversationId = targetConversationId;
    },

    handleEvent(event: StreamEvent) {
      // Forward tool events to the Agent terminal (opt-in via settings)
      handleAgentTerminalEvent(event);

      // console.log('[streamStore.handleEvent] Processing:', event.type);
      switch (event.type) {
        case 'message_start':
          status = 'streaming';
          // Each message_start begins a new index space. Sub-agent events
          // reuse index 0,1,2... so we offset them into the flat array.
          indexOffset = contentBlocks.length;
          currentParentId = (event as any).parent_tool_use_id || null;
          break;

        case 'content_block_start': {
          currentBlockIndex = event.index;
          currentBlockType = event.content_block.type;
          const pid = (event as any).parent_tool_use_id || currentParentId || undefined;
          if (event.content_block.type === 'text') {
            contentBlocks = [
              ...contentBlocks,
              { type: 'text', text: event.content_block.text ?? '', parentToolUseId: pid },
            ];
            // Text block added
          } else if (event.content_block.type === 'thinking') {
            contentBlocks = [
              ...contentBlocks,
              {
                type: 'thinking',
                thinking: event.content_block.thinking ?? '',
                parentToolUseId: pid,
              },
            ];
            // Thinking block added
          } else if (event.content_block.type === 'tool_use') {
            contentBlocks = [
              ...contentBlocks,
              {
                type: 'tool_use',
                id: event.content_block.id ?? '',
                name: event.content_block.name ?? '',
                input: {},
                parentToolUseId: pid,
              },
            ];
            // Tool use block added
          }
          break;
        }

        case 'content_block_delta': {
          // Map the event index to the actual position in contentBlocks
          const idx = indexOffset + event.index;
          if (idx < 0 || idx >= contentBlocks.length) break;
          const prev = contentBlocks[idx];

          // Build a fully new object — never mutate before reassign,
          // or Svelte 5's reactivity tracking won't detect the change.
          let updated: MessageContent;
          if (event.delta.type === 'text_delta' && prev.type === 'text') {
            updated = { ...prev, text: prev.text + (event.delta.text ?? '') };
            partialText += event.delta.text ?? '';
          } else if (event.delta.type === 'thinking_delta' && prev.type === 'thinking') {
            updated = { ...prev, thinking: prev.thinking + (event.delta.thinking ?? '') };
            partialThinking += event.delta.thinking ?? '';
          } else if (event.delta.type === 'input_json_delta' && prev.type === 'tool_use') {
            try {
              updated = { ...prev, input: JSON.parse(event.delta.partial_json ?? '{}') };
            } catch {
              // Partial JSON not yet parseable
              updated = prev;
            }
          } else {
            updated = prev;
          }

          contentBlocks = [
            ...contentBlocks.slice(0, idx),
            updated,
            ...contentBlocks.slice(idx + 1),
          ];
          break;
        }

        case 'content_block_stop':
          currentBlockIndex = -1;
          currentBlockType = '';
          break;

        case 'message_delta':
          if (event.usage) {
            tokenUsage = {
              input: event.usage.input_tokens,
              output: event.usage.output_tokens,
            };
          }
          break;

        case 'message_stop':
          // Don't drop to idle if we're still waiting for user input
          if (pendingQuestions.length === 0 && pendingApprovals.length === 0) {
            status = 'idle';
          }
          partialText = '';
          partialThinking = '';
          break;

        case 'tool_approval_request':
          status = 'tool_pending';
          pendingApprovals = [
            ...pendingApprovals,
            {
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              input: event.input,
              description: event.description,
            },
          ];
          break;

        case 'user_question_request':
          status = 'tool_pending';
          pendingQuestions = [
            ...pendingQuestions,
            {
              toolCallId: event.toolCallId,
              questions: event.questions,
            },
          ];
          break;

        case 'tool_result': {
          // Track the result
          const newResults = new Map(toolResults);
          newResults.set(event.toolCallId, {
            result: event.result,
            isError: event.isError,
            duration: event.duration,
          });
          toolResults = newResults;

          // Refresh editor tabs when file-writing tools complete
          // Supports both built-in tools and MCP tools (e.g. desktop-commander)
          if (!event.isError && event.toolName) {
            const builtinFileWriteTools = [
              'write_file',
              'edit_file',
              'create_file',
              'str_replace_editor',
              'Write',
              'Edit',
            ];
            const isFileWrite =
              builtinFileWriteTools.includes(event.toolName) || isMcpFileWriteTool(event.toolName);
            if (isFileWrite && event.filePath) {
              if (editorStore.followAlong) {
                // Follow Along: derive the edit line before refresh so we can use the
                // pre-edit file content to locate `old_string`.
                let editLine = event.editLineHint;
                if (!editLine && event.toolCallId) {
                  for (let i = contentBlocks.length - 1; i >= 0; i--) {
                    const block = contentBlocks[i];
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
                // Open the file as a tab in the primary pane (standard tab split)
                const filePath = event.filePath;
                const fileName = filePath.split('/').pop() ?? filePath;
                const language = detectLanguage(fileName);
                api.files
                  .read(filePath)
                  .then((res) => {
                    primaryPaneStore.openFileTab(filePath, res.data.content, language);
                    // Refresh the file content first
                    editorStore.refreshFile(filePath);
                    primaryPaneStore.refreshFileTab(filePath);
                    // Set the follow-along scroll target *after* refreshing so content is loaded
                    if (editLine) {
                      // Use a small delay to ensure the refresh completes
                      setTimeout(() => {
                        editorStore.setFollowAlongTarget({
                          filePath: filePath,
                          line: editLine,
                        });
                      }, 100);
                    }
                  })
                  .catch(() => {
                    // File may not be readable — skip
                  });
              }
            }
          }

          // Remove from pending questions only — approvals must be resolved
          // explicitly by the user clicking Allow/Deny. The tool_result event
          // arrives almost immediately after tool_approval_request (the CLI
          // doesn't pause for client approval), so clearing pendingApprovals
          // here would dismiss the dialog before the user ever sees it.
          pendingQuestions = pendingQuestions.filter((q) => q.toolCallId !== event.toolCallId);
          if (
            pendingApprovals.length === 0 &&
            pendingQuestions.length === 0 &&
            status === 'tool_pending'
          ) {
            status = 'streaming';
          }
          break;
        }

        case 'error':
          status = 'error';
          error = event.error.message;
          // Clear session ID on recoverable server errors so the next send
          // creates a fresh session instead of reusing the failed one.
          if (
            event.error.type === 'timeout' ||
            event.error.type === 'activity_timeout' ||
            event.error.type === 'cli_error'
          ) {
            sessionId = null;
          }
          break;

        case 'verification_result': {
          const newVerifications = new Map(verifications);
          newVerifications.set(event.filePath, {
            passed: event.passed,
            issues: event.issues,
          });
          verifications = newVerifications;
          break;
        }

        case 'ping':
          break;

        case 'context_warning':
          contextWarning = {
            inputTokens: event.inputTokens,
            contextLimit: event.contextLimit,
            usagePercent: event.usagePercent,
            autocompacted: event.autocompacted,
          };
          break;

        case 'compact_boundary':
          compactBoundary = {
            trigger: event.trigger,
            pre_tokens: event.pre_tokens,
            context_limit: event.context_limit,
          };
          break;

        case 'artifact_created':
          // Forward to the artifacts store so the sidebar updates in real time
          if (event.artifact) {
            artifactsStore.addFromStream(event.artifact);
          }
          break;

        case 'agent_note_created':
          // Forward to the agent notes store so the sidebar updates in real time
          if (event.note) {
            agentNotesStore.addFromStream(event.note);
          }
          break;

        case 'canvas_update':
          // Forward to the canvas store so the canvas panel updates in real time
          canvasStore.handleUpdate(event);
          break;

        case 'cross_session_message':
          // Cross-session messages are handled by the cross-session store
          // via its own SSE connection. This case is here for completeness.
          break;

        case 'api_retry':
          // Server is retrying after an API hang — keep streaming status
          status = 'streaming';
          break;
      }
    },

    resolveApproval(toolCallId: string) {
      pendingApprovals = pendingApprovals.filter((a) => a.toolCallId !== toolCallId);
      if (pendingApprovals.length === 0 && pendingQuestions.length === 0) status = 'streaming';
    },

    resolveQuestion(toolCallId: string) {
      pendingQuestions = pendingQuestions.filter((q) => q.toolCallId !== toolCallId);
      if (pendingQuestions.length === 0 && pendingApprovals.length === 0) status = 'streaming';
    },

    cancel() {
      if (abortController) {
        abortController.abort();
        abortController = null;
      }
      status = 'cancelled';
      partialText = '';
      partialThinking = '';
    },

    reset() {
      status = 'idle';
      sessionId = null;
      conversationId = null;
      partialText = '';
      partialThinking = '';
      contentBlocks = [];
      currentBlockIndex = -1;
      pendingApprovals = [];
      pendingQuestions = [];
      toolResults = new Map();
      verifications = new Map();
      error = null;
      abortController = null;
      indexOffset = 0;
      currentParentId = null;
      resetAgentTerminal();
    },

    captureState(): StreamSnapshot {
      return {
        status,
        sessionId,
        conversationId,
        partialText,
        partialThinking,
        contentBlocks: [...contentBlocks],
        pendingApprovals: [...pendingApprovals],
        pendingQuestions: [...pendingQuestions],
        tokenUsage: { ...tokenUsage },
        error,
        abortController,
        toolResults: new Map(toolResults),
        indexOffset,
        currentParentId,
      };
    },

    restoreState(snapshot: StreamSnapshot | null) {
      if (!snapshot) {
        this.reset();
        return;
      }
      status = snapshot.status;
      sessionId = snapshot.sessionId;
      conversationId = snapshot.conversationId;
      partialText = snapshot.partialText;
      partialThinking = snapshot.partialThinking;
      contentBlocks = snapshot.contentBlocks;
      currentBlockIndex = -1;
      currentBlockType = '';
      pendingApprovals = snapshot.pendingApprovals;
      pendingQuestions = snapshot.pendingQuestions;
      tokenUsage = snapshot.tokenUsage;
      error = snapshot.error;
      abortController = snapshot.abortController;
      toolResults = snapshot.toolResults;
      indexOffset = snapshot.indexOffset;
      currentParentId = snapshot.currentParentId;
    },
  };
}

export const streamStore = createStreamStore();

// ── HMR state preservation ────────────────────────────────────────────────
// When Vite hot-reloads this module, the singleton is recreated with default
// state.  Preserve critical fields (sessionId, status, contentBlocks, etc.)
// so the UI doesn't lose an in-flight stream.
if (import.meta.hot) {
  const hmrData = (import.meta.hot.data ?? {}) as { snapshot?: StreamSnapshot };
  if (hmrData?.snapshot) {
    console.log('[stream:hmr] Restoring stream state from previous module');
    streamStore.restoreState(hmrData.snapshot);
  }

  import.meta.hot.dispose((data: Record<string, unknown>) => {
    // Only snapshot if there's an active session worth preserving
    if (streamStore.sessionId) {
      console.log('[stream:hmr] Saving stream snapshot before dispose');
      data.snapshot = streamStore.captureState();
    }
  });
}
