import type { PermissionMode } from './tools.js';

export interface AgentProfile {
  id: string;
  name: string;
  description?: string;
  isBuiltIn: boolean;
  permissionMode: PermissionMode;
  allowedTools: string[];
  disallowedTools: string[];
  systemPrompt?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AgentProfileCreateInput {
  name: string;
  description?: string;
  permissionMode: PermissionMode;
  allowedTools?: string[];
  disallowedTools?: string[];
  systemPrompt?: string;
}

export interface AgentProfileUpdateInput {
  name?: string;
  description?: string;
  permissionMode?: PermissionMode;
  allowedTools?: string[];
  disallowedTools?: string[];
  systemPrompt?: string;
}

/**
 * Three built-in profiles that always exist and cannot be deleted.
 */
export const BUILT_IN_PROFILES: AgentProfile[] = [
  {
    id: 'write',
    name: 'Write',
    description: 'All tools available, unrestricted — full read/write access to the workspace',
    isBuiltIn: true,
    permissionMode: 'unrestricted',
    allowedTools: ['*'],
    disallowedTools: [],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'ask',
    name: 'Ask',
    description: 'Read-only tools only — no file writes, no terminal execution',
    isBuiltIn: true,
    permissionMode: 'safe',
    allowedTools: ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch'],
    disallowedTools: ['Write', 'Edit', 'Bash', 'NotebookEdit', 'Task'],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'No tools — pure LLM chat with no external access',
    isBuiltIn: true,
    permissionMode: 'plan',
    allowedTools: [],
    disallowedTools: ['*'],
    createdAt: 0,
    updatedAt: 0,
  },
];
