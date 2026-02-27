// ---------------------------------------------------------------------------
// Cloud Budget Manager — budget enforcement, circuit breakers, cost tracking
// ---------------------------------------------------------------------------
// Singleton service that manages cloud cost controls. Persists all state to
// SQLite for survival across restarts (AC 11). Enforces budget limits at
// global, per-PRD, per-story, and per-provider scopes (AC 1). Hard stops
// provisioning when exceeded (AC 2). Sends soft warnings at configurable
// thresholds (AC 3). Enforces instance limits (AC 4), runtime limits (AC 5),
// and instance type allow/denylists (AC 6).
// ---------------------------------------------------------------------------

import type {
  BudgetLimit,
  BudgetLimitCreateInput,
  BudgetLimitUpdateInput,
  BudgetState,
  BudgetScope,
  BudgetPeriod,
  BudgetStatus,
  CloudInstanceControls,
  CloudCostTrackingRecord,
  CircuitBreakerEvent,
  CircuitBreakerEventType,
  ProvisioningCheckResult,
  CostReportEntry,
  CostReportSummary,
  DailyCostSummary,
  StoryCostEstimate,
  ManagerCostOverview,
  CloudProviderType,
} from '@e/shared';
import { DEFAULT_INSTANCE_CONTROLS, isZeroCostExecutor } from '@e/shared';
import { getDb } from '../db/database.js';
import { nanoid } from 'nanoid';
import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// Budget period helpers
// ---------------------------------------------------------------------------

/** Calculate the start of the current billing period. */
function getPeriodStart(period: BudgetPeriod, now: number = Date.now()): number {
  const date = new Date(now);
  switch (period) {
    case 'day':
      date.setHours(0, 0, 0, 0);
      return date.getTime();
    case 'week': {
      const dayOfWeek = date.getDay();
      date.setDate(date.getDate() - dayOfWeek);
      date.setHours(0, 0, 0, 0);
      return date.getTime();
    }
    case 'month':
      date.setDate(1);
      date.setHours(0, 0, 0, 0);
      return date.getTime();
  }
}

/** Calculate the end of the current billing period. */
function getPeriodEnd(period: BudgetPeriod, now: number = Date.now()): number {
  const date = new Date(now);
  switch (period) {
    case 'day':
      date.setHours(23, 59, 59, 999);
      return date.getTime();
    case 'week': {
      const dayOfWeek = date.getDay();
      date.setDate(date.getDate() + (6 - dayOfWeek));
      date.setHours(23, 59, 59, 999);
      return date.getTime();
    }
    case 'month':
      date.setMonth(date.getMonth() + 1, 0);
      date.setHours(23, 59, 59, 999);
      return date.getTime();
  }
}

// ---------------------------------------------------------------------------
// CloudBudgetManager
// ---------------------------------------------------------------------------

export class CloudBudgetManager {
  readonly events = new EventEmitter();

  // -------------------------------------------------------------------------
  // Budget Limit CRUD (AC 1) — persisted to cloud_budget_limits table (AC 11)
  // -------------------------------------------------------------------------

  /** Create a new budget limit. */
  createBudgetLimit(input: BudgetLimitCreateInput): BudgetLimit {
    const db = getDb();
    const id = nanoid();
    const now = Date.now();
    const thresholds = input.warningThresholds ?? [50, 75, 90];

    db.query(
      `INSERT INTO cloud_budget_limits
        (id, scope, scope_target_id, limit_usd, period, warning_thresholds, hard_stop, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.scope,
      input.scopeTargetId ?? null,
      input.limitUsd,
      input.period,
      JSON.stringify(thresholds),
      (input.hardStop ?? true) ? 1 : 0,
      (input.enabled ?? true) ? 1 : 0,
      now,
      now,
    );

    return {
      id,
      scope: input.scope,
      scopeTargetId: input.scopeTargetId ?? null,
      limitUsd: input.limitUsd,
      period: input.period,
      warningThresholds: thresholds,
      hardStop: input.hardStop ?? true,
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    };
  }

  /** Update an existing budget limit. */
  updateBudgetLimit(id: string, input: BudgetLimitUpdateInput): BudgetLimit | null {
    const db = getDb();
    const existing = this.getBudgetLimit(id);
    if (!existing) return null;

    const sets: string[] = [];
    const values: any[] = [];

    if (input.limitUsd !== undefined) {
      sets.push('limit_usd = ?');
      values.push(input.limitUsd);
    }
    if (input.period !== undefined) {
      sets.push('period = ?');
      values.push(input.period);
    }
    if (input.warningThresholds !== undefined) {
      sets.push('warning_thresholds = ?');
      values.push(JSON.stringify(input.warningThresholds));
    }
    if (input.hardStop !== undefined) {
      sets.push('hard_stop = ?');
      values.push(input.hardStop ? 1 : 0);
    }
    if (input.enabled !== undefined) {
      sets.push('enabled = ?');
      values.push(input.enabled ? 1 : 0);
    }

    if (sets.length === 0) return existing;

    sets.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);

    db.query(`UPDATE cloud_budget_limits SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    return this.getBudgetLimit(id);
  }

  /** Delete a budget limit. */
  deleteBudgetLimit(id: string): boolean {
    const db = getDb();
    const result = db.query('DELETE FROM cloud_budget_limits WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /** Get a single budget limit by ID. */
  getBudgetLimit(id: string): BudgetLimit | null {
    const db = getDb();
    const row = db.query('SELECT * FROM cloud_budget_limits WHERE id = ?').get(id) as any;
    return row ? this.rowToBudgetLimit(row) : null;
  }

  /** List all budget limits, optionally filtered by scope. */
  listBudgetLimits(scope?: BudgetScope): BudgetLimit[] {
    const db = getDb();
    let rows: any[];
    if (scope) {
      rows = db
        .query('SELECT * FROM cloud_budget_limits WHERE scope = ? ORDER BY created_at DESC')
        .all(scope) as any[];
    } else {
      rows = db
        .query('SELECT * FROM cloud_budget_limits ORDER BY scope, created_at DESC')
        .all() as any[];
    }
    return rows.map((r) => this.rowToBudgetLimit(r));
  }

  /** Get budget limits applicable to a specific context. */
  getApplicableBudgets(opts: {
    storyId?: string;
    prdId?: string | null;
    provider?: CloudProviderType;
  }): BudgetLimit[] {
    const all = this.listBudgetLimits();
    return all.filter((b) => {
      if (!b.enabled) return false;
      switch (b.scope) {
        case 'global':
          return true;
        case 'prd':
          return opts.prdId != null && b.scopeTargetId === opts.prdId;
        case 'story':
          return opts.storyId != null && b.scopeTargetId === opts.storyId;
        case 'provider':
          return opts.provider != null && b.scopeTargetId === opts.provider;
        default:
          return false;
      }
    });
  }

  // -------------------------------------------------------------------------
  // Instance Controls (AC 4, 5, 6)
  // -------------------------------------------------------------------------

  /** Get current instance controls (persisted). */
  getInstanceControls(): CloudInstanceControls {
    const db = getDb();
    const row = db
      .query('SELECT * FROM cloud_instance_controls WHERE id = ?')
      .get('singleton') as any;
    if (!row) return { ...DEFAULT_INSTANCE_CONTROLS };

    return {
      maxConcurrentInstances: row.max_concurrent_instances,
      maxRuntimeMinutes: row.max_runtime_minutes,
      instanceTypeAllowlist: JSON.parse(row.instance_type_allowlist),
      instanceTypeDenylist: JSON.parse(row.instance_type_denylist),
    };
  }

  /** Update instance controls. */
  updateInstanceControls(controls: Partial<CloudInstanceControls>): CloudInstanceControls {
    const db = getDb();
    const current = this.getInstanceControls();

    const updated: CloudInstanceControls = {
      maxConcurrentInstances: controls.maxConcurrentInstances ?? current.maxConcurrentInstances,
      maxRuntimeMinutes: controls.maxRuntimeMinutes ?? current.maxRuntimeMinutes,
      instanceTypeAllowlist: controls.instanceTypeAllowlist ?? current.instanceTypeAllowlist,
      instanceTypeDenylist: controls.instanceTypeDenylist ?? current.instanceTypeDenylist,
    };

    db.query(
      `INSERT INTO cloud_instance_controls
        (id, max_concurrent_instances, max_runtime_minutes, instance_type_allowlist, instance_type_denylist, updated_at)
       VALUES ('singleton', ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         max_concurrent_instances = excluded.max_concurrent_instances,
         max_runtime_minutes = excluded.max_runtime_minutes,
         instance_type_allowlist = excluded.instance_type_allowlist,
         instance_type_denylist = excluded.instance_type_denylist,
         updated_at = excluded.updated_at`,
    ).run(
      updated.maxConcurrentInstances,
      updated.maxRuntimeMinutes,
      JSON.stringify(updated.instanceTypeAllowlist),
      JSON.stringify(updated.instanceTypeDenylist),
      Date.now(),
    );

    return updated;
  }

  // -------------------------------------------------------------------------
  // Cost Tracking Records (AC 8) — persisted to cloud_cost_records (AC 11)
  // -------------------------------------------------------------------------

  /** Record a new cloud cost entry (when an instance starts). */
  recordCostStart(input: {
    provider: CloudProviderType;
    region: string;
    instanceType: string;
    storyId: string;
    prdId: string | null;
    instanceId: string;
    executorType: string;
  }): CloudCostTrackingRecord {
    const db = getDb();
    const id = nanoid();
    const now = Date.now();

    db.query(
      `INSERT INTO cloud_cost_records
        (id, provider, region, instance_type, duration_ms, compute_cost_usd,
         story_id, prd_id, instance_id, executor_type, started_at, ended_at, created_at)
       VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, NULL, ?)`,
    ).run(
      id,
      input.provider,
      input.region,
      input.instanceType,
      input.storyId,
      input.prdId,
      input.instanceId,
      input.executorType,
      now,
      now,
    );

    return {
      id,
      provider: input.provider,
      region: input.region,
      instanceType: input.instanceType,
      durationMs: 0,
      computeCostUsd: 0,
      storyId: input.storyId,
      prdId: input.prdId,
      instanceId: input.instanceId,
      executorType: input.executorType,
      startedAt: now,
      endedAt: null,
      createdAt: now,
    };
  }

  /** Update cost record with current duration and cost. */
  updateCostRecord(instanceId: string, hourlyCostUsd: number): void {
    const db = getDb();
    const row = db
      .query(
        'SELECT * FROM cloud_cost_records WHERE instance_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1',
      )
      .get(instanceId) as any;
    if (!row) return;

    const now = Date.now();
    const durationMs = now - row.started_at;
    const costUsd = (durationMs / 3_600_000) * hourlyCostUsd;

    db.query(
      'UPDATE cloud_cost_records SET duration_ms = ?, compute_cost_usd = ? WHERE id = ?',
    ).run(durationMs, costUsd, row.id);
  }

  /** Finalize a cost record when an instance terminates. */
  finalizeCostRecord(instanceId: string, hourlyCostUsd: number): void {
    const db = getDb();
    const row = db
      .query(
        'SELECT * FROM cloud_cost_records WHERE instance_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1',
      )
      .get(instanceId) as any;
    if (!row) return;

    const now = Date.now();
    const durationMs = now - row.started_at;
    const costUsd = (durationMs / 3_600_000) * hourlyCostUsd;

    db.query(
      'UPDATE cloud_cost_records SET duration_ms = ?, compute_cost_usd = ?, ended_at = ? WHERE id = ?',
    ).run(durationMs, costUsd, now, row.id);
  }

  /** Get all cost records, with optional filters. */
  getCostRecords(opts?: {
    storyId?: string;
    prdId?: string;
    provider?: CloudProviderType;
    since?: number;
    until?: number;
  }): CloudCostTrackingRecord[] {
    const db = getDb();
    const conditions: string[] = [];
    const params: any[] = [];

    if (opts?.storyId) {
      conditions.push('story_id = ?');
      params.push(opts.storyId);
    }
    if (opts?.prdId) {
      conditions.push('prd_id = ?');
      params.push(opts.prdId);
    }
    if (opts?.provider) {
      conditions.push('provider = ?');
      params.push(opts.provider);
    }
    if (opts?.since) {
      conditions.push('started_at >= ?');
      params.push(opts.since);
    }
    if (opts?.until) {
      conditions.push('started_at <= ?');
      params.push(opts.until);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = db
      .query(`SELECT * FROM cloud_cost_records ${where} ORDER BY started_at DESC`)
      .all(...params) as any[];

    return rows.map((r) => this.rowToCostRecord(r));
  }

  /** Get active (non-finalized) cost records. */
  getActiveCostRecords(): CloudCostTrackingRecord[] {
    const db = getDb();
    const rows = db
      .query('SELECT * FROM cloud_cost_records WHERE ended_at IS NULL ORDER BY started_at DESC')
      .all() as any[];
    return rows.map((r) => this.rowToCostRecord(r));
  }

  // -------------------------------------------------------------------------
  // Budget State Computation (AC 1, 2, 3)
  // -------------------------------------------------------------------------

  /** Compute the current spend for a budget within its billing period. */
  computeSpend(budget: BudgetLimit): number {
    const db = getDb();
    const periodStart = getPeriodStart(budget.period);

    switch (budget.scope) {
      case 'global': {
        const row = db
          .query(
            'SELECT COALESCE(SUM(compute_cost_usd), 0) as total FROM cloud_cost_records WHERE started_at >= ?',
          )
          .get(periodStart) as any;
        return row.total;
      }
      case 'prd': {
        const row = db
          .query(
            'SELECT COALESCE(SUM(compute_cost_usd), 0) as total FROM cloud_cost_records WHERE prd_id = ? AND started_at >= ?',
          )
          .get(budget.scopeTargetId, periodStart) as any;
        return row.total;
      }
      case 'story': {
        const row = db
          .query(
            'SELECT COALESCE(SUM(compute_cost_usd), 0) as total FROM cloud_cost_records WHERE story_id = ? AND started_at >= ?',
          )
          .get(budget.scopeTargetId, periodStart) as any;
        return row.total;
      }
      case 'provider': {
        const row = db
          .query(
            'SELECT COALESCE(SUM(compute_cost_usd), 0) as total FROM cloud_cost_records WHERE provider = ? AND started_at >= ?',
          )
          .get(budget.scopeTargetId, periodStart) as any;
        return row.total;
      }
      default:
        return 0;
    }
  }

  /** Get the full budget state for a single budget. */
  getBudgetState(budget: BudgetLimit): BudgetState {
    const currentSpend = this.computeSpend(budget);
    const remaining = Math.max(0, budget.limitUsd - currentSpend);
    const usagePercent = budget.limitUsd > 0 ? (currentSpend / budget.limitUsd) * 100 : 0;

    let status: BudgetStatus = 'ok';
    if (currentSpend >= budget.limitUsd) {
      status = 'exceeded';
    } else if (budget.warningThresholds.some((t) => usagePercent >= t)) {
      status = 'warning';
    }

    const triggered = budget.warningThresholds.filter((t) => usagePercent >= t);

    return {
      budget,
      currentSpendUsd: currentSpend,
      remainingUsd: remaining,
      usagePercent,
      status,
      triggeredThresholds: triggered,
      periodStartAt: getPeriodStart(budget.period),
      periodEndAt: getPeriodEnd(budget.period),
    };
  }

  /** Get budget states for all enabled budgets. */
  getAllBudgetStates(): BudgetState[] {
    const budgets = this.listBudgetLimits().filter((b) => b.enabled);
    return budgets.map((b) => this.getBudgetState(b));
  }

  // -------------------------------------------------------------------------
  // Circuit Breaker / Provisioning Check (AC 2, 3, 4, 5, 6)
  // -------------------------------------------------------------------------

  /**
   * Check whether a new cloud instance can be provisioned.
   * This is the main entry point for budget enforcement before launching instances.
   * Returns a ProvisioningCheckResult indicating whether provisioning is allowed,
   * and any circuit breaker events triggered.
   *
   * AC 2: Hard stop when budget exceeded
   * AC 3: Soft warnings at thresholds
   * AC 4: Instance limit enforcement (queued if at limit)
   * AC 6: Instance type allowlist/denylist
   * AC 12: Zero-cost executors are always allowed
   */
  checkProvisioning(opts: {
    storyId: string;
    prdId?: string | null;
    provider: CloudProviderType;
    instanceType: string;
    executorType: string;
    currentActiveInstances: number;
  }): ProvisioningCheckResult {
    const events: CircuitBreakerEvent[] = [];
    const now = Date.now();

    // AC 12: Zero-cost executors (local, SSH) are always allowed
    if (isZeroCostExecutor(opts.executorType)) {
      return { allowed: true, queued: false, events: [] };
    }

    const controls = this.getInstanceControls();

    // AC 6: Instance type allowlist/denylist
    if (controls.instanceTypeDenylist.length > 0) {
      if (controls.instanceTypeDenylist.includes(opts.instanceType)) {
        const event: CircuitBreakerEvent = {
          type: 'instance_type_blocked',
          message: `Instance type "${opts.instanceType}" is on the denylist`,
          instanceType: opts.instanceType,
          timestamp: now,
        };
        events.push(event);
        this.recordEvent(event);
        return { allowed: false, queued: false, reason: event.message, events };
      }
    }
    if (controls.instanceTypeAllowlist.length > 0) {
      if (!controls.instanceTypeAllowlist.includes(opts.instanceType)) {
        const event: CircuitBreakerEvent = {
          type: 'instance_type_blocked',
          message: `Instance type "${opts.instanceType}" is not on the allowlist`,
          instanceType: opts.instanceType,
          timestamp: now,
        };
        events.push(event);
        this.recordEvent(event);
        return { allowed: false, queued: false, reason: event.message, events };
      }
    }

    // AC 4: Max concurrent instances — queue if at limit (not reject)
    if (opts.currentActiveInstances >= controls.maxConcurrentInstances) {
      const event: CircuitBreakerEvent = {
        type: 'instance_limit',
        message: `At maximum concurrent instances (${controls.maxConcurrentInstances}). New dispatch will be queued.`,
        timestamp: now,
      };
      events.push(event);
      this.recordEvent(event);
      return { allowed: false, queued: true, reason: event.message, events };
    }

    // AC 1, 2, 3: Budget enforcement
    const applicableBudgets = this.getApplicableBudgets({
      storyId: opts.storyId,
      prdId: opts.prdId,
      provider: opts.provider,
    });

    for (const budget of applicableBudgets) {
      const state = this.getBudgetState(budget);

      // AC 2: Hard stop when exceeded
      if (state.status === 'exceeded' && budget.hardStop) {
        const event: CircuitBreakerEvent = {
          type: 'budget_exceeded',
          message: `Budget exceeded: ${budget.scope} budget (${budget.scopeTargetId ?? 'global'}) — $${state.currentSpendUsd.toFixed(2)} / $${budget.limitUsd.toFixed(2)}`,
          budgetScope: budget.scope,
          budgetTargetId: budget.scopeTargetId,
          currentSpendUsd: state.currentSpendUsd,
          budgetLimitUsd: budget.limitUsd,
          timestamp: now,
        };
        events.push(event);
        this.recordEvent(event);
        this.events.emit('budget_exceeded', event);
        return { allowed: false, queued: false, reason: event.message, events };
      }

      // AC 3: Soft warnings at thresholds
      if (state.triggeredThresholds.length > 0) {
        const highestTriggered = Math.max(...state.triggeredThresholds);
        const event: CircuitBreakerEvent = {
          type: 'budget_warning',
          message: `Budget warning: ${budget.scope} budget at ${state.usagePercent.toFixed(1)}% ($${state.currentSpendUsd.toFixed(2)} / $${budget.limitUsd.toFixed(2)})`,
          budgetScope: budget.scope,
          budgetTargetId: budget.scopeTargetId,
          currentSpendUsd: state.currentSpendUsd,
          budgetLimitUsd: budget.limitUsd,
          thresholdPercent: highestTriggered,
          timestamp: now,
        };
        events.push(event);
        // Emit warning event for notification handler
        this.events.emit('budget_warning', event);
      }
    }

    return { allowed: true, queued: false, events };
  }

  /**
   * Check if a running golem should be stopped due to budget exhaustion.
   * AC 2: Running golems complete current step then stop.
   */
  shouldStopRunning(opts: {
    storyId: string;
    prdId?: string | null;
    provider: CloudProviderType;
  }): { shouldStop: boolean; reason?: string } {
    const applicableBudgets = this.getApplicableBudgets(opts);

    for (const budget of applicableBudgets) {
      const state = this.getBudgetState(budget);
      if (state.status === 'exceeded' && budget.hardStop) {
        return {
          shouldStop: true,
          reason: `Budget exceeded: ${budget.scope} budget — $${state.currentSpendUsd.toFixed(2)} / $${budget.limitUsd.toFixed(2)}`,
        };
      }
    }

    return { shouldStop: false };
  }

  /**
   * Check if an instance has exceeded its max runtime (AC 5).
   * Returns the list of instance IDs that should be auto-destroyed.
   */
  getTimedOutInstances(): { instanceId: string; storyId: string; runtimeMinutes: number }[] {
    const controls = this.getInstanceControls();
    const maxMs = controls.maxRuntimeMinutes * 60_000;
    const now = Date.now();

    const active = this.getActiveCostRecords();
    return active
      .filter((r) => now - r.startedAt > maxMs)
      .map((r) => ({
        instanceId: r.instanceId,
        storyId: r.storyId,
        runtimeMinutes: Math.round((now - r.startedAt) / 60_000),
      }));
  }

  // -------------------------------------------------------------------------
  // Circuit Breaker Event persistence
  // -------------------------------------------------------------------------

  /** Record a circuit breaker event to the database. */
  private recordEvent(event: CircuitBreakerEvent): void {
    const db = getDb();
    db.query(
      `INSERT INTO cloud_budget_events
        (id, event_type, message, budget_scope, budget_target_id,
         current_spend_usd, budget_limit_usd, threshold_percent,
         instance_type, instance_id, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      nanoid(),
      event.type,
      event.message,
      event.budgetScope ?? null,
      event.budgetTargetId ?? null,
      event.currentSpendUsd ?? null,
      event.budgetLimitUsd ?? null,
      event.thresholdPercent ?? null,
      event.instanceType ?? null,
      event.instanceId ?? null,
      event.timestamp,
    );
  }

  /** Get recent circuit breaker events. */
  getRecentEvents(limit: number = 50): CircuitBreakerEvent[] {
    const db = getDb();
    const rows = db
      .query('SELECT * FROM cloud_budget_events ORDER BY timestamp DESC LIMIT ?')
      .all(limit) as any[];

    return rows.map((r) => ({
      type: r.event_type as CircuitBreakerEventType,
      message: r.message,
      budgetScope: r.budget_scope as BudgetScope | undefined,
      budgetTargetId: r.budget_target_id,
      currentSpendUsd: r.current_spend_usd,
      budgetLimitUsd: r.budget_limit_usd,
      thresholdPercent: r.threshold_percent,
      instanceType: r.instance_type,
      instanceId: r.instance_id,
      timestamp: r.timestamp,
    }));
  }

  // -------------------------------------------------------------------------
  // Cost Reporting (AC 9, 10)
  // -------------------------------------------------------------------------

  /** Generate a cost report summary for a given date range. */
  generateCostReport(opts: {
    startDate: number;
    endDate: number;
    prdId?: string;
    storyId?: string;
    provider?: CloudProviderType;
  }): CostReportSummary {
    const records = this.getCostRecords({
      since: opts.startDate,
      until: opts.endDate,
      prdId: opts.prdId,
      storyId: opts.storyId,
      provider: opts.provider,
    });

    const db = getDb();
    let totalCost = 0;
    let totalDurationMs = 0;
    const byProvider: Record<string, number> = {};
    const byPrd: Record<string, number> = {};
    const byDay: Record<string, number> = {};
    const entries: CostReportEntry[] = [];

    for (const record of records) {
      totalCost += record.computeCostUsd;
      totalDurationMs += record.durationMs;

      byProvider[record.provider] = (byProvider[record.provider] ?? 0) + record.computeCostUsd;

      const prdKey = record.prdId ?? 'standalone';
      byPrd[prdKey] = (byPrd[prdKey] ?? 0) + record.computeCostUsd;

      // Derive day string
      const dayRow = db
        .query(`SELECT strftime('%Y-%m-%d', ?, 'unixepoch') as day`)
        .get(record.startedAt / 1000) as any;
      const day: string = dayRow?.day ?? 'unknown';
      byDay[day] = (byDay[day] ?? 0) + record.computeCostUsd;

      // Look up story title and PRD name for richer reports
      let storyTitle: string | undefined;
      let prdName: string | undefined;
      try {
        const storyRow = db
          .query('SELECT title FROM prd_stories WHERE id = ?')
          .get(record.storyId) as any;
        storyTitle = storyRow?.title;
        if (record.prdId) {
          const prdRow = db.query('SELECT name FROM prds WHERE id = ?').get(record.prdId) as any;
          prdName = prdRow?.name;
        }
      } catch {
        // OK — enrichment is best-effort
      }

      entries.push({
        date: day,
        provider: record.provider,
        region: record.region,
        instanceType: record.instanceType,
        durationMinutes: Math.round(record.durationMs / 60_000),
        computeCostUsd: record.computeCostUsd,
        storyId: record.storyId,
        storyTitle,
        prdId: record.prdId,
        prdName,
        executorType: record.executorType,
      });
    }

    return {
      totalCostUsd: totalCost,
      totalDurationMinutes: Math.round(totalDurationMs / 60_000),
      totalInstances: records.length,
      byProvider,
      byPrd,
      byDay,
      entries,
    };
  }

  /** Export cost data as CSV string (AC 10). */
  exportCsv(entries: CostReportEntry[]): string {
    const headers = [
      'date',
      'provider',
      'region',
      'instance_type',
      'duration_minutes',
      'compute_cost_usd',
      'story_id',
      'story_title',
      'prd_id',
      'prd_name',
      'executor_type',
    ];
    const rows = entries.map((e) =>
      [
        e.date,
        e.provider,
        e.region,
        e.instanceType,
        String(e.durationMinutes),
        e.computeCostUsd.toFixed(4),
        e.storyId,
        e.storyTitle ?? '',
        e.prdId ?? '',
        e.prdName ?? '',
        e.executorType,
      ]
        .map((v) => `"${v.replace(/"/g, '""')}"`)
        .join(','),
    );

    return [headers.join(','), ...rows].join('\n');
  }

  /** Generate a daily cost summary (for notification, AC 9). */
  generateDailySummary(date?: Date): DailyCostSummary {
    const d = date ?? new Date();
    d.setHours(0, 0, 0, 0);
    const dayStart = d.getTime();
    d.setHours(23, 59, 59, 999);
    const dayEnd = d.getTime();

    const report = this.generateCostReport({ startDate: dayStart, endDate: dayEnd });
    const budgetStates = this.getAllBudgetStates();

    const dateStr = new Date(dayStart).toISOString().split('T')[0];

    // Enrich byPrd with names
    const db = getDb();
    const byPrd: Record<string, { name: string; costUsd: number }> = {};
    for (const [prdId, cost] of Object.entries(report.byPrd)) {
      let name = prdId;
      if (prdId !== 'standalone') {
        try {
          const row = db.query('SELECT name FROM prds WHERE id = ?').get(prdId) as any;
          name = row?.name ?? prdId;
        } catch {
          /* best-effort */
        }
      }
      byPrd[prdId] = { name, costUsd: cost };
    }

    return {
      date: dateStr,
      totalCostUsd: report.totalCostUsd,
      instanceCount: report.totalInstances,
      byProvider: report.byProvider,
      byPrd,
      budgetStates,
    };
  }

  // -------------------------------------------------------------------------
  // Manager View (AC 7)
  // -------------------------------------------------------------------------

  /** Get the real-time cost overview for the Manager View. */
  getManagerCostOverview(): ManagerCostOverview {
    const now = Date.now();
    const budgetStates = this.getAllBudgetStates();
    const active = this.getActiveCostRecords();
    const controls = this.getInstanceControls();
    const db = getDb();

    // Per-story cost estimates
    const storyCosts: StoryCostEstimate[] = [];
    const seenStories = new Set<string>();

    // Active instances first
    for (const record of active) {
      if (seenStories.has(record.storyId)) continue;
      seenStories.add(record.storyId);

      let storyTitle = record.storyId;
      try {
        const row = db
          .query('SELECT title FROM prd_stories WHERE id = ?')
          .get(record.storyId) as any;
        storyTitle = row?.title ?? record.storyId;
      } catch {
        /* best-effort */
      }

      // Sum all costs for this story
      const allRecords = this.getCostRecords({ storyId: record.storyId });
      const totalCost = allRecords.reduce((sum, r) => sum + r.computeCostUsd, 0);

      storyCosts.push({
        storyId: record.storyId,
        storyTitle,
        prdId: record.prdId,
        cloudCostUsd: totalCost,
        isActive: true,
        executorType: record.executorType,
      });
    }

    // Calculate total cloud cost across all records for the current period
    // Use global budget period if set, otherwise default to month
    const globalBudgets = budgetStates.filter((s) => s.budget.scope === 'global');
    let totalCloudCost: number;
    if (globalBudgets.length > 0) {
      totalCloudCost = globalBudgets[0].currentSpendUsd;
    } else {
      const monthStart = getPeriodStart('month');
      const row = db
        .query(
          'SELECT COALESCE(SUM(compute_cost_usd), 0) as total FROM cloud_cost_records WHERE started_at >= ?',
        )
        .get(monthStart) as any;
      totalCloudCost = row.total;
    }

    return {
      totalCloudCostUsd: totalCloudCost,
      budgetStates,
      storyCosts,
      instanceControls: controls,
      activeInstanceCount: active.length,
      anyBudgetExceeded: budgetStates.some((s) => s.status === 'exceeded'),
      timestamp: now,
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private rowToBudgetLimit(row: any): BudgetLimit {
    return {
      id: row.id,
      scope: row.scope as BudgetScope,
      scopeTargetId: row.scope_target_id,
      limitUsd: row.limit_usd,
      period: row.period as BudgetPeriod,
      warningThresholds: JSON.parse(row.warning_thresholds),
      hardStop: row.hard_stop === 1,
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private rowToCostRecord(row: any): CloudCostTrackingRecord {
    return {
      id: row.id,
      provider: row.provider as CloudProviderType,
      region: row.region,
      instanceType: row.instance_type,
      durationMs: row.duration_ms,
      computeCostUsd: row.compute_cost_usd,
      storyId: row.story_id,
      prdId: row.prd_id,
      instanceId: row.instance_id,
      executorType: row.executor_type,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      createdAt: row.created_at,
    };
  }
}

/** Singleton budget manager instance. */
export const cloudBudgetManager = new CloudBudgetManager();
