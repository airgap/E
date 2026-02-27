import type {
  ScheduledTask,
  ScheduledTaskCreateInput,
  ScheduledTaskUpdateInput,
  ScheduledTaskWithStats,
  ScheduledTaskExecution,
} from '@e/shared';

const API_BASE = '';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `Request failed: ${response.statusText}`);
  }

  const data = await response.json();
  return data.data;
}

export const scheduledTasksApi = {
  /**
   * List all scheduled tasks for a workspace
   */
  async list(workspaceId: string): Promise<ScheduledTaskWithStats[]> {
    return request(`/api/scheduled-tasks?workspaceId=${encodeURIComponent(workspaceId)}`);
  },

  /**
   * Get a single scheduled task
   */
  async get(taskId: string): Promise<ScheduledTask> {
    return request(`/api/scheduled-tasks/${taskId}`);
  },

  /**
   * Create a new scheduled task
   */
  async create(input: ScheduledTaskCreateInput): Promise<ScheduledTask> {
    return request('/api/scheduled-tasks', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  /**
   * Update a scheduled task
   */
  async update(taskId: string, input: ScheduledTaskUpdateInput): Promise<ScheduledTask> {
    return request(`/api/scheduled-tasks/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  },

  /**
   * Delete a scheduled task
   */
  async delete(taskId: string): Promise<void> {
    return request(`/api/scheduled-tasks/${taskId}`, {
      method: 'DELETE',
    });
  },

  /**
   * Pause a task
   */
  async pause(taskId: string): Promise<void> {
    return request(`/api/scheduled-tasks/${taskId}/pause`, {
      method: 'POST',
    });
  },

  /**
   * Resume a task
   */
  async resume(taskId: string): Promise<void> {
    return request(`/api/scheduled-tasks/${taskId}/resume`, {
      method: 'POST',
    });
  },

  /**
   * Run a task immediately
   */
  async runNow(taskId: string): Promise<{ executionId: string }> {
    return request(`/api/scheduled-tasks/${taskId}/run`, {
      method: 'POST',
    });
  },

  /**
   * Get execution history for a task
   */
  async getExecutions(taskId: string, limit?: number): Promise<ScheduledTaskExecution[]> {
    const queryParams = limit ? `?limit=${limit}` : '';
    return request(`/api/scheduled-tasks/${taskId}/executions${queryParams}`);
  },
};
