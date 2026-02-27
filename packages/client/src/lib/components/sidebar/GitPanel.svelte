<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import { gitStore, type GitFileStatus } from '$lib/stores/git.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { primaryPaneStore } from '$lib/stores/primaryPane.svelte';
  import { gitOperationsStore } from '$lib/stores/gitOperations.svelte';
  import { editorStore } from '$lib/stores/editor.svelte';
  import CommitGroupPanel from './CommitGroupPanel.svelte';

  // ── Derived state ────────────────────────────────────────────────────────

  let workspacePath = $derived(settingsStore.workspacePath || '');

  let stagedFiles = $derived(gitStore.fileStatuses.filter((f) => f.staged && f.status !== 'U'));
  let unstagedFiles = $derived(gitStore.fileStatuses.filter((f) => !f.staged || f.status === 'U'));
  let conflictFiles = $derived(
    gitStore.fileStatuses.filter(
      (f) =>
        f.status === 'UU' ||
        f.status === 'AA' ||
        f.status === 'DD' ||
        f.status === 'AU' ||
        f.status === 'UA' ||
        f.status === 'DU' ||
        f.status === 'UD',
    ),
  );

  /** True when .git/index.lock exists — disables all git mutation buttons. */
  let locked = $derived(gitStore.indexLocked);

  // ── Local state ──────────────────────────────────────────────────────────

  let loadingKey = $state<string | null>(null);
  let refreshing = $state(false);

  // ── Commit state ─────────────────────────────────────────────────────────

  let commitMessage = $state('');
  let generating = $state(false);
  let committing = $state(false);
  let pushing = $state(false);
  let discarding = $state(false);
  let staging = $state<string | null>(null); // path of file being staged/unstaged, or 'all'
  let commitProgress = $state<string[]>([]);
  let pushProgress = $state<string[]>([]);
  let gitError = $state('');
  let gitErrorDetail = $state('');
  // Auto-open commit section if there's a persisted error from a previous attempt
  let showCommitSection = $state(gitOperationsStore.hasError);

  // ── Diagnostics state ────────────────────────────────────────────────────

  let showDiagnostics = $state(false);
  let showCommitDiagnostics = $state(true);

  // ── Lifecycle ────────────────────────────────────────────────────────────
  // NOTE: Git polling is managed centrally by workspace.svelte.ts via
  // gitStore.startPolling(). Do NOT create an additional setInterval here —
  // that causes duplicate refresh storms (2× the API calls, log spam).

  onMount(() => {
    // Restore error from sessionStorage (survives HMR reloads)
    if (gitOperationsStore.commitOperation.error) {
      gitError = gitOperationsStore.commitOperation.error;
      commitProgress = [...gitOperationsStore.commitOperation.progress];
      showCommitSection = true;
    }
  });

  // ── Helpers ──────────────────────────────────────────────────────────────

  function fileKey(file: GitFileStatus, staged: boolean): string {
    return `${staged ? 'staged' : 'unstaged'}:${file.path}`;
  }

  function statusLabel(status: string): string {
    switch (status) {
      case 'M':
        return 'M';
      case 'A':
        return 'A';
      case 'D':
        return 'D';
      case 'R':
        return 'R';
      case 'U':
        return '?';
      default:
        return status;
    }
  }

  function statusTitle(status: string): string {
    switch (status) {
      case 'M':
        return 'Modified';
      case 'A':
        return 'Added';
      case 'D':
        return 'Deleted';
      case 'R':
        return 'Renamed';
      case 'U':
        return 'Untracked';
      default:
        return status;
    }
  }

  function statusClass(status: string): string {
    switch (status) {
      case 'A':
        return 'badge-added';
      case 'D':
        return 'badge-deleted';
      case 'U':
        return 'badge-untracked';
      default:
        return 'badge-modified';
    }
  }

  function basename(path: string): string {
    return path.split('/').pop() ?? path;
  }

  function dirname(path: string): string {
    const parts = path.split('/');
    return parts.length > 1 ? parts.slice(0, -1).join('/') : '';
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  async function openDiff(file: GitFileStatus, staged: boolean) {
    if (file.status === 'U') return; // untracked — no diff
    const key = fileKey(file, staged);
    loadingKey = key;
    try {
      const res = await api.git.diff(workspacePath, file.path, staged);
      primaryPaneStore.openDiffTab(file.path, res.data.diff, staged);
    } catch (err: any) {
      // Show error as diff content so it's visible in the panel
      primaryPaneStore.openDiffTab(file.path, `Error: ${err?.message ?? err}`, staged);
    } finally {
      loadingKey = null;
    }
  }

  async function refresh() {
    if (!workspacePath) return;
    refreshing = true;
    await gitStore.refresh(workspacePath);
    refreshing = false;
  }

  // ── Stage / Unstage actions ─────────────────────────────────────────────

  async function stageFile(filePath: string) {
    if (staging) return;
    staging = filePath;
    gitError = '';
    try {
      await api.git.stage(workspacePath, [filePath]);
      await gitStore.refresh(workspacePath);
    } catch {
      gitError = `Failed to stage ${filePath}`;
    } finally {
      staging = null;
    }
  }

  async function unstageFile(filePath: string) {
    if (staging) return;
    staging = filePath;
    gitError = '';
    try {
      await api.git.unstage(workspacePath, [filePath]);
      await gitStore.refresh(workspacePath);
    } catch {
      gitError = `Failed to unstage ${filePath}`;
    } finally {
      staging = null;
    }
  }

  async function stageAll() {
    if (staging) return;
    staging = 'all';
    gitError = '';
    try {
      await api.git.stage(workspacePath);
      await gitStore.refresh(workspacePath);
    } catch {
      gitError = 'Failed to stage all files';
    } finally {
      staging = null;
    }
  }

  async function unstageAll() {
    if (staging) return;
    staging = 'all';
    gitError = '';
    try {
      await api.git.unstage(workspacePath);
      await gitStore.refresh(workspacePath);
    } catch {
      gitError = 'Failed to unstage all files';
    } finally {
      staging = null;
    }
  }

  // ── Commit actions ───────────────────────────────────────────────────────

  async function handleGenerateMessage() {
    if (generating || committing) return;
    generating = true;
    gitError = '';
    try {
      const res = await api.git.generateCommitMessage(workspacePath);
      if (res.ok && res.data.message) {
        commitMessage = res.data.message;
      } else {
        gitError = 'Could not generate message';
      }
    } catch (err: any) {
      const msg = err?.message || String(err);
      gitError = msg.includes('No changes') ? msg : `Failed to generate message: ${msg}`;
    }
    generating = false;
  }

  async function handleCommit() {
    if (!commitMessage.trim() || committing) {
      console.warn(
        '[GitPanel] handleCommit BLOCKED: message=%s committing=%s',
        commitMessage.trim() ? `"${commitMessage.trim().slice(0, 30)}"` : '(empty)',
        committing,
      );
      return;
    }
    committing = true;
    gitError = '';
    gitErrorDetail = '';
    commitProgress = [];
    gitStore.clearCommitDiagnostics();
    showCommitSection = true;
    showCommitDiagnostics = true;

    // Update shared store
    gitOperationsStore.startCommit();

    console.log(
      '[GitPanel] handleCommit starting, workspace:',
      workspacePath,
      'message:',
      commitMessage.trim(),
    );

    try {
      const result = await api.git.commitStream(workspacePath, commitMessage.trim(), (event) => {
        console.log('[GitPanel] commit stream event:', event.type, event.message?.slice(0, 100));
        if (event.type === 'status') {
          commitProgress = [...commitProgress, event.message || ''];
          gitOperationsStore.addCommitProgress(event.message || '');
        } else if (event.type === 'output') {
          commitProgress = [...commitProgress, event.message || ''];
          gitOperationsStore.addCommitProgress(event.message || '');
        } else if (event.type === 'diagnostic') {
          // Capture diagnostic phase events for debugging display
          gitStore.addCommitDiagnostic({
            phase: event.phase!,
            message: event.message || '',
            porcelain: event.porcelain || '',
            fileCount: event.fileCount || 0,
            timestamp: Date.now(),
          });
        } else if (event.type === 'error') {
          gitError = event.message || 'Commit failed';
          gitErrorDetail = (event as any).detail || '';
          gitOperationsStore.setCommitError(event.message || 'Commit failed');
        }
      });

      console.log('[GitPanel] commitStream result:', result);

      // Always refresh so the file list reflects actual git state.
      await gitStore.refresh(workspacePath);
      if (result.ok) {
        gitOperationsStore.endCommit(true);
        // Auto-clear on success
        setTimeout(() => {
          if (!gitError) {
            commitMessage = '';
            commitProgress = [];
          }
        }, 2000);
      } else {
        gitError = result.error || 'Commit failed';
        console.error('[GitPanel] Commit failed:', result.error);
        gitOperationsStore.setCommitError(result.error || 'Commit failed');
        gitOperationsStore.endCommit(false);
      }
    } catch (err) {
      console.error('[GitPanel] handleCommit unexpected error:', err);
      gitError = `Unexpected error: ${err}`;
      gitOperationsStore.setCommitError(String(err));
      gitOperationsStore.endCommit(false);
    } finally {
      // ALWAYS reset committing flag — prevents the button from getting stuck disabled
      committing = false;
    }
  }

  async function handlePush() {
    if (pushing) return;
    pushing = true;
    gitError = '';
    pushProgress = [];
    showCommitSection = true;

    // Update shared store
    gitOperationsStore.startPush();

    try {
      const result = await api.git.pushStream(workspacePath, (event) => {
        if (event.type === 'status') {
          pushProgress = [...pushProgress, event.message || ''];
          gitOperationsStore.addPushProgress(event.message || '');
        } else if (event.type === 'output') {
          pushProgress = [...pushProgress, event.message || ''];
          gitOperationsStore.addPushProgress(event.message || '');
        } else if (event.type === 'error') {
          gitError = event.message || 'Push failed';
          gitOperationsStore.setPushError(event.message || 'Push failed');
        }
      });

      if (result.ok) {
        gitOperationsStore.endPush(true);
        // Auto-clear on success
        setTimeout(() => {
          if (!gitError) {
            pushProgress = [];
          }
        }, 2000);
      } else {
        gitError = result.error || 'Push failed';
        gitOperationsStore.setPushError(result.error || 'Push failed');
        gitOperationsStore.endPush(false);
      }
    } catch (err) {
      console.error('[GitPanel] handlePush unexpected error:', err);
      gitError = `Unexpected error: ${err}`;
      gitOperationsStore.setPushError(String(err));
      gitOperationsStore.endPush(false);
    } finally {
      pushing = false;
    }
  }

  async function handleDiscard() {
    if (committing || discarding) return;
    const confirmed = confirm(
      `Discard ${gitStore.dirtyCount} change${gitStore.dirtyCount === 1 ? '' : 's'}? This cannot be undone.`,
    );
    if (!confirmed) return;

    discarding = true;
    const result = await gitStore.clean(workspacePath);
    if (!result.ok) {
      gitError = result.error || 'Failed to discard changes';
    }
    discarding = false;
  }

  function clearOutput() {
    commitMessage = '';
    commitProgress = [];
    pushProgress = [];
    gitError = '';
    gitErrorDetail = '';
    gitStore.clearCommitDiagnostics();
    gitOperationsStore.clearCommit();
  }

  async function handleDiagnose() {
    if (gitStore.diagnosing || !workspacePath) return;
    showDiagnostics = true;
    const result = await gitStore.diagnose(workspacePath);
    if (!result.ok) {
      gitError = result.error || 'Diagnostics failed';
    }
  }

  function diagStatusIcon(status: 'ok' | 'warn' | 'error'): string {
    switch (status) {
      case 'ok':
        return '✓';
      case 'warn':
        return '⚠';
      case 'error':
        return '✗';
    }
  }

  function phaseLabel(phase: string): string {
    switch (phase) {
      case 'before-staging':
        return 'Before Staging';
      case 'after-staging':
        return 'After Staging';
      case 'after-commit':
        return 'After Commit';
      default:
        return phase;
    }
  }
</script>

<div class="git-panel">
  <!-- ── Header ─────────────────────────────────────────────────────────── -->
  <div class="panel-header">
    <div class="branch-info">
      {#if gitStore.isRepo}
        <svg
          class="branch-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <circle cx="6" cy="6" r="3" />
          <circle cx="18" cy="18" r="3" />
          <path d="M6 9c0 3.314 2.686 6 6 6h2M18 15V9" />
        </svg>
        <span class="branch-name">{gitStore.branch || 'HEAD'}</span>
        <span class="file-count">{gitStore.fileStatuses.length} changed</span>
      {:else if workspacePath}
        <span class="no-repo">Not a git repository</span>
      {:else}
        <span class="no-repo">No workspace open</span>
      {/if}
    </div>
    <button class="refresh-btn" onclick={refresh} disabled={refreshing} title="Refresh">
      <svg
        class="refresh-icon"
        class:spinning={refreshing}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M23 4v6h-6M1 20v-6h6" />
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
      </svg>
    </button>
  </div>

  <!-- ── Persistent error banner (survives HMR, shown outside collapsible section) ── -->
  {#if gitError && !showCommitSection}
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div
      class="error-banner"
      onclick={() => {
        showCommitSection = true;
      }}
    >
      <svg
        class="error-banner-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <span class="error-banner-text">{gitError}</span>
      <button
        class="error-banner-dismiss"
        onclick={(e: MouseEvent) => {
          e.stopPropagation();
          gitError = '';
          gitErrorDetail = '';
          gitOperationsStore.clearCommit();
        }}
        title="Dismiss"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          ><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg
        >
      </button>
    </div>
  {/if}

  <!-- ── Index lock banner — git operation in progress ────────────────── -->
  {#if gitStore.indexLocked}
    <div class="lock-banner">
      <svg
        class="lock-banner-icon spin"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path
          d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"
        />
      </svg>
      <span class="lock-banner-text">Git operation in progress</span>
    </div>
  {/if}

  <!-- ── Merge Conflicts Section ─────────────────────────────────────── -->
  {#if conflictFiles.length > 0}
    <div class="conflict-section">
      <div class="section-header conflict-header-bar">
        <span class="conflict-header-label">
          <svg
            class="conflict-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path
              d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
            />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          Merge Conflicts
        </span>
        <span class="section-count conflict-count">{conflictFiles.length}</span>
      </div>
      {#each conflictFiles as file (file.path)}
        <div class="file-row-wrap">
          <button
            class="file-row"
            onclick={() => {
              const fullPath = workspacePath + '/' + file.path;
              editorStore.openFile(fullPath);
            }}
            title="Open {file.path} to resolve conflicts"
          >
            <span class="status-badge badge-conflict" title="Conflict">C</span>
            <span class="file-name">{basename(file.path)}</span>
            {#if dirname(file.path)}
              <span class="file-dir">{dirname(file.path)}</span>
            {/if}
          </button>
        </div>
      {/each}
    </div>
  {/if}

  <!-- ── Commit Section ─────────────────────────────────────────────────── -->
  {#if gitStore.isRepo && gitStore.isDirty}
    <div class="commit-section">
      <button
        class="commit-header"
        onclick={() => (showCommitSection = !showCommitSection)}
        title={showCommitSection ? 'Collapse' : 'Expand'}
      >
        <svg
          class="expand-icon"
          class:expanded={showCommitSection}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span>Commit & Actions</span>
      </button>

      {#if showCommitSection}
        <div class="commit-content">
          <!-- Message input with generate button -->
          <div class="commit-input-row">
            <input
              class="commit-input"
              type="text"
              placeholder="Commit message..."
              bind:value={commitMessage}
              onkeydown={(e) => e.key === 'Enter' && handleCommit()}
              disabled={committing || pushing || locked}
            />
            <button
              class="generate-btn"
              onclick={handleGenerateMessage}
              disabled={generating || committing || pushing || locked}
              title="Auto-generate commit message"
            >
              {#if generating}
                <svg
                  class="spin"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <line x1="12" y1="2" x2="12" y2="6" />
                  <line x1="12" y1="18" x2="12" y2="22" />
                  <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
                  <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
                  <line x1="2" y1="12" x2="6" y2="12" />
                  <line x1="18" y1="12" x2="22" y2="12" />
                  <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
                  <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
                </svg>
              {:else}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M15 4V2" />
                  <path d="M15 16v-2" />
                  <path d="M8 9h2" />
                  <path d="M20 9h2" />
                  <path d="M17.8 11.8L19 13" />
                  <path d="M15 9h0" />
                  <path d="M17.8 6.2L19 5" />
                  <path d="M3 21l9-9" />
                  <path d="M12.2 6.2L11 5" />
                </svg>
              {/if}
            </button>
          </div>

          <!-- Action buttons -->
          <div class="action-buttons">
            <button
              class="action-btn commit-btn"
              onclick={handleCommit}
              disabled={!commitMessage.trim() || committing || pushing || locked}
            >
              {#if committing}
                <svg
                  class="btn-spinner"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path
                    d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"
                  />
                </svg>
                Committing…
              {:else}
                Commit
              {/if}
            </button>
            <button
              class="action-btn push-btn"
              onclick={handlePush}
              disabled={committing || pushing || locked}
            >
              {#if pushing}
                <svg
                  class="btn-spinner"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path
                    d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"
                  />
                </svg>
                Pushing…
              {:else}
                Push
              {/if}
            </button>
            <button
              class="action-btn discard-btn"
              onclick={handleDiscard}
              disabled={committing || pushing || discarding || locked}
            >
              {#if discarding}
                <svg
                  class="btn-spinner"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path
                    d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"
                  />
                </svg>
                Discarding…
              {:else}
                Discard All
              {/if}
            </button>
          </div>

          <!-- Diagnose button -->
          <button
            class="action-btn diagnose-btn"
            onclick={handleDiagnose}
            disabled={gitStore.diagnosing}
            title="Run git diagnostics to check for common staging and commit issues"
          >
            {#if gitStore.diagnosing}
              <svg
                class="spin diag-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <line x1="12" y1="2" x2="12" y2="6" />
                <line x1="12" y1="18" x2="12" y2="22" />
                <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
                <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
                <line x1="2" y1="12" x2="6" y2="12" />
                <line x1="18" y1="12" x2="22" y2="12" />
                <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
                <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
              </svg>
              Diagnosing...
            {:else}
              <svg
                class="diag-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path
                  d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"
                />
                <path d="M12 16v-4" />
                <path d="M12 8h.01" />
              </svg>
              Diagnose
            {/if}
          </button>

          <!-- Commit progress output (from shared store - shows ANY ongoing commit) -->
          {#if gitOperationsStore.commitOperation.progress.length > 0 || gitOperationsStore.commitOperation.inProgress}
            <div class="progress-output">
              <div class="progress-header">
                <span>Commit Output</span>
                <button
                  class="clear-btn"
                  onclick={() => gitOperationsStore.clearCommit()}
                  title="Clear"
                >
                  ✕
                </button>
              </div>
              <div class="progress-lines">
                {#each gitOperationsStore.commitOperation.progress.slice(-15) as line}
                  <div class="progress-line">{line}</div>
                {/each}
              </div>
            </div>
          {/if}

          <!-- Push progress output (from shared store - shows ANY ongoing push) -->
          {#if gitOperationsStore.pushOperation.progress.length > 0 || gitOperationsStore.pushOperation.inProgress}
            <div class="progress-output">
              <div class="progress-header">
                <span>Push Output</span>
                <button
                  class="clear-btn"
                  onclick={() => gitOperationsStore.clearPush()}
                  title="Clear">✕</button
                >
              </div>
              <div class="progress-lines">
                {#each gitOperationsStore.pushOperation.progress.slice(-15) as line}
                  <div class="progress-line">{line}</div>
                {/each}
              </div>
            </div>
          {/if}

          <!-- Commit phase diagnostics (from streaming commit) -->
          {#if gitStore.commitDiagnostics.length > 0}
            <div class="diagnostics-panel">
              <button
                class="diagnostics-header"
                onclick={() => (showCommitDiagnostics = !showCommitDiagnostics)}
              >
                <svg
                  class="expand-icon"
                  class:expanded={showCommitDiagnostics}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                <span>Commit Flow Details</span>
                <span class="diag-count">{gitStore.commitDiagnostics.length} phases</span>
              </button>
              {#if showCommitDiagnostics}
                <div class="diagnostics-content">
                  {#each gitStore.commitDiagnostics as diag}
                    <div class="commit-phase">
                      <div class="phase-header">
                        <span class="phase-label">{phaseLabel(diag.phase)}</span>
                        <span class="phase-count"
                          >{diag.fileCount} file{diag.fileCount === 1 ? '' : 's'}</span
                        >
                      </div>
                      <div class="phase-message">{diag.message}</div>
                      {#if diag.porcelain}
                        <pre class="phase-porcelain">{diag.porcelain}</pre>
                      {/if}
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}

          <!-- Diagnostic check results (from /diagnose endpoint) -->
          {#if showDiagnostics && gitStore.diagnosticChecks.length > 0}
            <div class="diagnostics-panel">
              <div class="diagnostics-header-row">
                <span class="diagnostics-title">Git Diagnostics</span>
                <button
                  class="clear-btn"
                  onclick={() => {
                    gitStore.clearDiagnostics();
                    showDiagnostics = false;
                  }}
                  title="Dismiss">✕</button
                >
              </div>
              <div class="diagnostics-content">
                {#each gitStore.diagnosticChecks as check}
                  <div class="diag-check diag-{check.status}">
                    <span class="diag-status-icon">{diagStatusIcon(check.status)}</span>
                    <div class="diag-info">
                      <div class="diag-message">{check.message}</div>
                      {#if check.detail}
                        <pre class="diag-detail">{check.detail}</pre>
                      {/if}
                    </div>
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          <!-- Error display -->
          {#if gitError}
            <div class="error-block">
              <div class="error-block-header">
                <svg
                  class="error-block-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span class="error-block-text">{gitError}</span>
                <button
                  class="error-block-dismiss"
                  onclick={() => {
                    gitError = '';
                    gitErrorDetail = '';
                    gitOperationsStore.clearCommit();
                  }}
                  title="Dismiss"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                    ><line x1="18" y1="6" x2="6" y2="18" /><line
                      x1="6"
                      y1="6"
                      x2="18"
                      y2="18"
                    /></svg
                  >
                </button>
              </div>
              {#if gitErrorDetail}
                <pre class="error-block-detail">{gitErrorDetail}</pre>
              {/if}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  <!-- ── Empty / no-repo states ─────────────────────────────────────────── -->
  {#if !gitStore.isRepo}
    <div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="6" cy="6" r="3" />
        <circle cx="18" cy="18" r="3" />
        <path d="M6 9c0 3.314 2.686 6 6 6h2M18 15V9" />
      </svg>
      <p>{workspacePath ? 'Not a git repository' : 'Open a workspace to view git changes'}</p>
    </div>
  {:else if gitStore.fileStatuses.length === 0}
    <div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
      <p>No changes — working tree clean</p>
    </div>
  {:else}
    <div class="git-panel-content">
      <!-- ── Smart Staging ─────────────────────────────────────────────────── -->
      <div class="smart-staging-section">
        <CommitGroupPanel />
      </div>

      <div class="file-sections">
        <!-- ── Staged ─────────────────────────────────────────────────────── -->
        {#if stagedFiles.length > 0}
          <div class="section-header">
            <span>Staged</span>
            <div class="section-actions">
              <button
                class="section-action-btn"
                onclick={unstageAll}
                disabled={!!staging || locked}
                title="Unstage all"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
              <span class="section-count">{stagedFiles.length}</span>
            </div>
          </div>
          {#each stagedFiles as file (file.path)}
            {@const key = fileKey(file, true)}
            {@const isLoading = loadingKey === key}
            <div class="file-row-wrap">
              <button
                class="file-row"
                onclick={() => openDiff(file, true)}
                disabled={isLoading}
                title={file.path}
              >
                <span
                  class="status-badge {statusClass(file.status)}"
                  title={statusTitle(file.status)}
                >
                  {statusLabel(file.status)}
                </span>
                <span class="file-name">{basename(file.path)}</span>
                {#if dirname(file.path)}
                  <span class="file-dir">{dirname(file.path)}</span>
                {/if}
                {#if isLoading}
                  <svg
                    class="spinner"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <path
                      d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"
                    />
                  </svg>
                {/if}
              </button>
              <button
                class="stage-btn unstage"
                onclick={(e: MouseEvent) => {
                  e.stopPropagation();
                  unstageFile(file.path);
                }}
                disabled={!!staging || locked}
                title="Unstage"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            </div>
          {/each}
        {/if}

        <!-- ── Unstaged ────────────────────────────────────────────────────── -->
        {#if unstagedFiles.length > 0}
          <div class="section-header">
            <span>Unstaged</span>
            <div class="section-actions">
              <button
                class="section-action-btn"
                onclick={stageAll}
                disabled={!!staging || locked}
                title="Stage all"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
              <span class="section-count">{unstagedFiles.length}</span>
            </div>
          </div>
          {#each unstagedFiles as file (file.path)}
            {@const key = fileKey(file, false)}
            {@const isLoading = loadingKey === key}
            {@const isUntracked = file.status === 'U'}
            <div class="file-row-wrap">
              <button
                class="file-row"
                class:no-diff={isUntracked}
                onclick={() => openDiff(file, false)}
                disabled={isLoading || isUntracked}
                title={isUntracked ? 'Untracked — no diff available' : file.path}
              >
                <span
                  class="status-badge {statusClass(file.status)}"
                  title={statusTitle(file.status)}
                >
                  {statusLabel(file.status)}
                </span>
                <span class="file-name">{basename(file.path)}</span>
                {#if dirname(file.path)}
                  <span class="file-dir">{dirname(file.path)}</span>
                {/if}
                {#if isLoading}
                  <svg
                    class="spinner"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <path
                      d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"
                    />
                  </svg>
                {/if}
              </button>
              <button
                class="stage-btn stage"
                onclick={(e: MouseEvent) => {
                  e.stopPropagation();
                  stageFile(file.path);
                }}
                disabled={!!staging || locked}
                title="Stage"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            </div>
          {/each}
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .git-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    font-size: var(--fs-sm);
  }

  /* ── Header ── */
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    gap: 6px;
  }

  .branch-info {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    overflow: hidden;
  }

  .branch-icon {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    color: var(--text-muted);
  }

  .branch-name {
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 120px;
  }

  .file-count {
    color: var(--text-muted);
    white-space: nowrap;
  }

  .no-repo {
    color: var(--text-muted);
    font-style: italic;
  }

  .refresh-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: 4px;
    flex-shrink: 0;
    padding: 0;
    transition:
      color 0.15s,
      background 0.15s;
  }

  .refresh-btn:hover:not(:disabled) {
    color: var(--text);
    background: var(--bg-hover);
  }

  .refresh-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .refresh-icon {
    width: 14px;
    height: 14px;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .spinning {
    animation: spin 0.8s linear infinite;
  }

  /* ── Empty state ── */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 40px 20px;
    color: var(--text-muted);
    text-align: center;
  }

  .empty-state svg {
    width: 32px;
    height: 32px;
    opacity: 0.4;
  }

  .empty-state p {
    margin: 0;
    font-size: var(--fs-sm);
    line-height: 1.5;
  }

  /* ── Scrollable content area ── */
  .git-panel-content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    min-height: 0;
  }

  /* ── File sections ── */
  .file-sections {
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 5px 10px 4px;
    font-size: var(--fs-xxs);
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted);
    background: var(--bg);
    position: sticky;
    top: 0;
    z-index: 1;
    border-bottom: 1px solid var(--border);
  }

  .section-count {
    background: var(--bg-hover);
    color: var(--text-muted);
    border-radius: 10px;
    padding: 1px 6px;
    font-size: var(--fs-xxs);
    font-weight: 600;
  }

  .section-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .section-action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: 3px;
    padding: 0;
    transition:
      color 0.15s,
      background 0.15s;
  }

  .section-action-btn svg {
    width: 12px;
    height: 12px;
  }

  .section-action-btn:hover:not(:disabled) {
    color: var(--text);
    background: var(--bg-hover);
  }

  .section-action-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  /* ── File row wrap + stage buttons ── */

  .file-row-wrap {
    display: flex;
    align-items: center;
  }

  .file-row-wrap .file-row {
    flex: 1;
    min-width: 0;
  }

  .stage-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: none;
    background: transparent;
    cursor: pointer;
    border-radius: 3px;
    padding: 0;
    flex-shrink: 0;
    margin-right: 6px;
    opacity: 0;
    transition:
      opacity 0.1s,
      color 0.15s,
      background 0.15s;
  }

  .file-row-wrap:hover .stage-btn {
    opacity: 1;
  }

  .stage-btn svg {
    width: 12px;
    height: 12px;
  }

  .stage-btn.stage {
    color: var(--accent, #22c55e);
  }

  .stage-btn.stage:hover:not(:disabled) {
    background: rgba(34, 197, 94, 0.15);
  }

  .stage-btn.unstage {
    color: var(--text-muted);
  }

  .stage-btn.unstage:hover:not(:disabled) {
    color: var(--text-danger, #ef4444);
    background: rgba(239, 68, 68, 0.1);
  }

  .stage-btn:disabled {
    opacity: 0.3;
    cursor: default;
  }

  /* ── File row ── */
  .file-row {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 5px 10px;
    gap: 6px;
    background: transparent;
    border: none;
    border-bottom: 1px solid transparent;
    cursor: pointer;
    text-align: left;
    color: var(--text);
    transition: background 0.1s;
    min-width: 0;
  }

  .file-row:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .file-row:disabled {
    cursor: default;
  }

  .file-row.no-diff {
    opacity: 0.6;
  }

  /* ── Status badge ── */
  .status-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 3px;
    font-size: var(--fs-xxs);
    font-weight: 700;
    flex-shrink: 0;
    font-family: monospace;
  }

  .badge-modified {
    background: rgba(234, 179, 8, 0.15);
    color: #eab308;
  }
  .badge-added {
    background: rgba(34, 197, 94, 0.15);
    color: #22c55e;
  }
  .badge-deleted {
    background: rgba(239, 68, 68, 0.15);
    color: #ef4444;
  }
  .badge-untracked {
    background: rgba(148, 163, 184, 0.15);
    color: #94a3b8;
  }
  .badge-conflict {
    background: rgba(234, 179, 8, 0.15);
    color: #eab308;
  }

  /* ── File name / dir ── */
  .file-name {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 500;
    min-width: 0;
  }

  .file-dir {
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 80px;
    flex-shrink: 1;
    font-size: var(--fs-xxs);
  }

  /* ── Open icon / spinner ── */
  .open-icon {
    width: 11px;
    height: 11px;
    flex-shrink: 0;
    color: var(--text-muted);
    opacity: 0;
    transition: opacity 0.1s;
  }

  .file-row:hover .open-icon {
    opacity: 1;
  }

  .spinner {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
    color: var(--text-muted);
    animation: spin 0.8s linear infinite;
  }

  .btn-spinner {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
    animation: spin 0.8s linear infinite;
  }

  /* ── Conflict Section ── */
  .conflict-section {
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .conflict-header-bar {
    background: rgba(234, 179, 8, 0.08);
    border-bottom: 1px solid rgba(234, 179, 8, 0.2);
  }

  .conflict-header-label {
    display: flex;
    align-items: center;
    gap: 5px;
    color: #eab308;
    font-weight: 700;
  }

  .conflict-icon {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
  }

  .conflict-count {
    background: rgba(234, 179, 8, 0.15);
    color: #eab308;
  }

  /* ── Commit Section ── */
  .commit-section {
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .commit-header {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 8px 10px;
    background: var(--bg-hover);
    border: none;
    cursor: pointer;
    color: var(--text);
    font-weight: 600;
    font-size: var(--fs-sm);
    transition: background 0.1s;
  }

  .commit-header:hover {
    background: var(--bg-active);
  }

  .expand-icon {
    width: 12px;
    height: 12px;
    transition: transform 0.2s;
  }

  .expand-icon.expanded {
    transform: rotate(90deg);
  }

  .commit-content {
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .commit-input-row {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .commit-input {
    flex: 1;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font-size: var(--fs-sm);
    font-family: inherit;
  }

  .commit-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .commit-input:disabled {
    opacity: 0.5;
  }

  .generate-btn {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-hover);
    color: var(--accent);
    cursor: pointer;
    padding: 0;
    transition: all 0.15s;
  }

  .generate-btn svg {
    width: 14px;
    height: 14px;
  }

  .generate-btn:hover:not(:disabled) {
    background: var(--accent);
    color: var(--bg);
  }

  .generate-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .generate-btn .spin {
    animation: spin 1s linear infinite;
  }

  .action-buttons {
    display: flex;
    gap: 6px;
  }

  .action-btn {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: var(--fs-sm);
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }

  .commit-btn {
    background: var(--accent);
    color: var(--bg);
    border-color: var(--accent);
  }

  .commit-btn:hover:not(:disabled) {
    opacity: 0.9;
  }

  .commit-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .push-btn {
    background: var(--bg-hover);
    color: var(--text);
  }

  .push-btn:hover:not(:disabled) {
    background: var(--bg-active);
  }

  .push-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .discard-btn {
    background: transparent;
    color: var(--text-danger, #ef4444);
    border-color: var(--text-danger, #ef4444);
  }

  .discard-btn:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.1);
  }

  .discard-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .progress-output {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
  }

  .progress-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 8px;
    background: var(--bg-hover);
    border-bottom: 1px solid var(--border);
    font-size: var(--fs-xxs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }

  .clear-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 0 4px;
    font-size: var(--fs-sm);
    transition: color 0.15s;
  }

  .clear-btn:hover {
    color: var(--text-danger, #ef4444);
  }

  .progress-lines {
    max-height: 150px;
    overflow-y: auto;
    padding: 6px 8px;
  }

  .progress-line {
    font-size: var(--fs-xxs);
    color: var(--text-muted);
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: var(--font-mono, monospace);
  }

  /* ── Error banner (top-level, outside collapsible section) ── */
  .error-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 10px;
    background: rgba(239, 68, 68, 0.12);
    border: none;
    border-bottom: 1px solid rgba(239, 68, 68, 0.3);
    cursor: pointer;
    color: var(--text-danger, #ef4444);
    font-size: var(--fs-sm);
    text-align: left;
    transition: background 0.15s;
  }

  .error-banner:hover {
    background: rgba(239, 68, 68, 0.2);
  }

  .error-banner-icon {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }

  .error-banner-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }

  .error-banner-dismiss {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border: none;
    background: transparent;
    color: var(--text-danger, #ef4444);
    cursor: pointer;
    border-radius: 3px;
    padding: 0;
    flex-shrink: 0;
    opacity: 0.6;
    transition:
      opacity 0.15s,
      background 0.15s;
  }

  .error-banner-dismiss svg {
    width: 12px;
    height: 12px;
  }

  .error-banner-dismiss:hover {
    opacity: 1;
    background: rgba(239, 68, 68, 0.15);
  }

  /* ── Lock banner ── */
  .lock-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 10px;
    background: rgba(234, 179, 8, 0.12);
    border: none;
    border-bottom: 1px solid rgba(234, 179, 8, 0.3);
    color: var(--text-warning, #eab308);
    font-size: var(--fs-sm);
  }

  .lock-banner-icon {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
  }

  .lock-banner-text {
    font-weight: 600;
    font-size: var(--fs-xs);
  }

  /* ── Error block (inside commit section, with detail) ── */
  .error-block {
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 4px;
    overflow: hidden;
  }

  .error-block-header {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 8px 8px;
    color: var(--text-danger, #ef4444);
  }

  .error-block-icon {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    margin-top: 1px;
  }

  .error-block-text {
    flex: 1;
    font-size: var(--fs-sm);
    font-weight: 600;
    line-height: 1.4;
  }

  .error-block-dismiss {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border: none;
    background: transparent;
    color: var(--text-danger, #ef4444);
    cursor: pointer;
    border-radius: 3px;
    padding: 0;
    flex-shrink: 0;
    opacity: 0.6;
    transition:
      opacity 0.15s,
      background 0.15s;
  }

  .error-block-dismiss svg {
    width: 12px;
    height: 12px;
  }

  .error-block-dismiss:hover {
    opacity: 1;
    background: rgba(239, 68, 68, 0.15);
  }

  .error-block-detail {
    margin: 0;
    padding: 6px 8px;
    border-top: 1px solid rgba(239, 68, 68, 0.15);
    background: rgba(0, 0, 0, 0.15);
    font-size: var(--fs-xxs);
    color: var(--text-muted);
    line-height: 1.3;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: var(--font-mono, monospace);
    max-height: 120px;
    overflow-y: auto;
  }

  /* ── Diagnose button ── */
  .diagnose-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    background: var(--bg);
    color: var(--text-muted);
    border-color: var(--border);
  }

  .diagnose-btn:hover:not(:disabled) {
    color: var(--text);
    background: var(--bg-hover);
  }

  .diag-icon {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
  }

  .diagnose-btn .spin {
    animation: spin 1s linear infinite;
  }

  /* ── Diagnostics panel ── */
  .diagnostics-panel {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
  }

  .diagnostics-header {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 5px 8px;
    background: var(--bg-hover);
    border: none;
    border-bottom: 1px solid var(--border);
    cursor: pointer;
    color: var(--text);
    font-size: var(--fs-xxs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    transition: background 0.1s;
  }

  .diagnostics-header:hover {
    background: var(--bg-active);
  }

  .diagnostics-header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 5px 8px;
    background: var(--bg-hover);
    border-bottom: 1px solid var(--border);
  }

  .diagnostics-title {
    font-size: var(--fs-xxs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }

  .diag-count {
    margin-left: auto;
    font-size: var(--fs-xxs);
    color: var(--text-muted);
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
  }

  .diagnostics-content {
    max-height: 200px;
    overflow-y: auto;
  }

  /* ── Commit phase diagnostics ── */
  .commit-phase {
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
  }

  .commit-phase:last-child {
    border-bottom: none;
  }

  .phase-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 2px;
  }

  .phase-label {
    font-size: var(--fs-xxs);
    font-weight: 600;
    color: var(--accent);
  }

  .phase-count {
    font-size: var(--fs-xxs);
    color: var(--text-muted);
  }

  .phase-message {
    font-size: var(--fs-xxs);
    color: var(--text-muted);
    line-height: 1.4;
  }

  .phase-porcelain {
    margin: 4px 0 0;
    padding: 4px 6px;
    background: var(--bg-hover);
    border-radius: 3px;
    font-size: var(--fs-xxs);
    color: var(--text-muted);
    line-height: 1.3;
    white-space: pre-wrap;
    word-break: break-all;
    font-family: var(--font-mono, monospace);
    max-height: 80px;
    overflow-y: auto;
  }

  /* ── Diagnostic check items ── */
  .diag-check {
    display: flex;
    gap: 8px;
    padding: 5px 8px;
    border-bottom: 1px solid var(--border);
    align-items: flex-start;
  }

  .diag-check:last-child {
    border-bottom: none;
  }

  .diag-status-icon {
    flex-shrink: 0;
    width: 16px;
    text-align: center;
    font-size: var(--fs-sm);
    font-weight: 700;
    line-height: 1.4;
  }

  .diag-ok .diag-status-icon {
    color: #22c55e;
  }

  .diag-warn .diag-status-icon {
    color: #eab308;
  }

  .diag-error .diag-status-icon {
    color: #ef4444;
  }

  .diag-info {
    flex: 1;
    min-width: 0;
  }

  .diag-message {
    font-size: var(--fs-xxs);
    color: var(--text);
    line-height: 1.4;
  }

  .diag-warn .diag-message {
    color: #eab308;
  }

  .diag-error .diag-message {
    color: #ef4444;
  }

  .diag-detail {
    margin: 3px 0 0;
    padding: 4px 6px;
    background: var(--bg-hover);
    border-radius: 3px;
    font-size: var(--fs-xxs);
    color: var(--text-muted);
    line-height: 1.3;
    white-space: pre-wrap;
    word-break: break-all;
    font-family: var(--font-mono, monospace);
    max-height: 80px;
    overflow-y: auto;
  }

  /* ── Smart Staging ── */
  .smart-staging-section {
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
  }
</style>
