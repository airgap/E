/**
 * ULTRAPLAN - Remote Cloud Planning Mode
 *
 * Offloads complex planning to a remote Cloud Container Runtime (CCR)
 * session running Opus 4.6, giving it up to 30 minutes to think.
 * The user approves the result from their browser.
 *
 * Invocation: type /ultraplan <prompt> or include "ultraplan" in a message.
 *
 * Flow:
 * 1. User triggers ULTRAPLAN
 * 2. Server provisions a CCR session (or reuses an existing executor)
 * 3. Planning agent runs with extended context + workspace snapshot
 * 4. Results stream back as they're generated
 * 5. User reviews and approves/rejects the plan
 * 6. Approved plans can auto-generate stories in the PRD
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type UltraPlanStatus =
  | 'pending' // Waiting for CCR provisioning
  | 'provisioning' // Cloud container spinning up
  | 'planning' // Opus is thinking
  | 'completed' // Plan ready for review
  | 'approved' // User approved the plan
  | 'rejected' // User rejected the plan
  | 'failed' // Planning failed
  | 'timeout'; // Hit the 30-minute limit

export interface UltraPlanConfig {
  /** Model for planning (should be highest capability) */
  model: string;
  /** Maximum planning duration in minutes */
  maxDurationMinutes: number;
  /** Maximum tokens for the plan output */
  maxOutputTokens: number;
  /** Whether to include a workspace file tree snapshot */
  includeWorkspaceSnapshot: boolean;
  /** Whether to include recent git history */
  includeGitHistory: boolean;
  /** File globs to include in the workspace snapshot */
  snapshotGlobs: string[];
  /** File globs to exclude from the snapshot */
  snapshotExclude: string[];
  /** Auto-generate stories from approved plan */
  autoGenerateStories: boolean;
}

export interface UltraPlanRequest {
  /** The planning prompt from the user */
  prompt: string;
  /** Optional workspace path (defaults to current) */
  workspacePath?: string;
  /** Optional PRD ID to attach generated stories to */
  prdId?: string;
  /** Optional config overrides */
  config?: Partial<UltraPlanConfig>;
}

export interface UltraPlanSection {
  title: string;
  content: string;
  /** Generated story suggestions (if applicable) */
  suggestedStories?: {
    title: string;
    description: string;
    acceptanceCriteria: string[];
    priority: 'critical' | 'high' | 'medium' | 'low';
    dependsOn?: string[];
  }[];
}

export interface UltraPlanResult {
  /** Overall plan summary */
  summary: string;
  /** Structured plan sections */
  sections: UltraPlanSection[];
  /** Architecture decisions made */
  decisions: { decision: string; rationale: string; alternatives: string[] }[];
  /** Identified risks */
  risks: { risk: string; severity: 'low' | 'medium' | 'high'; mitigation: string }[];
  /** Estimated total effort */
  estimatedEffort?: string;
  /** Files that will likely be affected */
  affectedFiles: string[];
}

export interface UltraPlanSession {
  id: string;
  status: UltraPlanStatus;
  prompt: string;
  workspacePath: string;
  prdId?: string;
  config: UltraPlanConfig;
  result?: UltraPlanResult;
  /** Raw planning output (full text) */
  rawOutput?: string;
  /** Partial output (streams as planning progresses) */
  partialOutput?: string;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  /** Cloud instance ID (if using CCR) */
  instanceId?: string;
  /** Error message if failed */
  error?: string;
  /** Approval feedback from user */
  approvalNote?: string;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_ULTRAPLAN_CONFIG: UltraPlanConfig = {
  model: 'claude-opus-4-6',
  maxDurationMinutes: 30,
  maxOutputTokens: 32000,
  includeWorkspaceSnapshot: true,
  includeGitHistory: true,
  snapshotGlobs: [
    '**/*.ts',
    '**/*.tsx',
    '**/*.js',
    '**/*.jsx',
    '**/*.svelte',
    '**/*.py',
    '**/*.go',
    '**/*.rs',
    '**/*.json',
    '**/*.toml',
    '**/*.md',
    '**/Dockerfile',
    '**/*.yaml',
    '**/*.yml',
  ],
  snapshotExclude: [
    'node_modules/**',
    '.git/**',
    'dist/**',
    'build/**',
    '.svelte-kit/**',
    'coverage/**',
    '*.lock',
    '*.tgz',
  ],
  autoGenerateStories: true,
};

/** Regex to detect ultraplan invocation in user messages */
export const ULTRAPLAN_TRIGGER = /\bultraplan\b/i;

// ─── SSE Event ───────────────────────────────────────────────────────────────

export interface StreamUltraPlanEvent {
  type: 'ultraplan_event';
  sessionId: string;
  event:
    | 'started'
    | 'provisioning'
    | 'planning'
    | 'progress'
    | 'completed'
    | 'failed'
    | 'approved'
    | 'rejected';
  data: {
    status?: UltraPlanStatus;
    message?: string;
    partialOutput?: string;
    result?: UltraPlanResult;
    progress?: number; // 0.0 - 1.0
    error?: string;
  };
}
