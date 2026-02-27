<script lang="ts">
  import { uiStore } from '$lib/stores/ui.svelte';
  import { loopStore } from '$lib/stores/loop.svelte';
  import type { PRDSectionSeverity } from '@e/shared';

  let prd = $derived(loopStore.selectedPrd);
  let result = $derived(loopStore.completenessResult);

  function close() {
    loopStore.clearCompleteness();
    uiStore.closeModal();
  }

  async function runAnalysis() {
    const prdId = loopStore.selectedPrdId;
    if (!prdId) return;

    const res = await loopStore.analyzeCompleteness(prdId);
    if (!res.ok) {
      uiStore.toast(res.error || 'Completeness analysis failed', 'error');
    }
  }

  function scoreColor(score: number): string {
    if (score >= 80) return 'var(--accent-secondary)';
    if (score >= 50) return 'var(--accent-warning, #e6a817)';
    return 'var(--accent-error)';
  }

  function scoreLabel(score: number): string {
    if (score >= 90) return 'Excellent';
    if (score >= 70) return 'Good';
    if (score >= 50) return 'Fair';
    if (score >= 30) return 'Needs Work';
    return 'Incomplete';
  }

  function severityIcon(severity: PRDSectionSeverity): string {
    switch (severity) {
      case 'critical':
        return '●';
      case 'warning':
        return '●';
      case 'info':
        return '●';
    }
  }

  function severityLabel(severity: PRDSectionSeverity): string {
    switch (severity) {
      case 'critical':
        return 'Critical';
      case 'warning':
        return 'Warning';
      case 'info':
        return 'Info';
    }
  }

  // Auto-start analysis when modal opens
  $effect(() => {
    if (
      loopStore.selectedPrdId &&
      !loopStore.completenessResult &&
      !loopStore.analyzingCompleteness
    ) {
      runAnalysis();
    }
  });

  // Section sorting: show worst scores first, critical severity first
  let sortedSections = $derived(
    result
      ? [...result.sections].sort((a, b) => {
          // Sort by: severity priority (critical first), then score ascending (worst first)
          const severityOrder = { critical: 0, warning: 1, info: 2 };
          const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
          if (sevDiff !== 0) return sevDiff;
          return a.score - b.score;
        })
      : [],
  );

  let criticalCount = $derived(
    result ? result.sections.filter((s) => s.severity === 'critical' && s.score < 50).length : 0,
  );

  let warningCount = $derived(
    result ? result.sections.filter((s) => s.severity === 'warning' && s.score < 50).length : 0,
  );
</script>

<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div class="modal-overlay" onclick={close}>
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div class="modal" onclick={(e) => e.stopPropagation()}>
    <div class="modal-header">
      <h2>PRD Completeness Analysis</h2>
      <button class="close-btn" onclick={close} title="Close">
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
      {#if !prd}
        <div class="empty-state">No PRD selected.</div>
      {:else if loopStore.analyzingCompleteness}
        <!-- Loading state -->
        <div class="loading-state">
          <div class="spinner-large"></div>
          <p>Analyzing PRD completeness...</p>
          <p class="loading-sub">"{prd.name}"</p>
        </div>
      {:else if result}
        <!-- PRD Info -->
        <div class="prd-info">
          <div class="prd-title-row">
            <span class="prd-title">{prd.name}</span>
            <span class="story-count">{prd.stories?.length || 0} stories</span>
          </div>
        </div>

        <!-- Overall Score -->
        <div class="score-section">
          <div class="score-header">
            <span class="score-label">Completeness Score</span>
            <div class="score-row">
              <span class="score-value" style:color={scoreColor(result.overallScore)}>
                {result.overallScore}%
              </span>
              <span class="score-tag" style:background={scoreColor(result.overallScore)}>
                {result.overallLabel || scoreLabel(result.overallScore)}
              </span>
            </div>
          </div>
          <div class="score-bar-container">
            <div
              class="score-bar"
              style:width="{result.overallScore}%"
              style:background={scoreColor(result.overallScore)}
            ></div>
          </div>
          <p class="score-summary">{result.summary}</p>
          {#if criticalCount > 0 || warningCount > 0}
            <div class="issue-counts">
              {#if criticalCount > 0}
                <span class="issue-badge critical"
                  >{criticalCount} critical gap{criticalCount !== 1 ? 's' : ''}</span
                >
              {/if}
              {#if warningCount > 0}
                <span class="issue-badge warning"
                  >{warningCount} warning{warningCount !== 1 ? 's' : ''}</span
                >
              {/if}
            </div>
          {/if}
        </div>

        <!-- Section Analysis -->
        <div class="sections-list">
          <h4 class="section-heading">Section Analysis ({result.sections.length})</h4>
          {#each sortedSections as section (section.section)}
            <div
              class="section-card"
              class:missing={!section.present}
              class:critical={section.severity === 'critical' && section.score < 50}
            >
              <div class="section-card-header">
                <div class="section-label-row">
                  <span class="severity-icon" title={severityLabel(section.severity)}
                    >{severityIcon(section.severity)}</span
                  >
                  <span class="section-name">{section.label}</span>
                </div>
                <div class="section-score-row">
                  <span class="section-score" style:color={scoreColor(section.score)}>
                    {section.score}
                  </span>
                  <span
                    class="section-presence"
                    class:present={section.present}
                    class:absent={!section.present}
                  >
                    {section.present ? 'Found' : 'Missing'}
                  </span>
                </div>
              </div>
              <div class="section-bar-container">
                <div
                  class="section-bar"
                  style:width="{section.score}%"
                  style:background={scoreColor(section.score)}
                ></div>
              </div>
              <p class="section-feedback">{section.feedback}</p>
              {#if section.questions.length > 0}
                <div class="section-questions">
                  <span class="questions-label">Questions to fill gaps:</span>
                  <ul>
                    {#each section.questions as question}
                      <li>{question}</li>
                    {/each}
                  </ul>
                </div>
              {/if}
            </div>
          {/each}
        </div>

        <!-- Suggested Questions -->
        {#if result.suggestedQuestions.length > 0}
          <div class="suggested-questions">
            <h4 class="section-heading">Top Questions to Improve PRD</h4>
            <ol class="top-questions-list">
              {#each result.suggestedQuestions as question}
                <li>{question}</li>
              {/each}
            </ol>
          </div>
        {/if}

        <!-- Error -->
        {#if loopStore.completenessError}
          <div class="error-banner">
            {loopStore.completenessError}
          </div>
        {/if}
      {:else if loopStore.completenessError}
        <div class="error-banner">
          {loopStore.completenessError}
        </div>
      {/if}
    </div>

    <div class="modal-footer">
      <button class="btn-cancel" onclick={close}>
        {result ? 'Done' : 'Cancel'}
      </button>
      {#if result && !loopStore.analyzingCompleteness}
        <button class="btn-reanalyze" onclick={runAnalysis}> Re-analyze </button>
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
    width: 680px;
    max-height: 85vh;
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

  /* Loading */
  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 40px 20px;
    gap: 12px;
  }
  .loading-state p {
    font-size: var(--fs-base);
    color: var(--text-secondary);
  }
  .loading-sub {
    font-style: italic;
    color: var(--text-tertiary) !important;
    font-size: var(--fs-sm) !important;
  }
  .spinner-large {
    width: 24px;
    height: 24px;
    border: 3px solid transparent;
    border-top-color: var(--accent-primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  .empty-state {
    padding: 40px 20px;
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--fs-base);
  }

  /* PRD Info */
  .prd-info {
    margin-bottom: 16px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border-primary);
  }
  .prd-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .prd-title {
    font-size: var(--fs-md);
    font-weight: 600;
    color: var(--text-primary);
  }
  .story-count {
    font-size: var(--fs-xxs);
    padding: 2px 8px;
    border-radius: 10px;
    background: var(--bg-tertiary);
    color: var(--text-tertiary);
    font-weight: 600;
  }

  /* Overall score */
  .score-section {
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    padding: 12px;
    margin-bottom: 16px;
  }
  .score-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  .score-label {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-secondary);
  }
  .score-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .score-value {
    font-size: var(--fs-xl);
    font-weight: 700;
  }
  .score-tag {
    font-size: var(--fs-xxs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 2px 6px;
    border-radius: 3px;
    color: var(--text-on-accent);
  }
  .score-bar-container {
    height: 6px;
    background: var(--bg-tertiary);
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: 8px;
  }
  .score-bar {
    height: 100%;
    border-radius: 3px;
    transition: width 0.5s ease;
  }
  .score-summary {
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    line-height: 1.4;
    margin: 0;
  }
  .issue-counts {
    display: flex;
    gap: 6px;
    margin-top: 8px;
  }
  .issue-badge {
    font-size: var(--fs-xxs);
    padding: 2px 8px;
    border-radius: 10px;
    font-weight: 600;
  }
  .issue-badge.critical {
    background: rgba(239, 68, 68, 0.15);
    color: var(--accent-error);
  }
  .issue-badge.warning {
    background: rgba(230, 168, 23, 0.15);
    color: var(--accent-warning, #e6a817);
  }

  /* Section analysis */
  .section-heading {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-secondary);
    margin-bottom: 10px;
  }
  .sections-list {
    margin-bottom: 16px;
  }
  .section-card {
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    padding: 10px 12px;
    margin-bottom: 8px;
    background: var(--bg-secondary);
    transition: border-color var(--transition);
  }
  .section-card.missing {
    border-left: 3px solid var(--accent-warning, #e6a817);
  }
  .section-card.critical {
    border-left: 3px solid var(--accent-error);
  }
  .section-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }
  .section-label-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .severity-icon {
    font-size: var(--fs-xxs);
    flex-shrink: 0;
  }
  .section-name {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-primary);
  }
  .section-score-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .section-score {
    font-size: var(--fs-md);
    font-weight: 700;
  }
  .section-presence {
    font-size: var(--fs-xxs);
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 3px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .section-presence.present {
    background: rgba(34, 197, 94, 0.15);
    color: var(--accent-secondary);
  }
  .section-presence.absent {
    background: rgba(239, 68, 68, 0.15);
    color: var(--accent-error);
  }
  .section-bar-container {
    height: 3px;
    background: var(--bg-tertiary);
    border-radius: 2px;
    overflow: hidden;
    margin-bottom: 6px;
  }
  .section-bar {
    height: 100%;
    border-radius: 2px;
    transition: width 0.3s ease;
  }
  .section-feedback {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    line-height: 1.4;
    margin: 0 0 6px 0;
  }
  .section-questions {
    margin-top: 4px;
  }
  .questions-label {
    font-size: var(--fs-xxs);
    font-weight: 600;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .section-questions ul {
    padding-left: 16px;
    margin: 4px 0 0;
  }
  .section-questions li {
    font-size: var(--fs-xs);
    color: var(--accent-primary);
    line-height: 1.5;
  }

  /* Suggested questions */
  .suggested-questions {
    margin-bottom: 12px;
  }
  .top-questions-list {
    padding-left: 20px;
    margin: 0;
  }
  .top-questions-list li {
    font-size: var(--fs-sm);
    color: var(--text-primary);
    line-height: 1.6;
    margin-bottom: 4px;
  }

  /* Error */
  .error-banner {
    padding: 8px 12px;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid var(--accent-error);
    border-radius: var(--radius-sm);
    color: var(--accent-error);
    font-size: var(--fs-sm);
    margin-top: 12px;
  }

  /* Footer */
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
    cursor: pointer;
  }
  .btn-cancel:hover {
    background: var(--bg-hover);
  }
  .btn-reanalyze {
    padding: 6px 20px;
    font-size: var(--fs-sm);
    font-weight: 600;
    border-radius: var(--radius-sm);
    background: var(--accent-primary);
    color: var(--text-on-accent);
    cursor: pointer;
  }
  .btn-reanalyze:hover {
    opacity: 0.9;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
