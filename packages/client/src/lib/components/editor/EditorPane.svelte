<script lang="ts">
  import { editorStore, detectLanguage } from '$lib/stores/editor.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { workspaceListStore } from '$lib/stores/projects.svelte';
  import { workspaceStore } from '$lib/stores/workspace.svelte';
  import { formatRelativeTime } from '$lib/stores/recent-files.svelte';
  import EditorTabBar from './EditorTabBar.svelte';
  import EditorBreadcrumb from './EditorBreadcrumb.svelte';
  import CodeEditor from './CodeEditor.svelte';
  import CanvasEditor from './canvas-renderer/CanvasEditor.svelte';
  import UnifiedDiffView from './UnifiedDiffView.svelte';
  import DesignerView from './DesignerView.svelte';
  import SassPreview from './SassPreview.svelte';
  import SpatialCodeCanvas from './graph/SpatialCodeCanvas.svelte';
  import Editor3DView from './Editor3DView.svelte';
  import { featureFlags } from '$lib/stores/featureFlags.svelte';

  // The .pui visual designer is hidden for now — .pui files open straight to
  // code. Flip this to re-enable the Design/Code toggle + DesignerView.
  const DESIGNER_ENABLED = false;

  // 3D text view (LYK-1113) — a Code/3D toggle on regular file tabs, behind the
  // editor3dText flag. Tracked per-tab-id (transient, not persisted).
  let view3dTabs = $state<Set<string>>(new Set());
  const can3d = $derived(
    featureFlags.enabled('editor3dText') &&
      !!editorStore.activeTab &&
      (editorStore.activeTab.kind === 'file' || !editorStore.activeTab.kind),
  );
  const view3dOn = $derived(
    can3d && !!editorStore.activeTabId && view3dTabs.has(editorStore.activeTabId),
  );
  function setView3d(on: boolean) {
    const id = editorStore.activeTabId;
    if (!id) return;
    const next = new Set(view3dTabs);
    if (on) next.add(id);
    else next.delete(id);
    view3dTabs = next;
  }

  // Top 5 workspaces for the welcome panel (LYK-1002). recents puts
  // pinned first, then by lastOpened. Hidden when there are no entries.
  const welcomeRecents = $derived(workspaceListStore.recents.slice(0, 5));
  function openWelcomeWorkspace(w: { id: string; name: string; path: string }) {
    void workspaceListStore.switchWorkspace(w.id);
    workspaceStore.openWorkspace({ id: w.id, name: w.name, path: w.path });
  }

  // `.pui` files get the visual designer (LYK-970). Design is the default view;
  // the Design/Code toggle flips tab.designView. Code falls through to CM6.
  const isPuiTab = $derived(
    !!editorStore.activeTab &&
      editorStore.activeTab.kind !== 'diff' &&
      detectLanguage(editorStore.activeTab.fileName) === 'pui',
  );
  const designOn = $derived(
    DESIGNER_ENABLED && isPuiTab && editorStore.activeTab?.designView !== false,
  );

  // SCSS/Sass files get a compiled-CSS preview behind a Code/CSS toggle (Code is
  // the default). Tracked per-tab-id locally (transient, not persisted).
  const isSassTab = $derived(
    !!editorStore.activeTab &&
      editorStore.activeTab.kind !== 'diff' &&
      ['scss', 'sass'].includes(detectLanguage(editorStore.activeTab.fileName)),
  );
  let cssPreviewTabs = $state<Set<string>>(new Set());
  const cssOn = $derived(
    isSassTab && !!editorStore.activeTabId && cssPreviewTabs.has(editorStore.activeTabId),
  );
  function setCssPreview(on: boolean) {
    const id = editorStore.activeTabId;
    if (!id) return;
    const next = new Set(cssPreviewTabs);
    if (on) next.add(id);
    else next.delete(id);
    cssPreviewTabs = next;
  }

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
      {#if settingsStore.breadcrumbsEnabled}
        <EditorBreadcrumb />
      {/if}
      {#if DESIGNER_ENABLED && isPuiTab && editorStore.activeTab}
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
      {#if can3d && editorStore.activeTab}
        <div class="pui-view-toggle" role="tablist" aria-label="View mode">
          <button
            role="tab"
            aria-selected={!view3dOn}
            class:active={!view3dOn}
            onclick={() => setView3d(false)}
          >
            Code
          </button>
          <button
            role="tab"
            aria-selected={view3dOn}
            class:active={view3dOn}
            onclick={() => setView3d(true)}
          >
            3D
          </button>
        </div>
      {/if}
      {#if isSassTab && editorStore.activeTab}
        <div class="pui-view-toggle" role="tablist" aria-label="View mode">
          <button
            role="tab"
            aria-selected={!cssOn}
            class:active={!cssOn}
            onclick={() => setCssPreview(false)}
          >
            Code
          </button>
          <button
            role="tab"
            aria-selected={cssOn}
            class:active={cssOn}
            onclick={() => setCssPreview(true)}
          >
            CSS
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
          {:else if editorStore.activeTab.kind === 'code-canvas'}
            <SpatialCodeCanvas startFilePath={editorStore.activeTab.filePath} />
          {:else if view3dOn}
            <Editor3DView
              content={editorStore.activeTab.content}
              focusLine={editorStore.activeTab.cursorLine}
              onJump={(line) => {
                setView3d(false);
                editorStore.setPendingGoTo({ line, col: 1 });
              }}
            />
          {:else if designOn}
            <DesignerView tab={editorStore.activeTab} />
          {:else if cssOn}
            <SassPreview tab={editorStore.activeTab} />
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

        {#if welcomeRecents.length > 0}
          <!-- Welcome recent-workspaces section (LYK-1002). Pinned first,
               then by lastOpened, cap at 5 — keeps the empty state usable
               as a low-cost "start here" surface for new sessions. -->
          <div class="welcome-recents" aria-label="Recent workspaces">
            <div class="welcome-recents-title">Recent Workspaces</div>
            <ul class="welcome-recents-list">
              {#each welcomeRecents as w (w.id)}
                {@const hint = formatRelativeTime(w.lastOpened ?? 0)}
                {@const pinned = workspaceListStore.isPinned(w.id)}
                <li class="welcome-recents-row">
                  <button
                    type="button"
                    class="welcome-recents-open"
                    title={w.path}
                    onclick={() => openWelcomeWorkspace(w)}
                  >
                    {#if pinned}<span class="welcome-pin" aria-hidden="true">📌</span>{/if}
                    <span class="welcome-recents-name">{w.name}</span>
                    {#if hint}<span class="welcome-recents-time">{hint}</span>{/if}
                  </button>
                  <button
                    type="button"
                    class="welcome-recents-pin-btn"
                    title={pinned ? 'Unpin' : 'Pin'}
                    aria-pressed={pinned}
                    onclick={() => workspaceListStore.togglePin(w.id)}
                  >
                    {pinned ? '★' : '☆'}
                  </button>
                </li>
              {/each}
            </ul>
          </div>
        {/if}
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

  /* ── Welcome: recent workspaces (LYK-1002) ── */
  .welcome-recents {
    margin-top: 32px;
    width: 100%;
    max-width: 380px;
    padding: 0 24px;
    color: var(--text-secondary);
  }
  .welcome-recents-title {
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 6px;
    padding: 0 6px;
  }
  .welcome-recents-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .welcome-recents-row {
    display: flex;
    align-items: stretch;
    gap: 2px;
    border-radius: var(--radius-sm);
  }
  .welcome-recents-row:hover {
    background: var(--bg-hover);
  }
  .welcome-recents-open {
    flex: 1;
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 4px 6px;
    background: none;
    border: none;
    color: inherit;
    font: inherit;
    font-size: var(--fs-sm);
    text-align: left;
    cursor: pointer;
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .welcome-recents-name {
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .welcome-recents-time {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    margin-left: auto;
    flex-shrink: 0;
  }
  .welcome-pin {
    font-size: var(--fs-xxs);
  }
  .welcome-recents-pin-btn {
    width: 24px;
    padding: 0;
    background: none;
    border: none;
    color: var(--text-tertiary);
    cursor: pointer;
    font-size: var(--fs-base);
    line-height: 1;
    border-radius: var(--radius-sm);
  }
  .welcome-recents-pin-btn:hover {
    color: var(--accent-warning, var(--accent-primary));
  }
  .welcome-recents-pin-btn[aria-pressed='true'] {
    color: var(--accent-warning, var(--accent-primary));
  }
</style>
