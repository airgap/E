/**
 * Tests that zombie recovery in the LoopOrchestrator scopes all queries
 * (hasPendingWork, resetInProgressStories, determineTerminalStatus)
 * to the specific loop's active_story_ids rather than the entire PRD.
 *
 * This prevents one loop's recovery from interfering with other loops
 * that share the same PRD.
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { createTestDb } from '../../test-helpers';

// ---------------------------------------------------------------------------
// Test database — shared across all tests
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
  testDb.exec('ALTER TABLE loops ADD COLUMN machine_id TEXT');
} catch {
  /* exists */
}
try {
  testDb.exec('ALTER TABLE loops ADD COLUMN dismissed_at INTEGER');
} catch {
  /* exists */
}

// ---------------------------------------------------------------------------
// Module mocks — MUST be set up before importing the orchestrator
// ---------------------------------------------------------------------------

mock.module('../../db/database', () => ({
  getDb: () => testDb,
  initDatabase: () => {},
}));

// Mock LoopRunner — track created instances without actually running anything
let mockRunnerInstances: Array<{ loopId: string }> = [];

mock.module('../loop/runner', () => ({
  LoopRunner: class MockLoopRunner {
    loopId: string;
    constructor(
      loopId: string,
      _prdId: string | null,
      _workspacePath: string,
      _config: any,
      _events: any,
    ) {
      this.loopId = loopId;
      mockRunnerInstances.push(this);
    }
    async run() {
      /* no-op */
    }
    pause() {}
    resume() {}
    cancel() {}
  },
}));

mock.module('../../golem-names', () => ({
  getHostname: () => 'test-host',
}));

// ---------------------------------------------------------------------------
// Import orchestrator AFTER mocks — singleton constructor runs recovery on
// empty DB, which is a no-op.
// ---------------------------------------------------------------------------
const { loopOrchestrator } = await import('../loop/orchestrator');

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const WORKSPACE = '/test/zombie-workspace';
const NOW = Date.now();

// Use a counter to generate unique IDs per test, avoiding leakage from the
// singleton LoopOrchestrator's in-memory runners Map between tests.
let idCounter = 0;
function uid(prefix: string): string {
  return `${prefix}-${++idCounter}`;
}

function insertPrd(id: string) {
  testDb
    .query(
      'INSERT OR IGNORE INTO prds (id, workspace_path, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(id, WORKSPACE, 'Zombie Test PRD', NOW, NOW);
}

function insertStory(id: string, prdId: string, status: string, researchOnly = false) {
  testDb
    .query(
      'INSERT INTO prd_stories (id, prd_id, title, status, research_only, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(id, prdId, `Story ${id}`, status, researchOnly ? 1 : 0, NOW, NOW);
}

function insertLoop(
  id: string,
  prdId: string,
  status: string,
  activeStoryIds: string[] | null,
  currentStoryId: string | null = null,
) {
  testDb
    .query(
      `INSERT INTO loops (id, prd_id, workspace_path, status, config, current_iteration, started_at, total_stories_completed, total_stories_failed, total_iterations, iteration_log, last_heartbeat, active_story_ids, current_story_id)
       VALUES (?, ?, ?, ?, '{}', 0, ?, 0, 0, 0, '[]', ?, ?, ?)`,
    )
    .run(
      id,
      prdId,
      WORKSPACE,
      status,
      NOW,
      NOW - 60000,
      activeStoryIds ? JSON.stringify(activeStoryIds) : null,
      currentStoryId,
    );
}

function getStoryStatus(id: string): string {
  return (testDb.query('SELECT status FROM prd_stories WHERE id = ?').get(id) as any).status;
}

function getLoopStatus(id: string): string {
  return (testDb.query('SELECT status FROM loops WHERE id = ?').get(id) as any).status;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Scoped zombie recovery', () => {
  beforeEach(() => {
    mockRunnerInstances = [];
  });

  // Verifies that when Loop A has all completed stories and Loop B (same PRD)
  // has pending stories, Loop A is correctly marked terminal instead of being
  // incorrectly resumed due to seeing Loop B's pending stories.
  test('zombie loop with completed stories → terminal, not resume (despite other loop having pending work)', () => {
    const prdId = uid('prd');
    const loopAId = uid('loopA');
    const loopBId = uid('loopB');
    const s1 = uid('s1');
    const s2 = uid('s2');
    const s3 = uid('s3');
    const s4 = uid('s4');

    insertPrd(prdId);
    // Loop A stories: all completed
    insertStory(s1, prdId, 'completed');
    insertStory(s2, prdId, 'completed');
    // Loop B stories: has pending work
    insertStory(s3, prdId, 'in_progress');
    insertStory(s4, prdId, 'pending');

    insertLoop(loopAId, prdId, 'running', [s1, s2]);
    insertLoop(loopBId, prdId, 'running', [s3, s4]);

    // Trigger periodic zombie recovery via listLoops()
    loopOrchestrator.listLoops();

    // Loop A: all stories completed → should be marked terminal 'completed'
    expect(getLoopStatus(loopAId)).toBe('completed');
    // Loop B: has pending work → should be auto-resumed
    // Its in_progress story s3 should be reset to pending
    expect(getStoryStatus(s3)).toBe('pending');
    expect(getStoryStatus(s4)).toBe('pending');
    // Loop A's stories remain untouched
    expect(getStoryStatus(s1)).toBe('completed');
    expect(getStoryStatus(s2)).toBe('completed');

    // Only Loop B should have spawned a runner (Loop A is terminal)
    const resumedLoopIds = mockRunnerInstances.map((r) => r.loopId);
    expect(resumedLoopIds).toContain(loopBId);
    expect(resumedLoopIds).not.toContain(loopAId);
  });

  // Verifies that the resetInProgressStories method only resets
  // stories belonging to the specific loop, not the entire PRD.
  test('scoped reset only affects stories belonging to the recovered loop', () => {
    const prdId = uid('prd');
    const loopAId = uid('loopA');
    const loopBId = uid('loopB');
    const s1 = uid('s1');
    const s2 = uid('s2');
    const s3 = uid('s3');

    insertPrd(prdId);
    // Loop A: story s1 is in_progress (will be reset), s2 is pending
    insertStory(s1, prdId, 'in_progress');
    insertStory(s2, prdId, 'pending');
    // Loop B: story s3 is in_progress (should NOT be touched by Loop A's recovery)
    insertStory(s3, prdId, 'in_progress');

    insertLoop(loopAId, prdId, 'running', [s1, s2], s1);
    insertLoop(loopBId, prdId, 'running', [s3]);

    // Both loops are zombies (no runner). Trigger recovery.
    loopOrchestrator.listLoops();

    // Both loops should be auto-resumed since they both have pending work
    // s1 reset by Loop A's recovery, s3 reset by Loop B's recovery
    expect(getStoryStatus(s1)).toBe('pending');
    expect(getStoryStatus(s2)).toBe('pending');
    expect(getStoryStatus(s3)).toBe('pending');

    // Both should have runners created
    expect(mockRunnerInstances.length).toBe(2);
  });

  // Verifies that determineTerminalStatus only considers the loop's own
  // stories, not all stories in the PRD. Loop A (all completed) should
  // get 'completed', not 'completed_with_failures' due to Loop B's failures.
  test('terminal status is scoped: completed loop not affected by other loop failures', () => {
    const prdId = uid('prd');
    const loopAId = uid('loopA');
    const loopBId = uid('loopB');
    const s1 = uid('s1');
    const s2 = uid('s2');
    const s3 = uid('s3');

    insertPrd(prdId);
    // Loop A: all stories completed
    insertStory(s1, prdId, 'completed');
    insertStory(s2, prdId, 'completed');
    // Loop B: has a failed story (same PRD)
    insertStory(s3, prdId, 'failed');

    // Paused loops go straight to terminal status determination
    insertLoop(loopAId, prdId, 'paused', [s1, s2]);
    insertLoop(loopBId, prdId, 'paused', [s3]);

    loopOrchestrator.listLoops();

    // Loop A should be 'completed' — NOT 'completed_with_failures'
    expect(getLoopStatus(loopAId)).toBe('completed');
    // Loop B should be 'failed' — all its stories failed
    expect(getLoopStatus(loopBId)).toBe('failed');
    // No runners should be created for paused loops
    expect(mockRunnerInstances.length).toBe(0);
  });

  // Verifies AC #4: when no active_story_ids are recorded, the system
  // falls back to PRD-level behavior as a safety net.
  test('falls back to PRD-level scope when no active_story_ids recorded', () => {
    const prdId = uid('prd');
    const loopId = uid('loop');
    const s1 = uid('s1');
    const s2 = uid('s2');

    insertPrd(prdId);
    insertStory(s1, prdId, 'in_progress');
    insertStory(s2, prdId, 'pending');

    // Loop with no active_story_ids (null) — e.g. loop created before the feature
    insertLoop(loopId, prdId, 'running', null);

    loopOrchestrator.listLoops();

    // Should fall back to PRD-level reset (resets all in_progress stories)
    expect(getStoryStatus(s1)).toBe('pending');
    expect(getStoryStatus(s2)).toBe('pending');
    // Loop should be auto-resumed
    expect(mockRunnerInstances.length).toBe(1);
    expect(mockRunnerInstances[0].loopId).toBe(loopId);
  });

  // Verifies that hasPendingWork correctly identifies when a loop's own
  // stories are all done, even though the PRD has pending stories from
  // other loops. The loop should get terminal status, not be resumed.
  test('hasPendingWork returns false when loop stories are all done but PRD has other pending stories', () => {
    const prdId = uid('prd');
    const loopAId = uid('loopA');
    const s1 = uid('s1');
    const s2 = uid('s2');
    const s3 = uid('s3');
    const s4 = uid('s4');

    insertPrd(prdId);
    // Loop A: completed and failed
    insertStory(s1, prdId, 'completed');
    insertStory(s2, prdId, 'failed');
    // Other stories in PRD (not assigned to loopA)
    insertStory(s3, prdId, 'pending');
    insertStory(s4, prdId, 'in_progress');

    insertLoop(loopAId, prdId, 'running', [s1, s2]);

    loopOrchestrator.listLoops();

    // Loop A should be terminal (completed_with_failures), NOT resumed
    expect(getLoopStatus(loopAId)).toBe('completed_with_failures');
    // Other stories should be untouched
    expect(getStoryStatus(s3)).toBe('pending');
    expect(getStoryStatus(s4)).toBe('in_progress');
    // No runner created — loop is terminal
    expect(mockRunnerInstances.length).toBe(0);
  });

  // Verifies that current_story_id is included in scope (in addition
  // to active_story_ids) for the recovery queries.
  test('current_story_id is included in scoped recovery', () => {
    const prdId = uid('prd');
    const loopId = uid('loop');
    const s1 = uid('s1');
    const s2 = uid('s2');

    insertPrd(prdId);
    insertStory(s1, prdId, 'in_progress');
    insertStory(s2, prdId, 'pending');

    // Loop tracks s1 via current_story_id, s2 via active_story_ids
    insertLoop(loopId, prdId, 'running', [s2], s1);

    loopOrchestrator.listLoops();

    // Both stories should be found: s1 from current_story_id, s2 from active_story_ids
    expect(getStoryStatus(s1)).toBe('pending'); // Reset from in_progress
    expect(getStoryStatus(s2)).toBe('pending');
    expect(mockRunnerInstances.length).toBe(1);
  });

  // Verifies that paused loops with pending work scoped to them get 'failed'
  // terminal status (paused + zombie + has work = lost runner).
  test('paused zombie with scoped pending work gets failed status', () => {
    const prdId = uid('prd');
    const loopId = uid('loop');
    const s1 = uid('s1');
    const s2 = uid('s2');

    insertPrd(prdId);
    insertStory(s1, prdId, 'pending');
    insertStory(s2, prdId, 'completed');

    insertLoop(loopId, prdId, 'paused', [s1, s2]);

    loopOrchestrator.listLoops();

    // Paused with pending work → 'failed' (loop runner lost)
    expect(getLoopStatus(loopId)).toBe('failed');
  });
});
