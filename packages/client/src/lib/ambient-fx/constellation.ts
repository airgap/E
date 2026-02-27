/**
 * Constellation Effect — 1:1 port of lyku/ambient-fx ConstellationEffect
 *
 * Combines:
 * - Three-layer star system with twinkling (lyku constellation.ts)
 * - Nebulae with multi-lobe radial gradients (lyku constellation.ts)
 * - Spiral & elliptical galaxies (lyku constellation.ts)
 * - Constellation lines connecting bright stars (lyku constellation.ts)
 * - Celestial sphere placement with stereographic projection (lyku webgl/renderer.ts)
 * - Interactive pointer-reveal for constellation lines (lyku webgl/renderer.ts)
 * - Endless scroll rotation with no declination clamping (lyku webgl/renderer.ts)
 */
import type { AmbientEffect, AmbientThemeColors, ParticleConfig } from './types';

// ── Types ──────────────────────────────────────────────────────────────

interface Star {
  /** Right Ascension (0 to 2π) */
  ra: number;
  /** Declination (-π/2 to π/2) */
  dec: number;
  /** Screen position (computed each frame from projection) */
  screenX: number;
  screenY: number;
  visible: boolean;
  size: number;
  baseOpacity: number;
  opacity: number;
  r: number;
  g: number;
  b: number;
  twinklePhase: number;
  twinkleSpeed: number;
  /** 0 = background dim, 1 = medium, 2 = bright foreground */
  layer: number;
}

interface Nebula {
  ra: number;
  dec: number;
  screenX: number;
  screenY: number;
  visible: boolean;
  baseRadius: number; // In FOV units — scaled by projection
  r: number;
  g: number;
  b: number;
  opacity: number;
  lobes: Array<{
    offsetX: number;
    offsetY: number;
    radiusA: number;
    radiusB: number;
    rotation: number;
    intensity: number;
  }>;
}

interface Galaxy {
  ra: number;
  dec: number;
  screenX: number;
  screenY: number;
  visible: boolean;
  baseRadius: number;
  r: number;
  g: number;
  b: number;
  opacity: number;
  rotation: number;
  tilt: number;
  type: 'spiral' | 'elliptical';
  arms: number;
}

// ── Constants ──────────────────────────────────────────────────────────

const TWO_PI = Math.PI * 2;

/** Field of view in radians (~120°) */
const FOV = 2.1;

/** Scroll-to-declination rate — no clamping, endless rotation */
const SCROLL_TO_DEC_RATE = 0.0002;

/** Slow RA drift when idle (radians per ms of deltaTime) */
const RA_DRIFT_RATE = 0.00001;

/** Smooth interpolation factor (per frame) */
const VIEW_LERP = 0.25;

/** Max pixel distance for constellation line connections */
const CONNECTION_DISTANCE = 120;

/** Max number of constellation connections */
const MAX_CONNECTIONS = 30;

/** Radius around pointer where constellation lines reveal */
const REVEAL_RADIUS = 180;

// ── Helpers ────────────────────────────────────────────────────────────

function parseColor(color: string): { r: number; g: number; b: number } {
  const match = color.match(/rgba?\(([^)]+)\)/);
  if (match) {
    const parts = match[1].split(',').map((s) => parseFloat(s.trim()));
    return { r: parts[0], g: parts[1], b: parts[2] };
  }
  return { r: 255, g: 255, b: 255 };
}

function seededRandom(seed: number): () => number {
  return () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
}

/**
 * Stereographic projection from celestial coordinates to screen.
 * Identical math to lyku starCatalog.ts / webgl/renderer.ts
 */
function projectStar(
  starRa: number,
  starDec: number,
  centerRa: number,
  centerDec: number,
  scale: number,
): { x: number; y: number; visible: boolean } {
  const cosStarDec = Math.cos(starDec);
  const starX = cosStarDec * Math.cos(starRa);
  const starY = cosStarDec * Math.sin(starRa);
  const starZ = Math.sin(starDec);

  // Rotate so center is at positive X axis
  const cosRa = Math.cos(-centerRa);
  const sinRa = Math.sin(-centerRa);
  const x1 = starX * cosRa - starY * sinRa;
  const y1 = starX * sinRa + starY * cosRa;
  const z1 = starZ;

  const cosDec = Math.cos(-centerDec);
  const sinDec = Math.sin(-centerDec);
  const x2 = x1 * cosDec + z1 * sinDec;
  const y2 = y1;
  const z2 = -x1 * sinDec + z1 * cosDec;

  if (x2 <= 0.01) {
    return { x: 0, y: 0, visible: false };
  }

  const denom = 1 + x2;
  const projY = (2 * y2) / denom;
  const projZ = (2 * z2) / denom;

  return {
    x: projY * scale,
    y: -projZ * scale,
    visible: true,
  };
}

// ── Effect ─────────────────────────────────────────────────────────────

export class ConstellationEffect implements AmbientEffect {
  private stars: Star[] = [];
  private nebulae: Nebula[] = [];
  private galaxies: Galaxy[] = [];
  private connections: Array<[number, number]> = [];
  private width = 0;
  private height = 0;
  private startTime = 0;

  // Viewer orientation on celestial sphere
  private viewRa = Math.PI;
  private viewDec = 0.3;
  private targetViewDec = 0.3;

  // Scroll & pointer state
  private scrollOffset = 0;
  private pointerX = -1000;
  private pointerY = -1000;

  constructor(
    private config: ParticleConfig,
    private colors: AmbientThemeColors,
  ) {}

  // ── AmbientEffect interface ────────────────────────────────────────

  init(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.startTime = performance.now();

    this.initNebulae();
    this.initGalaxies();
    this.initStars();
    this.updateConnections();
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    // No star repositioning needed — sphere projection handles it
  }

  setScrollOffset(offset: number): void {
    this.scrollOffset = offset;
  }

  setPointerPosition(x: number, y: number): void {
    this.pointerX = x;
    this.pointerY = y;
  }

  update(deltaTime: number): void {
    const time = (performance.now() - this.startTime) * 0.001;

    // Scroll drives declination — endless, no clamping
    this.targetViewDec = 0.3 + this.scrollOffset * SCROLL_TO_DEC_RATE;

    // Smooth interpolation toward target (shortest path)
    let dDec = this.targetViewDec - this.viewDec;
    while (dDec > Math.PI) dDec -= TWO_PI;
    while (dDec < -Math.PI) dDec += TWO_PI;
    if (Math.abs(dDec) > 0.0001) {
      this.viewDec += dDec * VIEW_LERP;
    }

    // Slow RA drift for continuous motion
    this.viewRa += deltaTime * RA_DRIFT_RATE;
    if (this.viewRa > TWO_PI) this.viewRa -= TWO_PI;

    // Update star twinkling (from lyku constellation.ts)
    for (const star of this.stars) {
      const sinVal = Math.sin(time * star.twinkleSpeed + star.twinklePhase);
      const twinkleFactor = sinVal > 0 ? sinVal : sinVal * 0.3;
      star.opacity = star.baseOpacity * (0.3 + 0.7 * ((twinkleFactor + 1) / 2));
    }

    // Project all objects to screen positions
    this.projectAll();
    // Rebuild connections after projection
    this.updateConnections();
  }

  render(ctx: CanvasRenderingContext2D): void {
    // Draw nebulae (behind everything)
    this.renderNebulae(ctx);
    // Draw galaxies
    this.renderGalaxies(ctx);
    // Draw constellation lines (pointer reveal)
    this.renderConstellationLines(ctx);
    // Draw stars by layer
    this.renderStars(ctx);
  }

  destroy(): void {
    this.stars = [];
    this.nebulae = [];
    this.galaxies = [];
    this.connections = [];
  }

  // ── Initialization ─────────────────────────────────────────────────

  private initNebulae(): void {
    const colorOptions = [
      this.colors.particleColor1,
      this.colors.particleColor2,
      this.colors.particleColor3,
    ];

    // 4-6 nebulae scattered across the celestial sphere
    const nebulaCount = 4 + Math.floor(Math.random() * 3);
    this.nebulae = Array.from({ length: nebulaCount }, (_, i) => {
      const rng = seededRandom(i * 1337);
      const colorStr = colorOptions[i % colorOptions.length];
      const { r, g, b } = parseColor(colorStr);

      // Place on celestial sphere
      const u = rng();
      const v = rng();
      const ra = u * TWO_PI;
      const dec = Math.asin(2 * v - 1);

      // Lobes (from lyku constellation.ts)
      const lobeCount = 2 + Math.floor(rng() * 3);
      const baseRadius = 0.3 + rng() * 0.4; // FOV units
      const lobes = Array.from({ length: lobeCount }, () => ({
        offsetX: (rng() - 0.5) * baseRadius * 0.8,
        offsetY: (rng() - 0.5) * baseRadius * 0.8,
        radiusA: baseRadius * (0.6 + rng() * 0.6),
        radiusB: baseRadius * (0.4 + rng() * 0.5),
        rotation: rng() * Math.PI * 2,
        intensity: 0.6 + rng() * 0.4,
      }));

      return {
        ra,
        dec,
        screenX: 0,
        screenY: 0,
        visible: true,
        baseRadius,
        r,
        g,
        b,
        opacity: 0.08 + rng() * 0.08,
        lobes,
      };
    });
  }

  private initGalaxies(): void {
    const colorOptions = [
      this.colors.particleColor1,
      this.colors.particleColor2,
      this.colors.particleColor3,
    ];

    // 2-4 galaxies (from lyku constellation.ts)
    const galaxyCount = 2 + Math.floor(Math.random() * 3);
    this.galaxies = Array.from({ length: galaxyCount }, (_, i) => {
      const rng = seededRandom(i * 2749);
      const colorStr = colorOptions[i % colorOptions.length];
      const { r, g, b } = parseColor(colorStr);

      const u = rng();
      const v = rng();
      const ra = u * TWO_PI;
      const dec = Math.asin(2 * v - 1);

      return {
        ra,
        dec,
        screenX: 0,
        screenY: 0,
        visible: true,
        baseRadius: 0.04 + rng() * 0.06,
        r,
        g,
        b,
        opacity: 0.3 + rng() * 0.3,
        rotation: rng() * Math.PI * 2,
        tilt: rng() * 0.7,
        type: (rng() > 0.4 ? 'spiral' : 'elliptical') as 'spiral' | 'elliptical',
        arms: 2 + Math.floor(rng() * 3),
      };
    });
  }

  private initStars(): void {
    const colorOptions = [
      this.colors.particleColor1,
      this.colors.particleColor2,
      this.colors.particleColor3,
    ];

    const starCount = this.config.count;
    this.stars = [];

    // Fibonacci sphere for uniform distribution
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));

    // Layer 0: Background dim stars (40%) — from lyku constellation.ts
    const layer0Count = Math.floor(starCount * 0.4);
    for (let i = 0; i < layer0Count; i++) {
      const idx = i;
      const theta = goldenAngle * idx;
      const phi = Math.acos(1 - (2 * (idx + 0.5)) / starCount);
      const ra = ((theta % TWO_PI) + TWO_PI) % TWO_PI;
      const dec = Math.PI / 2 - phi;

      const colorStr = colorOptions[Math.floor(Math.random() * colorOptions.length)];
      const { r, g, b } = parseColor(colorStr);
      const baseOpacity = 0.2 + Math.random() * 0.3;

      this.stars.push({
        ra,
        dec,
        screenX: 0,
        screenY: 0,
        visible: false,
        size: 0.3 + Math.random() * 0.5,
        baseOpacity,
        opacity: baseOpacity,
        r,
        g,
        b,
        twinklePhase: Math.random() * TWO_PI,
        twinkleSpeed: 0.5 + Math.random() * 1.5,
        layer: 0,
      });
    }

    // Layer 1: Medium stars (40%)
    const layer1Count = Math.floor(starCount * 0.4);
    for (let i = 0; i < layer1Count; i++) {
      const idx = layer0Count + i;
      const theta = goldenAngle * idx;
      const phi = Math.acos(1 - (2 * (idx + 0.5)) / starCount);
      const ra = ((theta % TWO_PI) + TWO_PI) % TWO_PI;
      const dec = Math.PI / 2 - phi;

      const colorStr = colorOptions[Math.floor(Math.random() * colorOptions.length)];
      const { r, g, b } = parseColor(colorStr);
      const baseOpacity = 0.4 + Math.random() * 0.4;

      this.stars.push({
        ra,
        dec,
        screenX: 0,
        screenY: 0,
        visible: false,
        size: 0.5 + Math.random() * 1,
        baseOpacity,
        opacity: baseOpacity,
        r,
        g,
        b,
        twinklePhase: Math.random() * TWO_PI,
        twinkleSpeed: 1 + Math.random() * 2,
        layer: 1,
      });
    }

    // Layer 2: Bright foreground stars (20%)
    const layer2Count = starCount - layer0Count - layer1Count;
    for (let i = 0; i < layer2Count; i++) {
      const idx = layer0Count + layer1Count + i;
      const theta = goldenAngle * idx;
      const phi = Math.acos(1 - (2 * (idx + 0.5)) / starCount);
      const ra = ((theta % TWO_PI) + TWO_PI) % TWO_PI;
      const dec = Math.PI / 2 - phi;

      const colorStr = colorOptions[Math.floor(Math.random() * colorOptions.length)];
      const { r, g, b } = parseColor(colorStr);
      const baseOpacity = 0.7 + Math.random() * 0.3;

      this.stars.push({
        ra,
        dec,
        screenX: 0,
        screenY: 0,
        visible: false,
        size: 1 + Math.random() * 1.5,
        baseOpacity,
        opacity: baseOpacity,
        r,
        g,
        b,
        twinklePhase: Math.random() * TWO_PI,
        twinkleSpeed: 1.5 + Math.random() * 2.5,
        layer: 2,
      });
    }
  }

  // ── Projection ─────────────────────────────────────────────────────

  private projectAll(): void {
    const scale = Math.min(this.width, this.height) / FOV;
    const cx = this.width / 2;
    const cy = this.height / 2;

    // Project stars
    for (const star of this.stars) {
      const proj = projectStar(star.ra, star.dec, this.viewRa, this.viewDec, scale);
      star.screenX = cx + proj.x;
      star.screenY = cy + proj.y;
      star.visible = proj.visible;
    }

    // Project nebulae
    for (const nebula of this.nebulae) {
      const proj = projectStar(nebula.ra, nebula.dec, this.viewRa, this.viewDec, scale);
      nebula.screenX = cx + proj.x;
      nebula.screenY = cy + proj.y;
      nebula.visible = proj.visible;
    }

    // Project galaxies
    for (const galaxy of this.galaxies) {
      const proj = projectStar(galaxy.ra, galaxy.dec, this.viewRa, this.viewDec, scale);
      galaxy.screenX = cx + proj.x;
      galaxy.screenY = cy + proj.y;
      galaxy.visible = proj.visible;
    }
  }

  // ── Connections ────────────────────────────────────────────────────

  private updateConnections(): void {
    this.connections = [];
    // Only connect bright stars (layer 2) — from lyku constellation.ts
    const brightStars = this.stars.filter((s) => s.layer === 2 && s.visible);

    for (let i = 0; i < brightStars.length && this.connections.length < MAX_CONNECTIONS; i++) {
      for (
        let j = i + 1;
        j < brightStars.length && this.connections.length < MAX_CONNECTIONS;
        j++
      ) {
        const dx = brightStars[i].screenX - brightStars[j].screenX;
        const dy = brightStars[i].screenY - brightStars[j].screenY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < CONNECTION_DISTANCE) {
          const iIdx = this.stars.indexOf(brightStars[i]);
          const jIdx = this.stars.indexOf(brightStars[j]);
          this.connections.push([iIdx, jIdx]);
        }
      }
    }
  }

  // ── Rendering ──────────────────────────────────────────────────────

  private renderNebulae(ctx: CanvasRenderingContext2D): void {
    const scale = Math.min(this.width, this.height) / FOV;

    for (const nebula of this.nebulae) {
      if (!nebula.visible) continue;

      for (const lobe of nebula.lobes) {
        const lobeX = nebula.screenX + lobe.offsetX * scale;
        const lobeY = nebula.screenY + lobe.offsetY * scale;
        const maxLobeRadius = Math.max(lobe.radiusA, lobe.radiusB) * scale;
        const lobeOpacity = nebula.opacity * lobe.intensity;

        ctx.save();
        ctx.translate(lobeX, lobeY);
        ctx.rotate(lobe.rotation);
        ctx.scale(
          lobe.radiusA / Math.max(lobe.radiusA, lobe.radiusB),
          lobe.radiusB / Math.max(lobe.radiusA, lobe.radiusB),
        );

        try {
          const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, maxLobeRadius);
          gradient.addColorStop(0, `rgba(${nebula.r}, ${nebula.g}, ${nebula.b}, ${lobeOpacity})`);
          gradient.addColorStop(
            0.3,
            `rgba(${nebula.r}, ${nebula.g}, ${nebula.b}, ${lobeOpacity * 0.7})`,
          );
          gradient.addColorStop(
            0.6,
            `rgba(${nebula.r}, ${nebula.g}, ${nebula.b}, ${lobeOpacity * 0.3})`,
          );
          gradient.addColorStop(1, `rgba(${nebula.r}, ${nebula.g}, ${nebula.b}, 0)`);
          ctx.fillStyle = gradient;
        } catch {
          ctx.fillStyle = `rgba(${nebula.r}, ${nebula.g}, ${nebula.b}, ${lobeOpacity * 0.3})`;
        }

        ctx.beginPath();
        ctx.arc(0, 0, maxLobeRadius, 0, TWO_PI);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  private renderGalaxies(ctx: CanvasRenderingContext2D): void {
    const scale = Math.min(this.width, this.height) / FOV;

    for (const galaxy of this.galaxies) {
      if (!galaxy.visible) continue;

      const baseRadius = galaxy.baseRadius * scale;

      ctx.save();
      ctx.translate(galaxy.screenX, galaxy.screenY);
      ctx.rotate(galaxy.rotation);
      ctx.scale(1, 1 - galaxy.tilt * 0.85);

      if (galaxy.type === 'spiral') {
        // Outer halo
        try {
          const haloGradient = ctx.createRadialGradient(0, 0, 0, 0, 0, baseRadius * 1.2);
          haloGradient.addColorStop(
            0,
            `rgba(${galaxy.r}, ${galaxy.g}, ${galaxy.b}, ${galaxy.opacity * 0.4})`,
          );
          haloGradient.addColorStop(
            0.5,
            `rgba(${galaxy.r}, ${galaxy.g}, ${galaxy.b}, ${galaxy.opacity * 0.15})`,
          );
          haloGradient.addColorStop(1, `rgba(${galaxy.r}, ${galaxy.g}, ${galaxy.b}, 0)`);
          ctx.fillStyle = haloGradient;
        } catch {
          ctx.fillStyle = `rgba(${galaxy.r}, ${galaxy.g}, ${galaxy.b}, ${galaxy.opacity * 0.2})`;
        }
        ctx.beginPath();
        ctx.arc(0, 0, baseRadius * 1.2, 0, TWO_PI);
        ctx.fill();

        // Spiral arms
        for (let arm = 0; arm < galaxy.arms; arm++) {
          const armAngle = (arm / galaxy.arms) * TWO_PI;
          ctx.beginPath();
          let firstPoint = true;
          for (let t = 0; t <= 1; t += 0.02) {
            const spiralAngle = armAngle + t * Math.PI * 1.8;
            const r = baseRadius * (0.15 + t * 0.85);
            const x = Math.cos(spiralAngle) * r;
            const y = Math.sin(spiralAngle) * r;
            if (firstPoint) {
              ctx.moveTo(x, y);
              firstPoint = false;
            } else {
              ctx.lineTo(x, y);
            }
          }
          ctx.lineWidth = baseRadius * 0.1;
          ctx.strokeStyle = `rgba(${galaxy.r}, ${galaxy.g}, ${galaxy.b}, ${galaxy.opacity * 0.3})`;
          ctx.lineCap = 'round';
          ctx.stroke();
        }

        // Central bulge
        try {
          const bulgeGradient = ctx.createRadialGradient(0, 0, 0, 0, 0, baseRadius * 0.3);
          bulgeGradient.addColorStop(0, `rgba(255, 250, 240, ${galaxy.opacity * 0.8})`);
          bulgeGradient.addColorStop(
            0.3,
            `rgba(${galaxy.r}, ${galaxy.g}, ${galaxy.b}, ${galaxy.opacity * 0.6})`,
          );
          bulgeGradient.addColorStop(
            0.7,
            `rgba(${galaxy.r}, ${galaxy.g}, ${galaxy.b}, ${galaxy.opacity * 0.2})`,
          );
          bulgeGradient.addColorStop(1, `rgba(${galaxy.r}, ${galaxy.g}, ${galaxy.b}, 0)`);
          ctx.fillStyle = bulgeGradient;
        } catch {
          ctx.fillStyle = `rgba(255, 250, 240, ${galaxy.opacity * 0.5})`;
        }
        ctx.beginPath();
        ctx.arc(0, 0, baseRadius * 0.3, 0, TWO_PI);
        ctx.fill();
      } else {
        // Elliptical galaxy
        try {
          const ellipGradient = ctx.createRadialGradient(0, 0, 0, 0, 0, baseRadius);
          ellipGradient.addColorStop(0, `rgba(255, 250, 240, ${galaxy.opacity * 0.6})`);
          ellipGradient.addColorStop(
            0.15,
            `rgba(${galaxy.r}, ${galaxy.g}, ${galaxy.b}, ${galaxy.opacity * 0.5})`,
          );
          ellipGradient.addColorStop(
            0.4,
            `rgba(${galaxy.r}, ${galaxy.g}, ${galaxy.b}, ${galaxy.opacity * 0.25})`,
          );
          ellipGradient.addColorStop(
            0.7,
            `rgba(${galaxy.r}, ${galaxy.g}, ${galaxy.b}, ${galaxy.opacity * 0.08})`,
          );
          ellipGradient.addColorStop(1, `rgba(${galaxy.r}, ${galaxy.g}, ${galaxy.b}, 0)`);
          ctx.fillStyle = ellipGradient;
        } catch {
          ctx.fillStyle = `rgba(${galaxy.r}, ${galaxy.g}, ${galaxy.b}, ${galaxy.opacity * 0.3})`;
        }
        ctx.beginPath();
        ctx.arc(0, 0, baseRadius, 0, TWO_PI);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  private renderConstellationLines(ctx: CanvasRenderingContext2D): void {
    // Interactive reveal: lines only appear near pointer (from lyku webgl/renderer.ts)
    if (this.pointerX < 0) return;

    const { r: glowR, g: glowG, b: glowB } = parseColor(this.colors.glowColor);

    for (const [i, j] of this.connections) {
      const s1 = this.stars[i];
      const s2 = this.stars[j];
      if (!s1.visible || !s2.visible) continue;

      // Check distance from pointer to each star endpoint
      const dx1 = s1.screenX - this.pointerX;
      const dy1 = s1.screenY - this.pointerY;
      const dist1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);

      const dx2 = s2.screenX - this.pointerX;
      const dy2 = s2.screenY - this.pointerY;
      const dist2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

      // Only show line if either star is near pointer
      const nearPointer = dist1 < REVEAL_RADIUS || dist2 < REVEAL_RADIUS;
      if (!nearPointer) continue;

      const minDist = Math.min(dist1, dist2);
      const alpha = Math.max(0, (1 - minDist / REVEAL_RADIUS) * 0.8);
      if (alpha < 0.01) continue;

      // Distance-based alpha for the line itself
      const lineDx = s1.screenX - s2.screenX;
      const lineDy = s1.screenY - s2.screenY;
      const lineDist = Math.sqrt(lineDx * lineDx + lineDy * lineDy);
      const lineAlpha = (1 - lineDist / CONNECTION_DISTANCE) * 0.25;

      ctx.globalAlpha = Math.min(alpha, lineAlpha * 3);
      ctx.strokeStyle = `rgba(${glowR}, ${glowG}, ${glowB}, 0.6)`;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(s1.screenX, s1.screenY);
      ctx.lineTo(s2.screenX, s2.screenY);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private renderStars(ctx: CanvasRenderingContext2D): void {
    for (const star of this.stars) {
      if (!star.visible) continue;

      // Cull offscreen
      if (
        star.screenX < -10 ||
        star.screenX > this.width + 10 ||
        star.screenY < -10 ||
        star.screenY > this.height + 10
      )
        continue;

      // Pointer glow boost for bright stars near cursor (from lyku webgl/renderer.ts)
      let renderOpacity = star.opacity;
      let renderSize = star.size;
      if (star.layer === 2 && this.pointerX > 0) {
        const dx = star.screenX - this.pointerX;
        const dy = star.screenY - this.pointerY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < REVEAL_RADIUS) {
          const proximityFactor = 1 - dist / REVEAL_RADIUS;
          renderSize = star.size * (1 + proximityFactor * 0.5);
          renderOpacity = star.opacity + proximityFactor * (1 - star.opacity);
        }
      }

      ctx.globalAlpha = 1;

      // For stars large enough to glow, use a single radial gradient
      // that smoothly fades from bright core to transparent — no rings
      if (renderSize > 0.8) {
        const glowRadius = renderSize * 3;
        const gradient = ctx.createRadialGradient(
          star.screenX,
          star.screenY,
          0,
          star.screenX,
          star.screenY,
          glowRadius,
        );
        gradient.addColorStop(0, `rgba(${star.r}, ${star.g}, ${star.b}, ${renderOpacity})`);
        gradient.addColorStop(
          0.15,
          `rgba(${star.r}, ${star.g}, ${star.b}, ${renderOpacity * 0.7})`,
        );
        gradient.addColorStop(
          0.4,
          `rgba(${star.r}, ${star.g}, ${star.b}, ${renderOpacity * 0.15})`,
        );
        gradient.addColorStop(1, `rgba(${star.r}, ${star.g}, ${star.b}, 0)`);
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(star.screenX, star.screenY, glowRadius, 0, TWO_PI);
        ctx.fill();
      } else {
        // Tiny stars: just a dot, no gradient overhead
        ctx.fillStyle = `rgba(${star.r}, ${star.g}, ${star.b}, ${renderOpacity})`;
        ctx.beginPath();
        ctx.arc(star.screenX, star.screenY, renderSize, 0, TWO_PI);
        ctx.fill();
      }
    }

    ctx.globalAlpha = 1;
  }
}
