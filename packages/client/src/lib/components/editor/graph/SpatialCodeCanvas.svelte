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
  import type { RelationGraph, RelationNode } from './types';

  let { startFilePath }: { startFilePath: string } = $props();

  interface LaidOutNode extends RelationNode {
    x: number;
    y: number;
    z: number;
    /** Import specifier (for non-center nodes), used to resolve navigation. */
    specifier?: string;
  }

  let mode = $state<'2d' | '3d'>('2d');
  let currentFile = $state(startFilePath);
  let title = $state('');
  let nodes = $state<LaidOutNode[]>([]);
  let edges = $state<{ from: string; to: string }[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);

  // ── 2D viewport ──────────────────────────────────────────────────────────
  let zoom = $state(1);
  let panX = $state(0);
  let panY = $state(0);
  let dragging = false;
  let dragStart = { x: 0, y: 0, panX: 0, panY: 0 };

  const RADIUS = 260;
  const RADIUS_OUTER = 420;

  function basename(p: string): string {
    return p.split('/').pop() || p;
  }

  function layout(graph: RelationGraph): LaidOutNode[] {
    const center = graph.nodes.find((n) => n.center) ?? graph.nodes[0];
    const others = graph.nodes.filter((n) => n !== center);
    // Internal files ring closer; external deps ring farther out.
    const internal = others.filter((n) => n.kind !== 'external');
    const external = others.filter((n) => n.kind === 'external');

    const placed: LaidOutNode[] = [{ ...center, x: 0, y: 0, z: 0, specifier: specifierOf(center) }];
    const ring = (group: RelationNode[], r: number, phase: number) => {
      group.forEach((n, i) => {
        const a = phase + (i / Math.max(group.length, 1)) * Math.PI * 2;
        // Fibonacci-ish vertical spread for 3D depth; flat for 2D.
        const zt = group.length > 1 ? (i / (group.length - 1)) * 2 - 1 : 0;
        placed.push({
          ...n,
          x: Math.cos(a) * r,
          y: Math.sin(a) * r,
          z: zt * r * 0.6,
          specifier: specifierOf(n),
        });
      });
    };
    ring(internal, RADIUS, 0);
    ring(external, RADIUS_OUTER, Math.PI / 6);
    return placed;
  }

  function specifierOf(n: RelationNode): string | undefined {
    return n.id.startsWith('import:') ? n.id.slice('import:'.length) : undefined;
  }

  async function loadGraph(filePath: string) {
    loading = true;
    error = null;
    try {
      const res = await api.files.read(filePath);
      const doc = res.data.content;
      const graph = await moduleDepsProvider.build({
        filePath,
        workspacePath: settingsStore.workspacePath || '',
        pos: 0,
        doc,
        line: 0,
        column: 0,
      });
      if (!graph) {
        nodes = [
          {
            id: `file:${filePath}`,
            label: basename(filePath),
            kind: 'file',
            center: true,
            x: 0,
            y: 0,
            z: 0,
          },
        ];
        edges = [];
        title = `${basename(filePath)} · no imports`;
      } else {
        nodes = layout(graph);
        edges = graph.edges.map((e) => ({ from: e.from, to: e.to }));
        title = graph.title;
      }
      currentFile = filePath;
      // Reset the 2D view to frame the new neighborhood.
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

  /** Resolve a relative import specifier to a real file by probing extensions. */
  async function resolveSpecifier(spec: string, fromFile: string): Promise<string | null> {
    if (!spec.startsWith('.')) return null; // only relative imports are navigable in v1
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
      `${baseAbs}/index.ts`,
      `${baseAbs}/index.js`,
    ];
    for (const c of candidates) {
      try {
        await api.files.read(c);
        return c;
      } catch {
        /* try next */
      }
    }
    return null;
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

  async function activate(node: LaidOutNode) {
    if (node.center) {
      // Recenter on the center == open it in the editor.
      editorStore.openFile(currentFile, false);
      return;
    }
    if (node.kind === 'external' || !node.specifier) return;
    const resolved = await resolveSpecifier(node.specifier, currentFile);
    if (resolved) loadGraph(resolved);
  }

  function openInEditor(node: LaidOutNode) {
    if (node.center) {
      editorStore.openFile(currentFile, false);
    } else if (node.specifier) {
      resolveSpecifier(node.specifier, currentFile).then((r) => {
        if (r) editorStore.openFile(r, false);
      });
    }
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

  function edgePos(id: string) {
    const n = nodes.find((x) => x.id === id);
    return n ? { x: n.x, y: n.y } : { x: 0, y: 0 };
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
    const toRemove = scene.children.filter((c) => c.type === 'LineSegments');
    for (const c of toRemove) scene.remove(c);

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

    const pts: number[] = [];
    for (const e of edges) {
      const a = nodes.find((x) => x.id === e.from);
      const b = nodes.find((x) => x.id === e.to);
      if (!a || !b) continue;
      pts.push(a.x * scale, a.y * scale, a.z * scale, b.x * scale, b.y * scale, b.z * scale);
    }
    if (pts.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const accent =
        getComputedStyle(document.documentElement).getPropertyValue('--accent-primary').trim() ||
        '#e2733f';
      const line = new THREE.LineSegments(
        geo,
        new THREE.LineBasicMaterial({
          color: new THREE.Color(accent),
          transparent: true,
          opacity: 0.4,
        }),
      );
      scene.add(line);
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
          {#each edges as e (e.from + e.to)}
            {@const a = edgePos(e.from)}
            {@const b = edgePos(e.to)}
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
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
