<script lang="ts">
  import { loopStore, isStoryActive } from '$lib/stores/loop.svelte';
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { streamStore } from '$lib/stores/stream.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { uiStore } from '$lib/stores/ui.svelte';
  import { workStore } from '$lib/stores/work.svelte';
  import { primaryPaneStore } from '$lib/stores/primaryPane.svelte';
  import { api } from '$lib/api/client';
  import { sendAndStream } from '$lib/api/sse';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import type { PlanMode, LoopConfig, UserStory } from '@e/shared';
  import DependencyView from '$lib/components/planning/DependencyView.svelte';

  let workspacePath = $derived(settingsStore.workspacePath || '');
  let importJson = $state('');
  let showImport = $state(false);
  let showCreate = $state(false);
  let showAddStory = $state(false);
  let newPrdName = $state('');
  let newPrdDesc = $state('');
  let newStoryTitle = $state('');
  let newStoryDesc = $state('');
  let newStoryCriteria = $state('');
  let logEl = $state<HTMLDivElement>();
  let workingStoryId = $state<string | null>(null);

  onMount(() => {
    if (workspacePath) {
      loopStore.loadPrds(workspacePath);
    }
    loopStore.loadActiveLoop();
  });

  // Auto-scroll log to top (newest entries are first)
  $effect(() => {
    if (logEl && loopStore.log.length) {
      logEl.scrollTop = 0;
    }
  });

  function statusLabel(status: string): string {
    switch (status) {
      case 'completed':
        return 'DONE';
      case 'qa':
        return 'QA';
      case 'in_progress':
        return 'WIP';
      case 'failed':
        return 'FAIL';
      case 'failed_timeout':
        return 'T/O';
      case 'skipped':
        return 'SKIP';
      case 'archived':
        return 'ARCH';
      default:
        return 'TODO';
    }
  }

  function statusClass(status: string): string {
    switch (status) {
      case 'completed':
        return 'status-completed';
      case 'qa':
        return 'status-qa';
      case 'in_progress':
        return 'status-in-progress';
      case 'failed':
      case 'failed_timeout':
        return 'status-failed';
      case 'archived':
        return 'status-archived';
      default:
        return 'status-pending';
    }
  }

  function priorityLabel(p: string): string {
    return p === 'critical' ? '!!!' : p === 'high' ? '!!' : p === 'medium' ? '!' : '';
  }

  /** Status sort order: failed → in_progress → pending → qa → completed → skipped → archived */
  const statusOrder: Record<string, number> = {
    failed: 0,
    failed_timeout: 1,
    in_progress: 2,
    pending: 3,
    qa: 4,
    completed: 5,
    skipped: 6,
    archived: 7,
  };

  function sortByStatus<T extends { status: string }>(stories: T[]): T[] {
    return [...stories].sort(
      (a, b) => (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99),
    );
  }

  /**
   * A story is golem-eligible if it's pending, within attempt limits,
   * not research-only, and all dependencies are met (completed/qa/skipped/archived).
   */
  function isGolemEligible(story: UserStory, allStories: UserStory[]): boolean {
    if (story.status !== 'pending') return false;
    if (story.attempts >= story.maxAttempts) return false;
    if (story.researchOnly) return false;
    const deps = story.dependsOn || [];
    if (deps.length === 0) return true;
    const doneStatuses = new Set(['completed', 'qa', 'skipped', 'archived']);
    return deps.every((depId) => {
      const dep = allStories.find((s) => s.id === depId);
      return dep && doneStatuses.has(dep.status);
    });
  }

  async function handleCreate() {
    if (!newPrdName.trim() || !workspacePath) return;
    try {
      const res = await api.prds.create({
        workspacePath: workspacePath,
        name: newPrdName.trim(),
        description: newPrdDesc.trim(),
        stories: [],
      });
      if (res.ok) {
        loopStore.setSelectedPrdId(res.data.id);
        await loopStore.loadPrds(workspacePath);
        await loopStore.loadPrd(res.data.id);
        showCreate = false;
        newPrdName = '';
        newPrdDesc = '';
        uiStore.toast(`Created PRD: ${newPrdName}`, 'success');
      }
    } catch (err) {
      uiStore.toast(`Create failed: ${err}`, 'error');
    }
  }

  async function handleImport() {
    if (!importJson.trim() || !workspacePath) return;
    try {
      const parsed = JSON.parse(importJson);
      const res = await api.prds.import(workspacePath, parsed);
      if (res.ok) {
        loopStore.setSelectedPrdId(res.data.id);
        await loopStore.loadPrds(workspacePath);
        await loopStore.loadPrd(res.data.id);
        showImport = false;
        importJson = '';
        uiStore.toast(`Imported ${res.data.imported} stories`, 'success');
      }
    } catch (err) {
      uiStore.toast(`Import failed: ${err}`, 'error');
    }
  }

  async function handleAddStory() {
    const prdId = loopStore.selectedPrdId;
    if (!prdId || !newStoryTitle.trim()) return;
    try {
      const criteria = newStoryCriteria.split('\n').filter((l) => l.trim());
      await api.prds.addStory(prdId, {
        title: newStoryTitle,
        description: newStoryDesc,
        acceptanceCriteria: criteria,
        priority: 'medium',
      });
      await loopStore.loadPrd(prdId);
      newStoryTitle = '';
      newStoryDesc = '';
      newStoryCriteria = '';
      showAddStory = false;
    } catch (err) {
      uiStore.toast(`Failed to add story: ${err}`, 'error');
    }
  }

  async function handleDeleteStory(storyId: string) {
    const prdId = loopStore.selectedPrdId;
    if (!prdId) return;
    await api.prds.deleteStory(prdId, storyId);
    await loopStore.loadPrd(prdId);
  }

  async function handleArchiveStory(storyId: string) {
    const prdId = loopStore.selectedPrdId;
    if (!prdId) return;
    await api.prds.updateStory(prdId, storyId, { status: 'archived' });
    await loopStore.loadPrd(prdId);
  }

  async function handleArchiveAllCompleted() {
    const prdId = loopStore.selectedPrdId;
    if (!prdId) return;
    await api.prds.archiveCompletedPrdStories(prdId);
    await loopStore.loadPrd(prdId);
  }

  let prdCompletedStories = $derived(
    (loopStore.selectedPrd?.stories || []).filter((s: any) => s.status === 'completed'),
  );

  async function handleDeletePrd() {
    const prdId = loopStore.selectedPrdId;
    if (!prdId) return;
    if (!confirm('Delete this PRD and all its stories?')) return;
    await api.prds.delete(prdId);
    loopStore.setSelectedPrdId(null);
    await loopStore.loadPrds(workspacePath);
  }

  function openLoopConfig() {
    uiStore.openModal('loop-config');
  }

  // --- Hold-to-start-with-defaults logic ---
  const HOLD_DURATION = 800; // ms to hold for quick-start
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let holdStartTime = $state(0);
  let holdProgress = $state(0);
  let isHolding = $state(false);
  let holdCompleted = $state(false);
  let holdAnimFrame: number | null = null;

  function getDefaultConfig(): LoopConfig {
    const isStandaloneLoop = !loopStore.selectedPrdId;
    const storyCount = isStandaloneLoop
      ? workStore.standaloneStories.filter(
          (s) => s.status === 'pending' || s.status === 'in_progress',
        ).length
      : (loopStore.selectedPrd?.stories?.filter(
          (s: any) => s.status === 'pending' || s.status === 'in_progress',
        ).length ?? 0);
    const maxAttempts = 3;
    const maxFixUps = 2;
    return {
      maxIterations: Math.max(10, storyCount * maxAttempts * (1 + maxFixUps)),
      maxAttemptsPerStory: maxAttempts,
      maxFixUpAttempts: maxFixUps,
      model: settingsStore.model,
      effort: settingsStore.effort || 'high',
      autoCommit: true,
      autoSnapshot: true,
      pauseOnFailure: false,
      qualityChecks: [
        {
          id: 'default-tc',
          type: 'typecheck',
          name: 'Typecheck',
          command: 'bun run check',
          timeout: 60000,
          required: true,
          enabled: true,
        },
      ],
    };
  }

  function animateHold() {
    if (!isHolding) return;
    const elapsed = Date.now() - holdStartTime;
    holdProgress = Math.min(elapsed / HOLD_DURATION, 1);
    if (holdProgress >= 1) {
      holdCompleted = true;
      isHolding = false;
      startLoopWithDefaults();
      return;
    }
    holdAnimFrame = requestAnimationFrame(animateHold);
  }

  function onHoldStart(e: PointerEvent) {
    if (!loopStore.selectedPrdId) return;
    // Only trigger on primary button (left click)
    if (e.button !== 0) return;
    holdCompleted = false;
    isHolding = true;
    holdStartTime = Date.now();
    holdProgress = 0;
    holdAnimFrame = requestAnimationFrame(animateHold);
    // Set a timer for haptic-like complete
    holdTimer = setTimeout(() => {
      // animateHold will handle the completion
    }, HOLD_DURATION + 50);
  }

  function onHoldEnd() {
    if (holdAnimFrame) {
      cancelAnimationFrame(holdAnimFrame);
      holdAnimFrame = null;
    }
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
    if (isHolding && !holdCompleted) {
      // Released before hold completed → normal click → open config
      isHolding = false;
      holdProgress = 0;
      openLoopConfig();
    }
    // Reset after a short delay to allow the completion animation to flash
    if (holdCompleted) {
      setTimeout(() => {
        holdProgress = 0;
        holdCompleted = false;
      }, 400);
    } else {
      isHolding = false;
      holdProgress = 0;
    }
  }

  async function startLoopWithDefaults() {
    const prdId = loopStore.selectedPrdId;
    const workspacePath = settingsStore.workspacePath;
    if (!workspacePath) return;

    const config = getDefaultConfig();

    try {
      if (!prdId) {
        const standaloneCount = workStore.standaloneStories.filter(
          (s) => s.status === 'pending' || s.status === 'in_progress',
        ).length;
        loopStore.setStandaloneStoryCount(standaloneCount);
      }

      const result = await loopStore.startLoop(prdId ?? null, workspacePath, config);
      if (result.ok) {
        uiStore.toast('Golem activated with defaults', 'success');
      } else {
        uiStore.toast(result.error || 'Failed to activate Golem', 'error');
      }
    } catch (err) {
      uiStore.toast(`Failed to activate Golem: ${err}`, 'error');
    }
  }

  function actionLabel(action: string): string {
    const map: Record<string, string> = {
      started: '▶',
      passed: '✓',
      failed: '✗',
      committed: '⟨⟩',
      quality_check: '⚙',
      learning: '※',
      skipped: '⊘',
    };
    return map[action] || action;
  }

  function actionColor(action: string): string {
    switch (action) {
      case 'passed':
      case 'committed':
        return 'var(--accent-secondary)';
      case 'failed':
        return 'var(--accent-error)';
      case 'started':
        return 'var(--accent-primary)';
      default:
        return 'var(--text-tertiary)';
    }
  }

  function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  let planning = $state(false);
  let showDependencies = $state(false);

  // Auto-validate sprint when PRD is selected/changed
  $effect(() => {
    const prdId = loopStore.selectedPrdId;
    if (prdId && loopStore.selectedPrd?.stories?.length) {
      loopStore.validateSprint(prdId);
    }
  });

  function openGenerateModal() {
    uiStore.openModal('story-generate');
  }

  function openRefineModal(storyId: string) {
    loopStore.clearRefinement();
    loopStore.setRefiningStoryId(storyId);
    uiStore.openModal('story-refine');
  }

  function openValidateModal(storyId: string) {
    loopStore.clearCriteriaValidation();
    loopStore.setValidatingCriteriaStoryId(storyId);
    uiStore.openModal('criteria-validation');
  }

  function openEstimateModal(storyId: string) {
    loopStore.clearEstimation();
    loopStore.setEstimatingStoryId(storyId);
    uiStore.openModal('story-estimate');
  }

  function openSprintPlanModal() {
    loopStore.clearSprintPlan();
    uiStore.openModal('sprint-plan');
  }

  function openCompletenessModal() {
    loopStore.clearCompleteness();
    uiStore.openModal('prd-completeness');
  }

  function openTemplateLibrary() {
    loopStore.clearTemplates();
    uiStore.openModal('template-library');
  }

  function openPriorityModal(storyId: string) {
    loopStore.clearPriorityRecommendation();
    loopStore.setRecommendingPriorityStoryId(storyId);
    uiStore.openModal('priority-recommendation');
  }

  function openEffortValueMatrix() {
    loopStore.clearEffortValueMatrix();
    uiStore.openModal('effort-value-matrix');
  }

  function openCreateStoryModal() {
    loopStore.setEditingStoryId(null);
    uiStore.openModal('story-create');
  }

  function openEditStoryModal(storyId: string) {
    loopStore.setEditingStoryId(storyId);
    uiStore.openModal('story-create');
  }

  /**
   * Start working on a story interactively (pair programming mode).
   * Creates a conversation with the story context and opens it.
   */
  async function workInteractively(story: UserStory) {
    workingStoryId = story.id;
    try {
      // Build system prompt with story context
      const criteriaText =
        story.acceptanceCriteria.length > 0
          ? `## Acceptance Criteria\n${story.acceptanceCriteria.map((ac, i) => `${i + 1}. ${ac.description}`).join('\n')}`
          : '';
      const systemPrompt = `You are assisting the user with implementing this user story:

# Story: ${story.title}
Story ID: ${story.id}

${story.description || '(No description provided)'}

${criteriaText}

${story.estimate ? `## Estimate\nSize: ${story.estimate.size} (${story.estimate.storyPoints} points)\nConfidence: ${story.estimate.confidence} (${story.estimate.confidenceScore}%)\n${story.estimate.reasoning || ''}` : ''}

---

Work with the user to implement this story. Ask clarifying questions if needed, propose implementation approaches, and write code together. The goal is to complete the story successfully by meeting all acceptance criteria.`;

      // Create conversation with story context
      const res = await api.conversations.create({
        title: `📋 ${story.title}`,
        systemPrompt,
        workspacePath: workspacePath || undefined,
      });

      if (res.ok) {
        const conversationId = res.data.id;

        // Navigate to the conversation first
        await goto(`/?conversation=${conversationId}`);

        // Load the conversation
        const convRes = await api.conversations.get(conversationId);
        if (convRes.ok) {
          conversationStore.setActive(convRes.data);

          // Send initial message to kick off the collaboration — include full story
          // context in the message body so it's visible even in external CLI mode
          const acSection =
            story.acceptanceCriteria.length > 0
              ? `\n\n## Acceptance Criteria\n${story.acceptanceCriteria.map((ac, i) => `${i + 1}. ${ac.description}`).join('\n')}`
              : '';
          const initialMessage = `Let's work on implementing this story together:

## ${story.title}

${story.description || '(No description provided)'}${acSection}

Where would you like to start?`;

          await sendAndStream(conversationId, initialMessage);
        }

        uiStore.toast('Started interactive session for story', 'success');
      }
    } catch (err: any) {
      uiStore.toast(err.message || 'Failed to start interactive session', 'error');
    } finally {
      workingStoryId = null;
    }
  }

  let estimatingAll = $state(false);
  let recommendingAllPriorities = $state(false);
  let showStoriesMenu = $state(false);
  let storyMenuId = $state<string | null>(null);
  let resettingStoryId = $state<string | null>(null);
  let resettingAllFailed = $state(false);

  function closeStoriesMenu() {
    showStoriesMenu = false;
  }

  function toggleStoriesMenu() {
    showStoriesMenu = !showStoriesMenu;
  }

  function toggleStoryMenu(storyId: string) {
    storyMenuId = storyMenuId === storyId ? null : storyId;
  }

  function closeStoryMenu() {
    storyMenuId = null;
  }

  async function recommendAllPriorities() {
    const prdId = loopStore.selectedPrdId;
    if (!prdId || recommendingAllPriorities) return;
    recommendingAllPriorities = true;
    try {
      const result = await loopStore.recommendAllPriorities(prdId);
      if (result.ok) {
        const summary = loopStore.bulkPriorityResult?.summary;
        if (summary) {
          uiStore.toast(
            `Priority recommendations: ${summary.changedCount} changes suggested (${summary.criticalCount}C/${summary.highCount}H/${summary.mediumCount}M/${summary.lowCount}L)`,
            'success',
          );
        } else {
          uiStore.toast('All priorities analyzed', 'success');
        }
      } else {
        uiStore.toast(result.error || 'Priority recommendation failed', 'error');
      }
    } finally {
      recommendingAllPriorities = false;
    }
  }

  async function estimateAllStories() {
    const prdId = loopStore.selectedPrdId;
    if (!prdId || estimatingAll) return;
    estimatingAll = true;
    try {
      const result = await loopStore.estimateAllStories(prdId);
      if (result.ok) {
        const summary = loopStore.prdEstimationResult?.summary;
        if (summary) {
          uiStore.toast(
            `Estimated ${summary.smallCount + summary.mediumCount + summary.largeCount} stories (${summary.totalPoints} total points)`,
            'success',
          );
        } else {
          uiStore.toast('All stories estimated', 'success');
        }
      } else {
        uiStore.toast(result.error || 'Estimation failed', 'error');
      }
    } finally {
      estimatingAll = false;
    }
  }

  let prdFailedStories = $derived(
    (loopStore.selectedPrd?.stories || []).filter((s: any) => s.status === 'failed'),
  );

  async function handleResetStory(storyId: string) {
    resettingStoryId = storyId;
    try {
      const result = await loopStore.resetStory(storyId);
      if (result.ok) {
        if (loopStore.selectedPrdId) await loopStore.loadPrd(loopStore.selectedPrdId);
        uiStore.toast('Story reset to pending', 'success');
      } else {
        uiStore.toast(result.error || 'Failed to reset story', 'error');
      }
    } finally {
      resettingStoryId = null;
    }
  }

  async function handleResetAllFailed() {
    const prdId = loopStore.selectedPrdId;
    if (!prdId || !workspacePath) return;
    resettingAllFailed = true;
    try {
      const result = await loopStore.resetFailedAndRestart(prdId, workspacePath);
      if (result.ok) {
        await loopStore.loadPrd(prdId);
        uiStore.toast(`Reset ${result.resetCount ?? 0} failed stories`, 'success');
      } else {
        uiStore.toast(result.error || 'Failed to reset stories', 'error');
      }
    } finally {
      resettingAllFailed = false;
    }
  }

  function estimateSizeColor(size: string): string {
    switch (size) {
      case 'small':
        return 'var(--accent-secondary)';
      case 'medium':
        return 'var(--accent-warning, #e6a817)';
      case 'large':
        return 'var(--accent-error)';
      default:
        return 'var(--text-tertiary)';
    }
  }

  function estimateSizeLabel(size: string): string {
    return size === 'small' ? 'S' : size === 'medium' ? 'M' : 'L';
  }

  let totalStoryPoints = $derived(
    (loopStore.selectedPrd?.stories || []).reduce(
      (sum, s) => sum + (s.estimate?.storyPoints || 0),
      0,
    ),
  );

  let estimatedCount = $derived(
    (loopStore.selectedPrd?.stories || []).filter((s) => s.estimate).length,
  );

  async function startPlanning(mode: PlanMode) {
    if (!loopStore.selectedPrdId || planning) return;

    // For 'generate' mode, open the dedicated modal instead
    if (mode === 'generate') {
      openGenerateModal();
      return;
    }

    planning = true;
    try {
      const result = await loopStore.startPlanning(loopStore.selectedPrdId, workspacePath, mode);
      if (!result) {
        uiStore.toast('Failed to start planning session', 'error');
        return;
      }

      // Load the conversation into the main chat pane
      const convRes = await api.conversations.get(result.conversationId);
      conversationStore.setActive(convRes.data);
      streamStore.reset();

      // For chat-generate mode, send the first message immediately
      if (mode === 'chat-generate') {
        await sendAndStream(
          result.conversationId,
          "Let's plan this sprint. Review the PRD description and any existing stories, then suggest what we should build. Ask me clarifying questions if needed.",
        );
      }

      uiStore.toast(`Planning session started`, 'success');
    } catch (err) {
      uiStore.toast(`Planning failed: ${err}`, 'error');
    } finally {
      planning = false;
    }
  }
</script>

<div class="loop-panel">
  {#if loopStore.isActive}
    <div class="section-header">
      <span
        class="loop-badge"
        class:running={loopStore.isRunning}
        class:paused={loopStore.isPaused}
      >
        {loopStore.isRunning ? 'Running' : 'Paused'}
      </span>
    </div>
  {/if}

  <!-- PRD Selection -->
  <div class="prd-section">
    <div class="prd-select-row">
      <select
        value={loopStore.selectedPrdId || ''}
        onchange={(e) => {
          const val = (e.target as HTMLSelectElement).value;
          loopStore.setSelectedPrdId(val || null);
          if (val) loopStore.loadPrd(val);
        }}
      >
        <option value="">Select a PRD...</option>
        {#each loopStore.prds as prd}
          <option value={prd.id}>{prd.name}</option>
        {/each}
      </select>
      <button
        class="icon-btn"
        title="New PRD"
        onclick={() => {
          showCreate = !showCreate;
          showImport = false;
        }}
      >
        +
      </button>
      <button
        class="icon-btn"
        title="Import prd.json"
        onclick={() => {
          showImport = !showImport;
          showCreate = false;
        }}
      >
        ↓
      </button>
    </div>

    {#if showCreate}
      <div class="create-form">
        <input bind:value={newPrdName} placeholder="PRD name" />
        <textarea bind:value={newPrdDesc} placeholder="Description (optional)" rows="2"></textarea>
        <div class="import-actions">
          <button class="btn-sm btn-primary" onclick={handleCreate}>Create</button>
          <button
            class="btn-sm btn-ghost"
            onclick={() => {
              showCreate = false;
              newPrdName = '';
              newPrdDesc = '';
            }}>Cancel</button
          >
        </div>
      </div>
    {/if}

    {#if showImport}
      <div class="import-area">
        <textarea bind:value={importJson} placeholder="Paste prd.json content here..." rows="5"
        ></textarea>
        <div class="import-actions">
          <button class="btn-sm" onclick={handleImport}>Import</button>
          <button
            class="btn-sm btn-ghost"
            onclick={() => {
              showImport = false;
              importJson = '';
            }}>Cancel</button
          >
        </div>
      </div>
    {/if}
  </div>

  <!-- Sprint Planning -->
  {#if loopStore.selectedPrdId && !loopStore.isActive}
    <div class="plan-section">
      <div class="plan-row">
        <button
          class="btn-sm btn-plan"
          onclick={() => startPlanning('chat')}
          disabled={planning}
          title="Open a planning conversation with Claude"
        >
          Plan
        </button>
        <button
          class="btn-sm btn-plan"
          onclick={() => startPlanning('generate')}
          disabled={planning}
          title="AI-generate stories from PRD description with review"
        >
          Generate
        </button>
        <button
          class="btn-sm btn-plan"
          onclick={() => startPlanning('chat-generate')}
          disabled={planning}
          title="Chat to refine scope, then generate stories"
        >
          Plan + Gen
        </button>
      </div>
      <button
        class="edit-lock"
        onclick={() => {
          const next =
            loopStore.editMode === 'locked'
              ? 'propose'
              : loopStore.editMode === 'propose'
                ? 'unlocked'
                : 'locked';
          loopStore.setEditMode(next);
        }}
        title={loopStore.editMode === 'locked'
          ? 'Claude will discuss stories in plain text only'
          : loopStore.editMode === 'propose'
            ? 'Claude will propose structured edits for your approval'
            : 'Claude will apply edits automatically'}
      >
        <span class="lock-icon"
          >{loopStore.editMode === 'locked'
            ? '▣'
            : loopStore.editMode === 'propose'
              ? '▥'
              : '▢'}</span
        >
        <span class="lock-label"
          >{loopStore.editMode === 'locked'
            ? 'Locked'
            : loopStore.editMode === 'propose'
              ? 'Propose'
              : 'Unlocked'}</span
        >
      </button>
    </div>
  {/if}

  <!-- Stories List -->
  {#if loopStore.selectedPrd}
    <div class="stories-section">
      <div class="section-header">
        <h4>
          Stories ({(loopStore.selectedPrd.stories || []).filter(
            (s) => s.status !== 'completed' && s.status !== 'skipped' && s.status !== 'archived',
          ).length}){#if totalStoryPoints > 0}<span
              class="total-points"
              title="{estimatedCount} of {loopStore.selectedPrd.stories?.length || 0} estimated"
            >
              · {totalStoryPoints}pts</span
            >{/if}
        </h4>
        <div class="header-actions">
          {#if prdCompletedStories.length > 0}
            <button
              class="icon-btn archive-all-icon"
              title="Archive all completed"
              onclick={handleArchiveAllCompleted}
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
                <polyline points="21 8 21 21 3 21 3 8" /><rect
                  x="1"
                  y="3"
                  width="22"
                  height="5"
                /><line x1="10" y1="12" x2="14" y2="12" />
              </svg>
            </button>
          {/if}
          <button
            class="icon-btn"
            title="Quick add story"
            onclick={() => (showAddStory = !showAddStory)}>+</button
          >
          <button class="icon-btn" title="Create story (full form)" onclick={openCreateStoryModal}>
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
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="12" y1="18" x2="12" y2="12"></line>
              <line x1="9" y1="15" x2="15" y2="15"></line>
            </svg>
          </button>
          <div class="stories-menu-wrap">
            <button
              class="icon-btn"
              class:active-btn={showStoriesMenu}
              title="Actions"
              onclick={toggleStoriesMenu}>⋯</button
            >
            {#if showStoriesMenu}
              <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
              <div class="stories-menu-backdrop" onclick={closeStoriesMenu}></div>
              <div class="stories-menu">
                <button
                  class="menu-item"
                  onclick={() => {
                    closeStoriesMenu();
                    estimateAllStories();
                  }}
                  disabled={estimatingAll}
                >
                  {#if estimatingAll}<span class="spinner-sm"></span>{:else}Estimate all{/if}
                </button>
                <button
                  class="menu-item"
                  onclick={() => {
                    closeStoriesMenu();
                    recommendAllPriorities();
                  }}
                  disabled={recommendingAllPriorities}
                >
                  {#if recommendingAllPriorities}<span class="spinner-sm"></span>{:else}Prioritize
                    all{/if}
                </button>
                <div class="menu-divider"></div>
                <button
                  class="menu-item"
                  onclick={() => {
                    closeStoriesMenu();
                    openSprintPlanModal();
                  }}>Sprint plan</button
                >
                <button
                  class="menu-item"
                  onclick={() => {
                    closeStoriesMenu();
                    openEffortValueMatrix();
                  }}>Effort / Value matrix</button
                >
                <button
                  class="menu-item"
                  onclick={() => {
                    closeStoriesMenu();
                    openCompletenessModal();
                  }}>PRD completeness</button
                >
                <button
                  class="menu-item"
                  onclick={() => {
                    closeStoriesMenu();
                    loopStore.clearRefineAll();
                    uiStore.openModal('prd-refine-all');
                  }}>Refine all stories</button
                >
                <button
                  class="menu-item"
                  onclick={() => {
                    closeStoriesMenu();
                    openTemplateLibrary();
                  }}>Story templates</button
                >
                <button
                  class="menu-item"
                  class:active-btn={showDependencies}
                  onclick={() => {
                    closeStoriesMenu();
                    showDependencies = !showDependencies;
                  }}
                >
                  {showDependencies ? 'Hide dependencies' : 'Dependencies'}
                </button>
                {#if prdFailedStories.length > 0}
                  <div class="menu-divider"></div>
                  <button
                    class="menu-item menu-item-warning"
                    disabled={resettingAllFailed}
                    onclick={() => {
                      closeStoriesMenu();
                      handleResetAllFailed();
                    }}
                  >
                    {#if resettingAllFailed}
                      <span class="spinner-sm"></span>
                    {:else}
                      Reset {prdFailedStories.length} failed
                    {/if}
                  </button>
                {/if}
                <div class="menu-divider"></div>
                <button
                  class="menu-item menu-item-danger"
                  onclick={() => {
                    closeStoriesMenu();
                    handleDeletePrd();
                  }}>Delete PRD</button
                >
              </div>
            {/if}
          </div>
        </div>
      </div>

      {#if showAddStory}
        <div class="add-story-form">
          <input bind:value={newStoryTitle} placeholder="Story title" />
          <textarea bind:value={newStoryDesc} placeholder="Description" rows="2"></textarea>
          <textarea
            bind:value={newStoryCriteria}
            placeholder="Acceptance criteria (one per line)"
            rows="3"
          ></textarea>
          <div class="import-actions">
            <button class="btn-sm" onclick={handleAddStory}>Add</button>
            <button class="btn-sm btn-ghost" onclick={() => (showAddStory = false)}>Cancel</button>
          </div>
        </div>
      {/if}

      <div class="story-list">
        {#if (loopStore.selectedPrd.stories || []).length === 0}
          <div class="empty-stories">
            <span class="empty-hint"
              >No stories yet. Click + for quick add or
              <button class="empty-create-link" onclick={openCreateStoryModal}>create one</button
              >.</span
            >
          </div>
        {:else}
          {#each sortByStatus(loopStore.selectedPrd.stories || []) as story (story.id)}
            {@const eligible = isGolemEligible(story, loopStore.selectedPrd.stories || [])}
            <div
              class="story-item"
              class:active={isStoryActive(loopStore.activeLoop, story.id)}
              class:golem-eligible={eligible && loopStore.isActive}
              class:golem-ineligible={!eligible && loopStore.isActive && story.status === 'pending'}
            >
              <div class="story-header">
                <span class="story-status {statusClass(story.status)}">
                  {statusLabel(story.status)}
                </span>
                {#if loopStore.isActive && eligible}
                  <span class="eligible-indicator" title="Eligible for golem">▸</span>
                {:else if loopStore.isActive && story.status === 'pending' && story.attempts >= story.maxAttempts}
                  <span
                    class="exhausted-indicator"
                    title="Max attempts reached ({story.attempts}/{story.maxAttempts})">⊘</span
                  >
                  <span class="attempts-badge">{story.attempts}/{story.maxAttempts}</span>
                {:else if loopStore.isActive && story.status === 'pending' && !eligible && (story.dependsOn || []).length > 0}
                  <span class="blocked-indicator" title="Blocked by dependencies">⏳</span>
                {/if}
                <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
                <span
                  class="story-title"
                  class:clickable={!loopStore.isActive}
                  onclick={() => !loopStore.isActive && openEditStoryModal(story.id)}
                  >{story.title}</span
                >
                {#if priorityLabel(story.priority)}
                  <span class="priority-badge">{priorityLabel(story.priority)}</span>
                {/if}
                {#if loopStore.isActive && story.attempts > 0 && story.attempts < story.maxAttempts}
                  <span class="attempts-badge">{story.attempts}/{story.maxAttempts}</span>
                {/if}
                {#if story.status === 'failed' || story.attempts > 0}
                  <button
                    class="reset-badge-btn"
                    title="Reset attempts ({story.attempts}/{story.maxAttempts}) and set back to pending"
                    disabled={resettingStoryId === story.id}
                    onclick={() => handleResetStory(story.id)}
                  >
                    {#if resettingStoryId === story.id}
                      <span class="spinner-sm"></span>
                    {:else}
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path d="M9 14 4 9l5-5" /><path
                          d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"
                        />
                      </svg>
                      Reset
                    {/if}
                  </button>
                {/if}
                {#if !loopStore.isActive}
                  {#if story.status === 'completed'}
                    <button
                      class="archive-btn"
                      title="Archive"
                      onclick={() => handleArchiveStory(story.id)}
                    >
                      <svg
                        width="11"
                        height="11"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <polyline points="21 8 21 21 3 21 3 8" /><rect
                          x="1"
                          y="3"
                          width="22"
                          height="5"
                        /><line x1="10" y1="12" x2="14" y2="12" />
                      </svg>
                    </button>
                  {/if}
                  <button
                    class="work-interactive-btn"
                    title="Work interactively (pair programming mode)"
                    disabled={workingStoryId === story.id}
                    onclick={() => workInteractively(story)}
                  >
                    {#if workingStoryId === story.id}
                      <span class="spinner-sm"></span>
                    {:else}
                      <svg
                        width="11"
                        height="11"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle
                          cx="9"
                          cy="7"
                          r="4"
                        /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path
                          d="M16 3.13a4 4 0 0 1 0 7.75"
                        />
                      </svg>
                      Pair
                    {/if}
                  </button>
                  <button
                    class="edit-story-btn"
                    title="Edit story"
                    onclick={() => openEditStoryModal(story.id)}
                  >
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                  </button>
                  <div class="story-menu-wrap">
                    <button
                      class="story-menu-trigger"
                      title="More actions"
                      onclick={() => toggleStoryMenu(story.id)}>⋯</button
                    >
                    {#if storyMenuId === story.id}
                      <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
                      <div class="story-menu-backdrop" onclick={closeStoryMenu}></div>
                      <div class="story-menu">
                        <button
                          class="menu-item"
                          onclick={() => {
                            closeStoryMenu();
                            openValidateModal(story.id);
                          }}
                        >
                          <span class="menu-icon">✓</span> Validate criteria
                        </button>
                        <button
                          class="menu-item"
                          onclick={() => {
                            closeStoryMenu();
                            openRefineModal(story.id);
                          }}
                        >
                          <span class="menu-icon">↻</span> Refine story
                        </button>
                        <button
                          class="menu-item"
                          onclick={() => {
                            closeStoryMenu();
                            openEstimateModal(story.id);
                          }}
                        >
                          <span class="menu-icon">⚖</span> Estimate complexity
                        </button>
                        <button
                          class="menu-item"
                          onclick={() => {
                            closeStoryMenu();
                            openPriorityModal(story.id);
                          }}
                        >
                          <span class="menu-icon">⇅</span> Recommend priority
                        </button>
                      </div>
                    {/if}
                  </div>
                  <button class="delete-btn" onclick={() => handleDeleteStory(story.id)}>×</button>
                {/if}
              </div>
              <div class="story-badges">
                {#if story.estimate}
                  <span
                    class="estimate-badge"
                    style:background={estimateSizeColor(story.estimate.size)}
                    title="{story.estimate.size} · {story.estimate
                      .storyPoints} points · Confidence: {story.estimate.confidence}{story.estimate
                      .isManualOverride
                      ? ' (manual)'
                      : ''}"
                  >
                    {estimateSizeLabel(story.estimate.size)}{story.estimate.storyPoints}
                  </span>
                {/if}
                {#if story.priorityRecommendation && story.priorityRecommendation.suggestedPriority !== story.priority && !story.priorityRecommendation.isManualOverride}
                  <span
                    class="priority-rec-badge"
                    title="AI suggests: {story.priorityRecommendation.suggestedPriority}"
                  >
                    ⇅{story.priorityRecommendation.suggestedPriority[0].toUpperCase()}
                  </span>
                {/if}
                {#if story.dependsOn?.length > 0}
                  <span class="dep-badge" title="Depends on {story.dependsOn.length} story(ies)">
                    ↑{story.dependsOn.length}
                  </span>
                {/if}
                {#if story.attempts > 0}
                  <span class="attempts-badge">
                    {story.attempts}/{story.maxAttempts} attempts
                  </span>
                {/if}
              </div>
            </div>
          {/each}
        {/if}
      </div>

      <!-- Dependency View (collapsible) -->
      {#if showDependencies && loopStore.selectedPrdId}
        <DependencyView prdId={loopStore.selectedPrdId} />
      {/if}
    </div>

    <!-- Sprint Validation Warnings -->
    {#if loopStore.sprintWarnings.length > 0 && !loopStore.isActive}
      <div class="sprint-warnings">
        <div class="section-header">
          <h4>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              ><path
                d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
              /><line x1="12" y1="9" x2="12" y2="13" /><line
                x1="12"
                y1="17"
                x2="12.01"
                y2="17"
              /></svg
            >
            Sprint Warnings ({loopStore.sprintWarnings.length})
          </h4>
        </div>
        <div class="warning-list">
          {#each loopStore.sprintWarnings as warning}
            <div
              class="sprint-warning-item"
              class:blocking={warning.type === 'blocked_story'}
              class:circular={warning.type === 'circular_dependency'}
            >
              <span class="warning-msg">{warning.message}</span>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  {/if}

  <!-- Loop Controls -->
  <div class="controls-section">
    {#if loopStore.isActive}
      <div class="progress-info">
        <div class="progress-bar-container">
          <div class="progress-bar" style:width="{loopStore.progress}%"></div>
        </div>
        <div class="progress-row">
          <span class="progress-text">
            {loopStore.completedStories}/{loopStore.totalStories} stories • Iteration {loopStore
              .activeLoop?.currentIteration || 0}
          </span>
          <button
            class="dashboard-btn"
            onclick={() => {
              if (loopStore.activeLoop?.id)
                primaryPaneStore.openLooperTab(loopStore.activeLoop.id, 'Looper');
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              ><path d="M17 1l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><path
                d="M7 23l-4-4 4-4"
              /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg
            >
            Dashboard
          </button>
        </div>
      </div>

      <div class="control-buttons">
        {#if loopStore.isRunning}
          <button class="btn-sm btn-warning" onclick={() => loopStore.pauseLoop()}
            ><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none"
              ><rect x="4" y="3" width="6" height="18" rx="1" /><rect
                x="14"
                y="3"
                width="6"
                height="18"
                rx="1"
              /></svg
            > Pause</button
          >
        {:else if loopStore.isPaused}
          <button class="btn-sm btn-primary" onclick={() => loopStore.resumeLoop()}
            ><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none"
              ><polygon points="5 3 19 12 5 21 5 3" /></svg
            > Resume</button
          >
        {/if}
        <button
          class="btn-sm btn-danger"
          onclick={() => {
            if (confirm('Cancel the Golem?')) loopStore.cancelLoop();
          }}
          ><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none"
            ><rect x="4" y="4" width="16" height="16" rx="2" /></svg
          > Cancel</button
        >
      </div>
    {:else if loopStore.activeLoopChecked}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="hold-btn-wrap">
        <button
          class="btn-sm btn-primary full-width hold-btn"
          class:holding={isHolding}
          class:hold-complete={holdCompleted}
          disabled={!loopStore.selectedPrdId}
          onpointerdown={onHoldStart}
          onpointerup={onHoldEnd}
          onpointerleave={onHoldEnd}
          onpointercancel={onHoldEnd}
        >
          <span class="hold-fill" style:width="{holdProgress * 100}%"></span>
          <span class="hold-label">
            {#if holdCompleted}
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="3"
                stroke-linecap="round"
                stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg
              > Starting...
            {:else if isHolding}
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none"
                ><polygon points="5 3 19 12 5 21 5 3" /></svg
              > Hold for Quick Start
            {:else}
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none"
                ><polygon points="5 3 19 12 5 21 5 3" /></svg
              > Activate Golem
            {/if}
          </span>
        </button>
        <span class="hold-hint">
          {#if !loopStore.selectedPrdId}
            Select a PRD first
          {:else}
            Click to configure · Hold to quick-start
          {/if}
        </span>
      </div>
    {/if}
  </div>

  <!-- Activity Log -->
  {#if loopStore.log.length > 0}
    <div class="log-section">
      <div class="section-header">
        <h4>Activity Log</h4>
        <span class="log-count">{loopStore.log.length}</span>
      </div>
      <div class="log-list" bind:this={logEl}>
        {#each [...loopStore.log].reverse() as entry}
          <div class="log-entry">
            <span class="log-time">{formatTime(entry.timestamp)}</span>
            <span class="log-action" style:color={actionColor(entry.action)}>
              {actionLabel(entry.action)}
            </span>
            <span class="log-detail">{entry.detail}</span>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .loop-panel {
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    height: 100%;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 4px 4px;
  }
  .section-header h4 {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-secondary);
  }

  .header-actions {
    display: flex;
    gap: 4px;
  }

  .stories-menu-wrap {
    position: relative;
  }
  .stories-menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 99;
  }
  .stories-menu {
    position: absolute;
    top: 100%;
    right: 0;
    z-index: 100;
    min-width: 170px;
    margin-top: 4px;
    padding: 4px 0;
    background: var(--bg-primary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  }
  .menu-item {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 5px 12px;
    font-size: var(--fs-xs);
    font-weight: 500;
    color: var(--text-secondary);
    background: none;
    border: none;
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
  }
  .menu-item:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .menu-item:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .menu-item.active-btn {
    color: var(--accent-primary);
    font-weight: 600;
    background: none !important;
    border: none !important;
  }
  .menu-item-danger:hover:not(:disabled) {
    color: var(--accent-error);
  }
  .menu-item-warning:hover:not(:disabled) {
    color: var(--accent-warning, #e6a817);
  }
  .menu-divider {
    height: 1px;
    margin: 4px 8px;
    background: var(--border-primary);
  }
  .menu-icon {
    width: 14px;
    text-align: center;
    flex-shrink: 0;
  }

  /* Per-story sandwich menu */
  .story-menu-wrap {
    position: relative;
  }
  .story-menu-trigger {
    font-size: var(--fs-sm);
    padding: 0 4px;
    color: var(--text-tertiary);
    opacity: 0;
    background: none;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    letter-spacing: 1px;
  }
  .story-item:hover .story-menu-trigger {
    opacity: 1;
  }
  .story-menu-trigger:hover {
    color: var(--text-primary);
  }
  .story-menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 99;
  }
  .story-menu {
    position: absolute;
    top: 100%;
    right: 0;
    z-index: 100;
    min-width: 170px;
    margin-top: 4px;
    padding: 4px 0;
    background: var(--bg-primary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  }

  .loop-badge {
    font-size: var(--fs-xxs);
    padding: 2px 10px;
    border-radius: var(--radius-sm);
    font-weight: 700;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }
  .loop-badge.running {
    background: var(--accent-primary);
    color: var(--text-on-accent);
    animation: loopBadgePulse 2s ease-in-out infinite;
    box-shadow: 0 0 8px color-mix(in srgb, var(--accent-primary) 50%, transparent);
  }
  .loop-badge.paused {
    background: var(--accent-warning, #e6a817);
    color: #000;
    box-shadow: 0 0 6px color-mix(in srgb, var(--accent-warning) 40%, transparent);
  }

  @keyframes loopBadgePulse {
    0%,
    100% {
      box-shadow: 0 0 6px color-mix(in srgb, var(--accent-primary) 40%, transparent);
    }
    50% {
      box-shadow:
        0 0 14px color-mix(in srgb, var(--accent-primary) 60%, transparent),
        0 0 24px color-mix(in srgb, var(--accent-primary) 25%, transparent);
    }
  }

  .prd-section select {
    width: 100%;
    padding: 6px 8px;
    font-size: var(--fs-sm);
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
  }

  .prd-select-row {
    display: flex;
    gap: 4px;
  }
  .prd-select-row select {
    flex: 1;
  }

  .icon-btn {
    padding: 4px 8px;
    font-size: var(--fs-md);
    border-radius: var(--radius-sm);
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    border: 1px solid var(--border-primary);
  }
  .icon-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .create-form,
  .import-area,
  .add-story-form {
    margin-top: 6px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .create-form input,
  .create-form textarea,
  .import-area textarea,
  .add-story-form textarea,
  .add-story-form input {
    width: 100%;
    padding: 6px 8px;
    font-size: var(--fs-xs);
    font-family: var(--font-mono);
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    resize: vertical;
  }
  .import-actions {
    display: flex;
    gap: 4px;
    justify-content: flex-end;
  }

  .story-list {
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }

  .empty-stories {
    padding: 16px 8px;
    text-align: center;
  }
  .empty-hint {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
  }
  .empty-create-link {
    color: var(--accent-primary);
    background: none;
    border: none;
    cursor: pointer;
    font-size: var(--fs-xs);
    text-decoration: underline;
    padding: 0;
  }
  .empty-create-link:hover {
    opacity: 0.8;
  }

  .story-item {
    padding: 6px 8px;
    border-radius: var(--radius-sm);
    margin-bottom: 2px;
    background: var(--bg-tertiary);
    transition: background var(--transition);
  }
  .story-item.active {
    background: var(--bg-active);
    border-left: 2px solid var(--accent-primary);
  }
  .story-item.golem-eligible {
    border-left: 2px solid var(--accent-primary, #7c5cfc);
  }
  .story-item.golem-ineligible {
    opacity: 0.55;
  }
  .eligible-indicator {
    font-size: 10px;
    color: var(--accent-primary, #7c5cfc);
    flex-shrink: 0;
    line-height: 1;
    margin-right: -2px;
  }
  .exhausted-indicator {
    font-size: 10px;
    color: var(--accent-error, #ef4444);
    flex-shrink: 0;
    line-height: 1;
    margin-right: -2px;
    opacity: 0.7;
  }
  .blocked-indicator {
    font-size: 10px;
    color: var(--accent-warning, #eab308);
    flex-shrink: 0;
    line-height: 1;
    margin-right: -2px;
    opacity: 0.7;
  }
  .story-header {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .story-status {
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.3px;
    flex-shrink: 0;
    padding: 1px 5px;
    border-radius: 3px;
    line-height: 1.4;
    font-family: var(--font-mono, monospace);
  }
  .status-completed {
    color: var(--accent-secondary);
    background: color-mix(in srgb, var(--accent-secondary) 12%, transparent);
  }
  .status-qa {
    color: var(--accent-warning, #f0ad4e);
    background: color-mix(in srgb, var(--accent-warning, #f0ad4e) 12%, transparent);
  }
  .status-in-progress {
    color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
  }
  .status-failed {
    color: var(--accent-error);
    background: color-mix(in srgb, var(--accent-error) 12%, transparent);
  }
  .status-pending {
    color: var(--text-tertiary);
    background: color-mix(in srgb, var(--text-tertiary) 10%, transparent);
  }
  .status-archived {
    color: var(--text-tertiary);
    background: color-mix(in srgb, var(--text-tertiary) 8%, transparent);
    opacity: 0.6;
  }
  .story-title {
    font-size: var(--fs-xs);
    color: var(--text-primary);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .story-title.clickable {
    cursor: pointer;
  }
  .story-title.clickable:hover {
    color: var(--accent-primary);
    text-decoration: underline;
  }
  .priority-badge {
    font-size: var(--fs-xxs);
    color: var(--accent-warning, #e6a817);
    font-weight: bold;
  }
  .work-interactive-btn {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: var(--fs-xxs);
    padding: 2px 6px;
    border-radius: 3px;
    background: var(--accent-primary);
    color: white;
    border: none;
    cursor: pointer;
    font-weight: 600;
    transition: all var(--transition);
    opacity: 0;
  }
  .story-item:hover .work-interactive-btn {
    opacity: 0.9;
  }
  .work-interactive-btn:hover:not(:disabled) {
    opacity: 1 !important;
    background: var(--accent-primary-hover, var(--accent-primary));
    transform: translateY(-1px);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  }
  .work-interactive-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
  }

  .edit-story-btn,
  .delete-btn,
  .archive-btn {
    font-size: var(--fs-sm);
    padding: 0 4px;
    color: var(--text-tertiary);
    opacity: 0;
    transition: opacity var(--transition);
    background: none;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
  }
  .story-item:hover .edit-story-btn,
  .story-item:hover .delete-btn,
  .story-item:hover .archive-btn {
    opacity: 1;
  }
  .edit-story-btn:hover {
    color: var(--accent-primary);
  }
  .delete-btn:hover {
    color: var(--accent-error);
  }
  .archive-btn:hover {
    color: var(--accent-primary);
  }
  .archive-all-icon {
    color: var(--text-tertiary);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .archive-all-icon:hover {
    color: var(--accent-primary);
  }

  .story-badges {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: 20px;
    margin-top: 2px;
  }

  .estimate-badge {
    font-size: var(--fs-xxs);
    padding: 0 4px;
    border-radius: 2px;
    color: #fff;
    font-weight: 700;
    flex-shrink: 0;
    letter-spacing: 0.3px;
  }

  .total-points {
    font-weight: 400;
    font-size: var(--fs-xs);
    color: var(--accent-primary);
  }

  .spinner-sm {
    display: inline-block;
    width: 10px;
    height: 10px;
    border: 2px solid transparent;
    border-top-color: var(--accent-primary);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  .priority-rec-badge {
    font-size: var(--fs-xxs);
    padding: 0 3px;
    border-radius: 2px;
    background: rgba(59, 130, 246, 0.15);
    color: var(--accent-primary);
    font-weight: 700;
    flex-shrink: 0;
  }

  .dep-badge {
    font-size: var(--fs-xxs);
    padding: 0 3px;
    border-radius: 2px;
    background: rgba(239, 68, 68, 0.15);
    color: var(--accent-error);
    font-weight: 700;
    flex-shrink: 0;
  }

  .active-btn {
    background: var(--accent-primary) !important;
    color: var(--text-on-accent) !important;
    border-color: var(--accent-primary) !important;
  }

  .attempts-badge {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    margin-left: 20px;
  }

  .reset-badge-btn {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: var(--fs-xxs);
    padding: 1px 6px;
    border-radius: 3px;
    background: rgba(239, 68, 68, 0.12);
    color: var(--accent-error);
    border: none;
    cursor: pointer;
    font-weight: 600;
    transition: all var(--transition);
  }
  .reset-badge-btn:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.25);
  }
  .reset-badge-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .sprint-warnings {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .warning-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 100px;
    overflow-y: auto;
  }
  .sprint-warning-item {
    padding: 4px 6px;
    font-size: var(--fs-xxs);
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
    background: rgba(230, 168, 23, 0.08);
    border-left: 2px solid var(--accent-warning, #e6a817);
    line-height: 1.3;
  }
  .sprint-warning-item.blocking {
    border-left-color: var(--accent-error);
    background: rgba(239, 68, 68, 0.08);
  }
  .sprint-warning-item.circular {
    border-left-color: var(--accent-error);
    background: rgba(239, 68, 68, 0.12);
  }
  .warning-msg {
    word-break: break-word;
  }

  .controls-section {
    padding: 4px 0;
  }

  .progress-info {
    margin-bottom: 8px;
  }
  .progress-bar-container {
    height: 4px;
    background: var(--bg-tertiary);
    border-radius: 2px;
    overflow: hidden;
    margin-bottom: 4px;
  }
  .progress-bar {
    height: 100%;
    background: var(--accent-primary);
    border-radius: 2px;
    transition: width 0.3s ease;
  }
  .progress-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .progress-text {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
  }
  .dashboard-btn {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: var(--fs-xxs);
    color: var(--accent-primary);
    background: none;
    border: none;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    transition: background var(--transition);
  }
  .dashboard-btn:hover {
    background: var(--bg-hover);
  }

  .control-buttons {
    display: flex;
    gap: 4px;
  }

  .btn-sm {
    padding: 4px 10px;
    font-size: var(--fs-xs);
    border-radius: var(--radius-sm);
    font-weight: 600;
    cursor: pointer;
  }
  .btn-primary {
    background: var(--accent-primary);
    color: var(--text-on-accent);
  }
  .btn-warning {
    background: var(--accent-warning, #e6a817);
    color: #000;
  }
  .btn-danger {
    background: var(--accent-error);
    color: var(--text-on-accent);
  }
  .btn-ghost {
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--border-primary);
  }
  .btn-sm:hover {
    opacity: 0.9;
  }
  .btn-sm:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .full-width {
    width: 100%;
  }

  .log-section {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .log-count {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
  }
  .log-list {
    overflow-y: auto;
    flex: 1;
    min-height: 80px;
    max-height: 200px;
  }
  .log-entry {
    display: flex;
    align-items: baseline;
    gap: 6px;
    padding: 2px 4px;
    font-size: var(--fs-xxs);
  }
  .log-time {
    color: var(--text-tertiary);
    font-family: var(--font-mono);
    flex-shrink: 0;
  }
  .log-action {
    font-weight: 700;
    flex-shrink: 0;
    width: 16px;
    text-align: center;
  }
  .log-detail {
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .plan-section {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .plan-row {
    display: flex;
    gap: 4px;
  }
  .btn-plan {
    flex: 1;
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    border: 1px solid var(--border-primary);
    text-align: center;
  }
  .btn-plan:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--accent-primary);
    border-color: var(--accent-primary);
  }
  .edit-lock {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    border-radius: var(--radius-sm);
    background: transparent;
    border: none;
    cursor: pointer;
    transition: all var(--transition);
    width: 100%;
    text-align: left;
  }
  .edit-lock:hover {
    background: var(--bg-hover);
  }
  .lock-icon {
    font-size: var(--fs-sm);
    flex-shrink: 0;
  }
  .lock-label {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    font-weight: 600;
    letter-spacing: 0.3px;
  }

  /* --- Hold-to-start button --- */
  .hold-btn-wrap {
    display: flex;
    flex-direction: column;
    gap: 3px;
    width: 100%;
  }

  .hold-btn {
    position: relative;
    overflow: hidden;
    user-select: none;
    touch-action: none;
    transition:
      transform 0.1s ease,
      box-shadow 0.15s ease;
  }

  .hold-btn:active:not(:disabled) {
    transform: scale(0.98);
  }

  .hold-fill {
    position: absolute;
    inset: 0;
    width: 0%;
    background: rgba(255, 255, 255, 0.2);
    border-radius: inherit;
    transition: width 0.05s linear;
    pointer-events: none;
    z-index: 0;
  }

  .hold-btn.holding .hold-fill {
    background: rgba(255, 255, 255, 0.25);
  }

  .hold-btn.hold-complete .hold-fill {
    width: 100% !important;
    background: rgba(255, 255, 255, 0.35);
    transition: background 0.2s ease;
  }

  .hold-btn.hold-complete {
    animation: hold-pulse 0.3s ease;
  }

  .hold-label {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    pointer-events: none;
  }

  .hold-hint {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    text-align: center;
    line-height: 1;
  }

  @keyframes hold-pulse {
    0% {
      transform: scale(1);
      box-shadow: 0 0 0 0 var(--accent-primary);
    }
    50% {
      transform: scale(1.02);
      box-shadow: 0 0 12px 2px var(--accent-primary);
    }
    100% {
      transform: scale(1);
      box-shadow: 0 0 0 0 transparent;
    }
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.7;
    }
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
