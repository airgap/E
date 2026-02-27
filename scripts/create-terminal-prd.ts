/**
 * Script to create the "Fully-Featured TTY Terminal Emulator" PRD in the database.
 * Run with: bun scripts/create-terminal-prd.ts
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
  'Fully-Featured TTY Terminal Emulator',
  `Replace the minimal single-session terminal in E's bottom panel with a production-grade terminal emulator that meets and exceeds industry standards set by VS Code, Warp, iTerm2, Kitty, and Alacritty.

Current state: Single xterm.js instance, one PTY per WebSocket (killed on disconnect), no tabs, no splits, no search, no persistence, hardcoded theme. The store has 3 fields: isOpen, panelHeight, connected.

Target: Multi-session tabs, split panes, shell profiles, find-in-buffer, clickable links, session persistence, theme integration, shell integration with CWD tracking and command decorations, task runner, broadcast mode, and eventually Warp-style block output and inline images.

Architecture: Server-side SessionManager decouples PTY lifecycle from WebSocket connections. Client-side TerminalConnectionManager service keeps Terminal instances in memory across tab switches. Binary-prefix WebSocket protocol (0x00=raw data, 0x01=resize, 0x02=JSON control). Recursive split tree using existing SplitPane.svelte pattern. 5 phases across ~6 weeks, each independently shippable.`,
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
  // ── Phase 1: Multi-Session Foundation (P0 baseline) ──
  {
    title: 'Server-Side Terminal Session Manager',
    description:
      'Replace the current inline PTY spawning in terminal.ts with a persistent SessionManager that decouples PTY lifecycles from WebSocket connections. Sessions survive client disconnect. Add REST endpoints for session CRUD (POST/GET/DELETE /api/terminal/sessions) and shell detection (GET /api/terminal/shells). The SessionManager maintains a Map<id, TerminalSession> with ring buffer scrollback replay (~64KB per session), GC for orphaned sessions (30 min idle + exited), and multi-client attach support. WebSocket connects to existing sessions by ID and replays scrollback on attach. Extend the WebSocket protocol with binary-prefix framing: 0x00=raw data, 0x01=resize (backward-compatible), 0x02=JSON control messages.',
    acceptanceCriteria: [
      'SessionManager class maintains a Map of TerminalSession objects independent of WebSocket connections',
      'REST endpoint POST /api/terminal/sessions creates a new PTY session and returns sessionId, shell, pid',
      'REST endpoint GET /api/terminal/sessions lists all active sessions with metadata',
      'REST endpoint DELETE /api/terminal/sessions/:id kills a specific session',
      'REST endpoint GET /api/terminal/shells returns detected available shells with versions',
      'WebSocket /api/terminal/ws?sessionId=xxx attaches to an existing session',
      'On WebSocket attach, the server replays the scrollback ring buffer as a burst',
      'PTY sessions continue running when WebSocket disconnects',
      'GC runs every 5 minutes and kills sessions that exited + no WS attached + idle >30 min',
      'Binary-prefix protocol: 0x02 prefix sends JSON control messages (replay_start, replay_end, session_exit)',
    ],
    priority: 'critical',
  },
  {
    title: 'Shared Terminal Types',
    description:
      'Create packages/shared/src/terminal.ts with all shared types for the terminal system: ShellProfile, TerminalSessionMeta, TerminalCreateRequest, TerminalCreateResponse, TerminalControlMessage (union of replay_start, replay_end, session_exit, cwd_changed, command_start, command_end), TerminalPreferences, and the TerminalLayout tree types (TerminalLeaf, TerminalBranch) for split pane state.',
    acceptanceCriteria: [
      'ShellProfile type includes id, name, shellPath, args, env, cwd, icon fields',
      'TerminalSessionMeta type includes id, shell, pid, cwd, createdAt, lastActivity, exitCode',
      'TerminalCreateRequest/Response types match the REST API contract',
      'TerminalControlMessage is a discriminated union of all control message types',
      'TerminalLayout tree types (TerminalLeaf, TerminalBranch) support recursive splits',
      'TerminalPreferences type includes font, cursor, scrollback, bell, copy-on-select settings',
      'All types are exported from packages/shared/src/index.ts',
    ],
    priority: 'critical',
  },
  {
    title: 'Client Terminal Connection Manager',
    description:
      'Create packages/client/src/lib/services/terminal-connection.ts — an imperative service (not a store) that owns all WebSocket connections and xterm.js Terminal instances. Terminal instances persist in memory across tab switches using detachFromContainer/attachToContainer (moving the DOM element without recreating the Terminal). Install and integrate @xterm/addon-search, @xterm/addon-web-links, @xterm/addon-unicode11, @xterm/addon-clipboard. Handles binary-prefix protocol parsing for control messages.',
    acceptanceCriteria: [
      'TerminalConnectionManager class maintains a Map of connections keyed by sessionId',
      'createSession(profile) calls REST API to create session, then opens WebSocket and creates Terminal instance',
      'attachToContainer(sessionId, el) mounts the Terminal to a DOM element without recreating it',
      'detachFromContainer(sessionId) unmounts the Terminal from its DOM element while keeping it alive in memory',
      'destroySession(sessionId) closes WebSocket and disposes Terminal',
      'SearchAddon is loaded per terminal — search(sessionId, query, opts) delegates to it',
      'WebLinksAddon is loaded per terminal — URLs in output are clickable',
      'Unicode11Addon is loaded per terminal — emoji and wide chars render correctly',
      'WebGL addon is loaded with canvas fallback per terminal',
      'Binary-prefix protocol: 0x02 messages are parsed and emitted as typed events',
    ],
    priority: 'critical',
    dependsOn: [0, 1],
  },
  {
    title: 'Multi-Tab Terminal Store',
    description:
      'Rewrite packages/client/src/lib/stores/terminal.svelte.ts from 3 fields to full multi-tab state. Track tabs (TerminalTab[]), activeTabId, sessions (Map<string, SessionMeta>), profiles (ShellProfile[]), preferences (TerminalPreferences). Methods: createTab/closeTab/activateTab/renameTab/cycleTab, panel lifecycle (toggle/open/close/maximize), session tracking (register/unregister/setCwd/setExitCode), preferences, search toggle, broadcast toggle. Persist tab state and preferences to localStorage. Extend WorkspaceSnapshot in workspace.svelte.ts with terminalTabs, terminalActiveTabId, terminalPreferences, terminalMaximized.',
    acceptanceCriteria: [
      'Store manages tabs array with TerminalTab objects (id, label, layout, focusedSessionId)',
      'createTab(profileId?) creates a new tab with a leaf layout pointing to a new session',
      'closeTab(tabId) closes the tab and destroys its session(s)',
      'activateTab/cycleTab switches the visible terminal',
      'renameTab(tabId, label) updates the tab display name',
      'preferences (font, cursor, scrollback, bell) are reactive and persisted to localStorage',
      'WorkspaceSnapshot extended with terminalTabs, terminalActiveTabId, terminalPreferences',
      'restoreState correctly rebuilds tabs and reconnects to surviving sessions on workspace switch',
      'Derived state: activeTab, activeSessionId, tabCount',
      'Maximize state hides .main-content-upper when true',
    ],
    priority: 'critical',
    dependsOn: [1],
  },
  {
    title: 'Terminal Panel Component Decomposition',
    description:
      'Decompose the monolithic TerminalPanel.svelte (240 lines) into a component tree: TerminalPanel (shell) → TerminalHeader (TerminalTabBar + TerminalActions) + TerminalContent → TerminalInstance (single xterm.js viewport). TerminalTabBar shows tabs with shell icon, title, close button, and a + button with shell profile dropdown. TerminalActions shows search toggle, split buttons, kill, maximize. TerminalInstance wraps a single xterm.js viewport using the ConnectionManager for attach/detach. Theme colors derived from CSS custom properties instead of hardcoded #0d1117.',
    acceptanceCriteria: [
      'TerminalPanel.svelte is a shell component composing TerminalHeader and TerminalContent',
      'TerminalTabBar.svelte renders tabs with icon, title, close button — click to activate',
      'TerminalTabBar has a + button that opens a dropdown of available shell profiles',
      'TerminalActions.svelte has search toggle, split H/V buttons, kill button, maximize button',
      'TerminalInstance.svelte wraps a single xterm.js viewport using ConnectionManager attach/detach',
      'Terminal theme colors are derived from CSS custom properties via getComputedStyle',
      'Theme re-applies when settingsStore.theme or hypertheme changes (via $effect)',
      'Multiple tabs can be created, switched between, closed, and renamed',
      'Closing the panel does not kill sessions — reopening reconnects to all tabs',
      'Panel height is resizable 100-600px, default 250px',
    ],
    priority: 'critical',
    dependsOn: [2, 3],
  },
  {
    title: 'Keyboard Shortcuts and StatusBar Integration',
    description:
      'Add terminal keyboard shortcuts in AppShell.svelte onKeydown: Ctrl+Shift+` (new terminal tab), Ctrl+Shift+5 (split active terminal). Update StatusBar to show active shell name and session count badge next to the terminal toggle icon. Add terminal commands to the existing shortcut system.',
    acceptanceCriteria: [
      'Ctrl+` toggles terminal panel (existing, preserved)',
      'Ctrl+Shift+` creates a new terminal tab with default shell profile',
      'Ctrl+Shift+5 splits the active terminal horizontally',
      'StatusBar terminal button shows session count badge when >1 session exists',
      'StatusBar terminal button shows active shell name (e.g. "zsh") when terminal is open',
      'Shortcuts do not conflict with existing bindings',
    ],
    priority: 'high',
    dependsOn: [4],
  },

  // ── Phase 2: Splits + Search ──
  {
    title: 'Terminal Split Panes',
    description:
      'Add split terminal support within a tab. Create TerminalSplitPane.svelte that recursively renders the TerminalLayout tree (TerminalLeaf → TerminalInstance, TerminalBranch → SplitPane with two recursive children). Reuse the existing SplitPane.svelte component for resize handles, ratio management, and touch support. Add store methods: splitActive(direction), closeSplit(sessionId), focusSplit(sessionId), navigateSplit(up/down/left/right), setSplitRatio. Focus indicator (subtle border glow) on the active split pane.',
    acceptanceCriteria: [
      'TerminalSplitPane.svelte recursively renders TerminalLayout tree nodes',
      'Leaf nodes render TerminalInstance, branch nodes render SplitPane with two children',
      'splitActive("horizontal") splits the focused pane side-by-side with a new session',
      'splitActive("vertical") splits the focused pane top-bottom with a new session',
      'closeSplit(sessionId) removes the pane and its session, promoting the sibling',
      'navigateSplit(direction) moves focus between split panes using Alt+Arrow keys',
      'Split ratios are draggable and persisted in the tab layout tree',
      'Active split pane has a subtle focus indicator (border glow or accent highlight)',
      'Deeply nested splits work (e.g. split H, then split V within one side)',
      'Closing the last split in a tab closes the tab',
    ],
    priority: 'high',
    dependsOn: [4],
  },
  {
    title: 'Find in Terminal Buffer',
    description:
      'Create TerminalSearchBar.svelte — an inline search bar that appears at the top of a terminal instance when triggered. Wire to @xterm/addon-search for buffer searching. Support: text search, regex toggle, case-sensitive toggle, match count display, next/previous navigation. Ctrl+Shift+F opens search, Escape closes it. Search is per-terminal-instance (not global).',
    acceptanceCriteria: [
      'Ctrl+Shift+F opens the search bar overlay at the top of the active terminal instance',
      'Escape closes the search bar and clears highlights',
      'Text input searches the terminal scrollback buffer in real time',
      'Regex toggle enables/disables regex mode',
      'Case-sensitive toggle enables/disables case matching',
      'Match count displays "N of M" with current position',
      'Enter or down-arrow navigates to next match, Shift+Enter or up-arrow to previous',
      'Search highlights are visible in the terminal viewport',
      'Search is per-terminal-instance, not shared across splits or tabs',
    ],
    priority: 'high',
    dependsOn: [4],
  },
  {
    title: 'Link Detection and File Path Opening',
    description:
      'Configure @xterm/addon-web-links with a custom handler that distinguishes URLs from file paths. URLs open in the default browser. File paths (detected via regex for common patterns like /path/to/file.ts:42:10, ./relative/path.js:5) open in the IDE editor at the specified line and column using editorStore.openFile. Ctrl+click to follow links (matching VS Code behavior).',
    acceptanceCriteria: [
      'URLs in terminal output are underlined on hover and clickable',
      'Ctrl+click on a URL opens it in the default browser',
      'File paths with line:col patterns (e.g. src/foo.ts:42:10) are detected and underlined on hover',
      'Ctrl+click on a file path opens the file in the IDE editor at the correct line and column',
      'Relative paths are resolved against the terminal session CWD',
      'Common path formats work: absolute paths, ./relative, ../parent, path:line:col, path:line',
      'Link detection does not interfere with terminal selection or copy/paste',
    ],
    priority: 'high',
    dependsOn: [4],
  },
  {
    title: 'Copy/Paste and Context Menu',
    description:
      'Implement enhanced clipboard support and right-click context menu. Ctrl+Shift+C copies selection, Ctrl+Shift+V pastes. Optional copy-on-select (auto-copy when text is selected). Right-click context menu using the existing ContextMenu.svelte component with actions: Copy, Paste, Select All, Clear Terminal, Split Horizontally, Split Vertically, Close Terminal. Drag-and-drop file paths from FileTree into terminal (shell-escape paths with spaces).',
    acceptanceCriteria: [
      'Ctrl+Shift+C copies selected terminal text to clipboard',
      'Ctrl+Shift+V pastes clipboard content into the terminal',
      'Copy-on-select option in preferences auto-copies when text is selected',
      'Right-click opens a context menu with: Copy, Paste, Select All, Clear, Split H, Split V, Close',
      'Context menu uses the existing ContextMenu.svelte component',
      'Drag-and-drop from FileTree pastes the shell-escaped file path into the terminal',
      'Paths with spaces are automatically quoted when dropped',
    ],
    priority: 'high',
    dependsOn: [4],
  },

  // ── Phase 3: Shell Integration + Settings ──
  {
    title: 'Shell Integration Scripts (CWD + Command Boundaries)',
    description:
      'Create shell integration scripts for bash, zsh, and fish that emit OSC sequences for CWD tracking and command boundary detection. Scripts are sourced by the PTY on spawn (via environment variable injection). OSC sequences: \\e]7;file://hostname/cwd\\a for CWD changes, custom OSC for command_start/command_end with exit code. Server-side: parse these OSC sequences from PTY output, emit them as 0x02 JSON control messages to attached clients. Client-side: update tab title with current directory name, show exit code badges (green ✓ / red ✗) per command.',
    acceptanceCriteria: [
      'bash-integration.sh emits OSC 7 on directory change and custom OSC on command start/end',
      'zsh-integration.sh emits OSC 7 on directory change and custom OSC on command start/end',
      'fish-integration.fish emits OSC 7 on directory change and custom OSC on command start/end',
      'SessionManager injects integration script path via PROMPT_COMMAND / precmd / fish_prompt',
      'Server parses OSC sequences from PTY output and emits cwd_changed control messages',
      'Server parses command boundary OSC and emits command_start/command_end control messages',
      'Client updates tab title with the directory name from CWD changes',
      'Client shows exit code badge (green ✓ for 0, red ✗ for non-zero) in the terminal gutter',
      'Shell integration is opt-in via a setting (enableShellIntegration, default true)',
    ],
    priority: 'medium',
    dependsOn: [0, 4],
  },
  {
    title: 'Terminal Settings UI',
    description:
      'Add a "Terminal" section to the Settings modal with all terminal-specific preferences. Settings: font family, font size (9-24), font weight, line height, cursor style (block/underline/bar), cursor blink, scrollback lines (1000-100000), bell style (none/visual/audio/both), copy-on-select, right-click paste, default shell (dropdown of detected shells), enable shell integration toggle. Settings apply immediately to all open terminals via $effect. Persist in settingsStore and workspace snapshot.',
    acceptanceCriteria: [
      'Settings modal has a Terminal section accessible from the settings menu',
      'Font family setting with text input, default var(--font-family-mono)',
      'Font size setting with number input, range 9-24, default 13',
      'Cursor style dropdown: block, underline, bar',
      'Cursor blink toggle',
      'Scrollback lines number input, range 1000-100000, default 5000',
      'Bell style dropdown: none, visual, audio, both',
      'Copy-on-select toggle',
      'Default shell dropdown populated from GET /api/terminal/shells',
      'Shell integration enable/disable toggle',
      'All settings apply immediately to existing terminals without restart',
      'Settings persist across sessions via settingsStore',
    ],
    priority: 'medium',
    dependsOn: [4],
  },
  {
    title: 'Terminal Profiles (Named Configurations)',
    description:
      'Allow users to create, edit, and delete named terminal profiles that bundle shell path, args, env vars, working directory, and icon. Ship with auto-detected profiles for each available shell. Profile selection dropdown in TerminalTabBar +button. Profiles stored in settingsStore and persisted. Profile management UI in Settings > Terminal section.',
    acceptanceCriteria: [
      'Auto-detected profiles are created for each shell found by GET /api/terminal/shells',
      'Users can create custom profiles with name, shell path, args, env vars, cwd, icon',
      'Users can edit and delete custom profiles (auto-detected profiles are read-only)',
      'The + button in TerminalTabBar shows a dropdown of available profiles',
      'Selecting a profile creates a new tab with that profile configuration',
      'A default profile can be set — new terminals use it when no profile is specified',
      'Profiles are stored in settingsStore and persisted across sessions',
      'Profile management UI is accessible from Settings > Terminal',
    ],
    priority: 'medium',
    dependsOn: [4, 11],
  },

  // ── Phase 4: Power User Features ──
  {
    title: 'Session Persistence Across Browser Reload',
    description:
      'Ensure terminal sessions survive a full browser refresh or HMR reload. On client load, query GET /api/terminal/sessions to discover surviving PTY sessions. Reattach WebSocket connections and replay scrollback. Install @xterm/addon-serialize to snapshot terminal buffer state for faster re-render. The SessionManager already keeps PTYs alive on disconnect — this story wires the client-side reconnection flow.',
    acceptanceCriteria: [
      'Refreshing the browser reconnects to all previously open terminal sessions',
      'Terminal output from before the refresh is visible (via scrollback replay)',
      'Tab order and layout (including splits) are restored from workspace snapshot',
      'Terminal preferences are restored from persisted settings',
      'Sessions that exited during the reload show their exit status',
      '@xterm/addon-serialize is used to snapshot buffer for faster visual re-render',
      'No duplicate sessions are created — client reconciles with server session list',
    ],
    priority: 'medium',
    dependsOn: [0, 3],
  },
  {
    title: 'Broadcast Input Mode',
    description:
      'Add a broadcast toggle that, when enabled, sends keyboard input to ALL terminal sessions simultaneously. Useful for running the same command across multiple environments. Toggle is a button in TerminalActions with a visual indicator (e.g. broadcast icon glowing). When active, TerminalConnectionManager.write() fans out input to all connected WebSockets. Broadcast mode is per-tab-group, not global.',
    acceptanceCriteria: [
      'Broadcast toggle button is visible in TerminalActions',
      'When enabled, keyboard input in any terminal is replicated to all other terminal sessions',
      'Visual indicator (icon glow, badge) clearly shows when broadcast mode is active',
      'Broadcast can be toggled on/off without disrupting existing sessions',
      'Resize events are NOT broadcast (only input data)',
      'Broadcast is scoped to the current tab group, not all tabs globally',
    ],
    priority: 'low',
    dependsOn: [4],
  },
  {
    title: 'Task Runner Integration',
    description:
      'Detect package.json scripts and Makefile targets in the workspace and present them as one-click run buttons. Add a task runner dropdown in TerminalActions that lists discovered tasks. Clicking a task creates a new terminal tab and runs the command. Support npm, yarn, pnpm, bun script detection. Parse Makefile for target names. Cache task list and refresh on file change.',
    acceptanceCriteria: [
      'Tasks dropdown in TerminalActions lists package.json scripts when present',
      'Tasks dropdown lists Makefile targets when a Makefile is present',
      'Clicking a task creates a new terminal tab with an appropriate label (e.g. "npm run dev")',
      'The task command runs immediately in the new tab',
      'Package manager is auto-detected (npm, yarn, pnpm, bun) based on lockfile',
      'Task list refreshes when package.json or Makefile changes',
      'Recently run tasks are shown at the top of the dropdown',
    ],
    priority: 'low',
    dependsOn: [4],
  },
  {
    title: 'Session Logging',
    description:
      'Add the ability to log terminal session output to a file. Per-session toggle accessible from context menu or terminal header. Server-side: tee PTY output to a log file in a configurable directory (default ~/.e/terminal-logs/). Log files named with session ID and timestamp. Client-side: visual indicator when logging is active.',
    acceptanceCriteria: [
      'Session logging can be toggled from the terminal context menu',
      'When enabled, all PTY output is written to a log file on the server',
      'Log files are stored in ~/.e/terminal-logs/ with session ID and timestamp in filename',
      'Visual indicator in the terminal tab shows when logging is active',
      'Logs are plain text, not including control sequences (stripped for readability)',
      'Log files can be opened in the IDE editor from the context menu',
    ],
    priority: 'low',
    dependsOn: [0, 4],
  },
  {
    title: 'Accessibility (ARIA, Screen Reader, High Contrast)',
    description:
      'Ensure the terminal UI meets WCAG 2.1 AA accessibility standards. Add ARIA roles to tab bar (tablist, tab, tabpanel). Screen reader announcements for tab changes, session events, and search results. High contrast terminal theme variant that activates with the IDE high contrast mode. Focus management for keyboard-only navigation between tabs, splits, and actions.',
    acceptanceCriteria: [
      'Tab bar uses role="tablist", tabs use role="tab", content areas use role="tabpanel"',
      'Tab changes are announced to screen readers via aria-live region',
      'Search results count is announced to screen readers',
      'High contrast terminal theme activates when IDE high contrast mode is enabled',
      'All terminal actions are keyboard-accessible (tab bar, actions, context menu)',
      'Focus is correctly managed when creating, closing, and switching tabs',
      'Terminal instances have aria-label describing the shell and session',
    ],
    priority: 'low',
    dependsOn: [4],
  },

  // ── Phase 5: Exceeding Standard ──
  {
    title: 'Warp-Style Block-Based Command Output',
    description:
      'Render each command and its output as a discrete, collapsible block overlaid on the terminal. Requires shell integration (command_start/command_end boundaries). Each block shows: the command text, its exit code badge, a collapse/expand toggle, and a copy button. Collapsed blocks show just the command line. This is a custom overlay renderer on top of xterm.js, not a modification to xterm itself.',
    acceptanceCriteria: [
      'Each command boundary (from shell integration) creates a visual block in the terminal',
      'Blocks show the command text as a header with exit code badge',
      'Blocks can be collapsed to show only the command header',
      'Blocks can be expanded to show full output',
      'Copy button on each block copies the command output to clipboard',
      'Scrolling and interaction with the underlying xterm.js is not disrupted',
      'Block rendering degrades gracefully when shell integration is not available',
    ],
    priority: 'low',
    dependsOn: [10],
  },
  {
    title: 'Inline Image Rendering (iTerm2 + Sixel)',
    description:
      'Support inline image display in the terminal using the iTerm2 inline image protocol and Sixel graphics. Install @xterm/addon-image. Configure maximum image dimensions and memory limits. Images should render inline within the terminal output flow. Useful for tools like imgcat, viu, timg, and matplotlib backends.',
    acceptanceCriteria: [
      '@xterm/addon-image is installed and loaded per terminal instance',
      'iTerm2 inline image protocol renders images within terminal output',
      'Sixel graphics render correctly',
      'Maximum image dimensions are configurable (default 1000x1000)',
      'Memory limits prevent excessive image caching',
      'Images are cleared on terminal clear (Ctrl+L or clear command)',
      'Image rendering is opt-in via terminal settings (enableImages toggle)',
    ],
    priority: 'low',
    dependsOn: [4],
  },
  {
    title: 'Agent Integration — AI Tool Execution in Terminal',
    description:
      'When the AI agent executes Bash tool calls, optionally show the command and its output in a dedicated read-only terminal tab labeled "Agent". Listen to StreamToolResult events from the stream store. On Bash tool_use, create or reuse the Agent tab and write the command + output. The Agent tab is visually distinct (different tab icon/color) and read-only (input disabled).',
    acceptanceCriteria: [
      'A dedicated "Agent" terminal tab shows AI tool execution output',
      'Bash tool_use commands appear in the Agent tab with the command text highlighted',
      'Tool output streams into the Agent tab in real time',
      'The Agent tab is read-only — keyboard input is disabled',
      'The Agent tab is visually distinct with a different icon and/or tab color',
      'The Agent tab is created on first tool execution, reused for subsequent ones',
      'Agent tab can be closed and will recreate on next tool execution',
      'Agent integration is opt-in via a setting',
    ],
    priority: 'low',
    dependsOn: [4],
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
console.log(`  Name: Fully-Featured TTY Terminal Emulator`);
console.log(`  Stories: ${storyIds.length}`);
console.log(`  Critical: ${stories.filter((s) => s.priority === 'critical').length}`);
console.log(`  High: ${stories.filter((s) => s.priority === 'high').length}`);
console.log(`  Medium: ${stories.filter((s) => s.priority === 'medium').length}`);
console.log(`  Low: ${stories.filter((s) => s.priority === 'low').length}`);
console.log(`\nStory IDs:`);
storyIds.forEach((id, i) => {
  const deps = (stories[i].dependsOn || [])
    .map((idx) => stories[idx].title.slice(0, 30))
    .join(', ');
  console.log(
    `  ${String(i + 1).padStart(2)}. [${stories[i].priority.toUpperCase().padEnd(8)}] ${stories[i].title}${deps ? ` (depends: ${deps})` : ''}`,
  );
});
