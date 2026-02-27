/**
 * Agent Notes — persistent messages/reports left by agents for the user.
 *
 * Unlike artifacts (conversation-scoped), agent notes are workspace-scoped
 * so they persist across conversations and are visible in a dedicated sidebar panel.
 * Agents use notes to deliver research results, recommendations, status reports,
 * or any other information the user should review later.
 */

export type AgentNoteStatus = 'unread' | 'read' | 'archived';

export type AgentNoteCategory =
  | 'research'
  | 'report'
  | 'recommendation'
  | 'status'
  | 'general'
  | 'skill-proposal';

export interface AgentNote {
  id: string;
  workspacePath: string;
  conversationId?: string;
  storyId?: string;
  /** Title of the note (short summary) */
  title: string;
  /** Full markdown content of the note */
  content: string;
  /** Category for filtering */
  category: AgentNoteCategory;
  /** Read/unread/archived status */
  status: AgentNoteStatus;
  /** Optional metadata (e.g. agent model, quality results) */
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface AgentNoteCreateInput {
  workspacePath: string;
  conversationId?: string;
  storyId?: string;
  title: string;
  content: string;
  category?: AgentNoteCategory;
  metadata?: Record<string, unknown>;
}

export interface AgentNoteUpdateInput {
  title?: string;
  content?: string;
  category?: AgentNoteCategory;
  status?: AgentNoteStatus;
  metadata?: Record<string, unknown>;
}
