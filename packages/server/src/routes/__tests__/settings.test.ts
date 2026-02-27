import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { createTestDb } from '../../test-helpers';

const testDb = createTestDb();
mock.module('../../db/database', () => ({
  getDb: () => testDb,
  initDatabase: () => {},
}));

// Mock external services that settings routes call
const mockCheckOllamaHealth = mock(() => Promise.resolve(true));
const mockListOllamaModels = mock(() => Promise.resolve([{ name: 'llama3' }]));
const mockResetOllamaCache = mock(() => {});
const mockListOpenAIModels = mock(() => Promise.resolve([{ id: 'gpt-4' }]));
const mockListGeminiModels = mock(() => Promise.resolve([{ name: 'gemini-pro' }]));

mock.module('../../services/ollama-provider', () => ({
  checkOllamaHealth: mockCheckOllamaHealth,
  listOllamaModels: mockListOllamaModels,
}));

mock.module('../../services/llm-oneshot', () => ({
  resetOllamaCache: mockResetOllamaCache,
}));

mock.module('../../services/openai-provider-v2', () => ({
  listOpenAIModels: mockListOpenAIModels,
}));

mock.module('../../services/gemini-provider-v2', () => ({
  listGeminiModels: mockListGeminiModels,
}));

import { settingsRoutes as app } from '../settings';

function clearTables() {
  testDb.exec('DELETE FROM settings');
}

function insertSetting(key: string, value: any) {
  testDb.query('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, JSON.stringify(value));
}

describe('Settings Routes', () => {
  beforeEach(() => {
    clearTables();
  });

  // ---------------------------------------------------------------
  // GET / — Get all settings
  // ---------------------------------------------------------------
  describe('GET / — get all settings', () => {
    test('returns empty object when no settings exist', async () => {
      const res = await app.request('/');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data).toEqual({});
    });

    test('returns all settings as key-value map', async () => {
      insertSetting('theme', 'dark');
      insertSetting('fontSize', 14);
      insertSetting('features', { beta: true, experimental: false });

      const res = await app.request('/');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.theme).toBe('dark');
      expect(json.data.fontSize).toBe(14);
      expect(json.data.features).toEqual({ beta: true, experimental: false });
    });

    test('parses JSON values correctly for various types', async () => {
      insertSetting('string_val', 'hello');
      insertSetting('number_val', 42);
      insertSetting('bool_val', true);
      insertSetting('null_val', null);
      insertSetting('array_val', [1, 2, 3]);

      const res = await app.request('/');
      const json = await res.json();
      expect(json.data.string_val).toBe('hello');
      expect(json.data.number_val).toBe(42);
      expect(json.data.bool_val).toBe(true);
      expect(json.data.null_val).toBeNull();
      expect(json.data.array_val).toEqual([1, 2, 3]);
    });
  });

  // ---------------------------------------------------------------
  // GET /:key — Get single setting
  // ---------------------------------------------------------------
  describe('GET /:key — get single setting', () => {
    test('returns 404 for non-existent key', async () => {
      const res = await app.request('/nonexistent');
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('Not found');
    });

    test('returns a string setting', async () => {
      insertSetting('theme', 'dark');

      const res = await app.request('/theme');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data).toBe('dark');
    });

    test('returns a numeric setting', async () => {
      insertSetting('fontSize', 16);

      const res = await app.request('/fontSize');
      const json = await res.json();
      expect(json.data).toBe(16);
    });

    test('returns a boolean setting', async () => {
      insertSetting('autoSave', true);

      const res = await app.request('/autoSave');
      const json = await res.json();
      expect(json.data).toBe(true);
    });

    test('returns an object setting', async () => {
      insertSetting('keybindings', { save: 'ctrl+s', quit: 'ctrl+q' });

      const res = await app.request('/keybindings');
      const json = await res.json();
      expect(json.data).toEqual({ save: 'ctrl+s', quit: 'ctrl+q' });
    });

    test('returns an array setting', async () => {
      insertSetting('recentFiles', ['/a.ts', '/b.ts']);

      const res = await app.request('/recentFiles');
      const json = await res.json();
      expect(json.data).toEqual(['/a.ts', '/b.ts']);
    });
  });

  // ---------------------------------------------------------------
  // PATCH / — Update/merge settings
  // ---------------------------------------------------------------
  describe('PATCH / — update settings', () => {
    test('creates new settings', async () => {
      const res = await app.request('/', {
        method: 'PATCH',
        body: JSON.stringify({ theme: 'light', fontSize: 12 }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);

      // Verify in DB
      const row1 = testDb.query('SELECT value FROM settings WHERE key = ?').get('theme') as any;
      expect(JSON.parse(row1.value)).toBe('light');
      const row2 = testDb.query('SELECT value FROM settings WHERE key = ?').get('fontSize') as any;
      expect(JSON.parse(row2.value)).toBe(12);
    });

    test('upserts (overwrites) existing settings', async () => {
      insertSetting('theme', 'dark');

      await app.request('/', {
        method: 'PATCH',
        body: JSON.stringify({ theme: 'light' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const row = testDb.query('SELECT value FROM settings WHERE key = ?').get('theme') as any;
      expect(JSON.parse(row.value)).toBe('light');
    });

    test('accepts body wrapped in settings key', async () => {
      const res = await app.request('/', {
        method: 'PATCH',
        body: JSON.stringify({ settings: { lang: 'en', zoom: 1.5 } }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(200);

      const row = testDb.query('SELECT value FROM settings WHERE key = ?').get('lang') as any;
      expect(JSON.parse(row.value)).toBe('en');
      const row2 = testDb.query('SELECT value FROM settings WHERE key = ?').get('zoom') as any;
      expect(JSON.parse(row2.value)).toBe(1.5);
    });

    test('stores complex object values', async () => {
      await app.request('/', {
        method: 'PATCH',
        body: JSON.stringify({ editor: { tabSize: 2, wordWrap: true } }),
        headers: { 'Content-Type': 'application/json' },
      });

      const row = testDb.query('SELECT value FROM settings WHERE key = ?').get('editor') as any;
      expect(JSON.parse(row.value)).toEqual({ tabSize: 2, wordWrap: true });
    });

    test('stores array values', async () => {
      await app.request('/', {
        method: 'PATCH',
        body: JSON.stringify({ favorites: ['a', 'b', 'c'] }),
        headers: { 'Content-Type': 'application/json' },
      });

      const row = testDb.query('SELECT value FROM settings WHERE key = ?').get('favorites') as any;
      expect(JSON.parse(row.value)).toEqual(['a', 'b', 'c']);
    });

    test('stores null values', async () => {
      await app.request('/', {
        method: 'PATCH',
        body: JSON.stringify({ removed: null }),
        headers: { 'Content-Type': 'application/json' },
      });

      const row = testDb.query('SELECT value FROM settings WHERE key = ?').get('removed') as any;
      expect(JSON.parse(row.value)).toBeNull();
    });

    test('does not affect other existing settings', async () => {
      insertSetting('keep', 'me');
      insertSetting('change', 'old');

      await app.request('/', {
        method: 'PATCH',
        body: JSON.stringify({ change: 'new' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const kept = testDb.query('SELECT value FROM settings WHERE key = ?').get('keep') as any;
      expect(JSON.parse(kept.value)).toBe('me');
      const changed = testDb.query('SELECT value FROM settings WHERE key = ?').get('change') as any;
      expect(JSON.parse(changed.value)).toBe('new');
    });

    test('handles multiple settings in one request', async () => {
      await app.request('/', {
        method: 'PATCH',
        body: JSON.stringify({ a: 1, b: 2, c: 3 }),
        headers: { 'Content-Type': 'application/json' },
      });

      const rows = testDb.query('SELECT * FROM settings').all() as any[];
      expect(rows).toHaveLength(3);
    });

    test('updated settings are visible via GET', async () => {
      await app.request('/', {
        method: 'PATCH',
        body: JSON.stringify({ theme: 'solarized' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await app.request('/theme');
      const json = await res.json();
      expect(json.data).toBe('solarized');
    });
  });

  // ---------------------------------------------------------------
  // GET / — Sensitive keys are masked
  // ---------------------------------------------------------------
  describe('GET / — sensitive key masking', () => {
    test('masks anthropicApiKey as anthropicApiKeyConfigured', async () => {
      insertSetting('anthropicApiKey', 'sk-ant-secret123');

      const res = await app.request('/');
      const json = await res.json();
      expect(json.data.anthropicApiKey).toBeUndefined();
      expect(json.data.anthropicApiKeyConfigured).toBe(true);
    });

    test('masks openaiApiKey as openaiApiKeyConfigured', async () => {
      insertSetting('openaiApiKey', 'sk-openai-secret');

      const res = await app.request('/');
      const json = await res.json();
      expect(json.data.openaiApiKey).toBeUndefined();
      expect(json.data.openaiApiKeyConfigured).toBe(true);
    });

    test('masks googleApiKey as googleApiKeyConfigured', async () => {
      insertSetting('googleApiKey', 'AIza-google-key');

      const res = await app.request('/');
      const json = await res.json();
      expect(json.data.googleApiKey).toBeUndefined();
      expect(json.data.googleApiKeyConfigured).toBe(true);
    });

    test('masks jiraConfig, linearConfig, asanaConfig', async () => {
      insertSetting('jiraConfig', { token: 'secret' });
      insertSetting('linearConfig', { apiKey: 'secret' });
      insertSetting('asanaConfig', { pat: 'secret' });

      const res = await app.request('/');
      const json = await res.json();
      expect(json.data.jiraConfig).toBeUndefined();
      expect(json.data.jiraConfigConfigured).toBe(true);
      expect(json.data.linearConfig).toBeUndefined();
      expect(json.data.linearConfigConfigured).toBe(true);
      expect(json.data.asanaConfig).toBeUndefined();
      expect(json.data.asanaConfigConfigured).toBe(true);
    });

    test('reports configured=false for falsy sensitive values', async () => {
      insertSetting('anthropicApiKey', '');

      const res = await app.request('/');
      const json = await res.json();
      expect(json.data.anthropicApiKeyConfigured).toBe(false);
    });

    test('non-sensitive settings pass through alongside masked ones', async () => {
      insertSetting('theme', 'dark');
      insertSetting('anthropicApiKey', 'sk-secret');

      const res = await app.request('/');
      const json = await res.json();
      expect(json.data.theme).toBe('dark');
      expect(json.data.anthropicApiKeyConfigured).toBe(true);
      expect(json.data.anthropicApiKey).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------
  // PUT /api-key — Set API key (BYOK)
  // ---------------------------------------------------------------
  describe('PUT /api-key — set API key', () => {
    test('returns 400 when provider is missing', async () => {
      const res = await app.request('/api-key', {
        method: 'PUT',
        body: JSON.stringify({ apiKey: 'sk-test' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('provider and apiKey required');
    });

    test('returns 400 when apiKey is missing', async () => {
      const res = await app.request('/api-key', {
        method: 'PUT',
        body: JSON.stringify({ provider: 'anthropic' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
    });

    test('returns 400 for unknown provider', async () => {
      const res = await app.request('/api-key', {
        method: 'PUT',
        body: JSON.stringify({ provider: 'unknown', apiKey: 'key123' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('Unknown provider');
    });

    test('stores anthropic api key in settings', async () => {
      const res = await app.request('/api-key', {
        method: 'PUT',
        body: JSON.stringify({ provider: 'anthropic', apiKey: 'sk-ant-test123' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);

      const row = testDb
        .query('SELECT value FROM settings WHERE key = ?')
        .get('anthropicApiKey') as any;
      expect(JSON.parse(row.value)).toBe('sk-ant-test123');
    });

    test('stores openai api key in settings', async () => {
      await app.request('/api-key', {
        method: 'PUT',
        body: JSON.stringify({ provider: 'openai', apiKey: 'sk-openai-key' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const row = testDb
        .query('SELECT value FROM settings WHERE key = ?')
        .get('openaiApiKey') as any;
      expect(JSON.parse(row.value)).toBe('sk-openai-key');
    });

    test('stores google api key in settings', async () => {
      await app.request('/api-key', {
        method: 'PUT',
        body: JSON.stringify({ provider: 'google', apiKey: 'AIza-google-test' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const row = testDb
        .query('SELECT value FROM settings WHERE key = ?')
        .get('googleApiKey') as any;
      expect(JSON.parse(row.value)).toBe('AIza-google-test');
    });

    test('sets environment variable for anthropic', async () => {
      process.env.ANTHROPIC_API_KEY = undefined as unknown as string;
      await app.request('/api-key', {
        method: 'PUT',
        body: JSON.stringify({ provider: 'anthropic', apiKey: 'sk-ant-env-test' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(process.env.ANTHROPIC_API_KEY).toBe('sk-ant-env-test');
      delete process.env.ANTHROPIC_API_KEY;
    });

    test('overwrites existing api key', async () => {
      insertSetting('anthropicApiKey', 'old-key');

      await app.request('/api-key', {
        method: 'PUT',
        body: JSON.stringify({ provider: 'anthropic', apiKey: 'new-key' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const row = testDb
        .query('SELECT value FROM settings WHERE key = ?')
        .get('anthropicApiKey') as any;
      expect(JSON.parse(row.value)).toBe('new-key');
    });
  });

  // ---------------------------------------------------------------
  // GET /api-keys/status — Check API key status
  // ---------------------------------------------------------------
  describe('GET /api-keys/status — check API key status', () => {
    test('returns all providers as false when no keys configured', async () => {
      // Ensure env vars are not set
      const savedAnth = process.env.ANTHROPIC_API_KEY;
      const savedOpenai = process.env.OPENAI_API_KEY;
      const savedGoogle = process.env.GOOGLE_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.GOOGLE_API_KEY;

      const res = await app.request('/api-keys/status');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.anthropic).toBe(false);
      expect(json.data.openai).toBe(false);
      expect(json.data.google).toBe(false);

      // Restore
      if (savedAnth) process.env.ANTHROPIC_API_KEY = savedAnth;
      if (savedOpenai) process.env.OPENAI_API_KEY = savedOpenai;
      if (savedGoogle) process.env.GOOGLE_API_KEY = savedGoogle;
    });

    test('returns true for provider with key in DB', async () => {
      const savedAnth = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;

      insertSetting('anthropicApiKey', 'sk-test-key');

      const res = await app.request('/api-keys/status');
      const json = await res.json();
      expect(json.data.anthropic).toBe(true);

      if (savedAnth) process.env.ANTHROPIC_API_KEY = savedAnth;
    });

    test('returns true for provider with env var set', async () => {
      const saved = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = 'sk-env-key';

      const res = await app.request('/api-keys/status');
      const json = await res.json();
      expect(json.data.openai).toBe(true);

      if (saved) process.env.OPENAI_API_KEY = saved;
      else delete process.env.OPENAI_API_KEY;
    });
  });

  // ---------------------------------------------------------------
  // PUT /budget — Set session budget
  // ---------------------------------------------------------------
  describe('PUT /budget — set session budget', () => {
    test('sets a budget', async () => {
      const res = await app.request('/budget', {
        method: 'PUT',
        body: JSON.stringify({ budgetUsd: 10.0 }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);

      const row = testDb
        .query("SELECT value FROM settings WHERE key = 'sessionBudgetUsd'")
        .get() as any;
      expect(JSON.parse(row.value)).toBe(10.0);
    });

    test('clears budget when budgetUsd is null', async () => {
      insertSetting('sessionBudgetUsd', 5.0);

      const res = await app.request('/budget', {
        method: 'PUT',
        body: JSON.stringify({ budgetUsd: null }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(200);

      const row = testDb.query("SELECT value FROM settings WHERE key = 'sessionBudgetUsd'").get();
      expect(row).toBeNull();
    });

    test('overwrites existing budget', async () => {
      insertSetting('sessionBudgetUsd', 5.0);

      await app.request('/budget', {
        method: 'PUT',
        body: JSON.stringify({ budgetUsd: 20.0 }),
        headers: { 'Content-Type': 'application/json' },
      });

      const row = testDb
        .query("SELECT value FROM settings WHERE key = 'sessionBudgetUsd'")
        .get() as any;
      expect(JSON.parse(row.value)).toBe(20.0);
    });

    test('budget is retrievable via GET /:key after setting', async () => {
      await app.request('/budget', {
        method: 'PUT',
        body: JSON.stringify({ budgetUsd: 15.0 }),
        headers: { 'Content-Type': 'application/json' },
      });

      // sessionBudgetUsd key is stored, so we can read it through GET /:key
      const res = await app.request('/sessionBudgetUsd');
      const json = await res.json();
      expect(json.data).toBe(15.0);
    });
  });

  // ---------------------------------------------------------------
  // GET /budget — Get session budget
  // ---------------------------------------------------------------
  describe('GET /budget — get session budget', () => {
    test('returns null when no budget is set', async () => {
      const res = await app.request('/budget');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.budgetUsd).toBeNull();
    });

    test('returns the configured budget', async () => {
      insertSetting('sessionBudgetUsd', 25.0);

      const res = await app.request('/budget');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.budgetUsd).toBe(25.0);
    });

    test('returns a zero budget correctly', async () => {
      insertSetting('sessionBudgetUsd', 0);

      const res = await app.request('/budget');
      const json = await res.json();
      expect(json.data.budgetUsd).toBe(0);
    });

    test('returns a fractional budget', async () => {
      insertSetting('sessionBudgetUsd', 0.5);

      const res = await app.request('/budget');
      const json = await res.json();
      expect(json.data.budgetUsd).toBe(0.5);
    });
  });

  // ---------------------------------------------------------------
  // PATCH / — resetOllamaCache when oneshot settings change
  // ---------------------------------------------------------------
  describe('PATCH / — oneshot settings trigger cache reset', () => {
    test('resets Ollama cache when oneshotProvider changes', async () => {
      mockResetOllamaCache.mockClear();

      await app.request('/', {
        method: 'PATCH',
        body: JSON.stringify({ oneshotProvider: 'ollama' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(mockResetOllamaCache).toHaveBeenCalledTimes(1);
    });

    test('resets Ollama cache when oneshotModel changes', async () => {
      mockResetOllamaCache.mockClear();

      await app.request('/', {
        method: 'PATCH',
        body: JSON.stringify({ oneshotModel: 'llama3' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(mockResetOllamaCache).toHaveBeenCalledTimes(1);
    });

    test('resets Ollama cache when oneshotProvider is inside settings wrapper', async () => {
      mockResetOllamaCache.mockClear();

      await app.request('/', {
        method: 'PATCH',
        body: JSON.stringify({ settings: { oneshotProvider: 'openai' } }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(mockResetOllamaCache).toHaveBeenCalledTimes(1);
    });

    test('does NOT reset Ollama cache when unrelated settings change', async () => {
      mockResetOllamaCache.mockClear();

      await app.request('/', {
        method: 'PATCH',
        body: JSON.stringify({ theme: 'dark' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(mockResetOllamaCache).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------
  // PUT /api-key — environment variable side effects
  // ---------------------------------------------------------------
  describe('PUT /api-key — environment variable for openai and google', () => {
    test('sets environment variable for openai', async () => {
      const saved = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;

      await app.request('/api-key', {
        method: 'PUT',
        body: JSON.stringify({ provider: 'openai', apiKey: 'sk-openai-env' }),
        headers: { 'Content-Type': 'application/json' },
      });

      // @ts-expect-error -- env var was just set above
      expect(process.env.OPENAI_API_KEY).toBe('sk-openai-env');

      if (saved) process.env.OPENAI_API_KEY = saved;
      else delete process.env.OPENAI_API_KEY;
    });

    test('sets environment variable for google', async () => {
      const saved = process.env.GOOGLE_API_KEY;
      delete process.env.GOOGLE_API_KEY;

      await app.request('/api-key', {
        method: 'PUT',
        body: JSON.stringify({ provider: 'google', apiKey: 'AIza-google-env' }),
        headers: { 'Content-Type': 'application/json' },
      });

      // @ts-expect-error -- env var was just set above
      expect(process.env.GOOGLE_API_KEY).toBe('AIza-google-env');

      if (saved) process.env.GOOGLE_API_KEY = saved;
      else delete process.env.GOOGLE_API_KEY;
    });
  });

  // ---------------------------------------------------------------
  // GET /api-keys/status — mixed DB and env var state
  // ---------------------------------------------------------------
  describe('GET /api-keys/status — edge cases', () => {
    test('returns false for provider with empty string in DB and no env var', async () => {
      const saved = process.env.GOOGLE_API_KEY;
      delete process.env.GOOGLE_API_KEY;

      insertSetting('googleApiKey', '');

      const res = await app.request('/api-keys/status');
      const json = await res.json();
      expect(json.data.google).toBe(false);

      if (saved) process.env.GOOGLE_API_KEY = saved;
    });

    test('returns true when DB is empty but env var is set', async () => {
      const saved = process.env.GOOGLE_API_KEY;
      process.env.GOOGLE_API_KEY = 'AIza-env-only';

      const res = await app.request('/api-keys/status');
      const json = await res.json();
      expect(json.data.google).toBe(true);

      if (saved) process.env.GOOGLE_API_KEY = saved;
      else delete process.env.GOOGLE_API_KEY;
    });
  });

  // ---------------------------------------------------------------
  // Ollama endpoints
  // ---------------------------------------------------------------
  describe('GET /ollama/status — Ollama health check', () => {
    test('returns available=true when Ollama is healthy', async () => {
      mockCheckOllamaHealth.mockResolvedValue(true);

      const res = await app.request('/ollama/status');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.available).toBe(true);
    });

    test('returns available=false when Ollama is not healthy', async () => {
      mockCheckOllamaHealth.mockResolvedValue(false);

      const res = await app.request('/ollama/status');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.available).toBe(false);
    });
  });

  describe('GET /ollama/models — Ollama model list', () => {
    test('returns model list from Ollama', async () => {
      mockListOllamaModels.mockResolvedValue([{ name: 'llama3' }, { name: 'codellama' }]);

      const res = await app.request('/ollama/models');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data).toHaveLength(2);
      expect(json.data[0].name).toBe('llama3');
    });

    test('returns empty array when no models installed', async () => {
      mockListOllamaModels.mockResolvedValue([]);

      const res = await app.request('/ollama/models');
      const json = await res.json();
      expect(json.data).toEqual([]);
    });
  });

  // ---------------------------------------------------------------
  // OpenAI models endpoint
  // ---------------------------------------------------------------
  describe('GET /openai/models — OpenAI model list', () => {
    test('returns model list from OpenAI', async () => {
      mockListOpenAIModels.mockResolvedValue([{ id: 'gpt-4' }, { id: 'gpt-3.5-turbo' }]);

      const res = await app.request('/openai/models');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------
  // Gemini models endpoint
  // ---------------------------------------------------------------
  describe('GET /gemini/models — Gemini model list', () => {
    test('returns model list from Gemini', async () => {
      mockListGeminiModels.mockResolvedValue([{ name: 'gemini-pro' }]);

      const res = await app.request('/gemini/models');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data).toHaveLength(1);
      expect(json.data[0].name).toBe('gemini-pro');
    });
  });

  // ---------------------------------------------------------------
  // Permission Rules CRUD
  // ---------------------------------------------------------------
  describe('GET /permission-rules/presets — list presets', () => {
    test('returns the permission presets', async () => {
      const res = await app.request('/permission-rules/presets');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
      expect(json.data.length).toBeGreaterThan(0);
      // Every preset should have id, name, rules
      for (const preset of json.data) {
        expect(preset.id).toBeDefined();
        expect(preset.name).toBeDefined();
        expect(Array.isArray(preset.rules)).toBe(true);
      }
    });
  });

  describe('GET /permission-rules — list rules', () => {
    test('returns empty array when no rules exist', async () => {
      const res = await app.request('/permission-rules');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data).toEqual([]);
    });

    test('returns rules after creating them', async () => {
      // Create a global rule
      await app.request('/permission-rules', {
        method: 'POST',
        body: JSON.stringify({ type: 'allow', tool: 'Read', scope: 'global' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await app.request('/permission-rules');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.length).toBeGreaterThanOrEqual(1);
    });

    test('filters by scope query parameter', async () => {
      // Create both global and project-scoped rules
      await app.request('/permission-rules', {
        method: 'POST',
        body: JSON.stringify({ type: 'allow', tool: 'Read', scope: 'global' }),
        headers: { 'Content-Type': 'application/json' },
      });
      await app.request('/permission-rules', {
        method: 'POST',
        body: JSON.stringify({
          type: 'deny',
          tool: 'Bash',
          scope: 'project',
          workspacePath: '/proj',
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await app.request('/permission-rules?scope=global');
      const json = await res.json();
      expect(json.ok).toBe(true);
      for (const rule of json.data) {
        expect(rule.scope).toBe('global');
      }
    });

    test('filters by workspacePath', async () => {
      await app.request('/permission-rules', {
        method: 'POST',
        body: JSON.stringify({
          type: 'allow',
          tool: 'Write',
          scope: 'project',
          workspacePath: '/specific-proj',
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await app.request('/permission-rules?workspacePath=/specific-proj');
      const json = await res.json();
      expect(json.ok).toBe(true);
      // Should include the project-scoped rule for /specific-proj
      expect(json.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('POST /permission-rules — create rule', () => {
    test('creates a rule with all required fields', async () => {
      const res = await app.request('/permission-rules', {
        method: 'POST',
        body: JSON.stringify({
          type: 'allow',
          tool: 'Read',
          scope: 'global',
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.id).toBeDefined();
      expect(json.data.type).toBe('allow');
      expect(json.data.tool).toBe('Read');
      expect(json.data.scope).toBe('global');
    });

    test('creates a rule with a pattern', async () => {
      const res = await app.request('/permission-rules', {
        method: 'POST',
        body: JSON.stringify({
          type: 'deny',
          tool: 'Bash',
          pattern: 'rm -rf *',
          scope: 'global',
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.pattern).toBe('rm -rf *');
    });

    test('returns 400 when type is missing', async () => {
      const res = await app.request('/permission-rules', {
        method: 'POST',
        body: JSON.stringify({ tool: 'Read', scope: 'global' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('type');
    });

    test('returns 400 when tool is missing', async () => {
      const res = await app.request('/permission-rules', {
        method: 'POST',
        body: JSON.stringify({ type: 'allow', scope: 'global' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
    });

    test('returns 400 when scope is missing', async () => {
      const res = await app.request('/permission-rules', {
        method: 'POST',
        body: JSON.stringify({ type: 'allow', tool: 'Read' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
    });

    test('creates a project-scoped rule with workspacePath', async () => {
      const res = await app.request('/permission-rules', {
        method: 'POST',
        body: JSON.stringify({
          type: 'ask',
          tool: 'Write',
          scope: 'project',
          workspacePath: '/my-project',
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.scope).toBe('project');
    });

    test('creates a session-scoped rule with conversationId', async () => {
      const res = await app.request('/permission-rules', {
        method: 'POST',
        body: JSON.stringify({
          type: 'allow',
          tool: 'Bash',
          scope: 'session',
          conversationId: 'conv-123',
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.scope).toBe('session');
    });

    test('creates rule without pattern (undefined)', async () => {
      const res = await app.request('/permission-rules', {
        method: 'POST',
        body: JSON.stringify({
          type: 'allow',
          tool: 'Glob',
          scope: 'global',
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.pattern).toBeUndefined();
    });
  });

  describe('PATCH /permission-rules/:id — update rule', () => {
    test('updates an existing rule', async () => {
      // First create a rule
      const createRes = await app.request('/permission-rules', {
        method: 'POST',
        body: JSON.stringify({ type: 'allow', tool: 'Read', scope: 'global' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const created = await createRes.json();
      const ruleId = created.data.id;

      // Update it
      const updateRes = await app.request(`/permission-rules/${ruleId}`, {
        method: 'PATCH',
        body: JSON.stringify({ type: 'deny' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(updateRes.status).toBe(200);
      const updated = await updateRes.json();
      expect(updated.ok).toBe(true);
      expect(updated.data.id).toBe(ruleId);
      expect(updated.data.type).toBe('deny');
      // Original tool should be preserved via spread
      expect(updated.data.tool).toBe('Read');
    });

    test('returns 404 for non-existent rule', async () => {
      const res = await app.request('/permission-rules/nonexistent-id', {
        method: 'PATCH',
        body: JSON.stringify({ type: 'deny' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('Rule not found');
    });

    test('preserves rule id even if body tries to change it', async () => {
      const createRes = await app.request('/permission-rules', {
        method: 'POST',
        body: JSON.stringify({ type: 'allow', tool: 'Read', scope: 'global' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const created = await createRes.json();
      const ruleId = created.data.id;

      const updateRes = await app.request(`/permission-rules/${ruleId}`, {
        method: 'PATCH',
        body: JSON.stringify({ id: 'hacked-id', type: 'ask' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const updated = await updateRes.json();
      expect(updated.data.id).toBe(ruleId); // id must NOT change
      expect(updated.data.type).toBe('ask');
    });
  });

  describe('DELETE /permission-rules/:id — delete rule', () => {
    test('deletes an existing rule', async () => {
      // Create a rule first
      const createRes = await app.request('/permission-rules', {
        method: 'POST',
        body: JSON.stringify({ type: 'allow', tool: 'Read', scope: 'global' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const created = await createRes.json();
      const ruleId = created.data.id;

      // Delete it
      const delRes = await app.request(`/permission-rules/${ruleId}`, {
        method: 'DELETE',
      });
      expect(delRes.status).toBe(200);
      const delJson = await delRes.json();
      expect(delJson.ok).toBe(true);

      // Verify it is gone (loadPermissionRules for global)
      const listRes = await app.request('/permission-rules');
      const listJson = await listRes.json();
      const found = listJson.data.find((r: any) => r.id === ruleId);
      expect(found).toBeUndefined();
    });

    test('returns ok even for non-existent rule (idempotent)', async () => {
      const res = await app.request('/permission-rules/does-not-exist', {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
    });
  });

  describe('POST /permission-rules/apply-preset — apply preset', () => {
    test('applies the safe-coding preset as global scope', async () => {
      const res = await app.request('/permission-rules/apply-preset', {
        method: 'POST',
        body: JSON.stringify({ presetId: 'safe-coding', scope: 'global' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
      expect(json.data.length).toBeGreaterThan(0);
      // All rules should have the requested scope
      for (const rule of json.data) {
        expect(rule.scope).toBe('global');
        expect(rule.id).toBeDefined();
      }
    });

    test('applies the full-auto preset', async () => {
      const res = await app.request('/permission-rules/apply-preset', {
        method: 'POST',
        body: JSON.stringify({ presetId: 'full-auto', scope: 'global' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.length).toBe(1);
      expect(json.data[0].type).toBe('allow');
      expect(json.data[0].tool).toBe('*');
    });

    test('returns 404 for unknown preset', async () => {
      const res = await app.request('/permission-rules/apply-preset', {
        method: 'POST',
        body: JSON.stringify({ presetId: 'nonexistent-preset', scope: 'global' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('Preset not found');
    });

    test('replaces existing global rules when applying a global preset', async () => {
      // First apply one preset
      await app.request('/permission-rules/apply-preset', {
        method: 'POST',
        body: JSON.stringify({ presetId: 'full-auto', scope: 'global' }),
        headers: { 'Content-Type': 'application/json' },
      });

      // Now apply a different preset to the same scope
      const res = await app.request('/permission-rules/apply-preset', {
        method: 'POST',
        body: JSON.stringify({ presetId: 'safe-coding', scope: 'global' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await res.json();
      expect(json.ok).toBe(true);

      // Verify the old full-auto rules are gone, only safe-coding rules remain
      const listRes = await app.request('/permission-rules?scope=global');
      const listJson = await listRes.json();
      // None of the rules should be the full-auto wildcard (tool: '*')
      const wildcardRules = listJson.data.filter((r: any) => r.tool === '*');
      // safe-coding does not have a wildcard allow rule
      expect(wildcardRules).toHaveLength(0);
    });

    test('applies preset as project scope and replaces project rules', async () => {
      // Create a project-scoped rule manually
      await app.request('/permission-rules', {
        method: 'POST',
        body: JSON.stringify({
          type: 'deny',
          tool: 'Bash',
          scope: 'project',
          workspacePath: '/my-proj',
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      // Apply preset to project scope
      const res = await app.request('/permission-rules/apply-preset', {
        method: 'POST',
        body: JSON.stringify({
          presetId: 'full-auto',
          scope: 'project',
          workspacePath: '/my-proj',
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data).toHaveLength(1);
      expect(json.data[0].scope).toBe('project');
    });

    test('applies preset as session scope', async () => {
      const res = await app.request('/permission-rules/apply-preset', {
        method: 'POST',
        body: JSON.stringify({
          presetId: 'read-only',
          scope: 'session',
          conversationId: 'conv-abc',
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.length).toBeGreaterThan(0);
      for (const rule of json.data) {
        expect(rule.scope).toBe('session');
      }
    });
  });
});
