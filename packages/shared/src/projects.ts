export type CommentaryPersonality =
  | 'documentary_narrator'
  | 'technical_analyst'
  | 'comedic_observer'
  | 'project_lead'
  | 'wizard';

/**
 * Commentary verbosity controls how often the commentator chimes in:
 *  - 'frequent'  — narrates every 3-5 seconds, covers most events
 *  - 'strategic' — only narrates on tool_use, message_stop, quality checks
 *  - 'minimal'   — only major milestones (story completion, errors)
 */
export type CommentaryVerbosity = 'frequent' | 'strategic' | 'minimal';

/** Valid verbosity values — used for validation. */
export const VALID_VERBOSITY_VALUES: CommentaryVerbosity[] = ['frequent', 'strategic', 'minimal'];

/**
 * Migrate legacy verbosity values ('low'|'medium'|'high') to the new semantic names.
 * Returns the input unchanged if it's already a valid new value.
 */
export function migrateVerbosity(value: string): CommentaryVerbosity {
  switch (value) {
    case 'high':
      return 'frequent';
    case 'medium':
      return 'strategic';
    case 'low':
      return 'minimal';
    case 'frequent':
    case 'strategic':
    case 'minimal':
      return value;
    default:
      return 'strategic';
  }
}

/**
 * Commentary-specific settings that can be stored per-workspace.
 * Default values: enabled=false, personality='technical_analyst', verbosity='strategic'
 */
export interface CommentarySettings {
  enabled: boolean;
  personality: CommentaryPersonality;
  verbosity: CommentaryVerbosity;
}

/** Default commentary settings applied when none are configured. */
export const DEFAULT_COMMENTARY_SETTINGS: CommentarySettings = {
  enabled: true,
  personality: 'technical_analyst',
  verbosity: 'strategic',
};

export interface Workspace {
  id: string;
  name: string;
  path: string;
  lastOpened: number;
  settings?: WorkspaceSettings;
  createdAt: number;
}

export interface WorkspaceSettings {
  defaultModel?: string;
  defaultPermissionMode?: string;
  systemPrompt?: string;
  effort?: string;
  commentaryEnabled?: boolean;
  commentaryPersonality?: CommentaryPersonality;
  commentaryMuted?: boolean;
  commentaryVerbosity?: CommentaryVerbosity;
  commentaryHistoryEnabled?: boolean;
  commentaryTtsEnabled?: boolean;
  commentaryTtsVolume?: number; // 0.0 to 1.0
  commentaryTtsProvider?: 'browser' | 'elevenlabs' | 'google';
  commentaryTtsElevenLabsApiKey?: string;
  commentaryTtsGoogleApiKey?: string;
  /** Experimental: spatial audio positioning for multi-workspace TTS (disabled by default) */
  commentarySpatialAudioEnabled?: boolean;
  /** Cross-session messaging permission: 'open' | 'send_only' | 'receive_only' | 'disabled' */
  crossSessionPermission?: 'open' | 'send_only' | 'receive_only' | 'disabled';
  /** Max cross-session messages per minute for this workspace */
  crossSessionMaxPerMinute?: number;
  /** Pattern learning / self-improving skills settings */
  patternLearningEnabled?: boolean;
  patternLearningSensitivity?: 'aggressive' | 'moderate' | 'conservative';
  patternLearningMinOccurrences?: number;
  patternLearningMinConfidence?: number;
  patternLearningAutoApproveThreshold?: number;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  path: string;
  lastOpened: number;
}
