<script lang="ts">
  /**
   * Git graph — a rendered lane diagram of commit history with branches,
   * tags, and HEAD decorations. Click a commit to open it as a diff tab.
   *
   * Uses `gitGraphLayout` to compute per-row lane assignments; renders the
   * left column as inline SVG per row (simpler than a single big SVG with
   * virtualization) and lets the container handle vertical scrolling.
   */
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { workspaceListStore } from '$lib/stores/projects.svelte';
  import { primaryPaneStore } from '$lib/stores/primaryPane.svelte';
  import { layoutGraph, LANE_COLORS, type GraphRow } from '$lib/utils/gitGraphLayout';

  interface Commit {
    sha: string;
    parents: string[];
    author: string;
    email: string;
    timestamp: number;
    subject: string;
    refs: string[];
  }

  let commits = $state<Commit[]>([]);
  let rows = $state<GraphRow[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let limit = $state(300);

  let workspacePath = $derived(
    workspaceListStore.activeWorkspace?.path ||
      conversationStore.active?.workspacePath ||
      settingsStore.workspacePath ||
      '.',
  );

  const LANE_WIDTH = 14;
  const ROW_HEIGHT = 26;
  const DOT_RADIUS = 4;

  async function load() {
    loading = true;
    error = null;
    try {
      const res = await api.git.log(workspacePath, { limit });
      if (res.ok) {
        commits = res.data.commits;
        rows = layoutGraph(commits);
      } else {
        error = (res as { error?: string }).error ?? 'git log failed';
      }
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  onMount(load);

  $effect(() => {
    void workspacePath;
    void limit;
    // reload whenever workspace or limit changes
    load();
  });

  function laneColor(idx: number): string {
    return LANE_COLORS[idx % LANE_COLORS.length];
  }

  function dotColor(row: GraphRow): string {
    return laneColor(row.color);
  }

  function cx(lane: number): number {
    return lane * LANE_WIDTH + LANE_WIDTH / 2;
  }

  function openCommit(c: Commit) {
    primaryPaneStore.openCommitTab(c.sha, workspacePath, `${c.sha.slice(0, 7)} · ${c.subject}`);
  }

  function formatDate(ts: number): string {
    if (!ts) return '';
    const date = new Date(ts * 1000);
    const now = Date.now();
    const diff = (now - date.getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function shortAuthor(name: string): string {
    const first = name.split(/\s+/)[0] ?? name;
    return first.length > 14 ? first.slice(0, 14) : first;
  }

  function classifyRef(ref: string): { kind: 'head' | 'tag' | 'remote' | 'branch'; label: string } {
    if (ref === 'HEAD') return { kind: 'head', label: 'HEAD' };
    if (ref.startsWith('tag: ')) return { kind: 'tag', label: ref.slice(5) };
    if (ref.startsWith('refs/tags/')) return { kind: 'tag', label: ref.slice(10) };
    if (ref.includes('/')) return { kind: 'remote', label: ref };
    return { kind: 'branch', label: ref };
  }
</script>

<div class="graph-panel">
  {#if loading && commits.length === 0}
    <div class="status">Loading history…</div>
  {:else if error}
    <div class="status error">{error}</div>
  {:else if commits.length === 0}
    <div class="status">No commits yet.</div>
  {:else}
    <div class="graph-scroll">
      {#each commits as commit, i (commit.sha)}
        {@const row = rows[i]}
        {@const width = Math.max(row?.laneCount ?? 1, 1) * LANE_WIDTH}
        <button
          class="commit-row"
          title={`${commit.sha}\n${commit.author} <${commit.email}>\n${commit.subject}`}
          onclick={() => openCommit(commit)}
        >
          <svg
            class="lane-col"
            {width}
            height={ROW_HEIGHT}
            viewBox={`0 0 ${width} ${ROW_HEIGHT}`}
            aria-hidden="true"
          >
            <!-- segments from the previous row -->
            {#if row}
              {#each row.segments as seg}
                {#if seg.fromLane === seg.toLane}
                  <line
                    x1={cx(seg.fromLane)}
                    y1={0}
                    x2={cx(seg.toLane)}
                    y2={ROW_HEIGHT}
                    stroke={laneColor(seg.color)}
                    stroke-width="1.5"
                  />
                {:else}
                  <!-- diagonal connector: top half straight, bottom half diagonal -->
                  <path
                    d={`M ${cx(seg.fromLane)} 0 L ${cx(seg.fromLane)} ${ROW_HEIGHT / 2} L ${cx(seg.toLane)} ${ROW_HEIGHT}`}
                    stroke={laneColor(seg.color)}
                    stroke-width="1.5"
                    fill="none"
                  />
                {/if}
              {/each}
              <!-- dot for the commit itself -->
              <circle
                cx={cx(row.lane)}
                cy={ROW_HEIGHT / 2}
                r={DOT_RADIUS}
                fill={dotColor(row)}
                stroke="var(--bg-primary, #111)"
                stroke-width="1.5"
              />
            {/if}
          </svg>
          <div class="commit-meta">
            {#if commit.refs.length > 0}
              <span class="ref-row">
                {#each commit.refs as ref}
                  {@const info = classifyRef(ref)}
                  <span class="ref-pill ref-{info.kind}">{info.label}</span>
                {/each}
              </span>
            {/if}
            <span class="subject">{commit.subject}</span>
            <span class="extras">
              <span class="author">{shortAuthor(commit.author)}</span>
              <span class="sep">·</span>
              <span class="date">{formatDate(commit.timestamp)}</span>
              <span class="sep">·</span>
              <span class="sha">{commit.sha.slice(0, 7)}</span>
            </span>
          </div>
        </button>
      {/each}
    </div>
    {#if commits.length >= limit}
      <button class="load-more" onclick={() => (limit += 300)}>Load more</button>
    {/if}
  {/if}
</div>

<style>
  .graph-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    font-size: var(--fs-sm);
  }
  .graph-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }
  .status {
    padding: 12px;
    color: var(--text-tertiary);
    text-align: center;
  }
  .status.error {
    color: var(--accent-error);
  }

  .commit-row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 0 10px 0 6px;
    background: transparent;
    border: none;
    border-left: 2px solid transparent;
    color: var(--text-primary);
    text-align: left;
    cursor: pointer;
    transition:
      background 100ms ease-out,
      border-color 100ms ease-out;
  }
  .commit-row:hover {
    background: var(--bg-hover);
    border-left-color: var(--accent-primary, var(--syn-function));
  }
  .lane-col {
    flex: 0 0 auto;
    display: block;
  }

  .commit-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex: 1;
    height: 26px;
  }
  .subject {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-family);
  }
  .extras {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-family: var(--font-family-sans, sans-serif);
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    white-space: nowrap;
  }
  .sep {
    opacity: 0.5;
  }
  .sha {
    font-family: var(--font-family);
    color: var(--text-secondary);
  }

  .ref-row {
    display: inline-flex;
    gap: 4px;
    flex-wrap: nowrap;
    max-width: 40%;
    overflow: hidden;
  }
  .ref-pill {
    font-family: var(--font-family-sans, sans-serif);
    font-size: var(--fs-xxs);
    font-weight: 700;
    padding: 1px 7px;
    border-radius: 999px;
    border: 1px solid transparent;
    white-space: nowrap;
  }
  .ref-head {
    background: color-mix(in oklab, var(--accent-primary, #60a5fa) 22%, transparent);
    border-color: var(--accent-primary, #60a5fa);
    color: var(--accent-primary, #60a5fa);
  }
  .ref-branch {
    background: color-mix(in oklab, var(--accent-primary, #60a5fa) 14%, transparent);
    color: var(--accent-primary, #60a5fa);
  }
  .ref-remote {
    background: color-mix(in oklab, var(--text-tertiary) 12%, transparent);
    color: var(--text-secondary);
  }
  .ref-tag {
    background: color-mix(in oklab, var(--accent-warning, #f59e0b) 22%, transparent);
    color: var(--accent-warning, #f59e0b);
  }

  .load-more {
    flex-shrink: 0;
    padding: 10px;
    border: none;
    border-top: 1px solid var(--border-primary);
    background: transparent;
    color: var(--text-secondary);
    font-family: var(--font-family);
    font-size: var(--fs-sm);
    cursor: pointer;
    transition:
      background 100ms ease-out,
      color 100ms ease-out;
  }
  .load-more:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
</style>
