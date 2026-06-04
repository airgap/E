<!--
  CodePeekLayer.svelte — renders floating, draggable, live code peeks (LYK-1104).

  Mounted once in the app shell. Each peek is a small window pinned over the UI
  showing a code region; it stays live: when the file is open as an editor tab we
  slice from the tab's current content, otherwise we re-read on a file-watch
  event. Flag-gated (`tearOffPeek`) — when the flag is off the layer renders
  nothing (and the context-menu entry that creates peeks is hidden too).
-->
<script lang="ts">
  import { codePeeksStore } from '$lib/stores/codePeeks.svelte';
  import { editorStore } from '$lib/stores/editor.svelte';
  import { fileWatcherStore } from '$lib/stores/fileWatcher.svelte';
  import { featureFlags } from '$lib/stores/featureFlags.svelte';
  import { api } from '$lib/api/client';

  const enabled = $derived(featureFlags.enabled('tearOffPeek'));

  function sliceRegion(content: string, start: number, end: number): string {
    const lines = content.split('\n');
    return lines.slice(Math.max(0, start - 1), end).join('\n');
  }

  // Live from open editor tabs: when a peeked file is open, re-slice its current
  // (possibly unsaved) content as it changes.
  $effect(() => {
    const tabs = editorStore.tabs;
    for (const pk of codePeeksStore.peeks) {
      const tab = tabs.find((t) => t.filePath === pk.filePath);
      if (tab) {
        const next = sliceRegion(tab.content, pk.startLine, pk.endLine);
        if (next !== pk.content) codePeeksStore.updateContent(pk.id, next);
      }
    }
  });

  // Live from disk: when a watcher event fires for a peeked file that isn't open
  // as a tab, re-read and re-slice.
  $effect(() => {
    const at = fileWatcherStore.lastChangeAt;
    const path = fileWatcherStore.lastChangedPath;
    if (!at || !path) return;
    for (const pk of codePeeksStore.peeks) {
      if (pk.filePath !== path) continue;
      if (editorStore.tabs.some((t) => t.filePath === path)) continue; // tab effect handles it
      api.files
        .read(path)
        .then((res) =>
          codePeeksStore.updateContent(
            pk.id,
            sliceRegion(res.data.content, pk.startLine, pk.endLine),
          ),
        )
        .catch(() => {});
    }
  });

  // ── Drag ────────────────────────────────────────────────────────────────
  let dragId: string | null = null;
  let dragOff = { x: 0, y: 0 };

  function onHeaderDown(e: PointerEvent, id: string, x: number, y: number) {
    e.preventDefault();
    dragId = id;
    dragOff = { x: e.clientX - x, y: e.clientY - y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onHeaderMove(e: PointerEvent) {
    if (!dragId) return;
    const x = Math.max(0, Math.min(window.innerWidth - 120, e.clientX - dragOff.x));
    const y = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - dragOff.y));
    codePeeksStore.move(dragId, x, y);
  }
  function onHeaderUp(e: PointerEvent) {
    dragId = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* not captured */
    }
  }

  function openFull(filePath: string, line: number) {
    editorStore.openFile(filePath, false, { line, col: 1 });
  }
</script>

{#if enabled}
  {#each codePeeksStore.peeks as pk (pk.id)}
    <div
      class="peek"
      style="left: {pk.x}px; top: {pk.y}px; width: {pk.w}px; height: {pk.h}px; z-index: {9995};"
    >
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="peek-head"
        onpointerdown={(e) => onHeaderDown(e, pk.id, pk.x, pk.y)}
        onpointermove={onHeaderMove}
        onpointerup={onHeaderUp}
        ondblclick={() => openFull(pk.filePath, pk.startLine)}
        title="Drag to move · double-click to open file"
      >
        <span class="peek-name">{pk.fileName}</span>
        <span class="peek-range">{pk.startLine}–{pk.endLine}</span>
        <button
          class="peek-close"
          onpointerdown={(e) => e.stopPropagation()}
          onclick={() => codePeeksStore.close(pk.id)}
          title="Close">✕</button
        >
      </div>
      <pre class="peek-body"><code>{pk.content}</code></pre>
    </div>
  {/each}
{/if}

<style>
  .peek {
    position: fixed;
    display: flex;
    flex-direction: column;
    background: var(--bg-secondary);
    border: 1px solid var(--accent-primary);
    border-radius: 8px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.4);
    overflow: hidden;
    resize: both;
    min-width: 160px;
    min-height: 80px;
  }
  .peek-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    background: var(--bg-tertiary);
    border-bottom: 1px solid var(--border-primary);
    cursor: grab;
    user-select: none;
    flex-shrink: 0;
  }
  .peek-head:active {
    cursor: grabbing;
  }
  .peek-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--fs-xs);
    color: var(--text-primary);
    font-family: var(--ff-mono);
  }
  .peek-range {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    font-family: var(--ff-mono);
  }
  .peek-close {
    border: none;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    font-size: 12px;
    padding: 0 2px;
    line-height: 1;
  }
  .peek-close:hover {
    color: var(--text-primary);
  }
  .peek-body {
    flex: 1;
    margin: 0;
    overflow: auto;
    padding: 8px 10px;
    font-family: var(--ff-mono, monospace);
    font-size: var(--fs-xs);
    line-height: 1.5;
    color: var(--text-secondary);
    white-space: pre;
    tab-size: 2;
  }
  .peek-body code {
    font-family: inherit;
  }
</style>
