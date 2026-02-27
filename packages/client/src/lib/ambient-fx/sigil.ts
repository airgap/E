/**
 * Sigil Effect — 3D magical circles with Elder Futhark runes
 * Adapted from lyku/ambient-fx for E's Arcane hypertheme
 *
 * Performance optimizations:
 * - Pre-renders all 24 rune glyphs to offscreen canvases at init time
 * - No shadowBlur (extremely expensive) — uses pre-baked glow via double-render
 * - Skips sigils/runes with very low alpha
 * - Batches ring segments into single path where possible
 */
import type { AmbientEffect, AmbientThemeColors } from './types';

interface SigilRing {
  radius: number;
  rotationSpeed: number;
  segments: number;
  style: 'solid' | 'dashed' | 'dotted';
}

interface SigilRune {
  angle: number;
  radius: number;
  symbol: number;
  wavePhase: number;
}

interface Sigil {
  x: number;
  y: number;
  z: number;
  size: number;
  rotation: number;
  tiltX: number;
  tiltY: number;
  rings: SigilRing[];
  runes: SigilRune[];
  r: number;
  g: number;
  b: number;
  opacity: number;
  pulsePhase: number;
  pulseSpeed: number;
  vx: number;
  vy: number;
  vz: number;
}

interface Fragment {
  x: number;
  y: number;
  z: number;
  type: 'arc' | 'rune';
  rotation: number;
  rotationSpeed: number;
  tiltX: number;
  tiltY: number;
  r: number;
  g: number;
  b: number;
  opacity: number;
  vx: number;
  vy: number;
  arcRadius?: number;
  arcStart?: number;
  arcEnd?: number;
  symbol?: number;
  runeSize?: number;
}

function parseColor(color: string): { r: number; g: number; b: number } {
  const match = color.match(/rgba?\(([^)]+)\)/);
  if (match) {
    const parts = match[1].split(',').map((s) => parseFloat(s.trim()));
    return { r: parts[0], g: parts[1], b: parts[2] };
  }
  return { r: 200, g: 150, b: 60 };
}

// Spell sequences for sigil rings — rune indices map to Elder Futhark
const SPELLS = [
  {
    name: 'ward',
    rings: [
      [14, 16, 2, 14, 8, 10, 14, 16, 2, 14, 8, 10, 14, 16, 2, 14],
      [2, 16, 14, 12, 8, 2, 16, 14],
    ],
  },
  {
    name: 'light',
    rings: [
      [15, 22, 5, 7, 0, 15, 22, 5, 7, 0, 15, 22, 5, 7, 0, 15, 22],
      [5, 15, 22, 7, 21, 5, 15, 22],
    ],
  },
  {
    name: 'strength',
    rings: [
      [1, 16, 15, 14, 2, 1, 16, 15, 14, 2, 1, 16, 15, 14, 2, 1, 16, 15],
      [16, 1, 15, 18, 14, 16, 1, 15, 18, 14, 16, 1],
      [1, 2, 16, 15, 1, 2, 16],
    ],
  },
  {
    name: 'wisdom',
    rings: [
      [3, 5, 19, 13, 22, 3, 5, 19, 13, 22, 3, 5, 19, 13, 22, 3, 5, 19],
      [19, 3, 5, 13, 12, 19, 3, 5, 13, 12, 19],
      [3, 13, 19, 5, 3, 13],
    ],
  },
  {
    name: 'prosperity',
    rings: [
      [0, 11, 23, 21, 6, 7, 0, 11, 23, 21, 6, 7, 0, 11, 23, 21, 6, 7, 0, 11],
      [0, 6, 21, 11, 23, 0, 6, 21, 11, 23, 0, 6, 21, 11],
      [11, 0, 23, 7, 21, 11, 0, 23, 7, 21],
      [0, 21, 11, 6, 0, 21],
    ],
  },
  {
    name: 'protection',
    rings: [
      [14, 2, 16, 10, 8, 12, 14, 2, 16, 10, 8, 12, 14, 2, 16, 10, 8, 12, 14, 2],
      [16, 14, 8, 2, 10, 16, 14, 8, 2, 10, 16, 14, 8, 2],
      [14, 12, 2, 8, 16, 14, 12, 2, 8, 16],
      [2, 14, 16, 2, 14, 16],
    ],
  },
];

const ARCHETYPES = [
  { rings: 2, sizeRange: [0.05, 0.08] as const, speedMult: 1.8 },
  { rings: 3, sizeRange: [0.08, 0.12] as const, speedMult: 1.0 },
  { rings: 4, sizeRange: [0.1, 0.15] as const, speedMult: 0.7 },
  { rings: 5, sizeRange: [0.14, 0.2] as const, speedMult: 0.4 },
];

/**
 * Pre-render a single Elder Futhark rune to a Path2D.
 * This avoids calling moveTo/lineTo hundreds of times per frame.
 */
function createRunePath(runeIndex: number, size: number): Path2D {
  const path = new Path2D();
  const s = size;

  switch (runeIndex % 24) {
    case 0: // ᚠ Fehu
      path.moveTo(0, s);
      path.lineTo(0, -s);
      path.moveTo(0, -s);
      path.lineTo(s * 0.6, -s * 0.4);
      path.moveTo(0, -s * 0.2);
      path.lineTo(s * 0.6, s * 0.2);
      break;
    case 1: // ᚢ Uruz
      path.moveTo(-s * 0.3, s);
      path.lineTo(-s * 0.3, -s);
      path.lineTo(s * 0.3, -s * 0.2);
      path.lineTo(s * 0.3, s);
      break;
    case 2: // ᚦ Thurisaz
      path.moveTo(0, s);
      path.lineTo(0, -s);
      path.moveTo(0, -s);
      path.lineTo(s * 0.5, -s * 0.4);
      path.lineTo(0, s * 0.1);
      break;
    case 3: // ᚨ Ansuz
      path.moveTo(0, s);
      path.lineTo(0, -s);
      path.moveTo(0, -s * 0.6);
      path.lineTo(s * 0.5, -s * 0.2);
      path.moveTo(0, -s * 0.1);
      path.lineTo(s * 0.5, s * 0.3);
      break;
    case 4: // ᚱ Raidho
      path.moveTo(-s * 0.2, s);
      path.lineTo(-s * 0.2, -s);
      path.moveTo(-s * 0.2, -s);
      path.lineTo(s * 0.4, -s * 0.4);
      path.lineTo(-s * 0.2, s * 0.1);
      path.moveTo(-s * 0.2, s * 0.1);
      path.lineTo(s * 0.4, s);
      break;
    case 5: // ᚲ Kenaz
      path.moveTo(-s * 0.3, -s);
      path.lineTo(s * 0.3, 0);
      path.lineTo(-s * 0.3, s);
      break;
    case 6: // ᚷ Gebo
      path.moveTo(-s * 0.5, -s * 0.7);
      path.lineTo(s * 0.5, s * 0.7);
      path.moveTo(s * 0.5, -s * 0.7);
      path.lineTo(-s * 0.5, s * 0.7);
      break;
    case 7: // ᚹ Wunjo
      path.moveTo(-s * 0.2, s);
      path.lineTo(-s * 0.2, -s);
      path.moveTo(-s * 0.2, -s);
      path.lineTo(s * 0.4, -s * 0.3);
      path.lineTo(-s * 0.2, s * 0.3);
      break;
    case 8: // ᚺ Hagalaz
      path.moveTo(-s * 0.4, -s);
      path.lineTo(-s * 0.4, s);
      path.moveTo(s * 0.4, -s);
      path.lineTo(s * 0.4, s);
      path.moveTo(-s * 0.4, s * 0.1);
      path.lineTo(s * 0.4, -s * 0.4);
      break;
    case 9: // ᚾ Nauthiz
      path.moveTo(0, -s);
      path.lineTo(0, s);
      path.moveTo(-s * 0.4, -s * 0.2);
      path.lineTo(s * 0.4, s * 0.2);
      break;
    case 10: // ᛁ Isa
      path.moveTo(0, -s);
      path.lineTo(0, s);
      break;
    case 11: // ᛃ Jera
      path.moveTo(s * 0.1, -s);
      path.lineTo(s * 0.4, -s * 0.4);
      path.lineTo(s * 0.1, 0);
      path.moveTo(-s * 0.1, s);
      path.lineTo(-s * 0.4, s * 0.4);
      path.lineTo(-s * 0.1, 0);
      break;
    case 12: // ᛇ Eihwaz
      path.moveTo(0, -s);
      path.lineTo(0, s);
      path.moveTo(0, -s * 0.5);
      path.lineTo(s * 0.4, -s * 0.8);
      path.moveTo(0, s * 0.5);
      path.lineTo(-s * 0.4, s * 0.8);
      break;
    case 13: // ᛈ Perthro
      path.moveTo(-s * 0.3, s);
      path.lineTo(-s * 0.3, -s);
      path.moveTo(-s * 0.3, -s);
      path.lineTo(s * 0.3, -s * 0.4);
      path.moveTo(-s * 0.3, s);
      path.lineTo(s * 0.3, s * 0.4);
      break;
    case 14: // ᛉ Algiz
      path.moveTo(0, s);
      path.lineTo(0, -s * 0.2);
      path.moveTo(0, -s * 0.2);
      path.lineTo(-s * 0.5, -s);
      path.moveTo(0, -s * 0.2);
      path.lineTo(s * 0.5, -s);
      path.moveTo(0, -s * 0.2);
      path.lineTo(0, -s);
      break;
    case 15: // ᛊ Sowilo
      path.moveTo(-s * 0.4, -s);
      path.lineTo(s * 0.1, -s * 0.2);
      path.lineTo(-s * 0.1, s * 0.2);
      path.lineTo(s * 0.4, s);
      break;
    case 16: // ᛏ Tiwaz
      path.moveTo(0, s);
      path.lineTo(0, -s);
      path.moveTo(-s * 0.5, -s);
      path.lineTo(0, -s * 0.4);
      path.lineTo(s * 0.5, -s);
      break;
    case 17: // ᛒ Berkano
      path.moveTo(-s * 0.2, s);
      path.lineTo(-s * 0.2, -s);
      path.moveTo(-s * 0.2, -s);
      path.lineTo(s * 0.3, -s * 0.5);
      path.lineTo(-s * 0.2, 0);
      path.moveTo(-s * 0.2, 0);
      path.lineTo(s * 0.3, s * 0.5);
      path.lineTo(-s * 0.2, s);
      break;
    case 18: // ᛖ Ehwaz
      path.moveTo(-s * 0.3, s);
      path.lineTo(-s * 0.3, -s);
      path.moveTo(s * 0.3, s);
      path.lineTo(s * 0.3, -s);
      path.moveTo(-s * 0.3, 0);
      path.lineTo(s * 0.3, -s * 0.4);
      path.moveTo(-s * 0.3, s * 0.4);
      path.lineTo(s * 0.3, 0);
      break;
    case 19: // ᛗ Mannaz
      path.moveTo(-s * 0.4, s);
      path.lineTo(-s * 0.4, -s);
      path.lineTo(0, -s * 0.3);
      path.lineTo(s * 0.4, -s);
      path.lineTo(s * 0.4, s);
      path.moveTo(-s * 0.4, -s * 0.3);
      path.lineTo(0, s * 0.1);
      path.lineTo(s * 0.4, -s * 0.3);
      break;
    case 20: // ᛚ Laguz
      path.moveTo(-s * 0.2, s);
      path.lineTo(-s * 0.2, -s);
      path.lineTo(s * 0.4, -s * 0.3);
      break;
    case 21: // ᛝ Ingwaz
      path.moveTo(0, -s * 0.7);
      path.lineTo(s * 0.5, 0);
      path.lineTo(0, s * 0.7);
      path.lineTo(-s * 0.5, 0);
      path.closePath();
      break;
    case 22: // ᛞ Dagaz
      path.moveTo(-s * 0.4, -s * 0.7);
      path.lineTo(s * 0.4, -s * 0.7);
      path.lineTo(-s * 0.4, s * 0.7);
      path.lineTo(s * 0.4, s * 0.7);
      break;
    case 23: // ᛟ Othala
      path.moveTo(-s * 0.4, s);
      path.lineTo(-s * 0.4, s * 0.1);
      path.lineTo(0, -s * 0.7);
      path.lineTo(s * 0.4, s * 0.1);
      path.lineTo(s * 0.4, s);
      path.moveTo(-s * 0.4, s * 0.1);
      path.lineTo(s * 0.4, s * 0.1);
      break;
  }
  return path;
}

/**
 * Pre-rendered rune sprite — an offscreen canvas with a rune drawn on it.
 * We create one per color per rune index at a fixed size, then drawImage()
 * with scaling at render time, which is FAR cheaper than stroking paths.
 */
interface RuneSprite {
  canvas: OffscreenCanvas;
  size: number; // logical size of the rune within the sprite
}

const SPRITE_SIZE = 32; // Runes are rendered at this base size
const SPRITE_PAD = 8; // Padding for glow bleed

function createRuneSprite(runeIndex: number, r: number, g: number, b: number): RuneSprite {
  const dim = (SPRITE_SIZE + SPRITE_PAD) * 2;
  const oc = new OffscreenCanvas(dim, dim);
  const octx = oc.getContext('2d')!;
  const path = createRunePath(runeIndex, SPRITE_SIZE);

  octx.translate(dim / 2, dim / 2);
  octx.lineCap = 'round';
  octx.lineJoin = 'round';

  // Render a faint wider stroke underneath for glow effect (replaces shadowBlur)
  octx.lineWidth = 3.5;
  octx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.3)`;
  octx.stroke(path);

  // Main crisp stroke on top
  octx.lineWidth = 1.4;
  octx.strokeStyle = `rgba(${r}, ${g}, ${b}, 1)`;
  octx.stroke(path);

  return { canvas: oc, size: SPRITE_SIZE };
}

/**
 * Sigil Effect — 3D magical circles with rotating runes
 */
export class SigilEffect implements AmbientEffect {
  private sigils: Sigil[] = [];
  private fragments: Fragment[] = [];
  private width = 0;
  private height = 0;
  private lineWidth = 1;
  private startTime = 0;
  private scrollOffset = 0;

  // Pre-rendered rune sprites per color
  private runeSprites: Map<string, RuneSprite[]> = new Map();
  // Pre-computed rune Path2Ds for fragment rendering (less frequent, can afford stroke)
  private runePaths: Path2D[] = [];

  constructor(
    private config: { count: number },
    private colors: AmbientThemeColors,
  ) {}

  init(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.startTime = performance.now();
    this.lineWidth = 1.5;

    const minDim = Math.min(width, height);
    const sigilCount = this.config.count;

    const colorStrings = [
      this.colors.particleColor1,
      this.colors.particleColor2,
      this.colors.particleColor3,
    ];

    // Pre-render all 24 rune glyphs for each color
    this.runeSprites.clear();
    for (const cs of colorStrings) {
      const { r, g, b } = parseColor(cs);
      const key = `${r},${g},${b}`;
      if (!this.runeSprites.has(key)) {
        const sprites: RuneSprite[] = [];
        for (let i = 0; i < 24; i++) {
          sprites.push(createRuneSprite(i, r, g, b));
        }
        this.runeSprites.set(key, sprites);
      }
    }

    // Pre-compute Path2D for all 24 runes (used for fragments)
    this.runePaths = [];
    for (let i = 0; i < 24; i++) {
      this.runePaths.push(createRunePath(i, 1)); // unit size, scale at render
    }

    const spellsByRings: Record<number, typeof SPELLS> = {};
    for (const spell of SPELLS) {
      const ringCount = spell.rings.length;
      if (!spellsByRings[ringCount]) spellsByRings[ringCount] = [];
      spellsByRings[ringCount].push(spell);
    }

    this.sigils = Array.from({ length: sigilCount }, (_, i) => {
      const archetype = ARCHETYPES[i % ARCHETYPES.length];
      const numRings = archetype.rings;
      const [sizeMin, sizeMax] = archetype.sizeRange;
      const size = minDim * (sizeMin + Math.random() * (sizeMax - sizeMin));

      const baseSegments = numRings <= 2 ? 6 : numRings <= 4 ? 8 : 12;

      const rings: SigilRing[] = Array.from({ length: numRings }, (_, j) => ({
        radius: numRings === 1 ? 0.8 : 0.25 + (j / (numRings - 1)) * 0.7,
        rotationSpeed: 0.005 * archetype.speedMult * (j % 2 === 0 ? 1 : -1) * (1 + j * 0.15),
        segments: baseSegments * (j % 2 === 0 ? 1 : 2),
        style: (['solid', 'dashed', 'dotted'] as const)[j % 3],
      }));

      let spell = SPELLS[i % SPELLS.length];
      for (let r = numRings; r >= 2; r--) {
        if (spellsByRings[r] && spellsByRings[r].length > 0) {
          spell = spellsByRings[r][i % spellsByRings[r].length];
          break;
        }
      }

      const runes: SigilRune[] = [];
      for (let gap = 0; gap < Math.min(numRings, spell.rings.length); gap++) {
        const innerRingRadius = gap === 0 ? 0 : rings[gap - 1].radius;
        const outerRingRadius = rings[gap].radius;
        const midRadius = (innerRingRadius + outerRingRadius) / 2;

        const spellRingIdx = spell.rings.length - 1 - gap;
        const ringRunes = spell.rings[spellRingIdx] || spell.rings[0];

        const ringDepth = gap / Math.max(1, numRings - 1);
        const wordSizes =
          ringDepth < 0.3 ? [1, 2, 1, 2, 1] : ringDepth < 0.6 ? [2, 3, 2, 2, 3] : [3, 4, 5, 3, 4];

        let runeIdx = 0;
        let wordIdx = 0;
        const totalRunes = ringRunes.length;

        const words: number[][] = [];
        while (runeIdx < totalRunes) {
          const wordSize = Math.min(wordSizes[wordIdx % wordSizes.length], totalRunes - runeIdx);
          words.push(ringRunes.slice(runeIdx, runeIdx + wordSize));
          runeIdx += wordSize;
          wordIdx++;
        }

        const wordGap = 0.08;
        const totalGapSpace = wordGap * words.length;
        const runeSpace = (1 - totalGapSpace) / totalRunes;

        let currentAngle = 0;
        for (const word of words) {
          for (let r = 0; r < word.length; r++) {
            const angle = currentAngle * Math.PI * 2;
            const wavePhase = gap * 0.8 + angle * 0.5;
            runes.push({ angle, radius: midRadius, symbol: word[r], wavePhase });
            currentAngle += runeSpace;
          }
          currentAngle += wordGap;
        }
      }

      const z = 0.2 + Math.random() * 0.7;

      // Grid-based spacing with jitter
      const gridCols = Math.ceil(Math.sqrt((sigilCount * width) / height));
      const gridRows = Math.ceil(sigilCount / gridCols);
      const cellW = width / gridCols;
      const cellH = height / gridRows;
      const gridX = (i % gridCols) * cellW + cellW / 2;
      const gridY = Math.floor(i / gridCols) * cellH + cellH / 2;
      const jitterX = (Math.random() - 0.5) * cellW * 0.8;
      const jitterY = (Math.random() - 0.5) * cellH * 0.8;

      const colorStr = colorStrings[i % colorStrings.length];
      const { r, g, b } = parseColor(colorStr);

      return {
        x: gridX + jitterX,
        y: gridY + jitterY,
        z,
        size,
        rotation: Math.random() * Math.PI * 2,
        tiltX: 0,
        tiltY: 0,
        rings,
        runes,
        r,
        g,
        b,
        opacity: 0.5 + z * 0.4,
        pulsePhase: (i / sigilCount) * Math.PI * 2,
        pulseSpeed: 0.15 + 0.55 * (1 - (size / minDim - 0.04) / 0.16),
        vx: (Math.random() - 0.5) * 0.3 * archetype.speedMult,
        vy: (Math.random() - 0.5) * 0.3 * archetype.speedMult,
        vz: (Math.random() - 0.5) * 0.002,
      };
    });

    // Create fragments — broken sigil pieces
    const fragmentCount = Math.floor(sigilCount * 0.5);
    this.fragments = Array.from({ length: fragmentCount }, (_, i) => {
      const isArc = Math.random() > 0.4;
      const z = 0.1 + Math.random() * 0.8;
      const colorStr = colorStrings[i % colorStrings.length];
      const { r, g, b } = parseColor(colorStr);

      const fragment: Fragment = {
        x: Math.random() * width,
        y: Math.random() * height,
        z,
        type: isArc ? 'arc' : 'rune',
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 0.008,
        tiltX: 0,
        tiltY: 0,
        r,
        g,
        b,
        opacity: 0.35 + z * 0.3,
        vx: (Math.random() - 0.5) * 0.2,
        vy: (Math.random() - 0.5) * 0.2,
      };

      if (isArc) {
        fragment.arcRadius = minDim * (0.015 + Math.random() * 0.04);
        const arcLength = (0.08 + Math.random() * 0.17) * Math.PI * 2;
        fragment.arcStart = Math.random() * Math.PI * 2;
        fragment.arcEnd = fragment.arcStart + arcLength;
      } else {
        fragment.symbol = Math.floor(Math.random() * 24);
        fragment.runeSize = minDim * (0.008 + Math.random() * 0.015);
      }

      return fragment;
    });
  }

  resize(width: number, height: number): void {
    const scaleX = width / this.width;
    const scaleY = height / this.height;
    this.width = width;
    this.height = height;
    for (const s of this.sigils) {
      s.x *= scaleX;
      s.y *= scaleY;
    }
    for (const f of this.fragments) {
      f.x *= scaleX;
      f.y *= scaleY;
    }
  }

  update(deltaTime: number): void {
    this.scrollOffset += deltaTime * 0.01;

    for (const sigil of this.sigils) {
      sigil.x += sigil.vx;
      sigil.y += sigil.vy;
      sigil.z += sigil.vz;

      const buffer = sigil.size;
      if (sigil.x < -buffer) sigil.x = this.width + buffer;
      if (sigil.x > this.width + buffer) sigil.x = -buffer;
      if (sigil.y < -buffer) sigil.y = this.height + buffer;
      if (sigil.y > this.height + buffer) sigil.y = -buffer;

      if (sigil.z < 0.15) {
        sigil.z = 0.15;
        sigil.vz *= -1;
      }
      if (sigil.z > 0.85) {
        sigil.z = 0.85;
        sigil.vz *= -1;
      }
    }

    for (const frag of this.fragments) {
      frag.x += frag.vx;
      frag.y += frag.vy;
      frag.rotation += frag.rotationSpeed;

      if (frag.x < -50) frag.x = this.width + 50;
      if (frag.x > this.width + 50) frag.x = -50;
      if (frag.y < -50) frag.y = this.height + 50;
      if (frag.y > this.height + 50) frag.y = -50;
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    const time = (performance.now() - this.startTime) * 0.001;

    // NO shadowBlur — glow is baked into the pre-rendered rune sprites
    ctx.shadowBlur = 0;

    for (const sigil of this.sigils) {
      const { r, g, b } = sigil;
      const depthScale = 0.5 + sigil.z * 0.5;
      const depthAlpha = 0.5 + sigil.z * 0.5;
      const parallaxY = this.scrollOffset * (0.0005 + sigil.z * 0.006);
      const pulse = 0.85 + Math.sin(time * sigil.pulseSpeed + sigil.pulsePhase) * 0.15;
      const alpha = Math.min(1, sigil.opacity * pulse * depthAlpha);

      // Skip very faint sigils entirely
      if (alpha < 0.03) continue;

      const scaledSize = sigil.size * depthScale;

      ctx.save();
      ctx.translate(sigil.x, sigil.y - (parallaxY % this.height));
      ctx.globalAlpha = alpha;

      const tiltFactor = Math.cos(sigil.tiltX);

      // Trace alpha helper — rotating highlight
      const traceWidth = Math.PI * 0.7;
      const getTraceAlpha = (angle: number, tracePos: number) => {
        let angleDiff = angle - tracePos;
        if (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        else if (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        if (angleDiff <= 0 && angleDiff > -traceWidth) return 1 + angleDiff / traceWidth;
        if (angleDiff > 0 && angleDiff < 0.25) return 0.3 * (1 - angleDiff / 0.25);
        return 0;
      };

      // Draw rings — batch segments into fewer strokes
      for (let ri = 0; ri < sigil.rings.length; ri++) {
        const ring = sigil.rings[ri];
        const ringRadius = ring.radius * scaledSize;
        const traceSpeed = 1.5 / (0.5 + ring.radius);
        const tracePos = (time * traceSpeed + ri * 0.8) % (Math.PI * 2);

        ctx.save();
        ctx.scale(1, Math.max(0.25, Math.abs(tiltFactor)));
        ctx.rotate(sigil.tiltY);
        ctx.lineWidth = this.lineWidth * depthScale;

        const segments = ring.segments;
        for (let s = 0; s < segments; s++) {
          const startAngle = (s / segments) * Math.PI * 2;
          const endAngle = ((s + 0.7) / segments) * Math.PI * 2;
          const midAngle = (startAngle + endAngle) / 2;
          const segAlpha = getTraceAlpha(midAngle, tracePos);
          if (segAlpha < 0.05) continue;

          ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${0.8 * segAlpha})`;
          ctx.beginPath();
          ctx.arc(0, 0, ringRadius, startAngle, endAngle);
          ctx.stroke();
        }

        ctx.restore();
      }

      // Draw runes using pre-rendered sprites (massive perf win)
      ctx.save();
      ctx.scale(1, Math.max(0.25, Math.abs(tiltFactor)));
      const diskRotation = time * 0.08;
      ctx.rotate(diskRotation + sigil.tiltY);

      const spriteKey = `${r},${g},${b}`;
      const sprites = this.runeSprites.get(spriteKey);

      if (sprites) {
        for (const rune of sigil.runes) {
          const traceSpeed = 1.5 / (0.5 + rune.radius);
          const ringIndex = Math.round(rune.radius * (sigil.rings.length - 1));
          const tracePos = (time * traceSpeed + ringIndex * 0.8) % (Math.PI * 2);
          const traceAlpha = getTraceAlpha(rune.angle, tracePos);
          if (traceAlpha < 0.05) continue;

          const localX = Math.cos(rune.angle) * rune.radius * scaledSize;
          const localY = Math.sin(rune.angle) * rune.radius * scaledSize;

          ctx.save();
          ctx.translate(localX, localY);
          ctx.rotate(rune.angle + Math.PI / 2);
          ctx.globalAlpha = alpha * 0.9 * traceAlpha;

          const traceScale = 0.9 + traceAlpha * 0.3;
          const runeSize = scaledSize * 0.05 * traceScale;
          const scale = runeSize / SPRITE_SIZE;
          const sprite = sprites[rune.symbol % 24];
          const dim = (SPRITE_SIZE + SPRITE_PAD) * 2;

          // drawImage from offscreen canvas — hardware accelerated
          ctx.drawImage(
            sprite.canvas,
            -dim * scale * 0.5,
            -dim * scale * 0.5,
            dim * scale,
            dim * scale,
          );

          ctx.restore();
        }
      }

      ctx.restore();
      ctx.restore();
    }

    // Render floating fragments (fewer of these, can afford simple strokes)
    ctx.globalAlpha = 1;
    for (let fi = 0; fi < this.fragments.length; fi++) {
      const frag = this.fragments[fi];

      // Deterministic flicker (no Math.random() per frame)
      const flickerSeed = fi * 7.31;
      const flickerCycle = time * 0.5 + flickerSeed;
      const flickerChance =
        Math.sin(flickerCycle * 3.7) * Math.sin(flickerCycle * 5.3) * Math.sin(flickerCycle * 2.1);
      if (flickerChance > 0.85) continue; // Skip flickered-out fragments

      const { r: fr, g: fg, b: fb } = frag;
      const depthScale = 0.5 + frag.z * 0.5;
      const depthAlpha = 0.4 + frag.z * 0.6;
      const tiltFactor = Math.cos(frag.tiltX) * Math.cos(frag.tiltY);
      const fragParallaxY = this.scrollOffset * (0.0003 + frag.z * 0.004);

      const fragAlpha = Math.min(
        1,
        frag.opacity * depthAlpha * Math.max(0.2, Math.abs(tiltFactor)),
      );
      if (fragAlpha < 0.03) continue;

      ctx.save();
      ctx.translate(frag.x, frag.y - (fragParallaxY % this.height));
      ctx.rotate(frag.rotation);
      ctx.scale(depthScale, depthScale * Math.max(0.3, Math.abs(tiltFactor)));
      ctx.lineWidth = this.lineWidth * 0.8;
      ctx.lineCap = 'round';
      ctx.globalAlpha = fragAlpha;

      if (
        frag.type === 'arc' &&
        frag.arcRadius &&
        frag.arcStart !== undefined &&
        frag.arcEnd !== undefined
      ) {
        ctx.beginPath();
        ctx.arc(0, 0, frag.arcRadius, frag.arcStart, frag.arcEnd);
        ctx.strokeStyle = `rgba(${fr}, ${fg}, ${fb}, 0.6)`;
        ctx.stroke();
      } else if (frag.type === 'rune' && frag.symbol !== undefined && frag.runeSize) {
        // Use pre-computed Path2D for fragments
        const path = this.runePaths[frag.symbol % 24];
        ctx.save();
        ctx.scale(frag.runeSize, frag.runeSize);
        ctx.strokeStyle = `rgba(${fr}, ${fg}, ${fb}, 0.7)`;
        ctx.lineWidth = this.lineWidth / frag.runeSize;
        ctx.stroke(path);
        ctx.restore();
      }

      ctx.restore();
    }

    ctx.globalAlpha = 1;
  }

  destroy(): void {
    this.sigils = [];
    this.fragments = [];
    this.runeSprites.clear();
    this.runePaths = [];
  }
}
