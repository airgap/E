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
  let fileStatuses = $state<GitFileStatus[]>([]);
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
    // Match by path suffix (relativePath may differ from absolute)
    for (const f of fileStatuses) {
      if (filePath.endsWith(f.path) || f.path.endsWith(filePath.split('/').pop() ?? '')) {
        return f.status;
      }
    }
    return null;
  }

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
    if (pendingRefreshTimer) {
      clearTimeout(pendingRefreshTimer);
      pendingRefreshTimer = null;
    }

    const seq = ++refreshSeq;
    console.log('[gitStore.refresh] seq=%d path=%s', seq, rootPath);
    try {
      const [statusRes, branchRes] = await Promise.all([
        api.git.status(rootPath),
        api.git.branch(rootPath),
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
    }
  }

  function startPolling(rootPath: string, interval = 5000) {
    stopPolling();
    refresh(rootPath);
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
    refresh,
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
