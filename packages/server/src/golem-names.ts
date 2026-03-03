/**
 * Procedural golem name generator.
 * Deterministically maps a hostname seed to a memorable two-word name.
 */

const ADJECTIVES = [
  'Iron',
  'Flint',
  'Cinder',
  'Ashen',
  'Slate',
  'Brume',
  'Ember',
  'Chalk',
  'Dross',
  'Soot',
  'Gravel',
  'Burnt',
  'Tallow',
  'Murk',
  'Hollow',
];

const NOUNS = [
  'Fist',
  'Warden',
  'Spine',
  'Maw',
  'Grip',
  'Cog',
  'Jaw',
  'Watch',
  'Knuckle',
  'Walker',
  'Forge',
  'Marrow',
  'Rivet',
  'Hasp',
  'Wrist',
];

/**
 * Generate a deterministic two-word golem name from a seed string.
 * The same seed always produces the same name, so a wiped DB recreates
 * the same name on first boot.
 */
export function generateGolemName(seed: string): string {
  let adjIdx = 0;
  let nounIdx = 0;
  for (let i = 0; i < seed.length; i++) {
    adjIdx = (adjIdx + seed.charCodeAt(i)) % ADJECTIVES.length;
    nounIdx = (nounIdx + seed.charCodeAt(i) * (i + 1)) % NOUNS.length;
  }
  return ADJECTIVES[adjIdx] + NOUNS[nounIdx];
}

/**
 * Get the local machine's hostname.
 * Falls back to 'unknown' if the hostname command fails.
 */
export function getHostname(): string {
  try {
    const proc = Bun.spawnSync(['hostname'], { stdout: 'pipe', stderr: 'pipe' });
    return proc.stdout.toString().trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}
