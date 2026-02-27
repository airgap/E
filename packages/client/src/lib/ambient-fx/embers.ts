/**
 * Embers Effect — Floating embers, candle flickers & smoke wisps for Wizard's Study
 *
 * Three particle layers:
 * 1. Embers: Bright amber sparks rising from the bottom, dimming as they ascend
 * 2. Smoke wisps: Large, extremely faint grey shapes drifting upward with slow rotation
 * 3. Candle glows: Stationary warm pools of light that pulse and breathe
 *
 * Performance: pre-renders ember and smoke sprites to OffscreenCanvas at init.
 */
import type { AmbientEffect, AmbientThemeColors, ParticleConfig } from './types';

// ── Ember particles ─────────────────────────────────────────────
interface Ember {
  x: number;
  y: number;
  size: number;
  baseSize: number;
  speed: number;
  opacity: number;
  maxOpacity: number;
  /** Horizontal sway */
  swayPhase: number;
  swayAmplitude: number;
  swaySpeed: number;
  /** Flicker phase */
  flickerPhase: number;
  flickerSpeed: number;
  /** Lifetime 0→1, dies at 1 */
  life: number;
  lifeSpeed: number;
  sprite: OffscreenCanvas;
  spriteSize: number;
}

// ── Smoke wisps ─────────────────────────────────────────────────
interface Wisp {
  x: number;
  y: number;
  size: number;
  opacity: number;
  maxOpacity: number;
  rotation: number;
  rotationSpeed: number;
  speedX: number;
  speedY: number;
  life: number;
  lifeSpeed: number;
  sprite: OffscreenCanvas;
  spriteSize: number;
}

// ── Candle glow pools ───────────────────────────────────────────
interface CandleGlow {
  x: number;
  y: number;
  radius: number;
  baseRadius: number;
  opacity: number;
  baseOpacity: number;
  phase: number;
  phaseSpeed: number;
  /** Secondary breathe for radius */
  breathePhase: number;
  breatheSpeed: number;
  r: number;
  g: number;
  b: number;
}

function parseRGBA(color: string): { r: number; g: number; b: number; a: number } {
  const match = color.match(/rgba?\(([^)]+)\)/);
  if (match) {
    const parts = match[1].split(',').map((s) => parseFloat(s.trim()));
    return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
  }
  return { r: 228, g: 160, b: 60, a: 0.8 };
}

/**
 * Pre-render an ember spark sprite — bright core with warm glow falloff
 */
function createEmberSprite(
  r: number,
  g: number,
  b: number,
  maxSize: number,
): { canvas: OffscreenCanvas; size: number } {
  const glowRadius = maxSize * 4;
  const dim = Math.ceil(glowRadius * 2) + 2;
  const oc = new OffscreenCanvas(dim, dim);
  const ctx = oc.getContext('2d')!;
  const cx = dim / 2;
  const cy = dim / 2;

  // Warm glow halo
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius);
  gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.9)`);
  gradient.addColorStop(0.15, `rgba(${r}, ${g}, ${b}, 0.5)`);
  gradient.addColorStop(0.4, `rgba(${r}, ${Math.max(0, g - 40)}, ${Math.max(0, b - 30)}, 0.15)`);
  gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, dim, dim);

  // Bright white-hot core
  const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxSize * 0.6);
  coreGrad.addColorStop(0, `rgba(255, 245, 220, 0.95)`);
  coreGrad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
  ctx.fillStyle = coreGrad;
  ctx.fillRect(0, 0, dim, dim);

  return { canvas: oc, size: dim };
}

/**
 * Pre-render a smoke wisp sprite — very soft, diffuse blob
 */
function createSmokeSprite(size: number): { canvas: OffscreenCanvas; size: number } {
  const dim = size * 2 + 4;
  const oc = new OffscreenCanvas(dim, dim);
  const ctx = oc.getContext('2d')!;
  const cx = dim / 2;
  const cy = dim / 2;

  // Stretched, asymmetric smoke blob
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, 1.4); // Taller than wide

  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 0.8);
  gradient.addColorStop(0, 'rgba(180, 170, 160, 0.12)');
  gradient.addColorStop(0.5, 'rgba(160, 150, 140, 0.06)');
  gradient.addColorStop(1, 'rgba(140, 130, 120, 0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.8, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  return { canvas: oc, size: dim };
}

export class EmberEffect implements AmbientEffect {
  private embers: Ember[] = [];
  private wisps: Wisp[] = [];
  private candles: CandleGlow[] = [];
  private width = 0;
  private height = 0;
  private time = 0;

  // Sprite caches
  private emberSprites: { canvas: OffscreenCanvas; size: number }[] = [];
  private smokeSprites: { canvas: OffscreenCanvas; size: number }[] = [];

  constructor(
    private config: ParticleConfig,
    private colors: AmbientThemeColors,
  ) {}

  init(width: number, height: number): void {
    this.width = width;
    this.height = height;

    const c1 = parseRGBA(this.colors.particleColor1); // bright amber ember
    const c2 = parseRGBA(this.colors.particleColor2); // deep orange ember
    const c3 = parseRGBA(this.colors.particleColor3); // pale gold ember

    // Pre-render ember sprites (3 color variants)
    this.emberSprites = [
      createEmberSprite(c1.r, c1.g, c1.b, this.config.sizeMax),
      createEmberSprite(c2.r, c2.g, c2.b, this.config.sizeMax),
      createEmberSprite(c3.r, c3.g, c3.b, this.config.sizeMax),
    ];

    // Pre-render smoke sprites (3 sizes)
    this.smokeSprites = [createSmokeSprite(40), createSmokeSprite(60), createSmokeSprite(80)];

    this.initEmbers();
    this.initWisps();
    this.initCandles();
  }

  private initEmbers(): void {
    const count = this.config.count;
    this.embers = Array.from({ length: count }, () => this.spawnEmber(true));
  }

  private spawnEmber(randomLife: boolean): Ember {
    const spriteIdx = Math.floor(Math.random() * 3);
    const sprite = this.emberSprites[spriteIdx];
    const baseSize =
      this.config.sizeMin + Math.random() * (this.config.sizeMax - this.config.sizeMin);

    return {
      x: Math.random() * this.width,
      y: randomLife ? Math.random() * this.height : this.height + Math.random() * 40,
      size: baseSize,
      baseSize,
      speed: 0.5 + Math.random() * 1.0,
      opacity: 0,
      maxOpacity: 0.1 + Math.random() * 0.2,
      swayPhase: Math.random() * Math.PI * 2,
      swayAmplitude: 10 + Math.random() * 30,
      swaySpeed: 0.3 + Math.random() * 0.6,
      flickerPhase: Math.random() * Math.PI * 2,
      flickerSpeed: 0.4 + Math.random() * 0.8,
      life: randomLife ? Math.random() : 0,
      lifeSpeed: 0.03 + Math.random() * 0.05,
      sprite: sprite.canvas,
      spriteSize: sprite.size,
    };
  }

  private initWisps(): void {
    // Fewer wisps — they're large and subtle
    const wispCount = Math.floor(this.config.count * 0.15);
    this.wisps = Array.from({ length: wispCount }, () => this.spawnWisp(true));
  }

  private spawnWisp(randomLife: boolean): Wisp {
    const spriteIdx = Math.floor(Math.random() * 3);
    const sprite = this.smokeSprites[spriteIdx];

    return {
      x: Math.random() * this.width,
      y: randomLife
        ? this.height * 0.3 + Math.random() * this.height * 0.7
        : this.height + 20 + Math.random() * 40,
      size: 40 + Math.random() * 60,
      opacity: 0,
      maxOpacity: 0.04 + Math.random() * 0.06,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.1,
      speedX: (Math.random() - 0.5) * 0.15,
      speedY: -(0.1 + Math.random() * 0.2),
      life: randomLife ? Math.random() : 0,
      lifeSpeed: 0.02 + Math.random() * 0.03,
      sprite: sprite.canvas,
      spriteSize: sprite.size,
    };
  }

  private initCandles(): void {
    // A few stationary warm light pools
    const candleCount = 3 + Math.floor(Math.random() * 3);
    const glowColor = parseRGBA(this.colors.glowColor);

    this.candles = Array.from({ length: candleCount }, () => ({
      x: Math.random() * this.width,
      y: this.height * 0.5 + Math.random() * this.height * 0.5,
      radius: 80 + Math.random() * 120,
      baseRadius: 80 + Math.random() * 120,
      opacity: 0,
      baseOpacity: 0.03 + Math.random() * 0.04,
      phase: Math.random() * Math.PI * 2,
      phaseSpeed: 0.8 + Math.random() * 1.2,
      breathePhase: Math.random() * Math.PI * 2,
      breatheSpeed: 0.3 + Math.random() * 0.4,
      r: glowColor.r,
      g: glowColor.g,
      b: glowColor.b,
    }));
  }

  resize(width: number, height: number): void {
    const scaleX = width / this.width;
    const scaleY = height / this.height;
    this.width = width;
    this.height = height;

    for (const e of this.embers) {
      e.x *= scaleX;
      e.y *= scaleY;
    }
    for (const w of this.wisps) {
      w.x *= scaleX;
      w.y *= scaleY;
    }
    for (const c of this.candles) {
      c.x *= scaleX;
      c.y *= scaleY;
    }
  }

  update(deltaTime: number): void {
    const dt = deltaTime * 0.001;
    this.time += dt;

    // ── Update embers ───────────────────────────────────────────
    for (let i = 0; i < this.embers.length; i++) {
      const e = this.embers[i];
      e.life += e.lifeSpeed * dt;

      if (e.life >= 1) {
        // Respawn from bottom
        this.embers[i] = this.spawnEmber(false);
        continue;
      }

      // Rise upward
      e.y -= e.speed;

      // Horizontal sway
      e.swayPhase += e.swaySpeed * dt;
      e.x += Math.sin(e.swayPhase) * 0.3;

      // Gentle breathe (slow, subtle)
      e.flickerPhase += e.flickerSpeed * dt;
      const flicker = 0.85 + 0.15 * Math.sin(e.flickerPhase);

      // Fade in → full → fade out (quick in, slow burn, quick out)
      const fadeIn = Math.min(1, e.life * 5); // 0→0.2 = fade in
      const fadeOut = Math.max(0, 1 - (e.life - 0.7) / 0.3); // 0.7→1.0 = fade out
      e.opacity = e.maxOpacity * fadeIn * fadeOut * flicker;

      // Shrink as they die
      e.size = e.baseSize * (0.3 + 0.7 * fadeOut);
    }

    // ── Update wisps ────────────────────────────────────────────
    for (let i = 0; i < this.wisps.length; i++) {
      const w = this.wisps[i];
      w.life += w.lifeSpeed * dt;

      if (w.life >= 1) {
        this.wisps[i] = this.spawnWisp(false);
        continue;
      }

      w.x += w.speedX;
      w.y += w.speedY;
      w.rotation += w.rotationSpeed * dt;

      // Slow fade in/out
      const fadeIn = Math.min(1, w.life * 3);
      const fadeOut = Math.max(0, 1 - (w.life - 0.6) / 0.4);
      w.opacity = w.maxOpacity * fadeIn * fadeOut;
    }

    // ── Update candle glows ─────────────────────────────────────
    for (const c of this.candles) {
      c.phase += c.phaseSpeed * dt;
      c.breathePhase += c.breatheSpeed * dt;

      // Organic candle flicker — compound of two sine waves
      const flicker = 0.7 + 0.2 * Math.sin(c.phase) + 0.1 * Math.sin(c.phase * 2.7 + 1.3);
      c.opacity = c.baseOpacity * flicker;
      c.radius = c.baseRadius * (0.9 + 0.15 * Math.sin(c.breathePhase));
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    // ── Layer 1: Candle glow pools (bottom layer) ───────────────
    for (const c of this.candles) {
      if (c.opacity < 0.005) continue;
      const gradient = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.radius);
      gradient.addColorStop(0, `rgba(${c.r}, ${c.g}, ${c.b}, ${c.opacity})`);
      gradient.addColorStop(0.5, `rgba(${c.r}, ${c.g}, ${c.b}, ${c.opacity * 0.3})`);
      gradient.addColorStop(1, `rgba(${c.r}, ${c.g}, ${c.b}, 0)`);
      ctx.fillStyle = gradient;
      ctx.fillRect(c.x - c.radius, c.y - c.radius, c.radius * 2, c.radius * 2);
    }

    // ── Layer 2: Smoke wisps (mid layer) ────────────────────────
    for (const w of this.wisps) {
      if (w.opacity < 0.005) continue;
      ctx.save();
      ctx.globalAlpha = w.opacity;
      ctx.translate(w.x, w.y);
      ctx.rotate(w.rotation);
      const scale = w.size / 60;
      const drawSize = w.spriteSize * scale;
      ctx.drawImage(w.sprite, -drawSize * 0.5, -drawSize * 0.5, drawSize, drawSize);
      ctx.restore();
    }

    // ── Layer 3: Embers (top layer) ─────────────────────────────
    for (const e of this.embers) {
      if (e.opacity < 0.02) continue;
      const scale = e.size / this.config.sizeMax;
      const drawSize = e.spriteSize * scale;
      ctx.globalAlpha = e.opacity;
      ctx.drawImage(e.sprite, e.x - drawSize * 0.5, e.y - drawSize * 0.5, drawSize, drawSize);
    }
    ctx.globalAlpha = 1;
  }

  destroy(): void {
    this.embers = [];
    this.wisps = [];
    this.candles = [];
    this.emberSprites = [];
    this.smokeSprites = [];
  }
}
