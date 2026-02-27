/**
 * Task Runner Store — client-side state for workspace task discovery.
 *
 * Fetches tasks from the server (package.json scripts + Makefile targets),
 * tracks recently run tasks, and provides reactive state for the UI dropdown.
 */

import type { WorkspaceTask, TaskDiscoveryResponse, PackageManager } from '@e/shared';
import { getAuthToken } from '$lib/api/client';

// ── localStorage keys ──
const RECENT_TASKS_KEY = 'e-task-runner-recent';
const MAX_RECENT_TASKS = 5;

// ── Persistence helpers ──

function loadRecentTasks(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECENT_TASKS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // ignore
  }
  return [];
}

function saveRecentTasks(taskIds: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(RECENT_TASKS_KEY, JSON.stringify(taskIds));
  } catch {
    // ignore
  }
}

// ── Store ──

function createTaskRunnerStore() {
  // --- State ---
  let tasks = $state<WorkspaceTask[]>([]);
  let packageManager = $state<PackageManager | null>(null);
  let recentTaskIds = $state<string[]>(loadRecentTasks());
  let loading = $state(false);
  let error = $state<string | null>(null);
  let workspacePath = $state<string | null>(null);

  // --- Derived ---
  const hasTasks = $derived(tasks.length > 0);

  /** Tasks sorted with recent items first */
  const sortedTasks = $derived.by(() => {
    if (recentTaskIds.length === 0) return tasks;

    const recentSet = new Set(recentTaskIds);
    const recent: WorkspaceTask[] = [];
    const rest: WorkspaceTask[] = [];

    for (const task of tasks) {
      if (recentSet.has(task.id)) {
        recent.push(task);
      } else {
        rest.push(task);
      }
    }

    // Sort recent tasks by recency (most recent first)
    recent.sort((a, b) => {
      return recentTaskIds.indexOf(a.id) - recentTaskIds.indexOf(b.id);
    });

    return [...recent, ...rest];
  });

  /** Package.json tasks only */
  const packageTasks = $derived(tasks.filter((t) => t.source === 'package.json'));

  /** Makefile tasks only */
  const makefileTasks = $derived(tasks.filter((t) => t.source === 'Makefile'));

  return {
    // ── Getters ──
    get tasks() {
      return tasks;
    },
    get packageManager() {
      return packageManager;
    },
    get recentTaskIds() {
      return recentTaskIds;
    },
    get loading() {
      return loading;
    },
    get error() {
      return error;
    },
    get hasTasks() {
      return hasTasks;
    },
    get sortedTasks() {
      return sortedTasks;
    },
    get packageTasks() {
      return packageTasks;
    },
    get makefileTasks() {
      return makefileTasks;
    },
    get workspacePath() {
      return workspacePath;
    },

    // ── Actions ──

    /** Load tasks from the server for a given workspace */
    async loadTasks(wsPath: string): Promise<void> {
      workspacePath = wsPath;
      loading = true;
      error = null;

      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        const token = getAuthToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch(
          `/api/task-runner/discover?workspacePath=${encodeURIComponent(wsPath)}`,
          { headers },
        );

        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(body.error || `HTTP ${res.status}`);
        }

        const json = (await res.json()) as { ok: boolean; data: TaskDiscoveryResponse };
        if (json.ok && json.data) {
          tasks = json.data.tasks;
          packageManager = json.data.packageManager;
        }
      } catch (err) {
        error = (err as Error).message;
        tasks = [];
        packageManager = null;
      } finally {
        loading = false;
      }
    },

    /** Force refresh tasks from the server */
    async refreshTasks(): Promise<void> {
      if (!workspacePath) return;

      loading = true;
      error = null;

      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        const token = getAuthToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch(
          `/api/task-runner/refresh?workspacePath=${encodeURIComponent(workspacePath)}`,
          { method: 'POST', headers },
        );

        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(body.error || `HTTP ${res.status}`);
        }

        const json = (await res.json()) as { ok: boolean; data: TaskDiscoveryResponse };
        if (json.ok && json.data) {
          tasks = json.data.tasks;
          packageManager = json.data.packageManager;
        }
      } catch (err) {
        error = (err as Error).message;
      } finally {
        loading = false;
      }
    },

    /** Record a task as recently run (moves it to the top of recents) */
    recordRecentTask(taskId: string): void {
      const filtered = recentTaskIds.filter((id) => id !== taskId);
      recentTaskIds = [taskId, ...filtered].slice(0, MAX_RECENT_TASKS);
      saveRecentTasks(recentTaskIds);
    },

    /** Check if a task ID is in the recent list */
    isRecent(taskId: string): boolean {
      return recentTaskIds.includes(taskId);
    },

    /** Clear all state */
    clear(): void {
      tasks = [];
      packageManager = null;
      error = null;
      loading = false;
      workspacePath = null;
    },
  };
}

export const taskRunnerStore = createTaskRunnerStore();
