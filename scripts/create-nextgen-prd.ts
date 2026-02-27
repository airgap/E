/**
 * Script to create the "Agent Platform: Next-Gen Features" PRD directly in the database.
 * Run with: bun scripts/create-nextgen-prd.ts
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
const workspacePath = '/home/nicole/maude';

// Create PRD
db.query(
  `INSERT INTO prds (id, workspace_path, name, description, branch_name, quality_checks, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
).run(
  prdId,
  workspacePath,
  'Agent Platform: Next-Gen Features',
  'Comprehensive feature set inspired by Google Antigravity and Zed editor. Deduplicated from 16 raw features into 13 concrete stories across 4 phases. Phase 1 (High): Quick wins extending existing primitives. Phase 2 (Medium): Loop trust + AI interaction improvements. Phase 3 (Low): Deep platform features requiring significant architecture.',
  null,
  JSON.stringify([]),
  now,
  now,
);

// Stories definition
interface StoryDef {
  title: string;
  description: string;
  acceptanceCriteria: string[];
  priority: 'critical' | 'high' | 'medium' | 'low';
}

const stories: StoryDef[] = [
  // ── Phase 1: High Priority (Quick Wins) ──
  {
    title: 'Desktop Notifications for Background Agents',
    description:
      'When a loop story completes, fails, or needs approval while the user is in a different tab/window, fire an OS-level desktop notification (Web Notifications API) and optionally play a sound via the existing chirp engine. Should integrate with the existing StreamAudio system. Configurable: notification on completion, on failure, on approval needed. Sound already exists (chirp-engine.ts) — just need the OS notification bridge and loop event listeners.',
    acceptanceCriteria: [
      'OS desktop notification fires when a loop story completes while browser tab is not focused',
      'OS desktop notification fires when a tool approval is pending and user is not focused',
      'Notifications are configurable (on/off per event type) in settings',
      'Clicking a notification brings the user to the relevant conversation/story',
      'Existing chirp engine sound events still work alongside desktop notifications',
      'Notification permission is requested gracefully on first use',
    ],
    priority: 'high',
  },
  {
    title: 'Auto-Checkpoint Before Agent Runs + One-Click Restore',
    description:
      'Wire the existing git snapshot system to auto-trigger before every agent message send and before every loop story execution. Add a per-message restore button in the chat UI (next to each assistant message). The SnapshotModal already exists — this is about wiring auto-triggers and adding inline restore affordance. Each snapshot should store the message ID it was created for.',
    acceptanceCriteria: [
      'Git snapshot is automatically created before each sendAndStream call',
      'Git snapshot is automatically created before each loop story execution in LoopRunner',
      'Each assistant message in chat shows a subtle Restore button/icon',
      'Clicking Restore reverts to the snapshot taken before that message',
      'Snapshots are linked to message IDs in the database',
      'The existing SnapshotModal shows the enhanced snapshots with message context',
    ],
    priority: 'high',
  },
  {
    title: 'Rules Library with Active/On-Demand Toggle',
    description:
      'Enhance the existing MemoryPanel rules view. Add a dedicated Rules tab that shows all .claude/rules/*.md files and CLAUDE.md. Each rule gets an active/on-demand toggle: active rules are always injected into the system prompt, on-demand rules are available via @rule or /rule. Add a Create Rule button that creates a new .md file in .claude/rules/. Read .cursorrules, AGENTS.md, .github/copilot-instructions.md for compatibility. Store active/on-demand state in a rules metadata table.',
    acceptanceCriteria: [
      'MemoryPanel has a dedicated Rules view showing all rule files',
      'Each rule has a toggle between Active (always injected) and On-demand',
      'Active rules are injected into every conversation system prompt',
      'Create Rule button creates a new .md file in .claude/rules/ and opens it for editing',
      'Compatible rule files (.cursorrules, AGENTS.md, etc.) are discovered and shown',
      'Rules can be edited in-place in the panel',
      'On-demand rules can be injected via @rule mention',
    ],
    priority: 'high',
  },
  {
    title: 'Autonomy Tiers + Tool Permission Rules Editor',
    description:
      'Extend the existing PermissionMode system. Add server-side enforcement of per-tool PermissionRule patterns (types already exist in shared/tools.ts but are not enforced). Build a Permission Rules editor UI in Settings where users can define allow/deny/ask rules with glob patterns per tool name. Add a separate Terminal Command Policy (off/auto/turbo/custom) independent of the general autonomy level. Make permission rules configurable per-conversation and per-workspace.',
    acceptanceCriteria: [
      'Per-tool permission rules (allow/deny/ask with glob patterns) are enforced server-side',
      'Settings modal has a Permission Rules editor with add/edit/delete',
      'Terminal command policy is independently configurable (off/auto/turbo/custom)',
      'Permission rules can be scoped to session, project, or global',
      'Existing ToolApprovalDialog respects the new per-tool rules',
      'Default rule sets are provided for common workflows (e.g. safe-coding, full-auto)',
    ],
    priority: 'high',
  },
  {
    title: '@-Mention Context Injection System',
    description:
      'Implement an @-mention system in ChatInput. Typing @ opens an autocomplete menu (like the existing SlashCommandMenu pattern) with mention types: @file (browse/search project files — inject content as XML context), @symbol (search tree-sitter symbols — inject definition), @diagnostics (inject all LSP errors/warnings), @rule (inject an on-demand rule from the Rules Library), @thread (inject a prior conversation summary). Mentions render as collapsible badges in the input area. Reuse the existing buildContextPrefix pattern for injection.',
    acceptanceCriteria: [
      'Typing @ in ChatInput opens an autocomplete menu with mention types',
      'Each mention type has a secondary picker: file browser, symbol search, thread list, etc.',
      '@file injects the file content wrapped in XML context tags',
      '@symbol injects the symbol definition and location',
      '@diagnostics injects all current LSP errors and warnings',
      '@rule injects an on-demand rule from the Rules Library',
      'Selected mentions render as collapsible badges above the input showing attached context',
      'Multiple mentions can be combined in a single message',
    ],
    priority: 'high',
  },

  // ── Phase 2: Medium Priority (Loop Trust + AI Interaction) ──
  {
    title: 'Agent Profiles (Write/Ask/Minimal + Custom)',
    description:
      'Create named profiles that bundle: permissionMode + allowedTools + disallowedTools + systemPromptOverride. Ship 3 built-in profiles: Write (all tools, unrestricted), Ask (read-only tools, no file writes or terminal), Minimal (no tools, pure LLM chat). Add a profile switcher in the chat header or input bar (single click or keyboard shortcut). Users can create custom profiles from the Settings modal.',
    acceptanceCriteria: [
      'Three built-in profiles exist: Write, Ask, Minimal',
      'Profile switcher is accessible from the conversation header with one click',
      'Switching profiles updates allowedTools/disallowedTools/permissionMode for the active conversation',
      'Custom profiles can be created, edited, and deleted in Settings',
      'Each profile bundles: name, permissionMode, allowedTools, disallowedTools, optional systemPrompt',
      'Keyboard shortcut toggles between profiles',
    ],
    priority: 'medium',
  },
  {
    title: 'Thread-as-Context (@thread)',
    description:
      'Enable referencing prior conversations as context. Generate compact_summary when conversations end or are compacted. When @thread is used, show a conversation picker (recent, searchable). Inject the selected thread summary into the new conversation context. The compaction system (chat-compaction.ts) already generates summaries — extend it to be cross-thread referenceable.',
    acceptanceCriteria: [
      'Conversation summaries are generated and stored when conversations end',
      '@thread mention opens a conversation picker showing recent threads',
      'Picker supports search by conversation title and content',
      'Selected thread summary is injected as context in the current conversation',
      'Multiple threads can be referenced in one message',
      'Thread context is clearly labeled so the AI knows its provenance',
    ],
    priority: 'medium',
  },
  {
    title: 'Non-Blocking Feedback on Running Agents',
    description:
      'Allow users to send feedback/nudges to an agent mid-execution without stopping the stream. Add a lightweight feedback input that appears below the streaming message when a stream is active. Server-side: create POST /api/stream/:id/nudge that queues a message injection via the existing writeStdin mechanism. The ChatInput currently blocks sends during streaming — the nudge is an alternative path.',
    acceptanceCriteria: [
      'A nudge input appears below the streaming message when the agent is running',
      'Submitting a nudge does not stop the current stream',
      'The nudge content is queued and injected into the agent context on its next turn',
      'Server endpoint POST /api/stream/:id/nudge handles the injection',
      'Nudges are visible in the conversation history as a distinct message type',
      'Works for both regular conversations and loop story executions',
    ],
    priority: 'medium',
  },
  {
    title: 'Artifact System — Structured Agent Deliverables',
    description:
      'Replace chat-transcript-only output with structured artifacts. Define an Artifact type: { id, type, title, content, metadata, conversationId, messageId, createdAt }. Types: plan, diff, screenshot, walkthrough. Agents emit artifacts via <artifact> XML blocks (similar to <story-add> pattern). Artifacts render as interactive cards in chat. An Artifacts panel in the sidebar shows all artifacts for the workspace.',
    acceptanceCriteria: [
      'Artifact type is defined in shared types with id, type, title, content, metadata',
      'Supported artifact types: plan, diff, screenshot, walkthrough',
      'Agents can emit artifacts via XML blocks in their output',
      'Artifacts render as interactive expandable cards in chat messages',
      'An Artifacts panel in the sidebar lists all artifacts for the workspace',
      'Artifacts are stored in the database and persist across sessions',
      'Artifacts can be pinned/bookmarked for quick reference',
    ],
    priority: 'medium',
  },

  // ── Phase 3: Low Priority (Deep Platform) ──
  {
    title: 'Manager View — Cross-Workspace Agent Dashboard',
    description:
      'Create a Manager View showing all active agents, pending approvals, and completed work across all workspaces. Build on existing DigestPanel and AgentPanel. Add an Inbox section showing: pending tool approvals from any conversation, loop stories waiting for review, completed stories since last check. Show agent status (idle, running, waiting) per workspace.',
    acceptanceCriteria: [
      'Manager View is accessible as a sidebar tab or top-level route',
      'Shows all workspaces with their active agent status (idle/running/waiting)',
      'Inbox aggregates pending approvals across all workspaces and conversations',
      'Completed work section shows recently finished stories and conversations',
      'Clicking an inbox item navigates to the relevant conversation',
      'Agent status updates in real-time via SSE',
      'Works with multiple simultaneous loop runners across workspaces',
    ],
    priority: 'low',
  },
  {
    title: 'Gutter Run Buttons for Tests',
    description:
      'Add clickable run/test buttons in the CodeMirror editor gutter next to test function definitions. Use existing tree-sitter symbol data (symbolStore) to identify test functions. Create a CodeMirror StateField + gutter extension that renders play button widgets. Clicking runs the test via terminal with configurable command templates ($SYMBOL, $FILE variables).',
    acceptanceCriteria: [
      'Play button icons appear in the editor gutter next to test functions',
      'Test detection works for: Jest (describe/it/test), Vitest, Python (test_/pytest), Rust (#[test]), Go (Test*)',
      'Clicking a play button runs that specific test in the terminal',
      'Test command templates are configurable per-language in settings',
      'Command templates support $SYMBOL (function name) and $FILE (file path) variables',
      'Gutter buttons update when file content changes (tree-sitter re-parse)',
    ],
    priority: 'low',
  },
  {
    title: 'Embedded Browser Preview',
    description:
      'Add a browser panel to the IDE for visual verification of web apps. Implement as a webview/iframe panel. URL bar with navigation controls. Screenshot capture that saves to artifacts. Agent can trigger screenshots via tool call. Long-term: agent can navigate and interact for E2E verification.',
    acceptanceCriteria: [
      'Browser panel renders in the sidebar or as a docked pane',
      'URL bar with navigation controls (back, forward, refresh)',
      'Default URL detection from running dev server processes',
      'Screenshot capture button saves current view as an image artifact',
      'Agent can trigger screenshots via a tool call',
      'Panel is resizable and can be detached/reattached',
      'Basic responsive viewport controls (mobile/tablet/desktop widths)',
    ],
    priority: 'low',
  },
  {
    title: 'Multi-Cursor AI Transforms',
    description:
      'Enable applying a single AI prompt to multiple editor selections simultaneously. When user has multiple cursors active and triggers inline AI action, open a prompt input. AI receives all selections, returns per-selection transforms, applied as single undo-able CodeMirror transaction.',
    acceptanceCriteria: [
      'Keyboard shortcut activates inline AI prompt when multiple cursors are active',
      'Prompt input appears with context showing number of selections',
      'AI receives all selections as context and returns per-selection transforms',
      'Transforms are applied to all selections as a single undo-able CodeMirror transaction',
      'Works with 2+ selections across the same file',
      'Loading state shows per-selection progress',
      'Undo reverts all transforms at once',
    ],
    priority: 'low',
  },
];

// Insert stories
const storyInsert = db.query(
  `INSERT INTO prd_stories (id, prd_id, title, description, acceptance_criteria, priority, depends_on, sort_order, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

const storyIds: string[] = [];
for (let i = 0; i < stories.length; i++) {
  const s = stories[i];
  const storyId = nanoid(12);
  storyIds.push(storyId);

  const ac = s.acceptanceCriteria.map((desc) => ({
    id: nanoid(8),
    description: desc,
    passed: false,
  }));

  storyInsert.run(
    storyId,
    prdId,
    s.title,
    s.description,
    JSON.stringify(ac),
    s.priority,
    JSON.stringify([]),
    i,
    now,
    now,
  );
}

console.log(`\nPRD created successfully!`);
console.log(`  PRD ID: ${prdId}`);
console.log(`  Stories: ${storyIds.length}`);
console.log(`  High priority: ${stories.filter((s) => s.priority === 'high').length}`);
console.log(`  Medium priority: ${stories.filter((s) => s.priority === 'medium').length}`);
console.log(`  Low priority: ${stories.filter((s) => s.priority === 'low').length}`);
console.log(`\nStory IDs:`);
storyIds.forEach((id, i) => {
  console.log(`  ${i + 1}. [${stories[i].priority.toUpperCase()}] ${stories[i].title} (${id})`);
});
