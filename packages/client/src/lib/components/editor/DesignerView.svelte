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
  import { parsePuiMarkup, findNode, instrumentMarkup, type PuiNode } from '$lib/designer/pui-ast';
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

  // Remove a node and the whitespace that framed it (leading indent on its line
  // + one trailing newline) so deletion doesn't leave a blank line behind.
  function deleteNode(node: PuiNode) {
    const src = tab.content;
    let s = node.start;
    let e = node.end;
    while (s > 0 && (src[s - 1] === ' ' || src[s - 1] === '\t')) s--;
    if (src[e] === '\n') e++;
    editorStore.updateContent(tab.id, src.slice(0, s) + src.slice(e));
    selectedId = null;
  }

  // Insert a copy of the node right after it, on its own line at the node's
  // indentation. Selection stays on the original (its path-id is unchanged).
  function duplicateNode(node: PuiNode) {
    const src = tab.content;
    const lineStart = src.lastIndexOf('\n', node.start - 1) + 1;
    const indent = /^[ \t]*/.exec(src.slice(lineStart, node.start))?.[0] ?? '';
    const frag = src.slice(node.start, node.end);
    editorStore.updateContent(
      tab.id,
      src.slice(0, node.end) + '\n' + indent + frag + src.slice(node.end),
    );
  }

  // Markup outline (parsed with source offsets). Re-derives per edit; selection
  // is path-id based so it survives a re-parse of the same structure.
  const parsed = $derived(parsePuiMarkup(tab.content));
  let selectedId = $state<string | null>(null);
  const selectedNode = $derived(selectedId ? findNode(parsed.tree, selectedId) : null);

  // Live compile via the canonical Para toolchain (@lyku/para-preprocess →
  // svelte/compiler), debounced. `result` (clean source) drives the honest
  // compile-status line; `preview` is an INSTRUMENTED copy — each host element
  // tagged with data-pui-id — so a click in the render maps back to its outline
  // node. The canonical source the user edits is never touched.
  let result = $state<PuiCompileResult | null>(null);
  let preview = $state<PuiCompileResult | null>(null);
  let compiling = $state(false);
  let mountError = $state('');
  let previewEl = $state<HTMLElement>();
  let mountTick = $state(0);
  let timer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    const src = tab.content;
    const name = tab.fileName;
    clearTimeout(timer);
    compiling = true;
    timer = setTimeout(async () => {
      const clean = await compilePui(src, name);
      result = clean;
      const instrumented = instrumentMarkup(src, parsePuiMarkup(src).tree);
      const inst = await compilePui(instrumented, name);
      // Fall back to the clean compile if instrumentation somehow broke it.
      preview = inst.ok ? inst : clean;
      compiling = false;
    }, 250);
    return () => clearTimeout(timer);
  });

  // Mount the (instrumented) compiled component into the preview, resolving its
  // import graph (sibling .pui/.svelte, .js/.json, .ts/.pts, bare npm) from the
  // workspace. Async; cleanup unmounts the previous render and cancels an
  // in-flight resolve. Bumps mountTick on success so the selection ring
  // re-applies after each re-render.
  $effect(() => {
    const r = preview;
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
        else {
          handle = h;
          mountTick++;
        }
      } catch (e) {
        if (!cancelled) mountError = (e as Error).message;
      }
    })();
    return () => {
      cancelled = true;
      handle?.destroy();
    };
  });

  // Click in the render → select the nearest tagged host element's outline node.
  $effect(() => {
    const host = previewEl;
    if (!host) return;
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.('[data-pui-id]');
      const id = el?.getAttribute('data-pui-id');
      if (id) selectedId = id;
    };
    host.addEventListener('click', onClick);
    return () => host.removeEventListener('click', onClick);
  });

  // Ring the selected node in the render. Re-runs on selection AND after each
  // re-mount (mountTick) so the highlight survives recompiles.
  $effect(() => {
    const host = previewEl;
    const id = selectedId;
    void mountTick; // dependency: re-apply after a re-render
    if (!host) return;
    for (const prev of host.querySelectorAll<HTMLElement>('[data-pui-sel]')) {
      prev.removeAttribute('data-pui-sel');
      prev.style.outline = '';
      prev.style.outlineOffset = '';
    }
    if (!id) return;
    const el = host.querySelector<HTMLElement>(`[data-pui-id="${id}"]`);
    if (el) {
      el.setAttribute('data-pui-sel', '');
      el.style.outline = '2px solid var(--accent, #58a6ff)';
      el.style.outlineOffset = '-1px';
    }
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
          <div class="insp-actions">
            <button
              type="button"
              class="insp-btn"
              onclick={() => selectedNode && duplicateNode(selectedNode)}
            >
              Duplicate
            </button>
            <button
              type="button"
              class="insp-btn danger"
              onclick={() => selectedNode && deleteNode(selectedNode)}
            >
              Delete
            </button>
          </div>
          {#if selectedNode.attrs}
            <div class="insp-attrs">
              <span class="insp-k">attrs</span>
              <div class="attr-list">
                {#each selectedNode.attrs as attr, ai (ai)}
                  {#if attr.kind === 'static'}
                    <label class="attr-row">
                      <span class="attr-name">{attr.name}</span>
                      <input
                        class="attr-input"
                        spellcheck="false"
                        value={attr.value ?? ''}
                        oninput={(e) =>
                          patchRange(
                            attr.valueStart ?? 0,
                            attr.valueEnd ?? 0,
                            (e.currentTarget as HTMLInputElement).value,
                          )}
                      />
                    </label>
                  {:else}
                    <div class="attr-row">
                      <span class="attr-name">{attr.name}</span>
                      <span class="attr-badge attr-{attr.kind}">{attr.kind}</span>
                    </div>
                  {/if}
                {/each}
              </div>
            </div>
          {/if}
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
  .insp-attrs {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .attr-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .attr-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .attr-name {
    flex: none;
    min-width: 64px;
    max-width: 96px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--accent, #58a6ff);
    font-family: var(--font-mono, monospace);
    font-size: var(--fs-sm);
  }
  .attr-input {
    flex: 1;
    min-width: 0;
    padding: 3px 6px;
    border-radius: 4px;
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.12));
    background: var(--bg-code, #0d1117);
    color: var(--text-primary, #eee);
    font-family: var(--font-mono, monospace);
    font-size: var(--fs-sm);
  }
  .attr-badge {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-tertiary, #999);
    opacity: 0.8;
  }
  .insp-actions {
    display: flex;
    gap: 6px;
  }
  .insp-btn {
    flex: 1;
    padding: 4px 8px;
    border-radius: 4px;
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.12));
    background: var(--bg-elevated, rgba(255, 255, 255, 0.04));
    color: var(--text-secondary, #ccc);
    font-size: var(--fs-sm);
    cursor: pointer;
  }
  .insp-btn:hover {
    background: var(--bg-hover, rgba(255, 255, 255, 0.08));
    color: var(--text-primary, #fff);
  }
  .insp-btn.danger:hover {
    border-color: var(--danger, #f85149);
    color: var(--danger, #f85149);
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
