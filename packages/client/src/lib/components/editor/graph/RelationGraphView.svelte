<script lang="ts">
  /**
   * RelationGraphView — renders a RelationGraph as an SVG using elkjs
   * for layered layout. Mounted inside a CM6 hover tooltip; container
   * sizes itself to the laid-out graph (capped) so it doesn't blow up
   * the editor surface.
   *
   * Layout direction: 'RIGHT' (left-to-right) for typical "deps" reads,
   * 'DOWN' for taller graphs would also work but feels less like a
   * dependency arrow at a glance.
   *
   * Node sizing: we use a simple monospace-width estimate (~7.5px/char)
   * plus padding, which is good enough for ProseMirror-style hover sizes.
   * A more accurate measure would mount text temporarily and read the
   * bbox, but the cost (a layout flush per measurement) isn't worth it
   * at these graph sizes.
   */
  import { onMount } from 'svelte';
  import ELK from 'elkjs/lib/elk.bundled.js';
  import type { RelationGraph, RelationNode } from './types';

  let {
    graph,
    onNavigate,
  }: {
    graph: RelationGraph;
    /** Called when the user double-clicks a node with a navigate target. */
    onNavigate?: (node: RelationNode) => void;
  } = $props();

  // elkjs is heavy enough that we lazy-construct on mount.
  let elk: any = null;
  let laidOut = $state<{
    width: number;
    height: number;
    nodes: Array<RelationNode & { x: number; y: number; w: number; h: number }>;
    edges: Array<{ id: string; from: string; to: string; label?: string; path: string }>;
  } | null>(null);
  let layoutError = $state<string | null>(null);

  function nodeSize(n: RelationNode): { w: number; h: number } {
    const labelW = Math.max(60, Math.min(220, n.label.length * 7.5 + 18));
    const h = n.center ? 32 : 26;
    return { w: labelW, h };
  }

  function buildElkInput() {
    return {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.layered.spacing.nodeNodeBetweenLayers': '32',
        'elk.spacing.nodeNode': '16',
        'elk.padding': '[top=8,left=8,bottom=8,right=8]',
        'elk.layered.crossingMinimization.semiInteractive': 'true',
      },
      children: graph.nodes.map((n) => {
        const { w, h } = nodeSize(n);
        return { id: n.id, width: w, height: h };
      }),
      edges: graph.edges.map((e, i) => ({
        id: `e${i}`,
        sources: [e.from],
        targets: [e.to],
      })),
    };
  }

  /** Convert elkjs section bend points into an SVG path string. */
  function pathFromSection(section: any): string {
    const start = section.startPoint;
    const end = section.endPoint;
    const bends = section.bendPoints || [];
    const parts: string[] = [`M ${start.x} ${start.y}`];
    for (const b of bends) parts.push(`L ${b.x} ${b.y}`);
    parts.push(`L ${end.x} ${end.y}`);
    return parts.join(' ');
  }

  async function relayout() {
    if (!elk) return;
    try {
      const result = await elk.layout(buildElkInput());
      const nodeMap = new Map<string, RelationNode>();
      for (const n of graph.nodes) nodeMap.set(n.id, n);
      const positionedNodes = (result.children || []).map((c: any) => {
        const meta = nodeMap.get(c.id)!;
        return {
          ...meta,
          x: c.x ?? 0,
          y: c.y ?? 0,
          w: c.width ?? 80,
          h: c.height ?? 28,
        };
      });
      const positionedEdges = (result.edges || []).map((e: any, i: number) => {
        const original = graph.edges[i];
        const section = (e.sections && e.sections[0]) || null;
        return {
          id: e.id,
          from: e.sources?.[0] ?? original?.from,
          to: e.targets?.[0] ?? original?.to,
          label: original?.label,
          path: section ? pathFromSection(section) : '',
        };
      });
      laidOut = {
        width: result.width ?? 0,
        height: result.height ?? 0,
        nodes: positionedNodes,
        edges: positionedEdges,
      };
      layoutError = null;
    } catch (err) {
      layoutError = err instanceof Error ? err.message : String(err);
      laidOut = null;
    }
  }

  onMount(() => {
    elk = new ELK();
    relayout();
  });

  // Re-layout when the graph identity changes (provider returned a new
  // graph for a different hover).
  $effect(() => {
    void graph;
    if (elk) relayout();
  });

  function nodeFillFor(n: RelationNode): string {
    if (n.center) return 'var(--graph-node-center, rgba(78, 193, 245, 0.18))';
    switch (n.kind) {
      case 'file':
        return 'var(--graph-node-file, rgba(255, 255, 255, 0.06))';
      case 'external':
        return 'var(--graph-node-external, rgba(255, 200, 100, 0.1))';
      case 'signal':
      case 'effect':
        return 'var(--graph-node-signal, rgba(200, 130, 255, 0.12))';
      case 'component':
        return 'var(--graph-node-component, rgba(120, 220, 160, 0.12))';
      default:
        return 'var(--graph-node-default, rgba(255, 255, 255, 0.05))';
    }
  }

  function nodeStrokeFor(n: RelationNode): string {
    if (n.center) return 'var(--graph-stroke-center, rgba(78, 193, 245, 0.85))';
    switch (n.kind) {
      case 'external':
        return 'var(--graph-stroke-external, rgba(255, 200, 100, 0.5))';
      case 'signal':
      case 'effect':
        return 'var(--graph-stroke-signal, rgba(200, 130, 255, 0.5))';
      case 'component':
        return 'var(--graph-stroke-component, rgba(120, 220, 160, 0.5))';
      default:
        return 'var(--graph-stroke-default, rgba(255, 255, 255, 0.25))';
    }
  }

  function handleNodeActivate(n: RelationNode) {
    if (!n.navigate || !onNavigate) return;
    onNavigate(n);
  }
</script>

<div class="graph-popover">
  <header class="graph-header">{graph.title}</header>
  {#if layoutError}
    <div class="error">Layout failed: {layoutError}</div>
  {:else if !laidOut}
    <div class="loading">Laying out…</div>
  {:else}
    {@const lo = laidOut}
    <!-- Cap the displayed surface so big graphs don't overflow the popover. -->
    <div class="svg-scroll" style="max-width: min(620px, {lo.width + 16}px); max-height: 400px;">
      <svg
        width={lo.width}
        height={lo.height}
        viewBox="0 0 {lo.width} {lo.height}"
        aria-label={graph.title}
      >
        <defs>
          <marker
            id="graph-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--graph-edge, rgba(255,255,255,0.45))" />
          </marker>
        </defs>

        <!-- Edges first so nodes overlap them visually. -->
        <g
          class="edges"
          fill="none"
          stroke="var(--graph-edge, rgba(255,255,255,0.35))"
          stroke-width="1.25"
        >
          {#each lo.edges as edge (edge.id)}
            <path d={edge.path} marker-end="url(#graph-arrow)" />
          {/each}
        </g>

        <g class="nodes">
          {#each lo.nodes as n (n.id)}
            <g
              class="node"
              class:clickable={!!n.navigate}
              transform="translate({n.x}, {n.y})"
              ondblclick={() => handleNodeActivate(n)}
              role={n.navigate ? 'button' : undefined}
              tabindex={n.navigate ? 0 : undefined}
              onkeydown={(e) => {
                if (n.navigate && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  handleNodeActivate(n);
                }
              }}
            >
              <title>{n.title ?? n.label}</title>
              <rect
                width={n.w}
                height={n.h}
                rx="4"
                ry="4"
                fill={nodeFillFor(n)}
                stroke={nodeStrokeFor(n)}
                stroke-width={n.center ? 1.5 : 1}
              />
              <text x={n.w / 2} y={n.h / 2 + 4} text-anchor="middle">
                {n.label}
              </text>
            </g>
          {/each}
        </g>
      </svg>
    </div>
  {/if}
</div>

<style>
  .graph-popover {
    color: var(--fg-primary, #d4d4d4);
    background: var(--bg-popover, #202020);
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.1));
    border-radius: 4px;
    padding: 6px;
    font-family:
      system-ui,
      -apple-system,
      sans-serif;
    font-size: 11px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  }
  .graph-header {
    padding: 2px 4px 6px;
    color: var(--fg-secondary, #aaa);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 600;
    border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
    margin-bottom: 4px;
  }
  .svg-scroll {
    overflow: auto;
  }
  .loading,
  .error {
    padding: 8px 4px;
    color: var(--fg-tertiary, #888);
  }
  .error {
    color: var(--fg-danger, #e06c75);
  }
  .node text {
    fill: var(--fg-primary, #d4d4d4);
    font-size: 11px;
    pointer-events: none;
    user-select: none;
  }
  .node.clickable {
    cursor: pointer;
  }
  .node.clickable:hover rect {
    filter: brightness(1.3);
  }
  .node.clickable:focus {
    outline: none;
  }
  .node.clickable:focus rect {
    stroke-width: 2;
  }
</style>
