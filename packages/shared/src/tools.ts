export interface ToolDefinition {
  name: string;
  description: string;
  category: ToolCategory;
  inputSchema: Record<string, unknown>;
  requiresApproval: boolean;
  source: 'builtin' | 'mcp';
  mcpServer?: string;
}

export type ToolCategory =
  | 'filesystem' // Read, Write, Edit, Glob, Grep
  | 'execution' // Bash, start_process
  | 'web' // WebFetch, WebSearch
  | 'agent' // Task (sub-agents)
  | 'task' // TaskCreate, TaskUpdate, TaskList, TaskGet
  | 'planning' // EnterPlanMode, ExitPlanMode
  | 'notebook' // NotebookEdit
  | 'device' // Screenshot, Camera, Location
  | 'mcp' // MCP-provided tools
  | 'other';

export interface ToolExecution {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  output?: string;
  error?: string;
  status: 'pending_approval' | 'running' | 'completed' | 'failed' | 'denied';
  startedAt?: number;
  completedAt?: number;
  duration?: number;
  approvalState?: 'pending' | 'approved' | 'denied';
}

export interface PermissionRule {
  id: string;
  type: 'allow' | 'deny' | 'ask';
  tool: string;
  pattern?: string; // e.g., "git push:*"
  scope: 'session' | 'project' | 'global';
}

export type PermissionMode = 'plan' | 'safe' | 'fast' | 'unrestricted';

export type TerminalCommandPolicy = 'off' | 'auto' | 'turbo' | 'custom';

export interface PermissionRulePreset {
  id: string;
  name: string;
  description: string;
  rules: Omit<PermissionRule, 'id' | 'scope'>[];
}

/**
 * Default permission rule presets for common workflows.
 * Each preset provides a curated set of allow/deny/ask rules.
 */
export const PERMISSION_PRESETS: PermissionRulePreset[] = [
  {
    id: 'safe-coding',
    name: 'Safe Coding',
    description: 'Read-only tools auto-approved, all writes require confirmation',
    rules: [
      { type: 'allow', tool: 'Read' },
      { type: 'allow', tool: 'Glob' },
      { type: 'allow', tool: 'Grep' },
      { type: 'allow', tool: 'WebFetch' },
      { type: 'allow', tool: 'WebSearch' },
      { type: 'ask', tool: 'Write' },
      { type: 'ask', tool: 'Edit' },
      { type: 'ask', tool: 'Bash' },
      { type: 'ask', tool: 'NotebookEdit' },
      { type: 'deny', tool: 'Bash', pattern: 'rm -rf *' },
      { type: 'deny', tool: 'Bash', pattern: 'sudo *' },
    ],
  },
  {
    id: 'full-auto',
    name: 'Full Auto',
    description: 'All tools auto-approved — maximum speed, minimum friction',
    rules: [{ type: 'allow', tool: '*' }],
  },
  {
    id: 'read-only',
    name: 'Read Only',
    description: 'Only allow reading and searching — no modifications',
    rules: [
      { type: 'allow', tool: 'Read' },
      { type: 'allow', tool: 'Glob' },
      { type: 'allow', tool: 'Grep' },
      { type: 'allow', tool: 'WebFetch' },
      { type: 'allow', tool: 'WebSearch' },
      { type: 'deny', tool: 'Write' },
      { type: 'deny', tool: 'Edit' },
      { type: 'deny', tool: 'Bash' },
      { type: 'deny', tool: 'NotebookEdit' },
    ],
  },
  {
    id: 'cautious-terminal',
    name: 'Cautious Terminal',
    description: 'File edits auto-approved, but terminal commands always ask',
    rules: [
      { type: 'allow', tool: 'Read' },
      { type: 'allow', tool: 'Glob' },
      { type: 'allow', tool: 'Grep' },
      { type: 'allow', tool: 'WebFetch' },
      { type: 'allow', tool: 'WebSearch' },
      { type: 'allow', tool: 'Write' },
      { type: 'allow', tool: 'Edit' },
      { type: 'allow', tool: 'NotebookEdit' },
      { type: 'ask', tool: 'Bash' },
      { type: 'deny', tool: 'Bash', pattern: 'rm -rf *' },
      { type: 'deny', tool: 'Bash', pattern: 'sudo *' },
      { type: 'deny', tool: 'Bash', pattern: 'git push --force*' },
    ],
  },
];
