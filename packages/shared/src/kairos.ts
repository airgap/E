/**
 * KAIROS - Always-On Daemon Mode
 *
 * Named after the Ancient Greek concept of "the right moment," KAIROS is an
 * autonomous daemon mode for golems. It runs as a persistent background process
 * that watches the workspace, acts on its own schedule, and delivers concise
 * "Brief" mode responses suited to a persistent assistant.
 *
 * Think of KAIROS as a systemd service for an AI agent.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type KairosStatus = 'stopped' | 'starting' | 'running' | 'pausing' | 'paused' | 'error';

export type KairosOutputMode = 'brief' | 'normal' | 'silent';

/** What KAIROS watches for */
export type KairosWatchEvent =
  | 'file_change' // Files modified in workspace
  | 'git_push' // New commits pushed to remote
  | 'test_failure' // Test suite failures
  | 'build_error' // Build process errors
  | 'todo_added' // New TODO/FIXME comments
  | 'dependency_update' // Package dependency changes
  | 'schedule' // Scheduled interval triggers
  | 'idle_threshold'; // System has been idle for N minutes

export interface KairosWatchConfig {
  /** Which events to watch for */
  events: KairosWatchEvent[];
  /** File glob patterns to watch (default: source files) */
  watchPatterns: string[];
  /** File glob patterns to ignore */
  ignorePatterns: string[];
  /** Minimum interval between actions in seconds */
  cooldownSeconds: number;
  /** Scheduled interval in minutes (for 'schedule' event) */
  scheduleIntervalMinutes: number;
  /** Idle threshold in minutes before triggering idle actions */
  idleThresholdMinutes: number;
}

export interface KairosAction {
  id: string;
  event: KairosWatchEvent;
  description: string;
  timestamp: number;
  result?: string;
  durationMs?: number;
}

export interface KairosConfig {
  /** Output verbosity */
  outputMode: KairosOutputMode;
  /** What to watch and act on */
  watch: KairosWatchConfig;
  /** Model to use for daemon actions */
  model: string;
  /** Maximum actions per hour (circuit breaker) */
  maxActionsPerHour: number;
  /** Auto-pause after N consecutive errors */
  errorThreshold: number;
  /** System prompt override for daemon mode */
  systemPrompt?: string;
}

export interface KairosState {
  id: string;
  golemId: string;
  workspacePath: string;
  status: KairosStatus;
  config: KairosConfig;
  startedAt: number;
  lastActionAt?: number;
  actionsThisHour: number;
  consecutiveErrors: number;
  totalActions: number;
  recentActions: KairosAction[];
}

// ─── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_KAIROS_WATCH_CONFIG: KairosWatchConfig = {
  events: ['file_change', 'test_failure', 'build_error', 'todo_added'],
  watchPatterns: ['**/*.{ts,tsx,js,jsx,svelte,py,go,rs}'],
  ignorePatterns: [
    'node_modules/**',
    '.git/**',
    'dist/**',
    'build/**',
    '.svelte-kit/**',
    'coverage/**',
  ],
  cooldownSeconds: 60,
  scheduleIntervalMinutes: 30,
  idleThresholdMinutes: 15,
};

export const DEFAULT_KAIROS_CONFIG: KairosConfig = {
  outputMode: 'brief',
  watch: DEFAULT_KAIROS_WATCH_CONFIG,
  model: 'claude-sonnet-4-6',
  maxActionsPerHour: 20,
  errorThreshold: 5,
};

// ─── SSE Event ───────────────────────────────────────────────────────────────

export interface StreamKairosEvent {
  type: 'kairos_event';
  daemonId: string;
  event: 'started' | 'stopped' | 'paused' | 'action_taken' | 'error' | 'watching';
  data: {
    message?: string;
    action?: KairosAction;
    status?: KairosStatus;
    actionsThisHour?: number;
  };
}
