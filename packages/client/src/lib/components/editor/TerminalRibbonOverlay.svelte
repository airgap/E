<script lang="ts">
  /**
   * Terminal ribbon renderer — 3D scroll perspective effect for xterm.js.
   *
   * Copies line-height strips from xterm's rendered canvas (WebGL/canvas)
   * and redraws them onto an overlay canvas with the same scroll-effect
   * transforms used by the code editor's canvas renderer.
   *
   * xterm's own rendering is hidden via CSS; the overlay owns all visuals.
   * pointer-events:none lets clicks/keyboard pass through to xterm's input layer.
   */
  import { onMount } from 'svelte';
  import { computeScrollEffect } from './canvas-renderer/core/scroll-effect';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { terminalConnectionManager } from '$lib/services/terminal-connection';
  import type { ZoomAlign } from './canvas-renderer/core/renderer';

  let { containerEl, sessionId }: { containerEl: HTMLDivElement; sessionId: string } = $props();

  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let alive = false;
  let pw = 0;
  let ph = 0;

  // Cached source canvas reference (invalidated when disconnected from DOM)
  let cachedSrc: HTMLCanvasElement | null = null;

  function getXtermCanvas(): HTMLCanvasElement | null {
    if (cachedSrc && cachedSrc.isConnected) return cachedSrc;
    if (!containerEl) return null;
    // WebGL addon creates a canvas inside .xterm-screen.
    // The canvas fallback renderer also puts one there.
    // Grab the last canvas (WebGL overlays the fallback).
    const canvases = containerEl.querySelectorAll<HTMLCanvasElement>('.xterm-screen canvas');
    cachedSrc = canvases.length > 0 ? canvases[canvases.length - 1] : null;
    return cachedSrc;
  }

  /** Inject CSS to hide xterm's visual output while keeping input alive */
  let styleTag: HTMLStyleElement | null = null;

  function injectHideCSS() {
    if (styleTag) return;
    styleTag = document.createElement('style');
    styleTag.textContent = [
      // Hide xterm canvas renderers (WebGL + canvas fallback)
      '.terminal-instance .xterm-screen canvas { visibility: hidden !important; }',
      // Hide DOM text renderer rows (fallback if no canvas addon)
      '.terminal-instance .xterm-rows { visibility: hidden !important; }',
    ].join('\n');
    containerEl.appendChild(styleTag);
  }

  function removeHideCSS() {
    styleTag?.remove();
    styleTag = null;
  }

  function createOverlay() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:5;';
    containerEl.style.position = 'relative';
    containerEl.appendChild(canvas);
    ctx = canvas.getContext('2d')!;
  }

  function destroyOverlay() {
    canvas?.remove();
    canvas = null;
    ctx = null;
    cachedSrc = null;
    removeHideCSS();
    pw = 0;
    ph = 0;
  }

  function tick() {
    if (!alive) return;
    requestAnimationFrame(() => {
      if (!alive) return;
      try {
        render();
      } catch (e) {
        console.error('[terminal-ribbon] render error:', e);
      }
      tick();
    });
  }

  function render() {
    if (!canvas || !ctx || !containerEl) return;

    const src = getXtermCanvas();
    if (!src || src.width === 0 || src.height === 0) {
      // No source canvas (DOM renderer?) — let native rendering show
      removeHideCSS();
      return;
    }

    // Get row count from xterm Terminal instance (not DOM, which varies by renderer)
    const dims = terminalConnectionManager.getDimensions(sessionId);
    if (!dims || dims.rows === 0) return;

    // Source canvas found and dimensions available — hide xterm's native rendering
    injectHideCSS();

    const dpr = devicePixelRatio || 1;
    const w = containerEl.clientWidth;
    const h = containerEl.clientHeight;
    if (w === 0 || h === 0) return;

    // Resize overlay canvas if needed
    const npw = Math.round(w * dpr);
    const nph = Math.round(h * dpr);
    if (npw !== pw || nph !== ph) {
      pw = npw;
      ph = nph;
      canvas.width = npw;
      canvas.height = nph;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // Clear
    ctx.clearRect(0, 0, w, h);

    // Source canvas CSS dimensions
    const srcRect = src.getBoundingClientRect();
    const srcW = srcRect.width;
    const srcH = srcRect.height;
    if (srcW === 0 || srcH === 0) return;

    // DPR ratio between source canvas pixels and CSS pixels
    const srcDpr = src.width / srcW;
    const { rows, cursorY } = dims;

    // Cell height from source canvas CSS height / row count
    const cellHeight = srcH / rows;
    const align: ZoomAlign = settingsStore.scrollRendererAlign;

    // Center the scroll effect on the cursor row, not the viewport center.
    // This keeps the active area readable when content is sparse (e.g. only
    // a few lines at the top of the terminal).
    const cursorMidY = cursorY * cellHeight + cellHeight / 2;
    const viewMid = h / 2;

    // Pre-compute scroll effects for each row.
    // Shift row positions so the cursor row maps to the viewport center
    // before feeding into computeScrollEffect.
    const fxList: ReturnType<typeof computeScrollEffect>[] = [];
    for (let r = 0; r < rows; r++) {
      const rowMidY = r * cellHeight + cellHeight / 2;
      const effectMidY = rowMidY - cursorMidY + viewMid;
      fxList.push(computeScrollEffect(effectMidY, h));
    }

    // Anchor row is the cursor row — it keeps its original Y position
    const anchorIdx = Math.max(0, Math.min(cursorY, rows - 1));

    // Compute adjusted Y positions (compressed in taper zones)
    const adjustedY = new Float64Array(rows);
    adjustedY[anchorIdx] = anchorIdx * cellHeight;

    for (let i = anchorIdx + 1; i < rows; i++) {
      adjustedY[i] = adjustedY[i - 1] + cellHeight * fxList[i - 1].heightScale;
    }
    for (let i = anchorIdx - 1; i >= 0; i--) {
      adjustedY[i] = adjustedY[i + 1] - cellHeight * fxList[i].heightScale;
    }

    // Draw each row strip with scroll transforms
    for (let i = 0; i < rows; i++) {
      const fx = fxList[i];
      if (fx.skip) continue;

      const drawY = adjustedY[i];
      const drawH = cellHeight * fx.heightScale;
      const drawMidY = drawY + drawH / 2;

      // Source strip coordinates (in source canvas pixel space)
      const srcY = Math.round(i * cellHeight * srcDpr);
      const srcStripH = Math.round(cellHeight * srcDpr);
      if (srcStripH <= 0) continue;

      ctx.save();
      ctx.globalAlpha = fx.opacity;

      const anchorX = align === 'left' ? 0 : align === 'right' ? w : w / 2;
      ctx.translate(anchorX, drawMidY);
      ctx.scale(fx.scaleX, fx.scaleY);
      if (fx.skew !== 0) {
        ctx.transform(1, fx.skew, 0, 1, 0, 0);
      }
      ctx.translate(-anchorX, -drawMidY);

      // Copy strip from xterm's canvas to our overlay
      ctx.drawImage(src, 0, srcY, src.width, srcStripH, 0, drawY, w, drawH);

      ctx.restore();
    }
  }

  onMount(() => {
    createOverlay();
    alive = true;
    tick();

    return () => {
      alive = false;
      destroyOverlay();
    };
  });
</script>
