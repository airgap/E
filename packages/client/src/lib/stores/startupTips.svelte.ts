const STORAGE_KEY = 'e-startup-tips';

export interface StartupTip {
  id: string;
  /** Short category label (e.g. "Shortcut", "Feature", "Workflow") */
  category: string;
  /** The main tip text */
  text: string;
  /** Optional keyboard shortcut to display */
  shortcut?: string;
  /** Optional action to try (label for a button) */
  actionLabel?: string;
  /** Action identifier dispatched on click */
  actionId?: string;
}

export const STARTUP_TIPS: StartupTip[] = [
  {
    id: 'command-palette',
    category: 'Shortcut',
    text: 'Press Ctrl+K to open the Command Palette — search for any action in E.',
    shortcut: 'Ctrl+K',
    actionLabel: 'Try it',
    actionId: 'open-command-palette',
  },
  {
    id: 'at-mentions',
    category: 'Feature',
    text: 'Type @ in the chat input to attach files, symbols, or threads as context for E.',
    actionLabel: 'Focus chat',
    actionId: 'focus-chat',
  },
  {
    id: 'plan-mode',
    category: 'Workflow',
    text: 'Double-tap Shift+Tab to toggle Plan Mode — E will outline its approach before acting.',
    shortcut: 'Shift+Tab ×2',
  },
  {
    id: 'sidebar-panels',
    category: 'Navigation',
    text: 'Press Ctrl+/ to toggle the sidebar. It has 15+ panels: files, memory, agents, costs, and more.',
    shortcut: 'Ctrl+/',
    actionLabel: 'Toggle sidebar',
    actionId: 'toggle-sidebar',
  },
  {
    id: 'quick-open',
    category: 'Shortcut',
    text: 'Press Ctrl+P to fuzzy-search and open any file in your workspace — just like VS Code.',
    shortcut: 'Ctrl+P',
    actionLabel: 'Try it',
    actionId: 'open-quick-open',
  },
  {
    id: 'memory-panel',
    category: 'Feature',
    text: "Use the Memory panel to teach E about your project's conventions. It remembers across conversations.",
    actionLabel: 'Open Memory',
    actionId: 'open-memory-panel',
  },
  {
    id: 'teach-mode',
    category: 'Workflow',
    text: 'Click the Teach Mode button (graduation cap icon) or type /teach to enable Teach Mode — E explains concepts step by step.',
  },
  {
    id: 'session-replay',
    category: 'Feature',
    text: 'Type /replay to open Session Replay and review exactly how E solved a problem.',
  },
  {
    id: 'agent-profiles',
    category: 'Workflow',
    text: 'Press Ctrl+Shift+, to cycle agent profiles: Write (full autonomy), Ask (confirm first), or Minimal.',
    shortcut: 'Ctrl+Shift+,',
  },
  {
    id: 'branch-conversations',
    category: 'Feature',
    text: 'Hover any message and click the branch icon to fork the conversation — explore alternate approaches without losing context.',
  },
  {
    id: 'slash-commands',
    category: 'Shortcut',
    text: 'Type / in the chat input for quick commands: /clear, /new, /plan, /fork, /digest, and more.',
    actionLabel: 'Focus chat',
    actionId: 'focus-chat',
  },
  {
    id: 'help-panel',
    category: 'Navigation',
    text: 'Press ? to open the Help panel with searchable documentation for every E feature.',
    shortcut: '?',
    actionLabel: 'Open Help',
    actionId: 'open-help-panel',
  },
  {
    id: 'split-view',
    category: 'Shortcut',
    text: 'Press Ctrl+\\ to toggle between chat-only and split view with the code editor.',
    shortcut: 'Ctrl+\\',
  },
  {
    id: 'terminal',
    category: 'Feature',
    text: 'Press Ctrl+` to toggle the integrated terminal. E can run commands here when given permission.',
    shortcut: 'Ctrl+`',
  },
  {
    id: 'daily-digest',
    category: 'Workflow',
    text: 'Type /digest to see a summary of everything that happened in your workspace today.',
  },
  {
    id: 'themes',
    category: 'Customization',
    text: 'Open Settings (Ctrl+,) to explore themes — complete aesthetic packages with ambient effects.',
    shortcut: 'Ctrl+,',
    actionLabel: 'Open Settings',
    actionId: 'open-settings',
  },
  {
    id: 'voice-input',
    category: 'Feature',
    text: 'Click the microphone button in the chat input to dictate your message with speech-to-text.',
    actionLabel: 'Focus chat',
    actionId: 'focus-chat',
  },
  {
    id: 'loop-mode',
    category: 'Workflow',
    text: 'Create a PRD with user stories, then click Activate Golem — E implements stories autonomously.',
    actionLabel: 'Open Work panel',
    actionId: 'open-work-panel',
  },
  {
    id: 'workspace-tabs',
    category: 'Navigation',
    text: 'Use Ctrl+Alt+Left/Right to switch between workspace tabs, or Ctrl+Alt+W to close one.',
    shortcut: 'Ctrl+Alt+←/→',
  },
  {
    id: 'cost-tracking',
    category: 'Feature',
    text: 'Open the Costs panel in the sidebar to see real-time token usage, spend breakdown, and set budgets.',
    actionLabel: 'Open Costs',
    actionId: 'open-costs-panel',
  },
];

interface TipState {
  /** Index of the last shown tip */
  lastTipIndex: number;
  /** Set of tip IDs the user has already seen */
  seenTips: string[];
  /** Timestamp of last tip shown */
  lastShownAt: number | null;
}

const defaultState: TipState = {
  lastTipIndex: -1,
  seenTips: [],
  lastShownAt: null,
};

function loadState(): TipState {
  if (typeof window === 'undefined') return defaultState;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaultState, ...JSON.parse(raw) };
  } catch {}
  return defaultState;
}

function createStartupTipsStore() {
  let state = $state<TipState>(loadState());
  let visible = $state(false);
  let currentTip = $state<StartupTip | null>(null);

  function persist() {
    if (typeof window === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  /** Pick the next tip in rotation (round-robin through all tips) */
  function pickNextTip(): StartupTip {
    const nextIndex = (state.lastTipIndex + 1) % STARTUP_TIPS.length;
    return STARTUP_TIPS[nextIndex];
  }

  return {
    get visible() {
      return visible;
    },
    get currentTip() {
      return currentTip;
    },

    /** Show a startup tip (called on app mount) */
    show() {
      const tip = pickNextTip();
      currentTip = tip;
      visible = true;

      // Update state
      state.lastTipIndex = STARTUP_TIPS.indexOf(tip);
      if (!state.seenTips.includes(tip.id)) {
        state.seenTips = [...state.seenTips, tip.id];
      }
      state.lastShownAt = Date.now();
      persist();
    },

    /** Dismiss the current tip */
    dismiss() {
      visible = false;
    },

    /** Show the next tip (skip to next) */
    next() {
      state.lastTipIndex = (state.lastTipIndex + 1) % STARTUP_TIPS.length;
      const tip = pickNextTip();
      currentTip = tip;
      if (!state.seenTips.includes(tip.id)) {
        state.seenTips = [...state.seenTips, tip.id];
      }
      persist();
    },

    /** Total tip count */
    get totalTips() {
      return STARTUP_TIPS.length;
    },

    /** Current index (1-based for display) */
    get currentIndex() {
      return state.lastTipIndex + 1;
    },
  };
}

export const startupTipsStore = createStartupTipsStore();
