/**
 * Tests for the parallel-mode conversation navigation guard.
 *
 * Tests the pure shouldNavigateOnStoryStarted() helper which encapsulates the
 * decision logic used by the story_started event handler in loop.svelte.ts.
 * This approach avoids Svelte 5 runes compilation issues in the test environment.
 */
import { describe, test, expect } from 'vitest';
import { shouldNavigateOnStoryStarted, type StoryNavInput } from '../loop-nav-helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a default StoryNavInput. Callers override only what matters. */
function makeInput(overrides: Partial<StoryNavInput> = {}): StoryNavInput {
  return {
    hasConversationId: true,
    userManuallyNavigated: false,
    isParallel: false,
    parallelHasNavigated: false,
    ...overrides,
  };
}

// ===========================================================================
// AC-1: In parallel mode, story_started does NOT switch after the first story
// ===========================================================================
describe('AC-1: parallel mode only navigates on first story_started', () => {
  // First story in parallel mode should navigate.
  test('first story → shouldNavigate is true', () => {
    const result = shouldNavigateOnStoryStarted(
      makeInput({ isParallel: true, parallelHasNavigated: false }),
    );
    expect(result.shouldNavigate).toBe(true);
    expect(result.parallelHasNavigated).toBe(true);
  });

  // Second story in parallel mode should NOT navigate.
  test('second story → shouldNavigate is false', () => {
    const result = shouldNavigateOnStoryStarted(
      makeInput({ isParallel: true, parallelHasNavigated: true }),
    );
    expect(result.shouldNavigate).toBe(false);
    expect(result.parallelHasNavigated).toBe(true);
  });

  // Simulates dispatching 5 stories in parallel — only the first navigates.
  test('sequence of 5 stories → only first navigates', () => {
    let parallelHasNavigated = false;
    const results: boolean[] = [];

    for (let i = 0; i < 5; i++) {
      const result = shouldNavigateOnStoryStarted(
        makeInput({ isParallel: true, parallelHasNavigated }),
      );
      results.push(result.shouldNavigate);
      parallelHasNavigated = result.parallelHasNavigated;
    }

    expect(results).toEqual([true, false, false, false, false]);
    expect(parallelHasNavigated).toBe(true);
  });
});

// ===========================================================================
// AC-2: In serial mode, conversation switching is unchanged
// ===========================================================================
describe('AC-2: serial mode always navigates on story_started', () => {
  // Serial mode should always navigate to the new conversation.
  test('serial mode: always navigate', () => {
    const result = shouldNavigateOnStoryStarted(makeInput({ isParallel: false }));
    expect(result.shouldNavigate).toBe(true);
  });

  // Serial mode navigates repeatedly for multiple stories.
  test('serial mode: multiple stories all navigate', () => {
    for (let i = 0; i < 3; i++) {
      const result = shouldNavigateOnStoryStarted(makeInput({ isParallel: false }));
      expect(result.shouldNavigate).toBe(true);
    }
  });

  // parallelHasNavigated flag is irrelevant in serial mode.
  test('serial mode: parallelHasNavigated flag is not mutated', () => {
    const result = shouldNavigateOnStoryStarted(
      makeInput({ isParallel: false, parallelHasNavigated: false }),
    );
    expect(result.shouldNavigate).toBe(true);
    expect(result.parallelHasNavigated).toBe(false);
  });
});

// ===========================================================================
// AC-4: No navigation if user manually selected a different conversation
// ===========================================================================
describe('AC-4: user manual navigation prevents auto-switch', () => {
  // Serial mode: no navigation when user has manually navigated away.
  test('serial: userManuallyNavigated → no navigation', () => {
    const result = shouldNavigateOnStoryStarted(
      makeInput({ isParallel: false, userManuallyNavigated: true }),
    );
    expect(result.shouldNavigate).toBe(false);
  });

  // Parallel mode: no navigation when user has manually navigated away,
  // even if this would be the first story.
  test('parallel: userManuallyNavigated → no navigation even for first story', () => {
    const result = shouldNavigateOnStoryStarted(
      makeInput({ isParallel: true, parallelHasNavigated: false, userManuallyNavigated: true }),
    );
    expect(result.shouldNavigate).toBe(false);
    // parallelHasNavigated should NOT flip because we didn't navigate.
    expect(result.parallelHasNavigated).toBe(false);
  });
});

// ===========================================================================
// Edge cases
// ===========================================================================
describe('edge cases', () => {
  // No conversationId in the event — never navigate regardless of mode.
  test('no conversationId → no navigation (serial)', () => {
    const result = shouldNavigateOnStoryStarted(
      makeInput({ hasConversationId: false, isParallel: false }),
    );
    expect(result.shouldNavigate).toBe(false);
  });

  // No conversationId in parallel mode.
  test('no conversationId → no navigation (parallel)', () => {
    const result = shouldNavigateOnStoryStarted(
      makeInput({ hasConversationId: false, isParallel: true }),
    );
    expect(result.shouldNavigate).toBe(false);
  });

  // Both flags set (no conversationId + user navigated) — still no navigation.
  test('no conversationId + userManuallyNavigated → no navigation', () => {
    const result = shouldNavigateOnStoryStarted(
      makeInput({ hasConversationId: false, userManuallyNavigated: true }),
    );
    expect(result.shouldNavigate).toBe(false);
  });
});
