<!--
  AmbientBackground — Canvas-based ambient effects for magic hyperthemes.
  Renders behind all UI elements with pointer-events: none.

  Activated for: arcane (sigils), ethereal (motes), study (embers), astral (constellations)
  Inactive for: tech (CSS-only effects)

  Constellation themes use WebGL for GPU-accelerated star projection,
  nebulae, galaxies, and interactive constellation reveal on pointer hover.
  Other themes use Canvas2D.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { scrollStore } from '$lib/stores/scroll.svelte';
  import { createEffect, hasAmbientEffects, type AmbientEffect } from '$lib/ambient-fx';
  import { THEME_EFFECTS } from '$lib/ambient-fx/types';
  import { WebGLRenderer } from '$lib/ambient-fx/webgl-renderer';

  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null = null;
  let activeEffect: AmbientEffect | null = null;
  let webglRenderer: WebGLRenderer | null = null;
  let animationId: number | null = null;
  let lastTime = 0;
  let currentHypertheme = '';
  let mounted = false;
  let usingWebGL = false;

  // Quarter-resolution offscreen buffer for sigil effects
  // Renders at 0.25x, applies box blur, then scales up for a soft dreamy glow
  const DOWNSAMPLE_SCALE = 0.25;
  let offscreenCanvas: OffscreenCanvas | null = null;
  let offscreenCtx: OffscreenCanvasRenderingContext2D | null = null;
  let useDownsampledRendering = false;

  // Pointer tracking for interactive constellation reveal
  let pointerX = -1000;
  let pointerY = -1000;

  // Optional background image for themes that have one (e.g. Study)
  let bgImage: HTMLImageElement | null = null;
  let bgImageReady = false;

  // Target ~24fps for Canvas2D effects (decorative, don't need 60fps)
  // WebGL runs at full rAF rate since GPU does the work
  const CANVAS2D_FRAME_INTERVAL = 1000 / 24;

  function isConstellationType(hyperthemeId: string): boolean {
    const config = THEME_EFFECTS[hyperthemeId];
    return config?.type === 'constellation';
  }

  function isSigilType(hyperthemeId: string): boolean {
    const config = THEME_EFFECTS[hyperthemeId];
    return config?.type === 'sigil';
  }

  /**
   * Box blur on ImageData — averages each pixel with its 8 neighbors.
   * Fast on small buffers (quarter-res means ~6% of full pixel count).
   */
  function boxBlur(imageData: ImageData): void {
    const { data, width, height } = imageData;
    const copy = new Uint8ClampedArray(data);

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = (y * width + x) * 4;
        for (let c = 0; c < 4; c++) {
          data[i + c] =
            (copy[((y - 1) * width + (x - 1)) * 4 + c] +
              copy[((y - 1) * width + x) * 4 + c] +
              copy[((y - 1) * width + (x + 1)) * 4 + c] +
              copy[(y * width + (x - 1)) * 4 + c] +
              copy[i + c] +
              copy[(y * width + (x + 1)) * 4 + c] +
              copy[((y + 1) * width + (x - 1)) * 4 + c] +
              copy[((y + 1) * width + x) * 4 + c] +
              copy[((y + 1) * width + (x + 1)) * 4 + c]) /
            9;
        }
      }
    }
  }

  function destroyCurrent() {
    if (animationId !== null) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
    if (activeEffect) {
      activeEffect.destroy();
      activeEffect = null;
    }
    if (webglRenderer) {
      webglRenderer.destroy();
      webglRenderer = null;
    }
    usingWebGL = false;
    useDownsampledRendering = false;
    offscreenCanvas = null;
    offscreenCtx = null;
    ctx = null;
    bgImage = null;
    bgImageReady = false;
  }

  /**
   * Draw background image with cover-fit, darkened and tinted to blend
   * with the theme's backgroundColor. Only called for themes that specify
   * a backgroundImage in their THEME_EFFECTS config.
   */
  function drawBgImage(target: CanvasRenderingContext2D, w: number, h: number, bgColor: string) {
    if (!bgImage || !bgImageReady) return;

    // Cover-fit: scale image to cover the entire canvas, left-aligned
    const imgW = bgImage.naturalWidth;
    const imgH = bgImage.naturalHeight;
    const scale = Math.max(w / imgW, h / imgH);
    const drawW = imgW * scale;
    const drawH = imgH * scale;
    const ox = 0;
    const oy = (h - drawH) * 0.5;

    // Draw image at reduced opacity so it's subtle
    target.globalAlpha = 0.35;
    target.drawImage(bgImage, ox, oy, drawW, drawH);
    target.globalAlpha = 1;

    // Darken overlay to push it further into the background
    target.fillStyle = bgColor;
    target.globalAlpha = 0.55;
    target.fillRect(0, 0, w, h);
    target.globalAlpha = 1;
  }

  function initEffect(hyperthemeId: string) {
    destroyCurrent();
    currentHypertheme = hyperthemeId;

    if (!hasAmbientEffects(hyperthemeId) || !canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;

    if (isConstellationType(hyperthemeId)) {
      // ── WebGL path (constellations) ──────────────────────────────
      const renderer = new WebGLRenderer(hyperthemeId);
      const success = renderer.init(canvas, width * dpr, height * dpr);

      if (success) {
        webglRenderer = renderer;
        usingWebGL = true;
        lastTime = performance.now();
        tickWebGL();
        return;
      }
      // WebGL failed — fall through to Canvas2D
      console.warn('[AmbientBackground] WebGL failed, falling back to Canvas2D');
    }

    // ── Canvas2D path (sigils, motes, or WebGL fallback) ─────────
    ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Sigil effects render at quarter resolution with box blur for a soft dreamy glow
    useDownsampledRendering = isSigilType(hyperthemeId);
    if (useDownsampledRendering) {
      const offW = Math.max(1, Math.floor(width * DOWNSAMPLE_SCALE));
      const offH = Math.max(1, Math.floor(height * DOWNSAMPLE_SCALE));
      offscreenCanvas = new OffscreenCanvas(offW, offH);
      offscreenCtx = offscreenCanvas.getContext('2d');
    }

    // Load background image if the theme specifies one
    const themeConfig = THEME_EFFECTS[hyperthemeId];
    if (themeConfig?.backgroundImage) {
      const img = new Image();
      img.src = themeConfig.backgroundImage;
      img.onload = () => {
        bgImage = img;
        bgImageReady = true;
      };
    }

    activeEffect = createEffect(hyperthemeId);
    if (activeEffect) {
      if (useDownsampledRendering) {
        // Init effect at quarter resolution
        const offW = Math.floor(width * DOWNSAMPLE_SCALE);
        const offH = Math.floor(height * DOWNSAMPLE_SCALE);
        activeEffect.init(offW, offH);
      } else {
        activeEffect.init(width, height);
      }
      lastTime = performance.now();
      tickCanvas2D();
    }
  }

  // ── WebGL animation loop ────────────────────────────────────────
  function tickWebGL() {
    if (!webglRenderer || !canvas) return;

    animationId = requestAnimationFrame(tickWebGL);

    const now = performance.now();
    const elapsed = now - lastTime;
    lastTime = now;

    const deltaTime = Math.min(elapsed, 100);

    // Feed scroll and pointer
    webglRenderer.setScrollOffset(scrollStore.rawOffset);
    webglRenderer.setPointerPosition(pointerX, pointerY);

    // Update and render
    webglRenderer.update(deltaTime);
    webglRenderer.render();
  }

  // ── Canvas2D animation loop ─────────────────────────────────────
  function tickCanvas2D() {
    if (!activeEffect || !ctx || !canvas) return;

    animationId = requestAnimationFrame(tickCanvas2D);

    const now = performance.now();
    const elapsed = now - lastTime;
    if (elapsed < CANVAS2D_FRAME_INTERVAL) return;
    lastTime = now - (elapsed % CANVAS2D_FRAME_INTERVAL);

    const deltaTime = Math.min(elapsed, 100);

    if (activeEffect.setScrollOffset) {
      activeEffect.setScrollOffset(scrollStore.rawOffset);
    }
    if (activeEffect.setPointerPosition) {
      activeEffect.setPointerPosition(pointerX, pointerY);
    }

    activeEffect.update(deltaTime);

    const themeConfig = THEME_EFFECTS[currentHypertheme];

    if (useDownsampledRendering && offscreenCtx && offscreenCanvas) {
      // ── Quarter-res path: render → box blur → scale up ──────
      const offW = offscreenCanvas.width;
      const offH = offscreenCanvas.height;

      // Clear offscreen buffer
      if (themeConfig) {
        offscreenCtx.fillStyle = themeConfig.colors.backgroundColor;
        offscreenCtx.fillRect(0, 0, offW, offH);
      } else {
        offscreenCtx.clearRect(0, 0, offW, offH);
      }

      // Render effect at quarter resolution
      // OffscreenCanvasRenderingContext2D is API-compatible with CanvasRenderingContext2D
      // for all drawing operations used by ambient effects
      activeEffect.render(offscreenCtx as unknown as CanvasRenderingContext2D);

      // Box blur the small buffer — 3 passes approximates a Gaussian
      const imageData = offscreenCtx.getImageData(0, 0, offW, offH);
      boxBlur(imageData);
      boxBlur(imageData);
      boxBlur(imageData);
      offscreenCtx.putImageData(imageData, 0, 0);

      // Scale up to main canvas with bilinear interpolation (default)
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(offscreenCanvas, 0, 0, canvas.clientWidth, canvas.clientHeight);
    } else {
      // ── Full-res path (motes, embers, fallbacks) ──────────────
      if (themeConfig) {
        ctx.fillStyle = themeConfig.colors.backgroundColor;
        ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);

        // Draw background image if available (cover-fit, darkened)
        if (themeConfig.backgroundImage) {
          drawBgImage(
            ctx,
            canvas.clientWidth,
            canvas.clientHeight,
            themeConfig.colors.backgroundColor,
          );
        }
      } else {
        ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      }

      activeEffect.render(ctx);
    }
  }

  function handleResize() {
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;

    if (usingWebGL && webglRenderer) {
      webglRenderer.resize(width * dpr, height * dpr);
    } else if (ctx && activeEffect) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (useDownsampledRendering && offscreenCanvas) {
        const offW = Math.max(1, Math.floor(width * DOWNSAMPLE_SCALE));
        const offH = Math.max(1, Math.floor(height * DOWNSAMPLE_SCALE));
        offscreenCanvas = new OffscreenCanvas(offW, offH);
        offscreenCtx = offscreenCanvas.getContext('2d');
        activeEffect.resize(offW, offH);
      } else {
        activeEffect.resize(width, height);
      }
    }
  }

  onMount(() => {
    mounted = true;
    initEffect(settingsStore.hypertheme);

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(canvas);

    // Track pointer for interactive constellation reveal
    function onPointerMove(e: PointerEvent) {
      pointerX = e.clientX;
      pointerY = e.clientY;
    }
    function onPointerLeave() {
      pointerX = -1000;
      pointerY = -1000;
    }
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerleave', onPointerLeave);

    return () => {
      mounted = false;
      destroyCurrent();
      resizeObserver.disconnect();
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerleave', onPointerLeave);
    };
  });

  // React to theme changes
  $effect(() => {
    const ht = settingsStore.hypertheme;
    if (mounted && ht !== currentHypertheme) {
      initEffect(ht);
    }
  });

  let isActive = $derived(hasAmbientEffects(settingsStore.hypertheme));
</script>

<canvas bind:this={canvas} class="ambient-canvas" class:active={isActive} aria-hidden="true"
></canvas>

<style>
  .ambient-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 0;
    opacity: 0;
    transition: opacity 1s ease;
    /* GPU acceleration — composites on its own layer */
    will-change: transform;
    transform: translateZ(0);
    contain: strict;
  }
  .ambient-canvas.active {
    opacity: 1;
  }
</style>
