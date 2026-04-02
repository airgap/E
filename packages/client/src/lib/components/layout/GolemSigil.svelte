<script lang="ts">
  /**
   * GolemSigil — deterministic geometric glyph derived from a golem name.
   *
   * Generates a unique SVG sigil by hashing the name into shape parameters:
   * outer frame (hexagon/circle/diamond), inner rays, rotation, and color hue.
   * Each golem gets a visually distinct identity mark.
   */

  interface Props {
    name: string;
    size?: number;
    active?: boolean;
  }

  let { name, size = 20, active = false }: Props = $props();

  /** Simple string hash → 32-bit unsigned int */
  function hash(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
    return h >>> 0;
  }

  /** Derive deterministic parameters from name */
  const params = $derived.by(() => {
    const h = hash(name);
    const bits = (offset: number, count: number) => (h >> offset) & ((1 << count) - 1);

    const hue = h % 360;
    const frameType = bits(8, 2); // 0=hex, 1=circle, 2=diamond, 3=octagon
    const rayCount = 3 + bits(10, 2); // 3-6 inner rays
    const rotation = bits(12, 4) * 22.5; // 0-337.5° in 22.5° steps
    const hasInnerDot = !!bits(16, 1);
    const hasRing = !!bits(17, 1);

    return { hue, frameType, rayCount, rotation, hasInnerDot, hasRing };
  });

  /** Generate outer frame path */
  const framePath = $derived.by(() => {
    const cx = 12,
      cy = 12,
      r = 10;
    switch (params.frameType) {
      case 0: // hexagon
        return polygon(cx, cy, r, 6);
      case 1: // circle
        return `M ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy}`;
      case 2: // diamond
        return polygon(cx, cy, r, 4);
      default: // octagon
        return polygon(cx, cy, r, 8);
    }
  });

  /** Generate regular polygon path */
  function polygon(cx: number, cy: number, r: number, sides: number): string {
    const pts: string[] = [];
    for (let i = 0; i < sides; i++) {
      const a = (Math.PI * 2 * i) / sides - Math.PI / 2;
      pts.push(`${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`);
    }
    return `M ${pts.join(' L ')} Z`;
  }

  /** Generate inner ray lines */
  const rays = $derived.by(() => {
    const lines: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    const cx = 12,
      cy = 12;
    for (let i = 0; i < params.rayCount; i++) {
      const a = (Math.PI * 2 * i) / params.rayCount;
      lines.push({
        x1: cx + 2 * Math.cos(a),
        y1: cy + 2 * Math.sin(a),
        x2: cx + 7 * Math.cos(a),
        y2: cy + 7 * Math.sin(a),
      });
    }
    return lines;
  });
</script>

<svg
  class="golem-sigil"
  class:active
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  xmlns="http://www.w3.org/2000/svg"
  style="--sigil-hue: {params.hue};"
>
  <g transform="rotate({params.rotation} 12 12)">
    <!-- Outer frame -->
    <path d={framePath} stroke="currentColor" stroke-width="1.2" fill="none" opacity="0.7" />

    <!-- Inner rays -->
    {#each rays as ray}
      <line
        x1={ray.x1}
        y1={ray.y1}
        x2={ray.x2}
        y2={ray.y2}
        stroke="currentColor"
        stroke-width="0.8"
        opacity="0.5"
      />
    {/each}

    <!-- Optional inner ring -->
    {#if params.hasRing}
      <circle
        cx="12"
        cy="12"
        r="4"
        stroke="currentColor"
        stroke-width="0.6"
        fill="none"
        opacity="0.4"
      />
    {/if}

    <!-- Optional center dot -->
    {#if params.hasInnerDot}
      <circle cx="12" cy="12" r="1.2" fill="currentColor" opacity="0.6" />
    {/if}
  </g>
</svg>

<style>
  .golem-sigil {
    color: var(--text-tertiary);
    transition: all var(--transition);
    flex-shrink: 0;
  }
  .golem-sigil:hover,
  .golem-sigil.active {
    color: var(--accent-primary);
    filter: drop-shadow(0 0 3px var(--accent-primary));
  }
</style>
