/** Shared store for tracking ongoing git operations across all UI components.
 *
 * Errors are persisted to sessionStorage so they survive HMR reloads —
 * a common scenario when pre-commit hooks run builds/tests that touch
 * source files and trigger Vite's hot-module-replacement.
 */

export interface GitOperation {
  type: 'commit' | 'push';
  progress: string[];
  error: string | null;
  inProgress: boolean;
  timestamp: number;
}

const STORAGE_KEY = 'e:git-op-errors';

interface PersistedErrors {
  commit: { error: string; progress: string[]; timestamp: number } | null;
  push: { error: string; progress: string[]; timestamp: number } | null;
}

function loadPersistedErrors(): PersistedErrors {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { commit: null, push: null };
    const parsed = JSON.parse(raw) as PersistedErrors;
    // Expire errors older than 5 minutes
    const cutoff = Date.now() - 5 * 60 * 1000;
    if (parsed.commit && parsed.commit.timestamp < cutoff) parsed.commit = null;
    if (parsed.push && parsed.push.timestamp < cutoff) parsed.push = null;
    if (parsed.commit || parsed.push) {
      console.log('[gitOps] Restored persisted errors:', {
        commit: parsed.commit?.error,
        push: parsed.push?.error,
      });
    }
    return parsed;
  } catch (err) {
    console.warn('[gitOps] Failed to load persisted errors from sessionStorage:', err);
    return { commit: null, push: null };
  }
}

function persistErrors(commit: GitOperation, push: GitOperation) {
  try {
    const data: PersistedErrors = {
      commit: commit.error
        ? {
            error: commit.error,
            progress: commit.progress.slice(-20),
            timestamp: commit.timestamp || Date.now(),
          }
        : null,
      push: push.error
        ? {
            error: push.error,
            progress: push.progress.slice(-20),
            timestamp: push.timestamp || Date.now(),
          }
        : null,
    };
    if (data.commit || data.push) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // sessionStorage unavailable — ignore
  }
}

function clearPersistedErrors() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Strip ANSI escape sequences (colors, cursor movement, etc.) from a string.
 * Git, nx, prettier, and other CLI tools emit these when they detect a TTY or
 * when `--color=always` is set. They render as garbled `[32m` in HTML.
 */
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?(?:\x07|\x1b\\)|\x1b[()][0-9A-B]/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

function createGitOperationsStore() {
  // Restore any errors that survived a page reload
  const restored = loadPersistedErrors();

  let commitOperation = $state<GitOperation>({
    type: 'commit',
    progress: restored.commit?.progress ?? [],
    error: restored.commit?.error ?? null,
    inProgress: false,
    timestamp: restored.commit?.timestamp ?? 0,
  });

  let pushOperation = $state<GitOperation>({
    type: 'push',
    progress: restored.push?.progress ?? [],
    error: restored.push?.error ?? null,
    inProgress: false,
    timestamp: restored.push?.timestamp ?? 0,
  });

  return {
    get commitOperation() {
      return commitOperation;
    },
    get pushOperation() {
      return pushOperation;
    },
    get hasActiveOperation() {
      return commitOperation.inProgress || pushOperation.inProgress;
    },
    /** True when there's an error from a recent commit or push */
    get hasError() {
      return !!(commitOperation.error || pushOperation.error);
    },

    startCommit() {
      console.log('[gitOps] startCommit');
      commitOperation = {
        type: 'commit',
        progress: [],
        error: null,
        inProgress: true,
        timestamp: Date.now(),
      };
      persistErrors(commitOperation, pushOperation);
    },

    addCommitProgress(message: string) {
      if (!commitOperation.inProgress) {
        console.warn('[gitOps] addCommitProgress DROPPED (not in progress):', message);
        return;
      }
      commitOperation.progress = [...commitOperation.progress, stripAnsi(message)];
    },

    setCommitError(error: string) {
      const clean = stripAnsi(error);
      console.error('[gitOps] setCommitError:', clean);
      commitOperation.error = clean;
      persistErrors(commitOperation, pushOperation);
    },

    endCommit(success: boolean) {
      console.log('[gitOps] endCommit success=%s error=%s', success, commitOperation.error);
      commitOperation.inProgress = false;
      if (success && !commitOperation.error) {
        // Auto-clear successful commits after 2 seconds
        setTimeout(() => {
          if (!commitOperation.error) {
            commitOperation = {
              type: 'commit',
              progress: [],
              error: null,
              inProgress: false,
              timestamp: 0,
            };
            persistErrors(commitOperation, pushOperation);
          }
        }, 2000);
      } else {
        persistErrors(commitOperation, pushOperation);
      }
    },

    startPush() {
      pushOperation = {
        type: 'push',
        progress: [],
        error: null,
        inProgress: true,
        timestamp: Date.now(),
      };
      persistErrors(commitOperation, pushOperation);
    },

    addPushProgress(message: string) {
      if (pushOperation.inProgress) {
        pushOperation.progress = [...pushOperation.progress, stripAnsi(message)];
      }
    },

    setPushError(error: string) {
      pushOperation.error = stripAnsi(error);
      persistErrors(commitOperation, pushOperation);
    },

    endPush(success: boolean) {
      pushOperation.inProgress = false;
      if (success && !pushOperation.error) {
        // Auto-clear successful pushes after 2 seconds
        setTimeout(() => {
          if (!pushOperation.error) {
            pushOperation = {
              type: 'push',
              progress: [],
              error: null,
              inProgress: false,
              timestamp: 0,
            };
            persistErrors(commitOperation, pushOperation);
          }
        }, 2000);
      } else {
        persistErrors(commitOperation, pushOperation);
      }
    },

    clearCommit() {
      commitOperation = {
        type: 'commit',
        progress: [],
        error: null,
        inProgress: false,
        timestamp: 0,
      };
      persistErrors(commitOperation, pushOperation);
    },

    clearPush() {
      pushOperation = {
        type: 'push',
        progress: [],
        error: null,
        inProgress: false,
        timestamp: 0,
      };
      persistErrors(commitOperation, pushOperation);
    },

    clearAll() {
      this.clearCommit();
      this.clearPush();
      clearPersistedErrors();
    },
  };
}

export const gitOperationsStore = createGitOperationsStore();
