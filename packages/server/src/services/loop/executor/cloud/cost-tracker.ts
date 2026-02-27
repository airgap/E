// ---------------------------------------------------------------------------
// Cloud Cost Tracker
// ---------------------------------------------------------------------------
// Records and queries per-story cloud spend across all providers.
// Stores cost records in-memory with optional persistence hooks.
// ---------------------------------------------------------------------------

import type {
  CloudCostRecord,
  CloudProviderType,
  CloudBackendType,
  CloudInstance,
} from '@e/shared';
import { nanoid } from 'nanoid';

/**
 * Aggregate cost summary for a story or across all stories.
 */
export interface CostSummary {
  /** Total cost in USD. */
  totalCostUsd: number;
  /** Total duration in milliseconds. */
  totalDurationMs: number;
  /** Number of instances tracked. */
  instanceCount: number;
  /** Breakdown by provider. */
  byProvider: Record<string, number>;
  /** Breakdown by region. */
  byRegion: Record<string, number>;
  /** Breakdown by instance type. */
  byInstanceType: Record<string, number>;
}

/**
 * Cloud Cost Tracker — records per-story cloud spend with provider, region,
 * instance type, duration, and estimated cost.
 *
 * Acceptance Criterion 7: Cost tracking records per-story cloud spend with
 * provider, region, instance type, duration, and estimated cost.
 */
export class CloudCostTracker {
  private records: CloudCostRecord[] = [];

  /**
   * Start tracking cost for a new cloud instance.
   * Call this when an instance is provisioned.
   */
  startTracking(instance: CloudInstance, executionId: string): CloudCostRecord {
    const record: CloudCostRecord = {
      id: nanoid(),
      storyId: instance.story_id,
      prdId: instance.prd_id ?? null,
      provider: instance.provider,
      region: instance.region,
      instanceType: instance.instance_type,
      startTime: instance.created_at,
      endTime: null,
      durationMs: 0,
      estimatedCostUsd: 0,
      executionId,
      instanceId: instance.instance_id,
      backend: instance.backend,
    };

    this.records.push(record);
    return record;
  }

  /**
   * Update a cost record with current duration and cost estimate.
   * Call this periodically or when instance status changes.
   */
  updateCost(instanceId: string, hourlyCostUsd: number): CloudCostRecord | null {
    const record = this.records.find((r) => r.instanceId === instanceId && r.endTime === null);
    if (!record) return null;

    const now = Date.now();
    const startMs = new Date(record.startTime).getTime();
    record.durationMs = now - startMs;
    record.estimatedCostUsd = (record.durationMs / 3_600_000) * hourlyCostUsd;

    return record;
  }

  /**
   * Finalize a cost record when an instance is terminated.
   */
  finalize(instanceId: string, hourlyCostUsd: number): CloudCostRecord | null {
    const record = this.records.find((r) => r.instanceId === instanceId && r.endTime === null);
    if (!record) return null;

    const now = new Date().toISOString();
    record.endTime = now;
    const startMs = new Date(record.startTime).getTime();
    const endMs = new Date(now).getTime();
    record.durationMs = endMs - startMs;
    record.estimatedCostUsd = (record.durationMs / 3_600_000) * hourlyCostUsd;

    return record;
  }

  /**
   * Get cost records for a specific story.
   */
  getByStory(storyId: string): CloudCostRecord[] {
    return this.records.filter((r) => r.storyId === storyId);
  }

  /**
   * Get cost records for a specific PRD.
   */
  getByPrd(prdId: string): CloudCostRecord[] {
    return this.records.filter((r) => r.prdId === prdId);
  }

  /**
   * Get cost records for a specific execution.
   */
  getByExecution(executionId: string): CloudCostRecord[] {
    return this.records.filter((r) => r.executionId === executionId);
  }

  /**
   * Get cost record for a specific instance.
   */
  getByInstance(instanceId: string): CloudCostRecord | undefined {
    return this.records.find((r) => r.instanceId === instanceId);
  }

  /**
   * Get all cost records, optionally filtered by provider.
   */
  getAll(provider?: CloudProviderType): CloudCostRecord[] {
    if (provider) {
      return this.records.filter((r) => r.provider === provider);
    }
    return [...this.records];
  }

  /**
   * Calculate aggregate cost summary for a story.
   */
  summarizeStory(storyId: string): CostSummary {
    return this.summarize(this.getByStory(storyId));
  }

  /**
   * Calculate aggregate cost summary across all records.
   */
  summarizeAll(): CostSummary {
    return this.summarize(this.records);
  }

  /**
   * Get total cloud spend in USD across all records.
   */
  getTotalSpend(): number {
    return this.records.reduce((sum, r) => sum + r.estimatedCostUsd, 0);
  }

  /**
   * Get active (non-finalized) cost records.
   */
  getActive(): CloudCostRecord[] {
    return this.records.filter((r) => r.endTime === null);
  }

  /**
   * Remove old finalized records (older than the given cutoff).
   */
  pruneOlderThan(cutoffMs: number): number {
    const cutoff = Date.now() - cutoffMs;
    const before = this.records.length;
    this.records = this.records.filter((r) => {
      if (r.endTime === null) return true; // Keep active records
      return new Date(r.endTime).getTime() > cutoff;
    });
    return before - this.records.length;
  }

  private summarize(records: CloudCostRecord[]): CostSummary {
    const summary: CostSummary = {
      totalCostUsd: 0,
      totalDurationMs: 0,
      instanceCount: records.length,
      byProvider: {},
      byRegion: {},
      byInstanceType: {},
    };

    for (const record of records) {
      summary.totalCostUsd += record.estimatedCostUsd;
      summary.totalDurationMs += record.durationMs;
      summary.byProvider[record.provider] =
        (summary.byProvider[record.provider] ?? 0) + record.estimatedCostUsd;
      summary.byRegion[record.region] =
        (summary.byRegion[record.region] ?? 0) + record.estimatedCostUsd;
      summary.byInstanceType[record.instanceType] =
        (summary.byInstanceType[record.instanceType] ?? 0) + record.estimatedCostUsd;
    }

    return summary;
  }
}

/** Singleton cost tracker. */
export const cloudCostTracker = new CloudCostTracker();
