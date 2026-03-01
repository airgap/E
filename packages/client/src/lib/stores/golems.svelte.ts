import type {
  GolemPhase,
  GolemMood,
  StreamLoopEvent,
  IterationLogEntry,
  QualityCheckType,
} from '@e/shared';

/** Parameters for syncing golem state from a loop snapshot (page load / reconnect). */
export interface GolemSyncState {
  loopId: string;
  label: string;
  status: string;
  totalStories: number;
  storiesCompleted: number;
  storiesFailed: number;
  currentIteration: number;
  currentStoryId: string | null;
  currentStoryTitle: string | null;
  startedAt: number;
  iterationLog: IterationLogEntry[];
  activeStoryIds?: string[];
}

/** A single activity entry in a golem's recent timeline */
export interface GolemActivity {
  id: string;
  timestamp: number;
  event: string;
  detail: string;
  storyTitle?: string;
  type: 'info' | 'success' | 'error' | 'warning' | 'thought';
}

/** Result of a single quality check for the current story */
export interface GolemQualityCheck {
  checkName: string;
  checkType: QualityCheckType;
  passed: boolean;
  duration: number;
}

/** Outcome of a completed story */
export interface GolemStoryOutcome {
  storyId: string;
  storyTitle: string;
  result: 'success' | 'failed' | 'retrying';
  timestamp: number;
}

/** Full status of a single golem (mapped 1:1 from a loop) */
export interface GolemStatus {
  id: string; // loop ID
  label: string; // PRD name or "Standalone Stories"
  status:
    | 'running'
    | 'paused'
    | 'completed'
    | 'completed_with_failures'
    | 'failed'
    | 'cancelled'
    | 'idle';
  phase: GolemPhase;
  mood: GolemMood;
  thought: string;
  thoughtTimestamp: number;

  // Story progress
  currentStoryId: string | null;
  currentStoryTitle: string | null;
  currentIteration: number;
  totalIterations: number;
  storiesCompleted: number;
  storiesFailed: number;
  totalStories: number;

  // Attempt tracking
  currentAttempt: number;
  maxAttempts: number;
  fixUpAttempt: number;
  maxFixUpAttempts: number;

  // Timing
  startedAt: number;
  elapsedMs: number;

  // Quality checks for the current story
  qualityChecks: GolemQualityCheck[];

  // Recent story outcomes (most recent first, max 20)
  storyOutcomes: GolemStoryOutcome[];

  // Recent activity feed
  activities: GolemActivity[];

  // Active task conversations for parallel streaming view (storyId → conversationId + title)
  taskConversations: Array<{ storyId: string; storyTitle: string; conversationId: string }>;
  // Max parallel story count (from loop config)
  maxParallel: number;
  // Story IDs currently being executed in parallel (empty in serial mode)
  activeStoryIds: string[];
}

const MAX_ACTIVITIES = 50;
const MAX_STORY_OUTCOMES = 20;
let activityIdCounter = 0;

function createGolemsStore() {
  let golems = $state<GolemStatus[]>([]);
  let elapsedInterval = $state<ReturnType<typeof setInterval> | null>(null);

  function ensureElapsedTimer() {
    if (elapsedInterval) return;
    elapsedInterval = setInterval(() => {
      const now = Date.now();
      for (const g of golems) {
        if (g.status === 'running') {
          g.elapsedMs = now - g.startedAt;
        }
      }
    }, 1000);
  }

  function stopElapsedTimer() {
    if (elapsedInterval) {
      clearInterval(elapsedInterval);
      elapsedInterval = null;
    }
  }

  function getOrCreateGolem(loopId: string): GolemStatus {
    let g = golems.find((g) => g.id === loopId);
    if (!g) {
      g = {
        id: loopId,
        label: 'Golem',
        status: 'idle',
        phase: 'idle',
        mood: 'neutral',
        thought: 'Initializing...',
        thoughtTimestamp: Date.now(),
        currentStoryId: null,
        currentStoryTitle: null,
        currentIteration: 0,
        totalIterations: 0,
        storiesCompleted: 0,
        storiesFailed: 0,
        totalStories: 0,
        currentAttempt: 0,
        maxAttempts: 0,
        fixUpAttempt: 0,
        maxFixUpAttempts: 0,
        startedAt: Date.now(),
        elapsedMs: 0,
        qualityChecks: [],
        storyOutcomes: [],
        activities: [],
        taskConversations: [],
        maxParallel: 1,
        activeStoryIds: [],
      };
      golems = [...golems, g];
    }
    return g;
  }

  function addActivity(
    golem: GolemStatus,
    event: string,
    detail: string,
    type: GolemActivity['type'] = 'info',
    storyTitle?: string,
  ) {
    const activity: GolemActivity = {
      id: `ga-${++activityIdCounter}`,
      timestamp: Date.now(),
      event,
      detail,
      storyTitle,
      type,
    };
    golem.activities = [activity, ...golem.activities].slice(0, MAX_ACTIVITIES);
  }

  return {
    get golems() {
      return golems;
    },
    get activeGolems() {
      return golems.filter((g) => g.status === 'running' || g.status === 'paused');
    },
    get hasActiveGolems() {
      return golems.some((g) => g.status === 'running' || g.status === 'paused');
    },

    /** Initialize or update a golem when a loop starts */
    initGolem(loopId: string, label: string, totalStories: number, startedAt: number) {
      const g = getOrCreateGolem(loopId);
      g.label = label;
      g.status = 'running';
      g.phase = 'idle';
      g.mood = 'focused';
      g.thought = 'Waking up...';
      g.thoughtTimestamp = Date.now();
      g.totalStories = totalStories;
      g.startedAt = startedAt;
      g.elapsedMs = Date.now() - startedAt;
      g.storiesCompleted = 0;
      g.storiesFailed = 0;
      g.qualityChecks = [];
      g.storyOutcomes = [];
      g.activities = [];
      g.taskConversations = [];
      g.activeStoryIds = [];
      addActivity(g, 'started', `Golem activated: ${label}`, 'info');
      ensureElapsedTimer();
      // Force reactivity
      golems = [...golems];
    },

    /** Handle a loop SSE event and update golem state */
    handleEvent(event: StreamLoopEvent) {
      const g = getOrCreateGolem(event.loopId);

      switch (event.event) {
        case 'started':
          g.status = 'running';
          g.phase = 'idle';
          g.mood = 'focused';
          g.thought = 'Golem activated!';
          g.thoughtTimestamp = Date.now();
          addActivity(g, 'started', event.data.message || 'Loop started', 'info');
          ensureElapsedTimer();
          break;

        case 'golem_thought':
          g.thought = event.data.thought || g.thought;
          g.thoughtTimestamp = Date.now();
          if (event.data.phase) g.phase = event.data.phase;
          if (event.data.mood) g.mood = event.data.mood;
          if (event.data.storyId) g.currentStoryId = event.data.storyId;
          if (event.data.storyTitle) g.currentStoryTitle = event.data.storyTitle;
          if (event.data.attempt) g.currentAttempt = event.data.attempt;
          if (event.data.maxAttempts) g.maxAttempts = event.data.maxAttempts;
          if (event.data.fixUpAttempt !== undefined) g.fixUpAttempt = event.data.fixUpAttempt;
          if (event.data.maxFixUpAttempts !== undefined)
            g.maxFixUpAttempts = event.data.maxFixUpAttempts;
          // Don't add thoughts to activity feed — they're too noisy
          break;

        case 'iteration_start':
          g.currentIteration = event.data.iteration ?? g.currentIteration;
          if (event.data.storyId) g.currentStoryId = event.data.storyId;
          if (event.data.storyTitle) g.currentStoryTitle = event.data.storyTitle;
          addActivity(
            g,
            'iteration',
            `Iteration ${event.data.iteration}: ${event.data.storyTitle || 'selecting...'}`,
            'info',
            event.data.storyTitle,
          );
          break;

        case 'story_started':
          g.currentStoryId = event.data.storyId ?? null;
          g.currentStoryTitle = event.data.storyTitle ?? null;
          g.phase = 'implementing';
          g.qualityChecks = []; // Reset quality checks for new story
          // Track active story IDs for parallel mode
          if (event.data.storyId && !g.activeStoryIds.includes(event.data.storyId)) {
            g.activeStoryIds = [...g.activeStoryIds, event.data.storyId];
          }
          // Track per-task conversation for parallel streaming view
          if (event.data.storyId && event.data.conversationId) {
            // Remove any stale entry for this story (e.g. retry), then add
            g.taskConversations = [
              ...g.taskConversations.filter((tc) => tc.storyId !== event.data.storyId),
              {
                storyId: event.data.storyId!,
                storyTitle: event.data.storyTitle ?? '',
                conversationId: event.data.conversationId!,
              },
            ];
          }
          if (event.data.maxParallel) g.maxParallel = event.data.maxParallel;
          addActivity(
            g,
            'story_started',
            `Working on: ${event.data.storyTitle}`,
            'info',
            event.data.storyTitle,
          );
          break;

        case 'story_completed':
          g.storiesCompleted++;
          g.phase = 'celebrating';
          g.mood = 'proud';
          g.thought = `Completed "${event.data.storyTitle}"!`;
          // Remove from active story IDs and task conversations
          if (event.data.storyId) {
            g.activeStoryIds = g.activeStoryIds.filter((id) => id !== event.data.storyId);
            g.taskConversations = g.taskConversations.filter(
              (tc) => tc.storyId !== event.data.storyId,
            );
          }
          g.thoughtTimestamp = Date.now();
          g.storyOutcomes = [
            {
              storyId: event.data.storyId || '',
              storyTitle: event.data.storyTitle || '',
              result: 'success' as const,
              timestamp: Date.now(),
            },
            ...g.storyOutcomes,
          ].slice(0, MAX_STORY_OUTCOMES);
          addActivity(
            g,
            'story_completed',
            `Completed: ${event.data.storyTitle}`,
            'success',
            event.data.storyTitle,
          );
          break;

        case 'story_failed':
          if (!event.data.willRetry) g.storiesFailed++;
          g.phase = 'idle';
          g.mood = event.data.willRetry ? 'determined' : 'frustrated';
          // Remove from active story IDs and task conversations
          if (event.data.storyId) {
            g.activeStoryIds = g.activeStoryIds.filter((id) => id !== event.data.storyId);
            g.taskConversations = g.taskConversations.filter(
              (tc) => tc.storyId !== event.data.storyId,
            );
          }
          g.thought = event.data.willRetry
            ? `"${event.data.storyTitle}" stumbled — will try again`
            : `"${event.data.storyTitle}" failed after all attempts`;
          g.thoughtTimestamp = Date.now();
          g.storyOutcomes = [
            {
              storyId: event.data.storyId || '',
              storyTitle: event.data.storyTitle || '',
              result: (event.data.willRetry ? 'retrying' : 'failed') as GolemStoryOutcome['result'],
              timestamp: Date.now(),
            },
            ...g.storyOutcomes,
          ].slice(0, MAX_STORY_OUTCOMES);
          addActivity(
            g,
            'story_failed',
            `${event.data.willRetry ? 'Retry' : 'Failed'}: ${event.data.storyTitle}${event.data.message ? ` — ${event.data.message.slice(0, 100)}` : ''}`,
            event.data.willRetry ? 'warning' : 'error',
            event.data.storyTitle,
          );
          break;

        case 'quality_check':
          if (event.data.qualityResult) {
            const qr = event.data.qualityResult;
            // Track quality check result for the visual indicators
            const existingIdx = g.qualityChecks.findIndex((c) => c.checkName === qr.checkName);
            const checkEntry: GolemQualityCheck = {
              checkName: qr.checkName,
              checkType: qr.checkType,
              passed: qr.passed,
              duration: qr.duration,
            };
            if (existingIdx >= 0) {
              g.qualityChecks[existingIdx] = checkEntry;
            } else {
              g.qualityChecks = [...g.qualityChecks, checkEntry];
            }
            addActivity(
              g,
              'quality_check',
              `${qr.checkName}: ${qr.passed ? 'PASSED' : 'FAILED'}`,
              qr.passed ? 'success' : 'warning',
              event.data.storyTitle,
            );
          }
          break;

        case 'paused':
          g.status = 'paused';
          g.phase = 'idle';
          g.thought = 'Paused... waiting for instructions';
          g.thoughtTimestamp = Date.now();
          addActivity(g, 'paused', event.data.message || 'Golem paused', 'warning');
          break;

        case 'resumed':
          g.status = 'running';
          g.mood = 'determined';
          g.thought = 'Resuming work...';
          g.thoughtTimestamp = Date.now();
          addActivity(g, 'resumed', 'Golem resumed', 'info');
          ensureElapsedTimer();
          break;

        case 'completed': {
          // Check if the message indicates partial success (completed_with_failures)
          const isPartialSuccess =
            event.data.message?.includes('Partial success') ||
            event.data.message?.includes('partial success');
          if (isPartialSuccess) {
            g.status = 'completed_with_failures';
            g.phase = 'idle';
            g.mood = 'relieved';
            g.thought = event.data.message || 'Finished with some failures.';
          } else {
            g.status = 'completed';
            g.phase = 'celebrating';
            g.mood = 'excited';
            g.thought = 'All done! Every story is complete.';
          }
          g.activeStoryIds = [];
          g.thoughtTimestamp = Date.now();
          addActivity(
            g,
            'completed',
            event.data.message || 'All stories completed!',
            isPartialSuccess ? 'warning' : 'success',
          );
          break;
        }

        case 'failed':
          g.status = 'failed';
          g.phase = 'idle';
          g.mood = 'frustrated';
          g.thought = event.data.message || 'Something went wrong...';
          g.activeStoryIds = [];
          g.thoughtTimestamp = Date.now();
          addActivity(g, 'failed', event.data.message || 'Loop failed', 'error');
          break;

        case 'cancelled':
          g.status = 'cancelled';
          g.phase = 'idle';
          g.mood = 'neutral';
          g.thought = 'Cancelled. Standing down.';
          g.activeStoryIds = [];
          g.thoughtTimestamp = Date.now();
          addActivity(g, 'cancelled', 'Golem cancelled by user', 'warning');
          break;

        case 'learning':
          addActivity(
            g,
            'learning',
            `Learned: ${(event.data.learning || '').slice(0, 100)}`,
            'info',
            event.data.storyTitle,
          );
          break;
      }

      // Force reactivity
      golems = [...golems];

      // Stop timer if no active golems
      if (!golems.some((g) => g.status === 'running')) {
        stopElapsedTimer();
      }
    },

    /** Sync golem from existing loop state (e.g., on page load / reconnect) */
    syncFromLoopState(state: GolemSyncState) {
      const {
        loopId,
        label,
        status,
        totalStories,
        storiesCompleted,
        storiesFailed,
        currentIteration,
        currentStoryId,
        currentStoryTitle,
        startedAt,
        activeStoryIds = [],
      } = state;

      const g = getOrCreateGolem(loopId);
      g.label = label;
      g.status = status as GolemStatus['status'];
      g.totalStories = totalStories;
      g.storiesCompleted = storiesCompleted;
      g.storiesFailed = storiesFailed;
      g.currentIteration = currentIteration;
      g.currentStoryId = currentStoryId;
      g.currentStoryTitle = currentStoryTitle;
      g.activeStoryIds = activeStoryIds;
      g.startedAt = startedAt;
      g.elapsedMs = Date.now() - startedAt;

      // Determine if any stories are actively running (serial or parallel)
      const hasActiveStories = !!currentStoryId || activeStoryIds.length > 0;

      // Set mood/phase based on status
      if (status === 'running') {
        g.mood = storiesFailed > storiesCompleted ? 'determined' : 'focused';
        if (hasActiveStories) {
          g.phase = 'implementing';
          if (activeStoryIds.length > 1) {
            g.thought = `Working on ${activeStoryIds.length} stories in parallel...`;
          } else {
            g.thought = currentStoryTitle
              ? `Working on "${currentStoryTitle}"...`
              : 'Working on a story...';
          }
        } else {
          // No current story — check if we already know the backlog is empty
          // (the golem_thought event may have set backlog_empty before sync)
          if (g.phase !== 'backlog_empty') {
            g.phase = 'selecting_story';
            g.thought = 'Scanning backlog...';
          }
          // else keep existing backlog_empty phase/thought
        }
      } else if (status === 'paused') {
        g.mood = 'neutral';
        g.phase = 'idle';
        g.thought = 'Paused... waiting for instructions';
      } else if (status === 'completed') {
        g.mood = 'excited';
        g.phase = 'celebrating';
        g.thought = 'All done!';
      } else if (status === 'completed_with_failures') {
        g.mood = 'relieved';
        g.phase = 'idle';
        g.thought = 'Finished, but some stories had issues';
      } else if (status === 'failed') {
        g.mood = 'frustrated';
        g.phase = 'idle';
        g.thought = 'Loop ended with failures';
      }
      g.thoughtTimestamp = Date.now();

      // Build activities from iteration log (most recent first)
      const recentLog = iterationLog.slice(-MAX_ACTIVITIES).reverse();
      g.activities = recentLog.map((entry, i) => ({
        id: `sync-${loopId}-${i}`,
        timestamp: entry.timestamp,
        event: entry.action,
        detail: entry.detail,
        storyTitle: entry.storyTitle,
        type:
          entry.action === 'passed' || entry.action === 'committed'
            ? ('success' as const)
            : entry.action === 'failed'
              ? ('error' as const)
              : ('info' as const),
      }));

      // Build story outcomes from iteration log
      const outcomeEntries = iterationLog.filter(
        (e) => e.action === 'passed' || e.action === 'failed',
      );
      g.storyOutcomes = outcomeEntries
        .slice(-MAX_STORY_OUTCOMES)
        .reverse()
        .map(
          (entry): GolemStoryOutcome => ({
            storyId: '',
            storyTitle: entry.storyTitle || entry.detail,
            result: entry.action === 'passed' ? 'success' : 'failed',
            timestamp: entry.timestamp,
          }),
        );

      // Build quality checks from the most recent story's quality_check entries
      const qualityEntries = iterationLog.filter(
        (e) => e.action === 'quality_check' && e.qualityResults?.length,
      );
      if (qualityEntries.length > 0) {
        // Get the latest story's checks
        const latestStory = qualityEntries[qualityEntries.length - 1].storyTitle;
        const latestChecks = qualityEntries
          .filter((e) => e.storyTitle === latestStory)
          .flatMap((e) => e.qualityResults || []);
        g.qualityChecks = latestChecks.map((qr) => ({
          checkName: qr.checkName,
          checkType: qr.checkType,
          passed: qr.passed,
          duration: qr.duration,
        }));
      } else {
        g.qualityChecks = [];
      }

      if (status === 'running') {
        ensureElapsedTimer();
      }

      // Force reactivity
      golems = [...golems];
    },

    /** Remove a golem (e.g., when dismissed) */
    removeGolem(loopId: string) {
      golems = golems.filter((g) => g.id !== loopId);
      if (!golems.some((g) => g.status === 'running')) {
        stopElapsedTimer();
      }
    },

    /** Clear all non-active golems */
    clearInactive() {
      golems = golems.filter((g) => g.status === 'running' || g.status === 'paused');
    },

    /** @internal Restore golem state from HMR data */
    _hmrRestore(saved: GolemStatus[]) {
      golems = saved;
      if (saved.some((g) => g.status === 'running')) {
        ensureElapsedTimer();
      }
    },

    /** @internal Clean up timers for HMR disposal */
    _hmrCleanup() {
      stopElapsedTimer();
    },
  };
}

export const golemsStore = createGolemsStore();

// HMR state preservation — keep golems visible across hot module reloads
if (import.meta.hot) {
  const savedGolems = import.meta.hot.data?.golems as GolemStatus[] | undefined;
  if (savedGolems?.length) {
    golemsStore._hmrRestore(savedGolems);
  }

  import.meta.hot.dispose((data: Record<string, unknown>) => {
    try {
      data.golems = JSON.parse(JSON.stringify(golemsStore.golems));
    } catch {
      // Serialization failed — golems will be recovered from server
    }
    golemsStore._hmrCleanup();
  });
}
