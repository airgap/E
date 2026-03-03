<script lang="ts">
  import {
    golemsStore,
    type GolemStatus,
    type GolemActivity,
    type GolemStoryOutcome,
  } from '$lib/stores/golems.svelte';
  import { loopStore } from '$lib/stores/loop.svelte';
  import { uiStore } from '$lib/stores/ui.svelte';
  import { primaryPaneStore } from '$lib/stores/primaryPane.svelte';
  import { api } from '$lib/api/client';
  import { onMount, onDestroy } from 'svelte';
  import type { GolemMood, GolemPhase, QualityCheckType } from '@e/shared';

  // Ensure the golems store gets synced from the loop store on mount.
  // Always attempt to load from server — this handles initial page load,
  // HMR recovery, and any other scenario where client state was lost.
  onMount(() => {
    if (loopStore.activeLoop) {
      loopStore.syncGolemFromLoop(loopStore.activeLoop);
    } else {
      // Unconditionally load — the server is the source of truth
      loopStore.loadActiveLoop();
    }
    // Load persistent golem identity for this machine
    golemsStore.loadMachineGolem();
  });

  // --- Inline rename state ---
  let isRenamingGolem = $state(false);
  let renameInputValue = $state('');

  function startRename() {
    renameInputValue = golemsStore.machineGolem?.name ?? '';
    isRenamingGolem = true;
  }

  async function commitRename() {
    const trimmed = renameInputValue.trim();
    isRenamingGolem = false;
    if (trimmed && trimmed !== golemsStore.machineGolem?.name) {
      await golemsStore.renameMachineGolem(trimmed);
    }
  }

  function handleRenameKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      commitRename();
    } else if (e.key === 'Escape') {
      isRenamingGolem = false;
    }
  }

  // Relative time helper for "last active X ago"
  function relativeTime(ts: number | undefined): string {
    if (!ts) return 'never';
    const diffMs = Date.now() - ts;
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return 'just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return `${Math.floor(diffHr / 24)}d ago`;
  }

  // Reactively sync golem state when the active loop changes.
  // This handles async loadActiveLoop() completing after initial render,
  // HMR state restoration, and any other activeLoop changes.
  $effect(() => {
    const loop = loopStore.activeLoop;
    if (!loop) return;
    // Only auto-sync for active loops (running/paused).
    // Completed/failed/cancelled golems stay dismissed if the user cleared them.
    if (loop.status !== 'running' && loop.status !== 'paused') return;
    const golemExists = golemsStore.golems.some((g) => g.id === loop.id);
    if (!golemExists) {
      loopStore.syncGolemFromLoop(loop);
    }
  });

  // Thought text animation: type out new thoughts character by character
  let displayedThoughts = $state<Record<string, string>>({});
  let typewriterTimers = $state<Record<string, ReturnType<typeof setInterval>>>({});

  function startTypewriter(golemId: string, fullText: string) {
    // Clear existing timer
    if (typewriterTimers[golemId]) {
      clearInterval(typewriterTimers[golemId]);
    }
    displayedThoughts[golemId] = '';
    let charIndex = 0;
    typewriterTimers[golemId] = setInterval(() => {
      if (charIndex < fullText.length) {
        displayedThoughts[golemId] = fullText.slice(0, charIndex + 1);
        charIndex++;
      } else {
        clearInterval(typewriterTimers[golemId]);
        delete typewriterTimers[golemId];
      }
    }, 25);
  }

  // Track thought changes per golem
  let lastThoughts: Record<string, string> = {};

  $effect(() => {
    for (const golem of golemsStore.golems) {
      if (golem.thought !== lastThoughts[golem.id]) {
        lastThoughts[golem.id] = golem.thought;
        startTypewriter(golem.id, golem.thought);
      }
    }
  });

  // Clean up all typewriter timers when the component is destroyed
  // to prevent intervals firing on an unmounted component.
  onDestroy(() => {
    for (const timerId of Object.values(typewriterTimers)) {
      clearInterval(timerId);
    }
    for (const timerId of Object.values(taskTypewriterTimers)) {
      clearInterval(timerId);
    }
  });

  function getDisplayedThought(golemId: string): string {
    return displayedThoughts[golemId] ?? '';
  }

  // Per-task typewriter for parallel mode
  let displayedTaskThoughts = $state<Record<string, string>>({});
  let taskTypewriterTimers = $state<Record<string, ReturnType<typeof setInterval>>>({});

  function startTaskTypewriter(storyId: string, fullText: string) {
    if (taskTypewriterTimers[storyId]) {
      clearInterval(taskTypewriterTimers[storyId]);
    }
    displayedTaskThoughts[storyId] = '';
    let charIndex = 0;
    taskTypewriterTimers[storyId] = setInterval(() => {
      if (charIndex < fullText.length) {
        displayedTaskThoughts[storyId] = fullText.slice(0, charIndex + 1);
        charIndex++;
      } else {
        clearInterval(taskTypewriterTimers[storyId]);
        delete taskTypewriterTimers[storyId];
      }
    }, 20);
  }

  let lastTaskThoughts = $state<Record<string, string>>({});

  $effect(() => {
    for (const golem of golemsStore.golems) {
      for (const [storyId, ts] of Object.entries(golem.taskStatuses)) {
        if (ts.thought !== lastTaskThoughts[storyId]) {
          lastTaskThoughts[storyId] = ts.thought;
          startTaskTypewriter(storyId, ts.thought);
        }
      }
    }
  });

  // Mood emoji/icon
  function getMoodEmoji(mood: GolemMood): string {
    switch (mood) {
      case 'focused':
        return '🔍';
      case 'determined':
        return '💪';
      case 'excited':
        return '🎉';
      case 'proud':
        return '✨';
      case 'frustrated':
        return '😤';
      case 'worried':
        return '😟';
      case 'relieved':
        return '😌';
      default:
        return '🤖';
    }
  }

  function getMoodLabel(mood: GolemMood): string {
    switch (mood) {
      case 'focused':
        return 'Focused';
      case 'determined':
        return 'Determined';
      case 'excited':
        return 'Excited';
      case 'proud':
        return 'Proud';
      case 'frustrated':
        return 'Frustrated';
      case 'worried':
        return 'Worried';
      case 'relieved':
        return 'Relieved';
      default:
        return 'Neutral';
    }
  }

  // Phase display
  function getPhaseLabel(phase: GolemPhase): string {
    switch (phase) {
      case 'idle':
        return 'Idle';
      case 'selecting_story':
        return 'Selecting Story';
      case 'preparing':
        return 'Preparing';
      case 'snapshot':
        return 'Snapshotting';
      case 'pre_check':
        return 'Pre-Check';
      case 'spawning_agent':
        return 'Spawning Agent';
      case 'implementing':
        return 'Implementing';
      case 'quality_checking':
        return 'Quality Check';
      case 'committing':
        return 'Committing';
      case 'recording_learnings':
        return 'Learning';
      case 'fixing_up':
        return 'Fixing Up';
      case 'reverting':
        return 'Reverting';
      case 'celebrating':
        return 'Celebrating';
      case 'resting':
        return 'Resting';
      default:
        return 'Unknown';
    }
  }

  // Status display helpers
  function getStatusClass(status: GolemStatus['status']): string {
    switch (status) {
      case 'running':
        return 'status-running';
      case 'paused':
        return 'status-paused';
      case 'completed':
        return 'status-completed';
      case 'completed_with_failures':
        return 'status-warning';
      case 'failed':
        return 'status-failed';
      case 'cancelled':
        return 'status-cancelled';
      default:
        return 'status-idle';
    }
  }

  function getStatusLabel(status: GolemStatus['status']): string {
    switch (status) {
      case 'running':
        return 'Active';
      case 'paused':
        return 'Paused';
      case 'completed':
        return 'Complete';
      case 'completed_with_failures':
        return 'Partial';
      case 'failed':
        return 'Failed';
      case 'cancelled':
        return 'Cancelled';
      default:
        return 'Idle';
    }
  }

  // Elapsed time formatting
  function formatElapsed(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  }

  function formatTimestamp(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  // Activity type icon
  function getActivityIcon(type: GolemActivity['type']): string {
    switch (type) {
      case 'success':
        return '✓';
      case 'error':
        return '✗';
      case 'warning':
        return '!';
      case 'thought':
        return '~';
      default:
        return '›';
    }
  }

  function getProgressPercent(g: GolemStatus): number {
    if (g.totalStories === 0) return 0;
    return Math.round((g.storiesCompleted / g.totalStories) * 100);
  }

  // --- Phase pipeline ---
  // Simplified pipeline stages that group related phases
  const PIPELINE_STAGES = [
    { id: 'select', label: 'Select', phases: ['selecting_story'] as GolemPhase[] },
    {
      id: 'prepare',
      label: 'Prep',
      phases: ['preparing', 'snapshot', 'pre_check'] as GolemPhase[],
    },
    { id: 'implement', label: 'Build', phases: ['spawning_agent', 'implementing'] as GolemPhase[] },
    { id: 'quality', label: 'QA', phases: ['quality_checking'] as GolemPhase[] },
    {
      id: 'commit',
      label: 'Ship',
      phases: ['committing', 'merging', 'recording_learnings'] as GolemPhase[],
    },
  ] as const;

  function getPipelineStageIndex(phase: GolemPhase): number {
    for (let i = 0; i < PIPELINE_STAGES.length; i++) {
      if ((PIPELINE_STAGES[i].phases as readonly GolemPhase[]).includes(phase)) return i;
    }
    return -1; // idle, fixing_up, reverting, celebrating, resting
  }

  function getStageState(
    stageIdx: number,
    currentPhase: GolemPhase,
    golemStatus: GolemStatus['status'],
  ): 'done' | 'active' | 'pending' | 'idle' {
    if (golemStatus !== 'running') return 'idle';
    const currentIdx = getPipelineStageIndex(currentPhase);
    if (currentIdx < 0) return 'idle'; // special phases
    if (stageIdx < currentIdx) return 'done';
    if (stageIdx === currentIdx) return 'active';
    return 'pending';
  }

  // --- Quality check icons ---
  function getCheckTypeIcon(checkType: QualityCheckType): string {
    switch (checkType) {
      case 'typecheck':
        return 'TS';
      case 'lint':
        return 'LN';
      case 'test':
        return 'TX';
      case 'build':
        return 'BL';
      case 'custom':
        return 'CK';
      default:
        return '??';
    }
  }

  // --- Story outcome trail ---
  function getOutcomeColor(result: GolemStoryOutcome['result']): string {
    switch (result) {
      case 'success':
        return 'var(--accent-secondary)';
      case 'failed':
        return 'var(--accent-error)';
      case 'retrying':
        return 'var(--accent-warning)';
      default:
        return 'var(--text-tertiary)';
    }
  }

  // --- Sub-status line ---
  function getSubStatus(g: GolemStatus): string {
    if (g.status !== 'running') return '';
    switch (g.phase) {
      case 'selecting_story':
        return 'Scanning backlog for next story...';
      case 'backlog_empty':
        return g.thought || 'No eligible stories in backlog';
      case 'preparing':
        return 'Setting up workspace...';
      case 'snapshot':
        return 'Creating git snapshot...';
      case 'pre_check':
        return 'Running pre-flight checks...';
      case 'spawning_agent':
        return 'Spawning AI agent...';
      case 'implementing':
        if (g.fixUpAttempt > 0) {
          return `Fix-up pass ${g.fixUpAttempt}/${g.maxFixUpAttempts}`;
        }
        if (g.currentAttempt > 1) {
          return `Attempt ${g.currentAttempt}/${g.maxAttempts}`;
        }
        return 'Agent implementing changes...';
      case 'quality_checking': {
        const allChecks = Object.values(g.qualityChecksByStory).flat();
        const total = allChecks.length;
        const passed = allChecks.filter((c) => c.passed).length;
        if (total === 0) return 'Running quality checks...';
        return `Checks: ${passed}/${total} passing`;
      }
      case 'committing':
        return g.thought || 'Committing changes...';
      case 'merging':
        return g.thought || 'Merging into base branch...';
      case 'recording_learnings':
        return 'Recording learnings...';
      case 'fixing_up':
        return `Fix-up ${g.fixUpAttempt}/${g.maxFixUpAttempts}`;
      case 'reverting':
        return 'Reverting changes...';
      case 'celebrating':
        return 'Story completed!';
      case 'resting':
        return 'Cooldown between stories...';
      default:
        return '';
    }
  }

  function handlePause() {
    loopStore.pauseLoop();
  }

  function handleResume() {
    loopStore.resumeLoop();
  }

  function handleCancel() {
    loopStore.cancelLoop();
  }

  async function handleDismiss(golemId: string) {
    golemsStore.removeGolem(golemId);
    await api.loops.dismiss(golemId).catch(() => {});
  }

  function handleClearInactive() {
    golemsStore.clearInactive();
  }

  function handleWatchTasks(golemId: string, golemLabel: string) {
    primaryPaneStore.openGolemTasksTab(golemId, `Tasks: ${golemLabel}`);
  }

  function goToWork() {
    uiStore.setSidebarTab('work');
  }

  // Thought bubble cursor blink state
  const isTyping = $derived.by(() => {
    for (const golem of golemsStore.golems) {
      if (typewriterTimers[golem.id]) return true;
    }
    return false;
  });

  const IDLE_THOUGHTS = [
    'No golems are active. Start a loop from the Work panel to summon one.',
    'Golems are autonomous workers that implement your stories one by one.',
    'Each golem takes a story, implements it, runs quality checks, and moves on.',
  ];
  let idleThoughtIndex = $state(0);

  onMount(() => {
    const interval = setInterval(() => {
      idleThoughtIndex = (idleThoughtIndex + 1) % IDLE_THOUGHTS.length;
    }, 8000);
    return () => clearInterval(interval);
  });
</script>

<div class="golems-panel">
  <!-- Persistent machine golem identity header (always visible) -->
  {#if golemsStore.machineGolem}
    <div class="machine-golem-header">
      <div class="machine-golem-hex">⬡</div>
      <div class="machine-golem-identity">
        {#if isRenamingGolem}
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="machine-golem-rename-input"
            type="text"
            autofocus
            bind:value={renameInputValue}
            onblur={commitRename}
            onkeydown={handleRenameKeydown}
          />
        {:else}
          <button class="machine-golem-name-btn" onclick={startRename} title="Click to rename">
            <span class="machine-golem-name">{golemsStore.machineGolem.name}</span>
            <span class="machine-golem-rename-icon">✎</span>
          </button>
        {/if}
        <div class="machine-golem-meta">
          this machine · last active {relativeTime(golemsStore.machineGolem.lastActiveAt)}
        </div>
      </div>
    </div>
  {/if}

  {#if golemsStore.golems.length === 0}
    <!-- Empty state -->
    <div class="empty-state">
      <div class="empty-golem-icon">
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path
            d="M12 2a4 4 0 0 0-4 4v1H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2V6a4 4 0 0 0-4-4z"
          />
          <circle cx="9" cy="13" r="1.5" />
          <circle cx="15" cy="13" r="1.5" />
        </svg>
        <div class="empty-golem-zzz">z z z</div>
      </div>
      <div class="empty-title">No Active Golems</div>
      <div class="empty-hint">{IDLE_THOUGHTS[idleThoughtIndex]}</div>
      <button class="go-to-work-btn" onclick={goToWork}>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
        Go to Work Panel
      </button>
    </div>
  {:else}
    <!-- Golem cards -->
    <div class="golems-list">
      {#each golemsStore.golems as golem (golem.id)}
        <div
          class="golem-card"
          class:active={golem.status === 'running'}
          class:paused={golem.status === 'paused'}
        >
          <!-- Header: Avatar + Name + Status -->
          <div class="golem-header">
            <div class="golem-avatar" class:pulse={golem.status === 'running'}>
              <span class="golem-mood-emoji">{getMoodEmoji(golem.mood)}</span>
            </div>
            <div class="golem-identity">
              <div class="golem-name">{golem.label}</div>
              <div class="golem-meta">
                <span class="golem-status-badge {getStatusClass(golem.status)}"
                  >{getStatusLabel(golem.status)}</span
                >
                <span class="golem-phase">{getPhaseLabel(golem.phase)}</span>
              </div>
              {#if getSubStatus(golem)}
                <div class="golem-sub-status">{getSubStatus(golem)}</div>
              {/if}
            </div>
            <div class="golem-mood-label" title="Mood: {getMoodLabel(golem.mood)}">
              {getMoodLabel(golem.mood)}
            </div>
          </div>

          <!-- Phase pipeline -->
          {#if golem.status === 'running' || golem.status === 'paused'}
            <div class="phase-pipeline">
              {#each PIPELINE_STAGES as stage, idx (stage.id)}
                {@const state = getStageState(idx, golem.phase, golem.status)}
                <div class="pipeline-stage {state}" title="{stage.label}: {state}">
                  <div class="pipeline-dot"></div>
                  <span class="pipeline-label">{stage.label}</span>
                </div>
                {#if idx < PIPELINE_STAGES.length - 1}
                  <div class="pipeline-connector {state === 'done' ? 'done' : ''}"></div>
                {/if}
              {/each}
            </div>
          {/if}

          <!-- Thought bubble / parallel task rows -->
          {#if golem.maxParallel > 1 && golem.activeStoryIds.length > 0}
            <!-- Parallel mode: per-story status rows -->
            <div class="task-rows">
              {#each golem.activeStoryIds as storyId (storyId)}
                {@const tc = golem.taskConversations.find((t) => t.storyId === storyId)}
                {@const ts = golem.taskStatuses[storyId]}
                {@const storyChecks = golem.qualityChecksByStory[storyId] ?? []}
                <div class="task-row">
                  <div class="task-row-header">
                    <span class="task-row-title">{tc?.storyTitle ?? storyId}</span>
                    {#if ts}
                      <span class="task-phase-badge phase-{ts.phase}"
                        >{getPhaseLabel(ts.phase)}</span
                      >
                    {/if}
                  </div>
                  {#if ts?.thought}
                    <div class="task-row-thought">
                      {displayedTaskThoughts[storyId] ??
                        ts.thought}{#if taskTypewriterTimers[storyId]}<span class="cursor">|</span
                        >{/if}
                    </div>
                  {/if}
                  {#if storyChecks.length > 0}
                    <div class="qc-indicators qc-inline">
                      {#each storyChecks as check (check.checkName)}
                        <div
                          class="qc-chip"
                          class:passed={check.passed}
                          class:failed={!check.passed}
                          title="{check.checkName}: {check.passed
                            ? 'PASSED'
                            : 'FAILED'} ({Math.round(check.duration / 1000)}s)"
                        >
                          <span class="qc-icon">{getCheckTypeIcon(check.checkType)}</span>
                          <span class="qc-result">{check.passed ? '✓' : '✗'}</span>
                        </div>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          {:else}
            <!-- Serial mode: single thought bubble -->
            <div class="thought-bubble" class:thinking={golem.status === 'running'}>
              <div class="thought-dots">
                <span class="dot"></span>
                <span class="dot"></span>
              </div>
              <div class="thought-text">
                {getDisplayedThought(golem.id)}{#if typewriterTimers[golem.id]}<span class="cursor"
                    >|</span
                  >{/if}
              </div>
            </div>

            <!-- Current story (serial) -->
            {#if golem.currentStoryTitle}
              <div class="current-story">
                <span class="story-label">Working on</span>
                <span class="story-title">{golem.currentStoryTitle}</span>
                {#if golem.currentAttempt > 0}
                  <span class="attempt-info">
                    Attempt {golem.currentAttempt}/{golem.maxAttempts}
                    {#if golem.fixUpAttempt > 0}
                      · Fix-up {golem.fixUpAttempt}/{golem.maxFixUpAttempts}
                    {/if}
                  </span>
                {/if}
              </div>
            {/if}
          {/if}

          <!-- Failed stories — shown prominently when loop failed or completed with failures -->
          {#if (golem.status === 'failed' || golem.status === 'completed_with_failures') && golem.failedStories.length > 0}
            <div class="failed-stories">
              <div class="failed-stories-label">
                {golem.failedStories.length === 1 ? 'Failed story' : `Failed stories (${golem.failedStories.length})`}
              </div>
              {#each golem.failedStories as story (story.storyId || story.storyTitle)}
                <div class="failed-story-item">
                  <span class="failed-story-icon">✗</span>
                  <div class="failed-story-body">
                    <div class="failed-story-title">{story.storyTitle}</div>
                    {#if story.reason}
                      <div class="failed-story-reason">{story.reason}</div>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          {/if}

          <!-- Quality check indicators (serial mode — shows all checks from the single active story) -->
          {#if Object.values(golem.qualityChecksByStory).flat().length > 0 && !(golem.maxParallel > 1 && golem.activeStoryIds.length > 0)}
            <div class="quality-checks">
              <span class="qc-label">Checks</span>
              <div class="qc-indicators">
                {#each Object.values(golem.qualityChecksByStory).flat() as check (check.checkName)}
                  <div
                    class="qc-chip"
                    class:passed={check.passed}
                    class:failed={!check.passed}
                    title="{check.checkName}: {check.passed ? 'PASSED' : 'FAILED'} ({Math.round(
                      check.duration / 1000,
                    )}s)"
                  >
                    <span class="qc-icon">{getCheckTypeIcon(check.checkType)}</span>
                    <span class="qc-result">{check.passed ? '✓' : '✗'}</span>
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          <!-- Progress bar -->
          <div class="progress-section">
            <div class="progress-bar-container">
              <div class="progress-bar" style="width: {getProgressPercent(golem)}%"></div>
            </div>
            <div class="progress-stats">
              <span class="progress-text"
                >{golem.storiesCompleted}/{golem.totalStories} stories</span
              >
              {#if golem.storiesFailed > 0}
                <span class="progress-failed">{golem.storiesFailed} failed</span>
              {/if}
              <span class="progress-elapsed">{formatElapsed(golem.elapsedMs)}</span>
            </div>
          </div>

          <!-- Story outcome trail + Iteration info -->
          <div class="outcome-row">
            {#if golem.storyOutcomes.length > 0}
              <div class="story-trail" title="Recent story outcomes">
                {#each golem.storyOutcomes.slice(0, 12) as outcome (outcome.timestamp)}
                  <div
                    class="trail-dot outcome-{outcome.result}"
                    title="{outcome.storyTitle}: {outcome.result}"
                    style="background: {getOutcomeColor(outcome.result)}"
                  ></div>
                {/each}
              </div>
            {/if}
            <span class="iteration-label">Iter {golem.currentIteration}</span>
          </div>

          <!-- Controls -->
          {#if golem.status === 'running' || golem.status === 'paused'}
            <div class="golem-controls">
              <button
                class="ctrl-btn watch-btn"
                onclick={() => handleWatchTasks(golem.id, golem.label)}
                title="Watch task streams"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />
                  <path
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                  />
                </svg>
                Watch
              </button>
              {#if golem.status === 'running'}
                <button class="ctrl-btn pause-btn" onclick={handlePause} title="Pause">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="4" width="4" height="16" />
                    <rect x="14" y="4" width="4" height="16" />
                  </svg>
                  Pause
                </button>
              {:else}
                <button class="ctrl-btn resume-btn" onclick={handleResume} title="Resume">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5,3 19,12 5,21" />
                  </svg>
                  Resume
                </button>
              {/if}
              <button class="ctrl-btn cancel-btn" onclick={handleCancel} title="Cancel">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
                Cancel
              </button>
            </div>
          {:else}
            <div class="golem-controls">
              <button
                class="ctrl-btn dismiss-btn"
                onclick={() => handleDismiss(golem.id)}
                title="Dismiss"
              >
                Dismiss
              </button>
            </div>
          {/if}

          <!-- Activity feed -->
          {#if golem.activities.length > 0}
            <details
              class="activity-section"
              open={golem.status === 'failed' || golem.status === 'completed_with_failures'}
            >
              <summary class="activity-toggle">
                Activity Log ({golem.activities.length})
              </summary>
              <div class="activity-feed">
                {#each golem.activities.slice(0, 20) as activity (activity.id)}
                  <div class="activity-item activity-{activity.type}">
                    <span class="activity-icon">{getActivityIcon(activity.type)}</span>
                    <span class="activity-detail">{activity.detail}</span>
                    <span class="activity-time">{formatTimestamp(activity.timestamp)}</span>
                  </div>
                {/each}
              </div>
            </details>
          {/if}
        </div>
      {/each}
    </div>

    <!-- Footer actions -->
    {#if golemsStore.golems.some((g) => g.status !== 'running' && g.status !== 'paused')}
      <div class="panel-footer">
        <button class="clear-btn" onclick={handleClearInactive}> Clear Inactive </button>
      </div>
    {/if}
  {/if}
</div>

<style>
  .golems-panel {
    padding: 8px;
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  /* ── Empty state ── */
  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 24px;
    text-align: center;
  }

  .empty-golem-icon {
    position: relative;
    color: var(--text-tertiary);
    opacity: 0.6;
    animation: emptyGolemFloat 4s ease-in-out infinite;
  }

  .empty-golem-zzz {
    position: absolute;
    top: -8px;
    right: -12px;
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    opacity: 0.5;
    letter-spacing: 3px;
    animation: zzzFloat 3s ease-in-out infinite;
  }

  @keyframes emptyGolemFloat {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-4px);
    }
  }

  @keyframes zzzFloat {
    0%,
    100% {
      transform: translateY(0) translateX(0);
      opacity: 0.3;
    }
    50% {
      transform: translateY(-8px) translateX(4px);
      opacity: 0.7;
    }
  }

  .empty-title {
    font-size: var(--fs-md);
    font-weight: 700;
    color: var(--text-secondary);
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
  }

  .empty-hint {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    line-height: 1.5;
    max-width: 200px;
    transition: opacity 300ms ease;
  }

  .go-to-work-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent);
    cursor: pointer;
    transition: all var(--transition);
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
  }

  .go-to-work-btn:hover {
    background: color-mix(in srgb, var(--accent-primary) 20%, transparent);
    border-color: var(--accent-primary);
  }

  /* ── Golem list ── */
  .golems-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* ── Golem card ── */
  .golem-card {
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    transition: all var(--transition);
    position: relative;
    overflow: hidden;
  }

  .golem-card.active {
    border-color: color-mix(in srgb, var(--accent-primary) 40%, transparent);
    box-shadow: 0 0 12px color-mix(in srgb, var(--accent-primary) 10%, transparent);
  }

  .golem-card.active::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: linear-gradient(90deg, transparent, var(--accent-primary), transparent);
    background-size: 200% 100%;
    animation: golemCardSlide 2.5s ease-in-out infinite;
  }

  .golem-card.paused {
    border-color: color-mix(in srgb, var(--accent-warning) 30%, transparent);
  }

  .golem-card.paused::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--accent-warning);
    opacity: 0.5;
  }

  @keyframes golemCardSlide {
    0% {
      background-position: -200% 0%;
    }
    100% {
      background-position: 200% 0%;
    }
  }

  /* ── Golem header ── */
  .golem-header {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .golem-avatar {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-secondary);
    border-radius: 50%;
    flex-shrink: 0;
    position: relative;
  }

  .golem-avatar.pulse {
    animation: avatarPulse 2s ease-in-out infinite;
  }

  @keyframes avatarPulse {
    0%,
    100% {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent-primary) 30%, transparent);
    }
    50% {
      box-shadow: 0 0 8px 2px color-mix(in srgb, var(--accent-primary) 20%, transparent);
    }
  }

  .golem-mood-emoji {
    line-height: 1;
  }

  .golem-identity {
    flex: 1;
    min-width: 0;
  }

  .golem-name {
    font-size: var(--fs-sm);
    font-weight: 700;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .golem-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 2px;
  }

  .golem-status-badge {
    font-size: var(--fs-xxs);
    padding: 1px 6px;
    font-weight: 700;
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
    border: 1px solid;
  }

  .status-running {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
  }

  .status-paused {
    color: var(--accent-warning);
    border-color: var(--accent-warning);
    background: color-mix(in srgb, var(--accent-warning) 10%, transparent);
  }

  .status-completed {
    color: var(--accent-secondary);
    border-color: var(--accent-secondary);
    background: color-mix(in srgb, var(--accent-secondary) 10%, transparent);
  }

  .status-warning {
    color: var(--accent-warning);
    border-color: var(--accent-warning);
    background: color-mix(in srgb, var(--accent-warning) 10%, transparent);
  }

  .status-failed {
    color: var(--accent-error);
    border-color: var(--accent-error);
    background: color-mix(in srgb, var(--accent-error) 10%, transparent);
  }

  .status-cancelled {
    color: var(--text-tertiary);
    border-color: var(--border-secondary);
    background: var(--bg-secondary);
  }

  .status-idle {
    color: var(--text-tertiary);
    border-color: var(--border-primary);
    background: var(--bg-tertiary);
  }

  .golem-phase {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
  }

  .golem-mood-label {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    font-style: italic;
    flex-shrink: 0;
  }

  .golem-sub-status {
    font-size: var(--fs-xxs);
    color: var(--accent-primary);
    margin-top: 1px;
    opacity: 0.85;
    font-weight: 500;
  }

  /* ── Phase pipeline ── */
  .phase-pipeline {
    display: flex;
    align-items: center;
    gap: 0;
    padding: 4px 6px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
  }

  .pipeline-stage {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  .pipeline-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    border: 1.5px solid var(--border-secondary);
    background: var(--bg-tertiary);
    transition: all 300ms ease;
  }

  .pipeline-stage.done .pipeline-dot {
    background: var(--accent-secondary);
    border-color: var(--accent-secondary);
  }

  .pipeline-stage.active .pipeline-dot {
    background: var(--accent-primary);
    border-color: var(--accent-primary);
    box-shadow: 0 0 6px color-mix(in srgb, var(--accent-primary) 50%, transparent);
    animation: pipelinePulse 1.5s ease-in-out infinite;
  }

  .pipeline-stage.pending .pipeline-dot {
    background: var(--bg-tertiary);
    border-color: var(--border-secondary);
  }

  .pipeline-stage.idle .pipeline-dot {
    background: var(--bg-tertiary);
    border-color: var(--border-primary);
    opacity: 0.5;
  }

  @keyframes pipelinePulse {
    0%,
    100% {
      box-shadow: 0 0 4px color-mix(in srgb, var(--accent-primary) 30%, transparent);
    }
    50% {
      box-shadow: 0 0 8px color-mix(in srgb, var(--accent-primary) 60%, transparent);
    }
  }

  .pipeline-label {
    font-size: 9px;
    color: var(--text-tertiary);
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
    line-height: 1;
    white-space: nowrap;
  }

  .pipeline-stage.active .pipeline-label {
    color: var(--accent-primary);
    font-weight: 700;
  }

  .pipeline-stage.done .pipeline-label {
    color: var(--accent-secondary);
  }

  .pipeline-connector {
    flex: 1;
    height: 1.5px;
    background: var(--border-secondary);
    margin: 0 2px;
    margin-bottom: 12px;
    transition: background 300ms ease;
  }

  .pipeline-connector.done {
    background: var(--accent-secondary);
  }

  /* ── Thought bubble ── */
  .thought-bubble {
    position: relative;
    background: var(--bg-primary);
    border: 1px solid var(--border-secondary);
    border-radius: 8px;
    padding: 8px 10px;
    margin-left: 16px;
    min-height: 32px;
    display: flex;
    align-items: center;
  }

  .thought-bubble.thinking {
    border-color: color-mix(in srgb, var(--accent-primary) 30%, transparent);
  }

  .thought-dots {
    position: absolute;
    left: -12px;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .thought-dots .dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--border-secondary);
  }

  .thought-bubble.thinking .thought-dots .dot {
    background: var(--accent-primary);
    animation: dotPulse 1.5s ease-in-out infinite;
  }

  .thought-dots .dot:nth-child(2) {
    width: 3px;
    height: 3px;
    margin-left: -2px;
    animation-delay: 0.3s;
  }

  @keyframes dotPulse {
    0%,
    100% {
      opacity: 0.4;
    }
    50% {
      opacity: 1;
    }
  }

  .thought-text {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    line-height: 1.4;
    font-style: italic;
    word-break: break-word;
  }

  .cursor {
    color: var(--accent-primary);
    animation: cursorBlink 0.8s step-end infinite;
    font-style: normal;
  }

  @keyframes cursorBlink {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0;
    }
  }

  /* ── Current story ── */
  .current-story {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 8px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
  }

  .story-label {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
    font-weight: 600;
  }

  .story-title {
    font-size: var(--fs-sm);
    color: var(--text-primary);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .attempt-info {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
  }

  /* ── Parallel task rows ── */
  .task-rows {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .task-row {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 8px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-left: 2px solid color-mix(in srgb, var(--accent-primary) 40%, transparent);
  }

  .task-row-header {
    display: flex;
    align-items: center;
    gap: 6px;
    justify-content: space-between;
  }

  .task-row-title {
    font-size: var(--fs-xs);
    color: var(--text-primary);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }

  .task-phase-badge {
    font-size: 9px;
    color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent-primary) 25%, transparent);
    padding: 1px 5px;
    white-space: nowrap;
    flex-shrink: 0;
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
  }

  .task-row-thought {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    font-style: italic;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ── Quality check indicators ── */
  .quality-checks {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
  }

  .qc-label {
    font-size: 9px;
    color: var(--text-tertiary);
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
    font-weight: 600;
    flex-shrink: 0;
  }

  .qc-indicators {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }

  /* Inline quality checks inside parallel task rows */
  .qc-inline {
    margin-top: 2px;
  }

  .qc-chip {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 1px 5px;
    font-size: 9px;
    font-weight: 700;
    border: 1px solid;
    font-family: var(--font-mono, monospace);
    line-height: 1.3;
  }

  .qc-chip.passed {
    color: var(--accent-secondary);
    border-color: color-mix(in srgb, var(--accent-secondary) 40%, transparent);
    background: color-mix(in srgb, var(--accent-secondary) 8%, transparent);
  }

  .qc-chip.failed {
    color: var(--accent-error);
    border-color: color-mix(in srgb, var(--accent-error) 40%, transparent);
    background: color-mix(in srgb, var(--accent-error) 8%, transparent);
  }

  .qc-icon {
    opacity: 0.7;
  }

  .qc-result {
    font-size: 10px;
  }

  /* ── Story outcome trail ── */
  .outcome-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .story-trail {
    display: flex;
    align-items: center;
    gap: 3px;
    flex: 1;
    min-width: 0;
  }

  .trail-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
    transition: transform 150ms ease;
    cursor: default;
  }

  .trail-dot:hover {
    transform: scale(1.5);
  }

  .trail-dot.outcome-success {
    box-shadow: 0 0 3px color-mix(in srgb, var(--accent-secondary) 40%, transparent);
  }

  .trail-dot.outcome-failed {
    box-shadow: 0 0 3px color-mix(in srgb, var(--accent-error) 40%, transparent);
  }

  .trail-dot.outcome-retrying {
    box-shadow: 0 0 3px color-mix(in srgb, var(--accent-warning) 40%, transparent);
  }

  /* ── Progress bar ── */
  .progress-section {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .progress-bar-container {
    height: 4px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    overflow: hidden;
  }

  .progress-bar {
    height: 100%;
    background: var(--accent-primary);
    transition: width 500ms ease;
    position: relative;
  }

  .golem-card.active .progress-bar {
    box-shadow: 0 0 6px color-mix(in srgb, var(--accent-primary) 40%, transparent);
  }

  .progress-stats {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--fs-xxs);
  }

  .progress-text {
    color: var(--text-secondary);
    font-weight: 600;
  }

  .progress-failed {
    color: var(--accent-error);
    font-weight: 600;
  }

  .progress-elapsed {
    margin-left: auto;
    color: var(--text-tertiary);
    font-family: var(--font-mono, monospace);
    font-size: var(--fs-xxs);
  }

  .iteration-label {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    font-weight: 600;
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
    flex-shrink: 0;
    margin-left: auto;
  }

  /* ── Controls ── */
  .golem-controls {
    display: flex;
    gap: 6px;
  }

  .ctrl-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 5px 8px;
    font-size: var(--fs-xxs);
    font-weight: 700;
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
    border: 1px solid var(--border-secondary);
    background: var(--bg-secondary);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all var(--transition);
  }

  .ctrl-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .pause-btn:hover {
    color: var(--accent-warning);
    border-color: var(--accent-warning);
  }

  .resume-btn {
    color: var(--accent-primary);
    border-color: color-mix(in srgb, var(--accent-primary) 40%, transparent);
  }

  .resume-btn:hover {
    background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
    border-color: var(--accent-primary);
  }

  .cancel-btn:hover {
    color: var(--accent-error);
    border-color: var(--accent-error);
  }

  .watch-btn {
    color: var(--accent-primary);
    border-color: color-mix(in srgb, var(--accent-primary) 30%, transparent);
  }

  .watch-btn:hover {
    background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
    border-color: var(--accent-primary);
  }

  .dismiss-btn {
    color: var(--text-tertiary);
  }

  /* ── Activity feed ── */
  .activity-section {
    border-top: 1px solid var(--border-primary);
    margin-top: 2px;
    padding-top: 4px;
  }

  .activity-toggle {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    cursor: pointer;
    padding: 4px 0;
    font-weight: 600;
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
    user-select: none;
    list-style: none;
  }

  .activity-toggle::marker {
    content: '';
  }

  .activity-toggle::-webkit-details-marker {
    display: none;
  }

  .activity-toggle::before {
    content: '▸ ';
  }

  details[open] .activity-toggle::before {
    content: '▾ ';
  }

  .activity-feed {
    max-height: 200px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin-top: 4px;
  }

  .activity-item {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 3px 4px;
    font-size: var(--fs-xxs);
    line-height: 1.4;
    border-left: 2px solid var(--border-primary);
    transition: background var(--transition);
  }

  .activity-item:hover {
    background: var(--bg-hover);
  }

  .activity-item.activity-success {
    border-left-color: var(--accent-secondary);
  }

  .activity-item.activity-error {
    border-left-color: var(--accent-error);
  }

  .activity-item.activity-warning {
    border-left-color: var(--accent-warning);
  }

  .activity-icon {
    flex-shrink: 0;
    width: 12px;
    text-align: center;
    font-weight: 700;
    color: var(--text-tertiary);
  }

  .activity-success .activity-icon {
    color: var(--accent-secondary);
  }

  .activity-error .activity-icon {
    color: var(--accent-error);
  }

  .activity-warning .activity-icon {
    color: var(--accent-warning);
  }

  .activity-detail {
    flex: 1;
    color: var(--text-secondary);
    word-break: break-word;
  }

  .activity-time {
    flex-shrink: 0;
    color: var(--text-tertiary);
    font-family: var(--font-mono, monospace);
    font-size: var(--fs-xxs);
    opacity: 0.7;
  }

  /* ── Footer ── */
  .panel-footer {
    padding: 8px 0 0;
    border-top: 1px solid var(--border-primary);
    display: flex;
    justify-content: center;
  }

  .clear-btn {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    background: none;
    border: none;
    cursor: pointer;
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
    padding: 4px 8px;
    transition: color var(--transition);
  }

  .clear-btn:hover {
    color: var(--text-primary);
  }

  /* ── Failed Stories ── */
  .failed-stories {
    margin: 6px 0;
    border: 1px solid var(--accent-error);
    border-radius: 4px;
    overflow: hidden;
  }

  .failed-stories-label {
    font-size: var(--fs-xxs);
    font-weight: 600;
    text-transform: var(--ht-label-transform, uppercase);
    letter-spacing: var(--ht-label-spacing, 0.05em);
    color: var(--accent-error);
    padding: 4px 8px;
    background: color-mix(in srgb, var(--accent-error) 10%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--accent-error) 30%, transparent);
  }

  .failed-story-item {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 5px 8px;
    border-bottom: 1px solid var(--border-primary);
  }

  .failed-story-item:last-child {
    border-bottom: none;
  }

  .failed-story-icon {
    flex-shrink: 0;
    color: var(--accent-error);
    font-size: var(--fs-xs);
    font-weight: 700;
    margin-top: 1px;
  }

  .failed-story-body {
    flex: 1;
    min-width: 0;
  }

  .failed-story-title {
    font-size: var(--fs-xs);
    font-weight: 500;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .failed-story-reason {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    margin-top: 2px;
    word-break: break-word;
    /* Limit to 3 lines */
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  /* ── Machine Golem Identity Header ── */
  .machine-golem-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: 6px;
    margin-bottom: 8px;
  }

  .machine-golem-hex {
    font-size: 20px;
    color: var(--accent-primary);
    flex-shrink: 0;
    line-height: 1;
  }

  .machine-golem-identity {
    flex: 1;
    min-width: 0;
  }

  .machine-golem-name-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    color: var(--text-primary);
    font-size: var(--fs-sm);
    font-weight: 600;
    line-height: 1.3;
    width: 100%;
    text-align: left;
  }

  .machine-golem-name-btn:hover .machine-golem-rename-icon {
    opacity: 1;
  }

  .machine-golem-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .machine-golem-rename-icon {
    flex-shrink: 0;
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    opacity: 0;
    transition: opacity var(--transition);
  }

  .machine-golem-rename-input {
    width: 100%;
    background: var(--bg-primary);
    border: 1px solid var(--accent-primary);
    border-radius: 3px;
    padding: 2px 6px;
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-primary);
    outline: none;
  }

  .machine-golem-meta {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    margin-top: 1px;
  }
</style>
