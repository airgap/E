<script lang="ts">
  /**
   * SideBySideDiffView (LYK-1006) — paired-pane diff backed by CM6's
   * MergeView. Takes the same {diffContent, fileName} props as
   * UnifiedDiffView so it can be a drop-in swap from the toggle in
   * UnifiedDiffView's header.
   *
   * Why this exists: UnifiedDiffView renders the raw +/- stream
   * verbatim — fine for tiny edits, brutal for non-trivial PR
   * review. MergeView gets us:
   *   - Synced scroll with line-aligned gutter spacers
   *   - Word-level intra-line highlighting (highlightChanges)
   *   - Per-pane folding of unchanged regions (collapseUnchanged)
   * for free.
   *
   * Input is a unified diff string. We reconstruct two synthetic
   * documents from the +/-/context lines per hunk; MergeView then
   * computes its own diff between them and renders aligned panes.
   * Synthetic because hunks omit unchanged neighbours by design —
   * we don't have the full file, just the context git emits. The
   * alignment within each hunk stays correct; gaps between hunks
   * are bridged with a literal `… N lines unchanged …` marker.
   */
  import { onMount } from 'svelte';
  import { EditorView } from '@codemirror/view';
  import { MergeView } from '@codemirror/merge';
  import { eEditorTheme, eSyntaxHighlighting } from './e-cm-theme';
  import { loadLanguage } from './language-map';

  let {
    diffContent,
    fileName,
  }: {
    diffContent: string;
    fileName: string;
  } = $props();

  let container: HTMLDivElement;
  let mergeView: MergeView | null = null;

  interface Reconstructed {
    original: string;
    modified: string;
    additions: number;
    deletions: number;
  }

  /**
   * Walk a unified diff and produce two synthetic documents — the
   * "old" side (context + removed lines per hunk) and the "new" side
   * (context + added lines per hunk). Between hunks we inject a marker
   * line so MergeView shows the gap rather than collapsing distinct
   * hunks together.
   */
  function reconstruct(raw: string): Reconstructed {
    if (!raw.trim()) return { original: '', modified: '', additions: 0, deletions: 0 };
    const origLines: string[] = [];
    const modLines: string[] = [];
    let additions = 0;
    let deletions = 0;
    let firstHunk = true;
    let lastOldEnd = -1;
    let lastNewEnd = -1;

    for (const line of raw.split('\n')) {
      if (line.startsWith('@@')) {
        const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
        if (m) {
          const oldStart = parseInt(m[1], 10);
          const oldCount = m[2] ? parseInt(m[2], 10) : 1;
          const newStart = parseInt(m[3], 10);
          const newCount = m[4] ? parseInt(m[4], 10) : 1;
          if (!firstHunk) {
            const oldGap = oldStart - lastOldEnd - 1;
            const newGap = newStart - lastNewEnd - 1;
            if (oldGap > 0 || newGap > 0) {
              origLines.push(`… ${Math.max(0, oldGap)} unchanged lines …`);
              modLines.push(`… ${Math.max(0, newGap)} unchanged lines …`);
            }
          }
          firstHunk = false;
          lastOldEnd = oldStart + oldCount - 1;
          lastNewEnd = newStart + newCount - 1;
        }
        continue;
      }
      if (
        line.startsWith('diff ') ||
        line.startsWith('index ') ||
        line.startsWith('--- ') ||
        line.startsWith('+++ ') ||
        line.startsWith('\\ No newline')
      ) {
        continue; // meta — skip
      }
      if (line.startsWith('+')) {
        modLines.push(line.slice(1));
        additions++;
      } else if (line.startsWith('-')) {
        origLines.push(line.slice(1));
        deletions++;
      } else if (line.startsWith(' ')) {
        origLines.push(line.slice(1));
        modLines.push(line.slice(1));
      } else if (line === '') {
        // Trailing newline / blank — preserve in both.
        origLines.push('');
        modLines.push('');
      }
    }
    return {
      original: origLines.join('\n'),
      modified: modLines.join('\n'),
      additions,
      deletions,
    };
  }

  // Guess the language from the file extension so syntax highlighting
  // matches the source. Falls back to plain text.
  function languageFromName(name: string): string {
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    return ext || 'text';
  }

  let reconstructed = $derived(reconstruct(diffContent));
  let isEmpty = $derived(!diffContent.trim());

  async function init() {
    if (!container) return;
    if (mergeView) {
      mergeView.destroy();
      mergeView = null;
    }
    if (isEmpty) return;

    const langSupport = await loadLanguage(languageFromName(fileName));
    const baseExtensions = [
      eEditorTheme,
      eSyntaxHighlighting,
      EditorView.editable.of(false),
      EditorView.lineWrapping,
    ];
    if (langSupport) baseExtensions.push(langSupport);

    mergeView = new MergeView({
      parent: container,
      a: { doc: reconstructed.original, extensions: [...baseExtensions] },
      b: { doc: reconstructed.modified, extensions: [...baseExtensions] },
      // The three flags the ticket calls out — gutter for aligned
      // spacers, highlightChanges for intra-line word diff,
      // collapseUnchanged so PR-scale diffs don't blow up the view.
      gutter: true,
      highlightChanges: true,
      collapseUnchanged: { margin: 3, minSize: 4 },
    });
  }

  onMount(() => {
    void init();
    return () => {
      if (mergeView) {
        mergeView.destroy();
        mergeView = null;
      }
    };
  });

  // Re-init when the diff content or file changes.
  $effect(() => {
    void diffContent;
    void fileName;
    void init();
  });
</script>

<div class="sbs-wrapper">
  <div class="diff-stats">
    <span class="file-label">{fileName}</span>
    {#if !isEmpty}
      <span class="additions">+{reconstructed.additions}</span>
      <span class="deletions">−{reconstructed.deletions}</span>
    {/if}
  </div>
  {#if isEmpty}
    <div class="empty">No changes (binary file or identical content)</div>
  {:else}
    <div class="diff-pane" bind:this={container}></div>
  {/if}
</div>

<style>
  .sbs-wrapper {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    height: 100%;
  }
  .diff-stats {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 10px;
    border-bottom: 1px solid var(--border-primary);
    font-size: 11px;
    background: var(--bg-secondary);
  }
  .file-label {
    font-family: var(--font-family-mono, ui-monospace, monospace);
    color: var(--text-secondary);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .additions {
    color: var(--accent-secondary, #5ed26b);
    font-weight: 600;
  }
  .deletions {
    color: var(--accent-error, #ef4444);
    font-weight: 600;
  }
  .empty {
    padding: 24px;
    text-align: center;
    color: var(--text-tertiary);
    font-size: 12px;
  }
  .diff-pane {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .diff-pane :global(.cm-mergeView) {
    height: 100%;
  }
  .diff-pane :global(.cm-editor) {
    height: 100%;
  }
  .diff-pane :global(.cm-scroller) {
    overflow: auto;
  }
  .diff-pane :global(.cm-changedLine) {
    background: var(--bg-diff-add);
  }
  .diff-pane :global(.cm-deletedLine) {
    background: var(--bg-diff-remove);
  }
</style>
