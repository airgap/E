import type {
  CliProvider,
  OneshotProvider,
  Keybinding,
  PermissionMode,
  TerminalCommandPolicy,
  PermissionRule,
  ShellProfile,
  VoiceMode,
  VoiceInputProvider,
  DeviceCapabilities,
  PatternLearningSettings,
} from '@e/shared';
import { convertVsCodeSnippets, type ConvertedSnippet } from '$lib/utils/vscode-snippet-converter';
import { convertVsCodeTheme, type ConvertedTheme } from '$lib/utils/vscode-theme-converter';
import { findTheme, getDefaultTheme, getVisualStyle } from '$lib/config/themes';
import { getBaseUrl } from '$lib/api/client';

const STORAGE_KEY = 'e-settings';

interface SettingsState {
  theme: string;
  cliProvider: CliProvider;
  model: string;
  permissionMode: PermissionMode;
  terminalCommandPolicy: TerminalCommandPolicy;
  permissionRules: PermissionRule[];
  keybindings: Keybinding[];
  autoMemoryEnabled: boolean;
  /** Require change preview for AI file modifications */
  requireChangePreview: boolean;
  /** Format on save via LSP or external formatter */
  formatOnSave: boolean;
  /** Organize imports on save via LSP code action */
  organizeImportsOnSave: boolean;
  /** Formatter preference */
  defaultFormatter: 'auto' | 'lsp' | 'external';
  /** Show LSP inlay type hints inline in the editor */
  showInlayHints: boolean;
  /** Show inline git blame annotations at end of each line */
  showInlineBlame: boolean;
  /** Show LSP code lens (reference counts, etc.) above functions */
  showCodeLens: boolean;
  /** Enable proactive AI warnings (LLM-powered code review on edit) */
  proactiveWarningsEnabled: boolean;
  fontSize: number;
  uiFontSize: number | null; // null = follow code font size
  fontFamily: string;
  fontFamilySans: string;
  showThinkingBlocks: boolean;
  showToolDetails: boolean;
  autoScroll: boolean;
  streamingEnabled: boolean;
  compactMessages: boolean;
  autoCompaction: boolean;
  /** Percentage of context window at which auto-compaction triggers (70-95) */
  autoCompactionThreshold: number;
  /** Number of recent messages to keep uncompacted (10-50) */
  compactionRetentionCount: number;
  showBudgetDisplay: boolean;
  workspacePath: string;
  effort: string;
  maxBudgetUsd: number | null;
  maxTurns: number | null;
  sessionBudgetUsd: number | null;
  customSnippets: Record<string, ConvertedSnippet[]>;
  customThemes: Record<
    string,
    { name: string; type: 'dark' | 'light'; cssVars: Record<string, string> }
  >;
  streamingIndicator: 'dots' | 'spinner' | 'pulse' | 'none';
  streamingProgressBar:
    | 'rainbow'
    | 'accent'
    | 'pulse'
    | 'neon'
    | 'cylon'
    | 'matrix'
    | 'comet'
    | 'helix'
    | 'fire'
    | 'ocean'
    | 'electric'
    | 'candy'
    | 'vapor'
    | 'none';
  streamingCursor: 'block' | 'line' | 'underscore' | 'none';
  sendWithEnter: boolean;
  soundEnabled: boolean;
  soundVolume: number;
  soundStyle: 'classic' | 'melodic' | 'whimsy' | 'forest' | 'wind-chime' | 'chiptune';
  keyboardSounds: boolean;
  // Desktop notification settings
  notifyOnCompletion: boolean;
  notifyOnFailure: boolean;
  notifyOnApproval: boolean;
  // Startup tips
  showStartupTips: boolean;
  // Terminal preferences
  termFontFamily: string;
  termFontSize: number;
  termFontWeight: number;
  termLineHeight: number;
  termCursorStyle: 'block' | 'underline' | 'bar';
  termCursorBlink: boolean;
  termScrollback: number;
  termBellStyle: 'none' | 'visual' | 'audio' | 'both';
  termCopyOnSelect: boolean;
  termRightClickPaste: boolean;
  termDefaultShell: string;
  termEnableShellIntegration: boolean;
  termEnableImages: boolean;
  termImageMaxWidth: number;
  termImageMaxHeight: number;
  termImageStorageLimit: number;
  // Terminal profiles
  terminalProfiles: ShellProfile[];
  termDefaultProfileId: string;
  // Agent terminal integration
  agentTerminalEnabled: boolean;
  // Commentary TTS
  ttsEnabled: boolean;
  ttsVolume: number;
  ttsProvider: 'browser' | 'elevenlabs' | 'google';
  elevenLabsApiKey?: string;
  googleTtsApiKey?: string;
  // Experimental: spatial audio for multi-workspace TTS
  spatialAudioEnabled: boolean;
  // One-shot LLM (commentary, commit messages, code actions)
  oneshotProvider: OneshotProvider;
  oneshotModel: string;
  // Mobile bottom nav bar tabs (up to 10, "more" is always appended)
  mobileNavTabs: string[];
  // Snappy cursor effect (FTL prediction)
  snappyCursor: boolean;
  // Voice mode
  voiceMode: VoiceMode;
  voiceInputProvider: VoiceInputProvider;
  voiceWakeWord: string;
  voiceAutoSpeak: boolean;
  voiceLanguage: string;
  // Device capabilities
  deviceCapabilities: DeviceCapabilities;
  // Pattern detection / self-improving skills
  patternDetection: PatternLearningSettings;
}

const defaults: SettingsState = {
  theme: 'dark',
  cliProvider: 'claude',
  model: 'claude-sonnet-4-6',
  permissionMode: 'safe',
  terminalCommandPolicy: 'auto',
  permissionRules: [],
  keybindings: [
    { keys: 'Enter', action: 'send', context: 'input', description: 'Send message' },
    {
      keys: 'Shift+Tab Shift+Tab',
      action: 'togglePlanMode',
      context: 'global',
      description: 'Toggle plan mode',
    },
    { keys: 'Escape', action: 'cancel', context: 'global', description: 'Cancel/close' },
    { keys: 'Ctrl+k', action: 'commandPalette', context: 'global', description: 'Command palette' },
    { keys: 'Ctrl+/', action: 'toggleSidebar', context: 'global', description: 'Toggle sidebar' },
  ],
  autoMemoryEnabled: true,
  requireChangePreview: false,
  formatOnSave: false,
  organizeImportsOnSave: false,
  defaultFormatter: 'auto' as const,
  showInlayHints: false,
  showInlineBlame: false,
  showCodeLens: true,
  proactiveWarningsEnabled: false,
  fontSize: 14,
  uiFontSize: null,
  fontFamily: 'share-tech-mono',
  fontFamilySans: 'rajdhani',
  showThinkingBlocks: true,
  showToolDetails: true,
  autoScroll: true,
  streamingEnabled: true,
  compactMessages: false,
  autoCompaction: true,
  autoCompactionThreshold: 85,
  compactionRetentionCount: 15,
  showBudgetDisplay: false,
  workspacePath: '.',
  effort: 'high',
  maxBudgetUsd: null,
  maxTurns: null,
  sessionBudgetUsd: null,
  customSnippets: {},
  customThemes: {},
  streamingIndicator: 'dots',
  streamingProgressBar: 'rainbow',
  streamingCursor: 'block',
  sendWithEnter: true,
  soundEnabled: true,
  soundVolume: 80,
  soundStyle: 'melodic',
  keyboardSounds: false,
  notifyOnCompletion: true,
  notifyOnFailure: true,
  notifyOnApproval: true,
  showStartupTips: true,
  termFontFamily: 'var(--font-family, monospace)',
  termFontSize: 13,
  termFontWeight: 400,
  termLineHeight: 1.2,
  termCursorStyle: 'block',
  termCursorBlink: true,
  termScrollback: 5000,
  termBellStyle: 'visual',
  termCopyOnSelect: false,
  termRightClickPaste: false,
  termDefaultShell: '',
  termEnableShellIntegration: true,
  termEnableImages: false,
  termImageMaxWidth: 1000,
  termImageMaxHeight: 1000,
  termImageStorageLimit: 64,
  terminalProfiles: [],
  termDefaultProfileId: '',
  agentTerminalEnabled: false,
  ttsEnabled: false,
  ttsVolume: 80,
  ttsProvider: 'browser',
  elevenLabsApiKey: undefined,
  googleTtsApiKey: undefined,
  spatialAudioEnabled: false,
  oneshotProvider: 'auto',
  oneshotModel: 'qwen3:1.7b',
  mobileNavTabs: ['chat', 'files', 'terminal', 'work'],
  snappyCursor: false,
  voiceMode: 'disabled',
  voiceInputProvider: 'browser',
  voiceWakeWord: 'Hey E',
  voiceAutoSpeak: false,
  voiceLanguage: 'en-US',
  deviceCapabilities: {
    screenshotEnabled: false,
    cameraEnabled: false,
    locationEnabled: false,
    captureStorageDir: '.e/device-captures',
    captureStorageLimitMb: 100,
  },
  patternDetection: {
    enabled: true,
    sensitivity: 'moderate',
    minimumOccurrences: 3,
    confidenceThreshold: 0.7,
    autoCreateProposals: true,
    enabledPatternTypes: [
      'refactoring',
      'workflow',
      'tool-usage',
      'problem-solving',
      'file-pattern',
      'command-sequence',
    ],
  },
};

function loadFromStorage(): SettingsState {
  if (typeof window === 'undefined') return defaults;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = { ...defaults, ...JSON.parse(raw) };
      // Migrate old CSS-string fontFamily values to font IDs
      if (parsed.fontFamily && parsed.fontFamily.includes("'")) {
        parsed.fontFamily = defaults.fontFamily;
      }
      if (!parsed.fontFamilySans) {
        parsed.fontFamilySans = defaults.fontFamilySans;
      }
      // ── Migration: unify separate theme + hypertheme into single theme ──
      if (parsed.hypertheme) {
        if (parsed.hypertheme !== 'tech') {
          parsed.theme = parsed.hypertheme;
        }
        delete parsed.hypertheme;
      }
      // Migrate: slot-machine sound style was removed
      if (parsed.soundStyle === 'slot-machine') {
        parsed.soundStyle = defaults.soundStyle;
      }
      // Migrate: candyland theme was removed
      if (parsed.theme === 'candyland') {
        parsed.theme = defaults.theme;
      }
      // Migrate: voiceAutoSpeak was incorrectly defaulted to true — force off
      if (parsed.voiceAutoSpeak === true) {
        parsed.voiceAutoSpeak = false;
      }
      return parsed;
    }
  } catch {}
  return defaults;
}

function createSettingsStore() {
  let state = $state<SettingsState>(loadFromStorage());

  // Settings the server needs to know about (used for CLI process spawning & tool gating)
  const SERVER_SYNCED_KEYS: (keyof SettingsState)[] = [
    'cliProvider',
    'autoCompaction',
    'autoCompactionThreshold',
    'compactionRetentionCount',
    'permissionMode',
    'terminalCommandPolicy',
    'deviceCapabilities',
  ];

  function persist() {
    if (typeof window === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    applyTheme(state.theme);
  }

  function syncToServer(partial: Partial<SettingsState>) {
    const serverSettings: Record<string, unknown> = {};
    for (const key of SERVER_SYNCED_KEYS) {
      if (key in partial) serverSettings[key] = partial[key];
    }
    if (Object.keys(serverSettings).length === 0) return;

    fetch(`${getBaseUrl()}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: serverSettings }),
    }).catch(() => {
      /* best-effort sync */
    });
  }

  function applyTheme(themeId: string) {
    if (typeof document === 'undefined') return;

    const root = document.documentElement;
    const config = findTheme(themeId);
    const visualStyle = getVisualStyle(themeId);

    // Set data-theme and data-hypertheme FIRST so CSS [data-theme] selectors
    // resolve correctly before we touch any inline vars. This prevents a flash
    // when standard themes have their inline --bg-primary removed (they fall
    // back to the CSS selector value, which must already be pointing at the
    // correct theme).
    if (config?.category === 'immersive') {
      root.setAttribute('data-theme', config.type);
    } else if (themeId.startsWith('custom-') && state.customThemes[themeId]) {
      root.setAttribute('data-theme', state.customThemes[themeId].type);
    } else {
      root.setAttribute('data-theme', themeId);
    }
    root.setAttribute('data-hypertheme', visualStyle);

    // Collect the complete set of new inline CSS vars
    const newVars = new Map<string, string>();

    // Structural CSS vars (--ht-*)
    const effectiveConfig = config || getDefaultTheme();
    for (const [varName, value] of Object.entries(effectiveConfig.cssVars)) {
      newVars.set(varName, value);
    }

    // Color overrides for immersive themes
    if (effectiveConfig.colorOverrides) {
      for (const [varName, value] of Object.entries(effectiveConfig.colorOverrides)) {
        newVars.set(varName, value);
      }
    }

    // Custom theme vars
    if (themeId.startsWith('custom-') && state.customThemes[themeId]) {
      const ct = state.customThemes[themeId];
      for (const [varName, value] of Object.entries(ct.cssVars)) {
        newVars.set(varName, value);
      }
    }

    // Apply new values (overwrites existing), then remove stale vars.
    // Since data-theme is already correct, removing a stale inline var
    // falls back to the right CSS value — no flash.
    for (const [varName, value] of newVars) {
      root.style.setProperty(varName, value);
    }
    for (const key of Array.from(root.style)) {
      if (key.startsWith('--') && !newVars.has(key)) {
        root.style.removeProperty(key);
      }
    }
  }

  // Apply theme on load
  if (typeof window !== 'undefined') {
    const initialTheme = state.theme;
    applyTheme(initialTheme);
  }

  return {
    get theme() {
      return state.theme;
    },
    get visualStyle() {
      return getVisualStyle(state.theme);
    },
    /** @deprecated Use visualStyle instead */
    get hypertheme() {
      return getVisualStyle(state.theme);
    },
    get cliProvider() {
      return state.cliProvider;
    },
    get model() {
      return state.model;
    },
    get oneshotProvider() {
      return state.oneshotProvider ?? 'auto';
    },
    get oneshotModel() {
      return state.oneshotModel ?? 'qwen3:1.7b';
    },
    get permissionMode() {
      return state.permissionMode;
    },
    get terminalCommandPolicy() {
      return state.terminalCommandPolicy;
    },
    get permissionRules() {
      return state.permissionRules;
    },
    get keybindings() {
      return state.keybindings;
    },
    get autoMemoryEnabled() {
      return state.autoMemoryEnabled;
    },
    get requireChangePreview() {
      return state.requireChangePreview;
    },
    get formatOnSave() {
      return state.formatOnSave;
    },
    get organizeImportsOnSave() {
      return state.organizeImportsOnSave;
    },
    get showInlayHints() {
      return state.showInlayHints;
    },
    get showInlineBlame() {
      return state.showInlineBlame;
    },
    get showCodeLens() {
      return state.showCodeLens;
    },
    get proactiveWarningsEnabled() {
      return state.proactiveWarningsEnabled;
    },
    get defaultFormatter() {
      return state.defaultFormatter;
    },
    get fontSize() {
      return state.fontSize;
    },
    get uiFontSize() {
      return state.uiFontSize;
    },
    /** Effective UI font size — falls back to code font size when null */
    get effectiveUiFontSize() {
      return state.uiFontSize ?? state.fontSize;
    },
    get fontFamily() {
      return state.fontFamily;
    },
    get fontFamilySans() {
      return state.fontFamilySans;
    },
    get showThinkingBlocks() {
      return state.showThinkingBlocks;
    },
    get showToolDetails() {
      return state.showToolDetails;
    },
    get autoScroll() {
      return state.autoScroll;
    },
    get streamingEnabled() {
      return state.streamingEnabled;
    },
    get compactMessages() {
      return state.compactMessages;
    },
    get autoCompaction() {
      return state.autoCompaction;
    },
    get autoCompactionThreshold() {
      return state.autoCompactionThreshold;
    },
    get compactionRetentionCount() {
      return state.compactionRetentionCount;
    },
    get showBudgetDisplay() {
      return state.showBudgetDisplay;
    },
    get workspacePath() {
      return state.workspacePath;
    },
    get effort() {
      return state.effort;
    },
    get maxBudgetUsd() {
      return state.maxBudgetUsd;
    },
    get maxTurns() {
      return state.maxTurns;
    },
    get sessionBudgetUsd() {
      return state.sessionBudgetUsd;
    },
    get streamingIndicator() {
      return state.streamingIndicator;
    },
    get streamingProgressBar() {
      return state.streamingProgressBar;
    },
    get streamingCursor() {
      return state.streamingCursor;
    },
    get sendWithEnter() {
      return state.sendWithEnter;
    },
    get soundEnabled() {
      return state.soundEnabled;
    },
    get soundVolume() {
      return state.soundVolume;
    },
    get soundStyle() {
      return state.soundStyle;
    },
    get keyboardSounds() {
      return state.keyboardSounds;
    },
    get notifyOnCompletion() {
      return state.notifyOnCompletion;
    },
    get notifyOnFailure() {
      return state.notifyOnFailure;
    },
    get notifyOnApproval() {
      return state.notifyOnApproval;
    },
    get showStartupTips() {
      return state.showStartupTips;
    },
    get termFontFamily() {
      return state.termFontFamily;
    },
    get termFontSize() {
      return state.termFontSize;
    },
    get termFontWeight() {
      return state.termFontWeight;
    },
    get termLineHeight() {
      return state.termLineHeight;
    },
    get termCursorStyle() {
      return state.termCursorStyle;
    },
    get termCursorBlink() {
      return state.termCursorBlink;
    },
    get termScrollback() {
      return state.termScrollback;
    },
    get termBellStyle() {
      return state.termBellStyle;
    },
    get termCopyOnSelect() {
      return state.termCopyOnSelect;
    },
    get termRightClickPaste() {
      return state.termRightClickPaste;
    },
    get termDefaultShell() {
      return state.termDefaultShell;
    },
    get termEnableShellIntegration() {
      return state.termEnableShellIntegration;
    },
    get termEnableImages() {
      return state.termEnableImages;
    },
    get termImageMaxWidth() {
      return state.termImageMaxWidth;
    },
    get termImageMaxHeight() {
      return state.termImageMaxHeight;
    },
    get termImageStorageLimit() {
      return state.termImageStorageLimit;
    },
    get terminalProfiles() {
      return state.terminalProfiles;
    },
    get termDefaultProfileId() {
      return state.termDefaultProfileId;
    },
    get agentTerminalEnabled() {
      return state.agentTerminalEnabled;
    },
    get ttsEnabled() {
      return state.ttsEnabled;
    },
    get ttsVolume() {
      return state.ttsVolume;
    },
    get ttsProvider() {
      return state.ttsProvider;
    },
    get elevenLabsApiKey() {
      return state.elevenLabsApiKey;
    },
    get googleTtsApiKey() {
      return state.googleTtsApiKey;
    },
    get spatialAudioEnabled() {
      return state.spatialAudioEnabled;
    },
    get mobileNavTabs() {
      return state.mobileNavTabs;
    },
    get snappyCursor() {
      return state.snappyCursor;
    },
    get voiceMode() {
      return state.voiceMode;
    },
    get voiceInputProvider() {
      return state.voiceInputProvider;
    },
    get voiceWakeWord() {
      return state.voiceWakeWord;
    },
    get voiceAutoSpeak() {
      return state.voiceAutoSpeak;
    },
    get voiceLanguage() {
      return state.voiceLanguage;
    },
    get deviceCapabilities() {
      return state.deviceCapabilities;
    },
    get patternDetection() {
      return state.patternDetection;
    },
    get all() {
      return state;
    },

    setTheme(themeId: string) {
      state.theme = themeId;
      persist();
    },
    /** @deprecated Use setTheme() instead */
    setHypertheme(themeId: string) {
      state.theme = themeId;
      persist();
    },
    setModel(model: string) {
      state.model = model;
      persist();
    },
    setPermissionMode(mode: PermissionMode) {
      state.permissionMode = mode;
      persist();
      // Sync to server so it takes effect for the running process immediately.
      // The server reads permissionMode from its settings DB on every tool call.
      syncToServer({ permissionMode: mode });
    },
    setTerminalCommandPolicy(policy: TerminalCommandPolicy) {
      state.terminalCommandPolicy = policy;
      persist();
      syncToServer({ terminalCommandPolicy: policy });
    },
    setPermissionRules(rules: PermissionRule[]) {
      state.permissionRules = rules;
      persist();
    },
    update(partial: Partial<SettingsState>) {
      state = { ...state, ...partial };
      persist();
      syncToServer(partial);
    },
    setKeybinding(action: string, keys: string) {
      const idx = state.keybindings.findIndex((k) => k.action === action);
      if (idx >= 0) state.keybindings[idx].keys = keys;
      persist();
    },

    // --- Custom snippets ---
    get customSnippets() {
      return state.customSnippets;
    },
    importSnippets(json: Record<string, any>, language: string) {
      const converted = convertVsCodeSnippets(json);
      const existing = state.customSnippets[language] || [];
      state.customSnippets = {
        ...state.customSnippets,
        [language]: [...existing, ...converted],
      };
      persist();
      return converted.length;
    },
    clearSnippets(language: string) {
      const { [language]: _, ...rest } = state.customSnippets;
      state.customSnippets = rest;
      persist();
    },

    // --- Custom themes ---
    get customThemes() {
      return state.customThemes;
    },
    importTheme(json: Record<string, any>): string {
      const theme = convertVsCodeTheme(json as any);
      state.customThemes = {
        ...state.customThemes,
        [theme.id]: { name: theme.name, type: theme.type, cssVars: theme.cssVars },
      };
      persist();
      return theme.id;
    },
    deleteCustomTheme(id: string) {
      const { [id]: _, ...rest } = state.customThemes;
      state.customThemes = rest;
      // If current theme was deleted, switch to dark
      if (state.theme === id) {
        state.theme = 'dark';
      }
      persist();
    },

    // --- Terminal profiles ---
    addTerminalProfile(profile: ShellProfile) {
      state.terminalProfiles = [...state.terminalProfiles, profile];
      persist();
    },
    updateTerminalProfile(id: string, updates: Partial<ShellProfile>) {
      state.terminalProfiles = state.terminalProfiles.map((p) =>
        p.id === id ? { ...p, ...updates } : p,
      );
      persist();
    },
    deleteTerminalProfile(id: string) {
      state.terminalProfiles = state.terminalProfiles.filter((p) => p.id !== id);
      // If the deleted profile was the default, clear it
      if (state.termDefaultProfileId === id) {
        state.termDefaultProfileId = '';
      }
      persist();
    },
    setDefaultProfileId(id: string) {
      state.termDefaultProfileId = id;
      persist();
    },
  };
}

export const settingsStore = createSettingsStore();
