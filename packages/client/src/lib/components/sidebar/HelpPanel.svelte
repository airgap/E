<script lang="ts">
  import { uiStore } from '$lib/stores/ui.svelte';
  import { tutorialStore } from '$lib/stores/tutorial.svelte';

  type Section = {
    id: string;
    label: string;
    icon: string;
    articles: Article[];
  };

  type Article = {
    id: string;
    title: string;
    badge?: string;
    badgeColor?: string;
    body: string; // markdown-ish HTML
  };

  let searchQuery = $state('');
  let activeSection = $state('getting-started');
  let activeArticle = $state<Article | null>(null);

  const sections: Section[] = [
    {
      id: 'getting-started',
      label: 'Getting Started',
      icon: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
      articles: [
        {
          id: 'what-is-edna',
          title: 'What is E?',
          body: `
            <p>E is a desktop AI assistant powered by Claude — a full IDE-grade environment where you chat with Claude while working on real codebases.</p>
            <h3>Core idea</h3>
            <p>Instead of copy-pasting code into a chat window, E gives Claude <strong>direct access</strong> to your workspace: the file tree, open editor tabs, terminal, git history, LSP symbols, and more. Claude sees what you see.</p>
            <h3>The three zones</h3>
            <ul>
              <li><strong>Left Sidebar</strong> — 15 panels covering conversations, files, search, work items, memory, agents, tools, and more</li>
              <li><strong>Center Chat</strong> — real-time streaming conversation with Claude, with rich tool-call blocks and thinking steps visible</li>
              <li><strong>Right Editor</strong> — Monaco-based code editor with LSP integration, diff view, and terminal</li>
            </ul>
          `,
        },
        {
          id: 'first-conversation',
          title: 'Starting your first conversation',
          body: `
            <h3>1. Open or create a workspace</h3>
            <p>Use the workspace tabs in the top bar to switch between projects. Each workspace maps to a directory on disk.</p>
            <h3>2. Type a message</h3>
            <p>The chat input supports <strong>slash commands</strong> (type <code>/</code> for a menu), <strong>voice input</strong> (microphone button), and <strong>@ mentions</strong> for files.</p>
            <h3>3. Watch Claude work</h3>
            <p>Claude's thinking steps appear in collapsible blocks. Tool calls (file reads, shell commands, searches) show live output. You can cancel any streaming response with <kbd>Esc</kbd>.</p>
            <h3>Keyboard shortcuts</h3>
            <ul>
              <li><kbd>Enter</kbd> — Send message</li>
              <li><kbd>Shift+Enter</kbd> — New line</li>
              <li><kbd>Esc</kbd> — Cancel stream</li>
              <li><kbd>↑</kbd> — Edit last message (when input is empty)</li>
              <li><kbd>Ctrl+/</kbd> — Toggle sidebar</li>
              <li><kbd>Ctrl+K</kbd> — Command palette</li>
            </ul>
          `,
        },
        {
          id: 'slash-commands',
          title: 'Slash commands',
          body: `
            <p>Type <code>/</code> in the chat input to open the slash command menu. Available commands:</p>
            <ul>
              <li><code>/clear</code> — Clear the current conversation</li>
              <li><code>/plan</code> — Toggle plan mode (AI creates a plan before executing)</li>
              <li><code>/help</code> — Show list of available commands</li>
              <li><code>/memory</code> — Open the Memory panel</li>
              <li><code>/config</code> — Open settings</li>
              <li><code>/model [name]</code> — Switch AI model (opus, sonnet, haiku)</li>
              <li><code>/theme [name]</code> — Change theme</li>
              <li><code>/cost</code> — Show token usage and estimated cost</li>
              <li><code>/status</code> — Display session information</li>
              <li><code>/mcp</code> — Manage MCP servers</li>
              <li><code>/work</code> — Open work panel for PRDs and tasks</li>
              <li><code>/commit</code> — Create a git commit</li>
              <li><code>/review-pr [number]</code> — Review a pull request</li>
            </ul>
            <p>Type <code>/help</code> in the chat to see the full list. Commands can also be run from the <strong>Command Palette</strong> (<kbd>Ctrl+K</kbd>).</p>
          `,
        },
      ],
    },
    {
      id: 'chat',
      label: 'Chat & Conversations',
      icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
      articles: [
        {
          id: 'conversation-branching',
          title: 'Conversation Branching',
          badge: 'Feature',
          badgeColor: 'accent',
          body: `
            <p>Every message has a <strong>Branch</strong> button (git-fork icon) that creates a fork of the conversation from that point. Use branching to explore alternative approaches without losing your current thread.</p>
            <h3>How to use it</h3>
            <ol>
              <li>Hover over any message — the branch icon appears in the top-right corner</li>
              <li>Click it to fork — you're immediately taken to the new branch</li>
              <li>The original conversation is preserved; switch between branches from the <strong>Chats</strong> sidebar</li>
            </ol>
            <h3>When to branch</h3>
            <ul>
              <li>Exploring two different solutions to a problem</li>
              <li>Testing how Claude responds to rephrased questions</li>
              <li>Keeping a "safe" version while experimenting</li>
            </ul>
          `,
        },
        {
          id: 'session-replay',
          title: 'Session Replay',
          badge: 'Feature',
          badgeColor: 'accent',
          body: `
            <p>Replay any past conversation step-by-step, with animated narration, thinking steps, and tool calls — like a movie of Claude working through your problem.</p>
            <h3>Opening a replay</h3>
            <ol>
              <li>Hover over any assistant message and click the <strong>▶</strong> button</li>
              <li>The replay modal opens full-screen</li>
            </ol>
            <h3>Controls</h3>
            <ul>
              <li><kbd>Space</kbd> — Play / Pause</li>
              <li><strong>Speed selector</strong> — 0.5× to 4×</li>
              <li><strong>⟳ Restart</strong> — jump back to the beginning</li>
              <li><strong>Event list</strong> — click any event to jump to it</li>
            </ul>
            <h3>Event types shown</h3>
            <ul>
              <li><span class="badge-inline info">narration</span> — Claude's text output</li>
              <li><span class="badge-inline secondary">thinking</span> — Extended thinking steps</li>
              <li><span class="badge-inline warning">tool_call</span> — Tool invocations (file reads, shell, search)</li>
              <li><span class="badge-inline success">tool_result</span> — Tool output returned to Claude</li>
            </ul>
          `,
        },
        {
          id: 'teach-mode',
          title: 'Teach Me Mode',
          badge: 'Feature',
          badgeColor: 'accent',
          body: `
            <p>Switches E to a <strong>Socratic teaching style</strong> — instead of giving you answers, E asks guiding questions that help you reason through problems yourself.</p>
            <h3>Activating Teach Mode</h3>
            <ul>
              <li>Click the <strong>graduation cap</strong> segment in the <strong>mode selector</strong> next to the chat input</li>
              <li>Press <kbd>Shift+Tab</kbd> twice to cycle past Plan to Teach mode</li>
              <li>Type <code>/teach</code></li>
              <li>Use the Command Palette (<kbd>Ctrl+K</kbd>) and select "Mode: Teach Me"</li>
            </ul>
            <h3>What changes</h3>
            <p>E is instructed to: ask probing questions, guide rather than give answers, explain concepts step-by-step, and check your understanding before moving forward. Perfect for learning a new language, framework, or algorithm.</p>
          `,
        },
        {
          id: 'voice-input',
          title: 'Voice Input & Read-Aloud',
          badge: 'Feature',
          badgeColor: 'accent',
          body: `
            <h3>Voice Input</h3>
            <p>Click the microphone button to speak your message. While recording:</p>
            <ul>
              <li>An animated waveform appears in the button</li>
              <li>A floating preview shows your interim transcript</li>
              <li>Click again to stop — the transcript fills the chat input</li>
            </ul>
            <p>Requires a browser/OS that supports the <code>SpeechRecognition</code> API (Chrome, Edge, or Tauri with system speech).</p>
            <h3>Read-Aloud</h3>
            <p>Hover over any assistant message and click the <strong>speaker</strong> icon to hear it read aloud using your system's text-to-speech. Click <strong>stop</strong> on the same message to stop. Only one message plays at a time.</p>
          `,
        },
        {
          id: 'pair-mode',
          title: 'Live Pair Mode',
          badge: 'Feature',
          badgeColor: 'accent',
          body: `
            <p>Share your Claude session with teammates — they can observe your conversation in real time (read-only) with a shareable URL.</p>
            <h3>Starting a pair session</h3>
            <ol>
              <li>Click the <strong>Pair</strong> button in the chat input bar</li>
              <li>A share URL is generated and copied to clipboard</li>
              <li>Send the URL to your teammate</li>
            </ol>
            <h3>Joining as an observer</h3>
            <p>Open the shared URL in any E instance. A purple <strong>"Observing [Name]'s session"</strong> banner appears — you'll see all messages stream in real time.</p>
            <h3>Ending the session</h3>
            <p>Click <strong>Stop Sharing</strong> in the Pair button to close the room. All observers are disconnected.</p>
          `,
        },
        {
          id: 'diff-context',
          title: 'Diff-Aware Context',
          badge: 'Feature',
          badgeColor: 'accent',
          body: `
            <p>Paste a GitHub PR URL, a git range (<code>main..feature</code>), or a raw unified diff into the chat input. E automatically fetches and parses the diff, adding it as structured context for Claude.</p>
            <h3>Supported formats</h3>
            <ul>
              <li><strong>GitHub PR URL</strong> — e.g. <code>https://github.com/org/repo/pull/123</code></li>
              <li><strong>Git range</strong> — e.g. <code>main..feature/my-branch</code></li>
              <li><strong>Raw diff</strong> — paste a <code>--- a/file / +++ b/file</code> diff directly</li>
            </ul>
            <h3>What you see</h3>
            <p>A <strong>diff preview card</strong> appears below the input showing file chips (+/- counts) and total line stats. The diff is silently injected as XML context when you send. Dismiss with ✕.</p>
          `,
        },
      ],
    },
    {
      id: 'sidebar-panels',
      label: 'Sidebar Panels',
      icon: 'M4 6h16M4 12h16M4 18h16',
      articles: [
        {
          id: 'work-panel',
          title: 'Work Panel (PRDs & Stories)',
          body: `
            <p>The <strong>Work</strong> tab is your project management hub. It manages Product Requirements Documents (PRDs) and their user stories.</p>
            <h3>PRDs</h3>
            <p>A PRD is a planning document for a feature. Claude can generate them from a description, refine them, and estimate effort.</p>
            <h3>Stories</h3>
            <p>Each PRD contains user stories. Stories have statuses: <code>backlog → in-progress → completed</code>. Stories from code comments can be auto-imported via the TODOs panel.</p>
            <h3>Loop integration</h3>
            <p>The <strong>Golem</strong> feature runs Claude in an autonomous loop to implement stories one by one. Configure it with the Golem Config modal.</p>
          `,
        },
        {
          id: 'todos-panel',
          title: 'TODO Scanner',
          badge: 'Feature',
          badgeColor: 'accent',
          body: `
            <p>Scans your codebase for <code>TODO</code>, <code>FIXME</code>, <code>HACK</code>, and <code>BUG</code> comments using <strong>ripgrep</strong> and lets you import them as stories.</p>
            <h3>Running a scan</h3>
            <ol>
              <li>Open the <strong>TODOs</strong> sidebar tab</li>
              <li>Click <strong>Scan Workspace</strong></li>
              <li>Filter by type using the chips at the top</li>
            </ol>
            <h3>Importing to PRD</h3>
            <ol>
              <li>Check the items you want to import</li>
              <li>Choose a target PRD from the dropdown</li>
              <li>Click <strong>Import Selected</strong> — each comment becomes a story</li>
            </ol>
            <p>The scanner skips <code>node_modules</code>, <code>.git</code>, and binary files automatically.</p>
          `,
        },
        {
          id: 'ambient-panel',
          title: 'Ambient Background Agent',
          badge: 'Feature',
          badgeColor: 'accent',
          body: `
            <p>A file watcher that runs silently in the background and surfaces new TODOs/FIXMEs as they appear in your code — without interrupting your flow.</p>
            <h3>Starting the watcher</h3>
            <ol>
              <li>Open the <strong>Ambient</strong> sidebar tab</li>
              <li>Toggle <strong>Watch</strong> on</li>
              <li>E starts watching your workspace directory recursively with a 2-second debounce</li>
            </ol>
            <h3>Notifications</h3>
            <p>New code comments appear as notification cards color-coded by severity:</p>
            <ul>
              <li><span class="badge-inline warning">⚠ warning</span> — FIXME, HACK</li>
              <li><span class="badge-inline error">✗ error</span> — BUG</li>
              <li><span class="badge-inline info">ℹ info</span> — TODO</li>
            </ul>
            <p>Dismiss individual cards or <strong>Clear All</strong>. Up to 50 notifications per workspace.</p>
          `,
        },
        {
          id: 'costs-panel',
          title: 'Cost Dashboard',
          badge: 'Feature',
          badgeColor: 'accent',
          body: `
            <p>Real-time visibility into your Claude API usage — tokens consumed, estimated cost, and breakdown by model and conversation.</p>
            <h3>Period filter</h3>
            <p>Toggle between <strong>Today</strong>, <strong>7 Days</strong>, <strong>30 Days</strong>, and <strong>All Time</strong>.</p>
            <h3>What's shown</h3>
            <ul>
              <li><strong>Total Cost</strong> — USD estimate based on current Claude pricing</li>
              <li><strong>Input / Output Tokens</strong> — separately tracked</li>
              <li><strong>Conversations</strong> — count with activity in the period</li>
              <li><strong>By Model</strong> — proportional usage bars per model</li>
              <li><strong>By Day</strong> — vertical bar chart of daily spend</li>
              <li><strong>Top Conversations</strong> — click any row to jump to that conversation</li>
            </ul>
          `,
        },
        {
          id: 'digest-panel',
          title: 'Daily Digest',
          badge: 'Feature',
          badgeColor: 'accent',
          body: `
            <p>A daily summary of everything that happened in your workspace — conversations, git commits, completed stories, and agent loops.</p>
            <h3>Generating a digest</h3>
            <ol>
              <li>Open the <strong>Digest</strong> sidebar tab</li>
              <li>Pick a date (defaults to today) or toggle <strong>Week view</strong></li>
              <li>The digest loads automatically</li>
            </ol>
            <h3>Contents</h3>
            <ul>
              <li><strong>Stats</strong> — conversations, stories completed, commits, loops run</li>
              <li><strong>Git Commits</strong> — message + author for the day</li>
              <li><strong>Summary</strong> — pre-formatted markdown narrative</li>
            </ul>
            <p>Click <strong>Copy</strong> to paste the digest into a standup, PR description, or daily notes.</p>
          `,
        },
        {
          id: 'custom-tools-panel',
          title: 'Custom Tool Builder',
          badge: 'Feature',
          badgeColor: 'accent',
          body: `
            <p>Define your own tools that Claude can call during conversations — backed by shell commands you write.</p>
            <h3>Creating a tool</h3>
            <ol>
              <li>Open the <strong>Tools</strong> sidebar tab</li>
              <li>Click <strong>New Tool</strong></li>
              <li>Fill in: <strong>Name</strong>, <strong>Description</strong> (Claude reads this), <strong>Input Schema</strong> (JSON Schema), <strong>Handler Command</strong> (shell)</li>
              <li>Click <strong>Create</strong></li>
            </ol>
            <h3>How the handler works</h3>
            <p>When Claude calls your tool, the input JSON is passed as the <code>$TOOL_INPUT</code> environment variable to your shell command. Stdout is returned to Claude.</p>
            <p>Example: <code>echo $TOOL_INPUT | jq .query | xargs gh issue list --search</code></p>
            <h3>Testing</h3>
            <p>Use the <strong>Test</strong> button on any tool card to run it with sample JSON input and see the output immediately.</p>
          `,
        },
        {
          id: 'initiatives-panel',
          title: 'Initiative Layer',
          badge: 'Feature',
          badgeColor: 'accent',
          body: `
            <p>Group multiple workspaces and PRDs under high-level strategic <strong>Initiatives</strong> — like epics in traditional project management.</p>
            <h3>Creating an initiative</h3>
            <ol>
              <li>Open the <strong>Initiatives</strong> sidebar tab</li>
              <li>Click <strong>New Initiative</strong></li>
              <li>Give it a name, description, color, and status</li>
            </ol>
            <h3>Linking workspaces & PRDs</h3>
            <p>Expand an initiative card and use the <strong>+ Link Workspace</strong> and <strong>+ Link PRD</strong> dropdowns to connect existing resources.</p>
            <h3>Progress tracking</h3>
            <p>Each initiative card shows a progress bar calculated from all story statuses across all linked PRDs. Status cycles: <code>active → completed → archived</code>.</p>
          `,
        },
        {
          id: 'memory-panel',
          title: 'Memory Panel',
          body: `
            <p>Persistent notes that are automatically prepended to every conversation in a workspace — giving Claude long-term context about your project.</p>
            <h3>What to store</h3>
            <ul>
              <li>Project architecture decisions</li>
              <li>Coding conventions and style rules</li>
              <li>Key people, services, API patterns</li>
              <li>Things Claude keeps getting wrong</li>
            </ul>
            <p>Memory is per-workspace and stored in the database. Edit it freely — changes take effect on the next message.</p>
          `,
        },
        {
          id: 'mcp-panel',
          title: 'MCP Panel',
          body: `
            <p>Connect <strong>Model Context Protocol</strong> servers to extend Claude with external tools — databases, APIs, file systems, and more.</p>
            <h3>Adding an MCP server</h3>
            <ol>
              <li>Open the <strong>MCP</strong> sidebar tab or use Settings → MCP Manager</li>
              <li>Click <strong>Add Server</strong></li>
              <li>Enter the server command (e.g. <code>npx @modelcontextprotocol/server-sqlite</code>)</li>
              <li>The server starts and its tools become available to Claude immediately</li>
            </ol>
            <p>MCP servers run as local processes. E auto-discovers common MCP servers in your environment.</p>
          `,
        },
      ],
    },
    {
      id: 'editor',
      label: 'Editor & Code',
      icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z',
      articles: [
        {
          id: 'editor-basics',
          title: 'Monaco Code Editor',
          body: `
            <p>E embeds a full <strong>Monaco</strong> editor (the same engine as VS Code) with syntax highlighting, multi-cursor editing, and LSP integration.</p>
            <h3>Opening files</h3>
            <ul>
              <li><strong>File Tree</strong> (sidebar) — click any file to open it in a tab</li>
              <li><strong>Quick Open</strong> (<kbd>Ctrl+P</kbd>) — fuzzy-find files by name</li>
              <li><strong>Chat</strong> — when Claude edits a file, it opens automatically in a diff tab</li>
            </ul>
            <h3>Editor shortcuts</h3>
            <ul>
              <li><kbd>Ctrl+P</kbd> — Quick open file</li>
              <li><kbd>Ctrl+Shift+P</kbd> — Command palette (editor commands)</li>
              <li><kbd>Ctrl+G</kbd> — Go to line</li>
              <li><kbd>Ctrl+F</kbd> — Find in file</li>
              <li><kbd>Alt+Click</kbd> — Multi-cursor</li>
            </ul>
          `,
        },
        {
          id: 'diff-view',
          title: 'Diff View',
          body: `
            <p>When Claude proposes a file change, E shows a <strong>side-by-side diff</strong> with the original on the left and Claude's changes on the right.</p>
            <h3>Accepting changes</h3>
            <ul>
              <li>Click <strong>Accept</strong> to write the changes to disk</li>
              <li>Click <strong>Reject</strong> to discard</li>
              <li>Accepted changes are immediately reflected in the editor and file tree</li>
            </ul>
          `,
        },
        {
          id: 'terminal',
          title: 'Integrated Terminal',
          body: `
            <p>A full xterm.js terminal is available at the bottom of the editor pane. Claude can run commands in it directly when given permission.</p>
            <h3>Permissions</h3>
            <p>Conversations have a <strong>permission mode</strong>:</p>
            <ul>
              <li><code>default</code> — Claude asks before running shell commands</li>
              <li><code>acceptEdits</code> — Auto-accepts file edits, asks about shell</li>
              <li><code>bypassPermissions</code> — Claude acts autonomously (use with care)</li>
            </ul>
            <p>Change it in <strong>Settings → Conversation Permissions</strong>.</p>
          `,
        },
        {
          id: 'lsp',
          title: 'LSP & Symbol Outline',
          body: `
            <p>E connects to Language Server Protocol (LSP) servers for intelligent code features — go-to-definition, hover docs, diagnostics, and symbol outlines.</p>
            <h3>Symbol Outline (Symbols tab)</h3>
            <p>Shows a tree of all symbols in the active file — functions, classes, variables. Click any symbol to jump to it in the editor.</p>
            <h3>Supported languages</h3>
            <p>LSP servers must be installed separately. E auto-detects: TypeScript/JS (<code>typescript-language-server</code>), Python (<code>pylsp</code>), Rust (<code>rust-analyzer</code>), Go (<code>gopls</code>), and more.</p>
          `,
        },
      ],
    },
    {
      id: 'agents',
      label: 'Agents & Golems',
      icon: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
      articles: [
        {
          id: 'loop-mode',
          title: 'Golem Mode',
          body: `
            <p><strong>Golem Mode</strong> runs Claude in a fully autonomous cycle: it reads a story, implements it, verifies the result, and moves to the next story — without your intervention.</p>
            <h3>Activating a Golem</h3>
            <ol>
              <li>Open the <strong>Work</strong> sidebar tab and select a PRD</li>
              <li>Click <strong>Activate Golem</strong></li>
              <li>Configure settings in the Golem Config modal (model, max iterations, permission mode)</li>
              <li>Click <strong>Run</strong></li>
            </ol>
            <h3>What the loop does</h3>
            <ul>
              <li>Picks the next <code>backlog</code> story</li>
              <li>Generates an implementation plan</li>
              <li>Executes tool calls (file edits, shell commands, tests)</li>
              <li>Verifies success criteria</li>
              <li>Marks the story <code>completed</code> and moves on</li>
            </ul>
            <h3>Stopping</h3>
            <p>Click <strong>Stop Golem</strong> at any time. The current story is left in <code>in-progress</code> state.</p>
          `,
        },
        {
          id: 'agents-panel',
          title: 'Agent Panel',
          body: `
            <p>The <strong>Agents</strong> sidebar tab shows all running and recent agent loops — their status, current story, token usage, and logs.</p>
            <p>Each agent entry shows:</p>
            <ul>
              <li>Status badge (<code>running</code> / <code>completed</code> / <code>error</code>)</li>
              <li>Current story being worked on</li>
              <li>Iteration count and token consumption</li>
              <li>Expandable log of recent actions</li>
            </ul>
          `,
        },
        {
          id: 'plan-mode',
          title: 'Plan Mode',
          body: `
            <p>When <strong>Plan Mode</strong> is active, E thinks through a problem in full before taking any action.</p>
            <h3>Activating Plan Mode</h3>
            <ul>
              <li>Click the <strong>pencil</strong> segment in the <strong>mode selector</strong> next to the chat input</li>
              <li>Press <kbd>Shift+Tab</kbd> twice to cycle to Plan mode</li>
              <li>Type <code>/plan</code></li>
              <li>Use the Command Palette (<kbd>Ctrl+K</kbd>) and select "Mode: Plan"</li>
            </ul>
            <h3>What changes</h3>
            <p>E will:</p>
            <ul>
              <li>List all steps it intends to take</li>
              <li>Identify risks and edge cases</li>
              <li>Ask clarifying questions if needed</li>
              <li>Only execute once you confirm the plan</li>
            </ul>
            <p>Great for complex refactors or any change where you want a preview before E touches your code.</p>
          `,
        },
      ],
    },
    {
      id: 'keyboard',
      label: 'Keyboard Shortcuts',
      icon: 'M18 3H6a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3V6a3 3 0 0 0-3-3zM8 11H5V9h3v2zm0 4H5v-2h3v2zm4-4h-3V9h3v2zm0 4h-3v-2h3v2zm4-4h-3V9h3v2zm0 4h-3v-2h3v2z',
      articles: [
        {
          id: 'global-shortcuts',
          title: 'Global Shortcuts',
          body: `
            <table class="kbd-table">
              <thead><tr><th>Action</th><th>Shortcut</th></tr></thead>
              <tbody>
                <tr><td>Command Palette</td><td><kbd>Ctrl+K</kbd></td></tr>
                <tr><td>Toggle Sidebar</td><td><kbd>Ctrl+/</kbd></td></tr>
                <tr><td>Quick Open File</td><td><kbd>Ctrl+P</kbd></td></tr>
                <tr><td>Settings</td><td><kbd>Ctrl+,</kbd></td></tr>
                <tr><td>New Conversation</td><td><kbd>Ctrl+N</kbd></td></tr>
                <tr><td>Focus Chat Input</td><td><kbd>Ctrl+L</kbd></td></tr>
                <tr><td>Cancel Stream</td><td><kbd>Esc</kbd></td></tr>
                <tr><td>Cycle Mode (Normal / Plan / Teach)</td><td><kbd>Shift+Tab+Tab</kbd></td></tr>
                <tr><td>Previous Conversation</td><td><kbd>Ctrl+[</kbd></td></tr>
                <tr><td>Next Conversation</td><td><kbd>Ctrl+]</kbd></td></tr>
              </tbody>
            </table>
          `,
        },
        {
          id: 'chat-shortcuts',
          title: 'Chat Input Shortcuts',
          body: `
            <table class="kbd-table">
              <thead><tr><th>Action</th><th>Shortcut</th></tr></thead>
              <tbody>
                <tr><td>Send message</td><td><kbd>Enter</kbd></td></tr>
                <tr><td>New line in message</td><td><kbd>Shift+Enter</kbd></td></tr>
                <tr><td>Edit last message</td><td><kbd>↑</kbd> (when input empty)</td></tr>
                <tr><td>Slash command menu</td><td><code>/</code> at start of input</td></tr>
                <tr><td>Voice input</td><td>Click microphone button</td></tr>
                <tr><td>Toggle Teach Mode</td><td>Click graduation cap button</td></tr>
                <tr><td>Toggle Pair Mode</td><td>Click pair button</td></tr>
              </tbody>
            </table>
          `,
        },
        {
          id: 'replay-shortcuts',
          title: 'Replay Modal Shortcuts',
          body: `
            <table class="kbd-table">
              <thead><tr><th>Action</th><th>Shortcut</th></tr></thead>
              <tbody>
                <tr><td>Play / Pause</td><td><kbd>Space</kbd></td></tr>
                <tr><td>Restart</td><td><kbd>R</kbd></td></tr>
                <tr><td>Close modal</td><td><kbd>Esc</kbd></td></tr>
                <tr><td>Jump to event</td><td>Click in event list</td></tr>
              </tbody>
            </table>
          `,
        },
      ],
    },
    {
      id: 'settings',
      label: 'Settings & Config',
      icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
      articles: [
        {
          id: 'settings-overview',
          title: 'Settings Overview',
          body: `
            <p>Open Settings with <kbd>Ctrl+,</kbd> or the gear icon in the top-right corner. Settings are organized into tabs:</p>
            <ul>
              <li><strong>General</strong> — Default model, workspace path, theme (hypertheme)</li>
              <li><strong>Claude</strong> — API key, custom system prompt, permission defaults</li>
              <li><strong>MCP</strong> — Manage MCP server connections</li>
              <li><strong>Keybindings</strong> — View and customize keyboard shortcuts</li>
              <li><strong>Appearance</strong> — Font, font size, hypertheme selection</li>
            </ul>
          `,
        },
        {
          id: 'hyperthemes',
          title: 'Hyperthemes',
          body: `
            <p>E's visual style is controlled by <strong>Hyperthemes</strong> — complete aesthetic packages that change colors, typography, animations, and ambient effects.</p>
            <h3>Available themes</h3>
            <ul>
              <li><strong>Tech</strong> — High-contrast cyan on dark, scanline topbar</li>
              <li><strong>Arcane</strong> — Purple mystical, constellation ambient effect</li>
              <li><strong>Ethereal</strong> — Soft lavender, floating motes effect</li>
              <li><strong>Study</strong> — Warm amber on cream, paper texture</li>
              <li><strong>Astral</strong> — Deep blue with star field</li>
              <li><strong>Astral Midnight</strong> — Dark variant of Astral</li>
            </ul>
            <p>Switch themes in <strong>Settings → Appearance → Hypertheme</strong>.</p>
          `,
        },
        {
          id: 'api-key',
          title: 'Configuring Your API Key',
          body: `
            <p>E uses the Claude API directly. You need an Anthropic API key.</p>
            <h3>Setting up</h3>
            <ol>
              <li>Get a key from <strong>console.anthropic.com</strong></li>
              <li>Open <strong>Settings → Claude → API Key</strong></li>
              <li>Paste your key and click Save</li>
            </ol>
            <p>Your key is stored locally — it never leaves your machine. All Claude API calls go directly from E to Anthropic's servers.</p>
            <h3>Usage & costs</h3>
            <p>Track your token usage in the <strong>Costs</strong> sidebar tab. Costs are estimated based on current Claude pricing and may differ slightly from your Anthropic invoice.</p>
          `,
        },
      ],
    },
  ];

  // Flat search across all articles
  const allArticles = $derived(
    sections.flatMap((s) =>
      s.articles.map((a) => ({ ...a, sectionId: s.id, sectionLabel: s.label })),
    ),
  );

  const searchResults = $derived(
    searchQuery.length < 2
      ? []
      : allArticles.filter(
          (a) =>
            a.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            a.body.toLowerCase().includes(searchQuery.toLowerCase()),
        ),
  );

  const currentSection = $derived(sections.find((s) => s.id === activeSection));

  function openArticle(article: Article) {
    activeArticle = article;
  }

  function closeArticle() {
    activeArticle = null;
  }

  function openSection(sectionId: string) {
    activeSection = sectionId;
    activeArticle = null;
    searchQuery = '';
  }
</script>

<div class="help-panel">
  <!-- Header -->
  <div class="help-header">
    <div class="help-title">
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <path d="M12 17h.01" />
      </svg>
      Help & Docs
    </div>
    <input class="search-input" type="text" placeholder="Search docs…" bind:value={searchQuery} />
  </div>

  <!-- Article view -->
  {#if activeArticle}
    <div class="article-view">
      <button class="back-btn" onclick={closeArticle}>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M19 12H5M12 5l-7 7 7 7" />
        </svg>
        Back
      </button>
      <div class="article-header">
        <h2 class="article-title">{activeArticle.title}</h2>
        {#if activeArticle.badge}
          <span class="badge {activeArticle.badgeColor ?? ''}">{activeArticle.badge}</span>
        {/if}
      </div>
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      <div class="article-body">{@html activeArticle.body}</div>
    </div>

    <!-- Search results -->
  {:else if searchQuery.length >= 2}
    <div class="search-results">
      <p class="results-label">
        {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} for "{searchQuery}"
      </p>
      {#if searchResults.length === 0}
        <div class="empty-state">No docs match your search.</div>
      {:else}
        {#each searchResults as result}
          <button class="result-card" onclick={() => openArticle(result)}>
            <span class="result-section">{result.sectionLabel}</span>
            <span class="result-title">{result.title}</span>
          </button>
        {/each}
      {/if}
    </div>

    <!-- Main nav -->
  {:else}
    <div class="help-body">
      <!-- Section nav -->
      <nav class="section-nav">
        {#each sections as section}
          <button
            class="section-btn"
            class:active={activeSection === section.id}
            onclick={() => openSection(section.id)}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d={section.icon} />
            </svg>
            {section.label}
          </button>
        {/each}
      </nav>

      <!-- Article list -->
      {#if currentSection}
        <div class="article-list">
          <p class="section-heading">{currentSection.label}</p>
          {#each currentSection.articles as article}
            <button class="article-card" onclick={() => openArticle(article)}>
              <span class="article-card-title">{article.title}</span>
              {#if article.badge}
                <span class="badge {article.badgeColor ?? ''} sm">{article.badge}</span>
              {/if}
              <svg
                class="article-arrow"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <!-- Footer -->
  <div class="help-footer">
    <button class="footer-btn tutorial-btn" onclick={() => tutorialStore.reset()}>
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
      </svg>
      Tutorial
    </button>
    <button class="footer-btn" onclick={() => uiStore.openModal('keybindings')}>
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <rect x="2" y="6" width="20" height="12" rx="2" />
        <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
      </svg>
      Keys
    </button>
    <button class="footer-btn" onclick={() => uiStore.openModal('settings')}>
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <circle cx="12" cy="12" r="3" />
        <path
          d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
        />
      </svg>
      Settings
    </button>
    <span class="version-label">E v2</span>
  </div>
</div>

<style>
  .help-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    color: var(--text-primary);
    font-size: var(--fs-base);
  }

  /* ── Header ── */
  .help-header {
    padding: 12px 12px 10px;
    border-bottom: 1px solid var(--border-primary);
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .help-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--fs-xs);
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-secondary);
  }

  .search-input {
    width: 100%;
    padding: 6px 10px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: var(--fs-sm);
    transition: border-color var(--transition);
    box-sizing: border-box;
  }
  .search-input:focus {
    outline: none;
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-primary) 15%, transparent);
  }
  .search-input::placeholder {
    color: var(--text-tertiary);
  }

  /* ── Body ── */
  .help-body {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  /* ── Section nav ── */
  .section-nav {
    width: 100px;
    flex-shrink: 0;
    border-right: 1px solid var(--border-primary);
    overflow-y: auto;
    padding: 8px 0;
  }

  .section-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    width: 100%;
    padding: 8px 6px;
    font-size: var(--fs-xxs);
    font-weight: 600;
    letter-spacing: 0.04em;
    color: var(--text-tertiary);
    text-align: center;
    border-radius: 0;
    transition: all var(--transition);
    border-left: 2px solid transparent;
  }
  .section-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }
  .section-btn.active {
    color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 8%, transparent);
    border-left-color: var(--accent-primary);
  }

  /* ── Article list ── */
  .article-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .section-heading {
    font-size: var(--fs-xxs);
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-tertiary);
    padding: 4px 4px 8px;
    margin: 0;
  }

  .article-card {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    text-align: left;
    cursor: pointer;
    transition: all var(--transition);
    width: 100%;
  }
  .article-card:hover {
    border-color: var(--accent-primary);
    background: var(--bg-hover);
    box-shadow: var(--shadow-glow-sm);
  }

  .article-card-title {
    flex: 1;
    font-size: var(--fs-sm);
    font-weight: 500;
    color: var(--text-primary);
    line-height: 1.4;
  }

  .article-arrow {
    color: var(--text-tertiary);
    flex-shrink: 0;
  }

  /* ── Article view ── */
  .article-view {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .back-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    padding: 4px 8px;
    border-radius: var(--radius-sm);
    border: 1px solid transparent;
    transition: all var(--transition);
    width: fit-content;
  }
  .back-btn:hover {
    color: var(--accent-primary);
    border-color: var(--border-primary);
    background: var(--bg-hover);
  }

  .article-header {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .article-title {
    font-size: var(--fs-md);
    font-weight: 700;
    color: var(--text-primary);
    margin: 0;
    line-height: 1.3;
  }

  /* article body HTML styles */
  .article-body :global(h3) {
    font-size: var(--fs-sm);
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-secondary);
    margin: 14px 0 6px;
  }
  .article-body :global(p) {
    color: var(--text-secondary);
    line-height: 1.6;
    margin: 0 0 8px;
  }
  .article-body :global(ul),
  .article-body :global(ol) {
    color: var(--text-secondary);
    padding-left: 18px;
    margin: 0 0 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .article-body :global(li) {
    line-height: 1.5;
  }
  .article-body :global(strong) {
    color: var(--text-primary);
    font-weight: 600;
  }
  .article-body :global(code) {
    font-family: var(--font-mono, monospace);
    font-size: var(--fs-xs);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    border-radius: 3px;
    padding: 1px 5px;
    color: var(--accent-primary);
  }
  .article-body :global(kbd) {
    font-family: var(--font-mono, monospace);
    font-size: var(--fs-xxs);
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-bottom-width: 2px;
    border-radius: 4px;
    padding: 1px 6px;
    color: var(--text-primary);
    white-space: nowrap;
  }

  /* Keyboard shortcut table */
  .article-body :global(.kbd-table) {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--fs-sm);
    margin-bottom: 8px;
  }
  .article-body :global(.kbd-table th) {
    text-align: left;
    padding: 6px 8px;
    font-size: var(--fs-xxs);
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-tertiary);
    border-bottom: 1px solid var(--border-primary);
  }
  .article-body :global(.kbd-table td) {
    padding: 7px 8px;
    color: var(--text-secondary);
    border-bottom: 1px solid var(--border-secondary);
    vertical-align: middle;
  }
  .article-body :global(.kbd-table tr:last-child td) {
    border-bottom: none;
  }
  .article-body :global(.kbd-table tr:hover td) {
    background: var(--bg-hover);
  }

  /* Inline badges in article body */
  .article-body :global(.badge-inline) {
    display: inline-block;
    font-size: var(--fs-xxs);
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .article-body :global(.badge-inline.info) {
    background: color-mix(in srgb, var(--accent-primary) 15%, transparent);
    color: var(--accent-primary);
  }
  .article-body :global(.badge-inline.warning) {
    background: color-mix(in srgb, var(--accent-warning) 15%, transparent);
    color: var(--accent-warning);
  }
  .article-body :global(.badge-inline.error) {
    background: color-mix(in srgb, var(--accent-error) 15%, transparent);
    color: var(--accent-error);
  }
  .article-body :global(.badge-inline.secondary) {
    background: var(--bg-tertiary);
    color: var(--text-secondary);
  }
  .article-body :global(.badge-inline.success) {
    background: color-mix(in srgb, #4caf50 15%, transparent);
    color: #4caf50;
  }

  /* ── Badges ── */
  .badge {
    font-size: var(--fs-xxs);
    font-weight: 700;
    padding: 2px 7px;
    border-radius: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    flex-shrink: 0;
  }
  .badge.accent {
    background: color-mix(in srgb, var(--accent-primary) 15%, transparent);
    color: var(--accent-primary);
    border: 1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent);
  }
  .badge.sm {
    font-size: var(--fs-xxs);
    padding: 1px 5px;
  }

  /* ── Search results ── */
  .search-results {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .results-label {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    margin: 0 0 4px;
  }

  .result-card {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 9px 11px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    text-align: left;
    cursor: pointer;
    transition: all var(--transition);
    width: 100%;
  }
  .result-card:hover {
    border-color: var(--accent-primary);
    background: var(--bg-hover);
  }

  .result-section {
    font-size: var(--fs-xxs);
    font-weight: 600;
    color: var(--accent-primary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .result-title {
    font-size: var(--fs-sm);
    color: var(--text-primary);
    font-weight: 500;
  }

  .empty-state {
    color: var(--text-tertiary);
    font-size: var(--fs-sm);
    text-align: center;
    padding: 24px;
  }

  /* ── Footer ── */
  .help-footer {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    border-top: 1px solid var(--border-primary);
    flex-shrink: 0;
    background: var(--bg-secondary);
  }

  .footer-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    padding: 4px 8px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-secondary);
    transition: all var(--transition);
  }
  .footer-btn:hover {
    color: var(--accent-primary);
    border-color: var(--border-primary);
    background: var(--bg-hover);
  }

  .tutorial-btn {
    color: var(--accent-primary);
    border-color: color-mix(in srgb, var(--accent-primary) 30%, transparent);
    background: color-mix(in srgb, var(--accent-primary) 8%, transparent);
  }
  .tutorial-btn:hover {
    background: color-mix(in srgb, var(--accent-primary) 18%, transparent);
    border-color: var(--accent-primary);
    box-shadow: var(--shadow-glow-sm);
  }

  .version-label {
    margin-left: auto;
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    font-weight: 600;
    letter-spacing: 0.06em;
  }
</style>
