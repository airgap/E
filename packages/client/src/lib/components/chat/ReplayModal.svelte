<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import { api } from '$lib/api/client';

  let { conversationId, onClose } = $props<{
    conversationId: string;
    onClose: () => void;
  }>();

  // Timeline data
  let loading = $state(true);
  let error = $state<string | null>(null);
  let timeline = $state<{
    conversationId: string;
    title: string;
    totalEvents: number;
    duration: number;
    events: Array<{
      id: string;
      type: 'narration' | 'thinking' | 'tool_call' | 'tool_result' | 'user_message';
      role: 'user' | 'assistant';
      text: string;
      toolName?: string;
      timestamp: number;
      delay: number;
    }>;
  } | null>(null);

  let changes = $state<{
    filesChanged: Array<{ path: string; operation: 'created' | 'modified' | 'deleted' }>;
    commits: string[];
  } | null>(null);

  // Playback state
  let currentEventIndex = $state(0);
  let playing = $state(false);
  let speed = $state(1);
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let eventListEl = $state<HTMLDivElement | null>(null);

  const EVENT_BASE_DELAY = 200; // Fallback delay if event.delay is missing or 0

  const TYPE_ICON_PATHS: Record<string, string> = {
    narration: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
    thinking: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z M12 6v6l4 2',
    tool_call:
      'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z',
    tool_result: 'M20 6L9 17l-5-5',
    user_message: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  };

  const TYPE_LABELS: Record<string, string> = {
    narration: 'Narration',
    thinking: 'Thinking',
    tool_call: 'Tool Call',
    tool_result: 'Tool Result',
    user_message: 'User',
  };

  onMount(async () => {
    await loadTimeline();
  });

  onDestroy(() => {
    stopPlayback();
  });

  async function loadTimeline() {
    loading = true;
    error = null;
    try {
      const [timelineRes, changesRes] = await Promise.all([
        api.replay.getTimeline(conversationId),
        api.replay.getChanges(conversationId),
      ]);
      if (timelineRes.ok) {
        timeline = timelineRes.data;
      } else {
        error = 'Failed to load timeline';
      }
      if (changesRes.ok) {
        changes = changesRes.data;
      }
    } catch (err: any) {
      error = err?.message ?? 'Failed to load replay';
    } finally {
      loading = false;
    }
  }

  function startPlayback() {
    if (!timeline || timeline.events.length === 0) return;
    playing = true;
    scheduleNextEvent();
  }

  function scheduleNextEvent() {
    if (!timeline || currentEventIndex >= timeline.events.length - 1) {
      stopPlayback();
      return;
    }

    // Get the delay for the next event, or use base delay as fallback
    const nextEvent = timeline.events[currentEventIndex + 1];
    const eventDelay = nextEvent?.delay || EVENT_BASE_DELAY;
    const scaledDelay = Math.round(eventDelay / speed);

    timeoutId = setTimeout(() => {
      if (!timeline) return;
      currentEventIndex++;
      scrollEventIntoView(currentEventIndex);
      if (playing) {
        scheduleNextEvent();
      }
    }, scaledDelay);
  }

  function stopPlayback() {
    playing = false;
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  }

  function togglePlayPause() {
    if (playing) {
      stopPlayback();
    } else {
      if (timeline && currentEventIndex >= timeline.events.length - 1) {
        currentEventIndex = 0;
      }
      startPlayback();
    }
  }

  function restart() {
    stopPlayback();
    currentEventIndex = 0;
  }

  function jumpToEvent(index: number) {
    currentEventIndex = index;
    scrollEventIntoView(index);
  }

  function scrollEventIntoView(index: number) {
    if (!eventListEl) return;
    const el = eventListEl.querySelector(`[data-index="${index}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === ' ') {
      e.preventDefault();
      togglePlayPause();
    }
  }

  $effect(() => {
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  });

  // When speed changes and we're playing, restart playback
  $effect(() => {
    speed; // Track speed changes
    // Use untrack to check if playing without subscribing to it
    untrack(() => {
      if (timeoutId !== null) {
        // If currently playing, restart with new speed
        stopPlayback();
        startPlayback();
      }
    });
  });

  let progressPercent = $derived(
    timeline && timeline.events.length > 1
      ? (currentEventIndex / (timeline.events.length - 1)) * 100
      : 0,
  );

  let currentEvent = $derived(timeline ? (timeline.events[currentEventIndex] ?? null) : null);
</script>

<!-- Overlay backdrop -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="overlay"
  onclick={(e) => {
    if (e.target === e.currentTarget) onClose();
  }}
>
  <div class="modal">
    <!-- Header -->
    <div class="modal-header">
      <div class="header-left">
        <span class="header-icon">▶</span>
        <div>
          <div class="header-title">{timeline?.title ?? 'Loading...'}</div>
          <div class="header-sub">Session Replay</div>
        </div>
      </div>
      <button class="close-btn" onclick={onClose} title="Close (Esc)">✕</button>
    </div>

    {#if loading}
      <div class="loading-state">
        <div class="spinner"></div>
        <span>Loading replay timeline…</span>
      </div>
    {:else if error}
      <div class="error-state">
        <span class="error-icon">⚠</span>
        <span>{error}</span>
        <button class="btn-secondary" onclick={loadTimeline}>Retry</button>
      </div>
    {:else if timeline}
      <div class="modal-body">
        <!-- Left: current event display -->
        <div class="main-panel">
          <!-- Controls -->
          <div class="controls">
            <button
              class="ctrl-btn"
              onclick={restart}
              title="Restart"
              disabled={currentEventIndex === 0 && !playing}
            >
              ↺
            </button>
            <button
              class="ctrl-btn ctrl-play"
              onclick={togglePlayPause}
              title={playing ? 'Pause (Space)' : 'Play (Space)'}
            >
              {playing ? '⏸' : '▶'}
            </button>
            <div class="progress-wrap">
              <div class="progress-bar">
                <div class="progress-fill" style="width: {progressPercent}%"></div>
              </div>
              <span class="progress-label">{currentEventIndex + 1} / {timeline.events.length}</span>
            </div>
            <div class="speed-wrap">
              <span class="speed-label">Speed</span>
              <select class="speed-select" bind:value={speed}>
                <option value={0.5}>0.5x</option>
                <option value={1}>1x</option>
                <option value={2}>2x</option>
              </select>
            </div>
          </div>

          <!-- Current event card -->
          {#if currentEvent}
            {#key currentEvent.id}
              <div class="event-card event-card--{currentEvent.type}">
                <div class="event-card-header">
                  <span class="event-icon"
                    ><svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      ><path d={TYPE_ICON_PATHS[currentEvent.type] ?? 'M12 12h.01'} /></svg
                    ></span
                  >
                  <span class="event-type-label"
                    >{TYPE_LABELS[currentEvent.type] ?? currentEvent.type}</span
                  >
                  {#if currentEvent.toolName}
                    <span class="tool-name-badge">{currentEvent.toolName}</span>
                  {/if}
                  <span class="event-role-badge event-role-badge--{currentEvent.role}"
                    >{currentEvent.role}</span
                  >
                </div>
                <div class="event-text">{currentEvent.text}</div>
              </div>
            {/key}
          {:else}
            <div class="event-empty">No events to display</div>
          {/if}

          <!-- File changes section -->
          {#if changes && (changes.filesChanged.length > 0 || changes.commits.length > 0)}
            <div class="changes-section">
              <div class="changes-title">File Changes</div>
              {#if changes.commits.length > 0}
                <div class="changes-commits">
                  {#each changes.commits as commit}
                    <div class="commit-line">
                      <span class="commit-icon">⎇</span>
                      <code class="commit-text">{commit}</code>
                    </div>
                  {/each}
                </div>
              {/if}
              {#if changes.filesChanged.length > 0}
                <div class="files-list">
                  {#each changes.filesChanged as file}
                    <div class="file-item file-item--{file.operation}">
                      <span class="file-op">
                        {file.operation === 'created'
                          ? '+'
                          : file.operation === 'deleted'
                            ? '−'
                            : '~'}
                      </span>
                      <span class="file-path">{file.path}</span>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
        </div>

        <!-- Right: event list -->
        <div class="event-list-panel" bind:this={eventListEl}>
          <div class="event-list-title">Timeline ({timeline.events.length} events)</div>
          <div class="event-list">
            {#each timeline.events as event, i}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="event-list-item"
                class:active={i === currentEventIndex}
                class:past={i < currentEventIndex}
                data-index={i}
                onclick={() => jumpToEvent(i)}
                title={event.text}
              >
                <span class="event-list-icon"
                  ><svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    ><path d={TYPE_ICON_PATHS[event.type] ?? 'M12 12h.01'} /></svg
                  ></span
                >
                <div class="event-list-content">
                  <span class="event-list-type">{TYPE_LABELS[event.type] ?? event.type}</span>
                  <span class="event-list-text"
                    >{event.text.slice(0, 60)}{event.text.length > 60 ? '…' : ''}</span
                  >
                </div>
              </div>
            {/each}
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: rgba(0, 0, 0, 0.75);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    animation: fadeIn 0.15s linear;
  }

  .modal {
    width: 100%;
    max-width: 1100px;
    max-height: calc(100vh - 48px);
    background: var(--bg-primary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
  }

  /* Header */
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 20px;
    border-bottom: 1px solid var(--border-primary);
    flex-shrink: 0;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .header-icon {
    font-size: var(--fs-2xl);
    color: var(--accent-primary);
  }

  .header-title {
    font-size: var(--fs-md);
    font-weight: 700;
    color: var(--text-primary);
    letter-spacing: var(--ht-label-spacing);
  }

  .header-sub {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .close-btn {
    width: 28px;
    height: 28px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-primary);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: var(--fs-md);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all var(--transition);
  }

  .close-btn:hover {
    color: var(--accent-error);
    border-color: var(--accent-error);
  }

  /* Loading / error states */
  .loading-state,
  .error-state {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 60px 24px;
    color: var(--text-secondary);
    font-size: var(--fs-md);
  }

  .spinner {
    width: 20px;
    height: 20px;
    border: 2px solid var(--border-primary);
    border-top-color: var(--accent-primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .error-icon {
    color: var(--accent-error);
    font-size: var(--fs-xl);
  }

  /* Body layout */
  .modal-body {
    display: grid;
    grid-template-columns: 1fr 280px;
    overflow: hidden;
    flex: 1;
    min-height: 0;
  }

  /* Main panel */
  .main-panel {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 20px;
    overflow-y: auto;
    border-right: 1px solid var(--border-secondary);
  }

  /* Controls */
  .controls {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }

  .ctrl-btn {
    width: 34px;
    height: 34px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-primary);
    background: var(--bg-secondary);
    color: var(--text-primary);
    cursor: pointer;
    font-size: var(--fs-md);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all var(--transition);
    flex-shrink: 0;
  }

  .ctrl-btn:hover:not(:disabled) {
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }

  .ctrl-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .ctrl-play {
    background: var(--accent-primary);
    border-color: var(--accent-primary);
    color: var(--bg-primary);
  }

  .ctrl-play:hover:not(:disabled) {
    filter: brightness(1.1);
    color: var(--bg-primary);
  }

  .progress-wrap {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .progress-bar {
    height: 4px;
    background: var(--bg-tertiary);
    border-radius: 2px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: var(--accent-primary);
    transition: width 0.15s linear;
    border-radius: 2px;
  }

  .progress-label {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    font-family: var(--font-family);
  }

  .speed-wrap {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .speed-label {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
  }

  .speed-select {
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: var(--fs-sm);
    padding: 3px 6px;
    cursor: pointer;
  }

  /* Event card */
  .event-card {
    padding: 18px 20px;
    border-radius: var(--radius);
    border: 1px solid var(--border-secondary);
    background: var(--bg-secondary);
    animation:
      slideInUp 0.15s ease-out,
      fadeIn 0.15s linear;
    min-height: 120px;
  }

  .event-card--narration {
    border-left: 3px solid var(--accent-secondary);
  }

  .event-card--thinking {
    border-left: 3px solid #a78bfa;
    background: color-mix(in srgb, var(--bg-secondary) 95%, #a78bfa);
  }

  .event-card--tool_call {
    border-left: 3px solid var(--accent-primary);
  }

  .event-card--tool_result {
    border-left: 3px solid #34d399;
  }

  .event-card--user_message {
    border-left: 3px solid var(--border-primary);
  }

  .event-card-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
  }

  .event-icon {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .event-type-label {
    font-size: var(--fs-xs);
    font-weight: 700;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .tool-name-badge {
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 15%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent);
    border-radius: var(--radius-sm);
    padding: 1px 7px;
    font-family: var(--font-family);
  }

  .event-role-badge {
    margin-left: auto;
    font-size: var(--fs-xxs);
    font-weight: 600;
    padding: 1px 7px;
    border-radius: var(--radius-sm);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .event-role-badge--user {
    color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent-primary) 25%, transparent);
  }

  .event-role-badge--assistant {
    color: var(--accent-secondary);
    background: color-mix(in srgb, var(--accent-secondary) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent-secondary) 25%, transparent);
  }

  .event-text {
    font-size: var(--fs-base);
    line-height: 1.65;
    color: var(--text-primary);
    font-family: var(--font-family-sans);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .event-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 120px;
    color: var(--text-tertiary);
    font-size: var(--fs-base);
  }

  /* Changes section */
  .changes-section {
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius);
    padding: 14px 16px;
    background: var(--bg-secondary);
  }

  .changes-title {
    font-size: var(--fs-xs);
    font-weight: 700;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: 10px;
  }

  .changes-commits {
    margin-bottom: 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .commit-line {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: var(--fs-sm);
    color: var(--text-secondary);
  }

  .commit-icon {
    color: var(--accent-primary);
    flex-shrink: 0;
  }

  .commit-text {
    font-family: var(--font-family);
    font-size: var(--fs-xs);
    word-break: break-all;
  }

  .files-list {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .file-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--fs-sm);
    padding: 3px 6px;
    border-radius: var(--radius-sm);
  }

  .file-item--created {
    color: #34d399;
  }

  .file-item--modified {
    color: var(--text-secondary);
  }

  .file-item--deleted {
    color: var(--accent-error);
  }

  .file-op {
    font-weight: 700;
    font-size: var(--fs-md);
    width: 14px;
    text-align: center;
    flex-shrink: 0;
  }

  .file-path {
    font-family: var(--font-family);
    font-size: var(--fs-xs);
    word-break: break-all;
  }

  /* Event list panel */
  .event-list-panel {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .event-list-title {
    font-size: var(--fs-xs);
    font-weight: 700;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 14px 16px 10px;
    flex-shrink: 0;
    border-bottom: 1px solid var(--border-secondary);
  }

  .event-list {
    overflow-y: auto;
    flex: 1;
    padding: 8px 0;
  }

  .event-list-item {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 7px 14px;
    cursor: pointer;
    transition: background var(--transition);
    border-left: 2px solid transparent;
  }

  .event-list-item:hover {
    background: var(--bg-hover);
  }

  .event-list-item.active {
    background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
    border-left-color: var(--accent-primary);
  }

  .event-list-item.past {
    opacity: 0.55;
  }

  .event-list-icon {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    margin-top: 1px;
    color: var(--text-tertiary);
  }

  .event-list-content {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .event-list-type {
    font-size: var(--fs-xxs);
    font-weight: 700;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .event-list-text {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 220px;
  }

  /* Utility button */
  .btn-secondary {
    padding: 6px 14px;
    font-size: var(--fs-sm);
    font-weight: 600;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-primary);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all var(--transition);
  }

  .btn-secondary:hover {
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes slideInUp {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
