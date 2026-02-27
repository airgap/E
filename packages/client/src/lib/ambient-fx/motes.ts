/**
 * Motes Effect — Floating luminous particles for Ethereal hypertheme
 *
 * Two particle layers:
 * 1. Motes: Gentle floating luminous orbs with breathing opacity/size
 * 2. Shimmers: Tiny bright sparkles that pop in, twinkle, and fade out quickly
 *
 * Performance optimization: pre-renders each particle's glow to an offscreen
 * canvas sprite at init time, then uses drawImage() instead of creating
 * new radial gradients every frame.
 */
import type { AmbientEffect, AmbientThemeColors, ParticleConfig } from './types';

interface Mote {
  x: number;
  y: number;
  size: number;
  baseSize: number;
  speed: number;
  opacity: number;
  baseOpacity: number;
  r: number;
  g: number;
  b: number;
  angle: number;
  drift: number;
  phase: number;
  phaseSpeed: number;
  /** Pre-rendered glow sprite */
  sprite: OffscreenCanvas;
  spriteSize: number;
}

// ── Shimmer sparkles ────────────────────────────────────────────
interface Shimmer {
  x: number;
  y: number;
  size: number;
  /** Lifetime 0→1, dies at 1 */
  life: number;
  lifeSpeed: number;
  opacity: number;
  maxOpacity: number;
  /** Twinkle frequency */
  twinkleSpeed: number;
  twinklePhase: number;
  sprite: OffscreenCanvas;
  spriteSize: number;
}

function parseColor(color: string): { r: number; g: number; b: number } {
  const match = color.match(/rgba?\(([^)]+)\)/);
  if (match) {
    const parts = match[1].split(',').map((s) => parseFloat(s.trim()));
    return { r: parts[0], g: parts[1], b: parts[2] };
  }
  return { r: 180, g: 160, b: 220 };
}

/**
 * Pre-render a mote's glow + core to an offscreen canvas.
 * The sprite includes the radial gradient glow and bright center dot.
 */
function createMoteSprite(
  r: number,
  g: number,
  b: number,
  maxSize: number,
): { canvas: OffscreenCanvas; size: number } {
  const glowRadius = maxSize * 3;
  const dim = Math.ceil(glowRadius * 2) + 2;
  const oc = new OffscreenCanvas(dim, dim);
  const ctx = oc.getContext('2d')!;
  const cx = dim / 2;
  const cy = dim / 2;

  // Glow
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius);
  gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.6)`);
  gradient.addColorStop(0.4, `rgba(${r}, ${g}, ${b}, 0.2)`);
  gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, dim, dim);

  // Core
  ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 1)`;
  ctx.beginPath();
  ctx.arc(cx, cy, maxSize * 0.5, 0, Math.PI * 2);
  ctx.fill();

  return { canvas: oc, size: dim };
}

/**
 * Pre-render a shimmer sparkle — tiny white-hot core with a soft colored halo.
 * Much smaller and brighter than mote sprites, with a 4-point star shape.
 */
function createShimmerSprite(
  r: number,
  g: number,
  b: number,
): { canvas: OffscreenCanvas; size: number } {
  const dim = 24;
  const oc = new OffscreenCanvas(dim, dim);
  const ctx = oc.getContext('2d')!;
  const cx = dim / 2;
  const cy = dim / 2;

  // Soft colored halo
  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, dim * 0.45);
  halo.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.4)`);
  halo.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.1)`);
  halo.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, dim, dim);

  // 4-point star cross — horizontal and vertical spikes
  ctx.globalCompositeOperation = 'lighter';
  for (const [sx, sy] of [
    [1, 0.15],
    [0.15, 1],
  ] as const) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(sx, sy);
    const spike = ctx.createRadialGradient(0, 0, 0, 0, 0, dim * 0.4);
    spike.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
    spike.addColorStop(0.3, `rgba(${r}, ${g}, ${b}, 0.3)`);
    spike.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = spike;
    ctx.fillRect(-dim * 0.4, -dim * 0.4, dim * 0.8, dim * 0.8);
    ctx.restore();
  }
  ctx.globalCompositeOperation = 'source-over';

  // Bright white core
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, 2);
  core.addColorStop(0, 'rgba(255, 255, 255, 1)');
  core.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, 2, 0, Math.PI * 2);
  ctx.fill();

  return { canvas: oc, size: dim };
}

export class MotesEffect implements AmbientEffect {
  private motes: Mote[] = [];
  private shimmers: Shimmer[] = [];
  private width = 0;
  private height = 0;
  private time = 0;

  // Pre-rendered shimmer sprites (one per color)
  private shimmerSprites: { canvas: OffscreenCanvas; size: number }[] = [];

  constructor(
    private config: ParticleConfig,
    private colors: AmbientThemeColors,
  ) {}

  init(width: number, height: number): void {
    this.width = width;
    this.height = height;

    const colorStrings = [
      this.colors.particleColor1,
      this.colors.particleColor2,
      this.colors.particleColor3,
    ];

    // Pre-render mote sprites per color
    const spriteCache = new Map<string, { canvas: OffscreenCanvas; size: number }>();

    this.motes = Array.from({ length: this.config.count }, (_, i) => {
      const colorStr = colorStrings[i % colorStrings.length];
      const { r, g, b } = parseColor(colorStr);
      const baseSize =
        this.config.sizeMin + Math.random() * (this.config.sizeMax - this.config.sizeMin);

      // Get or create sprite for this color at max size
      const spriteKey = `${r},${g},${b}`;
      let spriteData = spriteCache.get(spriteKey);
      if (!spriteData) {
        spriteData = createMoteSprite(r, g, b, this.config.sizeMax);
        spriteCache.set(spriteKey, spriteData);
      }

      return {
        x: Math.random() * width,
        y: Math.random() * height,
        size: baseSize,
        baseSize,
        speed: this.config.speedMin + Math.random() * (this.config.speedMax - this.config.speedMin),
        opacity: 0,
        baseOpacity: 0.2 + Math.random() * 0.5,
        r,
        g,
        b,
        angle: Math.random() * Math.PI * 2,
        drift: (Math.random() - 0.5) * this.config.drift,
        phase: Math.random() * Math.PI * 2,
        phaseSpeed: 0.3 + Math.random() * 0.7,
        sprite: spriteData.canvas,
        spriteSize: spriteData.size,
      };
    });

    // Pre-render shimmer sprites (one per color variant)
    this.shimmerSprites = colorStrings.map((colorStr) => {
      const { r, g, b } = parseColor(colorStr);
      return createShimmerSprite(r, g, b);
    });

    // Spawn initial shimmers at random lifetimes
    this.initShimmers();
  }

  private initShimmers(): void {
    const count = 18;
    this.shimmers = Array.from({ length: count }, () => this.spawnShimmer(true));
  }

  private spawnShimmer(randomLife: boolean): Shimmer {
    const spriteIdx = Math.floor(Math.random() * this.shimmerSprites.length);
    const sprite = this.shimmerSprites[spriteIdx];
    return {
      x: Math.random() * this.width,
      y: Math.random() * this.height,
      size: 0.4 + Math.random() * 0.8,
      life: randomLife ? Math.random() : 0,
      lifeSpeed: 0.15 + Math.random() * 0.35,
      opacity: 0,
      maxOpacity: 0.3 + Math.random() * 0.7,
      twinkleSpeed: 3 + Math.random() * 6,
      twinklePhase: Math.random() * Math.PI * 2,
      sprite: sprite.canvas,
      spriteSize: sprite.size,
    };
  }

  resize(width: number, height: number): void {
    const scaleX = width / this.width;
    const scaleY = height / this.height;
    this.width = width;
    this.height = height;
    for (const m of this.motes) {
      m.x *= scaleX;
      m.y *= scaleY;
    }
    for (const s of this.shimmers) {
      s.x *= scaleX;
      s.y *= scaleY;
    }
  }

  update(deltaTime: number): void {
    const dt = deltaTime * 0.001;
    this.time += dt;

    // ── Update motes ──────────────────────────────────────────────
    for (const mote of this.motes) {
      // Gentle floating motion
      mote.angle += (Math.random() - 0.5) * 0.02;
      mote.x += Math.cos(mote.angle) * mote.speed + Math.sin(this.time * 0.3 + mote.phase) * 0.1;
      mote.y += Math.sin(mote.angle) * mote.speed - 0.15; // Slight upward drift

      // Pulsing opacity
      mote.opacity =
        mote.baseOpacity * (0.5 + 0.5 * Math.sin(this.time * mote.phaseSpeed + mote.phase));

      // Breathing size
      mote.size =
        mote.baseSize * (0.8 + 0.4 * Math.sin(this.time * mote.phaseSpeed * 0.7 + mote.phase));

      // Wrap around
      if (mote.x < -10) mote.x = this.width + 10;
      if (mote.x > this.width + 10) mote.x = -10;
      if (mote.y < -10) mote.y = this.height + 10;
      if (mote.y > this.height + 10) mote.y = -10;
    }

    // ── Update shimmers ───────────────────────────────────────────
    for (let i = 0; i < this.shimmers.length; i++) {
      const s = this.shimmers[i];
      s.life += s.lifeSpeed * dt;

      if (s.life >= 1) {
        // Respawn at new random position
        this.shimmers[i] = this.spawnShimmer(false);
        continue;
      }

      // Sharp fade in, twinkle, sharp fade out
      const fadeIn = Math.min(1, s.life * 6); // 0→0.17 = pop in
      const fadeOut = Math.max(0, 1 - (s.life - 0.6) / 0.4); // 0.6→1.0 = fade out
      const twinkle = 0.5 + 0.5 * Math.sin(this.time * s.twinkleSpeed + s.twinklePhase);
      s.opacity = s.maxOpacity * fadeIn * fadeOut * twinkle;
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    // ── Layer 1: Motes (bottom) ────────────────────────────────────
    for (const mote of this.motes) {
      if (mote.opacity < 0.02) continue;

      // Draw pre-rendered sprite with current opacity and size scaling
      const scale = mote.size / this.config.sizeMax;
      const drawSize = mote.spriteSize * scale;
      ctx.globalAlpha = mote.opacity;
      ctx.drawImage(
        mote.sprite,
        mote.x - drawSize * 0.5,
        mote.y - drawSize * 0.5,
        drawSize,
        drawSize,
      );
    }

    // ── Layer 2: Shimmers (top) ────────────────────────────────────
    ctx.globalCompositeOperation = 'lighter';
    for (const s of this.shimmers) {
      if (s.opacity < 0.02) continue;
      const drawSize = s.spriteSize * s.size;
      ctx.globalAlpha = s.opacity;
      ctx.drawImage(s.sprite, s.x - drawSize * 0.5, s.y - drawSize * 0.5, drawSize, drawSize);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  destroy(): void {
    this.motes = [];
    this.shimmers = [];
    this.shimmerSprites = [];
  }
}
