<script lang="ts">
  // Visual designer for `.pui` files (LYK-970, first slice).
  //
  // This is the SEAM + SCAFFOLD only: it proves the designer mounts in the
  // editor area for a `.pui` tab and is wired to the tab's source via
  // editorStore. The real Section-tree canvas, the ComponentLibrary palette
  // (LYK-969), the inspector, and the live `.pui` preview (port of Parascape's
  // demos/live-compile.ts) land in later slices. `.pui` source stays canonical:
  // the designer reads tab.content and writes back via editorStore.updateContent
  // so dirty/save/undo and the code view stay in sync.
  import { editorStore, type EditorTab } from '$lib/stores/editor.svelte';

  let { tab }: { tab: EditorTab } = $props();

  const lineCount = $derived(tab.content ? tab.content.split('\n').length : 0);

  // Source-canonical round-trip: edits flow back through editorStore so the
  // tab's dirty/save state and the Code view stay in sync. The Section-tree
  // canvas (later slice) will drive these same writes via pageToSource().
  function onSourceInput(e: Event) {
    editorStore.updateContent(tab.id, (e.currentTarget as HTMLTextAreaElement).value);
  }
</script>

<div class="designer">
  <div class="designer-body">
    <aside class="rail rail-left">
      <div class="rail-title">Palette</div>
      <p class="placeholder">ComponentLibrary palette — LYK-969</p>
    </aside>

    <section class="canvas">
      <div class="canvas-note">
        <strong>Visual designer</strong>
        <span>{tab.fileName} · {lineCount} lines · LYK-970 (scaffold)</span>
        <p>
          Section-tree canvas + live <code>.pui</code> preview land next. Edits below write back through
          the same tab the Code view edits (dirty/save stay in sync).
        </p>
      </div>
      <textarea
        class="source"
        spellcheck="false"
        value={tab.content}
        oninput={onSourceInput}
        aria-label="{tab.fileName} source"
      ></textarea>
    </section>

    <aside class="rail rail-right">
      <div class="rail-title">Inspector</div>
      <p class="placeholder">Selected-node props — LYK-970</p>
    </aside>
  </div>
</div>

<style>
  .designer {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    background: var(--bg-code);
  }
  .designer-body {
    display: grid;
    grid-template-columns: 200px 1fr 240px;
    flex: 1;
    min-height: 0;
  }
  .rail {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    overflow: auto;
    border-color: var(--border-subtle, rgba(255, 255, 255, 0.08));
  }
  .rail-left {
    border-right: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
  }
  .rail-right {
    border-left: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
  }
  .rail-title {
    font-size: var(--fs-sm);
    font-weight: 600;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    color: var(--text-secondary, #aaa);
  }
  .placeholder {
    font-size: var(--fs-sm);
    color: var(--text-tertiary);
    opacity: 0.7;
  }
  .canvas {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: auto;
    padding: 16px;
    gap: 12px;
  }
  .canvas-note {
    display: flex;
    flex-direction: column;
    gap: 4px;
    color: var(--text-tertiary);
    font-size: var(--fs-sm);
  }
  .canvas-note strong {
    color: var(--text-secondary, #ccc);
    font-size: var(--fs-md);
  }
  .source {
    flex: 1;
    min-height: 0;
    margin: 0;
    padding: 12px;
    border: none;
    outline: none;
    resize: none;
    border-radius: 6px;
    background: var(--bg-elevated, rgba(255, 255, 255, 0.03));
    color: var(--text-secondary, #bbb);
    font-family: var(--font-mono, monospace);
    font-size: var(--fs-sm);
    line-height: 1.5;
    white-space: pre;
    overflow: auto;
    tab-size: 2;
  }
</style>
