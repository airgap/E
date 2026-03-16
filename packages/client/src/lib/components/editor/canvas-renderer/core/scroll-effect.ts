/**
 * 3D scroll perspective effect.
 *
 * Lines in the focus zone (center ±15%) render flat at full opacity.
 * Lines in the taper zone (next 35% each side) progressively tilt,
 * shrink, and fade using cosine easing.
 *
 * Extracted from the original scroll-lens.ts CM plugin.
 */

// ── Tuning ──────────────────────────────────────────────────
const FOCUS = 0.7; // ±70% of half-height from center: flat (70% of viewport)
const TAPER = 0.3; // remaining 30% each side (15% of viewport): tilt
const MAX_ANGLE_DEG = 50;
const MAX_ANGLE = (MAX_ANGLE_DEG * Math.PI) / 180;

export interface ScrollTransform {
  scaleX: number;
  scaleY: number;
  opacity: number;
  /** Height multiplier for line spacing compression. */
  heightScale: number;
  /** Vertical shear factor — simulates rotateY on a cylindrical surface. */
  skew: number;
  /** True if the line is fully transparent and should be skipped. */
  skip: boolean;
}

/**
 * Compute the 3D scroll transform for a line at `lineMidY` in a
 * canvas of height `canvasH`.
 */
export function computeScrollEffect(lineMidY: number, canvasH: number): ScrollTransform {
  if (canvasH === 0)
    return { scaleX: 1, scaleY: 1, opacity: 1, heightScale: 1, skew: 0, skip: false };

  const midY = canvasH / 2;
  const halfH = canvasH / 2;

  // Normalized distance from center: −1 (top) … +1 (bottom)
  const n = (lineMidY - midY) / halfH;
  const a = Math.abs(n);

  let scale = 1;
  let opacity = 1;
  let angle = 0;

  if (a > FOCUS) {
    const t = Math.min(1, (a - FOCUS) / TAPER);
    const eased = (1 - Math.cos(t * Math.PI)) / 2;
    scale = 1 - eased * 0.4;
    opacity = 1 - eased * 0.65;
    angle = eased * MAX_ANGLE * Math.sign(n);
  }

  if (opacity < 0.03) {
    return { scaleX: 0, scaleY: 0, opacity: 0, heightScale: 0, skew: 0, skip: true };
  }

  // 3D projection: foreshorten vertically by cos(angle)
  const cosA = Math.cos(angle);
  const scaleX = scale;
  const scaleY = scale * Math.abs(cosA);

  // Line height compression — matches visual scaleY so lines pack tightly
  const heightScale = scaleY;

  // Vertical shear — simulates rotateY on a cylindrical surface.
  // sin(angle) gives the tangent-plane tilt; lines above center skew
  // one way, lines below the other, so the text appears to face outward
  // along the surface normal.
  const skew = Math.sin(angle) * 0.15;

  return { scaleX, scaleY, opacity, heightScale, skew, skip: false };
}
