<script lang="ts">
  import { patternLearningStore } from '$lib/stores/pattern-learning.svelte';
  import type { LearningTab, ProposalFilter } from '$lib/stores/pattern-learning.svelte';
  import { workspaceStore } from '$lib/stores/workspace.svelte';
  import type { PatternDetection, SkillProposal, LearningLogEntry } from '@e/shared';

  let workspacePath = $derived(workspaceStore.activeWorkspace?.workspacePath);

  // Load data when workspace changes
  $effect(() => {
    if (workspacePath) {
      patternLearningStore.load(workspacePath);
    } else {
      patternLearningStore.clear();
    }
  });

  const patternTypeLabels: Record<string, string> = {
    refactoring: 'Refactoring',
    workflow: 'Workflow',
    'tool-usage': 'Tool Usage',
    'problem-solving': 'Problem Solving',
    'file-pattern': 'File Pattern',
    'command-sequence': 'Command Sequence',
    debugging: 'Debugging',
    testing: 'Testing',
    documentation: 'Documentation',
    'code-generation': 'Code Generation',
    other: 'Other',
  };

  const patternTypeIcons: Record<string, string> = {
    refactoring: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7',
    workflow: 'M22 11.08V12a10 10 0 1 1-5.93-9.14 M22 4L12 14.01l-3-3',
    'tool-usage':
      'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z',
    'problem-solving':
      'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z',
    'file-pattern': 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6',
    'command-sequence': 'M4 17l6-6-6-6 M12 19h8',
    debugging:
      'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z M12 8v4 M12 16h.01',
    testing: 'M9 11l3 3L22 4 M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
    documentation:
      'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8',
    'code-generation': 'M16 18l6-6-6-6 M8 6l-6 6 6 6',
    other: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  };

  const logEventIcons: Record<string, string> = {
    'pattern-detected': 'M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM21 21l-4.35-4.35',
    'proposal-created':
      'M12 3l1.67 5.14h5.41l-4.38 3.18L16.38 17 12 13.82 7.62 17l1.68-5.68L4.92 8.14h5.41z',
    'proposal-approved': 'M9 11l3 3L22 4 M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
    'proposal-rejected': 'M18 6L6 18M6 6l12 12',
    'skill-installed': 'M22 11.08V12a10 10 0 1 1-5.93-9.14 M22 4L12 14.01l-3-3',
  };

  function formatDate(ts: number): string {
    const now = Date.now();
    const diff = now - ts;
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function confidenceColor(confidence: number): string {
    if (confidence >= 0.8) return 'var(--accent-success)';
    if (confidence >= 0.6) return 'var(--accent-warning, #f0ad4e)';
    return 'var(--text-tertiary)';
  }

  function confidenceLabel(confidence: number): string {
    if (confidence >= 0.85) return 'Very High';
    if (confidence >= 0.7) return 'High';
    if (confidence >= 0.5) return 'Moderate';
    return 'Low';
  }

  async function handleApprove(proposal: SkillProposal) {
    const success = await patternLearningStore.approveProposal(proposal.id);
    if (success) {
      patternLearningStore.selectProposal(null);
    }
  }

  async function handleReject(proposal: SkillProposal) {
    const success = await patternLearningStore.rejectProposal(proposal.id);
    if (success) {
      patternLearningStore.selectProposal(null);
    }
  }

  async function handleCheckAndPropose() {
    await patternLearningStore.checkAndPropose();
  }
</script>

<div class="learning-panel">
  <div class="panel-header">
    <span class="panel-title">Learning</span>
    {#if patternLearningStore.pendingCount > 0}
      <span class="pending-badge">{patternLearningStore.pendingCount} pending</span>
    {/if}
    <button
      class="refresh-btn"
      onclick={() => workspacePath && patternLearningStore.load(workspacePath)}
      title="Refresh"
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
        <polyline points="23 4 23 10 17 10"></polyline>
        <polyline points="1 20 1 14 7 14"></polyline>
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
      </svg>
    </button>
  </div>

  <!-- Tab bar -->
  <div class="tab-bar">
    {#each [['patterns', 'Patterns'], ['proposals', 'Proposals'], ['log', 'Log']] as [tab, label]}
      <button
        class="tab-btn"
        class:active={patternLearningStore.activeTab === tab}
        onclick={() => patternLearningStore.setTab(tab as LearningTab)}
      >
        {label}
        {#if tab === 'proposals' && patternLearningStore.pendingCount > 0}
          <span class="tab-badge">{patternLearningStore.pendingCount}</span>
        {/if}
      </button>
    {/each}
  </div>

  <div class="panel-content">
    {#if patternLearningStore.loading}
      <div class="empty-state">Loading...</div>
    {:else if !workspacePath}
      <div class="empty-state">Open a workspace to see learning data.</div>

      <!-- PATTERNS TAB -->
    {:else if patternLearningStore.activeTab === 'patterns'}
      {#if patternLearningStore.sortedPatterns.length === 0}
        <div class="empty-state">
          <div class="empty-icon">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM21 21l-4.35-4.35" />
            </svg>
          </div>
          No patterns detected yet. Patterns are discovered as the agent works across conversations.
        </div>
      {:else}
        {#each patternLearningStore.sortedPatterns as pattern (pattern.id)}
          <div
            class="pattern-item"
            class:selected={patternLearningStore.selectedPatternId === pattern.id}
          >
            <button
              class="pattern-header"
              onclick={() =>
                patternLearningStore.selectPattern(
                  patternLearningStore.selectedPatternId === pattern.id ? null : pattern.id,
                )}
            >
              <span class="pattern-icon">
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
                  <path d={patternTypeIcons[pattern.patternType] || patternTypeIcons.other} />
                </svg>
              </span>
              <span class="pattern-type-label"
                >{patternTypeLabels[pattern.patternType] || pattern.patternType}</span
              >
              <span class="pattern-count" title="{pattern.occurrences} occurrences"
                >{pattern.occurrences}x</span
              >
              <span
                class="confidence-dot"
                style="color: {confidenceColor(pattern.confidence)}"
                title="Confidence: {(pattern.confidence * 100).toFixed(0)}%"
              >
                <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor"
                  ><circle cx="4" cy="4" r="4" /></svg
                >
              </span>
            </button>

            {#if patternLearningStore.selectedPatternId === pattern.id}
              <div class="pattern-detail">
                <p class="pattern-description">{pattern.description}</p>
                <div class="pattern-meta">
                  <span class="meta-item">
                    <strong>Confidence:</strong>
                    {confidenceLabel(pattern.confidence)} ({(pattern.confidence * 100).toFixed(0)}%)
                  </span>
                  <span class="meta-item">
                    <strong>First seen:</strong>
                    {formatDate(pattern.firstSeen)}
                  </span>
                  <span class="meta-item">
                    <strong>Last seen:</strong>
                    {formatDate(pattern.lastSeen)}
                  </span>
                  <span class="meta-item">
                    <strong>Conversations:</strong>
                    {pattern.conversationIds.length}
                  </span>
                  {#if pattern.proposalCreated}
                    <span class="meta-item proposed">Proposal created</span>
                  {/if}
                </div>
                {#if pattern.tools.length > 0}
                  <div class="pattern-tools">
                    <strong>Tools:</strong>
                    {#each pattern.tools as tool}
                      <span class="tool-tag">{tool}</span>
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {/each}

        {#if patternLearningStore.proposablePatterns.length > 0}
          <div class="action-bar">
            <button class="action-btn" onclick={handleCheckAndPropose}>
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
                  d="M12 3l1.67 5.14h5.41l-4.38 3.18L16.38 17 12 13.82 7.62 17l1.68-5.68L4.92 8.14h5.41z"
                />
              </svg>
              Generate Proposals ({patternLearningStore.proposablePatterns.length})
            </button>
          </div>
        {/if}
      {/if}

      <!-- PROPOSALS TAB -->
    {:else if patternLearningStore.activeTab === 'proposals'}
      <!-- Proposal filter -->
      <div class="proposal-filters">
        {#each [['all', 'All'], ['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected']] as [f, label]}
          <button
            class="filter-btn"
            class:active={patternLearningStore.proposalFilter === f}
            onclick={() => patternLearningStore.setProposalFilter(f as ProposalFilter)}
          >
            {label}
          </button>
        {/each}
      </div>

      {#if patternLearningStore.filteredProposals.length === 0}
        <div class="empty-state">
          {#if patternLearningStore.proposalFilter === 'pending'}
            No pending proposals. Patterns will generate proposals when they reach the confidence
            threshold.
          {:else if patternLearningStore.proposalFilter === 'all'}
            No proposals yet. Proposals are generated from detected patterns.
          {:else}
            No {patternLearningStore.proposalFilter} proposals.
          {/if}
        </div>
      {:else}
        {#each patternLearningStore.filteredProposals as proposal (proposal.id)}
          <div
            class="proposal-item"
            class:selected={patternLearningStore.selectedProposalId === proposal.id}
            class:pending={proposal.status === 'pending'}
            class:approved={proposal.status === 'approved'}
            class:rejected={proposal.status === 'rejected'}
          >
            <button
              class="proposal-header"
              onclick={() =>
                patternLearningStore.selectProposal(
                  patternLearningStore.selectedProposalId === proposal.id ? null : proposal.id,
                )}
            >
              <span
                class="proposal-type-badge"
                class:skill={proposal.proposalType === 'skill'}
                class:rule={proposal.proposalType === 'rule'}
              >
                {proposal.proposalType}
              </span>
              <span class="proposal-name">{proposal.name}</span>
              <span class="proposal-status status-{proposal.status}">{proposal.status}</span>
            </button>

            {#if patternLearningStore.selectedProposalId === proposal.id}
              <div class="proposal-detail">
                <p class="proposal-description">{proposal.description}</p>

                {#if proposal.metadata?.rationale}
                  <div class="proposal-rationale">
                    <strong>Rationale:</strong>
                    {proposal.metadata.rationale}
                  </div>
                {/if}

                {#if proposal.metadata?.tags && Array.isArray(proposal.metadata.tags)}
                  <div class="proposal-tags">
                    {#each proposal.metadata.tags as tag}
                      <span class="tag">{tag}</span>
                    {/each}
                  </div>
                {/if}

                <div class="proposal-meta">
                  <span class="meta-item"
                    ><strong>Created:</strong> {formatDate(proposal.createdAt)}</span
                  >
                  {#if proposal.installedPath}
                    <span class="meta-item installed"
                      ><strong>Installed:</strong> {proposal.installedPath}</span
                    >
                  {/if}
                </div>

                <!-- Content preview -->
                <details class="content-preview">
                  <summary>View content</summary>
                  <pre class="content-code">{proposal.content}</pre>
                </details>

                <!-- Action buttons for pending proposals -->
                {#if proposal.status === 'pending'}
                  <div class="proposal-actions">
                    <button class="action-btn approve" onclick={() => handleApprove(proposal)}>
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
                        <polyline points="20 6 9 17 4 12"></polyline>
                      </svg>
                      Approve & Install
                    </button>
                    <button class="action-btn reject" onclick={() => handleReject(proposal)}>
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                      >
                        <path d="M18 6L6 18M6 6l12 12"></path>
                      </svg>
                      Reject
                    </button>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      {/if}

      <!-- LOG TAB -->
    {:else if patternLearningStore.activeTab === 'log'}
      {#if patternLearningStore.learningLog.length === 0}
        <div class="empty-state">
          <div class="empty-icon">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path
                d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8"
              />
            </svg>
          </div>
          No learning events recorded yet. Events appear as the agent detects patterns and creates proposals.
        </div>
      {:else}
        <div class="log-list">
          {#each patternLearningStore.learningLog as entry (entry.id)}
            <div class="log-entry">
              <span class="log-icon">
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path
                    d={logEventIcons[entry.eventType] ||
                      'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5'}
                  />
                </svg>
              </span>
              <div class="log-content">
                <span class="log-message">{entry.message}</span>
                <span class="log-meta">
                  <span class="log-type">{entry.eventType}</span>
                  <span class="log-time">{formatDate(entry.timestamp)}</span>
                </span>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .learning-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .panel-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 14px 8px;
    border-bottom: 1px solid var(--border-secondary);
    flex-shrink: 0;
  }

  .panel-title {
    font-size: var(--fs-sm);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-secondary);
  }

  .pending-badge {
    font-size: var(--fs-xxs);
    font-weight: 700;
    color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent);
    border-radius: 10px;
    padding: 1px 7px;
    white-space: nowrap;
  }

  .refresh-btn {
    margin-left: auto;
    width: 22px;
    height: 22px;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid var(--border-secondary);
    cursor: pointer;
    color: var(--text-tertiary);
    transition: all var(--transition);
    padding: 0;
  }

  .refresh-btn:hover {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 8%, transparent);
  }

  .tab-bar {
    display: flex;
    gap: 0;
    border-bottom: 1px solid var(--border-secondary);
    flex-shrink: 0;
  }

  .tab-btn {
    flex: 1;
    padding: 8px 12px;
    font-size: var(--fs-xs);
    font-weight: 600;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all var(--transition);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
  }

  .tab-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .tab-btn.active {
    color: var(--accent-primary);
    border-bottom-color: var(--accent-primary);
  }

  .tab-badge {
    font-size: var(--fs-xxs);
    font-weight: 700;
    background: var(--accent-primary);
    color: var(--bg-primary);
    border-radius: 8px;
    padding: 0 5px;
    min-width: 14px;
    text-align: center;
  }

  .panel-content {
    flex: 1;
    overflow-y: auto;
  }

  .empty-state {
    color: var(--text-tertiary);
    font-size: var(--fs-sm);
    text-align: center;
    padding: 24px 16px;
    line-height: 1.6;
  }

  .empty-icon {
    display: flex;
    justify-content: center;
    margin-bottom: 8px;
    color: var(--text-tertiary);
    opacity: 0.5;
  }

  /* ── Patterns ── */

  .pattern-item {
    border-bottom: 1px solid var(--border-secondary);
    transition: background var(--transition);
  }

  .pattern-item:hover {
    background: var(--bg-hover);
  }

  .pattern-item.selected {
    background: var(--bg-hover);
  }

  .pattern-header {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 8px 12px;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    color: var(--text-primary);
  }

  .pattern-icon {
    flex-shrink: 0;
    color: var(--text-tertiary);
    display: flex;
    align-items: center;
  }

  .pattern-type-label {
    font-size: var(--fs-sm);
    font-weight: 600;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pattern-count {
    font-size: var(--fs-xs);
    font-weight: 700;
    color: var(--text-tertiary);
    background: var(--bg-tertiary);
    border-radius: 8px;
    padding: 1px 5px;
    flex-shrink: 0;
  }

  .confidence-dot {
    flex-shrink: 0;
    display: flex;
    align-items: center;
  }

  .pattern-detail {
    padding: 0 12px 12px;
  }

  .pattern-description {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    line-height: 1.5;
    margin: 0 0 8px;
  }

  .pattern-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 12px;
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    margin-bottom: 6px;
  }

  .meta-item {
    display: inline;
  }

  .meta-item strong {
    color: var(--text-secondary);
  }

  .meta-item.proposed {
    color: var(--accent-success);
    font-weight: 600;
  }

  .meta-item.installed {
    color: var(--accent-success);
    word-break: break-all;
  }

  .pattern-tools {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
  }

  .tool-tag {
    font-size: var(--fs-xxs);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    border-radius: 3px;
    padding: 0 4px;
    color: var(--text-secondary);
  }

  .action-bar {
    padding: 8px 12px;
    border-top: 1px solid var(--border-secondary);
  }

  .action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    width: 100%;
    padding: 7px 12px;
    font-size: var(--fs-xs);
    font-weight: 600;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-primary);
    background: var(--bg-secondary);
    color: var(--text-primary);
    cursor: pointer;
    transition: all var(--transition);
  }

  .action-btn:hover {
    background: var(--bg-hover);
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }

  .action-btn.approve {
    border-color: var(--accent-success);
    color: var(--accent-success);
  }

  .action-btn.approve:hover {
    background: color-mix(in srgb, var(--accent-success) 15%, transparent);
  }

  .action-btn.reject {
    border-color: var(--border-primary);
    color: var(--text-secondary);
  }

  .action-btn.reject:hover {
    border-color: var(--accent-error);
    color: var(--accent-error);
    background: color-mix(in srgb, var(--accent-error) 8%, transparent);
  }

  /* ── Proposals ── */

  .proposal-filters {
    display: flex;
    gap: 4px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border-secondary);
    flex-shrink: 0;
  }

  .filter-btn {
    font-size: var(--fs-xs);
    font-weight: 600;
    padding: 3px 8px;
    border-radius: var(--radius-sm);
    background: transparent;
    border: 1px solid var(--border-secondary);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all var(--transition);
  }

  .filter-btn:hover {
    border-color: var(--border-primary);
    color: var(--text-primary);
  }

  .filter-btn.active {
    background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }

  .proposal-item {
    border-bottom: 1px solid var(--border-secondary);
    transition: background var(--transition);
  }

  .proposal-item:hover {
    background: var(--bg-hover);
  }

  .proposal-item.selected {
    background: var(--bg-hover);
  }

  .proposal-item.pending {
    border-left: 2px solid var(--accent-primary);
  }

  .proposal-item.approved {
    border-left: 2px solid var(--accent-success);
  }

  .proposal-item.rejected {
    border-left: 2px solid var(--text-tertiary);
    opacity: 0.7;
  }

  .proposal-header {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 8px 12px;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    color: var(--text-primary);
  }

  .proposal-type-badge {
    font-size: var(--fs-xxs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 1px 5px;
    border-radius: 3px;
    flex-shrink: 0;
  }

  .proposal-type-badge.skill {
    color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent);
  }

  .proposal-type-badge.rule {
    color: var(--accent-success);
    background: color-mix(in srgb, var(--accent-success) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent-success) 30%, transparent);
  }

  .proposal-name {
    font-size: var(--fs-sm);
    font-weight: 600;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .proposal-status {
    font-size: var(--fs-xxs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    flex-shrink: 0;
  }

  .status-pending {
    color: var(--accent-primary);
  }

  .status-approved {
    color: var(--accent-success);
  }

  .status-rejected {
    color: var(--text-tertiary);
  }

  .proposal-detail {
    padding: 0 12px 12px;
  }

  .proposal-description {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    line-height: 1.5;
    margin: 0 0 8px;
  }

  .proposal-rationale {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    line-height: 1.5;
    margin-bottom: 8px;
    padding: 6px 8px;
    background: var(--bg-secondary);
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-secondary);
  }

  .proposal-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 8px;
  }

  .tag {
    font-size: var(--fs-xxs);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    border-radius: 3px;
    padding: 1px 5px;
    color: var(--text-secondary);
  }

  .proposal-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 12px;
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    margin-bottom: 8px;
  }

  .content-preview {
    margin-bottom: 8px;
  }

  .content-preview summary {
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 4px 0;
  }

  .content-preview summary:hover {
    color: var(--accent-primary);
  }

  .content-code {
    font-family: var(--font-family-mono, monospace);
    font-size: var(--fs-xxs);
    line-height: 1.5;
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-word;
    background: var(--bg-secondary);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    padding: 8px;
    margin: 4px 0 0;
    max-height: 300px;
    overflow-y: auto;
  }

  .proposal-actions {
    display: flex;
    gap: 6px;
  }

  .proposal-actions .action-btn {
    flex: 1;
  }

  /* ── Log ── */

  .log-list {
    padding: 4px 0;
  }

  .log-entry {
    display: flex;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-secondary);
    align-items: flex-start;
  }

  .log-entry:hover {
    background: var(--bg-hover);
  }

  .log-icon {
    flex-shrink: 0;
    color: var(--text-tertiary);
    display: flex;
    align-items: center;
    padding-top: 2px;
  }

  .log-content {
    flex: 1;
    min-width: 0;
  }

  .log-message {
    font-size: var(--fs-xs);
    color: var(--text-primary);
    display: block;
    line-height: 1.4;
  }

  .log-meta {
    display: flex;
    gap: 8px;
    margin-top: 2px;
  }

  .log-type {
    font-size: var(--fs-xxs);
    font-weight: 600;
    color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
    border-radius: 3px;
    padding: 0 4px;
  }

  .log-time {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
  }
</style>
