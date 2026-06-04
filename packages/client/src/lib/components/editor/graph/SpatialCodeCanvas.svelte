<!--
  SpatialCodeCanvas.svelte — files as cards on a navigable board (LYK-1103).

  The dependency graph IS the navigation: the canvas starts on a file, shows it
  plus its imports as cards, and clicking an internal file recenters the board on
  that file (one neighborhood at a time). Two render modes:
    - 2D: a pannable/zoomable DOM board (default) — crisp, clickable cards + SVG edges.
    - 3D: a three.js scene — orbit the neighborhood; nodes as labelled sprites,
          imports on a sphere around the center, edges as lines.

  Flag-gated by the caller (`spatialCodeCanvas`); opened via the command palette.
  Reuses the existing client-side module-deps provider (no server work).
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import * as THREE from 'three';
  import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
  import { api } from '$lib/api/client';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { editorStore } from '$lib/stores/editor.svelte';
  import { moduleDepsProvider } from './providers/module-deps';
  import type { RelationNode } from './types';

  let { startFilePath }: { startFilePath: string } = $props();

  interface LaidOutNode extends RelationNode {
    x: number;
    y: number;
    z: number;
    /** BFS distance from the center file (0 = center). */
    depth: number;
    /** Resolved absolute path for file nodes (used for navigation/recenter). */
    filePath?: string;
  }

  let mode = $state<'2d' | '3d'>('2d');
  let currentFile = $state(startFilePath);
  let title = $state('');
  let nodes = $state<LaidOutNode[]>([]);
  let edges = $state<{ from: string; to: string }[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  // How many import hops to crawl from the center file.
  let maxDepth = $state(2);

  // ── 2D viewport ──────────────────────────────────────────────────────────
  let zoom = $state(1);
  let panX = $state(0);
  let panY = $state(0);
  let dragging = false;
  let dragStart = { x: 0, y: 0, panX: 0, panY: 0 };

  // Concentric ring spacing per BFS depth.
  const RING = 230;
  const MAX_NODES = 70;

  function basename(p: string): string {
    return p.split('/').pop() || p;
  }

  function normalize(p: string): string {
    const stack: string[] = [];
    for (const seg of p.split('/')) {
      if (seg === '' || seg === '.') continue;
      if (seg === '..') stack.pop();
      else stack.push(seg);
    }
    return '/' + stack.join('/');
  }

  // Per-crawl caches so we don't re-read / re-resolve the same path repeatedly.
  let readCache = new Map<string, string | null>();
  let resolveCache = new Map<string, string | null>();

  async function readFile(path: string): Promise<string | null> {
    if (readCache.has(path)) return readCache.get(path)!;
    let content: string | null = null;
    try {
      content = (await api.files.read(path)).data.content;
    } catch {
      content = null;
    }
    readCache.set(path, content);
    return content;
  }

  /** Resolve a relative import specifier to a real file by probing extensions. */
  async function resolveSpecifier(spec: string, fromFile: string): Promise<string | null> {
    if (!spec.startsWith('.')) return null; // only relative imports resolve to files
    const key = `${fromFile}::${spec}`;
    if (resolveCache.has(key)) return resolveCache.get(key)!;
    const dir = fromFile.slice(0, fromFile.lastIndexOf('/'));
    const baseAbs = normalize(`${dir}/${spec}`);
    const candidates = [
      baseAbs,
      `${baseAbs}.ts`,
      `${baseAbs}.tsx`,
      `${baseAbs}.js`,
      `${baseAbs}.jsx`,
      `${baseAbs}.svelte`,
      `${baseAbs}.svelte.ts`,
      `${baseAbs}.pui`,
      `${baseAbs}/index.ts`,
      `${baseAbs}/index.js`,
    ];
    let found: string | null = null;
    for (const c of candidates) {
      if ((await readFile(c)) !== null) {
        found = c;
        break;
      }
    }
    resolveCache.set(key, found);
    return found;
  }

  interface CrawlResult {
    nodes: LaidOutNode[];
    edges: { from: string; to: string }[];
    title: string;
  }

  /**
   * BFS the import graph from `startFile` out to `depthLimit` hops. File nodes
   * are keyed by resolved absolute path (so the same file reached two ways
   * dedupes); edges are directed importer → imported. Capped at MAX_NODES.
   */
  async function crawl(startFile: string, depthLimit: number): Promise<CrawlResult> {
    const nodeMap = new Map<string, LaidOutNode>();
    const edgeSet = new Set<string>();
    const edges: { from: string; to: string }[] = [];
    const visited = new Set<string>();
    const queue: { path: string; depth: number }[] = [{ path: startFile, depth: 0 }];

    const ensure = (
      id: string,
      label: string,
      kind: 'file' | 'external',
      depth: number,
      filePath?: string,
    ): LaidOutNode => {
      const ex = nodeMap.get(id);
      if (ex) {
        ex.depth = Math.min(ex.depth, depth);
        return ex;
      }
      const n: LaidOutNode = { id, label, kind, depth, filePath, x: 0, y: 0, z: 0 };
      nodeMap.set(id, n);
      return n;
    };
    const addEdge = (from: string, to: string) => {
      const k = `${from}|${to}`;
      if (from === to || edgeSet.has(k)) return;
      edgeSet.add(k);
      edges.push({ from, to });
    };

    ensure(`file:${startFile}`, basename(startFile), 'file', 0, startFile).center = true;

    while (queue.length) {
      const { path, depth } = queue.shift()!;
      if (visited.has(path)) continue;
      visited.add(path);
      if (nodeMap.size > MAX_NODES) break;

      const content = await readFile(path);
      if (content == null) continue;
      const g = await moduleDepsProvider.build({
        filePath: path,
        workspacePath: settingsStore.workspacePath || '',
        pos: 0,
        doc: content,
        line: 0,
        column: 0,
      });
      if (!g) continue;

      const fromId = `file:${path}`;
      for (const imp of g.nodes) {
        if (imp.center) continue;
        const spec = imp.id.slice('import:'.length);
        if (imp.kind === 'external') {
          ensure(`ext:${spec}`, spec, 'external', depth + 1);
          addEdge(fromId, `ext:${spec}`);
          continue;
        }
        const resolved = await resolveSpecifier(spec, path);
        if (resolved) {
          ensure(`file:${resolved}`, basename(resolved), 'file', depth + 1, resolved);
          addEdge(fromId, `file:${resolved}`);
          if (depth + 1 < depthLimit && !visited.has(resolved)) {
            queue.push({ path: resolved, depth: depth + 1 });
          }
        } else {
          // Unresolvable (alias like $lib, or a glob) — show as a leaf.
          ensure(`alias:${spec}`, spec, 'external', depth + 1);
          addEdge(fromId, `alias:${spec}`);
        }
      }
    }

    const all = [...nodeMap.values()];
    const files = all.filter((n) => n.kind === 'file').length;
    const ext = all.length - files;
    const capped = nodeMap.size > MAX_NODES ? ' (capped)' : '';
    return {
      nodes: all,
      edges,
      title: `${basename(startFile)} · ${files} files, ${ext} deps · depth ${depthLimit}${capped}`,
    };
  }

  /** Lay nodes out as concentric rings by BFS depth (center at the origin). */
  function layout(input: LaidOutNode[]): LaidOutNode[] {
    const byDepth = new Map<number, LaidOutNode[]>();
    for (const n of input) {
      const d = n.depth ?? 1;
      if (!byDepth.has(d)) byDepth.set(d, []);
      byDepth.get(d)!.push(n);
    }
    const placed: LaidOutNode[] = [];
    for (const [depth, group] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
      if (depth === 0) {
        placed.push({ ...group[0], x: 0, y: 0, z: 0 });
        continue;
      }
      const r = depth * RING;
      group.forEach((n, i) => {
        const ang = (i / Math.max(group.length, 1)) * Math.PI * 2 + depth * 0.7;
        placed.push({
          ...n,
          x: Math.cos(ang) * r,
          y: Math.sin(ang) * r,
          z: -(depth - 1) * (RING * 0.5),
        });
      });
    }
    return placed;
  }

  async function loadGraph(filePath: string) {
    loading = true;
    error = null;
    readCache = new Map();
    resolveCache = new Map();
    try {
      const result = await crawl(filePath, maxDepth);
      nodes = layout(result.nodes);
      edges = result.edges;
      title = result.title;
      currentFile = filePath;
      zoom = 1;
      panX = 0;
      panY = 0;
      if (mode === '3d') rebuildScene();
    } catch (e) {
      error = `Couldn't load ${basename(filePath)}: ${e}`;
    } finally {
      loading = false;
    }
  }

  function setDepth(d: number) {
    if (d === maxDepth) return;
    maxDepth = d;
    loadGraph(currentFile);
  }

  function activate(node: LaidOutNode) {
    if (node.center) {
      editorStore.openFile(currentFile, false);
      return;
    }
    // Recenter onto a file node; external/alias leaves aren't navigable.
    if (node.kind === 'file' && node.filePath) loadGraph(node.filePath);
  }

  function openInEditor(node: LaidOutNode) {
    const fp = node.center ? currentFile : node.filePath;
    if (fp) editorStore.openFile(fp, false);
  }

  // ── 2D interaction ─────────────────────────────────────────────────────────
  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    zoom = Math.min(3, Math.max(0.3, zoom * factor));
  }
  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    dragging = true;
    dragStart = { x: e.clientX, y: e.clientY, panX, panY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: PointerEvent) {
    if (!dragging) return;
    panX = dragStart.panX + (e.clientX - dragStart.x);
    panY = dragStart.panY + (e.clientY - dragStart.y);
  }
  function onPointerUp(e: PointerEvent) {
    dragging = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* not captured */
    }
  }

  const nodeColor = (kind: string) =>
    kind === 'external'
      ? 'var(--text-tertiary)'
      : kind === 'file'
        ? 'var(--accent-primary)'
        : 'var(--accent-secondary, var(--accent-primary))';

  // A directed edge segment, shortened at both ends so the arrowhead clears the
  // node cards. Returns null if either endpoint is missing.
  function edgeSeg(e: { from: string; to: string }) {
    const a = nodes.find((x) => x.id === e.from);
    const b = nodes.find((x) => x.id === e.to);
    if (!a || !b) return null;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const pad = 32;
    if (len < pad * 2) return null;
    return { x1: a.x + ux * pad, y1: a.y + uy * pad, x2: b.x - ux * pad, y2: b.y - uy * pad };
  }

  // ── 3D (three.js) ───────────────────────────────────────────────────────────
  let threeHost = $state<HTMLDivElement | null>(null);
  let renderer: THREE.WebGLRenderer | null = null;
  let scene: THREE.Scene | null = null;
  let camera: THREE.PerspectiveCamera | null = null;
  let controls: OrbitControls | null = null;
  let raf = 0;
  let resizeObs: ResizeObserver | null = null;
  const sprites: THREE.Sprite[] = [];
  const arrows: THREE.Object3D[] = [];
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  function labelTexture(label: string, kind: string): THREE.CanvasTexture {
    const pad = 16;
    const fs = 28;
    const c = document.createElement('canvas');
    const cx = c.getContext('2d')!;
    cx.font = `${fs}px ui-monospace, monospace`;
    const w = Math.ceil(cx.measureText(label).width) + pad * 2;
    const h = fs + pad * 2;
    c.width = w;
    c.height = h;
    const accent =
      kind === 'external'
        ? '#888'
        : getComputedStyle(document.documentElement).getPropertyValue('--accent-primary').trim() ||
          '#e2733f';
    cx.fillStyle = 'rgba(20,18,16,0.92)';
    roundRect(cx, 0, 0, w, h, 10);
    cx.fill();
    cx.lineWidth = 2;
    cx.strokeStyle = accent;
    roundRect(cx, 1, 1, w - 2, h - 2, 10);
    cx.stroke();
    cx.fillStyle = '#f4eee3';
    cx.font = `${fs}px ui-monospace, monospace`;
    cx.textBaseline = 'middle';
    cx.fillText(label, pad, h / 2);
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    return tex;
  }

  function roundRect(
    cx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ) {
    cx.beginPath();
    cx.moveTo(x + r, y);
    cx.arcTo(x + w, y, x + w, y + h, r);
    cx.arcTo(x + w, y + h, x, y + h, r);
    cx.arcTo(x, y + h, x, y, r);
    cx.arcTo(x, y, x + w, y, r);
    cx.closePath();
  }

  function buildScene() {
    if (!scene) return;
    // Clear previous content.
    for (const s of sprites) {
      s.material.map?.dispose();
      (s.material as THREE.SpriteMaterial).dispose();
      scene.remove(s);
    }
    sprites.length = 0;
    for (const ar of arrows) {
      (ar as THREE.ArrowHelper).dispose?.();
      scene.remove(ar);
    }
    arrows.length = 0;

    const scale = 0.012;
    for (const n of nodes) {
      const tex = labelTexture(n.label, n.kind);
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
      const sprite = new THREE.Sprite(mat);
      sprite.position.set(n.x * scale, n.y * scale, n.z * scale);
      const aspect =
        (tex.image as HTMLCanvasElement).width / (tex.image as HTMLCanvasElement).height;
      sprite.scale.set(aspect * 0.9, 0.9, 1);
      sprite.userData.nodeId = n.id;
      sprite.renderOrder = n.center ? 2 : 1;
      scene.add(sprite);
      sprites.push(sprite);
    }

    // Directed edges as arrows (importer → imported), shortened so the head
    // lands just shy of the target node.
    const accent =
      getComputedStyle(document.documentElement).getPropertyValue('--accent-primary').trim() ||
      '#e2733f';
    const color = new THREE.Color(accent);
    for (const e of edges) {
      const a = nodes.find((x) => x.id === e.from);
      const b = nodes.find((x) => x.id === e.to);
      if (!a || !b) continue;
      const from = new THREE.Vector3(a.x * scale, a.y * scale, a.z * scale);
      const to = new THREE.Vector3(b.x * scale, b.y * scale, b.z * scale);
      const dir = new THREE.Vector3().subVectors(to, from);
      const full = dir.length();
      if (full < 1e-3) continue;
      dir.normalize();
      const gap = 0.42; // clear the node sprite at the target end
      const length = Math.max(full - gap, full * 0.4);
      const arrow = new THREE.ArrowHelper(dir, from, length, color, length * 0.18, length * 0.1);
      (arrow.line.material as THREE.LineBasicMaterial).transparent = true;
      (arrow.line.material as THREE.LineBasicMaterial).opacity = 0.45;
      scene.add(arrow);
      arrows.push(arrow);
    }
  }

  function initThree() {
    if (!threeHost || renderer) return;
    const w = threeHost.clientWidth || 600;
    const h = threeHost.clientHeight || 400;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 100);
    camera.position.set(0, 0, 9);
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    threeHost.appendChild(renderer.domElement);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    renderer.domElement.addEventListener('dblclick', onThreeDblClick);
    renderer.domElement.addEventListener('click', onThreeClick);
    buildScene();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      controls?.update();
      if (renderer && scene && camera) renderer.render(scene, camera);
    };
    loop();
    resizeObs = new ResizeObserver(() => {
      if (!threeHost || !renderer || !camera) return;
      const nw = threeHost.clientWidth;
      const nh = threeHost.clientHeight;
      renderer.setSize(nw, nh);
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
    });
    resizeObs.observe(threeHost);
  }

  function pickNode(e: MouseEvent): LaidOutNode | null {
    if (!renderer || !camera) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(sprites, false);
    if (!hits.length) return null;
    const id = hits[0].object.userData.nodeId as string;
    return nodes.find((n) => n.id === id) ?? null;
  }
  function onThreeClick(e: MouseEvent) {
    const n = pickNode(e);
    if (n) activate(n);
  }
  function onThreeDblClick(e: MouseEvent) {
    const n = pickNode(e);
    if (n) openInEditor(n);
  }

  function rebuildScene() {
    if (renderer) buildScene();
  }

  function disposeThree() {
    cancelAnimationFrame(raf);
    raf = 0;
    resizeObs?.disconnect();
    resizeObs = null;
    if (renderer) {
      renderer.domElement.removeEventListener('dblclick', onThreeDblClick);
      renderer.domElement.removeEventListener('click', onThreeClick);
    }
    for (const s of sprites) {
      s.material.map?.dispose();
      (s.material as THREE.SpriteMaterial).dispose();
    }
    sprites.length = 0;
    for (const ar of arrows) (ar as THREE.ArrowHelper).dispose?.();
    arrows.length = 0;
    controls?.dispose();
    controls = null;
    renderer?.dispose();
    if (renderer?.domElement.parentElement) renderer.domElement.remove();
    renderer = null;
    scene = null;
    camera = null;
  }

  // Init / tear down the 3D scene as the mode toggles.
  $effect(() => {
    if (mode === '3d' && threeHost && !renderer) {
      initThree();
    } else if (mode === '2d' && renderer) {
      disposeThree();
    }
  });

  // Initial load.
  $effect(() => {
    if (
      startFilePath &&
      currentFile === startFilePath &&
      nodes.length === 0 &&
      !loading &&
      !error
    ) {
      loadGraph(startFilePath);
    }
  });

  onDestroy(disposeThree);
</script>

<div class="code-canvas">
  <header class="cc-toolbar">
    <span class="cc-title">{title || basename(currentFile)}</span>
    <span class="cc-path" title={currentFile}>{currentFile}</span>
    <div class="cc-depth" title="Import hops to crawl">
      <span class="cc-depth-label">depth</span>
      {#each [1, 2, 3] as d (d)}
        <button class:active={maxDepth === d} onclick={() => setDepth(d)}>{d}</button>
      {/each}
    </div>
    <div class="cc-modes">
      <button class:active={mode === '2d'} onclick={() => (mode = '2d')}>2D</button>
      <button class:active={mode === '3d'} onclick={() => (mode = '3d')}>3D</button>
    </div>
  </header>

  {#if error}
    <div class="cc-msg cc-error">{error}</div>
  {:else if loading}
    <div class="cc-msg">Loading…</div>
  {/if}

  {#if mode === '2d'}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="cc-board"
      onwheel={onWheel}
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
    >
      <div class="cc-stage" style="transform: translate({panX}px, {panY}px) scale({zoom});">
        <svg class="cc-edges" overflow="visible">
          <defs>
            <marker
              id="cc-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto"
            >
              <path d="M0,0 L10,5 L0,10 z" class="cc-arrowhead" />
            </marker>
          </defs>
          {#each edges as e (e.from + '|' + e.to)}
            {@const seg = edgeSeg(e)}
            {#if seg}
              <line x1={seg.x1} y1={seg.y1} x2={seg.x2} y2={seg.y2} marker-end="url(#cc-arrow)" />
            {/if}
          {/each}
        </svg>
        {#each nodes as n (n.id)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="cc-node"
            class:center={n.center}
            class:external={n.kind === 'external'}
            style="left: {n.x}px; top: {n.y}px; --node-accent: {nodeColor(n.kind)};"
            title={n.title ?? n.label}
            onpointerdown={(ev) => ev.stopPropagation()}
            onclick={(ev) => {
              ev.stopPropagation();
              activate(n);
            }}
            ondblclick={(ev) => {
              ev.stopPropagation();
              openInEditor(n);
            }}
          >
            {n.label}
          </div>
        {/each}
      </div>
      <div class="cc-hint">
        drag to pan · scroll to zoom · click a file to recenter · double-click to open
      </div>
    </div>
  {:else}
    <div class="cc-three" bind:this={threeHost}></div>
    <div class="cc-hint cc-hint-3d">
      drag to orbit · scroll to zoom · click a file to recenter · double-click to open
    </div>
  {/if}
</div>

<style>
  .code-canvas {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-primary);
    overflow: hidden;
    position: relative;
  }
  .cc-toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-primary);
    flex-shrink: 0;
  }
  .cc-title {
    font-weight: 600;
    color: var(--text-primary);
    font-size: var(--fs-sm);
  }
  .cc-path {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-tertiary);
    font-family: var(--ff-mono);
    font-size: var(--fs-xs);
  }
  .cc-modes {
    display: flex;
    gap: 2px;
  }
  .cc-modes button {
    border: 1px solid var(--border-primary);
    background: transparent;
    color: var(--text-secondary);
    padding: 2px 10px;
    cursor: pointer;
    font-size: var(--fs-xs);
  }
  .cc-modes button:first-child {
    border-radius: 6px 0 0 6px;
  }
  .cc-modes button:last-child {
    border-radius: 0 6px 6px 0;
  }
  .cc-modes button.active {
    background: var(--accent-primary);
    color: var(--text-on-accent, #fff);
    border-color: var(--accent-primary);
  }
  .cc-msg {
    position: absolute;
    top: 50px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 5;
    padding: 6px 14px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: 6px;
    font-size: var(--fs-sm);
    color: var(--text-secondary);
  }
  .cc-error {
    color: var(--accent-error, #e74c3c);
  }
  .cc-board {
    flex: 1;
    position: relative;
    overflow: hidden;
    cursor: grab;
    touch-action: none;
  }
  .cc-board:active {
    cursor: grabbing;
  }
  .cc-stage {
    position: absolute;
    left: 50%;
    top: 50%;
    transform-origin: 0 0;
    will-change: transform;
  }
  .cc-edges {
    position: absolute;
    left: 0;
    top: 0;
    overflow: visible;
    pointer-events: none;
  }
  .cc-edges line {
    stroke: color-mix(in srgb, var(--accent-primary) 45%, transparent);
    stroke-width: 1.5;
  }
  .cc-arrowhead {
    fill: color-mix(in srgb, var(--accent-primary) 70%, transparent);
  }
  .cc-depth {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .cc-depth-label {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    margin-right: 4px;
  }
  .cc-depth button {
    border: 1px solid var(--border-primary);
    background: transparent;
    color: var(--text-secondary);
    width: 22px;
    padding: 2px 0;
    cursor: pointer;
    font-size: var(--fs-xs);
    border-radius: 4px;
  }
  .cc-depth button.active {
    background: var(--accent-primary);
    color: var(--text-on-accent, #fff);
    border-color: var(--accent-primary);
  }
  .cc-node {
    position: absolute;
    transform: translate(-50%, -50%);
    padding: 6px 12px;
    border-radius: 8px;
    background: var(--bg-secondary);
    border: 1px solid var(--node-accent);
    color: var(--text-primary);
    font-family: var(--ff-mono);
    font-size: var(--fs-xs);
    white-space: nowrap;
    cursor: pointer;
    user-select: none;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
    transition:
      transform 80ms ease,
      box-shadow 120ms ease;
  }
  .cc-node:hover {
    box-shadow: 0 0 14px var(--node-accent);
  }
  .cc-node.center {
    font-weight: 700;
    font-size: var(--fs-sm);
    background: color-mix(in srgb, var(--accent-primary) 14%, var(--bg-secondary));
  }
  .cc-node.external {
    opacity: 0.75;
    cursor: default;
  }
  .cc-three {
    flex: 1;
    min-height: 0;
    position: relative;
  }
  .cc-hint {
    position: absolute;
    bottom: 8px;
    left: 50%;
    transform: translateX(-50%);
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    background: color-mix(in srgb, var(--bg-primary) 70%, transparent);
    padding: 3px 10px;
    border-radius: 100px;
    pointer-events: none;
  }
</style>
