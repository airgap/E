<script lang="ts">
  import type { RichDiffData, RichDiffFile } from '@e/shared';
  import { editorStore } from '$lib/stores/editor.svelte';
  import { chirpEngine } from '$lib/audio/chirp-engine';
  import { settingsStore } from '$lib/stores/settings.svelte';

  function uiClick() {
    if (settingsStore.soundEnabled) chirpEngine.uiClick();
  }

  let { data } = $props<{ data: string }>();

  let expandedFiles = $state<Set<number>>(new Set([0]));
  let viewMode = $state<'unified' | 'split'>('unified');

  const parsed = $derived.by((): RichDiffData | null => {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  });

  function toggleFile(idx: number) {
    uiClick();
    const next = new Set(expandedFiles);
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    expandedFiles = next;
  }

  function expandAllFiles() {
    if (!parsed) return;
    expandedFiles = new Set(parsed.files.map((_, i) => i));
  }

  function collapseAllFiles() {
    expandedFiles = new Set();
  }

  function openFile(path: string, e?: MouseEvent) {
    e?.stopPropagation();
    editorStore.openFile(path, false);
  }

  function fileAdditions(file: RichDiffFile): number {
    return file.hunks.reduce((n, h) => n + h.lines.filter((l) => l.type === 'add').length, 0);
  }

  function fileDeletions(file: RichDiffFile): number {
    return file.hunks.reduce((n, h) => n + h.lines.filter((l) => l.type === 'remove').length, 0);
  }
</script>

{#if parsed}
  <div class="diff-renderer">
    <div class="diff-toolbar">
      <span class="diff-stats">
        <span class="stat-files"
          >{parsed.stats.filesChanged} file{parsed.stats.filesChanged !== 1 ? 's' : ''}</span
        >
        <span class="stat-add">+{parsed.stats.additions}</span>
        <span class="stat-del">-{parsed.stats.deletions}</span>
      </span>
      <button class="toolbar-btn" onclick={expandAllFiles}>Expand all</button>
      <button class="toolbar-btn" onclick={collapseAllFiles}>Collapse all</button>
    </div>

    {#each parsed.files as file, fi (fi)}
      <div class="diff-file">
        <button class="file-header" onclick={() => toggleFile(fi)}>
          <span class="chevron" class:open={expandedFiles.has(fi)}>&#9654;</span>
          <span class="file-path" onclick={(e) => openFile(file.newPath || file.oldPath, e)}>
            {file.newPath || file.oldPath}
          </span>
          {#if file.renamed}
            <span class="rename-badge">renamed</span>
          {/if}
          {#if file.binary}
            <span class="binary-badge">binary</span>
          {/if}
          <span class="file-stats">
            <span class="file-add">+{fileAdditions(file)}</span>
            <span class="file-del">-{fileDeletions(file)}</span>
          </span>
        </button>

        {#if expandedFiles.has(fi) && !file.binary}
          <div class="hunks">
            {#each file.hunks as hunk, hi (hi)}
              <div class="hunk">
                <div class="hunk-header">
                  @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@
                </div>
                {#each hunk.lines as line (line)}
                  <div
                    class="diff-line"
                    class:add={line.type === 'add'}
                    class:remove={line.type === 'remove'}
                    class:context={line.type === 'context'}
                  >
                    <span class="line-prefix"
                      >{line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}</span
                    >
                    <span class="line-content">{line.content}</span>
                  </div>
                {/each}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .diff-renderer {
    border: var(--ht-border-width, 1px) var(--ht-border-style, solid)
      color-mix(in srgb, var(--text-tertiary, #6e7681) 20%, transparent);
    border-radius: var(--ht-radius, 4px);
    overflow: hidden;
    background: var(--bg-primary, #0d1117);
    transition: border-color var(--ht-transition-speed, 125ms) ease;
  }

  .diff-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    background: color-mix(in srgb, var(--bg-secondary, #161b22) 80%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--text-tertiary, #6e7681) 15%, transparent);
    font-size: var(--fs-sans-xs);
  }

  .diff-stats {
    flex: 1;
    display: flex;
    gap: 8px;
  }

  .stat-files {
    color: var(--text-secondary, #8b949e);
  }

  .stat-add {
    color: var(--accent-secondary, #00ff88);
    font-weight: 600;
  }

  .stat-del {
    color: var(--accent-error, #ff3344);
    font-weight: 600;
  }

  .toolbar-btn {
    padding: 1px 8px;
    border: none;
    background: color-mix(in srgb, var(--text-tertiary, #6e7681) 15%, transparent);
    color: var(--text-tertiary, #6e7681);
    font-family: var(--font-family-mono, monospace);
    font-size: var(--fs-xxs);
    border-radius: 3px;
    cursor: pointer;
  }

  .toolbar-btn:hover {
    color: var(--text-primary, #c9d1d9);
    background: color-mix(in srgb, var(--text-tertiary, #6e7681) 25%, transparent);
  }

  .diff-file {
    border-bottom: 1px solid color-mix(in srgb, var(--text-tertiary, #6e7681) 10%, transparent);
  }

  .diff-file:last-child {
    border-bottom: none;
  }

  .file-header {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 5px 10px;
    border: none;
    background: color-mix(in srgb, var(--bg-secondary, #161b22) 50%, transparent);
    color: var(--text-secondary, #8b949e);
    font-family: var(--font-family-mono, monospace);
    font-size: var(--fs-xs);
    cursor: pointer;
    text-align: left;
  }

  .file-header:hover {
    background: color-mix(in srgb, var(--bg-secondary, #161b22) 70%, transparent);
  }

  .chevron {
    font-size: var(--fs-xxs);
    transition: transform 0.12s;
    flex-shrink: 0;
  }

  .chevron.open {
    transform: rotate(90deg);
  }

  .file-path {
    flex: 1;
    color: var(--text-primary, #c9d1d9);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-path:hover {
    text-decoration: underline;
    color: var(--accent-primary, #00b4ff);
  }

  .rename-badge,
  .binary-badge {
    padding: 1px 5px;
    border-radius: 3px;
    font-size: var(--fs-xs);
    font-weight: 600;
  }

  .rename-badge {
    background: color-mix(in srgb, var(--accent-primary, #00b4ff) 15%, transparent);
    color: var(--accent-primary, #00b4ff);
  }

  .binary-badge {
    background: color-mix(in srgb, var(--text-tertiary, #6e7681) 15%, transparent);
    color: var(--text-tertiary, #6e7681);
  }

  .file-stats {
    display: flex;
    gap: 4px;
    font-size: var(--fs-xxs);
    flex-shrink: 0;
  }

  .file-add {
    color: var(--accent-secondary, #00ff88);
  }

  .file-del {
    color: var(--accent-error, #ff3344);
  }

  .hunk-header {
    padding: 3px 10px;
    color: var(--text-tertiary, #6e7681);
    font-size: var(--fs-xxs);
    background: color-mix(in srgb, var(--accent-primary, #00b4ff) 5%, transparent);
  }

  .diff-line {
    display: flex;
    font-size: var(--fs-xs);
    line-height: 1.5;
  }

  .line-prefix {
    width: 20px;
    text-align: center;
    flex-shrink: 0;
    user-select: none;
    color: var(--text-tertiary, #6e7681);
  }

  .line-content {
    flex: 1;
    padding-right: 8px;
    white-space: pre-wrap;
    word-break: break-all;
  }

  .diff-line.add {
    background: color-mix(in srgb, var(--accent-secondary, #00ff88) 8%, transparent);
  }

  .diff-line.add .line-prefix {
    color: var(--accent-secondary, #00ff88);
  }

  .diff-line.remove {
    background: color-mix(in srgb, var(--accent-error, #ff3344) 8%, transparent);
  }

  .diff-line.remove .line-prefix {
    color: var(--accent-error, #ff3344);
  }
</style>
