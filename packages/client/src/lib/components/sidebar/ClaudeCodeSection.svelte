<script lang="ts">
  /**
   * Collapsible 'Claude Code' subsection rendered under the E conversation
   * list. Gated by settings.showClaudeCodeHistory at the parent, so this
   * component just renders unconditionally when mounted.
   *
   * Click a row → opens the read-only viewer modal (claude-code-viewer).
   */
  import { onMount } from 'svelte';
  import { workspaceListStore } from '$lib/stores/projects.svelte';
  import { claudeCodeHistoryStore } from '$lib/stores/claude-code-history.svelte';
  import { uiStore } from '$lib/stores/ui.svelte';

  let expanded = $state(true);

  let workspacePath = $derived(workspaceListStore.activeWorkspace?.path ?? null);

  // Reload whenever the active workspace changes (each workspace has its own
  // CC project directory, so summaries are per-workspace).
  $effect(() => {
    if (workspacePath) void claudeCodeHistoryStore.loadList(workspacePath);
  });

  onMount(() => {
    if (workspacePath) void claudeCodeHistoryStore.loadList(workspacePath);
  });

  function openViewer(id: string) {
    if (!workspacePath) return;
    void claudeCodeHistoryStore.loadViewing(workspacePath, id);
    uiStore.openModal('claude-code-viewer');
  }

  function formatRelative(epochMs: number): string {
    const diff = Date.now() - epochMs;
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
    return new Date(epochMs).toLocaleDateString();
  }
</script>

<section class="cc-section" aria-label="Claude Code conversations">
  <button
    class="cc-header"
    onclick={() => (expanded = !expanded)}
    aria-expanded={expanded}
    title={expanded ? 'Collapse' : 'Expand'}
  >
    <svg
      class="caret"
      class:open={expanded}
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
    <span class="label">Claude Code</span>
    <span class="count">{claudeCodeHistoryStore.summaries.length}</span>
  </button>

  {#if expanded}
    {#if claudeCodeHistoryStore.loading && claudeCodeHistoryStore.summaries.length === 0}
      <div class="hint">Loading…</div>
    {:else if !workspacePath}
      <div class="hint">Open a workspace to see Claude Code history.</div>
    {:else if claudeCodeHistoryStore.summaries.length === 0}
      <div class="hint">
        No Claude Code conversations in this workspace yet. Run <code>claude</code> here to get started.
      </div>
    {:else}
      <ul class="cc-list">
        {#each claudeCodeHistoryStore.summaries as conv (conv.id)}
          <li>
            <button
              class="cc-item"
              onclick={() => openViewer(conv.id)}
              title={`${conv.title} · ${conv.messageCount} message${conv.messageCount === 1 ? '' : 's'}`}
            >
              <span class="cc-title truncate">{conv.title}</span>
              <span class="cc-meta">
                <span class="cc-count">{conv.messageCount} msg</span>
                <span class="cc-time">{formatRelative(conv.updatedAt)}</span>
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>

<style>
  .cc-section {
    border-top: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
    padding-top: 4px;
    margin-top: 8px;
  }

  .cc-header {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: transparent;
    border: none;
    color: var(--text-secondary, #aaa);
    font-size: var(--fs-xs, 11px);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 600;
    cursor: pointer;
  }
  .cc-header:hover {
    color: var(--text-primary, #d4d4d4);
  }
  .caret {
    transition: transform 100ms ease;
  }
  .caret.open {
    transform: rotate(90deg);
  }
  .label {
    flex: 1;
    text-align: left;
  }
  .count {
    background: var(--bg-tertiary, rgba(255, 255, 255, 0.06));
    padding: 1px 6px;
    border-radius: 8px;
    font-size: 10px;
    font-weight: 600;
  }

  .cc-list {
    list-style: none;
    margin: 0;
    padding: 0 0 4px;
  }

  .cc-item {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 12px;
    background: transparent;
    border: none;
    color: var(--text-primary, #d4d4d4);
    cursor: pointer;
    text-align: left;
  }
  .cc-item:hover {
    background: var(--bg-hover, rgba(255, 255, 255, 0.04));
  }

  .cc-title {
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .truncate {
    /* Provided by global utility; redeclared so the section is portable. */
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cc-meta {
    display: flex;
    gap: 8px;
    font-size: 10px;
    color: var(--text-tertiary, #888);
  }

  .hint {
    padding: 8px 12px;
    font-size: 11px;
    color: var(--text-tertiary, #888);
  }
  .hint code {
    background: var(--bg-tertiary, rgba(255, 255, 255, 0.06));
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 10px;
  }
</style>
