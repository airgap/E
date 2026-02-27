<script lang="ts">
  import { streamStore } from '$lib/stores/stream.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { workStore } from '$lib/stores/work.svelte';
  import { editorStore } from '$lib/stores/editor.svelte';
  import { gitStore } from '$lib/stores/git.svelte';
  import { gitOperationsStore } from '$lib/stores/gitOperations.svelte';
  import { lspStore } from '$lib/stores/lsp.svelte';
  import { terminalStore } from '$lib/stores/terminal.svelte';
  import { loopStore } from '$lib/stores/loop.svelte';
  import { uiStore } from '$lib/stores/ui.svelte';
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { api } from '$lib/api/client';
  import { throbberStore } from '$lib/stores/throbber.svelte';
  import VoiceModeIndicator from '$lib/components/voice/VoiceModeIndicator.svelte';

  // Client-side pricing table (per million tokens)
  const PRICING: Record<string, { input: number; output: number }> = {
    'claude-opus-4-6': { input: 15.0, output: 75.0 },
    'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
    'claude-sonnet-4-5-20250929': { input: 3.0, output: 15.0 },
    'claude-haiku-4-5-20251001': { input: 0.8, output: 4.0 },
  };
  const DEFAULT_PRICING = { input: 3.0, output: 15.0 };

  function estimateCost(model: string, inputTokens: number, outputTokens: number): string {
    const p = PRICING[model] || DEFAULT_PRICING;
    const cost = (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
    return cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2);
  }

  // ── Model picker state ──
  let modelPickerOpen = $state(false);

  const MODEL_OPTIONS = [
    { id: 'claude-opus-4-6', label: 'Opus 4.6', desc: 'Highest capability' },
    { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', desc: 'Balanced & current' },
    { id: 'claude-sonnet-4-5-20250929', label: 'Sonnet 4.5', desc: 'Balanced' },
    { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', desc: 'Fast & light' },
  ];

  // ── Git gutter popover state ──
  const GIT_STATE_KEY = 'e-git-popup-state';

  // Load persisted state from localStorage
  function loadGitState() {
    try {
      const saved = localStorage.getItem(GIT_STATE_KEY);
      if (saved) {
        const state = JSON.parse(saved);
        return {
          commitMessage: state.commitMessage || '',
          // Don't persist progress logs - they're session-specific
          commitProgress: [],
          // Don't persist errors across page reloads - they're stale if page reloaded
          gitError: '',
          lastMode: state.lastMode || 'actions',
        };
      }
    } catch {
      // Ignore parse errors
    }
    return {
      commitMessage: '',
      commitProgress: [],
      gitError: '',
      lastMode: 'actions' as const,
    };
  }

  // Save state to localStorage
  function saveGitState() {
    try {
      localStorage.setItem(
        GIT_STATE_KEY,
        JSON.stringify({
          commitMessage,
          // Don't persist progress logs - they're session-specific
          // Don't persist errors - they're session-specific
          lastMode: gitMenuMode,
        }),
      );
    } catch {
      // Ignore storage errors
    }
  }

  const savedState = loadGitState();
  let gitMenuOpen = $state(false);
  let gitMenuMode = $state<'actions' | 'commit' | 'confirm-clean' | 'confirm-push'>(
    savedState.lastMode,
  );
  let commitMessage = $state(savedState.commitMessage);
  let gitBusy = $state(false);
  let gitLocked = $derived(gitStore.indexLocked);
  let gitError = $state(savedState.gitError);
  let generating = $state(false);
  let commitProgress = $state<string[]>(savedState.commitProgress);
  let pushProgress = $state<string[]>([]);

  // ── Throbber phrase rotation (shared store) ──
  $effect(() => {
    if (!streamStore.isStreaming) {
      throbberStore.stop();
      return;
    }
    throbberStore.start(settingsStore.theme);
    return () => throbberStore.stop();
  });

  // Only show the throbber phrase in the statusbar when the streaming
  // conversation is NOT the focused chat (i.e. the user switched away)
  // AND the throbber has kicked in (after the initial delay).
  // When focused, the phrase appears inline in StreamingMessage instead.
  let showGutterPhrase = $derived(
    streamStore.isStreaming &&
      throbberStore.visible &&
      streamStore.conversationId !== null &&
      streamStore.conversationId !== conversationStore.activeId,
  );

  // Auto-save state when it changes
  $effect(() => {
    // Track dependencies (progress logs are not persisted, only commitMessage and mode)
    commitMessage;
    gitMenuMode;
    // Save on next tick to batch updates
    queueMicrotask(saveGitState);
  });

  async function handleGenerateMessage() {
    if (generating || gitBusy) return;
    generating = true;
    gitError = '';
    try {
      const res = await api.git.generateCommitMessage(settingsStore.workspacePath);
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

  function toggleGitMenu(e: MouseEvent) {
    e.stopPropagation();
    gitMenuOpen = !gitMenuOpen;
    // Clear session-specific state when opening fresh
    if (gitMenuOpen && !gitBusy) {
      commitProgress = [];
      pushProgress = [];
      gitError = '';
    }
  }

  function closeGitMenu() {
    gitMenuOpen = false;
  }

  function clearCommitState() {
    commitMessage = '';
    commitProgress = [];
    pushProgress = [];
    gitError = '';
    gitMenuMode = 'actions';
  }

  async function handleCommit() {
    if (!commitMessage.trim() || gitBusy || gitLocked) {
      console.warn(
        '[StatusBar] handleCommit BLOCKED: message=%s gitBusy=%s locked=%s',
        commitMessage.trim() ? `"${commitMessage.trim().slice(0, 30)}"` : '(empty)',
        gitBusy,
        gitLocked,
      );
      return;
    }
    gitBusy = true;
    gitError = '';
    commitProgress = [];
    console.log('[StatusBar] Committing with message:', commitMessage.trim());

    // Update shared store
    gitOperationsStore.startCommit();

    try {
      const result = await api.git.commitStream(
        settingsStore.workspacePath,
        commitMessage.trim(),
        (event) => {
          if (event.type === 'status') {
            commitProgress = [...commitProgress, event.message || ''];
            gitOperationsStore.addCommitProgress(event.message || '');
          } else if (event.type === 'output') {
            commitProgress = [...commitProgress, event.message || ''];
            gitOperationsStore.addCommitProgress(event.message || '');
          } else if (event.type === 'error') {
            gitError = event.message || 'Commit failed';
            gitOperationsStore.setCommitError(event.message || 'Commit failed');
          }
        },
      );

      console.log('[StatusBar] Commit result:', result);
      // Always refresh so the file list reflects actual git state
      await gitStore.refresh(settingsStore.workspacePath);
      if (result.ok) {
        console.log('[StatusBar] Commit succeeded, SHA:', result.sha);
        gitOperationsStore.endCommit(true);
        // Auto-close only on success, keep output visible briefly
        setTimeout(() => {
          if (!gitError) {
            gitMenuOpen = false;
            clearCommitState();
          }
        }, 1000);
      } else {
        console.log('[StatusBar] Commit failed:', result.error);
        gitError = result.error || 'Commit failed';
        gitOperationsStore.setCommitError(result.error || 'Commit failed');
        gitOperationsStore.endCommit(false);
        // Keep menu open on error so user can see what happened
      }
    } catch (err) {
      console.error('[StatusBar] handleCommit unexpected error:', err);
      gitError = `Unexpected error: ${err}`;
      gitOperationsStore.setCommitError(String(err));
      gitOperationsStore.endCommit(false);
    } finally {
      // ALWAYS reset busy flag — prevents the button from getting stuck disabled
      gitBusy = false;
    }
  }

  async function handleClean() {
    if (gitBusy || gitLocked) return;
    gitBusy = true;
    gitError = '';
    const result = await gitStore.clean(settingsStore.workspacePath);
    gitBusy = false;
    if (result.ok) {
      gitMenuOpen = false;
    } else {
      gitError = result.error || 'Clean failed';
    }
  }

  async function handlePush() {
    if (gitBusy || gitLocked) return;
    gitBusy = true;
    gitError = '';
    pushProgress = [];
    gitMenuMode = 'confirm-push';

    // Update shared store
    gitOperationsStore.startPush();

    const result = await api.git.pushStream(settingsStore.workspacePath, (event) => {
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

    gitBusy = false;
    if (result.ok) {
      gitOperationsStore.endPush(true);
      // Auto-close after showing success
      setTimeout(() => {
        if (!gitError) {
          gitMenuOpen = false;
          pushProgress = [];
        }
      }, 1000);
    } else {
      gitError = result.error || 'Push failed';
      gitOperationsStore.setPushError(result.error || 'Push failed');
      gitOperationsStore.endPush(false);
      // Keep menu open on error
    }
  }

  function handleViewChanges() {
    // Open the Git panel in the sidebar
    uiStore.setSidebarTab('git');
    gitMenuOpen = false;
  }

  // Accumulate session-wide spend
  let sessionCost = $state(0);
  let lastTrackedTokens = $state({ input: 0, output: 0 });

  $effect(() => {
    const { input, output } = streamStore.tokenUsage;
    if (input > lastTrackedTokens.input || output > lastTrackedTokens.output) {
      const deltaIn = input - lastTrackedTokens.input;
      const deltaOut = output - lastTrackedTokens.output;
      const p = PRICING[settingsStore.model] || DEFAULT_PRICING;
      sessionCost += (deltaIn / 1_000_000) * p.input + (deltaOut / 1_000_000) * p.output;
      lastTrackedTokens = { input, output };
    }
  });
</script>

<svelte:window onclick={closeGitMenu} />

<footer class="statusbar">
  {#if streamStore.isStreaming && settingsStore.streamingProgressBar !== 'none'}
    <div class="statusbar-throbber {settingsStore.streamingProgressBar}" aria-hidden="true"></div>
  {/if}
  <div class="statusbar-left">
    {#if gitStore.isRepo && gitStore.branch}
      <div class="git-gutter-wrapper">
        <button
          class="status-item git-branch"
          class:dirty={gitStore.isDirty}
          onclick={toggleGitMenu}
          aria-haspopup="menu"
          aria-expanded={gitMenuOpen}
          title={gitLocked
            ? `${gitStore.branch} — git operation in progress`
            : gitStore.isDirty
              ? `${gitStore.branch} — ${gitStore.dirtyCount} uncommitted change${gitStore.dirtyCount === 1 ? '' : 's'}`
              : `${gitStore.branch} — clean`}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle
              cx="6"
              cy="18"
              r="3"
            /><path d="M18 9a9 9 0 0 1-9 9" />
          </svg>
          {gitStore.branch}
          {#if gitStore.isDirty}
            <span class="git-dirty-badge">{gitStore.dirtyCount}</span>
          {/if}
          {#if commitProgress.length > 0 || pushProgress.length > 0 || gitError}
            <span class="git-output-badge" title="Git output available">●</span>
          {/if}
        </button>

        {#if gitMenuOpen}
          <div class="git-popover" role="menu" onclick={(e) => e.stopPropagation()}>
            {#if gitLocked}
              <div class="git-popover-lock-notice">
                <svg
                  class="spin"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path
                    d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"
                  />
                </svg>
                <span>Git operation in progress</span>
              </div>
            {/if}
            {#if !gitStore.isDirty}
              <div class="git-popover-item disabled">Working tree clean</div>
              <button
                type="button"
                class="git-popover-item"
                onclick={() => (gitMenuMode = 'confirm-push')}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polyline points="16 17 21 12 16 7" /><path d="M21 12H9" /><path
                    d="M5 21a9 9 0 0 1 0-18"
                  />
                </svg>
                Push to remote
              </button>
            {:else if gitMenuMode === 'actions'}
              <button type="button" class="git-popover-item" onclick={handleViewChanges}>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline
                    points="14 2 14 8 20 8"
                  /><line x1="9" y1="15" x2="15" y2="15" /><line x1="9" y1="12" x2="15" y2="12" />
                </svg>
                View changes
              </button>
              <button
                type="button"
                class="git-popover-item"
                onclick={() => (gitMenuMode = 'commit')}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <circle cx="12" cy="12" r="4" /><line x1="1.05" y1="12" x2="7" y2="12" /><line
                    x1="17.01"
                    y1="12"
                    x2="22.96"
                    y2="12"
                  />
                </svg>
                Commit all changes
              </button>
              <button
                type="button"
                class="git-popover-item"
                onclick={() => (gitMenuMode = 'confirm-push')}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polyline points="16 17 21 12 16 7" /><path d="M21 12H9" /><path
                    d="M5 21a9 9 0 0 1 0-18"
                  />
                </svg>
                Push to remote
              </button>
              <button
                type="button"
                class="git-popover-item danger"
                onclick={() => (gitMenuMode = 'confirm-clean')}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polyline points="3 6 5 6 21 6" /><path
                    d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
                  />
                </svg>
                Discard all changes
              </button>
            {:else if gitMenuMode === 'commit'}
              <div class="git-popover-form">
                <div class="git-commit-row">
                  <input
                    class="git-commit-input"
                    type="text"
                    placeholder="Commit message..."
                    bind:value={commitMessage}
                    onkeydown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleCommit();
                      }
                      if (e.key === 'Escape') {
                        gitMenuMode = 'actions';
                      }
                    }}
                    disabled={gitBusy || generating || gitLocked}
                  />
                  <button
                    type="button"
                    class="git-generate-btn"
                    onclick={handleGenerateMessage}
                    disabled={generating || gitBusy || gitLocked}
                    title="Auto-generate commit message"
                  >
                    {#if generating}
                      <svg
                        class="spin"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <line x1="12" y1="2" x2="12" y2="6" /><line
                          x1="12"
                          y1="18"
                          x2="12"
                          y2="22"
                        /><line x1="4.93" y1="4.93" x2="7.76" y2="7.76" /><line
                          x1="16.24"
                          y1="16.24"
                          x2="19.07"
                          y2="19.07"
                        /><line x1="2" y1="12" x2="6" y2="12" /><line
                          x1="18"
                          y1="12"
                          x2="22"
                          y2="12"
                        /><line x1="4.93" y1="19.07" x2="7.76" y2="16.24" /><line
                          x1="16.24"
                          y1="7.76"
                          x2="19.07"
                          y2="4.93"
                        />
                      </svg>
                    {:else}
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path d="M15 4V2" /><path d="M15 16v-2" /><path d="M8 9h2" /><path
                          d="M20 9h2"
                        /><path d="M17.8 11.8L19 13" /><path d="M15 9h0" /><path
                          d="M17.8 6.2L19 5"
                        /><path d="M3 21l9-9" /><path d="M12.2 6.2L11 5" />
                      </svg>
                    {/if}
                  </button>
                </div>
                <div class="git-popover-actions">
                  <button
                    type="button"
                    class="git-action-btn cancel"
                    onclick={() => (gitMenuMode = 'actions')}
                    disabled={gitBusy}>Cancel</button
                  >
                  <button
                    type="button"
                    class="git-action-btn confirm"
                    onclick={handleCommit}
                    disabled={!commitMessage.trim() || gitBusy || generating || gitLocked}
                    >{gitBusy ? 'Committing...' : gitLocked ? 'Git locked…' : 'Commit'}</button
                  >
                </div>
                {#if commitProgress.length > 0}
                  <div class="git-progress">
                    <div class="git-progress-header">
                      <span class="git-progress-title">Commit Output</span>
                      <button
                        type="button"
                        class="git-clear-btn"
                        onclick={clearCommitState}
                        title="Clear output"
                      >
                        ✕
                      </button>
                    </div>
                    {#each commitProgress.slice(-10) as line}
                      <div class="git-progress-line">{line}</div>
                    {/each}
                  </div>
                {/if}
                {#if gitError}
                  <div class="git-error">{gitError}</div>
                {/if}
              </div>
            {:else if gitMenuMode === 'confirm-clean'}
              <div class="git-popover-form">
                <div class="git-confirm-text">
                  Discard {gitStore.dirtyCount} change{gitStore.dirtyCount === 1 ? '' : 's'}? This
                  cannot be undone.
                </div>
                <div class="git-popover-actions">
                  <button
                    type="button"
                    class="git-action-btn cancel"
                    onclick={() => (gitMenuMode = 'actions')}
                    disabled={gitBusy}>Cancel</button
                  >
                  <button
                    type="button"
                    class="git-action-btn danger"
                    onclick={handleClean}
                    disabled={gitBusy || gitLocked}
                    >{gitBusy ? 'Cleaning...' : gitLocked ? 'Git locked…' : 'Discard'}</button
                  >
                </div>
                {#if gitError}
                  <div class="git-error">{gitError}</div>
                {/if}
              </div>
            {:else if gitMenuMode === 'confirm-push'}
              <div class="git-popover-form">
                <div class="git-confirm-text-normal">
                  Push {gitStore.branch} to origin?
                </div>
                <div class="git-popover-actions">
                  <button
                    type="button"
                    class="git-action-btn cancel"
                    onclick={() => (gitMenuMode = 'actions')}
                    disabled={gitBusy}>Cancel</button
                  >
                  <button
                    type="button"
                    class="git-action-btn confirm"
                    onclick={handlePush}
                    disabled={gitBusy || gitLocked}
                    >{gitBusy ? 'Pushing...' : gitLocked ? 'Git locked…' : 'Push'}</button
                  >
                </div>
                {#if pushProgress.length > 0}
                  <div class="git-progress">
                    <div class="git-progress-header">
                      <span class="git-progress-title">Push Output</span>
                      <button
                        type="button"
                        class="git-clear-btn"
                        onclick={clearCommitState}
                        title="Clear output"
                      >
                        ✕
                      </button>
                    </div>
                    {#each pushProgress.slice(-10) as line}
                      <div class="git-progress-line">{line}</div>
                    {/each}
                  </div>
                {/if}
                {#if gitError}
                  <div class="git-error">{gitError}</div>
                {/if}
              </div>
            {/if}
          </div>
        {/if}
      </div>
    {/if}

    {#if loopStore.isActive}
      <button
        class="status-item golem-status"
        class:running={loopStore.isRunning}
        class:paused={loopStore.isPaused}
        onclick={() => uiStore.setSidebarTab('work')}
        title="Golem: {loopStore.isRunning
          ? 'Running'
          : 'Paused'} — {loopStore.completedStories}/{loopStore.totalStories} stories"
      >
        <span class="golem-status-dot"></span>
        <span class="golem-status-text">
          Golem {loopStore.isRunning ? 'running' : 'paused'}
          {#if loopStore.totalStories > 0}
            ({loopStore.completedStories}/{loopStore.totalStories})
          {/if}
        </span>
      </button>
    {/if}

    {#if workStore.inProgressStories.length > 0}
      <span class="status-item task-status">
        {workStore.inProgressStories[0].title}
      </span>
    {/if}

    {#if showGutterPhrase}
      <span class="status-item">
        <span class="throbber-phrase">{throbberStore.phrase}</span>
      </span>
    {:else if streamStore.status === 'tool_pending'}
      <span class="status-item">
        <span class="status-dot pending"></span> Tool approval pending
      </span>
    {:else if streamStore.status === 'error'}
      <span class="status-item">
        <span class="status-dot error"></span> Error{#if streamStore.error}: {streamStore.error}{/if}
      </span>
    {/if}
  </div>

  <div class="statusbar-right">
    {#if editorStore.activeTab}
      <span class="status-item cursor-pos">
        {editorStore.activeTab.cursorLine}:{editorStore.activeTab.cursorCol}
      </span>
      <span class="status-item indent-label">
        {#if editorStore.activeTab.editorConfig?.indent_style === 'space'}
          Spaces: {editorStore.activeTab.editorConfig.indent_size ?? 4}
        {:else if editorStore.activeTab.editorConfig?.indent_style === 'tab'}
          Tabs: {editorStore.activeTab.editorConfig.tab_width ??
            editorStore.activeTab.editorConfig.indent_size ??
            4}
        {:else}
          Tab: 4
        {/if}
      </span>
      <span class="status-item lang-label">
        {editorStore.activeTab.language}
      </span>
      {@const lang = editorStore.activeTab.language}
      {@const lspStatus = lspStore.getStatus(lang)}
      {@const lspServerInfo = lspStore.getServerInfo(lang)}
      {#if lspStatus === 'ready'}
        <span class="status-item lsp-status" title="LSP connected">
          <span class="lsp-dot connected"></span> LSP
        </span>
      {:else if lspStatus === 'connecting'}
        <span class="status-item lsp-status" title="LSP connecting">
          <span class="lsp-dot connecting"></span> LSP
        </span>
      {:else if lspStore.isInstalling(lang)}
        <span class="status-item lsp-status" title="Installing language server...">
          <span class="lsp-dot connecting"></span> Installing...
        </span>
      {:else if lspStatus === 'error'}
        <span class="status-item lsp-status" title="LSP error">
          <span class="lsp-dot error"></span> LSP
        </span>
      {:else if lspServerInfo?.installable && !lspServerInfo?.available && !lspStore.isDismissed(lang)}
        <button
          class="status-item lsp-install"
          onclick={() => lspStore.installServer(lang, settingsStore.workspacePath)}
          title="Install {lspServerInfo.command} via npm"
        >
          Install LSP
        </button>
        <button
          class="status-item lsp-dismiss"
          onclick={() => lspStore.dismissInstall(lang)}
          title="Dismiss"
        >
          &times;
        </button>
      {:else if lspServerInfo?.systemInstallHint && !lspServerInfo?.available}
        <span class="status-item lsp-status" title={lspServerInfo.systemInstallHint}>
          <span class="lsp-dot error"></span> LSP not found
        </span>
      {/if}
    {/if}

    {#if settingsStore.showBudgetDisplay}
      {#if streamStore.tokenUsage.input || streamStore.tokenUsage.output}
        {@const cost = estimateCost(
          settingsStore.model,
          streamStore.tokenUsage.input,
          streamStore.tokenUsage.output,
        )}
        <span
          class="status-item tokens"
          title="Input: {streamStore.tokenUsage.input.toLocaleString()} / Output: {streamStore.tokenUsage.output.toLocaleString()} tokens"
        >
          {streamStore.tokenUsage.input.toLocaleString()}in / {streamStore.tokenUsage.output.toLocaleString()}out
          <span class="cost-badge">${cost}</span>
        </span>
      {/if}

      {#if sessionCost > 0}
        {@const budget = settingsStore.sessionBudgetUsd}
        {@const overBudget = budget && sessionCost >= budget}
        {@const nearBudget = budget && sessionCost >= budget * 0.8 && !overBudget}
        <span
          class="status-item session-cost"
          class:over-budget={overBudget}
          class:near-budget={nearBudget}
          title="Total session spend{budget ? ` (budget: $${budget.toFixed(2)})` : ''}"
        >
          Session: ${sessionCost.toFixed(4)}{budget ? ` / $${budget.toFixed(2)}` : ''}
        </span>
      {/if}
    {/if}

    <button
      class="status-item terminal-toggle"
      class:active={terminalStore.isOpen}
      onclick={() => terminalStore.toggle()}
      title="Toggle terminal (Ctrl+`)"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
      </svg>
      {#if terminalStore.isOpen && terminalStore.activeSessionId}
        {@const meta = terminalStore.sessions.get(terminalStore.activeSessionId)}
        {#if meta?.shell}
          <span class="terminal-shell-name">{meta.shell.split('/').pop()}</span>
        {/if}
      {/if}
      {#if terminalStore.sessions.size > 1}
        <span class="terminal-session-badge">{terminalStore.sessions.size}</span>
      {/if}
    </button>

    <span class="status-item mode">
      {settingsStore.permissionMode}
    </span>

    <VoiceModeIndicator />

    <button
      class="status-item model"
      onclick={() => (modelPickerOpen = !modelPickerOpen)}
      title="Switch model"
    >
      {settingsStore.model.split('-').slice(1, 3).join(' ')}
    </button>

    {#if modelPickerOpen}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="model-picker-backdrop"
        onclick={() => (modelPickerOpen = false)}
        onkeydown={() => {}}
      ></div>
      <div class="model-picker">
        {#each MODEL_OPTIONS as m}
          <button
            class="model-picker-option"
            class:active={settingsStore.model === m.id}
            onclick={() => {
              settingsStore.setModel(m.id);
              modelPickerOpen = false;
            }}
          >
            <span class="model-picker-label">{m.label}</span>
            <span class="model-picker-desc">{m.desc}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
</footer>

<style>
  .statusbar-throbber {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    transform: translateY(-100%);
    pointer-events: none;
  }
  .statusbar-throbber.rainbow {
    background: linear-gradient(
      in oklab 90deg,
      oklch(var(--rainbow-l) 0.2 0),
      oklch(var(--rainbow-l) 0.2 60),
      oklch(var(--rainbow-l) 0.2 120),
      oklch(var(--rainbow-l) 0.2 180),
      oklch(var(--rainbow-l) 0.2 240),
      oklch(var(--rainbow-l) 0.2 300),
      oklch(var(--rainbow-l) 0.2 360)
    );
    background-size: 200% 100%;
    animation: rainbowSlide 2s linear infinite;
  }
  .statusbar-throbber.accent {
    background: linear-gradient(90deg, transparent, var(--accent-primary), transparent);
    background-size: 200% 100%;
    animation: accentSlide 1.5s ease-in-out infinite;
  }
  .statusbar-throbber.pulse {
    background: var(--accent-primary);
    animation: barPulse 2s ease-in-out infinite;
  }

  /* ── Neon: breathing neon glow ── */
  .statusbar-throbber.neon {
    background: var(--accent-primary);
    animation: neonBreathe 1.8s ease-in-out infinite;
  }

  /* ── Cylon: Knight Rider scanner ── */
  .statusbar-throbber.cylon {
    background: transparent;
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    transform: translateY(-100%);
    overflow: hidden;
  }
  .statusbar-throbber.cylon::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 30%;
    height: 100%;
    background: linear-gradient(
      90deg,
      transparent,
      var(--accent-primary),
      var(--accent-primary),
      transparent
    );
    box-shadow:
      0 0 12px var(--accent-primary),
      0 0 4px var(--accent-primary);
    animation: cylonScan 1.4s ease-in-out infinite alternate;
  }

  /* ── Matrix: cascading digital green ── */
  .statusbar-throbber.matrix {
    background: repeating-linear-gradient(
      90deg,
      #00220080 0px,
      #00ff41cc 1px,
      #00ff4166 2px,
      #00220080 4px
    );
    background-size: 200% 100%;
    animation: matrixRain 0.8s linear infinite;
    box-shadow:
      0 0 8px #00ff4199,
      0 0 3px #00ff41cc;
  }

  /* ── Comet: bright dot streaking across ── */
  .statusbar-throbber.comet {
    background: transparent;
    overflow: hidden;
  }
  .statusbar-throbber.comet::after {
    content: '';
    position: absolute;
    top: 0;
    left: -10%;
    width: 10%;
    height: 100%;
    background: linear-gradient(
      90deg,
      transparent,
      var(--accent-primary) 60%,
      #fff 90%,
      transparent
    );
    box-shadow:
      0 0 8px var(--accent-primary),
      0 0 2px #fff;
    border-radius: 2px;
    animation: cometStreak 1.2s cubic-bezier(0.4, 0, 0.2, 1) infinite;
  }

  /* ── Helix: double-strand interweave ── */
  .statusbar-throbber.helix {
    background:
      repeating-linear-gradient(
        90deg,
        var(--accent-primary) 0px,
        transparent 2px,
        transparent 8px,
        var(--accent-primary) 10px
      ),
      repeating-linear-gradient(
        90deg,
        var(--accent-secondary) 4px,
        transparent 6px,
        transparent 12px,
        var(--accent-secondary) 14px
      );
    background-size:
      200% 100%,
      200% 100%;
    animation: helixSlide 1.5s linear infinite;
    opacity: 0.7;
  }

  /* ── Fire: warm blaze gradient ── */
  .statusbar-throbber.fire {
    background: linear-gradient(
      90deg,
      #ff440080,
      #ff880080,
      #ffcc0080,
      #ff660080,
      #ff220080,
      #ff880080
    );
    background-size: 300% 100%;
    animation: fireFlicker 1s ease-in-out infinite;
  }

  /* ── Ocean: deep blue wave ── */
  .statusbar-throbber.ocean {
    background: linear-gradient(
      90deg,
      #001a4d80,
      #0044aa80,
      #0088cc80,
      #00bbff80,
      #0066dd80,
      #001a4d80
    );
    background-size: 300% 100%;
    animation: oceanWave 3s ease-in-out infinite;
  }

  /* ── Electric: crackling spark ── */
  .statusbar-throbber.electric {
    background: transparent;
    overflow: hidden;
  }
  .statusbar-throbber.electric::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 100%;
    background: linear-gradient(
      90deg,
      transparent 0%,
      transparent 45%,
      var(--accent-primary) 48%,
      #fff 50%,
      var(--accent-primary) 52%,
      transparent 55%,
      transparent 100%
    );
    background-size: 200% 100%;
    animation: electricSpark 0.4s steps(3) infinite;
    box-shadow: 0 0 4px var(--accent-primary);
  }

  /* ── Candy: pastel barber pole ── */
  .statusbar-throbber.candy {
    background: repeating-linear-gradient(
      -45deg,
      #ff88cc60,
      #ff88cc60 4px,
      #88ccff60 4px,
      #88ccff60 8px,
      #88ff8860 8px,
      #88ff8860 12px,
      #ffcc8860 12px,
      #ffcc8860 16px
    );
    background-size: 200% 100%;
    animation: candyScroll 1s linear infinite;
  }

  /* ── Vapor: vaporwave aesthetic ── */
  .statusbar-throbber.vapor {
    background: linear-gradient(
      90deg,
      #ff71ce80,
      #01cdfe80,
      #05ffa180,
      #b967ff80,
      #fffb9680,
      #ff71ce80
    );
    background-size: 300% 100%;
    animation: vaporDrift 5s ease-in-out infinite;
    filter: blur(0.3px) saturate(1.2);
  }

  /* ── Keyframes ── */
  @keyframes rainbowSlide {
    0% {
      background-position: 0% 0%;
    }
    100% {
      background-position: 200% 0%;
    }
  }
  @keyframes accentSlide {
    0% {
      background-position: -200% 0%;
    }
    100% {
      background-position: 200% 0%;
    }
  }
  @keyframes barPulse {
    0%,
    100% {
      opacity: 0.15;
    }
    50% {
      opacity: 0.6;
      box-shadow: 0 0 8px var(--accent-primary);
    }
  }
  @keyframes neonBreathe {
    0%,
    100% {
      opacity: 0.2;
      box-shadow: 0 0 2px var(--accent-primary);
    }
    50% {
      opacity: 1;
      box-shadow:
        0 0 12px var(--accent-primary),
        0 0 24px var(--accent-primary),
        0 0 4px #fff;
    }
  }
  @keyframes cylonScan {
    0% {
      left: -30%;
    }
    100% {
      left: 100%;
    }
  }
  @keyframes matrixRain {
    0% {
      background-position: 0% 0%;
    }
    100% {
      background-position: -4px 0%;
    }
  }
  @keyframes cometStreak {
    0% {
      left: -10%;
      opacity: 0;
    }
    10% {
      opacity: 1;
    }
    90% {
      opacity: 1;
    }
    100% {
      left: 110%;
      opacity: 0;
    }
  }
  @keyframes helixSlide {
    0% {
      background-position:
        0% 0%,
        0% 0%;
    }
    100% {
      background-position:
        20px 0%,
        -20px 0%;
    }
  }
  @keyframes fireFlicker {
    0% {
      background-position: 0% 0%;
      opacity: 0.6;
    }
    25% {
      opacity: 0.9;
    }
    50% {
      background-position: 150% 0%;
      opacity: 0.5;
    }
    75% {
      opacity: 1;
    }
    100% {
      background-position: 300% 0%;
      opacity: 0.6;
    }
  }
  @keyframes oceanWave {
    0% {
      background-position: 0% 0%;
    }
    50% {
      background-position: 150% 0%;
    }
    100% {
      background-position: 300% 0%;
    }
  }
  @keyframes electricSpark {
    0% {
      background-position: 0% 0%;
      opacity: 0.3;
    }
    33% {
      background-position: 80% 0%;
      opacity: 1;
    }
    66% {
      background-position: 160% 0%;
      opacity: 0.2;
    }
    100% {
      background-position: 200% 0%;
      opacity: 0.8;
    }
  }
  @keyframes candyScroll {
    0% {
      background-position: 0 0;
    }
    100% {
      background-position: 32px 0;
    }
  }
  @keyframes vaporDrift {
    0% {
      background-position: 0% 0%;
    }
    50% {
      background-position: 150% 0%;
    }
    100% {
      background-position: 300% 0%;
    }
  }

  .statusbar {
    height: var(--statusbar-height);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    background: var(--bg-secondary);
    border-top: var(--ht-separator);
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-tertiary);
    flex-shrink: 0;
    letter-spacing: var(--ht-label-spacing);
    text-transform: var(--ht-label-transform);
    position: relative;
    z-index: 1;
  }
  /* Let canvas effects bleed through in magic hyperthemes */
  :global([data-hypertheme='arcane']) .statusbar,
  :global([data-hypertheme='ethereal']) .statusbar,
  :global([data-hypertheme='astral']) .statusbar,
  :global([data-hypertheme='astral-midnight']) .statusbar {
    background: var(--bg-glass);
  }
  :global([data-hypertheme='study']) .statusbar {
    background: transparent;
  }

  .statusbar-left,
  .statusbar-right {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .status-item {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: var(--radius-sm);
    transition: all var(--transition);
  }
  .status-dot.idle {
    background: var(--text-tertiary);
  }
  .status-dot.streaming {
    background: var(--accent-secondary);
    box-shadow:
      0 0 6px var(--accent-secondary),
      var(--shadow-glow-sm);
    animation: pulse 1.2s infinite;
  }
  .status-dot.pending {
    background: var(--accent-warning);
    box-shadow: 0 0 6px var(--accent-warning);
    animation: pulse 1.2s infinite;
  }
  .status-dot.error {
    background: var(--accent-error);
    box-shadow: 0 0 6px var(--accent-error);
  }

  .throbber-phrase {
    display: inline-block;
    animation: phraseFadeIn 0.4s ease-out;
    font-style: italic;
  }

  @keyframes phraseFadeIn {
    0% {
      opacity: 0;
      transform: translateY(2px);
    }
    100% {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .git-gutter-wrapper {
    position: relative;
  }

  .git-branch {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    text-transform: none;
    cursor: pointer;
    border: none;
    background: none;
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    transition: all var(--transition);
    font-weight: 600;
    font-family: inherit;
    letter-spacing: inherit;
  }
  .git-branch:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }
  .git-branch.dirty {
    color: var(--accent-warning);
  }

  .git-dirty-badge {
    font-size: var(--fs-xxs);
    font-weight: 700;
    min-width: 16px;
    height: 16px;
    line-height: 16px;
    text-align: center;
    border-radius: 8px;
    background: var(--accent-warning);
    color: var(--bg-primary);
    margin-left: 2px;
    padding: 0 4px;
  }

  .git-output-badge {
    font-size: var(--fs-xxs);
    color: var(--accent-primary);
    margin-left: 4px;
    animation: pulse 2s infinite;
  }

  /* ── Git popover (opens upward from statusbar) ── */
  .git-popover {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    z-index: 200;
    min-width: 220px;
    background: var(--bg-elevated, var(--bg-secondary));
    border: 1px solid var(--border-primary);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
    padding: 4px;
    animation: gitPopIn 0.12s ease;
  }

  @keyframes gitPopIn {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .git-popover-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 10px;
    border: none;
    background: none;
    color: var(--text-primary);
    font-size: var(--fs-xs);
    font-family: inherit;
    font-weight: 500;
    border-radius: var(--radius-sm);
    cursor: pointer;
    text-align: left;
    transition: background var(--transition);
    text-transform: none;
    letter-spacing: normal;
  }
  .git-popover-item:hover {
    background: var(--bg-hover);
  }
  .git-popover-item.danger {
    color: var(--accent-error);
  }
  .git-popover-item.danger:hover {
    background: color-mix(in srgb, var(--accent-error) 12%, transparent);
  }
  .git-popover-item.disabled {
    color: var(--text-tertiary);
    cursor: default;
    font-style: italic;
  }
  .git-popover-item.disabled:hover {
    background: none;
  }

  .git-popover-lock-notice {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-warning, #eab308);
    background: rgba(234, 179, 8, 0.08);
    border-bottom: 1px solid rgba(234, 179, 8, 0.2);
  }

  .git-popover-form {
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .git-commit-input {
    width: 100%;
    padding: 6px 8px;
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    background: var(--bg-primary);
    color: var(--text-primary);
    font-size: var(--fs-xs);
    font-family: inherit;
    outline: none;
    transition: border-color var(--transition);
  }
  .git-commit-input:focus {
    border-color: var(--accent-primary);
  }
  .git-commit-input:disabled {
    opacity: 0.5;
  }

  .git-commit-row {
    display: flex;
    gap: 4px;
    align-items: center;
  }
  .git-commit-row .git-commit-input {
    flex: 1;
  }

  .git-generate-btn {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    background: var(--bg-tertiary);
    color: var(--accent-primary);
    cursor: pointer;
    transition: all var(--transition);
    padding: 0;
  }
  .git-generate-btn:hover:not(:disabled) {
    background: var(--accent-primary);
    color: var(--bg-primary);
    border-color: var(--accent-primary);
  }
  .git-generate-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .git-generate-btn .spin {
    animation: gitSpin 1s linear infinite;
  }

  @keyframes gitSpin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .git-popover-actions {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
  }

  .git-action-btn {
    padding: 4px 10px;
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    font-size: var(--fs-xxs);
    font-family: inherit;
    font-weight: 600;
    cursor: pointer;
    transition: all var(--transition);
    text-transform: none;
    letter-spacing: normal;
  }
  .git-action-btn.cancel {
    background: var(--bg-tertiary);
    color: var(--text-secondary);
  }
  .git-action-btn.cancel:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .git-action-btn.confirm {
    background: var(--accent-primary);
    color: var(--bg-primary);
    border-color: var(--accent-primary);
  }
  .git-action-btn.confirm:hover {
    filter: brightness(1.1);
  }
  .git-action-btn.confirm:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .git-action-btn.danger {
    background: var(--accent-error);
    color: var(--bg-primary);
    border-color: var(--accent-error);
  }
  .git-action-btn.danger:hover {
    filter: brightness(1.1);
  }
  .git-action-btn.danger:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .git-confirm-text {
    font-size: var(--fs-xs);
    color: var(--accent-error);
    font-weight: 500;
    padding: 2px 0;
    text-transform: none;
    letter-spacing: normal;
  }

  .git-confirm-text-normal {
    font-size: var(--fs-xs);
    color: var(--text-primary);
    font-weight: 500;
    padding: 2px 0;
    text-transform: none;
    letter-spacing: normal;
  }

  .git-progress {
    max-height: 150px;
    overflow-y: auto;
    background: var(--bg-primary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    margin-top: 6px;
    font-family: var(--font-family);
  }
  .git-progress-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 6px;
    border-bottom: 1px solid var(--border-primary);
    position: sticky;
    top: 0;
    background: var(--bg-primary);
    z-index: 1;
  }
  .git-progress-title {
    font-size: var(--fs-xxs);
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .git-clear-btn {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0 4px;
    line-height: 1;
    transition: color var(--transition);
  }
  .git-clear-btn:hover {
    color: var(--accent-error);
  }
  .git-progress-line {
    font-size: var(--fs-xxs);
    color: var(--text-secondary);
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
    text-transform: none;
    letter-spacing: normal;
    padding: 2px 6px;
  }

  .git-error {
    font-size: var(--fs-xxs);
    color: var(--accent-error);
    padding: 2px 4px;
    text-transform: none;
    letter-spacing: normal;
  }

  /* ── Golem status in statusbar ── */
  .golem-status {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 1px 10px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    border: 1px solid transparent;
    font-weight: 700;
    font-size: var(--fs-xs);
    transition: all var(--transition);
    text-transform: none;
  }
  .golem-status.running {
    color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
    border-color: color-mix(in srgb, var(--accent-primary) 30%, transparent);
  }
  .golem-status.paused {
    color: var(--accent-warning);
    background: color-mix(in srgb, var(--accent-warning) 12%, transparent);
    border-color: color-mix(in srgb, var(--accent-warning) 30%, transparent);
  }
  .golem-status:hover {
    filter: brightness(1.2);
  }
  .golem-status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .golem-status.running .golem-status-dot {
    background: var(--accent-primary);
    box-shadow: 0 0 8px var(--accent-primary);
    animation: golemDotPulse 1.5s ease-in-out infinite;
  }
  .golem-status.paused .golem-status-dot {
    background: var(--accent-warning);
    box-shadow: 0 0 6px var(--accent-warning);
  }
  .golem-status-text {
    white-space: nowrap;
  }

  @keyframes golemDotPulse {
    0%,
    100% {
      box-shadow: 0 0 4px var(--accent-primary);
      transform: scale(1);
    }
    50% {
      box-shadow:
        0 0 12px var(--accent-primary),
        0 0 20px color-mix(in srgb, var(--accent-primary) 40%, transparent);
      transform: scale(1.2);
    }
  }

  .task-status {
    color: var(--accent-primary);
    animation: pulse 2s infinite;
    font-weight: 700;
  }

  .cursor-pos {
    font-family: var(--font-family);
    font-size: var(--fs-xs);
    color: var(--text-secondary);
  }

  .indent-label {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
  }

  .lang-label {
    font-size: var(--fs-xs);
    text-transform: uppercase;
    color: var(--text-secondary);
  }

  .tokens {
    font-family: var(--font-family);
    font-size: var(--fs-xs);
    letter-spacing: 0.5px;
    color: var(--accent-primary);
  }
  .cost-badge {
    padding: 0 4px;
    background: var(--bg-active);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    font-weight: 700;
    font-size: var(--fs-xxs);
    margin-left: 4px;
  }
  .session-cost {
    font-family: var(--font-family);
    font-size: var(--fs-xs);
    letter-spacing: 0.5px;
    color: var(--accent-secondary);
    font-weight: 700;
  }
  .session-cost.near-budget {
    color: var(--accent-warning);
  }
  .session-cost.over-budget {
    color: var(--accent-error);
    animation: pulse 1.2s infinite;
  }

  .terminal-toggle {
    cursor: pointer;
    padding: 2px 4px;
    border-radius: var(--radius-sm);
    color: var(--text-tertiary);
    transition: all var(--transition);
    border: none;
    background: none;
  }
  .terminal-toggle:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }
  .terminal-toggle.active {
    color: var(--accent-primary);
  }

  .terminal-shell-name {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    margin-left: 2px;
    text-transform: none;
  }

  .terminal-session-badge {
    font-size: var(--fs-xxs);
    font-weight: 700;
    min-width: 16px;
    height: 16px;
    line-height: 16px;
    text-align: center;
    border-radius: 8px;
    background: var(--accent-primary);
    color: var(--bg-primary);
    margin-left: 2px;
    padding: 0 4px;
  }

  .mode {
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
    padding: 1px 8px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    font-size: var(--fs-xs);
    font-weight: 700;
    color: var(--text-secondary);
  }

  /* ── Model picker ── */
  .model {
    cursor: pointer;
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
    padding: 1px 8px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    font-size: var(--fs-xs);
    font-weight: 700;
    color: var(--accent-primary);
    transition: all var(--transition);
  }
  .model:hover {
    border-color: var(--accent-primary);
    box-shadow: var(--shadow-glow-sm);
  }

  .model-picker-backdrop {
    position: fixed;
    inset: 0;
    z-index: 99;
  }
  .model-picker {
    position: absolute;
    bottom: calc(100% + 4px);
    right: 8px;
    z-index: 100;
    min-width: 200px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
    padding: 4px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .model-picker-option {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    border: 1px solid transparent;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
    transition: all var(--transition);
    text-align: left;
    width: 100%;
  }
  .model-picker-option:hover {
    background: var(--bg-hover);
    border-color: var(--border-primary);
  }
  .model-picker-option.active {
    background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }
  .model-picker-label {
    font-size: var(--fs-sm);
    font-weight: 700;
    letter-spacing: var(--ht-label-spacing);
    text-transform: var(--ht-label-transform);
  }
  .model-picker-desc {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    font-weight: 400;
  }
  .model-picker-option.active .model-picker-desc {
    color: color-mix(in srgb, var(--accent-primary) 70%, var(--text-tertiary));
  }

  .lsp-status {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    text-transform: uppercase;
  }
  .lsp-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: var(--radius-sm);
  }
  .lsp-dot.connected {
    background: var(--accent-secondary);
    box-shadow: 0 0 4px var(--accent-secondary);
  }
  .lsp-dot.connecting {
    background: var(--accent-warning);
  }
  .lsp-dot.error {
    background: var(--accent-error);
  }

  .lsp-install {
    font-size: var(--fs-xs);
    padding: 1px 8px;
    background: var(--bg-tertiary);
    border: 1px solid var(--accent-primary);
    border-radius: var(--radius-sm);
    color: var(--accent-primary);
    cursor: pointer;
    transition: all var(--transition);
    letter-spacing: var(--ht-label-spacing);
    text-transform: var(--ht-label-transform);
    font-weight: 700;
  }
  .lsp-install:hover {
    background: var(--accent-primary);
    color: var(--bg-primary);
  }

  .lsp-dismiss {
    font-size: var(--fs-sm);
    padding: 0 4px;
    background: none;
    border: none;
    color: var(--text-tertiary);
    cursor: pointer;
    line-height: 1;
  }
  .lsp-dismiss:hover {
    color: var(--text-primary);
  }

  /* ── Mobile: hide editor-specific clutter, keep stream status ── */
  :global([data-mobile]) .cursor-pos,
  :global([data-mobile]) .indent-label,
  :global([data-mobile]) .lang-label,
  :global([data-mobile]) .lsp-status,
  :global([data-mobile]) .lsp-install,
  :global([data-mobile]) .lsp-dismiss,
  :global([data-mobile]) .tokens,
  :global([data-mobile]) .session-cost,
  :global([data-mobile]) .mode,
  :global([data-mobile]) .model {
    display: none;
  }
  :global([data-mobile]) .task-status {
    max-width: 40vw;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  :global([data-mobile]) .statusbar {
    padding: 0 10px;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.3;
    }
  }
</style>
