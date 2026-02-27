// ---------------------------------------------------------------------------
// Cloud Budget Notifier
// ---------------------------------------------------------------------------
// Integrates the CloudBudgetManager with the notification system.
// Sends budget warnings, budget exceeded alerts, and daily cost summaries
// through configured notification channels (Slack, Discord, Telegram, Email).
// AC 3: Soft warning notifications at configurable thresholds
// AC 9: Daily cost summary via notification channels
// ---------------------------------------------------------------------------

import { cloudBudgetManager } from './cloud-budget-manager.js';
import { sendNotification } from './notification-channels.js';
import type { CircuitBreakerEvent } from '@e/shared';

/**
 * Initialize budget notification listeners.
 * Call this once at server startup to wire circuit breaker events
 * to the notification system.
 */
export function initBudgetNotifications(): void {
  // AC 3: Forward budget warning events to notification channels
  cloudBudgetManager.events.on('budget_warning', (event: CircuitBreakerEvent) => {
    sendNotification({
      event: 'budget_warning',
      title: '⚠️ Cloud Budget Warning',
      message:
        event.message +
        (event.thresholdPercent ? `\nThreshold: ${event.thresholdPercent}%` : '') +
        (event.currentSpendUsd != null
          ? `\nCurrent spend: $${event.currentSpendUsd.toFixed(2)}`
          : '') +
        (event.budgetLimitUsd != null ? `\nBudget limit: $${event.budgetLimitUsd.toFixed(2)}` : ''),
    }).catch((err) => {
      console.error('[budget-notifier] Failed to send budget warning notification:', err);
    });
  });

  // AC 2: Forward budget exceeded events to notification channels
  cloudBudgetManager.events.on('budget_exceeded', (event: CircuitBreakerEvent) => {
    sendNotification({
      event: 'budget_exceeded',
      title: '🛑 Cloud Budget Exceeded — Provisioning Stopped',
      message:
        event.message +
        '\nAll new cloud golem provisioning has been halted.' +
        '\nRunning golems will complete their current step then stop.' +
        (event.currentSpendUsd != null
          ? `\nCurrent spend: $${event.currentSpendUsd.toFixed(2)}`
          : '') +
        (event.budgetLimitUsd != null ? `\nBudget limit: $${event.budgetLimitUsd.toFixed(2)}` : ''),
    }).catch((err) => {
      console.error('[budget-notifier] Failed to send budget exceeded notification:', err);
    });
  });

  console.log('[budget-notifier] Budget notification listeners initialized');
}

/**
 * Send the daily cost summary notification (AC 9).
 * Intended to be called by a scheduled task or cron-like trigger.
 */
export async function sendDailyCostSummaryNotification(date?: Date): Promise<void> {
  const summary = cloudBudgetManager.generateDailySummary(date);

  // Build a human-readable message
  const lines: string[] = [
    `📊 Daily Cloud Cost Summary — ${summary.date}`,
    '',
    `Total spend: $${summary.totalCostUsd.toFixed(2)}`,
    `Instances used: ${summary.instanceCount}`,
  ];

  // Provider breakdown
  const providers = Object.entries(summary.byProvider);
  if (providers.length > 0) {
    lines.push('', 'By provider:');
    for (const [provider, cost] of providers) {
      lines.push(`  • ${provider}: $${cost.toFixed(2)}`);
    }
  }

  // PRD breakdown
  const prds = Object.entries(summary.byPrd);
  if (prds.length > 0) {
    lines.push('', 'By PRD:');
    for (const [, info] of prds) {
      lines.push(`  • ${info.name}: $${info.costUsd.toFixed(2)}`);
    }
  }

  // Budget warnings
  const warnings = summary.budgetStates.filter((s) => s.status !== 'ok');
  if (warnings.length > 0) {
    lines.push('', '⚠️ Budget alerts:');
    for (const w of warnings) {
      lines.push(
        `  • ${w.budget.scope} (${w.budget.scopeTargetId ?? 'global'}): ` +
          `${w.usagePercent.toFixed(1)}% — $${w.currentSpendUsd.toFixed(2)} / $${w.budget.limitUsd.toFixed(2)} ` +
          `[${w.status.toUpperCase()}]`,
      );
    }
  }

  await sendNotification({
    event: 'daily_cost_summary',
    title: `Cloud Cost Summary — ${summary.date}`,
    message: lines.join('\n'),
  });
}
