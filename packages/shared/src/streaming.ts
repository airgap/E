import type { Task } from './tasks.js';
import type { UserStory, StreamLoopEvent } from './prd.js';
import type { Artifact } from './artifacts.js';
import type { AgentNote } from './agent-notes.js';
import type { CrossSessionMessage } from './cross-session.js';

// SSE event types matching Claude's stream-json format
export type StreamEvent =
  | StreamMessageStart
  | StreamContentBlockStart
  | StreamContentBlockDelta
  | StreamContentBlockStop
  | StreamMessageDelta
  | StreamMessageStop
  | StreamToolUseStart
  | StreamToolResult
  | StreamToolApprovalRequest
  | StreamUserQuestionRequest
  | StreamError
  | StreamPing
  | StreamTaskUpdate
  | StreamStoryUpdate
  | StreamAgentEvent
  | StreamVerificationResult
  | StreamLoopEvent
  | StreamContextWarning
  | StreamCompactBoundary
  | StreamArtifactCreated
  | StreamAgentNoteCreated
  | StreamCommentary
  | StreamCrossSessionMessage
  | StreamApiRetry
  | StreamCanvasUpdate
  | StreamCanvasInteraction;

export interface StreamMessageStart {
  type: 'message_start';
  message: {
    id: string;
    role: 'assistant';
    model: string;
  };
  parent_tool_use_id?: string | null;
}

export interface StreamContentBlockStart {
  type: 'content_block_start';
  index: number;
  content_block: {
    type: 'text' | 'thinking' | 'tool_use';
    id?: string;
    name?: string;
    text?: string;
    thinking?: string;
  };
  parent_tool_use_id?: string | null;
}

export interface StreamContentBlockDelta {
  type: 'content_block_delta';
  index: number;
  delta: {
    type: 'text_delta' | 'thinking_delta' | 'input_json_delta';
    text?: string;
    thinking?: string;
    partial_json?: string;
  };
  parent_tool_use_id?: string | null;
}

export interface StreamContentBlockStop {
  type: 'content_block_stop';
  index: number;
  parent_tool_use_id?: string | null;
}

export interface StreamMessageDelta {
  type: 'message_delta';
  delta: {
    stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
  };
  usage?: {
    output_tokens: number;
    input_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export interface StreamMessageStop {
  type: 'message_stop';
}

export interface StreamToolUseStart {
  type: 'tool_use_start';
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface StreamToolResult {
  type: 'tool_result';
  toolCallId: string;
  result: string;
  isError: boolean;
  duration?: number;
  toolName?: string;
  filePath?: string;
  /** Approximate line number where the edit occurred — used by Follow Along to scroll the editor. */
  editLineHint?: number;
}

export interface StreamToolApprovalRequest {
  type: 'tool_approval_request';
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  description: string;
}

export interface StreamUserQuestionRequest {
  type: 'user_question_request';
  toolCallId: string;
  questions: Array<{
    question: string;
    header?: string;
    options?: Array<{ label: string; description?: string }>;
    multiSelect?: boolean;
  }>;
}

export interface StreamError {
  type: 'error';
  error: {
    type: string;
    message: string;
  };
}

export interface StreamPing {
  type: 'ping';
}

/**
 * @deprecated Use StreamStoryUpdate instead. Tasks have been unified into stories.
 */
export interface StreamTaskUpdate {
  type: 'task_update';
  task: Task;
}

/** Emitted when a story's status or data changes during loop execution or manual updates. */
export interface StreamStoryUpdate {
  type: 'story_update';
  story: UserStory;
}

export interface StreamAgentEvent {
  type: 'agent_event';
  agentId: string;
  event: 'spawned' | 'progress' | 'completed' | 'error';
  data?: unknown;
}

export interface StreamVerificationResult {
  type: 'verification_result';
  filePath: string;
  passed: boolean;
  issues: Array<{
    severity: 'error' | 'warning' | 'info';
    line?: number;
    message: string;
    rule?: string;
  }>;
  tool: string;
  duration: number;
}

/**
 * Emitted when the conversation context is approaching the model's limit.
 * `autocompacted` is true when the server already applied compaction automatically.
 */
export interface StreamContextWarning {
  type: 'context_warning';
  inputTokens: number;
  contextLimit: number;
  usagePercent: number;
  autocompacted: boolean;
}

/**
 * Emitted immediately when autocompaction fires — mirrors Claude Code's
 * `compact_boundary` system event. The client can use this to show a
 * "conversation compacted" divider in the message list.
 */
export interface StreamCompactBoundary {
  type: 'compact_boundary';
  trigger: 'auto' | 'manual';
  pre_tokens: number;
  context_limit: number;
}

/**
 * Emitted when an agent extracts and stores an artifact from its output.
 * The Artifacts panel listens for this to update in real time.
 */
export interface StreamArtifactCreated {
  type: 'artifact_created';
  artifact: Artifact;
}

/**
 * Emitted when an agent creates a note/report for the user.
 * The Agent Notes panel listens for this to update in real time.
 */
export interface StreamAgentNoteCreated {
  type: 'agent_note_created';
  note: AgentNote;
}

/**
 * Emitted as color-commentary during agent work — personality-flavored
 * observations about what the agent is doing, intended for ambient display.
 */
export interface StreamCommentary {
  type: 'commentary';
  text: string;
  timestamp: number;
  personality: string;
  workspaceId: string;
}

/**
 * Emitted when a cross-session message is received from another agent/conversation.
 * Displayed as a distinct message type in the receiving conversation.
 */
export interface StreamCrossSessionMessage {
  type: 'cross_session_message';
  message: CrossSessionMessage;
}

/**
 * Emitted when the server detects an API hang and automatically retries
 * by spawning a new CLI process with --resume.
 */
export interface StreamApiRetry {
  type: 'api_retry';
  attempt: number;
}

/**
 * Emitted when an agent pushes content to the canvas.
 * The canvas renders live visual content (HTML/SVG/Mermaid/tables).
 */
export interface StreamCanvasUpdate {
  type: 'canvas_update';
  canvasId: string;
  contentType: 'html' | 'svg' | 'mermaid' | 'table';
  content: string;
  title?: string;
  conversationId: string;
}

/**
 * Emitted when a user interacts with canvas elements (click, hover).
 * Sent from client to agent to report user actions on the canvas.
 */
export interface StreamCanvasInteraction {
  type: 'canvas_interaction';
  canvasId: string;
  interactionType: 'click' | 'hover';
  elementId?: string;
  coordinates?: { x: number; y: number };
  timestamp: number;
}
