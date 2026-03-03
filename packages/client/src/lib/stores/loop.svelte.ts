import { golemsStore } from './golems.svelte';
import type {
  PRD,
  LoopState,
  IterationLogEntry,
  StreamLoopEvent,
  LoopConfig,
  PlanMode,
  EditMode,
  GeneratedStory,
  RefinementQuestion,
  RefineStoryResponse,
  DependencyGraph,
  SprintValidation,
  SprintValidationWarning,
  ValidateACResponse,
  ACOverride,
  StoryEstimate,
  EstimatePrdResponse,
  SprintPlanResponse,
  PRDCompletenessAnalysis,
  StoryTemplate,
  StoryTemplateCategory,
  PriorityRecommendation,
  PriorityRecommendationBulkResponse,
  EffortValueMatrix,
  MatrixStoryPosition,
  MatrixQuadrant,
  UserStory,
  RefineAllResponse,
  StoryRecommendation,
  SuggestedNewStory,
} from '@e/shared';
import { api, getBaseUrl, getAuthToken } from '../api/client';
import { conversationStore } from './conversation.svelte';

// --- Helper functions for effort-value matrix computation ---

/** Compute effort score (0-100) from story estimate. Higher = more effort. */
function computeEffortScore(story: UserStory): number | null {
  if (!story.estimate) return null;

  // Map story points to effort score (higher points = higher effort)
  // Fibonacci scale: 1, 2, 3, 5, 8, 13
  const pointsToEffort: Record<number, number> = {
    1: 10,
    2: 25,
    3: 40,
    5: 60,
    8: 80,
    13: 95,
  };

  const baseEffort =
    pointsToEffort[story.estimate.storyPoints] ?? Math.min(story.estimate.storyPoints * 7.5, 100);

  // Adjust slightly based on size classification
  const sizeModifier =
    story.estimate.size === 'large' ? 5 : story.estimate.size === 'small' ? -5 : 0;

  return Math.max(0, Math.min(100, baseEffort + sizeModifier));
}

/** Compute value score (0-100) from priority and acceptance criteria impact. Higher = more value. */
function computeValueScore(story: UserStory): number | null {
  // Priority contributes the largest share of value (0-60 base)
  const priorityToValue: Record<string, number> = {
    critical: 90,
    high: 70,
    medium: 45,
    low: 20,
  };

  let value = priorityToValue[story.priority] ?? 40;

  // Acceptance criteria count adds impact weight (more criteria = potentially higher impact)
  const criteriaCount = story.acceptanceCriteria?.length || 0;
  if (criteriaCount >= 5) value = Math.min(100, value + 8);
  else if (criteriaCount >= 3) value = Math.min(100, value + 4);

  // If there's a priority recommendation suggesting higher priority, boost value
  if (story.priorityRecommendation && !story.priorityRecommendation.isManualOverride) {
    const suggestedVal = priorityToValue[story.priorityRecommendation.suggestedPriority] ?? 0;
    const currentVal = priorityToValue[story.priority] ?? 0;
    if (suggestedVal > currentVal) {
      // Blend in the AI suggestion slightly
      value = Math.min(100, value + Math.round((suggestedVal - currentVal) * 0.3));
    }
  }

  // Stories blocking others are higher value
  if (story.dependsOn && story.dependsOn.length === 0) {
    // No dependencies — might be a foundation piece (slight boost if it has dependents tracked elsewhere)
  }

  return Math.max(0, Math.min(100, value));
}

/** Determine quadrant from effort and value scores */
function computeQuadrant(effortScore: number, valueScore: number): MatrixQuadrant {
  const highValue = valueScore >= 50;
  const highEffort = effortScore >= 50;

  if (highValue && !highEffort) return 'quick_wins'; // High value, low effort
  if (highValue && highEffort) return 'major_projects'; // High value, high effort
  if (!highValue && !highEffort) return 'fill_ins'; // Low value, low effort
  return 'low_priority'; // Low value, high effort
}

const SELECTED_PRD_KEY = 'e-selected-prd-id';

function createLoopStore() {
  let activeLoop = $state<LoopState | null>(null);
  let prds = $state<PRD[]>([]);
  let selectedPrdId = $state<string | null>(null);
  let loading = $state(false);
  let log = $state<IterationLogEntry[]>([]);
  let eventReader = $state<ReadableStreamDefaultReader | null>(null);
  let eventAbort = $state<AbortController | null>(null);
  let prdEventAbort = $state<AbortController | null>(null);
  let prdEventsWorkspacePath = $state<string | null>(null);
  let standaloneStoryCount = $state(0); // Tracks total stories for standalone loops
  let activeLoopChecked = $state(false); // True once loadActiveLoop() has completed at least once

  // Sprint planning state
  let editMode = $state<EditMode>('locked');
  let planConversationId = $state<string | null>(null);
  let planPrdId = $state<string | null>(null);

  // Story generation state
  let generatedStories = $state<GeneratedStory[]>([]);
  let generating = $state(false);
  let generateError = $state<string | null>(null);

  // Story create/edit state
  let editingStoryId = $state<string | null>(null);

  // Story refinement state
  let refiningStoryId = $state<string | null>(null);
  let refining = $state(false);
  let refineError = $state<string | null>(null);
  let refinementQuestions = $state<RefinementQuestion[]>([]);
  let refinementQualityScore = $state<number | null>(null);
  let refinementQualityExplanation = $state<string | null>(null);
  let refinementMeetsThreshold = $state(false);
  let refinementImprovements = $state<string[]>([]);
  let refinementUpdatedStory = $state<RefineStoryResponse['updatedStory'] | null>(null);
  let refinementRound = $state(0);

  // PRD-wide refinement state
  let refiningAll = $state(false);
  let refineAllResults = $state<RefineAllResponse | null>(null);
  let refineAllError = $state<string | null>(null);

  // Dependency state
  let dependencyGraph = $state<DependencyGraph | null>(null);
  let dependencyLoading = $state(false);
  let dependencyError = $state<string | null>(null);
  let sprintValidation = $state<SprintValidation | null>(null);
  let analyzingDependencies = $state(false);

  // AC validation state
  let validatingCriteriaStoryId = $state<string | null>(null);
  let validatingCriteria = $state(false);
  let criteriaValidationResult = $state<ValidateACResponse | null>(null);
  let criteriaValidationError = $state<string | null>(null);
  let criteriaOverrides = $state<ACOverride[]>([]);

  // Estimation state
  let estimatingStoryId = $state<string | null>(null);
  let estimating = $state(false);
  let estimationResult = $state<StoryEstimate | null>(null);
  let estimationError = $state<string | null>(null);
  let estimatingPrd = $state(false);
  let prdEstimationResult = $state<EstimatePrdResponse | null>(null);

  // Sprint plan recommendation state
  let generatingSprintPlan = $state(false);
  let sprintPlanResult = $state<SprintPlanResponse | null>(null);
  let sprintPlanError = $state<string | null>(null);
  let sprintPlanCapacity = $state<number>(20);
  let sprintPlanCapacityMode = $state<'points' | 'count'>('points');

  // PRD completeness analysis state
  let analyzingCompleteness = $state(false);
  let completenessResult = $state<PRDCompletenessAnalysis | null>(null);
  let completenessError = $state<string | null>(null);

  // Story template library state
  let templates = $state<StoryTemplate[]>([]);
  let templatesLoading = $state(false);
  let templatesError = $state<string | null>(null);
  let selectedTemplateId = $state<string | null>(null);
  let templateFilterCategory = $state<StoryTemplateCategory | null>(null);

  // Priority recommendation state
  let recommendingPriorityStoryId = $state<string | null>(null);
  let recommendingPriority = $state(false);
  let priorityRecommendationResult = $state<PriorityRecommendation | null>(null);
  let priorityRecommendationError = $state<string | null>(null);
  let recommendingAllPriorities = $state(false);
  let bulkPriorityResult = $state<PriorityRecommendationBulkResponse | null>(null);

  // Effort-value matrix state
  let effortValueMatrix = $state<EffortValueMatrix | null>(null);
  let matrixFilterQuadrant = $state<MatrixQuadrant | null>(null);
  let matrixManualPositions = $state<Record<string, { effortScore: number; valueScore: number }>>(
    {},
  );

  return {
    get activeLoop() {
      return activeLoop;
    },
    get prds() {
      return prds;
    },
    get selectedPrdId() {
      return selectedPrdId;
    },
    get selectedPrd() {
      return prds.find((p) => p.id === selectedPrdId) || null;
    },
    get loading() {
      return loading;
    },
    get log() {
      return log;
    },
    get isRunning() {
      return activeLoop?.status === 'running';
    },
    get isPaused() {
      return activeLoop?.status === 'paused';
    },
    get isActive() {
      return activeLoop?.status === 'running' || activeLoop?.status === 'paused';
    },
    /** Whether the initial loadActiveLoop() call has completed. Use to avoid showing the start button prematurely. */
    get activeLoopChecked() {
      return activeLoopChecked;
    },
    get completedStories() {
      return activeLoop?.totalStoriesCompleted ?? 0;
    },
    get totalStories() {
      if (activeLoop && !activeLoop.prdId) {
        return standaloneStoryCount;
      }
      const prd = prds.find((p) => p.id === activeLoop?.prdId);
      return prd?.stories?.length ?? 0;
    },
    get progress() {
      const total = this.totalStories;
      if (total === 0) return 0;
      return Math.round((this.completedStories / total) * 100);
    },
    get editMode() {
      return editMode;
    },
    get allowEdits() {
      return editMode !== 'locked';
    },
    get planConversationId() {
      return planConversationId;
    },
    get planPrdId() {
      return planPrdId;
    },
    get generatedStories() {
      return generatedStories;
    },
    get generating() {
      return generating;
    },
    get generateError() {
      return generateError;
    },
    get editingStoryId() {
      return editingStoryId;
    },
    get refiningStoryId() {
      return refiningStoryId;
    },
    get refining() {
      return refining;
    },
    get refineError() {
      return refineError;
    },
    get refinementQuestions() {
      return refinementQuestions;
    },
    get refinementQualityScore() {
      return refinementQualityScore;
    },
    get refinementQualityExplanation() {
      return refinementQualityExplanation;
    },
    get refinementMeetsThreshold() {
      return refinementMeetsThreshold;
    },
    get refinementImprovements() {
      return refinementImprovements;
    },
    get refinementUpdatedStory() {
      return refinementUpdatedStory;
    },
    get refinementRound() {
      return refinementRound;
    },
    get refiningAll() {
      return refiningAll;
    },
    get refineAllResults() {
      return refineAllResults;
    },
    get refineAllError() {
      return refineAllError;
    },
    get dependencyGraph() {
      return dependencyGraph;
    },
    get dependencyLoading() {
      return dependencyLoading;
    },
    get dependencyError() {
      return dependencyError;
    },
    get sprintValidation() {
      return sprintValidation;
    },
    get analyzingDependencies() {
      return analyzingDependencies;
    },
    get hasBlockedStories() {
      if (!dependencyGraph) return false;
      return dependencyGraph.nodes.some(
        (n) => n.blockedByCount > 0 && !n.isReady && n.status === 'pending',
      );
    },
    get sprintWarnings(): SprintValidationWarning[] {
      return sprintValidation?.warnings || [];
    },
    get validatingCriteriaStoryId() {
      return validatingCriteriaStoryId;
    },
    get validatingCriteria() {
      return validatingCriteria;
    },
    get criteriaValidationResult() {
      return criteriaValidationResult;
    },
    get criteriaValidationError() {
      return criteriaValidationError;
    },
    get criteriaOverrides() {
      return criteriaOverrides;
    },
    get estimatingStoryId() {
      return estimatingStoryId;
    },
    get estimating() {
      return estimating;
    },
    get estimationResult() {
      return estimationResult;
    },
    get estimationError() {
      return estimationError;
    },
    get estimatingPrd() {
      return estimatingPrd;
    },
    get prdEstimationResult() {
      return prdEstimationResult;
    },
    get generatingSprintPlan() {
      return generatingSprintPlan;
    },
    get sprintPlanResult() {
      return sprintPlanResult;
    },
    get sprintPlanError() {
      return sprintPlanError;
    },
    get sprintPlanCapacity() {
      return sprintPlanCapacity;
    },
    get sprintPlanCapacityMode() {
      return sprintPlanCapacityMode;
    },
    get analyzingCompleteness() {
      return analyzingCompleteness;
    },
    get completenessResult() {
      return completenessResult;
    },
    get completenessError() {
      return completenessError;
    },
    get templates() {
      return templates;
    },
    get templatesLoading() {
      return templatesLoading;
    },
    get templatesError() {
      return templatesError;
    },
    get selectedTemplateId() {
      return selectedTemplateId;
    },
    get selectedTemplate() {
      return templates.find((t) => t.id === selectedTemplateId) || null;
    },
    get templateFilterCategory() {
      return templateFilterCategory;
    },
    get recommendingPriorityStoryId() {
      return recommendingPriorityStoryId;
    },
    get recommendingPriority() {
      return recommendingPriority;
    },
    get priorityRecommendationResult() {
      return priorityRecommendationResult;
    },
    get priorityRecommendationError() {
      return priorityRecommendationError;
    },
    get recommendingAllPriorities() {
      return recommendingAllPriorities;
    },
    get bulkPriorityResult() {
      return bulkPriorityResult;
    },
    get effortValueMatrix() {
      return effortValueMatrix;
    },
    get matrixFilterQuadrant() {
      return matrixFilterQuadrant;
    },
    get matrixManualPositions() {
      return matrixManualPositions;
    },

    // --- Setters ---

    setActiveLoop(loop: LoopState | null) {
      activeLoop = loop;
      if (loop) {
        log = loop.iterationLog || [];
      }
    },
    setPrds(list: PRD[]) {
      prds = list;
    },
    setSelectedPrdId(id: string | null) {
      selectedPrdId = id;
      try {
        if (id) {
          localStorage.setItem(SELECTED_PRD_KEY, id);
        } else {
          localStorage.removeItem(SELECTED_PRD_KEY);
        }
      } catch {
        /* localStorage unavailable */
      }
    },
    setLoading(v: boolean) {
      loading = v;
    },
    addLogEntry(entry: IterationLogEntry) {
      log = [...log, entry];
    },
    clearLog() {
      log = [];
    },
    setEditMode(v: EditMode) {
      editMode = v;
    },
    setPlanConversationId(id: string | null) {
      planConversationId = id;
    },
    setPlanPrdId(id: string | null) {
      planPrdId = id;
    },

    // --- Loop event handling ---

    handleLoopEvent(event: StreamLoopEvent) {
      if (!activeLoop || event.loopId !== activeLoop.id) return;

      // Forward ALL events to the golems store for the live status panel
      golemsStore.handleEvent(event);

      // Forward worktree events to the worktree store for live UI updates
      if (
        event.event === 'worktree_created' ||
        event.event === 'worktree_merge_started' ||
        event.event === 'worktree_merge_completed' ||
        event.event === 'worktree_merge_conflict'
      ) {
        import('./worktree.svelte').then(({ worktreeStore }) => {
          worktreeStore.handleLoopEvent(event);
        });
      }

      const isStandaloneLoop = !activeLoop.prdId;

      switch (event.event) {
        case 'started':
          activeLoop = { ...activeLoop, status: 'running' };
          break;

        case 'iteration_start':
          activeLoop = {
            ...activeLoop,
            currentIteration: event.data.iteration ?? activeLoop.currentIteration,
            currentStoryId: event.data.storyId ?? null,
          };
          break;

        case 'story_started':
          // Update story status in the appropriate store
          if (isStandaloneLoop) {
            this.updateStandaloneStory(event.data.storyId!, 'in_progress');
          } else {
            this.updateStoryInPrds(event.data.storyId!, 'in_progress');
          }
          // Navigate to the new conversation so the user can watch the agent work
          if (event.data.conversationId) {
            this.navigateToLoopConversation(event.data.conversationId, event.data.storyTitle);
          }
          break;

        case 'story_completed':
          activeLoop = {
            ...activeLoop,
            totalStoriesCompleted: activeLoop.totalStoriesCompleted + 1,
          };
          if (isStandaloneLoop) {
            this.updateStandaloneStory(event.data.storyId!, 'completed');
          } else {
            this.updateStoryInPrds(event.data.storyId!, 'completed');
          }
          break;

        case 'story_failed': {
          // If the server will retry, mark as pending (not failed) so UI reflects retry
          const newStatus = event.data.willRetry ? 'pending' : 'failed';
          if (isStandaloneLoop) {
            this.updateStandaloneStory(event.data.storyId!, newStatus);
          } else {
            this.updateStoryInPrds(event.data.storyId!, newStatus);
          }
          break;
        }

        case 'paused':
          activeLoop = { ...activeLoop, status: 'paused', pausedAt: Date.now() };
          break;

        case 'resumed':
          activeLoop = { ...activeLoop, status: 'running' };
          break;

        case 'completed':
        case 'failed':
        case 'cancelled':
          activeLoop = {
            ...activeLoop,
            status:
              event.event === 'cancelled'
                ? 'cancelled'
                : event.event === 'failed'
                  ? 'failed'
                  : event.data.partial
                    ? 'completed_with_failures'
                    : 'completed',
            completedAt: Date.now(),
            currentStoryId: null,
          };
          this.disconnectEvents();
          break;
      }

      // Add to log for relevant events
      if (event.data.storyId && event.event !== 'quality_check') {
        this.addLogEntry({
          iteration: event.data.iteration ?? activeLoop?.currentIteration ?? 0,
          storyId: event.data.storyId,
          storyTitle: event.data.storyTitle ?? '',
          action: event.event as IterationLogEntry['action'],
          detail: event.data.message ?? event.event,
          timestamp: Date.now(),
          qualityResults: event.data.qualityResult ? [event.data.qualityResult] : undefined,
        });
      }
    },

    updateStoryInPrds(storyId: string, status: string) {
      prds = prds.map((prd) => ({
        ...prd,
        stories: (prd.stories || []).map((s) =>
          s.id === storyId ? { ...s, status: status as any } : s,
        ),
      }));
    },

    /** Update a standalone story status via workStore (lazy import to avoid circular dep). */
    updateStandaloneStory(storyId: string, status: string) {
      // Lazy import to break circular dependency (workStore imports loopStore)
      import('../stores/work.svelte').then(({ workStore }) => {
        workStore.updateStoryStatus(storyId, status);
      });
    },

    /** Fetch and navigate to a conversation created by the loop. */
    async navigateToLoopConversation(convId: string, storyTitle?: string) {
      try {
        const res = await api.conversations.get(convId);
        if (res.ok && res.data) {
          const conv = res.data;
          // Add to the conversation list
          conversationStore.prependConversation({
            id: conv.id,
            title: conv.title,
            createdAt: conv.createdAt,
            updatedAt: conv.updatedAt,
            messageCount: conv.messages?.length ?? 0,
            model: conv.model,
          });
          // Set as active so the chat pane shows the agent's work
          conversationStore.setActive(conv);
        }
      } catch (err) {
        console.error(`[loop] Failed to navigate to loop conversation ${convId}:`, err);
      }
    },

    // --- SSE event streaming ---

    async connectEvents(loopId: string) {
      this.disconnectEvents();

      const MAX_RECONNECT_ATTEMPTS = 5;
      const RECONNECT_DELAY_MS = 3000;
      let reconnectAttempts = 0;

      const connect = async () => {
        const abort = new AbortController();
        eventAbort = abort;

        try {
          const headers: Record<string, string> = {};
          const token = getAuthToken();
          if (token) headers['Authorization'] = `Bearer ${token}`;

          const res = await fetch(`${getBaseUrl()}/loops/${loopId}/events`, {
            headers,
            signal: abort.signal,
          });

          if (!res.ok || !res.body) return;

          const reader = res.body.getReader();
          eventReader = reader;
          const decoder = new TextDecoder();
          let buffer = '';
          reconnectAttempts = 0; // Reset on successful connect

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const json = line.slice(6).trim();
              if (!json || json === '{"type":"ping"}') continue;

              try {
                const event = JSON.parse(json);
                if (event.type === 'loop_event') {
                  this.handleLoopEvent(event as StreamLoopEvent);
                } else if (event.type === 'agent_note_created') {
                  // Forward agent notes to the agent notes store
                  import('../stores/agent-notes.svelte').then(({ agentNotesStore }) => {
                    agentNotesStore.addFromStream(event.note);
                  });
                }
              } catch {
                /* non-JSON line */
              }
            }
          }

          // Stream ended normally — check if loop is still active and reconnect
          if (activeLoop && (activeLoop.status === 'running' || activeLoop.status === 'paused')) {
            if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
              reconnectAttempts++;
              console.log(
                `[loop] SSE stream ended, reconnecting (attempt ${reconnectAttempts})...`,
              );
              // Refresh loop state from server before reconnecting
              try {
                const loopRes = await api.loops.get(loopId);
                if (loopRes.ok) {
                  const serverLoop = loopRes.data;
                  if (
                    serverLoop.status === 'completed' ||
                    serverLoop.status === 'completed_with_failures' ||
                    serverLoop.status === 'cancelled' ||
                    serverLoop.status === 'failed'
                  ) {
                    // Server says it's done — update local state
                    activeLoop = { ...activeLoop, ...serverLoop };
                    return;
                  }
                }
              } catch {
                /* proceed with reconnect */
              }
              await new Promise((r) => setTimeout(r, RECONNECT_DELAY_MS));
              if (eventAbort && !eventAbort.signal.aborted) {
                await connect();
              }
            } else {
              console.warn(
                '[loop] Max reconnect attempts reached, refreshing loop state from server',
              );
              await this.loadActiveLoop();
            }
          }
        } catch (err) {
          if ((err as Error).name !== 'AbortError') {
            console.error('[loop] Event stream error:', err);
            // Attempt reconnect on non-abort errors
            if (
              activeLoop &&
              (activeLoop.status === 'running' || activeLoop.status === 'paused') &&
              reconnectAttempts < MAX_RECONNECT_ATTEMPTS
            ) {
              reconnectAttempts++;
              await new Promise((r) => setTimeout(r, RECONNECT_DELAY_MS));
              if (eventAbort && !eventAbort.signal.aborted) {
                await connect();
              }
            }
          }
        }
      };

      await connect();
    },

    disconnectEvents() {
      if (eventAbort) {
        eventAbort.abort();
        eventAbort = null;
      }
      eventReader = null;
    },

    /**
     * Subscribe to PRD change events via SSE.
     * Auto-refreshes the PRD list when mutations happen (create, update, delete).
     */
    connectPrdEvents(workspacePath: string) {
      // Skip if already connected for this workspace
      if (prdEventAbort && prdEventsWorkspacePath === workspacePath) return;
      this.disconnectPrdEvents();

      prdEventsWorkspacePath = workspacePath;
      const abort = new AbortController();
      prdEventAbort = abort;

      const connect = async () => {
        try {
          const headers: Record<string, string> = { Accept: 'text/event-stream' };
          const token = getAuthToken();
          if (token) headers['Authorization'] = `Bearer ${token}`;

          const url = `${getBaseUrl()}/prds/events?workspacePath=${encodeURIComponent(workspacePath)}`;
          const res = await fetch(url, { headers, signal: abort.signal });

          if (!res.ok || !res.body) return;

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              try {
                const event = JSON.parse(line.slice(6));
                if (event.type === 'ping') continue;

                // A PRD mutation happened — reload the list
                console.log('[loop] PRD change event:', event.type, event.prdId);
                if (prdEventsWorkspacePath) {
                  await this.loadPrds(prdEventsWorkspacePath);
                }
              } catch {
                /* malformed event — skip */
              }
            }
          }
        } catch (err) {
          if ((err as Error).name !== 'AbortError') {
            console.warn('[loop] PRD events stream error, reconnecting in 5s:', err);
            // Reconnect after delay
            if (!abort.signal.aborted) {
              await new Promise((r) => setTimeout(r, 5000));
              if (!abort.signal.aborted) {
                await connect();
              }
            }
          }
        }
      };

      connect();
    },

    disconnectPrdEvents() {
      if (prdEventAbort) {
        prdEventAbort.abort();
        prdEventAbort = null;
      }
      prdEventsWorkspacePath = null;
    },

    // --- API helpers ---

    async loadPrds(workspacePath: string) {
      loading = true;
      try {
        const res = await api.prds.list(workspacePath);
        if (res.ok) {
          prds = res.data;
          // Restore previously selected PRD from localStorage
          if (!selectedPrdId) {
            try {
              const saved = localStorage.getItem(SELECTED_PRD_KEY);
              if (saved) {
                if (prds.some((p) => p.id === saved)) {
                  selectedPrdId = saved;
                  // Sync work panel filter (lazy import to avoid circular dep)
                  import('../stores/work.svelte').then(({ workStore }) => {
                    if (
                      workStore.activeFilter === 'standalone' ||
                      workStore.activeFilter === 'all'
                    ) {
                      workStore.setFilter(saved);
                    }
                  });
                } else {
                  // Saved PRD no longer exists — clean up
                  localStorage.removeItem(SELECTED_PRD_KEY);
                }
              }
            } catch {
              /* localStorage unavailable */
            }
          }
          // Load stories for any PRDs that are missing them.
          // The list endpoint includes stories, so this is normally a no-op —
          // but it ensures counts are always available even if the response
          // doesn't include stories (e.g. older server, race condition).
          // The selected PRD is always refreshed to keep its data current.
          const toLoad = new Set<string>(prds.filter((p) => !p.stories).map((p) => p.id));
          if (selectedPrdId && prds.some((p) => p.id === selectedPrdId)) {
            toLoad.add(selectedPrdId);
          }
          if (toLoad.size > 0) {
            await Promise.all([...toLoad].map((id) => this.loadPrd(id)));
          }
        }
      } finally {
        loading = false;
      }

      // Start listening for real-time PRD mutations (idempotent — won't reconnect if already connected)
      this.connectPrdEvents(workspacePath);
    },

    async loadPrd(id: string) {
      loading = true;
      try {
        const res = await api.prds.get(id);
        if (res.ok) {
          // Update in place
          prds = prds.map((p) => (p.id === id ? res.data : p));
          if (!prds.find((p) => p.id === id)) {
            prds = [...prds, res.data];
          }
        }
      } finally {
        loading = false;
      }
    },

    async loadActiveLoop() {
      try {
        const res = await api.loops.list('running');
        if (res.ok && res.data.length > 0) {
          activeLoop = res.data[0];
          log = activeLoop!.iterationLog || [];
          // Refresh from the specific loop endpoint to get authoritative state
          try {
            const freshRes = await api.loops.get(activeLoop!.id);
            if (freshRes.ok) {
              activeLoop = freshRes.data;
              log = activeLoop!.iterationLog || [];
            }
          } catch {
            /* use cached data */
          }
          // Restore standalone story count for progress tracking
          if (activeLoop && !activeLoop.prdId) {
            this.restoreStandaloneStoryCount();
          }
          // Connect to events if still running
          if (activeLoop && activeLoop.status === 'running') {
            this.connectEvents(activeLoop.id);
          }
          // Sync golem status from loop state
          if (activeLoop) {
            this.syncGolemFromLoop(activeLoop);
          }
        } else {
          // Check for paused loops
          const pausedRes = await api.loops.list('paused');
          if (pausedRes.ok && pausedRes.data.length > 0) {
            activeLoop = pausedRes.data[0];
            log = activeLoop!.iterationLog || [];
            if (!activeLoop!.prdId) {
              this.restoreStandaloneStoryCount();
            }
            // Sync golem status for paused loop
            if (activeLoop) {
              this.syncGolemFromLoop(activeLoop);
            }
          } else {
            // Check for recently-failed loops that might have been "running" before
            const failedRes = await api.loops.list('failed');
            if (failedRes.ok && failedRes.data.length > 0) {
              const recent = failedRes.data[0];
              // If it failed in the last 60 seconds, show it so user sees the transition
              if (recent.completedAt && Date.now() - recent.completedAt < 60000) {
                activeLoop = recent;
                log = recent.iterationLog || [];
              }
            }
          }
        }
      } catch {
        /* server may not be ready */
      } finally {
        activeLoopChecked = true;
      }
    },

    /** Restore standalone story count from workStore for progress tracking. */
    restoreStandaloneStoryCount() {
      import('../stores/work.svelte').then(({ workStore }) => {
        // Total = all standalone stories (any status), since completed ones count toward progress
        standaloneStoryCount = workStore.standaloneStories.length;
      });
    },

    setStandaloneStoryCount(count: number) {
      standaloneStoryCount = count;
    },

    /** Sync the golems store from existing loop state (for page load / reconnect) */
    syncGolemFromLoop(loop: LoopState) {
      // Determine the label from PRD or standalone
      let label = 'Standalone Stories';
      if (loop.prdId) {
        const prd = prds.find((p) => p.id === loop.prdId);
        label = prd ? prd.name : `PRD ${loop.prdId.slice(0, 8)}`;
      }
      // Get total stories count
      let total = 0;
      if (loop.prdId) {
        const prd = prds.find((p) => p.id === loop.prdId);
        total = prd?.stories?.length ?? 0;
      } else {
        total = standaloneStoryCount;
      }
      // Get current story title from log or PRD
      let currentStoryTitle: string | null = null;
      if (loop.currentStoryId) {
        // Try to find the story title from PRDs
        for (const prd of prds) {
          const story = prd.stories?.find((s) => s.id === loop.currentStoryId);
          if (story) {
            currentStoryTitle = story.title;
            break;
          }
        }
        // Fallback: look in iteration log
        if (!currentStoryTitle && loop.iterationLog.length > 0) {
          const lastEntry = [...loop.iterationLog]
            .reverse()
            .find((e) => e.storyId === loop.currentStoryId);
          if (lastEntry) currentStoryTitle = lastEntry.storyTitle;
        }
      }
      golemsStore.syncFromLoopState({
        loopId: loop.id,
        label,
        status: loop.status,
        totalStories: total,
        storiesCompleted: loop.totalStoriesCompleted,
        storiesFailed: loop.totalStoriesFailed,
        currentIteration: loop.currentIteration,
        currentStoryId: loop.currentStoryId,
        currentStoryTitle,
        startedAt: loop.startedAt,
        iterationLog: loop.iterationLog,
        activeStoryIds: loop.activeStoryIds ?? [],
      });
    },

    async startLoop(
      prdId: string | null,
      workspacePath: string,
      config: LoopConfig,
    ): Promise<{ ok: boolean; error?: string }> {
      loading = true;
      try {
        const res = await api.loops.start({ prdId, workspacePath, config });
        if (res.ok) {
          const loopRes = await api.loops.get(res.data.loopId);
          if (loopRes.ok) {
            activeLoop = loopRes.data;
            log = [];
            this.connectEvents(res.data.loopId);
            // Initialize the golem in the golems store
            this.syncGolemFromLoop(loopRes.data);
          }
          return { ok: true };
        }
        return { ok: false, error: (res as any).error || 'Failed to activate Golem' };
      } catch (err) {
        return { ok: false, error: String(err) };
      } finally {
        loading = false;
      }
    },

    async pauseLoop() {
      if (!activeLoop) return;
      await api.loops.pause(activeLoop.id);
    },

    async resumeLoop() {
      if (!activeLoop) return;
      await api.loops.resume(activeLoop.id);
    },

    async cancelLoop() {
      if (!activeLoop) return;
      await api.loops.cancel(activeLoop.id);
    },

    /** Reset a single story's attempts back to 0, status to pending */
    async resetStory(storyId: string): Promise<{ ok: boolean; error?: string }> {
      try {
        const res = await api.loops.resetStory(storyId);
        if (res.ok) {
          // Update local state
          this.updateStoryInPrds(storyId, 'pending');
          this.updateStandaloneStory(storyId, 'pending');
          // Refresh PRDs to get updated attempt counts
          if (activeLoop?.workspacePath) await this.loadPrds(activeLoop.workspacePath);
          return { ok: true };
        }
        return { ok: false, error: (res as any).error || 'Failed to reset story' };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    /** Reset all failed stories in a PRD/workspace and optionally restart the loop */
    async resetFailedAndRestart(
      prdId: string | null,
      workspacePath: string,
      config?: LoopConfig,
    ): Promise<{ ok: boolean; resetCount?: number; error?: string }> {
      try {
        const res = await api.loops.resetFailed({
          prdId,
          workspacePath,
          restart: !!config,
          config,
        });
        if (res.ok) {
          // Refresh story state
          if (workspacePath) await this.loadPrds(workspacePath);

          // If a new loop was started, connect to it
          if (res.data.loopId) {
            const loopRes = await api.loops.get(res.data.loopId);
            if (loopRes.ok) {
              activeLoop = loopRes.data;
              log = [];
              this.connectEvents(res.data.loopId);
            }
          }
          return { ok: true, resetCount: res.data.resetCount };
        }
        return { ok: false, error: (res as any).error || 'Failed to reset stories' };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    // --- Story generation ---

    setGeneratedStories(stories: GeneratedStory[]) {
      generatedStories = stories;
    },
    clearGeneration() {
      generatedStories = [];
      generateError = null;
    },

    async generateStories(
      prdId: string,
      description: string,
      context?: string,
      count?: number,
    ): Promise<{ ok: boolean; error?: string }> {
      generating = true;
      generateError = null;
      generatedStories = [];
      try {
        const res = await api.prds.generate(prdId, { description, context, count });
        if (res.ok) {
          generatedStories = res.data.stories as GeneratedStory[];
          return { ok: true };
        }
        generateError = (res as any).error || 'Generation failed';
        return { ok: false, error: generateError ?? undefined };
      } catch (err) {
        generateError = String(err);
        return { ok: false, error: generateError ?? undefined };
      } finally {
        generating = false;
      }
    },

    async acceptGeneratedStories(
      prdId: string,
      stories: GeneratedStory[],
    ): Promise<{ ok: boolean; error?: string }> {
      loading = true;
      try {
        const res = await api.prds.acceptGenerated(prdId, stories);
        if (res.ok) {
          generatedStories = [];
          generateError = null;
          // Reload the PRD to show the new stories
          await this.loadPrd(prdId);
          return { ok: true };
        }
        return { ok: false, error: (res as any).error || 'Failed to accept stories' };
      } catch (err) {
        return { ok: false, error: String(err) };
      } finally {
        loading = false;
      }
    },

    updateGeneratedStory(index: number, updates: Partial<GeneratedStory>) {
      generatedStories = generatedStories.map((s, i) => (i === index ? { ...s, ...updates } : s));
    },

    removeGeneratedStory(index: number) {
      generatedStories = generatedStories.filter((_, i) => i !== index);
    },

    /**
     * One-step flow: create a new PRD from a description and generate stories.
     * Returns the new PRD ID on success. If autoAccept is true (default), stories
     * are automatically added to the PRD.
     */
    async generateFromDescription(
      workspacePath: string,
      description: string,
      opts?: {
        name?: string;
        context?: string;
        count?: number;
        autoAccept?: boolean;
      },
    ): Promise<{ ok: boolean; prdId?: string; error?: string }> {
      generating = true;
      generateError = null;
      generatedStories = [];
      try {
        const res = await api.prds.generateFromDescription({
          description,
          workspacePath,
          name: opts?.name,
          context: opts?.context,
          count: opts?.count,
          autoAccept: opts?.autoAccept,
        });
        if (res.ok) {
          generatedStories = res.data.stories as GeneratedStory[];
          // If auto-accepted, reload the PRD list so it appears
          if (res.data.accepted > 0) {
            await this.loadPrds(workspacePath);
            await this.loadPrd(res.data.prdId);
          }
          return { ok: true, prdId: res.data.prdId };
        }
        generateError = (res as any).error || 'Generation failed';
        return { ok: false, error: generateError ?? undefined };
      } catch (err) {
        generateError = String(err);
        return { ok: false, error: generateError ?? undefined };
      } finally {
        generating = false;
      }
    },

    // --- Story create/edit ---

    setEditingStoryId(id: string | null) {
      editingStoryId = id;
    },

    // --- Story refinement ---

    setRefiningStoryId(id: string | null) {
      refiningStoryId = id;
    },

    clearRefinement() {
      refiningStoryId = null;
      refining = false;
      refineError = null;
      refinementQuestions = [];
      refinementQualityScore = null;
      refinementQualityExplanation = null;
      refinementMeetsThreshold = false;
      refinementImprovements = [];
      refinementUpdatedStory = null;
      refinementRound = 0;
    },

    async refineStory(
      prdId: string,
      storyId: string,
      answers?: Array<{ questionId: string; answer: string }>,
    ): Promise<{ ok: boolean; error?: string }> {
      refining = true;
      refineError = null;
      refiningStoryId = storyId;
      try {
        const res = await api.prds.refineStory(prdId, storyId, answers);
        if (res.ok) {
          refinementQuestions = res.data.questions as RefinementQuestion[];
          refinementQualityScore = res.data.qualityScore;
          refinementQualityExplanation = res.data.qualityExplanation;
          refinementMeetsThreshold = res.data.meetsThreshold;
          refinementImprovements = res.data.improvements || [];
          refinementUpdatedStory = res.data.updatedStory || null;
          refinementRound += 1;

          // If answers were provided and story was updated, reload the PRD to reflect changes
          if (answers && answers.length > 0 && res.data.updatedStory) {
            await this.loadPrd(prdId);
          }

          return { ok: true };
        }
        refineError = (res as any).error || 'Refinement failed';
        return { ok: false, error: refineError ?? undefined };
      } catch (err) {
        refineError = String(err);
        return { ok: false, error: refineError ?? undefined };
      } finally {
        refining = false;
      }
    },

    // --- PRD-wide refinement ---

    clearRefineAll() {
      refiningAll = false;
      refineAllResults = null;
      refineAllError = null;
    },

    async refineAllStories(
      prdId: string,
      options?: { statuses?: string[]; includeCodeScan?: boolean },
    ): Promise<{ ok: boolean; error?: string }> {
      refiningAll = true;
      refineAllError = null;
      refineAllResults = null;
      try {
        const res = await api.prds.refineAllStories(prdId, options);
        if (res.ok) {
          refineAllResults = res.data;
          return { ok: true };
        }
        refineAllError = (res as any).error || 'PRD-wide refinement failed';
        return { ok: false, error: refineAllError ?? undefined };
      } catch (err) {
        refineAllError = String(err);
        return { ok: false, error: refineAllError ?? undefined };
      } finally {
        refiningAll = false;
      }
    },

    async applyRecommendation(prdId: string, rec: StoryRecommendation): Promise<{ ok: boolean }> {
      if (rec.action === 'keep') return { ok: true };

      if (rec.action === 'remove' || rec.action === 'already_done') {
        // Archive the story
        const res = await api.prds.updateStory(prdId, rec.storyId, { status: 'archived' });
        if (res.ok) await this.loadPrd(prdId);
        return { ok: res.ok };
      }

      if (rec.action === 'update' && rec.suggestedChanges) {
        const updates: Record<string, any> = {};
        if (rec.suggestedChanges.title) updates.title = rec.suggestedChanges.title;
        if (rec.suggestedChanges.description)
          updates.description = rec.suggestedChanges.description;
        if (rec.suggestedChanges.acceptanceCriteria)
          updates.acceptanceCriteria = rec.suggestedChanges.acceptanceCriteria;
        if (rec.suggestedChanges.priority) updates.priority = rec.suggestedChanges.priority;
        const res = await api.prds.updateStory(prdId, rec.storyId, updates);
        if (res.ok) await this.loadPrd(prdId);
        return { ok: res.ok };
      }

      // For split/merge — just mark as acknowledged for now (user handles manually)
      return { ok: true };
    },

    async addSuggestedStory(prdId: string, story: SuggestedNewStory): Promise<{ ok: boolean }> {
      const res = await api.prds.addStory(prdId, {
        title: story.title,
        description: story.description,
        acceptanceCriteria: story.acceptanceCriteria,
        priority: story.priority,
      });
      if (res.ok) await this.loadPrd(prdId);
      return { ok: res.ok };
    },

    // --- Sprint planning ---

    // --- Dependency management ---

    async loadDependencyGraph(prdId: string): Promise<void> {
      dependencyLoading = true;
      dependencyError = null;
      try {
        const res = await api.prds.getDependencyGraph(prdId);
        if (res.ok) {
          dependencyGraph = res.data;
        } else {
          dependencyError = (res as any).error || 'Failed to load dependency graph';
        }
      } catch (err) {
        dependencyError = String(err);
      } finally {
        dependencyLoading = false;
      }
    },

    async addDependency(
      prdId: string,
      fromStoryId: string,
      toStoryId: string,
      reason?: string,
    ): Promise<{ ok: boolean; error?: string }> {
      try {
        const res = await api.prds.addDependency(prdId, fromStoryId, toStoryId, reason);
        if (res.ok) {
          dependencyGraph = res.data;
          // Reload PRD to reflect updated dependsOn arrays
          await this.loadPrd(prdId);
          return { ok: true };
        }
        return { ok: false, error: (res as any).error || 'Failed to add dependency' };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    async removeDependency(
      prdId: string,
      fromStoryId: string,
      toStoryId: string,
    ): Promise<{ ok: boolean; error?: string }> {
      try {
        const res = await api.prds.removeDependency(prdId, fromStoryId, toStoryId);
        if (res.ok) {
          dependencyGraph = res.data;
          await this.loadPrd(prdId);
          return { ok: true };
        }
        return { ok: false, error: (res as any).error || 'Failed to remove dependency' };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    async editDependency(
      prdId: string,
      fromStoryId: string,
      toStoryId: string,
      reason: string,
    ): Promise<{ ok: boolean; error?: string }> {
      try {
        const res = await api.prds.editDependency(prdId, fromStoryId, toStoryId, reason);
        if (res.ok) {
          dependencyGraph = res.data;
          await this.loadPrd(prdId);
          return { ok: true };
        }
        return { ok: false, error: (res as any).error || 'Failed to edit dependency' };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    async analyzeDependencies(
      prdId: string,
      replaceAutoDetected?: boolean,
    ): Promise<{ ok: boolean; error?: string }> {
      analyzingDependencies = true;
      dependencyError = null;
      try {
        const res = await api.prds.analyzeDependencies(prdId, replaceAutoDetected);
        if (res.ok) {
          dependencyGraph = res.data.graph;
          await this.loadPrd(prdId);
          return { ok: true };
        }
        dependencyError = (res as any).error || 'Analysis failed';
        return { ok: false, error: dependencyError ?? undefined };
      } catch (err) {
        dependencyError = String(err);
        return { ok: false, error: dependencyError ?? undefined };
      } finally {
        analyzingDependencies = false;
      }
    },

    async validateSprint(prdId: string): Promise<SprintValidation | null> {
      try {
        const res = await api.prds.validateSprint(prdId);
        if (res.ok) {
          sprintValidation = res.data;
          return res.data;
        }
        return null;
      } catch {
        return null;
      }
    },

    clearDependencyState() {
      dependencyGraph = null;
      dependencyError = null;
      sprintValidation = null;
      analyzingDependencies = false;
    },

    // --- Acceptance Criteria Validation ---

    setValidatingCriteriaStoryId(id: string | null) {
      validatingCriteriaStoryId = id;
    },

    clearCriteriaValidation() {
      validatingCriteriaStoryId = null;
      validatingCriteria = false;
      criteriaValidationResult = null;
      criteriaValidationError = null;
      criteriaOverrides = [];
    },

    async validateCriteria(
      prdId: string,
      storyId: string,
      criteria?: string[],
      storyTitle?: string,
      storyDescription?: string,
    ): Promise<{ ok: boolean; error?: string }> {
      validatingCriteria = true;
      criteriaValidationError = null;
      criteriaValidationResult = null;
      validatingCriteriaStoryId = storyId;
      criteriaOverrides = [];
      try {
        // If no criteria provided, extract from the story
        let criteriaToValidate = criteria;
        if (!criteriaToValidate) {
          const prd = prds.find((p) => p.id === prdId);
          const story = prd?.stories?.find((s) => s.id === storyId);
          if (story) {
            criteriaToValidate = story.acceptanceCriteria.map((ac: any) => ac.description);
            storyTitle = storyTitle || story.title;
            storyDescription = storyDescription || story.description;
          }
        }
        if (!criteriaToValidate || criteriaToValidate.length === 0) {
          criteriaValidationError = 'No acceptance criteria to validate';
          return { ok: false, error: criteriaValidationError };
        }

        const res = await api.prds.validateCriteria(
          prdId,
          storyId,
          criteriaToValidate,
          storyTitle,
          storyDescription,
        );
        if (res.ok) {
          criteriaValidationResult = res.data;
          return { ok: true };
        }
        criteriaValidationError = (res as any).error || 'Validation failed';
        return { ok: false, error: criteriaValidationError ?? undefined };
      } catch (err) {
        criteriaValidationError = String(err);
        return { ok: false, error: criteriaValidationError ?? undefined };
      } finally {
        validatingCriteria = false;
      }
    },

    addCriteriaOverride(override: ACOverride) {
      criteriaOverrides = [...criteriaOverrides, override];
    },

    removeCriteriaOverride(criterionIndex: number) {
      criteriaOverrides = criteriaOverrides.filter((o) => o.criterionIndex !== criterionIndex);
    },

    async applyCriteriaSuggestions(
      prdId: string,
      storyId: string,
      acceptedIndices: number[],
    ): Promise<{ ok: boolean; error?: string }> {
      if (!criteriaValidationResult) {
        return { ok: false, error: 'No validation result to apply' };
      }

      // Find the current story
      const prd = prds.find((p) => p.id === prdId);
      const story = prd?.stories?.find((s) => s.id === storyId);
      if (!story) return { ok: false, error: 'Story not found' };

      // Build new criteria: apply suggestions for accepted indices, keep original for others
      const newCriteria = story.acceptanceCriteria.map((ac: any, idx: number) => {
        if (acceptedIndices.includes(idx)) {
          const validation = criteriaValidationResult!.criteria.find((c) => c.index === idx);
          if (validation?.suggestedReplacement) {
            return { ...ac, description: validation.suggestedReplacement };
          }
        }
        return ac;
      });

      try {
        const res = await api.prds.updateStory(prdId, storyId, {
          acceptanceCriteria: newCriteria,
        });
        if (res.ok) {
          await this.loadPrd(prdId);
          return { ok: true };
        }
        return { ok: false, error: (res as any).error || 'Failed to update criteria' };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    // --- Story Estimation ---

    setEstimatingStoryId(id: string | null) {
      estimatingStoryId = id;
    },

    clearEstimation() {
      estimatingStoryId = null;
      estimating = false;
      estimationResult = null;
      estimationError = null;
    },

    clearPrdEstimation() {
      estimatingPrd = false;
      prdEstimationResult = null;
    },

    async estimateStory(prdId: string, storyId: string): Promise<{ ok: boolean; error?: string }> {
      estimating = true;
      estimationError = null;
      estimationResult = null;
      estimatingStoryId = storyId;
      try {
        const res = await api.prds.estimateStory(prdId, storyId);
        if (res.ok) {
          estimationResult = res.data.estimate;
          // Reload PRD to reflect the persisted estimate
          await this.loadPrd(prdId);
          return { ok: true };
        }
        estimationError = (res as any).error || 'Estimation failed';
        return { ok: false, error: estimationError ?? undefined };
      } catch (err) {
        estimationError = String(err);
        return { ok: false, error: estimationError ?? undefined };
      } finally {
        estimating = false;
      }
    },

    async saveManualEstimate(
      prdId: string,
      storyId: string,
      size: string,
      storyPoints: number,
      reasoning?: string,
    ): Promise<{ ok: boolean; error?: string }> {
      try {
        const res = await api.prds.saveManualEstimate(prdId, storyId, {
          size,
          storyPoints,
          reasoning,
        });
        if (res.ok) {
          estimationResult = res.data.estimate;
          await this.loadPrd(prdId);
          return { ok: true };
        }
        return { ok: false, error: (res as any).error || 'Failed to save estimate' };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    async estimateAllStories(
      prdId: string,
      reEstimate?: boolean,
    ): Promise<{ ok: boolean; error?: string }> {
      estimatingPrd = true;
      prdEstimationResult = null;
      try {
        const res = await api.prds.estimatePrd(prdId, reEstimate);
        if (res.ok) {
          prdEstimationResult = res.data;
          await this.loadPrd(prdId);
          return { ok: true };
        }
        return { ok: false, error: (res as any).error || 'Bulk estimation failed' };
      } catch (err) {
        return { ok: false, error: String(err) };
      } finally {
        estimatingPrd = false;
      }
    },

    // --- Sprint Plan Recommendations ---

    setSprintPlanCapacity(value: number) {
      sprintPlanCapacity = value;
    },

    setSprintPlanCapacityMode(mode: 'points' | 'count') {
      sprintPlanCapacityMode = mode;
    },

    clearSprintPlan() {
      generatingSprintPlan = false;
      sprintPlanResult = null;
      sprintPlanError = null;
    },

    async generateSprintPlan(
      prdId: string,
      capacity?: number,
      capacityMode?: 'points' | 'count',
    ): Promise<{ ok: boolean; error?: string }> {
      generatingSprintPlan = true;
      sprintPlanError = null;
      sprintPlanResult = null;
      const cap = capacity ?? sprintPlanCapacity;
      const mode = capacityMode ?? sprintPlanCapacityMode;
      try {
        const res = await api.prds.generateSprintPlan(prdId, cap, mode);
        if (res.ok) {
          sprintPlanResult = res.data;
          return { ok: true };
        }
        sprintPlanError = (res as any).error || 'Sprint planning failed';
        return { ok: false, error: sprintPlanError ?? undefined };
      } catch (err) {
        sprintPlanError = String(err);
        return { ok: false, error: sprintPlanError ?? undefined };
      } finally {
        generatingSprintPlan = false;
      }
    },

    /** @internal Restore critical loop state from HMR data */
    _hmrRestore(data: {
      activeLoop: LoopState | null;
      log: IterationLogEntry[];
      activeLoopChecked: boolean;
      standaloneStoryCount: number;
    }) {
      activeLoop = data.activeLoop;
      log = data.log;
      activeLoopChecked = data.activeLoopChecked;
      standaloneStoryCount = data.standaloneStoryCount;
    },

    /** Move a story from one sprint to another within the current plan */
    moveStoryInPlan(storyId: string, fromSprintIndex: number, toSprintIndex: number) {
      if (!sprintPlanResult) return;

      const plan = { ...sprintPlanResult };
      const sprints = [...plan.sprints];

      // Find and remove the story from the source sprint
      const fromSprint = { ...sprints[fromSprintIndex] };
      const storyIdx = fromSprint.stories.findIndex((s) => s.storyId === storyId);
      if (storyIdx === -1) return;

      const [story] = fromSprint.stories.splice(storyIdx, 1);
      story.reason = 'Manually moved';
      fromSprint.totalPoints -= story.storyPoints;
      sprints[fromSprintIndex] = { ...fromSprint, stories: [...fromSprint.stories] };

      // Add to the destination sprint
      const toSprint = { ...sprints[toSprintIndex] };
      toSprint.stories = [...toSprint.stories, story];
      toSprint.totalPoints += story.storyPoints;
      sprints[toSprintIndex] = toSprint;

      // Remove empty sprints and renumber
      const filtered = sprints.filter((s) => s.stories.length > 0);
      filtered.forEach((s, i) => {
        s.sprintNumber = i + 1;
      });

      sprintPlanResult = {
        ...plan,
        sprints: filtered,
        totalSprints: filtered.length,
      };
    },

    async saveAdjustedPlan(prdId: string): Promise<{ ok: boolean; error?: string }> {
      if (!sprintPlanResult) return { ok: false, error: 'No plan to save' };
      try {
        const res = await api.prds.saveAdjustedSprintPlan(prdId, sprintPlanResult);
        if (res.ok) {
          sprintPlanResult = res.data;
          return { ok: true };
        }
        return { ok: false, error: (res as any).error || 'Failed to save adjusted plan' };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    // --- PRD Completeness Analysis ---

    clearCompleteness() {
      analyzingCompleteness = false;
      completenessResult = null;
      completenessError = null;
    },

    async analyzeCompleteness(prdId: string): Promise<{ ok: boolean; error?: string }> {
      analyzingCompleteness = true;
      completenessError = null;
      completenessResult = null;
      try {
        const res = await api.prds.analyzeCompleteness(prdId);
        if (res.ok) {
          completenessResult = res.data.analysis;
          return { ok: true };
        }
        completenessError = (res as any).error || 'Completeness analysis failed';
        return { ok: false, error: completenessError ?? undefined };
      } catch (err) {
        completenessError = String(err);
        return { ok: false, error: completenessError ?? undefined };
      } finally {
        analyzingCompleteness = false;
      }
    },

    // --- Story Template Library ---

    setSelectedTemplateId(id: string | null) {
      selectedTemplateId = id;
    },

    setTemplateFilterCategory(cat: StoryTemplateCategory | null) {
      templateFilterCategory = cat;
    },

    clearTemplates() {
      templatesError = null;
      selectedTemplateId = null;
    },

    async loadTemplates(category?: StoryTemplateCategory): Promise<void> {
      templatesLoading = true;
      templatesError = null;
      try {
        const res = await api.prds.listTemplates(category || undefined);
        if (res.ok) {
          templates = res.data;
        } else {
          templatesError = (res as any).error || 'Failed to load templates';
        }
      } catch (err) {
        templatesError = String(err);
      } finally {
        templatesLoading = false;
      }
    },

    async createTemplate(body: {
      name: string;
      description: string;
      category: StoryTemplateCategory;
      titleTemplate: string;
      descriptionTemplate: string;
      acceptanceCriteriaTemplates: string[];
      priority?: string;
      tags?: string[];
    }): Promise<{ ok: boolean; error?: string }> {
      try {
        const res = await api.prds.createTemplate(body as any);
        if (res.ok) {
          templates = [...templates, res.data];
          return { ok: true };
        }
        return { ok: false, error: (res as any).error || 'Failed to create template' };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    async updateTemplate(
      templateId: string,
      body: Record<string, any>,
    ): Promise<{ ok: boolean; error?: string }> {
      try {
        const res = await api.prds.updateTemplate(templateId, body as any);
        if (res.ok) {
          templates = templates.map((t) => (t.id === templateId ? res.data : t));
          return { ok: true };
        }
        return { ok: false, error: (res as any).error || 'Failed to update template' };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    async deleteTemplate(templateId: string): Promise<{ ok: boolean; error?: string }> {
      try {
        const res = await api.prds.deleteTemplate(templateId);
        if (res.ok) {
          templates = templates.filter((t) => t.id !== templateId);
          if (selectedTemplateId === templateId) selectedTemplateId = null;
          return { ok: true };
        }
        return { ok: false, error: (res as any).error || 'Failed to delete template' };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    async createStoryFromTemplate(
      prdId: string,
      templateId: string,
      variables?: Record<string, string>,
    ): Promise<{ ok: boolean; error?: string }> {
      try {
        const res = await api.prds.createStoryFromTemplate(prdId, templateId, variables);
        if (res.ok) {
          // Reload the PRD to show the new story
          await this.loadPrd(prdId);
          return { ok: true };
        }
        return { ok: false, error: (res as any).error || 'Failed to create story from template' };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    // --- Priority Recommendations ---

    setRecommendingPriorityStoryId(id: string | null) {
      recommendingPriorityStoryId = id;
    },

    clearPriorityRecommendation() {
      recommendingPriorityStoryId = null;
      recommendingPriority = false;
      priorityRecommendationResult = null;
      priorityRecommendationError = null;
    },

    clearBulkPriorityResult() {
      recommendingAllPriorities = false;
      bulkPriorityResult = null;
    },

    async recommendPriority(
      prdId: string,
      storyId: string,
    ): Promise<{ ok: boolean; error?: string }> {
      recommendingPriority = true;
      priorityRecommendationError = null;
      priorityRecommendationResult = null;
      recommendingPriorityStoryId = storyId;
      try {
        const res = await api.prds.recommendPriority(prdId, storyId);
        if (res.ok) {
          priorityRecommendationResult = res.data.recommendation;
          // Reload PRD to reflect the persisted recommendation
          await this.loadPrd(prdId);
          return { ok: true };
        }
        priorityRecommendationError = (res as any).error || 'Priority recommendation failed';
        return { ok: false, error: priorityRecommendationError ?? undefined };
      } catch (err) {
        priorityRecommendationError = String(err);
        return { ok: false, error: priorityRecommendationError ?? undefined };
      } finally {
        recommendingPriority = false;
      }
    },

    async acceptPriority(
      prdId: string,
      storyId: string,
      priority: string,
      accept: boolean,
    ): Promise<{ ok: boolean; error?: string }> {
      try {
        const res = await api.prds.acceptPriority(prdId, storyId, priority, accept);
        if (res.ok) {
          await this.loadPrd(prdId);
          return { ok: true };
        }
        return { ok: false, error: (res as any).error || 'Failed to update priority' };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    async recommendAllPriorities(prdId: string): Promise<{ ok: boolean; error?: string }> {
      recommendingAllPriorities = true;
      bulkPriorityResult = null;
      try {
        const res = await api.prds.recommendAllPriorities(prdId);
        if (res.ok) {
          bulkPriorityResult = res.data;
          await this.loadPrd(prdId);
          return { ok: true };
        }
        return { ok: false, error: (res as any).error || 'Bulk priority recommendation failed' };
      } catch (err) {
        return { ok: false, error: String(err) };
      } finally {
        recommendingAllPriorities = false;
      }
    },

    // --- Effort vs Value Matrix ---

    setMatrixFilterQuadrant(quadrant: MatrixQuadrant | null) {
      matrixFilterQuadrant = quadrant;
    },

    clearEffortValueMatrix() {
      effortValueMatrix = null;
      matrixFilterQuadrant = null;
    },

    /** Adjust a story's position in the matrix manually */
    adjustStoryPosition(storyId: string, effortScore: number, valueScore: number) {
      matrixManualPositions = {
        ...matrixManualPositions,
        [storyId]: { effortScore, valueScore },
      };
      // Recompute matrix if it exists
      if (effortValueMatrix) {
        const prd = prds.find((p) => p.id === effortValueMatrix!.prdId);
        if (prd) {
          this.computeEffortValueMatrix(prd.id);
        }
      }
    },

    /** Reset a manual position adjustment */
    resetStoryPosition(storyId: string) {
      const { [storyId]: _, ...rest } = matrixManualPositions;
      matrixManualPositions = rest;
      if (effortValueMatrix) {
        const prd = prds.find((p) => p.id === effortValueMatrix!.prdId);
        if (prd) {
          this.computeEffortValueMatrix(prd.id);
        }
      }
    },

    /** Compute the effort-value matrix from existing story data */
    computeEffortValueMatrix(prdId: string): EffortValueMatrix | null {
      const prd = prds.find((p) => p.id === prdId);
      if (!prd || !prd.stories?.length) {
        effortValueMatrix = null;
        return null;
      }

      const plotted: MatrixStoryPosition[] = [];
      const excluded: EffortValueMatrix['excludedStories'] = [];

      for (const story of prd.stories) {
        // Check if story has been manually positioned
        const manualPos = matrixManualPositions[story.id];
        if (manualPos) {
          plotted.push({
            storyId: story.id,
            title: story.title,
            status: story.status,
            priority: story.priority,
            effortScore: manualPos.effortScore,
            valueScore: manualPos.valueScore,
            quadrant: computeQuadrant(manualPos.effortScore, manualPos.valueScore),
            storyPoints: story.estimate?.storyPoints ?? null,
            size: story.estimate?.size ?? null,
            isManualPosition: true,
          });
          continue;
        }

        // Compute effort from estimate
        const effortScore = computeEffortScore(story);
        // Compute value from priority and acceptance criteria
        const valueScore = computeValueScore(story);

        if (effortScore === null || valueScore === null) {
          const reasons: string[] = [];
          if (effortScore === null) reasons.push('no estimate');
          if (valueScore === null) reasons.push('missing priority data');
          excluded.push({
            storyId: story.id,
            title: story.title,
            reason: reasons.join(', '),
          });
          continue;
        }

        plotted.push({
          storyId: story.id,
          title: story.title,
          status: story.status,
          priority: story.priority,
          effortScore,
          valueScore,
          quadrant: computeQuadrant(effortScore, valueScore),
          storyPoints: story.estimate?.storyPoints ?? null,
          size: story.estimate?.size ?? null,
          isManualPosition: false,
        });
      }

      const quadrantCounts: Record<MatrixQuadrant, number> = {
        quick_wins: 0,
        major_projects: 0,
        fill_ins: 0,
        low_priority: 0,
      };
      for (const s of plotted) {
        quadrantCounts[s.quadrant]++;
      }

      const matrix: EffortValueMatrix = {
        prdId,
        stories: plotted,
        quadrantCounts,
        totalPlotted: plotted.length,
        excludedStories: excluded,
      };

      effortValueMatrix = matrix;
      return matrix;
    },

    // --- Sprint planning (chat) ---

    async startPlanning(
      prdId: string,
      workspacePath: string,
      mode: PlanMode,
      userPrompt?: string,
    ): Promise<{ conversationId: string; mode: string } | null> {
      loading = true;
      try {
        const res = await api.prds.plan(prdId, {
          mode,
          editMode,
          userPrompt,
        });
        if (res.ok) {
          planConversationId = res.data.conversationId;
          planPrdId = prdId;
          return res.data;
        }
        return null;
      } catch (err) {
        console.error('[loop] Failed to start planning:', err);
        return null;
      } finally {
        loading = false;
      }
    },
  };
}

export const loopStore = createLoopStore();

/** Check if a story is currently being executed (serial or parallel). */
export function isStoryActive(loop: LoopState | null | undefined, storyId: string): boolean {
  if (!loop) return false;
  return loop.currentStoryId === storyId || loop.activeStoryIds?.includes(storyId) === true;
}

// HMR state preservation — keep active loop state across hot module reloads
if (import.meta.hot) {
  const hmrData = import.meta.hot.data as
    | {
        activeLoop?: LoopState | null;
        log?: IterationLogEntry[];
        activeLoopChecked?: boolean;
        standaloneStoryCount?: number;
      }
    | undefined;

  if (hmrData?.activeLoop) {
    loopStore._hmrRestore({
      activeLoop: hmrData.activeLoop,
      log: hmrData.log ?? [],
      activeLoopChecked: hmrData.activeLoopChecked ?? false,
      standaloneStoryCount: hmrData.standaloneStoryCount ?? 0,
    });

    // Reconnect SSE stream if loop is still active
    const loop = loopStore.activeLoop;
    if (loop && loop.status === 'running') {
      loopStore.connectEvents(loop.id);
    }
    // Re-sync golem store from restored loop state
    if (loop && (loop.status === 'running' || loop.status === 'paused')) {
      loopStore.syncGolemFromLoop(loop);
    }
  }

  import.meta.hot.dispose((data: Record<string, unknown>) => {
    // Disconnect SSE before module is replaced to avoid orphaned streams
    loopStore.disconnectEvents();
    loopStore.disconnectPrdEvents();

    try {
      data.activeLoop = loopStore.activeLoop
        ? JSON.parse(JSON.stringify(loopStore.activeLoop))
        : null;
      data.log = JSON.parse(JSON.stringify(loopStore.log));
      data.activeLoopChecked = loopStore.activeLoopChecked;
      // standaloneStoryCount is accessed via getter in the store
      data.standaloneStoryCount = loopStore.totalStories;
    } catch {
      // Serialization failed — will be recovered from server
    }
  });
}
