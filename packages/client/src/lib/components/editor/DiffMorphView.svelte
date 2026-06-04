<!--
  DiffMorphView.svelte — in-place old→new morph with a scrub slider (LYK-1105).

  Instead of a split or stacked diff, the change plays out in a single pane: drag
  the slider (or hit play) and removed lines collapse + fade out while added lines
  grow + fade in, so old morphs into new in place. t=0 is the old file, t=1 the
  new. Context lines stay put. Reuses the unified-diff string the diff tab already
  carries. Flag-gated by the caller (`inPlaceDiffMorph`).
-->
<script lang="ts">
  let { diffContent, fileName }: { diffContent: string; fileName: string } = $props();

  type LineType = 'context' | 'added' | 'removed' | 'hunk';
  interface MorphLine {
    type: LineType;
    text: string;
  }

  const LH = 20; // px per line in the morph body

  function parse(raw: string): MorphLine[] {
    const out: MorphLine[] = [];
    for (const line of raw.split('\n')) {
      if (line.startsWith('@@')) {
        out.push({ type: 'hunk', text: line });
      } else if (
        line.startsWith('diff ') ||
        line.startsWith('index ') ||
        line.startsWith('--- ') ||
        line.startsWith('+++ ')
      ) {
        // skip file meta
      } else if (line.startsWith('+')) {
        out.push({ type: 'added', text: line.slice(1) });
      } else if (line.startsWith('-')) {
        out.push({ type: 'removed', text: line.slice(1) });
      } else {
        out.push({ type: 'context', text: line.replace(/^ /, '') });
      }
    }
    return out;
  }

  const lines = $derived(parse(diffContent));
  const additions = $derived(lines.filter((l) => l.type === 'added').length);
  const deletions = $derived(lines.filter((l) => l.type === 'removed').length);

  // Scrub position: 0 = old, 1 = new. Start fully new (the result).
  let t = $state(1);
  let playing = $state(false);
  let raf = 0;

  function play() {
    if (playing) {
      stop();
      return;
    }
    playing = true;
    // Restart from old if parked at the end.
    if (t >= 1) t = 0;
    const startT = t;
    const start = performance.now();
    const dur = 1600 * (1 - startT);
    const step = (now: number) => {
      const p = dur <= 0 ? 1 : Math.min(1, (now - start) / dur);
      t = startT + (1 - startT) * p;
      if (p < 1 && playing) {
        raf = requestAnimationFrame(step);
      } else {
        playing = false;
      }
    };
    raf = requestAnimationFrame(step);
  }
  function stop() {
    playing = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  // Per-line geometry from the scrub value.
  function rowHeight(type: LineType): number {
    if (type === 'removed') return (1 - t) * LH;
    if (type === 'added') return t * LH;
    return LH;
  }
  function rowOpacity(type: LineType): number {
    if (type === 'removed') return 1 - t;
    if (type === 'added') return t;
    return 1;
  }
</script>

<div class="morph">
  <div class="morph-bar">
    <span class="file">{fileName}</span>
    <span class="add">+{additions}</span>
    <span class="del">−{deletions}</span>
    <button class="play" onclick={play} title={playing ? 'Pause' : 'Play morph'}>
      {playing ? '⏸' : '▶'}
    </button>
    <input
      class="scrub"
      type="range"
      min="0"
      max="1"
      step="0.01"
      bind:value={t}
      oninput={stop}
      aria-label="Scrub old to new"
    />
    <span class="pct">{t < 0.5 ? 'old' : 'new'} · {Math.round(t * 100)}%</span>
  </div>

  <div class="morph-body">
    {#each lines as l, i (i)}
      {#if l.type === 'hunk'}
        <div class="row hunk">{l.text}</div>
      {:else}
        <div
          class="row {l.type}"
          style="height: {rowHeight(l.type)}px; opacity: {rowOpacity(l.type)};"
        >
          <span class="gutter"
            >{#if l.type === 'added'}+{:else if l.type === 'removed'}−{:else}&nbsp;{/if}</span
          >
          <span class="text">{l.text}</span>
        </div>
      {/if}
    {/each}
  </div>
</div>

<style>
  .morph {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--bg-code);
    font-family: var(--font-mono, 'Menlo', 'Monaco', monospace);
    font-size: var(--fs-base);
  }
  .morph-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 14px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-primary);
    flex-shrink: 0;
    font-size: var(--fs-sm);
  }
  .file {
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 40%;
  }
  .add {
    color: #4ade80;
    font-weight: 600;
  }
  .del {
    color: #f87171;
    font-weight: 600;
  }
  .play {
    border: 1px solid var(--accent-primary);
    background: transparent;
    color: var(--accent-primary);
    border-radius: 6px;
    cursor: pointer;
    padding: 1px 9px;
    line-height: 1.5;
  }
  .scrub {
    flex: 1;
    min-width: 80px;
    accent-color: var(--accent-primary);
    cursor: pointer;
  }
  .pct {
    color: var(--text-tertiary);
    font-size: var(--fs-xs);
    white-space: nowrap;
    min-width: 64px;
    text-align: right;
  }
  .morph-body {
    flex: 1;
    overflow: auto;
    padding: 8px 0;
  }
  .row {
    display: flex;
    line-height: 20px;
    white-space: pre;
    overflow: hidden;
    will-change: height, opacity;
  }
  .row.added {
    background: rgba(74, 222, 128, 0.12);
    color: #bbf7d0;
  }
  .row.removed {
    background: rgba(248, 113, 113, 0.12);
    color: #fecaca;
  }
  .row.context {
    color: var(--text-secondary);
  }
  .row.hunk {
    height: 20px;
    color: #60a5fa;
    background: rgba(96, 165, 250, 0.06);
    padding: 0 14px;
    user-select: none;
  }
  .gutter {
    width: 24px;
    min-width: 24px;
    text-align: center;
    user-select: none;
    opacity: 0.7;
  }
  .text {
    flex: 1;
    padding: 0 14px;
    overflow-wrap: anywhere;
  }
</style>
