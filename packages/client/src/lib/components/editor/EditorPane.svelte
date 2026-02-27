<script lang="ts">
  import { editorStore } from '$lib/stores/editor.svelte';
  import EditorTabBar from './EditorTabBar.svelte';
  import EditorBreadcrumb from './EditorBreadcrumb.svelte';
  import CodeEditor from './CodeEditor.svelte';
  import UnifiedDiffView from './UnifiedDiffView.svelte';
</script>

<div class="editor-pane">
  <div class="editor-area">
    {#if editorStore.hasOpenTabs}
      <EditorTabBar />
      <EditorBreadcrumb />
      {#if editorStore.activeTab}
        {#key editorStore.activeTabId}
          {#if editorStore.activeTab.kind === 'diff'}
            <UnifiedDiffView
              diffContent={editorStore.activeTab.diffContent ?? ''}
              fileName={editorStore.activeTab.filePath}
            />
          {:else}
            <CodeEditor tab={editorStore.activeTab} />
          {/if}
        {/key}
      {/if}
    {:else}
      <div class="empty-state">
        <div class="empty-icon">
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        </div>
        <p class="empty-text">Open a file from the sidebar</p>
        <p class="empty-hint">Click a file or use Ctrl+P to quick open</p>
      </div>
    {/if}
  </div>
</div>

<style>
  .editor-pane {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--bg-code);
  }

  .editor-area {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: var(--text-tertiary);
  }

  .empty-icon {
    opacity: 0.3;
    margin-bottom: 8px;
  }

  .empty-text {
    font-size: var(--fs-md);
    font-weight: 600;
    letter-spacing: 0.5px;
  }

  .empty-hint {
    font-size: var(--fs-sm);
    opacity: 0.6;
  }
</style>
