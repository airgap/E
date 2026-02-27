/**
 * Throbber Phrases — rotating status text shown while streaming.
 *
 * Generic phrases are always available. Theme-specific phrases are
 * mixed in when the user's active theme has an entry here, giving
 * immersive themes a distinctive voice.
 */

/** Generic phrases — used by every theme */
export const GENERIC_PHRASES: string[] = [
  // introspective
  'Holding that thought…',
  'Following a hunch…',
  'Tracing the thread…',
  'Unraveling the knot…',
  'Pulling at something…',
  'The shape is forming…',

  // confident energy
  'Oh, I see where this is going…',
  'Getting somewhere good…',
  'This is the interesting part…',
  'Wait for it…',
  'Building momentum…',
  'On to something…',

  // playful
  'Juggling abstractions…',
  'Herding electrons…',
  'Untangling spaghetti…',
  'Rearranging the furniture…',
  'Shaking the magic 8-ball…',
  'Consulting my inner monologue…',
  'Asking the rubber duck…',

  // technical-poetic
  'Walking the syntax tree…',
  'Gradient descent in progress…',
  'Sampling the latent space…',
  'Attention heads converging…',
  'Propagating forward…',
  'Searching the solution space…',
  'Tokens in, clarity out…',

  // zen
  'Letting it crystallize…',
  'The fog is lifting…',
  'Clarity incoming…',
  'Pieces clicking into place…',
  'Almost got it…',
  'Breathing between thoughts…',
  'The signal is clearing…',

  // dramatic
  'Forging a response…',
  'Distilling raw thought…',
  'Sculpting an answer…',
  'Weaving it together…',
  'The gears are meshing…',
  'Stitching context…',
];

/**
 * Per-theme phrase overrides. Keyed by theme ID.
 * These get combined with the generic list — they don't replace it.
 */
export const THEME_PHRASES: Record<string, string[]> = {
  // ── Immersive themes ──────────────────────────────────────────

  arcane: [
    'The runes rearrange themselves…',
    'Arcane energy crackles between glyphs…',
    'A sigil flares in the dark…',
    'The incantation takes shape…',
    'Drawing power from the ley lines…',
    'The codex pages turn on their own…',
    'Elder patterns surface from the void…',
    'The circle hums — something stirs…',
    'Binding syllables to syntax…',
    'The spell crystallizes…',
    'Mana flows through the circuit…',
    'The grimoire knows the answer…',
    'Whispering the true name…',
    'Channeling through the obsidian lens…',
    'The ward accepts the query…',
  ],

  ethereal: [
    'Light bends through the prism…',
    'Iridescent threads winding…',
    'The shimmer deepens into meaning…',
    'Aurora fragments coalescing…',
    'Opalescent logic taking form…',
    'Moonbeams carrying data…',
    'Dissolving the question into clarity…',
    'Pearl-light humming between worlds…',
    'Gossamer filaments connecting…',
    'The veil thins — almost through…',
    'Phosphorescent thoughts rising…',
    'Starlight refracting into answers…',
    'Dew on spider silk, catching signals…',
    'The luminous stream quickens…',
    'Translucent layers aligning…',
  ],

  study: [
    'Quill scratching furiously…',
    'The tome falls open to the right page…',
    'Embers flare — a breakthrough…',
    'Bubbling in the retort…',
    'Cross-referencing three scrolls at once…',
    'The alembic drips golden…',
    'Turning pages by candlelight…',
    'The cauldron speaks in riddles…',
    'Reagents reacting beautifully…',
    'Amber light catches the formula…',
    'The wizard nods slowly…',
    'Ink drying on the solution…',
    'A leather-bound memory surfaces…',
    'The owl hoots in agreement…',
    'Dust motes spell out the answer…',
  ],

  astral: [
    'Locking onto the signal…',
    'Stellar cartography updating…',
    'Quantum coherence achieved…',
    'The nebula resolves into structure…',
    'Pulsar timing aligned…',
    'Warp calculations at 98%…',
    'Riding a gravitational wave…',
    'Deep space packet received…',
    'Star charts recalibrating…',
    'Photon stream decoding…',
    'The observatory hums with data…',
    'Constellation pattern matched…',
    'Interstellar handshake in progress…',
    'Solar wind carrying the answer…',
    'The cosmos is being helpful today…',
  ],

  'astral-midnight': [
    'The void returns a signal…',
    'Dark matter rearranging…',
    'Starlight cutting through absolute black…',
    'The abyss considered your question…',
    'Photons arriving from the event horizon…',
    'Zero-point fluctuation detected…',
    'Midnight frequency locked…',
    'Singularity offering clarity…',
    'The deep field resolves…',
    'Light where there should be none…',
    'Void-state computation…',
    'Hawking radiation carrying data…',
    'The black body radiates an answer…',
    'Absolute dark, absolute focus…',
    'Something emerges from nothing…',
  ],

  goth: [
    'Blood ink drying on vellum…',
    'The cathedral organ swells…',
    'Shadows knitting themselves together…',
    'A raven delivers the answer…',
    'The void is being cooperative…',
    'Thorns flowering into logic…',
    'Something stirs beneath the surface…',
    'The mirror shows the solution…',
    'Candlewax drips into meaning…',
    'Velvet darkness, silver thoughts…',
    'The belltower strikes an answer…',
    'Gargoyles whispering secrets…',
    'Crimson threads connecting…',
    'The crypt yields its knowledge…',
    'Beautiful darkness, sharp insight…',
  ],

  'magic-forest': [
    'The mycelium network pulses…',
    'Bioluminescent breadcrumbs appearing…',
    'Ancient roots passing messages…',
    'Fairy rings computing in parallel…',
    'The canopy opens to let an idea through…',
    'Sprites assembling the answer…',
    'Moss encoding the solution…',
    'Dewdrop lenses focusing…',
    'The old oak remembers something…',
    'Fireflies synchronizing…',
    'Mushroom caps receiving signals…',
    'The forest floor knows the way…',
    'Pollen carrying compressed wisdom…',
    'A clearing opens in the logic…',
    'The undergrowth whispers: almost…',
  ],

  // ── Standard themes with personality ──────────────────────────

  matrix: [
    'Follow the white rabbit…',
    'The Matrix is reloading…',
    'Green rain decrypting…',
    'There is no spoon — only code…',
    'Jacking into the mainframe…',
    'Morpheus sends his regards…',
    'Dodging bullets of doubt…',
    'The red pill is working…',
    'Architect subroutine engaged…',
    'I know kung fu…',
    'Glitch in the Matrix — fixing…',
    'The One is thinking…',
  ],

  synthwave: [
    'Chrome dreams buffering…',
    'Sunset protocol at 80%…',
    'Neon grid fully powered…',
    'Outrunning the render pipeline…',
    'Synth pads reaching crescendo…',
    'Laser beams converging on the answer…',
    'VHS tracking adjusted…',
    'Turbo mode engaged…',
    'Cruising the data highway…',
    'The horizon line approaches…',
    'Retro-future loading…',
    'Palm trees swaying in the datastream…',
  ],

  'tokyo-night': [
    'Neon kanji flickering to life…',
    'Late night in the code district…',
    'Rain streaks on the terminal…',
    'Vending machine dispensing wisdom…',
    'The night shift deepens…',
    'Izakaya conversations overheard…',
    'Train announcement: next stop, clarity…',
    'Lanterns swaying — almost there…',
    'Alleyway shortcut to the answer…',
    'The konbini has what we need…',
    'Cherry blossoms on the keyboard…',
    'Shinkansen-speed processing…',
  ],

  'rose-pine': [
    'Petals unfolding into logic…',
    'First light through the pines…',
    'Morning dew on the solution…',
    'The garden path reveals itself…',
    'Soft gold on the horizon…',
    'Pine resin sealing the answer…',
    'Birdsong carrying the signal…',
    'The rosebush blooms with insight…',
    'Mist burning off — clarity ahead…',
    'Lavender thoughts settling…',
    'The warmth of dawn thinking…',
    'Soil and roots and quiet knowing…',
  ],

  nord: [
    'Aurora borealis computing…',
    'Frost forming on the answer…',
    'The fjord reflects something deep…',
    'Arctic silence, sharp focus…',
    'Polar winds carrying data…',
    'Ice crystals encoding the solution…',
    'The long night yields insight…',
    'Snow dampens everything but thought…',
    'Viking runes aligning…',
    'Northern clarity descending…',
    'The glacier reveals a layer…',
    'Midnight sun never stops thinking…',
  ],

  dracula: [
    'The count runs the numbers…',
    'Bats forming a search pattern…',
    'Castle Dracula mainframe spinning…',
    'Nocturnal subroutines engaged…',
    'The coffin lid clicks open…',
    'Fangs sinking into the problem…',
    'Transylvanian algorithm awakens…',
    'The organ plays a solution…',
    'Mist creeping toward the answer…',
    'Eternal night, eternal compute…',
    'The vampire squints at the logic…',
    'Blood-red cursor blinking…',
  ],

  monokai: [
    'Syntax trees in glorious color…',
    'The OG editor energy flows…',
    'Sublime intuition loading…',
    'Yellow function, pink string, green comment…',
    'Monospaced meditation deepening…',
    'Classic warmth, modern thoughts…',
    'The 2013 aesthetic endures…',
    'Tab-width-4 contemplation…',
    'Warm dark palette processing…',
    'Every bracket perfectly highlighted…',
    'The theme that launched a thousand editors…',
    'Retro-syntax revelation incoming…',
  ],

  'catppuccin-mocha': [
    'Double shot of insight brewing…',
    'The foam art spells out the answer…',
    'Warm mocha stream of consciousness…',
    'Espresso-powered reasoning…',
    'The barista nods knowingly…',
    'Café ambience: peak focus…',
    'Latte gradient resolving…',
    'Steam rising into solutions…',
    'The coffee rings form a diagram…',
    'Sipping while thinking…',
    'Bean-to-cup pipeline processing…',
    'The café closes when the answer\u2019s ready…',
  ],

  sakura: [
    'A petal lands on the solution…',
    'Hanami season for the mind…',
    'Cherry blossom diff incoming…',
    'The branch blooms with answers…',
    'Pink clouds parting…',
    'Spring breeze carrying insight…',
    'The garden path is clear…',
    'Petals arranging into patterns…',
    'Soft pink dawn of understanding…',
    'The sakura tree has seen this before…',
    'Blossoms falling in slow motion…',
    'A perfect viewing spot for the answer…',
  ],

  gruvbox: [
    'Amber warmth intensifying…',
    'Retro CRT glow deepening…',
    'Earth tones grounding the logic…',
    'Vintage terminal humming…',
    'Warm orange on dark brown: clarity…',
    'The old way still works best…',
    'Analog warmth, digital precision…',
    'Yellowed pages, fresh ideas…',
    'The 70s called — they have the answer…',
    'Brutalist beauty computing…',
    'Warm palette, cool logic…',
    'Harvest gold processing…',
  ],
};

// Also map dark/light variants to the same phrases
THEME_PHRASES['gruvbox-dark'] = THEME_PHRASES['gruvbox'];
THEME_PHRASES['gruvbox-light'] = THEME_PHRASES['gruvbox'];
THEME_PHRASES['rose-pine-dawn'] = THEME_PHRASES['rose-pine'];
THEME_PHRASES['sakura-light'] = THEME_PHRASES['sakura'];
THEME_PHRASES['catppuccin-latte'] = THEME_PHRASES['catppuccin-mocha'];

/**
 * Get a combined phrase list for a given theme.
 * Returns generic phrases + any theme-specific ones.
 */
export function getPhrasesForTheme(themeId: string): string[] {
  const themePhrases = THEME_PHRASES[themeId];
  if (themePhrases) {
    return [...GENERIC_PHRASES, ...themePhrases];
  }
  return GENERIC_PHRASES;
}

/**
 * Pick a random phrase from the combined list for a theme,
 * avoiding the previously shown phrase.
 */
export function pickPhrase(themeId: string, previous?: string): string {
  const phrases = getPhrasesForTheme(themeId);
  if (phrases.length <= 1) return phrases[0] ?? 'Thinking…';

  let pick: string;
  do {
    pick = phrases[Math.floor(Math.random() * phrases.length)];
  } while (pick === previous && phrases.length > 1);

  return pick;
}
