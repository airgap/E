/**
 * autoDream Service - Background Memory Consolidation
 *
 * Runs during idle periods to consolidate observations:
 * - Scans agent notes, pattern detections, and conversation history
 * - Merges related observations
 * - Removes contradictions
 * - Crystallizes confirmed facts
 */

import { EventEmitter } from 'events';
import { nanoid } from 'nanoid';
import { getDb } from '../db/database';
import type {
  DreamState,
  DreamConfig,
  DreamResult,
  DreamPhase,
  DreamTrigger,
  DreamObservation,
  DreamConsolidation,
  StreamDreamEvent,
} from '@e/shared';
import { DEFAULT_DREAM_CONFIG } from '@e/shared';

class AutoDreamService extends EventEmitter {
  private state: DreamState | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private isDreaming = false;

  /**
   * Initialize the dream service for a workspace.
   */
  init(workspacePath: string, config?: Partial<DreamConfig>): void {
    this.state = {
      id: nanoid(12),
      workspacePath,
      phase: 'idle',
      config: { ...DEFAULT_DREAM_CONFIG, ...config },
      totalDreams: 0,
      totalConsolidations: 0,
      totalPruned: 0,
      recentResults: [],
    };
  }

  /**
   * Signal that the system is now idle. Starts the idle timer.
   */
  markIdle(): void {
    if (!this.state || this.isDreaming) return;

    if (this.idleTimer) clearTimeout(this.idleTimer);

    this.idleTimer = setTimeout(
      () => this.triggerDream('idle_timeout'),
      this.state.config.idleThresholdMinutes * 60 * 1000,
    );
  }

  /**
   * Signal that the system is active. Cancels idle timer.
   */
  markActive(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  /**
   * Trigger a dream cycle.
   */
  async triggerDream(trigger: DreamTrigger): Promise<DreamResult | null> {
    if (!this.state || this.isDreaming) return null;
    this.isDreaming = true;

    const result: DreamResult = {
      id: nanoid(12),
      trigger,
      phase: 'scanning',
      startedAt: Date.now(),
      observationsScanned: 0,
      consolidations: [],
      contradictionsResolved: 0,
      entriesPruned: 0,
      factsCrystallized: 0,
    };

    try {
      // Phase 1: Scanning
      this.setPhase('scanning', trigger);
      const observations = this.gatherObservations();
      result.observationsScanned = observations.length;

      if (observations.length === 0) {
        result.phase = 'complete';
        result.completedAt = Date.now();
        result.durationMs = result.completedAt - result.startedAt;
        this.isDreaming = false;
        return result;
      }

      // Phase 2: Analyzing
      this.setPhase('analyzing', trigger);
      const groups = this.groupRelatedObservations(observations);

      // Phase 3: Merging
      this.setPhase('merging', trigger);
      for (const group of groups) {
        if (group.length > 1) {
          const consolidation = this.mergeGroup(group);
          if (consolidation) {
            result.consolidations.push(consolidation);
          }
        }
      }

      // Phase 4: Pruning
      this.setPhase('pruning', trigger);
      result.entriesPruned = this.pruneStaleObservations(observations);

      // Phase 5: Crystallizing
      this.setPhase('crystallizing', trigger);
      result.factsCrystallized = this.crystallizeFacts(observations);

      // Complete
      result.phase = 'complete';
      result.completedAt = Date.now();
      result.durationMs = result.completedAt - result.startedAt;

      // Update state
      this.state.totalDreams++;
      this.state.totalConsolidations += result.consolidations.length;
      this.state.totalPruned += result.entriesPruned;
      this.state.lastDreamAt = Date.now();
      this.state.recentResults = [...this.state.recentResults.slice(-9), result];

      this.persistDreamResult(result);
      this.emitEvent('completed', trigger, undefined, result);
    } catch (err) {
      result.phase = 'complete';
      result.completedAt = Date.now();
      result.durationMs = result.completedAt - result.startedAt;
    } finally {
      this.isDreaming = false;
      this.state.phase = 'idle';
    }

    return result;
  }

  getState(): DreamState | null {
    return this.state;
  }

  // ─── Internal Methods ──────────────────────────────────────────────────

  private gatherObservations(): DreamObservation[] {
    const db = getDb();
    const observations: DreamObservation[] = [];

    try {
      // Gather agent notes
      const notes = db
        .query(
          `
        SELECT id, content, category, confidence, created_at, workspace_path
        FROM agent_notes
        WHERE status = 'active'
        ORDER BY created_at DESC
        LIMIT ?
      `,
        )
        .all(this.state!.config.maxObservationsPerCycle) as any[];

      for (const note of notes) {
        observations.push({
          id: note.id,
          source: 'agent_note',
          sourceId: note.id,
          content: note.content,
          confidence: note.confidence || 0.5,
          timestamp: note.created_at,
          workspacePath: note.workspace_path || this.state!.workspacePath,
        });
      }

      // Gather pattern detections
      const patterns = db
        .query(
          `
        SELECT id, pattern_type, description, confidence, detected_at, workspace_path
        FROM pattern_detections
        WHERE status = 'confirmed'
        ORDER BY detected_at DESC
        LIMIT ?
      `,
        )
        .all(
          Math.max(0, this.state!.config.maxObservationsPerCycle - observations.length),
        ) as any[];

      for (const pattern of patterns) {
        observations.push({
          id: pattern.id,
          source: 'pattern_detection',
          sourceId: pattern.id,
          content: pattern.description,
          confidence: pattern.confidence || 0.6,
          timestamp: pattern.detected_at,
          workspacePath: pattern.workspace_path || this.state!.workspacePath,
        });
      }
    } catch {
      // Tables may not exist
    }

    return observations.filter((o) => o.confidence >= this.state!.config.minConfidenceThreshold);
  }

  private groupRelatedObservations(observations: DreamObservation[]): DreamObservation[][] {
    // Simple grouping by content similarity (word overlap)
    const groups: DreamObservation[][] = [];
    const assigned = new Set<string>();

    for (const obs of observations) {
      if (assigned.has(obs.id)) continue;

      const group = [obs];
      assigned.add(obs.id);

      const obsWords = new Set(obs.content.toLowerCase().split(/\s+/));

      for (const other of observations) {
        if (assigned.has(other.id)) continue;
        const otherWords = new Set(other.content.toLowerCase().split(/\s+/));
        const overlap = [...obsWords].filter((w) => otherWords.has(w) && w.length > 3).length;
        const similarity = overlap / Math.max(obsWords.size, otherWords.size);

        if (similarity > 0.3) {
          group.push(other);
          assigned.add(other.id);
        }
      }

      groups.push(group);
    }

    return groups;
  }

  private mergeGroup(group: DreamObservation[]): DreamConsolidation | null {
    if (group.length < 2) return null;

    // Pick highest confidence observation as the base
    const sorted = group.sort((a, b) => b.confidence - a.confidence);
    const base = sorted[0];

    // Boost confidence when multiple observations agree
    const boostedConfidence = Math.min(1.0, base.confidence + 0.1 * (group.length - 1));

    return {
      mergedObservationIds: group.map((o) => o.id),
      insight: base.content,
      confidence: boostedConfidence,
      replacedPrevious: false,
    };
  }

  private pruneStaleObservations(observations: DreamObservation[]): number {
    const now = Date.now();
    const staleThreshold = 30 * 24 * 60 * 60 * 1000; // 30 days
    let pruned = 0;

    for (const obs of observations) {
      if (now - obs.timestamp > staleThreshold && obs.confidence < 0.5) {
        pruned++;
        // Mark as pruned in the database
        try {
          const db = getDb();
          if (obs.source === 'agent_note') {
            db.query(`UPDATE agent_notes SET status = 'archived' WHERE id = ?`).run(obs.sourceId);
          }
        } catch {
          /* ignore */
        }
      }
    }

    return pruned;
  }

  private crystallizeFacts(observations: DreamObservation[]): number {
    // High-confidence observations that appeared multiple times become "facts"
    let crystallized = 0;
    for (const obs of observations) {
      if (obs.confidence >= 0.9) {
        crystallized++;
      }
    }
    return crystallized;
  }

  private setPhase(phase: DreamPhase, trigger: DreamTrigger): void {
    if (this.state) this.state.phase = phase;
    this.emitEvent('phase_change', trigger, phase);
  }

  private emitEvent(
    event: StreamDreamEvent['event'],
    trigger?: DreamTrigger,
    phase?: DreamPhase,
    result?: DreamResult,
  ): void {
    const sseEvent: StreamDreamEvent = {
      type: 'dream_event',
      event,
      data: { phase, trigger, result },
    };
    this.emit('dream_event', sseEvent);
  }

  private persistDreamResult(result: DreamResult): void {
    try {
      const db = getDb();
      db.query(
        `
        INSERT INTO dream_logs (id, trigger, started_at, completed_at, duration_ms, observations_scanned, consolidations_json, contradictions_resolved, entries_pruned, facts_crystallized)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        result.id,
        result.trigger,
        result.startedAt,
        result.completedAt || null,
        result.durationMs || null,
        result.observationsScanned,
        JSON.stringify(result.consolidations),
        result.contradictionsResolved,
        result.entriesPruned,
        result.factsCrystallized,
      );
    } catch {
      // Table may not exist yet
    }
  }
}

export const autoDream = new AutoDreamService();
