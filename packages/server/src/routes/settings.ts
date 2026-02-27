import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { getDb } from '../db/database';
import { listOllamaModels, checkOllamaHealth } from '../services/ollama-provider';
import { resetOllamaCache } from '../services/llm-oneshot';
import { listOpenAIModels } from '../services/openai-provider-v2';
import { listGeminiModels } from '../services/gemini-provider-v2';
import {
  ensurePermissionRulesTable,
  loadPermissionRules,
  savePermissionRule,
  deletePermissionRule,
} from '../services/permission-rules';
import { PERMISSION_PRESETS } from '@e/shared';

const app = new Hono();

// Sensitive keys that should never be sent to the client
const SENSITIVE_KEYS = new Set([
  'anthropicApiKey',
  'openaiApiKey',
  'googleApiKey',
  'jiraConfig',
  'linearConfig',
  'asanaConfig',
]);

// Get all settings
app.get('/', (c) => {
  const db = getDb();
  const rows = db.query('SELECT * FROM settings').all() as any[];
  const settings: Record<string, any> = {};
  for (const row of rows) {
    if (SENSITIVE_KEYS.has(row.key)) {
      // Only expose whether the key is configured, not the value
      settings[row.key + 'Configured'] = !!JSON.parse(row.value);
    } else {
      settings[row.key] = JSON.parse(row.value);
    }
  }
  return c.json({ ok: true, data: settings });
});

// Update settings (merge)
app.patch('/', async (c) => {
  const body = await c.req.json();
  const db = getDb();

  const upsert = db.query(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  for (const [key, value] of Object.entries(body.settings || body)) {
    upsert.run(key, JSON.stringify(value));
  }

  // Reset cached Ollama availability when oneshot settings change
  if ('oneshotProvider' in (body.settings || body) || 'oneshotModel' in (body.settings || body)) {
    resetOllamaCache();
  }

  // Note: Device capabilities don't need special cache handling here
  // The device routes load them from settings on each request for security

  return c.json({ ok: true });
});

// --- Permission Rules CRUD ---

// List permission rule presets
app.get('/permission-rules/presets', (c) => {
  return c.json({ ok: true, data: PERMISSION_PRESETS });
});

// List permission rules (with optional scope filter)
app.get('/permission-rules', (c) => {
  ensurePermissionRulesTable();
  const scope = c.req.query('scope');
  const workspacePath = c.req.query('workspacePath');
  const conversationId = c.req.query('conversationId');

  const rules = loadPermissionRules(conversationId, workspacePath);

  // If a specific scope is requested, filter
  if (scope) {
    return c.json({ ok: true, data: rules.filter((r) => r.scope === scope) });
  }

  return c.json({ ok: true, data: rules });
});

// Create a permission rule
app.post('/permission-rules', async (c) => {
  ensurePermissionRulesTable();
  const body = await c.req.json();
  const { type, tool, pattern, scope, workspacePath, conversationId } = body;

  if (!type || !tool || !scope) {
    return c.json({ ok: false, error: 'type, tool, and scope are required' }, 400);
  }

  const rule = {
    id: nanoid(),
    type: type as 'allow' | 'deny' | 'ask',
    tool: tool as string,
    pattern: pattern || undefined,
    scope: scope as 'session' | 'project' | 'global',
  };

  savePermissionRule(rule, workspacePath, conversationId);

  return c.json({ ok: true, data: rule });
});

// Update a permission rule
app.patch('/permission-rules/:id', async (c) => {
  ensurePermissionRulesTable();
  const ruleId = c.req.param('id');
  const body = await c.req.json();

  const db = getDb();
  const existing = db.query('SELECT data FROM permission_rules WHERE id = ?').get(ruleId) as {
    data: string;
  } | null;
  if (!existing) {
    return c.json({ ok: false, error: 'Rule not found' }, 404);
  }

  const rule = { ...JSON.parse(existing.data), ...body, id: ruleId };
  savePermissionRule(rule, body.workspacePath, body.conversationId);

  return c.json({ ok: true, data: rule });
});

// Delete a permission rule
app.delete('/permission-rules/:id', (c) => {
  ensurePermissionRulesTable();
  const ruleId = c.req.param('id');
  deletePermissionRule(ruleId);
  return c.json({ ok: true });
});

// Apply a preset — replaces all rules for a given scope
app.post('/permission-rules/apply-preset', async (c) => {
  ensurePermissionRulesTable();
  const body = await c.req.json();
  const { presetId, scope, workspacePath, conversationId } = body;

  const preset = PERMISSION_PRESETS.find((p) => p.id === presetId);
  if (!preset) {
    return c.json({ ok: false, error: 'Preset not found' }, 404);
  }

  const db = getDb();

  // Delete existing rules for this scope
  if (scope === 'global') {
    db.query("DELETE FROM permission_rules WHERE scope = 'global'").run();
  } else if (scope === 'project' && workspacePath) {
    db.query("DELETE FROM permission_rules WHERE scope = 'project' AND workspace_path = ?").run(
      workspacePath,
    );
  } else if (scope === 'session' && conversationId) {
    db.query("DELETE FROM permission_rules WHERE scope = 'session' AND conversation_id = ?").run(
      conversationId,
    );
  }

  // Insert new rules from preset
  const rules = preset.rules.map((r) => ({
    id: nanoid(),
    type: r.type,
    tool: r.tool,
    pattern: r.pattern,
    scope: scope as 'session' | 'project' | 'global',
  }));

  for (const rule of rules) {
    savePermissionRule(rule, workspacePath, conversationId);
  }

  return c.json({ ok: true, data: rules });
});

// Ollama model discovery
app.get('/ollama/status', async (c) => {
  const healthy = await checkOllamaHealth();
  return c.json({ ok: true, data: { available: healthy } });
});

app.get('/ollama/models', async (c) => {
  const models = await listOllamaModels();
  return c.json({ ok: true, data: models });
});

// OpenAI model discovery
app.get('/openai/models', async (c) => {
  const models = await listOpenAIModels();
  return c.json({ ok: true, data: models });
});

// Google Gemini model discovery
app.get('/gemini/models', async (c) => {
  const models = await listGeminiModels();
  return c.json({ ok: true, data: models });
});

// Set API key (BYOK)
app.put('/api-key', async (c) => {
  const body = await c.req.json();
  const { provider, apiKey } = body;

  if (!provider || !apiKey) {
    return c.json({ ok: false, error: 'provider and apiKey required' }, 400);
  }

  const keyMap: Record<string, string> = {
    anthropic: 'anthropicApiKey',
    openai: 'openaiApiKey',
    google: 'googleApiKey',
  };

  const settingKey = keyMap[provider];
  if (!settingKey) return c.json({ ok: false, error: 'Unknown provider' }, 400);

  const db = getDb();
  db.query(
    `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(settingKey, JSON.stringify(apiKey));

  // Also set as environment variable for the current process
  const envMap: Record<string, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    google: 'GOOGLE_API_KEY',
  };
  if (envMap[provider]) {
    process.env[envMap[provider]] = apiKey;
  }

  return c.json({ ok: true });
});

// Check which API keys are configured
app.get('/api-keys/status', (c) => {
  const db = getDb();
  const keys = ['anthropicApiKey', 'openaiApiKey', 'googleApiKey'];
  const status: Record<string, boolean> = {};

  for (const key of keys) {
    const row = db.query('SELECT value FROM settings WHERE key = ?').get(key) as any;
    const envKey =
      key === 'anthropicApiKey'
        ? 'ANTHROPIC_API_KEY'
        : key === 'openaiApiKey'
          ? 'OPENAI_API_KEY'
          : 'GOOGLE_API_KEY';
    status[key.replace('ApiKey', '')] = !!(row && JSON.parse(row.value)) || !!process.env[envKey];
  }

  return c.json({ ok: true, data: status });
});

// Get/set session budget
app.get('/budget', (c) => {
  const db = getDb();
  const row = db.query("SELECT value FROM settings WHERE key = 'sessionBudgetUsd'").get() as any;
  const budget = row ? JSON.parse(row.value) : null;
  return c.json({ ok: true, data: { budgetUsd: budget } });
});

app.put('/budget', async (c) => {
  const body = await c.req.json();
  const { budgetUsd } = body;

  const db = getDb();
  if (budgetUsd == null) {
    db.query("DELETE FROM settings WHERE key = 'sessionBudgetUsd'").run();
  } else {
    db.query(
      `INSERT INTO settings (key, value) VALUES ('sessionBudgetUsd', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(JSON.stringify(budgetUsd));
  }

  return c.json({ ok: true });
});

// Get single setting by key (catch-all — must be last to avoid shadowing specific routes like /budget)
app.get('/:key', (c) => {
  const db = getDb();
  const row = db.query('SELECT value FROM settings WHERE key = ?').get(c.req.param('key')) as any;
  if (!row) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true, data: JSON.parse(row.value) });
});

export { app as settingsRoutes };
