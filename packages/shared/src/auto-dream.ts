/**
 * autoDream - Background Memory Consolidation
 *
 * Runs as a forked sub-process during idle periods to consolidate memory:
 * - Merges observations from across sessions
 * - Removes logical contradictions
 * - Converts tentative notes into confirmed facts
 * - Strengthens patterns with repeated evidence
 *
 * The "dream" metaphor: like biological sleep consolidation, the system
 * processes and organizes memories when not actively engaged.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type DreamPhase =
  | 'idle' // Not dreaming
  | 'scanning' // Reading existing memories, notes, and patterns
  | 'analyzing' // Finding connections, contradictions, patterns
  | 'merging' // Combining related observations
  | 'pruning' // Removing contradictions and stale data
  | 'crystallizing' // Converting tentative observations to confirmed facts
  | 'complete'; // Done, returning to idle

export type DreamTrigger =
  | 'idle_timeout' // System was idle for configured duration
  | 'session_end' // A conversation session ended
  | 'loop_complete' // A golem loop finished
  | 'manual' // User triggered consolidation
  | 'scheduled'; // Scheduled (e.g. nightly)

export interface DreamObservation {
  id: string;
  source: 'agent_note' | 'pattern_detection' | 'conversation' | 'loop_log';
  sourceId: string;
  content: string;
  confidence: number; // 0.0 - 1.0
  timestamp: number;
  workspacePath: string;
}

export interface DreamConsolidation {
  /** Observations that were merged */
  mergedObservationIds: string[];
  /** The consolidated insight */
  insight: string;
  /** Confidence after consolidation (typically higher than individual observations) */
  confidence: number;
  /** Whether this contradicted and replaced existing knowledge */
  replacedPrevious: boolean;
}

export interface DreamResult {
  id: string;
  trigger: DreamTrigger;
  phase: DreamPhase;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  /** Observations scanned */
  observationsScanned: number;
  /** Consolidations performed */
  consolidations: DreamConsolidation[];
  /** Contradictions found and resolved */
  contradictionsResolved: number;
  /** Stale entries pruned */
  entriesPruned: number;
  /** New confirmed facts crystallized */
  factsCrystallized: number;
}

export interface DreamConfig {
  /** Minimum idle time before dreaming (minutes) */
  idleThresholdMinutes: number;
  /** Maximum dream duration (seconds) */
  maxDurationSeconds: number;
  /** Model for analysis */
  model: string;
  /** Minimum observation confidence to consider (0.0 - 1.0) */
  minConfidenceThreshold: number;
  /** Maximum observations to process per dream cycle */
  maxObservationsPerCycle: number;
  /** Auto-trigger on session end */
  triggerOnSessionEnd: boolean;
  /** Auto-trigger on loop complete */
  triggerOnLoopComplete: boolean;
}

export interface DreamState {
  id: string;
  workspacePath: string;
  phase: DreamPhase;
  config: DreamConfig;
  lastDreamAt?: number;
  totalDreams: number;
  totalConsolidations: number;
  totalPruned: number;
  recentResults: DreamResult[];
}

// ─── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_DREAM_CONFIG: DreamConfig = {
  idleThresholdMinutes: 15,
  maxDurationSeconds: 120,
  model: 'claude-haiku-4-5-20251001',
  minConfidenceThreshold: 0.3,
  maxObservationsPerCycle: 100,
  triggerOnSessionEnd: true,
  triggerOnLoopComplete: true,
};

// ─── SSE Event ───────────────────────────────────────────────────────────────

export interface StreamDreamEvent {
  type: 'dream_event';
  event: 'started' | 'phase_change' | 'consolidation' | 'completed';
  data: {
    phase?: DreamPhase;
    trigger?: DreamTrigger;
    message?: string;
    result?: DreamResult;
    observationsScanned?: number;
  };
}
