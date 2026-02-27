import { EventEmitter } from 'events';
import { watch, readFileSync } from 'fs';
import type { FSWatcher } from 'fs';
import { nanoid } from 'nanoid';

export interface AmbientNotification {
  id: string;
  workspacePath: string;
  type: 'todo_added' | 'test_failure' | 'build_error' | 'git_conflict' | 'type_error';
  severity: 'info' | 'warning' | 'error';
  title: string;
  message: string;
  file?: string;
  line?: number;
  suggestion?: string;
  createdAt: number;
  dismissed: boolean;
}

const WATCHED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.svelte', '.py', '.go', '.rs']);

const IGNORED_PATH_SEGMENTS = ['node_modules', '.git', 'dist', 'build', '.svelte-kit', 'coverage'];

const TODO_PATTERN = /\/\/\s*(TODO|FIXME)[:\s]+(.*)/gi;
const TODO_PATTERN_HASH = /#\s*(TODO|FIXME)[:\s]+(.*)/gi;
const MAX_NOTIFICATIONS = 50;
const DEBOUNCE_MS = 2000;

function shouldIgnorePath(filePath: string): boolean {
  return IGNORED_PATH_SEGMENTS.some(
    (segment) => filePath.includes(`/${segment}/`) || filePath.includes(`\\${segment}\\`),
  );
}

function hasWatchedExtension(filePath: string): boolean {
  const dot = filePath.lastIndexOf('.');
  if (dot === -1) return false;
  return WATCHED_EXTENSIONS.has(filePath.slice(dot));
}

function extractTodos(content: string): Set<string> {
  const todos = new Set<string>();

  // Reset lastIndex before use since we use global flag
  let match: RegExpExecArray | null;

  const slashPattern = /\/\/\s*(TODO|FIXME)[:\s]+(.*)/gi;
  while ((match = slashPattern.exec(content)) !== null) {
    todos.add(`${match[1].toUpperCase()}:${match[2].trim()}`);
  }

  const hashPattern = /#\s*(TODO|FIXME)[:\s]+(.*)/gi;
  while ((match = hashPattern.exec(content)) !== null) {
    todos.add(`${match[1].toUpperCase()}:${match[2].trim()}`);
  }

  return todos;
}

function findTodoLine(content: string, todoText: string): number | undefined {
  const lines = content.split('\n');
  const keyword = todoText.startsWith('FIXME') ? 'FIXME' : 'TODO';
  const body = todoText.slice(keyword.length + 1); // strip "TODO:" or "FIXME:"

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (
      line.toUpperCase().includes(keyword) &&
      line.includes(body.slice(0, 20)) // partial match of the body
    ) {
      return i + 1; // 1-indexed
    }
  }
  return undefined;
}

class AmbientAgent {
  readonly events = new EventEmitter();

  private watchers = new Map<string, FSWatcher>();
  private notifications = new Map<string, AmbientNotification[]>();
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private todoCache = new Map<string, Set<string>>();

  startWatching(workspacePath: string): void {
    if (this.watchers.has(workspacePath)) return;

    try {
      const watcher = watch(workspacePath, { recursive: true }, (eventType, filename) => {
        if (!filename) return;

        const fullPath = `${workspacePath}/${filename}`;

        if (shouldIgnorePath(fullPath)) return;
        if (!hasWatchedExtension(fullPath)) return;

        // Debounce per file
        const existing = this.debounceTimers.get(fullPath);
        if (existing) clearTimeout(existing);

        const timer = setTimeout(() => {
          this.debounceTimers.delete(fullPath);
          this.scanFile(workspacePath, fullPath);
        }, DEBOUNCE_MS);

        this.debounceTimers.set(fullPath, timer);
      });

      watcher.on('error', (err) => {
        console.error(`[AmbientAgent] Watcher error for ${workspacePath}:`, err);
      });

      this.watchers.set(workspacePath, watcher);

      if (!this.notifications.has(workspacePath)) {
        this.notifications.set(workspacePath, []);
      }
    } catch (err) {
      console.error(`[AmbientAgent] Failed to start watching ${workspacePath}:`, err);
      throw err;
    }
  }

  stopWatching(workspacePath: string): void {
    const watcher = this.watchers.get(workspacePath);
    if (!watcher) return;

    watcher.close();
    this.watchers.delete(workspacePath);

    // Cancel any pending debounce timers for this workspace
    for (const [filePath, timer] of this.debounceTimers.entries()) {
      if (filePath.startsWith(workspacePath)) {
        clearTimeout(timer);
        this.debounceTimers.delete(filePath);
      }
    }

    // Clean up TODO cache for this workspace
    for (const filePath of this.todoCache.keys()) {
      if (filePath.startsWith(workspacePath)) {
        this.todoCache.delete(filePath);
      }
    }
  }

  isWatching(workspacePath: string): boolean {
    return this.watchers.has(workspacePath);
  }

  getNotifications(workspacePath: string): AmbientNotification[] {
    return (this.notifications.get(workspacePath) ?? []).filter((n) => !n.dismissed);
  }

  dismissNotification(id: string): void {
    for (const notifs of this.notifications.values()) {
      const notif = notifs.find((n) => n.id === id);
      if (notif) {
        notif.dismissed = true;
        return;
      }
    }
  }

  clearNotifications(workspacePath: string): void {
    this.notifications.set(workspacePath, []);
  }

  private addNotification(notif: AmbientNotification): void {
    const list = this.notifications.get(notif.workspacePath) ?? [];

    list.push(notif);

    // Drop oldest notifications if over the limit
    while (list.length > MAX_NOTIFICATIONS) {
      list.shift();
    }

    this.notifications.set(notif.workspacePath, list);
    this.events.emit('notification', notif);
  }

  private scanFile(workspacePath: string, filePath: string): void {
    let content: string;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch {
      // File may have been deleted or is not readable
      return;
    }

    const currentTodos = extractTodos(content);
    const knownTodos = this.todoCache.get(filePath) ?? new Set<string>();

    // Find newly added TODOs/FIXMEs
    for (const todo of currentTodos) {
      if (!knownTodos.has(todo)) {
        const keyword = todo.startsWith('FIXME') ? 'FIXME' : 'TODO';
        const body = todo.slice(keyword.length + 1);
        const lineNumber = findTodoLine(content, todo);

        const notif: AmbientNotification = {
          id: nanoid(),
          workspacePath,
          type: 'todo_added',
          severity: keyword === 'FIXME' ? 'warning' : 'info',
          title: `New ${keyword} detected`,
          message: body,
          file: filePath,
          line: lineNumber,
          suggestion: keyword === 'FIXME' ? 'Fix this issue' : 'Address this TODO',
          createdAt: Date.now(),
          dismissed: false,
        };

        this.addNotification(notif);
      }
    }

    // Update cache with current state
    this.todoCache.set(filePath, currentTodos);
  }
}

export const ambientAgent = new AmbientAgent();
