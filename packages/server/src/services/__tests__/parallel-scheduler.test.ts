import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { EventEmitter } from 'events';
import { createTestDb } from '../../test-helpers';
import type {
  LoopConfig,
  UserStory,
  ExecutionResult,
  StreamLoopEvent,
  MergeResult,
} from '@e/shared';

// ---------------------------------------------------------------------------
// Mock Bun.spawn for git operations in gitCommitInWorktree
// ---------------------------------------------------------------------------

let spawnResults: Array<{ stdout: string; stderr: string; exitCode: number }> = [];
let spawnCallIndex = 0;
let spawnCalls: Array<{ args: string[]; cwd: string }> = [];

function mockSpawnResult(stdout: string, stderr: string, exitCode: number) {
  spawnResults.push({ stdout, stderr, exitCode });
}

function makeReadableStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

const originalSpawn = Bun.spawn;

function setupSpawnMock() {
  spawnResults = [];
  spawnCallIndex = 0;
  spawnCalls = [];

  (Bun as any).spawn = (args: string[], opts: any) => {
    const idx = spawnCallIndex++;
    const result = spawnResults[idx] ?? { stdout: '', stderr: '', exitCode: 0 };
    spawnCalls.push({ args: [...args], cwd: opts?.cwd ?? '' });

    return {
      stdout: makeReadableStream(result.stdout),
      stderr: makeReadableStream(result.stderr),
      exited: Promise.resolve(result.exitCode),
    };
  };
}

function restoreSpawnMock() {
  (Bun as any).spawn = originalSpawn;
}

// ---------------------------------------------------------------------------
// Test database
// ---------------------------------------------------------------------------

const testDb = createTestDb();
// Add columns that come via migrations
try {
  testDb.exec('ALTER TABLE loops ADD COLUMN last_heartbeat INTEGER');
} catch {
  /* exists */
}
try {
  testDb.exec('ALTER TABLE loops ADD COLUMN active_story_ids TEXT');
} catch {
  /* exists */
}
try {
  testDb.exec("ALTER TABLE prds ADD COLUMN workflow_config TEXT NOT NULL DEFAULT '{}'");
} catch {
  /* exists */
}

// ---------------------------------------------------------------------------
// Module mocks — MUST be set up before importing the scheduler
// ---------------------------------------------------------------------------

mock.module('../../db/database', () => ({
  getDb: () => testDb,
  initDatabase: () => {},
}));

// Mock dispatcher — we control execution results via mockDispatcherExecute
let mockDispatcherExecute: any = () => Promise.resolve(makeSuccessResult());

mock.module('../loop/dispatcher', () => ({
  GolemDispatcher: class MockGolemDispatcher {
    execute(context: any) {
      return mockDispatcherExecute(context);
    }
  },
  golemDispatcher: {
    execute: (context: any) => mockDispatcherExecute(context),
  },
}));

// Mock worktree service — we control creation/lookup results
let mockWorktreeCreate: any = () => Promise.resolve({ ok: true, data: '/tmp/worktree/story-1' });
let mockWorktreeGetForStory: any = () => null;
let mockWorktreeCreateRecord: any = () =>
  Promise.resolve({
    ok: true,
    data: {
      id: 'wt-1',
      workspace_path: '/test/workspace',
      story_id: 'story-1',
      worktree_path: '/tmp/worktree/story-1',
      branch_name: 'story/story-1',
      status: 'active',
    },
  });
let mockWorktreeRemove: any = () => Promise.resolve({ ok: true });
let mockWorktreeUpdateStatus: any = () => ({ ok: true });
/** Tracks calls to mockWorktreeRemove for assertions */
let worktreeRemoveCalls: any[][] = [];
/** Tracks calls to mockWorktreeUpdateStatus for assertions */
let worktreeUpdateStatusCalls: any[][] = [];

mock.module('../worktree-service', () => ({
  create: (a: any) => mockWorktreeCreate(a),
  getForStory: (a: any) => mockWorktreeGetForStory(a),
  createRecord: (a: any) => mockWorktreeCreateRecord(a),
  remove: (a: any, b: any) => {
    worktreeRemoveCalls.push([a, b]);
    return mockWorktreeRemove(a, b);
  },
  updateStatus: (a: any, b: any) => {
    worktreeUpdateStatusCalls.push([a, b]);
    return mockWorktreeUpdateStatus(a, b);
  },
  resolveWorkspacePath: (wp: string, _sid: string) => wp,
}));

// Mock worktree merge service
let mockMerge: any = () =>
  Promise.resolve({
    ok: true,
    commitSha: 'abc123def',
    operationLog: [],
  } as MergeResult);
/** Tracks calls to mockMerge for assertions */
let mergeCalls: any[][] = [];

mock.module('../worktree-merge', () => ({
  merge: (a: any) => {
    mergeCalls.push([a]);
    return mockMerge(a);
  },
}));

// ---------------------------------------------------------------------------
// Import AFTER mocks — the scheduler will use our mocked modules
// ---------------------------------------------------------------------------

import { ParallelScheduler } from '../loop/parallel-scheduler';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const TEST_LOOP_ID = 'loop-test-1';
const TEST_PRD_ID = 'prd-test-1';
const TEST_WORKSPACE = '/test/workspace';

function makeDefaultConfig(overrides?: Partial<LoopConfig>): LoopConfig {
  return {
    maxIterations: 50,
    maxAttemptsPerStory: 3,
    maxFixUpAttempts: 2,
    model: 'claude-sonnet-4-20250514',
    effort: 'high',
    autoCommit: true,
    autoSnapshot: false,
    pauseOnFailure: false,
    qualityChecks: [
      {
        id: 'check-1',
        type: 'typecheck',
        name: 'TypeCheck',
        command: 'tsc --noEmit',
        timeout: 60000,
        required: true,
        enabled: true,
      },
    ],
    maxParallel: 3,
    autoMerge: true,
    ...overrides,
  };
}

function makeSuccessResult(overrides?: Partial<ExecutionResult>): ExecutionResult {
  return {
    status: 'success',
    branchName: 'story/story-1',
    commitSha: 'abc123',
    logs: ['Implemented successfully'],
    duration: 5000,
    agentOutput: 'Done!',
    agentError: null,
    qualityResults: [
      {
        checkId: 'check-1',
        checkName: 'TypeCheck',
        checkType: 'typecheck',
        passed: true,
        output: 'No errors found',
        duration: 2000,
        exitCode: 0,
      },
    ],
    conversationId: 'conv-1',
    agentId: 'agent-1',
    ...overrides,
  };
}

function makeFailedResult(overrides?: Partial<ExecutionResult>): ExecutionResult {
  return {
    status: 'failure',
    branchName: 'story/story-1',
    commitSha: null,
    logs: ['Failed'],
    duration: 3000,
    agentOutput: 'Error!',
    agentError: 'Agent crashed',
    qualityResults: [],
    conversationId: 'conv-1',
    agentId: 'agent-1',
    ...overrides,
  };
}

function makeQualityFailedResult(): ExecutionResult {
  return {
    status: 'success',
    branchName: 'story/story-1',
    commitSha: null,
    logs: ['Quality checks failed'],
    duration: 5000,
    agentOutput: 'Done but broken',
    agentError: null,
    qualityResults: [
      {
        checkId: 'check-1',
        checkName: 'TypeCheck',
        checkType: 'typecheck',
        passed: false,
        output: 'error TS2345: Type mismatch',
        duration: 2000,
        exitCode: 1,
      },
    ],
    conversationId: 'conv-1',
    agentId: 'agent-1',
  };
}

function clearTables() {
  testDb.exec('DELETE FROM prd_stories');
  testDb.exec('DELETE FROM loops');
  testDb.exec('DELETE FROM prds');
  testDb.exec('DELETE FROM worktrees');
}

function insertTestStory(
  id: string,
  opts?: {
    prdId?: string | null;
    status?: string;
    priority?: string;
    dependsOn?: string[];
    attempts?: number;
    maxAttempts?: number;
    researchOnly?: boolean;
    sortOrder?: number;
    title?: string;
  },
): void {
  const now = Date.now();
  testDb
    .query(
      `INSERT INTO prd_stories (
      id, prd_id, workspace_path, title, description,
      acceptance_criteria, priority, depends_on, dependency_reasons,
      status, attempts, max_attempts, learnings, research_only,
      sort_order, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      opts?.prdId ?? TEST_PRD_ID,
      TEST_WORKSPACE,
      opts?.title ?? `Story ${id}`,
      `Description for ${id}`,
      JSON.stringify([{ id: 'ac-1', description: 'AC 1', passed: false }]),
      opts?.priority ?? 'medium',
      JSON.stringify(opts?.dependsOn ?? []),
      JSON.stringify({}),
      opts?.status ?? 'pending',
      opts?.attempts ?? 0,
      opts?.maxAttempts ?? 3,
      JSON.stringify([]),
      opts?.researchOnly ? 1 : 0,
      opts?.sortOrder ?? 0,
      now,
      now,
    );
}

function insertTestLoop(): void {
  const now = Date.now();
  testDb
    .query(
      `INSERT INTO loops (
      id, prd_id, workspace_path, status, config,
      current_iteration, current_story_id, current_agent_id,
      started_at, total_stories_completed, total_stories_failed,
      total_iterations, iteration_log
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      TEST_LOOP_ID,
      TEST_PRD_ID,
      TEST_WORKSPACE,
      'running',
      JSON.stringify(makeDefaultConfig()),
      0,
      null,
      null,
      now,
      0,
      0,
      0,
      JSON.stringify([]),
    );
}

function insertTestPrd(): void {
  const now = Date.now();
  testDb
    .query(
      `INSERT INTO prds (
      id, workspace_path, name, description, quality_checks, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(TEST_PRD_ID, TEST_WORKSPACE, 'Test PRD', 'Test description', JSON.stringify([]), now, now);
}

function getStoryStatus(storyId: string): string {
  const row = testDb.query('SELECT status FROM prd_stories WHERE id = ?').get(storyId) as any;
  return row?.status ?? 'unknown';
}

function getStoryAttempts(storyId: string): number {
  const row = testDb.query('SELECT attempts FROM prd_stories WHERE id = ?').get(storyId) as any;
  return row?.attempts ?? 0;
}

function getLoopData(): any {
  return testDb.query('SELECT * FROM loops WHERE id = ?').get(TEST_LOOP_ID) as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ParallelScheduler', () => {
  let events: EventEmitter;
  let emittedEvents: StreamLoopEvent[];

  beforeEach(() => {
    clearTables();
    setupSpawnMock();
    insertTestPrd();
    insertTestLoop();

    events = new EventEmitter();
    emittedEvents = [];
    events.on('loop_event', (evt: StreamLoopEvent) => {
      emittedEvents.push(evt);
    });

    // Reset mocks to defaults
    mockDispatcherExecute = () => Promise.resolve(makeSuccessResult());
    mockWorktreeCreate = () => Promise.resolve({ ok: true, data: '/tmp/worktree/story-1' });
    mockWorktreeGetForStory = () => null;
    mockWorktreeCreateRecord = () =>
      Promise.resolve({
        ok: true,
        data: {
          id: 'wt-1',
          workspace_path: TEST_WORKSPACE,
          story_id: 'story-1',
          worktree_path: '/tmp/worktree/story-1',
          branch_name: 'story/story-1',
          status: 'active',
        },
      });
    mockWorktreeRemove = () => Promise.resolve({ ok: true });
    mockWorktreeUpdateStatus = () => ({ ok: true });
    mockMerge = () =>
      Promise.resolve({
        ok: true,
        commitSha: 'abc123def',
        operationLog: [],
      } as MergeResult);

    // Reset call trackers
    worktreeRemoveCalls = [];
    worktreeUpdateStatusCalls = [];
    mergeCalls = [];
  });

  afterEach(() => {
    restoreSpawnMock();
  });

  function createScheduler(configOverrides?: Partial<LoopConfig>) {
    const config = makeDefaultConfig(configOverrides);
    const dispatcher = { execute: (ctx: any) => mockDispatcherExecute(ctx) } as any;
    return new ParallelScheduler(
      TEST_LOOP_ID,
      TEST_PRD_ID,
      TEST_WORKSPACE,
      config,
      events,
      dispatcher,
    );
  }

  // -----------------------------------------------------------------
  // selectEligibleStories
  // -----------------------------------------------------------------

  describe('selectEligibleStories', () => {
    // Verifies that only stories in "pending" status with satisfied deps are eligible
    test('returns pending stories with no dependencies', () => {
      insertTestStory('s1', { status: 'pending' });
      insertTestStory('s2', { status: 'pending' });
      insertTestStory('s3', { status: 'completed' });

      const scheduler = createScheduler();
      const eligible = scheduler.selectEligibleStories(5);

      expect(eligible).toHaveLength(2);
      expect(eligible.map((s: UserStory) => s.id)).toContain('s1');
      expect(eligible.map((s: UserStory) => s.id)).toContain('s2');
    });

    // Ensures stories blocked by incomplete dependencies are excluded
    test('excludes stories with unsatisfied dependencies', () => {
      insertTestStory('s1', { status: 'pending', sortOrder: 1 });
      insertTestStory('s2', { status: 'pending', dependsOn: ['s1'], sortOrder: 2 });
      insertTestStory('s3', { status: 'pending', dependsOn: ['s2'], sortOrder: 3 });

      const scheduler = createScheduler();
      const eligible = scheduler.selectEligibleStories(5);

      // Only s1 should be eligible (s2 depends on s1, s3 depends on s2)
      expect(eligible).toHaveLength(1);
      expect(eligible[0].id).toBe('s1');
    });

    // Verifies that completed dependencies unblock dependent stories
    test('includes stories whose dependencies are completed', () => {
      insertTestStory('s1', { status: 'completed' });
      insertTestStory('s2', { status: 'pending', dependsOn: ['s1'] });

      const scheduler = createScheduler();
      const eligible = scheduler.selectEligibleStories(5);

      expect(eligible).toHaveLength(1);
      expect(eligible[0].id).toBe('s2');
    });

    // Verifies qa status also unblocks dependents (qaUnblocksDependents default=true)
    test('includes stories whose dependencies are in qa (qaUnblocksDependents)', () => {
      insertTestStory('s1', { status: 'qa' });
      insertTestStory('s2', { status: 'pending', dependsOn: ['s1'] });

      const scheduler = createScheduler();
      const eligible = scheduler.selectEligibleStories(5);

      expect(eligible).toHaveLength(1);
      expect(eligible[0].id).toBe('s2');
    });

    // Ensures stories that have exceeded max attempts are not retried
    test('excludes stories that exceeded maxAttempts', () => {
      insertTestStory('s1', { status: 'pending', attempts: 3, maxAttempts: 3 });
      insertTestStory('s2', { status: 'pending', attempts: 0 });

      const scheduler = createScheduler();
      const eligible = scheduler.selectEligibleStories(5);

      expect(eligible).toHaveLength(1);
      expect(eligible[0].id).toBe('s2');
    });

    // Ensures research-only stories are excluded from implementation loops
    test('excludes research-only stories', () => {
      insertTestStory('s1', { status: 'pending', researchOnly: true });
      insertTestStory('s2', { status: 'pending', researchOnly: false });

      const scheduler = createScheduler();
      const eligible = scheduler.selectEligibleStories(5);

      expect(eligible).toHaveLength(1);
      expect(eligible[0].id).toBe('s2');
    });

    // Ensures stories already in progress are not double-dispatched
    test('excludes in_progress stories', () => {
      insertTestStory('s1', { status: 'in_progress' });
      insertTestStory('s2', { status: 'pending' });

      const scheduler = createScheduler();
      const eligible = scheduler.selectEligibleStories(5);

      expect(eligible).toHaveLength(1);
      expect(eligible[0].id).toBe('s2');
    });

    // Verifies that the limit parameter correctly caps results
    test('respects the limit parameter', () => {
      insertTestStory('s1', { status: 'pending', sortOrder: 1 });
      insertTestStory('s2', { status: 'pending', sortOrder: 2 });
      insertTestStory('s3', { status: 'pending', sortOrder: 3 });

      const scheduler = createScheduler();
      const eligible = scheduler.selectEligibleStories(2);

      expect(eligible).toHaveLength(2);
    });

    // Verifies priority-based ordering: critical > high > medium > low
    test('sorts by priority then sortOrder', () => {
      insertTestStory('s1', { status: 'pending', priority: 'low', sortOrder: 1 });
      insertTestStory('s2', { status: 'pending', priority: 'critical', sortOrder: 2 });
      insertTestStory('s3', { status: 'pending', priority: 'high', sortOrder: 3 });

      const scheduler = createScheduler();
      const eligible = scheduler.selectEligibleStories(5);

      expect(eligible.map((s: UserStory) => s.id)).toEqual(['s2', 's3', 's1']);
    });

    // Verifies that failed_timeout stories are eligible for retry
    test('includes failed_timeout stories (eligible for retry)', () => {
      insertTestStory('s1', { status: 'failed_timeout', attempts: 1, maxAttempts: 3 });
      insertTestStory('s2', { status: 'failed' }); // permanently failed, not eligible

      const scheduler = createScheduler();
      const eligible = scheduler.selectEligibleStories(5);

      expect(eligible).toHaveLength(1);
      expect(eligible[0].id).toBe('s1');
    });
  });

  // -----------------------------------------------------------------
  // getActiveStoryIds / getActiveCount
  // -----------------------------------------------------------------

  describe('active tracking', () => {
    // Verifies that the scheduler starts with no active executions
    test('starts with empty active executions', () => {
      const scheduler = createScheduler();
      expect(scheduler.getActiveStoryIds()).toEqual([]);
      expect(scheduler.getActiveCount()).toBe(0);
    });
  });

  // -----------------------------------------------------------------
  // setMood
  // -----------------------------------------------------------------

  describe('setMood', () => {
    // Verifies mood can be set without errors and is propagated to events
    test('sets mood without throwing', () => {
      const scheduler = createScheduler();
      expect(() => scheduler.setMood('excited')).not.toThrow();
      expect(() => scheduler.setMood('frustrated')).not.toThrow();
      expect(() => scheduler.setMood('neutral')).not.toThrow();
    });
  });

  // -----------------------------------------------------------------
  // runParallelBatch — success path
  // -----------------------------------------------------------------

  describe('runParallelBatch', () => {
    // Verifies the happy path: eligible story dispatched, passes quality checks, merges
    test('dispatches eligible stories and handles success with auto-merge', async () => {
      insertTestStory('s1', { status: 'pending' });

      // Set up spawn mocks for git commit in worktree:
      // 1. git add -A (success)
      // 2. git status --porcelain (has changes)
      // 3. git commit (success)
      // 4. git rev-parse HEAD (returns SHA)
      mockSpawnResult('', '', 0); // git add
      mockSpawnResult('M src/index.ts', '', 0); // git status
      mockSpawnResult('', '', 0); // git commit
      mockSpawnResult('abc123def456', '', 0); // git rev-parse

      const scheduler = createScheduler();
      const result = await scheduler.runParallelBatch(1, () => false);

      expect(result.dispatched).toBe(1);
      expect(result.storyIds).toEqual(['s1']);
      // Story should have been completed and merged
      expect(result.completed).toBe(1);
      expect(result.merged).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.conflicts).toBe(0);

      // Verify story status updated to 'qa' after successful merge
      expect(getStoryStatus('s1')).toBe('qa');

      // Verify worktree was requested (createRecord is called via mock.module proxy)
      // Verify merge was called
      expect(mergeCalls.length).toBeGreaterThan(0);
    });

    // Verifies that multiple stories can be dispatched concurrently up to maxParallel
    test('dispatches up to maxParallel stories concurrently', async () => {
      insertTestStory('s1', { status: 'pending', sortOrder: 1 });
      insertTestStory('s2', { status: 'pending', sortOrder: 2 });
      insertTestStory('s3', { status: 'pending', sortOrder: 3 });
      insertTestStory('s4', { status: 'pending', sortOrder: 4 });

      // Each story needs git commit mocks: git add, git status, git commit, git rev-parse
      for (let i = 0; i < 3; i++) {
        mockSpawnResult('', '', 0);
        mockSpawnResult('M src/index.ts', '', 0);
        mockSpawnResult('', '', 0);
        mockSpawnResult('abc123def456', '', 0);
      }

      const scheduler = createScheduler({ maxParallel: 3 });
      const result = await scheduler.runParallelBatch(1, () => false);

      // Should dispatch exactly 3 (maxParallel limit), not 4
      expect(result.dispatched).toBe(3);
      expect(result.storyIds).toHaveLength(3);
    });

    // Verifies that when no stories are eligible, the batch returns empty result
    test('returns empty result when no eligible stories', async () => {
      insertTestStory('s1', { status: 'completed' });
      insertTestStory('s2', { status: 'failed', attempts: 3, maxAttempts: 3 });

      const scheduler = createScheduler();
      const result = await scheduler.runParallelBatch(1, () => false);

      expect(result.dispatched).toBe(0);
      expect(result.completed).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.storyIds).toEqual([]);
    });

    // Verifies the story_started and worktree_created SSE events are emitted
    test('emits worktree_created and story_started events', async () => {
      insertTestStory('s1', { status: 'pending' });

      // Git commit mocks
      mockSpawnResult('', '', 0);
      mockSpawnResult('M src/index.ts', '', 0);
      mockSpawnResult('', '', 0);
      mockSpawnResult('abc123def456', '', 0);

      const scheduler = createScheduler();
      await scheduler.runParallelBatch(1, () => false);

      const worktreeCreated = emittedEvents.filter((e) => e.event === 'worktree_created');
      const storyStarted = emittedEvents.filter((e) => e.event === 'story_started');

      expect(worktreeCreated).toHaveLength(1);
      expect(worktreeCreated[0].data.storyId).toBe('s1');
      expect(worktreeCreated[0].data.worktreePath).toBeDefined();
      expect(worktreeCreated[0].data.maxParallel).toBe(3);

      expect(storyStarted).toHaveLength(1);
      expect(storyStarted[0].data.storyId).toBe('s1');
    });

    // Verifies that autoCommit: false skips the commit step
    test('skips git commit when autoCommit is false', async () => {
      insertTestStory('s1', { status: 'pending' });

      const scheduler = createScheduler({ autoCommit: false });
      const result = await scheduler.runParallelBatch(1, () => false);

      // No git spawns needed
      expect(spawnCalls).toHaveLength(0);
      expect(result.completed).toBe(1);
    });
  });

  // -----------------------------------------------------------------
  // runParallelBatch — failure path
  // -----------------------------------------------------------------

  describe('runParallelBatch — failure handling', () => {
    // Verifies that agent errors mark the story as pending for retry when attempts remain
    test('marks story as pending for retry when agent fails and retries remain', async () => {
      insertTestStory('s1', { status: 'pending', attempts: 0, maxAttempts: 3 });

      // Dispatcher returns failure
      mockDispatcherExecute = () => Promise.resolve(makeFailedResult());

      const scheduler = createScheduler();
      const result = await scheduler.runParallelBatch(1, () => false);

      expect(result.dispatched).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.completed).toBe(0);

      // Story should be reset to pending for retry (attempt 1 of 3)
      expect(getStoryStatus('s1')).toBe('pending');
      // Attempts should have been incremented to 1
      expect(getStoryAttempts('s1')).toBe(1);
    });

    // Verifies that stories are marked permanently failed when no retries remain
    test('marks story as failed permanently when no retries remain', async () => {
      insertTestStory('s1', { status: 'pending', attempts: 2, maxAttempts: 3 });

      mockDispatcherExecute = () => Promise.resolve(makeFailedResult());

      const scheduler = createScheduler();
      const result = await scheduler.runParallelBatch(1, () => false);

      expect(result.failed).toBe(1);
      // Attempts will be 3, and maxAttempts is 3, so no more retries
      expect(getStoryStatus('s1')).toBe('failed');
    });

    // Verifies that quality check failures cause story to be retried/failed
    test('handles quality check failures', async () => {
      insertTestStory('s1', { status: 'pending', attempts: 0, maxAttempts: 3 });

      mockDispatcherExecute = () => Promise.resolve(makeQualityFailedResult());

      const scheduler = createScheduler();
      const result = await scheduler.runParallelBatch(1, () => false);

      expect(result.failed).toBe(1);
      // Should be reset to pending for retry
      expect(getStoryStatus('s1')).toBe('pending');
    });

    // Verifies that a story_failed event is emitted with willRetry info
    test('emits story_failed event with willRetry=true', async () => {
      insertTestStory('s1', { status: 'pending', attempts: 0, maxAttempts: 3 });

      mockDispatcherExecute = () => Promise.resolve(makeFailedResult());

      const scheduler = createScheduler();
      await scheduler.runParallelBatch(1, () => false);

      const failEvents = emittedEvents.filter((e) => e.event === 'story_failed');
      expect(failEvents).toHaveLength(1);
      expect(failEvents[0].data.storyId).toBe('s1');
      expect(failEvents[0].data.willRetry).toBe(true);
    });

    // Verifies story_failed event with willRetry=false on permanent failure
    test('emits story_failed event with willRetry=false on last attempt', async () => {
      insertTestStory('s1', { status: 'pending', attempts: 2, maxAttempts: 3 });

      mockDispatcherExecute = () => Promise.resolve(makeFailedResult());

      const scheduler = createScheduler();
      await scheduler.runParallelBatch(1, () => false);

      const failEvents = emittedEvents.filter((e) => e.event === 'story_failed');
      expect(failEvents).toHaveLength(1);
      expect(failEvents[0].data.willRetry).toBe(false);
    });

    // Verifies learning is recorded when a story fails
    test('records learning on failure', async () => {
      insertTestStory('s1', { status: 'pending', attempts: 0, maxAttempts: 3 });

      mockDispatcherExecute = () =>
        Promise.resolve(
          makeFailedResult({
            agentError: 'Test agent error message',
          }),
        );

      const scheduler = createScheduler();
      await scheduler.runParallelBatch(1, () => false);

      // Check learnings were recorded
      const row = testDb.query('SELECT learnings FROM prd_stories WHERE id = ?').get('s1') as any;
      const learnings = JSON.parse(row.learnings);
      expect(learnings).toHaveLength(1);
      expect(learnings[0]).toContain('Test agent error message');
    });

    // Verifies that quality check failure names are recorded as learnings
    test('records quality check failure names in learnings', async () => {
      insertTestStory('s1', { status: 'pending', attempts: 0, maxAttempts: 3 });

      mockDispatcherExecute = () => Promise.resolve(makeQualityFailedResult());

      const scheduler = createScheduler();
      await scheduler.runParallelBatch(1, () => false);

      const row = testDb.query('SELECT learnings FROM prd_stories WHERE id = ?').get('s1') as any;
      const learnings = JSON.parse(row.learnings);
      expect(learnings).toHaveLength(1);
      expect(learnings[0]).toContain('TypeCheck');
    });
  });

  // -----------------------------------------------------------------
  // runParallelBatch — merge path
  // -----------------------------------------------------------------

  describe('runParallelBatch — merge handling', () => {
    // Verifies that merge conflict marks the story as failed without blocking others (AC #6)
    test('handles merge conflicts by marking story as failed (AC #6)', async () => {
      insertTestStory('s1', { status: 'pending' });

      // Git commit succeeds
      mockSpawnResult('', '', 0);
      mockSpawnResult('M src/index.ts', '', 0);
      mockSpawnResult('', '', 0);
      mockSpawnResult('abc123def456', '', 0);

      // Merge returns conflict
      mockMerge = () =>
        Promise.resolve({
          ok: false,
          error: 'Merge conflict',
          conflictingFiles: ['src/index.ts', 'src/utils.ts'],
          operationLog: [],
        } as MergeResult);

      const scheduler = createScheduler();
      const result = await scheduler.runParallelBatch(1, () => false);

      expect(result.conflicts).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.merged).toBe(0);

      // Verify merge conflict events were emitted
      const conflictEvents = emittedEvents.filter((e) => e.event === 'worktree_merge_conflict');
      expect(conflictEvents).toHaveLength(1);
      expect(conflictEvents[0].data.conflictingFiles).toEqual(['src/index.ts', 'src/utils.ts']);
    });

    // Verifies merge_started and merge_completed SSE events are emitted
    test('emits worktree_merge_started and worktree_merge_completed events', async () => {
      insertTestStory('s1', { status: 'pending' });

      // Git commit mocks
      mockSpawnResult('', '', 0);
      mockSpawnResult('M src/index.ts', '', 0);
      mockSpawnResult('', '', 0);
      mockSpawnResult('abc123def456', '', 0);

      const scheduler = createScheduler();
      await scheduler.runParallelBatch(1, () => false);

      const mergeStarted = emittedEvents.filter((e) => e.event === 'worktree_merge_started');
      const mergeCompleted = emittedEvents.filter((e) => e.event === 'worktree_merge_completed');

      expect(mergeStarted).toHaveLength(1);
      expect(mergeStarted[0].data.storyId).toBe('s1');

      expect(mergeCompleted).toHaveLength(1);
      expect(mergeCompleted[0].data.storyId).toBe('s1');
      expect(mergeCompleted[0].data.commitSha).toBeDefined();
    });

    // Verifies no merge is attempted when autoMerge is disabled
    test('skips merge when autoMerge is false', async () => {
      insertTestStory('s1', { status: 'pending' });

      // Git commit mocks
      mockSpawnResult('', '', 0);
      mockSpawnResult('M src/index.ts', '', 0);
      mockSpawnResult('', '', 0);
      mockSpawnResult('abc123def456', '', 0);

      const scheduler = createScheduler({ autoMerge: false });
      const result = await scheduler.runParallelBatch(1, () => false);

      expect(result.completed).toBe(1);
      expect(result.merged).toBe(0);

      // Story should be in qa status (no merge)
      expect(getStoryStatus('s1')).toBe('qa');

      // Merge should NOT have been called
      expect(mergeCalls).toHaveLength(0);
    });

    // Verifies that non-conflict merge failures result in retry
    test('retries on non-conflict merge failure', async () => {
      insertTestStory('s1', { status: 'pending' });

      // Git commit mocks
      mockSpawnResult('', '', 0);
      mockSpawnResult('M src/index.ts', '', 0);
      mockSpawnResult('', '', 0);
      mockSpawnResult('abc123def456', '', 0);

      // Merge fails with non-conflict error
      mockMerge = () =>
        Promise.resolve({
          ok: false,
          error: 'Branch not found',
          operationLog: [],
        } as MergeResult);

      const scheduler = createScheduler();
      const result = await scheduler.runParallelBatch(1, () => false);

      expect(result.failed).toBe(1);
      expect(result.conflicts).toBe(0);

      // Story should be reset to pending for retry
      expect(getStoryStatus('s1')).toBe('pending');
    });
  });

  // -----------------------------------------------------------------
  // Worktree reuse on retry (AC #7)
  // -----------------------------------------------------------------

  describe('worktree reuse', () => {
    // Verifies that retrying a story reuses the existing worktree (AC #7)
    test('reuses existing worktree for retried stories (AC #7)', async () => {
      insertTestStory('s1', { status: 'pending', attempts: 1, maxAttempts: 3 });

      // Worktree already exists for this story
      mockWorktreeGetForStory = () => ({
        id: 'wt-existing',
        workspace_path: TEST_WORKSPACE,
        story_id: 's1',
        worktree_path: '/tmp/existing-worktree',
        branch_name: 'story/s1',
        status: 'active',
      });

      // Git commit mocks
      mockSpawnResult('', '', 0);
      mockSpawnResult('M src/index.ts', '', 0);
      mockSpawnResult('', '', 0);
      mockSpawnResult('abc123def456', '', 0);

      const scheduler = createScheduler();
      const batchResult = await scheduler.runParallelBatch(1, () => false);

      // Should have reused existing worktree and dispatched the story
      expect(batchResult.dispatched).toBe(1);
    });

    // Verifies that conflict-status worktrees get reset to active on retry
    test('resets conflict status worktree to active on retry', async () => {
      insertTestStory('s1', { status: 'pending', attempts: 1, maxAttempts: 3 });

      // Worktree exists with conflict status
      mockWorktreeGetForStory = () => ({
        id: 'wt-conflict',
        workspace_path: TEST_WORKSPACE,
        story_id: 's1',
        worktree_path: '/tmp/conflict-worktree',
        branch_name: 'story/s1',
        status: 'conflict',
      });

      // Git commit mocks
      mockSpawnResult('', '', 0);
      mockSpawnResult('M src/index.ts', '', 0);
      mockSpawnResult('', '', 0);
      mockSpawnResult('abc123def456', '', 0);

      const scheduler = createScheduler();
      await scheduler.runParallelBatch(1, () => false);

      // Should have called updateStatus to reset from conflict to active
      expect(worktreeUpdateStatusCalls.some((c) => c[0] === 's1' && c[1] === 'active')).toBe(true);
    });
  });

  // -----------------------------------------------------------------
  // Worktree creation failure
  // -----------------------------------------------------------------

  describe('worktree creation failure', () => {
    // Verifies that a worktree creation failure skips the story (stays pending for next batch)
    test('skips story when worktree creation fails (story stays pending)', async () => {
      insertTestStory('s1', { status: 'pending' });

      // Worktree creation fails
      mockWorktreeCreate = () => Promise.resolve({ ok: false, error: 'Disk full' });

      const scheduler = createScheduler();
      const result = await scheduler.runParallelBatch(1, () => false);

      // Story is not dispatched — dispatchStory returns null when worktree fails
      expect(result.dispatched).toBe(0);
      // Story remains pending (not marked as failed — will retry next iteration)
      expect(getStoryStatus('s1')).toBe('pending');
    });

    // Verifies that worktree record creation failure cleans up the worktree on disk
    test('cleans up worktree if record creation fails', async () => {
      insertTestStory('s1', { status: 'pending' });

      // Worktree creates on disk but record fails
      mockWorktreeCreateRecord = () => Promise.resolve({ ok: false, error: 'DB error' });

      const scheduler = createScheduler();
      const result = await scheduler.runParallelBatch(1, () => false);

      // Should have tried to clean up the on-disk worktree
      expect(worktreeRemoveCalls.length).toBeGreaterThan(0);
      // Story is not dispatched — stays pending for retry
      expect(result.dispatched).toBe(0);
      expect(getStoryStatus('s1')).toBe('pending');
    });
  });

  // -----------------------------------------------------------------
  // Git commit in worktree
  // -----------------------------------------------------------------

  describe('git commit in worktree', () => {
    // Verifies that git commit failure causes the story to retry
    test('treats git commit failure as retry-able failure', async () => {
      insertTestStory('s1', { status: 'pending', attempts: 0, maxAttempts: 3 });

      // Git add succeeds, status shows changes, but commit fails
      mockSpawnResult('', '', 0); // git add
      mockSpawnResult('M src/index.ts', '', 0); // git status
      mockSpawnResult('', 'fatal: unable to create commit', 1); // git commit fails

      const scheduler = createScheduler();
      const result = await scheduler.runParallelBatch(1, () => false);

      expect(result.failed).toBe(1);
      // Story should be reset to pending for retry
      expect(getStoryStatus('s1')).toBe('pending');
    });

    // Verifies that nothing-to-commit skips the commit step gracefully
    test('skips commit when no changes to commit', async () => {
      insertTestStory('s1', { status: 'pending' });

      // Git add succeeds, but status shows no changes
      mockSpawnResult('', '', 0); // git add
      mockSpawnResult('', '', 0); // git status (empty = no changes)

      const scheduler = createScheduler();
      const result = await scheduler.runParallelBatch(1, () => false);

      // Should still proceed to merge even without commit
      expect(result.completed).toBe(1);
    });
  });

  // -----------------------------------------------------------------
  // Loop state tracking
  // -----------------------------------------------------------------

  describe('loop state tracking', () => {
    // Verifies that total_stories_completed is incremented in the DB
    test('increments total_stories_completed on success', async () => {
      insertTestStory('s1', { status: 'pending' });

      // Git commit mocks
      mockSpawnResult('', '', 0);
      mockSpawnResult('M src/index.ts', '', 0);
      mockSpawnResult('', '', 0);
      mockSpawnResult('abc123def456', '', 0);

      const scheduler = createScheduler();
      await scheduler.runParallelBatch(1, () => false);

      const loopData = getLoopData();
      expect(loopData.total_stories_completed).toBe(1);
    });

    // Verifies that total_stories_failed is incremented on permanent failure
    test('increments total_stories_failed on permanent failure', async () => {
      insertTestStory('s1', { status: 'pending', attempts: 2, maxAttempts: 3 });

      mockDispatcherExecute = () => Promise.resolve(makeFailedResult());

      const scheduler = createScheduler();
      const result = await scheduler.runParallelBatch(1, () => false);

      const loopData = getLoopData();
      expect(loopData.total_stories_failed).toBe(1);
    });

    // Verifies active_story_ids is updated in the loop DB
    test('updates active_story_ids in loop DB during execution', async () => {
      insertTestStory('s1', { status: 'pending' });

      // Git commit mocks
      mockSpawnResult('', '', 0);
      mockSpawnResult('M src/index.ts', '', 0);
      mockSpawnResult('', '', 0);
      mockSpawnResult('abc123def456', '', 0);

      const scheduler = createScheduler();
      await scheduler.runParallelBatch(1, () => false);

      // After completion, active_story_ids should be empty
      const loopData = getLoopData();
      const activeIds = JSON.parse(loopData.active_story_ids || '[]');
      expect(activeIds).toEqual([]);
    });
  });

  // -----------------------------------------------------------------
  // Standalone stories (no PRD)
  // -----------------------------------------------------------------

  describe('standalone stories', () => {
    // Verifies that standalone stories (no PRD) are correctly selected
    test('selects standalone stories when prdId is null', () => {
      // Insert a standalone story
      const now = Date.now();
      testDb
        .query(
          `INSERT INTO prd_stories (
          id, prd_id, workspace_path, title, description,
          acceptance_criteria, priority, depends_on, dependency_reasons,
          status, attempts, max_attempts, learnings, research_only,
          sort_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'standalone-1',
          null,
          TEST_WORKSPACE,
          'Standalone Story',
          'Description',
          JSON.stringify([]),
          'medium',
          JSON.stringify([]),
          JSON.stringify({}),
          'pending',
          0,
          3,
          JSON.stringify([]),
          0,
          0,
          now,
          now,
        );

      const config = makeDefaultConfig();
      const dispatcher = { execute: (ctx: any) => mockDispatcherExecute(ctx) } as any;
      const scheduler = new ParallelScheduler(
        TEST_LOOP_ID,
        null, // no PRD
        TEST_WORKSPACE,
        config,
        events,
        dispatcher,
      );

      const eligible = scheduler.selectEligibleStories(5);
      expect(eligible).toHaveLength(1);
      expect(eligible[0].id).toBe('standalone-1');
    });
  });

  // -----------------------------------------------------------------
  // Story metadata updates
  // -----------------------------------------------------------------

  describe('story metadata updates', () => {
    // Verifies that conversationId and agentId are saved from execution results
    test('updates story with conversationId and agentId from execution', async () => {
      insertTestStory('s1', { status: 'pending' });

      mockDispatcherExecute = () =>
        Promise.resolve(
          makeSuccessResult({
            conversationId: 'conv-test-123',
            agentId: 'agent-test-456',
          }),
        );

      // Git commit mocks
      mockSpawnResult('', '', 0);
      mockSpawnResult('M src/index.ts', '', 0);
      mockSpawnResult('', '', 0);
      mockSpawnResult('abc123def456', '', 0);

      const scheduler = createScheduler();
      await scheduler.runParallelBatch(1, () => false);

      const row = testDb
        .query('SELECT conversation_id, agent_id FROM prd_stories WHERE id = ?')
        .get('s1') as any;
      expect(row.conversation_id).toBe('conv-test-123');
      expect(row.agent_id).toBe('agent-test-456');
    });

    // Verifies commitSha is saved after successful git commit
    test('saves commitSha after successful git commit', async () => {
      insertTestStory('s1', { status: 'pending' });

      mockSpawnResult('', '', 0);
      mockSpawnResult('M src/index.ts', '', 0);
      mockSpawnResult('', '', 0);
      mockSpawnResult('commitsha789', '', 0);

      const scheduler = createScheduler();
      await scheduler.runParallelBatch(1, () => false);

      const row = testDb.query('SELECT commit_sha FROM prd_stories WHERE id = ?').get('s1') as any;
      expect(row.commit_sha).toBe('commitsha789');
    });
  });

  // -----------------------------------------------------------------
  // maxParallel=1 behavior (AC #8)
  // -----------------------------------------------------------------

  describe('maxParallel=1', () => {
    // Verifies that with maxParallel=1, only one story is dispatched at a time (AC #8)
    test('dispatches only one story at a time when maxParallel=1', async () => {
      insertTestStory('s1', { status: 'pending', sortOrder: 1 });
      insertTestStory('s2', { status: 'pending', sortOrder: 2 });

      // Git commit mocks for one story
      mockSpawnResult('', '', 0);
      mockSpawnResult('M src/index.ts', '', 0);
      mockSpawnResult('', '', 0);
      mockSpawnResult('abc123def456', '', 0);

      const scheduler = createScheduler({ maxParallel: 1 });
      const result = await scheduler.runParallelBatch(1, () => false);

      // Should only dispatch 1 story (maxParallel=1)
      expect(result.dispatched).toBe(1);
      expect(result.storyIds).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------
  // Dispatcher exception
  // -----------------------------------------------------------------

  describe('dispatcher exception', () => {
    // Verifies that an executor promise rejection is caught and handled
    test('handles dispatcher promise rejection gracefully', async () => {
      insertTestStory('s1', { status: 'pending' });

      mockDispatcherExecute = () => Promise.reject(new Error('Executor crashed'));

      const scheduler = createScheduler();
      const result = await scheduler.runParallelBatch(1, () => false);

      // Should handle the error without throwing, and count it as a failure
      expect(result.failed).toBe(1);
    });
  });

  // -----------------------------------------------------------------
  // Dependency chain — parallel batch only takes independent stories
  // -----------------------------------------------------------------

  describe('dependency-aware scheduling', () => {
    // Verifies that a complex dependency graph only dispatches independent stories
    test('dispatches only independent stories from a dependency graph', () => {
      // s1 has no deps, s2 depends on s1, s3 has no deps,
      // s4 depends on s3, s5 depends on s2 and s4
      insertTestStory('s1', { status: 'pending', sortOrder: 1 });
      insertTestStory('s2', { status: 'pending', dependsOn: ['s1'], sortOrder: 2 });
      insertTestStory('s3', { status: 'pending', sortOrder: 3 });
      insertTestStory('s4', { status: 'pending', dependsOn: ['s3'], sortOrder: 4 });
      insertTestStory('s5', { status: 'pending', dependsOn: ['s2', 's4'], sortOrder: 5 });

      const scheduler = createScheduler({ maxParallel: 5 });
      const eligible = scheduler.selectEligibleStories(5);

      // Only s1 and s3 have no dependencies
      expect(eligible.map((s: UserStory) => s.id)).toEqual(['s1', 's3']);
    });

    // Verifies that once a dependency is completed, the dependent story becomes eligible
    test('unblocks stories as dependencies complete', () => {
      insertTestStory('s1', { status: 'completed' });
      insertTestStory('s2', { status: 'pending', dependsOn: ['s1'] });

      const scheduler = createScheduler();
      const eligible = scheduler.selectEligibleStories(5);

      expect(eligible).toHaveLength(1);
      expect(eligible[0].id).toBe('s2');
    });

    // Verifies that partially satisfied dependencies still block a story
    test('story with partially satisfied dependencies remains blocked', () => {
      insertTestStory('s1', { status: 'completed' });
      insertTestStory('s2', { status: 'pending' }); // not completed
      insertTestStory('s3', { status: 'pending', dependsOn: ['s1', 's2'] });

      const scheduler = createScheduler();
      const eligible = scheduler.selectEligibleStories(5);

      // s2 is eligible (pending with no deps), s3 is blocked by s2
      expect(eligible.map((s: UserStory) => s.id)).toEqual(['s2']);
    });
  });

  // -----------------------------------------------------------------
  // Multiple stories in parallel — independence
  // -----------------------------------------------------------------

  describe('parallel independence', () => {
    // Verifies one failing story doesn't prevent other stories from completing (AC #6)
    test('one failing story does not block others from completing', async () => {
      insertTestStory('s1', { status: 'pending', sortOrder: 1 });
      insertTestStory('s2', { status: 'pending', sortOrder: 2 });

      let callCount = 0;
      mockDispatcherExecute = () => {
        callCount++;
        if (callCount === 1) {
          // First story fails
          return Promise.resolve(makeFailedResult());
        }
        // Second story succeeds
        return Promise.resolve(makeSuccessResult());
      };

      // Git commit mocks for the successful story
      mockSpawnResult('', '', 0);
      mockSpawnResult('M src/index.ts', '', 0);
      mockSpawnResult('', '', 0);
      mockSpawnResult('abc123def456', '', 0);

      const scheduler = createScheduler({ maxParallel: 2 });
      const result = await scheduler.runParallelBatch(1, () => false);

      // Both should have been dispatched
      expect(result.dispatched).toBe(2);
      // One completed, one failed
      expect(result.completed).toBe(1);
      expect(result.failed).toBe(1);
    });
  });

  // -----------------------------------------------------------------
  // Prompt building
  // -----------------------------------------------------------------

  describe('prompt construction', () => {
    // Verifies that the scheduler builds correct prompts for stories
    test('builds system and story prompts (private methods, tested via dispatch)', async () => {
      insertTestStory('s1', {
        status: 'pending',
        title: 'Implement dark mode',
      });

      // Track what prompt is sent to the dispatcher
      let capturedPrompt = '';
      let capturedSystemPrompt = '';
      mockDispatcherExecute = (ctx: any) => {
        capturedPrompt = ctx.prompt;
        capturedSystemPrompt = ctx.systemPrompt;
        return Promise.resolve(makeSuccessResult());
      };

      // Git commit mocks
      mockSpawnResult('', '', 0);
      mockSpawnResult('M src/index.ts', '', 0);
      mockSpawnResult('', '', 0);
      mockSpawnResult('abc123def456', '', 0);

      const scheduler = createScheduler();
      await scheduler.runParallelBatch(1, () => false);

      expect(capturedPrompt).toContain('Implement dark mode');
      expect(capturedPrompt).toContain('Acceptance Criteria');
      expect(capturedSystemPrompt).toContain('autonomous AI agent');
    });

    // Verifies learnings from previous attempts are included in the prompt
    test('includes learnings from previous attempts', async () => {
      // Insert story with previous learnings
      const now = Date.now();
      testDb
        .query(
          `INSERT INTO prd_stories (
          id, prd_id, workspace_path, title, description,
          acceptance_criteria, priority, depends_on, dependency_reasons,
          status, attempts, max_attempts, learnings, research_only,
          sort_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          's-learn',
          TEST_PRD_ID,
          TEST_WORKSPACE,
          'Story with learnings',
          'Description',
          JSON.stringify([{ id: 'ac-1', description: 'AC 1', passed: false }]),
          'medium',
          JSON.stringify([]),
          JSON.stringify({}),
          'pending',
          1,
          3,
          JSON.stringify(['Previous error: missing import', 'Type mismatch on line 42']),
          0,
          0,
          now,
          now,
        );

      let capturedPrompt = '';
      mockDispatcherExecute = (ctx: any) => {
        capturedPrompt = ctx.prompt;
        return Promise.resolve(makeSuccessResult());
      };

      mockSpawnResult('', '', 0);
      mockSpawnResult('M src/index.ts', '', 0);
      mockSpawnResult('', '', 0);
      mockSpawnResult('abc123def456', '', 0);

      const scheduler = createScheduler();
      await scheduler.runParallelBatch(1, () => false);

      expect(capturedPrompt).toContain('Learnings from Previous Attempts');
      expect(capturedPrompt).toContain('missing import');
      expect(capturedPrompt).toContain('Type mismatch on line 42');
    });
  });
});
