<script lang="ts">
  import { loopStore } from '$lib/stores/loop.svelte';
  import { workStore } from '$lib/stores/work.svelte';
  import { primaryPaneStore } from '$lib/stores/primaryPane.svelte';
  import type { IterationLogEntry, QualityCheckResult, UserStory } from '@e/shared';
  import { onMount, onDestroy } from 'svelte';

  let { loopId }: { loopId: string } = $props();

  // --- Elapsed time ticker ---
  let now = $state(Date.now());
  let ticker: ReturnType<typeof setInterval> | null = null;
  onMount(() => {
    ticker = setInterval(() => (now = Date.now()), 1000);
  });
  onDestroy(() => {
    if (ticker) clearInterval(ticker);
  });

  // --- Derived state ---
  let loop = $derived(loopStore.activeLoop);
  let log = $derived(loopStore.log);
  let config = $derived(loop?.config);
  let stories = $derived(getStories());
  let currentStory = $derived(stories.find((s) => s.id === loop?.currentStoryId) ?? null);

  function getStories(): UserStory[] {
    if (loop?.prdId) {
      return loopStore.selectedPrd?.stories ?? [];
    }
    return workStore.standaloneStories;
  }

  // --- Status helpers ---
  const statusColors: Record<string, string> = {
    running: 'var(--accent-primary)',
    paused: 'var(--accent-warning)',
    completed: 'var(--accent-secondary)',
    completed_with_failures: 'var(--accent-warning)',
    failed: 'var(--accent-error)',
    cancelled: 'var(--text-tertiary)',
  };

  const statusLabels: Record<string, string> = {
    running: 'Running',
    paused: 'Paused',
    completed: 'Completed',
    completed_with_failures: 'Partial Success',
    failed: 'Failed',
    cancelled: 'Cancelled',
  };

  function formatElapsed(startMs: number, endMs?: number): string {
    const ms = (endMs ?? now) - startMs;
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rs = s % 60;
    if (m < 60) return `${m}m ${rs}s`;
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return `${h}h ${rm}m`;
  }

  function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  // --- Per-story execution state derived from iteration log ---
  interface StoryExecState {
    freshAttempts: number;
    currentFixUp: number;
    maxFixUps: number;
    maxAttempts: number;
    lastQualityResults: QualityCheckResult[];
    isActive: boolean;
    lastAction: string;
  }

  function deriveStoryState(storyId: string): StoryExecState {
    const entries = log.filter((e) => e.storyId === storyId);
    let freshAttempts = 0;
    let currentFixUp = 0;
    const maxFixUps = config?.maxFixUpAttempts ?? 2;
    const maxAttempts = config?.maxAttemptsPerStory ?? 3;
    let lastQualityResults: QualityCheckResult[] = [];
    let lastAction = '';

    for (const entry of entries) {
      if (entry.action === 'started') {
        if (entry.detail.includes('Fix-up pass')) {
          const match = entry.detail.match(/Fix-up pass (\d+)\/(\d+)/);
          if (match) {
            currentFixUp = parseInt(match[1]);
          }
        } else {
          freshAttempts++;
          currentFixUp = 0;
        }
      }
      if (entry.action === 'quality_check' && entry.qualityResults?.length) {
        lastQualityResults = entry.qualityResults;
      }
      lastAction = entry.action;
    }

    return {
      freshAttempts,
      currentFixUp,
      maxFixUps,
      maxAttempts,
      lastQualityResults,
      isActive: storyId === loop?.currentStoryId,
      lastAction,
    };
  }

  // --- Story grouping ---
  interface GroupedStories {
    inProgress: UserStory[];
    pending: UserStory[];
    qa: UserStory[];
    completed: UserStory[];
    failed: UserStory[];
  }

  let grouped = $derived<GroupedStories>({
    inProgress: stories.filter((s) => s.status === 'in_progress'),
    pending: stories.filter((s) => s.status === 'pending' && !s.researchOnly),
    qa: stories.filter((s) => s.status === 'qa'),
    completed: stories.filter((s) => s.status === 'completed'),
    failed: stories.filter((s) => s.status === 'failed'),
  });

  // --- Expandable quality output ---
  let expandedChecks = $state<Set<string>>(new Set());
  function toggleCheck(checkId: string) {
    const next = new Set(expandedChecks);
    if (next.has(checkId)) next.delete(checkId);
    else next.add(checkId);
    expandedChecks = next;
  }

  // --- Expandable log stories ---
  let expandedLogStories = $state<Set<string>>(new Set());
  function toggleLogStory(storyId: string) {
    const next = new Set(expandedLogStories);
    if (next.has(storyId)) next.delete(storyId);
    else next.add(storyId);
    expandedLogStories = next;
  }

  // --- Expandable log quality output ---
  let expandedLogOutputs = $state<Set<number>>(new Set());
  function toggleLogOutput(idx: number) {
    const next = new Set(expandedLogOutputs);
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    expandedLogOutputs = next;
  }

  // --- Actions ---
  function openConversation(conversationId: string | undefined, title: string) {
    if (!conversationId) return;
    primaryPaneStore.openConversation(conversationId, title);
  }

  async function handleResetStory(storyId: string, title: string) {
    const res = await loopStore.resetStory(storyId);
    if (!res.ok) {
      console.error(`Failed to reset story "${title}":`, res.error);
    }
  }

  async function handleRetryAllFailed() {
    if (!loop) return;
    const count = grouped.failed.length;
    if (!confirm(`Reset ${count} failed stor${count === 1 ? 'y' : 'ies'} and restart the loop?`))
      return;
    const res = await loopStore.resetFailedAndRestart(loop.prdId, loop.workspacePath, config);
    if (!res.ok) {
      console.error('Failed to retry all:', res.error);
    }
  }

  // --- Timeline grouped by story ---
  interface StoryLogGroup {
    storyId: string;
    storyTitle: string;
    entries: (IterationLogEntry & { originalIndex: number })[];
  }

  let timelineGroups = $derived.by<StoryLogGroup[]>(() => {
    const groups = new Map<string, StoryLogGroup>();
    const ordered: string[] = [];

    // Walk entries from newest to oldest
    for (let i = log.length - 1; i >= 0; i--) {
      const entry = log[i];
      if (!groups.has(entry.storyId)) {
        groups.set(entry.storyId, {
          storyId: entry.storyId,
          storyTitle: entry.storyTitle,
          entries: [],
        });
        ordered.push(entry.storyId);
      }
      groups.get(entry.storyId)!.entries.push({ ...entry, originalIndex: i });
    }

    return ordered.map((id) => groups.get(id)!);
  });

  // Priority badge
  function priorityLabel(p: string): string {
    if (p === 'critical') return '!!!';
    if (p === 'high') return '!!';
    if (p === 'medium') return '!';
    return '';
  }

  const priorityColors: Record<string, string> = {
    critical: 'var(--accent-error)',
    high: 'var(--accent-warning)',
    medium: 'var(--accent-primary)',
    low: 'var(--text-tertiary)',
  };

  // Action icons for log
  const actionIcons: Record<string, string> = {
    started: 'M12 5v14M5 12h14', // plus
    passed: 'M20 6L9 17l-5-5', // check
    failed: 'M18 6L6 18M6 6l12 12', // x
    committed: 'M16 3h5v5M4 20L21 3', // arrow
    quality_check:
      'M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83', // sun/gear
    learning: 'M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z', // book
    skipped: 'M5 4l10 8-10 8V4z', // skip
  };

  const actionColors: Record<string, string> = {
    started: 'var(--accent-primary)',
    passed: 'var(--accent-secondary)',
    failed: 'var(--accent-error)',
    committed: 'var(--accent-secondary)',
    quality_check: 'var(--text-tertiary)',
    learning: 'var(--accent-warning)',
    skipped: 'var(--text-tertiary)',
  };
</script>

<div class="looper-view">
  {#if !loop}
    <div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M17 1l4 4-4 4" />
        <path d="M3 11V9a4 4 0 0 1 4-4h14" />
        <path d="M7 23l-4-4 4-4" />
        <path d="M21 13v2a4 4 0 0 1-4 4H3" />
      </svg>
      <p>No active loop</p>
      <span>Start a loop from the sidebar to see it here</span>
    </div>
  {:else}
    <!-- ═══ Section A: Status Header ═══ -->
    <div class="status-header">
      <div class="status-left">
        <span
          class="status-badge"
          style:background={statusColors[loop.status] ?? 'var(--text-tertiary)'}
        >
          {statusLabels[loop.status] ?? loop.status}
        </span>
        <span class="elapsed">{formatElapsed(loop.startedAt, loop.completedAt)}</span>
      </div>
      <div class="status-center">
        <span class="config-tag"
          >{config?.model?.split('-').slice(1, 3).join(' ') ?? 'unknown'}</span
        >
        <span class="config-sep">/</span>
        <span class="config-tag">{config?.effort ?? '?'} effort</span>
        <span class="config-sep">/</span>
        <span class="config-tag"
          >{config?.maxAttemptsPerStory ?? 3}a x {config?.maxFixUpAttempts ?? 2}f</span
        >
      </div>
      <div class="status-right">
        {#if loopStore.isRunning}
          <button class="ctrl-btn warning" onclick={() => loopStore.pauseLoop()}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"
              ><rect x="4" y="3" width="6" height="18" rx="1" /><rect
                x="14"
                y="3"
                width="6"
                height="18"
                rx="1"
              /></svg
            >
            Pause
          </button>
        {:else if loopStore.isPaused}
          <button class="ctrl-btn primary" onclick={() => loopStore.resumeLoop()}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"
              ><polygon points="5 3 19 12 5 21 5 3" /></svg
            >
            Resume
          </button>
        {/if}
        {#if loopStore.isActive}
          <button
            class="ctrl-btn danger"
            onclick={() => {
              if (confirm('Cancel the loop?')) loopStore.cancelLoop();
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"
              ><rect x="4" y="4" width="16" height="16" rx="2" /></svg
            >
            Cancel
          </button>
        {/if}
      </div>
    </div>

    <!-- ═══ Section B: Progress Overview ═══ -->
    <div class="progress-section">
      <div class="progress-bar-container">
        <div class="progress-bar-fill" style:width="{loopStore.progress}%"></div>
        {#if loop.totalStoriesFailed > 0}
          <div
            class="progress-bar-failed"
            style:width="{(loop.totalStoriesFailed / loopStore.totalStories) * 100}%"
          ></div>
        {/if}
      </div>
      <div class="progress-stats">
        <span class="stat">
          <strong>{loop.totalStoriesCompleted}</strong> of <strong>{loopStore.totalStories}</strong> completed
        </span>
        {#if loop.totalStoriesFailed > 0}
          <span class="stat failed-stat">{loop.totalStoriesFailed} failed</span>
        {/if}
        <span class="stat-sep"></span>
        <span class="stat muted"
          >Iteration {loop.currentIteration} of {config?.maxIterations ?? '?'}</span
        >
      </div>
    </div>

    <div class="scroll-area">
      <!-- ═══ Section C: Current Story Focus ═══ -->
      {#if currentStory}
        {@const execState = deriveStoryState(currentStory.id)}
        <div class="section">
          <h3 class="section-title">Current Story</h3>
          <div class="current-story-card">
            <div class="cs-header">
              <span class="cs-title">{currentStory.title}</span>
              {#if priorityLabel(currentStory.priority)}
                <span class="priority-badge" style:color={priorityColors[currentStory.priority]}>
                  {priorityLabel(currentStory.priority)}
                </span>
              {/if}
              {#if currentStory.conversationId}
                <button
                  class="cs-link"
                  onclick={() =>
                    openConversation(currentStory?.conversationId, currentStory?.title ?? 'Story')}
                >
                  View chat
                </button>
              {/if}
            </div>

            <!-- Attempt / Fix-up cycle visualization -->
            <div class="cycle-viz">
              <div class="cycle-row">
                <span class="cycle-label">Attempt</span>
                <div class="cycle-dots">
                  {#each Array(execState.maxAttempts) as _, i}
                    <div
                      class="cycle-dot attempt-dot"
                      class:active={i + 1 === execState.freshAttempts}
                      class:done={i + 1 < execState.freshAttempts}
                    >
                      {i + 1}
                    </div>
                    {#if i < execState.maxAttempts - 1}
                      <div
                        class="cycle-connector"
                        class:done={i + 1 < execState.freshAttempts}
                      ></div>
                    {/if}
                  {/each}
                </div>
              </div>
              {#if execState.maxFixUps > 0}
                <div class="cycle-row sub-row">
                  <span class="cycle-label">Fix-up</span>
                  <div class="cycle-dots">
                    {#each Array(execState.maxFixUps) as _, i}
                      <div
                        class="cycle-dot fixup-dot"
                        class:active={i + 1 === execState.currentFixUp}
                        class:done={i + 1 < execState.currentFixUp}
                      >
                        {i + 1}
                      </div>
                      {#if i < execState.maxFixUps - 1}
                        <div
                          class="cycle-connector small"
                          class:done={i + 1 < execState.currentFixUp}
                        ></div>
                      {/if}
                    {/each}
                    {#if execState.currentFixUp === 0}
                      <span class="cycle-hint">not yet triggered</span>
                    {/if}
                  </div>
                </div>
              {/if}
            </div>

            <!-- Quality checks -->
            {#if execState.lastQualityResults.length > 0}
              <div class="qc-section">
                <span class="qc-title">Quality Checks</span>
                {#each execState.lastQualityResults as qr}
                  <div class="qc-row">
                    <span class="qc-icon" class:passed={qr.passed} class:failed={!qr.passed}>
                      {qr.passed ? '\u2713' : '\u2717'}
                    </span>
                    <span class="qc-name">{qr.checkName}</span>
                    <span class="qc-duration">{(qr.duration / 1000).toFixed(1)}s</span>
                    {#if !qr.passed && qr.output}
                      <button class="qc-expand" onclick={() => toggleCheck(qr.checkId)}>
                        {expandedChecks.has(qr.checkId) ? 'hide' : 'show output'}
                      </button>
                    {/if}
                  </div>
                  {#if expandedChecks.has(qr.checkId) && qr.output}
                    <pre class="qc-output">{qr.output.slice(0, 3000)}</pre>
                  {/if}
                {/each}
              </div>
            {/if}
          </div>
        </div>
      {:else if loopStore.isActive}
        <div class="section">
          <h3 class="section-title">Current Story</h3>
          <div class="current-story-card empty-card">
            <span class="muted">Selecting next story...</span>
          </div>
        </div>
      {/if}

      <!-- ═══ Section D: Story Pipeline ═══ -->
      <div class="section">
        <h3 class="section-title">Stories ({stories.length})</h3>

        {#if grouped.inProgress.length > 0}
          <div class="pipeline-group">
            {#each grouped.inProgress as story (story.id)}
              {@const exec = deriveStoryState(story.id)}
              <div class="pipeline-row active">
                <span class="pl-icon spinning">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                    ><path
                      d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"
                    /></svg
                  >
                </span>
                <span class="pl-title">{story.title}</span>
                {#if priorityLabel(story.priority)}
                  <span class="priority-badge small" style:color={priorityColors[story.priority]}
                    >{priorityLabel(story.priority)}</span
                  >
                {/if}
                <span class="pl-attempts"
                  >{exec.freshAttempts}/{exec.maxAttempts}{exec.currentFixUp > 0
                    ? ` f${exec.currentFixUp}`
                    : ''}</span
                >
              </div>
            {/each}
          </div>
        {/if}

        {#if grouped.pending.length > 0}
          <div class="pipeline-group">
            <span class="pipeline-group-label">Pending ({grouped.pending.length})</span>
            {#each grouped.pending as story (story.id)}
              <div class="pipeline-row">
                <span class="pl-icon pending">
                  <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="4" /></svg
                  >
                </span>
                <span class="pl-title">{story.title}</span>
                {#if priorityLabel(story.priority)}
                  <span class="priority-badge small" style:color={priorityColors[story.priority]}
                    >{priorityLabel(story.priority)}</span
                  >
                {/if}
                {#if story.dependsOn.length > 0}
                  <span class="pl-dep">dep:{story.dependsOn.length}</span>
                {/if}
              </div>
            {/each}
          </div>
        {/if}

        {#if grouped.completed.length > 0}
          <div class="pipeline-group">
            <span class="pipeline-group-label">Completed ({grouped.completed.length})</span>
            {#each grouped.completed as story (story.id)}
              <div
                class="pipeline-row completed"
                role="button"
                tabindex="0"
                onclick={() => openConversation(story.conversationId, story.title)}
                onkeydown={(e) =>
                  e.key === 'Enter' && openConversation(story.conversationId, story.title)}
              >
                <span class="pl-icon done">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
                    ><path d="M20 6L9 17l-5-5" /></svg
                  >
                </span>
                <span class="pl-title">{story.title}</span>
                {#if story.commitSha}
                  <span class="pl-sha">{story.commitSha.slice(0, 7)}</span>
                {/if}
              </div>
            {/each}
          </div>
        {/if}

        {#if grouped.failed.length > 0}
          <div class="pipeline-group">
            <div class="pipeline-group-header">
              <span class="pipeline-group-label">Failed ({grouped.failed.length})</span>
              {#if !loopStore.isActive}
                <button
                  class="retry-all-btn"
                  onclick={handleRetryAllFailed}
                  title="Reset all failed stories and restart the loop"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="23 4 23 10 17 10" />
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                  Retry all
                </button>
              {/if}
            </div>
            {#each grouped.failed as story (story.id)}
              <div class="pipeline-row failed-row">
                <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
                <div
                  class="failed-row-main"
                  onclick={() => openConversation(story.conversationId, story.title)}
                >
                  <span class="pl-icon failed">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
                      ><path d="M18 6L6 18M6 6l12 12" /></svg
                    >
                  </span>
                  <span class="pl-title">{story.title}</span>
                  <span class="pl-attempts fail">{story.attempts}/{story.maxAttempts}</span>
                  {#if story.learnings.length > 0}
                    <span class="pl-learnings"
                      >{story.learnings.length} learning{story.learnings.length !== 1
                        ? 's'
                        : ''}</span
                    >
                  {/if}
                </div>
                <button
                  class="retry-btn"
                  onclick={() => handleResetStory(story.id, story.title)}
                  title="Reset attempts and move back to pending"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="23 4 23 10 17 10" />
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                </button>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <!-- ═══ Section E: Activity Timeline ═══ -->
      <div class="section">
        <h3 class="section-title">Activity ({log.length})</h3>
        <div class="timeline">
          {#each timelineGroups as group (group.storyId)}
            <div class="tl-group">
              <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
              <div class="tl-group-header" onclick={() => toggleLogStory(group.storyId)}>
                <svg
                  class="tl-chevron"
                  class:open={expandedLogStories.has(group.storyId)}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                <span class="tl-group-title">{group.storyTitle}</span>
                <span class="tl-group-count">{group.entries.length}</span>
              </div>
              {#if expandedLogStories.has(group.storyId)}
                <div class="tl-entries">
                  {#each group.entries as entry (entry.originalIndex)}
                    <div class="tl-entry">
                      <svg
                        class="tl-action-icon"
                        style:color={actionColors[entry.action] ?? 'var(--text-tertiary)'}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                      >
                        <path d={actionIcons[entry.action] ?? actionIcons.started} />
                      </svg>
                      <span class="tl-time">{formatTime(entry.timestamp)}</span>
                      <span class="tl-detail">{entry.detail}</span>
                      {#if entry.qualityResults?.length}
                        <button
                          class="tl-expand"
                          onclick={() => toggleLogOutput(entry.originalIndex)}
                        >
                          {expandedLogOutputs.has(entry.originalIndex) ? 'hide' : 'details'}
                        </button>
                      {/if}
                    </div>
                    {#if expandedLogOutputs.has(entry.originalIndex) && entry.qualityResults}
                      <div class="tl-qr-details">
                        {#each entry.qualityResults as qr}
                          <div class="tl-qr-row">
                            <span class="qc-icon" class:passed={qr.passed} class:failed={!qr.passed}
                              >{qr.passed ? '\u2713' : '\u2717'}</span
                            >
                            <span>{qr.checkName}</span>
                            <span class="qc-duration">{(qr.duration / 1000).toFixed(1)}s</span>
                          </div>
                          {#if qr.output && !qr.passed}
                            <pre class="qc-output">{qr.output.slice(0, 2000)}</pre>
                          {/if}
                        {/each}
                      </div>
                    {/if}
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
          {#if log.length === 0}
            <div class="tl-empty">No activity yet</div>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .looper-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--bg-primary);
    color: var(--text-primary);
  }

  /* ── Empty state ── */
  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: var(--text-tertiary);
  }
  .empty-state svg {
    width: 40px;
    height: 40px;
    opacity: 0.3;
  }
  .empty-state p {
    font-size: var(--fs-md);
    margin: 0;
  }
  .empty-state span {
    font-size: var(--fs-sm);
    opacity: 0.6;
  }

  /* ── Status Header ── */
  .status-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px;
    border-bottom: 1px solid var(--border-primary);
    background: var(--bg-secondary);
    flex-shrink: 0;
    gap: 12px;
  }
  .status-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .status-badge {
    font-size: var(--fs-xxs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 2px 8px;
    border-radius: 3px;
    color: var(--bg-primary);
  }
  .elapsed {
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    font-family: var(--font-mono);
  }
  .status-center {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
  }
  .config-tag {
    font-family: var(--font-mono);
  }
  .config-sep {
    opacity: 0.3;
  }
  .status-right {
    display: flex;
    gap: 6px;
  }
  .ctrl-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    font-size: var(--fs-xs);
    font-weight: 600;
    border-radius: var(--radius-sm);
    border: none;
    cursor: pointer;
    transition: opacity var(--transition);
  }
  .ctrl-btn:hover {
    opacity: 0.85;
  }
  .ctrl-btn.primary {
    background: var(--accent-primary);
    color: var(--text-on-accent, #fff);
  }
  .ctrl-btn.warning {
    background: var(--accent-warning);
    color: var(--bg-primary);
  }
  .ctrl-btn.danger {
    background: var(--accent-error);
    color: #fff;
  }

  /* ── Progress ── */
  .progress-section {
    padding: 10px 16px;
    border-bottom: 1px solid var(--border-primary);
    flex-shrink: 0;
  }
  .progress-bar-container {
    height: 6px;
    background: var(--bg-tertiary);
    border-radius: 3px;
    overflow: hidden;
    display: flex;
    margin-bottom: 6px;
  }
  .progress-bar-fill {
    background: var(--accent-secondary);
    transition: width 0.4s ease;
    border-radius: 3px 0 0 3px;
  }
  .progress-bar-failed {
    background: var(--accent-error);
    opacity: 0.6;
    transition: width 0.4s ease;
  }
  .progress-stats {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: var(--fs-xs);
    color: var(--text-secondary);
  }
  .stat strong {
    color: var(--text-primary);
  }
  .failed-stat {
    color: var(--accent-error);
  }
  .stat-sep {
    flex: 1;
  }
  .muted {
    color: var(--text-tertiary);
  }

  /* ── Scroll area ── */
  .scroll-area {
    flex: 1;
    overflow-y: auto;
    padding: 0 16px 16px;
  }

  .section {
    margin-top: 16px;
  }
  .section-title {
    font-size: var(--fs-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-tertiary);
    margin: 0 0 8px;
  }

  /* ── Current Story Card ── */
  .current-story-card {
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius);
    padding: 12px;
  }
  .current-story-card.empty-card {
    padding: 20px;
    text-align: center;
  }
  .cs-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }
  .cs-title {
    font-size: var(--fs-base);
    font-weight: 600;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cs-link {
    font-size: var(--fs-xxs);
    color: var(--accent-primary);
    background: none;
    border: none;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    flex-shrink: 0;
  }
  .cs-link:hover {
    background: var(--bg-hover);
  }

  /* ── Cycle visualization ── */
  .cycle-viz {
    margin-bottom: 10px;
  }
  .cycle-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
  }
  .sub-row {
    padding-left: 20px;
  }
  .cycle-label {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    width: 48px;
    flex-shrink: 0;
    text-align: right;
  }
  .cycle-dots {
    display: flex;
    align-items: center;
    gap: 0;
  }
  .cycle-dot {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--fs-xxs);
    font-weight: 700;
    font-family: var(--font-mono);
    border: 2px solid var(--border-primary);
    background: var(--bg-tertiary);
    color: var(--text-tertiary);
    transition: all 0.2s;
  }
  .cycle-dot.active {
    border-color: var(--accent-primary);
    background: var(--accent-primary);
    color: var(--text-on-accent, #fff);
    box-shadow: 0 0 8px color-mix(in srgb, var(--accent-primary) 40%, transparent);
  }
  .cycle-dot.done {
    border-color: var(--accent-secondary);
    background: var(--accent-secondary);
    color: var(--text-on-accent, #fff);
  }
  .fixup-dot {
    width: 18px;
    height: 18px;
    font-size: var(--fs-xs);
  }
  .fixup-dot.active {
    border-color: var(--accent-warning);
    background: var(--accent-warning);
    color: var(--bg-primary);
    box-shadow: 0 0 8px color-mix(in srgb, var(--accent-warning) 40%, transparent);
  }
  .cycle-connector {
    width: 16px;
    height: 2px;
    background: var(--border-primary);
  }
  .cycle-connector.small {
    width: 10px;
  }
  .cycle-connector.done {
    background: var(--accent-secondary);
  }
  .cycle-hint {
    font-size: var(--fs-xxs);
    color: var(--text-muted);
    margin-left: 6px;
    font-style: italic;
  }

  /* ── Quality Checks ── */
  .qc-section {
    border-top: 1px solid var(--border-secondary);
    padding-top: 8px;
  }
  .qc-title {
    font-size: var(--fs-xxs);
    font-weight: 600;
    text-transform: uppercase;
    color: var(--text-tertiary);
    letter-spacing: 0.3px;
    display: block;
    margin-bottom: 4px;
  }
  .qc-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 0;
    font-size: var(--fs-sm);
  }
  .qc-icon {
    font-weight: 700;
    width: 16px;
    text-align: center;
  }
  .qc-icon.passed {
    color: var(--accent-secondary);
  }
  .qc-icon.failed {
    color: var(--accent-error);
  }
  .qc-name {
    flex: 1;
  }
  .qc-duration {
    font-family: var(--font-mono);
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
  }
  .qc-expand {
    font-size: var(--fs-xxs);
    color: var(--accent-primary);
    background: none;
    border: none;
    cursor: pointer;
    padding: 1px 4px;
    border-radius: 2px;
  }
  .qc-expand:hover {
    background: var(--bg-hover);
  }
  .qc-output {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    line-height: 1.4;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    padding: 8px;
    margin: 4px 0 6px;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 240px;
    overflow-y: auto;
    color: var(--text-secondary);
  }

  /* ── Priority badge ── */
  .priority-badge {
    font-size: var(--fs-xxs);
    font-weight: 800;
    font-family: var(--font-mono);
    flex-shrink: 0;
  }
  .priority-badge.small {
    font-size: var(--fs-xs);
  }

  /* ── Pipeline ── */
  .pipeline-group {
    margin-bottom: 8px;
  }
  .pipeline-group-label {
    display: block;
    font-size: var(--fs-xxs);
    color: var(--text-muted);
    margin-bottom: 2px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .pipeline-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    border-radius: var(--radius-sm);
    font-size: var(--fs-sm);
    transition: background var(--transition);
  }
  .pipeline-row.completed,
  .pipeline-row.failed-row {
    cursor: pointer;
  }
  .pipeline-row.completed:hover,
  .pipeline-row.failed-row:hover {
    background: var(--bg-hover);
  }
  .pipeline-row.active {
    background: color-mix(in srgb, var(--accent-primary) 8%, var(--bg-secondary));
    border: 1px solid color-mix(in srgb, var(--accent-primary) 20%, var(--border-primary));
  }
  .pl-icon {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .pl-icon svg {
    width: 14px;
    height: 14px;
  }
  .pl-icon.pending {
    color: var(--text-muted);
  }
  .pl-icon.done {
    color: var(--accent-secondary);
  }
  .pl-icon.failed {
    color: var(--accent-error);
  }
  .pl-icon.spinning {
    color: var(--accent-primary);
    animation: spin 2s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .pl-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pl-attempts {
    font-size: var(--fs-xxs);
    font-family: var(--font-mono);
    color: var(--text-tertiary);
    flex-shrink: 0;
  }
  .pl-attempts.fail {
    color: var(--accent-error);
  }
  .pl-sha {
    font-size: var(--fs-xxs);
    font-family: var(--font-mono);
    color: var(--accent-secondary);
    flex-shrink: 0;
  }
  .pl-dep {
    font-size: var(--fs-xxs);
    color: var(--text-muted);
    flex-shrink: 0;
  }
  .pl-learnings {
    font-size: var(--fs-xxs);
    color: var(--accent-warning);
    flex-shrink: 0;
  }

  /* ── Failed story reset buttons ── */
  .pipeline-group-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 2px;
  }
  .failed-row-main {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    min-width: 0;
    cursor: pointer;
  }
  .retry-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: none;
    background: none;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: var(--radius-sm);
    flex-shrink: 0;
    opacity: 0;
    transition:
      opacity var(--transition),
      color var(--transition),
      background var(--transition);
  }
  .retry-btn svg {
    width: 13px;
    height: 13px;
  }
  .pipeline-row:hover .retry-btn {
    opacity: 1;
  }
  .retry-btn:hover {
    color: var(--accent-primary);
    background: var(--bg-hover);
  }
  .retry-all-btn {
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 2px 7px;
    font-size: var(--fs-xxs);
    font-weight: 600;
    color: var(--accent-primary);
    background: none;
    border: 1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition:
      background var(--transition),
      border-color var(--transition);
  }
  .retry-all-btn svg {
    width: 11px;
    height: 11px;
  }
  .retry-all-btn:hover {
    background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
    border-color: var(--accent-primary);
  }

  /* ── Timeline ── */
  .timeline {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .tl-group {
    background: var(--bg-secondary);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .tl-group-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    cursor: pointer;
    transition: background var(--transition);
    user-select: none;
  }
  .tl-group-header:hover {
    background: var(--bg-hover);
  }
  .tl-chevron {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
    transition: transform 0.15s;
    color: var(--text-tertiary);
  }
  .tl-chevron.open {
    transform: rotate(90deg);
  }
  .tl-group-title {
    font-size: var(--fs-sm);
    font-weight: 500;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tl-group-count {
    font-size: var(--fs-xxs);
    color: var(--text-muted);
    font-family: var(--font-mono);
  }
  .tl-entries {
    border-top: 1px solid var(--border-secondary);
  }
  .tl-entry {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px 4px 26px;
    font-size: var(--fs-xs);
  }
  .tl-action-icon {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
  }
  .tl-time {
    font-family: var(--font-mono);
    font-size: var(--fs-xxs);
    color: var(--text-muted);
    flex-shrink: 0;
    min-width: 60px;
  }
  .tl-detail {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-secondary);
  }
  .tl-expand {
    font-size: var(--fs-sans-xxs);
    color: var(--accent-primary);
    background: none;
    border: none;
    cursor: pointer;
    padding: 1px 4px;
    border-radius: 2px;
    flex-shrink: 0;
  }
  .tl-expand:hover {
    background: var(--bg-hover);
  }
  .tl-qr-details {
    padding: 4px 8px 8px 38px;
  }
  .tl-qr-row {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--fs-xs);
    padding: 2px 0;
  }
  .tl-empty {
    text-align: center;
    padding: 20px;
    font-size: var(--fs-sm);
    color: var(--text-muted);
  }
</style>
