/**
 * Swarm Coordinator - Multi-Agent Parallel Execution
 *
 * Spawns sub-agents with restricted toolsets in isolated contexts.
 * Supports both in-process isolation and process-based workers.
 *
 * Architecture:
 * - SwarmGroup: A collection of agents working on related tasks
 * - SwarmAgent: An individual worker within a swarm
 * - SwarmTask: A unit of work assigned to an agent
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type SwarmAgentStatus = 'idle' | 'working' | 'completed' | 'failed' | 'cancelled';
export type SwarmGroupStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'completed_partial'
  | 'failed'
  | 'cancelled';
export type SwarmIsolation = 'in_process' | 'worktree' | 'container';

export interface SwarmToolPermission {
  /** Tool name or glob pattern */
  tool: string;
  /** Whether this tool is allowed */
  allowed: boolean;
}

export interface SwarmAgentConfig {
  /** Display name for this agent */
  name: string;
  /** Color for output identification (hex) */
  color: string;
  /** Model to use */
  model: string;
  /** System prompt override */
  systemPrompt?: string;
  /** Tool restrictions (allowlist) */
  toolPermissions: SwarmToolPermission[];
  /** Isolation mode */
  isolation: SwarmIsolation;
  /** Maximum turns before force-stopping */
  maxTurns: number;
}

export interface SwarmTask {
  id: string;
  groupId: string;
  agentId?: string;
  title: string;
  description: string;
  /** Dependencies: task IDs that must complete before this starts */
  dependsOn: string[];
  status: SwarmAgentStatus;
  result?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  /** Worktree path (if isolation === 'worktree') */
  worktreePath?: string;
  /** Branch name (if isolation === 'worktree') */
  branchName?: string;
}

export interface SwarmAgent {
  id: string;
  groupId: string;
  config: SwarmAgentConfig;
  status: SwarmAgentStatus;
  currentTaskId?: string;
  tasksCompleted: number;
  tasksFailed: number;
  startedAt?: number;
  lastActivityAt?: number;
}

export interface SwarmGroup {
  id: string;
  name: string;
  workspacePath: string;
  status: SwarmGroupStatus;
  agents: SwarmAgent[];
  tasks: SwarmTask[];
  config: SwarmGroupConfig;
  createdAt: number;
  completedAt?: number;
  /** Originating loop ID (if spawned from a loop) */
  loopId?: string;
  /** Originating story ID (if spawned from a story) */
  storyId?: string;
}

export interface SwarmGroupConfig {
  /** Maximum concurrent agents */
  maxConcurrent: number;
  /** Auto-merge worktree results on success */
  autoMerge: boolean;
  /** Fail the group if any task fails */
  failFast: boolean;
  /** Default agent config (can be overridden per-agent) */
  defaultAgentConfig: Omit<SwarmAgentConfig, 'name' | 'color'>;
}

// ─── Agent Colors ────────────────────────────────────────────────────────────
// Distinct colors for up to 8 concurrent agents

export const SWARM_AGENT_COLORS = [
  '#FF6B6B', // Red
  '#4ECDC4', // Teal
  '#FFE66D', // Yellow
  '#A29BFE', // Lavender
  '#FD79A8', // Pink
  '#00B894', // Green
  '#E17055', // Orange
  '#74B9FF', // Blue
];

// ─── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_SWARM_AGENT_CONFIG: Omit<SwarmAgentConfig, 'name' | 'color'> = {
  model: 'claude-sonnet-4-6',
  toolPermissions: [
    { tool: 'read_file', allowed: true },
    { tool: 'write_file', allowed: true },
    { tool: 'edit_file', allowed: true },
    { tool: 'bash', allowed: true },
    { tool: 'glob', allowed: true },
    { tool: 'grep', allowed: true },
  ],
  isolation: 'worktree',
  maxTurns: 50,
};

export const DEFAULT_SWARM_GROUP_CONFIG: SwarmGroupConfig = {
  maxConcurrent: 3,
  autoMerge: true,
  failFast: false,
  defaultAgentConfig: DEFAULT_SWARM_AGENT_CONFIG,
};

// ─── SSE Event ───────────────────────────────────────────────────────────────

export interface StreamSwarmEvent {
  type: 'swarm_event';
  groupId: string;
  event:
    | 'group_started'
    | 'agent_started'
    | 'task_assigned'
    | 'task_completed'
    | 'task_failed'
    | 'agent_done'
    | 'group_completed';
  data: {
    agentId?: string;
    agentName?: string;
    agentColor?: string;
    taskId?: string;
    taskTitle?: string;
    message?: string;
    status?: SwarmGroupStatus;
    result?: string;
  };
}
