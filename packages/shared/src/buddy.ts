/**
 * BUDDY - Tamagotchi-Style Terminal Pet
 *
 * A companion pet that lives in the E UI. Features:
 * - 18 species across 5 rarity tiers
 * - 1% shiny chance independent of rarity
 * - Two-layer architecture: "skeleton" (deterministic appearance) + "soul" (LLM personality)
 * - Mood/energy system tied to user activity
 * - ASCII rendering with animation states
 */

// ─── Species & Rarity ────────────────────────────────────────────────────────

export type BuddyRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export interface BuddySpecies {
  id: string;
  name: string;
  rarity: BuddyRarity;
  /** ASCII art frames for idle animation */
  frames: string[];
  /** ASCII art for happy state */
  happyFrame: string;
  /** ASCII art for sleeping state */
  sleepFrame: string;
  /** Base color (CSS color value) */
  color: string;
}

// Rarity weights for species selection (must sum to 1.0)
export const RARITY_WEIGHTS: Record<BuddyRarity, number> = {
  common: 0.4,
  uncommon: 0.3,
  rare: 0.18,
  epic: 0.09,
  legendary: 0.03,
};

export const SHINY_CHANCE = 0.01; // 1% independent of rarity

// ─── Species Catalog ─────────────────────────────────────────────────────────

export const BUDDY_SPECIES: BuddySpecies[] = [
  // Common (40%)
  {
    id: 'golem-pebble',
    name: 'Pebble Golem',
    rarity: 'common',
    frames: ['(o_o)', '(o_O)', '(O_o)'],
    happyFrame: '(^_^)',
    sleepFrame: '(-_-)',
    color: '#8B8682',
  },
  {
    id: 'spark-mote',
    name: 'Spark Mote',
    rarity: 'common',
    frames: ['·*·', '*·*', '·*·'],
    happyFrame: '✧*✧',
    sleepFrame: '·.·',
    color: '#FFD700',
  },
  {
    id: 'bit-bug',
    name: 'Bit Bug',
    rarity: 'common',
    frames: ['/\\_/\\', '\\_/\\/', '/\\_/\\'],
    happyFrame: '/^_^\\',
    sleepFrame: '/~_~\\',
    color: '#90EE90',
  },
  {
    id: 'dust-bunny',
    name: 'Dust Bunny',
    rarity: 'common',
    frames: ['(\\(\\', '( -.-)', '(\\(\\'],
    happyFrame: '(^.^)',
    sleepFrame: '(-.-)zzZ',
    color: '#DEB887',
  },
  {
    id: 'clock-tick',
    name: 'Clock Tick',
    rarity: 'common',
    frames: ['⏰', '⏱', '⏰'],
    happyFrame: '⏰✨',
    sleepFrame: '⏰💤',
    color: '#C0C0C0',
  },

  // Uncommon (30%)
  {
    id: 'rune-wisp',
    name: 'Rune Wisp',
    rarity: 'uncommon',
    frames: ['᚛•᚜', '᚛°᚜', '᚛•᚜'],
    happyFrame: '᚛✦᚜',
    sleepFrame: '᚛·᚜',
    color: '#9B59B6',
  },
  {
    id: 'hex-cat',
    name: 'Hex Cat',
    rarity: 'uncommon',
    frames: ['/\\_/\\', '(=^.^=)', '/\\_/\\'],
    happyFrame: '(=^ω^=)',
    sleepFrame: '(=^-.-^=)',
    color: '#E74C3C',
  },
  {
    id: 'pipe-snake',
    name: 'Pipe Snake',
    rarity: 'uncommon',
    frames: ['~§>', '~~§>', '~~~§>'],
    happyFrame: '~§>♪',
    sleepFrame: '~§>z',
    color: '#2ECC71',
  },
  {
    id: 'ember-sprite',
    name: 'Ember Sprite',
    rarity: 'uncommon',
    frames: ['🔥', '🔸', '🔥'],
    happyFrame: '🔥✨',
    sleepFrame: '🔸',
    color: '#FF6347',
  },
  {
    id: 'null-moth',
    name: 'Null Moth',
    rarity: 'uncommon',
    frames: ['}{', '}{', '{}'],
    happyFrame: '{♡}',
    sleepFrame: '{-}',
    color: '#778899',
  },

  // Rare (18%)
  {
    id: 'void-jellyfish',
    name: 'Void Jellyfish',
    rarity: 'rare',
    frames: ['⊙∽∽', '⊙≈≈', '⊙∽∽'],
    happyFrame: '⊙✧✧',
    sleepFrame: '⊙――',
    color: '#00CED1',
  },
  {
    id: 'circuit-fox',
    name: 'Circuit Fox',
    rarity: 'rare',
    frames: ['▸ᴥ◂', '▸ᴥ◂', '▹ᴥ◃'],
    happyFrame: '▸ωᴥω◂',
    sleepFrame: '▸-ᴥ-◂',
    color: '#FF8C00',
  },
  {
    id: 'glyph-owl',
    name: 'Glyph Owl',
    rarity: 'rare',
    frames: ['⊚v⊚', '⊙v⊙', '⊚v⊚'],
    happyFrame: '⊛v⊛',
    sleepFrame: '—v—',
    color: '#4169E1',
  },

  // Epic (9%)
  {
    id: 'phase-dragon',
    name: 'Phase Dragon',
    rarity: 'epic',
    frames: ['≋⊳≋', '≈⊳≈', '≋⊳≋'],
    happyFrame: '✦⊳✦',
    sleepFrame: '—⊳—',
    color: '#8A2BE2',
  },
  {
    id: 'sigil-phoenix',
    name: 'Sigil Phoenix',
    rarity: 'epic',
    frames: ['⊕╋⊕', '⊕╋⊕', '⊖╋⊖'],
    happyFrame: '✧╋✧',
    sleepFrame: '·╋·',
    color: '#FF4500',
  },
  {
    id: 'echo-whale',
    name: 'Echo Whale',
    rarity: 'epic',
    frames: ['≻)))>', '≻))>', '≻)))>'],
    happyFrame: '≻)))>♫',
    sleepFrame: '≻)>z',
    color: '#1E90FF',
  },

  // Legendary (3%)
  {
    id: 'quantum-lobster',
    name: 'Quantum Lobster',
    rarity: 'legendary',
    frames: ['⊂(◉‿◉)つ', '⊂(◉‿◉)つ', '⊂(◉ω◉)つ'],
    happyFrame: '⊂(◉∀◉)つ✧',
    sleepFrame: '⊂(◉‿◉)つz',
    color: '#FF1493',
  },
  {
    id: 'world-serpent',
    name: 'World Serpent',
    rarity: 'legendary',
    frames: ['◉⊰≈≈≈⊱◉', '◉⊰≈≈⊱◉', '◉⊰≈≈≈⊱◉'],
    happyFrame: '◉⊰✧✧✧⊱◉',
    sleepFrame: '◉⊰―――⊱◉',
    color: '#FFD700',
  },
];

// ─── Buddy State ─────────────────────────────────────────────────────────────

export type BuddyMood = 'happy' | 'content' | 'neutral' | 'bored' | 'sleepy' | 'excited';

export interface BuddySoul {
  name: string;
  personality: string; // One-sentence personality description
  catchphrase: string; // Unique greeting/catchphrase
  quirk: string; // A behavioral quirk
}

export interface BuddyState {
  id: string;
  speciesId: string;
  isShiny: boolean;
  soul: BuddySoul;
  mood: BuddyMood;
  energy: number; // 0-100
  happiness: number; // 0-100
  /** Total interactions (pats, feeds, etc.) */
  interactions: number;
  bornAt: number;
  lastInteractionAt: number;
  lastFedAt: number;
}

export interface BuddyConfig {
  /** Whether buddy is visible in the UI */
  visible: boolean;
  /** Position in the UI */
  position: 'status-bar' | 'sidebar' | 'floating';
  /** Animation speed multiplier */
  animationSpeed: number;
  /** Show buddy reactions to events (builds, tests, etc.) */
  reactToEvents: boolean;
}

export const DEFAULT_BUDDY_CONFIG: BuddyConfig = {
  visible: true,
  position: 'status-bar',
  animationSpeed: 1.0,
  reactToEvents: true,
};

// ─── Generation ──────────────────────────────────────────────────────────────

/**
 * Deterministic species selection from a seed string.
 * Uses a simple hash to select species weighted by rarity.
 */
export function selectSpecies(seed: string): BuddySpecies {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  // Normalize to 0-1
  const normalized = Math.abs(hash) / 2147483647;

  let cumulative = 0;
  const rarityOrder: BuddyRarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

  for (const rarity of rarityOrder) {
    const speciesOfRarity = BUDDY_SPECIES.filter((s) => s.rarity === rarity);
    cumulative += RARITY_WEIGHTS[rarity];
    if (normalized <= cumulative) {
      // Select within rarity tier using secondary hash
      const secondaryHash = Math.abs((hash * 31 + 17) | 0);
      const index = secondaryHash % speciesOfRarity.length;
      return speciesOfRarity[index];
    }
  }

  // Fallback (shouldn't happen)
  return BUDDY_SPECIES[0];
}

/**
 * Determine if a buddy is shiny based on seed.
 */
export function isShiny(seed: string): boolean {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 7) - hash + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) / 2147483647 < SHINY_CHANCE;
}
