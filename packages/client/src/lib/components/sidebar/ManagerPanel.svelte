<script lang="ts">
  import { api } from '$lib/api/client';
  import { scheduledTasksApi } from '$lib/api/scheduled-tasks';
  import { workspaceListStore } from '$lib/stores/projects.svelte';
  import { primaryPaneStore } from '$lib/stores/primaryPane.svelte';
  import { uiStore } from '$lib/stores/ui.svelte';
  import { managerCommentaryStore } from '$lib/stores/manager-commentary.svelte';
  import { crossSessionStore } from '$lib/stores/cross-session.svelte';
  import { onMount, onDestroy } from 'svelte';
  import type { WorkspaceSettings, ScheduledTaskWithStats } from '@e/shared';

  // ---- Types ----
  type CommentaryPersonality =
    | 'documentary_narrator'
    | 'technical_analyst'
    | 'comedic_observer'
    | 'project_lead'
    | 'wizard';

  type CommentaryVerbosity = 'frequent' | 'strategic' | 'minimal';

  interface PersonalityOption {
    id: CommentaryPersonality;
    label: string;
    icon: string;
  }

  interface WorkspaceStatus {
    id: string;
    name: string;
    path: string;
    agentStatus: 'idle' | 'running' | 'waiting';
    activeLoops: any[];
    activeSessions: any[];
    pendingApprovals: any[];
    lastOpened: number;
    settings?: WorkspaceSettings;
  }

  interface PendingApproval {
    sessionId: string;
    conversationId: string;
    conversationTitle: string;
    workspacePath: string | null;
    toolCallId: string;
    toolName: string;
    description: string;
  }

  interface StoryEntry {
    id: string;
    title: string;
    status: string;
    workspace_path: string;
    updated_at: number;
    prd_id: string | null;
    conversation_id?: string | null;
    prd_name: string | null;
    attempts?: number | null;
    max_attempts?: number | null;
    executor_id?: string | null;
    executor_type?: string | null;
    machine_id?: string | null;
  }

  interface OverviewData {
    workspaces: WorkspaceStatus[];
    pendingApprovals: PendingApproval[];
    inProgressStories: StoryEntry[];
    completedStories: StoryEntry[];
    summary: {
      totalWorkspaces: number;
      totalPendingApprovals: number;
      totalRunningAgents: number;
      totalActiveLoops: number;
      totalCompletedToday: number;
    };
  }

  // ---- Personality Options ----
  const personalities: PersonalityOption[] = [
    {
      id: 'documentary_narrator',
      label: 'Documentary',
      icon: 'M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    },
    {
      id: 'technical_analyst',
      label: 'Technical',
      icon: 'M3 3l18 18M9 9v6a3 3 0 0 0 5.12 2.12M15 15V9a3 3 0 0 0-3-3M3 12h18M12 3v18',
    },
    {
      id: 'comedic_observer',
      label: 'Comedic',
      icon: 'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01',
    },
    {
      id: 'project_lead',
      label: 'Lead',
      icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
    },
    {
      id: 'wizard',
      label: 'Wizard',
      icon: 'M12 2L9.5 8.5 3 10l5 4.5L6.5 21 12 17.5 17.5 21 16 14.5 21 10l-6.5-1.5z',
    },
  ];

  // ---- Verbosity Options ----
  const verbosityOptions: { value: CommentaryVerbosity; label: string; shortLabel: string }[] = [
    { value: 'frequent', label: 'Frequent commentary', shortLabel: 'Hi' },
    { value: 'strategic', label: 'Strategic milestones', shortLabel: 'Med' },
    { value: 'minimal', label: 'Major events only', shortLabel: 'Lo' },
  ];

  // ---- State ----
  let loading = $state(false);
  let error = $state<string | null>(null);
  let data = $state<OverviewData | null>(null);
  let lastRefresh = $state<Date | null>(null);
  let refreshInterval: ReturnType<typeof setInterval> | null = null;
  let evtSource: EventSource | null = null;
  let openPersonalityDropdown = $state<string | null>(null);
  let openVerbosityDropdown = $state<string | null>(null);
  let scheduledTasks = $state<Map<string, ScheduledTaskWithStats[]>>(new Map());
  let showScheduledTasks = $state(false);

  // ---- Golem Questions ----
  interface GolemQuestionEntry {
    questionId: string;
    storyId: string;
    executorId: string;
    question: string;
    context?: string;
    askedAt: number;
  }
  let golemQuestions = $state<GolemQuestionEntry[]>([]);
  let golemAnswers = $state<Record<string, string>>({});
  let golemQuestionPoll: ReturnType<typeof setInterval> | null = null;
  let coordinationEvtSource: EventSource | null = null;

  // Derived: expanded workspace from the manager commentary store
  let expandedWsId = $derived(managerCommentaryStore.expandedWorkspaceId);

  // ---- Load ----
  async function load() {
    loading = true;
    error = null;
    try {
      const res = await api.manager.overview();
      data = res.data;
      lastRefresh = new Date();
      // Load scheduled tasks for all workspaces
      await loadScheduledTasks();
    } catch (e: any) {
      error = e?.message ?? 'Failed to load manager overview';
    } finally {
      loading = false;
    }
  }

  async function loadScheduledTasks() {
    if (!data?.workspaces) return;
    const tasksMap = new Map<string, ScheduledTaskWithStats[]>();
    for (const ws of data.workspaces) {
      try {
        const tasks = await scheduledTasksApi.list(ws.id);
        if (tasks.length > 0) {
          tasksMap.set(ws.id, tasks);
        }
      } catch (e) {
        console.error(`Failed to load scheduled tasks for workspace ${ws.id}:`, e);
      }
    }
    scheduledTasks = tasksMap;
  }

  // ---- SSE for real-time updates ----
  function connectSSE() {
    if (typeof EventSource === 'undefined') return;
    evtSource?.close();
    evtSource = new EventSource('/api/manager/events');
    evtSource.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data);
        if (evt.type !== 'ping') {
          load();
        }
      } catch {}
    };
    evtSource.onerror = () => {};
  }

  // ---- Navigation ----
  function openConversation(conversationId: string, title: string) {
    primaryPaneStore.openConversation(conversationId, title);
    uiStore.setSidebarTab('conversations');
  }

  // ---- Workspace status helpers ----
  function statusDot(status: 'idle' | 'running' | 'waiting'): string {
    switch (status) {
      case 'running':
        return 'var(--accent-primary)';
      case 'waiting':
        return 'var(--accent-warning, #f59e0b)';
      case 'idle':
      default:
        return 'var(--text-tertiary)';
    }
  }

  function statusLabel(status: 'idle' | 'running' | 'waiting'): string {
    switch (status) {
      case 'running':
        return 'running';
      case 'waiting':
        return 'waiting';
      default:
        return 'idle';
    }
  }

  function formatTime(ms: number): string {
    const diff = Date.now() - ms;
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
  }

  function formatCommentaryTime(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function workspaceName(path: string | null | undefined): string {
    if (!path) return 'Unknown';
    const ws = workspaceListStore.workspaces.find((w) => w.path === path);
    if (ws) return ws.name;
    return path.split('/').pop() ?? path;
  }

  function getVerbosityLabel(ws: WorkspaceStatus): string {
    const v = ws.settings?.commentaryVerbosity ?? 'strategic';
    return verbosityOptions.find((o) => o.value === v)?.shortLabel ?? 'Med';
  }

  // ---- Commentary Controls ----

  $effect(() => {
    if (!data?.workspaces) return;
    for (const ws of data.workspaces) {
      const isMuted = ws.settings?.commentaryMuted ?? false;
      const isAlreadyActive = managerCommentaryStore.isActive(ws.id);
      if (!isMuted && !isAlreadyActive && ws.agentStatus !== 'idle') {
        const personality = ws.settings?.commentaryPersonality || 'technical_analyst';
        managerCommentaryStore.startCommentary(ws.id, personality);
      } else if (isMuted && isAlreadyActive) {
        managerCommentaryStore.stopCommentary(ws.id);
      }
    }
  });

  async function toggleCommentaryMute(ws: WorkspaceStatus) {
    const currentMuted = ws.settings?.commentaryMuted ?? false;
    const newMuted = !currentMuted;
    try {
      await api.workspaces.update(ws.id, {
        settings: { commentaryMuted: newMuted },
      });
      if (data) {
        const idx = data.workspaces.findIndex((w) => w.id === ws.id);
        if (idx >= 0) {
          data.workspaces[idx].settings = {
            ...data.workspaces[idx].settings,
            commentaryMuted: newMuted,
          };
        }
      }
      managerCommentaryStore.setMuted(ws.id, newMuted);
      if (!newMuted && ws.agentStatus !== 'idle') {
        const personality = ws.settings?.commentaryPersonality || 'technical_analyst';
        managerCommentaryStore.startCommentary(ws.id, personality);
      }
    } catch (err) {
      console.error('Failed to toggle commentary mute:', err);
      uiStore.toast('Failed to update commentary settings', 'error');
    }
  }

  async function toggleCommentaryHistory(ws: WorkspaceStatus) {
    const currentEnabled = ws.settings?.commentaryHistoryEnabled ?? true;
    try {
      await api.workspaces.update(ws.id, {
        settings: { commentaryHistoryEnabled: !currentEnabled },
      });
      if (data) {
        const idx = data.workspaces.findIndex((w) => w.id === ws.id);
        if (idx >= 0) {
          data.workspaces[idx].settings = {
            ...data.workspaces[idx].settings,
            commentaryHistoryEnabled: !currentEnabled,
          };
        }
      }
      uiStore.toast(
        !currentEnabled ? 'Commentary history enabled' : 'Commentary history disabled',
        'info',
      );
    } catch (err) {
      console.error('Failed to toggle commentary history:', err);
      uiStore.toast('Failed to update commentary history setting', 'error');
    }
  }

  async function setCommentaryPersonality(ws: WorkspaceStatus, personality: CommentaryPersonality) {
    openPersonalityDropdown = null;
    try {
      await api.workspaces.update(ws.id, {
        settings: { commentaryPersonality: personality },
      });
      if (data) {
        const idx = data.workspaces.findIndex((w) => w.id === ws.id);
        if (idx >= 0) {
          data.workspaces[idx].settings = {
            ...data.workspaces[idx].settings,
            commentaryPersonality: personality,
          };
        }
      }
      if (managerCommentaryStore.isActive(ws.id)) {
        managerCommentaryStore.startCommentary(ws.id, personality);
      }
    } catch (err) {
      console.error('Failed to set commentary personality:', err);
      uiStore.toast('Failed to update commentary personality', 'error');
    }
  }

  async function setCommentaryVerbosity(ws: WorkspaceStatus, verbosity: CommentaryVerbosity) {
    openVerbosityDropdown = null;
    try {
      await api.workspaces.update(ws.id, {
        settings: { commentaryVerbosity: verbosity },
      });
      await api.commentary.updateSettings(ws.id, { verbosity }).catch(() => {});
      if (data) {
        const idx = data.workspaces.findIndex((w) => w.id === ws.id);
        if (idx >= 0) {
          data.workspaces[idx].settings = {
            ...data.workspaces[idx].settings,
            commentaryVerbosity: verbosity,
          };
        }
      }
      const opt = verbosityOptions.find((o) => o.value === verbosity);
      uiStore.toast(`Verbosity: ${opt?.label ?? verbosity}`, 'info');
    } catch (err) {
      console.error('Failed to set commentary verbosity:', err);
      uiStore.toast('Failed to update verbosity', 'error');
    }
  }

  function togglePersonalityDropdown(wsId: string) {
    openVerbosityDropdown = null;
    openPersonalityDropdown = openPersonalityDropdown === wsId ? null : wsId;
  }

  function toggleVerbosityDropdown(wsId: string) {
    openPersonalityDropdown = null;
    openVerbosityDropdown = openVerbosityDropdown === wsId ? null : wsId;
  }

  function openCommentarySettings() {
    openPersonalityDropdown = null;
    openVerbosityDropdown = null;
    uiStore.openSettings();
  }

  // Close dropdowns when clicking outside
  $effect(() => {
    if (openPersonalityDropdown || openVerbosityDropdown || openCrossSessionDropdown) {
      const handler = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (
          !target.closest('.ws-personality-dropdown') &&
          !target.closest('.ws-verbosity-dropdown') &&
          !target.closest('.ws-cross-session-dropdown')
        ) {
          openPersonalityDropdown = null;
          openVerbosityDropdown = null;
          openCrossSessionDropdown = null;
        }
      };
      document.addEventListener('click', handler);
      return () => document.removeEventListener('click', handler);
    }
  });

  // ---- Spatial Audio (Experimental, opt-in) ----
  let spatialEnabled = $derived(managerCommentaryStore.spatialAudioEnabled);
  let mgrTtsEnabled = $derived(managerCommentaryStore.ttsEnabled);
  let mgrTtsVolume = $derived(managerCommentaryStore.ttsVolume);

  $effect(() => {
    if (data?.workspaces) {
      managerCommentaryStore.updateSpatialPositions(
        data.workspaces.map((w: WorkspaceStatus) => w.id),
      );
    }
  });

  function toggleSpatialAudio() {
    const next = !spatialEnabled;
    managerCommentaryStore.setSpatialAudioEnabled(next);
    uiStore.toast(
      next ? 'Spatial audio enabled \u2014 L/C/R positioning' : 'Spatial audio disabled',
      'info',
    );
  }

  function toggleMgrTts() {
    managerCommentaryStore.setTtsEnabled(!mgrTtsEnabled);
  }

  function handleMgrVolume(e: Event) {
    managerCommentaryStore.setTtsVolume(parseFloat((e.target as HTMLInputElement).value));
  }

  function spatialBadge(wsId: string): string {
    if (!spatialEnabled) return '';
    const p = managerCommentaryStore.getSpatialPosition(wsId);
    if (!p) return '';
    if (p.pan <= -0.5) return 'L';
    if (p.pan >= 0.5) return 'R';
    if (p.pan > -0.1 && p.pan < 0.1) return 'C';
    return p.pan < 0 ? 'CL' : 'CR';
  }

  // ---- Cross-Session Flow ----
  let crossSessionFlow = $derived(crossSessionStore.recentFlow);
  let openCrossSessionDropdown = $state<string | null>(null);

  type CrossSessionPerm = 'open' | 'send_only' | 'receive_only' | 'disabled';

  const crossSessionPermOptions: { value: CrossSessionPerm; label: string; icon: string }[] = [
    { value: 'open', label: 'Open (send & receive)', icon: '&#x2194;' },
    { value: 'send_only', label: 'Send only', icon: '&#x2192;' },
    { value: 'receive_only', label: 'Receive only', icon: '&#x2190;' },
    { value: 'disabled', label: 'Disabled', icon: '&#x2715;' },
  ];

  function toggleCrossSessionDropdown(wsId: string) {
    openCrossSessionDropdown = openCrossSessionDropdown === wsId ? null : wsId;
  }

  async function setCrossSessionPermission(ws: WorkspaceStatus, permission: CrossSessionPerm) {
    openCrossSessionDropdown = null;
    try {
      await api.workspaces.update(ws.id, {
        settings: { crossSessionPermission: permission },
      });
      if (data) {
        const idx = data.workspaces.findIndex((w) => w.id === ws.id);
        if (idx >= 0) {
          data.workspaces[idx].settings = {
            ...data.workspaces[idx].settings,
            crossSessionPermission: permission,
          };
        }
      }
      uiStore.toast(
        `Cross-session: ${crossSessionPermOptions.find((o) => o.value === permission)?.label ?? permission}`,
        'info',
      );
    } catch (err) {
      console.error('Failed to set cross-session permission:', err);
      uiStore.toast('Failed to update cross-session permission', 'error');
    }
  }

  /** Count of cross-session messages involving a workspace */
  function crossSessionCountForWorkspace(wsId: string): number {
    return crossSessionFlow.filter(
      (m) =>
        m.senderContext.workspaceId === wsId ||
        // Check if the target is in this workspace (approximate via recent flow)
        crossSessionFlow.some((m2) => m2.senderContext.workspaceId === wsId),
    ).length;
  }

  /** Get recent cross-session messages involving a workspace */
  function crossSessionMessagesForWorkspace(wsId: string): typeof crossSessionFlow {
    return crossSessionFlow.filter((m) => m.senderContext.workspaceId === wsId).slice(0, 5);
  }

  // ---- Golem Question helpers ----

  async function loadGolemQuestions() {
    try {
      const res = await fetch('/api/story-coordination/pending-questions');
      const json = await res.json();
      if (json.ok) golemQuestions = json.data ?? [];
    } catch {
      /* silently ignore — questions are best-effort */
    }
  }

  async function answerGolemQuestion(questionId: string, storyId: string) {
    const answer = golemAnswers[questionId]?.trim();
    if (!answer) return;
    try {
      const res = await fetch(`/api/story-coordination/${storyId}/question/${questionId}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer }),
      });
      if (res.ok) {
        golemQuestions = golemQuestions.filter((q) => q.questionId !== questionId);
        const copy = { ...golemAnswers };
        delete copy[questionId];
        golemAnswers = copy;
        uiStore.toast('Answer sent to golem', 'success');
      } else {
        uiStore.toast('Failed to send answer', 'error');
      }
    } catch {
      uiStore.toast('Failed to send answer', 'error');
    }
  }

  function connectCoordinationSSE() {
    if (typeof EventSource === 'undefined') return;
    coordinationEvtSource?.close();
    coordinationEvtSource = new EventSource('/api/story-coordination/events');
    coordinationEvtSource.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data);
        if (evt.type === 'story_question' || evt.type === 'story_answered') {
          loadGolemQuestions();
        }
      } catch {}
    };
    coordinationEvtSource.onerror = () => {};
  }

  // ---- Lifecycle ----
  onMount(() => {
    load();
    connectSSE();
    crossSessionStore.subscribeFlow();
    refreshInterval = setInterval(load, 30_000);
    // Golem questions: load once + SSE for immediate updates + poll as fallback
    loadGolemQuestions();
    connectCoordinationSSE();
    golemQuestionPoll = setInterval(loadGolemQuestions, 10_000);
  });

  onDestroy(() => {
    evtSource?.close();
    coordinationEvtSource?.close();
    crossSessionStore.unsubscribeFlow();
    if (refreshInterval) clearInterval(refreshInterval);
    if (golemQuestionPoll) clearInterval(golemQuestionPoll);
    managerCommentaryStore.stopAll();
  });
</script>

<div class="manager-panel">
  <!-- Header -->
  <div class="panel-header">
    <div class="header-actions">
      {#if lastRefresh}
        <span class="last-refresh" title={lastRefresh.toLocaleTimeString()}>
          {formatTime(lastRefresh.getTime())}
        </span>
      {/if}
      <button class="btn-refresh" onclick={load} disabled={loading} title="Refresh">
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          class:spinning={loading}
        >
          <path d="M23 4v6h-6M1 20v-6h6" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
      </button>
    </div>
  </div>

  {#if error}
    <div class="error-msg">{error}</div>
  {/if}

  {#if data}
    <!-- Summary Stats -->
    <div class="stats-row">
      <div class="stat-chip" class:active={data.summary.totalRunningAgents > 0}>
        <span class="stat-num">{data.summary.totalRunningAgents}</span>
        <span class="stat-lbl">Running</span>
      </div>
      <div class="stat-chip" class:warn={data.summary.totalPendingApprovals > 0}>
        <span class="stat-num">{data.summary.totalPendingApprovals}</span>
        <span class="stat-lbl">Waiting</span>
      </div>
      <div class="stat-chip">
        <span class="stat-num">{data.summary.totalActiveLoops}</span>
        <span class="stat-lbl">Loops</span>
      </div>
      <div class="stat-chip">
        <span class="stat-num">{data.summary.totalCompletedToday}</span>
        <span class="stat-lbl">Done Today</span>
      </div>
    </div>

    <!-- Audio Controls Bar -->
    <div class="audio-controls-bar">
      <button
        class="audio-btn"
        class:active={mgrTtsEnabled}
        onclick={toggleMgrTts}
        title={mgrTtsEnabled ? 'Disable TTS' : 'Enable TTS for commentary'}
      >
        {#if mgrTtsEnabled}
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path
              d="M15.54 8.46a5 5 0 0 1 0 7.07"
            ></path></svg
          >
        {:else}
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line
              x1="23"
              y1="9"
              x2="17"
              y2="15"
            ></line><line x1="17" y1="9" x2="23" y2="15"></line></svg
          >
        {/if}
        <span class="audio-btn-label">TTS</span>
      </button>
      {#if mgrTtsEnabled}
        <div class="audio-volume" title={`Volume: ${Math.round(mgrTtsVolume * 100)}%`}>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={mgrTtsVolume}
            oninput={handleMgrVolume}
            class="volume-slider-sm"
          />
        </div>
        <button
          class="audio-btn spatial-btn"
          class:active={spatialEnabled}
          onclick={toggleSpatialAudio}
          title={spatialEnabled
            ? 'Disable spatial audio positioning'
            : 'Enable spatial audio \u2014 position workspaces L/C/R (experimental)'}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><path d="M3 18v-6a9 9 0 0 1 18 0v6"></path><path
              d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"
            ></path></svg
          >
          <span class="audio-btn-label">Spatial</span>
          {#if spatialEnabled}
            <span class="exp-badge">EXP</span>
          {/if}
        </button>
      {/if}
    </div>

    <!-- Golem Questions: remote golem needs human input to continue -->
    {#if golemQuestions.length > 0}
      <div class="section">
        <div class="section-header">
          <span class="section-title">
            <span class="dot pulse-dot" style:background="var(--accent-error, #ef4444)"></span>
            Golem Needs Help
            <span class="badge warn">{golemQuestions.length}</span>
          </span>
        </div>
        <div class="item-list">
          {#each golemQuestions as q (q.questionId)}
            <div class="inbox-item golem-question-card">
              <div class="inbox-item-top">
                <span class="tool-badge">ask_human</span>
                <span class="ws-chip" title="executor: {q.executorId}"
                  >{q.executorId.slice(0, 12)}</span
                >
                <span class="inbox-item-sub" style:margin-left="auto">{formatTime(q.askedAt)}</span>
              </div>
              <div class="golem-q-text">{q.question}</div>
              {#if q.context}
                <div class="golem-q-context">{q.context}</div>
              {/if}
              <div class="golem-q-row">
                <input
                  class="golem-q-input"
                  type="text"
                  placeholder="Type your answer and press Enter…"
                  bind:value={golemAnswers[q.questionId]}
                  onkeydown={(e) => {
                    if (e.key === 'Enter') answerGolemQuestion(q.questionId, q.storyId);
                  }}
                />
                <button
                  class="golem-q-send"
                  onclick={() => answerGolemQuestion(q.questionId, q.storyId)}
                  disabled={!golemAnswers[q.questionId]?.trim()}>Reply</button
                >
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Inbox: Pending Approvals -->
    {#if data.pendingApprovals.length > 0}
      <div class="section">
        <div class="section-header">
          <span class="section-title">
            <span class="dot" style:background="var(--accent-warning, #f59e0b)"></span>
            Pending Approvals
            <span class="badge warn">{data.pendingApprovals.length}</span>
          </span>
        </div>
        <div class="item-list">
          {#each data.pendingApprovals as approval (approval.toolCallId)}
            <button
              class="inbox-item clickable"
              onclick={() => openConversation(approval.conversationId, approval.conversationTitle)}
            >
              <div class="inbox-item-top">
                <span class="tool-badge">{approval.toolName}</span>
                {#if approval.workspacePath}
                  <span class="ws-chip">{workspaceName(approval.workspacePath)}</span>
                {/if}
              </div>
              <div class="inbox-item-desc">{approval.description}</div>
              <div class="inbox-item-sub">{approval.conversationTitle}</div>
            </button>
          {/each}
        </div>
      </div>
    {/if}

    <!-- In-Progress Stories -->
    {#if data.inProgressStories.length > 0}
      <div class="section">
        <div class="section-header">
          <span class="section-title">
            <span class="dot spin-dot" style:background="var(--accent-primary)"></span>
            In Progress
            <span class="badge">{data.inProgressStories.length}</span>
          </span>
        </div>
        <div class="item-list">
          {#each data.inProgressStories as story (story.id)}
            <div
              class="inbox-item"
              class:clickable={!!story.conversation_id}
              role={story.conversation_id ? 'button' : undefined}
              tabindex={story.conversation_id ? 0 : undefined}
              onclick={() => {
                if (story.conversation_id) {
                  openConversation(story.conversation_id, story.title);
                }
              }}
              onkeydown={(e) => {
                if (e.key === 'Enter' && story.conversation_id) {
                  openConversation(story.conversation_id, story.title);
                }
              }}
            >
              <div class="inbox-item-top">
                <span class="story-title">{story.title}</span>
              </div>
              <div class="inbox-item-sub">
                {workspaceName(story.workspace_path)}
                {#if story.prd_name}
                  · {story.prd_name}
                {/if}
                · attempt {story.attempts ?? '?'}
                {#if story.executor_type && story.machine_id}
                  · <span class="executor-chip" title="{story.executor_type}: {story.machine_id}"
                    >{story.executor_type === 'local-worktree' ? 'local' : story.machine_id}</span
                  >
                {/if}
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Scheduled Tasks -->
    {#if scheduledTasks.size > 0}
      {@const totalTasks = Array.from(scheduledTasks.values()).reduce(
        (sum, tasks) => sum + tasks.length,
        0,
      )}
      {@const upcomingTasks = Array.from(scheduledTasks.values())
        .flat()
        .filter((t) => t.status === 'active' && t.nextRun)
        .sort((a, b) => (a.nextRun || 0) - (b.nextRun || 0))
        .slice(0, 5)}
      <div class="section">
        <div class="section-header">
          <button
            class="section-title-btn"
            onclick={() => (showScheduledTasks = !showScheduledTasks)}
          >
            <span class="section-title">
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="expand-icon"
                class:expanded={showScheduledTasks}
              >
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
              <span class="dot" style:background="var(--accent-info, #3b82f6)"></span>
              Scheduled Tasks
              <span class="badge">{totalTasks}</span>
            </span>
          </button>
        </div>
        {#if showScheduledTasks}
          <div class="item-list">
            {#each upcomingTasks as task (task.id)}
              {@const ws = data.workspaces.find((w) => w.id === task.workspaceId)}
              <div class="inbox-item">
                <div class="inbox-item-top">
                  <span class="story-title">{task.name}</span>
                  {#if task.nextRun}
                    <span class="task-next-badge">{formatTime(task.nextRun)}</span>
                  {/if}
                </div>
                <div class="inbox-item-sub">
                  {ws?.name || 'Unknown workspace'}
                  {#if task.cronExpression}
                    · Cron: {task.cronExpression}
                  {:else if task.intervalMinutes}
                    · Every {task.intervalMinutes}m
                  {/if}
                </div>
              </div>
            {/each}
            {#if upcomingTasks.length === 0}
              <div class="empty-msg">No active scheduled tasks</div>
            {/if}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Workspace Status -->
    <div class="section">
      <div class="section-header">
        <span class="section-title">Workspaces</span>
      </div>
      <div class="workspace-list">
        {#each data.workspaces as ws (ws.id)}
          {@const wsCommentary = managerCommentaryStore.getWorkspaceState(ws.id)}
          {@const wsEntries = managerCommentaryStore.getEntries(ws.id)}
          {@const isCommentaryActive = managerCommentaryStore.isActive(ws.id)}
          {@const isMuted = ws.settings?.commentaryMuted ?? false}
          {@const isExpanded = expandedWsId === ws.id}
          {@const currentVerbosity = ws.settings?.commentaryVerbosity ?? 'strategic'}
          {@const wsXsMessages = crossSessionMessagesForWorkspace(ws.id)}
          <div class="workspace-card" class:muted={isMuted} class:expanded={isExpanded}>
            <!-- Workspace Header Row -->
            <div class="workspace-card-header">
              <span
                class="ws-dot"
                style:background={statusDot(ws.agentStatus)}
                class:ws-dot-pulse={ws.agentStatus === 'running'}
              ></span>
              <div class="ws-info">
                <span class="ws-name">
                  {ws.name}
                  {#if isCommentaryActive && !isMuted}
                    <span class="commentary-live-dot" title="Commentary active"></span>
                  {/if}
                  {#if spatialBadge(ws.id)}
                    <span class="spatial-pos-badge" title={`Spatial: ${spatialBadge(ws.id)}`}
                      >{spatialBadge(ws.id)}</span
                    >
                  {/if}
                </span>
                <span class="ws-meta">
                  <span class="ws-status">{statusLabel(ws.agentStatus)}</span>
                  {#if ws.activeLoops.length > 0}
                    · {ws.activeLoops.length} loop{ws.activeLoops.length !== 1 ? 's' : ''}
                  {/if}
                  {#if ws.activeSessions.length > 0}
                    · {ws.activeSessions.length} session{ws.activeSessions.length !== 1 ? 's' : ''}
                  {/if}
                  {#if ws.settings?.crossSessionPermission && ws.settings.crossSessionPermission !== 'open'}
                    · xsm: {ws.settings.crossSessionPermission}
                  {/if}
                </span>
              </div>
              {#if ws.pendingApprovals.length > 0}
                <span class="badge warn sm">{ws.pendingApprovals.length}</span>
              {/if}
              {#if wsXsMessages.length > 0}
                <span class="badge cross-session-badge sm" title="Cross-session messages">
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                  >
                    <path d="M4 12h16M4 12l4-4M4 12l4 4M20 12l-4-4M20 12l-4 4"></path>
                  </svg>
                  {wsXsMessages.length}
                </span>
              {/if}
              <div class="ws-commentary-controls">
                <!-- Personality Selector -->
                <div class="ws-personality-dropdown">
                  <button
                    class="ws-control-btn"
                    class:active={!isMuted}
                    onclick={(e) => {
                      e.stopPropagation();
                      togglePersonalityDropdown(ws.id);
                    }}
                    title="Change commentary personality"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path
                        d={personalities.find(
                          (p) =>
                            p.id === (ws.settings?.commentaryPersonality || 'technical_analyst'),
                        )?.icon || ''}
                      />
                    </svg>
                  </button>

                  {#if openPersonalityDropdown === ws.id}
                    <div class="personality-dropdown" onclick={(e) => e.stopPropagation()}>
                      {#each personalities as p}
                        <button
                          class="personality-option"
                          class:active={(ws.settings?.commentaryPersonality ||
                            'technical_analyst') === p.id}
                          onclick={() => setCommentaryPersonality(ws, p.id)}
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
                            <path d={p.icon} />
                          </svg>
                          <span class="personality-label">{p.label}</span>
                          {#if (ws.settings?.commentaryPersonality || 'technical_analyst') === p.id}
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2.5"
                              class="check-icon"
                            >
                              <polyline points="20 6 9 17 4 12"></polyline>
                            </svg>
                          {/if}
                        </button>
                      {/each}
                    </div>
                  {/if}
                </div>

                <!-- Verbosity Selector -->
                <div class="ws-verbosity-dropdown">
                  <button
                    class="ws-control-btn ws-verbosity-btn"
                    class:active={!isMuted}
                    onclick={(e) => {
                      e.stopPropagation();
                      toggleVerbosityDropdown(ws.id);
                    }}
                    title="Change commentary verbosity ({currentVerbosity})"
                  >
                    <span class="verbosity-label-text">{getVerbosityLabel(ws)}</span>
                  </button>

                  {#if openVerbosityDropdown === ws.id}
                    <div class="verbosity-dropdown" onclick={(e) => e.stopPropagation()}>
                      {#each verbosityOptions as opt}
                        <button
                          class="verbosity-option"
                          class:active={currentVerbosity === opt.value}
                          onclick={() => setCommentaryVerbosity(ws, opt.value)}
                        >
                          <span class="verbosity-option-label">{opt.shortLabel}</span>
                          <span class="verbosity-option-desc">{opt.label}</span>
                          {#if currentVerbosity === opt.value}
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2.5"
                              class="check-icon"
                            >
                              <polyline points="20 6 9 17 4 12"></polyline>
                            </svg>
                          {/if}
                        </button>
                      {/each}
                    </div>
                  {/if}
                </div>

                <!-- Mute/Unmute Button -->
                <button
                  class="ws-control-btn"
                  class:muted={isMuted}
                  onclick={(e) => {
                    e.stopPropagation();
                    toggleCommentaryMute(ws);
                  }}
                  title={isMuted ? 'Unmute commentary' : 'Mute commentary'}
                >
                  {#if isMuted}
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                      <line x1="23" y1="9" x2="17" y2="15"></line>
                      <line x1="17" y1="9" x2="23" y2="15"></line>
                    </svg>
                  {:else}
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                    </svg>
                  {/if}
                </button>

                <!-- Settings Button -->
                <button
                  class="ws-control-btn"
                  onclick={(e) => {
                    e.stopPropagation();
                    openCommentarySettings();
                  }}
                  title="Open commentary settings"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <circle cx="12" cy="12" r="3"></circle>
                    <path
                      d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
                    ></path>
                  </svg>
                </button>

                <!-- History Toggle Button -->
                <button
                  class="ws-control-btn"
                  class:active={ws.settings?.commentaryHistoryEnabled !== false}
                  onclick={(e) => {
                    e.stopPropagation();
                    toggleCommentaryHistory(ws);
                  }}
                  title={ws.settings?.commentaryHistoryEnabled !== false
                    ? 'Disable commentary history'
                    : 'Enable commentary history'}
                >
                  {#if ws.settings?.commentaryHistoryEnabled === false}
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                      <line x1="18" y1="6" x2="10" y2="14" />
                      <line x1="10" y1="6" x2="18" y2="14" />
                    </svg>
                  {:else}
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                    </svg>
                  {/if}
                </button>

                <!-- Cross-Session Permission (AC 5) -->
                <div class="ws-cross-session-dropdown">
                  <button
                    class="ws-control-btn"
                    class:active={ws.settings?.crossSessionPermission !== 'disabled'}
                    onclick={(e) => {
                      e.stopPropagation();
                      toggleCrossSessionDropdown(ws.id);
                    }}
                    title="Cross-session messaging: {ws.settings?.crossSessionPermission || 'open'}"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d="M4 12h16M4 12l4-4M4 12l4 4M20 12l-4-4M20 12l-4 4"></path>
                    </svg>
                  </button>
                  {#if openCrossSessionDropdown === ws.id}
                    <div class="ws-dropdown-menu">
                      {#each crossSessionPermOptions as opt (opt.value)}
                        <button
                          class="ws-dropdown-item"
                          class:selected={(ws.settings?.crossSessionPermission || 'open') ===
                            opt.value}
                          onclick={(e) => {
                            e.stopPropagation();
                            setCrossSessionPermission(ws, opt.value);
                          }}
                        >
                          <span class="ws-dropdown-icon">{@html opt.icon}</span>
                          <span>{opt.label}</span>
                        </button>
                      {/each}
                    </div>
                  {/if}
                </div>
              </div>
            </div>

            <!-- Commentary Feed Area -->
            {#if !isMuted && wsEntries.length > 0}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="ws-commentary-feed"
                class:expanded={isExpanded}
                onclick={() => managerCommentaryStore.toggleExpanded(ws.id)}
                title={isExpanded ? 'Collapse commentary' : 'Expand commentary'}
              >
                <div class="commentary-feed-header">
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="commentary-mic-icon"
                  >
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  </svg>
                  <span class="commentary-feed-label">Commentary</span>
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="commentary-chevron"
                    class:rotated={isExpanded}
                  >
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </div>
                <div class="commentary-entries">
                  {#each isExpanded ? wsEntries : wsEntries.slice(-2) as entry (entry.timestamp)}
                    <div class="commentary-entry">
                      <span class="commentary-time">{formatCommentaryTime(entry.timestamp)}</span>
                      <span class="commentary-text">{entry.text}</span>
                    </div>
                  {/each}
                </div>
              </div>
            {:else if !isMuted && isCommentaryActive}
              <div class="ws-commentary-feed waiting">
                <div class="commentary-feed-header">
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="commentary-mic-icon"
                  >
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  </svg>
                  <span class="commentary-feed-label waiting-text">Listening...</span>
                </div>
              </div>
            {/if}
          </div>
        {:else}
          <div class="empty">No workspaces</div>
        {/each}
      </div>
    </div>

    <!-- Cross-Session Messages (AC 4) -->
    {#if crossSessionFlow.length > 0}
      <div class="section">
        <div class="section-header">
          <span class="section-title">
            Agent Messages
            <span class="badge cross-session-flow-badge">{crossSessionFlow.length}</span>
          </span>
        </div>
        <div class="item-list cross-session-flow-list">
          {#each crossSessionFlow.slice(0, 10) as msg (msg.id)}
            <div class="cross-session-flow-item">
              <span class="cross-session-flow-icon">
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path d="M5 12h14M12 5l7 7-7 7"></path>
                </svg>
              </span>
              <div class="cross-session-flow-info">
                <span class="cross-session-flow-route">
                  {msg.senderContext.conversationTitle || msg.senderContext.workspaceName}
                  <span class="cross-session-flow-arrow">&rarr;</span>
                  <span class="cross-session-flow-target"
                    >{msg.toConversationId.slice(0, 8)}...</span
                  >
                </span>
                <span class="cross-session-flow-preview"
                  >{msg.content.slice(0, 80)}{msg.content.length > 80 ? '...' : ''}</span
                >
                <span class="cross-session-flow-time">{formatTime(msg.timestamp)}</span>
              </div>
              {#if msg.delivered}
                <span class="cross-session-flow-delivered" title="Delivered">
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--accent-success, #10b981)"
                    stroke-width="2.5"
                  >
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </span>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Completed Work (last 24h) -->
    {#if data.completedStories.length > 0}
      <div class="section">
        <div class="section-header">
          <span class="section-title">
            Completed Today
            <span class="badge success"
              >{data.completedStories.filter((s) => s.status === 'completed').length}</span
            >
          </span>
        </div>
        <div class="item-list">
          {#each data.completedStories as story (story.id)}
            <div class="story-row" class:failed={story.status === 'failed'}>
              <span class="story-check">
                {#if story.status === 'completed'}
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--accent-success, #10b981)"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"><path d="M20 6L9 17l-5-5" /></svg
                  >
                {:else}
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--accent-error)"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    ><line x1="18" y1="6" x2="6" y2="18" /><line
                      x1="6"
                      y1="6"
                      x2="18"
                      y2="18"
                    /></svg
                  >
                {/if}
              </span>
              <div class="story-info">
                <span class="story-title-sm">{story.title}</span>
                <span class="story-meta">
                  {workspaceName(story.workspace_path)}
                  {#if story.prd_name}· {story.prd_name}{/if}
                  · {formatTime(story.updated_at)}
                </span>
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    {#if data.pendingApprovals.length === 0 && data.inProgressStories.length === 0 && data.completedStories.length === 0}
      <div class="empty-state">
        <div class="empty-icon">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle
              cx="12"
              cy="12"
              r="2"
            /></svg
          >
        </div>
        <div class="empty-text">All quiet. No active agents or pending approvals.</div>
      </div>
    {/if}
  {:else if loading}
    <div class="loading">Loading...</div>
  {/if}
</div>

<style>
  .manager-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px;
    height: 100%;
    overflow-y: auto;
  }
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: flex-end;
  }
  .header-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .last-refresh {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
  }
  .btn-refresh {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: var(--radius-sm);
    color: var(--text-tertiary);
    transition: all var(--transition);
  }
  .btn-refresh:hover:not(:disabled) {
    color: var(--accent-primary);
    background: var(--bg-hover);
  }
  .btn-refresh:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .spinning {
    animation: spin 0.8s linear infinite;
  }
  .error-msg {
    font-size: var(--fs-sm);
    color: var(--accent-error);
    background: var(--bg-secondary);
    border-radius: var(--radius-sm);
    padding: 8px 10px;
  }
  .stats-row {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 6px;
  }
  .stat-chip {
    background: var(--bg-secondary);
    border-radius: var(--radius-sm);
    padding: 8px 6px;
    text-align: center;
    border: 1px solid transparent;
    transition: border-color var(--transition);
  }
  .stat-chip.active {
    border-color: var(--accent-primary);
  }
  .stat-chip.warn {
    border-color: var(--accent-warning, #f59e0b);
  }
  .stat-num {
    display: block;
    font-size: var(--fs-lg);
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1.2;
  }
  .stat-lbl {
    display: block;
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-top: 2px;
  }
  .section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .section-title {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  @keyframes pulse-dot {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.4;
    }
  }
  .spin-dot {
    animation: pulse-dot 1.5s ease-in-out infinite;
  }
  .badge {
    font-size: var(--fs-xxs);
    font-weight: 700;
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    padding: 1px 5px;
    border-radius: 999px;
    min-width: 16px;
    text-align: center;
  }
  .badge.warn {
    background: color-mix(in srgb, var(--accent-warning, #f59e0b) 20%, transparent);
    color: var(--accent-warning, #f59e0b);
  }
  .badge.success {
    background: color-mix(in srgb, var(--accent-success, #10b981) 20%, transparent);
    color: var(--accent-success, #10b981);
  }
  .badge.sm {
    font-size: var(--fs-xxs);
    padding: 1px 4px;
  }
  .badge.cross-session-badge {
    background: color-mix(in srgb, var(--accent-primary) 15%, transparent);
    color: var(--accent-primary);
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .badge.cross-session-flow-badge {
    background: color-mix(in srgb, var(--accent-primary) 15%, transparent);
    color: var(--accent-primary);
  }
  .cross-session-flow-list {
    max-height: 200px;
    overflow-y: auto;
  }
  .cross-session-flow-item {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 5px 8px;
    background: var(--bg-secondary);
    border-radius: var(--radius-sm);
    font-size: var(--fs-xs);
  }
  .cross-session-flow-icon {
    color: var(--accent-primary);
    flex-shrink: 0;
    margin-top: 1px;
    display: flex;
    align-items: center;
  }
  .cross-session-flow-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .cross-session-flow-route {
    font-weight: 500;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cross-session-flow-arrow {
    color: var(--text-tertiary);
    margin: 0 2px;
  }
  .cross-session-flow-target {
    color: var(--text-secondary);
  }
  .cross-session-flow-preview {
    color: var(--text-tertiary);
    font-size: var(--fs-xxs);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cross-session-flow-time {
    color: var(--text-tertiary);
    font-size: var(--fs-xxs);
  }
  .cross-session-flow-delivered {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    margin-top: 2px;
  }
  .item-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .inbox-item {
    background: var(--bg-secondary);
    border-radius: var(--radius-sm);
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    border: 1px solid transparent;
    transition: all var(--transition);
    text-align: left;
    width: 100%;
  }
  .inbox-item.clickable {
    cursor: pointer;
  }
  .inbox-item.clickable:hover {
    border-color: var(--accent-primary);
    background: var(--bg-hover);
  }
  .inbox-item-top {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-wrap: wrap;
  }
  .tool-badge {
    font-size: var(--fs-xxs);
    font-weight: 600;
    font-family: var(--font-family-mono, monospace);
    background: var(--bg-tertiary);
    color: var(--accent-primary);
    padding: 1px 5px;
    border-radius: 3px;
  }
  .ws-chip {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    background: var(--bg-tertiary);
    padding: 1px 5px;
    border-radius: 3px;
  }
  /* Golem question cards */
  .golem-question-card {
    border-left: 2px solid var(--accent-error, #ef4444);
  }
  .golem-q-text {
    font-size: var(--fs-xs);
    color: var(--text-primary);
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
    margin: 4px 0 2px;
  }
  .golem-q-context {
    font-size: var(--fs-xxs);
    color: var(--text-secondary);
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
    padding: 4px 6px;
    background: var(--bg-tertiary);
    border-radius: 3px;
    margin-bottom: 6px;
  }
  .golem-q-row {
    display: flex;
    gap: 4px;
    margin-top: 6px;
  }
  .golem-q-input {
    flex: 1;
    font-size: var(--fs-xs);
    padding: 4px 7px;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    background: var(--bg-primary);
    color: var(--text-primary);
    outline: none;
    min-width: 0;
  }
  .golem-q-input:focus {
    border-color: var(--accent-primary);
  }
  .golem-q-send {
    font-size: var(--fs-xs);
    padding: 4px 10px;
    border: none;
    border-radius: 4px;
    background: var(--accent-primary);
    color: white;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .golem-q-send:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .golem-q-send:not(:disabled):hover {
    filter: brightness(1.15);
  }
  /* Pulsing dot for attention */
  .pulse-dot {
    animation: dot-pulse 1.5s ease-in-out infinite;
  }
  @keyframes dot-pulse {
    0%,
    100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.5;
      transform: scale(0.7);
    }
  }

  .inbox-item-desc {
    font-size: var(--fs-xs);
    color: var(--text-primary);
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .inbox-item-sub {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .executor-chip {
    font-size: var(--fs-xxs);
    color: var(--accent-primary);
    opacity: 0.85;
  }
  .story-title {
    font-size: var(--fs-sm);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }
  .workspace-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .workspace-card {
    background: var(--bg-secondary);
    border-radius: var(--radius-sm);
    border: 1px solid transparent;
    transition: all var(--transition);
    overflow: hidden;
  }
  .workspace-card.muted {
    opacity: 0.6;
    border-color: var(--border-secondary);
  }
  .workspace-card.expanded {
    border-color: color-mix(in srgb, var(--accent-primary) 30%, transparent);
  }
  .workspace-card-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
  }
  .ws-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
    transition: box-shadow var(--transition);
  }
  .ws-dot-pulse {
    box-shadow: 0 0 0 0 var(--accent-primary);
    animation: ws-dot-ring 2s ease-in-out infinite;
  }
  @keyframes ws-dot-ring {
    0% {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent-primary) 40%, transparent);
    }
    70% {
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent-primary) 0%, transparent);
    }
    100% {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent-primary) 0%, transparent);
    }
  }
  .ws-info {
    flex: 1;
    min-width: 0;
  }
  .ws-name {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .commentary-live-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent-primary);
    flex-shrink: 0;
    animation: commentary-pulse 2s ease-in-out infinite;
  }
  @keyframes commentary-pulse {
    0%,
    100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.3;
      transform: scale(0.8);
    }
  }
  .ws-meta {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
  }
  .ws-status {
    color: var(--text-tertiary);
  }
  .ws-commentary-controls {
    display: flex;
    align-items: center;
    gap: 3px;
    margin-left: auto;
    flex-shrink: 0;
  }
  .ws-personality-dropdown {
    position: relative;
  }
  .ws-verbosity-dropdown {
    position: relative;
  }
  .ws-control-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: var(--radius-sm);
    background: transparent;
    border: 1px solid var(--border-secondary);
    cursor: pointer;
    color: var(--text-tertiary);
    transition: all var(--transition);
    padding: 0;
  }
  .ws-control-btn:hover {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 8%, transparent);
  }
  .ws-control-btn.active {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
  }
  .ws-control-btn.muted {
    color: var(--accent-error);
    border-color: var(--border-secondary);
  }
  .ws-control-btn.muted:hover {
    color: var(--accent-error);
    border-color: var(--accent-error);
    background: color-mix(in srgb, var(--accent-error) 8%, transparent);
  }
  .ws-verbosity-btn {
    width: auto;
    min-width: 22px;
    padding: 0 4px;
  }
  .verbosity-label-text {
    font-size: var(--fs-xxs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    line-height: 1;
  }
  .personality-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    min-width: 140px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-md);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: 100;
    overflow: hidden;
  }
  .personality-option {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 10px;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--border-secondary);
    cursor: pointer;
    transition: background var(--transition);
    text-align: left;
  }
  .personality-option:last-child {
    border-bottom: none;
  }
  .personality-option:hover {
    background: var(--bg-hover);
  }
  .personality-option.active {
    background: color-mix(in srgb, var(--accent-primary) 8%, transparent);
  }
  .personality-option svg {
    flex-shrink: 0;
    color: var(--text-tertiary);
  }
  .personality-option.active svg {
    color: var(--accent-primary);
  }
  .personality-label {
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-primary);
    flex: 1;
  }
  .check-icon {
    flex-shrink: 0;
    color: var(--accent-primary);
  }
  .verbosity-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    min-width: 180px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-md);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: 100;
    overflow: hidden;
  }
  .verbosity-option {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 10px;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--border-secondary);
    cursor: pointer;
    transition: background var(--transition);
    text-align: left;
  }
  .verbosity-option:last-child {
    border-bottom: none;
  }
  .verbosity-option:hover {
    background: var(--bg-hover);
  }
  .verbosity-option.active {
    background: color-mix(in srgb, var(--accent-primary) 8%, transparent);
  }
  .verbosity-option-label {
    font-size: var(--fs-xs);
    font-weight: 700;
    color: var(--text-primary);
    min-width: 28px;
  }
  .verbosity-option.active .verbosity-option-label {
    color: var(--accent-primary);
  }
  .verbosity-option-desc {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    flex: 1;
  }
  .ws-cross-session-dropdown {
    position: relative;
  }
  .ws-dropdown-menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    min-width: 170px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-md);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: 100;
    overflow: hidden;
  }
  .ws-dropdown-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 10px;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--border-secondary);
    cursor: pointer;
    transition: background var(--transition);
    text-align: left;
    font-size: var(--fs-xs);
    color: var(--text-primary);
  }
  .ws-dropdown-item:last-child {
    border-bottom: none;
  }
  .ws-dropdown-item:hover {
    background: var(--bg-hover);
  }
  .ws-dropdown-item.selected {
    background: color-mix(in srgb, var(--accent-primary) 8%, transparent);
    color: var(--accent-primary);
  }
  .ws-dropdown-icon {
    flex-shrink: 0;
    width: 16px;
    text-align: center;
    color: var(--text-tertiary);
  }
  .ws-dropdown-item.selected .ws-dropdown-icon {
    color: var(--accent-primary);
  }
  .ws-commentary-feed {
    border-top: 1px solid var(--border-secondary);
    padding: 4px 8px 6px;
    cursor: pointer;
    transition: all var(--transition);
    background: color-mix(in srgb, var(--accent-primary) 3%, transparent);
  }
  .ws-commentary-feed:hover {
    background: color-mix(in srgb, var(--accent-primary) 6%, transparent);
  }
  .ws-commentary-feed.expanded {
    background: color-mix(in srgb, var(--accent-primary) 5%, transparent);
  }
  .ws-commentary-feed.waiting {
    cursor: default;
  }
  .commentary-feed-header {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 2px;
  }
  .commentary-mic-icon {
    flex-shrink: 0;
    color: var(--accent-primary);
    opacity: 0.7;
  }
  .commentary-feed-label {
    font-size: var(--fs-xxs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--accent-primary);
    opacity: 0.7;
    flex: 1;
  }
  .waiting-text {
    font-style: italic;
    font-weight: 600;
    opacity: 0.5;
    animation: pulse-dot 2s ease-in-out infinite;
  }
  .commentary-chevron {
    flex-shrink: 0;
    color: var(--text-tertiary);
    transition: transform var(--transition);
  }
  .commentary-chevron.rotated {
    transform: rotate(180deg);
  }
  .commentary-entries {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .commentary-entry {
    display: flex;
    gap: 6px;
    align-items: flex-start;
  }
  .commentary-time {
    flex-shrink: 0;
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    opacity: 0.7;
    font-family: var(--font-family-mono, monospace);
    line-height: 1.5;
    min-width: 40px;
  }
  .commentary-text {
    font-size: var(--fs-xxs);
    color: var(--text-secondary);
    line-height: 1.5;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .ws-commentary-feed.expanded .commentary-text {
    -webkit-line-clamp: unset;
    overflow: visible;
  }
  .story-row {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 6px 8px;
    background: var(--bg-secondary);
    border-radius: var(--radius-sm);
  }
  .story-row.failed {
    opacity: 0.6;
  }
  .story-check {
    flex-shrink: 0;
    margin-top: 1px;
    display: flex;
    align-items: center;
  }
  .story-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .story-title-sm {
    font-size: var(--fs-xs);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .story-meta {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 32px 16px;
    color: var(--text-tertiary);
  }
  .empty-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-tertiary);
  }
  .empty-text {
    font-size: var(--fs-sm);
    text-align: center;
    line-height: 1.5;
  }
  .empty {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    padding: 8px;
    text-align: center;
  }
  .loading {
    font-size: var(--fs-sm);
    color: var(--text-tertiary);
    padding: 20px;
    text-align: center;
  }

  /* Audio Controls Bar */
  .audio-controls-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    background: var(--bg-secondary);
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-secondary);
  }
  .audio-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    border-radius: var(--radius-sm);
    background: transparent;
    border: 1px solid var(--border-secondary);
    cursor: pointer;
    color: var(--text-tertiary);
    transition: all var(--transition);
    font-size: var(--fs-xxs);
    white-space: nowrap;
  }
  .audio-btn:hover {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 6%, transparent);
  }
  .audio-btn.active {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
  }
  .audio-btn-label {
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .spatial-btn {
    position: relative;
  }
  .exp-badge {
    font-size: var(--fs-xxs);
    font-weight: 700;
    letter-spacing: 0.06em;
    color: var(--accent-warning, #f59e0b);
    background: color-mix(in srgb, var(--accent-warning, #f59e0b) 15%, transparent);
    padding: 0 3px;
    border-radius: 2px;
    line-height: 1.4;
  }
  .audio-volume {
    display: flex;
    align-items: center;
  }
  .volume-slider-sm {
    width: 50px;
    height: 3px;
    -webkit-appearance: none;
    appearance: none;
    background: var(--border-secondary);
    border-radius: 2px;
    outline: none;
    cursor: pointer;
  }
  .volume-slider-sm::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--accent-primary);
    cursor: pointer;
  }
  .volume-slider-sm::-moz-range-thumb {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--accent-primary);
    border: none;
    cursor: pointer;
  }
  .spatial-pos-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: var(--fs-xxs);
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent-primary) 25%, transparent);
    padding: 0 3px;
    border-radius: 3px;
    line-height: 1.5;
    min-width: 14px;
    text-align: center;
    flex-shrink: 0;
  }

  /* Scheduled Tasks */
  .section-title-btn {
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    width: 100%;
    text-align: left;
  }

  .expand-icon {
    transition: transform 0.2s ease;
    margin-right: 4px;
  }

  .expand-icon.expanded {
    transform: rotate(90deg);
  }

  .task-next-badge {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 3px;
    background: var(--accent-info, #3b82f6);
    color: white;
    font-weight: 500;
    margin-left: auto;
  }

  .empty-msg {
    padding: 16px;
    text-align: center;
    color: var(--text-tertiary);
    font-size: 12px;
  }

  /* Mobile-responsive styles for remote access */
  @media (max-width: 768px) {
    .manager-panel {
      font-size: 14px;
    }

    .workspace-card {
      padding: 12px;
    }

    .workspace-header {
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
    }

    .workspace-actions {
      width: 100%;
      justify-content: flex-start;
      gap: 6px;
    }

    .stat-grid {
      grid-template-columns: repeat(2, 1fr);
      gap: 8px;
    }

    .approval-card {
      padding: 10px;
    }

    .commentary-controls {
      flex-direction: column;
      gap: 8px;
    }

    .personality-select,
    .verbosity-select {
      width: 100%;
    }

    .story-row {
      padding: 10px;
    }

    .cross-section {
      padding: 10px;
    }

    .cross-msg-card {
      padding: 10px;
    }
  }

  @media (max-width: 480px) {
    .workspace-card {
      padding: 10px;
    }

    .stat-grid {
      grid-template-columns: 1fr;
    }

    .workspace-name {
      font-size: 15px;
    }

    .stat-value {
      font-size: 20px;
    }
  }
</style>
