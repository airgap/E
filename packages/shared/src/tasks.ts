/**
 * @deprecated Use StoryStatus from prd.ts instead. Tasks have been unified into stories.
 */
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'deleted';

/**
 * @deprecated Use UserStory from prd.ts instead. Tasks have been unified into stories
 * as standalone stories (prdId = null).
 */
export interface Task {
  id: string;
  subject: string;
  description: string;
  activeForm?: string;
  status: TaskStatus;
  owner?: string;
  blocks: string[];
  blockedBy: string[];
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

/**
 * @deprecated Use StandaloneStoryCreateInput from prd.ts instead.
 */
export interface TaskCreateInput {
  subject: string;
  description: string;
  activeForm?: string;
  metadata?: Record<string, unknown>;
}

/**
 * @deprecated Tasks have been unified into stories. Use story update APIs instead.
 */
export interface TaskUpdateInput {
  taskId: string;
  status?: TaskStatus;
  subject?: string;
  description?: string;
  activeForm?: string;
  owner?: string;
  addBlocks?: string[];
  addBlockedBy?: string[];
  metadata?: Record<string, unknown>;
}
