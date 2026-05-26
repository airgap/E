<script lang="ts">
  // Compiled-CSS preview for an SCSS/Sass tab. Debounce-compiles the live buffer
  // via the server (Dart Sass), resolving @use/@import from the file's directory,
  // and shows the CSS read-only. Errors (with Sass's line/column message) show in
  // place. The source stays canonical — this view never writes back.
  import { api } from '$lib/api/client';
  import type { EditorTab } from '$lib/stores/editor.svelte';

  let { tab }: { tab: EditorTab } = $props();

  const indented = $derived(tab.language === 'sass');
  let css = $state('');
  let error = $state('');
  let compiling = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    const source = tab.content;
    const path = tab.filePath;
    const isIndented = indented;
    clearTimeout(timer);
    compiling = true;
    let cancelled = false;
    timer = setTimeout(async () => {
      try {
        const res = await api.sass.compile(source, path, isIndented);
        if (cancelled) return;
        if (res?.ok) {
          css = res.data?.css ?? '';
          error = '';
        } else {
          error = res?.error ?? 'compile failed';
        }
      } catch (e) {
        if (!cancelled) error = (e as Error).message;
      } finally {
        if (!cancelled) compiling = false;
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  });

  const lineCount = $derived(css ? css.split('\n').length : 0);
</script>

<div class="sass-preview">
  <div class="sp-status" role="status">
    {#if compiling && !css && !error}
      <span class="dot pending"></span> compiling…
    {:else if error}
      <span class="dot err"></span> error
    {:else}
      <span class="dot ok"></span> compiled · {lineCount} line{lineCount === 1 ? '' : 's'}
    {/if}
  </div>
  {#if error}
    <pre class="sp-error">{error}</pre>
  {:else}
    <pre class="sp-css">{css}</pre>
  {/if}
</div>

<style>
  .sass-preview {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    background: var(--bg-code);
  }
  .sp-status {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    font-size: var(--fs-sm);
    color: var(--text-secondary, #bbb);
    border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
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
  .sp-css,
  .sp-error {
    margin: 0;
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 12px;
    font-family: var(--font-mono, monospace);
    font-size: var(--fs-sm);
    line-height: 1.5;
    white-space: pre;
    tab-size: 2;
  }
  .sp-css {
    color: var(--text-primary, #eee);
  }
  .sp-error {
    color: var(--danger, #f85149);
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
