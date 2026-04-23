import { EventEmitter } from 'events';
import { watch, type FSWatcher } from 'fs';
import { stat } from 'fs/promises';
import { resolve, join } from 'path';

/**
 * File change event broadcast to subscribers.
 * `mtime` is the file's current modification time in ms (0 if the file is gone).
 */
export interface FileChangeEvent {
  type: 'change' | 'delete';
  path: string;
  mtime: number;
}

/**
 * Directories we never want to watch — they churn constantly and dwarf any real signal.
 */
const IGNORED_DIR_SEGMENTS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  '__pycache__',
  'target',
  '.venv',
]);

function shouldIgnore(path: string): boolean {
  for (const seg of IGNORED_DIR_SEGMENTS) {
    if (path.includes(`/${seg}/`) || path.endsWith(`/${seg}`)) return true;
  }
  return false;
}

class FileWatcherService extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private watchedRoot: string | null = null;
  /** Debounce map: path → timeout handle. Coalesces bursts of fs events per-path. */
  private pending = new Map<string, NodeJS.Timeout>();
  /** Debounce window in ms. Editor reloads wait until the writer is done. */
  private readonly debounceMs = 75;

  /**
   * Start watching a workspace root. If already watching the same root, this is a no-op;
   * switching roots tears down the old watcher first.
   */
  watch(rootPath: string): void {
    const absRoot = resolve(rootPath);
    if (this.watchedRoot === absRoot) return;

    this.stop();

    try {
      // Bun supports recursive: true on Linux + macOS.
      this.watcher = watch(absRoot, { recursive: true }, (_eventType, filename) => {
        if (!filename) return;
        const relPath = filename.toString();
        const absPath = join(absRoot, relPath);
        if (shouldIgnore(absPath)) return;
        this.queueEmit(absPath);
      });
      this.watcher.on('error', (err) => {
        console.error('[file-watcher] watcher error:', err);
      });
      this.watchedRoot = absRoot;
      console.log(`[file-watcher] watching ${absRoot}`);
    } catch (err) {
      console.error(`[file-watcher] failed to watch ${absRoot}:`, err);
      this.watcher = null;
      this.watchedRoot = null;
    }
  }

  /** Stop watching entirely. */
  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    this.watchedRoot = null;
    for (const t of this.pending.values()) clearTimeout(t);
    this.pending.clear();
  }

  /** Path currently being watched (absolute) or null. */
  get root(): string | null {
    return this.watchedRoot;
  }

  /** Coalesce events per-path and stat to classify change vs delete before emitting. */
  private queueEmit(absPath: string): void {
    const existing = this.pending.get(absPath);
    if (existing) clearTimeout(existing);
    const handle = setTimeout(async () => {
      this.pending.delete(absPath);
      try {
        const s = await stat(absPath);
        if (s.isDirectory()) return; // directory events aren't useful to editors
        this.emit('event', {
          type: 'change',
          path: absPath,
          mtime: s.mtimeMs,
        } satisfies FileChangeEvent);
      } catch {
        this.emit('event', {
          type: 'delete',
          path: absPath,
          mtime: 0,
        } satisfies FileChangeEvent);
      }
    }, this.debounceMs);
    this.pending.set(absPath, handle);
  }
}

export const fileWatcher = new FileWatcherService();
