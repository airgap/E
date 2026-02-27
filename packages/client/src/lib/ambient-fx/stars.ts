/**
 * Stars Effect — 3D celestial sphere for Astral hypertheme
 *
 * Stars are distributed on a unit sphere and projected via stereographic
 * projection. Scrolling rotates the viewer's declination, creating the
 * effect of panning across the night sky. A slow RA drift provides
 * continuous subtle motion even when idle.
 *
 * Math adapted from lyku/ambient-fx starCatalog.ts stereographic projection.
 */
import type { AmbientEffect, AmbientThemeColors, ParticleConfig } from './types';

/** A star positioned on the celestial sphere */
interface Star {
  /** Right Ascension in radians (0 to 2π) — longitude on the sphere */
  ra: number;
  /** Declination in radians (-π/2 to π/2) — latitude on the sphere */
  dec: number;
  /** Rendered size in CSS pixels */
  size: number;
  r: number;
  g: number;
  b: number;
  baseOpacity: number;
  twinkleSpeed: number;
  twinklePhase: number;
}

const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI / 2;

/** Field of view in radians (~120°) */
const FOV = 2.1;

/** Scroll-to-declination conversion rate (radians per pixel) */
const SCROLL_TO_DEC_RATE = 0.0008;

/** Slow RA drift when idle (radians per millisecond) */
const RA_DRIFT_RATE = 0.00001;

/** Interpolation factor for smooth view transitions (per frame) */
const VIEW_LERP = 0.25;

function parseColor(color: string): { r: number; g: number; b: number } {
  const match = color.match(/rgba?\(([^)]+)\)/);
  if (match) {
    const parts = match[1].split(',').map((s) => parseFloat(s.trim()));
    return { r: parts[0], g: parts[1], b: parts[2] };
  }
  return { r: 200, g: 210, b: 230 };
}

/**
 * Stereographic projection from celestial coordinates to screen.
 * Projects a star on the unit sphere onto a tangent plane centered
 * at the viewer's current (centerRa, centerDec).
 */
function projectStar(
  starRa: number,
  starDec: number,
  centerRa: number,
  centerDec: number,
  scale: number,
): { x: number; y: number; visible: boolean } {
  // Convert star to 3D Cartesian on unit sphere
  const cosStarDec = Math.cos(starDec);
  const starX = cosStarDec * Math.cos(starRa);
  const starY = cosStarDec * Math.sin(starRa);
  const starZ = Math.sin(starDec);

  // Rotate so center is at positive X axis
  // First: rotate around Z axis by -centerRa
  const cosRa = Math.cos(-centerRa);
  const sinRa = Math.sin(-centerRa);
  const x1 = starX * cosRa - starY * sinRa;
  const y1 = starX * sinRa + starY * cosRa;
  const z1 = starZ;

  // Then: rotate around Y axis by -centerDec
  const cosDec = Math.cos(-centerDec);
  const sinDec = Math.sin(-centerDec);
  const x2 = x1 * cosDec + z1 * sinDec;
  const y2 = y1;
  const z2 = -x1 * sinDec + z1 * cosDec;

  // Stars behind the viewer are not visible
  if (x2 <= 0.01) {
    return { x: 0, y: 0, visible: false };
  }

  // Stereographic projection onto plane at x=1
  const denom = 1 + x2;
  const projY = (2 * y2) / denom;
  const projZ = (2 * z2) / denom;

  return {
    x: projY * scale,
    y: -projZ * scale, // Negate so north is up
    visible: true,
  };
}

export class StarsEffect implements AmbientEffect {
  private stars: Star[] = [];
  private width = 0;
  private height = 0;
  private time = 0;

  // Viewer orientation on the celestial sphere
  private viewRa = Math.PI; // Looking at ~12h RA
  private viewDec = 0.3; // Slightly above celestial equator
  private targetViewDec = 0.3;

  // Scroll state
  private scrollOffset = 0;

  // Cached twinkling opacities (avoid per-star allocation in render)
  private opacities: Float32Array = new Float32Array(0);

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

    // Distribute stars uniformly on the sphere
    // Using Fibonacci sphere distribution for even coverage
    const count = this.config.count;
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));

    this.stars = Array.from({ length: count }, (_, i) => {
      const colorStr = colorStrings[i % colorStrings.length];
      const { r, g, b } = parseColor(colorStr);

      // Fibonacci sphere: uniform distribution on unit sphere
      const theta = goldenAngle * i;
      const phi = Math.acos(1 - (2 * (i + 0.5)) / count);

      // Convert spherical (theta, phi) to celestial (ra, dec)
      const ra = ((theta % TWO_PI) + TWO_PI) % TWO_PI; // 0 to 2π
      const dec = HALF_PI - phi; // -π/2 to π/2

      return {
        ra,
        dec,
        size: this.config.sizeMin + Math.random() * (this.config.sizeMax - this.config.sizeMin),
        r,
        g,
        b,
        baseOpacity: 0.3 + Math.random() * 0.6,
        twinkleSpeed: 0.5 + Math.random() * 2.0,
        twinklePhase: Math.random() * TWO_PI,
      };
    });

    this.opacities = new Float32Array(count);
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    // No star repositioning needed — sphere projection handles it
  }

  setScrollOffset(offset: number): void {
    this.scrollOffset = offset;
  }

  update(deltaTime: number): void {
    this.time += deltaTime * 0.001;

    // Update target declination from scroll
    this.targetViewDec = 0.3 + this.scrollOffset * SCROLL_TO_DEC_RATE;

    // Clamp target declination to valid range
    this.targetViewDec = Math.max(-HALF_PI + 0.1, Math.min(HALF_PI - 0.1, this.targetViewDec));

    // Smooth interpolation toward target
    const dDec = this.targetViewDec - this.viewDec;
    if (Math.abs(dDec) > 0.0001) {
      this.viewDec += dDec * VIEW_LERP;
    }

    // Slow RA drift for continuous motion
    this.viewRa += deltaTime * RA_DRIFT_RATE;
    if (this.viewRa > TWO_PI) this.viewRa -= TWO_PI;

    // Update twinkling
    for (let i = 0; i < this.stars.length; i++) {
      const star = this.stars[i];
      const twinkle = Math.sin(this.time * star.twinkleSpeed + star.twinklePhase);
      // Asymmetric twinkle: brighter peaks, subtler dims
      const factor = twinkle > 0 ? twinkle : twinkle * 0.3;
      this.opacities[i] = star.baseOpacity * (0.3 + 0.7 * ((factor + 1) / 2));
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    const halfW = this.width / 2;
    const halfH = this.height / 2;
    const scale = Math.min(this.width, this.height) / FOV;

    for (let i = 0; i < this.stars.length; i++) {
      const star = this.stars[i];
      const opacity = this.opacities[i];
      if (opacity < 0.05) continue;

      const proj = projectStar(star.ra, star.dec, this.viewRa, this.viewDec, scale);
      if (!proj.visible) continue;

      // Offset to screen center
      const sx = halfW + proj.x;
      const sy = halfH + proj.y;

      // Cull offscreen
      if (sx < -10 || sx > this.width + 10 || sy < -10 || sy > this.height + 10) continue;

      // Draw glow for larger stars
      if (star.size > 1.5) {
        const glowRadius = star.size * 2.5;
        const gradient = ctx.createRadialGradient(sx, sy, 0, sx, sy, glowRadius);
        gradient.addColorStop(0, `rgba(${star.r}, ${star.g}, ${star.b}, ${opacity * 0.3})`);
        gradient.addColorStop(1, `rgba(${star.r}, ${star.g}, ${star.b}, 0)`);
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(sx, sy, glowRadius, 0, TWO_PI);
        ctx.fill();
      }

      // Draw star core
      ctx.fillStyle = `rgba(${star.r}, ${star.g}, ${star.b}, ${opacity})`;
      ctx.beginPath();
      ctx.arc(sx, sy, star.size, 0, TWO_PI);
      ctx.fill();
    }
  }

  destroy(): void {
    this.stars = [];
    this.opacities = new Float32Array(0);
  }
}
