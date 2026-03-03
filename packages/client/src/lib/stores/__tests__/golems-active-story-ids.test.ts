/**
 * Tests for the activeStoryIds threading through golem sync.
 *
 * Tests the pure determineSyncPhase() helper which encapsulates the core
 * phase/mood/thought logic used by syncFromLoopState(). This approach avoids
 * Svelte 5 runes compilation issues in the test environment.
 */
import { describe, test, expect } from 'vitest';
import { determineSyncPhase, type SyncPhaseInput } from '../golem-sync-helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal SyncPhaseInput for testing. Callers override only what matters. */
function makeInput(overrides: Partial<SyncPhaseInput> = {}): SyncPhaseInput {
  return {
    status: 'running',
    currentStoryId: null,
    currentStoryTitle: null,
    activeStoryIds: [],
    storiesCompleted: 0,
    storiesFailed: 0,
    existingPhase: 'idle',
    ...overrides,
  };
}

// ===========================================================================
// AC-1 & AC-2: activeStoryIds determines active work status
// ===========================================================================
describe('AC-1 & AC-2: activeStoryIds determines golem is actively working', () => {
  // When there are active story IDs (parallel mode) but no currentStoryId,
  // the golem should be in "implementing" phase, not "selecting_story".
  test('parallel: activeStoryIds non-empty → phase is implementing', () => {
    const result = determineSyncPhase(
      makeInput({
        activeStoryIds: ['story-a', 'story-b'],
        status: 'running',
      }),
    );
    expect(result.phase).toBe('implementing');
    expect(result.mood).toBe('focused');
  });

  // When no stories are active at all, the golem should be selecting_story.
  test('no active stories and no currentStoryId → phase is selecting_story', () => {
    const result = determineSyncPhase(
      makeInput({
        currentStoryId: null,
        activeStoryIds: [],
        status: 'running',
      }),
    );
    expect(result.phase).toBe('selecting_story');
    expect(result.thought).toBe('Scanning backlog...');
  });

  // With multiple parallel stories, the thought message should reflect count.
  test('multiple activeStoryIds → thought reflects parallel count', () => {
    const result = determineSyncPhase(
      makeInput({
        activeStoryIds: ['story-a', 'story-b', 'story-c'],
        status: 'running',
      }),
    );
    expect(result.thought).toBe('Working on 3 stories in parallel...');
  });

  // With a single activeStoryId and a currentStoryTitle, the thought uses the title.
  test('single activeStoryId with title → thought uses story title', () => {
    const result = determineSyncPhase(
      makeInput({
        currentStoryId: 'story-a',
        currentStoryTitle: 'Add login page',
        activeStoryIds: ['story-a'],
        status: 'running',
      }),
    );
    expect(result.thought).toBe('Working on "Add login page"...');
  });

  // With single activeStoryId but no title, uses generic fallback.
  test('single activeStoryId without title → generic thought', () => {
    const result = determineSyncPhase(
      makeInput({
        currentStoryId: null,
        currentStoryTitle: null,
        activeStoryIds: ['story-a'],
        status: 'running',
      }),
    );
    expect(result.thought).toBe('Working on a story...');
  });
});

// ===========================================================================
// AC-3: Parallel mode – phase never reverts to selecting_story while active
// ===========================================================================
describe('AC-3: phase never reverts to selecting_story while activeStoryIds non-empty', () => {
  // When activeStoryIds is non-empty, phase must be implementing regardless
  // of currentStoryId being null (this is the core parallel-mode fix).
  test('null currentStoryId with non-empty activeStoryIds → implementing', () => {
    const result = determineSyncPhase(
      makeInput({
        currentStoryId: null,
        activeStoryIds: ['story-a', 'story-b'],
        status: 'running',
      }),
    );
    expect(result.phase).toBe('implementing');
    expect(result.phase).not.toBe('selecting_story');
  });

  // Repeated calls with activeStoryIds should always return implementing.
  test('repeated calls with activeStoryIds always return implementing', () => {
    for (let i = 0; i < 5; i++) {
      const result = determineSyncPhase(
        makeInput({
          currentStoryId: null,
          activeStoryIds: ['story-x'],
          status: 'running',
          existingPhase: i === 0 ? 'idle' : 'implementing',
        }),
      );
      expect(result.phase).toBe('implementing');
    }
  });

  // Only when activeStoryIds becomes empty should selecting_story be possible.
  test('selecting_story possible once activeStoryIds emptied', () => {
    const withActive = determineSyncPhase(
      makeInput({ activeStoryIds: ['story-a'], status: 'running' }),
    );
    expect(withActive.phase).toBe('implementing');

    const withoutActive = determineSyncPhase(
      makeInput({ activeStoryIds: [], currentStoryId: null, status: 'running' }),
    );
    expect(withoutActive.phase).toBe('selecting_story');
  });
});

// ===========================================================================
// AC-4: Serial mode – behavior unchanged (falls back to currentStoryId)
// ===========================================================================
describe('AC-4: serial mode unchanged — uses currentStoryId', () => {
  // In serial mode, activeStoryIds is empty. The golem should use
  // currentStoryId to determine if it's actively working.
  test('serial: currentStoryId set → phase is implementing', () => {
    const result = determineSyncPhase(
      makeInput({
        currentStoryId: 'story-serial',
        currentStoryTitle: 'Serial Story',
        activeStoryIds: [],
        status: 'running',
      }),
    );
    expect(result.phase).toBe('implementing');
    expect(result.thought).toBe('Working on "Serial Story"...');
  });

  // In serial mode with no current story, shows selecting_story.
  test('serial: no currentStoryId → phase is selecting_story', () => {
    const result = determineSyncPhase(
      makeInput({
        currentStoryId: null,
        activeStoryIds: [],
        status: 'running',
      }),
    );
    expect(result.phase).toBe('selecting_story');
  });

  // Serial mode should compute mood correctly based on failure ratio.
  test('serial: more failures than completions → determined mood', () => {
    const result = determineSyncPhase(
      makeInput({
        currentStoryId: 'story-x',
        currentStoryTitle: 'Story X',
        activeStoryIds: [],
        storiesCompleted: 1,
        storiesFailed: 3,
        status: 'running',
      }),
    );
    expect(result.mood).toBe('determined');
  });

  // Serial mode should compute mood correctly for successful runs.
  test('serial: more completions than failures → focused mood', () => {
    const result = determineSyncPhase(
      makeInput({
        currentStoryId: 'story-x',
        currentStoryTitle: 'Story X',
        activeStoryIds: [],
        storiesCompleted: 5,
        storiesFailed: 1,
        status: 'running',
      }),
    );
    expect(result.mood).toBe('focused');
  });
});

// ===========================================================================
// AC-5: SSE event-driven phase updates take priority over sync-based phase
// ===========================================================================
describe('AC-5: SSE events take priority over sync-based phase', () => {
  // When existing phase is backlog_empty (set by SSE golem_thought),
  // a subsequent sync with no active stories should preserve it.
  test('backlog_empty preserved when no active stories', () => {
    const result = determineSyncPhase(
      makeInput({
        currentStoryId: null,
        activeStoryIds: [],
        status: 'running',
        existingPhase: 'backlog_empty',
      }),
    );
    expect(result.phase).toBe('backlog_empty');
    // thought is empty to signal "keep existing thought"
    expect(result.thought).toBe('');
  });

  // When existing phase is backlog_empty but now there ARE active stories,
  // the sync should correctly override to implementing (new stories appeared).
  test('backlog_empty overridden when activeStoryIds become non-empty', () => {
    const result = determineSyncPhase(
      makeInput({
        currentStoryId: null,
        activeStoryIds: ['story-new'],
        status: 'running',
        existingPhase: 'backlog_empty',
      }),
    );
    expect(result.phase).toBe('implementing');
  });

  // Other existing phases (not backlog_empty) are overwritten by sync.
  test('non-backlog_empty existing phases are overwritten by sync', () => {
    const result = determineSyncPhase(
      makeInput({
        currentStoryId: null,
        activeStoryIds: [],
        status: 'running',
        existingPhase: 'implementing', // stale phase from previous SSE
      }),
    );
    // Should become selecting_story, not stay implementing
    expect(result.phase).toBe('selecting_story');
  });
});

// ===========================================================================
// Terminal status phases
// ===========================================================================
describe('terminal status phases', () => {
  // Paused status should yield idle phase.
  test('paused → idle', () => {
    const result = determineSyncPhase(makeInput({ status: 'paused' }));
    expect(result.phase).toBe('idle');
    expect(result.mood).toBe('neutral');
  });

  // Completed status should yield celebrating phase.
  test('completed → celebrating', () => {
    const result = determineSyncPhase(makeInput({ status: 'completed' }));
    expect(result.phase).toBe('celebrating');
    expect(result.mood).toBe('excited');
  });

  // Completed with failures should yield idle phase with relieved mood.
  test('completed_with_failures → idle, relieved', () => {
    const result = determineSyncPhase(makeInput({ status: 'completed_with_failures' }));
    expect(result.phase).toBe('idle');
    expect(result.mood).toBe('relieved');
  });

  // Failed status should yield idle phase with frustrated mood.
  test('failed → idle, frustrated', () => {
    const result = determineSyncPhase(makeInput({ status: 'failed' }));
    expect(result.phase).toBe('idle');
    expect(result.mood).toBe('frustrated');
  });
});
