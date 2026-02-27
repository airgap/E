import type { LoopState, UserStory, StoryPriority } from '@e/shared';

// Priority ordering for story selection
export const PRIORITY_ORDER: Record<StoryPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

// --- Row mappers ---

export function storyFromRow(row: any): UserStory {
  return {
    id: row.id,
    prdId: row.prd_id || null,
    workspacePath: row.workspace_path || undefined,
    title: row.title,
    description: row.description,
    acceptanceCriteria: JSON.parse(row.acceptance_criteria || '[]'),
    priority: row.priority,
    dependsOn: JSON.parse(row.depends_on || '[]'),
    dependencyReasons: JSON.parse(row.dependency_reasons || '{}'),
    status: row.status,
    taskId: row.task_id,
    agentId: row.agent_id,
    conversationId: row.conversation_id,
    commitSha: row.commit_sha,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    learnings: JSON.parse(row.learnings || '[]'),
    researchOnly: !!row.research_only,
    externalRef: row.external_ref ? JSON.parse(row.external_ref) : undefined,
    externalStatus: row.external_status || undefined,
    // Executor metadata (distributed coordination)
    executorId: row.executor_id || undefined,
    executorType: row.executor_type || undefined,
    machineId: row.machine_id || undefined,
    startedAt: row.started_at || undefined,
    lastHeartbeat: row.last_heartbeat || undefined,
    assignedBranch: row.assigned_branch || undefined,
    leaseExpiresAt: row.lease_expires_at || undefined,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function loopFromRow(row: any): LoopState {
  return {
    id: row.id,
    prdId: row.prd_id || null,
    workspacePath: row.workspace_path,
    status: row.status,
    config: JSON.parse(row.config || '{}'),
    currentIteration: row.current_iteration,
    currentStoryId: row.current_story_id,
    currentAgentId: row.current_agent_id,
    startedAt: row.started_at,
    pausedAt: row.paused_at,
    completedAt: row.completed_at,
    totalStoriesCompleted: row.total_stories_completed,
    totalStoriesFailed: row.total_stories_failed,
    totalIterations: row.total_iterations,
    iterationLog: JSON.parse(row.iteration_log || '[]'),
    lastHeartbeat: row.last_heartbeat ?? undefined,
    activeStoryIds: row.active_story_ids ? JSON.parse(row.active_story_ids) : undefined,
  };
}
