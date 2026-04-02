/**
 * Grid Effect — Hyperfuture ambient visual
 *
 * Real-time 2D fluid simulation (Jos Stam's "Stable Fluids") rendered as a
 * discrete pixel grid with 1px gaps for an LED-matrix aesthetic.
 *
 * Inputs:
 *   - Device accelerometer/gyroscope → gravity direction
 *   - Pointer drag → velocity + dye injection
 *   - Random periodic impulses → keeps it alive at idle
 *
 * Performance: N=48 grid, 2 solver iterations, ImageData batch rendering.
 * Runs comfortably at 24fps on mobile.
 */

import type { AmbientEffect, AmbientThemeColors, ParticleConfig } from './types';

// ── Helpers ──────────────────────────────────────────────────────

function parseRgb(rgba: string): [number, number, number] {
  const m = rgba.match(/[\d.]+/g);
  if (!m || m.length < 3) return [0, 200, 255];
  return [Number(m[0]), Number(m[1]), Number(m[2])];
}

// ── Stable-fluid solver ──────────────────────────────────────────
// Inlined IX for hot loops — avoid function call overhead

function setBoundary(b: number, x: Float32Array, N: number): void {
  const s = N + 2;
  for (let i = 1; i <= N; i++) {
    x[0 + s * i] = b === 1 ? -x[1 + s * i] : x[1 + s * i];
    x[N + 1 + s * i] = b === 1 ? -x[N + s * i] : x[N + s * i];
    x[i + s * 0] = b === 2 ? -x[i + s * 1] : x[i + s * 1];
    x[i + s * (N + 1)] = b === 2 ? -x[i + s * N] : x[i + s * N];
  }
  x[0] = 0.5 * (x[1] + x[s]);
  x[0 + s * (N + 1)] = 0.5 * (x[1 + s * (N + 1)] + x[0 + s * N]);
  x[N + 1] = 0.5 * (x[N] + x[N + 1 + s]);
  x[N + 1 + s * (N + 1)] = 0.5 * (x[N + s * (N + 1)] + x[N + 1 + s * N]);
}

function linearSolve(
  b: number,
  x: Float32Array,
  x0: Float32Array,
  a: number,
  c: number,
  N: number,
  iter: number,
): void {
  const cRecip = 1 / c;
  const s = N + 2;
  for (let k = 0; k < iter; k++) {
    for (let j = 1; j <= N; j++) {
      const row = s * j;
      for (let i = 1; i <= N; i++) {
        const idx = i + row;
        x[idx] = (x0[idx] + a * (x[idx + 1] + x[idx - 1] + x[idx + s] + x[idx - s])) * cRecip;
      }
    }
    setBoundary(b, x, N);
  }
}

function diffuse(
  b: number,
  x: Float32Array,
  x0: Float32Array,
  diff: number,
  dt: number,
  N: number,
  iter: number,
): void {
  const a = dt * diff * N * N;
  linearSolve(b, x, x0, a, 1 + 4 * a, N, iter);
}

function advect(
  b: number,
  d: Float32Array,
  d0: Float32Array,
  vx: Float32Array,
  vy: Float32Array,
  dt: number,
  N: number,
): void {
  const dtN = dt * N;
  const s = N + 2;
  const nHalf = N + 0.5;

  for (let j = 1; j <= N; j++) {
    const row = s * j;
    for (let i = 1; i <= N; i++) {
      const idx = i + row;
      let x = i - dtN * vx[idx];
      let y = j - dtN * vy[idx];

      if (x < 0.5) x = 0.5;
      else if (x > nHalf) x = nHalf;
      if (y < 0.5) y = 0.5;
      else if (y > nHalf) y = nHalf;

      const i0 = x | 0;
      const j0 = y | 0;
      const s1 = x - i0;
      const s0 = 1 - s1;
      const t1 = y - j0;
      const t0 = 1 - t1;

      const row0 = s * j0;
      const row1 = row0 + s;
      d[idx] =
        s0 * (t0 * d0[i0 + row0] + t1 * d0[i0 + row1]) +
        s1 * (t0 * d0[i0 + 1 + row0] + t1 * d0[i0 + 1 + row1]);
    }
  }
  setBoundary(b, d, N);
}

function project(
  vx: Float32Array,
  vy: Float32Array,
  p: Float32Array,
  div: Float32Array,
  N: number,
  iter: number,
): void {
  const s = N + 2;
  const halfRecipN = -0.5 / N;
  const halfN = 0.5 * N;

  for (let j = 1; j <= N; j++) {
    const row = s * j;
    for (let i = 1; i <= N; i++) {
      const idx = i + row;
      div[idx] = halfRecipN * (vx[idx + 1] - vx[idx - 1] + vy[idx + s] - vy[idx - s]);
      p[idx] = 0;
    }
  }
  setBoundary(0, div, N);
  setBoundary(0, p, N);
  linearSolve(0, p, div, 1, 4, N, iter);

  for (let j = 1; j <= N; j++) {
    const row = s * j;
    for (let i = 1; i <= N; i++) {
      const idx = i + row;
      vx[idx] -= halfN * (p[idx + 1] - p[idx - 1]);
      vy[idx] -= halfN * (p[idx + s] - p[idx - s]);
    }
  }
  setBoundary(1, vx, N);
  setBoundary(2, vy, N);
}

// ── Main effect class ────────────────────────────────────────────

export class GridEffect implements AmbientEffect {
  private canvasW = 0;
  private canvasH = 0;

  private N = 0;
  private stride = 0;
  private size = 0;

  private Vx!: Float32Array;
  private Vy!: Float32Array;
  private Vx0!: Float32Array;
  private Vy0!: Float32Array;
  private density!: Float32Array;
  private density0!: Float32Array;
  private dye2!: Float32Array;
  private dye2_0!: Float32Array;

  private readonly diff = 0.00002;
  private readonly visc = 0.0000005;
  private readonly iter = 2; // 2 iterations is enough at N=48

  // Input
  private gravX = 0;
  private gravY = 0;
  private prevPtrX = -1;
  private prevPtrY = -1;
  private ptrX = -1;
  private ptrY = -1;
  private impulseTimer = 0;

  // Render buffer
  private imgData: ImageData | null = null;

  // Colors
  private c1: [number, number, number] = [0, 0, 0];
  private c2: [number, number, number] = [0, 0, 0];
  private c3: [number, number, number] = [0, 0, 0];

  constructor(
    private config: ParticleConfig,
    private colors: AmbientThemeColors,
  ) {}

  init(width: number, height: number): void {
    this.canvasW = width;
    this.canvasH = height;

    // Fixed small grid — sim resolution independent of canvas size
    this.N = 48;
    this.stride = this.N + 2;
    this.size = this.stride * this.stride;

    const alloc = () => new Float32Array(this.size);
    this.Vx = alloc();
    this.Vy = alloc();
    this.Vx0 = alloc();
    this.Vy0 = alloc();
    this.density = alloc();
    this.density0 = alloc();
    this.dye2 = alloc();
    this.dye2_0 = alloc();

    this.c1 = parseRgb(this.colors.particleColor1);
    this.c2 = parseRgb(this.colors.particleColor2);
    this.c3 = parseRgb(this.colors.particleColor3);

    // Pre-allocate ImageData at grid resolution (N×N pixels, upscaled by canvas)
    this.imgData = new ImageData(this.N, this.N);

    this.injectImpulse();
    this.injectImpulse();
    this.injectImpulse();
  }

  resize(width: number, height: number): void {
    this.canvasW = width;
    this.canvasH = height;
  }

  setScrollOffset(_offset: number): void {}

  setPointerPosition(x: number, y: number): void {
    this.prevPtrX = this.ptrX;
    this.prevPtrY = this.ptrY;
    this.ptrX = x;
    this.ptrY = y;
  }

  setDeviceMotion(ax: number, ay: number): void {
    this.gravX = ax * 2;
    this.gravY = ay * 2;
  }

  private injectImpulse(): void {
    const N = this.N;
    const s = this.stride;
    const cx = 4 + Math.floor(Math.random() * (N - 8));
    const cy = 4 + Math.floor(Math.random() * (N - 8));
    const r = 2 + Math.floor(Math.random() * 4);
    const angle = Math.random() * Math.PI * 2;
    const strength = 3 + Math.random() * 5;
    const dvx = Math.cos(angle) * strength;
    const dvy = Math.sin(angle) * strength;
    const useDye2 = Math.random() > 0.5;

    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > r * r) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 1 || nx > N || ny < 1 || ny > N) continue;
        const falloff = 1 - Math.sqrt(d2) / r;
        const idx = nx + s * ny;
        if (useDye2) this.dye2[idx] += falloff * 2;
        else this.density[idx] += falloff * 2;
        this.Vx[idx] += dvx * falloff;
        this.Vy[idx] += dvy * falloff;
      }
    }
  }

  update(deltaTime: number): void {
    const dt = Math.min(deltaTime / 1000, 0.05);
    const N = this.N;
    const it = this.iter;

    // Periodic impulses
    this.impulseTimer += deltaTime;
    if (this.impulseTimer > 900) {
      this.impulseTimer = 0;
      this.injectImpulse();
    }

    // Pointer drag
    if (
      this.ptrX >= 0 &&
      this.prevPtrX >= 0 &&
      (this.ptrX !== this.prevPtrX || this.ptrY !== this.prevPtrY)
    ) {
      const gx = Math.floor((this.ptrX / this.canvasW) * N) + 1;
      const gy = Math.floor((this.ptrY / this.canvasH) * N) + 1;
      const dx = this.ptrX - this.prevPtrX;
      const dy = this.ptrY - this.prevPtrY;
      const s = this.stride;

      for (let oy = -2; oy <= 2; oy++) {
        for (let ox = -2; ox <= 2; ox++) {
          const nx = gx + ox;
          const ny = gy + oy;
          if (nx < 1 || nx > N || ny < 1 || ny > N) continue;
          const idx = nx + s * ny;
          this.Vx[idx] += dx * 0.2;
          this.Vy[idx] += dy * 0.2;
          this.density[idx] += 0.5;
          this.dye2[idx] += 0.3;
        }
      }
    }

    // Device gravity
    if (this.gravX !== 0 || this.gravY !== 0) {
      const s = this.stride;
      const gx = this.gravX * dt;
      const gy = this.gravY * dt;
      for (let j = 1; j <= N; j++) {
        const row = s * j;
        for (let i = 1; i <= N; i++) {
          const idx = i + row;
          this.Vx[idx] += gx;
          this.Vy[idx] += gy;
        }
      }
    }

    // Velocity step
    diffuse(1, this.Vx0, this.Vx, this.visc, dt, N, it);
    diffuse(2, this.Vy0, this.Vy, this.visc, dt, N, it);
    project(this.Vx0, this.Vy0, this.Vx, this.Vy, N, it);
    advect(1, this.Vx, this.Vx0, this.Vx0, this.Vy0, dt, N);
    advect(2, this.Vy, this.Vy0, this.Vx0, this.Vy0, dt, N);
    project(this.Vx, this.Vy, this.Vx0, this.Vy0, N, it);

    // Density steps (two dye channels)
    diffuse(0, this.density0, this.density, this.diff, dt, N, it);
    advect(0, this.density, this.density0, this.Vx, this.Vy, dt, N);
    diffuse(0, this.dye2_0, this.dye2, this.diff, dt, N, it);
    advect(0, this.dye2, this.dye2_0, this.Vx, this.Vy, dt, N);

    // Global decay
    const decay = 1 - 0.4 * dt;
    for (let i = 0; i < this.size; i++) {
      this.density[i] *= decay;
      this.dye2[i] *= decay;
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    const N = this.N;
    const s = this.stride;
    const img = this.imgData;
    if (!img) return;
    const px = img.data;
    const maxA = this.config.opacity;
    const c1 = this.c1;
    const c2 = this.c2;
    const c3 = this.c3;

    // Write fluid state into ImageData (N×N pixels)
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const simIdx = i + 1 + s * (j + 1);
        const d1 = this.density[simIdx];
        const d2 = this.dye2[simIdx];
        const total = d1 + d2;

        const pxIdx = (j * N + i) * 4;

        if (total < 0.01) {
          px[pxIdx] = 0;
          px[pxIdx + 1] = 0;
          px[pxIdx + 2] = 0;
          px[pxIdx + 3] = 0;
          continue;
        }

        const t2 = d2 / (total + 0.001);
        const intensity = total > 1.5 ? 1.5 : total;
        const t1 = intensity > 1 ? 1 : intensity;

        const r = (1 - t2) * (c1[0] + (c3[0] - c1[0]) * t1) + t2 * c2[0];
        const g = (1 - t2) * (c1[1] + (c3[1] - c1[1]) * t1) + t2 * c2[1];
        const b = (1 - t2) * (c1[2] + (c3[2] - c1[2]) * t1) + t2 * c2[2];
        const a = (intensity > maxA ? maxA : intensity * maxA) * 255;

        px[pxIdx] = r;
        px[pxIdx + 1] = g;
        px[pxIdx + 2] = b;
        px[pxIdx + 3] = a;
      }
    }

    // Draw the N×N ImageData upscaled to fill the canvas with nearest-neighbor
    // (pixelated) interpolation for the LED-grid look
    ctx.save();
    ctx.imageSmoothingEnabled = false;

    // Put the tiny image onto a temporary canvas, then drawImage scaled up
    // We reuse a single-pixel putImageData + drawImage trick:
    // Actually, we can use createImageBitmap or just putImageData at 0,0
    // and drawImage the canvas onto itself — but simplest is an offscreen canvas.
    if (!this._offscreen || this._offscreen.width !== N) {
      this._offscreen = new OffscreenCanvas(N, N);
      this._offCtx = this._offscreen.getContext('2d')!;
    }
    this._offCtx!.putImageData(img, 0, 0);
    ctx.drawImage(this._offscreen!, 0, 0, this.canvasW, this.canvasH);
    ctx.restore();
  }

  // Offscreen buffer for upscaling
  private _offscreen: OffscreenCanvas | null = null;
  private _offCtx: OffscreenCanvasRenderingContext2D | null = null;

  destroy(): void {
    this.Vx = new Float32Array(0);
    this.Vy = new Float32Array(0);
    this.Vx0 = new Float32Array(0);
    this.Vy0 = new Float32Array(0);
    this.density = new Float32Array(0);
    this.density0 = new Float32Array(0);
    this.dye2 = new Float32Array(0);
    this.dye2_0 = new Float32Array(0);
    this.imgData = null;
    this._offscreen = null;
    this._offCtx = null;
  }
}
