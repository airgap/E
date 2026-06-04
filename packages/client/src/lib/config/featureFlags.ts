/**
 * Feature-flag registry for experimental editor features (LYK-1081).
 *
 * Everything that exploits E owning its own renderer / being agent-native —
 * the "things a VS Code extension can't do" set — ships behind a flag that is
 * OFF by default. Adding a feature is a one-line entry here; the feature reads
 * its flag via the featureFlags store and no-ops when disabled, so `main` stays
 * safe while these bake.
 *
 * Linear: each flag maps to a child of LYK-1082..1087.
 */

export type FeatureFlagGroup =
  | 'Render layer'
  | 'Agent-native'
  | 'Inline widgets'
  | 'Spatial'
  | 'Motion'
  | 'Ambient';

export interface FeatureFlag {
  key: string;
  label: string;
  description: string;
  group: FeatureFlagGroup;
  /** Linear issue identifier for traceability. */
  issue: string;
  /** true once a real implementation reads this flag (vs. registered-only). */
  implemented?: boolean;
}

export const FEATURE_FLAGS = [
  // ── Render layer (LYK-1082) ────────────────────────────────────────────────
  {
    key: 'editorGlyphTint',
    label: 'Glyph tinting',
    description: 'Tint code glyphs by git age — recent code glows, settled code fades.',
    group: 'Render layer',
    issue: 'LYK-1088',
    implemented: true,
  },
  {
    key: 'editorTextAnimations',
    label: 'Text edit animations',
    description: 'Type-in / dissolve / reformat-morph on text mutations.',
    group: 'Render layer',
    issue: 'LYK-1089',
  },
  {
    key: 'editorFocusFisheye',
    label: 'Focus fisheye',
    description: 'Per-glyph scaling — current function large, rest miniaturized.',
    group: 'Render layer',
    issue: 'LYK-1090',
  },
  {
    key: 'editorShaderAtmosphere',
    label: 'Shader atmosphere',
    description: 'Grain, cursor bloom, depth-of-field, thinking shimmer.',
    group: 'Render layer',
    issue: 'LYK-1091',
  },

  // ── Agent-native (LYK-1083) ────────────────────────────────────────────────
  {
    key: 'agentLiveEdit',
    label: 'Live agent edits',
    description: 'Glow the lines the agent just edited, instead of a silent jump.',
    group: 'Agent-native',
    issue: 'LYK-1092',
    implemented: true,
  },
  {
    key: 'agentEditReplay',
    label: 'Agent edit replay',
    description: 'Scrub/play through an agent turn’s edits in the timeline panel.',
    group: 'Agent-native',
    issue: 'LYK-1093',
    implemented: true,
  },
  {
    key: 'agentMultiCursor',
    label: 'Golem cursors',
    description: 'Concurrent agents shown as live named cursors.',
    group: 'Agent-native',
    issue: 'LYK-1094',
  },
  {
    key: 'agentAttentionLines',
    label: 'Attention lines',
    description: 'Curves from chat to the code regions the agent references.',
    group: 'Agent-native',
    issue: 'LYK-1095',
  },
  {
    key: 'agentEditConfidence',
    label: 'Edit confidence',
    description: 'Tint agent edits by stated confidence.',
    group: 'Agent-native',
    issue: 'LYK-1096',
  },

  // ── Inline widgets (LYK-1084) ──────────────────────────────────────────────
  {
    key: 'inlineNumberScrubber',
    label: 'Number scrubber',
    description: 'Drag a numeric literal to change its value.',
    group: 'Inline widgets',
    issue: 'LYK-1097',
    implemented: true,
  },
  {
    key: 'inlineColorPicker',
    label: 'Color picker',
    description: 'Inline swatch + picker on color literals.',
    group: 'Inline widgets',
    issue: 'LYK-1098',
    implemented: true,
  },
  {
    key: 'inlineRegexTester',
    label: 'Regex tester',
    description: 'Click a regex literal to test sample strings against it.',
    group: 'Inline widgets',
    issue: 'LYK-1099',
    implemented: true,
  },
  {
    key: 'inlineSparklines',
    label: 'Sparklines',
    description: 'Tiny chart after numeric array literals.',
    group: 'Inline widgets',
    issue: 'LYK-1100',
    implemented: true,
  },
  {
    key: 'inlineMediaPreview',
    label: 'Media preview',
    description: 'Thumbnail after image paths and inline SVG literals.',
    group: 'Inline widgets',
    issue: 'LYK-1101',
    implemented: true,
  },
  {
    key: 'inlineRuntimeValues',
    label: 'Runtime values',
    description: 'Show expression values inline as tests/debug run.',
    group: 'Inline widgets',
    issue: 'LYK-1102',
  },

  // ── Spatial (LYK-1085) ─────────────────────────────────────────────────────
  {
    key: 'spatialCodeCanvas',
    label: 'Code canvas',
    description: 'Files/functions as cards; dep-graph navigation.',
    group: 'Spatial',
    issue: 'LYK-1103',
  },
  {
    key: 'tearOffPeek',
    label: 'Tear-off peeks',
    description: 'Pin any code region as a floating live window.',
    group: 'Spatial',
    issue: 'LYK-1104',
  },
  {
    key: 'inPlaceDiffMorph',
    label: 'In-place diff morph',
    description: 'Same pane morphs old→new with a scrub slider.',
    group: 'Spatial',
    issue: 'LYK-1105',
  },
  {
    key: 'contextReactiveTiling',
    label: 'Reactive tiling',
    description: 'Layout follows the files the agent is touching.',
    group: 'Spatial',
    issue: 'LYK-1106',
  },

  // ── Motion (LYK-1086) ──────────────────────────────────────────────────────
  {
    key: 'motionCursor',
    label: 'Cursor motion',
    description: 'Ease the caret between positions with a faint glow trail.',
    group: 'Motion',
    issue: 'LYK-1107',
    implemented: true,
  },
  {
    key: 'motionThemeTransition',
    label: 'Theme crossfade',
    description: 'Crossfade color tokens on theme switch instead of hard-swapping.',
    group: 'Motion',
    issue: 'LYK-1108',
    implemented: true,
  },
  {
    key: 'motionFocusPulse',
    label: 'Focus pulse',
    description: 'Pulse the target line on jump-to-def; soft morphing selection.',
    group: 'Motion',
    issue: 'LYK-1109',
    implemented: true,
  },

  // ── Ambient (LYK-1087) ─────────────────────────────────────────────────────
  {
    key: 'ambientSound',
    label: 'Editor sound',
    description: 'Keystroke/edit/pass-fail tones via the chirp engine.',
    group: 'Ambient',
    issue: 'LYK-1110',
  },
  {
    key: 'ambientBackdrop',
    label: 'Status backdrop',
    description: 'Backdrop reflects build/test/agent state.',
    group: 'Ambient',
    issue: 'LYK-1111',
  },
  {
    key: 'ambientCodeWeather',
    label: 'Code weather',
    description: 'Generative grain/glow drift over time.',
    group: 'Ambient',
    issue: 'LYK-1112',
  },
] as const satisfies readonly FeatureFlag[];

export type FeatureFlagKey = (typeof FEATURE_FLAGS)[number]['key'];

export const FEATURE_FLAG_KEYS: FeatureFlagKey[] = FEATURE_FLAGS.map((f) => f.key);
