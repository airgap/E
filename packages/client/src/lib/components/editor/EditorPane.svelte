<script lang="ts">
  import { editorStore, detectLanguage } from '$lib/stores/editor.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import EditorTabBar from './EditorTabBar.svelte';
  import EditorBreadcrumb from './EditorBreadcrumb.svelte';
  import CodeEditor from './CodeEditor.svelte';
  import CanvasEditor from './canvas-renderer/CanvasEditor.svelte';
  import UnifiedDiffView from './UnifiedDiffView.svelte';
  import DesignerView from './DesignerView.svelte';

  // `.pui` files get the visual designer (LYK-970). Design is the default view;
  // the Design/Code toggle flips tab.designView. Code falls through to CM6.
  const isPuiTab = $derived(
    !!editorStore.activeTab &&
      editorStore.activeTab.kind !== 'diff' &&
      detectLanguage(editorStore.activeTab.fileName) === 'pui',
  );
  const designOn = $derived(isPuiTab && editorStore.activeTab?.designView !== false);

  $effect(() => {
    console.log(
      '[EditorPane] scrollRenderer=',
      settingsStore.scrollRenderer,
      'hasOpenTabs=',
      editorStore.hasOpenTabs,
      'activeTab=',
      !!editorStore.activeTab,
      'kind=',
      editorStore.activeTab?.kind,
    );
  });
</script>

<div class="editor-pane">
  <div class="editor-area">
    {#if editorStore.hasOpenTabs}
      <EditorTabBar />
      <EditorBreadcrumb />
      {#if isPuiTab && editorStore.activeTab}
        <div class="pui-view-toggle" role="tablist" aria-label="View mode">
          <button
            role="tab"
            aria-selected={designOn}
            class:active={designOn}
            onclick={() => editorStore.setDesignView(editorStore.activeTab!.id, true)}
          >
            Design
          </button>
          <button
            role="tab"
            aria-selected={!designOn}
            class:active={!designOn}
            onclick={() => editorStore.setDesignView(editorStore.activeTab!.id, false)}
          >
            Code
          </button>
        </div>
      {/if}
      {#if editorStore.activeTab}
        {#key editorStore.activeTabId}
          {#if editorStore.activeTab.kind === 'diff'}
            <UnifiedDiffView
              diffContent={editorStore.activeTab.diffContent ?? ''}
              fileName={editorStore.activeTab.filePath}
            />
          {:else if designOn}
            <DesignerView tab={editorStore.activeTab} />
          {:else if settingsStore.scrollRenderer}
            <CanvasEditor tab={editorStore.activeTab} />
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

  .pui-view-toggle {
    display: flex;
    gap: 2px;
    padding: 4px 8px;
    border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
  }
  .pui-view-toggle button {
    font: inherit;
    font-size: var(--fs-sm);
    padding: 2px 10px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
  }
  .pui-view-toggle button:hover {
    color: var(--text-secondary, #ccc);
  }
  .pui-view-toggle button.active {
    background: var(--bg-elevated, rgba(255, 255, 255, 0.08));
    color: var(--text-primary, #fff);
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
