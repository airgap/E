export type MemoryCategory =
  | 'convention'
  | 'decision'
  | 'preference'
  | 'pattern'
  | 'context'
  | 'architecture'
  | 'naming'
  | 'forbidden'
  | 'testing';

export type MemorySource = 'auto' | 'manual';

export interface WorkspaceMemory {
  id: string;
  workspacePath: string;
  category: MemoryCategory;
  key: string;
  content: string;
  source: MemorySource;
  confidence: number; // 0.0 - 1.0
  timesSeen: number;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceMemoryCreate {
  workspacePath: string;
  category: MemoryCategory;
  key: string;
  content: string;
  source?: MemorySource;
  confidence?: number;
}

export interface WorkspaceMemoryUpdate {
  category?: MemoryCategory;
  key?: string;
  content?: string;
  confidence?: number;
}
