import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { createTestDb } from '../../test-helpers';

const testDb = createTestDb();
mock.module('../../db/database', () => ({
  getDb: () => testDb,
  initDatabase: () => {},
}));

import { taskRoutes as app } from '../tasks';

function clearTables() {
  testDb.exec('DELETE FROM tasks');
}

function insertTask(overrides: Record<string, any> = {}) {
  const defaults = {
    id: 'task-1',
    conversation_id: null,
    subject: 'Test Task',
    description: 'A test task description',
    active_form: null,
    status: 'pending',
    owner: null,
    blocks: '[]',
    blocked_by: '[]',
    metadata: '{}',
    created_at: 1000000,
    updated_at: 1000000,
  };
  const row = { ...defaults, ...overrides };
  testDb
    .query(
      `INSERT INTO tasks (id, conversation_id, subject, description, active_form, status, owner, blocks, blocked_by, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.conversation_id,
      row.subject,
      row.description,
      row.active_form,
      row.status,
      row.owner,
      row.blocks,
      row.blocked_by,
      row.metadata,
      row.created_at,
      row.updated_at,
    );
}

describe('Task Routes', () => {
  beforeEach(() => {
    clearTables();
  });

  // ---------------------------------------------------------------
  // GET / — List tasks
  // ---------------------------------------------------------------
  describe('GET / — list tasks', () => {
    test('returns empty array when no tasks exist', async () => {
      const res = await app.request('/');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data).toEqual([]);
    });

    test('returns all non-deleted tasks ordered by created_at ASC', async () => {
      insertTask({ id: 'task-later', subject: 'Later', created_at: 200 });
      insertTask({ id: 'task-earlier', subject: 'Earlier', created_at: 100 });

      const res = await app.request('/');
      const json = await res.json();
      expect(json.data).toHaveLength(2);
      expect(json.data[0].id).toBe('task-earlier');
      expect(json.data[1].id).toBe('task-later');
    });

    test('excludes deleted tasks', async () => {
      insertTask({ id: 'task-active', status: 'pending' });
      insertTask({ id: 'task-deleted', status: 'deleted' });

      const res = await app.request('/');
      const json = await res.json();
      expect(json.data).toHaveLength(1);
      expect(json.data[0].id).toBe('task-active');
    });

    test('filters by conversationId query param', async () => {
      insertTask({ id: 'task-a', conversation_id: 'conv-1' });
      insertTask({ id: 'task-b', conversation_id: 'conv-2' });

      const res = await app.request('/?conversationId=conv-1');
      const json = await res.json();
      expect(json.data).toHaveLength(1);
      expect(json.data[0].id).toBe('task-a');
    });

    test('filters by conversationId and excludes deleted', async () => {
      insertTask({ id: 'task-a', conversation_id: 'conv-1', status: 'pending' });
      insertTask({ id: 'task-b', conversation_id: 'conv-1', status: 'deleted' });

      const res = await app.request('/?conversationId=conv-1');
      const json = await res.json();
      expect(json.data).toHaveLength(1);
      expect(json.data[0].id).toBe('task-a');
    });

    test('maps row to camelCase shape', async () => {
      insertTask({
        id: 'task-1',
        subject: 'My Task',
        description: 'desc',
        active_form: 'form-1',
        status: 'in_progress',
        owner: 'alice',
        blocks: '["task-2"]',
        blocked_by: '["task-3"]',
        metadata: '{"priority":"high"}',
        created_at: 100,
        updated_at: 200,
      });

      const res = await app.request('/');
      const json = await res.json();
      const task = json.data[0];
      expect(task.id).toBe('task-1');
      expect(task.subject).toBe('My Task');
      expect(task.description).toBe('desc');
      expect(task.activeForm).toBe('form-1');
      expect(task.status).toBe('in_progress');
      expect(task.owner).toBe('alice');
      expect(task.blocks).toEqual(['task-2']);
      expect(task.blockedBy).toEqual(['task-3']);
      expect(task.metadata).toEqual({ priority: 'high' });
      expect(task.createdAt).toBe(100);
      expect(task.updatedAt).toBe(200);
    });
  });

  // ---------------------------------------------------------------
  // GET /:id — Get single task
  // ---------------------------------------------------------------
  describe('GET /:id — get task', () => {
    test('returns 404 for non-existent task', async () => {
      const res = await app.request('/nonexistent');
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('Not found');
    });

    test('returns a single task', async () => {
      insertTask({ id: 'task-1', subject: 'Do the thing' });

      const res = await app.request('/task-1');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.id).toBe('task-1');
      expect(json.data.subject).toBe('Do the thing');
    });

    test('parses blocks, blockedBy, and metadata from JSON', async () => {
      insertTask({
        id: 'task-1',
        blocks: '["t2","t3"]',
        blocked_by: '["t0"]',
        metadata: '{"key":"val"}',
      });

      const res = await app.request('/task-1');
      const json = await res.json();
      expect(json.data.blocks).toEqual(['t2', 't3']);
      expect(json.data.blockedBy).toEqual(['t0']);
      expect(json.data.metadata).toEqual({ key: 'val' });
    });

    test('returns empty object metadata when default in DB', async () => {
      insertTask({ id: 'task-1' });

      const res = await app.request('/task-1');
      const json = await res.json();
      expect(json.data.metadata).toEqual({});
    });
  });

  // ---------------------------------------------------------------
  // POST / — Create task
  // ---------------------------------------------------------------
  describe('POST / — create task', () => {
    test('creates a task with required fields', async () => {
      const res = await app.request('/', {
        method: 'POST',
        body: JSON.stringify({ subject: 'New Task', description: 'Do stuff' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.id).toBeDefined();

      const row = testDb.query('SELECT * FROM tasks WHERE id = ?').get(json.data.id) as any;
      expect(row.subject).toBe('New Task');
      expect(row.description).toBe('Do stuff');
      expect(row.status).toBe('pending');
    });

    test('creates a task with conversationId and activeForm', async () => {
      const res = await app.request('/', {
        method: 'POST',
        body: JSON.stringify({
          subject: 'Linked Task',
          description: 'Linked',
          conversationId: 'conv-1',
          activeForm: 'form-abc',
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await res.json();
      const row = testDb.query('SELECT * FROM tasks WHERE id = ?').get(json.data.id) as any;
      expect(row.conversation_id).toBe('conv-1');
      expect(row.active_form).toBe('form-abc');
    });

    test('creates a task with metadata', async () => {
      const res = await app.request('/', {
        method: 'POST',
        body: JSON.stringify({
          subject: 'Meta Task',
          description: '',
          metadata: { priority: 'high', tags: ['a', 'b'] },
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await res.json();
      const row = testDb.query('SELECT metadata FROM tasks WHERE id = ?').get(json.data.id) as any;
      expect(JSON.parse(row.metadata)).toEqual({ priority: 'high', tags: ['a', 'b'] });
    });

    test('defaults conversationId to null when not provided', async () => {
      const res = await app.request('/', {
        method: 'POST',
        body: JSON.stringify({ subject: 'Solo Task', description: '' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await res.json();
      const row = testDb
        .query('SELECT conversation_id FROM tasks WHERE id = ?')
        .get(json.data.id) as any;
      expect(row.conversation_id).toBeNull();
    });

    test('generates unique short ids (8 chars)', async () => {
      const res1 = await app.request('/', {
        method: 'POST',
        body: JSON.stringify({ subject: 'T1', description: '' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const res2 = await app.request('/', {
        method: 'POST',
        body: JSON.stringify({ subject: 'T2', description: '' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const j1 = await res1.json();
      const j2 = await res2.json();
      expect(j1.data.id).not.toBe(j2.data.id);
      expect(j1.data.id.length).toBe(8);
    });
  });

  // ---------------------------------------------------------------
  // PATCH /:id — Update task
  // ---------------------------------------------------------------
  describe('PATCH /:id — update task', () => {
    test('returns 404 for non-existent task', async () => {
      const res = await app.request('/nonexistent', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'done' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('Not found');
    });

    test('updates status', async () => {
      insertTask({ id: 'task-1', status: 'pending' });

      const res = await app.request('/task-1', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'in_progress' }),
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.status).toBe('in_progress');
    });

    test('updates subject and description', async () => {
      insertTask({ id: 'task-1', subject: 'Old Subject', description: 'Old Desc' });

      const res = await app.request('/task-1', {
        method: 'PATCH',
        body: JSON.stringify({ subject: 'New Subject', description: 'New Desc' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await res.json();
      expect(json.data.subject).toBe('New Subject');
      expect(json.data.description).toBe('New Desc');
    });

    test('updates activeForm', async () => {
      insertTask({ id: 'task-1' });

      const res = await app.request('/task-1', {
        method: 'PATCH',
        body: JSON.stringify({ activeForm: 'form-xyz' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await res.json();
      expect(json.data.activeForm).toBe('form-xyz');
    });

    test('updates owner', async () => {
      insertTask({ id: 'task-1' });

      const res = await app.request('/task-1', {
        method: 'PATCH',
        body: JSON.stringify({ owner: 'bob' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await res.json();
      expect(json.data.owner).toBe('bob');
    });

    test('addBlocks merges into existing blocks without duplicates', async () => {
      insertTask({ id: 'task-1', blocks: '["t2"]' });

      const res = await app.request('/task-1', {
        method: 'PATCH',
        body: JSON.stringify({ addBlocks: ['t2', 't3'] }),
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await res.json();
      expect(json.data.blocks).toEqual(['t2', 't3']);
    });

    test('addBlocks works when blocks is empty', async () => {
      insertTask({ id: 'task-1', blocks: '[]' });

      const res = await app.request('/task-1', {
        method: 'PATCH',
        body: JSON.stringify({ addBlocks: ['t5', 't6'] }),
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await res.json();
      expect(json.data.blocks).toEqual(['t5', 't6']);
    });

    test('addBlockedBy merges into existing blockedBy without duplicates', async () => {
      insertTask({ id: 'task-1', blocked_by: '["t0"]' });

      const res = await app.request('/task-1', {
        method: 'PATCH',
        body: JSON.stringify({ addBlockedBy: ['t0', 't1'] }),
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await res.json();
      expect(json.data.blockedBy).toEqual(['t0', 't1']);
    });

    test('addBlockedBy works when blockedBy is empty', async () => {
      insertTask({ id: 'task-1', blocked_by: '[]' });

      const res = await app.request('/task-1', {
        method: 'PATCH',
        body: JSON.stringify({ addBlockedBy: ['dep-1'] }),
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await res.json();
      expect(json.data.blockedBy).toEqual(['dep-1']);
    });

    test('metadata merges with existing metadata', async () => {
      insertTask({ id: 'task-1', metadata: '{"a":1,"b":2}' });

      const res = await app.request('/task-1', {
        method: 'PATCH',
        body: JSON.stringify({ metadata: { b: 99, c: 3 } }),
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await res.json();
      expect(json.data.metadata).toEqual({ a: 1, b: 99, c: 3 });
    });

    test('metadata null values delete keys', async () => {
      insertTask({ id: 'task-1', metadata: '{"keep":"yes","remove":"me"}' });

      const res = await app.request('/task-1', {
        method: 'PATCH',
        body: JSON.stringify({ metadata: { remove: null } }),
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await res.json();
      expect(json.data.metadata).toEqual({ keep: 'yes' });
    });

    test('metadata merges when existing metadata is empty', async () => {
      insertTask({ id: 'task-1', metadata: '{}' });

      const res = await app.request('/task-1', {
        method: 'PATCH',
        body: JSON.stringify({ metadata: { newKey: 'newVal' } }),
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await res.json();
      expect(json.data.metadata).toEqual({ newKey: 'newVal' });
    });

    test('updates updated_at timestamp', async () => {
      insertTask({ id: 'task-1', updated_at: 1000 });

      await app.request('/task-1', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'done' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const row = testDb.query('SELECT updated_at FROM tasks WHERE id = ?').get('task-1') as any;
      expect(row.updated_at).toBeGreaterThan(1000);
    });

    test('returns full updated task in response', async () => {
      insertTask({ id: 'task-1', subject: 'Original', status: 'pending' });

      const res = await app.request('/task-1', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'done' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await res.json();
      expect(json.data.id).toBe('task-1');
      expect(json.data.subject).toBe('Original');
      expect(json.data.status).toBe('done');
    });
  });

  // ---------------------------------------------------------------
  // DELETE /:id — Delete task (soft delete)
  // ---------------------------------------------------------------
  describe('DELETE /:id — delete task', () => {
    test('soft-deletes a task by setting status to deleted', async () => {
      insertTask({ id: 'task-1', status: 'pending' });

      const res = await app.request('/task-1', { method: 'DELETE' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);

      const row = testDb.query('SELECT status FROM tasks WHERE id = ?').get('task-1') as any;
      expect(row.status).toBe('deleted');
    });

    test('updates updated_at on soft delete', async () => {
      insertTask({ id: 'task-1', updated_at: 1000 });

      await app.request('/task-1', { method: 'DELETE' });
      const row = testDb.query('SELECT updated_at FROM tasks WHERE id = ?').get('task-1') as any;
      expect(row.updated_at).toBeGreaterThan(1000);
    });

    test('returns ok even for non-existent task', async () => {
      const res = await app.request('/nonexistent', { method: 'DELETE' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
    });

    test('deleted task does not appear in list', async () => {
      insertTask({ id: 'task-1', status: 'pending' });
      await app.request('/task-1', { method: 'DELETE' });

      const res = await app.request('/');
      const json = await res.json();
      expect(json.data).toHaveLength(0);
    });
  });
});
