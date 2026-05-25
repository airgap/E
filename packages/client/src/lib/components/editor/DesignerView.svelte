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
  import { mountPui, type PuiMountHandle } from '$lib/designer/pui-mount';
  import { parsePuiMarkup, findNode, type PuiNode } from '$lib/designer/pui-ast';
  import { api } from '$lib/api/client';

  // Reads a workspace file for the dep resolver; null when it doesn't exist.
  const readFile = async (path: string): Promise<string | null> => {
    try {
      const res = await api.files.read(path);
      return res?.data?.content ?? null;
    } catch {
      return null;
    }
  };

  // Bundles a bare npm specifier from node_modules (parabun bundler, server-side);
  // null when unavailable.
  const bundle = async (specifier: string, fromFile: string): Promise<string | null> => {
    try {
      const res = await api.pui.bundle(specifier, fromFile);
      return res?.data?.js ?? null;
    } catch {
      return null;
    }
  };

  let { tab }: { tab: EditorTab } = $props();

  const lineCount = $derived(tab.content ? tab.content.split('\n').length : 0);

  // Source-canonical round-trip: edits flow back through editorStore so the
  // tab's dirty/save state and the Code view stay in sync.
  function onSourceInput(e: Event) {
    editorStore.updateContent(tab.id, (e.currentTarget as HTMLTextAreaElement).value);
  }

  // Patch the source in place over [start,end) — the source-canonical edit
  // primitive the outline/inspector use (no lossy serialize; formatting and the
  // rest of the file survive).
  function patchRange(start: number, end: number, replacement: string) {
    const src = tab.content;
    editorStore.updateContent(tab.id, src.slice(0, start) + replacement + src.slice(end));
  }

  // Markup outline (parsed with source offsets). Re-derives per edit; selection
  // is path-id based so it survives a re-parse of the same structure.
  const parsed = $derived(parsePuiMarkup(tab.content));
  let selectedId = $state<string | null>(null);
  const selectedNode = $derived(selectedId ? findNode(parsed.tree, selectedId) : null);

  // Live compile via the canonical Para toolchain (@lyku/para-preprocess →
  // svelte/compiler), debounced; the result drives both the compile-status
  // line and the mounted preview below.
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

  // Mount the compiled component into the preview, resolving its import graph
  // (sibling .pui/.svelte, .js/.json) from the workspace. Async; cleanup
  // unmounts the previous render and cancels an in-flight resolve.
  $effect(() => {
    const r = result;
    const el = previewEl;
    const filePath = tab.filePath;
    mountError = '';
    if (!el || !r?.ok || !r.js) return;
    const rootJs = r.js;
    const rootCss = r.css;
    let handle: PuiMountHandle | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const h = await mountPui(el, { rootJs, rootCss, filePath, readFile, bundle });
        if (cancelled) h.destroy();
        else handle = h;
      } catch (e) {
        if (!cancelled) mountError = (e as Error).message;
      }
    })();
    return () => {
      cancelled = true;
      handle?.destroy();
    };
  });
</script>

{#snippet row(node: PuiNode, depth: number)}
  <button
    type="button"
    class="outline-row otype-{node.type}"
    class:sel={selectedId === node.id}
    style="padding-left: {6 + depth * 12}px"
    onclick={() => (selectedId = node.id)}
  >
    {node.label || node.type}
  </button>
  {#each node.children as child (child.id)}{@render row(child, depth + 1)}{/each}
{/snippet}

<div class="designer">
  <div class="designer-body">
    <aside class="rail rail-left">
      <div class="rail-title">Outline</div>
      {#if parsed.error}
        <p class="placeholder">unparsable while editing…</p>
      {:else if !parsed.tree.length}
        <p class="placeholder">empty markup</p>
      {:else}
        <div class="outline">
          {#each parsed.tree as node (node.id)}{@render row(node, 0)}{/each}
        </div>
      {/if}
    </aside>

    <section class="canvas">
      <div class="canvas-note">
        <strong>Visual designer</strong>
        <span>{tab.fileName} · {lineCount} lines · LYK-970</span>
        <p>
          Live render below; pick a node in the Outline to inspect it and edit text in place. All
          edits are source-range patches written back through the same tab the Code view edits
          (dirty/save stay in sync). Palette + on-canvas selection land next.
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
      {#if !selectedNode}
        <p class="placeholder">Select a node in the outline</p>
      {:else}
        <div class="insp">
          <div class="insp-row">
            <span class="insp-k">kind</span><span>{selectedNode.type}</span>
          </div>
          <div class="insp-row">
            <span class="insp-k">node</span><span>{selectedNode.label || '—'}</span>
          </div>
          <div class="insp-row">
            <span class="insp-k">span</span><span>[{selectedNode.start}, {selectedNode.end}]</span>
          </div>
          {#if selectedNode.type === 'text'}
            <label class="insp-field">
              <span class="insp-k">text</span>
              <textarea
                class="insp-text"
                spellcheck="false"
                value={selectedNode.text ?? ''}
                oninput={(e) =>
                  patchRange(
                    selectedNode.start,
                    selectedNode.end,
                    (e.currentTarget as HTMLTextAreaElement).value,
                  )}
              ></textarea>
            </label>
          {:else}
            <pre class="insp-src">{tab.content.slice(selectedNode.start, selectedNode.end)}</pre>
          {/if}
        </div>
      {/if}
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
  .outline {
    display: flex;
    flex-direction: column;
    margin: 0 -12px;
  }
  .outline-row {
    display: block;
    width: 100%;
    text-align: left;
    border: 0;
    background: none;
    cursor: pointer;
    padding: 3px 8px 3px 6px;
    font-family: var(--font-mono, monospace);
    font-size: var(--fs-sm);
    color: var(--text-secondary, #ccc);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .outline-row:hover {
    background: var(--bg-elevated, rgba(255, 255, 255, 0.05));
  }
  .outline-row.sel {
    background: var(--accent-soft, rgba(88, 166, 255, 0.18));
    color: var(--text-primary, #fff);
  }
  .outline-row.otype-component {
    color: var(--accent, #58a6ff);
  }
  .outline-row.otype-text {
    color: var(--text-tertiary, #999);
    font-style: italic;
  }
  .outline-row.otype-block,
  .outline-row.otype-expression {
    color: var(--warning, #d29922);
  }
  .insp {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: var(--fs-sm);
  }
  .insp-row {
    display: flex;
    gap: 8px;
  }
  .insp-k {
    flex: none;
    width: 42px;
    color: var(--text-tertiary, #999);
    text-transform: uppercase;
    font-size: 10px;
    letter-spacing: 0.5px;
    padding-top: 2px;
  }
  .insp-row span:last-child {
    color: var(--text-secondary, #ccc);
    font-family: var(--font-mono, monospace);
    word-break: break-word;
  }
  .insp-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .insp-text {
    resize: vertical;
    min-height: 56px;
    padding: 6px;
    border-radius: 4px;
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.12));
    background: var(--bg-code, #0d1117);
    color: var(--text-primary, #eee);
    font-family: var(--font-mono, monospace);
    font-size: var(--fs-sm);
  }
  .insp-src {
    margin: 0;
    padding: 6px;
    border-radius: 4px;
    background: var(--bg-code, #0d1117);
    color: var(--text-tertiary, #999);
    font-family: var(--font-mono, monospace);
    font-size: var(--fs-sm);
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 160px;
    overflow: auto;
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
