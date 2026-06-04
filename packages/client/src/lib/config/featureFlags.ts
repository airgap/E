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
    description: 'Inserted text glows/fades in as you (or the agent) type.',
    group: 'Render layer',
    issue: 'LYK-1089',
    implemented: true,
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
  {
    key: 'editor3dText',
    label: '3D text view',
    description: 'Read-only WebGL perspective view of a file with fisheye focus (Code/3D toggle).',
    group: 'Render layer',
    issue: 'LYK-1113',
    implemented: true,
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
    description: 'A curve to the code line the agent is currently working on, while it streams.',
    group: 'Agent-native',
    issue: 'LYK-1095',
    implemented: true,
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
    description: 'Files as cards on a 2D/3D board; the dep graph is the navigation.',
    group: 'Spatial',
    issue: 'LYK-1103',
    implemented: true,
  },
  {
    key: 'tearOffPeek',
    label: 'Tear-off peeks',
    description: 'Right-click a selection → pin it as a floating, live-updating window.',
    group: 'Spatial',
    issue: 'LYK-1104',
    implemented: true,
  },
  {
    key: 'inPlaceDiffMorph',
    label: 'In-place diff morph',
    description: 'A "Morph" diff mode: one pane crossfades old→new with a scrub slider.',
    group: 'Spatial',
    issue: 'LYK-1105',
    implemented: true,
  },
  {
    key: 'contextReactiveTiling',
    label: 'Reactive tiling',
    description: 'Auto-split panes so the two files the agent is touching sit side by side.',
    group: 'Spatial',
    issue: 'LYK-1106',
    implemented: true,
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
    description: 'Soft click on keystrokes; pass/fail tone on test runs (chirp engine).',
    group: 'Ambient',
    issue: 'LYK-1110',
    implemented: true,
  },
  {
    key: 'ambientBackdrop',
    label: 'Status backdrop',
    description: 'Backdrop shimmers while the agent works; red vignette when tests fail.',
    group: 'Ambient',
    issue: 'LYK-1111',
    implemented: true,
  },
  {
    key: 'ambientCodeWeather',
    label: 'Code weather',
    description: 'Faint film grain + a slow-drifting accent glow over the window.',
    group: 'Ambient',
    issue: 'LYK-1112',
    implemented: true,
  },
] as const satisfies readonly FeatureFlag[];

export type FeatureFlagKey = (typeof FEATURE_FLAGS)[number]['key'];

export const FEATURE_FLAG_KEYS: FeatureFlagKey[] = FEATURE_FLAGS.map((f) => f.key);
