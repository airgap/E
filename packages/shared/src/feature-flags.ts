/**
 * Feature Flags System
 *
 * Two-tier feature flag system inspired by Claude Code's leaked architecture:
 *
 * 1. Compile-time flags: Static boolean constants that enable dead code elimination
 *    when bundled. These gate major features that aren't ready for release.
 *
 * 2. Runtime flags: Dynamic flags stored in settings/database that can be toggled
 *    without rebuilding. Prefixed with `e_` for namespacing.
 *
 * Usage:
 *   import { FLAGS, isRuntimeFlagEnabled } from '@e/shared/feature-flags';
 *
 *   // Compile-time (tree-shaken when false):
 *   if (FLAGS.KAIROS) { ... }
 *
 *   // Runtime (checked against settings):
 *   if (isRuntimeFlagEnabled('e_buddy_preview', runtimeFlags)) { ... }
 */

// ─── Compile-Time Feature Flags ──────────────────────────────────────────────
// These are constant booleans. When false, bundlers eliminate dead branches.

export const FLAGS = {
  /** KAIROS: Always-on daemon mode for golems */
  KAIROS: true,

  /** autoDream: Background memory consolidation during idle */
  AUTO_DREAM: true,

  /** BUDDY: Tamagotchi-style terminal companion pet */
  BUDDY: true,

  /** Swarm Coordinator: Multi-agent parallel execution */
  SWARM: true,

  /** Frustration Detection: Sentiment analysis on user input */
  FRUSTRATION_DETECTION: true,

  /** Context Compaction: Smart LLM context compression */
  CONTEXT_COMPACTION: true,

  /** ULTRAPLAN: Remote cloud planning with extended thinking */
  ULTRAPLAN: true,

  /** Brief Output Mode: Condensed responses for background agents */
  BRIEF_MODE: true,

  /** Undercover Mode: Public repo detection and reference scrubbing */
  UNDERCOVER: true,

  /** Browser Tool: Playwright headless browser automation */
  BROWSER_TOOL: true,

  /** Prompt Caching: Claude API cache_control markers */
  PROMPT_CACHE: true,

  /** Telemetry: Local-only usage analytics */
  TELEMETRY: true,

  /** Agent Sleep: Checkpoint/resume with wake triggers */
  AGENT_SLEEP: true,

  /** Tree-sitter: AST parsing for structural code analysis */
  TREE_SITTER: true,

  /** Vim Mode: Vim keybinding support in editor */
  VIM_MODE: true,
} as const;

export type CompileFlag = keyof typeof FLAGS;

// ─── Runtime Feature Flags ───────────────────────────────────────────────────
// Dynamic flags that can be toggled via settings UI or API without rebuild.

export interface RuntimeFlag {
  id: string;
  name: string;
  description: string;
  defaultEnabled: boolean;
  /** Optional: only enable during a specific date window */
  previewWindow?: { start: string; end: string };
}

export const RUNTIME_FLAGS: RuntimeFlag[] = [
  {
    id: 'e_kairos_daemon',
    name: 'KAIROS Daemon',
    description: 'Enable always-on background golem daemon mode',
    defaultEnabled: false,
  },
  {
    id: 'e_auto_dream',
    name: 'autoDream',
    description: 'Enable background memory consolidation during idle periods',
    defaultEnabled: false,
  },
  {
    id: 'e_buddy_pet',
    name: 'BUDDY Pet',
    description: 'Enable Tamagotchi-style companion pet in the UI',
    defaultEnabled: false,
    previewWindow: { start: '2026-04-01', end: '2026-04-07' },
  },
  {
    id: 'e_swarm_coordinator',
    name: 'Swarm Coordinator',
    description: 'Enable multi-agent swarm parallel execution',
    defaultEnabled: false,
  },
  {
    id: 'e_frustration_detection',
    name: 'Frustration Detection',
    description: 'Detect user frustration and adjust response tone',
    defaultEnabled: true,
  },
  {
    id: 'e_context_compaction',
    name: 'Smart Compaction',
    description: 'Use intelligent context compression for LLM conversations',
    defaultEnabled: true,
  },
  {
    id: 'e_ultraplan',
    name: 'ULTRAPLAN',
    description: 'Remote cloud planning with extended Opus thinking time (up to 30 min)',
    defaultEnabled: false,
  },
  {
    id: 'e_brief_mode',
    name: 'Brief Output',
    description: 'Condensed output mode for background agents and KAIROS daemon',
    defaultEnabled: true,
  },
  {
    id: 'e_undercover',
    name: 'Undercover Mode',
    description: 'Auto-detect public repos and scrub internal references',
    defaultEnabled: true,
  },
  {
    id: 'e_browser_tool',
    name: 'Browser Tool',
    description: 'Playwright headless browser automation for screenshots, scraping, testing',
    defaultEnabled: false,
  },
  {
    id: 'e_prompt_cache',
    name: 'Prompt Caching',
    description: 'Cache stable prompt segments (system prompt, tools, conversation prefix)',
    defaultEnabled: true,
  },
  {
    id: 'e_telemetry',
    name: 'Telemetry',
    description: 'Local-only usage analytics and cost tracking',
    defaultEnabled: false,
  },
  {
    id: 'e_agent_sleep',
    name: 'Agent Sleep',
    description: 'Allow agents to checkpoint state and resume on triggers',
    defaultEnabled: false,
  },
  {
    id: 'e_tree_sitter',
    name: 'Tree-sitter AST',
    description: 'Structural code analysis via tree-sitter parsing',
    defaultEnabled: false,
  },
  {
    id: 'e_vim_mode',
    name: 'Vim Mode',
    description: 'Vim keybinding support in code editors',
    defaultEnabled: false,
  },
];

export type RuntimeFlagId = (typeof RUNTIME_FLAGS)[number]['id'];

/**
 * Evaluate whether a runtime flag is currently enabled.
 * Checks: compile gate → user override → preview window → default.
 */
export function isRuntimeFlagEnabled(
  flagId: string,
  overrides: Record<string, boolean> = {},
): boolean {
  const flag = RUNTIME_FLAGS.find((f) => f.id === flagId);
  if (!flag) return false;

  // Check user override first
  if (flagId in overrides) return overrides[flagId];

  // Check preview window
  if (flag.previewWindow) {
    const now = new Date();
    const start = new Date(flag.previewWindow.start);
    const end = new Date(flag.previewWindow.end);
    end.setHours(23, 59, 59, 999);
    if (now >= start && now <= end) return true;
  }

  return flag.defaultEnabled;
}

/**
 * Get all flags with their current resolved state.
 */
export function resolveAllFlags(overrides: Record<string, boolean> = {}): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const flag of RUNTIME_FLAGS) {
    result[flag.id] = isRuntimeFlagEnabled(flag.id, overrides);
  }
  return result;
}
