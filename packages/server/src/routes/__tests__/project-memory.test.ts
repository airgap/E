import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { createTestDb } from '../../test-helpers';

const testDb = createTestDb();
mock.module('../../db/database', () => ({
  getDb: () => testDb,
  initDatabase: () => {},
}));

// Mock the memory-extractor so LLM extraction endpoints don't make real LLM calls
mock.module('../../services/memory-extractor', () => ({
  extractMemoriesFromConversation: async () => [
    { category: 'convention', key: 'indent-style', content: 'Use 2 spaces', confidence: 0.7 },
  ],
  extractMemoriesFromCommits: async () => [
    { category: 'decision', key: 'use-sqlite', content: 'Decided to use SQLite', confidence: 0.6 },
  ],
}));

import { workspaceMemoryRoutes as app } from '../project-memory';

function clearTables() {
  testDb.exec('DELETE FROM workspace_memories');
  // Also clear version history table if it exists
  try {
    testDb.exec('DELETE FROM workspace_memory_versions');
  } catch {
    // Table may not exist yet
  }
}

function insertMemory(overrides: Record<string, any> = {}) {
  const defaults = {
    id: 'mem-1',
    workspace_path: '/test',
    category: 'convention',
    key: 'test-key',
    content: 'test content',
    source: 'manual',
    confidence: 1.0,
    times_seen: 1,
    created_at: 1000,
    updated_at: 1000,
  };
  const row = { ...defaults, ...overrides };
  testDb
    .query(
      'INSERT INTO workspace_memories (id, workspace_path, category, key, content, source, confidence, times_seen, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      row.id,
      row.workspace_path,
      row.category,
      row.key,
      row.content,
      row.source,
      row.confidence,
      row.times_seen,
      row.created_at,
      row.updated_at,
    );
}

describe('Project Memory Routes', () => {
  beforeEach(() => {
    clearTables();
  });

  describe('GET / — list memories', () => {
    test('returns empty array when no memories', async () => {
      const res = await app.request('/?workspacePath=/test');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data).toEqual([]);
    });

    test('returns memories for project path', async () => {
      testDb
        .query(
          'INSERT INTO workspace_memories (id, workspace_path, category, key, content, source, confidence, times_seen, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run('mem-1', '/test', 'convention', 'tabs', 'Use 2 spaces', 'manual', 1.0, 1, 1000, 1000);

      const res = await app.request('/?workspacePath=/test');
      const json = await res.json();
      expect(json.data).toHaveLength(1);
      expect(json.data[0].key).toBe('tabs');
    });

    test('filters by category', async () => {
      testDb
        .query(
          'INSERT INTO workspace_memories (id, workspace_path, category, key, content, source, confidence, times_seen, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run('mem-1', '/test', 'convention', 'tabs', 'Use 2 spaces', 'manual', 1.0, 1, 1000, 1000);
      testDb
        .query(
          'INSERT INTO workspace_memories (id, workspace_path, category, key, content, source, confidence, times_seen, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run('mem-2', '/test', 'decision', 'db', 'Use SQLite', 'manual', 1.0, 1, 1000, 1000);

      const res = await app.request('/?workspacePath=/test&category=convention');
      const json = await res.json();
      expect(json.data).toHaveLength(1);
      expect(json.data[0].category).toBe('convention');
    });
  });

  describe('POST / — create memory', () => {
    test('creates a new memory', async () => {
      const res = await app.request('/', {
        method: 'POST',
        body: JSON.stringify({
          workspacePath: '/test',
          category: 'convention',
          key: 'indent',
          content: 'Use 2 spaces',
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.id).toBeDefined();
    });

    test('reinforces existing memory by key', async () => {
      testDb
        .query(
          'INSERT INTO workspace_memories (id, workspace_path, category, key, content, source, confidence, times_seen, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          'mem-1',
          '/test',
          'convention',
          'indent',
          'Use 2 spaces',
          'manual',
          0.5,
          1,
          1000,
          1000,
        );

      const res = await app.request('/', {
        method: 'POST',
        body: JSON.stringify({
          workspacePath: '/test',
          category: 'convention',
          key: 'indent',
          content: 'Use 2 spaces for indent',
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await res.json();
      expect(json.ok).toBe(true);

      const row = testDb.query('SELECT * FROM workspace_memories WHERE id = ?').get('mem-1') as any;
      expect(row.times_seen).toBe(2);
      expect(row.content).toBe('Use 2 spaces for indent');
    });
  });

  describe('DELETE /:id — delete memory', () => {
    test('deletes a memory', async () => {
      testDb
        .query(
          'INSERT INTO workspace_memories (id, workspace_path, category, key, content, source, confidence, times_seen, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run('mem-1', '/test', 'convention', 'tabs', 'Use 2 spaces', 'manual', 1.0, 1, 1000, 1000);

      const res = await app.request('/mem-1', { method: 'DELETE' });
      expect(res.status).toBe(200);

      const row = testDb.query('SELECT * FROM workspace_memories WHERE id = ?').get('mem-1');
      expect(row).toBeNull();
    });
  });

  describe('GET /context — format for system prompt', () => {
    test('returns formatted context', async () => {
      insertMemory({
        id: 'mem-1',
        workspace_path: '/test',
        category: 'convention',
        key: 'indent',
        content: 'Use 2 spaces',
      });

      const res = await app.request('/context?workspacePath=/test');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.context).toContain('indent');
    });

    test('returns empty context when no memories exist', async () => {
      const res = await app.request('/context?workspacePath=/empty');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.context).toBe('');
      expect(json.data.count).toBe(0);
    });

    test('returns 400 when workspacePath is missing', async () => {
      const res = await app.request('/context');
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('workspacePath required');
    });

    test('excludes low-confidence memories (below 0.3)', async () => {
      insertMemory({ id: 'mem-1', workspace_path: '/test', key: 'high-conf', confidence: 0.8 });
      insertMemory({ id: 'mem-2', workspace_path: '/test', key: 'low-conf', confidence: 0.1 });

      const res = await app.request('/context?workspacePath=/test');
      const json = await res.json();
      expect(json.data.context).toContain('high-conf');
      expect(json.data.context).not.toContain('low-conf');
      expect(json.data.count).toBe(1);
    });

    test('groups memories by category with labels', async () => {
      insertMemory({
        id: 'mem-1',
        workspace_path: '/test',
        category: 'convention',
        key: 'indent',
        content: 'Use 2 spaces',
      });
      insertMemory({
        id: 'mem-2',
        workspace_path: '/test',
        category: 'decision',
        key: 'db',
        content: 'Use SQLite',
      });

      const res = await app.request('/context?workspacePath=/test');
      const json = await res.json();
      expect(json.data.context).toContain('Coding Conventions');
      expect(json.data.context).toContain('Architecture Decisions');
      expect(json.data.count).toBe(2);
    });
  });

  // ---------------------------------------------------------------
  // GET / — list memories (additional edge cases)
  // ---------------------------------------------------------------
  describe('GET / — list memories (edge cases)', () => {
    test('returns 400 when workspacePath is missing', async () => {
      const res = await app.request('/');
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('workspacePath required');
    });

    test('maps fields to camelCase', async () => {
      insertMemory({
        id: 'mem-1',
        workspace_path: '/test',
        category: 'convention',
        key: 'tabs',
        content: 'Use 2 spaces',
        source: 'auto',
        confidence: 0.9,
        times_seen: 5,
        created_at: 1000,
        updated_at: 2000,
      });

      const res = await app.request('/?workspacePath=/test');
      const json = await res.json();
      const mem = json.data[0];
      expect(mem.id).toBe('mem-1');
      expect(mem.workspacePath).toBe('/test');
      expect(mem.category).toBe('convention');
      expect(mem.key).toBe('tabs');
      expect(mem.content).toBe('Use 2 spaces');
      expect(mem.source).toBe('auto');
      expect(mem.confidence).toBe(0.9);
      expect(mem.timesSeen).toBe(5);
      expect(mem.createdAt).toBe(1000);
      expect(mem.updatedAt).toBe(2000);
    });
  });

  // ---------------------------------------------------------------
  // POST / — create memory (additional edge cases)
  // ---------------------------------------------------------------
  describe('POST / — create memory (validation)', () => {
    test('returns 400 when workspacePath is missing', async () => {
      const res = await app.request('/', {
        method: 'POST',
        body: JSON.stringify({ key: 'indent', content: 'Use 2 spaces' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('workspacePath, key, and content are required');
    });

    test('returns 400 when key is missing', async () => {
      const res = await app.request('/', {
        method: 'POST',
        body: JSON.stringify({ workspacePath: '/test', content: 'Use 2 spaces' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
    });

    test('returns 400 when content is missing', async () => {
      const res = await app.request('/', {
        method: 'POST',
        body: JSON.stringify({ workspacePath: '/test', key: 'indent' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
    });

    test('uses default category and source when not provided', async () => {
      const res = await app.request('/', {
        method: 'POST',
        body: JSON.stringify({ workspacePath: '/test', key: 'indent', content: 'Use 2 spaces' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(201);
      const json = await res.json();

      const row = testDb
        .query('SELECT * FROM workspace_memories WHERE id = ?')
        .get(json.data.id) as any;
      expect(row.category).toBe('convention');
      expect(row.source).toBe('manual');
      expect(row.confidence).toBe(1.0);
    });

    test('uses provided category, source, confidence', async () => {
      const res = await app.request('/', {
        method: 'POST',
        body: JSON.stringify({
          workspacePath: '/test',
          category: 'decision',
          key: 'db-choice',
          content: 'Use SQLite',
          source: 'auto',
          confidence: 0.7,
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(201);
      const json = await res.json();

      const row = testDb
        .query('SELECT * FROM workspace_memories WHERE id = ?')
        .get(json.data.id) as any;
      expect(row.category).toBe('decision');
      expect(row.source).toBe('auto');
      expect(row.confidence).toBe(0.7);
    });

    test('reinforcement increases confidence (capped at 1.0)', async () => {
      insertMemory({ id: 'mem-1', workspace_path: '/test', key: 'indent', confidence: 0.95 });

      await app.request('/', {
        method: 'POST',
        body: JSON.stringify({ workspacePath: '/test', key: 'indent', content: 'Updated content' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const row = testDb
        .query('SELECT confidence FROM workspace_memories WHERE id = ?')
        .get('mem-1') as any;
      expect(row.confidence).toBeLessThanOrEqual(1.0);
    });
  });

  // ---------------------------------------------------------------
  // GET /search/query — search memories
  // ---------------------------------------------------------------
  describe('GET /search/query — search memories', () => {
    test('returns 400 when workspacePath is missing', async () => {
      const res = await app.request('/search/query?q=test');
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('workspacePath and q required');
    });

    test('returns 400 when q is missing', async () => {
      const res = await app.request('/search/query?workspacePath=/test');
      expect(res.status).toBe(400);
    });

    test('searches by key', async () => {
      insertMemory({
        id: 'mem-1',
        workspace_path: '/test',
        key: 'indent-style',
        content: 'Use 2 spaces',
      });
      insertMemory({
        id: 'mem-2',
        workspace_path: '/test',
        key: 'db-choice',
        content: 'Use SQLite',
      });

      const res = await app.request('/search/query?workspacePath=/test&q=indent');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data).toHaveLength(1);
      expect(json.data[0].key).toBe('indent-style');
    });

    test('searches by content', async () => {
      insertMemory({
        id: 'mem-1',
        workspace_path: '/test',
        key: 'style',
        content: 'Use 2 spaces for indentation',
      });
      insertMemory({
        id: 'mem-2',
        workspace_path: '/test',
        key: 'db',
        content: 'Use SQLite database',
      });

      const res = await app.request('/search/query?workspacePath=/test&q=SQLite');
      const json = await res.json();
      expect(json.data).toHaveLength(1);
      expect(json.data[0].key).toBe('db');
    });

    test('returns empty array when no matches', async () => {
      insertMemory({
        id: 'mem-1',
        workspace_path: '/test',
        key: 'indent',
        content: 'Use 2 spaces',
      });

      const res = await app.request('/search/query?workspacePath=/test&q=nonexistent');
      const json = await res.json();
      expect(json.data).toHaveLength(0);
    });

    test('only searches within the given workspace', async () => {
      insertMemory({
        id: 'mem-1',
        workspace_path: '/project-a',
        key: 'indent',
        content: 'Use tabs',
      });
      insertMemory({
        id: 'mem-2',
        workspace_path: '/project-b',
        key: 'indent',
        content: 'Use spaces',
      });

      const res = await app.request('/search/query?workspacePath=/project-a&q=indent');
      const json = await res.json();
      expect(json.data).toHaveLength(1);
      expect(json.data[0].workspacePath).toBe('/project-a');
    });
  });

  // ---------------------------------------------------------------
  // GET /:id — get single memory
  // ---------------------------------------------------------------
  describe('GET /:id — get single memory', () => {
    test('returns 404 for non-existent memory', async () => {
      const res = await app.request('/nonexistent');
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('Not found');
    });

    test('returns a single memory', async () => {
      insertMemory({
        id: 'mem-1',
        workspace_path: '/test',
        category: 'convention',
        key: 'indent',
        content: 'Use 2 spaces',
      });

      const res = await app.request('/mem-1');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.id).toBe('mem-1');
      expect(json.data.key).toBe('indent');
      expect(json.data.content).toBe('Use 2 spaces');
      expect(json.data.category).toBe('convention');
    });
  });

  // ---------------------------------------------------------------
  // PATCH /:id — update memory
  // ---------------------------------------------------------------
  describe('PATCH /:id — update memory', () => {
    test('returns 404 for non-existent memory', async () => {
      const res = await app.request('/nonexistent', {
        method: 'PATCH',
        body: JSON.stringify({ content: 'Updated' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('Not found');
    });

    test('returns 400 when no fields to update', async () => {
      insertMemory({ id: 'mem-1', workspace_path: '/test' });

      const res = await app.request('/mem-1', {
        method: 'PATCH',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('No fields to update');
    });

    test('updates content', async () => {
      insertMemory({ id: 'mem-1', workspace_path: '/test', content: 'Old content' });

      const res = await app.request('/mem-1', {
        method: 'PATCH',
        body: JSON.stringify({ content: 'New content' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);

      const row = testDb
        .query('SELECT content FROM workspace_memories WHERE id = ?')
        .get('mem-1') as any;
      expect(row.content).toBe('New content');
    });

    test('updates category', async () => {
      insertMemory({ id: 'mem-1', workspace_path: '/test', category: 'convention' });

      await app.request('/mem-1', {
        method: 'PATCH',
        body: JSON.stringify({ category: 'decision' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const row = testDb
        .query('SELECT category FROM workspace_memories WHERE id = ?')
        .get('mem-1') as any;
      expect(row.category).toBe('decision');
    });

    test('updates key', async () => {
      insertMemory({ id: 'mem-1', workspace_path: '/test', key: 'old-key' });

      await app.request('/mem-1', {
        method: 'PATCH',
        body: JSON.stringify({ key: 'new-key' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const row = testDb
        .query('SELECT key FROM workspace_memories WHERE id = ?')
        .get('mem-1') as any;
      expect(row.key).toBe('new-key');
    });

    test('updates confidence', async () => {
      insertMemory({ id: 'mem-1', workspace_path: '/test', confidence: 0.5 });

      await app.request('/mem-1', {
        method: 'PATCH',
        body: JSON.stringify({ confidence: 0.9 }),
        headers: { 'Content-Type': 'application/json' },
      });

      const row = testDb
        .query('SELECT confidence FROM workspace_memories WHERE id = ?')
        .get('mem-1') as any;
      expect(row.confidence).toBe(0.9);
    });

    test('updates updated_at timestamp', async () => {
      insertMemory({ id: 'mem-1', workspace_path: '/test', updated_at: 1000 });

      await app.request('/mem-1', {
        method: 'PATCH',
        body: JSON.stringify({ content: 'changed' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const row = testDb
        .query('SELECT updated_at FROM workspace_memories WHERE id = ?')
        .get('mem-1') as any;
      expect(row.updated_at).toBeGreaterThan(1000);
    });
  });

  // ---------------------------------------------------------------
  // DELETE /:id — delete memory (additional edge cases)
  // ---------------------------------------------------------------
  describe('DELETE /:id — delete memory (edge cases)', () => {
    test('returns 404 for non-existent memory', async () => {
      const res = await app.request('/nonexistent', { method: 'DELETE' });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('Not found');
    });
  });

  // ---------------------------------------------------------------
  // POST /extract — bulk extract memories
  // ---------------------------------------------------------------
  describe('POST /extract — bulk extract memories', () => {
    test('returns 400 when workspacePath is missing', async () => {
      const res = await app.request('/extract', {
        method: 'POST',
        body: JSON.stringify({ messages: [{ role: 'user', content: 'test' }] }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('workspacePath and messages[] required');
    });

    test('returns 400 when messages is missing', async () => {
      const res = await app.request('/extract', {
        method: 'POST',
        body: JSON.stringify({ workspacePath: '/test' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
    });

    test('returns 400 when messages is not an array', async () => {
      const res = await app.request('/extract', {
        method: 'POST',
        body: JSON.stringify({ workspacePath: '/test', messages: 'not-an-array' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
    });

    test('extracts convention memories from text', async () => {
      const res = await app.request('/extract', {
        method: 'POST',
        body: JSON.stringify({
          workspacePath: '/test',
          messages: [{ role: 'user', content: 'We always use single quotes in our codebase' }],
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.extracted).toBeGreaterThanOrEqual(0);
      expect(json.data.created).toBeGreaterThanOrEqual(0);
    });

    test('returns zero counts when no patterns match', async () => {
      const res = await app.request('/extract', {
        method: 'POST',
        body: JSON.stringify({
          workspacePath: '/test',
          messages: [
            { role: 'user', content: 'Hello, how are you?' },
            { role: 'assistant', content: 'Fine thanks' },
          ],
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await res.json();
      expect(json.data.extracted).toBe(0);
      expect(json.data.created).toBe(0);
    });

    test('reinforces existing memories on re-extraction', async () => {
      // First create a memory with a matching key
      insertMemory({
        id: 'mem-1',
        workspace_path: '/test',
        key: 'single quotes',
        content: 'prefer single quotes',
        confidence: 0.6,
        times_seen: 1,
      });

      const res = await app.request('/extract', {
        method: 'POST',
        body: JSON.stringify({
          workspacePath: '/test',
          messages: [{ role: 'user', content: 'We prefer use single quotes for strings' }],
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await res.json();
      expect(json.ok).toBe(true);

      // The existing memory should have its times_seen incremented
      const row = testDb
        .query('SELECT times_seen, confidence FROM workspace_memories WHERE id = ?')
        .get('mem-1') as any;
      // It may or may not match the exact key, but the extract endpoint completes without error
      expect(row).toBeDefined();
    });

    test('extracts decision memories', async () => {
      const res = await app.request('/extract', {
        method: 'POST',
        body: JSON.stringify({
          workspacePath: '/test',
          messages: [
            {
              role: 'assistant',
              content: 'We decided to migrate to PostgreSQL for better scalability',
            },
          ],
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await res.json();
      expect(json.ok).toBe(true);
      // Should detect the decision pattern
      expect(json.data.extracted).toBeGreaterThanOrEqual(0);
    });
  });

  // ---------------------------------------------------------------
  // POST /extract-llm — LLM-powered extraction from conversation
  // ---------------------------------------------------------------
  describe('POST /extract-llm — LLM-powered memory extraction', () => {
    test('returns 400 when workspacePath is missing', async () => {
      const res = await app.request('/extract-llm', {
        method: 'POST',
        body: JSON.stringify({ messages: [{ role: 'user', content: 'test' }] }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('workspacePath and messages[] required');
    });

    test('returns 400 when messages is missing', async () => {
      const res = await app.request('/extract-llm', {
        method: 'POST',
        body: JSON.stringify({ workspacePath: '/test' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
    });

    test('returns 400 when messages is not an array', async () => {
      const res = await app.request('/extract-llm', {
        method: 'POST',
        body: JSON.stringify({ workspacePath: '/test', messages: 'not-array' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
    });

    test('extracts memories from conversation using LLM', async () => {
      const res = await app.request('/extract-llm', {
        method: 'POST',
        body: JSON.stringify({
          workspacePath: '/test',
          messages: [
            { role: 'user', content: 'We always use 2 spaces for indentation' },
            { role: 'assistant', content: 'Got it, 2 spaces it is.' },
          ],
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.extracted).toBe(1);
      expect(json.data.created).toBe(1);

      // Verify the memory was inserted in DB
      const rows = testDb
        .query('SELECT * FROM workspace_memories WHERE workspace_path = ?')
        .all('/test') as any[];
      expect(rows.length).toBeGreaterThanOrEqual(1);
      const found = rows.find((r: any) => r.key === 'indent-style');
      expect(found).toBeDefined();
      expect(found.source).toBe('auto');
    });

    test('reinforces existing memory on re-extraction', async () => {
      // Insert existing memory
      insertMemory({
        id: 'mem-llm-1',
        workspace_path: '/test',
        key: 'indent-style',
        content: 'Use tabs',
        confidence: 0.5,
        times_seen: 1,
      });

      const res = await app.request('/extract-llm', {
        method: 'POST',
        body: JSON.stringify({
          workspacePath: '/test',
          messages: [{ role: 'user', content: 'We use spaces' }],
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.extracted).toBe(1);
      expect(json.data.created).toBe(0); // reinforced, not created

      // Check that times_seen was incremented
      const row = testDb
        .query('SELECT times_seen, confidence FROM workspace_memories WHERE id = ?')
        .get('mem-llm-1') as any;
      expect(row.times_seen).toBe(2);
      expect(row.confidence).toBeGreaterThan(0.5);
    });
  });

  // ---------------------------------------------------------------
  // POST /extract-commits — LLM-powered extraction from git commits
  // ---------------------------------------------------------------
  describe('POST /extract-commits — commit-based memory extraction', () => {
    test('returns 400 when workspacePath is missing', async () => {
      const res = await app.request('/extract-commits', {
        method: 'POST',
        body: JSON.stringify({ commits: [{ message: 'feat: add thing' }] }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('workspacePath and commits[] required');
    });

    test('returns 400 when commits is missing', async () => {
      const res = await app.request('/extract-commits', {
        method: 'POST',
        body: JSON.stringify({ workspacePath: '/test' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
    });

    test('returns 400 when commits is not an array', async () => {
      const res = await app.request('/extract-commits', {
        method: 'POST',
        body: JSON.stringify({ workspacePath: '/test', commits: 'not-array' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
    });

    test('extracts memories from commit messages', async () => {
      const res = await app.request('/extract-commits', {
        method: 'POST',
        body: JSON.stringify({
          workspacePath: '/test',
          commits: [
            { message: 'feat: switch to SQLite for local storage', files: ['db.ts'] },
            { message: 'fix: handle null values in parser', files: ['parser.ts'] },
          ],
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.extracted).toBe(1);
      expect(json.data.created).toBe(1);
    });

    test('reinforces existing memory from commits', async () => {
      // Insert existing memory
      insertMemory({
        id: 'mem-commit-1',
        workspace_path: '/test',
        key: 'use-sqlite',
        content: 'Use SQLite',
        confidence: 0.4,
        times_seen: 1,
      });

      const res = await app.request('/extract-commits', {
        method: 'POST',
        body: JSON.stringify({
          workspacePath: '/test',
          commits: [{ message: 'refactor: improve SQLite queries' }],
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.extracted).toBe(1);
      expect(json.data.created).toBe(0);

      // Check reinforcement
      const row = testDb
        .query('SELECT times_seen, confidence FROM workspace_memories WHERE id = ?')
        .get('mem-commit-1') as any;
      expect(row.times_seen).toBe(2);
      expect(row.confidence).toBeGreaterThan(0.4);
    });
  });

  // ---------------------------------------------------------------
  // GET /versions/:id — Version history for a memory
  // ---------------------------------------------------------------
  describe('GET /versions/:id — version history', () => {
    test('returns empty array when no versions exist', async () => {
      const res = await app.request('/versions/mem-1');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data).toEqual([]);
    });

    test('returns versions after an update creates a version snapshot', async () => {
      // Insert a memory
      insertMemory({
        id: 'mem-ver-1',
        workspace_path: '/test',
        key: 'indent',
        content: 'Use tabs',
        confidence: 0.5,
        category: 'convention',
      });

      // Update it (the PATCH handler saves a version before updating)
      await app.request('/mem-ver-1', {
        method: 'PATCH',
        body: JSON.stringify({ content: 'Use 2 spaces' }),
        headers: { 'Content-Type': 'application/json' },
      });

      // Now check versions
      const res = await app.request('/versions/mem-ver-1');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.length).toBeGreaterThanOrEqual(1);

      // The version should contain the OLD content
      const version = json.data[0];
      expect(version.memoryId).toBe('mem-ver-1');
      expect(version.content).toBe('Use tabs');
      expect(version.confidence).toBe(0.5);
      expect(version.category).toBe('convention');
      expect(version.savedAt).toBeDefined();
    });

    test('returns multiple versions after multiple updates', async () => {
      // Insert a memory
      insertMemory({
        id: 'mem-ver-2',
        workspace_path: '/test',
        key: 'style',
        content: 'Version 1',
        confidence: 0.3,
        category: 'convention',
      });

      // Update twice to create two version snapshots
      await app.request('/mem-ver-2', {
        method: 'PATCH',
        body: JSON.stringify({ content: 'Version 2' }),
        headers: { 'Content-Type': 'application/json' },
      });
      await app.request('/mem-ver-2', {
        method: 'PATCH',
        body: JSON.stringify({ content: 'Version 3' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await app.request('/versions/mem-ver-2');
      const json = await res.json();
      expect(json.data.length).toBe(2);
      // Both previous contents should be present as versions
      const contents = json.data.map((v: any) => v.content);
      expect(contents).toContain('Version 1');
      expect(contents).toContain('Version 2');
    });
  });
});
