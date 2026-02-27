<script lang="ts">
  import { onMount } from 'svelte';
  import { EditorView } from '@codemirror/view';
  import { EditorState } from '@codemirror/state';
  import { MergeView } from '@codemirror/merge';
  import { eEditorTheme, eSyntaxHighlighting } from './e-cm-theme';
  import { loadLanguage } from './language-map';

  let {
    original,
    modified,
    language = 'text',
  } = $props<{
    original: string;
    modified: string;
    language?: string;
  }>();

  let container: HTMLDivElement;
  let mergeView: MergeView | null = null;

  async function init() {
    if (!container) return;
    if (mergeView) {
      mergeView.destroy();
      mergeView = null;
    }

    const langSupport = await loadLanguage(language);
    const extensions = [eEditorTheme, eSyntaxHighlighting, EditorView.editable.of(false)];
    if (langSupport) extensions.push(langSupport);

    mergeView = new MergeView({
      parent: container,
      a: {
        doc: original,
        extensions,
      },
      b: {
        doc: modified,
        extensions: [...extensions],
      },
    });
  }

  onMount(() => {
    init();
    return () => {
      if (mergeView) {
        mergeView.destroy();
        mergeView = null;
      }
    };
  });
</script>

<div class="diff-view" bind:this={container}></div>

<style>
  .diff-view {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    border: 1px solid var(--border-primary);
    border-radius: var(--radius);
  }
  .diff-view :global(.cm-mergeView) {
    height: 100%;
  }
  .diff-view :global(.cm-editor) {
    height: 100%;
  }
  .diff-view :global(.cm-scroller) {
    overflow: auto;
  }
  .diff-view :global(.cm-changedLine) {
    background: var(--bg-diff-add);
  }
  .diff-view :global(.cm-deletedLine) {
    background: var(--bg-diff-remove);
  }
</style>
