/**
 * Pure helper functions for loop conversation navigation decisions.
 *
 * Extracted from loop.svelte.ts so the core logic can be unit-tested
 * without Svelte runes.
 */

/** Inputs for deciding whether a story_started event should auto-navigate. */
export interface StoryNavInput {
  /** Whether the event includes a conversationId to navigate to. */
  hasConversationId: boolean;
  /** Whether the user manually navigated away from the loop conversation. */
  userManuallyNavigated: boolean;
  /** Whether the loop is running in parallel mode (maxParallel > 1). */
  isParallel: boolean;
  /** Whether we already auto-navigated for a previous story in this parallel run. */
  parallelHasNavigated: boolean;
}

/** Result of the navigation decision. */
export interface StoryNavResult {
  /** Whether to call navigateToLoopConversation. */
  shouldNavigate: boolean;
  /** Updated value for the parallelHasNavigated flag. */
  parallelHasNavigated: boolean;
}

/**
 * Determine whether a story_started event should auto-navigate the chat pane.
 *
 * - Serial mode: always navigate (unchanged legacy behaviour).
 * - Parallel mode: only navigate for the very first story to avoid rapidly
 *   flipping the chat pane between conversations.
 * - Never navigate if the event has no conversationId or if the user manually
 *   selected a different conversation.
 */
export function shouldNavigateOnStoryStarted(input: StoryNavInput): StoryNavResult {
  // No conversation to navigate to, or user has manually navigated away.
  if (!input.hasConversationId || input.userManuallyNavigated) {
    return { shouldNavigate: false, parallelHasNavigated: input.parallelHasNavigated };
  }

  // Serial mode: always navigate.
  if (!input.isParallel) {
    return { shouldNavigate: true, parallelHasNavigated: input.parallelHasNavigated };
  }

  // Parallel mode: only navigate for the first story.
  if (!input.parallelHasNavigated) {
    return { shouldNavigate: true, parallelHasNavigated: true };
  }

  return { shouldNavigate: false, parallelHasNavigated: true };
}
