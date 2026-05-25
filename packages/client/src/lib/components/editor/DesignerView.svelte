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
  import { compilePui, type PuiCompileResult } from '$lib/designer/pui-compile';
  import { mountPui } from '$lib/designer/pui-mount';

  let { tab }: { tab: EditorTab } = $props();

  const lineCount = $derived(tab.content ? tab.content.split('\n').length : 0);

  // Source-canonical round-trip: edits flow back through editorStore so the
  // tab's dirty/save state and the Code view stay in sync. The Section-tree
  // canvas (later slice) will drive these same writes via pageToSource().
  function onSourceInput(e: Event) {
    editorStore.updateContent(tab.id, (e.currentTarget as HTMLTextAreaElement).value);
  }

  // Live compile via the canonical Para toolchain (@lyku/para-preprocess →
  // svelte/compiler), debounced. Diagnostics now; mounting the result (the
  // in-browser eval harness) is the next slice.
  let result = $state<PuiCompileResult | null>(null);
  let compiling = $state(false);
  let mountError = $state('');
  let previewEl = $state<HTMLElement>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    const src = tab.content;
    const name = tab.fileName;
    clearTimeout(timer);
    compiling = true;
    timer = setTimeout(async () => {
      const r = await compilePui(src, name);
      result = r;
      compiling = false;
    }, 250);
    return () => clearTimeout(timer);
  });

  // Mount the compiled component into the preview; re-runs on each compile
  // result (cleanup unmounts the previous render first).
  $effect(() => {
    const r = result;
    const el = previewEl;
    mountError = '';
    if (!el || !r?.ok || !r.js) return;
    let handle: { destroy(): void } | undefined;
    try {
      handle = mountPui(el, r.js, r.css);
    } catch (e) {
      mountError = (e as Error).message;
    }
    return () => handle?.destroy();
  });
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
          Live render below. Edits write back through the same tab the Code view edits (dirty/save
          stay in sync). Editable Section-tree canvas + palette land next.
        </p>
        <div class="compile-status" role="status">
          {#if compiling && !result}
            <span class="dot pending"></span> compiling…
          {:else if result?.ok}
            <span class="dot ok"></span> compiles
            {#if result.warnings.length}· {result.warnings.length} warning{result.warnings
                .length === 1
                ? ''
                : 's'}{/if}
          {:else if result?.error}
            <span class="dot err"></span>
            {result.error.message}{#if result.error.line}<span class="loc">
                (line {result.error.line})</span
              >{/if}
          {/if}
        </div>
      </div>
      <div class="preview" class:errored={!!mountError}>
        <div class="preview-host" bind:this={previewEl}></div>
        {#if mountError}
          <div class="preview-overlay">{mountError}</div>
        {/if}
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
  .compile-status {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--fs-sm);
    color: var(--text-secondary, #bbb);
  }
  .compile-status .loc {
    opacity: 0.7;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex: none;
  }
  .dot.ok {
    background: var(--success, #3fb950);
  }
  .dot.err {
    background: var(--danger, #f85149);
  }
  .dot.pending {
    background: var(--text-tertiary, #888);
  }
  .preview {
    position: relative;
    flex: 1;
    min-height: 120px;
    border-radius: 6px;
    background: var(--bg-primary, #fff);
    overflow: auto;
  }
  .preview.errored {
    background: var(--bg-elevated, rgba(255, 255, 255, 0.03));
  }
  .preview-host {
    padding: 16px;
  }
  .preview-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 16px;
    color: var(--text-tertiary);
    font-size: var(--fs-sm);
  }
  .source {
    flex: 0 0 40%;
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
