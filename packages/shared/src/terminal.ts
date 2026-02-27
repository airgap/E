// --- Terminal Types ---

/** Available shell profile for terminal sessions */
export interface ShellProfile {
  id: string;
  name: string;
  shellPath: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
  icon?: string;
  /** Whether this profile was auto-detected from system shells (read-only) */
  isAutoDetected?: boolean;
}

/** Detected shell on the system */
export interface ShellInfo {
  path: string;
  name: string;
  version: string;
}

/** Metadata for a terminal session (client-facing) */
export interface TerminalSessionMeta {
  id: string;
  shell: string;
  pid: number;
  cwd: string;
  cols: number;
  rows: number;
  createdAt: number;
  lastActivity: number;
  exitCode: number | null;
  attached: boolean;
  /** Whether session logging is currently active */
  logging: boolean;
  /** Path to the log file (if logging is or was active) */
  logFilePath: string | null;
  /** Story ID this session is scoped to (null if not story-scoped) */
  storyId: string | null;
}

/** Request to create a new terminal session */
export interface TerminalCreateRequest {
  shell?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
  /** Whether to enable shell integration (CWD tracking, command boundaries). Default: true */
  enableShellIntegration?: boolean;
  /** Story ID — when provided, terminal CWD resolves to the story's worktree path */
  storyId?: string;
}

/** Response from creating a terminal session */
export interface TerminalCreateResponse {
  sessionId: string;
  shell: string;
  pid: number;
  cwd: string;
  /** Story ID if the session was created with worktree scoping */
  storyId?: string;
}

// --- WebSocket Control Messages (0x02 prefix) ---

export type TerminalControlMessage =
  | TerminalReplayStart
  | TerminalReplayEnd
  | TerminalSessionExit
  | TerminalCwdChanged
  | TerminalCommandStart
  | TerminalCommandEnd
  | TerminalCommandText
  | TerminalLoggingStarted
  | TerminalLoggingStopped
  | TerminalRichContent;

export interface TerminalReplayStart {
  type: 'replay_start';
  bytes: number;
}

export interface TerminalReplayEnd {
  type: 'replay_end';
}

export interface TerminalSessionExit {
  type: 'session_exit';
  exitCode: number;
  signal?: number;
}

export interface TerminalCwdChanged {
  type: 'cwd_changed';
  cwd: string;
}

export interface TerminalCommandStart {
  type: 'command_start';
  id: string;
}

export interface TerminalCommandEnd {
  type: 'command_end';
  id: string;
  exitCode: number;
}

export interface TerminalCommandText {
  type: 'command_text';
  id: string;
  text: string;
}

export interface TerminalLoggingStarted {
  type: 'logging_started';
  logFilePath: string;
}

export interface TerminalLoggingStopped {
  type: 'logging_stopped';
}

// --- Rich Content Types ---

/** Content types supported by the rich block renderer */
export type RichContentType =
  | 'table'
  | 'json'
  | 'image'
  | 'diff'
  | 'markdown'
  | 'error'
  | 'progress'
  | 'test_results';

/** Rich content message sent from server when structured output is detected */
export interface TerminalRichContent {
  type: 'rich_content';
  /** The command block this content belongs to */
  blockId: string;
  /** What kind of rich content this is */
  contentType: RichContentType;
  /** Serialized payload (interpretation depends on contentType) */
  data: string;
}

/** Parsed table data for the table renderer */
export interface RichTableData {
  headers: string[];
  rows: string[][];
  /** Original format detected */
  format: 'csv' | 'tsv' | 'json' | 'columns';
}

/** Parsed error data for the error renderer */
export interface RichErrorData {
  errorType: string;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  frames: RichErrorFrame[];
}

export interface RichErrorFrame {
  file: string;
  line: number;
  column?: number;
  function: string;
  isInternal: boolean;
}

/** Parsed diff data for the diff renderer */
export interface RichDiffData {
  files: RichDiffFile[];
  stats: { additions: number; deletions: number; filesChanged: number };
}

export interface RichDiffFile {
  oldPath: string;
  newPath: string;
  hunks: RichDiffHunk[];
  binary: boolean;
  renamed: boolean;
}

export interface RichDiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: RichDiffLine[];
}

export interface RichDiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
}

// --- Protocol Constants ---

/** Binary prefix bytes for the terminal WebSocket protocol */
export const TERMINAL_PROTOCOL = {
  /** Raw PTY data (default / no prefix) */
  DATA: 0x00,
  /** Resize command: payload is "cols,rows" in ASCII */
  RESIZE: 0x01,
  /** JSON control message */
  CONTROL: 0x02,
} as const;

// --- Split Layout Types ---

export type SplitDirection = 'horizontal' | 'vertical';

export interface TerminalLeaf {
  type: 'leaf';
  sessionId: string;
}

export interface TerminalBranch {
  type: 'split';
  direction: SplitDirection;
  ratio: number;
  first: TerminalLayout;
  second: TerminalLayout;
}

export type TerminalLayout = TerminalLeaf | TerminalBranch;

// --- Tab Types ---

export interface TerminalTab {
  id: string;
  label: string;
  layout: TerminalLayout;
  focusedSessionId: string;
  /** Profile ID used to create this tab (for session reconnection) */
  profileId?: string;
}

// --- Preferences ---

export type CursorStyle = 'block' | 'underline' | 'bar';
export type BellStyle = 'none' | 'visual' | 'audio' | 'both';

export interface TerminalPreferences {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  cursorStyle: CursorStyle;
  cursorBlink: boolean;
  scrollback: number;
  bellStyle: BellStyle;
  copyOnSelect: boolean;
  rightClickPaste: boolean;
  defaultShell: string;
  enableShellIntegration: boolean;
  /** Enable inline image rendering (iTerm2 + Sixel protocols) */
  enableImages: boolean;
  /** Maximum image width in pixels (default 1000) */
  imageMaxWidth: number;
  /** Maximum image height in pixels (default 1000) */
  imageMaxHeight: number;
  /** Image storage cache limit in MB (default 64) */
  imageStorageLimit: number;
}

/** A command block representing a single command and its output in the terminal */
export interface TerminalCommandBlock {
  /** Unique command ID from shell integration */
  id: string;
  /** The command text typed by the user */
  commandText: string;
  /** The buffer row (absolute) where the command output starts */
  startRow: number;
  /** The buffer row (absolute) where the command output ends (-1 if still running) */
  endRow: number;
  /** Exit code of the command (null if still running) */
  exitCode: number | null;
  /** Whether the block is collapsed (showing only header) */
  collapsed: boolean;
  /** Timestamp when the command started */
  startedAt: number;
  /** Timestamp when the command finished (0 if still running) */
  finishedAt: number;
}

export const DEFAULT_TERMINAL_PREFERENCES: TerminalPreferences = {
  fontFamily: 'var(--font-family, monospace)',
  fontSize: 13,
  fontWeight: 400,
  lineHeight: 1.2,
  cursorStyle: 'block',
  cursorBlink: true,
  scrollback: 5000,
  bellStyle: 'visual',
  copyOnSelect: false,
  rightClickPaste: false,
  defaultShell: '',
  enableShellIntegration: true,
  enableImages: false,
  imageMaxWidth: 1000,
  imageMaxHeight: 1000,
  imageStorageLimit: 64,
};
