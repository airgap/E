import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { createTestDb } from '../../test-helpers';

const testDb = createTestDb();
mock.module('../../db/database', () => ({
  getDb: () => testDb,
  initDatabase: () => {},
}));

// Mock the LLM one-shot utility — we don't want real CLI/API calls in tests
let mockCallLlmResponse: string | Error = '';
let mockCallLlmCapture: any = null;
mock.module('../../services/llm-oneshot', () => ({
  callLlm: async (opts: any) => {
    mockCallLlmCapture = opts;
    if (mockCallLlmResponse instanceof Error) throw mockCallLlmResponse;
    return mockCallLlmResponse;
  },
}));

import { prdRoutes as app } from '../prd/index';

function clearTables() {
  testDb.exec('DELETE FROM prd_stories');
  testDb.exec('DELETE FROM prds');
  testDb.exec('DELETE FROM workspace_memories');
  testDb.exec('DELETE FROM conversations');
  testDb.exec('DELETE FROM story_templates');
}

function insertPrd(overrides: Record<string, any> = {}) {
  const defaults = {
    id: 'prd-1',
    workspace_path: '/test/project',
    name: 'Test PRD',
    description: 'A test product requirements document',
    branch_name: null,
    quality_checks: '[]',
    created_at: 1000000,
    updated_at: 1000000,
  };
  const row = { ...defaults, ...overrides };
  testDb
    .query(
      `INSERT INTO prds (id, workspace_path, name, description, branch_name, quality_checks, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.workspace_path,
      row.name,
      row.description,
      row.branch_name,
      row.quality_checks,
      row.created_at,
      row.updated_at,
    );
}

function insertStory(overrides: Record<string, any> = {}) {
  const defaults = {
    id: 'story-1',
    prd_id: 'prd-1',
    title: 'Test Story',
    description: 'A test story description',
    acceptance_criteria: JSON.stringify([
      { id: 'ac-1', description: 'First criterion', passed: false },
      { id: 'ac-2', description: 'Second criterion', passed: false },
      { id: 'ac-3', description: 'Third criterion', passed: false },
    ]),
    priority: 'medium',
    depends_on: '[]',
    dependency_reasons: '{}',
    status: 'pending',
    task_id: null,
    agent_id: null,
    conversation_id: null,
    commit_sha: null,
    attempts: 0,
    max_attempts: 3,
    learnings: '[]',
    sort_order: 0,
    workspace_path: null,
    external_ref: null,
    external_status: null,
    estimate: null,
    created_at: 1000000,
    updated_at: 1000000,
  };
  const row = { ...defaults, ...overrides };
  testDb
    .query(
      `INSERT INTO prd_stories (id, prd_id, title, description, acceptance_criteria, priority, depends_on, dependency_reasons, status, task_id, agent_id, conversation_id, commit_sha, attempts, max_attempts, learnings, sort_order, workspace_path, external_ref, external_status, estimate, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.prd_id,
      row.title,
      row.description,
      row.acceptance_criteria,
      row.priority,
      row.depends_on,
      row.dependency_reasons,
      row.status,
      row.task_id,
      row.agent_id,
      row.conversation_id,
      row.commit_sha,
      row.attempts,
      row.max_attempts,
      row.learnings,
      row.sort_order,
      row.workspace_path,
      row.external_ref,
      row.external_status,
      row.estimate,
      row.created_at,
      row.updated_at,
    );
}

function insertMemory(overrides: Record<string, any> = {}) {
  const defaults = {
    id: 'mem-1',
    workspace_path: '/test/project',
    category: 'convention',
    key: 'test-convention',
    content: 'Use TypeScript strict mode',
    source: 'manual',
    confidence: 0.9,
    times_seen: 1,
    created_at: 1000000,
    updated_at: 1000000,
  };
  const row = { ...defaults, ...overrides };
  testDb
    .query(
      `INSERT INTO workspace_memories (id, workspace_path, category, key, content, source, confidence, times_seen, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

describe('PRD Routes', () => {
  beforeEach(() => {
    clearTables();
    mockCallLlmResponse = '';
    mockCallLlmCapture = null;
  });

  // ---------------------------------------------------------------
  // GET / — List PRDs
  // ---------------------------------------------------------------
  describe('GET / — list PRDs', () => {
    test('returns empty array when no PRDs exist', async () => {
      const res = await app.request('/');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data).toEqual([]);
    });

    test('returns all PRDs ordered by updated_at DESC', async () => {
      insertPrd({ id: 'prd-old', name: 'Old', updated_at: 100 });
      insertPrd({ id: 'prd-new', name: 'New', updated_at: 200 });

      const res = await app.request('/');
      const json = await res.json();
      expect(json.data).toHaveLength(2);
      expect(json.data[0].id).toBe('prd-new');
      expect(json.data[1].id).toBe('prd-old');
    });

    test('filters by workspacePath query param', async () => {
      insertPrd({ id: 'prd-a', workspace_path: '/project-a' });
      insertPrd({ id: 'prd-b', workspace_path: '/project-b' });

      const res = await app.request('/?workspacePath=/project-a');
      const json = await res.json();
      expect(json.data).toHaveLength(1);
      expect(json.data[0].id).toBe('prd-a');
    });

    test('includes stories for each PRD so dropdown counts work without a separate fetch', async () => {
      insertPrd({ id: 'prd-counts' });
      insertStory({ id: 's-pending', prd_id: 'prd-counts', status: 'pending' });
      insertStory({ id: 's-qa', prd_id: 'prd-counts', status: 'qa' });
      insertStory({ id: 's-done', prd_id: 'prd-counts', status: 'completed' });

      const res = await app.request('/');
      const json = await res.json();
      const prd = json.data.find((p: any) => p.id === 'prd-counts');
      expect(prd.stories).toHaveLength(3);
      const statuses = prd.stories.map((s: any) => s.status).sort();
      expect(statuses).toEqual(['completed', 'pending', 'qa']);
    });

    test('maps row to camelCase shape', async () => {
      insertPrd({
        id: 'prd-1',
        workspace_path: '/my/project',
        name: 'My PRD',
        description: 'desc',
        branch_name: 'feature/test',
        quality_checks: '[{"id":"qc-1","type":"typecheck"}]',
        created_at: 100,
        updated_at: 200,
      });

      const res = await app.request('/');
      const json = await res.json();
      const prd = json.data[0];
      expect(prd.id).toBe('prd-1');
      expect(prd.workspacePath).toBe('/my/project');
      expect(prd.name).toBe('My PRD');
      expect(prd.description).toBe('desc');
      expect(prd.branchName).toBe('feature/test');
      expect(prd.qualityChecks).toEqual([{ id: 'qc-1', type: 'typecheck' }]);
      expect(prd.createdAt).toBe(100);
      expect(prd.updatedAt).toBe(200);
    });
  });

  // ---------------------------------------------------------------
  // GET /:id — Get single PRD with stories
  // ---------------------------------------------------------------
  describe('GET /:id — get PRD', () => {
    test('returns 404 for non-existent PRD', async () => {
      const res = await app.request('/nonexistent');
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('Not found');
    });

    test('returns PRD with stories', async () => {
      insertPrd({ id: 'prd-1' });
      insertStory({ id: 'story-1', prd_id: 'prd-1', sort_order: 1, title: 'Second' });
      insertStory({ id: 'story-2', prd_id: 'prd-1', sort_order: 0, title: 'First' });

      const res = await app.request('/prd-1');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.id).toBe('prd-1');
      expect(json.data.stories).toHaveLength(2);
      // Ordered by sort_order ASC
      expect(json.data.stories[0].title).toBe('First');
      expect(json.data.stories[1].title).toBe('Second');
    });

    test('returns stories with properly mapped fields', async () => {
      insertPrd({ id: 'prd-1' });
      insertStory({
        id: 'story-1',
        prd_id: 'prd-1',
        title: 'My Story',
        description: 'Story desc',
        priority: 'high',
        status: 'in_progress',
        depends_on: '["story-0"]',
        learnings: '["learned something"]',
        attempts: 2,
        max_attempts: 5,
      });

      const res = await app.request('/prd-1');
      const json = await res.json();
      const story = json.data.stories[0];
      expect(story.id).toBe('story-1');
      expect(story.prdId).toBe('prd-1');
      expect(story.title).toBe('My Story');
      expect(story.description).toBe('Story desc');
      expect(story.priority).toBe('high');
      expect(story.status).toBe('in_progress');
      expect(story.dependsOn).toEqual(['story-0']);
      expect(story.learnings).toEqual(['learned something']);
      expect(story.attempts).toBe(2);
      expect(story.maxAttempts).toBe(5);
      expect(story.acceptanceCriteria).toHaveLength(3);
    });
  });

  // ---------------------------------------------------------------
  // POST / — Create PRD with stories
  // ---------------------------------------------------------------
  describe('POST / — create PRD', () => {
    test('creates a PRD with stories', async () => {
      const res = await app.request('/', {
        method: 'POST',
        body: JSON.stringify({
          workspacePath: '/test/project',
          name: 'New PRD',
          description: 'Build a thing',
          stories: [
            {
              title: 'Story One',
              description: 'First story',
              acceptanceCriteria: ['AC 1', 'AC 2', 'AC 3'],
              priority: 'high',
            },
            {
              title: 'Story Two',
              description: 'Second story',
              acceptanceCriteria: ['AC A', 'AC B', 'AC C'],
            },
          ],
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.id).toBeDefined();
      expect(json.data.storyIds).toHaveLength(2);

      // Verify stories in DB
      const stories = testDb
        .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order')
        .all(json.data.id) as any[];
      expect(stories).toHaveLength(2);
      expect(stories[0].title).toBe('Story One');
      expect(stories[0].priority).toBe('high');
      expect(stories[1].title).toBe('Story Two');
      expect(stories[1].priority).toBe('medium'); // default

      // Verify acceptance criteria are properly formed
      const criteria = JSON.parse(stories[0].acceptance_criteria);
      expect(criteria).toHaveLength(3);
      expect(criteria[0].description).toBe('AC 1');
      expect(criteria[0].passed).toBe(false);
      expect(criteria[0].id).toBeDefined();
    });

    test('creates PRD with no stories', async () => {
      const res = await app.request('/', {
        method: 'POST',
        body: JSON.stringify({
          workspacePath: '/test/project',
          name: 'Empty PRD',
          description: '',
          stories: [],
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.data.storyIds).toHaveLength(0);
    });

    test('creates PRD with quality checks', async () => {
      const res = await app.request('/', {
        method: 'POST',
        body: JSON.stringify({
          workspacePath: '/test/project',
          name: 'PRD with Checks',
          stories: [],
          qualityChecks: [
            {
              id: 'qc-1',
              type: 'typecheck',
              name: 'TypeCheck',
              command: 'bun run check',
              timeout: 30000,
              required: true,
              enabled: true,
            },
          ],
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      const row = testDb
        .query('SELECT quality_checks FROM prds WHERE id = ?')
        .get(json.data.id) as any;
      const checks = JSON.parse(row.quality_checks);
      expect(checks).toHaveLength(1);
      expect(checks[0].type).toBe('typecheck');
    });
  });

  // ---------------------------------------------------------------
  // PATCH /:id — Update PRD
  // ---------------------------------------------------------------
  describe('PATCH /:id — update PRD', () => {
    test('returns 404 for non-existent PRD', async () => {
      const res = await app.request('/nonexistent', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Updated' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(404);
    });

    test('updates name and description', async () => {
      insertPrd({ id: 'prd-1' });

      const res = await app.request('/prd-1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Updated Name', description: 'New desc' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);

      const row = testDb.query('SELECT * FROM prds WHERE id = ?').get('prd-1') as any;
      expect(row.name).toBe('Updated Name');
      expect(row.description).toBe('New desc');
    });

    test('updates branchName', async () => {
      insertPrd({ id: 'prd-1' });

      await app.request('/prd-1', {
        method: 'PATCH',
        body: JSON.stringify({ branchName: 'feature/new-branch' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const row = testDb.query('SELECT branch_name FROM prds WHERE id = ?').get('prd-1') as any;
      expect(row.branch_name).toBe('feature/new-branch');
    });

    test('returns 400 when no fields to update', async () => {
      insertPrd({ id: 'prd-1' });

      const res = await app.request('/prd-1', {
        method: 'PATCH',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
    });

    test('updates qualityChecks', async () => {
      insertPrd({ id: 'prd-1' });

      const qualityChecks = { hasAcceptanceCriteria: true, hasDependencies: false };
      const res = await app.request('/prd-1', {
        method: 'PATCH',
        body: JSON.stringify({ qualityChecks }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(200);

      const row = testDb.query('SELECT quality_checks FROM prds WHERE id = ?').get('prd-1') as any;
      expect(JSON.parse(row.quality_checks)).toEqual(qualityChecks);
    });
  });

  // ---------------------------------------------------------------
  // DELETE /:id — Delete PRD
  // ---------------------------------------------------------------
  describe('DELETE /:id — delete PRD', () => {
    test('deletes a PRD', async () => {
      insertPrd({ id: 'prd-1' });

      const res = await app.request('/prd-1', { method: 'DELETE' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);

      const row = testDb.query('SELECT * FROM prds WHERE id = ?').get('prd-1');
      expect(row).toBeNull();
    });

    test('returns 404 for non-existent PRD', async () => {
      const res = await app.request('/nonexistent', { method: 'DELETE' });
      expect(res.status).toBe(404);
    });

    test('cascades delete to stories', async () => {
      insertPrd({ id: 'prd-1' });
      insertStory({ id: 'story-1', prd_id: 'prd-1' });
      insertStory({ id: 'story-2', prd_id: 'prd-1' });

      await app.request('/prd-1', { method: 'DELETE' });

      const stories = testDb.query('SELECT * FROM prd_stories WHERE prd_id = ?').all('prd-1');
      expect(stories).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------
  // POST /:id/stories — Add story to PRD
  // ---------------------------------------------------------------
  describe('POST /:id/stories — add story', () => {
    test('adds a story to an existing PRD', async () => {
      insertPrd({ id: 'prd-1' });

      const res = await app.request('/prd-1/stories', {
        method: 'POST',
        body: JSON.stringify({
          title: 'New Story',
          description: 'A new story',
          acceptanceCriteria: ['AC 1', 'AC 2', 'AC 3'],
          priority: 'high',
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.id).toBeDefined();
    });

    test('returns 404 for non-existent PRD', async () => {
      const res = await app.request('/nonexistent/stories', {
        method: 'POST',
        body: JSON.stringify({ title: 'Story', acceptanceCriteria: [] }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(404);
    });

    test('increments sort_order based on existing stories', async () => {
      insertPrd({ id: 'prd-1' });
      insertStory({ id: 'story-1', prd_id: 'prd-1', sort_order: 0 });
      insertStory({ id: 'story-2', prd_id: 'prd-1', sort_order: 1 });

      const res = await app.request('/prd-1/stories', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Third Story',
          acceptanceCriteria: ['AC'],
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      const row = testDb
        .query('SELECT sort_order FROM prd_stories WHERE id = ?')
        .get(json.data.id) as any;
      expect(row.sort_order).toBe(2);
    });

    test('touches PRD updated_at', async () => {
      insertPrd({ id: 'prd-1', updated_at: 1000 });

      await app.request('/prd-1/stories', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Story',
          acceptanceCriteria: [],
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const row = testDb.query('SELECT updated_at FROM prds WHERE id = ?').get('prd-1') as any;
      expect(row.updated_at).toBeGreaterThan(1000);
    });

    test('reorders stories by dependencies when dependsOn is provided', async () => {
      insertPrd({ id: 'prd-1' });
      insertStory({ id: 'dep-target', prd_id: 'prd-1', title: 'Foundation', sort_order: 0 });

      const res = await app.request('/prd-1/stories', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Dependent Story',
          dependsOn: ['dep-target'],
          acceptanceCriteria: ['AC'],
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.data.id).toBeDefined();

      // The dependent story should be after the target in sort order
      const targetRow = testDb
        .query('SELECT sort_order FROM prd_stories WHERE id = ?')
        .get('dep-target') as any;
      const newRow = testDb
        .query('SELECT sort_order FROM prd_stories WHERE id = ?')
        .get(json.data.id) as any;
      expect(newRow.sort_order).toBeGreaterThan(targetRow.sort_order);
    });
  });

  // ---------------------------------------------------------------
  // PATCH /:prdId/stories/:storyId — Update story
  // ---------------------------------------------------------------
  describe('PATCH /:prdId/stories/:storyId — update story', () => {
    test('returns 404 for non-existent story', async () => {
      insertPrd({ id: 'prd-1' });

      const res = await app.request('/prd-1/stories/nonexistent', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Updated' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(404);
    });

    test('updates title and description', async () => {
      insertPrd({ id: 'prd-1' });
      insertStory({ id: 'story-1', prd_id: 'prd-1' });

      const res = await app.request('/prd-1/stories/story-1', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Updated Title', description: 'Updated Description' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.title).toBe('Updated Title');
      expect(json.data.description).toBe('Updated Description');
    });

    test('updates status and priority', async () => {
      insertPrd({ id: 'prd-1' });
      insertStory({ id: 'story-1', prd_id: 'prd-1', status: 'pending', priority: 'medium' });

      const res = await app.request('/prd-1/stories/story-1', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'completed', priority: 'critical' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.data.status).toBe('completed');
      expect(json.data.priority).toBe('critical');
    });

    test('appends a learning with addLearning', async () => {
      insertPrd({ id: 'prd-1' });
      insertStory({ id: 'story-1', prd_id: 'prd-1', learnings: '["first learning"]' });

      const res = await app.request('/prd-1/stories/story-1', {
        method: 'PATCH',
        body: JSON.stringify({ addLearning: 'second learning' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.data.learnings).toEqual(['first learning', 'second learning']);
    });

    test('returns 400 when no fields to update', async () => {
      insertPrd({ id: 'prd-1' });
      insertStory({ id: 'story-1', prd_id: 'prd-1' });

      const res = await app.request('/prd-1/stories/story-1', {
        method: 'PATCH',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
    });

    test('updates acceptanceCriteria', async () => {
      insertPrd({ id: 'prd-1' });
      insertStory({ id: 'story-1', prd_id: 'prd-1' });

      const res = await app.request('/prd-1/stories/story-1', {
        method: 'PATCH',
        body: JSON.stringify({ acceptanceCriteria: ['AC 1', 'AC 2'] }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.acceptanceCriteria).toHaveLength(2);
    });

    test('updates learnings array', async () => {
      insertPrd({ id: 'prd-1' });
      insertStory({ id: 'story-1', prd_id: 'prd-1' });

      const res = await app.request('/prd-1/stories/story-1', {
        method: 'PATCH',
        body: JSON.stringify({ learnings: ['Learning A', 'Learning B'] }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.learnings).toEqual(['Learning A', 'Learning B']);
    });

    test('updates estimate', async () => {
      insertPrd({ id: 'prd-1' });
      insertStory({ id: 'story-1', prd_id: 'prd-1' });

      const estimate = {
        size: 'medium',
        storyPoints: 5,
        confidence: 'high',
        confidenceScore: 85,
        reasoning: 'Medium complexity task',
        isManualOverride: true,
      };
      const res = await app.request('/prd-1/stories/story-1', {
        method: 'PATCH',
        body: JSON.stringify({ estimate }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.estimate).toBeDefined();
      expect(json.data.estimate.size).toBe('medium');
      expect(json.data.estimate.storyPoints).toBe(5);
    });

    test('clears estimate when set to null', async () => {
      insertPrd({ id: 'prd-1' });
      insertStory({
        id: 'story-1',
        prd_id: 'prd-1',
        estimate: JSON.stringify({ size: 'small', storyPoints: 2 }),
      });

      const res = await app.request('/prd-1/stories/story-1', {
        method: 'PATCH',
        body: JSON.stringify({ estimate: null }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(200);
      // Verify in DB that estimate was set to null
      const row = testDb
        .query('SELECT estimate FROM prd_stories WHERE id = ?')
        .get('story-1') as any;
      expect(row.estimate).toBeNull();
    });

    test('updates researchOnly flag', async () => {
      insertPrd({ id: 'prd-1' });
      insertStory({ id: 'story-1', prd_id: 'prd-1' });

      const res = await app.request('/prd-1/stories/story-1', {
        method: 'PATCH',
        body: JSON.stringify({ researchOnly: true }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.researchOnly).toBe(true);
    });
  });

  // ---------------------------------------------------------------
  // DELETE /:prdId/stories/:storyId — Delete story
  // ---------------------------------------------------------------
  describe('DELETE /:prdId/stories/:storyId — delete story', () => {
    test('deletes a story', async () => {
      insertPrd({ id: 'prd-1' });
      insertStory({ id: 'story-1', prd_id: 'prd-1' });

      const res = await app.request('/prd-1/stories/story-1', { method: 'DELETE' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);

      const row = testDb.query('SELECT * FROM prd_stories WHERE id = ?').get('story-1');
      expect(row).toBeNull();
    });

    test('returns 404 for non-existent story', async () => {
      insertPrd({ id: 'prd-1' });

      const res = await app.request('/prd-1/stories/nonexistent', { method: 'DELETE' });
      expect(res.status).toBe(404);
    });

    test('touches PRD updated_at', async () => {
      insertPrd({ id: 'prd-1', updated_at: 1000 });
      insertStory({ id: 'story-1', prd_id: 'prd-1' });

      await app.request('/prd-1/stories/story-1', { method: 'DELETE' });

      const row = testDb.query('SELECT updated_at FROM prds WHERE id = ?').get('prd-1') as any;
      expect(row.updated_at).toBeGreaterThan(1000);
    });
  });

  // ---------------------------------------------------------------
  // POST /import — Import Ralph-format PRD
  // ---------------------------------------------------------------
  describe('POST /import — import PRD', () => {
    test('imports a Ralph-format PRD', async () => {
      const ralphPrd = {
        project: 'My Project',
        branchName: 'ralph/my-project',
        description: 'A project',
        userStories: [
          {
            id: 'US-001',
            title: 'Story A',
            description: 'First story',
            acceptanceCriteria: ['AC1', 'AC2', 'AC3'],
            priority: 2,
            passes: false,
          },
          {
            id: 'US-002',
            title: 'Story B',
            description: 'Second story',
            acceptanceCriteria: ['AC4'],
            priority: 1,
            passes: true,
          },
        ],
      };

      const res = await app.request('/import', {
        method: 'POST',
        body: JSON.stringify({ workspacePath: '/test/project', prdJson: ralphPrd }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.imported).toBe(2);

      // Check stories
      const stories = testDb
        .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order')
        .all(json.data.id) as any[];
      expect(stories).toHaveLength(2);
      expect(stories[0].priority).toBe('high'); // priority 2 maps to 'high'
      expect(stories[1].priority).toBe('critical'); // priority 1 maps to 'critical'
      expect(stories[1].status).toBe('completed'); // passes: true maps to 'completed'
    });

    test('returns 400 when missing required fields', async () => {
      const res = await app.request('/import', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
    });

    test('maps numeric priority 3 to medium and 4+ to low', async () => {
      const ralphPrd = {
        project: 'Priority Test',
        description: 'Testing priorities',
        userStories: [
          {
            id: 'US-003',
            title: 'Medium Priority',
            description: 'Priority 3 story',
            acceptanceCriteria: ['AC1'],
            priority: 3,
          },
          {
            id: 'US-004',
            title: 'Low Priority',
            description: 'Priority 4 story',
            acceptanceCriteria: ['AC1'],
            priority: 4,
          },
        ],
      };

      const res = await app.request('/import', {
        method: 'POST',
        body: JSON.stringify({ workspacePath: '/test', prdJson: ralphPrd }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(201);
      const json = await res.json();

      const stories = testDb
        .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order')
        .all(json.data.id) as any[];
      expect(stories[0].priority).toBe('medium');
      expect(stories[1].priority).toBe('low');
    });

    test('handles string priority in import', async () => {
      const ralphPrd = {
        project: 'String Priority',
        description: 'Test string priority',
        userStories: [
          {
            id: 'US-005',
            title: 'Critical Story',
            description: 'Has string priority',
            acceptanceCriteria: ['AC1'],
            priority: 'critical',
          },
        ],
      };

      const res = await app.request('/import', {
        method: 'POST',
        body: JSON.stringify({ workspacePath: '/test', prdJson: ralphPrd }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(201);
      const json = await res.json();

      const stories = testDb
        .query('SELECT * FROM prd_stories WHERE prd_id = ?')
        .all(json.data.id) as any[];
      expect(stories[0].priority).toBe('critical');
    });
  });

  // ---------------------------------------------------------------
  // GET /:id/export — Export PRD as Ralph-compatible format
  // ---------------------------------------------------------------
  describe('GET /:id/export — export PRD', () => {
    test('exports a PRD in Ralph format', async () => {
      insertPrd({ id: 'prd-1', name: 'My PRD', description: 'A PRD', branch_name: 'feature/test' });
      insertStory({
        id: 'story-1',
        prd_id: 'prd-1',
        title: 'Story A',
        description: 'First',
        priority: 'high',
        status: 'completed',
        sort_order: 0,
      });
      insertStory({
        id: 'story-2',
        prd_id: 'prd-1',
        title: 'Story B',
        description: 'Second',
        priority: 'low',
        status: 'pending',
        sort_order: 1,
      });

      const res = await app.request('/prd-1/export');
      expect(res.status).toBe(200);
      const json = await res.json();
      const data = json.data;

      expect(data.project).toBe('My PRD');
      expect(data.branchName).toBe('feature/test');
      expect(data.description).toBe('A PRD');
      expect(data.userStories).toHaveLength(2);
      expect(data.userStories[0].id).toBe('US-001');
      expect(data.userStories[0].priority).toBe(2); // 'high' → 2
      expect(data.userStories[0].passes).toBe(true); // 'completed' → true
      expect(data.userStories[1].priority).toBe(4); // 'low' → 4
      expect(data.userStories[1].passes).toBe(false);
    });

    test('returns 404 for non-existent PRD', async () => {
      const res = await app.request('/nonexistent/export');
      expect(res.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------
  // POST /:id/generate/accept — Accept generated stories
  // ---------------------------------------------------------------
  describe('POST /:id/generate/accept — accept generated stories', () => {
    test('bulk-adds generated stories to a PRD', async () => {
      insertPrd({ id: 'prd-1' });

      const stories = [
        {
          title: 'Generated Story 1',
          description: 'First gen story',
          acceptanceCriteria: ['AC 1', 'AC 2', 'AC 3'],
          priority: 'high' as const,
        },
        {
          title: 'Generated Story 2',
          description: 'Second gen story',
          acceptanceCriteria: ['AC A', 'AC B', 'AC C'],
          priority: 'medium' as const,
        },
      ];

      const res = await app.request('/prd-1/generate/accept', {
        method: 'POST',
        body: JSON.stringify({ stories }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.accepted).toBe(2);
      expect(json.data.storyIds).toHaveLength(2);

      // Verify stories in DB
      const dbStories = testDb
        .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order')
        .all('prd-1') as any[];
      expect(dbStories).toHaveLength(2);
      expect(dbStories[0].title).toBe('Generated Story 1');
      expect(dbStories[0].priority).toBe('high');
      expect(dbStories[1].title).toBe('Generated Story 2');

      // Verify acceptance criteria
      const criteria = JSON.parse(dbStories[0].acceptance_criteria);
      expect(criteria).toHaveLength(3);
      expect(criteria[0].description).toBe('AC 1');
      expect(criteria[0].passed).toBe(false);
    });

    test('returns 404 for non-existent PRD', async () => {
      const res = await app.request('/nonexistent/generate/accept', {
        method: 'POST',
        body: JSON.stringify({ stories: [{ title: 'Story', acceptanceCriteria: [] }] }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(404);
    });

    test('returns 400 when no stories provided', async () => {
      insertPrd({ id: 'prd-1' });

      const res = await app.request('/prd-1/generate/accept', {
        method: 'POST',
        body: JSON.stringify({ stories: [] }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
    });

    test('appends to existing stories with correct sort order', async () => {
      insertPrd({ id: 'prd-1' });
      insertStory({ id: 'existing-1', prd_id: 'prd-1', sort_order: 0 });
      insertStory({ id: 'existing-2', prd_id: 'prd-1', sort_order: 1 });

      const stories = [
        {
          title: 'New Story',
          description: 'New',
          acceptanceCriteria: ['AC'],
          priority: 'medium' as const,
        },
      ];

      const res = await app.request('/prd-1/generate/accept', {
        method: 'POST',
        body: JSON.stringify({ stories }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      const newStoryRow = testDb
        .query('SELECT sort_order FROM prd_stories WHERE id = ?')
        .get(json.data.storyIds[0]) as any;
      expect(newStoryRow.sort_order).toBe(2);
    });

    test('touches PRD updated_at', async () => {
      insertPrd({ id: 'prd-1', updated_at: 1000 });

      const stories = [
        {
          title: 'Story',
          description: '',
          acceptanceCriteria: ['AC'],
          priority: 'medium' as const,
        },
      ];

      await app.request('/prd-1/generate/accept', {
        method: 'POST',
        body: JSON.stringify({ stories }),
        headers: { 'Content-Type': 'application/json' },
      });

      const row = testDb.query('SELECT updated_at FROM prds WHERE id = ?').get('prd-1') as any;
      expect(row.updated_at).toBeGreaterThan(1000);
    });
  });

  // ---------------------------------------------------------------
  // POST /:id/generate — Generate stories (mocked AI)
  // ---------------------------------------------------------------
  describe('POST /:id/generate — generate stories', () => {
    test('returns 404 for non-existent PRD', async () => {
      const res = await app.request('/nonexistent/generate', {
        method: 'POST',
        body: JSON.stringify({ description: 'Build a thing' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(404);
    });

    test('returns 400 when no description provided', async () => {
      insertPrd({ id: 'prd-1', description: '' });

      const res = await app.request('/prd-1/generate', {
        method: 'POST',
        body: JSON.stringify({ description: '' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
    });

    test('uses PRD description as fallback when request description is empty', async () => {
      insertPrd({ id: 'prd-1', description: 'Build a user auth system' });

      // Mock fetch to simulate AI response
      const mockStories = [
        {
          title: 'Login',
          description: 'User login',
          acceptanceCriteria: ['AC1', 'AC2', 'AC3'],
          priority: 'high',
        },
        {
          title: 'Register',
          description: 'User registration',
          acceptanceCriteria: ['AC1', 'AC2', 'AC3'],
          priority: 'high',
        },
      ];

      mockCallLlmResponse = JSON.stringify(mockStories);

      const res = await app.request('/prd-1/generate', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.stories).toHaveLength(2);
      expect(json.data.prdId).toBe('prd-1');
    });

    test('generates stories with valid structure from AI response', async () => {
      insertPrd({ id: 'prd-1', description: 'Test PRD' });

      const mockStories = [
        {
          title: 'Story One',
          description: 'First story desc',
          acceptanceCriteria: ['AC 1', 'AC 2', 'AC 3'],
          priority: 'critical',
        },
        {
          title: 'Story Two',
          description: 'Second story desc',
          acceptanceCriteria: ['AC A', 'AC B', 'AC C', 'AC D'],
          priority: 'medium',
        },
      ];

      mockCallLlmResponse = JSON.stringify(mockStories);

      const res = await app.request('/prd-1/generate', {
        method: 'POST',
        body: JSON.stringify({ description: 'Build authentication', count: 5 }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.stories).toHaveLength(2);

      const story1 = json.data.stories[0];
      expect(story1.title).toBe('Story One');
      expect(story1.description).toBe('First story desc');
      expect(story1.acceptanceCriteria).toEqual(['AC 1', 'AC 2', 'AC 3']);
      expect(story1.priority).toBe('critical');

      const story2 = json.data.stories[1];
      expect(story2.acceptanceCriteria).toHaveLength(4);
    });

    test('handles markdown code fences in AI response', async () => {
      insertPrd({ id: 'prd-1', description: 'Test PRD' });

      const mockStories = [
        {
          title: 'Story',
          description: 'Desc',
          acceptanceCriteria: ['AC1', 'AC2', 'AC3'],
          priority: 'medium',
        },
      ];

      mockCallLlmResponse = '```json\n' + JSON.stringify(mockStories) + '\n```';

      const res = await app.request('/prd-1/generate', {
        method: 'POST',
        body: JSON.stringify({ description: 'Build a thing' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.stories).toHaveLength(1);
    });

    test('ensures minimum 3 acceptance criteria per story', async () => {
      insertPrd({ id: 'prd-1', description: 'Test PRD' });

      const mockStories = [
        {
          title: 'Story',
          description: 'Desc',
          acceptanceCriteria: ['Only one'],
          priority: 'medium',
        },
      ];

      mockCallLlmResponse = JSON.stringify(mockStories);

      const res = await app.request('/prd-1/generate', {
        method: 'POST',
        body: JSON.stringify({ description: 'Build a thing' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.ok).toBe(true);
      const story = json.data.stories[0];
      expect(story.acceptanceCriteria.length).toBeGreaterThanOrEqual(3);
      expect(story.acceptanceCriteria[0]).toBe('Only one');
      // Placeholder criteria should be added
      expect(story.acceptanceCriteria[1]).toContain('Needs acceptance criterion');
    });

    test('validates and defaults invalid priority', async () => {
      insertPrd({ id: 'prd-1', description: 'Test PRD' });

      const mockStories = [
        {
          title: 'Story',
          description: 'Desc',
          acceptanceCriteria: ['AC1', 'AC2', 'AC3'],
          priority: 'invalid-priority',
        },
      ];

      mockCallLlmResponse = JSON.stringify(mockStories);

      const res = await app.request('/prd-1/generate', {
        method: 'POST',
        body: JSON.stringify({ description: 'Build a thing' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.data.stories[0].priority).toBe('medium'); // defaults to medium
    });

    test('filters out stories without titles', async () => {
      insertPrd({ id: 'prd-1', description: 'Test PRD' });

      const mockStories = [
        {
          title: 'Good Story',
          description: 'Valid',
          acceptanceCriteria: ['AC1', 'AC2', 'AC3'],
          priority: 'medium',
        },
        {
          title: '',
          description: 'No title',
          acceptanceCriteria: ['AC1', 'AC2', 'AC3'],
          priority: 'medium',
        },
        {
          description: 'Missing title field',
          acceptanceCriteria: ['AC1', 'AC2', 'AC3'],
          priority: 'medium',
        },
      ];

      mockCallLlmResponse = JSON.stringify(mockStories);

      const res = await app.request('/prd-1/generate', {
        method: 'POST',
        body: JSON.stringify({ description: 'Build a thing' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.data.stories).toHaveLength(1);
      expect(json.data.stories[0].title).toBe('Good Story');
    });

    test('handles AI API error gracefully', async () => {
      insertPrd({ id: 'prd-1', description: 'Test PRD' });

      mockCallLlmResponse = new Error('LLM call failed (429)');

      const res = await app.request('/prd-1/generate', {
        method: 'POST',
        body: JSON.stringify({ description: 'Build a thing' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('generation failed');
    });

    test('handles invalid JSON in AI response', async () => {
      insertPrd({ id: 'prd-1', description: 'Test PRD' });

      mockCallLlmResponse = 'This is not valid JSON at all';

      const res = await app.request('/prd-1/generate', {
        method: 'POST',
        body: JSON.stringify({ description: 'Build a thing' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(502);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('Failed to parse');
    });

    test('returns 502 when AI returns empty stories array', async () => {
      insertPrd({ id: 'prd-1', description: 'Test PRD' });

      mockCallLlmResponse = JSON.stringify([]);

      const res = await app.request('/prd-1/generate', {
        method: 'POST',
        body: JSON.stringify({ description: 'Build a thing' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(502);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('empty or invalid');
    });

    test('includes existing stories in prompt context to avoid duplicates', async () => {
      insertPrd({ id: 'prd-1', description: 'Test PRD' });
      insertStory({ id: 'existing-1', prd_id: 'prd-1', title: 'Existing Story' });

      mockCallLlmResponse = JSON.stringify([
        {
          title: 'New Story',
          description: 'New',
          acceptanceCriteria: ['AC1', 'AC2', 'AC3'],
          priority: 'medium',
        },
      ]);

      await app.request('/prd-1/generate', {
        method: 'POST',
        body: JSON.stringify({ description: 'Build a thing' }),
        headers: { 'Content-Type': 'application/json' },
      });

      // System prompt should include existing story context
      expect(mockCallLlmCapture.system).toContain('Existing Story');
      expect(mockCallLlmCapture.system).toContain('avoid duplicating');
    });

    test('includes project memory context in system prompt', async () => {
      insertPrd({ id: 'prd-1', description: 'Test PRD', workspace_path: '/test/project' });
      insertMemory({
        id: 'mem-1',
        workspace_path: '/test/project',
        category: 'convention',
        key: 'language',
        content: 'Use TypeScript',
        confidence: 0.9,
      });

      mockCallLlmResponse = JSON.stringify([
        {
          title: 'Story',
          description: 'Desc',
          acceptanceCriteria: ['AC1', 'AC2', 'AC3'],
          priority: 'medium',
        },
      ]);

      await app.request('/prd-1/generate', {
        method: 'POST',
        body: JSON.stringify({ description: 'Build a thing' }),
        headers: { 'Content-Type': 'application/json' },
      });

      // System prompt should include project memory
      expect(mockCallLlmCapture.system).toContain('Project Memory');
      expect(mockCallLlmCapture.system).toContain('Use TypeScript');
    });
  });

  // ---------------------------------------------------------------
  // POST /:prdId/stories/:storyId/refine — Story refinement
  // ---------------------------------------------------------------
  describe('POST /:prdId/stories/:storyId/refine — story refinement', () => {
    function mockAnthropicRefine(response: any, _captureBody?: { body: any }) {
      mockCallLlmResponse = JSON.stringify(response);
    }

    function withApiKey(fn: () => Promise<void>) {
      return fn;
    }

    test('returns 404 for non-existent PRD', async () => {
      const res = await app.request('/nonexistent/stories/story-1/refine', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('PRD not found');
    });

    test('returns 404 for non-existent story', async () => {
      insertPrd({ id: 'prd-1' });

      const res = await app.request('/prd-1/stories/nonexistent/refine', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('Story not found');
    });

    test(
      'performs initial analysis with quality score and questions',
      withApiKey(async () => {
        insertPrd({ id: 'prd-1', name: 'Test PRD', description: 'A test PRD' });
        insertStory({
          id: 'story-1',
          prd_id: 'prd-1',
          title: 'Add login',
          description: 'Users should be able to log in',
        });

        mockAnthropicRefine({
          qualityScore: 45,
          qualityExplanation:
            'The story lacks detail about authentication method, error handling, and UI requirements.',
          meetsThreshold: false,
          questions: [
            {
              id: 'q1',
              question: 'What authentication method should be used?',
              context: 'Different auth methods have different implementation requirements',
              suggestedAnswers: ['OAuth 2.0', 'Email/password', 'SSO'],
            },
            {
              id: 'q2',
              question: 'What should happen on login failure?',
              context: 'Error handling is critical for security and UX',
              suggestedAnswers: ['Show generic error', 'Show specific error'],
            },
            {
              id: 'q3',
              question: 'Is there a session timeout requirement?',
              context: 'Session management affects security posture',
            },
          ],
          improvements: [],
        });

        const res = await app.request('/prd-1/stories/story-1/refine', {
          method: 'POST',
          body: JSON.stringify({}),
          headers: { 'Content-Type': 'application/json' },
        });

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.ok).toBe(true);
        expect(json.data.storyId).toBe('story-1');
        expect(json.data.qualityScore).toBe(45);
        expect(json.data.qualityExplanation).toContain('lacks detail');
        expect(json.data.meetsThreshold).toBe(false);
        expect(json.data.questions).toHaveLength(3);

        // Verify question structure
        const q1 = json.data.questions[0];
        expect(q1.id).toBe('q1');
        expect(q1.question).toBe('What authentication method should be used?');
        expect(q1.context).toContain('auth methods');
        expect(q1.suggestedAnswers).toEqual(['OAuth 2.0', 'Email/password', 'SSO']);
      }),
    );

    test(
      'generates 2-5 relevant clarifying questions',
      withApiKey(async () => {
        insertPrd({ id: 'prd-1' });
        insertStory({ id: 'story-1', prd_id: 'prd-1', title: 'Vague story' });

        mockAnthropicRefine({
          qualityScore: 30,
          qualityExplanation: 'Very vague',
          meetsThreshold: false,
          questions: [
            { id: 'q1', question: 'Q1?', context: 'C1' },
            { id: 'q2', question: 'Q2?', context: 'C2' },
            { id: 'q3', question: 'Q3?', context: 'C3' },
            { id: 'q4', question: 'Q4?', context: 'C4' },
          ],
          improvements: [],
        });

        const res = await app.request('/prd-1/stories/story-1/refine', {
          method: 'POST',
          body: JSON.stringify({}),
          headers: { 'Content-Type': 'application/json' },
        });

        const json = await res.json();
        expect(json.ok).toBe(true);
        // Should have between 2 and 5 questions (up to 5 per spec)
        expect(json.data.questions.length).toBeGreaterThanOrEqual(2);
        expect(json.data.questions.length).toBeLessThanOrEqual(5);
      }),
    );

    test(
      'limits questions to maximum of 5',
      withApiKey(async () => {
        insertPrd({ id: 'prd-1' });
        insertStory({ id: 'story-1', prd_id: 'prd-1' });

        // AI returns 8 questions — should be truncated to 5
        mockAnthropicRefine({
          qualityScore: 20,
          qualityExplanation: 'Very vague',
          meetsThreshold: false,
          questions: Array.from({ length: 8 }, (_, i) => ({
            id: `q${i + 1}`,
            question: `Question ${i + 1}?`,
            context: `Context ${i + 1}`,
          })),
          improvements: [],
        });

        const res = await app.request('/prd-1/stories/story-1/refine', {
          method: 'POST',
          body: JSON.stringify({}),
          headers: { 'Content-Type': 'application/json' },
        });

        const json = await res.json();
        expect(json.ok).toBe(true);
        expect(json.data.questions).toHaveLength(5);
      }),
    );

    test(
      'incorporates user answers to update story',
      withApiKey(async () => {
        insertPrd({ id: 'prd-1', name: 'Test PRD' });
        insertStory({
          id: 'story-1',
          prd_id: 'prd-1',
          title: 'Add login',
          description: 'Users should be able to log in',
        });

        mockAnthropicRefine({
          qualityScore: 85,
          qualityExplanation:
            'Story is now well-defined with clear authentication method and error handling.',
          meetsThreshold: true,
          questions: [],
          updatedStory: {
            title: 'Add OAuth 2.0 Login',
            description:
              'Users should be able to log in using OAuth 2.0 with Google and GitHub providers. On failure, a generic error message is shown with a retry option.',
            acceptanceCriteria: [
              'User can log in with Google OAuth',
              'User can log in with GitHub OAuth',
              'Failed login shows generic error with retry button',
              'Session persists for 24 hours',
            ],
            priority: 'high',
          },
          improvements: [
            'Added specific authentication method (OAuth 2.0)',
            'Defined error handling behavior',
            'Added session timeout requirement',
            'Split acceptance criteria into specific, testable items',
          ],
        });

        const res = await app.request('/prd-1/stories/story-1/refine', {
          method: 'POST',
          body: JSON.stringify({
            answers: [
              { questionId: 'q1', answer: 'OAuth 2.0 with Google and GitHub' },
              { questionId: 'q2', answer: 'Show generic error with retry' },
              { questionId: 'q3', answer: '24 hours' },
            ],
          }),
          headers: { 'Content-Type': 'application/json' },
        });

        const json = await res.json();
        expect(json.ok).toBe(true);
        expect(json.data.qualityScore).toBe(85);
        expect(json.data.meetsThreshold).toBe(true);
        expect(json.data.questions).toHaveLength(0);

        // Verify updated story
        expect(json.data.updatedStory).toBeDefined();
        expect(json.data.updatedStory.title).toBe('Add OAuth 2.0 Login');
        expect(json.data.updatedStory.description).toContain('OAuth 2.0');
        expect(json.data.updatedStory.acceptanceCriteria).toHaveLength(4);
        expect(json.data.updatedStory.priority).toBe('high');

        // Verify improvements explanation
        expect(json.data.improvements).toBeDefined();
        expect(json.data.improvements.length).toBeGreaterThanOrEqual(1);
        expect(json.data.improvements[0]).toContain('authentication method');
      }),
    );

    test(
      'auto-applies updated story to database when answers provided',
      withApiKey(async () => {
        insertPrd({ id: 'prd-1' });
        insertStory({
          id: 'story-1',
          prd_id: 'prd-1',
          title: 'Original Title',
          description: 'Original description',
          priority: 'medium',
        });

        mockAnthropicRefine({
          qualityScore: 90,
          qualityExplanation: 'Excellent',
          meetsThreshold: true,
          questions: [],
          updatedStory: {
            title: 'Refined Title',
            description: 'Refined description with more detail',
            acceptanceCriteria: ['Criterion A', 'Criterion B', 'Criterion C'],
            priority: 'high',
          },
          improvements: ['Improved title clarity', 'Added more context'],
        });

        await app.request('/prd-1/stories/story-1/refine', {
          method: 'POST',
          body: JSON.stringify({
            answers: [{ questionId: 'q1', answer: 'Some answer' }],
          }),
          headers: { 'Content-Type': 'application/json' },
        });

        // Check the database was updated
        const dbStory = testDb
          .query('SELECT * FROM prd_stories WHERE id = ?')
          .get('story-1') as any;
        expect(dbStory.title).toBe('Refined Title');
        expect(dbStory.description).toBe('Refined description with more detail');
        expect(dbStory.priority).toBe('high');

        const criteria = JSON.parse(dbStory.acceptance_criteria);
        expect(criteria).toHaveLength(3);
        expect(criteria[0].description).toBe('Criterion A');
        expect(criteria[0].passed).toBe(false);
        expect(criteria[0].id).toBeDefined();

        // PRD updated_at should also be updated
        const dbPrd = testDb.query('SELECT updated_at FROM prds WHERE id = ?').get('prd-1') as any;
        expect(dbPrd.updated_at).toBeGreaterThan(1000000);
      }),
    );

    test(
      'does not update database on initial analysis (no answers)',
      withApiKey(async () => {
        insertPrd({ id: 'prd-1' });
        insertStory({
          id: 'story-1',
          prd_id: 'prd-1',
          title: 'Original Title',
          description: 'Original desc',
        });

        mockAnthropicRefine({
          qualityScore: 50,
          qualityExplanation: 'Needs work',
          meetsThreshold: false,
          questions: [{ id: 'q1', question: 'Q?', context: 'C' }],
          updatedStory: {
            title: 'Should Not Be Applied',
            description: 'This should not be saved',
            acceptanceCriteria: ['AC'],
            priority: 'critical',
          },
        });

        await app.request('/prd-1/stories/story-1/refine', {
          method: 'POST',
          body: JSON.stringify({}),
          headers: { 'Content-Type': 'application/json' },
        });

        // Database should remain unchanged
        const dbStory = testDb
          .query('SELECT * FROM prd_stories WHERE id = ?')
          .get('story-1') as any;
        expect(dbStory.title).toBe('Original Title');
        expect(dbStory.description).toBe('Original desc');
      }),
    );

    test(
      'handles markdown code fences in AI response',
      withApiKey(async () => {
        insertPrd({ id: 'prd-1' });
        insertStory({ id: 'story-1', prd_id: 'prd-1' });

        const response = {
          qualityScore: 60,
          qualityExplanation: 'Fair',
          meetsThreshold: false,
          questions: [{ id: 'q1', question: 'Q?', context: 'C' }],
        };

        mockCallLlmResponse = '```json\n' + JSON.stringify(response) + '\n```';

        const res = await app.request('/prd-1/stories/story-1/refine', {
          method: 'POST',
          body: JSON.stringify({}),
          headers: { 'Content-Type': 'application/json' },
        });

        const json = await res.json();
        expect(json.ok).toBe(true);
        expect(json.data.qualityScore).toBe(60);
      }),
    );

    test(
      'clamps quality score to valid range',
      withApiKey(async () => {
        insertPrd({ id: 'prd-1' });
        insertStory({ id: 'story-1', prd_id: 'prd-1' });

        mockAnthropicRefine({
          qualityScore: 150,
          qualityExplanation: 'Out of range',
          meetsThreshold: true,
          questions: [],
        });

        const res = await app.request('/prd-1/stories/story-1/refine', {
          method: 'POST',
          body: JSON.stringify({}),
          headers: { 'Content-Type': 'application/json' },
        });

        const json = await res.json();
        expect(json.ok).toBe(true);
        expect(json.data.qualityScore).toBe(100);
      }),
    );

    test(
      'defaults quality score to 50 for non-numeric value',
      withApiKey(async () => {
        insertPrd({ id: 'prd-1' });
        insertStory({ id: 'story-1', prd_id: 'prd-1' });

        mockAnthropicRefine({
          qualityScore: 'not a number',
          qualityExplanation: 'Bad score',
          meetsThreshold: false,
          questions: [{ id: 'q1', question: 'Q?', context: 'C' }],
        });

        const res = await app.request('/prd-1/stories/story-1/refine', {
          method: 'POST',
          body: JSON.stringify({}),
          headers: { 'Content-Type': 'application/json' },
        });

        const json = await res.json();
        expect(json.ok).toBe(true);
        expect(json.data.qualityScore).toBe(50);
      }),
    );

    test(
      'handles AI API error (non-200 response)',
      withApiKey(async () => {
        insertPrd({ id: 'prd-1' });
        insertStory({ id: 'story-1', prd_id: 'prd-1' });

        mockCallLlmResponse = new Error('LLM call failed (429)');

        const res = await app.request('/prd-1/stories/story-1/refine', {
          method: 'POST',
          body: JSON.stringify({}),
          headers: { 'Content-Type': 'application/json' },
        });

        expect(res.status).toBe(500);
        const json = await res.json();
        expect(json.ok).toBe(false);
        expect(json.error).toContain('refinement failed');
      }),
    );

    test(
      'handles invalid JSON in AI response',
      withApiKey(async () => {
        insertPrd({ id: 'prd-1' });
        insertStory({ id: 'story-1', prd_id: 'prd-1' });

        mockCallLlmResponse = 'This is not valid JSON{';

        const res = await app.request('/prd-1/stories/story-1/refine', {
          method: 'POST',
          body: JSON.stringify({}),
          headers: { 'Content-Type': 'application/json' },
        });

        expect(res.status).toBe(502);
        const json = await res.json();
        expect(json.ok).toBe(false);
        expect(json.error).toContain('Failed to parse');
      }),
    );

    test(
      'handles AI response with no text content',
      withApiKey(async () => {
        insertPrd({ id: 'prd-1' });
        insertStory({ id: 'story-1', prd_id: 'prd-1' });

        mockCallLlmResponse = new Error('LLM returned no text content');

        const res = await app.request('/prd-1/stories/story-1/refine', {
          method: 'POST',
          body: JSON.stringify({}),
          headers: { 'Content-Type': 'application/json' },
        });

        expect(res.status).toBe(500);
        const json = await res.json();
        expect(json.ok).toBe(false);
        expect(json.error).toContain('refinement failed');
      }),
    );

    test(
      'filters out invalid questions (no question text)',
      withApiKey(async () => {
        insertPrd({ id: 'prd-1' });
        insertStory({ id: 'story-1', prd_id: 'prd-1' });

        mockAnthropicRefine({
          qualityScore: 40,
          qualityExplanation: 'Needs work',
          meetsThreshold: false,
          questions: [
            { id: 'q1', question: 'Valid question?', context: 'Context' },
            { id: 'q2', question: '', context: 'No question text' },
            { id: 'q3', question: null, context: 'Null question' },
            { id: 'q4', question: 'Another valid?', context: 'More context' },
          ],
        });

        const res = await app.request('/prd-1/stories/story-1/refine', {
          method: 'POST',
          body: JSON.stringify({}),
          headers: { 'Content-Type': 'application/json' },
        });

        const json = await res.json();
        expect(json.ok).toBe(true);
        expect(json.data.questions).toHaveLength(2);
        expect(json.data.questions[0].question).toBe('Valid question?');
        expect(json.data.questions[1].question).toBe('Another valid?');
      }),
    );

    test(
      'assigns default id for questions without an id',
      withApiKey(async () => {
        insertPrd({ id: 'prd-1' });
        insertStory({ id: 'story-1', prd_id: 'prd-1' });

        mockAnthropicRefine({
          qualityScore: 50,
          qualityExplanation: 'Fair',
          meetsThreshold: false,
          questions: [{ question: 'Question without id?', context: 'Context' }],
        });

        const res = await app.request('/prd-1/stories/story-1/refine', {
          method: 'POST',
          body: JSON.stringify({}),
          headers: { 'Content-Type': 'application/json' },
        });

        const json = await res.json();
        expect(json.ok).toBe(true);
        expect(json.data.questions[0].id).toBeDefined();
        expect(json.data.questions[0].id.length).toBeGreaterThan(0);
      }),
    );

    test(
      'includes project memory context in system prompt',
      withApiKey(async () => {
        insertPrd({ id: 'prd-1', workspace_path: '/test/project' });
        insertStory({ id: 'story-1', prd_id: 'prd-1' });
        insertMemory({
          id: 'mem-1',
          workspace_path: '/test/project',
          category: 'convention',
          key: 'testing',
          content: 'Use vitest for all tests',
          confidence: 0.9,
        });

        mockAnthropicRefine({
          qualityScore: 60,
          qualityExplanation: 'Fair',
          meetsThreshold: false,
          questions: [{ id: 'q1', question: 'Q?', context: 'C' }],
        });

        await app.request('/prd-1/stories/story-1/refine', {
          method: 'POST',
          body: JSON.stringify({}),
          headers: { 'Content-Type': 'application/json' },
        });

        expect(mockCallLlmCapture.system).toContain('Project Memory');
        expect(mockCallLlmCapture.system).toContain('Use vitest');
      }),
    );

    test(
      'includes sibling story context in system prompt',
      withApiKey(async () => {
        insertPrd({ id: 'prd-1' });
        insertStory({ id: 'story-1', prd_id: 'prd-1', title: 'Login Feature' });
        insertStory({
          id: 'story-2',
          prd_id: 'prd-1',
          title: 'Registration Feature',
          description: 'User registration flow',
        });

        mockAnthropicRefine({
          qualityScore: 60,
          qualityExplanation: 'Fair',
          meetsThreshold: false,
          questions: [{ id: 'q1', question: 'Q?', context: 'C' }],
        });

        await app.request('/prd-1/stories/story-1/refine', {
          method: 'POST',
          body: JSON.stringify({}),
          headers: { 'Content-Type': 'application/json' },
        });

        // System prompt should include sibling stories but NOT the story being refined
        expect(mockCallLlmCapture.system).toContain('Registration Feature');
        expect(mockCallLlmCapture.system).toContain('Other Stories');
      }),
    );

    test(
      'validates priority in updated story',
      withApiKey(async () => {
        insertPrd({ id: 'prd-1' });
        insertStory({ id: 'story-1', prd_id: 'prd-1', priority: 'medium' });

        mockAnthropicRefine({
          qualityScore: 85,
          qualityExplanation: 'Good',
          meetsThreshold: true,
          questions: [],
          updatedStory: {
            title: 'Updated',
            description: 'Updated desc',
            acceptanceCriteria: ['AC1', 'AC2', 'AC3'],
            priority: 'invalid-priority',
          },
          improvements: ['Fixed title'],
        });

        const res = await app.request('/prd-1/stories/story-1/refine', {
          method: 'POST',
          body: JSON.stringify({
            answers: [{ questionId: 'q1', answer: 'Answer' }],
          }),
          headers: { 'Content-Type': 'application/json' },
        });

        const json = await res.json();
        expect(json.ok).toBe(true);
        // Invalid priority should fall back to story's original priority
        expect(json.data.updatedStory.priority).toBe('medium');
      }),
    );

    test(
      'filters out empty/invalid acceptance criteria',
      withApiKey(async () => {
        insertPrd({ id: 'prd-1' });
        insertStory({ id: 'story-1', prd_id: 'prd-1' });

        mockAnthropicRefine({
          qualityScore: 85,
          qualityExplanation: 'Good',
          meetsThreshold: true,
          questions: [],
          updatedStory: {
            title: 'Updated',
            description: 'Updated desc',
            acceptanceCriteria: ['Valid AC', '', '   ', 'Another valid AC', null],
            priority: 'high',
          },
          improvements: ['Cleaned up'],
        });

        const res = await app.request('/prd-1/stories/story-1/refine', {
          method: 'POST',
          body: JSON.stringify({
            answers: [{ questionId: 'q1', answer: 'Answer' }],
          }),
          headers: { 'Content-Type': 'application/json' },
        });

        const json = await res.json();
        expect(json.ok).toBe(true);
        expect(json.data.updatedStory.acceptanceCriteria).toEqual(['Valid AC', 'Another valid AC']);
      }),
    );

    test(
      'refinement can be repeated (iterative refinement)',
      withApiKey(async () => {
        insertPrd({ id: 'prd-1' });
        insertStory({
          id: 'story-1',
          prd_id: 'prd-1',
          title: 'Vague story',
          description: 'Do something',
        });

        // Round 1: Initial analysis — low quality
        mockAnthropicRefine({
          qualityScore: 35,
          qualityExplanation: 'Very vague story with no specifics',
          meetsThreshold: false,
          questions: [
            { id: 'q1', question: 'What exactly?', context: 'Need specifics' },
            { id: 'q2', question: 'For whom?', context: 'Need target user' },
          ],
        });

        const res1 = await app.request('/prd-1/stories/story-1/refine', {
          method: 'POST',
          body: JSON.stringify({}),
          headers: { 'Content-Type': 'application/json' },
        });

        const json1 = await res1.json();
        expect(json1.data.qualityScore).toBe(35);
        expect(json1.data.meetsThreshold).toBe(false);
        expect(json1.data.questions.length).toBeGreaterThan(0);

        // Round 2: Submit answers — improved but still needs work
        mockAnthropicRefine({
          qualityScore: 65,
          qualityExplanation: 'Better but still missing edge cases',
          meetsThreshold: false,
          questions: [
            { id: 'q3', question: 'What about error cases?', context: 'Edge cases matter' },
          ],
          updatedStory: {
            title: 'Better title',
            description: 'Better description',
            acceptanceCriteria: ['AC1', 'AC2', 'AC3'],
            priority: 'medium',
          },
          improvements: ['Clarified scope'],
        });

        const res2 = await app.request('/prd-1/stories/story-1/refine', {
          method: 'POST',
          body: JSON.stringify({
            answers: [
              { questionId: 'q1', answer: 'Build a dashboard' },
              { questionId: 'q2', answer: 'For admins' },
            ],
          }),
          headers: { 'Content-Type': 'application/json' },
        });

        const json2 = await res2.json();
        expect(json2.data.qualityScore).toBe(65);
        expect(json2.data.meetsThreshold).toBe(false);
        expect(json2.data.questions.length).toBeGreaterThan(0);

        // Round 3: Submit more answers — now meets threshold
        mockAnthropicRefine({
          qualityScore: 92,
          qualityExplanation: 'Excellent — story is fully defined',
          meetsThreshold: true,
          questions: [],
          updatedStory: {
            title: 'Admin Dashboard with Error Handling',
            description: 'Build admin dashboard with comprehensive error handling',
            acceptanceCriteria: ['AC1', 'AC2', 'AC3', 'AC4'],
            priority: 'high',
          },
          improvements: ['Added error handling', 'Refined acceptance criteria'],
        });

        const res3 = await app.request('/prd-1/stories/story-1/refine', {
          method: 'POST',
          body: JSON.stringify({
            answers: [{ questionId: 'q3', answer: 'Show error toast and log to monitoring' }],
          }),
          headers: { 'Content-Type': 'application/json' },
        });

        const json3 = await res3.json();
        expect(json3.data.qualityScore).toBe(92);
        expect(json3.data.meetsThreshold).toBe(true);
        expect(json3.data.questions).toHaveLength(0);
        expect(json3.data.improvements.length).toBeGreaterThan(0);
      }),
    );

    test(
      'meetsThreshold is correctly derived from qualityScore >= 80',
      withApiKey(async () => {
        insertPrd({ id: 'prd-1' });
        insertStory({ id: 'story-1', prd_id: 'prd-1' });

        // Score 79 — below threshold
        mockAnthropicRefine({
          qualityScore: 79,
          qualityExplanation: 'Almost there',
          meetsThreshold: true, // AI says true but server should override based on score
          questions: [],
        });

        const res1 = await app.request('/prd-1/stories/story-1/refine', {
          method: 'POST',
          body: JSON.stringify({}),
          headers: { 'Content-Type': 'application/json' },
        });

        const json1 = await res1.json();
        expect(json1.data.meetsThreshold).toBe(false);

        // Score 80 — meets threshold
        mockAnthropicRefine({
          qualityScore: 80,
          qualityExplanation: 'Good enough',
          meetsThreshold: false, // AI says false but server should override
          questions: [],
        });

        const res2 = await app.request('/prd-1/stories/story-1/refine', {
          method: 'POST',
          body: JSON.stringify({}),
          headers: { 'Content-Type': 'application/json' },
        });

        const json2 = await res2.json();
        expect(json2.data.meetsThreshold).toBe(true);
      }),
    );

    test(
      'provides quality explanation of what was unclear',
      withApiKey(async () => {
        insertPrd({ id: 'prd-1' });
        insertStory({ id: 'story-1', prd_id: 'prd-1', title: 'Do stuff' });

        mockAnthropicRefine({
          qualityScore: 25,
          qualityExplanation:
            'The story title "Do stuff" is extremely vague. It lacks a clear description, has no acceptance criteria specifics, and does not define the target user or expected behavior.',
          meetsThreshold: false,
          questions: [
            { id: 'q1', question: 'What stuff?', context: 'The scope is completely undefined' },
          ],
        });

        const res = await app.request('/prd-1/stories/story-1/refine', {
          method: 'POST',
          body: JSON.stringify({}),
          headers: { 'Content-Type': 'application/json' },
        });

        const json = await res.json();
        expect(json.ok).toBe(true);
        expect(json.data.qualityExplanation).toContain('vague');
        expect(json.data.qualityExplanation.length).toBeGreaterThan(20);
      }),
    );

    test(
      'provides improvements explanation after refinement',
      withApiKey(async () => {
        insertPrd({ id: 'prd-1' });
        insertStory({ id: 'story-1', prd_id: 'prd-1' });

        mockAnthropicRefine({
          qualityScore: 88,
          qualityExplanation: 'Story is now well-defined',
          meetsThreshold: true,
          questions: [],
          updatedStory: {
            title: 'Refined',
            description: 'Refined desc',
            acceptanceCriteria: ['AC1', 'AC2', 'AC3'],
            priority: 'high',
          },
          improvements: [
            'Changed vague title to specific feature name',
            'Added error handling acceptance criteria',
            'Defined target user persona',
          ],
        });

        const res = await app.request('/prd-1/stories/story-1/refine', {
          method: 'POST',
          body: JSON.stringify({
            answers: [{ questionId: 'q1', answer: 'An answer' }],
          }),
          headers: { 'Content-Type': 'application/json' },
        });

        const json = await res.json();
        expect(json.ok).toBe(true);
        expect(json.data.improvements).toHaveLength(3);
        expect(json.data.improvements[0]).toContain('title');
        expect(json.data.improvements[1]).toContain('error handling');
      }),
    );

    test(
      'handles missing improvements gracefully',
      withApiKey(async () => {
        insertPrd({ id: 'prd-1' });
        insertStory({ id: 'story-1', prd_id: 'prd-1' });

        mockAnthropicRefine({
          qualityScore: 50,
          qualityExplanation: 'Fair',
          meetsThreshold: false,
          questions: [{ id: 'q1', question: 'Q?', context: 'C' }],
          // No improvements field
        });

        const res = await app.request('/prd-1/stories/story-1/refine', {
          method: 'POST',
          body: JSON.stringify({}),
          headers: { 'Content-Type': 'application/json' },
        });

        const json = await res.json();
        expect(json.ok).toBe(true);
        // Should not have improvements key when not provided
        expect(json.data.improvements).toBeUndefined();
      }),
    );

    test(
      'includes user answers in prompt to AI',
      withApiKey(async () => {
        insertPrd({ id: 'prd-1' });
        insertStory({ id: 'story-1', prd_id: 'prd-1', title: 'My Story' });

        mockAnthropicRefine({
          qualityScore: 80,
          qualityExplanation: 'Good',
          meetsThreshold: true,
          questions: [],
          updatedStory: {
            title: 'Updated',
            description: 'Updated',
            acceptanceCriteria: ['AC1', 'AC2', 'AC3'],
            priority: 'medium',
          },
        });

        await app.request('/prd-1/stories/story-1/refine', {
          method: 'POST',
          body: JSON.stringify({
            answers: [
              { questionId: 'auth-method', answer: 'Use JWT tokens' },
              { questionId: 'error-handling', answer: 'Show toast notifications' },
            ],
          }),
          headers: { 'Content-Type': 'application/json' },
        });

        // The user prompt should contain the answers
        const userMessage = mockCallLlmCapture.user;
        expect(userMessage).toContain('Use JWT tokens');
        expect(userMessage).toContain('Show toast notifications');
        expect(userMessage).toContain('auth-method');
        expect(userMessage).toContain('error-handling');
      }),
    );

    test(
      'includes PRD context in initial analysis prompt',
      withApiKey(async () => {
        insertPrd({
          id: 'prd-1',
          name: 'Auth System PRD',
          description: 'Build a complete authentication system',
        });
        insertStory({ id: 'story-1', prd_id: 'prd-1', title: 'Login' });

        mockAnthropicRefine({
          qualityScore: 55,
          qualityExplanation: 'Fair',
          meetsThreshold: false,
          questions: [{ id: 'q1', question: 'Q?', context: 'C' }],
        });

        await app.request('/prd-1/stories/story-1/refine', {
          method: 'POST',
          body: JSON.stringify({}),
          headers: { 'Content-Type': 'application/json' },
        });

        const userMessage = mockCallLlmCapture.user;
        expect(userMessage).toContain('Auth System PRD');
        expect(userMessage).toContain('Build a complete authentication system');
      }),
    );
  });

  // ---------------------------------------------------------------
  // POST /:id/plan — Sprint planning
  // ---------------------------------------------------------------
  describe('POST /:id/plan — sprint planning', () => {
    test('creates a planning conversation', async () => {
      insertPrd({ id: 'prd-1', name: 'My PRD', description: 'A PRD' });

      const res = await app.request('/prd-1/plan', {
        method: 'POST',
        body: JSON.stringify({ mode: 'chat', editMode: 'locked' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.conversationId).toBeDefined();
      expect(json.data.prdId).toBe('prd-1');
      expect(json.data.mode).toBe('chat');
      expect(json.data.editMode).toBe('locked');

      // Verify conversation was created
      const conv = testDb
        .query('SELECT * FROM conversations WHERE id = ?')
        .get(json.data.conversationId) as any;
      expect(conv).toBeDefined();
      expect(conv.title).toContain('[Plan]');
      expect(conv.plan_mode).toBe(1);
    });

    test('returns 404 for non-existent PRD', async () => {
      const res = await app.request('/nonexistent/plan', {
        method: 'POST',
        body: JSON.stringify({ mode: 'chat', editMode: 'locked' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(404);
    });

    test('includes story edit blocks for propose mode', async () => {
      insertPrd({ id: 'prd-1', name: 'My PRD', description: 'A PRD' });

      const res = await app.request('/prd-1/plan', {
        method: 'POST',
        body: JSON.stringify({ mode: 'chat', editMode: 'propose' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      const conv = testDb
        .query('SELECT system_prompt FROM conversations WHERE id = ?')
        .get(json.data.conversationId) as any;
      expect(conv.system_prompt).toContain('story-add');
      expect(conv.system_prompt).toContain('story-edit');
      expect(conv.system_prompt).toContain('user will see each suggestion');
    });

    test('includes existing stories context in system prompt', async () => {
      insertPrd({ id: 'prd-1', name: 'My PRD', description: 'A PRD' });
      insertStory({ id: 'story-1', prd_id: 'prd-1', title: 'Auth Story' });

      const res = await app.request('/prd-1/plan', {
        method: 'POST',
        body: JSON.stringify({ mode: 'chat', editMode: 'locked' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      const conv = testDb
        .query('SELECT system_prompt FROM conversations WHERE id = ?')
        .get(json.data.conversationId) as any;
      expect(conv.system_prompt).toContain('Auth Story');
    });
  });

  // ---------------------------------------------------------------
  // POST /:prdId/stories/:storyId/validate-criteria — AC validation
  // ---------------------------------------------------------------
  describe('POST /:prdId/stories/:storyId/validate-criteria — acceptance criteria validation', () => {
    test('returns 404 for non-existent PRD', async () => {
      const res = await app.request('/nonexistent/stories/story-1/validate-criteria', {
        method: 'POST',
        body: JSON.stringify({ storyId: 'story-1', criteria: ['Test criterion'] }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(404);
    });

    test('returns 404 for non-existent story', async () => {
      insertPrd({ id: 'prd-1' });

      const res = await app.request('/prd-1/stories/nonexistent/validate-criteria', {
        method: 'POST',
        body: JSON.stringify({ storyId: 'nonexistent', criteria: ['Test criterion'] }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(404);
    });

    test('returns 400 when no criteria available (empty body and empty story criteria)', async () => {
      insertPrd({ id: 'prd-1' });
      insertStory({ id: 'story-1', prd_id: 'prd-1', acceptance_criteria: '[]' });

      const res = await app.request('/prd-1/stories/story-1/validate-criteria', {
        method: 'POST',
        body: JSON.stringify({ storyId: 'story-1', criteria: [] }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('No acceptance criteria');
    });

    test('falls back to stored criteria when request criteria is empty', async () => {
      insertPrd({ id: 'prd-1' });
      insertStory({
        id: 'story-1',
        prd_id: 'prd-1',
        title: 'Login Story',
        acceptance_criteria: JSON.stringify([
          { id: 'ac-1', description: 'User can enter email and password', passed: false },
          { id: 'ac-2', description: 'System returns JWT on success', passed: false },
        ]),
      });

      const mockValidation = {
        overallScore: 85,
        allValid: true,
        summary: 'Good criteria overall.',
        criteria: [
          {
            index: 0,
            text: 'User can enter email and password',
            isValid: true,
            issues: [],
            suggestedReplacement: null,
          },
          {
            index: 1,
            text: 'System returns JWT on success',
            isValid: true,
            issues: [],
            suggestedReplacement: null,
          },
        ],
      };

      mockCallLlmResponse = JSON.stringify(mockValidation);

      const res = await app.request('/prd-1/stories/story-1/validate-criteria', {
        method: 'POST',
        body: JSON.stringify({ storyId: 'story-1' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.criteria).toHaveLength(2);
    });

    test('validates criteria and returns issues for vague language', async () => {
      insertPrd({ id: 'prd-1' });
      insertStory({ id: 'story-1', prd_id: 'prd-1', title: 'UI Story' });

      const mockValidation = {
        overallScore: 35,
        allValid: false,
        summary: 'Criteria contain vague and unmeasurable language.',
        criteria: [
          {
            index: 0,
            text: 'The system should work well',
            isValid: false,
            issues: [
              {
                criterionIndex: 0,
                criterionText: 'The system should work well',
                severity: 'error',
                category: 'vague',
                message: 'The phrase "work well" is subjective and lacks measurable outcomes.',
                suggestedReplacement:
                  'The system responds to all API requests within 200ms under normal load',
              },
            ],
            suggestedReplacement:
              'The system responds to all API requests within 200ms under normal load',
          },
          {
            index: 1,
            text: 'The UI should be user-friendly',
            isValid: false,
            issues: [
              {
                criterionIndex: 1,
                criterionText: 'The UI should be user-friendly',
                severity: 'error',
                category: 'vague',
                message: '"User-friendly" is subjective without specific metrics.',
                suggestedReplacement:
                  'New users can complete the registration flow in under 2 minutes without external help',
              },
              {
                criterionIndex: 1,
                criterionText: 'The UI should be user-friendly',
                severity: 'warning',
                category: 'unmeasurable',
                message: 'No objective measurement criteria provided.',
                suggestedReplacement:
                  'New users can complete the registration flow in under 2 minutes without external help',
              },
            ],
            suggestedReplacement:
              'New users can complete the registration flow in under 2 minutes without external help',
          },
        ],
      };

      mockCallLlmResponse = JSON.stringify(mockValidation);

      const res = await app.request('/prd-1/stories/story-1/validate-criteria', {
        method: 'POST',
        body: JSON.stringify({
          storyId: 'story-1',
          criteria: ['The system should work well', 'The UI should be user-friendly'],
          storyTitle: 'UI Story',
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);

      // AC1: System checks each criterion for specificity (not vague language)
      expect(json.data.overallScore).toBe(35);
      expect(json.data.allValid).toBe(false);
      expect(json.data.storyId).toBe('story-1');
      expect(json.data.summary).toBeTruthy();

      // Check criteria structure
      expect(json.data.criteria).toHaveLength(2);

      // First criterion — vague language flagged
      const c0 = json.data.criteria[0];
      expect(c0.isValid).toBe(false);
      expect(c0.issues).toHaveLength(1);
      expect(c0.issues[0].category).toBe('vague');
      expect(c0.issues[0].severity).toBe('error');
      expect(c0.issues[0].message).toBeTruthy();

      // AC4: AI suggests improved versions of problematic criteria
      expect(c0.suggestedReplacement).toBeTruthy();
      expect(c0.issues[0].suggestedReplacement).toBeTruthy();

      // Second criterion — multiple issues
      const c1 = json.data.criteria[1];
      expect(c1.isValid).toBe(false);
      expect(c1.issues.length).toBeGreaterThanOrEqual(2);
      expect(c1.suggestedReplacement).toBeTruthy();
    });

    test('validates measurability and testability of criteria', async () => {
      insertPrd({ id: 'prd-1' });
      insertStory({ id: 'story-1', prd_id: 'prd-1', title: 'API Story' });

      const mockValidation = {
        overallScore: 45,
        allValid: false,
        summary: 'Several criteria lack measurable outcomes.',
        criteria: [
          {
            index: 0,
            text: 'API should handle errors properly',
            isValid: false,
            issues: [
              {
                criterionIndex: 0,
                criterionText: 'API should handle errors properly',
                severity: 'error',
                category: 'untestable',
                message: 'No specific error scenarios or expected behaviors defined.',
                suggestedReplacement:
                  'API returns HTTP 400 with error message JSON for invalid input parameters',
              },
              {
                criterionIndex: 0,
                criterionText: 'API should handle errors properly',
                severity: 'warning',
                category: 'unmeasurable',
                message: '"Properly" is not objectively verifiable.',
                suggestedReplacement:
                  'API returns HTTP 400 with error message JSON for invalid input parameters',
              },
            ],
            suggestedReplacement:
              'API returns HTTP 400 with error message JSON for invalid input parameters',
          },
          {
            index: 1,
            text: 'System returns HTTP 200 with user data on successful login',
            isValid: true,
            issues: [],
            suggestedReplacement: null,
          },
        ],
      };

      mockCallLlmResponse = JSON.stringify(mockValidation);

      const res = await app.request('/prd-1/stories/story-1/validate-criteria', {
        method: 'POST',
        body: JSON.stringify({
          storyId: 'story-1',
          criteria: [
            'API should handle errors properly',
            'System returns HTTP 200 with user data on successful login',
          ],
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.ok).toBe(true);

      // AC2: System validates criteria are measurable/testable
      const c0 = json.data.criteria[0];
      expect(c0.isValid).toBe(false);
      expect(c0.issues.some((i: any) => i.category === 'untestable')).toBe(true);
      expect(c0.issues.some((i: any) => i.category === 'unmeasurable')).toBe(true);

      // Valid criterion passes
      const c1 = json.data.criteria[1];
      expect(c1.isValid).toBe(true);
      expect(c1.issues).toHaveLength(0);
    });

    test('normalizes severity and category values from AI', async () => {
      insertPrd({ id: 'prd-1' });
      insertStory({ id: 'story-1', prd_id: 'prd-1' });

      // AI returns invalid severity/category — should be normalized
      const mockValidation = {
        overallScore: 50,
        allValid: false,
        summary: 'Mixed results.',
        criteria: [
          {
            index: 0,
            text: 'Some criterion',
            isValid: false,
            issues: [
              {
                criterionIndex: 0,
                criterionText: 'Some criterion',
                severity: 'critical', // invalid → should become 'warning'
                category: 'unclear', // invalid → should become 'vague'
                message: 'This is unclear.',
                suggestedReplacement: 'Improved version',
              },
            ],
            suggestedReplacement: 'Improved version',
          },
        ],
      };

      mockCallLlmResponse = JSON.stringify(mockValidation);

      const res = await app.request('/prd-1/stories/story-1/validate-criteria', {
        method: 'POST',
        body: JSON.stringify({ storyId: 'story-1', criteria: ['Some criterion'] }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.ok).toBe(true);

      const issue = json.data.criteria[0].issues[0];
      // Invalid severity normalized to 'warning'
      expect(['error', 'warning', 'info']).toContain(issue.severity);
      expect(issue.severity).toBe('warning');
      // Invalid category normalized to 'vague'
      expect([
        'vague',
        'unmeasurable',
        'untestable',
        'too_broad',
        'ambiguous',
        'missing_detail',
      ]).toContain(issue.category);
      expect(issue.category).toBe('vague');
    });

    test('clamps overall score to 0-100 range', async () => {
      insertPrd({ id: 'prd-1' });
      insertStory({ id: 'story-1', prd_id: 'prd-1' });

      const mockValidation = {
        overallScore: 150, // out of range — should clamp to 100
        allValid: true,
        summary: 'Overly generous score.',
        criteria: [
          { index: 0, text: 'Criterion', isValid: true, issues: [], suggestedReplacement: null },
        ],
      };

      mockCallLlmResponse = JSON.stringify(mockValidation);

      const res = await app.request('/prd-1/stories/story-1/validate-criteria', {
        method: 'POST',
        body: JSON.stringify({ storyId: 'story-1', criteria: ['Criterion'] }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.overallScore).toBeLessThanOrEqual(100);
      expect(json.data.overallScore).toBeGreaterThanOrEqual(0);
    });

    test('handles markdown code fences in AI response', async () => {
      insertPrd({ id: 'prd-1' });
      insertStory({ id: 'story-1', prd_id: 'prd-1' });

      const mockValidation = {
        overallScore: 90,
        allValid: true,
        summary: 'All clear.',
        criteria: [
          {
            index: 0,
            text: 'Test criterion',
            isValid: true,
            issues: [],
            suggestedReplacement: null,
          },
        ],
      };

      mockCallLlmResponse = '```json\n' + JSON.stringify(mockValidation) + '\n```';

      const res = await app.request('/prd-1/stories/story-1/validate-criteria', {
        method: 'POST',
        body: JSON.stringify({ storyId: 'story-1', criteria: ['Test criterion'] }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.overallScore).toBe(90);
    });

    test('returns 502 when AI returns non-JSON response', async () => {
      insertPrd({ id: 'prd-1' });
      insertStory({ id: 'story-1', prd_id: 'prd-1' });

      mockCallLlmResponse = 'This is not valid JSON at all';

      const res = await app.request('/prd-1/stories/story-1/validate-criteria', {
        method: 'POST',
        body: JSON.stringify({ storyId: 'story-1', criteria: ['Test criterion'] }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(502);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('parse');
    });

    test('returns 500 when AI API returns error status', async () => {
      insertPrd({ id: 'prd-1' });
      insertStory({ id: 'story-1', prd_id: 'prd-1' });

      mockCallLlmResponse = new Error('LLM call failed (429)');

      const res = await app.request('/prd-1/stories/story-1/validate-criteria', {
        method: 'POST',
        body: JSON.stringify({ storyId: 'story-1', criteria: ['Test criterion'] }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('validation failed');
    });

    test('returns 500 when AI returns no text content', async () => {
      insertPrd({ id: 'prd-1' });
      insertStory({ id: 'story-1', prd_id: 'prd-1' });

      mockCallLlmResponse = new Error('LLM returned no text content');

      const res = await app.request('/prd-1/stories/story-1/validate-criteria', {
        method: 'POST',
        body: JSON.stringify({ storyId: 'story-1', criteria: ['Test criterion'] }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('validation failed');
    });

    test('correctly determines allValid based on individual criteria validity', async () => {
      insertPrd({ id: 'prd-1' });
      insertStory({ id: 'story-1', prd_id: 'prd-1' });

      const mockValidation = {
        overallScore: 95,
        allValid: true, // AI says all valid
        summary: 'Excellent criteria.',
        criteria: [
          { index: 0, text: 'Criterion A', isValid: true, issues: [], suggestedReplacement: null },
          {
            index: 1,
            text: 'Criterion B',
            isValid: false, // But this is invalid — allValid should be recomputed to false
            issues: [
              {
                criterionIndex: 1,
                criterionText: 'Criterion B',
                severity: 'warning',
                category: 'ambiguous',
                message: 'Ambiguous terms used.',
                suggestedReplacement: 'Improved B',
              },
            ],
            suggestedReplacement: 'Improved B',
          },
        ],
      };

      mockCallLlmResponse = JSON.stringify(mockValidation);

      const res = await app.request('/prd-1/stories/story-1/validate-criteria', {
        method: 'POST',
        body: JSON.stringify({ storyId: 'story-1', criteria: ['Criterion A', 'Criterion B'] }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.ok).toBe(true);
      // Server recomputes allValid from individual criteria, so it should be false
      expect(json.data.allValid).toBe(false);
    });

    test('provides suggested improvements for each problematic criterion', async () => {
      insertPrd({ id: 'prd-1' });
      insertStory({ id: 'story-1', prd_id: 'prd-1', title: 'Perf Story' });

      const mockValidation = {
        overallScore: 40,
        allValid: false,
        summary: 'Multiple criteria need improvement.',
        criteria: [
          {
            index: 0,
            text: 'System should be fast',
            isValid: false,
            issues: [
              {
                criterionIndex: 0,
                criterionText: 'System should be fast',
                severity: 'error',
                category: 'vague',
                message: '"Fast" is subjective without specific performance thresholds.',
                suggestedReplacement: 'Page load time is under 1 second on 3G network connection',
              },
            ],
            suggestedReplacement: 'Page load time is under 1 second on 3G network connection',
          },
          {
            index: 1,
            text: 'Data should be handled efficiently',
            isValid: false,
            issues: [
              {
                criterionIndex: 1,
                criterionText: 'Data should be handled efficiently',
                severity: 'error',
                category: 'unmeasurable',
                message: '"Efficiently" has no defined metric.',
                suggestedReplacement:
                  'Database queries complete within 100ms for datasets up to 10,000 records',
              },
            ],
            suggestedReplacement:
              'Database queries complete within 100ms for datasets up to 10,000 records',
          },
          {
            index: 2,
            text: 'Error messages should be appropriate',
            isValid: false,
            issues: [
              {
                criterionIndex: 2,
                criterionText: 'Error messages should be appropriate',
                severity: 'warning',
                category: 'ambiguous',
                message: '"Appropriate" is unclear. What constitutes appropriate?',
                suggestedReplacement:
                  'Error messages include the HTTP status code, error type, and a human-readable description',
              },
            ],
            suggestedReplacement:
              'Error messages include the HTTP status code, error type, and a human-readable description',
          },
        ],
      };

      mockCallLlmResponse = JSON.stringify(mockValidation);

      const res = await app.request('/prd-1/stories/story-1/validate-criteria', {
        method: 'POST',
        body: JSON.stringify({
          storyId: 'story-1',
          criteria: [
            'System should be fast',
            'Data should be handled efficiently',
            'Error messages should be appropriate',
          ],
          storyTitle: 'Perf Story',
          storyDescription: 'Performance optimization story',
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.ok).toBe(true);

      // AC4: AI suggests improved versions for ALL problematic criteria
      for (const criterion of json.data.criteria) {
        expect(criterion.isValid).toBe(false);
        expect(criterion.suggestedReplacement).toBeTruthy();
        expect(criterion.suggestedReplacement.length).toBeGreaterThan(10);

        // Each issue also has a suggested replacement
        for (const issue of criterion.issues) {
          expect(issue.suggestedReplacement).toBeTruthy();
        }
      }
    });

    test('uses story title and description for context when provided', async () => {
      insertPrd({ id: 'prd-1' });
      insertStory({
        id: 'story-1',
        prd_id: 'prd-1',
        title: 'Auth Story',
        description: 'Implement user authentication',
      });

      const mockValidation = {
        overallScore: 80,
        allValid: true,
        summary: 'Good criteria.',
        criteria: [
          { index: 0, text: 'Login works', isValid: true, issues: [], suggestedReplacement: null },
        ],
      };

      mockCallLlmResponse = JSON.stringify(mockValidation);

      const res = await app.request('/prd-1/stories/story-1/validate-criteria', {
        method: 'POST',
        body: JSON.stringify({
          storyId: 'story-1',
          criteria: ['Login works'],
          storyTitle: 'Custom Title Override',
          storyDescription: 'Custom description override',
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.ok).toBe(true);

      // Verify the AI was sent the proper context
      expect(mockCallLlmCapture).toBeTruthy();
      const userMessage = mockCallLlmCapture.user;
      expect(userMessage).toContain('Custom Title Override');
      expect(userMessage).toContain('Custom description override');
    });

    test('treats info-only issues as valid criteria', async () => {
      insertPrd({ id: 'prd-1' });
      insertStory({ id: 'story-1', prd_id: 'prd-1' });

      const mockValidation = {
        overallScore: 85,
        allValid: true,
        summary: 'Minor suggestions only.',
        criteria: [
          {
            index: 0,
            text: 'User receives email notification within 5 minutes',
            isValid: true,
            issues: [
              {
                criterionIndex: 0,
                criterionText: 'User receives email notification within 5 minutes',
                severity: 'info',
                category: 'missing_detail',
                message: 'Consider specifying what triggers the notification.',
                suggestedReplacement:
                  'User receives email notification within 5 minutes of account creation',
              },
            ],
            suggestedReplacement:
              'User receives email notification within 5 minutes of account creation',
          },
        ],
      };

      mockCallLlmResponse = JSON.stringify(mockValidation);

      const res = await app.request('/prd-1/stories/story-1/validate-criteria', {
        method: 'POST',
        body: JSON.stringify({
          storyId: 'story-1',
          criteria: ['User receives email notification within 5 minutes'],
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.ok).toBe(true);

      // Criterion with only info-level issues should be considered valid
      const c0 = json.data.criteria[0];
      expect(c0.isValid).toBe(true);
      expect(c0.issues).toHaveLength(1);
      expect(c0.issues[0].severity).toBe('info');
      expect(json.data.allValid).toBe(true);
    });

    test('handles missing overallScore with default of 50', async () => {
      insertPrd({ id: 'prd-1' });
      insertStory({ id: 'story-1', prd_id: 'prd-1' });

      const mockValidation = {
        // Missing overallScore
        allValid: true,
        summary: 'Score missing.',
        criteria: [
          { index: 0, text: 'Test', isValid: true, issues: [], suggestedReplacement: null },
        ],
      };

      mockCallLlmResponse = JSON.stringify(mockValidation);

      const res = await app.request('/prd-1/stories/story-1/validate-criteria', {
        method: 'POST',
        body: JSON.stringify({ storyId: 'story-1', criteria: ['Test'] }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.overallScore).toBe(50); // Default when missing
    });

    test('includes system prompt checking for all six validation categories', async () => {
      insertPrd({ id: 'prd-1' });
      insertStory({ id: 'story-1', prd_id: 'prd-1' });

      const mockValidation = {
        overallScore: 80,
        allValid: true,
        summary: 'OK',
        criteria: [
          { index: 0, text: 'Test', isValid: true, issues: [], suggestedReplacement: null },
        ],
      };

      mockCallLlmResponse = JSON.stringify(mockValidation);

      const res = await app.request('/prd-1/stories/story-1/validate-criteria', {
        method: 'POST',
        body: JSON.stringify({ storyId: 'story-1', criteria: ['Test'] }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.ok).toBe(true);

      // AC1 + AC2: System prompt should reference all validation categories
      const capturedSystem = mockCallLlmCapture.system;
      expect(capturedSystem).toContain('vague');
      expect(capturedSystem).toContain('unmeasurable');
      expect(capturedSystem).toContain('untestable');
      expect(capturedSystem).toContain('too_broad');
      expect(capturedSystem).toContain('ambiguous');
      expect(capturedSystem).toContain('missing_detail');

      // Should also mention specificity, measurability, testability
      expect(capturedSystem).toContain('Specificity');
      expect(capturedSystem).toContain('Measurability');
      expect(capturedSystem).toContain('Testability');

      // Should define severity levels
      expect(capturedSystem).toContain('error');
      expect(capturedSystem).toContain('warning');
      expect(capturedSystem).toContain('info');
    });
  });

  // ---------------------------------------------------------------
  // Story Template Library
  // ---------------------------------------------------------------

  function insertTemplate(overrides: Record<string, any> = {}) {
    const defaults = {
      id: 'tmpl-1',
      name: 'Custom Template',
      description: 'A custom story template',
      category: 'feature',
      title_template: 'As a {{user_role}}, I want to {{action}}',
      description_template: '## Overview\n{{description}}',
      acceptance_criteria_templates: JSON.stringify([
        'User can {{action}} from the {{page}} page',
        'Validation is performed on all inputs',
      ]),
      priority: 'medium',
      tags: JSON.stringify(['custom', 'test']),
      is_built_in: 0,
      created_at: 1000000,
      updated_at: 1000000,
    };
    const row = { ...defaults, ...overrides };
    testDb
      .query(
        `INSERT INTO story_templates (id, name, description, category, title_template, description_template,
         acceptance_criteria_templates, priority, tags, is_built_in, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.name,
        row.description,
        row.category,
        row.title_template,
        row.description_template,
        row.acceptance_criteria_templates,
        row.priority,
        row.tags,
        row.is_built_in,
        row.created_at,
        row.updated_at,
      );
  }

  describe('GET /templates — list templates', () => {
    test('seeds built-in templates on first call and returns them', async () => {
      const res = await app.request('/templates');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      // Should have at least 4 built-in templates (feature, bug, tech_debt, spike)
      expect(json.data.length).toBeGreaterThanOrEqual(4);

      const categories = json.data.map((t: any) => t.category);
      expect(categories).toContain('feature');
      expect(categories).toContain('bug');
      expect(categories).toContain('tech_debt');
      expect(categories).toContain('spike');

      // All should be built-in
      for (const t of json.data) {
        expect(t.isBuiltIn).toBe(true);
      }
    });

    test('each built-in template has pre-filled sections with placeholder guidance', async () => {
      const res = await app.request('/templates');
      const json = await res.json();
      for (const t of json.data) {
        expect(t.name).toBeTruthy();
        expect(t.description).toBeTruthy();
        expect(t.titleTemplate).toBeTruthy();
        expect(t.descriptionTemplate).toBeTruthy();
        expect(t.acceptanceCriteriaTemplates.length).toBeGreaterThan(0);
        // Templates should have placeholder guidance with {{}} syntax
        const allText = [
          t.titleTemplate,
          t.descriptionTemplate,
          ...t.acceptanceCriteriaTemplates,
        ].join(' ');
        expect(allText).toContain('{{');
      }
    });

    test('includes type-appropriate acceptance criteria examples', async () => {
      const res = await app.request('/templates');
      const json = await res.json();

      // Feature template should mention user-facing criteria
      const featureTmpl = json.data.find((t: any) => t.category === 'feature');
      expect(featureTmpl).toBeDefined();
      expect(featureTmpl.acceptanceCriteriaTemplates.length).toBeGreaterThanOrEqual(3);

      // Bug template should mention regression
      const bugTmpl = json.data.find((t: any) => t.category === 'bug');
      expect(bugTmpl).toBeDefined();
      const bugAcText = bugTmpl.acceptanceCriteriaTemplates.join(' ');
      expect(bugAcText.toLowerCase()).toContain('regression');

      // Tech debt template should mention refactor or tests
      const techDebtTmpl = json.data.find((t: any) => t.category === 'tech_debt');
      expect(techDebtTmpl).toBeDefined();
      const tdAcText = techDebtTmpl.acceptanceCriteriaTemplates.join(' ');
      expect(tdAcText.toLowerCase()).toContain('test');

      // Spike template should mention findings/recommendation
      const spikeTmpl = json.data.find((t: any) => t.category === 'spike');
      expect(spikeTmpl).toBeDefined();
      const spikeAcText = spikeTmpl.acceptanceCriteriaTemplates.join(' ');
      expect(spikeAcText.toLowerCase()).toContain('recommendation');
    });

    test('filters by category query param', async () => {
      // Seed built-ins first
      await app.request('/templates');
      // Insert a custom template
      insertTemplate({ id: 'tmpl-custom', category: 'custom' });

      const res = await app.request('/templates?category=custom');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data).toHaveLength(1);
      expect(json.data[0].category).toBe('custom');
    });

    test('returns both built-in and custom templates', async () => {
      // Seed built-ins first
      await app.request('/templates');
      insertTemplate({ id: 'tmpl-custom', name: 'My Custom', category: 'custom' });

      const res = await app.request('/templates');
      const json = await res.json();
      const builtIn = json.data.filter((t: any) => t.isBuiltIn);
      const custom = json.data.filter((t: any) => !t.isBuiltIn);
      expect(builtIn.length).toBeGreaterThanOrEqual(4);
      expect(custom.length).toBe(1);
      expect(custom[0].name).toBe('My Custom');
    });
  });

  describe('GET /templates/:templateId — get single template', () => {
    test('returns a template by id', async () => {
      insertTemplate({ id: 'tmpl-get' });
      const res = await app.request('/templates/tmpl-get');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.id).toBe('tmpl-get');
      expect(json.data.name).toBe('Custom Template');
    });

    test('returns 404 for non-existent template', async () => {
      const res = await app.request('/templates/nonexistent');
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.ok).toBe(false);
    });
  });

  describe('POST /templates — create custom template', () => {
    test('creates a custom template successfully', async () => {
      const body = {
        name: 'API Endpoint',
        description: 'Template for REST API endpoints',
        category: 'feature',
        titleTemplate: 'API: {{method}} {{endpoint}}',
        descriptionTemplate: 'Implement {{method}} {{endpoint}} endpoint',
        acceptanceCriteriaTemplates: [
          'Endpoint returns correct status codes',
          'Request validation is implemented',
          'Response matches documented schema',
        ],
        priority: 'high',
        tags: ['api', 'backend'],
      };

      const res = await app.request('/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.name).toBe('API Endpoint');
      expect(json.data.category).toBe('feature');
      expect(json.data.isBuiltIn).toBe(false);
      expect(json.data.acceptanceCriteriaTemplates).toHaveLength(3);
      expect(json.data.tags).toEqual(['api', 'backend']);
      expect(json.data.id).toBeTruthy();
    });

    test('rejects template without name', async () => {
      const res = await app.request('/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '', category: 'feature' }),
      });
      expect(res.status).toBe(400);
    });

    test('rejects template without category', async () => {
      const res = await app.request('/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /templates/:templateId — update template', () => {
    test('updates a custom template', async () => {
      insertTemplate({ id: 'tmpl-upd' });
      const res = await app.request('/templates/tmpl-upd', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Name', priority: 'high' }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.name).toBe('Updated Name');
      expect(json.data.priority).toBe('high');
    });

    test('returns 404 for non-existent template', async () => {
      const res = await app.request('/templates/nonexistent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });
      expect(res.status).toBe(404);
    });

    test('returns unchanged template if no updates provided', async () => {
      insertTemplate({ id: 'tmpl-noop' });
      const res = await app.request('/templates/tmpl-noop', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.name).toBe('Custom Template');
    });

    test('updates description', async () => {
      insertTemplate({ id: 'tmpl-desc' });
      const res = await app.request('/templates/tmpl-desc', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Updated description' }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.description).toBe('Updated description');
    });

    test('updates category', async () => {
      insertTemplate({ id: 'tmpl-cat' });
      const res = await app.request('/templates/tmpl-cat', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'bug_fix' }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.category).toBe('bug_fix');
    });

    test('updates titleTemplate', async () => {
      insertTemplate({ id: 'tmpl-title' });
      const res = await app.request('/templates/tmpl-title', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ titleTemplate: 'New title template: {{action}}' }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.titleTemplate).toBe('New title template: {{action}}');
    });

    test('updates descriptionTemplate', async () => {
      insertTemplate({ id: 'tmpl-desc-tmpl' });
      const res = await app.request('/templates/tmpl-desc-tmpl', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ descriptionTemplate: '## New\n{{description}}' }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.descriptionTemplate).toBe('## New\n{{description}}');
    });

    test('updates acceptanceCriteriaTemplates', async () => {
      insertTemplate({ id: 'tmpl-ac' });
      const res = await app.request('/templates/tmpl-ac', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acceptanceCriteriaTemplates: ['Criterion 1', 'Criterion 2'] }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.acceptanceCriteriaTemplates).toEqual(['Criterion 1', 'Criterion 2']);
    });

    test('updates tags', async () => {
      insertTemplate({ id: 'tmpl-tags' });
      const res = await app.request('/templates/tmpl-tags', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: ['frontend', 'ux'] }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.tags).toEqual(['frontend', 'ux']);
    });

    test('updates multiple fields at once', async () => {
      insertTemplate({ id: 'tmpl-multi' });
      const res = await app.request('/templates/tmpl-multi', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Multi-updated',
          description: 'All fields changed',
          category: 'tech_debt',
          titleTemplate: 'Title: {{action}}',
          descriptionTemplate: 'Desc: {{action}}',
          acceptanceCriteriaTemplates: ['AC1'],
          priority: 'critical',
          tags: ['backend'],
        }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.name).toBe('Multi-updated');
      expect(json.data.description).toBe('All fields changed');
      expect(json.data.category).toBe('tech_debt');
      expect(json.data.titleTemplate).toBe('Title: {{action}}');
      expect(json.data.descriptionTemplate).toBe('Desc: {{action}}');
      expect(json.data.acceptanceCriteriaTemplates).toEqual(['AC1']);
      expect(json.data.priority).toBe('critical');
      expect(json.data.tags).toEqual(['backend']);
    });
  });

  describe('DELETE /templates/:templateId — delete template', () => {
    test('deletes a custom template', async () => {
      insertTemplate({ id: 'tmpl-del', is_built_in: 0 });
      const res = await app.request('/templates/tmpl-del', { method: 'DELETE' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);

      // Verify it's gone
      const check = await app.request('/templates/tmpl-del');
      expect(check.status).toBe(404);
    });

    test('refuses to delete built-in templates', async () => {
      insertTemplate({ id: 'tmpl-builtin', is_built_in: 1 });
      const res = await app.request('/templates/tmpl-builtin', { method: 'DELETE' });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('built-in');
    });

    test('returns 404 for non-existent template', async () => {
      const res = await app.request('/templates/nonexistent', { method: 'DELETE' });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /:id/stories/from-template — create story from template', () => {
    test('creates a story from a template with variable substitution', async () => {
      insertPrd({ id: 'prd-tmpl' });
      insertTemplate({
        id: 'tmpl-use',
        title_template: 'As a {{user_role}}, I want to {{action}}',
        description_template: '## Feature\n{{user_role}} needs to {{action}}',
        acceptance_criteria_templates: JSON.stringify([
          'User can {{action}} from the dashboard',
          'System validates input before processing',
        ]),
        priority: 'high',
      });

      const res = await app.request('/prd-tmpl/stories/from-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: 'tmpl-use',
          variables: {
            user_role: 'developer',
            action: 'deploy code',
          },
        }),
      });
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.story.title).toBe('As a developer, I want to deploy code');
      expect(json.data.story.description).toContain('developer needs to deploy code');
      expect(json.data.story.acceptanceCriteria[0]).toBe('User can deploy code from the dashboard');
      expect(json.data.story.priority).toBe('high');
      expect(json.data.storyId).toBeTruthy();
    });

    test('keeps placeholders when variables are not provided', async () => {
      insertPrd({ id: 'prd-tmpl2' });
      insertTemplate({
        id: 'tmpl-partial',
        title_template: 'Fix: {{bug_description}}',
        description_template: 'Bug in {{area}}',
        acceptance_criteria_templates: JSON.stringify(['Bug is fixed']),
      });

      const res = await app.request('/prd-tmpl2/stories/from-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: 'tmpl-partial' }),
      });
      expect(res.status).toBe(201);
      const json = await res.json();
      // Placeholders should remain when no variables are provided
      expect(json.data.story.title).toBe('Fix: {{bug_description}}');
      expect(json.data.story.description).toBe('Bug in {{area}}');
    });

    test('returns 404 when PRD does not exist', async () => {
      insertTemplate({ id: 'tmpl-no-prd' });
      const res = await app.request('/nonexistent-prd/stories/from-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: 'tmpl-no-prd' }),
      });
      expect(res.status).toBe(404);
    });

    test('returns 404 when template does not exist', async () => {
      insertPrd({ id: 'prd-tmpl3' });
      const res = await app.request('/prd-tmpl3/stories/from-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: 'nonexistent-tmpl' }),
      });
      expect(res.status).toBe(404);
    });

    test('story is persisted in database with correct sort order', async () => {
      insertPrd({ id: 'prd-tmpl4' });
      insertStory({ id: 'existing-story', prd_id: 'prd-tmpl4', sort_order: 0 });
      insertTemplate({ id: 'tmpl-sort' });

      const res = await app.request('/prd-tmpl4/stories/from-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: 'tmpl-sort' }),
      });
      const json = await res.json();

      // Verify story is in the database
      const dbRow = testDb
        .query('SELECT * FROM prd_stories WHERE id = ?')
        .get(json.data.storyId) as any;
      expect(dbRow).toBeTruthy();
      expect(dbRow.prd_id).toBe('prd-tmpl4');
      expect(dbRow.sort_order).toBe(1); // Should be after existing story
    });
  });

  // ---------------------------------------------------------------
  // Priority Recommendation Engine Tests
  // ---------------------------------------------------------------
  describe('Priority Recommendation Engine', () => {
    function withApiKey(fn: () => Promise<void>) {
      return fn;
    }

    function mockAiPriorityResponse(response: any) {
      mockCallLlmResponse = JSON.stringify(response);
    }

    function setPriorityRecommendation(storyId: string, rec: any) {
      testDb
        .query('UPDATE prd_stories SET priority_recommendation = ? WHERE id = ?')
        .run(JSON.stringify(rec), storyId);
    }

    // -- Single story priority recommendation --

    describe('POST /:prdId/stories/:storyId/priority — single story recommendation', () => {
      test('returns 404 for non-existent PRD', async () => {
        const res = await app.request('/nonexistent/stories/story-1/priority', {
          method: 'POST',
          body: JSON.stringify({ storyId: 'story-1' }),
          headers: { 'Content-Type': 'application/json' },
        });
        expect(res.status).toBe(404);
      });

      test('returns 404 for non-existent story', async () => {
        insertPrd({ id: 'prd-pri-1' });
        const res = await app.request('/prd-pri-1/stories/nonexistent/priority', {
          method: 'POST',
          body: JSON.stringify({ storyId: 'nonexistent' }),
          headers: { 'Content-Type': 'application/json' },
        });
        expect(res.status).toBe(404);
      });

      test(
        'recommends priority with all factor categories',
        withApiKey(async () => {
          insertPrd({ id: 'prd-pri-2', description: 'E-commerce platform' });
          insertStory({
            id: 'story-pri-1',
            prd_id: 'prd-pri-2',
            title: 'User Authentication',
            description: 'Implement secure login with OAuth and session management',
            priority: 'medium',
            acceptance_criteria: JSON.stringify([
              { id: 'ac-1', description: 'Users can log in with email/password', passed: false },
              { id: 'ac-2', description: 'Session tokens are securely stored', passed: false },
              { id: 'ac-3', description: 'Failed login attempts are rate-limited', passed: false },
            ]),
          });

          mockAiPriorityResponse({
            suggestedPriority: 'high',
            confidence: 85,
            factors: [
              {
                factor: 'Security-critical feature',
                category: 'risk',
                impact: 'increases',
                weight: 'major',
              },
              {
                factor: 'Foundation for other features',
                category: 'dependency',
                impact: 'increases',
                weight: 'major',
              },
              {
                factor: 'Core user workflow',
                category: 'user_impact',
                impact: 'increases',
                weight: 'moderate',
              },
              {
                factor: 'Moderate scope with 3 criteria',
                category: 'scope',
                impact: 'neutral',
                weight: 'minor',
              },
            ],
            explanation:
              'Authentication is a security-critical, foundational feature that blocks other user-facing stories.',
          });

          const res = await app.request('/prd-pri-2/stories/story-pri-1/priority', {
            method: 'POST',
            body: JSON.stringify({ storyId: 'story-pri-1' }),
            headers: { 'Content-Type': 'application/json' },
          });

          expect(res.status).toBe(200);
          const json = await res.json();
          expect(json.ok).toBe(true);
          expect(json.data.recommendation.suggestedPriority).toBe('high');
          expect(json.data.recommendation.currentPriority).toBe('medium');
          expect(json.data.recommendation.confidence).toBe(85);
          expect(json.data.recommendation.factors).toHaveLength(4);
          expect(json.data.recommendation.explanation).toContain('security-critical');
          expect(json.data.recommendation.isManualOverride).toBe(false);

          // Verify all factor categories are present
          const categories = json.data.recommendation.factors.map((f: any) => f.category);
          expect(categories).toContain('risk');
          expect(categories).toContain('dependency');
          expect(categories).toContain('user_impact');
          expect(categories).toContain('scope');
        }),
      );

      test(
        'persists recommendation to database',
        withApiKey(async () => {
          insertPrd({ id: 'prd-pri-3' });
          insertStory({ id: 'story-pri-2', prd_id: 'prd-pri-3', priority: 'low' });

          mockAiPriorityResponse({
            suggestedPriority: 'critical',
            confidence: 92,
            factors: [
              {
                factor: 'Blocks all other stories',
                category: 'dependency',
                impact: 'increases',
                weight: 'major',
              },
            ],
            explanation: 'This is a blocking story.',
          });

          await app.request('/prd-pri-3/stories/story-pri-2/priority', {
            method: 'POST',
            body: JSON.stringify({ storyId: 'story-pri-2' }),
            headers: { 'Content-Type': 'application/json' },
          });

          // Check database directly
          const dbRow = testDb
            .query('SELECT priority_recommendation FROM prd_stories WHERE id = ?')
            .get('story-pri-2') as any;
          expect(dbRow.priority_recommendation).toBeTruthy();
          const rec = JSON.parse(dbRow.priority_recommendation);
          expect(rec.suggestedPriority).toBe('critical');
          expect(rec.confidence).toBe(92);
          expect(rec.isManualOverride).toBe(false);
        }),
      );

      test(
        'handles invalid AI response gracefully',
        withApiKey(async () => {
          insertPrd({ id: 'prd-pri-4' });
          insertStory({ id: 'story-pri-3', prd_id: 'prd-pri-4' });

          // Return invalid priority and missing fields
          mockAiPriorityResponse({
            suggestedPriority: 'ultra-critical',
            confidence: 200,
            factors: [
              {
                factor: 'Valid factor',
                category: 'invalid-cat',
                impact: 'invalid-impact',
                weight: 'invalid-weight',
              },
            ],
          });

          const res = await app.request('/prd-pri-4/stories/story-pri-3/priority', {
            method: 'POST',
            body: JSON.stringify({ storyId: 'story-pri-3' }),
            headers: { 'Content-Type': 'application/json' },
          });

          expect(res.status).toBe(200);
          const json = await res.json();
          // Invalid priority should fall back to 'medium'
          expect(json.data.recommendation.suggestedPriority).toBe('medium');
          // Confidence capped at 100
          expect(json.data.recommendation.confidence).toBe(100);
          // Invalid category defaults to 'scope'
          expect(json.data.recommendation.factors[0].category).toBe('scope');
          // Invalid impact defaults to 'neutral'
          expect(json.data.recommendation.factors[0].impact).toBe('neutral');
          // Invalid weight defaults to 'moderate'
          expect(json.data.recommendation.factors[0].weight).toBe('moderate');
          // Missing explanation gets default
          expect(json.data.recommendation.explanation).toBeTruthy();
        }),
      );

      test(
        'includes dependency context in AI prompt',
        withApiKey(async () => {
          insertPrd({ id: 'prd-pri-5' });
          insertStory({
            id: 'story-blocker',
            prd_id: 'prd-pri-5',
            title: 'Setup Database',
            priority: 'high',
            sort_order: 0,
          });
          insertStory({
            id: 'story-blocked',
            prd_id: 'prd-pri-5',
            title: 'User CRUD',
            priority: 'medium',
            depends_on: JSON.stringify(['story-blocker']),
            sort_order: 1,
          });
          insertStory({
            id: 'story-downstream',
            prd_id: 'prd-pri-5',
            title: 'User Profile',
            priority: 'low',
            depends_on: JSON.stringify(['story-blocked']),
            sort_order: 2,
          });

          mockCallLlmResponse = JSON.stringify({
            suggestedPriority: 'high',
            confidence: 80,
            factors: [
              {
                factor: 'Blocks downstream',
                category: 'dependency',
                impact: 'increases',
                weight: 'major',
              },
            ],
            explanation: 'Story blocks other work.',
          });

          await app.request('/prd-pri-5/stories/story-blocker/priority', {
            method: 'POST',
            body: JSON.stringify({ storyId: 'story-blocker' }),
            headers: { 'Content-Type': 'application/json' },
          });

          // The prompt should include dependency info — story-blocker blocks story-blocked
          expect(mockCallLlmCapture.user).toContain('BLOCKS');
          expect(mockCallLlmCapture.user).toContain('User CRUD');
        }),
      );

      test(
        'includes blocked-by dependency context in prompt',
        withApiKey(async () => {
          insertPrd({ id: 'prd-pri-6' });
          insertStory({
            id: 'pri6-blocker',
            prd_id: 'prd-pri-6',
            title: 'Database Setup',
            priority: 'high',
            sort_order: 0,
          });
          insertStory({
            id: 'pri6-blocked',
            prd_id: 'prd-pri-6',
            title: 'API Endpoints',
            priority: 'medium',
            depends_on: JSON.stringify(['pri6-blocker']),
            sort_order: 1,
          });

          mockCallLlmResponse = JSON.stringify({
            suggestedPriority: 'medium',
            confidence: 75,
            factors: [
              {
                factor: 'Blocked by setup',
                category: 'dependency',
                impact: 'decreases',
                weight: 'moderate',
              },
            ],
            explanation: 'Story depends on database setup.',
          });

          await app.request('/prd-pri-6/stories/pri6-blocked/priority', {
            method: 'POST',
            body: JSON.stringify({}),
            headers: { 'Content-Type': 'application/json' },
          });

          // The prompt should include "BLOCKED BY" context
          expect(mockCallLlmCapture.user).toContain('BLOCKED BY');
          expect(mockCallLlmCapture.user).toContain('Database Setup');
        }),
      );

      test(
        'includes project memory context in priority prompt',
        withApiKey(async () => {
          insertPrd({ id: 'prd-pri-7' });
          insertStory({ id: 'pri7-s1', prd_id: 'prd-pri-7', title: 'Feature', priority: 'medium' });
          insertMemory({
            id: 'mem-pri7',
            workspace_path: '/test/project',
            category: 'decision',
            key: 'arch-choice',
            content: 'Use microservices architecture',
          });

          mockCallLlmResponse = JSON.stringify({
            suggestedPriority: 'high',
            confidence: 80,
            factors: [],
            explanation: 'Based on architecture context.',
          });

          await app.request('/prd-pri-7/stories/pri7-s1/priority', {
            method: 'POST',
            body: JSON.stringify({}),
            headers: { 'Content-Type': 'application/json' },
          });

          // Verify project memory context is included in the LLM prompt
          expect(mockCallLlmCapture.system).toContain('Project Memory');
          expect(mockCallLlmCapture.system).toContain('microservices');
        }),
      );
    });

    // -- Accept/override priority --

    describe('PUT /:prdId/stories/:storyId/priority — accept/override priority', () => {
      test('accepts AI-suggested priority', async () => {
        insertPrd({ id: 'prd-acc-1' });
        insertStory({ id: 'story-acc-1', prd_id: 'prd-acc-1', priority: 'medium' });
        setPriorityRecommendation('story-acc-1', {
          storyId: 'story-acc-1',
          suggestedPriority: 'high',
          currentPriority: 'medium',
          confidence: 85,
          factors: [],
          explanation: 'Should be high.',
          isManualOverride: false,
        });

        const res = await app.request('/prd-acc-1/stories/story-acc-1/priority', {
          method: 'PUT',
          body: JSON.stringify({ priority: 'high', accept: true }),
          headers: { 'Content-Type': 'application/json' },
        });

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.ok).toBe(true);

        // Verify story priority was updated
        const dbRow = testDb
          .query('SELECT * FROM prd_stories WHERE id = ?')
          .get('story-acc-1') as any;
        expect(dbRow.priority).toBe('high');

        // Verify recommendation was updated (not marked as manual override since we accepted)
        const rec = JSON.parse(dbRow.priority_recommendation);
        expect(rec.isManualOverride).toBe(false);
        expect(rec.currentPriority).toBe('high');
      });

      test('overrides with different priority (manual override)', async () => {
        insertPrd({ id: 'prd-acc-2' });
        insertStory({ id: 'story-acc-2', prd_id: 'prd-acc-2', priority: 'medium' });
        setPriorityRecommendation('story-acc-2', {
          storyId: 'story-acc-2',
          suggestedPriority: 'high',
          currentPriority: 'medium',
          confidence: 85,
          factors: [],
          explanation: 'Should be high.',
          isManualOverride: false,
        });

        const res = await app.request('/prd-acc-2/stories/story-acc-2/priority', {
          method: 'PUT',
          body: JSON.stringify({ priority: 'critical', accept: false }),
          headers: { 'Content-Type': 'application/json' },
        });

        expect(res.status).toBe(200);

        const dbRow = testDb
          .query('SELECT * FROM prd_stories WHERE id = ?')
          .get('story-acc-2') as any;
        expect(dbRow.priority).toBe('critical');

        const rec = JSON.parse(dbRow.priority_recommendation);
        expect(rec.isManualOverride).toBe(true);
        expect(rec.currentPriority).toBe('critical');
      });

      test('rejects invalid priority', async () => {
        insertPrd({ id: 'prd-acc-3' });
        insertStory({ id: 'story-acc-3', prd_id: 'prd-acc-3' });

        const res = await app.request('/prd-acc-3/stories/story-acc-3/priority', {
          method: 'PUT',
          body: JSON.stringify({ priority: 'invalid', accept: true }),
          headers: { 'Content-Type': 'application/json' },
        });

        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toContain('Invalid priority');
      });

      test('returns 404 for non-existent story', async () => {
        insertPrd({ id: 'prd-acc-4' });
        const res = await app.request('/prd-acc-4/stories/nonexistent/priority', {
          method: 'PUT',
          body: JSON.stringify({ priority: 'high', accept: true }),
          headers: { 'Content-Type': 'application/json' },
        });
        expect(res.status).toBe(404);
      });
    });

    // -- Bulk priority recommendation --

    describe('POST /:id/priorities — bulk priority recommendation', () => {
      test('returns 404 for non-existent PRD', async () => {
        const res = await app.request('/nonexistent/priorities', {
          method: 'POST',
          body: JSON.stringify({}),
          headers: { 'Content-Type': 'application/json' },
        });
        expect(res.status).toBe(404);
      });

      test('returns 400 when PRD has no stories', async () => {
        insertPrd({ id: 'prd-bulk-1' });
        const res = await app.request('/prd-bulk-1/priorities', {
          method: 'POST',
          body: JSON.stringify({}),
          headers: { 'Content-Type': 'application/json' },
        });
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toContain('No stories');
      });

      test(
        'recommends priorities for all stories',
        withApiKey(async () => {
          insertPrd({ id: 'prd-bulk-2', description: 'Task management app' });
          insertStory({
            id: 'bulk-s1',
            prd_id: 'prd-bulk-2',
            title: 'Auth System',
            priority: 'medium',
            sort_order: 0,
          });
          insertStory({
            id: 'bulk-s2',
            prd_id: 'prd-bulk-2',
            title: 'Dashboard UI',
            priority: 'medium',
            sort_order: 1,
          });
          insertStory({
            id: 'bulk-s3',
            prd_id: 'prd-bulk-2',
            title: 'Email Notifications',
            priority: 'medium',
            sort_order: 2,
          });

          mockAiPriorityResponse({
            recommendations: [
              {
                storyId: 'bulk-s1',
                suggestedPriority: 'critical',
                confidence: 90,
                factors: [
                  {
                    factor: 'Foundation feature',
                    category: 'dependency',
                    impact: 'increases',
                    weight: 'major',
                  },
                ],
                explanation: 'Authentication is foundational.',
              },
              {
                storyId: 'bulk-s2',
                suggestedPriority: 'high',
                confidence: 75,
                factors: [
                  {
                    factor: 'Core user interface',
                    category: 'user_impact',
                    impact: 'increases',
                    weight: 'moderate',
                  },
                ],
                explanation: 'Dashboard is the primary interface.',
              },
              {
                storyId: 'bulk-s3',
                suggestedPriority: 'low',
                confidence: 80,
                factors: [
                  {
                    factor: 'Nice-to-have feature',
                    category: 'scope',
                    impact: 'decreases',
                    weight: 'minor',
                  },
                ],
                explanation: 'Notifications can be added later.',
              },
            ],
            summary: 'Auth first, then dashboard, notifications last.',
          });

          const res = await app.request('/prd-bulk-2/priorities', {
            method: 'POST',
            body: JSON.stringify({}),
            headers: { 'Content-Type': 'application/json' },
          });

          expect(res.status).toBe(200);
          const json = await res.json();
          expect(json.ok).toBe(true);
          expect(json.data.recommendations).toHaveLength(3);
          expect(json.data.summary.criticalCount).toBe(1);
          expect(json.data.summary.highCount).toBe(1);
          expect(json.data.summary.lowCount).toBe(1);
          expect(json.data.summary.changedCount).toBe(3); // All changed from medium

          // Verify persisted in database
          const s1 = testDb
            .query('SELECT priority_recommendation FROM prd_stories WHERE id = ?')
            .get('bulk-s1') as any;
          const s2 = testDb
            .query('SELECT priority_recommendation FROM prd_stories WHERE id = ?')
            .get('bulk-s2') as any;
          const s3 = testDb
            .query('SELECT priority_recommendation FROM prd_stories WHERE id = ?')
            .get('bulk-s3') as any;
          expect(JSON.parse(s1.priority_recommendation).suggestedPriority).toBe('critical');
          expect(JSON.parse(s2.priority_recommendation).suggestedPriority).toBe('high');
          expect(JSON.parse(s3.priority_recommendation).suggestedPriority).toBe('low');
        }),
      );
    });

    // -- Priority recommendations update when dependencies change --

    describe('Priority recommendation invalidation on dependency changes', () => {
      test('adding a dependency invalidates priority recommendations for both stories', async () => {
        insertPrd({ id: 'prd-inv-1' });
        insertStory({ id: 'inv-s1', prd_id: 'prd-inv-1', title: 'Story A', sort_order: 0 });
        insertStory({ id: 'inv-s2', prd_id: 'prd-inv-1', title: 'Story B', sort_order: 1 });

        // Set priority recommendations on both
        setPriorityRecommendation('inv-s1', {
          storyId: 'inv-s1',
          suggestedPriority: 'medium',
          currentPriority: 'medium',
          confidence: 80,
          factors: [],
          explanation: 'Initial recommendation',
          isManualOverride: false,
        });
        setPriorityRecommendation('inv-s2', {
          storyId: 'inv-s2',
          suggestedPriority: 'low',
          currentPriority: 'low',
          confidence: 70,
          factors: [],
          explanation: 'Initial recommendation',
          isManualOverride: false,
        });

        // Add dependency: s1 depends on s2
        await app.request('/prd-inv-1/dependencies', {
          method: 'POST',
          body: JSON.stringify({
            fromStoryId: 'inv-s1',
            toStoryId: 'inv-s2',
            reason: 'Data model needed',
          }),
          headers: { 'Content-Type': 'application/json' },
        });

        // Both recommendations should be nullified
        const s1Row = testDb
          .query('SELECT priority_recommendation FROM prd_stories WHERE id = ?')
          .get('inv-s1') as any;
        const s2Row = testDb
          .query('SELECT priority_recommendation FROM prd_stories WHERE id = ?')
          .get('inv-s2') as any;
        expect(s1Row.priority_recommendation).toBeNull();
        expect(s2Row.priority_recommendation).toBeNull();
      });

      test('removing a dependency invalidates priority recommendations', async () => {
        insertPrd({ id: 'prd-inv-2' });
        insertStory({
          id: 'inv-s3',
          prd_id: 'prd-inv-2',
          title: 'Story C',
          depends_on: JSON.stringify(['inv-s4']),
          sort_order: 0,
        });
        insertStory({ id: 'inv-s4', prd_id: 'prd-inv-2', title: 'Story D', sort_order: 1 });

        setPriorityRecommendation('inv-s3', {
          storyId: 'inv-s3',
          suggestedPriority: 'high',
          currentPriority: 'medium',
          confidence: 85,
          factors: [],
          explanation: 'Based on dependency',
          isManualOverride: false,
        });
        setPriorityRecommendation('inv-s4', {
          storyId: 'inv-s4',
          suggestedPriority: 'critical',
          currentPriority: 'medium',
          confidence: 90,
          factors: [],
          explanation: 'Blocking story',
          isManualOverride: false,
        });

        // Remove dependency
        await app.request('/prd-inv-2/dependencies', {
          method: 'DELETE',
          body: JSON.stringify({ fromStoryId: 'inv-s3', toStoryId: 'inv-s4' }),
          headers: { 'Content-Type': 'application/json' },
        });

        const s3Row = testDb
          .query('SELECT priority_recommendation FROM prd_stories WHERE id = ?')
          .get('inv-s3') as any;
        const s4Row = testDb
          .query('SELECT priority_recommendation FROM prd_stories WHERE id = ?')
          .get('inv-s4') as any;
        expect(s3Row.priority_recommendation).toBeNull();
        expect(s4Row.priority_recommendation).toBeNull();
      });

      test('updating dependsOn via PATCH invalidates priority recommendations', async () => {
        insertPrd({ id: 'prd-inv-3' });
        insertStory({ id: 'inv-s5', prd_id: 'prd-inv-3', title: 'Story E', sort_order: 0 });
        insertStory({ id: 'inv-s6', prd_id: 'prd-inv-3', title: 'Story F', sort_order: 1 });

        setPriorityRecommendation('inv-s5', {
          storyId: 'inv-s5',
          suggestedPriority: 'medium',
          currentPriority: 'medium',
          confidence: 75,
          factors: [],
          explanation: 'Recommendation',
          isManualOverride: false,
        });
        setPriorityRecommendation('inv-s6', {
          storyId: 'inv-s6',
          suggestedPriority: 'high',
          currentPriority: 'medium',
          confidence: 80,
          factors: [],
          explanation: 'Recommendation',
          isManualOverride: false,
        });

        // Update story E to depend on story F via PATCH
        await app.request('/prd-inv-3/stories/inv-s5', {
          method: 'PATCH',
          body: JSON.stringify({ dependsOn: ['inv-s6'] }),
          headers: { 'Content-Type': 'application/json' },
        });

        // Both recommendations should be invalidated
        const s5Row = testDb
          .query('SELECT priority_recommendation FROM prd_stories WHERE id = ?')
          .get('inv-s5') as any;
        const s6Row = testDb
          .query('SELECT priority_recommendation FROM prd_stories WHERE id = ?')
          .get('inv-s6') as any;
        expect(s5Row.priority_recommendation).toBeNull();
        expect(s6Row.priority_recommendation).toBeNull();
      });

      test('changing priority via PATCH invalidates related stories recommendations', async () => {
        insertPrd({ id: 'prd-inv-4' });
        insertStory({
          id: 'inv-s7',
          prd_id: 'prd-inv-4',
          title: 'Story G',
          priority: 'medium',
          depends_on: JSON.stringify(['inv-s8']),
          sort_order: 0,
        });
        insertStory({
          id: 'inv-s8',
          prd_id: 'prd-inv-4',
          title: 'Story H',
          priority: 'medium',
          sort_order: 1,
        });

        setPriorityRecommendation('inv-s7', {
          storyId: 'inv-s7',
          suggestedPriority: 'high',
          currentPriority: 'medium',
          confidence: 80,
          factors: [],
          explanation: 'Recommendation',
          isManualOverride: false,
        });
        setPriorityRecommendation('inv-s8', {
          storyId: 'inv-s8',
          suggestedPriority: 'high',
          currentPriority: 'medium',
          confidence: 80,
          factors: [],
          explanation: 'Recommendation',
          isManualOverride: false,
        });

        // Change story H's priority — story G depends on H, so G's recommendation should be invalidated
        await app.request('/prd-inv-4/stories/inv-s8', {
          method: 'PATCH',
          body: JSON.stringify({ priority: 'critical' }),
          headers: { 'Content-Type': 'application/json' },
        });

        // Story G's recommendation should be invalidated (it depends on H)
        const s7Row = testDb
          .query('SELECT priority_recommendation FROM prd_stories WHERE id = ?')
          .get('inv-s7') as any;
        expect(s7Row.priority_recommendation).toBeNull();

        // Story H's own recommendation should remain (only related stories are invalidated, not the story itself)
        const s8Row = testDb
          .query('SELECT priority_recommendation FROM prd_stories WHERE id = ?')
          .get('inv-s8') as any;
        expect(s8Row.priority_recommendation).toBeTruthy();
      });

      test('changing priority via PATCH invalidates blocked-by stories recommendations', async () => {
        insertPrd({ id: 'prd-inv-5' });
        insertStory({
          id: 'inv-s9',
          prd_id: 'prd-inv-5',
          title: 'Story I',
          priority: 'high',
          sort_order: 0,
        });
        insertStory({
          id: 'inv-s10',
          prd_id: 'prd-inv-5',
          title: 'Story J',
          priority: 'medium',
          depends_on: JSON.stringify(['inv-s9']),
          sort_order: 1,
        });

        setPriorityRecommendation('inv-s9', {
          storyId: 'inv-s9',
          suggestedPriority: 'high',
          currentPriority: 'high',
          confidence: 90,
          factors: [],
          explanation: 'Recommendation',
          isManualOverride: false,
        });
        setPriorityRecommendation('inv-s10', {
          storyId: 'inv-s10',
          suggestedPriority: 'medium',
          currentPriority: 'medium',
          confidence: 75,
          factors: [],
          explanation: 'Recommendation',
          isManualOverride: false,
        });

        // Change story I's priority — story J depends on I (i.e. J is blocked by I)
        await app.request('/prd-inv-5/stories/inv-s9', {
          method: 'PATCH',
          body: JSON.stringify({ priority: 'low' }),
          headers: { 'Content-Type': 'application/json' },
        });

        // Story J's recommendation should be invalidated (it's blocked by I whose priority changed)
        const s10Row = testDb
          .query('SELECT priority_recommendation FROM prd_stories WHERE id = ?')
          .get('inv-s10') as any;
        expect(s10Row.priority_recommendation).toBeNull();
      });
    });

    // -- Generated stories get priorities --

    describe('Generated stories receive priorities', () => {
      test(
        'AI-generated stories include priority assignments',
        withApiKey(async () => {
          insertPrd({ id: 'prd-gen-pri', description: 'Project management tool' });

          const mockStories = [
            {
              title: 'Authentication System',
              description: 'User login and registration',
              acceptanceCriteria: ['Users can register', 'Users can login', 'Password reset works'],
              priority: 'critical',
            },
            {
              title: 'Dashboard View',
              description: 'Main dashboard with overview',
              acceptanceCriteria: [
                'Shows project stats',
                'Lists recent activity',
                'Navigation works',
              ],
              priority: 'high',
            },
            {
              title: 'Dark Mode',
              description: 'Theme toggle for dark mode',
              acceptanceCriteria: [
                'Toggle available',
                'All pages support dark theme',
                'Preference persisted',
              ],
              priority: 'low',
            },
          ];

          mockCallLlmResponse = JSON.stringify(mockStories);

          const res = await app.request('/prd-gen-pri/generate', {
            method: 'POST',
            body: JSON.stringify({ description: 'Build a project management tool' }),
            headers: { 'Content-Type': 'application/json' },
          });

          expect(res.status).toBe(200);
          const json = await res.json();
          expect(json.ok).toBe(true);

          // Each generated story should have a priority
          expect(json.data.stories[0].priority).toBe('critical');
          expect(json.data.stories[1].priority).toBe('high');
          expect(json.data.stories[2].priority).toBe('low');
        }),
      );

      test(
        'generated stories with invalid priority default to medium',
        withApiKey(async () => {
          insertPrd({ id: 'prd-gen-pri2', description: 'Test' });

          const mockStories = [
            {
              title: 'Story',
              description: 'Desc',
              acceptanceCriteria: ['AC1', 'AC2', 'AC3'],
              priority: 'super-important', // invalid
            },
          ];

          mockCallLlmResponse = JSON.stringify(mockStories);

          const res = await app.request('/prd-gen-pri2/generate', {
            method: 'POST',
            body: JSON.stringify({ description: 'Test' }),
            headers: { 'Content-Type': 'application/json' },
          });

          const json = await res.json();
          expect(json.data.stories[0].priority).toBe('medium');
        }),
      );
    });
  });

  // ---------------------------------------------------------------
  // GET /stories — List standalone stories
  // ---------------------------------------------------------------
  describe('GET /stories — list standalone stories', () => {
    test('returns 400 when workspacePath is missing', async () => {
      const res = await app.request('/stories');
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('workspacePath');
    });

    test('returns empty array when no standalone stories exist', async () => {
      const res = await app.request('/stories?workspacePath=/test/project');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data).toEqual([]);
    });

    test('returns only standalone stories for workspace (prd_id IS NULL)', async () => {
      // Insert a standalone story (prd_id = null)
      insertStory({
        id: 'standalone-1',
        prd_id: null,
        workspace_path: '/test/project',
        title: 'Standalone Story',
      });
      // Insert a PRD-bound story — should NOT appear
      insertPrd({ id: 'prd-1', workspace_path: '/test/project' });
      insertStory({ id: 'prd-story-1', prd_id: 'prd-1', title: 'PRD Story' });

      const res = await app.request('/stories?workspacePath=/test/project');
      const json = await res.json();
      expect(json.data).toHaveLength(1);
      expect(json.data[0].id).toBe('standalone-1');
      expect(json.data[0].title).toBe('Standalone Story');
      expect(json.data[0].prdId).toBeNull();
    });

    test('filters by workspace path', async () => {
      insertStory({
        id: 'story-ws-a',
        prd_id: null,
        workspace_path: '/project-a',
        title: 'A Story',
      });
      insertStory({
        id: 'story-ws-b',
        prd_id: null,
        workspace_path: '/project-b',
        title: 'B Story',
      });

      const res = await app.request('/stories?workspacePath=/project-a');
      const json = await res.json();
      expect(json.data).toHaveLength(1);
      expect(json.data[0].id).toBe('story-ws-a');
    });

    test('orders by sort_order ASC then created_at ASC', async () => {
      insertStory({
        id: 'story-second',
        prd_id: null,
        workspace_path: '/test/project',
        title: 'Second',
        sort_order: 1,
        created_at: 100,
      });
      insertStory({
        id: 'story-first',
        prd_id: null,
        workspace_path: '/test/project',
        title: 'First',
        sort_order: 0,
        created_at: 200,
      });

      const res = await app.request('/stories?workspacePath=/test/project');
      const json = await res.json();
      expect(json.data[0].title).toBe('First');
      expect(json.data[1].title).toBe('Second');
    });
  });

  // ---------------------------------------------------------------
  // GET /stories/all — List all stories for workspace
  // ---------------------------------------------------------------
  describe('GET /stories/all — list all stories for workspace', () => {
    test('returns 400 when workspacePath is missing', async () => {
      const res = await app.request('/stories/all');
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('workspacePath');
    });

    test('returns standalone and PRD-bound stories separately', async () => {
      insertPrd({ id: 'prd-1', workspace_path: '/test/project', name: 'My PRD' });
      insertStory({
        id: 'standalone-1',
        prd_id: null,
        workspace_path: '/test/project',
        title: 'Standalone',
      });
      insertStory({
        id: 'prd-story-1',
        prd_id: 'prd-1',
        title: 'PRD Bound',
      });

      const res = await app.request('/stories/all?workspacePath=/test/project');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.standalone).toHaveLength(1);
      expect(json.data.standalone[0].title).toBe('Standalone');
      expect(json.data.byPrd).toHaveLength(1);
      expect(json.data.byPrd[0].title).toBe('PRD Bound');
      expect(json.data.byPrd[0].prdName).toBe('My PRD');
    });

    test('returns empty arrays when no stories exist', async () => {
      const res = await app.request('/stories/all?workspacePath=/empty/project');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.standalone).toEqual([]);
      expect(json.data.byPrd).toEqual([]);
    });
  });

  // ---------------------------------------------------------------
  // POST /stories — Create standalone story
  // ---------------------------------------------------------------
  describe('POST /stories — create standalone story', () => {
    test('creates a standalone story with all fields', async () => {
      const res = await app.request('/stories', {
        method: 'POST',
        body: JSON.stringify({
          workspacePath: '/test/project',
          title: 'New Standalone Story',
          description: 'A standalone story description',
          acceptanceCriteria: ['AC 1', 'AC 2'],
          priority: 'high',
          dependsOn: ['dep-1'],
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.id).toBeDefined();
      expect(json.data.title).toBe('New Standalone Story');
      expect(json.data.description).toBe('A standalone story description');
      expect(json.data.priority).toBe('high');
      expect(json.data.prdId).toBeNull();
      expect(json.data.workspacePath).toBe('/test/project');
      expect(json.data.acceptanceCriteria).toHaveLength(2);
      expect(json.data.acceptanceCriteria[0].description).toBe('AC 1');
      expect(json.data.acceptanceCriteria[0].passed).toBe(false);
      expect(json.data.acceptanceCriteria[0].id).toBeDefined();
      expect(json.data.dependsOn).toEqual(['dep-1']);
    });

    test('returns 400 when workspacePath is missing', async () => {
      const res = await app.request('/stories', {
        method: 'POST',
        body: JSON.stringify({
          title: 'No Workspace',
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
    });

    test('returns 400 when title is missing', async () => {
      const res = await app.request('/stories', {
        method: 'POST',
        body: JSON.stringify({
          workspacePath: '/test/project',
          title: '',
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(400);
    });

    test('defaults priority to medium and empty arrays', async () => {
      const res = await app.request('/stories', {
        method: 'POST',
        body: JSON.stringify({
          workspacePath: '/test/project',
          title: 'Minimal Story',
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.data.priority).toBe('medium');
      expect(json.data.acceptanceCriteria).toEqual([]);
      expect(json.data.dependsOn).toEqual([]);
      expect(json.data.status).toBe('pending');
    });
  });

  // ---------------------------------------------------------------
  // PATCH /stories/:storyId — Update standalone story
  // ---------------------------------------------------------------
  describe('PATCH /stories/:storyId — update standalone story', () => {
    test('returns 404 for non-existent standalone story', async () => {
      const res = await app.request('/stories/nonexistent', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Updated' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('Standalone story not found');
    });

    test('returns 404 for PRD-bound story (not standalone)', async () => {
      insertPrd({ id: 'prd-1' });
      insertStory({ id: 'prd-story', prd_id: 'prd-1' });

      const res = await app.request('/stories/prd-story', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Updated' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(404);
    });

    test('updates title, description, and priority', async () => {
      insertStory({
        id: 'standalone-1',
        prd_id: null,
        workspace_path: '/test/project',
        title: 'Original',
        description: 'Original desc',
        priority: 'low',
      });

      const res = await app.request('/stories/standalone-1', {
        method: 'PATCH',
        body: JSON.stringify({
          title: 'Updated Title',
          description: 'Updated desc',
          priority: 'critical',
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.title).toBe('Updated Title');
      expect(json.data.description).toBe('Updated desc');
      expect(json.data.priority).toBe('critical');
    });

    test('updates status and sortOrder', async () => {
      insertStory({
        id: 'standalone-1',
        prd_id: null,
        workspace_path: '/test/project',
        status: 'pending',
        sort_order: 0,
      });

      const res = await app.request('/stories/standalone-1', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'in_progress', sortOrder: 5 }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.data.status).toBe('in_progress');
      expect(json.data.sortOrder).toBe(5);
    });

    test('updates acceptanceCriteria (string array converted to objects)', async () => {
      insertStory({
        id: 'standalone-1',
        prd_id: null,
        workspace_path: '/test/project',
      });

      const res = await app.request('/stories/standalone-1', {
        method: 'PATCH',
        body: JSON.stringify({
          acceptanceCriteria: ['New AC 1', 'New AC 2'],
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.data.acceptanceCriteria).toHaveLength(2);
      expect(json.data.acceptanceCriteria[0].description).toBe('New AC 1');
      expect(json.data.acceptanceCriteria[0].passed).toBe(false);
      expect(json.data.acceptanceCriteria[0].id).toBeDefined();
    });

    test('updates dependsOn and dependencyReasons', async () => {
      insertStory({
        id: 'standalone-1',
        prd_id: null,
        workspace_path: '/test/project',
      });

      const res = await app.request('/stories/standalone-1', {
        method: 'PATCH',
        body: JSON.stringify({
          dependsOn: ['story-a', 'story-b'],
          dependencyReasons: { 'story-a': 'Needs auth first' },
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.data.dependsOn).toEqual(['story-a', 'story-b']);
      expect(json.data.dependencyReasons).toEqual({ 'story-a': 'Needs auth first' });
    });

    test('updates externalRef', async () => {
      insertStory({
        id: 'standalone-1',
        prd_id: null,
        workspace_path: '/test/project',
      });

      const res = await app.request('/stories/standalone-1', {
        method: 'PATCH',
        body: JSON.stringify({
          externalRef: { provider: 'github', id: '123', url: 'https://github.com/issue/123' },
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.data.externalRef).toEqual({
        provider: 'github',
        id: '123',
        url: 'https://github.com/issue/123',
      });
    });

    test('returns existing data when no fields to update', async () => {
      insertStory({
        id: 'standalone-1',
        prd_id: null,
        workspace_path: '/test/project',
        title: 'Original',
      });

      const res = await app.request('/stories/standalone-1', {
        method: 'PATCH',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.title).toBe('Original');
    });

    test('updates updated_at timestamp', async () => {
      insertStory({
        id: 'standalone-1',
        prd_id: null,
        workspace_path: '/test/project',
        updated_at: 1000,
      });

      await app.request('/stories/standalone-1', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Touched' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const row = testDb
        .query('SELECT updated_at FROM prd_stories WHERE id = ?')
        .get('standalone-1') as any;
      expect(row.updated_at).toBeGreaterThan(1000);
    });

    test('updates researchOnly flag for standalone story', async () => {
      insertStory({
        id: 'standalone-1',
        prd_id: null,
        workspace_path: '/test/project',
        research_only: 0,
      });

      const res = await app.request('/stories/standalone-1', {
        method: 'PATCH',
        body: JSON.stringify({ researchOnly: true }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.researchOnly).toBe(true);

      // Verify in DB
      const row = testDb
        .query('SELECT research_only FROM prd_stories WHERE id = ?')
        .get('standalone-1') as any;
      expect(row.research_only).toBe(1);
    });
  });

  // ---------------------------------------------------------------
  // DELETE /stories/:storyId — Delete standalone story
  // ---------------------------------------------------------------
  describe('DELETE /stories/:storyId — delete standalone story', () => {
    test('deletes a standalone story', async () => {
      insertStory({
        id: 'standalone-1',
        prd_id: null,
        workspace_path: '/test/project',
      });

      const res = await app.request('/stories/standalone-1', { method: 'DELETE' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);

      const row = testDb.query('SELECT * FROM prd_stories WHERE id = ?').get('standalone-1');
      expect(row).toBeNull();
    });

    test('returns 404 for non-existent standalone story', async () => {
      const res = await app.request('/stories/nonexistent', { method: 'DELETE' });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('Standalone story not found');
    });

    test('returns 404 for PRD-bound story (not standalone)', async () => {
      insertPrd({ id: 'prd-1' });
      insertStory({ id: 'prd-story', prd_id: 'prd-1' });

      const res = await app.request('/stories/prd-story', { method: 'DELETE' });
      expect(res.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------
  // PUT /stories/:storyId/estimate — Save manual estimate for standalone story
  // ---------------------------------------------------------------
  describe('PUT /stories/:storyId/estimate — manual estimate for standalone story', () => {
    test('saves a manual estimate', async () => {
      insertStory({
        id: 'standalone-1',
        prd_id: null,
        workspace_path: '/test/project',
      });

      const res = await app.request('/stories/standalone-1/estimate', {
        method: 'PUT',
        body: JSON.stringify({
          size: 'large',
          storyPoints: 8,
          reasoning: 'Complex integration work',
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.storyId).toBe('standalone-1');
      expect(json.data.estimate.size).toBe('large');
      expect(json.data.estimate.storyPoints).toBe(8);
      expect(json.data.estimate.confidence).toBe('high');
      expect(json.data.estimate.confidenceScore).toBe(100);
      expect(json.data.estimate.isManualOverride).toBe(true);
      expect(json.data.estimate.reasoning).toBe('Complex integration work');
    });

    test('returns 404 for non-existent standalone story', async () => {
      const res = await app.request('/stories/nonexistent/estimate', {
        method: 'PUT',
        body: JSON.stringify({ size: 'small', storyPoints: 1 }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(404);
    });

    test('returns 404 for PRD-bound story', async () => {
      insertPrd({ id: 'prd-1' });
      insertStory({ id: 'prd-story', prd_id: 'prd-1' });

      const res = await app.request('/stories/prd-story/estimate', {
        method: 'PUT',
        body: JSON.stringify({ size: 'small', storyPoints: 1 }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(404);
    });

    test('preserves existing estimate fields and overrides with manual values', async () => {
      const existingEstimate = {
        storyId: 'standalone-1',
        size: 'small',
        storyPoints: 2,
        confidence: 'medium',
        confidenceScore: 60,
        factors: [{ factor: 'simple', impact: 'decreases', weight: 'minor' }],
        reasoning: 'AI estimate',
        isManualOverride: false,
      };
      insertStory({
        id: 'standalone-1',
        prd_id: null,
        workspace_path: '/test/project',
        estimate: JSON.stringify(existingEstimate),
      });

      const res = await app.request('/stories/standalone-1/estimate', {
        method: 'PUT',
        body: JSON.stringify({
          size: 'large',
          storyPoints: 13,
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.data.estimate.size).toBe('large');
      expect(json.data.estimate.storyPoints).toBe(13);
      expect(json.data.estimate.isManualOverride).toBe(true);
      expect(json.data.estimate.confidence).toBe('high');
      expect(json.data.estimate.confidenceScore).toBe(100);
      // Original factors should be preserved
      expect(json.data.estimate.factors).toEqual(existingEstimate.factors);
    });

    test('defaults size and storyPoints when not provided', async () => {
      insertStory({
        id: 'standalone-1',
        prd_id: null,
        workspace_path: '/test/project',
      });

      const res = await app.request('/stories/standalone-1/estimate', {
        method: 'PUT',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.data.estimate.size).toBe('medium');
      expect(json.data.estimate.storyPoints).toBe(3);
      expect(json.data.estimate.reasoning).toBe('Manual estimate');
    });

    test('updates the story updated_at in database', async () => {
      insertStory({
        id: 'standalone-1',
        prd_id: null,
        workspace_path: '/test/project',
        updated_at: 1000,
      });

      await app.request('/stories/standalone-1/estimate', {
        method: 'PUT',
        body: JSON.stringify({ size: 'small', storyPoints: 1 }),
        headers: { 'Content-Type': 'application/json' },
      });

      const row = testDb
        .query('SELECT updated_at FROM prd_stories WHERE id = ?')
        .get('standalone-1') as any;
      expect(row.updated_at).toBeGreaterThan(1000);
    });
  });

  // ---------------------------------------------------------------
  // POST /stories/:storyId/estimate — AI estimate for standalone story
  // ---------------------------------------------------------------
  describe('POST /stories/:storyId/estimate — AI estimate for standalone story', () => {
    test('returns 404 for non-existent standalone story', async () => {
      const res = await app.request('/stories/nonexistent/estimate', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(404);
    });

    test('returns 404 for PRD-bound story', async () => {
      insertPrd({ id: 'prd-1' });
      insertStory({ id: 'prd-story', prd_id: 'prd-1' });

      const res = await app.request('/stories/prd-story/estimate', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(404);
    });

    test('calls AI API and saves estimate', async () => {
      insertStory({
        id: 'standalone-1',
        prd_id: null,
        workspace_path: '/test/project',
        title: 'Build auth system',
        description: 'Implement OAuth login',
      });

      const mockEstimate = {
        size: 'medium',
        storyPoints: 5,
        confidence: 'high',
        confidenceScore: 85,
        factors: [{ factor: 'OAuth complexity', impact: 'increases', weight: 'moderate' }],
        reasoning: 'OAuth integration is moderately complex',
      };

      mockCallLlmResponse = JSON.stringify(mockEstimate);

      const res = await app.request('/stories/standalone-1/estimate', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.storyId).toBe('standalone-1');
      expect(json.data.estimate.size).toBe('medium');
      expect(json.data.estimate.storyPoints).toBe(5);
      expect(json.data.estimate.confidence).toBe('high');
      expect(json.data.estimate.isManualOverride).toBe(false);

      // Verify DB was updated
      const row = testDb
        .query('SELECT estimate FROM prd_stories WHERE id = ?')
        .get('standalone-1') as any;
      const saved = JSON.parse(row.estimate);
      expect(saved.storyPoints).toBe(5);
    });

    test('handles AI API error gracefully', async () => {
      insertStory({
        id: 'standalone-1',
        prd_id: null,
        workspace_path: '/test/project',
        title: 'Test Story',
      });

      mockCallLlmResponse = new Error('LLM call failed (500)');

      const res = await app.request('/stories/standalone-1/estimate', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('Estimation failed');
    });
  });

  // ---------------------------------------------------------------
  // POST /stories/reorder — Reorder standalone stories
  // ---------------------------------------------------------------
  describe('POST /stories/reorder — reorder standalone stories', () => {
    test('reorders stories by updating sort_order', async () => {
      insertStory({
        id: 'sa-1',
        prd_id: null,
        workspace_path: '/test/project',
        title: 'Story A',
        sort_order: 0,
      });
      insertStory({
        id: 'sa-2',
        prd_id: null,
        workspace_path: '/test/project',
        title: 'Story B',
        sort_order: 1,
      });
      insertStory({
        id: 'sa-3',
        prd_id: null,
        workspace_path: '/test/project',
        title: 'Story C',
        sort_order: 2,
      });

      const res = await app.request('/stories/reorder', {
        method: 'POST',
        body: JSON.stringify({ storyIds: ['sa-3', 'sa-1', 'sa-2'] }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);

      // Verify sort_order in DB
      const s3 = testDb.query('SELECT sort_order FROM prd_stories WHERE id = ?').get('sa-3') as any;
      const s1 = testDb.query('SELECT sort_order FROM prd_stories WHERE id = ?').get('sa-1') as any;
      const s2 = testDb.query('SELECT sort_order FROM prd_stories WHERE id = ?').get('sa-2') as any;
      expect(s3.sort_order).toBe(0);
      expect(s1.sort_order).toBe(1);
      expect(s2.sort_order).toBe(2);
    });

    test('returns 400 when storyIds is missing or empty', async () => {
      const res = await app.request('/stories/reorder', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('storyIds');
    });

    test('returns 400 when reorder violates dependency constraints', async () => {
      insertStory({
        id: 'dep-a',
        prd_id: null,
        workspace_path: '/test/project',
        title: 'A',
        sort_order: 0,
      });
      insertStory({
        id: 'dep-b',
        prd_id: null,
        workspace_path: '/test/project',
        title: 'B',
        sort_order: 1,
        depends_on: JSON.stringify(['dep-a']),
      });

      // Try to put B before A — violates dependency
      const res = await app.request('/stories/reorder', {
        method: 'POST',
        body: JSON.stringify({ storyIds: ['dep-b', 'dep-a'] }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('dependency constraints');
    });
  });

  // ---------------------------------------------------------------
  // POST /stories/archive-completed — Archive completed standalone stories
  // ---------------------------------------------------------------
  describe('POST /stories/archive-completed — archive completed standalone stories', () => {
    test('archives completed standalone stories', async () => {
      insertStory({
        id: 'arch-1',
        prd_id: null,
        workspace_path: '/test/project',
        status: 'completed',
      });
      insertStory({
        id: 'arch-2',
        prd_id: null,
        workspace_path: '/test/project',
        status: 'pending',
      });
      insertStory({
        id: 'arch-3',
        prd_id: null,
        workspace_path: '/test/project',
        status: 'completed',
      });

      const res = await app.request('/stories/archive-completed', {
        method: 'POST',
        body: JSON.stringify({ workspacePath: '/test/project' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.archived).toBe(2);

      // Verify status changes in DB
      const s1 = testDb.query('SELECT status FROM prd_stories WHERE id = ?').get('arch-1') as any;
      const s2 = testDb.query('SELECT status FROM prd_stories WHERE id = ?').get('arch-2') as any;
      expect(s1.status).toBe('archived');
      expect(s2.status).toBe('pending');
    });

    test('returns 400 when workspacePath is missing', async () => {
      const res = await app.request('/stories/archive-completed', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('workspacePath');
    });

    test('returns zero when no completed stories exist', async () => {
      insertStory({
        id: 'narch-1',
        prd_id: null,
        workspace_path: '/test/project',
        status: 'pending',
      });

      const res = await app.request('/stories/archive-completed', {
        method: 'POST',
        body: JSON.stringify({ workspacePath: '/test/project' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.archived).toBe(0);
    });
  });

  // ---------------------------------------------------------------
  // POST /:prdId/stories/archive-completed — Archive completed PRD stories
  // ---------------------------------------------------------------
  describe('POST /:prdId/stories/archive-completed — archive completed PRD stories', () => {
    test('archives completed stories in a PRD', async () => {
      insertPrd({ id: 'prd-arch' });
      insertStory({ id: 'prd-arch-1', prd_id: 'prd-arch', status: 'completed' });
      insertStory({ id: 'prd-arch-2', prd_id: 'prd-arch', status: 'pending' });
      insertStory({ id: 'prd-arch-3', prd_id: 'prd-arch', status: 'completed' });

      const res = await app.request('/prd-arch/stories/archive-completed', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.archived).toBe(2);

      const s1 = testDb
        .query('SELECT status FROM prd_stories WHERE id = ?')
        .get('prd-arch-1') as any;
      expect(s1.status).toBe('archived');
    });

    test('touches PRD updated_at', async () => {
      insertPrd({ id: 'prd-arch-t', updated_at: 1000 });
      insertStory({ id: 'prd-arch-t1', prd_id: 'prd-arch-t', status: 'completed' });

      await app.request('/prd-arch-t/stories/archive-completed', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });

      const row = testDb.query('SELECT updated_at FROM prds WHERE id = ?').get('prd-arch-t') as any;
      expect(row.updated_at).toBeGreaterThan(1000);
    });
  });

  // ---------------------------------------------------------------
  // GET /:id/dependencies — Get dependency graph
  // ---------------------------------------------------------------
  describe('GET /:id/dependencies — get dependency graph', () => {
    test('returns dependency graph for PRD', async () => {
      insertPrd({ id: 'prd-dep' });
      insertStory({
        id: 'dep-s1',
        prd_id: 'prd-dep',
        title: 'Foundation',
        sort_order: 0,
      });
      insertStory({
        id: 'dep-s2',
        prd_id: 'prd-dep',
        title: 'Feature',
        depends_on: JSON.stringify(['dep-s1']),
        sort_order: 1,
      });

      const res = await app.request('/prd-dep/dependencies');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.nodes).toHaveLength(2);
      expect(json.data.edges).toHaveLength(1);
      expect(json.data.edges[0].from).toBe('dep-s1');
      expect(json.data.edges[0].to).toBe('dep-s2');
    });

    test('returns 404 for non-existent PRD', async () => {
      const res = await app.request('/nonexistent/dependencies');
      expect(res.status).toBe(404);
    });

    test('returns empty graph for PRD with no dependencies', async () => {
      insertPrd({ id: 'prd-nodep' });
      insertStory({ id: 'nodep-1', prd_id: 'prd-nodep', title: 'A', sort_order: 0 });
      insertStory({ id: 'nodep-2', prd_id: 'prd-nodep', title: 'B', sort_order: 1 });

      const res = await app.request('/prd-nodep/dependencies');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.nodes).toHaveLength(2);
      expect(json.data.edges).toHaveLength(0);
    });

    test('detects circular dependency warning in graph', async () => {
      insertPrd({ id: 'prd-circg' });
      insertStory({
        id: 'circg-s1',
        prd_id: 'prd-circg',
        title: 'Alpha',
        depends_on: JSON.stringify(['circg-s2']),
        sort_order: 0,
      });
      insertStory({
        id: 'circg-s2',
        prd_id: 'prd-circg',
        title: 'Beta',
        depends_on: JSON.stringify(['circg-s1']),
        sort_order: 1,
      });

      const res = await app.request('/prd-circg/dependencies');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.warnings.length).toBeGreaterThanOrEqual(1);
      const circularWarning = json.data.warnings.find((w: any) => w.type === 'circular');
      expect(circularWarning).toBeDefined();
      expect(circularWarning.storyIds.length).toBeGreaterThanOrEqual(2);
    });

    test('detects orphan dependency warning in graph', async () => {
      insertPrd({ id: 'prd-orphg' });
      insertStory({
        id: 'orphg-s1',
        prd_id: 'prd-orphg',
        title: 'Orphan Dep',
        depends_on: JSON.stringify(['nonexistent-id']),
        sort_order: 0,
      });

      const res = await app.request('/prd-orphg/dependencies');
      const json = await res.json();
      expect(json.ok).toBe(true);
      const orphanWarning = json.data.warnings.find((w: any) => w.type === 'orphan_dependency');
      expect(orphanWarning).toBeDefined();
      expect(orphanWarning.message).toContain('non-existent');
    });

    test('detects unresolved blocker warning for in-progress story', async () => {
      insertPrd({ id: 'prd-ublk' });
      insertStory({
        id: 'ublk-s1',
        prd_id: 'prd-ublk',
        title: 'Blocker',
        status: 'pending',
        sort_order: 0,
      });
      insertStory({
        id: 'ublk-s2',
        prd_id: 'prd-ublk',
        title: 'Blocked Work',
        status: 'in_progress',
        depends_on: JSON.stringify(['ublk-s1']),
        sort_order: 1,
      });

      const res = await app.request('/prd-ublk/dependencies');
      const json = await res.json();
      expect(json.ok).toBe(true);
      const blockerWarning = json.data.warnings.find((w: any) => w.type === 'unresolved_blocker');
      expect(blockerWarning).toBeDefined();
      expect(blockerWarning.message).toContain('Blocked Work');
      expect(blockerWarning.storyIds).toContain('ublk-s2');
      expect(blockerWarning.storyIds).toContain('ublk-s1');
    });

    test('includes depth and blocking info in nodes', async () => {
      insertPrd({ id: 'prd-depth' });
      insertStory({
        id: 'depth-s1',
        prd_id: 'prd-depth',
        title: 'Root',
        status: 'completed',
        sort_order: 0,
      });
      insertStory({
        id: 'depth-s2',
        prd_id: 'prd-depth',
        title: 'Level 1',
        depends_on: JSON.stringify(['depth-s1']),
        sort_order: 1,
      });
      insertStory({
        id: 'depth-s3',
        prd_id: 'prd-depth',
        title: 'Level 2',
        depends_on: JSON.stringify(['depth-s2']),
        sort_order: 2,
      });

      const res = await app.request('/prd-depth/dependencies');
      const json = await res.json();
      expect(json.ok).toBe(true);

      const rootNode = json.data.nodes.find((n: any) => n.storyId === 'depth-s1');
      expect(rootNode.depth).toBe(0);
      expect(rootNode.blocksCount).toBe(1);

      const level1 = json.data.nodes.find((n: any) => n.storyId === 'depth-s2');
      expect(level1.depth).toBe(1);
      expect(level1.blockedByCount).toBe(1);
      expect(level1.isReady).toBe(true); // depth-s1 is completed

      const level2 = json.data.nodes.find((n: any) => n.storyId === 'depth-s3');
      expect(level2.depth).toBe(2);
      expect(level2.isReady).toBe(false); // depth-s2 is not completed
    });
  });

  // ---------------------------------------------------------------
  // POST /:id/dependencies — Add dependency
  // ---------------------------------------------------------------
  describe('POST /:id/dependencies — add dependency', () => {
    test('adds a dependency between two stories', async () => {
      insertPrd({ id: 'prd-adep' });
      insertStory({ id: 'adep-s1', prd_id: 'prd-adep', title: 'First', sort_order: 0 });
      insertStory({ id: 'adep-s2', prd_id: 'prd-adep', title: 'Second', sort_order: 1 });

      const res = await app.request('/prd-adep/dependencies', {
        method: 'POST',
        body: JSON.stringify({
          fromStoryId: 'adep-s2',
          toStoryId: 'adep-s1',
          reason: 'Needs foundation first',
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.edges).toHaveLength(1);

      // Verify in DB
      const row = testDb
        .query('SELECT depends_on, dependency_reasons FROM prd_stories WHERE id = ?')
        .get('adep-s2') as any;
      expect(JSON.parse(row.depends_on)).toContain('adep-s1');
      expect(JSON.parse(row.dependency_reasons)['adep-s1']).toBe('Needs foundation first');
    });

    test('returns 404 for non-existent PRD', async () => {
      const res = await app.request('/nonexistent/dependencies', {
        method: 'POST',
        body: JSON.stringify({ fromStoryId: 'a', toStoryId: 'b' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(404);
    });

    test('returns 400 when fromStoryId or toStoryId is missing', async () => {
      insertPrd({ id: 'prd-adep2' });
      const res = await app.request('/prd-adep2/dependencies', {
        method: 'POST',
        body: JSON.stringify({ fromStoryId: 'a' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
    });

    test('returns 400 for self-dependency', async () => {
      insertPrd({ id: 'prd-self' });
      insertStory({ id: 'self-s1', prd_id: 'prd-self', title: 'Self' });

      const res = await app.request('/prd-self/dependencies', {
        method: 'POST',
        body: JSON.stringify({ fromStoryId: 'self-s1', toStoryId: 'self-s1' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('itself');
    });

    test('returns 404 when story does not belong to PRD', async () => {
      insertPrd({ id: 'prd-wrong' });
      insertStory({ id: 'wrong-s1', prd_id: 'prd-wrong', title: 'Right' });

      const res = await app.request('/prd-wrong/dependencies', {
        method: 'POST',
        body: JSON.stringify({ fromStoryId: 'wrong-s1', toStoryId: 'nonexistent-story' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------
  // DELETE /:id/dependencies — Remove dependency
  // ---------------------------------------------------------------
  describe('DELETE /:id/dependencies — remove dependency', () => {
    test('removes a dependency between two stories', async () => {
      insertPrd({ id: 'prd-rdep' });
      insertStory({ id: 'rdep-s1', prd_id: 'prd-rdep', title: 'First', sort_order: 0 });
      insertStory({
        id: 'rdep-s2',
        prd_id: 'prd-rdep',
        title: 'Second',
        depends_on: JSON.stringify(['rdep-s1']),
        dependency_reasons: JSON.stringify({ 'rdep-s1': 'Foundation needed' }),
        sort_order: 1,
      });

      const res = await app.request('/prd-rdep/dependencies', {
        method: 'DELETE',
        body: JSON.stringify({ fromStoryId: 'rdep-s2', toStoryId: 'rdep-s1' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.edges).toHaveLength(0);

      // Verify in DB
      const row = testDb
        .query('SELECT depends_on, dependency_reasons FROM prd_stories WHERE id = ?')
        .get('rdep-s2') as any;
      expect(JSON.parse(row.depends_on)).toEqual([]);
      expect(JSON.parse(row.dependency_reasons)).toEqual({});
    });

    test('returns 404 for non-existent PRD', async () => {
      const res = await app.request('/nonexistent/dependencies', {
        method: 'DELETE',
        body: JSON.stringify({ fromStoryId: 'a', toStoryId: 'b' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(404);
    });

    test('returns 400 when required fields are missing', async () => {
      insertPrd({ id: 'prd-rdep2' });
      const res = await app.request('/prd-rdep2/dependencies', {
        method: 'DELETE',
        body: JSON.stringify({ fromStoryId: 'a' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
    });
  });

  // ---------------------------------------------------------------
  // PATCH /:id/dependencies — Edit dependency reason
  // ---------------------------------------------------------------
  describe('PATCH /:id/dependencies — edit dependency reason', () => {
    test('updates dependency reason', async () => {
      insertPrd({ id: 'prd-edep' });
      insertStory({ id: 'edep-s1', prd_id: 'prd-edep', title: 'First', sort_order: 0 });
      insertStory({
        id: 'edep-s2',
        prd_id: 'prd-edep',
        title: 'Second',
        depends_on: JSON.stringify(['edep-s1']),
        dependency_reasons: JSON.stringify({ 'edep-s1': 'Old reason' }),
        sort_order: 1,
      });

      const res = await app.request('/prd-edep/dependencies', {
        method: 'PATCH',
        body: JSON.stringify({
          fromStoryId: 'edep-s2',
          toStoryId: 'edep-s1',
          reason: 'Updated reason',
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);

      // Verify in DB
      const row = testDb
        .query('SELECT dependency_reasons FROM prd_stories WHERE id = ?')
        .get('edep-s2') as any;
      expect(JSON.parse(row.dependency_reasons)['edep-s1']).toBe('Updated reason');
    });

    test('removes reason when set to empty string', async () => {
      insertPrd({ id: 'prd-edep2' });
      insertStory({ id: 'edep2-s1', prd_id: 'prd-edep2', title: 'First', sort_order: 0 });
      insertStory({
        id: 'edep2-s2',
        prd_id: 'prd-edep2',
        title: 'Second',
        depends_on: JSON.stringify(['edep2-s1']),
        dependency_reasons: JSON.stringify({ 'edep2-s1': 'Some reason' }),
        sort_order: 1,
      });

      await app.request('/prd-edep2/dependencies', {
        method: 'PATCH',
        body: JSON.stringify({
          fromStoryId: 'edep2-s2',
          toStoryId: 'edep2-s1',
          reason: '',
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const row = testDb
        .query('SELECT dependency_reasons FROM prd_stories WHERE id = ?')
        .get('edep2-s2') as any;
      const reasons = JSON.parse(row.dependency_reasons);
      expect(reasons['edep2-s1']).toBeUndefined();
    });

    test('returns 404 for non-existent PRD', async () => {
      const res = await app.request('/nonexistent/dependencies', {
        method: 'PATCH',
        body: JSON.stringify({ fromStoryId: 'a', toStoryId: 'b', reason: 'test' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(404);
    });

    test('returns 404 when dependency does not exist', async () => {
      insertPrd({ id: 'prd-edep3' });
      insertStory({ id: 'edep3-s1', prd_id: 'prd-edep3', title: 'First', sort_order: 0 });
      insertStory({
        id: 'edep3-s2',
        prd_id: 'prd-edep3',
        title: 'Second',
        depends_on: '[]',
        sort_order: 1,
      });

      const res = await app.request('/prd-edep3/dependencies', {
        method: 'PATCH',
        body: JSON.stringify({
          fromStoryId: 'edep3-s2',
          toStoryId: 'edep3-s1',
          reason: 'No dep exists',
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toContain('does not exist');
    });
  });

  // ---------------------------------------------------------------
  // POST /:id/dependencies/analyze — AI dependency analysis
  // ---------------------------------------------------------------
  describe('POST /:id/dependencies/analyze — AI dependency analysis', () => {
    test('returns 404 for non-existent PRD', async () => {
      const res = await app.request('/nonexistent/dependencies/analyze', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(404);
    });

    test('returns 400 when PRD has fewer than 2 stories', async () => {
      insertPrd({ id: 'prd-dep-a1' });
      insertStory({ id: 'dep-a1-s1', prd_id: 'prd-dep-a1', title: 'Only story' });

      const res = await app.request('/prd-dep-a1/dependencies/analyze', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('at least 2');
    });

    test('analyzes dependencies using AI and returns graph', async () => {
      insertPrd({ id: 'prd-dep-a2' });
      insertStory({ id: 'dep-a2-s1', prd_id: 'prd-dep-a2', title: 'Setup DB', sort_order: 0 });
      insertStory({ id: 'dep-a2-s2', prd_id: 'prd-dep-a2', title: 'User CRUD', sort_order: 1 });

      mockCallLlmResponse = JSON.stringify([
        {
          fromStoryId: 'dep-a2-s2',
          toStoryId: 'dep-a2-s1',
          reason: 'User CRUD needs database schema from Setup DB',
        },
      ]);

      const res = await app.request('/prd-dep-a2/dependencies/analyze', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.graph.edges).toHaveLength(1);
      expect(json.data.graph.edges[0].from).toBe('dep-a2-s1');
      expect(json.data.dependencies).toHaveLength(1);

      // Verify dependency was persisted
      const row = testDb
        .query('SELECT depends_on FROM prd_stories WHERE id = ?')
        .get('dep-a2-s2') as any;
      expect(JSON.parse(row.depends_on)).toContain('dep-a2-s1');
    });

    test('handles AI error gracefully', async () => {
      insertPrd({ id: 'prd-dep-a3' });
      insertStory({ id: 'dep-a3-s1', prd_id: 'prd-dep-a3', title: 'Story A', sort_order: 0 });
      insertStory({ id: 'dep-a3-s2', prd_id: 'prd-dep-a3', title: 'Story B', sort_order: 1 });

      mockCallLlmResponse = new Error('LLM call failed (500)');

      const res = await app.request('/prd-dep-a3/dependencies/analyze', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.ok).toBe(false);
    });
  });

  // ---------------------------------------------------------------
  // GET /:id/dependencies/validate — Validate dependencies
  // ---------------------------------------------------------------
  describe('GET /:id/dependencies/validate — validate dependencies', () => {
    test('returns validation result for PRD with valid dependencies', async () => {
      insertPrd({ id: 'prd-val' });
      insertStory({ id: 'val-s1', prd_id: 'prd-val', title: 'First', sort_order: 0 });
      insertStory({
        id: 'val-s2',
        prd_id: 'prd-val',
        title: 'Second',
        depends_on: JSON.stringify(['val-s1']),
        sort_order: 1,
      });

      const res = await app.request('/prd-val/dependencies/validate');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data).toBeDefined();
      expect(json.data.valid).toBe(true);
      expect(json.data.warnings).toHaveLength(0);
    });

    test('returns 404 for non-existent PRD', async () => {
      const res = await app.request('/nonexistent/dependencies/validate');
      expect(res.status).toBe(404);
    });

    test('detects circular dependencies', async () => {
      insertPrd({ id: 'prd-circ' });
      insertStory({
        id: 'circ-s1',
        prd_id: 'prd-circ',
        title: 'Story A',
        depends_on: JSON.stringify(['circ-s2']),
        sort_order: 0,
      });
      insertStory({
        id: 'circ-s2',
        prd_id: 'prd-circ',
        title: 'Story B',
        depends_on: JSON.stringify(['circ-s1']),
        sort_order: 1,
      });

      const res = await app.request('/prd-circ/dependencies/validate');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.valid).toBe(false);
      const circularWarnings = json.data.warnings.filter(
        (w: any) => w.type === 'circular_dependency',
      );
      expect(circularWarnings.length).toBeGreaterThanOrEqual(1);
    });

    test('detects blocked in-progress story', async () => {
      insertPrd({ id: 'prd-blocked' });
      insertStory({
        id: 'blocked-s1',
        prd_id: 'prd-blocked',
        title: 'Dependency',
        status: 'pending',
        sort_order: 0,
      });
      insertStory({
        id: 'blocked-s2',
        prd_id: 'prd-blocked',
        title: 'In Progress Story',
        status: 'in_progress',
        depends_on: JSON.stringify(['blocked-s1']),
        sort_order: 1,
      });

      const res = await app.request('/prd-blocked/dependencies/validate');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.valid).toBe(false);
      const blockedWarnings = json.data.warnings.filter((w: any) => w.type === 'blocked_story');
      expect(blockedWarnings.length).toBeGreaterThanOrEqual(1);
      expect(blockedWarnings[0].message).toContain('In Progress Story');
    });
  });

  // ---------------------------------------------------------------
  // POST /:prdId/stories/:storyId/estimate — AI estimate for PRD story
  // ---------------------------------------------------------------
  describe('POST /:prdId/stories/:storyId/estimate — AI estimate for PRD story', () => {
    test('returns 404 for non-existent PRD', async () => {
      const res = await app.request('/nonexistent/stories/story-1/estimate', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(404);
    });

    test('returns 404 for non-existent story', async () => {
      insertPrd({ id: 'prd-est' });

      const res = await app.request('/prd-est/stories/nonexistent/estimate', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(404);
    });

    test('generates AI estimate and persists to DB', async () => {
      insertPrd({ id: 'prd-est2', name: 'Test PRD', description: 'A project' });
      insertStory({
        id: 'est-s1',
        prd_id: 'prd-est2',
        title: 'Build auth',
        description: 'OAuth login',
      });

      const mockEstimate = {
        size: 'medium',
        storyPoints: 5,
        confidence: 'high',
        confidenceScore: 85,
        factors: [{ factor: 'OAuth complexity', impact: 'increases', weight: 'moderate' }],
        reasoning: 'OAuth is moderately complex',
      };

      mockCallLlmResponse = JSON.stringify(mockEstimate);

      const res = await app.request('/prd-est2/stories/est-s1/estimate', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.storyId).toBe('est-s1');
      expect(json.data.estimate.size).toBe('medium');
      expect(json.data.estimate.storyPoints).toBe(5);
      expect(json.data.estimate.isManualOverride).toBe(false);

      // Verify in DB
      const row = testDb
        .query('SELECT estimate FROM prd_stories WHERE id = ?')
        .get('est-s1') as any;
      const saved = JSON.parse(row.estimate);
      expect(saved.storyPoints).toBe(5);
    });

    test('handles AI error gracefully', async () => {
      insertPrd({ id: 'prd-est3' });
      insertStory({ id: 'est-s2', prd_id: 'prd-est3', title: 'Story' });

      mockCallLlmResponse = new Error('LLM call failed');

      const res = await app.request('/prd-est3/stories/est-s2/estimate', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('estimation failed');
    });

    test('handles invalid JSON in AI response', async () => {
      insertPrd({ id: 'prd-est4' });
      insertStory({ id: 'est-s3', prd_id: 'prd-est4', title: 'Story' });

      mockCallLlmResponse = 'Not JSON at all';

      const res = await app.request('/prd-est4/stories/est-s3/estimate', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(502);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('parse');
    });
  });

  // ---------------------------------------------------------------
  // PUT /:prdId/stories/:storyId/estimate — Manual estimate for PRD story
  // ---------------------------------------------------------------
  describe('PUT /:prdId/stories/:storyId/estimate — manual estimate for PRD story', () => {
    test('saves a manual estimate override', async () => {
      insertPrd({ id: 'prd-mest' });
      insertStory({ id: 'mest-s1', prd_id: 'prd-mest', title: 'Story' });

      const res = await app.request('/prd-mest/stories/mest-s1/estimate', {
        method: 'PUT',
        body: JSON.stringify({ size: 'large', storyPoints: 8, reasoning: 'Complex' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.storyId).toBe('mest-s1');
      expect(json.data.estimate.size).toBe('large');
      expect(json.data.estimate.storyPoints).toBe(8);
      expect(json.data.estimate.isManualOverride).toBe(true);
      expect(json.data.estimate.reasoning).toBe('Complex');
    });

    test('returns 404 for non-existent story', async () => {
      insertPrd({ id: 'prd-mest2' });

      const res = await app.request('/prd-mest2/stories/nonexistent/estimate', {
        method: 'PUT',
        body: JSON.stringify({ size: 'small', storyPoints: 1 }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(404);
    });

    test('rejects invalid size', async () => {
      insertPrd({ id: 'prd-mest3' });
      insertStory({ id: 'mest-s2', prd_id: 'prd-mest3', title: 'Story' });

      const res = await app.request('/prd-mest3/stories/mest-s2/estimate', {
        method: 'PUT',
        body: JSON.stringify({ size: 'gigantic', storyPoints: 5 }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('size');
    });

    test('rejects invalid story points', async () => {
      insertPrd({ id: 'prd-mest4' });
      insertStory({ id: 'mest-s3', prd_id: 'prd-mest4', title: 'Story' });

      const res = await app.request('/prd-mest4/stories/mest-s3/estimate', {
        method: 'PUT',
        body: JSON.stringify({ size: 'medium', storyPoints: 7 }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('story points');
    });

    test('preserves existing AI factors on manual override', async () => {
      insertPrd({ id: 'prd-mest5' });
      const existingEstimate = {
        storyId: 'mest-s4',
        size: 'small',
        storyPoints: 2,
        confidence: 'high',
        confidenceScore: 90,
        factors: [{ factor: 'Simple task', impact: 'decreases', weight: 'minor' }],
        reasoning: 'AI estimate',
        isManualOverride: false,
      };
      insertStory({
        id: 'mest-s4',
        prd_id: 'prd-mest5',
        title: 'Story',
        estimate: JSON.stringify(existingEstimate),
      });

      const res = await app.request('/prd-mest5/stories/mest-s4/estimate', {
        method: 'PUT',
        body: JSON.stringify({ size: 'large', storyPoints: 13 }),
        headers: { 'Content-Type': 'application/json' },
      });

      const json = await res.json();
      expect(json.data.estimate.size).toBe('large');
      expect(json.data.estimate.storyPoints).toBe(13);
      expect(json.data.estimate.isManualOverride).toBe(true);
      // AI factors preserved
      expect(json.data.estimate.factors).toEqual(existingEstimate.factors);
      // Confidence preserved from existing
      expect(json.data.estimate.confidence).toBe('high');
    });
  });

  // ---------------------------------------------------------------
  // POST /:id/estimate — Bulk estimate all PRD stories
  // ---------------------------------------------------------------
  describe('POST /:id/estimate — bulk estimate PRD stories', () => {
    test('returns 404 for non-existent PRD', async () => {
      const res = await app.request('/nonexistent/estimate', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(404);
    });

    test('returns 400 when PRD has no stories', async () => {
      insertPrd({ id: 'prd-best1' });

      const res = await app.request('/prd-best1/estimate', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('No stories');
    });

    test('bulk estimates stories using AI and persists results', async () => {
      insertPrd({
        id: 'prd-best2',
        name: 'Bulk Est PRD',
        description: 'Project for bulk estimation',
      });
      insertStory({
        id: 'best2-s1',
        prd_id: 'prd-best2',
        title: 'Auth Module',
        description: 'Implement authentication',
        sort_order: 0,
      });
      insertStory({
        id: 'best2-s2',
        prd_id: 'prd-best2',
        title: 'Dashboard',
        description: 'Build dashboard view',
        sort_order: 1,
      });

      mockCallLlmResponse = JSON.stringify([
        {
          storyId: 'best2-s1',
          size: 'medium',
          storyPoints: 5,
          confidence: 'high',
          confidenceScore: 85,
          factors: [{ factor: 'OAuth complexity', impact: 'increases', weight: 'moderate' }],
          reasoning: 'Medium complexity OAuth flow',
        },
        {
          storyId: 'best2-s2',
          size: 'small',
          storyPoints: 2,
          confidence: 'high',
          confidenceScore: 90,
          factors: [{ factor: 'Simple UI', impact: 'decreases', weight: 'minor' }],
          reasoning: 'Standard dashboard layout',
        },
      ]);

      const res = await app.request('/prd-best2/estimate', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.prdId).toBe('prd-best2');
      expect(json.data.summary.totalPoints).toBe(7);
      expect(json.data.estimates).toHaveLength(2);
      expect(json.data.summary.smallCount).toBe(1);
      expect(json.data.summary.mediumCount).toBe(1);

      // Verify persisted in DB
      const row1 = testDb
        .query('SELECT estimate FROM prd_stories WHERE id = ?')
        .get('best2-s1') as any;
      const est1 = JSON.parse(row1.estimate);
      expect(est1.size).toBe('medium');
      expect(est1.storyPoints).toBe(5);
    });

    test('returns current estimates when all stories already estimated', async () => {
      insertPrd({ id: 'prd-best3' });
      insertStory({
        id: 'best3-s1',
        prd_id: 'prd-best3',
        title: 'Story',
        estimate: JSON.stringify({
          storyId: 'best3-s1',
          size: 'small',
          storyPoints: 2,
          confidence: 'high',
          confidenceScore: 90,
          factors: [],
          reasoning: 'Simple',
          isManualOverride: true,
        }),
      });

      const res = await app.request('/prd-best3/estimate', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.summary.totalPoints).toBe(2);
    });

    test('handles AI error in bulk estimation', async () => {
      insertPrd({ id: 'prd-best4' });
      insertStory({ id: 'best4-s1', prd_id: 'prd-best4', title: 'Story' });

      mockCallLlmResponse = new Error('LLM service unavailable');

      const res = await app.request('/prd-best4/estimate', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('Bulk estimation failed');
    });

    test('handles invalid JSON in bulk estimation AI response', async () => {
      insertPrd({ id: 'prd-best5' });
      insertStory({ id: 'best5-s1', prd_id: 'prd-best5', title: 'Story' });

      mockCallLlmResponse = 'not valid json at all';

      const res = await app.request('/prd-best5/estimate', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(502);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('parse');
    });

    test('re-estimates stories when reEstimate is true', async () => {
      insertPrd({ id: 'prd-best6', name: 'Re-est PRD' });
      insertStory({
        id: 'best6-s1',
        prd_id: 'prd-best6',
        title: 'Story',
        estimate: JSON.stringify({
          storyId: 'best6-s1',
          size: 'small',
          storyPoints: 2,
          confidence: 'low',
          confidenceScore: 30,
          factors: [],
          reasoning: 'Old',
          isManualOverride: false,
        }),
      });

      mockCallLlmResponse = JSON.stringify([
        {
          storyId: 'best6-s1',
          size: 'large',
          storyPoints: 8,
          confidence: 'high',
          confidenceScore: 85,
          factors: [],
          reasoning: 'Re-estimated as large',
          suggestedBreakdown: ['Step 1', 'Step 2'],
        },
      ]);

      const res = await app.request('/prd-best6/estimate', {
        method: 'POST',
        body: JSON.stringify({ reEstimate: true }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.estimates[0].size).toBe('large');
      expect(json.data.estimates[0].storyPoints).toBe(8);
    });

    test('includes workspace memory context when available', async () => {
      insertPrd({ id: 'prd-best7', name: 'Memory PRD', description: 'Project with memories' });
      insertStory({ id: 'best7-s1', prd_id: 'prd-best7', title: 'Story' });
      insertMemory({
        id: 'mem-best7',
        workspace_path: '/test/project',
        category: 'convention',
        key: 'style',
        content: 'Use functional components',
      });

      mockCallLlmResponse = JSON.stringify([
        {
          storyId: 'best7-s1',
          size: 'small',
          storyPoints: 2,
          confidence: 'high',
          confidenceScore: 90,
          factors: [],
          reasoning: 'Simple',
        },
      ]);

      const res = await app.request('/prd-best7/estimate', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      // Verify the LLM was called with memory context in the system prompt
      expect(mockCallLlmCapture.system).toContain('Project Memory');
    });
  });

  // ---------------------------------------------------------------
  // POST /:id/completeness — PRD completeness analysis
  // ---------------------------------------------------------------
  describe('POST /:id/completeness — PRD completeness analysis', () => {
    test('returns 404 for non-existent PRD', async () => {
      const res = await app.request('/nonexistent/completeness', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(404);
    });

    test('analyzes PRD completeness using AI', async () => {
      insertPrd({ id: 'prd-comp', name: 'My PRD', description: 'Build an e-commerce platform' });
      insertStory({ id: 'comp-s1', prd_id: 'prd-comp', title: 'Auth', sort_order: 0 });

      const mockAnalysis = {
        overallScore: 65,
        overallLabel: 'Fair',
        summary: 'PRD covers goals but lacks success metrics.',
        sections: [
          {
            section: 'goals',
            label: 'Goals & Objectives',
            present: true,
            severity: 'critical',
            score: 80,
            feedback: 'Goals are clear.',
            questions: ['What is the primary KPI?'],
          },
          {
            section: 'scope',
            label: 'Scope & Boundaries',
            present: false,
            severity: 'critical',
            score: 20,
            feedback: 'Scope is not defined.',
            questions: ['What is out of scope?'],
          },
        ],
        suggestedQuestions: ['What are the success metrics?', 'Who are the target users?'],
      };

      mockCallLlmResponse = JSON.stringify(mockAnalysis);

      const res = await app.request('/prd-comp/completeness', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.analysis.overallScore).toBeGreaterThanOrEqual(0);
      expect(json.data.analysis.overallScore).toBeLessThanOrEqual(100);
      expect(json.data.analysis.sections).toBeDefined();
      expect(json.data.analysis.suggestedQuestions).toBeDefined();
    });

    test('handles AI error gracefully', async () => {
      insertPrd({ id: 'prd-comp2', name: 'Test', description: 'Something' });

      mockCallLlmResponse = new Error('LLM call failed');

      const res = await app.request('/prd-comp2/completeness', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.ok).toBe(false);
    });

    test('handles invalid JSON in AI response', async () => {
      insertPrd({ id: 'prd-comp3', name: 'Test', description: 'Something' });

      mockCallLlmResponse = 'Not valid JSON';

      const res = await app.request('/prd-comp3/completeness', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(502);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('parse');
    });

    test('handles code-fenced JSON response from AI', async () => {
      insertPrd({ id: 'prd-comp4', name: 'Fenced PRD', description: 'Testing fences' });
      insertStory({ id: 'comp4-s1', prd_id: 'prd-comp4', title: 'Story', sort_order: 0 });

      // Wrap response in markdown code fences like some LLMs do
      mockCallLlmResponse =
        '```json\n' +
        JSON.stringify({
          overallScore: 60,
          overallLabel: 'Fair',
          summary: 'Needs more detail.',
          sections: [
            {
              section: 'goals',
              present: true,
              score: 70,
              feedback: 'Goals are clear.',
              questions: ['What KPIs?'],
            },
          ],
          suggestedQuestions: ['What are the success metrics?'],
        }) +
        '\n```';

      const res = await app.request('/prd-comp4/completeness', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.analysis.overallScore).toBe(60);
    });

    test('derives overallLabel when AI omits it', async () => {
      insertPrd({ id: 'prd-comp5', name: 'Label PRD', description: 'Test label derivation' });

      mockCallLlmResponse = JSON.stringify({
        overallScore: 45,
        // overallLabel intentionally omitted
        summary: 'Needs work.',
        sections: [],
        suggestedQuestions: [],
      });

      const res = await app.request('/prd-comp5/completeness', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.analysis.overallLabel).toBe('Needs Work');
    });

    test('builds suggested questions from low-scoring sections when AI omits them', async () => {
      insertPrd({ id: 'prd-comp6', name: 'Q PRD', description: 'Test question derivation' });

      mockCallLlmResponse = JSON.stringify({
        overallScore: 30,
        summary: 'Incomplete.',
        sections: [
          {
            section: 'goals',
            present: false,
            score: 0,
            feedback: 'Missing.',
            questions: ['What goals?'],
          },
          {
            section: 'scope',
            present: false,
            score: 10,
            feedback: 'Vague.',
            questions: ['What is scope?'],
          },
        ],
        // suggestedQuestions intentionally omitted (not an array)
        suggestedQuestions: 'not an array',
      });

      const res = await app.request('/prd-comp6/completeness', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      // Should derive suggestedQuestions from the low-scoring sections
      expect(json.data.analysis.suggestedQuestions.length).toBeGreaterThan(0);
    });

    test('includes project memory context in completeness analysis', async () => {
      insertPrd({ id: 'prd-comp7', name: 'Memory PRD', description: 'Test memory context' });
      insertMemory({
        id: 'mem-comp7',
        workspace_path: '/test/project',
        category: 'context',
        key: 'project-type',
        content: 'Microservices architecture',
      });

      mockCallLlmResponse = JSON.stringify({
        overallScore: 75,
        overallLabel: 'Good',
        summary: 'Good PRD.',
        sections: [],
        suggestedQuestions: ['Any more questions?'],
      });

      const res = await app.request('/prd-comp7/completeness', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      expect(mockCallLlmCapture.system).toContain('Project Memory');
      expect(mockCallLlmCapture.system).toContain('Microservices');
    });

    test('fills in missing sections that AI did not analyze', async () => {
      insertPrd({ id: 'prd-comp8', name: 'Partial PRD', description: 'Test missing section fill' });

      // AI only analyzes 'goals' but the endpoint checks all 10 standard sections
      mockCallLlmResponse = JSON.stringify({
        overallScore: 50,
        overallLabel: 'Fair',
        summary: 'Partial.',
        sections: [
          { section: 'goals', present: true, score: 80, feedback: 'Good goals.', questions: [] },
        ],
        suggestedQuestions: [],
      });

      const res = await app.request('/prd-comp8/completeness', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      // Should have all 10 standard sections filled in
      expect(json.data.analysis.sections.length).toBe(10);
      // The goals section should be present
      const goals = json.data.analysis.sections.find((s: any) => s.section === 'goals');
      expect(goals.present).toBe(true);
      expect(goals.score).toBe(80);
      // Missing sections should be marked as not present with score 0
      const scope = json.data.analysis.sections.find((s: any) => s.section === 'scope');
      expect(scope.present).toBe(false);
      expect(scope.score).toBe(0);
      expect(scope.feedback).toContain('not found');
    });
  });

  // ---------------------------------------------------------------
  // POST /:id/sprint-plan — Generate sprint plan
  // ---------------------------------------------------------------
  describe('POST /:id/sprint-plan — generate sprint plan', () => {
    test('returns 400 when capacity is missing or invalid', async () => {
      insertPrd({ id: 'prd-sp1' });

      const res = await app.request('/prd-sp1/sprint-plan', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('capacity');
    });

    test('returns 404 for non-existent PRD', async () => {
      const res = await app.request('/nonexistent/sprint-plan', {
        method: 'POST',
        body: JSON.stringify({ capacity: 10 }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(404);
    });

    test('returns 400 when PRD has no stories', async () => {
      insertPrd({ id: 'prd-sp2' });

      const res = await app.request('/prd-sp2/sprint-plan', {
        method: 'POST',
        body: JSON.stringify({ capacity: 10 }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('No stories');
    });

    test('returns plan with unassigned stories when none are estimated', async () => {
      insertPrd({ id: 'prd-sp3' });
      insertStory({ id: 'sp3-s1', prd_id: 'prd-sp3', title: 'Story', status: 'pending' });

      const res = await app.request('/prd-sp3/sprint-plan', {
        method: 'POST',
        body: JSON.stringify({ capacity: 10 }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.sprints).toHaveLength(0);
      expect(json.data.unassignedStories).toHaveLength(1);
      expect(json.data.unassignedStories[0].reason).toContain('estimate');
    });

    test('generates sprint plan with estimated stories using AI', async () => {
      insertPrd({ id: 'prd-sp4', name: 'Plan PRD', description: 'A project' });
      const estimate1 = JSON.stringify({
        storyId: 'sp4-s1',
        size: 'medium',
        storyPoints: 5,
        confidence: 'high',
        confidenceScore: 85,
        factors: [],
        reasoning: 'Medium',
        isManualOverride: false,
      });
      const estimate2 = JSON.stringify({
        storyId: 'sp4-s2',
        size: 'small',
        storyPoints: 3,
        confidence: 'high',
        confidenceScore: 90,
        factors: [],
        reasoning: 'Small',
        isManualOverride: false,
      });
      insertStory({
        id: 'sp4-s1',
        prd_id: 'prd-sp4',
        title: 'Auth',
        status: 'pending',
        estimate: estimate1,
        sort_order: 0,
      });
      insertStory({
        id: 'sp4-s2',
        prd_id: 'prd-sp4',
        title: 'Dashboard',
        status: 'pending',
        estimate: estimate2,
        sort_order: 1,
      });

      mockCallLlmResponse = JSON.stringify({
        sprints: [
          {
            sprintNumber: 1,
            storyIds: ['sp4-s1', 'sp4-s2'],
            storyReasons: { 'sp4-s1': 'Foundation', 'sp4-s2': 'Core UI' },
            rationale: 'Both stories fit in one sprint',
          },
        ],
        summary: 'Single sprint plan',
      });

      const res = await app.request('/prd-sp4/sprint-plan', {
        method: 'POST',
        body: JSON.stringify({ capacity: 10 }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.sprints.length).toBeGreaterThanOrEqual(1);
      expect(json.data.prdId).toBe('prd-sp4');
      expect(json.data.totalPoints).toBeGreaterThan(0);
    });

    test('handles invalid JSON in sprint plan AI response', async () => {
      insertPrd({ id: 'prd-sp5' });
      const estimate = JSON.stringify({
        storyId: 'sp5-s1',
        size: 'small',
        storyPoints: 2,
        confidence: 'high',
        confidenceScore: 90,
        factors: [],
        reasoning: 'Small',
        isManualOverride: false,
      });
      insertStory({
        id: 'sp5-s1',
        prd_id: 'prd-sp5',
        title: 'Story',
        status: 'pending',
        estimate,
        sort_order: 0,
      });

      mockCallLlmResponse = 'not valid json';

      const res = await app.request('/prd-sp5/sprint-plan', {
        method: 'POST',
        body: JSON.stringify({ capacity: 10 }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(502);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('parse');
    });

    test('handles AI response missing sprints array', async () => {
      insertPrd({ id: 'prd-sp6' });
      const estimate = JSON.stringify({
        storyId: 'sp6-s1',
        size: 'small',
        storyPoints: 2,
        confidence: 'high',
        confidenceScore: 90,
        factors: [],
        reasoning: 'Small',
        isManualOverride: false,
      });
      insertStory({
        id: 'sp6-s1',
        prd_id: 'prd-sp6',
        title: 'Story',
        status: 'pending',
        estimate,
        sort_order: 0,
      });

      mockCallLlmResponse = JSON.stringify({ summary: 'No sprints here' });

      const res = await app.request('/prd-sp6/sprint-plan', {
        method: 'POST',
        body: JSON.stringify({ capacity: 10 }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(502);
      const json = await res.json();
      expect(json.error).toContain('sprints');
    });

    test('creates overflow sprint for stories AI missed', async () => {
      insertPrd({ id: 'prd-sp7' });
      const mkEstimate = (id: string, pts: number) =>
        JSON.stringify({
          storyId: id,
          size: 'small',
          storyPoints: pts,
          confidence: 'high',
          confidenceScore: 90,
          factors: [],
          reasoning: 'Est',
          isManualOverride: false,
        });

      insertStory({
        id: 'sp7-s1',
        prd_id: 'prd-sp7',
        title: 'Assigned Story',
        status: 'pending',
        estimate: mkEstimate('sp7-s1', 3),
        sort_order: 0,
      });
      insertStory({
        id: 'sp7-s2',
        prd_id: 'prd-sp7',
        title: 'Missed Story',
        status: 'pending',
        estimate: mkEstimate('sp7-s2', 5),
        sort_order: 1,
      });

      // AI only assigns sp7-s1 but misses sp7-s2
      mockCallLlmResponse = JSON.stringify({
        sprints: [
          {
            sprintNumber: 1,
            storyIds: ['sp7-s1'],
            storyReasons: { 'sp7-s1': 'Foundation' },
            rationale: 'Sprint 1',
          },
        ],
        summary: 'Plan with missing story',
      });

      const res = await app.request('/prd-sp7/sprint-plan', {
        method: 'POST',
        body: JSON.stringify({ capacity: 3 }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      // sp7-s2 should be placed in an overflow sprint since sprint 1 is at capacity (3/3)
      expect(json.data.totalPoints).toBe(8);
      const allStoryIds = json.data.sprints.flatMap((s: any) =>
        s.stories.map((st: any) => st.storyId),
      );
      expect(allStoryIds).toContain('sp7-s1');
      expect(allStoryIds).toContain('sp7-s2');
    });

    test('handles AI error in sprint planning', async () => {
      insertPrd({ id: 'prd-sp8' });
      const estimate = JSON.stringify({
        storyId: 'sp8-s1',
        size: 'small',
        storyPoints: 2,
        confidence: 'high',
        confidenceScore: 90,
        factors: [],
        reasoning: 'Small',
        isManualOverride: false,
      });
      insertStory({
        id: 'sp8-s1',
        prd_id: 'prd-sp8',
        title: 'Story',
        status: 'pending',
        estimate,
        sort_order: 0,
      });

      mockCallLlmResponse = new Error('LLM service down');

      const res = await app.request('/prd-sp8/sprint-plan', {
        method: 'POST',
        body: JSON.stringify({ capacity: 10 }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('Sprint planning failed');
    });
  });

  // ---------------------------------------------------------------
  // PUT /:id/sprint-plan — Save adjusted sprint plan
  // ---------------------------------------------------------------
  describe('PUT /:id/sprint-plan — save adjusted sprint plan', () => {
    test('returns 404 for non-existent PRD', async () => {
      const res = await app.request('/nonexistent/sprint-plan', {
        method: 'PUT',
        body: JSON.stringify({ sprints: [] }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(404);
    });

    test('returns 400 when sprints array is missing', async () => {
      insertPrd({ id: 'prd-spu1' });

      const res = await app.request('/prd-spu1/sprint-plan', {
        method: 'PUT',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('sprints');
    });

    test('saves manually adjusted sprint plan', async () => {
      insertPrd({ id: 'prd-spu2' });
      const estimate = JSON.stringify({
        storyId: 'spu2-s1',
        size: 'medium',
        storyPoints: 5,
        confidence: 'high',
        confidenceScore: 85,
        factors: [],
        reasoning: 'Medium',
        isManualOverride: false,
      });
      insertStory({
        id: 'spu2-s1',
        prd_id: 'prd-spu2',
        title: 'Story A',
        estimate: estimate,
        sort_order: 0,
      });

      const res = await app.request('/prd-spu2/sprint-plan', {
        method: 'PUT',
        body: JSON.stringify({
          sprints: [
            {
              stories: [{ storyId: 'spu2-s1', reason: 'Priority work' }],
              rationale: 'First sprint',
            },
          ],
          summary: 'Adjusted plan',
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.prdId).toBe('prd-spu2');
      expect(json.data.sprints).toHaveLength(1);
      expect(json.data.sprints[0].stories[0].storyId).toBe('spu2-s1');
      expect(json.data.sprints[0].stories[0].title).toBe('Story A');
      expect(json.data.sprints[0].stories[0].storyPoints).toBe(5);
      expect(json.data.totalPoints).toBe(5);
      expect(json.data.summary).toBe('Adjusted plan');
    });
  });
});
