<script lang="ts">
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { patternLearningStore } from '$lib/stores/pattern-learning.svelte';
  import { workspaceStore } from '$lib/stores/workspace.svelte';
  import type { PatternType, PatternSensitivity } from '@e/shared';
  import { PATTERN_SENSITIVITY_PRESETS } from '@e/shared';

  const sensitivityOptions: { id: PatternSensitivity; label: string; desc: string }[] = [
    {
      id: 'aggressive',
      label: 'Aggressive',
      desc: `Detects patterns early (${PATTERN_SENSITIVITY_PRESETS.aggressive.minimumOccurrences} occurrences, ${Math.round(PATTERN_SENSITIVITY_PRESETS.aggressive.confidenceThreshold * 100)}% confidence)`,
    },
    {
      id: 'moderate',
      label: 'Moderate',
      desc: `Balanced detection (${PATTERN_SENSITIVITY_PRESETS.moderate.minimumOccurrences} occurrences, ${Math.round(PATTERN_SENSITIVITY_PRESETS.moderate.confidenceThreshold * 100)}% confidence)`,
    },
    {
      id: 'conservative',
      label: 'Conservative',
      desc: `Only high-confidence patterns (${PATTERN_SENSITIVITY_PRESETS.conservative.minimumOccurrences} occurrences, ${Math.round(PATTERN_SENSITIVITY_PRESETS.conservative.confidenceThreshold * 100)}% confidence)`,
    },
  ];

  const patternTypes: { id: PatternType; label: string; desc: string }[] = [
    { id: 'refactoring', label: 'Refactoring', desc: 'Code extraction, renaming, restructuring' },
    { id: 'workflow', label: 'Workflow', desc: 'Repeated multi-step processes' },
    { id: 'tool-usage', label: 'Tool Usage', desc: 'Repeated tool call patterns' },
    {
      id: 'problem-solving',
      label: 'Problem Solving',
      desc: 'Debugging and troubleshooting patterns',
    },
    { id: 'file-pattern', label: 'File Patterns', desc: 'Repeated file operations' },
    { id: 'command-sequence', label: 'Command Sequences', desc: 'Repeated bash commands' },
    { id: 'debugging', label: 'Debugging', desc: 'Debug-specific patterns' },
    { id: 'testing', label: 'Testing', desc: 'Test creation and execution patterns' },
    { id: 'documentation', label: 'Documentation', desc: 'Documentation generation patterns' },
    { id: 'code-generation', label: 'Code Generation', desc: 'Code scaffolding patterns' },
  ];

  function updateSettings(partial: Partial<typeof settingsStore.patternDetection>) {
    const current = { ...settingsStore.patternDetection };
    settingsStore.update({ patternDetection: { ...current, ...partial } });
  }

  function setSensitivity(sensitivity: PatternSensitivity) {
    const preset = PATTERN_SENSITIVITY_PRESETS[sensitivity];
    updateSettings({
      sensitivity,
      minimumOccurrences: preset.minimumOccurrences,
      confidenceThreshold: preset.confidenceThreshold,
    });
  }

  function togglePatternType(type: PatternType) {
    const current = [...settingsStore.patternDetection.enabledPatternTypes];
    const idx = current.indexOf(type);
    if (idx >= 0) {
      current.splice(idx, 1);
    } else {
      current.push(type);
    }
    updateSettings({ enabledPatternTypes: current });
  }

  let workspacePath = $derived(workspaceStore.activeWorkspace?.workspacePath);

  // Load learning data when workspace available
  $effect(() => {
    if (workspacePath) {
      patternLearningStore.load(workspacePath);
    }
  });
</script>

<div class="pattern-detection-settings">
  <!-- Enable/Disable -->
  <div class="setting-group">
    <label class="setting-label">Pattern Detection</label>
    <p class="setting-hint">
      When enabled, agents analyze conversations to detect recurring patterns and propose reusable
      skills or rules.
    </p>
    <label class="toggle-row">
      <input
        type="checkbox"
        checked={settingsStore.patternDetection.enabled}
        onchange={(e) => updateSettings({ enabled: (e.target as HTMLInputElement).checked })}
      />
      <span>Enable pattern detection</span>
    </label>
  </div>

  {#if settingsStore.patternDetection.enabled}
    <!-- Sensitivity -->
    <div class="setting-group">
      <label class="setting-label">Detection Sensitivity</label>
      <p class="setting-hint">
        Controls how many occurrences and what confidence level is needed before patterns are
        flagged.
      </p>
      <div class="sensitivity-grid">
        {#each sensitivityOptions as opt}
          <button
            class="sensitivity-option"
            class:active={settingsStore.patternDetection.sensitivity === opt.id}
            onclick={() => setSensitivity(opt.id)}
          >
            <span class="sensitivity-name">{opt.label}</span>
            <span class="sensitivity-desc">{opt.desc}</span>
          </button>
        {/each}
      </div>
    </div>

    <!-- Auto-Create Proposals -->
    <div class="setting-group">
      <label class="setting-label">Auto-Propose</label>
      <p class="setting-hint">
        Automatically create skill/rule proposals when patterns meet thresholds.
      </p>
      <label class="toggle-row">
        <input
          type="checkbox"
          checked={settingsStore.patternDetection.autoCreateProposals}
          onchange={(e) =>
            updateSettings({ autoCreateProposals: (e.target as HTMLInputElement).checked })}
        />
        <span>Auto-create proposals for detected patterns</span>
      </label>
    </div>

    <!-- Pattern Types -->
    <div class="setting-group">
      <label class="setting-label">Enabled Pattern Types</label>
      <p class="setting-hint">Choose which types of patterns to detect.</p>
      <div class="pattern-types-grid">
        {#each patternTypes as pt}
          <label
            class="pattern-type-option"
            class:enabled={settingsStore.patternDetection.enabledPatternTypes.includes(pt.id)}
          >
            <input
              type="checkbox"
              checked={settingsStore.patternDetection.enabledPatternTypes.includes(pt.id)}
              onchange={() => togglePatternType(pt.id)}
            />
            <div class="pattern-type-info">
              <span class="pattern-type-name">{pt.label}</span>
              <span class="pattern-type-desc">{pt.desc}</span>
            </div>
          </label>
        {/each}
      </div>
    </div>

    <!-- Stats -->
    <div class="setting-group">
      <label class="setting-label">Learning Status</label>
      <p class="setting-hint">Current pattern detection activity for this workspace.</p>
      <div class="stats-grid">
        <div class="stat-card">
          <span class="stat-value">{patternLearningStore.patterns.length}</span>
          <span class="stat-label">Patterns Detected</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">{patternLearningStore.pendingCount}</span>
          <span class="stat-label">Pending Proposals</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">{patternLearningStore.learningLog.length}</span>
          <span class="stat-label">Learning Events</span>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .pattern-detection-settings {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .setting-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .setting-label {
    font-weight: 600;
    font-size: 0.9rem;
    color: var(--text-primary, #e0e0e0);
  }

  .setting-hint {
    font-size: 0.8rem;
    color: var(--text-secondary, #888);
    margin: 0;
    line-height: 1.4;
  }

  .toggle-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
    font-size: 0.85rem;
    color: var(--text-primary, #e0e0e0);
  }

  .toggle-row input[type='checkbox'] {
    accent-color: var(--accent, #6e56cf);
    width: 16px;
    height: 16px;
    cursor: pointer;
  }

  .sensitivity-grid {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .sensitivity-option {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding: 0.6rem 0.8rem;
    border: 1px solid var(--border, #333);
    border-radius: 6px;
    background: var(--surface-1, #1a1a2e);
    cursor: pointer;
    text-align: left;
    transition: all 0.15s;
  }

  .sensitivity-option:hover {
    border-color: var(--accent, #6e56cf);
  }

  .sensitivity-option.active {
    border-color: var(--accent, #6e56cf);
    background: color-mix(in srgb, var(--accent, #6e56cf) 10%, transparent);
  }

  .sensitivity-name {
    font-weight: 600;
    font-size: 0.85rem;
    color: var(--text-primary, #e0e0e0);
  }

  .sensitivity-desc {
    font-size: 0.75rem;
    color: var(--text-secondary, #888);
  }

  .pattern-types-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.4rem;
  }

  .pattern-type-option {
    display: flex;
    align-items: flex-start;
    gap: 0.4rem;
    padding: 0.4rem 0.5rem;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.15s;
  }

  .pattern-type-option:hover {
    background: var(--surface-1, #1a1a2e);
  }

  .pattern-type-option.enabled {
    background: color-mix(in srgb, var(--accent, #6e56cf) 8%, transparent);
  }

  .pattern-type-option input[type='checkbox'] {
    accent-color: var(--accent, #6e56cf);
    margin-top: 2px;
    cursor: pointer;
  }

  .pattern-type-info {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  .pattern-type-name {
    font-size: 0.8rem;
    font-weight: 500;
    color: var(--text-primary, #e0e0e0);
  }

  .pattern-type-desc {
    font-size: 0.7rem;
    color: var(--text-secondary, #888);
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
  }

  .stat-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.2rem;
    padding: 0.6rem;
    border: 1px solid var(--border, #333);
    border-radius: 6px;
    background: var(--surface-1, #1a1a2e);
  }

  .stat-value {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--accent, #6e56cf);
  }

  .stat-label {
    font-size: 0.7rem;
    color: var(--text-secondary, #888);
    text-align: center;
  }
</style>
