// ---------------------------------------------------------------------------
// Cloud Budget & Cost Control Types
// ---------------------------------------------------------------------------
// Configurable budget limits, cost tracking, and automatic circuit breakers
// for cloud golem spend. Prevents runaway costs with hierarchical budgets
// (global, per-PRD, per-story, per-provider), soft warnings, hard stops,
// instance controls, and cost reporting.
// ---------------------------------------------------------------------------

import type { CloudProviderType } from './cloud-provider.js';

// ---------------------------------------------------------------------------
// Budget period & hierarchy
// ---------------------------------------------------------------------------

/** Billing period for budget enforcement. */
export type BudgetPeriod = 'day' | 'week' | 'month';

/** Budget scope — which level this budget applies to. */
export type BudgetScope = 'global' | 'prd' | 'story' | 'provider';

/** Current state of a budget. */
export type BudgetStatus = 'ok' | 'warning' | 'exceeded';

// ---------------------------------------------------------------------------
// Budget configuration
// ---------------------------------------------------------------------------

/**
 * A single budget limit configuration.
 * Can be applied at global, per-PRD, per-story, or per-provider scope.
 */
export interface BudgetLimit {
  /** Unique ID for this budget limit. */
  id: string;
  /** Budget scope (global, prd, story, provider). */
  scope: BudgetScope;
  /** Scope target ID — null for global, prdId for prd, storyId for story, provider name for provider. */
  scopeTargetId: string | null;
  /** Maximum spend in USD for this budget. */
  limitUsd: number;
  /** Billing period for budget reset. */
  period: BudgetPeriod;
  /** Warning thresholds as percentages (0-100). Default: [50, 75, 90]. */
  warningThresholds: number[];
  /** Whether to hard-stop when budget is exceeded. */
  hardStop: boolean;
  /** Whether this budget is enabled. */
  enabled: boolean;
  /** When this budget was created (epoch ms). */
  createdAt: number;
  /** When this budget was last updated (epoch ms). */
  updatedAt: number;
}

/** Input for creating a budget limit. */
export interface BudgetLimitCreateInput {
  scope: BudgetScope;
  scopeTargetId?: string | null;
  limitUsd: number;
  period: BudgetPeriod;
  warningThresholds?: number[];
  hardStop?: boolean;
  enabled?: boolean;
}

/** Input for updating a budget limit. */
export interface BudgetLimitUpdateInput {
  limitUsd?: number;
  period?: BudgetPeriod;
  warningThresholds?: number[];
  hardStop?: boolean;
  enabled?: boolean;
}

// ---------------------------------------------------------------------------
// Budget status & tracking
// ---------------------------------------------------------------------------

/** Real-time status of a budget. */
export interface BudgetState {
  /** The budget limit configuration. */
  budget: BudgetLimit;
  /** Current spend in USD within the active period. */
  currentSpendUsd: number;
  /** Remaining budget in USD. */
  remainingUsd: number;
  /** Percentage of budget used (0-100). */
  usagePercent: number;
  /** Current budget status. */
  status: BudgetStatus;
  /** Which warning thresholds have been triggered. */
  triggeredThresholds: number[];
  /** Start of the current billing period (epoch ms). */
  periodStartAt: number;
  /** End of the current billing period (epoch ms). */
  periodEndAt: number;
}

// ---------------------------------------------------------------------------
// Instance controls
// ---------------------------------------------------------------------------

/** Configuration for cloud instance controls. */
export interface CloudInstanceControls {
  /** Maximum concurrent cloud instances (default: 10). */
  maxConcurrentInstances: number;
  /** Maximum runtime per cloud instance in minutes (default: 30). Auto-destroy on timeout. */
  maxRuntimeMinutes: number;
  /** Allowed instance types. If non-empty, only these types can be launched. */
  instanceTypeAllowlist: string[];
  /** Denied instance types. Overrides allowlist — these can never be launched. */
  instanceTypeDenylist: string[];
}

/** Default instance controls. */
export const DEFAULT_INSTANCE_CONTROLS: CloudInstanceControls = {
  maxConcurrentInstances: 10,
  maxRuntimeMinutes: 30,
  instanceTypeAllowlist: [],
  instanceTypeDenylist: [],
};

// ---------------------------------------------------------------------------
// Full budget configuration
// ---------------------------------------------------------------------------

/** Complete cost control configuration. */
export interface CostControlConfig {
  /** Budget limits at various scopes. */
  budgets: BudgetLimit[];
  /** Cloud instance controls. */
  instanceControls: CloudInstanceControls;
  /** Default per-story budget in USD (used when no explicit story budget is set). */
  defaultStoryBudgetUsd: number;
  /** Whether cost controls are globally enabled. */
  enabled: boolean;
}

/** Default cost control configuration. */
export const DEFAULT_COST_CONTROL_CONFIG: CostControlConfig = {
  budgets: [],
  instanceControls: DEFAULT_INSTANCE_CONTROLS,
  defaultStoryBudgetUsd: 1.0,
  enabled: true,
};

// ---------------------------------------------------------------------------
// Cloud cost tracking record (persisted)
// ---------------------------------------------------------------------------

/**
 * A single cloud cost tracking record.
 * Acceptance Criterion 8: records provider, region, instance_type, duration,
 * compute_cost, story_id, prd_id.
 */
export interface CloudCostTrackingRecord {
  /** Unique record ID. */
  id: string;
  /** Cloud provider (aws, gcp, azure, custom). */
  provider: CloudProviderType;
  /** Cloud region. */
  region: string;
  /** Instance/machine type. */
  instanceType: string;
  /** Duration in milliseconds. */
  durationMs: number;
  /** Compute cost in USD. */
  computeCostUsd: number;
  /** Story ID this cost is attributed to. */
  storyId: string;
  /** PRD ID (null for standalone stories). */
  prdId: string | null;
  /** Instance ID in the cloud provider. */
  instanceId: string;
  /** Executor type (e.g. "cloud-aws", "cloud-gcp"). */
  executorType: string;
  /** When the instance started (epoch ms). */
  startedAt: number;
  /** When the instance was terminated (epoch ms, null if still running). */
  endedAt: number | null;
  /** When this record was created (epoch ms). */
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Circuit breaker events
// ---------------------------------------------------------------------------

/** Types of circuit breaker events. */
export type CircuitBreakerEventType =
  | 'budget_warning' // Soft warning threshold reached
  | 'budget_exceeded' // Hard budget limit exceeded
  | 'instance_limit' // Max concurrent instances reached
  | 'runtime_timeout' // Instance exceeded max runtime
  | 'instance_type_blocked'; // Blocked instance type attempted

/** A circuit breaker event. */
export interface CircuitBreakerEvent {
  /** Event type. */
  type: CircuitBreakerEventType;
  /** Human-readable message. */
  message: string;
  /** Budget scope that triggered this event (if budget-related). */
  budgetScope?: BudgetScope;
  /** Budget target ID (if budget-related). */
  budgetTargetId?: string | null;
  /** Current spend in USD (if budget-related). */
  currentSpendUsd?: number;
  /** Budget limit in USD (if budget-related). */
  budgetLimitUsd?: number;
  /** Warning threshold percentage that was triggered (if warning). */
  thresholdPercent?: number;
  /** Instance type that was blocked (if instance_type_blocked). */
  instanceType?: string;
  /** Instance ID affected (if runtime_timeout). */
  instanceId?: string;
  /** When this event occurred (epoch ms). */
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Provisioning check result
// ---------------------------------------------------------------------------

/** Result of checking whether a new cloud instance can be provisioned. */
export interface ProvisioningCheckResult {
  /** Whether provisioning is allowed. */
  allowed: boolean;
  /** Reason if not allowed. */
  reason?: string;
  /** Whether the request should be queued (e.g. at instance limit). */
  queued: boolean;
  /** Circuit breaker events triggered by this check. */
  events: CircuitBreakerEvent[];
}

// ---------------------------------------------------------------------------
// Cost report types
// ---------------------------------------------------------------------------

/** Format for cost data export. */
export type CostExportFormat = 'csv' | 'json';

/** Cost report request parameters. */
export interface CostReportRequest {
  /** Start date (epoch ms). */
  startDate: number;
  /** End date (epoch ms). */
  endDate: number;
  /** Filter by PRD ID. */
  prdId?: string;
  /** Filter by story ID. */
  storyId?: string;
  /** Filter by provider. */
  provider?: CloudProviderType;
  /** Export format. */
  format: CostExportFormat;
}

/** Cost report entry for export. */
export interface CostReportEntry {
  date: string;
  provider: string;
  region: string;
  instanceType: string;
  durationMinutes: number;
  computeCostUsd: number;
  storyId: string;
  storyTitle?: string;
  prdId: string | null;
  prdName?: string;
  executorType: string;
}

/** Aggregate cost report summary. */
export interface CostReportSummary {
  /** Total spend in USD. */
  totalCostUsd: number;
  /** Total duration in minutes. */
  totalDurationMinutes: number;
  /** Number of instances tracked. */
  totalInstances: number;
  /** Breakdown by provider. */
  byProvider: Record<string, number>;
  /** Breakdown by PRD. */
  byPrd: Record<string, number>;
  /** Breakdown by day. */
  byDay: Record<string, number>;
  /** Report entries. */
  entries: CostReportEntry[];
}

/** Daily cost summary for notification. */
export interface DailyCostSummary {
  /** Date string (YYYY-MM-DD). */
  date: string;
  /** Total spend in USD. */
  totalCostUsd: number;
  /** Number of instances used. */
  instanceCount: number;
  /** Breakdown by provider. */
  byProvider: Record<string, number>;
  /** Breakdown by PRD. */
  byPrd: Record<string, { name: string; costUsd: number }>;
  /** Active budget states. */
  budgetStates: BudgetState[];
}

// ---------------------------------------------------------------------------
// Real-time cost estimation for Manager View
// ---------------------------------------------------------------------------

/** Per-story real-time cost estimate. */
export interface StoryCostEstimate {
  storyId: string;
  storyTitle: string;
  prdId: string | null;
  /** Current cloud compute cost (from active + finalized instances). */
  cloudCostUsd: number;
  /** Whether an instance is currently running for this story. */
  isActive: boolean;
  /** Executor type. */
  executorType: string;
}

/** Aggregate cost estimate for Manager View. */
export interface ManagerCostOverview {
  /** Total cloud compute spend in the current period. */
  totalCloudCostUsd: number;
  /** Active budget states for all scopes. */
  budgetStates: BudgetState[];
  /** Per-story cost estimates (for active stories). */
  storyCosts: StoryCostEstimate[];
  /** Current instance controls. */
  instanceControls: CloudInstanceControls;
  /** Number of currently active cloud instances. */
  activeInstanceCount: number;
  /** Whether any budget is exceeded. */
  anyBudgetExceeded: boolean;
  /** Timestamp of this snapshot. */
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Executor cost classification
// ---------------------------------------------------------------------------

/** Executor types that are zero-cost (local/SSH). */
export const ZERO_COST_EXECUTOR_TYPES = [
  'local',
  'local-worktree',
  'remote-ssh',
  'ssh-remote',
] as const;

/** Check if an executor type is zero-cost (exempt from cloud budgets). */
export function isZeroCostExecutor(executorType: string): boolean {
  return (ZERO_COST_EXECUTOR_TYPES as readonly string[]).includes(executorType);
}
