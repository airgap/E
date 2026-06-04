<!--
  Editor3DView.svelte — read-only WebGL "3D text" view of a file (LYK-1113).

  Each line is rasterized to its own canvas texture and placed as a plane in a
  three.js scene, viewed by an angled perspective camera. Fisheye (LYK-1090):
  lines near the focus line are large/near/opaque; with distance they shrink,
  recede in z, and dim — so the focus pops and context falls away into depth.

  Read-only by design (no caret/editing in 3D). Click a line to refocus the
  fisheye on it; double-click to jump back into the 2D editor there. Windowed
  around the focus for large files. Flag-gated by the caller (`editor3dText`).
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import * as THREE from 'three';
  import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

  let {
    content,
    focusLine = 1,
    onJump,
  }: { content: string; focusLine?: number; onJump?: (line: number) => void } = $props();

  const WINDOW = 45; // lines rendered on each side of the focus
  const LINE_H = 0.34; // world height of a line at the focus
  const LEFT_X = -3.4; // world x of the left text margin
  const MAX_CHARS = 140;

  let host = $state<HTMLDivElement | null>(null);
  let renderer: THREE.WebGLRenderer | null = null;
  let scene: THREE.Scene | null = null;
  let camera: THREE.PerspectiveCamera | null = null;
  let controls: OrbitControls | null = null;
  let raf = 0;
  let resizeObs: ResizeObserver | null = null;
  const meshes: THREE.Mesh[] = [];
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  // Focus line is internal so clicking a line can re-center the fisheye.
  let focus = $state(Math.max(1, focusLine));
  $effect(() => {
    focus = Math.max(1, focusLine);
  });

  const ink = () =>
    getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim() ||
    '#f4eee3';
  const accent = () =>
    getComputedStyle(document.documentElement).getPropertyValue('--accent-primary').trim() ||
    '#e2733f';

  function lineTexture(text: string, isFocus: boolean): THREE.CanvasTexture {
    const fs = 30;
    const pad = 10;
    const c = document.createElement('canvas');
    const cx = c.getContext('2d')!;
    cx.font = `${fs}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    const shown = (text || ' ').slice(0, MAX_CHARS) || ' ';
    const w = Math.max(8, Math.ceil(cx.measureText(shown).width)) + pad * 2;
    const h = fs + pad * 2;
    c.width = w;
    c.height = h;
    cx.font = `${fs}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    cx.textBaseline = 'middle';
    if (isFocus) {
      cx.fillStyle = `color-mix(in srgb, ${accent()} 22%, transparent)`;
      // color-mix may not be supported in canvas; fall back to a plain tint.
      try {
        cx.fillRect(0, 0, w, h);
      } catch {
        /* ignore */
      }
    }
    const trimmed = shown.trimStart();
    const isComment =
      trimmed.startsWith('//') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('#');
    cx.fillStyle = isFocus ? accent() : isComment ? 'rgba(180,176,168,0.75)' : ink();
    cx.fillText(shown, pad, h / 2 + 1);
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    tex.minFilter = THREE.LinearFilter;
    return tex;
  }

  function clearMeshes() {
    if (!scene) return;
    for (const m of meshes) {
      (m.material as THREE.MeshBasicMaterial).map?.dispose();
      (m.material as THREE.MeshBasicMaterial).dispose();
      m.geometry.dispose();
      scene.remove(m);
    }
    meshes.length = 0;
  }

  function build() {
    if (!scene) return;
    clearMeshes();
    const lines = content.split('\n');
    const total = lines.length;
    const f = Math.min(Math.max(focus, 1), total);
    const lo = Math.max(1, f - WINDOW);
    const hi = Math.min(total, f + WINDOW);

    // Walk outward from the focus accumulating fisheye-compressed y spacing.
    const yOf = (lineNo: number): number => {
      const d = lineNo - f;
      const steps = Math.abs(d);
      let y = 0;
      for (let k = 1; k <= steps; k++) y += LINE_H / (1 + k * 0.045);
      return d >= 0 ? -y : y;
    };

    for (let n = lo; n <= hi; n++) {
      const d = Math.abs(n - f);
      const s = Math.max(0.28, 1 / (1 + d * 0.05)); // fisheye scale
      const z = -d * 0.13; // recede with distance
      const opacity = Math.max(0.12, 1 - d * 0.02);
      const isFocus = n === f;

      const tex = lineTexture(lines[n - 1] ?? '', isFocus);
      const img = tex.image as HTMLCanvasElement;
      const aspect = img.width / img.height;
      const hWorld = LINE_H * s * 0.86;
      const wWorld = hWorld * aspect;

      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(wWorld, hWorld), mat);
      // Left-align: left edge at LEFT_X.
      mesh.position.set(LEFT_X + wWorld / 2, yOf(n), z);
      mesh.userData.line = n;
      mesh.renderOrder = isFocus ? 2 : 1;
      scene.add(mesh);
      meshes.push(mesh);
    }
  }

  function initThree() {
    if (!host || renderer) return;
    const w = host.clientWidth || 600;
    const h = host.clientHeight || 400;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 100);
    camera.position.set(0, 0.6, 6.2);
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    host.appendChild(renderer.domElement);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 0, 0);
    renderer.domElement.addEventListener('click', onClick);
    renderer.domElement.addEventListener('dblclick', onDblClick);
    build();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      controls?.update();
      if (renderer && scene && camera) renderer.render(scene, camera);
    };
    loop();
    resizeObs = new ResizeObserver(() => {
      if (!host || !renderer || !camera) return;
      const nw = host.clientWidth;
      const nh = host.clientHeight;
      renderer.setSize(nw, nh);
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
    });
    resizeObs.observe(host);
  }

  function pick(e: MouseEvent): number | null {
    if (!renderer || !camera) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(meshes, false);
    return hits.length ? (hits[0].object.userData.line as number) : null;
  }
  function onClick(e: MouseEvent) {
    const n = pick(e);
    if (n && n !== focus) {
      focus = n;
      build();
    }
  }
  function onDblClick(e: MouseEvent) {
    const n = pick(e);
    if (n) onJump?.(n);
  }

  function dispose() {
    cancelAnimationFrame(raf);
    raf = 0;
    resizeObs?.disconnect();
    resizeObs = null;
    if (renderer) {
      renderer.domElement.removeEventListener('click', onClick);
      renderer.domElement.removeEventListener('dblclick', onDblClick);
    }
    clearMeshes();
    controls?.dispose();
    controls = null;
    renderer?.dispose();
    if (renderer?.domElement.parentElement) renderer.domElement.remove();
    renderer = null;
    scene = null;
    camera = null;
  }

  onMount(initThree);
  onDestroy(dispose);

  // Rebuild when the document or focus changes (after init).
  let lastKey = '';
  $effect(() => {
    const key = `${content.length}:${focus}`;
    if (renderer && key !== lastKey) {
      lastKey = key;
      build();
    }
  });
</script>

<div class="ed3d-wrap">
  <div class="ed3d" bind:this={host}></div>
  <div class="ed3d-hint">
    drag to orbit · scroll to zoom · click a line to focus · double-click to edit it
  </div>
</div>

<style>
  .ed3d-wrap {
    position: relative;
    flex: 1;
    min-height: 0;
    height: 100%;
    overflow: hidden;
  }
  .ed3d {
    position: absolute;
    inset: 0;
    background: var(--bg-code);
  }
  .ed3d-hint {
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
    z-index: 2;
  }
</style>
