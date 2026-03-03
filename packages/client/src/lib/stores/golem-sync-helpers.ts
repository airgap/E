/**
 * Pure helper functions for golem phase/mood/thought determination.
 *
 * Extracted from golems.svelte.ts so the core logic can be unit-tested
 * without Svelte runes.
 */

import type { GolemPhase, GolemMood } from '@e/shared';

/** Inputs used to determine golem phase, mood, and thought during sync. */
export interface SyncPhaseInput {
  status: string;
  currentStoryId: string | null;
  currentStoryTitle: string | null;
  activeStoryIds: string[];
  storiesCompleted: number;
  storiesFailed: number;
  /** The golem's current phase (needed to preserve SSE-driven backlog_empty). */
  existingPhase: GolemPhase;
}

/** Output of the phase determination logic. */
export interface SyncPhaseOutput {
  phase: GolemPhase;
  mood: GolemMood;
  thought: string;
}

/**
 * Determine the golem's phase, mood, and thought based on loop sync state.
 *
 * Key design decisions:
 * - `activeStoryIds.length > 0` means stories are running (parallel mode),
 *   even when `currentStoryId` is null.
 * - In serial mode, falls back to `currentStoryId`.
 * - SSE-driven `backlog_empty` phase is preserved (not overwritten by sync).
 */
export function determineSyncPhase(input: SyncPhaseInput): SyncPhaseOutput {
  const {
    status,
    currentStoryId,
    currentStoryTitle,
    activeStoryIds,
    storiesCompleted,
    storiesFailed,
    existingPhase,
  } = input;

  // Determine if any stories are actively running (serial or parallel)
  const hasActiveStories = !!currentStoryId || activeStoryIds.length > 0;

  if (status === 'running') {
    const mood: GolemMood = storiesFailed > storiesCompleted ? 'determined' : 'focused';

    if (hasActiveStories) {
      let thought: string;
      if (activeStoryIds.length > 1) {
        thought = `Working on ${activeStoryIds.length} stories in parallel...`;
      } else {
        thought = currentStoryTitle
          ? `Working on "${currentStoryTitle}"...`
          : 'Working on a story...';
      }
      return { phase: 'implementing', mood, thought };
    }

    // No active stories — check if SSE already set backlog_empty
    if (existingPhase === 'backlog_empty') {
      // Preserve existing phase/thought (SSE takes priority)
      return { phase: 'backlog_empty', mood, thought: '' };
    }
    return { phase: 'selecting_story', mood, thought: 'Scanning backlog...' };
  }

  if (status === 'paused') {
    return { phase: 'idle', mood: 'neutral', thought: 'Paused... waiting for instructions' };
  }

  if (status === 'completed') {
    return { phase: 'celebrating', mood: 'excited', thought: 'All done!' };
  }

  if (status === 'completed_with_failures') {
    return { phase: 'idle', mood: 'relieved', thought: 'Finished, but some stories had issues' };
  }

  if (status === 'failed') {
    return { phase: 'idle', mood: 'frustrated', thought: 'Loop ended with failures' };
  }

  // Fallback for unexpected status
  return { phase: 'idle', mood: 'neutral', thought: '' };
}
