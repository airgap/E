/**
 * @deprecated Use workStore (work.svelte.ts) instead.
 * Standalone tasks are now stories with prdId=null in the unified Work pane.
 * This store is kept for backward compatibility during transition.
 */
import type { Task, TaskStatus } from '@e/shared';

function createTaskStore() {
  let tasks = $state<Task[]>([]);
  let loading = $state(false);

  return {
    get tasks() {
      return tasks;
    },
    get loading() {
      return loading;
    },
    get pending() {
      return tasks.filter((t) => t.status === 'pending');
    },
    get inProgress() {
      return tasks.filter((t) => t.status === 'in_progress');
    },
    get completed() {
      return tasks.filter((t) => t.status === 'completed');
    },
    get count() {
      return tasks.length;
    },

    setTasks(list: Task[]) {
      tasks = list;
    },
    setLoading(v: boolean) {
      loading = v;
    },

    addTask(task: Task) {
      tasks = [...tasks, task];
    },

    updateTask(taskId: string, updates: Partial<Task>) {
      tasks = tasks.map((t) => (t.id === taskId ? { ...t, ...updates } : t));
    },

    removeTask(taskId: string) {
      tasks = tasks.filter((t) => t.id !== taskId);
    },

    getTask(taskId: string): Task | undefined {
      return tasks.find((t) => t.id === taskId);
    },

    // Check if a task is blocked
    isBlocked(taskId: string): boolean {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return false;
      return task.blockedBy.some((id) => {
        const blocker = tasks.find((t) => t.id === id);
        return blocker && blocker.status !== 'completed';
      });
    },
  };
}

export const taskStore = createTaskStore();
