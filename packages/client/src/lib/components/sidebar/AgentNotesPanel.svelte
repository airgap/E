<script lang="ts">
  import { agentNotesStore } from '$lib/stores/agent-notes.svelte';
  import { workspaceStore } from '$lib/stores/workspace.svelte';
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { uiStore } from '$lib/stores/ui.svelte';
  import { api } from '$lib/api/client';
  import type { AgentNote, AgentNoteCategory } from '@e/shared';

  type FilterOption = AgentNoteCategory | 'all' | 'unread';

  let expandedId = $state<string | null>(null);

  let workspacePath = $derived(workspaceStore.activeWorkspace?.workspacePath);

  // Load notes when workspace changes
  $effect(() => {
    if (workspacePath) {
      agentNotesStore.load(workspacePath);
    } else {
      agentNotesStore.clear();
    }
  });

  const categoryLabels: Record<AgentNoteCategory, string> = {
    research: 'Research',
    report: 'Report',
    recommendation: 'Recommendation',
    status: 'Status',
    general: 'General',
    'skill-proposal': 'Skill Proposal',
  };

  const categoryIcons: Record<AgentNoteCategory, string> = {
    research: 'M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM21 21l-4.35-4.35',
    report:
      'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8',
    recommendation:
      'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z',
    status: 'M9 11l3 3L22 4 M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
    general:
      'M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-3l-4 4z',
    'skill-proposal':
      'M12 3l1.67 5.14h5.41l-4.38 3.18L16.38 17 12 13.82 7.62 17l1.68-5.68L4.92 8.14h5.41z',
  };

  function toggleExpand(note: AgentNote) {
    if (expandedId === note.id) {
      expandedId = null;
    } else {
      expandedId = note.id;
      // Auto-mark as read when expanded
      if (note.status === 'unread') {
        agentNotesStore.markAsRead(note.id);
      }
    }
  }

  async function navigateToConversation(note: AgentNote) {
    if (note.conversationId) {
      try {
        const res = await api.conversations.get(note.conversationId);
        if (res.ok && res.data) {
          conversationStore.setActive(res.data);
          uiStore.setSidebarTab('conversations');
        }
      } catch (err) {
        console.error('[agent-notes] Failed to navigate to conversation:', err);
      }
    }
  }

  function formatDate(ts: number) {
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

  function truncateContent(content: string, maxLen = 200): string {
    if (content.length <= maxLen) return content;
    return content.slice(0, maxLen).trimEnd() + '...';
  }

  async function approveProposal(note: AgentNote) {
    if (!workspacePath || !note.metadata?.proposalId) return;

    try {
      const res = await api.learning.approveProposal(note.metadata.proposalId as string);

      if (res.ok) {
        // Archive the note
        await agentNotesStore.archive(note.id);
      }
    } catch (err) {
      console.error('[agent-notes] Failed to approve proposal:', err);
    }
  }

  async function rejectProposal(note: AgentNote, _ignorePatternType = false) {
    if (!workspacePath || !note.metadata?.proposalId) return;

    try {
      const res = await api.learning.rejectProposal(note.metadata.proposalId as string);

      if (res.ok) {
        // Archive the note
        await agentNotesStore.archive(note.id);
      }
    } catch (err) {
      console.error('[agent-notes] Failed to reject proposal:', err);
    }
  }
</script>

<div class="notes-panel">
  <div class="panel-header">
    <span class="panel-title">Agent Notes</span>
    {#if agentNotesStore.count > 0}
      <span class="panel-count">{agentNotesStore.count}</span>
    {/if}
    {#if agentNotesStore.unreadCount > 0}
      <span class="unread-badge">{agentNotesStore.unreadCount} new</span>
    {/if}
    {#if agentNotesStore.unreadCount > 0}
      <button
        class="mark-read-btn"
        onclick={() => agentNotesStore.markAllAsRead()}
        title="Mark all as read"
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
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
          <polyline points="22 4 12 14.01 9 11.01"></polyline>
        </svg>
      </button>
    {/if}
  </div>

  <!-- Filter tabs -->
  <div class="filter-tabs">
    {#each ['all', 'unread', 'skill-proposal', 'report', 'research', 'recommendation', 'status', 'general'] as f}
      <button
        class="filter-tab"
        class:active={agentNotesStore.filterCategory === f}
        onclick={() => agentNotesStore.setFilter(f as FilterOption)}
      >
        {#if f === 'all'}All
        {:else if f === 'unread'}
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none"
            ><circle cx="12" cy="12" r="6" /></svg
          >
          Unread
        {:else}
          {categoryLabels[f as AgentNoteCategory] ?? f}
        {/if}
      </button>
    {/each}
  </div>

  <!-- Notes list -->
  <div class="notes-list">
    {#if agentNotesStore.loading}
      <div class="empty-state">Loading...</div>
    {:else if !workspacePath}
      <div class="empty-state">Open a workspace to see agent notes.</div>
    {:else if agentNotesStore.filteredNotes.length === 0}
      <div class="empty-state">
        {#if agentNotesStore.filterCategory === 'unread'}
          No unread notes. You're all caught up!
        {:else if agentNotesStore.filterCategory === 'all'}
          <div class="empty-icon">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path
                d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-3l-4 4z"
              />
            </svg>
          </div>
          No agent notes yet. When agents complete tasks in the loop, their reports will appear here.
        {:else}
          No {agentNotesStore.filterCategory} notes.
        {/if}
      </div>
    {:else}
      {#each agentNotesStore.filteredNotes as note (note.id)}
        <div
          class="note-item"
          class:expanded={expandedId === note.id}
          class:unread={note.status === 'unread'}
        >
          <!-- Header row -->
          <div class="note-header">
            <button class="note-expand-btn" onclick={() => toggleExpand(note)} title="Expand note">
              {#if note.status === 'unread'}
                <span class="unread-dot"></span>
              {/if}
              <span class="note-category-icon">
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
                  <path d={categoryIcons[note.category] || categoryIcons.general} />
                </svg>
              </span>
              <span class="note-title">{note.title}</span>
              <span class="note-chevron" class:rotated={expandedId === note.id}>
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </span>
            </button>
            <div class="note-actions">
              {#if note.conversationId}
                <button
                  class="note-action-btn"
                  onclick={() => navigateToConversation(note)}
                  title="Go to conversation"
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
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </button>
              {/if}
              <button
                class="note-action-btn"
                onclick={() => agentNotesStore.archive(note.id)}
                title="Archive"
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
                  <path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4" />
                </svg>
              </button>
              <button
                class="note-action-btn danger"
                onclick={() => agentNotesStore.remove(note.id)}
                title="Delete"
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path d="M18 6L6 18M6 6l12 12"></path>
                </svg>
              </button>
            </div>
          </div>

          <!-- Meta row -->
          <div class="note-meta">
            <span class="note-category-badge">{categoryLabels[note.category] ?? note.category}</span
            >
            <span class="note-date">{formatDate(note.createdAt)}</span>
          </div>

          <!-- Preview (collapsed) -->
          {#if expandedId !== note.id}
            <div class="note-preview">
              {truncateContent(
                note.content
                  .replace(/^#.*\n/gm, '')
                  .replace(/[*`#\[\]]/g, '')
                  .trim(),
              )}
            </div>
          {/if}

          <!-- Expanded content -->
          {#if expandedId === note.id}
            <div class="note-content">
              <pre class="note-markdown">{note.content}</pre>
            </div>

            <!-- Skill proposal actions -->
            {#if note.category === 'skill-proposal' && note.metadata?.proposalId}
              <div class="proposal-actions">
                <button class="proposal-btn approve" onclick={() => approveProposal(note)}>
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
                  Approve & Create
                </button>
                <button class="proposal-btn reject" onclick={() => rejectProposal(note, false)}>
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
                <button
                  class="proposal-btn reject-ignore"
                  onclick={() => rejectProposal(note, true)}
                  title="Reject and ignore this pattern type"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
                  </svg>
                  Reject & Ignore Type
                </button>
              </div>
            {/if}
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .notes-panel {
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

  .panel-count {
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-tertiary);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    border-radius: 10px;
    padding: 0 6px;
    min-width: 18px;
    text-align: center;
  }

  .unread-badge {
    font-size: var(--fs-xxs);
    font-weight: 700;
    color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent);
    border-radius: 10px;
    padding: 1px 7px;
    white-space: nowrap;
  }

  .mark-read-btn {
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

  .mark-read-btn:hover {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 8%, transparent);
  }

  .filter-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border-secondary);
    flex-shrink: 0;
  }

  .filter-tab {
    font-size: var(--fs-xs);
    font-weight: 600;
    padding: 3px 8px;
    border-radius: var(--radius-sm);
    background: transparent;
    border: 1px solid var(--border-secondary);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all var(--transition);
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }

  .filter-tab:hover {
    border-color: var(--border-primary);
    color: var(--text-primary);
  }

  .filter-tab.active {
    background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }

  .notes-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
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

  .note-item {
    border-bottom: 1px solid var(--border-secondary);
    transition: background var(--transition);
  }

  .note-item:hover {
    background: var(--bg-hover);
  }

  .note-item.expanded {
    background: var(--bg-hover);
  }

  .note-item.unread {
    background: color-mix(in srgb, var(--accent-primary) 4%, transparent);
  }

  .note-item.unread:hover {
    background: color-mix(in srgb, var(--accent-primary) 8%, transparent);
  }

  .note-header {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 8px 0 0;
  }

  .note-expand-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    padding: 8px 10px;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    color: var(--text-primary);
    min-width: 0;
  }

  .unread-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent-primary);
    flex-shrink: 0;
  }

  .note-category-icon {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    color: var(--text-tertiary);
  }

  .note-title {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-primary);
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .note-chevron {
    flex-shrink: 0;
    color: var(--text-tertiary);
    transition: transform var(--transition);
    display: flex;
    align-items: center;
  }

  .note-chevron.rotated {
    transform: rotate(180deg);
  }

  .note-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  .note-action-btn {
    width: 20px;
    height: 20px;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid transparent;
    cursor: pointer;
    color: var(--text-tertiary);
    transition: all var(--transition);
    padding: 0;
  }

  .note-action-btn:hover {
    color: var(--accent-primary);
    border-color: var(--border-primary);
    background: var(--bg-secondary);
  }

  .note-action-btn.danger:hover {
    color: var(--accent-error);
    border-color: var(--accent-error);
  }

  .note-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px 4px;
  }

  .note-category-badge {
    font-size: var(--fs-xxs);
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent);
    border-radius: 3px;
    padding: 1px 5px;
    flex-shrink: 0;
  }

  .note-date {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
  }

  .note-preview {
    padding: 0 10px 8px;
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    line-height: 1.5;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .note-content {
    padding: 0 10px 10px;
    max-height: 400px;
    overflow-y: auto;
  }

  .note-markdown {
    font-family: var(--font-family-mono, monospace);
    font-size: var(--fs-xs);
    line-height: 1.6;
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-word;
    background: var(--bg-secondary);
    border-radius: var(--radius-sm);
    padding: 10px;
    margin: 0;
  }

  .proposal-actions {
    display: flex;
    gap: 6px;
    padding: 8px 10px;
    border-top: 1px solid var(--border-secondary);
  }

  .proposal-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 6px 10px;
    font-size: var(--fs-xs);
    font-weight: 600;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-primary);
    background: var(--bg-secondary);
    color: var(--text-primary);
    cursor: pointer;
    transition: all var(--transition);
  }

  .proposal-btn:hover {
    background: var(--bg-hover);
    border-color: var(--accent-primary);
  }

  .proposal-btn.approve {
    border-color: var(--accent-success);
    color: var(--accent-success);
  }

  .proposal-btn.approve:hover {
    background: color-mix(in srgb, var(--accent-success) 15%, transparent);
    border-color: var(--accent-success);
  }

  .proposal-btn.reject,
  .proposal-btn.reject-ignore {
    border-color: var(--border-primary);
    color: var(--text-secondary);
  }

  .proposal-btn.reject:hover,
  .proposal-btn.reject-ignore:hover {
    border-color: var(--accent-error);
    color: var(--accent-error);
    background: color-mix(in srgb, var(--accent-error) 8%, transparent);
  }
</style>
