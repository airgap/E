<script lang="ts">
  // LYK-1006: this component now hosts a Unified | Side-by-Side toggle
  // and renders SideBySideDiffView when the user (or persisted setting)
  // prefers paired panes. The "Unified" label was misleading after the
  // toggle landed — the file name kept for backward import compatibility
  // because UnifiedDiffView is imported from many places.
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { featureFlags } from '$lib/stores/featureFlags.svelte';
  import SideBySideDiffView from './SideBySideDiffView.svelte';
  import DiffMorphView from './DiffMorphView.svelte';

  let {
    diffContent,
    fileName,
  }: {
    diffContent: string;
    fileName: string;
  } = $props();

  // In-place morph (LYK-1105) is a local, non-persisted view mode layered on top
  // of the persisted unified/side-by-side preference, and only when the flag is on.
  let morph = $state(false);
  const morphAvailable = $derived(featureFlags.enabled('inPlaceDiffMorph'));

  function setMode(mode: 'unified' | 'side-by-side') {
    morph = false;
    settingsStore.update({ diffViewMode: mode });
  }

  interface DiffLine {
    type: 'added' | 'removed' | 'hunk' | 'context' | 'meta';
    content: string;
    lineNo?: string;
  }

  interface DiffSection {
    header: string;
    lines: DiffLine[];
  }

  function parseDiff(raw: string): DiffSection[] {
    if (!raw.trim()) return [];
    const sections: DiffSection[] = [];
    let current: DiffSection | null = null;

    for (const line of raw.split('\n')) {
      if (line.startsWith('@@')) {
        if (current) sections.push(current);
        current = { header: line, lines: [] };
      } else if (
        line.startsWith('diff ') ||
        line.startsWith('index ') ||
        line.startsWith('--- ') ||
        line.startsWith('+++ ')
      ) {
        // meta lines before first hunk — put in a "header" section
        if (!current) current = { header: '', lines: [] };
        current.lines.push({ type: 'meta', content: line });
      } else if (current) {
        if (line.startsWith('+') && !line.startsWith('+++')) {
          current.lines.push({ type: 'added', content: line });
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          current.lines.push({ type: 'removed', content: line });
        } else {
          current.lines.push({ type: 'context', content: line });
        }
      }
    }
    if (current) sections.push(current);
    return sections;
  }

  let sections = $derived(parseDiff(diffContent));
  let isEmpty = $derived(!diffContent.trim());

  // Summary stats
  let additions = $derived(
    diffContent.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).length,
  );
  let deletions = $derived(
    diffContent.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---')).length,
  );
</script>

<div class="unified-diff">
  {#if morph && morphAvailable && !isEmpty}
    <div class="diff-stats">
      <span class="file-label">{fileName}</span>
      <span class="additions">+{additions}</span>
      <span class="deletions">−{deletions}</span>
      <div class="mode-toggle" role="tablist" aria-label="Diff view mode">
        <button type="button" role="tab" aria-selected="false" onclick={() => setMode('unified')}
          >Unified</button
        >
        <button
          type="button"
          role="tab"
          aria-selected="false"
          onclick={() => setMode('side-by-side')}>Side-by-Side</button
        >
        <button type="button" role="tab" aria-selected="true" class="active">Morph</button>
      </div>
    </div>
    <DiffMorphView {diffContent} {fileName} />
  {:else if settingsStore.diffViewMode === 'side-by-side' && !isEmpty}
    <!-- LYK-1006: hand off to MergeView-backed side-by-side view; the
         mode toggle lives in its header so we don't render two. -->
    <div class="mode-toggle-wrap">
      <span class="file-label">{fileName}</span>
      <div class="mode-toggle" role="tablist" aria-label="Diff view mode">
        <button type="button" role="tab" aria-selected="false" onclick={() => setMode('unified')}
          >Unified</button
        >
        <button type="button" role="tab" aria-selected="true" class="active">Side-by-Side</button>
        {#if morphAvailable}
          <button type="button" role="tab" aria-selected="false" onclick={() => (morph = true)}
            >Morph</button
          >
        {/if}
      </div>
    </div>
    <SideBySideDiffView {diffContent} {fileName} />
  {:else}
    <!-- Stats bar -->
    <div class="diff-stats">
      <span class="file-label">{fileName}</span>
      {#if !isEmpty}
        <span class="additions">+{additions}</span>
        <span class="deletions">−{deletions}</span>
      {/if}
      <div class="mode-toggle" role="tablist" aria-label="Diff view mode">
        <button type="button" role="tab" aria-selected="true" class="active">Unified</button>
        <button
          type="button"
          role="tab"
          aria-selected="false"
          onclick={() => setMode('side-by-side')}>Side-by-Side</button
        >
        {#if morphAvailable}
          <button type="button" role="tab" aria-selected="false" onclick={() => (morph = true)}
            >Morph</button
          >
        {/if}
      </div>
    </div>

    {#if isEmpty}
      <div class="empty-diff">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
        <p>No changes (binary file or identical content)</p>
      </div>
    {:else}
      <div class="diff-body">
        {#each sections as section}
          {#if section.header}
            <div class="hunk-header">{section.header}</div>
          {/if}
          {#each section.lines as line}
            <div class="diff-line diff-{line.type}">
              <span class="line-gutter">
                {#if line.type === 'added'}+{:else if line.type === 'removed'}-{:else}&nbsp;{/if}
              </span>
              <span class="line-content">{line.content.slice(1)}</span>
            </div>
          {/each}
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .unified-diff {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--bg-code);
    font-family: var(--font-mono, 'Menlo', 'Monaco', 'Courier New', monospace);
    font-size: var(--fs-base);
  }

  /* Stats bar */
  .diff-stats {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 14px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-primary);
    flex-shrink: 0;
    font-size: var(--fs-sm);
  }

  /* LYK-1006 view-mode toggle */
  .mode-toggle-wrap {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 14px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-primary);
    font-size: var(--fs-sm);
  }
  .mode-toggle {
    display: inline-flex;
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .mode-toggle button {
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    border: none;
    font: inherit;
    font-size: 11px;
    padding: 2px 8px;
    cursor: pointer;
  }
  .mode-toggle button:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .mode-toggle button.active {
    background: var(--accent-primary);
    color: #fff;
    cursor: default;
  }

  .file-label {
    color: var(--text-secondary);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono, monospace);
  }

  .additions {
    color: #4ade80;
    font-weight: 600;
  }

  .deletions {
    color: #f87171;
    font-weight: 600;
  }

  /* Empty state */
  .empty-diff {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: var(--text-tertiary);
  }

  .empty-diff svg {
    width: 32px;
    height: 32px;
    opacity: 0.35;
  }

  .empty-diff p {
    font-family: var(--font-sans, sans-serif);
    font-size: var(--fs-base);
    margin: 0;
  }

  /* Diff body */
  .diff-body {
    flex: 1;
    overflow: auto;
    padding: 8px 0;
  }

  /* Hunk header */
  .hunk-header {
    padding: 3px 14px;
    color: #60a5fa;
    background: rgba(96, 165, 250, 0.06);
    border-top: 1px solid rgba(96, 165, 250, 0.12);
    border-bottom: 1px solid rgba(96, 165, 250, 0.12);
    font-size: var(--fs-sm);
    white-space: pre;
    user-select: none;
  }

  /* Diff lines */
  .diff-line {
    display: flex;
    line-height: 1.6;
    white-space: pre;
  }

  .diff-line:hover {
    filter: brightness(1.06);
  }

  .diff-added {
    background: rgba(74, 222, 128, 0.1);
    color: #bbf7d0;
  }

  .diff-removed {
    background: rgba(248, 113, 113, 0.1);
    color: #fecaca;
  }

  .diff-context {
    color: var(--text-secondary);
  }

  .diff-meta {
    color: var(--text-tertiary);
    opacity: 0.55;
    font-size: var(--fs-xs);
  }

  /* Gutter */
  .line-gutter {
    width: 24px;
    min-width: 24px;
    text-align: center;
    user-select: none;
    padding: 0 4px;
    color: inherit;
    opacity: 0.6;
  }

  .diff-added .line-gutter {
    color: #4ade80;
    opacity: 1;
  }
  .diff-removed .line-gutter {
    color: #f87171;
    opacity: 1;
  }

  .line-content {
    flex: 1;
    padding-right: 14px;
    overflow-wrap: anywhere;
  }
</style>
