export type AgentType = 'explore' | 'plan' | 'general-purpose' | 'bash' | 'custom';

export type AgentStatus = 'spawning' | 'running' | 'completed' | 'error' | 'cancelled';

export interface Agent {
  id: string;
  type: AgentType;
  description: string;
  status: AgentStatus;
  prompt: string;
  result?: string;
  error?: string;
  parentSessionId: string;
  spawnedAt: number;
  completedAt?: number;
  model?: string;
  maxTurns?: number;
  turnCount: number;
}

export interface AgentSpawnInput {
  type: AgentType;
  description: string;
  prompt: string;
  model?: string;
  maxTurns?: number;
  runInBackground?: boolean;
}
