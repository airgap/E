<script lang="ts">
  import { uiStore } from '$lib/stores/ui.svelte';
  import { loopStore } from '$lib/stores/loop.svelte';
  import { workStore } from '$lib/stores/work.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { uuid } from '$lib/utils/uuid';
  import type { QualityCheckConfig, LoopConfig } from '@e/shared';
  import { onMount } from 'svelte';

  const LOOP_CONFIG_KEY = 'e-loop-config';

  interface SavedLoopConfig {
    maxIterations: number;
    maxAttemptsPerStory: number;
    maxFixUpAttempts: number;
    model: string;
    effort: string;
    autoCommit: boolean;
    autoSnapshot: boolean;
    pauseOnFailure: boolean;
    qualityChecks: QualityCheckConfig[];
    maxParallel?: number;
    autoMerge?: boolean;
  }

  function loadSavedConfig(): SavedLoopConfig | null {
    try {
      const raw = localStorage.getItem(LOOP_CONFIG_KEY);
      if (raw) return JSON.parse(raw);
    } catch {
      /* localStorage unavailable */
    }
    return null;
  }

  function saveConfig(config: SavedLoopConfig) {
    try {
      localStorage.setItem(LOOP_CONFIG_KEY, JSON.stringify(config));
    } catch {
      /* localStorage unavailable */
    }
  }

  // Standalone mode: no PRD selected
  let isStandalone = $derived(!loopStore.selectedPrdId);
  let standaloneStoryCount = $derived(
    workStore.standaloneStories.filter((s) => s.status === 'pending' || s.status === 'in_progress')
      .length,
  );

  // Auto-calculate story count for smart maxIterations default
  let storyCount = $derived(
    isStandalone
      ? standaloneStoryCount
      : (loopStore.selectedPrd?.stories?.filter(
          (s: any) => s.status === 'pending' || s.status === 'in_progress',
        ).length ?? 0),
  );

  // Load saved config or use defaults
  const saved = loadSavedConfig();

  let maxAttemptsPerStory = $state(saved?.maxAttemptsPerStory ?? 3);
  let maxFixUpAttempts = $state(saved?.maxFixUpAttempts ?? 2);
  // Default maxIterations: storyCount * maxAttemptsPerStory * (1 + maxFixUpAttempts), minimum 10
  let maxIterations = $state(saved?.maxIterations ?? 50);
  let model = $state(saved?.model ?? settingsStore.model);
  let effort = $state(saved?.effort ?? settingsStore.effort ?? 'high');
  let autoCommit = $state(saved?.autoCommit ?? true);
  let autoSnapshot = $state(saved?.autoSnapshot ?? true);
  let pauseOnFailure = $state(saved?.pauseOnFailure ?? false);
  let maxParallel = $state(saved?.maxParallel ?? 1);
  let autoMerge = $state(saved?.autoMerge ?? true);

  let checks = $state<QualityCheckConfig[]>([]);
  let showAddCheck = $state(false);
  let newCheckName = $state('');
  let newCheckCommand = $state('');
  let newCheckType = $state<'typecheck' | 'lint' | 'test' | 'build' | 'custom'>('custom');
  let newCheckRequired = $state(true);

  onMount(() => {
    // Only compute smart maxIterations if no saved config
    if (!saved) {
      const count = storyCount;
      if (count > 0) {
        maxIterations = Math.max(10, count * maxAttemptsPerStory * (1 + maxFixUpAttempts));
      }
    }

    // Pre-populate quality checks: saved config > PRD checks > defaults
    if (saved?.qualityChecks?.length) {
      checks = saved.qualityChecks;
    } else {
      const prd = loopStore.selectedPrd;
      if (prd && prd.qualityChecks?.length > 0) {
        checks = prd.qualityChecks.map((c) => ({ ...c, enabled: true }));
      } else {
        // Provide sensible defaults based on common project setups
        checks = [
          {
            id: uuid().slice(0, 8),
            type: 'typecheck',
            name: 'Typecheck',
            command: 'bun run check',
            timeout: 60000,
            required: true,
            enabled: true,
          },
        ];
      }
    }
  });

  function addCheck() {
    if (!newCheckName.trim() || !newCheckCommand.trim()) return;
    checks = [
      ...checks,
      {
        id: uuid().slice(0, 8),
        type: newCheckType,
        name: newCheckName,
        command: newCheckCommand,
        timeout: 60000,
        required: newCheckRequired,
        enabled: true,
      },
    ];
    newCheckName = '';
    newCheckCommand = '';
    newCheckRequired = true;
    showAddCheck = false;
  }

  function removeCheck(id: string) {
    checks = checks.filter((c) => c.id !== id);
  }

  function toggleCheck(id: string) {
    checks = checks.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c));
  }

  let depWarnings = $state<
    Array<{ type: string; message: string; storyId: string; storyTitle: string }>
  >([]);
  let validatingDeps = $state(false);

  onMount(async () => {
    // Validate dependencies when modal opens (PRD mode only)
    const prdId = loopStore.selectedPrdId;
    if (prdId) {
      validatingDeps = true;
      const result = await loopStore.validateSprint(prdId);
      if (result) {
        depWarnings = result.warnings;
      }
      validatingDeps = false;
    }
  });

  async function startLoop() {
    const prdId = loopStore.selectedPrdId;
    const workspacePath = settingsStore.workspacePath;
    if (!workspacePath) return;

    const config: LoopConfig = {
      maxIterations,
      maxAttemptsPerStory,
      maxFixUpAttempts,
      model,
      effort,
      autoCommit,
      autoSnapshot,
      pauseOnFailure,
      qualityChecks: checks,
      maxParallel,
      autoMerge,
    };

    // Persist settings for next time
    saveConfig({
      maxIterations,
      maxAttemptsPerStory,
      maxFixUpAttempts,
      model,
      effort,
      autoCommit,
      autoSnapshot,
      pauseOnFailure,
      qualityChecks: checks,
      maxParallel,
      autoMerge,
    });

    try {
      // Set standalone story count for progress tracking before starting
      if (!prdId) {
        loopStore.setStandaloneStoryCount(standaloneStoryCount);
      }

      const result = await loopStore.startLoop(prdId ?? null, workspacePath, config);
      if (result.ok) {
        uiStore.toast('Golem activated', 'success');
        close();
      } else {
        uiStore.toast(result.error || 'Failed to activate Golem', 'error');
      }
    } catch (err) {
      uiStore.toast(`Failed to activate Golem: ${err}`, 'error');
    }
  }

  function close() {
    uiStore.closeModal();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div class="modal-overlay" onclick={close}>
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div class="modal" onclick={(e) => e.stopPropagation()}>
    <div class="modal-header">
      <h2>Configure Golem</h2>
      <button class="close-btn" onclick={close}>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>

    <div class="modal-body">
      {#if loopStore.selectedPrd}
        <div class="prd-info">
          <strong>{loopStore.selectedPrd.name}</strong>
          <span class="prd-stories"
            >{(loopStore.selectedPrd.stories || []).filter(
              (s) => s.status !== 'completed' && s.status !== 'skipped' && s.status !== 'archived',
            ).length} stories remaining</span
          >
        </div>
      {:else if isStandalone}
        <div class="prd-info">
          <strong>Standalone Stories</strong>
          <span class="prd-stories">{standaloneStoryCount} pending</span>
        </div>
      {/if}

      <div class="form-section">
        <h3>Execution</h3>

        <div class="form-row">
          <label>Model</label>
          <select bind:value={model}>
            <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
            <option value="claude-sonnet-4-5-20250929">Claude Sonnet 4.5</option>
            <option value="claude-opus-4-6">Claude Opus 4.6</option>
            <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
          </select>
        </div>

        <div class="form-row">
          <label>Effort</label>
          <select bind:value={effort}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>

        <div class="form-row">
          <label>Max iterations</label>
          <input type="number" bind:value={maxIterations} min="1" max="500" />
        </div>
        {#if storyCount > 0}
          <div class="form-hint">
            {storyCount} stories x {maxAttemptsPerStory} attempts x {1 + maxFixUpAttempts} passes = {storyCount *
              maxAttemptsPerStory *
              (1 + maxFixUpAttempts)} max iterations
          </div>
        {/if}

        <div class="form-row">
          <label>Fresh attempts / story</label>
          <input type="number" bind:value={maxAttemptsPerStory} min="1" max="10" />
        </div>
        <div class="form-row">
          <label>Fix-up passes / attempt</label>
          <input type="number" bind:value={maxFixUpAttempts} min="0" max="5" />
        </div>
        <div class="form-hint">
          Each attempt gets {maxFixUpAttempts} fix-up pass{maxFixUpAttempts !== 1 ? 'es' : ''} to fix
          errors before starting fresh
        </div>
      </div>

      <div class="form-section">
        <h3>Behavior</h3>

        <label class="toggle-row">
          <input type="checkbox" bind:checked={autoCommit} />
          <span>Auto-commit after each story</span>
        </label>

        <label class="toggle-row">
          <input type="checkbox" bind:checked={autoSnapshot} />
          <span>Git snapshot before each story</span>
        </label>

        <label class="toggle-row">
          <input type="checkbox" bind:checked={pauseOnFailure} />
          <span>Pause on story failure</span>
        </label>
      </div>

      <div class="form-section">
        <h3>Worktree Dispatch</h3>

        <div class="form-row">
          <label>Max parallel stories</label>
          <div class="slider-row">
            <input type="range" min="1" max="10" step="1" bind:value={maxParallel} class="slider" />
            <span class="slider-value">{maxParallel}</span>
          </div>
        </div>
        <div class="form-hint">
          {maxParallel === 1
            ? 'Serial execution (one story at a time)'
            : `Up to ${maxParallel} stories in parallel worktrees`}
        </div>

        <label class="toggle-row">
          <input type="checkbox" bind:checked={autoMerge} />
          <span>Auto-merge branches on completion</span>
        </label>

        {#if maxParallel > 1}
          <div class="form-hint disk-note">
            Each parallel worktree creates a full copy of the working directory. Ensure adequate
            disk space.
          </div>
        {/if}
      </div>

      <div class="form-section">
        <div class="section-header-inline">
          <h3>Quality Checks</h3>
          <button class="add-btn" onclick={() => (showAddCheck = !showAddCheck)}>+ Add</button>
        </div>

        {#if showAddCheck}
          <div class="add-check-form">
            <input bind:value={newCheckName} placeholder="Check name" />
            <input bind:value={newCheckCommand} placeholder="Command (e.g. npm test)" />
            <div class="add-check-row">
              <select bind:value={newCheckType}>
                <option value="typecheck">Typecheck</option>
                <option value="lint">Lint</option>
                <option value="test">Test</option>
                <option value="build">Build</option>
                <option value="custom">Custom</option>
              </select>
              <label class="toggle-inline">
                <input type="checkbox" bind:checked={newCheckRequired} />
                Required
              </label>
              <button class="btn-sm" onclick={addCheck}>Add</button>
            </div>
          </div>
        {/if}

        <div class="check-list">
          {#each checks as check (check.id)}
            <div class="check-item">
              <label class="check-toggle">
                <input
                  type="checkbox"
                  checked={check.enabled}
                  onchange={() => toggleCheck(check.id)}
                />
              </label>
              <div class="check-info">
                <span class="check-name" class:disabled={!check.enabled}>
                  {check.name}
                  {#if check.required}<span class="required-badge">req</span>{/if}
                </span>
                <span class="check-cmd">{check.command}</span>
              </div>
              <button class="remove-btn" onclick={() => removeCheck(check.id)}>×</button>
            </div>
          {:else}
            <div class="empty-checks">No quality checks configured</div>
          {/each}
        </div>
      </div>
    </div>

    {#if depWarnings.length > 0}
      <div class="dep-warnings-section">
        <div class="dep-warnings-header">
          <span class="dep-warnings-icon">△</span>
          <span class="dep-warnings-title">Dependency Warnings ({depWarnings.length})</span>
        </div>
        <div class="dep-warnings-list">
          {#each depWarnings as warning}
            <div class="dep-warning-item">
              <span class="dep-warning-msg">{warning.message}</span>
            </div>
          {/each}
        </div>
        <p class="dep-warnings-note">
          The loop will respect dependency order and only run stories whose dependencies are met.
          Blocked stories will be deferred automatically.
        </p>
      </div>
    {/if}

    <div class="modal-footer">
      <button class="btn-cancel" onclick={close}>Cancel</button>
      {#if loopStore.isActive}
        <div class="already-running">
          <span class="already-running-dot"></span>
          Golem is already {loopStore.isRunning ? 'running' : 'paused'}
        </div>
      {:else}
        <button class="btn-start" onclick={startLoop}>
          {#if depWarnings.length > 0}<svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="currentColor"
              stroke="none"><polygon points="5 3 19 12 5 21 5 3" /></svg
            > Activate Golem (with warnings){:else}<svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="currentColor"
              stroke="none"><polygon points="5 3 19 12 5 21 5 3" /></svg
            > Activate Golem{/if}
        </button>
      {/if}
    </div>
  </div>
</div>

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  .modal {
    background: var(--bg-primary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-lg, 8px);
    width: 480px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  }
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-primary);
  }
  .modal-header h2 {
    font-size: var(--fs-lg);
    font-weight: 600;
  }
  .close-btn {
    padding: 4px;
    border-radius: 4px;
    color: var(--text-tertiary);
  }
  .close-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .modal-body {
    padding: 16px 20px;
    overflow-y: auto;
    flex: 1;
  }

  .prd-info {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
    margin-bottom: 16px;
    font-size: var(--fs-base);
  }
  .prd-stories {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    margin-left: auto;
  }

  .form-section {
    margin-bottom: 16px;
  }
  .form-section h3 {
    font-size: var(--fs-sm);
    font-weight: 600;
    text-transform: uppercase;
    color: var(--text-tertiary);
    margin-bottom: 8px;
    letter-spacing: 0.5px;
  }

  .form-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }
  .form-row label {
    font-size: var(--fs-sm);
    color: var(--text-secondary);
  }
  .form-row select,
  .form-row input[type='number'] {
    width: 160px;
    padding: 4px 8px;
    font-size: var(--fs-sm);
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
  }

  .form-hint {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    margin: -2px 0 6px;
    text-align: right;
  }
  .form-hint.disk-note {
    text-align: left;
    margin-top: 4px;
    padding: 4px 8px;
    background: rgba(234, 179, 8, 0.08);
    border-radius: var(--radius-sm);
    border-left: 2px solid var(--accent-warning, #eab308);
  }

  .slider-row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 160px;
  }
  .slider {
    flex: 1;
    accent-color: var(--accent-primary);
    height: 4px;
  }
  .slider-value {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-primary);
    min-width: 20px;
    text-align: center;
  }

  .toggle-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    cursor: pointer;
  }
  .toggle-row input[type='checkbox'] {
    accent-color: var(--accent-primary);
  }

  .section-header-inline {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .add-btn {
    font-size: var(--fs-xs);
    padding: 2px 8px;
    border-radius: var(--radius-sm);
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    border: 1px solid var(--border-primary);
  }
  .add-btn:hover {
    background: var(--bg-hover);
  }

  .add-check-form {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 8px 0;
    padding: 8px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
  }
  .add-check-form input,
  .add-check-form select {
    padding: 4px 8px;
    font-size: var(--fs-sm);
    background: var(--bg-primary);
    color: var(--text-primary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
  }
  .add-check-row {
    display: flex;
    gap: 4px;
    align-items: center;
  }
  .toggle-inline {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    cursor: pointer;
  }

  .check-list {
    margin-top: 8px;
  }
  .check-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
    margin-bottom: 4px;
  }
  .check-toggle input {
    accent-color: var(--accent-primary);
  }
  .check-info {
    flex: 1;
    min-width: 0;
  }
  .check-name {
    font-size: var(--fs-sm);
    font-weight: 500;
    color: var(--text-primary);
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .check-name.disabled {
    opacity: 0.5;
  }
  .required-badge {
    font-size: var(--fs-xxs);
    padding: 0 4px;
    border-radius: 2px;
    background: var(--accent-primary);
    color: var(--text-on-accent);
    font-weight: 600;
  }
  .check-cmd {
    font-size: var(--fs-xxs);
    font-family: var(--font-mono);
    color: var(--text-tertiary);
  }
  .remove-btn {
    font-size: var(--fs-md);
    padding: 0 4px;
    color: var(--text-tertiary);
  }
  .remove-btn:hover {
    color: var(--accent-error);
  }
  .empty-checks {
    text-align: center;
    padding: 12px;
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 20px;
    border-top: 1px solid var(--border-primary);
  }
  .btn-cancel {
    padding: 6px 16px;
    font-size: var(--fs-sm);
    border-radius: var(--radius-sm);
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    border: 1px solid var(--border-primary);
  }
  .btn-cancel:hover {
    background: var(--bg-hover);
  }
  .btn-start {
    padding: 6px 20px;
    font-size: var(--fs-sm);
    font-weight: 600;
    border-radius: var(--radius-sm);
    background: var(--accent-primary);
    color: var(--text-on-accent);
  }
  .btn-start:hover {
    opacity: 0.9;
  }
  .btn-sm {
    padding: 4px 10px;
    font-size: var(--fs-xs);
    border-radius: var(--radius-sm);
    background: var(--accent-primary);
    color: var(--text-on-accent);
    font-weight: 600;
  }

  .dep-warnings-section {
    margin: 0 20px 0;
    padding: 12px;
    background: rgba(230, 168, 23, 0.08);
    border: 1px solid rgba(230, 168, 23, 0.3);
    border-radius: var(--radius-sm);
  }
  .dep-warnings-header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 8px;
  }
  .dep-warnings-icon {
    font-size: var(--fs-md);
  }
  .dep-warnings-title {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--accent-warning, #e6a817);
  }
  .dep-warnings-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 100px;
    overflow-y: auto;
  }
  .dep-warning-item {
    padding: 4px 8px;
    background: rgba(230, 168, 23, 0.05);
    border-radius: var(--radius-sm);
    border-left: 2px solid var(--accent-warning, #e6a817);
  }
  .dep-warning-msg {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    line-height: 1.3;
  }
  .dep-warnings-note {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    margin-top: 8px;
    margin-bottom: 0;
    font-style: italic;
  }

  .already-running {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 16px;
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--accent-primary);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
  }
  .already-running-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent-primary);
    animation: pulse-dot 2s ease-in-out infinite;
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
</style>
