/**
 * Telemetry Service
 *
 * Privacy-first, local-only usage analytics.
 * All data stays on-device unless user configures an export endpoint.
 */

import { nanoid } from 'nanoid';
import { getDb } from '../db/database';
import type {
  TelemetryEvent,
  TelemetryEventType,
  TelemetryDailySummary,
  TelemetryConfig,
} from '@e/shared';
import { DEFAULT_TELEMETRY_CONFIG } from '@e/shared';

class TelemetryService {
  private static instance: TelemetryService;
  private config: TelemetryConfig = { ...DEFAULT_TELEMETRY_CONFIG };
  private sessionId = nanoid(12);

  static getInstance(): TelemetryService {
    if (!TelemetryService.instance) {
      TelemetryService.instance = new TelemetryService();
    }
    return TelemetryService.instance;
  }

  setConfig(config: Partial<TelemetryConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): TelemetryConfig {
    return { ...this.config };
  }

  /**
   * Record a telemetry event.
   */
  track(type: TelemetryEventType, data: Record<string, string | number | boolean> = {}): void {
    if (!this.config.enabled) return;
    if (this.config.enabledEvents.length > 0 && !this.config.enabledEvents.includes(type)) return;

    const event: TelemetryEvent = {
      id: nanoid(12),
      type,
      timestamp: Date.now(),
      data,
      sessionId: this.sessionId,
    };

    const db = getDb();
    db.query(
      `INSERT INTO telemetry_events (id, type, session_id, data_json, timestamp) VALUES (?, ?, ?, ?, ?)`,
    ).run(event.id, event.type, event.sessionId, JSON.stringify(event.data), event.timestamp);
  }

  /**
   * Get events within a time range.
   */
  getEvents(
    since?: number,
    until?: number,
    type?: TelemetryEventType,
    limit = 100,
  ): TelemetryEvent[] {
    const db = getDb();
    let query = 'SELECT * FROM telemetry_events WHERE 1=1';
    const params: any[] = [];

    if (since) {
      query += ' AND timestamp >= ?';
      params.push(since);
    }
    if (until) {
      query += ' AND timestamp <= ?';
      params.push(until);
    }
    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }

    query += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);

    const rows = db.query(query).all(...params) as any[];
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      timestamp: r.timestamp,
      data: JSON.parse(r.data_json),
      sessionId: r.session_id,
    }));
  }

  /**
   * Get a daily summary for a given date.
   */
  getDailySummary(date: string): TelemetryDailySummary {
    const db = getDb();
    const dayStart = new Date(date).setHours(0, 0, 0, 0);
    const dayEnd = new Date(date).setHours(23, 59, 59, 999);

    const events = db
      .query('SELECT type, data_json FROM telemetry_events WHERE timestamp >= ? AND timestamp <= ?')
      .all(dayStart, dayEnd) as any[];

    const toolCounts = new Map<string, number>();
    const modelCounts = new Map<string, number>();
    const features = new Set<string>();
    let tokens = 0;

    for (const e of events) {
      const data = JSON.parse(e.data_json);
      if (e.type === 'tool_invoked' && data.tool) {
        toolCounts.set(data.tool, (toolCounts.get(data.tool) || 0) + 1);
      }
      if (e.type === 'model_used' && data.model) {
        modelCounts.set(data.model as string, (modelCounts.get(data.model as string) || 0) + 1);
      }
      if (e.type === 'tokens_consumed' && data.count) {
        tokens += data.count as number;
      }
      if (e.type === 'feature_used' && data.feature) {
        features.add(data.feature as string);
      }
    }

    const count = (type: string) => events.filter((e) => e.type === type).length;

    return {
      date,
      sessionCount: count('session_start'),
      messageCount: count('message_sent'),
      toolInvocations: count('tool_invoked'),
      toolErrors: count('tool_error'),
      tokensConsumed: tokens,
      estimatedCostUsd: 0, // Would need model-specific pricing
      loopsRun: count('loop_started'),
      storiesCompleted: count('story_completed'),
      storiesFailed: count('story_failed'),
      topTools: Array.from(toolCounts.entries())
        .map(([tool, c]) => ({ tool, count: c }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      topModels: Array.from(modelCounts.entries())
        .map(([model, c]) => ({ model, count: c }))
        .sort((a, b) => b.count - a.count),
      featuresUsed: Array.from(features),
    };
  }

  /**
   * Prune old events based on retention policy.
   */
  prune(): number {
    if (this.config.retentionDays <= 0) return 0;
    const cutoff = Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000;
    const db = getDb();
    const result = db.query('DELETE FROM telemetry_events WHERE timestamp < ?').run(cutoff);
    return result.changes;
  }
}

export const telemetry = TelemetryService.getInstance();
