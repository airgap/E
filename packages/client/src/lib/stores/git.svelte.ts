import { api } from '$lib/api/client';

export interface GitFileStatus {
  path: string;
  status: string; // M, A, D, U, R
  staged: boolean;
}

export interface DiagnosticCheck {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  detail?: string;
}

/** A diagnostic snapshot captured during a commit phase */
export interface CommitPhaseDiagnostic {
  phase: 'before-staging' | 'after-staging' | 'after-commit';
  message: string;
  porcelain: string;
  fileCount: number;
  timestamp: number;
}

function createGitStore() {
  let isRepo = $state(false);
  let branch = $state('');
  /**
   * Ahead/behind counts vs the current branch's upstream (LYK-1010).
   * Set to 0/0 with hasUpstream=false when the branch has no upstream
   * configured — the status bar shows just the branch name in that case.
   */
  let ahead = $state(0);
  let behind = $state(0);
  let hasUpstream = $state(false);
  let fileStatuses = $state<GitFileStatus[]>([]);
  /** Set of repo-relative paths that match .gitignore rules. Populated lazily
   *  (only on startPolling and on manual refreshIgnored calls) because
   *  `--ignored` is expensive on large repos. */
  let ignoredPaths = $state<Set<string>>(new Set());
  /** True when .git/index.lock exists — a git operation is in progress. */
  let indexLocked = $state(false);
  let pollTimer = $state<ReturnType<typeof setInterval> | null>(null);

  // Monotonic counter — prevents stale in-flight poll responses from
  // overwriting fresher data (e.g. a commit's refresh beating a poll).
  let refreshSeq = 0;

  // Throttle: minimum interval between refresh calls (ms).
  // Calls within this window are coalesced — only the last one fires.
  const REFRESH_THROTTLE_MS = 2000;
  let lastRefreshStart = 0;
  let pendingRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  // Diagnostic state
  let diagnosticChecks = $state<DiagnosticCheck[]>([]);
  let diagnosing = $state(false);
  let lastDiagnoseTime = $state<number | null>(null);

  // Commit phase diagnostics (populated during streaming commit)
  let commitDiagnostics = $state<CommitPhaseDiagnostic[]>([]);

  function getStatus(filePath: string): string | null {
    // Git returns paths relative to the repo root; the tree gives us absolute
    // paths. Match on full equality or suffix `/<relpath>` so we don't
    // false-match sibling files that share a basename.
    for (const f of fileStatuses) {
      if (filePath === f.path || filePath.endsWith('/' + f.path)) {
        return f.status;
      }
    }
    return null;
  }

  /**
   * Is this absolute path gitignored? Requires `refreshIgnored()` to have run
   * for the current repo root; otherwise returns false.
   */
  function isIgnored(filePath: string): boolean {
    if (ignoredPaths.size === 0 || !lastPolledRoot) return false;
    const rel =
      filePath === lastPolledRoot
        ? ''
        : filePath.startsWith(lastPolledRoot + '/')
          ? filePath.slice(lastPolledRoot.length + 1)
          : null;
    if (rel === null) return false;
    if (ignoredPaths.has(rel)) return true;
    // Git's --ignored=matching lists ignored files, and also ignored dirs as
    // path-with-trailing-slash. A file under an ignored dir won't be in the
    // set itself, so walk up its parents and check for a trailing-slash match.
    const parts = rel.split('/');
    while (parts.length > 0) {
      parts.pop();
      const dir = parts.join('/');
      if (ignoredPaths.has(dir + '/')) return true;
    }
    return false;
  }

  /**
   * Rolled-up status for a directory. Returns the most notable status of any
   * tracked change under it (conflict > delete > modify > untracked > add >
   * rename), or null when clean. Useful for tinting folder rows in a tree.
   */
  function getDirStatus(dirPath: string): string | null {
    if (!lastPolledRoot) return null;
    // Normalize to an absolute prefix with a trailing slash so "src" doesn't
    // match "src-tauri/".
    const dirAbs = dirPath.endsWith('/') ? dirPath.slice(0, -1) : dirPath;
    const dirRel =
      dirAbs === lastPolledRoot
        ? ''
        : dirAbs.startsWith(lastPolledRoot + '/')
          ? dirAbs.slice(lastPolledRoot.length + 1)
          : null;
    if (dirRel === null) return null;

    const rank: Record<string, number> = { U: 6, D: 5, M: 4, '?': 3, A: 2, R: 1 };
    let best: string | null = null;
    let bestRank = 0;
    const prefix = dirRel === '' ? '' : dirRel + '/';
    for (const f of fileStatuses) {
      if (prefix === '' || f.path === dirRel || f.path.startsWith(prefix)) {
        const r = rank[f.status] ?? 0;
        if (r > bestRank) {
          bestRank = r;
          best = f.status;
        }
      }
    }
    return best;
  }

  /** Repo root of the last refresh — used by getDirStatus to resolve absolute→relative. */
  let lastPolledRoot: string | null = null;

  async function refresh(rootPath: string, { force = false } = {}) {
    // Throttle: if a refresh started recently, defer this call.
    const now = Date.now();
    const elapsed = now - lastRefreshStart;
    if (!force && elapsed < REFRESH_THROTTLE_MS) {
      // Coalesce: cancel any pending deferred refresh and schedule a new one
      if (pendingRefreshTimer) clearTimeout(pendingRefreshTimer);
      pendingRefreshTimer = setTimeout(() => {
        pendingRefreshTimer = null;
        refresh(rootPath, { force: true });
      }, REFRESH_THROTTLE_MS - elapsed);
      return;
    }
    lastRefreshStart = now;
    lastPolledRoot = rootPath;
    if (pendingRefreshTimer) {
      clearTimeout(pendingRefreshTimer);
      pendingRefreshTimer = null;
    }

    const seq = ++refreshSeq;
    console.log('[gitStore.refresh] seq=%d path=%s', seq, rootPath);
    try {
      const [statusRes, branchRes, branchStatusRes] = await Promise.all([
        api.git.status(rootPath),
        api.git.branch(rootPath),
        api.git.branchStatus(rootPath).catch(() => null),
      ]);
      // A newer refresh was started while we were awaiting — discard this stale result.
      if (seq !== refreshSeq) {
        console.log('[gitStore.refresh] seq=%d stale (current=%d), discarding', seq, refreshSeq);
        return;
      }
      const prevIsRepo = isRepo;
      const prevFileCount = fileStatuses.length;
      isRepo = statusRes.data.isRepo;
      fileStatuses = statusRes.data.files;
      indexLocked = statusRes.data.indexLocked ?? false;
      branch = branchRes.data.branch;
      if (branchStatusRes?.ok) {
        ahead = branchStatusRes.data.ahead;
        behind = branchStatusRes.data.behind;
        hasUpstream = branchStatusRes.data.hasUpstream;
      } else {
        ahead = 0;
        behind = 0;
        hasUpstream = false;
      }
      // Log state transitions that affect commit UI visibility
      if (prevIsRepo && !isRepo) {
        console.warn('[gitStore.refresh] isRepo changed TRUE→FALSE — commit UI will be hidden');
      }
      if (prevFileCount > 0 && fileStatuses.length === 0) {
        console.warn(
          '[gitStore.refresh] isDirty changed TRUE→FALSE (files: %d→0) — commit UI will be hidden',
          prevFileCount,
        );
      }
      console.log(
        '[gitStore.refresh] seq=%d done: isRepo=%s branch=%s files=%d',
        seq,
        isRepo,
        branch,
        fileStatuses.length,
      );
    } catch (err) {
      if (seq !== refreshSeq) {
        console.log(
          '[gitStore.refresh] seq=%d stale after error (current=%d), discarding',
          seq,
          refreshSeq,
        );
        return;
      }
      console.error(
        '[gitStore.refresh] FAILED — setting isRepo=false, fileStatuses=[] (commit UI will be hidden). Error:',
        err,
      );
      isRepo = false;
      fileStatuses = [];
      indexLocked = false;
      branch = '';
      ahead = 0;
      behind = 0;
      hasUpstream = false;
    }
  }

  /**
   * Fetch the list of gitignored paths. This is expensive on large repos so
   * we only do it on workspace switch / user request, not every poll.
   * Git itself doesn't change .gitignore during a session often enough to
   * justify periodic refetch.
   */
  async function refreshIgnored(rootPath: string): Promise<void> {
    try {
      const res = await api.git.status(rootPath, { ignored: true });
      if (res.ok && res.data.isRepo) {
        ignoredPaths = new Set(res.data.ignored);
      }
    } catch {
      // Non-fatal — file tree just won't dim gitignored entries.
    }
  }

  function startPolling(rootPath: string, interval = 5000) {
    stopPolling();
    refresh(rootPath);
    void refreshIgnored(rootPath);
    pollTimer = setInterval(() => refresh(rootPath), interval);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function diagnose(
    rootPath: string,
  ): Promise<{ ok: boolean; checks?: DiagnosticCheck[]; error?: string }> {
    diagnosing = true;
    try {
      const res = await api.git.diagnose(rootPath);
      if (res.ok) {
        diagnosticChecks = res.data.checks;
        lastDiagnoseTime = Date.now();
        return { ok: true, checks: res.data.checks };
      }
      return { ok: false, error: 'Diagnose failed' };
    } catch (err) {
      const errMsg = String(err);
      const match = errMsg.match(/Error: (.+)/);
      return { ok: false, error: match ? match[1] : errMsg };
    } finally {
      diagnosing = false;
    }
  }

  function clearDiagnostics() {
    diagnosticChecks = [];
    lastDiagnoseTime = null;
  }

  function clearCommitDiagnostics() {
    commitDiagnostics = [];
  }

  /** Record a commit phase diagnostic event from the streaming commit */
  function addCommitDiagnostic(diagnostic: CommitPhaseDiagnostic) {
    commitDiagnostics = [...commitDiagnostics, diagnostic];
  }

  async function commit(
    rootPath: string,
    message: string,
  ): Promise<{ ok: boolean; sha?: string; error?: string }> {
    try {
      console.log('[gitStore] Calling API commit with:', { rootPath, message });
      const res = await api.git.commit(rootPath, message);
      console.log('[gitStore] API response:', res);
      if (res.ok) {
        await refresh(rootPath);
        return { ok: true, sha: res.data.sha };
      }
      return { ok: false, error: 'Commit failed' };
    } catch (err) {
      console.error('[gitStore] Commit error:', err);
      const errMsg = String(err);
      // Extract the actual git error message if present
      const match = errMsg.match(/git commit failed: (.+)/) || errMsg.match(/Error: (.+)/);
      return { ok: false, error: match ? match[1] : errMsg };
    }
  }

  async function clean(rootPath: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await api.git.clean(rootPath);
      if (res.ok) {
        await refresh(rootPath);
        return { ok: true };
      }
      return { ok: false, error: 'Clean failed' };
    } catch (err) {
      const errMsg = String(err);
      const match = errMsg.match(/Error: (.+)/);
      return { ok: false, error: match ? match[1] : errMsg };
    }
  }

  async function push(rootPath: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await api.git.push(rootPath);
      if (res.ok) {
        return { ok: true };
      }
      return { ok: false, error: 'Push failed' };
    } catch (err) {
      const errMsg = String(err);
      // Extract the actual git error message if present
      const match = errMsg.match(/git push failed: (.+)/) || errMsg.match(/Error: (.+)/);
      return { ok: false, error: match ? match[1] : errMsg };
    }
  }

  return {
    get isRepo() {
      return isRepo;
    },
    get branch() {
      return branch;
    },
    /** Commits the current branch is ahead of its upstream. */
    get ahead() {
      return ahead;
    },
    /** Commits the current branch is behind its upstream. */
    get behind() {
      return behind;
    },
    /** True when the current branch has an upstream tracking ref. */
    get hasUpstream() {
      return hasUpstream;
    },
    get fileStatuses() {
      return fileStatuses;
    },
    get isDirty() {
      return fileStatuses.length > 0;
    },
    get dirtyCount() {
      return fileStatuses.length;
    },
    /** True when .git/index.lock exists — another git process is running. */
    get indexLocked() {
      return indexLocked;
    },
    // Diagnostic state
    get diagnosticChecks() {
      return diagnosticChecks;
    },
    get diagnosing() {
      return diagnosing;
    },
    get lastDiagnoseTime() {
      return lastDiagnoseTime;
    },
    get commitDiagnostics() {
      return commitDiagnostics;
    },
    getStatus,
    getDirStatus,
    isIgnored,
    refresh,
    refreshIgnored,
    startPolling,
    stopPolling,
    commit,
    clean,
    push,
    diagnose,
    clearDiagnostics,
    clearCommitDiagnostics,
    addCommitDiagnostic,
  };
}

export const gitStore = createGitStore();
