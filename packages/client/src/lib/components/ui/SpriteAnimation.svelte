<script lang="ts">
  import { onMount } from 'svelte';

  interface Props {
    /** Path to the sprite sheet image */
    src?: string;
    /** Width of a single frame in px */
    frameWidth?: number;
    /** Height of a single frame in px */
    frameHeight?: number;
    /** Total number of frames */
    frameCount?: number;
    /** Duration per frame in ms */
    frameDuration?: number;
    /** Display size in px — snapped to nearest integer multiple of frameWidth */
    size?: number;
    /** Whether to loop the animation */
    loop?: boolean;
    /** CSS class to apply to the wrapper */
    class?: string;
  }

  let {
    src = '/E.png',
    frameWidth = 32,
    frameHeight = 32,
    frameCount = 11,
    frameDuration = 30,
    size = 32,
    loop = false,
    class: className = '',
  }: Props = $props();

  let canvasEl: HTMLCanvasElement | undefined = $state();

  /** Snap to nearest integer scale (minimum 1×) */
  const intScale = $derived(Math.max(1, Math.round(size / frameWidth)));
  const displaySize = $derived(frameWidth * intScale);
  const displayHeight = $derived(frameHeight * intScale);

  /** Read --accent-primary from computed styles and return it, falling back to white */
  function getAccentColor(): string {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue('--accent-primary')
      .trim();
    return raw || '#ffffff';
  }

  onMount(() => {
    if (!canvasEl) return;

    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.src = src;

    img.onload = () => {
      let frame = 0;
      ctx.imageSmoothingEnabled = false;

      function drawFrame() {
        if (!ctx || !canvasEl) return;
        const w = canvasEl.width;
        const h = canvasEl.height;

        ctx.clearRect(0, 0, w, h);

        // Draw the sprite frame (white-on-transparent)
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(img, frame * frameWidth, 0, frameWidth, frameHeight, 0, 0, w, h);

        // Tint: fill with accent color, but only where the sprite has alpha
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = getAccentColor();
        ctx.fillRect(0, 0, w, h);

        // Reset
        ctx.globalCompositeOperation = 'source-over';
      }

      drawFrame();

      if (frameCount <= 1) return;

      const interval = setInterval(() => {
        frame++;
        if (frame >= frameCount) {
          if (loop) {
            frame = 0;
          } else {
            clearInterval(interval);
            frame = frameCount - 1;
            drawFrame();
            return;
          }
        }
        drawFrame();
      }, frameDuration);

      return () => clearInterval(interval);
    };
  });
</script>

<canvas
  bind:this={canvasEl}
  width={displaySize}
  height={displayHeight}
  class="sprite-animation {className}"
  style="width: {displaySize}px; height: {displayHeight}px;"
></canvas>

<style>
  .sprite-animation {
    display: block;
    image-rendering: pixelated;
    image-rendering: crisp-edges;
  }
</style>
