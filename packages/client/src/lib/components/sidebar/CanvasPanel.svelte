<script lang="ts">
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { canvasStore } from '$lib/stores/canvas.svelte';
  import { primaryPaneStore } from '$lib/stores/primaryPane.svelte';
  import CanvasRenderer from '../canvas/CanvasRenderer.svelte';

  let expandedId = $state<string | null>(null);

  const conversationId = $derived(conversationStore.activeId);
  const canvases = $derived(canvasStore.current);

  function toggleExpand(id: string) {
    expandedId = expandedId === id ? null : id;
  }

  function openInTab(id: string) {
    const canvas = canvasStore.getById(id);
    if (!canvas) return;
    primaryPaneStore.openCanvasTab(id, canvas.title || 'Canvas');
  }

  function formatDate(ts: number) {
    return new Date(ts).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  // Update canvas store when conversation changes
  $effect(() => {
    canvasStore.setConversation(conversationId);
  });
</script>

<div class="canvas-panel">
  <div class="panel-header">
    <span class="panel-title">Canvas</span>
    <span class="panel-count">{canvases.length}</span>
  </div>

  <div class="canvas-list">
    {#if !conversationId}
      <div class="empty-state">Open a conversation to see canvas visualizations.</div>
    {:else if canvases.length === 0}
      <div class="empty-state">
        No canvas content yet. Agents can push visual content using the <code>canvas_push</code> tool
        to create diagrams, charts, UI previews, and data visualizations.
      </div>
    {:else}
      {#each canvases as canvas (canvas.id)}
        <div class="canvas-item" class:expanded={expandedId === canvas.id}>
          <!-- Header row -->
          <div class="canvas-item-header">
            <button class="canvas-expand-btn" onclick={() => openInTab(canvas.id)}>
              <span class="canvas-icon">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                  <line x1="3" y1="9" x2="21" y2="9"></line>
                  <line x1="9" y1="21" x2="9" y2="9"></line>
                </svg>
              </span>
              <span class="canvas-type-badge">{canvas.contentType}</span>
              <span class="canvas-name">{canvas.title || 'Untitled Canvas'}</span>
            </button>
            <div class="canvas-actions">
              <button
                class="canvas-action-btn"
                onclick={(e) => {
                  e.stopPropagation();
                  toggleExpand(canvas.id);
                }}
                title="Preview inline"
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  class:rotated={expandedId === canvas.id}
                >
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </button>
            </div>
          </div>

          <!-- Meta row -->
          <div class="canvas-meta">
            <span class="canvas-date">{formatDate(canvas.lastUpdated)}</span>
          </div>

          <!-- Preview -->
          {#if expandedId === canvas.id}
            <div class="canvas-preview">
              <CanvasRenderer
                contentType={canvas.contentType}
                content={canvas.content}
                canvasId={canvas.id}
              />
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .canvas-panel {
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

  .canvas-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
  }

  .empty-state {
    color: var(--text-tertiary);
    font-size: var(--fs-sm);
    text-align: center;
    padding: 24px 16px;
    line-height: 1.6;
  }

  .empty-state code {
    font-family: var(--font-family-mono, monospace);
    font-size: var(--fs-xs);
    background: var(--bg-tertiary);
    padding: 1px 4px;
    border-radius: 3px;
    color: var(--accent-primary);
  }

  .canvas-item {
    border-bottom: 1px solid var(--border-secondary);
    transition: background var(--transition);
  }

  .canvas-item:hover {
    background: var(--bg-hover);
  }

  .canvas-item.expanded {
    background: var(--bg-hover);
  }

  .canvas-item-header {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 8px 0 0;
  }

  .canvas-expand-btn {
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

  .canvas-icon {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    color: var(--text-tertiary);
  }

  .canvas-type-badge {
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

  .canvas-name {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-primary);
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .canvas-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  .canvas-action-btn {
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

  .canvas-action-btn:hover {
    color: var(--accent-primary);
    border-color: var(--border-primary);
    background: var(--bg-secondary);
  }

  .canvas-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px 6px;
  }

  .canvas-date {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
  }

  .canvas-preview {
    padding: 10px;
    max-height: 300px;
    overflow: auto;
    background: var(--bg-secondary);
    border-radius: var(--radius-sm);
    margin: 0 10px 10px;
  }

  /* Chevron rotation for inline preview toggle */
  .canvas-action-btn svg.rotated {
    transform: rotate(180deg);
  }
</style>
