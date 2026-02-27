const STORAGE_KEY = 'e-tutorial';

export type TutorialStepId =
  | 'welcome'
  | 'chat-basics'
  | 'slash-commands'
  | 'sidebar-panels'
  | 'editor-pane'
  | 'command-palette'
  | 'agents-loops'
  | 'settings-themes'
  | 'complete';

export interface TutorialStep {
  id: TutorialStepId;
  title: string;
  description: string;
  /** SVG path for the step icon */
  icon: string;
  /** Detailed body content (HTML) */
  body: string;
  /** Optional action label for a "try it" button */
  actionLabel?: string;
  /** Action identifier to dispatch */
  actionId?: string;
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to E',
    icon: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
    description: 'Getting started with E',
    body: `
      <p><strong>E</strong> is an IDE that integrates AI assistance directly into your workspace. You can chat with an AI agent while it reads and modifies files in your project.</p>
      <h3>Interface layout</h3>
      <ul>
        <li><strong>Left Sidebar</strong> — Access to panels (conversations, files, work items, memory, agents, tools)</li>
        <li><strong>Center Chat</strong> — Where you communicate with the AI and see its responses</li>
        <li><strong>Right Editor</strong> — Code editor with LSP support, diff view, and terminal</li>
      </ul>
      <p>This guide covers the main features. Click <strong>Next</strong> to continue.</p>
    `,
  },
  {
    id: 'chat-basics',
    title: 'Chat & Conversations',
    icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
    description: 'How to interact with the AI',
    body: `
      <p>Use the <strong>center chat area</strong> to send messages and receive responses. You'll see the AI's thinking process and tool usage as it works.</p>
      <h3>Keyboard shortcuts</h3>
      <ul>
        <li><kbd>Enter</kbd> — Send your message</li>
        <li><kbd>Shift+Enter</kbd> — New line</li>
        <li><kbd>Esc</kbd> — Cancel a streaming response</li>
        <li><kbd>↑</kbd> — Edit your last message (when input is empty)</li>
      </ul>
      <h3>Additional features</h3>
      <ul>
        <li><strong>@ Mentions</strong> — Type <code>@</code> to attach files, symbols, or threads as context</li>
        <li><strong>Voice Input</strong> — Click the microphone button to dictate instead of typing</li>
        <li><strong>Teach Mode</strong> — Click the graduation cap button to receive explanations instead of direct solutions</li>
        <li><strong>Branching</strong> — Hover any message and click the branch icon to create an alternate conversation path</li>
      </ul>
    `,
    actionLabel: 'Focus Chat Input',
    actionId: 'focus-chat',
  },
  {
    id: 'slash-commands',
    title: 'Slash Commands',
    icon: 'M7 8l-4 4 4 4M17 8l4 4-4 4M14 4l-4 16',
    description: 'Text commands for common actions',
    body: `
      <p>Type <code>/</code> in the chat input to access available commands:</p>
      <ul>
        <li><code>/clear</code> — Clear the current conversation</li>
        <li><code>/plan</code> — Toggle Plan Mode (AI creates a plan before executing)</li>
        <li><code>/help</code> — Show list of available commands</li>
        <li><code>/memory</code> — Open the Memory panel</li>
        <li><code>/config</code> — Open settings</li>
        <li><code>/model [name]</code> — Switch AI model (opus, sonnet, haiku)</li>
        <li><code>/theme [name]</code> — Change theme</li>
        <li><code>/cost</code> — Show token usage and estimated cost</li>
        <li><code>/status</code> — Display session information</li>
        <li><code>/mcp</code> — Manage MCP servers</li>
        <li><code>/work</code> — Open work panel for PRDs and tasks</li>
      </ul>
      <p>Additional commands like <code>/commit</code> and <code>/review-pr</code> are also available.</p>
    `,
  },
  {
    id: 'sidebar-panels',
    title: 'Sidebar Panels',
    icon: 'M4 6h16M4 12h16M4 18h16',
    description: 'Available panels',
    body: `
      <p>The sidebar contains various panels for different tasks. Press <kbd>Ctrl+/</kbd> to toggle it.</p>
      <h3>Main panels</h3>
      <ul>
        <li><strong>Chats</strong> — Conversation history and branching</li>
        <li><strong>Files</strong> — Workspace file tree</li>
        <li><strong>Work</strong> — PRDs, user stories, and project planning</li>
        <li><strong>Memory</strong> — Persistent notes retained across conversations</li>
        <li><strong>Agents</strong> — Status of running background agents</li>
        <li><strong>Tools</strong> — Custom tool definitions</li>
        <li><strong>MCP</strong> — Connected external servers (databases, APIs, etc.)</li>
        <li><strong>Costs</strong> — Token usage and API spending</li>
      </ul>
      <p>Panels can be rearranged by dragging them between columns or detaching them as separate windows.</p>
    `,
    actionLabel: 'Toggle Sidebar',
    actionId: 'toggle-sidebar',
  },
  {
    id: 'editor-pane',
    title: 'Editor & Terminal',
    icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z',
    description: 'Code editor and terminal access',
    body: `
      <p>The editor uses Monaco (the same engine as VS Code) and includes syntax highlighting, multi-cursor editing, and LSP support.</p>
      <h3>Opening files</h3>
      <ul>
        <li><strong>File Tree</strong> — Click any file in the sidebar</li>
        <li><kbd>Ctrl+P</kbd> — Fuzzy file finder</li>
        <li><strong>Auto-open</strong> — Files open automatically in diff view when the AI edits them</li>
      </ul>
      <h3>Layout</h3>
      <ul>
        <li><kbd>Ctrl+\\</kbd> — Toggle between chat-only view and split view</li>
      </ul>
      <h3>Terminal</h3>
      <p>Press <kbd>Ctrl+\`</kbd> to toggle the terminal. The AI can execute commands here if you grant permission.</p>
    `,
    actionLabel: 'Toggle Editor',
    actionId: 'toggle-editor',
  },
  {
    id: 'command-palette',
    title: 'Command Palette',
    icon: 'M18 3H6a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3V6a3 3 0 0 0-3-3zM8 11H5V9h3v2zm0 4H5v-2h3v2zm4-4h-3V9h3v2zm0 4h-3v-2h3v2zm4-4h-3V9h3v2zm0 4h-3v-2h3v2z',
    description: 'Searchable command launcher',
    body: `
      <p>Press <kbd>Ctrl+K</kbd> to open the Command Palette, which provides fuzzy search access to all available actions.</p>
      <h3>Available actions</h3>
      <ul>
        <li>Run slash commands</li>
        <li>Switch between conversations</li>
        <li>Open settings, panels, or modals</li>
        <li>Toggle modes (plan mode, teach mode, etc.)</li>
      </ul>
      <p>This is useful for accessing features without memorizing specific shortcuts.</p>
    `,
    actionLabel: 'Open Palette',
    actionId: 'open-command-palette',
  },
  {
    id: 'agents-loops',
    title: 'Agents & Golems',
    icon: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
    description: 'Automated task execution',
    body: `
      <p><strong>Golem Mode</strong> allows the AI to work autonomously: it selects a task, implements it, verifies the result, and continues to the next task without requiring input.</p>
      <h3>Activating a Golem</h3>
      <ol>
        <li>Open the <strong>Work</strong> panel and create a PRD with user stories</li>
        <li>Click <strong>Activate Golem</strong></li>
        <li>Configure the model, iteration limit, and tool permissions</li>
        <li>Click <strong>Run</strong></li>
      </ol>
      <h3>Plan Mode</h3>
      <p>Press <kbd>Shift+Tab</kbd> twice (or click ✏ in the top bar) to enable Plan Mode. The AI will create an implementation plan before executing changes.</p>
      <h3>Agent Profiles</h3>
      <p>Press <kbd>Ctrl+Shift+,</kbd> to cycle between Write, Ask, and Minimal profiles, which set different levels of AI autonomy.</p>
    `,
    actionLabel: 'Open Work Panel',
    actionId: 'open-work-panel',
  },
  {
    id: 'settings-themes',
    title: 'Settings & Themes',
    icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    description: 'Customization options',
    body: `
      <p>Press <kbd>Ctrl+,</kbd> to open Settings and configure the application.</p>
      <h3>Hyperthemes</h3>
      <p>Theme presets that modify colors, animations, and visual effects:</p>
      <ul>
        <li><strong>Tech</strong> — High-contrast cyan with scanline effects</li>
        <li><strong>Arcane</strong> — Purple palette with constellation patterns</li>
        <li><strong>Ethereal</strong> — Soft lavender with floating particle effects</li>
        <li><strong>Study</strong> — Warm amber on cream with subtle sparkles</li>
        <li><strong>Astral</strong> — Deep blue with star field background</li>
      </ul>
      <h3>Other options</h3>
      <ul>
        <li><strong>Fonts</strong> — Monospace and sans-serif font selection</li>
        <li><strong>Audio</strong> — Sound effects configuration</li>
        <li><strong>Permissions</strong> — Tool and terminal access control</li>
        <li><strong>MCP Servers</strong> — External server connections</li>
      </ul>
    `,
    actionLabel: 'Open Settings',
    actionId: 'open-settings',
  },
  {
    id: 'complete',
    title: 'Tutorial Complete',
    icon: 'M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
    description: 'Additional information',
    body: `
      <p>You've completed the tutorial. Here are a few more things to know:</p>
      <h3>Useful features</h3>
      <ul>
        <li>Press <kbd>?</kbd> to open the <strong>Help Panel</strong> for detailed documentation</li>
        <li>Use <strong>Memory</strong> to store project-specific information that persists across conversations</li>
        <li>Enable <strong>Teach Mode</strong> when you want explanations instead of solutions</li>
        <li>Use <strong>Session Replay</strong> to review past AI actions</li>
        <li>Check the <strong>Daily Digest</strong> for a summary of workspace activity</li>
      </ul>
      <p>You can restart this tutorial from the <strong>Help</strong> panel.</p>
    `,
  },
];

interface TutorialState {
  completed: boolean;
  currentStepIndex: number;
  stepsVisited: string[];
  dismissedAt: number | null;
}

const defaultState: TutorialState = {
  completed: false,
  currentStepIndex: 0,
  stepsVisited: [],
  dismissedAt: null,
};

function loadState(): TutorialState {
  if (typeof window === 'undefined') return defaultState;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaultState, ...JSON.parse(raw) };
  } catch {}
  return defaultState;
}

function createTutorialStore() {
  let state = $state<TutorialState>(loadState());
  let active = $state(false);

  function persist() {
    if (typeof window === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  return {
    get active() {
      return active;
    },
    get completed() {
      return state.completed;
    },
    get currentStepIndex() {
      return state.currentStepIndex;
    },
    get currentStep(): TutorialStep {
      return TUTORIAL_STEPS[state.currentStepIndex] ?? TUTORIAL_STEPS[0];
    },
    get totalSteps() {
      return TUTORIAL_STEPS.length;
    },
    get stepsVisited() {
      return state.stepsVisited;
    },
    get isFirstTime(): boolean {
      return !state.completed && state.dismissedAt === null;
    },
    get progress(): number {
      return Math.round((state.currentStepIndex / (TUTORIAL_STEPS.length - 1)) * 100);
    },

    /** Open the tutorial (optionally at a specific step) */
    start(stepIndex = 0) {
      state.currentStepIndex = stepIndex;
      active = true;
      const stepId = TUTORIAL_STEPS[stepIndex]?.id;
      if (stepId && !state.stepsVisited.includes(stepId)) {
        state.stepsVisited = [...state.stepsVisited, stepId];
      }
      persist();
    },

    /** Advance to the next step */
    next() {
      if (state.currentStepIndex < TUTORIAL_STEPS.length - 1) {
        state.currentStepIndex++;
        const stepId = TUTORIAL_STEPS[state.currentStepIndex]?.id;
        if (stepId && !state.stepsVisited.includes(stepId)) {
          state.stepsVisited = [...state.stepsVisited, stepId];
        }
        persist();
      }
    },

    /** Go back to the previous step */
    prev() {
      if (state.currentStepIndex > 0) {
        state.currentStepIndex--;
        persist();
      }
    },

    /** Jump to a specific step */
    goToStep(index: number) {
      if (index >= 0 && index < TUTORIAL_STEPS.length) {
        state.currentStepIndex = index;
        const stepId = TUTORIAL_STEPS[index]?.id;
        if (stepId && !state.stepsVisited.includes(stepId)) {
          state.stepsVisited = [...state.stepsVisited, stepId];
        }
        persist();
      }
    },

    /** Mark as complete and close */
    complete() {
      state.completed = true;
      state.currentStepIndex = TUTORIAL_STEPS.length - 1;
      active = false;
      persist();
    },

    /** Dismiss without completing (close but remember position) */
    dismiss() {
      active = false;
      state.dismissedAt = Date.now();
      persist();
    },

    /** Reset the tutorial state (for re-running) */
    reset() {
      state = { ...defaultState };
      active = true;
      persist();
    },
  };
}

export const tutorialStore = createTutorialStore();
