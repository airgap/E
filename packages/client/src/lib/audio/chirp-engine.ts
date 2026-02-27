/**
 * Chirp Engine — generative melodic feedback for Claude stream events
 *
 * Pure Web Audio API additive synthesis. Each instrument is modelled
 * via its natural harmonic series with per-partial gains and exponential
 * decay envelopes — no samples, no oscillator types beyond sine.
 *
 * Instrument palette:
 *   Marimba   — warm woody bars, strong fundamental, even harmonics damp fast
 *   Vibraphone — metallic singing bars, brighter partials, motor tremolo optional
 *   Bowl      — singing bowl / bowed glass, slow attack, near-pure fundamental
 *   Plate     — inharmonic struck metal, dense partials, used for errors
 *
 * All events are tuned to a common pentatonic scale so simultaneous
 * chirps always harmonise with each other.
 */

export type ChirpEvent =
  | 'message_start' // New response begins
  | 'text_start' // Text block starts
  | 'text_delta' // Text streaming (throttled)
  | 'thinking_start' // Thinking block
  | 'tool_start' // Tool invocation
  | 'tool_result_ok' // Tool success
  | 'tool_result_error' // Tool error
  | 'tool_approval' // Awaiting user approval
  | 'user_question' // User question prompt
  | 'message_stop' // Response complete
  | 'error' // Stream error
  | 'cancelled' // User cancelled
  // Terminal events
  | 'command_success' // Terminal command exited 0
  | 'command_fail' // Terminal command exited non-zero
  | 'rich_appear' // Rich content detected for a block
  | 'progress_complete' // Progress bar hit 100%
  // Chat events
  | 'chat_send'; // User sent a chat message

// ---------------------------------------------------------------------------
// Additive synthesis primitives
// ---------------------------------------------------------------------------

/**
 * A single overtone in an additive synthesis voice.
 * ratio: frequency multiplier from the fundamental (1 = fundamental, 2 = octave, etc.)
 * gain:  relative amplitude of this overtone (before envelope)
 * decay: per-overtone exponential decay time constant (seconds) — lets higher
 *        overtones die away faster, as they do in real struck instruments
 */
interface Overtone {
  ratio: number;
  gain: number;
  decay: number;
}

/**
 * A complete note specification.
 * freq:    fundamental frequency in Hz
 * partials: harmonic series definition
 * attack:  attack time in seconds
 * release: overall release tail (seconds) after partials fade
 * gain:    master gain for this note (0–1)
 * detune:  optional cents detune on all partials (chorus warmth)
 */
interface NoteSpec {
  freq: number;
  partials: Overtone[];
  attack: number;
  release: number;
  gain: number;
  detune?: number;
  waveform?: OscillatorType;
}

// ---------------------------------------------------------------------------
// Instrument partial series
// Tuned to match the characteristic timbre of each physical instrument.
// ---------------------------------------------------------------------------

/**
 * Marimba — warm rosewood bar.
 * Strong fundamental, 4th harmonic (2 octaves) prominent, higher partials
 * damp very quickly. The characteristic "thwack" lives in the fast-decaying
 * upper partials.
 */
const MARIMBA: Overtone[] = [
  { ratio: 1, gain: 1.0, decay: 0.8 },
  { ratio: 4, gain: 0.35, decay: 0.18 },
  { ratio: 10, gain: 0.12, decay: 0.06 },
  { ratio: 18, gain: 0.05, decay: 0.03 },
];

/**
 * Vibraphone — aluminium bar with resonator tube.
 * Brighter than marimba, prominent 3rd and 5th harmonics,
 * longer metallic sustain. The motor tremolo effect is omitted
 * for brevity but the spectral shape is right.
 */
const VIBRAPHONE: Overtone[] = [
  { ratio: 1, gain: 1.0, decay: 1.2 },
  { ratio: 3.03, gain: 0.4, decay: 0.6 }, // slightly inharmonic — real vibes
  { ratio: 5.95, gain: 0.18, decay: 0.3 },
  { ratio: 8.6, gain: 0.08, decay: 0.14 },
  { ratio: 12.3, gain: 0.04, decay: 0.07 },
];

/**
 * Singing bowl / bowed glass — nearly pure fundamental with one
 * very soft octave partial, very slow attack, long ring.
 */
const BOWL: Overtone[] = [
  { ratio: 1, gain: 1.0, decay: 3.5 },
  { ratio: 2.76, gain: 0.2, decay: 2.0 }, // inharmonic second partial
  { ratio: 5.4, gain: 0.06, decay: 0.8 },
];

/**
 * Struck metal plate — dense inharmonic partials.
 * Models a hit on a large plate or tam-tam: aggressive, clangy,
 * with a cluster of inharmonic frequencies.
 */
const PLATE: Overtone[] = [
  { ratio: 1, gain: 0.8, decay: 0.25 },
  { ratio: 1.51, gain: 0.7, decay: 0.18 },
  { ratio: 2.2, gain: 0.55, decay: 0.12 },
  { ratio: 3.17, gain: 0.4, decay: 0.09 },
  { ratio: 4.8, gain: 0.25, decay: 0.06 },
  { ratio: 6.9, gain: 0.15, decay: 0.04 },
];

/**
 * Tubular bell — long metallic sustain, strong 2nd and 3rd inharmonic partials.
 * Used for attention / approval chimes.
 */
const BELL: Overtone[] = [
  { ratio: 1, gain: 1.0, decay: 2.5 },
  { ratio: 2.76, gain: 0.6, decay: 1.8 },
  { ratio: 5.4, gain: 0.25, decay: 1.0 },
  { ratio: 8.93, gain: 0.12, decay: 0.5 },
  { ratio: 13.3, gain: 0.05, decay: 0.25 },
];

// ---------------------------------------------------------------------------
// Common pentatonic scale frequencies (C major pentatonic, two octaves)
// All events are tuned to notes from this set so concurrent chirps harmonise.
// C4=261.6, D4=293.7, E4=329.6, G4=392.0, A4=440.0
// C5=523.3, D5=587.3, E5=659.3, G5=784.0, A5=880.0
// C6=1046.5, E6=1318.5
// ---------------------------------------------------------------------------

// Event note assignments — chosen so the narrative arc makes musical sense:
//   start events → lower notes, completion → higher resolution, error → dissonant

const NOTES = {
  C4: 261.6,
  D4: 293.7,
  E4: 329.6,
  G4: 392.0,
  A4: 440.0,
  C5: 523.3,
  D5: 587.3,
  E5: 659.3,
  G5: 784.0,
  A5: 880.0,
  C6: 1046.5,
  E6: 1318.5,
  // Error note — B♭4, outside pentatonic, intentionally tense
  Bb4: 466.2,
  // Thinking — low G3
  G3: 196.0,
};

// ---------------------------------------------------------------------------
// Event → note spec table
// ---------------------------------------------------------------------------

const EVENT_NOTES: Record<ChirpEvent, NoteSpec | NoteSpec[]> = {
  // A single marimba strike on G4 — light, readying
  message_start: {
    freq: NOTES.G4,
    partials: MARIMBA,
    attack: 0.004,
    release: 0.08,
    gain: 0.32,
  },

  // Soft vibraphone tap — E5, barely there
  text_start: {
    freq: NOTES.E5,
    partials: VIBRAPHONE,
    attack: 0.003,
    release: 0.06,
    gain: 0.18,
  },

  // text_delta handled by playBrush() — gain:0 sentinel so Record is complete
  text_delta: {
    freq: NOTES.A5,
    partials: VIBRAPHONE,
    attack: 0.002,
    release: 0.03,
    gain: 0.0,
  },

  // Singing bowl on G3 — low, contemplative
  thinking_start: {
    freq: NOTES.G3,
    partials: BOWL,
    attack: 0.06,
    release: 0.5,
    gain: 0.26,
  },

  // tool events handled per-family in TOOL_NOTES — placeholder unused
  tool_start: {
    freq: NOTES.D4,
    partials: VIBRAPHONE,
    attack: 0.004,
    release: 0.07,
    gain: 0.2,
  },

  // Vibraphone major third — D5 + A5
  tool_result_ok: [
    { freq: NOTES.D5, partials: VIBRAPHONE, attack: 0.004, release: 0.12, gain: 0.24 },
    { freq: NOTES.A5, partials: VIBRAPHONE, attack: 0.004, release: 0.12, gain: 0.14 },
  ],

  // Plate strike on Bb4 — dissonant clang
  tool_result_error: {
    freq: NOTES.Bb4,
    partials: PLATE,
    attack: 0.003,
    release: 0.12,
    gain: 0.28,
  },

  // Bell chord — C5 + E5 + G5 (major triad), sustained
  tool_approval: [
    { freq: NOTES.C5, partials: BELL, attack: 0.008, release: 0.5, gain: 0.28 },
    { freq: NOTES.E5, partials: BELL, attack: 0.008, release: 0.5, gain: 0.2 },
    { freq: NOTES.G5, partials: BELL, attack: 0.008, release: 0.5, gain: 0.14 },
  ],

  // user_question handled by playUserQuestion()
  user_question: {
    freq: NOTES.E4,
    partials: MARIMBA,
    attack: 0.005,
    release: 0.12,
    gain: 0.0, // gain=0 sentinel — uses special handler
  },

  // Marimba resolution — C5 + E5 + G5, warm landing
  message_stop: [
    { freq: NOTES.C5, partials: MARIMBA, attack: 0.006, release: 0.35, gain: 0.28 },
    { freq: NOTES.E5, partials: MARIMBA, attack: 0.006, release: 0.35, gain: 0.2 },
    { freq: NOTES.G5, partials: MARIMBA, attack: 0.006, release: 0.35, gain: 0.14 },
  ],

  // Descending plate hits — Bb4 then G3
  error: [
    { freq: NOTES.Bb4, partials: PLATE, attack: 0.003, release: 0.18, gain: 0.3 },
    { freq: NOTES.G3, partials: PLATE, attack: 0.003, release: 0.18, gain: 0.2 },
  ],

  // Soft marimba descent — A4 → G4, gentle fade
  cancelled: [
    { freq: NOTES.A4, partials: MARIMBA, attack: 0.006, release: 0.3, gain: 0.2 },
    { freq: NOTES.G4, partials: MARIMBA, attack: 0.006, release: 0.4, gain: 0.14 },
  ],

  // ── Terminal events ──

  // Quick vibraphone dyad — C5 + E5, bright clean confirmation
  command_success: [
    { freq: NOTES.C5, partials: VIBRAPHONE, attack: 0.003, release: 0.1, gain: 0.2 },
    { freq: NOTES.E5, partials: VIBRAPHONE, attack: 0.003, release: 0.1, gain: 0.12 },
  ],

  // Low plate clang — Bb4, mechanical failure
  command_fail: {
    freq: NOTES.Bb4,
    partials: PLATE,
    attack: 0.002,
    release: 0.1,
    gain: 0.22,
  },

  // Soft bowl bloom — E5, data unfolding into existence
  rich_appear: {
    freq: NOTES.E5,
    partials: BOWL,
    attack: 0.02,
    release: 0.2,
    gain: 0.16,
  },

  // Ascending marimba fanfare — C5 + E5 + G5 + C6
  progress_complete: [
    { freq: NOTES.C5, partials: MARIMBA, attack: 0.004, release: 0.25, gain: 0.24 },
    { freq: NOTES.E5, partials: MARIMBA, attack: 0.004, release: 0.25, gain: 0.18 },
    { freq: NOTES.G5, partials: MARIMBA, attack: 0.004, release: 0.25, gain: 0.12 },
    { freq: NOTES.C6, partials: MARIMBA, attack: 0.004, release: 0.25, gain: 0.08 },
  ],

  // Chat send — bright vibraphone tap on A4, quick affirmation
  chat_send: {
    freq: NOTES.A4,
    partials: VIBRAPHONE,
    attack: 0.003,
    release: 0.06,
    gain: 0.2,
  },
};

// ---------------------------------------------------------------------------
// Per-tool sonic families (vibraphone family with different note choices)
// ---------------------------------------------------------------------------

type ToolFamily = 'shell' | 'read' | 'write' | 'search' | 'agent' | 'default';

function toolFamily(name: string): ToolFamily {
  const n = name.toLowerCase();
  if (n === 'bash') return 'shell';
  if (n === 'read' || n === 'glob' || n === 'grep') return 'read';
  if (
    n === 'write' ||
    n === 'edit' ||
    n === 'notebookedit' ||
    n === 'str_replace_editor' ||
    n === 'write_file' ||
    n === 'edit_file' ||
    n === 'create_file'
  )
    return 'write';
  if (n === 'websearch' || n === 'webfetch') return 'search';
  if (n === 'task' || n.startsWith('mcp__')) return 'agent';
  return 'default';
}

interface ToolNotes {
  start: NoteSpec | NoteSpec[];
  ok: NoteSpec | NoteSpec[];
}

const TOOL_NOTES: Record<ToolFamily, ToolNotes> = {
  // Shell — low marimba, grounded, decisive
  shell: {
    start: { freq: NOTES.C4, partials: MARIMBA, attack: 0.004, release: 0.1, gain: 0.24 },
    ok: [
      { freq: NOTES.C4, partials: MARIMBA, attack: 0.004, release: 0.12, gain: 0.22 },
      { freq: NOTES.G4, partials: MARIMBA, attack: 0.004, release: 0.12, gain: 0.14 },
    ],
  },
  // Read — high vibraphone, light and airy
  read: {
    start: { freq: NOTES.A5, partials: VIBRAPHONE, attack: 0.003, release: 0.08, gain: 0.18 },
    ok: [
      { freq: NOTES.E5, partials: VIBRAPHONE, attack: 0.004, release: 0.12, gain: 0.18 },
      { freq: NOTES.A5, partials: VIBRAPHONE, attack: 0.004, release: 0.12, gain: 0.12 },
    ],
  },
  // Write — mid marimba, weighted, solid
  write: {
    start: { freq: NOTES.D4, partials: MARIMBA, attack: 0.005, release: 0.1, gain: 0.24 },
    ok: [
      { freq: NOTES.G4, partials: MARIMBA, attack: 0.005, release: 0.14, gain: 0.22 },
      { freq: NOTES.D5, partials: MARIMBA, attack: 0.005, release: 0.14, gain: 0.14 },
    ],
  },
  // Search — bowl sweep: low attack, singing
  search: {
    start: { freq: NOTES.D5, partials: BOWL, attack: 0.02, release: 0.2, gain: 0.2 },
    ok: [
      { freq: NOTES.G4, partials: VIBRAPHONE, attack: 0.005, release: 0.16, gain: 0.2 },
      { freq: NOTES.D5, partials: VIBRAPHONE, attack: 0.005, release: 0.16, gain: 0.12 },
    ],
  },
  // Agent — deep bell, resonant spawn
  agent: {
    start: { freq: NOTES.C4, partials: BELL, attack: 0.015, release: 0.5, gain: 0.26 },
    ok: [
      { freq: NOTES.G4, partials: BELL, attack: 0.01, release: 0.4, gain: 0.24 },
      { freq: NOTES.C5, partials: BELL, attack: 0.01, release: 0.4, gain: 0.16 },
    ],
  },
  // Default — vibraphone D4
  default: {
    start: { freq: NOTES.D4, partials: VIBRAPHONE, attack: 0.004, release: 0.08, gain: 0.2 },
    ok: [
      { freq: NOTES.D4, partials: VIBRAPHONE, attack: 0.004, release: 0.12, gain: 0.22 },
      { freq: NOTES.A4, partials: VIBRAPHONE, attack: 0.004, release: 0.12, gain: 0.14 },
    ],
  },
};

// ---------------------------------------------------------------------------
// Whimsy instrument partial series
// Tuned to sound like a music box, toy piano, and kalimba.
// ---------------------------------------------------------------------------

/**
 * Music Box tine — pure metallic overtones with slight inharmonicity.
 * Very fast attack (the cylinder plucks the tine instantly),
 * long glassy decay. Ethereal, delicate, perfectly clockwork.
 */
const MUSIC_BOX: Overtone[] = [
  { ratio: 1, gain: 1.0, decay: 2.2 },
  { ratio: 2.03, gain: 0.28, decay: 0.9 }, // slightly inharmonic 2nd
  { ratio: 4.12, gain: 0.1, decay: 0.35 },
  { ratio: 6.84, gain: 0.04, decay: 0.14 },
];

/**
 * Toy Piano — thin metal tine struck by a tiny hammer.
 * Bright, brittle, slightly hollow. Higher partials decay almost instantly.
 */
const TOY_PIANO: Overtone[] = [
  { ratio: 1, gain: 1.0, decay: 0.55 },
  { ratio: 2.0, gain: 0.5, decay: 0.2 },
  { ratio: 3.1, gain: 0.28, decay: 0.09 },
  { ratio: 5.0, gain: 0.12, decay: 0.04 },
  { ratio: 7.5, gain: 0.06, decay: 0.02 },
];

/**
 * Kalimba (thumb piano) — warm fundamental with a quick metallic twang.
 * The tine rings bright, decays into a deep warm resonance.
 */
const KALIMBA: Overtone[] = [
  { ratio: 1, gain: 1.0, decay: 1.8 },
  { ratio: 2.0, gain: 0.55, decay: 0.65 },
  { ratio: 3.05, gain: 0.2, decay: 0.22 },
  { ratio: 4.92, gain: 0.08, decay: 0.08 },
];

/**
 * Toy Xylophone — short wooden bars, higher register, bouncier than marimba.
 * Lots of click on attack, harmonics die fast leaving just the warm tone.
 */
const TOY_XYLOPHONE: Overtone[] = [
  { ratio: 1, gain: 1.0, decay: 0.5 },
  { ratio: 3.0, gain: 0.45, decay: 0.1 },
  { ratio: 7.0, gain: 0.18, decay: 0.04 },
  { ratio: 12.0, gain: 0.06, decay: 0.02 },
];

// ---------------------------------------------------------------------------
// Forest instrument partial series
// Enchanted woodland synthesis: wind chimes, wooden flutes, owl hoots,
// rustling leaves, dripping water, and fairy sparkles.
// ---------------------------------------------------------------------------

/**
 * Wind Chime — thin metal tubes swaying in a forest breeze.
 * Bright, shimmery, with closely-spaced inharmonic partials that
 * create a beautiful beating/shimmering effect. Long ethereal sustain.
 */
const WIND_CHIME: Overtone[] = [
  { ratio: 1, gain: 1.0, decay: 2.8 },
  { ratio: 1.08, gain: 0.7, decay: 2.4 }, // close detuning = shimmer
  { ratio: 2.37, gain: 0.35, decay: 1.5 },
  { ratio: 3.92, gain: 0.15, decay: 0.8 },
  { ratio: 6.1, gain: 0.06, decay: 0.3 },
];

/**
 * Wooden Flute — warm, breathy, hollow wooden pipe.
 * Strong odd harmonics (characteristic of open cylindrical pipes),
 * gentle attack like breath filling the column, warm woody sustain.
 */
const WOODEN_FLUTE: Overtone[] = [
  { ratio: 1, gain: 1.0, decay: 1.4 },
  { ratio: 2.0, gain: 0.15, decay: 0.8 }, // weak even harmonic (open pipe)
  { ratio: 3.0, gain: 0.4, decay: 0.6 }, // strong 3rd
  { ratio: 5.0, gain: 0.12, decay: 0.3 },
  { ratio: 7.0, gain: 0.04, decay: 0.12 },
];

/**
 * Raindrop — a single water drop hitting a still pool.
 * Very pure tone with a fast pluck attack and a quick
 * resonant decay, like a tiny liquid bell.
 */
const RAINDROP: Overtone[] = [
  { ratio: 1, gain: 1.0, decay: 0.4 },
  { ratio: 2.17, gain: 0.3, decay: 0.15 }, // slightly inharmonic splash
  { ratio: 4.56, gain: 0.1, decay: 0.06 },
];

/**
 * Fairy Sparkle — bright crystalline ping with rapid glittering decay.
 * Very high, thin partials that evaporate almost instantly,
 * like pixie dust catching the light.
 */
const FAIRY_SPARKLE: Overtone[] = [
  { ratio: 1, gain: 1.0, decay: 0.6 },
  { ratio: 1.5, gain: 0.6, decay: 0.45 }, // perfect fifth shimmer
  { ratio: 2.0, gain: 0.4, decay: 0.3 },
  { ratio: 3.17, gain: 0.2, decay: 0.15 },
  { ratio: 5.34, gain: 0.08, decay: 0.06 },
];

/**
 * Owl Hoot — deep, hollow, resonant call.
 * Very strong fundamental with minimal upper partials,
 * slow attack mimicking the owl's breathy onset, long warm sustain.
 */
const OWL_HOOT: Overtone[] = [
  { ratio: 1, gain: 1.0, decay: 2.0 },
  { ratio: 1.5, gain: 0.12, decay: 1.2 }, // faint fifth
  { ratio: 2.0, gain: 0.06, decay: 0.6 },
];

// Forest scale — D Dorian (natural, woodland, slightly mysterious)
// D E F G A B C — the raised 6th gives it a bittersweet, enchanted quality
const FOREST_NOTES = {
  D3: 146.8,
  E3: 164.8,
  F3: 174.6,
  G3: 196.0,
  A3: 220.0,
  B3: 246.9,
  C4: 261.6,
  D4: 293.7,
  E4: 329.6,
  F4: 349.2,
  G4: 392.0,
  A4: 440.0,
  B4: 493.9,
  C5: 523.3,
  D5: 587.3,
  E5: 659.3,
  F5: 698.5,
  G5: 784.0,
  A5: 880.0,
  B5: 987.8,
  C6: 1046.5,
  D6: 1174.7,
  // Low owl hoot note
  D2: 73.4,
};

// Event → forest note specs
const FOREST_EVENT_NOTES: Record<ChirpEvent, NoteSpec | NoteSpec[]> = {
  // Wind chime greeting — D5, gentle woodland hello
  message_start: {
    freq: FOREST_NOTES.D5,
    partials: WIND_CHIME,
    attack: 0.008,
    release: 0.15,
    gain: 0.28,
  },

  // Fairy sparkle — A5, tiny magical glint
  text_start: {
    freq: FOREST_NOTES.A5,
    partials: FAIRY_SPARKLE,
    attack: 0.002,
    release: 0.08,
    gain: 0.2,
  },

  // text_delta → playForestRustle() — sentinel
  text_delta: {
    freq: FOREST_NOTES.D6,
    partials: FAIRY_SPARKLE,
    attack: 0.001,
    release: 0.02,
    gain: 0.0,
  },

  // Owl contemplation — D2, deep and wise
  thinking_start: {
    freq: FOREST_NOTES.D2,
    partials: OWL_HOOT,
    attack: 0.06,
    release: 0.6,
    gain: 0.26,
  },

  // Raindrop — G4, clear purpose
  tool_start: {
    freq: FOREST_NOTES.G4,
    partials: RAINDROP,
    attack: 0.002,
    release: 0.08,
    gain: 0.22,
  },

  // Two wind chimes — A4 + D5 (woodland perfect fourth)
  tool_result_ok: [
    { freq: FOREST_NOTES.A4, partials: WIND_CHIME, attack: 0.004, release: 0.14, gain: 0.24 },
    { freq: FOREST_NOTES.D5, partials: WIND_CHIME, attack: 0.004, release: 0.14, gain: 0.16 },
  ],

  // Cracked twig — B4 raindrop clunk (out of the dorian comfort zone)
  tool_result_error: {
    freq: FOREST_NOTES.F4,
    partials: RAINDROP,
    attack: 0.003,
    release: 0.14,
    gain: 0.26,
  },

  // Fairy ring fanfare — D5 + F5 + A5 + D6
  tool_approval: [
    { freq: FOREST_NOTES.D5, partials: FAIRY_SPARKLE, attack: 0.006, release: 0.6, gain: 0.26 },
    { freq: FOREST_NOTES.F5, partials: FAIRY_SPARKLE, attack: 0.006, release: 0.6, gain: 0.2 },
    { freq: FOREST_NOTES.A5, partials: FAIRY_SPARKLE, attack: 0.006, release: 0.6, gain: 0.14 },
    { freq: FOREST_NOTES.D6, partials: FAIRY_SPARKLE, attack: 0.006, release: 0.6, gain: 0.08 },
  ],

  // user_question → playForestQuestion() — sentinel
  user_question: {
    freq: FOREST_NOTES.G4,
    partials: WOODEN_FLUTE,
    attack: 0.005,
    release: 0.1,
    gain: 0.0,
  },

  // Woodland resolution — D4 + A4 + D5 warm flute landing
  message_stop: [
    { freq: FOREST_NOTES.D4, partials: WOODEN_FLUTE, attack: 0.008, release: 0.4, gain: 0.26 },
    { freq: FOREST_NOTES.A4, partials: WOODEN_FLUTE, attack: 0.008, release: 0.4, gain: 0.2 },
    { freq: FOREST_NOTES.D5, partials: WOODEN_FLUTE, attack: 0.008, release: 0.4, gain: 0.14 },
  ],

  // Falling leaves — B4 then G3, descending wind chimes
  error: [
    { freq: FOREST_NOTES.B4, partials: WIND_CHIME, attack: 0.004, release: 0.2, gain: 0.28 },
    { freq: FOREST_NOTES.G3, partials: WIND_CHIME, attack: 0.004, release: 0.2, gain: 0.2 },
  ],

  // Dusk settling — E5 → D5, gentle flute fade
  cancelled: [
    { freq: FOREST_NOTES.E5, partials: WOODEN_FLUTE, attack: 0.006, release: 0.3, gain: 0.2 },
    { freq: FOREST_NOTES.D5, partials: WOODEN_FLUTE, attack: 0.006, release: 0.4, gain: 0.14 },
  ],

  // Wind chime resolution — D5 + A5, woodland confirmation
  command_success: [
    { freq: FOREST_NOTES.D5, partials: WIND_CHIME, attack: 0.003, release: 0.12, gain: 0.2 },
    { freq: FOREST_NOTES.A5, partials: WIND_CHIME, attack: 0.003, release: 0.12, gain: 0.12 },
  ],

  // Owl warning hoot — D2, deep ominous call
  command_fail: {
    freq: FOREST_NOTES.D2,
    partials: OWL_HOOT,
    attack: 0.03,
    release: 0.2,
    gain: 0.22,
  },

  // Fairy sparkle bloom — A5, magical data appearing
  rich_appear: {
    freq: FOREST_NOTES.A5,
    partials: FAIRY_SPARKLE,
    attack: 0.01,
    release: 0.15,
    gain: 0.16,
  },

  // Ascending fairy cascade — D5 + A5 + D6
  progress_complete: [
    { freq: FOREST_NOTES.D5, partials: FAIRY_SPARKLE, attack: 0.004, release: 0.3, gain: 0.22 },
    { freq: FOREST_NOTES.A5, partials: FAIRY_SPARKLE, attack: 0.004, release: 0.3, gain: 0.16 },
    { freq: FOREST_NOTES.D6, partials: FAIRY_SPARKLE, attack: 0.004, release: 0.3, gain: 0.1 },
  ],

  // Chat send — leaf rustle, quick wind chime tap
  chat_send: {
    freq: FOREST_NOTES.A4,
    partials: WIND_CHIME,
    attack: 0.003,
    release: 0.06,
    gain: 0.18,
  },
};

interface ForestToolNotes {
  start: NoteSpec | NoteSpec[];
  ok: NoteSpec | NoteSpec[];
}

const FOREST_TOOL_NOTES: Record<ToolFamily, ForestToolNotes> = {
  // Shell — deep raindrop, grounded like tree roots
  shell: {
    start: { freq: FOREST_NOTES.D3, partials: RAINDROP, attack: 0.003, release: 0.12, gain: 0.24 },
    ok: [
      { freq: FOREST_NOTES.D3, partials: RAINDROP, attack: 0.004, release: 0.14, gain: 0.22 },
      { freq: FOREST_NOTES.A3, partials: RAINDROP, attack: 0.004, release: 0.14, gain: 0.14 },
    ],
  },
  // Read — high fairy sparkle, scanning through leaves
  read: {
    start: {
      freq: FOREST_NOTES.A5,
      partials: FAIRY_SPARKLE,
      attack: 0.002,
      release: 0.1,
      gain: 0.18,
    },
    ok: [
      { freq: FOREST_NOTES.E5, partials: FAIRY_SPARKLE, attack: 0.003, release: 0.14, gain: 0.18 },
      { freq: FOREST_NOTES.A5, partials: FAIRY_SPARKLE, attack: 0.003, release: 0.14, gain: 0.12 },
    ],
  },
  // Write — mid wooden flute, inscribing on bark
  write: {
    start: {
      freq: FOREST_NOTES.D4,
      partials: WOODEN_FLUTE,
      attack: 0.006,
      release: 0.12,
      gain: 0.24,
    },
    ok: [
      { freq: FOREST_NOTES.G4, partials: WOODEN_FLUTE, attack: 0.006, release: 0.16, gain: 0.22 },
      { freq: FOREST_NOTES.D5, partials: WOODEN_FLUTE, attack: 0.006, release: 0.16, gain: 0.14 },
    ],
  },
  // Search — wind chime sweep, breeze through branches
  search: {
    start: { freq: FOREST_NOTES.D5, partials: WIND_CHIME, attack: 0.012, release: 0.22, gain: 0.2 },
    ok: [
      { freq: FOREST_NOTES.G4, partials: WIND_CHIME, attack: 0.005, release: 0.18, gain: 0.2 },
      { freq: FOREST_NOTES.D5, partials: WIND_CHIME, attack: 0.005, release: 0.18, gain: 0.12 },
    ],
  },
  // Agent — owl hoot, wise creature awakening
  agent: {
    start: { freq: FOREST_NOTES.D3, partials: OWL_HOOT, attack: 0.02, release: 0.55, gain: 0.26 },
    ok: [
      { freq: FOREST_NOTES.A3, partials: OWL_HOOT, attack: 0.015, release: 0.45, gain: 0.24 },
      { freq: FOREST_NOTES.D4, partials: OWL_HOOT, attack: 0.015, release: 0.45, gain: 0.16 },
    ],
  },
  // Default — raindrop D4
  default: {
    start: { freq: FOREST_NOTES.D4, partials: RAINDROP, attack: 0.002, release: 0.1, gain: 0.2 },
    ok: [
      { freq: FOREST_NOTES.D4, partials: RAINDROP, attack: 0.003, release: 0.14, gain: 0.22 },
      { freq: FOREST_NOTES.A4, partials: RAINDROP, attack: 0.003, release: 0.14, gain: 0.14 },
    ],
  },
};

// ---------------------------------------------------------------------------
// Wind Chime sound style — dedicated serene wind chime synthesis
// Shimmering metallic tubes, gentle breezes, crystalline resonances,
// and subtle harmonic overtones. Every event is pure chime.
// ---------------------------------------------------------------------------

/**
 * Tubular Chime — resonant wind chime tube with clear, open sustain.
 * Bright fundamental with a gentle detuned shimmer that blooms then
 * fades cleanly, like a struck tube ringing in open air.
 */
const TUBULAR_CHIME: Overtone[] = [
  { ratio: 1, gain: 1.0, decay: 1.6 },
  { ratio: 1.003, gain: 0.45, decay: 1.3 }, // very slight detuning = gentle shimmer
  { ratio: 2.41, gain: 0.25, decay: 0.7 },
  { ratio: 4.02, gain: 0.1, decay: 0.35 },
  { ratio: 6.35, gain: 0.04, decay: 0.15 },
];

/**
 * Crystal Chime — bright, clear, glass-like wind chime.
 * Clean fundamental with airy upper partials that sparkle
 * and fade quickly, like a crystal prism catching sunlight.
 */
const CRYSTAL_CHIME: Overtone[] = [
  { ratio: 1, gain: 1.0, decay: 1.0 },
  { ratio: 2.0, gain: 0.5, decay: 0.7 }, // pure octave = open, clean
  { ratio: 3.0, gain: 0.3, decay: 0.45 }, // fifth above octave = bright
  { ratio: 5.04, gain: 0.15, decay: 0.2 },
  { ratio: 8.0, gain: 0.06, decay: 0.08 },
];

/**
 * Bamboo Chime — warm, hollow, wooden wind chime.
 * Strong fundamental with dampened upper harmonics,
 * creating a softer, warmer, more grounded tone. Like bamboo knocking.
 */
const BAMBOO_CHIME: Overtone[] = [
  { ratio: 1, gain: 1.0, decay: 0.6 },
  { ratio: 2.0, gain: 0.3, decay: 0.35 }, // clean octave = open woody ring
  { ratio: 3.0, gain: 0.1, decay: 0.15 },
  { ratio: 4.7, gain: 0.03, decay: 0.06 },
];

/**
 * Bell Chime — clear bell-like wind chime with gentle inharmonics.
 * A clean struck-bell quality that rings openly then fades,
 * with just enough harmonic complexity for warmth.
 */
const BELL_CHIME: Overtone[] = [
  { ratio: 1, gain: 1.0, decay: 1.8 },
  { ratio: 2.0, gain: 0.45, decay: 1.2 }, // clean octave = open bell ring
  { ratio: 3.0, gain: 0.25, decay: 0.7 }, // twelfth = bright bell character
  { ratio: 4.24, gain: 0.12, decay: 0.35 }, // mild inharmonic = bell colour
  { ratio: 6.0, gain: 0.05, decay: 0.15 },
];

/**
 * Tinkle Chime — very small, high, delicate chime.
 * Quick, clean attack with airy upper partials that vanish fast.
 * Like a tiny glass bead tapped in a breeze.
 */
const TINKLE_CHIME: Overtone[] = [
  { ratio: 1, gain: 1.0, decay: 0.35 },
  { ratio: 2.0, gain: 0.5, decay: 0.2 }, // clean octave
  { ratio: 4.0, gain: 0.2, decay: 0.08 },
  { ratio: 7.0, gain: 0.06, decay: 0.03 },
];

// Wind Chime scale — F Lydian (bright, dreamy, floating, ethereal)
// F G A B C D E — the raised 4th gives it an airy, suspended, magical quality
const CHIME_NOTES = {
  F2: 87.3,
  G2: 98.0,
  A2: 110.0,
  B2: 123.5,
  C3: 130.8,
  D3: 146.8,
  E3: 164.8,
  F3: 174.6,
  G3: 196.0,
  A3: 220.0,
  B3: 246.9,
  C4: 261.6,
  D4: 293.7,
  E4: 329.6,
  F4: 349.2,
  G4: 392.0,
  A4: 440.0,
  B4: 493.9,
  C5: 523.3,
  D5: 587.3,
  E5: 659.3,
  F5: 698.5,
  G5: 784.0,
  A5: 880.0,
  B5: 987.8,
  C6: 1046.5,
  D6: 1174.7,
  E6: 1318.5,
  F6: 1396.9,
};

// Event → wind chime note specs
const WIND_CHIME_EVENT_NOTES: Record<ChirpEvent, NoteSpec | NoteSpec[]> = {
  // Tubular chime greeting — F5, clear open hello
  message_start: {
    freq: CHIME_NOTES.F5,
    partials: TUBULAR_CHIME,
    attack: 0.005,
    release: 0.12,
    gain: 0.26,
  },

  // Crystal tinkle — A5, bright sparkle
  text_start: {
    freq: CHIME_NOTES.A5,
    partials: CRYSTAL_CHIME,
    attack: 0.002,
    release: 0.1,
    gain: 0.2,
  },

  // text_delta → playWindChimeBreezeNote() — sentinel
  text_delta: {
    freq: CHIME_NOTES.F6,
    partials: TINKLE_CHIME,
    attack: 0.001,
    release: 0.02,
    gain: 0.0,
  },

  // Bell chime contemplation — F3, warm and open
  thinking_start: {
    freq: CHIME_NOTES.F3,
    partials: BELL_CHIME,
    attack: 0.03,
    release: 0.35,
    gain: 0.24,
  },

  // Bamboo knock — C4, purposeful wooden tap
  tool_start: {
    freq: CHIME_NOTES.C4,
    partials: BAMBOO_CHIME,
    attack: 0.003,
    release: 0.08,
    gain: 0.22,
  },

  // Twin crystal chimes — A4 + F5 (open sixth)
  tool_result_ok: [
    { freq: CHIME_NOTES.A4, partials: CRYSTAL_CHIME, attack: 0.003, release: 0.1, gain: 0.22 },
    { freq: CHIME_NOTES.F5, partials: CRYSTAL_CHIME, attack: 0.003, release: 0.1, gain: 0.14 },
  ],

  // Muted bamboo tap — C4, soft low signal
  tool_result_error: {
    freq: CHIME_NOTES.C4,
    partials: BAMBOO_CHIME,
    attack: 0.002,
    release: 0.08,
    gain: 0.22,
  },

  // Cascading crystal fanfare — F5 + A5 + C6 + F6
  tool_approval: [
    { freq: CHIME_NOTES.F5, partials: CRYSTAL_CHIME, attack: 0.005, release: 0.3, gain: 0.24 },
    { freq: CHIME_NOTES.A5, partials: CRYSTAL_CHIME, attack: 0.005, release: 0.3, gain: 0.18 },
    { freq: CHIME_NOTES.C6, partials: CRYSTAL_CHIME, attack: 0.005, release: 0.3, gain: 0.12 },
    { freq: CHIME_NOTES.F6, partials: CRYSTAL_CHIME, attack: 0.005, release: 0.3, gain: 0.07 },
  ],

  // user_question → playWindChimeQuestion() — sentinel
  user_question: {
    freq: CHIME_NOTES.C4,
    partials: TUBULAR_CHIME,
    attack: 0.005,
    release: 0.1,
    gain: 0.0,
  },

  // Open landing — F4 + A4 + F5 tubular resolution
  message_stop: [
    { freq: CHIME_NOTES.F4, partials: TUBULAR_CHIME, attack: 0.006, release: 0.2, gain: 0.24 },
    { freq: CHIME_NOTES.A4, partials: TUBULAR_CHIME, attack: 0.006, release: 0.2, gain: 0.18 },
    { freq: CHIME_NOTES.F5, partials: TUBULAR_CHIME, attack: 0.006, release: 0.2, gain: 0.12 },
  ],

  // Gentle descending bell — F5 → C4, soft falling interval
  error: [
    { freq: CHIME_NOTES.F5, partials: BELL_CHIME, attack: 0.004, release: 0.18, gain: 0.24 },
    { freq: CHIME_NOTES.C4, partials: BELL_CHIME, attack: 0.004, release: 0.18, gain: 0.16 },
  ],

  // Fading breeze — G5 → F5, gentle descending tinkle
  cancelled: [
    { freq: CHIME_NOTES.G5, partials: TINKLE_CHIME, attack: 0.004, release: 0.12, gain: 0.18 },
    { freq: CHIME_NOTES.F5, partials: TINKLE_CHIME, attack: 0.004, release: 0.15, gain: 0.12 },
  ],

  // Crystal chime resolution — F5 + C6
  command_success: [
    { freq: CHIME_NOTES.F5, partials: CRYSTAL_CHIME, attack: 0.003, release: 0.1, gain: 0.2 },
    { freq: CHIME_NOTES.C6, partials: CRYSTAL_CHIME, attack: 0.003, release: 0.1, gain: 0.12 },
  ],

  // Low bamboo clack — warning tap
  command_fail: {
    freq: CHIME_NOTES.F3,
    partials: BAMBOO_CHIME,
    attack: 0.002,
    release: 0.08,
    gain: 0.22,
  },

  // Tinkle shimmer — A5, data appearing
  rich_appear: {
    freq: CHIME_NOTES.A5,
    partials: TINKLE_CHIME,
    attack: 0.01,
    release: 0.15,
    gain: 0.16,
  },

  // Ascending crystal cascade — F5 + A5 + C6 + F6
  progress_complete: [
    { freq: CHIME_NOTES.F5, partials: CRYSTAL_CHIME, attack: 0.004, release: 0.25, gain: 0.22 },
    { freq: CHIME_NOTES.A5, partials: CRYSTAL_CHIME, attack: 0.004, release: 0.25, gain: 0.16 },
    { freq: CHIME_NOTES.C6, partials: CRYSTAL_CHIME, attack: 0.004, release: 0.25, gain: 0.1 },
    { freq: CHIME_NOTES.F6, partials: CRYSTAL_CHIME, attack: 0.004, release: 0.25, gain: 0.06 },
  ],

  // Chat send — tinkle chime tap, bright acknowledgement
  chat_send: {
    freq: CHIME_NOTES.A5,
    partials: TINKLE_CHIME,
    attack: 0.003,
    release: 0.06,
    gain: 0.18,
  },
};

interface WindChimeToolNotes {
  start: NoteSpec | NoteSpec[];
  ok: NoteSpec | NoteSpec[];
}

const WIND_CHIME_TOOL_NOTES: Record<ToolFamily, WindChimeToolNotes> = {
  // Shell — deep bamboo knock, grounded and earthy
  shell: {
    start: {
      freq: CHIME_NOTES.F3,
      partials: BAMBOO_CHIME,
      attack: 0.003,
      release: 0.12,
      gain: 0.24,
    },
    ok: [
      { freq: CHIME_NOTES.F3, partials: BAMBOO_CHIME, attack: 0.004, release: 0.14, gain: 0.22 },
      { freq: CHIME_NOTES.C4, partials: BAMBOO_CHIME, attack: 0.004, release: 0.14, gain: 0.14 },
    ],
  },
  // Read — high tinkle, scanning through pages
  read: {
    start: {
      freq: CHIME_NOTES.A5,
      partials: TINKLE_CHIME,
      attack: 0.002,
      release: 0.1,
      gain: 0.18,
    },
    ok: [
      { freq: CHIME_NOTES.E5, partials: TINKLE_CHIME, attack: 0.003, release: 0.14, gain: 0.18 },
      { freq: CHIME_NOTES.A5, partials: TINKLE_CHIME, attack: 0.003, release: 0.14, gain: 0.12 },
    ],
  },
  // Write — mid tubular chime, clean engraving
  write: {
    start: {
      freq: CHIME_NOTES.F4,
      partials: TUBULAR_CHIME,
      attack: 0.005,
      release: 0.1,
      gain: 0.22,
    },
    ok: [
      { freq: CHIME_NOTES.C5, partials: TUBULAR_CHIME, attack: 0.005, release: 0.12, gain: 0.2 },
      { freq: CHIME_NOTES.F5, partials: TUBULAR_CHIME, attack: 0.005, release: 0.12, gain: 0.12 },
    ],
  },
  // Search — crystal chime sweep, sparkling discovery
  search: {
    start: {
      freq: CHIME_NOTES.F5,
      partials: CRYSTAL_CHIME,
      attack: 0.005,
      release: 0.12,
      gain: 0.2,
    },
    ok: [
      { freq: CHIME_NOTES.C5, partials: CRYSTAL_CHIME, attack: 0.004, release: 0.1, gain: 0.2 },
      { freq: CHIME_NOTES.F5, partials: CRYSTAL_CHIME, attack: 0.004, release: 0.1, gain: 0.12 },
    ],
  },
  // Agent — bell chime, clear awakening
  agent: {
    start: { freq: CHIME_NOTES.F3, partials: BELL_CHIME, attack: 0.015, release: 0.25, gain: 0.24 },
    ok: [
      { freq: CHIME_NOTES.C4, partials: BELL_CHIME, attack: 0.01, release: 0.2, gain: 0.22 },
      { freq: CHIME_NOTES.F4, partials: BELL_CHIME, attack: 0.01, release: 0.2, gain: 0.14 },
    ],
  },
  // Default — bamboo tap F4
  default: {
    start: { freq: CHIME_NOTES.F4, partials: BAMBOO_CHIME, attack: 0.002, release: 0.1, gain: 0.2 },
    ok: [
      { freq: CHIME_NOTES.F4, partials: BAMBOO_CHIME, attack: 0.003, release: 0.14, gain: 0.22 },
      { freq: CHIME_NOTES.C5, partials: BAMBOO_CHIME, attack: 0.003, release: 0.14, gain: 0.14 },
    ],
  },
};

// C major scale + extensions — bright, upbeat, no pentatonic flats
const WHIMSY_NOTES = {
  C4: 261.6,
  D4: 293.7,
  E4: 329.6,
  F4: 349.2,
  G4: 392.0,
  A4: 440.0,
  B4: 493.9,
  C5: 523.3,
  D5: 587.3,
  E5: 659.3,
  F5: 698.5,
  G5: 784.0,
  A5: 880.0,
  B5: 987.8,
  C6: 1046.5,
  E6: 1318.5,
  // Squeeze-toy squeak frequency (used for brush-replacement)
  F6: 1396.9,
};

// Event → whimsy note specs
const WHIMSY_EVENT_NOTES: Record<ChirpEvent, NoteSpec | NoteSpec[]> = {
  // Toy piano ding — E5, cheerful readying
  message_start: {
    freq: WHIMSY_NOTES.E5,
    partials: TOY_PIANO,
    attack: 0.002,
    release: 0.1,
    gain: 0.3,
  },

  // Music box tinkle — G5, light and airy
  text_start: {
    freq: WHIMSY_NOTES.G5,
    partials: MUSIC_BOX,
    attack: 0.001,
    release: 0.08,
    gain: 0.2,
  },

  // text_delta → playWhimsySqueak() — sentinel
  text_delta: {
    freq: WHIMSY_NOTES.C6,
    partials: MUSIC_BOX,
    attack: 0.001,
    release: 0.02,
    gain: 0.0,
  },

  // Kalimba dream — C4, slow and contemplative
  thinking_start: {
    freq: WHIMSY_NOTES.C4,
    partials: KALIMBA,
    attack: 0.04,
    release: 0.6,
    gain: 0.28,
  },

  // Toy xylophone tick — D5
  tool_start: {
    freq: WHIMSY_NOTES.D5,
    partials: TOY_XYLOPHONE,
    attack: 0.002,
    release: 0.08,
    gain: 0.22,
  },

  // Two music box notes — E5 + B5
  tool_result_ok: [
    { freq: WHIMSY_NOTES.E5, partials: MUSIC_BOX, attack: 0.002, release: 0.14, gain: 0.24 },
    { freq: WHIMSY_NOTES.B5, partials: MUSIC_BOX, attack: 0.002, release: 0.14, gain: 0.14 },
  ],

  // Toy xylophone clunk — Bb-ish (F#5-ish, slightly sour on purpose — still cute)
  tool_result_error: {
    freq: WHIMSY_NOTES.F5,
    partials: TOY_XYLOPHONE,
    attack: 0.003,
    release: 0.14,
    gain: 0.26,
  },

  // Magic music box triad — C5 + E5 + G5 + C6, sparkly fanfare
  tool_approval: [
    { freq: WHIMSY_NOTES.C5, partials: MUSIC_BOX, attack: 0.004, release: 0.6, gain: 0.26 },
    { freq: WHIMSY_NOTES.E5, partials: MUSIC_BOX, attack: 0.004, release: 0.6, gain: 0.2 },
    { freq: WHIMSY_NOTES.G5, partials: MUSIC_BOX, attack: 0.004, release: 0.6, gain: 0.14 },
    { freq: WHIMSY_NOTES.C6, partials: MUSIC_BOX, attack: 0.004, release: 0.6, gain: 0.08 },
  ],

  // user_question → playWhimsyQuestion() — sentinel
  user_question: {
    freq: WHIMSY_NOTES.E4,
    partials: TOY_PIANO,
    attack: 0.002,
    release: 0.1,
    gain: 0.0,
  },

  // Kalimba landing — C5 + E5 + G5, warm resolution
  message_stop: [
    { freq: WHIMSY_NOTES.C5, partials: KALIMBA, attack: 0.004, release: 0.4, gain: 0.28 },
    { freq: WHIMSY_NOTES.E5, partials: KALIMBA, attack: 0.004, release: 0.4, gain: 0.2 },
    { freq: WHIMSY_NOTES.G5, partials: KALIMBA, attack: 0.004, release: 0.4, gain: 0.14 },
  ],

  // Sad toy xylophone tumble — B4 then G4, descending
  error: [
    { freq: WHIMSY_NOTES.B4, partials: TOY_XYLOPHONE, attack: 0.003, release: 0.2, gain: 0.28 },
    { freq: WHIMSY_NOTES.G4, partials: TOY_XYLOPHONE, attack: 0.003, release: 0.2, gain: 0.2 },
  ],

  // Toy piano wilt — A5 → G5, gentle fade
  cancelled: [
    { freq: WHIMSY_NOTES.A5, partials: TOY_PIANO, attack: 0.004, release: 0.28, gain: 0.2 },
    { freq: WHIMSY_NOTES.G5, partials: TOY_PIANO, attack: 0.004, release: 0.38, gain: 0.14 },
  ],

  // Music box resolution — D5 + A5, toy success
  command_success: [
    { freq: WHIMSY_NOTES.D5, partials: MUSIC_BOX, attack: 0.002, release: 0.12, gain: 0.2 },
    { freq: WHIMSY_NOTES.A5, partials: MUSIC_BOX, attack: 0.002, release: 0.12, gain: 0.12 },
  ],

  // Toy xylophone descending clunk — F4, cartoonish fail
  command_fail: {
    freq: WHIMSY_NOTES.F4,
    partials: TOY_XYLOPHONE,
    attack: 0.002,
    release: 0.1,
    gain: 0.22,
  },

  // Kalimba sparkle — G5, data blooming
  rich_appear: {
    freq: WHIMSY_NOTES.G5,
    partials: KALIMBA,
    attack: 0.01,
    release: 0.18,
    gain: 0.16,
  },

  // Music box ascending arpeggio — C5 + E5 + G5 + C6
  progress_complete: [
    { freq: WHIMSY_NOTES.C5, partials: MUSIC_BOX, attack: 0.003, release: 0.3, gain: 0.22 },
    { freq: WHIMSY_NOTES.E5, partials: MUSIC_BOX, attack: 0.003, release: 0.3, gain: 0.16 },
    { freq: WHIMSY_NOTES.G5, partials: MUSIC_BOX, attack: 0.003, release: 0.3, gain: 0.1 },
    { freq: WHIMSY_NOTES.C6, partials: MUSIC_BOX, attack: 0.003, release: 0.3, gain: 0.06 },
  ],

  // Chat send — toy piano pop, cheerful send
  chat_send: {
    freq: WHIMSY_NOTES.A5,
    partials: TOY_PIANO,
    attack: 0.002,
    release: 0.06,
    gain: 0.18,
  },
};

interface WhimsyToolNotes {
  start: NoteSpec | NoteSpec[];
  ok: NoteSpec | NoteSpec[];
}

const WHIMSY_TOOL_NOTES: Record<ToolFamily, WhimsyToolNotes> = {
  // Shell — low kalimba thunk, purposeful
  shell: {
    start: { freq: WHIMSY_NOTES.C4, partials: KALIMBA, attack: 0.003, release: 0.12, gain: 0.24 },
    ok: [
      { freq: WHIMSY_NOTES.C4, partials: KALIMBA, attack: 0.003, release: 0.14, gain: 0.22 },
      { freq: WHIMSY_NOTES.G4, partials: KALIMBA, attack: 0.003, release: 0.14, gain: 0.14 },
    ],
  },
  // Read — high music box sparkle
  read: {
    start: { freq: WHIMSY_NOTES.A5, partials: MUSIC_BOX, attack: 0.001, release: 0.1, gain: 0.18 },
    ok: [
      { freq: WHIMSY_NOTES.E5, partials: MUSIC_BOX, attack: 0.002, release: 0.14, gain: 0.18 },
      { freq: WHIMSY_NOTES.A5, partials: MUSIC_BOX, attack: 0.002, release: 0.14, gain: 0.12 },
    ],
  },
  // Write — mid toy piano bonk, satisfying
  write: {
    start: { freq: WHIMSY_NOTES.D5, partials: TOY_PIANO, attack: 0.002, release: 0.12, gain: 0.24 },
    ok: [
      { freq: WHIMSY_NOTES.G5, partials: TOY_PIANO, attack: 0.002, release: 0.16, gain: 0.22 },
      { freq: WHIMSY_NOTES.D5, partials: TOY_PIANO, attack: 0.002, release: 0.16, gain: 0.14 },
    ],
  },
  // Search — kalimba shimmer sweep
  search: {
    start: { freq: WHIMSY_NOTES.D5, partials: KALIMBA, attack: 0.015, release: 0.22, gain: 0.2 },
    ok: [
      { freq: WHIMSY_NOTES.G5, partials: MUSIC_BOX, attack: 0.004, release: 0.18, gain: 0.2 },
      { freq: WHIMSY_NOTES.B5, partials: MUSIC_BOX, attack: 0.004, release: 0.18, gain: 0.12 },
    ],
  },
  // Agent — music box chord, magical spawn
  agent: {
    start: { freq: WHIMSY_NOTES.C5, partials: MUSIC_BOX, attack: 0.01, release: 0.55, gain: 0.26 },
    ok: [
      { freq: WHIMSY_NOTES.G5, partials: MUSIC_BOX, attack: 0.008, release: 0.45, gain: 0.24 },
      { freq: WHIMSY_NOTES.C6, partials: MUSIC_BOX, attack: 0.008, release: 0.45, gain: 0.16 },
    ],
  },
  // Default — toy xylophone D5
  default: {
    start: {
      freq: WHIMSY_NOTES.D5,
      partials: TOY_XYLOPHONE,
      attack: 0.002,
      release: 0.1,
      gain: 0.2,
    },
    ok: [
      { freq: WHIMSY_NOTES.D5, partials: TOY_XYLOPHONE, attack: 0.002, release: 0.14, gain: 0.22 },
      { freq: WHIMSY_NOTES.A5, partials: TOY_XYLOPHONE, attack: 0.002, release: 0.14, gain: 0.14 },
    ],
  },
};

// ---------------------------------------------------------------------------
// Chiptune (8-bit) synthesis — NES/Game Boy inspired
// Square and triangle waves, single-partial, sharp envelopes.
// ---------------------------------------------------------------------------

/** Square wave lead — classic NES pulse channel */
const CHIP_LEAD: Overtone[] = [{ ratio: 1, gain: 1.0, decay: 0.25 }];

/** Triangle wave bass — NES triangle channel, warm and smooth */
const CHIP_BASS: Overtone[] = [{ ratio: 1, gain: 1.0, decay: 0.4 }];

/** Quick arpeggio note — very short, staccato */
const CHIP_ARP: Overtone[] = [{ ratio: 1, gain: 1.0, decay: 0.12 }];

/** SFX hit — gritty with a bit of harmonic color */
const CHIP_SFX: Overtone[] = [
  { ratio: 1, gain: 1.0, decay: 0.1 },
  { ratio: 1.5, gain: 0.3, decay: 0.05 },
];

// A minor pentatonic — the classic chiptune scale
const CHIP_NOTES = {
  A2: 110.0,
  C3: 130.8,
  D3: 146.8,
  E3: 164.8,
  G3: 196.0,
  A3: 220.0,
  C4: 261.6,
  D4: 293.7,
  E4: 329.6,
  G4: 392.0,
  A4: 440.0,
  C5: 523.3,
  D5: 587.3,
  E5: 659.3,
  G5: 784.0,
  A5: 880.0,
  C6: 1046.5,
  E6: 1318.5,
};

const CHIPTUNE_EVENT_NOTES: Record<ChirpEvent, NoteSpec | NoteSpec[]> = {
  message_start: {
    freq: CHIP_NOTES.A4,
    partials: CHIP_LEAD,
    attack: 0.001,
    release: 0.08,
    gain: 0.3,
    waveform: 'square',
  },
  text_start: {
    freq: CHIP_NOTES.E5,
    partials: CHIP_LEAD,
    attack: 0.001,
    release: 0.05,
    gain: 0.2,
    waveform: 'square',
  },
  text_delta: {
    freq: CHIP_NOTES.A5,
    partials: CHIP_ARP,
    attack: 0.001,
    release: 0.02,
    gain: 0.0,
    waveform: 'square',
  },
  thinking_start: {
    freq: CHIP_NOTES.A2,
    partials: CHIP_BASS,
    attack: 0.01,
    release: 0.3,
    gain: 0.28,
    waveform: 'triangle',
  },
  tool_start: {
    freq: CHIP_NOTES.E4,
    partials: CHIP_LEAD,
    attack: 0.001,
    release: 0.06,
    gain: 0.24,
    waveform: 'square',
  },
  tool_result_ok: [
    {
      freq: CHIP_NOTES.A4,
      partials: CHIP_ARP,
      attack: 0.001,
      release: 0.06,
      gain: 0.24,
      waveform: 'square',
    },
    {
      freq: CHIP_NOTES.E5,
      partials: CHIP_ARP,
      attack: 0.001,
      release: 0.06,
      gain: 0.16,
      waveform: 'square',
    },
  ],
  tool_result_error: {
    freq: CHIP_NOTES.D3,
    partials: CHIP_SFX,
    attack: 0.001,
    release: 0.1,
    gain: 0.28,
    waveform: 'sawtooth',
  },
  tool_approval: [
    {
      freq: CHIP_NOTES.C5,
      partials: CHIP_LEAD,
      attack: 0.002,
      release: 0.3,
      gain: 0.26,
      waveform: 'square',
    },
    {
      freq: CHIP_NOTES.E5,
      partials: CHIP_LEAD,
      attack: 0.002,
      release: 0.3,
      gain: 0.2,
      waveform: 'square',
    },
    {
      freq: CHIP_NOTES.G5,
      partials: CHIP_LEAD,
      attack: 0.002,
      release: 0.3,
      gain: 0.14,
      waveform: 'square',
    },
  ],
  user_question: {
    freq: CHIP_NOTES.E4,
    partials: CHIP_LEAD,
    attack: 0.001,
    release: 0.08,
    gain: 0.0,
    waveform: 'square',
  },
  message_stop: [
    {
      freq: CHIP_NOTES.C5,
      partials: CHIP_LEAD,
      attack: 0.001,
      release: 0.2,
      gain: 0.26,
      waveform: 'square',
    },
    {
      freq: CHIP_NOTES.E5,
      partials: CHIP_LEAD,
      attack: 0.001,
      release: 0.2,
      gain: 0.18,
      waveform: 'square',
    },
    {
      freq: CHIP_NOTES.A5,
      partials: CHIP_LEAD,
      attack: 0.001,
      release: 0.2,
      gain: 0.12,
      waveform: 'square',
    },
  ],
  error: [
    {
      freq: CHIP_NOTES.D3,
      partials: CHIP_SFX,
      attack: 0.001,
      release: 0.15,
      gain: 0.3,
      waveform: 'sawtooth',
    },
    {
      freq: CHIP_NOTES.A2,
      partials: CHIP_SFX,
      attack: 0.001,
      release: 0.15,
      gain: 0.22,
      waveform: 'sawtooth',
    },
  ],
  cancelled: [
    {
      freq: CHIP_NOTES.E5,
      partials: CHIP_LEAD,
      attack: 0.001,
      release: 0.15,
      gain: 0.2,
      waveform: 'square',
    },
    {
      freq: CHIP_NOTES.C5,
      partials: CHIP_LEAD,
      attack: 0.001,
      release: 0.2,
      gain: 0.14,
      waveform: 'triangle',
    },
  ],
  command_success: [
    {
      freq: CHIP_NOTES.A4,
      partials: CHIP_ARP,
      attack: 0.001,
      release: 0.06,
      gain: 0.2,
      waveform: 'square',
    },
    {
      freq: CHIP_NOTES.E5,
      partials: CHIP_ARP,
      attack: 0.001,
      release: 0.06,
      gain: 0.12,
      waveform: 'square',
    },
  ],
  command_fail: {
    freq: CHIP_NOTES.D3,
    partials: CHIP_SFX,
    attack: 0.001,
    release: 0.08,
    gain: 0.22,
    waveform: 'sawtooth',
  },
  rich_appear: {
    freq: CHIP_NOTES.E5,
    partials: CHIP_LEAD,
    attack: 0.002,
    release: 0.1,
    gain: 0.16,
    waveform: 'triangle',
  },
  progress_complete: [
    {
      freq: CHIP_NOTES.A4,
      partials: CHIP_ARP,
      attack: 0.001,
      release: 0.15,
      gain: 0.22,
      waveform: 'square',
    },
    {
      freq: CHIP_NOTES.C5,
      partials: CHIP_ARP,
      attack: 0.001,
      release: 0.15,
      gain: 0.16,
      waveform: 'square',
    },
    {
      freq: CHIP_NOTES.E5,
      partials: CHIP_ARP,
      attack: 0.001,
      release: 0.15,
      gain: 0.12,
      waveform: 'square',
    },
    {
      freq: CHIP_NOTES.A5,
      partials: CHIP_ARP,
      attack: 0.001,
      release: 0.15,
      gain: 0.08,
      waveform: 'square',
    },
  ],
  chat_send: {
    freq: CHIP_NOTES.A5,
    partials: CHIP_ARP,
    attack: 0.001,
    release: 0.04,
    gain: 0.18,
    waveform: 'square',
  },
};

const CHIPTUNE_TOOL_NOTES: Record<
  ToolFamily,
  { start: NoteSpec | NoteSpec[]; ok: NoteSpec | NoteSpec[] }
> = {
  shell: {
    start: {
      freq: CHIP_NOTES.A3,
      partials: CHIP_BASS,
      attack: 0.001,
      release: 0.08,
      gain: 0.24,
      waveform: 'triangle',
    },
    ok: [
      {
        freq: CHIP_NOTES.A3,
        partials: CHIP_ARP,
        attack: 0.001,
        release: 0.08,
        gain: 0.22,
        waveform: 'square',
      },
      {
        freq: CHIP_NOTES.E4,
        partials: CHIP_ARP,
        attack: 0.001,
        release: 0.08,
        gain: 0.14,
        waveform: 'square',
      },
    ],
  },
  read: {
    start: {
      freq: CHIP_NOTES.E5,
      partials: CHIP_ARP,
      attack: 0.001,
      release: 0.06,
      gain: 0.18,
      waveform: 'square',
    },
    ok: [
      {
        freq: CHIP_NOTES.C5,
        partials: CHIP_ARP,
        attack: 0.001,
        release: 0.08,
        gain: 0.18,
        waveform: 'square',
      },
      {
        freq: CHIP_NOTES.E5,
        partials: CHIP_ARP,
        attack: 0.001,
        release: 0.08,
        gain: 0.12,
        waveform: 'square',
      },
    ],
  },
  write: {
    start: {
      freq: CHIP_NOTES.D4,
      partials: CHIP_LEAD,
      attack: 0.001,
      release: 0.08,
      gain: 0.24,
      waveform: 'square',
    },
    ok: [
      {
        freq: CHIP_NOTES.G4,
        partials: CHIP_ARP,
        attack: 0.001,
        release: 0.1,
        gain: 0.22,
        waveform: 'square',
      },
      {
        freq: CHIP_NOTES.D5,
        partials: CHIP_ARP,
        attack: 0.001,
        release: 0.1,
        gain: 0.14,
        waveform: 'square',
      },
    ],
  },
  search: {
    start: {
      freq: CHIP_NOTES.D5,
      partials: CHIP_LEAD,
      attack: 0.002,
      release: 0.12,
      gain: 0.2,
      waveform: 'triangle',
    },
    ok: [
      {
        freq: CHIP_NOTES.G4,
        partials: CHIP_ARP,
        attack: 0.001,
        release: 0.1,
        gain: 0.2,
        waveform: 'square',
      },
      {
        freq: CHIP_NOTES.D5,
        partials: CHIP_ARP,
        attack: 0.001,
        release: 0.1,
        gain: 0.12,
        waveform: 'square',
      },
    ],
  },
  agent: {
    start: {
      freq: CHIP_NOTES.A3,
      partials: CHIP_BASS,
      attack: 0.005,
      release: 0.3,
      gain: 0.26,
      waveform: 'triangle',
    },
    ok: [
      {
        freq: CHIP_NOTES.E4,
        partials: CHIP_LEAD,
        attack: 0.002,
        release: 0.2,
        gain: 0.24,
        waveform: 'square',
      },
      {
        freq: CHIP_NOTES.A4,
        partials: CHIP_LEAD,
        attack: 0.002,
        release: 0.2,
        gain: 0.16,
        waveform: 'square',
      },
    ],
  },
  default: {
    start: {
      freq: CHIP_NOTES.E4,
      partials: CHIP_LEAD,
      attack: 0.001,
      release: 0.06,
      gain: 0.2,
      waveform: 'square',
    },
    ok: [
      {
        freq: CHIP_NOTES.E4,
        partials: CHIP_ARP,
        attack: 0.001,
        release: 0.08,
        gain: 0.22,
        waveform: 'square',
      },
      {
        freq: CHIP_NOTES.A4,
        partials: CHIP_ARP,
        attack: 0.001,
        release: 0.08,
        gain: 0.14,
        waveform: 'square',
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// Classic (oscillator) synthesis — the original chirp engine configs
// Used when soundStyle === 'classic'
// ---------------------------------------------------------------------------

export type SoundStyle = 'classic' | 'melodic' | 'whimsy' | 'forest' | 'wind-chime' | 'chiptune';

interface ClassicConfig {
  freq: number;
  freq2?: number;
  type: OscillatorType;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  gain: number;
  gain2?: number;
  filter?: number;
}

const CLASSIC_CHIRPS: Record<ChirpEvent, ClassicConfig> = {
  message_start: {
    freq: 880,
    freq2: 1320,
    type: 'sine',
    attack: 0.008,
    decay: 0.1,
    sustain: 0.0,
    release: 0.18,
    gain: 0.28,
    gain2: 0.16,
  },
  text_start: {
    freq: 1400,
    type: 'sine',
    attack: 0.004,
    decay: 0.05,
    sustain: 0.0,
    release: 0.08,
    gain: 0.22,
  },
  text_delta: {
    freq: 2200,
    type: 'sine',
    attack: 0.002,
    decay: 0.018,
    sustain: 0.0,
    release: 0.025,
    gain: 0.14,
    filter: 3000,
  },
  thinking_start: {
    freq: 200,
    freq2: 300,
    type: 'sine',
    attack: 0.025,
    decay: 0.2,
    sustain: 0.0,
    release: 0.3,
    gain: 0.22,
    gain2: 0.12,
    filter: 550,
  },
  tool_start: {
    freq: 660,
    type: 'square',
    attack: 0.004,
    decay: 0.035,
    sustain: 0.0,
    release: 0.06,
    gain: 0.16,
    filter: 1100,
  },
  tool_result_ok: {
    freq: 880,
    freq2: 1108,
    type: 'sine',
    attack: 0.008,
    decay: 0.12,
    sustain: 0.0,
    release: 0.22,
    gain: 0.26,
    gain2: 0.14,
  },
  tool_result_error: {
    freq: 240,
    freq2: 180,
    type: 'sawtooth',
    attack: 0.01,
    decay: 0.14,
    sustain: 0.0,
    release: 0.22,
    gain: 0.22,
    gain2: 0.13,
    filter: 750,
  },
  tool_approval: {
    freq: 1047,
    freq2: 1319,
    type: 'sine',
    attack: 0.01,
    decay: 0.18,
    sustain: 0.12,
    release: 0.3,
    gain: 0.3,
    gain2: 0.16,
  },
  user_question: {
    freq: 440,
    type: 'sine',
    attack: 0.01,
    decay: 0.1,
    sustain: 0.0,
    release: 0.15,
    gain: 0.0,
  }, // handled by playClassicUserQuestion
  message_stop: {
    freq: 523,
    freq2: 659,
    type: 'sine',
    attack: 0.01,
    decay: 0.25,
    sustain: 0.0,
    release: 0.4,
    gain: 0.28,
    gain2: 0.15,
  },
  error: {
    freq: 150,
    freq2: 112,
    type: 'sawtooth',
    attack: 0.01,
    decay: 0.2,
    sustain: 0.06,
    release: 0.32,
    gain: 0.3,
    gain2: 0.18,
    filter: 550,
  },
  cancelled: {
    freq: 440,
    type: 'sine',
    attack: 0.01,
    decay: 0.35,
    sustain: 0.0,
    release: 0.45,
    gain: 0.18,
    filter: 900,
  },

  // Terminal: quick rising pair — shell success beep
  command_success: {
    freq: 880,
    freq2: 1320,
    type: 'square',
    attack: 0.003,
    decay: 0.04,
    sustain: 0.0,
    release: 0.08,
    gain: 0.18,
    gain2: 0.1,
    filter: 2000,
  },

  // Terminal: descending sawtooth buzz — shell fail
  command_fail: {
    freq: 200,
    freq2: 140,
    type: 'sawtooth',
    attack: 0.005,
    decay: 0.08,
    sustain: 0.0,
    release: 0.14,
    gain: 0.2,
    gain2: 0.12,
    filter: 600,
  },

  // Terminal: sine bloom — data appearing
  rich_appear: {
    freq: 1200,
    type: 'sine',
    attack: 0.015,
    decay: 0.1,
    sustain: 0.0,
    release: 0.15,
    gain: 0.14,
  },

  // Terminal: rising sine fanfare — progress done
  progress_complete: {
    freq: 523,
    freq2: 1047,
    type: 'sine',
    attack: 0.008,
    decay: 0.18,
    sustain: 0.0,
    release: 0.3,
    gain: 0.24,
    gain2: 0.14,
  },

  // Chat send — quick sine blip, crisp acknowledgement
  chat_send: {
    freq: 880,
    type: 'sine',
    attack: 0.003,
    decay: 0.06,
    sustain: 0.0,
    release: 0.04,
    gain: 0.18,
  },
};

type ClassicToolFamily = 'shell' | 'read' | 'write' | 'search' | 'agent' | 'default';

const CLASSIC_TOOL_CHIRPS: Record<ClassicToolFamily, { start: ClassicConfig; ok: ClassicConfig }> =
  {
    shell: {
      start: {
        freq: 110,
        type: 'square',
        attack: 0.003,
        decay: 0.04,
        sustain: 0.0,
        release: 0.07,
        gain: 0.2,
        filter: 600,
      },
      ok: {
        freq: 140,
        freq2: 220,
        type: 'square',
        attack: 0.003,
        decay: 0.06,
        sustain: 0.0,
        release: 0.1,
        gain: 0.18,
        gain2: 0.1,
        filter: 700,
      },
    },
    read: {
      start: {
        freq: 1800,
        type: 'sine',
        attack: 0.004,
        decay: 0.04,
        sustain: 0.0,
        release: 0.06,
        gain: 0.18,
      },
      ok: {
        freq: 1600,
        freq2: 2000,
        type: 'sine',
        attack: 0.006,
        decay: 0.08,
        sustain: 0.0,
        release: 0.12,
        gain: 0.2,
        gain2: 0.1,
      },
    },
    write: {
      start: {
        freq: 440,
        type: 'triangle',
        attack: 0.005,
        decay: 0.05,
        sustain: 0.0,
        release: 0.09,
        gain: 0.22,
        filter: 1400,
      },
      ok: {
        freq: 392,
        freq2: 523,
        type: 'triangle',
        attack: 0.005,
        decay: 0.12,
        sustain: 0.0,
        release: 0.18,
        gain: 0.24,
        gain2: 0.14,
        filter: 1600,
      },
    },
    search: {
      start: {
        freq: 600,
        freq2: 1200,
        type: 'sine',
        attack: 0.01,
        decay: 0.12,
        sustain: 0.0,
        release: 0.15,
        gain: 0.18,
        filter: 1800,
      },
      ok: {
        freq: 1400,
        freq2: 900,
        type: 'sine',
        attack: 0.008,
        decay: 0.14,
        sustain: 0.0,
        release: 0.18,
        gain: 0.22,
        gain2: 0.1,
      },
    },
    agent: {
      start: {
        freq: 80,
        freq2: 120,
        type: 'sine',
        attack: 0.03,
        decay: 0.25,
        sustain: 0.0,
        release: 0.35,
        gain: 0.24,
        gain2: 0.14,
        filter: 400,
      },
      ok: {
        freq: 220,
        freq2: 330,
        type: 'sine',
        attack: 0.015,
        decay: 0.2,
        sustain: 0.0,
        release: 0.3,
        gain: 0.24,
        gain2: 0.13,
        filter: 500,
      },
    },
    default: {
      start: {
        freq: 660,
        type: 'square',
        attack: 0.004,
        decay: 0.035,
        sustain: 0.0,
        release: 0.06,
        gain: 0.16,
        filter: 1100,
      },
      ok: {
        freq: 880,
        freq2: 1108,
        type: 'sine',
        attack: 0.008,
        decay: 0.12,
        sustain: 0.0,
        release: 0.22,
        gain: 0.26,
        gain2: 0.14,
      },
    },
  };

// ---------------------------------------------------------------------------
// Cooldowns
// ---------------------------------------------------------------------------

const EVENT_COOLDOWNS: Partial<Record<ChirpEvent, number>> = {
  text_delta: 160,
  tool_start: 120,
  tool_result_ok: 200,
  text_start: 100,
  command_success: 200,
  command_fail: 200,
  rich_appear: 300,
  progress_complete: 500,
  chat_send: 300,
};

// ---------------------------------------------------------------------------
// Ambient soundscape definitions — per-hypertheme generative drones
// ---------------------------------------------------------------------------

interface AmbientVoice {
  freq: number;
  gain: number;
  type: OscillatorType;
}
interface AmbientDef {
  voices: AmbientVoice[];
  lfoRate: number;
  lfoDepth: number;
  gain: number;
}

const AMBIENT_DEFS: Record<string, AmbientDef> = {
  // Dark electronic hum — A1 fundamental with fifth
  tech: {
    voices: [
      { freq: 55, gain: 0.35, type: 'sine' },
      { freq: 82.4, gain: 0.15, type: 'sine' },
      { freq: 165, gain: 0.06, type: 'triangle' },
    ],
    lfoRate: 0.07,
    lfoDepth: 0.15,
    gain: 0.04,
  },
  // Mysterious D2 drone with distant overtones
  arcane: {
    voices: [
      { freq: 73.4, gain: 0.3, type: 'sine' },
      { freq: 110, gain: 0.2, type: 'sine' },
      { freq: 220, gain: 0.05, type: 'triangle' },
    ],
    lfoRate: 0.04,
    lfoDepth: 0.25,
    gain: 0.035,
  },
  // Floating C2 pad, very slow modulation
  ethereal: {
    voices: [
      { freq: 65.4, gain: 0.25, type: 'sine' },
      { freq: 98, gain: 0.2, type: 'sine' },
      { freq: 196, gain: 0.08, type: 'sine' },
    ],
    lfoRate: 0.03,
    lfoDepth: 0.3,
    gain: 0.03,
  },
  // Warm Bb1 study drone, minimal movement
  study: {
    voices: [
      { freq: 61.7, gain: 0.3, type: 'sine' },
      { freq: 92.5, gain: 0.12, type: 'sine' },
    ],
    lfoRate: 0.06,
    lfoDepth: 0.1,
    gain: 0.03,
  },
  // Deep cosmic G1 with wide harmonic spread
  astral: {
    voices: [
      { freq: 49, gain: 0.3, type: 'sine' },
      { freq: 73.4, gain: 0.2, type: 'sine' },
      { freq: 147, gain: 0.1, type: 'sine' },
      { freq: 294, gain: 0.03, type: 'sine' },
    ],
    lfoRate: 0.02,
    lfoDepth: 0.35,
    gain: 0.035,
  },
  // Deepest E1 drone, very slow ebb
  'astral-midnight': {
    voices: [
      { freq: 41.2, gain: 0.35, type: 'sine' },
      { freq: 61.7, gain: 0.2, type: 'sine' },
      { freq: 123.5, gain: 0.08, type: 'sine' },
    ],
    lfoRate: 0.015,
    lfoDepth: 0.4,
    gain: 0.03,
  },
  // Dark Bb1 sawtooth buzz, industrial undertone
  goth: {
    voices: [
      { freq: 46.2, gain: 0.35, type: 'sawtooth' },
      { freq: 69.3, gain: 0.15, type: 'sine' },
      { freq: 138.6, gain: 0.06, type: 'sine' },
    ],
    lfoRate: 0.05,
    lfoDepth: 0.2,
    gain: 0.025,
  },
  // Enchanted D2 forest hum with triangle shimmer
  'magic-forest': {
    voices: [
      { freq: 73.4, gain: 0.25, type: 'sine' },
      { freq: 110, gain: 0.18, type: 'sine' },
      { freq: 146.8, gain: 0.1, type: 'sine' },
      { freq: 220, gain: 0.04, type: 'triangle' },
    ],
    lfoRate: 0.035,
    lfoDepth: 0.25,
    gain: 0.035,
  },
};

// ---------------------------------------------------------------------------
// Focus noise presets — filtered white noise generators
// ---------------------------------------------------------------------------

interface FocusPreset {
  filterType: BiquadFilterType;
  filterFreq: number;
  filterQ: number;
  gain: number;
}

const FOCUS_PRESETS: Record<string, FocusPreset> = {
  white: { filterType: 'allpass', filterFreq: 1000, filterQ: 0, gain: 0.04 },
  pink: { filterType: 'lowpass', filterFreq: 1500, filterQ: 0.5, gain: 0.06 },
  brown: { filterType: 'lowpass', filterFreq: 400, filterQ: 0.7, gain: 0.08 },
  rain: { filterType: 'bandpass', filterFreq: 3000, filterQ: 1.5, gain: 0.07 },
  vinyl: { filterType: 'bandpass', filterFreq: 800, filterQ: 2.0, gain: 0.05 },
};

// ---------------------------------------------------------------------------
// Reverb impulse response definitions — per-hypertheme spatial character
// ---------------------------------------------------------------------------

interface ReverbDef {
  duration: number; // impulse length in seconds
  decay: number; // exponential decay time constant
  mix: number; // wet level (0–1)
  filterFreq: number; // lowpass filter on impulse (darker = lower)
}

const REVERB_DEFS: Record<string, ReverbDef> = {
  tech: { duration: 0.8, decay: 0.3, mix: 0.15, filterFreq: 4000 },
  arcane: { duration: 2.0, decay: 0.8, mix: 0.25, filterFreq: 3000 },
  ethereal: { duration: 3.5, decay: 1.5, mix: 0.35, filterFreq: 6000 },
  study: { duration: 0.6, decay: 0.2, mix: 0.1, filterFreq: 3500 },
  astral: { duration: 4.0, decay: 1.8, mix: 0.3, filterFreq: 5000 },
  'astral-midnight': { duration: 5.0, decay: 2.2, mix: 0.35, filterFreq: 4000 },
  goth: { duration: 2.5, decay: 1.0, mix: 0.25, filterFreq: 2000 },
  'magic-forest': { duration: 2.0, decay: 0.7, mix: 0.2, filterFreq: 5000 },
};

// ---------------------------------------------------------------------------
// Rhythm groove templates — timing offsets within a beat (normalized 0–1)
// ---------------------------------------------------------------------------

type RhythmPattern = 'straight' | 'swing' | 'shuffle' | 'dotted';

const GROOVE_TEMPLATES: Record<RhythmPattern, number[]> = {
  straight: [0, 0.25, 0.5, 0.75],
  swing: [0, 0.33, 0.5, 0.83],
  shuffle: [0, 0.375, 0.5, 0.875],
  dotted: [0, 0.375, 0.75],
};

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class ChirpEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private lastFired = new Map<ChirpEvent, number>();
  private noiseBuffer: AudioBuffer | null = null;
  private volume = 1.0;
  private style: SoundStyle = 'melodic';

  // ── Spatial audio ──
  private defaultPan = 0; // -1 (left) to 1 (right)

  // ── Harmonic context ──
  private noteHistory: number[] = []; // ring buffer of recent frequencies
  private readonly NOTE_HISTORY_SIZE = 6;

  // ── Adaptive tempo / beat clock ──
  private beatBpm = 120;
  private beatPhase = 0; // time of last beat start
  private deltaTimestamps: number[] = []; // recent text_delta arrival times
  private readonly DELTA_WINDOW = 12; // how many deltas to average

  // ── Completion tracking ──
  private streamToolCount = 0;

  // ── Ambient soundscape ──
  private ambientOscs: OscillatorNode[] = [];
  private ambientGains: GainNode[] = [];
  private ambientLfos: OscillatorNode[] = [];
  private ambientMaster: GainNode | null = null;
  private ambientTheme: string | null = null;

  // ── Focus noise ──
  private focusSource: AudioBufferSourceNode | null = null;
  private focusGain: GainNode | null = null;
  private focusPreset: string | null = null;
  private longNoiseBuffer: AudioBuffer | null = null;

  // ── Musical typing ──
  private keystrokeIndex = 0;

  // ── Reverb ──
  private reverbNode: ConvolverNode | null = null;
  private reverbGain: GainNode | null = null;
  private currentReverbTheme: string | null = null;

  // ── Sidechain ducking ──
  private ambientTargetGain = 0;
  private focusTargetGain = 0;

  // ── Error escalation ──
  private consecutiveErrors = 0;

  // ── Rhythm patterns ──
  private rhythmPattern: RhythmPattern = 'straight';
  private rhythmPosition = 0;

  // ── MIDI output ──
  private midiOutput: MIDIOutput | null = null;
  private midiEnabled = false;

  // ── Generative composition ──
  private generativeMode = false;
  private genPadOscs: OscillatorNode[] = [];
  private genPadGains: GainNode[] = [];
  private genPadMaster: GainNode | null = null;
  private genRoot = 261.6; // C4

  // ── Autoplay policy gate ──
  // True only after the first user gesture calls unlock().
  // Prevents scheduling audio on a suspended AudioContext (which would
  // cause all events to queue at currentTime=0 and burst when resumed).
  private unlocked = false;

  // ── Style blending ──
  private blendRatio = 0;
  private secondaryStyle: SoundStyle | null = null;

  private createContext(): AudioContext {
    const ctx = new AudioContext();

    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -16;
    this.compressor.knee.value = 8;
    this.compressor.ratio.value = 3;
    this.compressor.attack.value = 0.005;
    this.compressor.release.value = 0.2;

    // Gentle high shelf to add air, slight low-cut to avoid muddiness
    const hiShelf = ctx.createBiquadFilter();
    hiShelf.type = 'highshelf';
    hiShelf.frequency.value = 6000;
    hiShelf.gain.value = 2.5; // +2.5 dB above 6 kHz — adds sparkle

    const loShelf = ctx.createBiquadFilter();
    loShelf.type = 'highpass';
    loShelf.frequency.value = 60; // remove sub-bass rumble

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this.volume;

    // Signal path: masterGain → loShelf → hiShelf → compressor → destination (dry)
    //              masterGain → reverbNode → reverbGain → destination     (wet send)
    this.masterGain.connect(loShelf);
    loShelf.connect(hiShelf);
    hiShelf.connect(this.compressor);
    this.compressor.connect(ctx.destination);

    // Reverb send — initially silent, activated by setReverb()
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0;
    this.reverbGain.connect(ctx.destination);

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
    });

    return ctx;
  }

  private ensureContext(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      this.ctx = this.createContext();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  /**
   * Play a single additive synthesis note.
   * Each partial gets its own oscillator + gain node with an
   * exponential decay envelope — far more natural than linear ramps.
   */
  private playNote(spec: NoteSpec, startOffset = 0, pan?: number): void {
    const ctx = this.ensureContext();
    const master = this.masterGain!;
    const t = ctx.currentTime + startOffset;
    const usePan = pan ?? this.defaultPan;

    for (const ot of spec.partials) {
      const freq =
        spec.freq * ot.ratio + (spec.detune ? spec.freq * ot.ratio * (spec.detune / 1200) : 0);
      const peakGain = spec.gain * ot.gain;

      const osc = ctx.createOscillator();
      const env = ctx.createGain();

      osc.type = spec.waveform ?? 'sine';
      osc.frequency.setValueAtTime(freq, t);

      // Attack: linear ramp to peak
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(peakGain, t + spec.attack);

      // Decay: exponential — this is what makes it sound like a real struck instrument.
      // setTargetAtTime approaches 0 exponentially with the given time constant.
      const decayEnd = t + spec.attack + ot.decay;
      env.gain.setTargetAtTime(0.0001, t + spec.attack, ot.decay * 0.4);

      // Release tail — linear to silence
      const noteEnd = decayEnd + spec.release;
      env.gain.setValueAtTime(0.0001, decayEnd);
      env.gain.linearRampToValueAtTime(0, noteEnd);

      osc.connect(env);

      // Spatial panning — route through StereoPannerNode when non-zero
      if (usePan !== 0) {
        const panner = ctx.createStereoPanner();
        panner.pan.setValueAtTime(usePan, t);
        env.connect(panner);
        panner.connect(master);
      } else {
        env.connect(master);
      }

      osc.start(t);
      osc.stop(noteEnd + 0.05);
    }

    // Record frequency for harmonic context
    this.recordNote(spec.freq);

    // MIDI output (if enabled)
    if (this.midiEnabled && this.midiOutput) {
      const maxDecay = Math.max(...spec.partials.map((p) => p.decay));
      this.sendMidiNote(spec.freq, spec.gain, spec.attack + maxDecay + spec.release);
    }
  }

  private playSpec(spec: NoteSpec | NoteSpec[], startOffset = 0, pan?: number): void {
    if (Array.isArray(spec)) {
      for (const s of spec) this.playNote(s, startOffset, pan);
    } else {
      this.playNote(spec, startOffset, pan);
    }
  }

  /**
   * Soft brush stroke — replaces the old scribble noise burst.
   * Filtered noise shaped to sound like a light brush on a drumhead:
   * narrower band, gentler gain, softer onset.
   */
  private makeNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuffer && this.noiseBuffer.sampleRate === ctx.sampleRate) {
      return this.noiseBuffer;
    }
    const length = Math.ceil(ctx.sampleRate * 0.07);
    const buf = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;
    return buf;
  }

  private playBrush(): void {
    const ctx = this.ensureContext();
    const master = this.masterGain!;
    const now = ctx.currentTime;
    const buf = this.makeNoiseBuffer(ctx);
    const dur = 0.038;

    // Soft brush: one bandpass band around 2.5 kHz, gentle gain
    const src = ctx.createBufferSource();
    src.buffer = buf;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2500;
    bp.Q.value = 1.8;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.22, now + 0.005); // gentle onset
    env.gain.setTargetAtTime(0.0001, now + 0.005, 0.018);

    src.connect(bp);
    bp.connect(env);
    env.connect(master);
    src.start(now);
    src.stop(now + dur + 0.01);
  }

  /**
   * "Huh?" — three marimba notes with rising pitch, interrogative contour.
   * E4 → G4 → B4→D5 (the last note bends upward like a spoken question).
   */
  private playUserQuestion(): void {
    const ctx = this.ensureContext();
    const master = this.masterGain!;
    const now = ctx.currentTime;

    const marimbaTone = (
      startT: number,
      freqA: number,
      freqB: number,
      dur: number,
      gain: number,
    ) => {
      for (const ot of MARIMBA) {
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        const peakGain = gain * ot.gain;

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freqA * ot.ratio, now + startT);
        // Bend the fundamental only on the last note
        if (freqB !== freqA && ot.ratio === 1) {
          osc.frequency.linearRampToValueAtTime(freqB * ot.ratio, now + startT + dur);
        }

        env.gain.setValueAtTime(0, now + startT);
        env.gain.linearRampToValueAtTime(peakGain, now + startT + 0.005);
        env.gain.setTargetAtTime(0.0001, now + startT + 0.005, ot.decay * 0.4);
        env.gain.setValueAtTime(0.0001, now + startT + dur);
        env.gain.linearRampToValueAtTime(0, now + startT + dur + 0.06);

        osc.connect(env);
        env.connect(master);
        osc.start(now + startT);
        osc.stop(now + startT + dur + 0.1);
      }
    };

    //             start  fA           fB           dur   gain
    marimbaTone(0.0, NOTES.E4, NOTES.E4, 0.08, 0.24);
    marimbaTone(0.1, NOTES.G4, NOTES.G4, 0.08, 0.26);
    marimbaTone(0.21, NOTES.A4, NOTES.D5, 0.32, 0.32); // bends up — the "?"
  }

  /**
   * Rubber-duck squeak — replaces text_delta in whimsy mode.
   * A very short bandpass noise burst tuned around 1.8–3.5 kHz
   * with a fast attack/release to sound like a tiny toy squeak.
   */
  private playWhimsySqueak(): void {
    const ctx = this.ensureContext();
    const master = this.masterGain!;
    const now = ctx.currentTime;
    const buf = this.makeNoiseBuffer(ctx);
    const dur = 0.028;

    // Two bandpass bands for the characteristic double-peak of a squeeze toy
    const squeakBand = (center: number, Q: number, gain: number) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = center;
      bp.Q.value = Q;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(gain, now + 0.003);
      env.gain.setTargetAtTime(0.0001, now + 0.003, 0.012);
      src.connect(bp);
      bp.connect(env);
      env.connect(master);
      src.start(now);
      src.stop(now + dur + 0.005);
    };

    squeakBand(2200, 3.5, 0.28);
    squeakBand(3800, 5.0, 0.14);
  }

  /**
   * Whimsy user question — "doo-doo-doo?" in toy piano.
   * Three toy piano notes rising with a little upward bend on the last note.
   */
  private playWhimsyQuestion(): void {
    const ctx = this.ensureContext();
    const master = this.masterGain!;
    const now = ctx.currentTime;

    const toyNote = (startT: number, freqA: number, freqB: number, dur: number, gain: number) => {
      for (const ot of TOY_PIANO) {
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        const peakGain = gain * ot.gain;
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freqA * ot.ratio, now + startT);
        if (freqB !== freqA && ot.ratio === 1) {
          osc.frequency.linearRampToValueAtTime(freqB * ot.ratio, now + startT + dur);
        }
        env.gain.setValueAtTime(0, now + startT);
        env.gain.linearRampToValueAtTime(peakGain, now + startT + 0.002);
        env.gain.setTargetAtTime(0.0001, now + startT + 0.002, ot.decay * 0.4);
        env.gain.setValueAtTime(0.0001, now + startT + dur);
        env.gain.linearRampToValueAtTime(0, now + startT + dur + 0.05);
        osc.connect(env);
        env.connect(master);
        osc.start(now + startT);
        osc.stop(now + startT + dur + 0.08);
      }
    };

    //          start  fA                     fB                     dur   gain
    toyNote(0.0, WHIMSY_NOTES.E5, WHIMSY_NOTES.E5, 0.07, 0.24);
    toyNote(0.09, WHIMSY_NOTES.G5, WHIMSY_NOTES.G5, 0.07, 0.26);
    toyNote(0.19, WHIMSY_NOTES.A5, WHIMSY_NOTES.C6, 0.28, 0.3); // bends up!
  }

  /**
   * Forest rustle — replaces text_delta in forest mode.
   * Soft filtered noise shaped like wind through leaves,
   * with a gentle high-frequency shimmer and a low rustle undertone.
   * Much gentler and more organic than the tech brush stroke.
   */
  private playForestRustle(): void {
    const ctx = this.ensureContext();
    const master = this.masterGain!;
    const now = ctx.currentTime;
    const buf = this.makeNoiseBuffer(ctx);
    const dur = 0.045;

    // Leafy rustle: broad bandpass around 1.8 kHz, very soft
    const src = ctx.createBufferSource();
    src.buffer = buf;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 1.2; // wide band = natural sounding

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.16, now + 0.008); // soft onset
    env.gain.setTargetAtTime(0.0001, now + 0.008, 0.022);

    src.connect(bp);
    bp.connect(env);
    env.connect(master);
    src.start(now);
    src.stop(now + dur + 0.01);

    // Add a tiny fairy sparkle overtone for magic
    const sparkle = ctx.createOscillator();
    const sparkleEnv = ctx.createGain();
    sparkle.type = 'sine';
    sparkle.frequency.setValueAtTime(FOREST_NOTES.D6, now);
    sparkleEnv.gain.setValueAtTime(0, now);
    sparkleEnv.gain.linearRampToValueAtTime(0.04, now + 0.004);
    sparkleEnv.gain.setTargetAtTime(0.0001, now + 0.004, 0.015);
    sparkle.connect(sparkleEnv);
    sparkleEnv.connect(master);
    sparkle.start(now);
    sparkle.stop(now + dur + 0.01);
  }

  /**
   * Forest question — "hoo-hoo-hoo?" in wooden flute.
   * Three ascending flute tones with the last bending upward,
   * like a woodland creature calling a question through the trees.
   */
  private playForestQuestion(): void {
    const ctx = this.ensureContext();
    const master = this.masterGain!;
    const now = ctx.currentTime;

    const fluteNote = (startT: number, freqA: number, freqB: number, dur: number, gain: number) => {
      for (const ot of WOODEN_FLUTE) {
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        const peakGain = gain * ot.gain;
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freqA * ot.ratio, now + startT);
        if (freqB !== freqA && ot.ratio === 1) {
          osc.frequency.linearRampToValueAtTime(freqB * ot.ratio, now + startT + dur);
        }
        env.gain.setValueAtTime(0, now + startT);
        env.gain.linearRampToValueAtTime(peakGain, now + startT + 0.008); // breathy onset
        env.gain.setTargetAtTime(0.0001, now + startT + 0.008, ot.decay * 0.4);
        env.gain.setValueAtTime(0.0001, now + startT + dur);
        env.gain.linearRampToValueAtTime(0, now + startT + dur + 0.06);
        osc.connect(env);
        env.connect(master);
        osc.start(now + startT);
        osc.stop(now + startT + dur + 0.1);
      }
    };

    //             start  fA                    fB                    dur   gain
    fluteNote(0.0, FOREST_NOTES.G4, FOREST_NOTES.G4, 0.09, 0.22);
    fluteNote(0.11, FOREST_NOTES.A4, FOREST_NOTES.A4, 0.09, 0.24);
    fluteNote(0.22, FOREST_NOTES.B4, FOREST_NOTES.D5, 0.3, 0.3); // bends up — the "?"
  }

  /**
   * Wind chime breeze — replaces text_delta in wind-chime mode.
   * A gentle, airy shimmer: soft high-passed noise shaped like
   * a light breeze, with a delicate high-frequency tinkle overtone.
   * Uses a higher centre frequency and wider band for a more open,
   * spacious airiness rather than a tight hiss.
   */
  private playWindChimeBreeze(): void {
    const ctx = this.ensureContext();
    const master = this.masterGain!;
    const now = ctx.currentTime;
    const buf = this.makeNoiseBuffer(ctx);
    const dur = 0.04;

    // Airy breeze: higher bandpass at 3.2 kHz, very wide = spacious air
    const src = ctx.createBufferSource();
    src.buffer = buf;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3200;
    bp.Q.value = 0.5; // very wide band = open, spacious breeze

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.08, now + 0.006); // soft onset
    env.gain.setTargetAtTime(0.0001, now + 0.006, 0.015);

    src.connect(bp);
    bp.connect(env);
    env.connect(master);
    src.start(now);
    src.stop(now + dur + 0.01);

    // Add a tiny pure tinkle overtone for sparkle
    const tinkle = ctx.createOscillator();
    const tinkleEnv = ctx.createGain();
    tinkle.type = 'sine';
    tinkle.frequency.setValueAtTime(CHIME_NOTES.F6, now);
    tinkleEnv.gain.setValueAtTime(0, now);
    tinkleEnv.gain.linearRampToValueAtTime(0.025, now + 0.003);
    tinkleEnv.gain.setTargetAtTime(0.0001, now + 0.003, 0.012);
    tinkle.connect(tinkleEnv);
    tinkleEnv.connect(master);
    tinkle.start(now);
    tinkle.stop(now + dur + 0.01);
  }

  /**
   * Wind chime question — ascending crystal chime tones.
   * Three brightening chime strikes (F5 → A5 → C6 bend up),
   * using consonant intervals for a clean, open rising question.
   */
  private playWindChimeQuestion(): void {
    const ctx = this.ensureContext();
    const master = this.masterGain!;
    const now = ctx.currentTime;

    const chimeStrike = (
      startT: number,
      freqA: number,
      freqB: number,
      dur: number,
      gain: number,
    ) => {
      for (const ot of CRYSTAL_CHIME) {
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        const peakGain = gain * ot.gain;
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freqA * ot.ratio, now + startT);
        if (freqB !== freqA && ot.ratio === 1) {
          osc.frequency.linearRampToValueAtTime(freqB * ot.ratio, now + startT + dur);
        }
        env.gain.setValueAtTime(0, now + startT);
        env.gain.linearRampToValueAtTime(peakGain, now + startT + 0.003);
        env.gain.setTargetAtTime(0.0001, now + startT + 0.003, ot.decay * 0.35);
        env.gain.setValueAtTime(0.0001, now + startT + dur);
        env.gain.linearRampToValueAtTime(0, now + startT + dur + 0.04);
        osc.connect(env);
        env.connect(master);
        osc.start(now + startT);
        osc.stop(now + startT + dur + 0.08);
      }
    };

    //                start  fA                  fB                  dur   gain
    chimeStrike(0.0, CHIME_NOTES.F5, CHIME_NOTES.F5, 0.07, 0.2);
    chimeStrike(0.09, CHIME_NOTES.A5, CHIME_NOTES.A5, 0.07, 0.22);
    chimeStrike(0.19, CHIME_NOTES.C6, CHIME_NOTES.F6, 0.22, 0.26); // bends up — the "?"
  }

  toolStart(name: string) {
    if (!this.unlocked) return;

    const key: ChirpEvent = 'tool_start';
    const cooldown = EVENT_COOLDOWNS[key];
    if (cooldown !== undefined) {
      const now = performance.now();
      if (now - (this.lastFired.get(key) ?? 0) < cooldown) return;
      this.lastFired.set(key, now);
    }
    try {
      if (this.style === 'classic') {
        this.playClassicConfig(CLASSIC_TOOL_CHIRPS[toolFamily(name)].start);
      } else if (this.style === 'whimsy') {
        this.playSpec(WHIMSY_TOOL_NOTES[toolFamily(name)].start);
      } else if (this.style === 'forest') {
        this.playSpec(FOREST_TOOL_NOTES[toolFamily(name)].start);
      } else if (this.style === 'wind-chime') {
        this.playSpec(WIND_CHIME_TOOL_NOTES[toolFamily(name)].start);
      } else if (this.style === 'chiptune') {
        this.playSpec(CHIPTUNE_TOOL_NOTES[toolFamily(name)].start);
      } else {
        this.playSpec(TOOL_NOTES[toolFamily(name)].start);
      }
      this.duckAmbient();
    } catch (e) {
      console.warn('[ChirpEngine] playback error:', e);
    }
  }

  toolResultOk(name: string) {
    if (!this.unlocked) return;

    const key: ChirpEvent = 'tool_result_ok';
    const cooldown = EVENT_COOLDOWNS[key];
    if (cooldown !== undefined) {
      const now = performance.now();
      if (now - (this.lastFired.get(key) ?? 0) < cooldown) return;
      this.lastFired.set(key, now);
    }
    this.consecutiveErrors = 0; // Reset error escalation on success
    try {
      if (this.style === 'classic') {
        this.playClassicConfig(CLASSIC_TOOL_CHIRPS[toolFamily(name)].ok);
      } else if (this.style === 'whimsy') {
        this.playSpec(WHIMSY_TOOL_NOTES[toolFamily(name)].ok);
      } else if (this.style === 'forest') {
        this.playSpec(FOREST_TOOL_NOTES[toolFamily(name)].ok);
      } else if (this.style === 'wind-chime') {
        this.playSpec(WIND_CHIME_TOOL_NOTES[toolFamily(name)].ok);
      } else if (this.style === 'chiptune') {
        this.playSpec(CHIPTUNE_TOOL_NOTES[toolFamily(name)].ok);
      } else {
        this.playSpec(TOOL_NOTES[toolFamily(name)].ok);
      }
      this.duckAmbient();
    } catch (e) {
      console.warn('[ChirpEngine] playback error:', e);
    }
  }

  chirp(event: ChirpEvent) {
    if (!this.unlocked) return; // No user gesture yet — drop the event

    const cooldown = EVENT_COOLDOWNS[event];
    if (cooldown !== undefined) {
      const now = performance.now();
      if (now - (this.lastFired.get(event) ?? 0) < cooldown) return;
      this.lastFired.set(event, now);
    }

    // Stream lifecycle tracking
    if (event === 'message_start') {
      this.resetStreamTracking();
      this.consecutiveErrors = 0;
      if (this.generativeMode) this.genOnEvent(event);
    }
    if (event === 'text_delta') this.recordDelta();

    // Error escalation tracking
    if (event === 'tool_result_error' || event === 'error') {
      this.consecutiveErrors++;
    } else if (event === 'tool_result_ok' || event === 'message_stop') {
      this.consecutiveErrors = 0;
    }

    // Rhythm quantization offset for text_delta
    const rhythmOffset =
      event === 'text_delta' && this.rhythmPattern !== 'straight' ? this.getGrooveOffset() : 0;

    try {
      // Generative mode: route events to composition engine
      if (this.generativeMode && event !== 'text_delta') {
        this.genOnEvent(event);
      }

      // Style blending: if active, try blended spec first
      if (
        this.secondaryStyle &&
        this.blendRatio > 0 &&
        event !== 'text_delta' &&
        event !== 'user_question'
      ) {
        const blended = this.getBlendedSpec(event);
        if (blended) {
          this.playSpec(blended, rhythmOffset);
          this.duckAmbient();
          return;
        }
      }

      if (this.style === 'classic') {
        if (event === 'text_delta') {
          this.playClassicScribble();
          this.duckAmbient();
          return;
        }
        if (event === 'user_question') {
          this.playClassicUserQuestion();
          this.duckAmbient();
          return;
        }
        const cfg = CLASSIC_CHIRPS[event];
        if (cfg) {
          // Error escalation: boost gain on consecutive errors
          if (this.consecutiveErrors > 1 && (event === 'tool_result_error' || event === 'error')) {
            const escalated = {
              ...cfg,
              gain: Math.min(0.5, cfg.gain * (1 + this.consecutiveErrors * 0.15)),
            };
            this.playClassicConfig(escalated);
          } else {
            this.playClassicConfig(cfg);
          }
        }
        this.duckAmbient();
        return;
      }

      if (this.style === 'chiptune') {
        if (event === 'text_delta') {
          this.playChiptuneBlip();
          this.duckAmbient();
          return;
        }
        if (event === 'user_question') {
          this.playChiptuneQuestion();
          this.duckAmbient();
          return;
        }
        const spec = CHIPTUNE_EVENT_NOTES[event];
        if (!spec) return;
        this.playSpec(spec, rhythmOffset);
        this.duckAmbient();
        return;
      }

      if (this.style === 'whimsy') {
        if (event === 'text_delta') {
          this.playWhimsySqueak();
          this.duckAmbient();
          return;
        }
        if (event === 'user_question') {
          this.playWhimsyQuestion();
          this.duckAmbient();
          return;
        }
        const spec = WHIMSY_EVENT_NOTES[event];
        if (!spec) return;
        this.playSpec(spec, rhythmOffset);
        this.duckAmbient();
        return;
      }

      if (this.style === 'forest') {
        if (event === 'text_delta') {
          this.playForestRustle();
          this.duckAmbient();
          return;
        }
        if (event === 'user_question') {
          this.playForestQuestion();
          this.duckAmbient();
          return;
        }
        const spec = FOREST_EVENT_NOTES[event];
        if (!spec) return;
        this.playSpec(spec, rhythmOffset);
        this.duckAmbient();
        return;
      }

      if (this.style === 'wind-chime') {
        if (event === 'text_delta') {
          this.playWindChimeBreeze();
          this.duckAmbient();
          return;
        }
        if (event === 'user_question') {
          this.playWindChimeQuestion();
          this.duckAmbient();
          return;
        }
        const spec = WIND_CHIME_EVENT_NOTES[event];
        if (!spec) return;
        this.playSpec(spec, rhythmOffset);
        this.duckAmbient();
        return;
      }

      // Melodic path
      if (event === 'text_delta') {
        this.playBrush();
        this.duckAmbient();
        return;
      }
      if (event === 'user_question') {
        this.playUserQuestion();
        this.duckAmbient();
        return;
      }

      // Error escalation for additive synthesis styles
      if (this.consecutiveErrors > 1 && (event === 'tool_result_error' || event === 'error')) {
        const spec = EVENT_NOTES[event];
        if (spec) {
          const escalate = (s: NoteSpec): NoteSpec => ({
            ...s,
            gain: Math.min(0.5, s.gain * (1 + this.consecutiveErrors * 0.12)),
            detune: (s.detune ?? 0) + this.consecutiveErrors * 15, // increasingly detuned
          });
          if (Array.isArray(spec)) {
            this.playSpec(spec.map(escalate), rhythmOffset);
          } else {
            this.playSpec(escalate(spec), rhythmOffset);
          }
          this.duckAmbient();
          return;
        }
      }

      const spec = EVENT_NOTES[event];
      if (!spec) return;
      this.playSpec(spec, rhythmOffset);
      this.duckAmbient();
    } catch (e) {
      console.warn('[ChirpEngine] playback error:', e);
    }

    // Scaled completion fanfare after message_stop (when tools were used)
    if (event === 'message_stop' && this.streamToolCount > 1) {
      try {
        this.completionFanfare();
      } catch (_) {
        /* swallow */
      }
    }
  }

  // ── Classic synthesis playback ─────────────────────────────────────────────

  private playClassicConfig(cfg: ClassicConfig): void {
    const ctx = this.ensureContext();
    const master = this.masterGain!;
    const now = ctx.currentTime;

    const playOsc = (freq: number, gainPeak: number) => {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = cfg.type;
      osc.frequency.setValueAtTime(freq, now);
      if (cfg.freq2 && freq === cfg.freq) {
        osc.frequency.linearRampToValueAtTime(cfg.freq2, now + cfg.attack + cfg.decay);
      }
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(gainPeak, now + cfg.attack);
      env.gain.linearRampToValueAtTime(gainPeak * cfg.sustain, now + cfg.attack + cfg.decay);
      env.gain.linearRampToValueAtTime(0, now + cfg.attack + cfg.decay + cfg.release);
      if (cfg.filter) {
        const lpf = ctx.createBiquadFilter();
        lpf.type = 'lowpass';
        lpf.frequency.value = cfg.filter;
        osc.connect(lpf);
        lpf.connect(env);
      } else {
        osc.connect(env);
      }
      env.connect(master);
      osc.start(now);
      osc.stop(now + cfg.attack + cfg.decay + cfg.release + 0.05);
    };

    playOsc(cfg.freq, cfg.gain);

    if (cfg.freq2 && cfg.gain2 !== undefined) {
      const harm = ctx.createOscillator();
      const harmEnv = ctx.createGain();
      harm.type = 'sine';
      harm.frequency.setValueAtTime(cfg.freq2, now);
      harmEnv.gain.setValueAtTime(0, now);
      harmEnv.gain.linearRampToValueAtTime(cfg.gain2, now + cfg.attack);
      harmEnv.gain.linearRampToValueAtTime(cfg.gain2 * cfg.sustain, now + cfg.attack + cfg.decay);
      harmEnv.gain.linearRampToValueAtTime(0, now + cfg.attack + cfg.decay + cfg.release);
      harm.connect(harmEnv);
      harmEnv.connect(master);
      harm.start(now);
      harm.stop(now + cfg.attack + cfg.decay + cfg.release + 0.05);
    }
  }

  private playClassicScribble(): void {
    const ctx = this.ensureContext();
    const master = this.masterGain!;
    const now = ctx.currentTime;
    const buf = this.makeNoiseBuffer(ctx);
    const dur = 0.045;
    const burst = (centerHz: number, Q: number, gain: number) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = centerHz;
      bp.Q.value = Q;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(gain, now + 0.003);
      env.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      src.connect(bp);
      bp.connect(env);
      env.connect(master);
      src.start(now);
      src.stop(now + dur + 0.005);
    };
    burst(4200, 2.5, 0.55);
    burst(8500, 4.0, 0.25);
  }

  private playClassicUserQuestion(): void {
    const ctx = this.ensureContext();
    const master = this.masterGain!;
    const now = ctx.currentTime;
    const note = (
      startT: number,
      freqStart: number,
      freqEnd: number,
      dur: number,
      gain: number,
    ) => {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freqStart, now + startT);
      osc.frequency.linearRampToValueAtTime(freqEnd, now + startT + dur);
      const att = 0.008,
        rel = dur * 0.45;
      env.gain.setValueAtTime(0, now + startT);
      env.gain.linearRampToValueAtTime(gain, now + startT + att);
      env.gain.linearRampToValueAtTime(gain * 0.6, now + startT + dur - rel);
      env.gain.linearRampToValueAtTime(0, now + startT + dur + 0.04);
      osc.connect(env);
      env.connect(master);
      osc.start(now + startT);
      osc.stop(now + startT + dur + 0.08);
    };
    note(0.0, 329, 329, 0.07, 0.22);
    note(0.09, 392, 392, 0.07, 0.24);
    note(0.19, 494, 587, 0.28, 0.3);
  }

  // ── Terminal interaction sounds ─────────────────────────────────────────────

  /** Ultra-short micro-click for UI interactions (sorting, toggling, etc.) */
  uiClick() {
    const cooldown = 60;
    const now = performance.now();
    if (now - (this.lastFired.get('command_success') ?? 0) < cooldown) return;
    this.lastFired.set('command_success', now);
    try {
      this.playNote({
        freq: 1800,
        partials: [{ ratio: 1, gain: 1.0, decay: 0.03 }],
        attack: 0.001,
        release: 0.015,
        gain: 0.08,
      });
    } catch (e) {
      console.warn('[ChirpEngine] playback error:', e);
    }
  }

  /** Play ascending milestone tone based on progress percentage */
  progressMilestone(percent: number) {
    const cooldown = 800;
    const now = performance.now();
    if (now - (this.lastFired.get('progress_complete') ?? 0) < cooldown) return;
    this.lastFired.set('progress_complete', now);

    // Map percentage to ascending scale degrees
    const milestoneNotes = [NOTES.C4, NOTES.E4, NOTES.G4, NOTES.C5, NOTES.E5];
    const idx = Math.min(Math.floor(percent / 25), milestoneNotes.length - 1);
    const freq = milestoneNotes[idx];

    try {
      this.playNote({
        freq,
        partials: VIBRAPHONE,
        attack: 0.003,
        release: 0.08,
        gain: 0.12,
      });
    } catch (e) {
      console.warn('[ChirpEngine] playback error:', e);
    }
  }

  // ── Chiptune handlers ────────────────────────────────────────────────────

  /** NES-style text blip — quick square wave with pitch variation */
  private playChiptuneBlip(): void {
    const ctx = this.ensureContext();
    const master = this.masterGain!;
    const now = ctx.currentTime;
    const freq = 1800 + Math.random() * 400;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, now);
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.12, now + 0.001);
    env.gain.setTargetAtTime(0.0001, now + 0.001, 0.01);
    osc.connect(env);
    env.connect(master);
    osc.start(now);
    osc.stop(now + 0.03);
  }

  /** Chiptune question — ascending square arpeggio like a retro "got item" jingle */
  private playChiptuneQuestion(): void {
    const freqs = [CHIP_NOTES.E4, CHIP_NOTES.G4, CHIP_NOTES.A4, CHIP_NOTES.C5];
    for (let i = 0; i < freqs.length; i++) {
      this.playNote(
        {
          freq: freqs[i],
          partials: CHIP_LEAD,
          attack: 0.001,
          release: 0.06,
          gain: 0.24,
          waveform: 'square',
        },
        i * 0.06,
      );
    }
  }

  // ── Reverb ──────────────────────────────────────────────────────────────

  /** Generate a synthetic impulse response for convolution reverb */
  private generateImpulse(ctx: AudioContext, def: ReverbDef): AudioBuffer {
    const length = Math.ceil(ctx.sampleRate * def.duration);
    const buf = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        // Exponentially decaying noise, with simple lowpass via averaging
        const noise = Math.random() * 2 - 1;
        const decay = Math.exp(-i / (ctx.sampleRate * def.decay));
        data[i] = noise * decay;
      }
      // Simple filter: average adjacent samples to darken high frequencies
      if (def.filterFreq < 5000) {
        const passes = Math.round((8000 - def.filterFreq) / 1000);
        for (let p = 0; p < passes; p++) {
          for (let i = 1; i < length; i++) {
            data[i] = data[i] * 0.5 + data[i - 1] * 0.5;
          }
        }
      }
    }
    return buf;
  }

  /** Set reverb to match a hypertheme — generates impulse and connects convolver */
  setReverb(theme: string): void {
    const def = REVERB_DEFS[theme];
    if (!def) {
      this.clearReverb();
      return;
    }
    if (theme === this.currentReverbTheme) return;

    const ctx = this.ensureContext();
    const master = this.masterGain!;

    // Clean up old reverb
    if (this.reverbNode) {
      try {
        this.reverbNode.disconnect();
      } catch (_) {
        /* */
      }
    }

    // Create convolver with generated impulse
    this.reverbNode = ctx.createConvolver();
    this.reverbNode.buffer = this.generateImpulse(ctx, def);

    // Connect: masterGain → convolver → reverbGain (→ destination, already connected)
    master.connect(this.reverbNode);
    this.reverbNode.connect(this.reverbGain!);
    this.reverbGain!.gain.value = def.mix;

    this.currentReverbTheme = theme;
  }

  /** Remove reverb */
  clearReverb(): void {
    if (this.reverbNode) {
      try {
        this.reverbNode.disconnect();
      } catch (_) {
        /* */
      }
      this.reverbNode = null;
    }
    if (this.reverbGain) this.reverbGain.gain.value = 0;
    this.currentReverbTheme = null;
  }

  // ── Sidechain ducking ──────────────────────────────────────────────────

  /** Momentarily duck ambient drone + focus noise so chirps cut through */
  private duckAmbient(): void {
    if (this.ambientMaster && this.ctx && this.ambientTargetGain > 0) {
      const now = this.ctx.currentTime;
      this.ambientMaster.gain.cancelScheduledValues(now);
      this.ambientMaster.gain.setValueAtTime(this.ambientTargetGain * 0.3, now);
      this.ambientMaster.gain.linearRampToValueAtTime(this.ambientTargetGain, now + 0.35);
    }
    if (this.focusGain && this.ctx && this.focusTargetGain > 0) {
      const now = this.ctx.currentTime;
      this.focusGain.gain.cancelScheduledValues(now);
      this.focusGain.gain.setValueAtTime(this.focusTargetGain * 0.3, now);
      this.focusGain.gain.linearRampToValueAtTime(this.focusTargetGain, now + 0.35);
    }
  }

  // ── Rhythm patterns ─────────────────────────────────────────────────────

  /** Get start offset to snap to the nearest groove grid position */
  private getGrooveOffset(): number {
    if (this.deltaTimestamps.length < 3) return 0;
    const beatDuration = 60000 / this.beatBpm; // ms
    const template = GROOVE_TEMPLATES[this.rhythmPattern];
    const now = performance.now();
    const posInBeat = ((now - this.beatPhase) % beatDuration) / beatDuration; // 0–1

    // Find nearest groove position
    let minDist = 1;
    let nearestPos = 0;
    for (const pos of template) {
      const dist = Math.min(
        Math.abs(posInBeat - pos),
        Math.abs(posInBeat - pos - 1),
        Math.abs(posInBeat - pos + 1),
      );
      if (dist < minDist) {
        minDist = dist;
        nearestPos = pos;
      }
    }

    // If already close to a groove position, play on time
    if (minDist < 0.08) return 0;

    // Otherwise delay to next groove position
    let delay = nearestPos - posInBeat;
    if (delay < 0) delay += 1;
    return (delay * beatDuration) / 1000; // convert to seconds
  }

  // ── Conversation leitmotifs ─────────────────────────────────────────────

  /** Play a unique 4-note motif derived from a conversation ID hash */
  playLeitmotif(conversationId: string): void {
    let hash = 0;
    for (let i = 0; i < conversationId.length; i++) {
      hash = ((hash << 5) - hash + conversationId.charCodeAt(i)) | 0;
    }

    const scale = this.getCurrentScale();
    const partials = this.getCurrentPartials();

    for (let i = 0; i < 4; i++) {
      const idx = Math.abs((hash >> (i * 7)) & 0x7f) % scale.length;
      this.playNote(
        { freq: scale[idx], partials, attack: 0.004, release: 0.15, gain: 0.14 },
        i * 0.08,
      );
    }
  }

  /** Get the current style's scale as a frequency array */
  private getCurrentScale(): number[] {
    if (this.style === 'forest') return Object.values(FOREST_NOTES);
    if (this.style === 'wind-chime') return Object.values(CHIME_NOTES);
    if (this.style === 'whimsy') return Object.values(WHIMSY_NOTES);
    if (this.style === 'chiptune') return Object.values(CHIP_NOTES);
    return Object.values(NOTES);
  }

  /** Get the current style's default instrument partials */
  private getCurrentPartials(): Overtone[] {
    if (this.style === 'forest') return WIND_CHIME;
    if (this.style === 'wind-chime') return CRYSTAL_CHIME;
    if (this.style === 'whimsy') return MUSIC_BOX;
    if (this.style === 'chiptune') return CHIP_LEAD;
    return VIBRAPHONE;
  }

  // ── Background notification melodies ────────────────────────────────────

  /** Play a distinctive melody when the tab is hidden — attention needed */
  playNotificationMelody(type: 'completion' | 'approval' | 'error'): void {
    if (!this.unlocked) return;
    if (typeof document !== 'undefined' && !document.hidden) return;

    const scale = this.getCurrentScale();
    const partials = this.getCurrentPartials();
    const patterns: Record<string, number[]> = {
      completion: [0, 2, 4, 7].map((i) => scale[Math.min(i, scale.length - 1)]),
      approval: [2, 4, 7, 9].map((i) => scale[Math.min(i, scale.length - 1)]),
      error: [7, 4, 2, 0].map((i) => scale[Math.min(i, scale.length - 1)]),
    };

    const notes = patterns[type] ?? patterns.completion;
    try {
      for (let i = 0; i < notes.length; i++) {
        this.playNote(
          { freq: notes[i], partials, attack: 0.006, release: 0.25, gain: 0.22 },
          i * 0.12,
        );
      }
    } catch (e) {
      console.warn('[ChirpEngine] notification melody error:', e);
    }
  }

  // ── MIDI output ─────────────────────────────────────────────────────────

  /** Enable MIDI output — connects to the first available MIDI output port */
  async enableMidi(): Promise<boolean> {
    try {
      const access = await navigator.requestMIDIAccess();
      const outputs = Array.from(access.outputs.values());
      if (outputs.length > 0) {
        this.midiOutput = outputs[0];
        this.midiEnabled = true;
        return true;
      }
    } catch (e) {
      console.warn('[ChirpEngine] MIDI access failed:', e);
    }
    return false;
  }

  /** Disable MIDI output */
  disableMidi(): void {
    this.midiOutput = null;
    this.midiEnabled = false;
  }

  /** Send a MIDI note-on/off pair for the given frequency */
  private sendMidiNote(freq: number, velocity: number, duration: number): void {
    if (!this.midiOutput) return;
    const midiNote = Math.round(12 * Math.log2(freq / 440) + 69);
    if (midiNote < 0 || midiNote > 127) return;
    const vel = Math.round(Math.min(127, Math.max(1, velocity * 127)));
    const now = performance.now();
    this.midiOutput.send([0x90, midiNote, vel]); // note on
    this.midiOutput.send([0x80, midiNote, 0], now + duration * 1000); // note off
  }

  // ── Generative composition ──────────────────────────────────────────────

  /** Start generative composition mode — continuous evolving music from events */
  startGenerative(): void {
    this.stopGenerative();
    const ctx = this.ensureContext();
    const master = this.masterGain!;
    const now = ctx.currentTime;

    this.genPadMaster = ctx.createGain();
    this.genPadMaster.gain.setValueAtTime(0, now);
    this.genPadMaster.gain.linearRampToValueAtTime(0.03, now + 2);
    this.genPadMaster.connect(master);

    // Create a simple pad: root + fifth + octave
    for (const ratio of [1, 1.5, 2]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(this.genRoot * ratio, now);
      const g = ctx.createGain();
      g.gain.value = ratio === 1 ? 0.5 : 0.25;
      osc.connect(g);
      g.connect(this.genPadMaster);
      osc.start(now);
      this.genPadOscs.push(osc);
      this.genPadGains.push(g);
    }

    this.generativeMode = true;
  }

  /** Stop generative composition with fade-out */
  stopGenerative(): void {
    if (this.genPadMaster && this.ctx) {
      const now = this.ctx.currentTime;
      this.genPadMaster.gain.cancelScheduledValues(now);
      this.genPadMaster.gain.setValueAtTime(this.genPadMaster.gain.value, now);
      this.genPadMaster.gain.linearRampToValueAtTime(0, now + 2);
    }

    const oscs = [...this.genPadOscs];
    setTimeout(() => {
      for (const osc of oscs) {
        try {
          osc.stop();
          osc.disconnect();
        } catch (_) {
          /* */
        }
      }
    }, 2200);

    this.genPadOscs = [];
    this.genPadGains = [];
    this.genPadMaster = null;
    this.generativeMode = false;
  }

  /** Handle a stream event in generative mode — shift chords, add melody */
  private genOnEvent(event: ChirpEvent): void {
    if (!this.ctx || !this.genPadMaster) return;
    const now = this.ctx.currentTime;

    // Chord changes based on event type
    let newRoot = this.genRoot;
    if (event === 'message_start')
      newRoot = 261.6; // C4 — home key
    else if (event === 'tool_start')
      newRoot = this.genRoot * (4 / 3); // IV
    else if (event === 'tool_result_ok')
      newRoot = this.genRoot * (3 / 2); // V
    else if (event === 'tool_result_error')
      newRoot = this.genRoot * (6 / 5); // minor iii
    else if (event === 'message_stop') newRoot = 261.6; // resolve to I

    // Keep root in a reasonable range
    while (newRoot > 400) newRoot /= 2;
    while (newRoot < 130) newRoot *= 2;

    if (newRoot !== this.genRoot) {
      this.genRoot = newRoot;
      // Smoothly glide pad oscillators to new chord
      const ratios = [1, 1.5, 2];
      for (let i = 0; i < this.genPadOscs.length && i < ratios.length; i++) {
        this.genPadOscs[i].frequency.linearRampToValueAtTime(newRoot * ratios[i], now + 0.5);
      }
    }

    // Add a melody note for non-delta events
    if (event !== 'text_delta' && event !== 'message_start') {
      const scale = this.getCurrentScale();
      const freq = this.selectConsonant(scale.filter((f) => f > 200 && f < 1200));
      this.playNote(
        { freq, partials: this.getCurrentPartials(), attack: 0.004, release: 0.2, gain: 0.1 },
        0,
      );
    }
  }

  // ── Style blending ──────────────────────────────────────────────────────

  /** Get a blended NoteSpec by interpolating between primary and secondary styles */
  private getBlendedSpec(event: ChirpEvent): NoteSpec | NoteSpec[] | null {
    if (!this.secondaryStyle || this.blendRatio === 0) return null;

    const primary = this.getStyleSpec(this.style, event);
    const secondary = this.getStyleSpec(this.secondaryStyle, event);
    if (!primary || !secondary) return primary ?? secondary;

    const r = this.blendRatio;

    // Blend single specs
    if (!Array.isArray(primary) && !Array.isArray(secondary)) {
      return {
        freq: primary.freq * (1 - r) + secondary.freq * r,
        partials: r < 0.5 ? primary.partials : secondary.partials,
        attack: primary.attack * (1 - r) + secondary.attack * r,
        release: primary.release * (1 - r) + secondary.release * r,
        gain: primary.gain * (1 - r) + secondary.gain * r,
        waveform: r < 0.5 ? primary.waveform : secondary.waveform,
      };
    }

    // For arrays, pick based on blend ratio
    return r < 0.5 ? primary : secondary;
  }

  /** Look up the NoteSpec for a given style and event */
  private getStyleSpec(style: SoundStyle, event: ChirpEvent): NoteSpec | NoteSpec[] | null {
    if (style === 'melodic') return EVENT_NOTES[event] ?? null;
    if (style === 'whimsy') return WHIMSY_EVENT_NOTES[event] ?? null;
    if (style === 'forest') return FOREST_EVENT_NOTES[event] ?? null;
    if (style === 'wind-chime') return WIND_CHIME_EVENT_NOTES[event] ?? null;
    if (style === 'chiptune') return CHIPTUNE_EVENT_NOTES[event] ?? null;
    return null;
  }

  // ── Harmonic context ─────────────────────────────────────────────────────

  /** Record a frequency into the rolling history for consonance tracking */
  private recordNote(freq: number): void {
    this.noteHistory.push(freq);
    if (this.noteHistory.length > this.NOTE_HISTORY_SIZE) {
      this.noteHistory.shift();
    }
  }

  /** Score the consonance of an interval (0–1, higher = more consonant) */
  private consonanceScore(a: number, b: number): number {
    const ratio = Math.max(a, b) / Math.min(a, b);
    const semitones = Math.round(12 * Math.log2(ratio)) % 12;
    const SCORES: Record<number, number> = {
      0: 1.0, // unison
      1: 0.2, // minor 2nd
      2: 0.5, // major 2nd
      3: 0.75, // minor 3rd
      4: 0.8, // major 3rd
      5: 0.85, // perfect 4th
      6: 0.1, // tritone
      7: 0.9, // perfect 5th
      8: 0.65, // minor 6th
      9: 0.7, // major 6th
      10: 0.4, // minor 7th
      11: 0.3, // major 7th
    };
    return SCORES[semitones] ?? 0.5;
  }

  /** Pick the most consonant frequency from candidates, given recent history */
  selectConsonant(candidates: number[]): number {
    if (this.noteHistory.length === 0 || candidates.length <= 1) {
      return candidates[0] ?? 440;
    }
    let bestFreq = candidates[0];
    let bestScore = -1;
    for (const freq of candidates) {
      let score = 0;
      for (const prev of this.noteHistory) {
        score += this.consonanceScore(freq, prev);
      }
      if (score > bestScore) {
        bestScore = score;
        bestFreq = freq;
      }
    }
    return bestFreq;
  }

  // ── Adaptive tempo / beat clock ─────────────────────────────────────────

  /** Record a text_delta arrival and derive streaming BPM */
  private recordDelta(): void {
    const now = performance.now();
    this.deltaTimestamps.push(now);
    if (this.deltaTimestamps.length > this.DELTA_WINDOW) {
      this.deltaTimestamps.shift();
    }
    if (this.deltaTimestamps.length >= 3) {
      const intervals: number[] = [];
      for (let i = 1; i < this.deltaTimestamps.length; i++) {
        intervals.push(this.deltaTimestamps[i] - this.deltaTimestamps[i - 1]);
      }
      const avgMs = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      this.beatBpm = Math.max(60, Math.min(300, 60000 / avgMs));
      this.beatPhase = now;
    }
  }

  /** Return seconds offset to snap to the nearest 16th-note grid position */
  quantizeToNextBeat(): number {
    if (this.deltaTimestamps.length < 3) return 0;
    const beatDuration = 60000 / this.beatBpm;
    const sixteenthDur = beatDuration / 4;
    const now = performance.now();
    const posIn16th = (now - this.beatPhase) % sixteenthDur;
    const toNext16th = sixteenthDur - posIn16th;
    // If within 20% of a grid line, play on time
    if (posIn16th < sixteenthDur * 0.2 || toNext16th < sixteenthDur * 0.2) {
      return 0;
    }
    return toNext16th / 1000; // convert ms → seconds
  }

  // ── Scaled completion fanfares ──────────────────────────────────────────

  /** Play ascending arpeggio scaled to stream complexity (tool count) */
  private completionFanfare(): void {
    const count = this.streamToolCount;
    if (count <= 0) return;

    const getScale = (): number[] => {
      if (this.style === 'forest')
        return [
          FOREST_NOTES.D4,
          FOREST_NOTES.A4,
          FOREST_NOTES.D5,
          FOREST_NOTES.A5,
          FOREST_NOTES.D6,
        ];
      if (this.style === 'wind-chime')
        return [
          CHIME_NOTES.F4,
          CHIME_NOTES.A4,
          CHIME_NOTES.C5,
          CHIME_NOTES.F5,
          CHIME_NOTES.A5,
          CHIME_NOTES.C6,
        ];
      if (this.style === 'whimsy')
        return [
          WHIMSY_NOTES.C4,
          WHIMSY_NOTES.E4,
          WHIMSY_NOTES.G4,
          WHIMSY_NOTES.C5,
          WHIMSY_NOTES.E5,
          WHIMSY_NOTES.G5,
        ];
      return [NOTES.C4, NOTES.E4, NOTES.G4, NOTES.C5, NOTES.E5, NOTES.G5, NOTES.C6];
    };

    const getPartials = (): Overtone[] => {
      if (this.style === 'forest') return FAIRY_SPARKLE;
      if (this.style === 'wind-chime') return CRYSTAL_CHIME;
      if (this.style === 'whimsy') return MUSIC_BOX;
      return VIBRAPHONE;
    };

    const scale = getScale();
    const partials = getPartials();
    // 2 notes for 2 tools, up to full scale for 5+ tools
    const numNotes = Math.min(Math.max(2, Math.ceil(count / 2) + 1), scale.length);
    const noteSpacing = 0.06;

    for (let i = 0; i < numNotes; i++) {
      this.playNote(
        {
          freq: scale[i],
          partials,
          attack: 0.004,
          release: 0.2 + i * 0.04,
          gain: 0.18 - i * 0.015,
        },
        // Stagger after the normal message_stop sound
        0.35 + i * noteSpacing,
      );
    }
  }

  // ── Musical typing ──────────────────────────────────────────────────────

  /** Play a pentatonic note for a keystroke, cycling through the scale */
  playKeystroke(): void {
    if (!this.unlocked) return;
    const scales: Record<string, number[]> = {
      melodic: [NOTES.C5, NOTES.D5, NOTES.E5, NOTES.G5, NOTES.A5],
      forest: [FOREST_NOTES.D4, FOREST_NOTES.E4, FOREST_NOTES.G4, FOREST_NOTES.A4, FOREST_NOTES.B4],
      'wind-chime': [
        CHIME_NOTES.F4,
        CHIME_NOTES.G4,
        CHIME_NOTES.A4,
        CHIME_NOTES.B4,
        CHIME_NOTES.C5,
      ],
      whimsy: [WHIMSY_NOTES.C5, WHIMSY_NOTES.D5, WHIMSY_NOTES.E5, WHIMSY_NOTES.G5, WHIMSY_NOTES.A5],
      classic: [523.3, 587.3, 659.3, 784.0, 880.0], // C5 pentatonic
    };

    const scale = scales[this.style] ?? scales.melodic;
    // Use harmonic context to pick the most consonant next note
    const freq =
      this.noteHistory.length > 0
        ? this.selectConsonant(scale)
        : scale[this.keystrokeIndex % scale.length];
    this.keystrokeIndex++;

    const getPartials = (): Overtone[] => {
      if (this.style === 'forest') return RAINDROP;
      if (this.style === 'wind-chime') return TINKLE_CHIME;
      if (this.style === 'whimsy') return TOY_PIANO;
      return VIBRAPHONE;
    };

    try {
      this.playNote({
        freq,
        partials: getPartials(),
        attack: 0.002,
        release: 0.04,
        gain: 0.07,
      });
    } catch (e) {
      console.warn('[ChirpEngine] keystroke error:', e);
    }
  }

  // ── Ambient soundscape ──────────────────────────────────────────────────

  /** Create a looping noise buffer for focus noise */
  private makeLongNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.longNoiseBuffer && this.longNoiseBuffer.sampleRate === ctx.sampleRate) {
      return this.longNoiseBuffer;
    }
    const length = Math.ceil(ctx.sampleRate * 4);
    const buf = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this.longNoiseBuffer = buf;
    return buf;
  }

  /** Start a generative ambient drone for the given hypertheme */
  startAmbient(theme: string): void {
    // Stop existing ambient if running
    this.stopAmbient();

    const def = AMBIENT_DEFS[theme];
    if (!def) return;

    const ctx = this.ensureContext();
    const master = this.masterGain!;
    const now = ctx.currentTime;

    // Ambient master gain with 2s fade-in
    this.ambientTargetGain = def.gain;
    this.ambientMaster = ctx.createGain();
    this.ambientMaster.gain.setValueAtTime(0, now);
    this.ambientMaster.gain.linearRampToValueAtTime(def.gain, now + 2);
    this.ambientMaster.connect(master);

    // LFO for tremolo — modulates ambient master gain
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(def.lfoRate, now);
    lfoGain.gain.setValueAtTime(def.gain * def.lfoDepth, now);
    lfo.connect(lfoGain);
    lfoGain.connect(this.ambientMaster.gain);
    lfo.start(now);
    this.ambientLfos.push(lfo);

    // Create voice oscillators
    for (const voice of def.voices) {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = voice.type;
      osc.frequency.setValueAtTime(voice.freq, now);
      env.gain.setValueAtTime(voice.gain, now);
      osc.connect(env);
      env.connect(this.ambientMaster);
      osc.start(now);
      this.ambientOscs.push(osc);
      this.ambientGains.push(env);
    }

    this.ambientTheme = theme;
  }

  /** Stop the ambient drone with a 2s fade-out */
  stopAmbient(): void {
    if (!this.ambientMaster || !this.ctx) {
      this.ambientOscs = [];
      this.ambientGains = [];
      this.ambientLfos = [];
      this.ambientMaster = null;
      this.ambientTheme = null;
      return;
    }

    const now = this.ctx.currentTime;

    // Fade out
    this.ambientMaster.gain.cancelScheduledValues(now);
    this.ambientMaster.gain.setValueAtTime(this.ambientMaster.gain.value, now);
    this.ambientMaster.gain.linearRampToValueAtTime(0, now + 2);

    // Schedule cleanup after fade
    const oscs = [...this.ambientOscs];
    const lfos = [...this.ambientLfos];
    setTimeout(() => {
      for (const osc of oscs) {
        try {
          osc.stop();
          osc.disconnect();
        } catch (_) {
          /* already stopped */
        }
      }
      for (const lfo of lfos) {
        try {
          lfo.stop();
          lfo.disconnect();
        } catch (_) {
          /* already stopped */
        }
      }
    }, 2200);

    this.ambientOscs = [];
    this.ambientGains = [];
    this.ambientLfos = [];
    this.ambientMaster = null;
    this.ambientTheme = null;
  }

  // ── Focus noise ─────────────────────────────────────────────────────────

  /** Start generative focus noise with the given preset */
  startFocusNoise(preset: string): void {
    this.stopFocusNoise();

    const def = FOCUS_PRESETS[preset];
    if (!def) return;

    const ctx = this.ensureContext();
    const master = this.masterGain!;
    const now = ctx.currentTime;
    const buf = this.makeLongNoiseBuffer(ctx);

    this.focusTargetGain = def.gain;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = def.filterType;
    filter.frequency.setValueAtTime(def.filterFreq, now);
    if (def.filterQ > 0) filter.Q.setValueAtTime(def.filterQ, now);

    this.focusGain = ctx.createGain();
    this.focusGain.gain.setValueAtTime(0, now);
    this.focusGain.gain.linearRampToValueAtTime(def.gain, now + 1.5);

    src.connect(filter);
    filter.connect(this.focusGain);
    this.focusGain.connect(master);
    src.start(now);

    this.focusSource = src;
    this.focusPreset = preset;
  }

  /** Stop focus noise with a 1.5s fade-out */
  stopFocusNoise(): void {
    if (!this.focusSource || !this.focusGain || !this.ctx) {
      this.focusSource = null;
      this.focusGain = null;
      this.focusPreset = null;
      return;
    }

    const now = this.ctx.currentTime;
    this.focusGain.gain.cancelScheduledValues(now);
    this.focusGain.gain.setValueAtTime(this.focusGain.gain.value, now);
    this.focusGain.gain.linearRampToValueAtTime(0, now + 1.5);

    const src = this.focusSource;
    setTimeout(() => {
      try {
        src.stop();
        src.disconnect();
      } catch (_) {
        /* already stopped */
      }
    }, 1700);

    this.focusSource = null;
    this.focusGain = null;
    this.focusPreset = null;
  }

  // ── Data sonification ───────────────────────────────────────────────────

  /** Map numeric values to musical notes and play them sequentially */
  sonifyData(
    values: number[],
    options?: { tempo?: number; minFreq?: number; maxFreq?: number },
  ): void {
    if (values.length === 0) return;

    const tempo = options?.tempo ?? 120; // ms per note
    const minFreq = options?.minFreq ?? 220; // A3
    const maxFreq = options?.maxFreq ?? 880; // A5

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    const getPartials = (): Overtone[] => {
      if (this.style === 'forest') return WOODEN_FLUTE;
      if (this.style === 'wind-chime') return CRYSTAL_CHIME;
      if (this.style === 'whimsy') return MUSIC_BOX;
      return VIBRAPHONE;
    };

    const partials = getPartials();

    try {
      for (let i = 0; i < values.length; i++) {
        const normalized = (values[i] - min) / range;
        const freq = minFreq + normalized * (maxFreq - minFreq);

        this.playNote(
          {
            freq,
            partials,
            attack: 0.004,
            release: Math.max(0.05, (tempo / 1000) * 0.6),
            gain: 0.16,
          },
          (i * tempo) / 1000,
        );
      }
    } catch (e) {
      console.warn('[ChirpEngine] sonification error:', e);
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  setStyle(s: SoundStyle) {
    this.style = s;
  }

  setPan(pan: number) {
    this.defaultPan = Math.max(-1, Math.min(1, pan));
  }

  /** Track a tool call during streaming (for scaled fanfares) */
  trackToolCall(): void {
    this.streamToolCount++;
  }

  /** Reset stream tracking state (called on message_start) */
  resetStreamTracking(): void {
    this.streamToolCount = 0;
    this.deltaTimestamps = [];
  }

  /** Get current derived streaming BPM */
  getBpm(): number {
    return this.beatBpm;
  }

  /** Whether ambient is currently playing */
  get isAmbientPlaying(): boolean {
    return this.ambientTheme !== null;
  }

  /** Whether focus noise is currently playing */
  get isFocusNoisePlaying(): boolean {
    return this.focusPreset !== null;
  }

  unlock() {
    this.unlocked = true;
    this.ensureContext();
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.masterGain) this.masterGain.gain.value = this.volume;
  }

  /** Set the rhythm quantization pattern for streaming chirps */
  setRhythmPattern(pattern: RhythmPattern) {
    this.rhythmPattern = pattern;
    this.rhythmPosition = 0;
  }

  /** Blend two sound styles together (0 = pure primary, 1 = pure secondary) */
  setBlend(primary: SoundStyle, secondary: SoundStyle, ratio: number) {
    this.style = primary;
    this.secondaryStyle = secondary;
    this.blendRatio = Math.max(0, Math.min(1, ratio));
  }

  /** Clear style blending — revert to single style */
  clearBlend() {
    this.secondaryStyle = null;
    this.blendRatio = 0;
  }

  dispose() {
    this.stopAmbient();
    this.stopFocusNoise();
    this.stopGenerative();
    this.clearReverb();
    this.disableMidi();
    this.ctx?.close();
    this.ctx = null;
    this.masterGain = null;
    this.reverbGain = null;
    this.noiseBuffer = null;
    this.longNoiseBuffer = null;
    this.noteHistory = [];
    this.deltaTimestamps = [];
    this.streamToolCount = 0;
    this.keystrokeIndex = 0;
    this.consecutiveErrors = 0;
    this.rhythmPosition = 0;
    this.secondaryStyle = null;
    this.blendRatio = 0;
  }
}

/** Singleton — shared across the app */
export const chirpEngine = new ChirpEngine();
