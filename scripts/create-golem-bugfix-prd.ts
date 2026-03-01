/**
 * Script to create the "Golem / Loop System Bug Fixes & Improvements" PRD.
 * Run with: bun scripts/create-golem-bugfix-prd.ts
 */

import { Database } from 'bun:sqlite';
import { join } from 'path';
import { homedir } from 'os';

function nanoid(len: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  for (const b of bytes) result += chars[b % chars.length];
  return result;
}

const DB_PATH = Bun.env.E_DB_PATH || join(homedir(), '.e', 'e.db');
const db = new Database(DB_PATH);
db.exec('PRAGMA journal_mode=WAL');
db.exec('PRAGMA foreign_keys=ON');

const prdId = nanoid(12);
const now = Date.now();
const workspacePath = '/raid/E';

// Create PRD
db.query(
  `INSERT INTO prds (id, workspace_path, name, description, branch_name, quality_checks, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
).run(
  prdId,
  workspacePath,
  'Golem / Loop System Bug Fixes & Improvements',
  `Fix bugs and improve reliability across the golem/loop subsystem — covering the parallel scheduler, serial runner, client-side golem store, SSE event handling, tab management, and UI components.

Key areas:
1. Parallel scheduler: Promise.all slot blocking, TOCTOU counter race, missing cancellation propagation, hardcoded base branch
2. Serial runner: story_started timing, cancel event gaps
3. Client golem store: single currentStoryId in parallel mode, phase clobbering from syncFromLoopState, quality check data loss
4. SSE & loop store: conversation rapid-switching in parallel, reconnect state gaps, completed_with_failures handling
5. Tab management: golem-tasks tab rendering in secondary panes, missing icon/tooltip, move-to-pane data loss
6. UI components: typewriter timer leaks, missing CSS classes, empty completed state, deprecated syntax`,
  null,
  JSON.stringify([
    {
      id: nanoid(8),
      type: 'typecheck',
      name: 'Typecheck',
      command: 'bun run check',
      timeout: 60000,
      required: true,
      enabled: true,
    },
  ]),
  now,
  now,
);

// Stories definition
interface StoryDef {
  title: string;
  description: string;
  acceptanceCriteria: string[];
  priority: 'critical' | 'high' | 'medium' | 'low';
  dependsOn?: number[]; // indices into stories array (resolved after all IDs created)
}

const stories: StoryDef[] = [
  // ── Group A: Original Bugs (the two reported by user) ──

  // 0
  {
    title: 'Thread activeStoryIds Through Client Golem Sync',
    description:
      'The client golem store uses a single `currentStoryId` to determine phase, but in parallel mode the parallel-scheduler never writes `current_story_id` to the DB — it writes `activeStoryIds` instead. This causes `syncFromLoopState()` to reset the golem to "Scanning backlog" even while multiple stories are actively running. Fix: thread `activeStoryIds` through `syncGolemFromLoop → syncFromLoopState` and use it in phase logic so the golem knows stories are active even when `currentStoryId` is null. No schema or server changes needed — `activeStoryIds` already exists in the DB and shared types.',
    acceptanceCriteria: [
      '`syncGolemFromLoop` reads `activeStoryIds` from the loop state and passes it to `syncFromLoopState`',
      '`syncFromLoopState` uses `activeStoryIds.length > 0` to determine the golem is actively working (not idle/scanning)',
      'In parallel mode, the golem phase never reverts to "selecting_story" while `activeStoryIds` is non-empty',
      'In serial mode, behavior is unchanged (falls back to `currentStoryId`)',
      'SSE event-driven phase updates still take priority over sync-based phase',
    ],
    priority: 'critical',
  },

  // 1
  {
    title: 'Fix Golem Tasks Tab Focus and Rendering',
    description:
      'The "Tasks: foo" tab has multiple issues: (1) `openGolemTasksTab` always uses `activePaneId` rather than the clicked pane, so clicking "Watch Tasks" from sidebar while a different pane is focused opens the tab in the wrong pane. (2) Secondary panes (index > 0) cannot render `golem-tasks` tab kind — they show "Open a file from the sidebar" placeholder instead. (3) Missing tooltip for `golem-tasks` tab kind in PrimaryTabBar. (4) No dedicated icon case for `golem-tasks` — falls through to generic chat bubble.',
    acceptanceCriteria: [
      '`openGolemTasksTab` opens or focuses the tab in the correct pane (search all panes first, then use activePaneId for new tabs)',
      'Secondary split panes can render `golem-tasks` tab kind (not just pane index 0)',
      'PrimaryTabBar shows a descriptive tooltip for golem-tasks tabs',
      'PrimaryTabBar shows a dedicated icon for golem-tasks tabs (not the generic chat bubble)',
      '`setActiveTab` logs a warning (dev only) when tab is not found in pane, instead of silently failing',
    ],
    priority: 'critical',
  },

  // ── Group B: Parallel Scheduler Correctness ──

  // 2
  {
    title: 'Replace Promise.all with Incremental Settlement in Parallel Scheduler',
    description:
      '`waitForBatch` in `parallel-scheduler.ts` uses `Promise.all` to wait for all in-flight stories. This means if story A finishes in 1 minute but story B takes 10 minutes, story A\'s slot cannot be reused for 9 minutes and its merge happens against a potentially stale base. Replace with an incremental "settle one at a time" pattern using `Promise.race` so each story is processed as soon as it completes, freeing its slot immediately for the next story in the backlog.',
    acceptanceCriteria: [
      '`waitForBatch` processes story results incrementally as each promise settles, not all-at-once',
      'Freed slots are immediately available for dispatching new stories from the backlog',
      'Story merge happens as soon as execution completes, not after the entire batch finishes',
      'Error handling per-story is preserved — one story failing does not block others',
      'The batch loop continues until all dispatched stories have settled',
    ],
    priority: 'high',
  },

  // 3
  {
    title: 'Fix TOCTOU Race in incrementCompleted / incrementFailed',
    description:
      '`incrementCompleted` and `incrementFailed` in `parallel-scheduler.ts` read the current counter from the DB, add 1, and write it back in two separate queries. When two stories complete near-simultaneously, both read the same value and one increment is lost. Use an atomic SQL update: `UPDATE loops SET total_stories_completed = total_stories_completed + 1`.',
    acceptanceCriteria: [
      '`incrementCompleted` uses a single atomic SQL UPDATE with `total_stories_completed = total_stories_completed + 1`',
      '`incrementFailed` uses a single atomic SQL UPDATE with `total_stories_failed = total_stories_failed + 1`',
      'No intermediate SELECT is needed for the counter value',
      'The updated counter value is returned for logging/event emission if needed',
    ],
    priority: 'high',
  },

  // 4
  {
    title: 'Propagate Cancellation to In-Flight Story Executions',
    description:
      'When a parallel loop is cancelled, `waitForBatch` breaks out of the result-processing loop but does not cancel in-flight `dispatcher.execute()` calls — agent processes keep running in the background. The GolemDispatcher already has a `cancel(executionId)` method. Wire it up: when `isCancelled()` returns true, iterate `activeExecutions` and call `dispatcher.cancel()` for each.',
    acceptanceCriteria: [
      'When `isCancelled()` is detected in the parallel scheduler, all active execution IDs are cancelled via `dispatcher.cancel()`',
      'In-flight agent processes receive the cancellation signal and stop',
      'The cancellation is best-effort — if an execution has already completed, the cancel call is a no-op',
      'Active story IDs are cleared from the DB after cancellation',
      'Each cancelled story is marked with an appropriate status (not left as in_progress)',
    ],
    priority: 'high',
  },

  // 5
  {
    title: 'Fix Hardcoded dev Base Branch in ensureWorktree',
    description:
      '`ensureWorktree` in `parallel-scheduler.ts` hardcodes `\'dev\'` as the base branch when creating new worktrees. Projects using `main` or other branch names get worktrees branched from the wrong base. Read the actual base branch from the loop/PRD config or detect the repository default branch.',
    acceptanceCriteria: [
      'New worktrees use the PRD\'s `branchName` (if set) or the repository\'s default branch (detected via git) instead of hardcoded `\'dev\'`',
      'Existing worktree retry path still uses `existingRecord.base_branch` as fallback',
      'If no branch can be determined, fall back to `\'main\'` (not `\'dev\'`)',
    ],
    priority: 'medium',
  },

  // 6
  {
    title: 'Bound modifiedFilesCache and conflictHistory Growth',
    description:
      '`modifiedFilesCache` and `conflictHistory` in the parallel scheduler grow without bounds as stories succeed or fail across retry cycles. For PRDs with hundreds of stories, this becomes significant. Add cleanup: evict entries for stories that have been merged successfully and are no longer relevant for conflict prediction.',
    acceptanceCriteria: [
      '`modifiedFilesCache` entries are evicted for stories that have been successfully merged and have no pending retries',
      '`conflictHistory` is pruned after each batch — entries older than the current iteration are removed',
      'The caches remain populated for stories that are still relevant for conflict prediction',
      'Memory usage is bounded proportionally to active (non-completed) stories',
    ],
    priority: 'low',
  },

  // ── Group C: Serial Runner ──

  // 7
  {
    title: 'Emit story_started Before Execution in Serial Mode',
    description:
      'In serial mode, `runner.ts` emits `story_started` at line 931 AFTER `dispatcher.execute()` returns. The client doesn\'t know a story started until the agent is already done — the golem shows "Summoning agent…" for the entire execution. The parallel scheduler correctly emits `story_started` before execution. Fix the serial path to match: emit `story_started` before calling `dispatcher.execute()`.',
    acceptanceCriteria: [
      '`story_started` event is emitted BEFORE `dispatcher.execute()` in the serial path',
      'The event includes the story ID, title, and conversation ID',
      'The client sees the golem transition to "implementing" phase as soon as the story begins, not after it completes',
      'If execution fails immediately, the story_started event was still emitted (consistent with parallel behavior)',
    ],
    priority: 'high',
  },

  // 8
  {
    title: 'Fix Cancel Path Event Emission in Runner',
    description:
      'Both serial and parallel cancel paths in `runner.ts` update the DB to `cancelled` and emit `loop_done`, but neither emits a `cancelled` SSE event. The client relies on the orchestrator to emit it separately, creating a race. The runner should emit `cancelled` event itself for consistency, and the orchestrator should not duplicate it.',
    acceptanceCriteria: [
      'Serial cancel path emits a `cancelled` SSE event before `loop_done`',
      'Parallel cancel path emits a `cancelled` SSE event before `loop_done`',
      'The orchestrator\'s `cancelLoop` does not duplicate the `cancelled` event (or the client deduplicates)',
      'Client receives exactly one `cancelled` event per cancellation',
    ],
    priority: 'medium',
  },

  // ── Group D: Client State Consistency ──

  // 9
  {
    title: 'Track Quality Checks Per-Story Instead of Per-Golem',
    description:
      'Quality checks are stored as `g.qualityChecks` on the golem object. In parallel mode, each `story_started` event clears the array, so story B starting wipes story A\'s quality check results. Change to a per-story Map so quality check results for all active stories are preserved simultaneously.',
    acceptanceCriteria: [
      'Quality checks are stored per-story (e.g., `Map<storyId, QualityCheck[]>`) instead of a flat array on the golem',
      '`story_started` only initializes quality checks for the new story, not clearing other stories',
      'Quality check events are routed to the correct story\'s check array',
      'The GolemTasksView displays quality checks per-story in parallel mode',
      'In serial mode, behavior is unchanged (only one story active at a time)',
    ],
    priority: 'high',
    dependsOn: [0],
  },

  // 10
  {
    title: 'Fix completed_with_failures Not Reflected in Loop Store',
    description:
      '`handleLoopEvent` in `loop.svelte.ts` maps the `completed` event to `status: \'completed\'` regardless of whether it was a partial success. The `completed_with_failures` distinction is lost. A comment says "check DB on next poll" but SSE disconnects at that point, so the poll never happens. Parse the event message or add a `partial` flag to the event to distinguish full vs partial completion.',
    acceptanceCriteria: [
      'The loop store correctly reflects `completed_with_failures` status when the loop ends with some story failures',
      'The UI shows a visual distinction between full completion and partial completion (different status badge/color)',
      'The status is set from the SSE event directly — no reliance on a follow-up DB poll that may never happen',
    ],
    priority: 'medium',
  },

  // 11
  {
    title: 'Stop Parallel story_started from Rapidly Switching Active Conversation',
    description:
      'Every `story_started` event calls `navigateToLoopConversation` in `loop.svelte.ts`, which sets the active conversation in the main chat pane. In parallel mode, this causes the chat view to rapidly flip between conversations as stories are dispatched. Only navigate on the first story, or only in serial mode.',
    acceptanceCriteria: [
      'In parallel mode, `story_started` does NOT switch the active conversation after the first story',
      'In serial mode, conversation switching behavior is unchanged (each new story switches)',
      'The user can manually navigate to any parallel story\'s conversation via the Tasks panel',
      'No conversation navigation happens if the user has manually selected a different conversation',
    ],
    priority: 'high',
  },

  // 12
  {
    title: 'Re-sync Golem State on SSE Reconnect',
    description:
      'When the SSE stream reconnects (`loop.svelte.ts`), `activeLoop` is refreshed from the server but `syncGolemFromLoop()` is never called. Events missed during the disconnect leave stale golem state (phase, thought, quality checks) until the next event arrives. Call `syncGolemFromLoop()` after reconnection.',
    acceptanceCriteria: [
      '`syncGolemFromLoop()` is called after successful SSE reconnection',
      'Golem state (phase, thought, activities) is refreshed from the server state, not left stale',
      'If SSE was disconnected during a phase transition, the golem shows the correct current phase after reconnect',
      'Reconnect sync does not duplicate activities or quality checks',
    ],
    priority: 'medium',
    dependsOn: [0],
  },

  // 13
  {
    title: 'Prevent syncFromLoopState from Overwriting Newer SSE Data',
    description:
      '`syncFromLoopState` overwrites the golem\'s phase, thought, activities, etc. from DB-polled data. If SSE events have already updated the golem with more recent data, the sync reverts to older state. Add a timestamp or sequence check: only apply sync data if it is newer than the last SSE event update.',
    acceptanceCriteria: [
      'Golem state tracks a `lastEventTimestamp` updated on each SSE event',
      '`syncFromLoopState` compares its data freshness against `lastEventTimestamp`',
      'If SSE data is newer, `syncFromLoopState` preserves the SSE-driven state',
      'On cold load (no prior SSE events), `syncFromLoopState` applies normally as the initial state',
      'The `backlog_empty` phase guard is generalized to cover all phases',
    ],
    priority: 'medium',
    dependsOn: [0],
  },

  // ── Group E: Tab / UI Fixes ──

  // 14
  {
    title: 'Fix Move-to-Pane Losing golem-tasks Tab Data',
    description:
      'Right-click → "Move to New Pane" on a golem-tasks tab calls `splitOpen()` which creates a plain `chat` tab, losing `kind: \'golem-tasks\'` and `loopId`. The move operation should preserve the tab\'s kind and associated metadata.',
    acceptanceCriteria: [
      '"Move to New Pane" preserves the tab\'s `kind` field (golem-tasks, looper, diff, etc.)',
      '"Move to New Pane" preserves the tab\'s metadata (`loopId`, `prdId`, `conversationId`, etc.)',
      'The moved tab renders correctly in the new pane with full functionality',
      'Other tab kinds (file, chat, diff) are also preserved correctly when moved',
    ],
    priority: 'medium',
    dependsOn: [1],
  },

  // 15
  {
    title: 'Fix Typewriter Timer Leak in GolemsPanel',
    description:
      '`GolemsPanel.svelte` creates `setInterval` timers for the typewriter effect but never cleans them up when the component is destroyed. If the panel unmounts mid-animation, intervals keep firing on a destroyed component. Add proper cleanup in `onDestroy`.',
    acceptanceCriteria: [
      'All typewriter `setInterval` timers are cleared when GolemsPanel unmounts',
      'The cleanup runs in `onDestroy` or an equivalent Svelte 5 lifecycle hook',
      'No console errors from updating state on a destroyed component',
      'Typewriter effect still works normally during component lifetime',
    ],
    priority: 'medium',
  },

  // 16
  {
    title: 'Add Missing completed_with_failures CSS Class and Empty State',
    description:
      '`GolemTasksView.svelte` has two issues: (1) `getStatusClass()` falls through to `status-idle` for `completed_with_failures` — the badge gets wrong styling. (2) When all parallel tasks complete, the view empties entirely (no history). Add the CSS class and a "recently completed" section.',
    acceptanceCriteria: [
      '`getStatusClass()` returns a dedicated CSS class for `completed_with_failures` (e.g., `status-partial` with warning color)',
      'The empty state for completed loops shows a summary: "X stories completed, Y failed" with outcome list',
      '`getStatusLabel()` and `getStatusClass()` handle all possible story statuses without fallthrough',
      'The completed state includes links to navigate to each story\'s conversation',
    ],
    priority: 'medium',
  },

  // ── Group F: Server-Side Fixes ──

  // 17
  {
    title: 'Fix cancelLoop Deleting Runner Before Async Completion',
    description:
      '`orchestrator.ts` `cancelLoop` calls `runner.cancel()` then immediately does `this.runners.delete(loopId)`. The runner is still executing asynchronously. Between cancel and completion, `getLoopState` thinks the runner doesn\'t exist. Defer the delete until the runner\'s `loop_done` event.',
    acceptanceCriteria: [
      'The runner is NOT removed from the runners map until its async execution has fully completed',
      '`getLoopState` correctly reports a "cancelling" state during the async wind-down',
      'The `loop_done` event handler removes the runner from the map',
      'No double-delete (the `loop_done` handler is idempotent)',
    ],
    priority: 'medium',
  },

  // 18
  {
    title: 'Fix loop_done Handler Leak on Client Disconnect',
    description:
      'The SSE endpoint in `loop.ts` routes registers a `.once(\'loop_done\')` handler. If the client disconnects first (abort fires), the abort handler removes the `loop_event` listener but NOT the `loop_done` listener. Orphaned handlers accumulate. Clean up both listeners on abort.',
    acceptanceCriteria: [
      'The abort handler removes BOTH the `loop_event` listener and the `loop_done` listener',
      'No orphaned event handlers accumulate when clients connect and disconnect',
      'The `loop_done` handler is a named function so it can be removed by reference',
      'If `loop_done` fires before abort, cleanup is still correct (no double-remove errors)',
    ],
    priority: 'medium',
  },

  // 19
  {
    title: 'Scope Zombie Recovery to the Specific Loop',
    description:
      '`recoverOrResumeZombieLoops` in `orchestrator.ts` resets ALL `in_progress` stories for a PRD (`WHERE prd_id = ?`), not just the ones belonging to the specific loop. If multiple loops run against the same PRD, this resets other loops\' stories. Scope the reset to the loop\'s story IDs.',
    acceptanceCriteria: [
      'Zombie recovery only resets stories that belong to the specific loop being recovered',
      'Stories from other loops against the same PRD are not affected',
      'The reset query uses the loop\'s `active_story_ids` or `current_story_id` to scope correctly',
      'If no active story IDs are recorded, falls back to the current behavior as a safety net',
    ],
    priority: 'low',
  },

  // ── Group G: Quick Fixes ──

  // 20
  {
    title: 'Fix $effect Writing to $state It Reads in GolemsPanel',
    description:
      '`GolemsPanel.svelte` has an `$effect` that both reads and writes `lastThoughts` (a `$state` variable), which can trigger re-runs. `lastThoughts` should be a plain `let` since it\'s only used as a comparison cache inside the effect, not as reactive state that drives UI.',
    acceptanceCriteria: [
      '`lastThoughts` is declared as a plain `let` (not `$state`)',
      'The `$effect` no longer re-triggers from its own writes',
      'Typewriter behavior is unchanged — thoughts still animate correctly',
    ],
    priority: 'low',
  },

  // 21
  {
    title: 'Fix Deprecated $props Syntax in GolemTaskColumn',
    description:
      '`GolemTaskColumn.svelte` uses the deprecated `$props<T>()` syntax. Update to the current Svelte 5 pattern: `let { ... }: Props = $props()`.',
    acceptanceCriteria: [
      'Props are destructured using `let { prop1, prop2 }: Props = $props()` pattern',
      'All props are correctly typed',
      'Component behavior is unchanged',
    ],
    priority: 'low',
  },
];

// Insert stories
const storyInsert = db.query(
  `INSERT INTO prd_stories (id, prd_id, title, description, acceptance_criteria, priority, depends_on, dependency_reasons, sort_order, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

const storyIds: string[] = [];
for (let i = 0; i < stories.length; i++) {
  storyIds.push(nanoid(12));
}

for (let i = 0; i < stories.length; i++) {
  const s = stories[i];
  const storyId = storyIds[i];

  const ac = s.acceptanceCriteria.map((desc) => ({
    id: nanoid(8),
    description: desc,
    passed: false,
  }));

  const dependsOn = (s.dependsOn || []).map((idx) => storyIds[idx]);
  const dependencyReasons: Record<string, string> = {};
  for (const idx of s.dependsOn || []) {
    dependencyReasons[storyIds[idx]] = `Requires "${stories[idx].title}" to be completed first`;
  }

  storyInsert.run(
    storyId,
    prdId,
    s.title,
    s.description,
    JSON.stringify(ac),
    s.priority,
    JSON.stringify(dependsOn),
    JSON.stringify(dependencyReasons),
    i,
    now,
    now,
  );
}

console.log(`\nPRD created successfully!`);
console.log(`  PRD ID: ${prdId}`);
console.log(`  Name: Golem / Loop System Bug Fixes & Improvements`);
console.log(`  Stories: ${storyIds.length}`);
console.log(`  Critical: ${stories.filter((s) => s.priority === 'critical').length}`);
console.log(`  High: ${stories.filter((s) => s.priority === 'high').length}`);
console.log(`  Medium: ${stories.filter((s) => s.priority === 'medium').length}`);
console.log(`  Low: ${stories.filter((s) => s.priority === 'low').length}`);
console.log(`\nStory IDs:`);
storyIds.forEach((id, i) => {
  const deps = (stories[i].dependsOn || [])
    .map((idx) => stories[idx].title.slice(0, 40))
    .join(', ');
  console.log(
    `  ${String(i + 1).padStart(2)}. [${stories[i].priority.toUpperCase().padEnd(8)}] ${stories[i].title}${deps ? ` (depends: ${deps})` : ''}`,
  );
});
