/**
 * TaskRunnerService — discovers workspace tasks from package.json scripts
 * and Makefile targets. Caches results per workspace and watches for file
 * changes to invalidate the cache automatically.
 *
 * Supports auto-detection of package managers: npm, yarn, pnpm, bun.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { PackageManager, WorkspaceTask, TaskDiscoveryResponse } from '@e/shared';

// ---------------------------------------------------------------------------
// File-system helpers
// ---------------------------------------------------------------------------

function fileExists(filePath: string): boolean {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function readFileSync(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Package Manager Detection
// ---------------------------------------------------------------------------

const LOCKFILE_MAP: Record<string, PackageManager> = {
  'bun.lockb': 'bun',
  'bun.lock': 'bun',
  'pnpm-lock.yaml': 'pnpm',
  'yarn.lock': 'yarn',
  'package-lock.json': 'npm',
};

function detectPackageManager(workspacePath: string): PackageManager | null {
  // Check lockfiles in priority order (more specific first)
  for (const [lockfile, pm] of Object.entries(LOCKFILE_MAP)) {
    if (fileExists(path.join(workspacePath, lockfile))) {
      return pm;
    }
  }

  // If package.json exists but no lockfile, default to npm
  if (fileExists(path.join(workspacePath, 'package.json'))) {
    return 'npm';
  }

  return null;
}

// ---------------------------------------------------------------------------
// Package.json Script Discovery
// ---------------------------------------------------------------------------

function discoverPackageJsonTasks(
  workspacePath: string,
  packageManager: PackageManager,
): WorkspaceTask[] {
  const pkgPath = path.join(workspacePath, 'package.json');
  const content = readFileSync(pkgPath);
  if (!content) return [];

  try {
    const pkg = JSON.parse(content);
    const scripts = pkg.scripts;
    if (!scripts || typeof scripts !== 'object') return [];

    const tasks: WorkspaceTask[] = [];
    for (const [name, command] of Object.entries(scripts)) {
      if (typeof command !== 'string') continue;

      const execution = `${packageManager} run ${name}`;
      tasks.push({
        id: `package.json:${name}`,
        name,
        source: 'package.json',
        command,
        execution,
      });
    }

    return tasks;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Makefile Target Discovery
// ---------------------------------------------------------------------------

/** Regex to match Makefile target lines (e.g. "build:", "test: dep1 dep2") */
const MAKEFILE_TARGET_RE = /^([a-zA-Z0-9_][\w.-]*)(?:\s*:(?!=))/;

/** Targets that are typically internal / not useful to run directly */
const MAKEFILE_INTERNAL_TARGETS = new Set([
  '.PHONY',
  '.DEFAULT',
  '.PRECIOUS',
  '.INTERMEDIATE',
  '.SECONDARY',
  '.SECONDEXPANSION',
  '.DELETE_ON_ERROR',
  '.IGNORE',
  '.LOW_RESOLUTION_TIME',
  '.SILENT',
  '.EXPORT_ALL_VARIABLES',
  '.NOTPARALLEL',
  '.ONESHELL',
  '.POSIX',
  '.SUFFIXES',
]);

function discoverMakefileTasks(workspacePath: string): WorkspaceTask[] {
  const makefilePath = path.join(workspacePath, 'Makefile');
  const content = readFileSync(makefilePath);
  if (!content) return [];

  const tasks: WorkspaceTask[] = [];
  const seen = new Set<string>();

  for (const line of content.split('\n')) {
    const match = MAKEFILE_TARGET_RE.exec(line);
    if (!match) continue;

    const name = match[1];

    // Skip internal/special targets and duplicates
    if (MAKEFILE_INTERNAL_TARGETS.has(name)) continue;
    if (seen.has(name)) continue;

    // Skip pattern rules (contain %)
    if (name.includes('%')) continue;

    seen.add(name);
    tasks.push({
      id: `Makefile:${name}`,
      name,
      source: 'Makefile',
      command: `make ${name}`,
      execution: `make ${name}`,
    });
  }

  return tasks;
}

// ---------------------------------------------------------------------------
// Cache Entry
// ---------------------------------------------------------------------------

interface CacheEntry {
  response: TaskDiscoveryResponse;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// TaskRunnerService
// ---------------------------------------------------------------------------

class TaskRunnerService {
  /** Cached task discovery results keyed by workspace path */
  private cache = new Map<string, CacheEntry>();

  /** Active file-system watchers keyed by workspace path */
  private watchers = new Map<string, fs.FSWatcher[]>();

  /** Debounce timers for cache invalidation */
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Discover all tasks in a workspace. Results are cached and automatically
   * invalidated when package.json or Makefile changes.
   */
  discover(workspacePath: string): TaskDiscoveryResponse {
    // Check cache first
    const cached = this.cache.get(workspacePath);
    if (cached) {
      return cached.response;
    }

    // Detect package manager
    const packageManager = detectPackageManager(workspacePath);

    // Discover tasks from all sources
    const tasks: WorkspaceTask[] = [];

    if (packageManager) {
      tasks.push(...discoverPackageJsonTasks(workspacePath, packageManager));
    }

    tasks.push(...discoverMakefileTasks(workspacePath));

    const response: TaskDiscoveryResponse = {
      packageManager,
      tasks,
    };

    // Cache the result
    this.cache.set(workspacePath, {
      response,
      timestamp: Date.now(),
    });

    // Set up file watchers for auto-invalidation
    this.setupWatchers(workspacePath);

    return response;
  }

  /**
   * Force refresh the task cache for a workspace.
   */
  refresh(workspacePath: string): TaskDiscoveryResponse {
    this.invalidateCache(workspacePath);
    return this.discover(workspacePath);
  }

  /**
   * Stop watching a workspace and clear its cache.
   */
  unwatch(workspacePath: string): void {
    this.invalidateCache(workspacePath);
    this.teardownWatchers(workspacePath);
  }

  /**
   * Clean up all watchers and caches (for graceful shutdown).
   */
  dispose(): void {
    for (const wsPath of this.watchers.keys()) {
      this.teardownWatchers(wsPath);
    }
    this.cache.clear();
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  // ── Internal ──

  private invalidateCache(workspacePath: string): void {
    this.cache.delete(workspacePath);
  }

  private setupWatchers(workspacePath: string): void {
    // Avoid setting up duplicate watchers
    if (this.watchers.has(workspacePath)) return;

    const watcherList: fs.FSWatcher[] = [];
    const filesToWatch = ['package.json', 'Makefile'];

    for (const file of filesToWatch) {
      const filePath = path.join(workspacePath, file);
      if (!fileExists(filePath)) continue;

      try {
        const watcher = fs.watch(filePath, () => {
          // Debounce: invalidate cache after short delay
          const existing = this.debounceTimers.get(workspacePath);
          if (existing) clearTimeout(existing);

          this.debounceTimers.set(
            workspacePath,
            setTimeout(() => {
              this.invalidateCache(workspacePath);
              this.debounceTimers.delete(workspacePath);
            }, 500),
          );
        });

        watcher.on('error', () => {
          // Silently ignore watcher errors (file may be deleted)
        });

        watcherList.push(watcher);
      } catch {
        // Ignore errors setting up watchers (file may not exist or be inaccessible)
      }
    }

    if (watcherList.length > 0) {
      this.watchers.set(workspacePath, watcherList);
    }
  }

  private teardownWatchers(workspacePath: string): void {
    const watcherList = this.watchers.get(workspacePath);
    if (watcherList) {
      for (const w of watcherList) {
        try {
          w.close();
        } catch {
          // ignore
        }
      }
      this.watchers.delete(workspacePath);
    }

    const timer = this.debounceTimers.get(workspacePath);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(workspacePath);
    }
  }
}

/** Singleton instance */
export const taskRunnerService = new TaskRunnerService();
