// ---------------------------------------------------------------------------
// Cloud Budget & Cost Control API Routes
// ---------------------------------------------------------------------------
// REST endpoints for managing cloud budgets, instance controls, cost tracking,
// cost reporting (CSV/JSON export), and real-time Manager View data.
// ---------------------------------------------------------------------------

import { Hono } from 'hono';
import { cloudBudgetManager } from '../services/cloud-budget-manager.js';
import type {
  BudgetScope,
  BudgetLimitCreateInput,
  BudgetLimitUpdateInput,
  CloudProviderType,
  CostExportFormat,
} from '@e/shared';

const app = new Hono();

// ---------------------------------------------------------------------------
// Budget Limits CRUD (AC 1)
// ---------------------------------------------------------------------------

/** GET /api/cloud-budget/limits — List all budget limits. */
app.get('/limits', (c) => {
  const scope = c.req.query('scope') as BudgetScope | undefined;
  const limits = cloudBudgetManager.listBudgetLimits(scope);
  return c.json({ ok: true, data: limits });
});

/** GET /api/cloud-budget/limits/:id — Get a single budget limit. */
app.get('/limits/:id', (c) => {
  const limit = cloudBudgetManager.getBudgetLimit(c.req.param('id'));
  if (!limit) return c.json({ ok: false, error: 'Budget limit not found' }, 404);
  return c.json({ ok: true, data: limit });
});

/** POST /api/cloud-budget/limits — Create a budget limit. */
app.post('/limits', async (c) => {
  const body = await c.req.json<BudgetLimitCreateInput>();

  if (!body.scope || body.limitUsd == null || !body.period) {
    return c.json({ ok: false, error: 'scope, limitUsd, and period are required' }, 400);
  }

  const limit = cloudBudgetManager.createBudgetLimit(body);
  return c.json({ ok: true, data: limit }, 201);
});

/** PATCH /api/cloud-budget/limits/:id — Update a budget limit. */
app.patch('/limits/:id', async (c) => {
  const body = await c.req.json<BudgetLimitUpdateInput>();
  const limit = cloudBudgetManager.updateBudgetLimit(c.req.param('id'), body);
  if (!limit) return c.json({ ok: false, error: 'Budget limit not found' }, 404);
  return c.json({ ok: true, data: limit });
});

/** DELETE /api/cloud-budget/limits/:id — Delete a budget limit. */
app.delete('/limits/:id', (c) => {
  const deleted = cloudBudgetManager.deleteBudgetLimit(c.req.param('id'));
  if (!deleted) return c.json({ ok: false, error: 'Budget limit not found' }, 404);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Budget State (AC 1, 2, 3)
// ---------------------------------------------------------------------------

/** GET /api/cloud-budget/states — Get all budget states. */
app.get('/states', (c) => {
  const states = cloudBudgetManager.getAllBudgetStates();
  return c.json({ ok: true, data: states });
});

/** GET /api/cloud-budget/states/:id — Get state for a single budget. */
app.get('/states/:id', (c) => {
  const limit = cloudBudgetManager.getBudgetLimit(c.req.param('id'));
  if (!limit) return c.json({ ok: false, error: 'Budget limit not found' }, 404);
  const state = cloudBudgetManager.getBudgetState(limit);
  return c.json({ ok: true, data: state });
});

// ---------------------------------------------------------------------------
// Instance Controls (AC 4, 5, 6)
// ---------------------------------------------------------------------------

/** GET /api/cloud-budget/instance-controls — Get current instance controls. */
app.get('/instance-controls', (c) => {
  const controls = cloudBudgetManager.getInstanceControls();
  return c.json({ ok: true, data: controls });
});

/** PUT /api/cloud-budget/instance-controls — Update instance controls. */
app.put('/instance-controls', async (c) => {
  const body = await c.req.json();
  const controls = cloudBudgetManager.updateInstanceControls(body);
  return c.json({ ok: true, data: controls });
});

// ---------------------------------------------------------------------------
// Cost Records (AC 8)
// ---------------------------------------------------------------------------

/** GET /api/cloud-budget/cost-records — List cost tracking records. */
app.get('/cost-records', (c) => {
  const storyId = c.req.query('storyId');
  const prdId = c.req.query('prdId');
  const provider = c.req.query('provider') as CloudProviderType | undefined;
  const since = c.req.query('since') ? Number(c.req.query('since')) : undefined;
  const until = c.req.query('until') ? Number(c.req.query('until')) : undefined;

  const records = cloudBudgetManager.getCostRecords({
    storyId: storyId || undefined,
    prdId: prdId || undefined,
    provider,
    since,
    until,
  });
  return c.json({ ok: true, data: records });
});

// ---------------------------------------------------------------------------
// Circuit Breaker Events
// ---------------------------------------------------------------------------

/** GET /api/cloud-budget/events — Get recent circuit breaker events. */
app.get('/events', (c) => {
  const limit = Number(c.req.query('limit') || '50');
  const events = cloudBudgetManager.getRecentEvents(limit);
  return c.json({ ok: true, data: events });
});

// ---------------------------------------------------------------------------
// Provisioning Check (AC 2, 4, 6)
// ---------------------------------------------------------------------------

/** POST /api/cloud-budget/check — Check if provisioning is allowed. */
app.post('/check', async (c) => {
  const body = await c.req.json();
  const result = cloudBudgetManager.checkProvisioning({
    storyId: body.storyId,
    prdId: body.prdId,
    provider: body.provider,
    instanceType: body.instanceType,
    executorType: body.executorType,
    currentActiveInstances: body.currentActiveInstances ?? 0,
  });
  return c.json({ ok: true, data: result });
});

// ---------------------------------------------------------------------------
// Cost Reports (AC 9, 10)
// ---------------------------------------------------------------------------

/** GET /api/cloud-budget/report — Generate a cost report. */
app.get('/report', (c) => {
  const startDate = Number(c.req.query('startDate') || getPeriodStartDefault());
  const endDate = Number(c.req.query('endDate') || Date.now());
  const prdId = c.req.query('prdId') || undefined;
  const storyId = c.req.query('storyId') || undefined;
  const provider = c.req.query('provider') as CloudProviderType | undefined;
  const format = (c.req.query('format') || 'json') as CostExportFormat;

  const report = cloudBudgetManager.generateCostReport({
    startDate,
    endDate,
    prdId,
    storyId,
    provider,
  });

  // AC 10: CSV export
  if (format === 'csv') {
    const csv = cloudBudgetManager.exportCsv(report.entries);
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="cost-report-${new Date().toISOString().split('T')[0]}.csv"`,
      },
    });
  }

  // JSON export
  return c.json({ ok: true, data: report });
});

/** GET /api/cloud-budget/daily-summary — Get today's cost summary (AC 9). */
app.get('/daily-summary', (c) => {
  const dateStr = c.req.query('date');
  const date = dateStr ? new Date(dateStr) : undefined;
  const summary = cloudBudgetManager.generateDailySummary(date);
  return c.json({ ok: true, data: summary });
});

// ---------------------------------------------------------------------------
// Manager View (AC 7)
// ---------------------------------------------------------------------------

/** GET /api/cloud-budget/overview — Real-time cost overview for Manager View. */
app.get('/overview', (c) => {
  const overview = cloudBudgetManager.getManagerCostOverview();
  return c.json({ ok: true, data: overview });
});

// ---------------------------------------------------------------------------
// Timed-out instances (AC 5)
// ---------------------------------------------------------------------------

/** GET /api/cloud-budget/timed-out — Get instances that have exceeded max runtime. */
app.get('/timed-out', (c) => {
  const timedOut = cloudBudgetManager.getTimedOutInstances();
  return c.json({ ok: true, data: timedOut });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Default to start of current month if no startDate provided. */
function getPeriodStartDefault(): number {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export { app as cloudBudgetRoutes };
