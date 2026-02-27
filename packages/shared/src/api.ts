import type { Settings } from './settings.js';
import type { MCPTransport, MCPScope } from './mcp.js';

// --- Conversations ---
export interface CreateConversationRequest {
  title?: string;
  model?: string;
  systemPrompt?: string;
  workspacePath?: string;
  permissionMode?: string;
  effort?: string;
  maxBudgetUsd?: number;
  maxTurns?: number;
  allowedTools?: string[];
  disallowedTools?: string[];
  planMode?: boolean;
}

export interface SendMessageRequest {
  content: string;
  attachments?: Attachment[];
}

export interface Attachment {
  type: 'file' | 'image';
  path?: string;
  /** base64-encoded file content (for images) or plain text (for text files) */
  content?: string;
  mimeType?: string;
  name: string;
  /** File size in bytes (for display purposes) */
  size?: number;
}

// --- Tool Approval ---
export interface ToolApprovalResponse {
  toolCallId: string;
  approved: boolean;
  alwaysApprove?: boolean; // "allow always" for this tool pattern
}

// --- Settings ---
export interface UpdateSettingsRequest {
  settings: Partial<Settings>;
}

// --- MCP ---
export interface AddMCPServerRequest {
  name: string;
  transport: MCPTransport;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  scope: MCPScope;
}

// --- Memory ---
export interface UpdateMemoryRequest {
  path: string;
  content: string;
}

// --- Tasks ---
// TaskCreateInput and TaskUpdateInput are in tasks.ts

// --- Agents ---
// AgentSpawnInput is in agents.ts

// --- Plan Mode ---
export interface PlanApprovalRequest {
  approved: boolean;
  clearContext?: boolean;
  autoAcceptEdits?: boolean;
}

// --- Generic ---
export interface APIResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}
