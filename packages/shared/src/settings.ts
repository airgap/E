import type { PermissionMode, PermissionRule, TerminalCommandPolicy } from './tools.js';
import type { MCPServerConfig } from './mcp.js';
import type { PatternLearningSettings } from './pattern-learning.js';

export type ThemeId =
  | 'dark'
  | 'light'
  | 'dark-colorblind'
  | 'light-colorblind'
  | 'dark-ansi'
  | 'light-ansi'
  | 'monokai'
  | 'dracula'
  | 'nord'
  | 'gruvbox-dark'
  | 'gruvbox-light'
  | 'solarized-dark'
  | 'solarized-light'
  | 'catppuccin-mocha'
  | 'catppuccin-latte'
  | 'tokyo-night'
  | 'rose-pine'
  | 'rose-pine-dawn'
  | 'synthwave'
  | 'github-dark'
  | 'github-light'
  | 'one-dark'
  | 'everforest'
  | 'goth'
  | 'high-contrast'
  | 'high-contrast-light'
  | (string & {});

export type CliProvider = 'claude' | 'kiro' | 'gemini-cli' | 'copilot' | 'ollama' | 'bedrock';

/**
 * Provider for one-shot (non-conversation) LLM calls like commentary, commit
 * messages, code actions, etc.
 *
 * - 'auto': Try local Ollama first, fall back to the CLI provider
 * - 'ollama': Always use local Ollama
 * - 'cli': Always use the configured cliProvider (Claude/Gemini/Copilot CLI)
 */
export type OneshotProvider = 'auto' | 'ollama' | 'cli';

/**
 * Voice mode for bidirectional voice interaction
 * - 'disabled': No voice input
 * - 'push-to-talk': Hold a key to activate voice input
 * - 'always-on': Continuous listening with wake word detection
 */
export type VoiceMode = 'disabled' | 'push-to-talk' | 'always-on';

/**
 * Voice input provider
 * - 'browser': Web Speech API (built-in, real-time)
 * - 'whisper': OpenAI Whisper API (higher accuracy, requires API key)
 */
export type VoiceInputProvider = 'browser' | 'whisper';

/**
 * Remote access mode
 * - 'disabled': No remote access
 * - 'tailscale': Tailscale serve/funnel integration
 * - 'ssh': SSH tunnel instructions provided
 */
export type RemoteAccessMode = 'disabled' | 'tailscale' | 'ssh';

/**
 * Remote session info — tracks active remote connections
 */
export interface RemoteSession {
  id: string;
  origin: string;
  userAgent: string;
  connectedAt: string;
  lastActivity: string;
  isRemote: boolean;
}

/**
 * Remote access configuration
 */
export interface RemoteAccessConfig {
  enabled: boolean;
  mode: RemoteAccessMode;
  requireAuth: boolean;
  tailscaleHostname?: string;
  sshTunnelCommand?: string;
}

/**
 * Device capabilities configuration
 * Opt-in device-level features for agents (screenshot, camera, location)
 */
export interface DeviceCapabilities {
  /** Allow agents to capture screenshots for visual debugging */
  screenshotEnabled: boolean;
  /** Allow agents to access camera for barcode/document scanning */
  cameraEnabled: boolean;
  /** Allow agents to access approximate location for timezone-aware scheduling */
  locationEnabled: boolean;
  /** Directory where captured media is stored (relative to workspace) */
  captureStorageDir: string;
  /** Maximum storage for captured media in MB */
  captureStorageLimitMb: number;
}

export interface Settings {
  theme: ThemeId;
  cliProvider: CliProvider;
  model: string;
  permissionMode: PermissionMode;
  permissionRules: PermissionRule[];
  terminalCommandPolicy: TerminalCommandPolicy;
  keybindings: Keybinding[];
  mcpServers: MCPServerConfig[];
  autoMemoryEnabled: boolean;
  workspacePath: string;
  maxBudgetUsd?: number;
  // Appearance
  fontSize: number;
  fontFamily: string;
  showThinkingBlocks: boolean;
  showToolDetails: boolean;
  // Behavior
  autoScroll: boolean;
  streamingEnabled: boolean;
  compactMessages: boolean;
  autoCompaction: boolean;
  // One-shot LLM (commentary, commit messages, code actions, etc.)
  oneshotProvider: OneshotProvider;
  oneshotModel: string;
  // Audio & notifications
  soundEnabled: boolean;
  soundVolume: number;
  soundStyle: 'classic' | 'melodic' | 'whimsy' | 'forest' | 'wind-chime';
  notifyOnCompletion: boolean;
  notifyOnFailure: boolean;
  notifyOnApproval: boolean;
  // Voice mode
  voiceMode: VoiceMode;
  voiceInputProvider: VoiceInputProvider;
  voiceWakeWord: string;
  voiceAutoSpeak: boolean;
  voiceLanguage: string;
  // Remote access
  remoteAccessEnabled: boolean;
  remoteAccessMode: RemoteAccessMode;
  remoteAccessRequireAuth: boolean;
  // Pattern detection & self-improving skills
  patternDetection: PatternLearningSettings;
  // Device capabilities
  deviceCapabilities: DeviceCapabilities;
}

export interface Keybinding {
  keys: string;
  action: string;
  context: 'global' | 'input' | 'chat';
  description?: string;
}

// API key is stored server-side only, never sent to client
export interface ServerOnlySettings {
  anthropicApiKey: string;
  workspacePaths: string[];
  sessionPersistence: boolean;
  debugMode: boolean;
  whisperApiKey?: string;
  remoteAccessTailscaleHostname?: string;
  remoteAccessSshTunnelCommand?: string;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  cliProvider: 'claude',
  model: 'claude-sonnet-4-6',
  permissionMode: 'safe',
  permissionRules: [],
  terminalCommandPolicy: 'auto',
  keybindings: [
    { keys: 'Ctrl+Enter', action: 'send', context: 'input', description: 'Send message' },
    {
      keys: 'Shift+Tab Shift+Tab',
      action: 'togglePlanMode',
      context: 'global',
      description: 'Toggle plan mode',
    },
    { keys: 'Escape', action: 'cancel', context: 'global', description: 'Cancel/close' },
    { keys: 'Ctrl+k', action: 'commandPalette', context: 'global', description: 'Command palette' },
    { keys: 'Ctrl+/', action: 'toggleSidebar', context: 'global', description: 'Toggle sidebar' },
    { keys: 'Ctrl+l', action: 'clearChat', context: 'global', description: 'Clear chat display' },
    {
      keys: 'Ctrl+Shift+p',
      action: 'commandPalette',
      context: 'global',
      description: 'Command palette (alt)',
    },
    {
      keys: 'Ctrl+Shift+,',
      action: 'cycleProfile',
      context: 'global',
      description: 'Cycle agent profile',
    },
  ],
  mcpServers: [],
  autoMemoryEnabled: true,
  workspacePath: '.',
  fontSize: 14,
  fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
  showThinkingBlocks: true,
  showToolDetails: true,
  autoScroll: true,
  streamingEnabled: true,
  compactMessages: false,
  autoCompaction: true,
  oneshotProvider: 'auto',
  oneshotModel: 'qwen3:1.7b',
  soundEnabled: true,
  soundVolume: 80,
  soundStyle: 'melodic',
  notifyOnCompletion: true,
  notifyOnFailure: true,
  notifyOnApproval: true,
  voiceMode: 'disabled',
  voiceInputProvider: 'browser',
  voiceWakeWord: 'Hey E',
  voiceAutoSpeak: false,
  voiceLanguage: 'en-US',
  remoteAccessEnabled: false,
  remoteAccessMode: 'disabled',
  remoteAccessRequireAuth: true,
  patternDetection: {
    enabled: true,
    sensitivity: 'moderate',
    minimumOccurrences: 3,
    confidenceThreshold: 0.7,
    autoCreateProposals: true,
    enabledPatternTypes: [
      'refactoring',
      'debugging',
      'testing',
      'documentation',
      'workflow',
      'code-generation',
    ],
  },
  deviceCapabilities: {
    screenshotEnabled: false,
    cameraEnabled: false,
    locationEnabled: false,
    captureStorageDir: '.e/device-captures',
    captureStorageLimitMb: 100,
  },
};
