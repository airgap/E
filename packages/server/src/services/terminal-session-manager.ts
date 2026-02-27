import { nanoid } from 'nanoid';
import type {
  TerminalSessionMeta,
  TerminalCreateRequest,
  TerminalCreateResponse,
  TerminalControlMessage,
  ShellInfo,
} from '@e/shared';
import { TERMINAL_PROTOCOL } from '@e/shared';
import { parseTestOutput } from './test-output-parser.js';
import { existsSync, mkdirSync, appendFileSync, writeFileSync, realpathSync } from 'fs';
import { basename, resolve, dirname, join } from 'path';
import { homedir } from 'os';
import { getForStory as getWorktreeForStory } from './worktree-service';

// --- Shell Integration Script Paths ---

/** Resolve the path to a shell integration script by shell name */
function getShellIntegrationPath(shellName: string): string | null {
  // import.meta.dir = .../src/services/ in Bun
  // Shell integration scripts live at .../src/shell-integration/
  const srcDir = dirname(import.meta.dir); // .../src/
  const candidates = [
    resolve(srcDir, 'shell-integration'), // .../src/shell-integration/
  ];

  const fileMap: Record<string, string> = {
    bash: 'bash-integration.sh',
    zsh: 'zsh-integration.sh',
    fish: 'fish-integration.fish',
  };

  const fileName = fileMap[shellName];
  if (!fileName) return null;

  for (const dir of candidates) {
    const script = resolve(dir, fileName);
    if (existsSync(script)) return script;
  }
  return null;
}

/** Determine the shell name (bash, zsh, fish) from a shell path */
function getShellName(shellPath: string): string {
  const base = basename(shellPath).toLowerCase();
  if (base.includes('bash')) return 'bash';
  if (base.includes('zsh')) return 'zsh';
  if (base.includes('fish')) return 'fish';
  return base;
}

// --- OSC Sequence Parsing ---

/**
 * Parse and strip OSC sequences from PTY output data.
 * Returns the cleaned data (for display) and any extracted events.
 *
 * Supported sequences:
 *   - OSC 7: \x1b]7;file://hostname/path\x07  (or ST = \x1b\\)
 *   - OSC 633;C: \x1b]633;C\x07              (command start)
 *   - OSC 633;D;exitCode: \x1b]633;D;N\x07   (command end)
 */
interface OscParseResult {
  /** PTY data with OSC sequences stripped out */
  cleanData: string;
  /** Extracted CWD from OSC 7, if any */
  cwd: string | null;
  /** Whether a command_start was detected */
  commandStart: boolean;
  /** Exit code from command_end, or null if no command_end detected */
  commandEndExitCode: number | null;
  /** Command line text from OSC 633;E, if any */
  commandText: string | null;
}

// Regex for OSC sequences terminated by BEL (\x07) or ST (\x1b\\)
// OSC 7:    \x1b]7;file://host/path(\x07|\x1b\\)
// OSC 633:  \x1b]633;...\x07|\x1b\\)
const OSC_RE = /\x1b\](?:7;([^\x07\x1b]*)|633;([^\x07\x1b]*))(?:\x07|\x1b\\)/g;

function parseOscSequences(data: string): OscParseResult {
  let cwd: string | null = null;
  let commandStart = false;
  let commandEndExitCode: number | null = null;
  let commandText: string | null = null;

  // Extract info from OSC sequences
  let match: RegExpExecArray | null;
  OSC_RE.lastIndex = 0;
  while ((match = OSC_RE.exec(data)) !== null) {
    const osc7Payload = match[1];
    const osc633Payload = match[2];

    if (osc7Payload !== undefined) {
      // OSC 7: file://hostname/path
      try {
        const url = new URL(osc7Payload);
        cwd = decodeURIComponent(url.pathname);
      } catch {
        // Try simple path extraction: file://host/path
        const pathMatch = osc7Payload.match(/^file:\/\/[^/]*(\/.*)/);
        if (pathMatch) {
          cwd = decodeURIComponent(pathMatch[1]);
        }
      }
    }

    if (osc633Payload !== undefined) {
      if (osc633Payload === 'C') {
        commandStart = true;
      } else if (osc633Payload.startsWith('D;')) {
        const code = parseInt(osc633Payload.slice(2), 10);
        commandEndExitCode = isNaN(code) ? 0 : code;
      } else if (osc633Payload === 'D') {
        commandEndExitCode = 0;
      } else if (osc633Payload.startsWith('E;')) {
        commandText = osc633Payload.slice(2);
      }
    }
  }

  // Strip all OSC sequences from the data before forwarding to clients
  const cleanData = data.replace(OSC_RE, '');

  return { cleanData, cwd, commandStart, commandEndExitCode, commandText };
}

// --- Session Logging ---

/** Default directory for terminal session logs */
const LOG_DIR = join(homedir(), '.e', 'terminal-logs');

/**
 * Strip ANSI escape sequences (CSI, OSC, SGR, cursor movement, etc.)
 * from terminal output for clean, readable log files.
 */
// eslint-disable-next-line no-control-regex
const ANSI_RE =
  /\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][0-9A-B]|\x1b[=><!]|\x1b\[[\?]?[0-9;]*[hlJKmSusr]|\r/g;

function stripAnsi(data: string): string {
  return data.replace(ANSI_RE, '');
}

/** Generate a timestamped log file path for a session */
function makeLogFilePath(sessionId: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '');
  return join(LOG_DIR, `${sessionId}_${ts}.log`);
}

/** Ensure the log directory exists */
function ensureLogDir(): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

// --- PTY Helper ---
// node-pty's native addon doesn't work under Bun (PTY processes get SIGHUP
// immediately). We use a native C helper that does forkpty+exec and proxies
// raw I/O — no JSON, no base64, no Node.js subprocess.

import { spawn as nodeSpawn, type ChildProcess } from 'child_process';

const PTY_HELPER_PATH = resolve(dirname(import.meta.dir), '..', 'src', 'native', 'pty-helper');

/** IPty-compatible handle backed by the native pty-helper binary */
class NativePty {
  pid: number = 0;
  /** Called when the child PID is detected (may be delayed) */
  onPid: ((pid: number) => void) | null = null;
  private helper: ChildProcess;
  private ctlStream: import('stream').Writable | null = null;
  private dataCallbacks: Array<(data: string) => void> = [];
  private exitCallbacks: Array<(info: { exitCode: number; signal?: number }) => void> = [];
  private exited = false;

  constructor(
    shell: string,
    args: string[],
    opts: { cols: number; rows: number; cwd: string; env: Record<string, string>; name?: string },
  ) {
    this.helper = nodeSpawn(
      PTY_HELPER_PATH,
      [shell, opts.cwd, String(opts.cols), String(opts.rows), ...args],
      {
        stdio: ['pipe', 'pipe', 'inherit', 'pipe'],
        env: opts.env,
      },
    );

    // fd 3 = control channel for resize
    this.ctlStream = this.helper.stdio[3] as import('stream').Writable;

    // Raw PTY output — no decoding, no framing
    this.helper.stdout!.on('data', (chunk: Buffer) => {
      const str = chunk.toString();
      for (const cb of this.dataCallbacks) cb(str);
    });

    // Detect PID from the helper's child (use helper's own pid as fallback,
    // real child pid is inside the helper)
    this.pid = this.helper.pid ?? 0;
    // The helper's child PID isn't directly exposed, but for session metadata
    // the helper PID is sufficient (killing it will kill the child too).
    if (this.pid && this.onPid) this.onPid(this.pid);

    this.helper.on('exit', (code, signal) => {
      if (!this.exited) {
        this.exited = true;
        const exitCode = code ?? (signal ? 128 : 1);
        const sig = signal ? parseInt(signal) || undefined : undefined;
        for (const cb of this.exitCallbacks) cb({ exitCode, signal: sig });
      }
    });
  }

  write(data: string) {
    if (this.helper.stdin?.writable) {
      this.helper.stdin.write(data);
    }
  }

  resize(cols: number, rows: number) {
    if (this.ctlStream?.writable) {
      const buf = Buffer.alloc(5);
      buf[0] = 0x01;
      buf.writeUInt16LE(cols, 1);
      buf.writeUInt16LE(rows, 3);
      this.ctlStream.write(buf);
    }
  }

  kill() {
    try {
      this.helper.kill('SIGTERM');
    } catch {}
    setTimeout(() => {
      try {
        this.helper.kill('SIGKILL');
      } catch {}
    }, 200);
  }

  onData(cb: (data: string) => void) {
    this.dataCallbacks.push(cb);
  }

  onExit(cb: (info: { exitCode: number; signal?: number }) => void) {
    this.exitCallbacks.push(cb);
  }
}

/** Check that the pty-helper binary exists */
const ptyAvailable = existsSync(PTY_HELPER_PATH);

// --- Types ---

/** Minimal WebSocket-like interface for both standard WebSocket and Bun ServerWebSocket */
interface WsLike {
  send(data: string | ArrayBuffer | Uint8Array): void;
  close(code?: number, reason?: string): void;
}

interface TerminalSession {
  id: string;
  shell: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
  pid: number;
  pty: NativePty;
  /** Ring buffer of recent output chunks for reconnect replay */
  scrollbackBuffer: string[];
  scrollbackBytes: number;
  createdAt: number;
  lastActivity: number;
  exitCode: number | null;
  exitSignal: number | null;
  /** All currently attached WebSocket clients */
  attachedWs: Set<WsLike>;
  /** Whether logging is enabled for this session */
  logging: boolean;
  /** Path to the active log file (null if logging never started) */
  logFilePath: string | null;
  /** Whether shell integration OSC parsing is enabled */
  shellIntegration: boolean;
  /** Counter for generating unique command IDs */
  commandCounter: number;
  /** The current in-flight command ID (for pairing start/end) */
  currentCommandId: string | null;
  /** Coalescing buffer for PTY output — flushed on a microtimer */
  outputBuffer: string;
  /** Timer handle for the coalescing flush */
  flushTimer: ReturnType<typeof setTimeout> | null;
  /** Accumulates output during a command block for rich content analysis */
  commandOutputBuffer: string;
  /** Whether we are currently inside a command block (between start and end) */
  commandInProgress: boolean;
  /** The current command's text (for context-aware analysis) */
  currentCommandText: string | null;
  /** Story ID this session is scoped to (undefined if not story-scoped) */
  storyId?: string;
}

/** Maximum scrollback buffer size in bytes per session */
const MAX_SCROLLBACK_BYTES = 64 * 1024; // 64KB

/** Output coalescing: flush interval and size threshold */
const FLUSH_INTERVAL_MS = 2; // Flush at most every 2ms
const FLUSH_SIZE_THRESHOLD = 8 * 1024; // Flush immediately if buffer exceeds 8KB

/** GC interval: check for orphaned sessions every 5 minutes */
const GC_INTERVAL_MS = 5 * 60 * 1000;

/** Sessions that exited + no WS + idle > this are garbage collected */
const ORPHAN_TIMEOUT_MS = 30 * 60 * 1000;

// --- Shell Detection ---

const SHELL_CANDIDATES = [
  { path: '/bin/bash', name: 'Bash' },
  { path: '/usr/bin/bash', name: 'Bash' },
  { path: '/bin/zsh', name: 'Zsh' },
  { path: '/usr/bin/zsh', name: 'Zsh' },
  { path: '/usr/bin/fish', name: 'Fish' },
  { path: '/usr/bin/pwsh', name: 'PowerShell' },
  { path: '/usr/local/bin/pwsh', name: 'PowerShell' },
  { path: '/bin/sh', name: 'sh' },
];

let cachedShells: ShellInfo[] | null = null;

async function getShellVersion(shellPath: string): Promise<string> {
  try {
    const proc = Bun.spawn([shellPath, '--version'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    // Extract first line, trim
    const firstLine = text.split('\n')[0]?.trim() || '';
    // Try to extract version number (e.g. "5.2.15" from "GNU bash, version 5.2.15(1)-release")
    const vMatch = firstLine.match(/(\d+\.\d+[\w.-]*)/);
    return vMatch?.[1] || firstLine.slice(0, 50);
  } catch {
    return '';
  }
}

// --- Session Manager ---

class TerminalSessionManager {
  private sessions = new Map<string, TerminalSession>();
  private gcTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.gcTimer = setInterval(() => this.gc(), GC_INTERVAL_MS);
  }

  get available(): boolean {
    return ptyAvailable;
  }

  /** Create a new terminal session with its own PTY */
  create(opts: TerminalCreateRequest & { workspacePath?: string }): TerminalCreateResponse {
    if (!ptyAvailable) {
      throw new Error('PTY worker not available');
    }

    const id = `term_${nanoid(10)}`;
    const shell = opts.shell || process.env.SHELL || '/bin/bash';
    const args = opts.args || [];
    let cwd = opts.cwd || opts.workspacePath || process.env.HOME || '/';
    let resolvedStoryId: string | undefined;

    // Resolve worktree CWD when story context is active
    if (opts.storyId) {
      try {
        const worktreeRecord = getWorktreeForStory(opts.storyId);
        if (worktreeRecord && existsSync(worktreeRecord.worktree_path)) {
          cwd = worktreeRecord.worktree_path;
          resolvedStoryId = opts.storyId;
        }
      } catch {
        // DB not available or other error — fall through to default CWD
      }
    }

    const cols = opts.cols || 80;
    const rows = opts.rows || 24;
    const enableIntegration = opts.enableShellIntegration !== false;

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...opts.env,
      TERM_PROGRAM: 'e-ide',
      TERM_PROGRAM_VERSION: '1.0.0',
    };

    // Inject shell integration script path via environment variable.
    // The shell sources this script on startup via PROMPT_COMMAND (bash),
    // precmd hook (zsh), or fish_prompt (fish).
    const shellName = getShellName(shell);
    const integrationScript = enableIntegration ? getShellIntegrationPath(shellName) : null;

    let spawnArgs = [...args];
    if (integrationScript) {
      // Set env var so the shell knows integration is available
      env.E_SHELL_INTEGRATION = integrationScript;

      // For bash/zsh: pass --rcfile or source the script
      // For fish: use --init-command
      if (shellName === 'bash') {
        // Use --rcfile to source our integration (it will also source user's bashrc)
        // We create a wrapper that sources the user's rc file then our integration
        env.E_SHELL_INTEGRATION_INJECT = '1';
        spawnArgs = ['--rcfile', integrationScript, ...args];
      } else if (shellName === 'zsh') {
        // For zsh, we inject via ZDOTDIR or ENV. Simplest approach: use -i flag
        // and set ENV to auto-source the integration script after user's zshrc.
        env.E_SHELL_INTEGRATION_INJECT = '1';
        // The cleanest approach: set an env var and have .zshrc source it.
        // For automatic injection without modifying user files, we pass it as a
        // command argument that zsh will execute on startup.
        spawnArgs = ['-i', ...args];
        // We'll source the integration at the end via precmd setup
        env.ZDOTDIR_ORIGINAL = env.ZDOTDIR || '';
      } else if (shellName === 'fish') {
        spawnArgs = ['--init-command', `source ${integrationScript}`, ...args];
      }
    }

    const term = new NativePty(shell, spawnArgs, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env,
    });

    // For zsh, we inject the integration script by writing a source command
    // immediately after the shell starts. This runs after .zshrc loads.
    if (integrationScript && shellName === 'zsh') {
      // Give zsh a moment to initialize, then source the integration script
      setTimeout(() => {
        try {
          term.write(`source "${integrationScript}"\n`);
        } catch {
          // PTY may already be closed
        }
      }, 100);
    }

    // For bash with --rcfile, we need to also source the user's bashrc.
    // We'll create a wrapper approach: the integration script itself is lightweight,
    // and the user's bashrc is sourced via PROMPT_COMMAND or a subshell init.
    // Actually, bash's --rcfile replaces .bashrc, so we inject sourcing of user's
    // bashrc by writing it to the terminal after startup.
    if (integrationScript && shellName === 'bash') {
      setTimeout(() => {
        try {
          const bashrc = `${env.HOME || '/root'}/.bashrc`;
          // Source user's bashrc if it exists, silently
          term.write(`[ -f "${bashrc}" ] && source "${bashrc}" 2>/dev/null\n`);
        } catch {
          // PTY may already be closed
        }
      }, 50);
    }

    const session: TerminalSession = {
      id,
      shell,
      args,
      cwd,
      env,
      cols,
      rows,
      pid: 0, // Updated asynchronously when the worker reports the real PID
      pty: term,
      scrollbackBuffer: [],
      scrollbackBytes: 0,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      exitCode: null,
      exitSignal: null,
      attachedWs: new Set(),
      logging: false,
      logFilePath: null,
      shellIntegration: enableIntegration && integrationScript !== null,
      commandCounter: 0,
      currentCommandId: null,
      outputBuffer: '',
      flushTimer: null,
      commandOutputBuffer: '',
      commandInProgress: false,
      currentCommandText: null,
      storyId: resolvedStoryId,
    };

    // Update PID when the worker reports it
    term.onPid = (pid) => {
      session.pid = pid;
    };

    // Forward PTY data to all attached WebSockets and buffer for replay.
    // When shell integration is active, parse OSC sequences from the output,
    // strip them from display data, and emit control messages.
    term.onData((data: string) => {
      session.lastActivity = Date.now();

      if (session.shellIntegration) {
        const result = parseOscSequences(data);

        // Emit control messages for detected events
        if (result.cwd) {
          session.cwd = result.cwd;
          this.sendControl(session, { type: 'cwd_changed', cwd: result.cwd });
        }

        if (result.commandText !== null) {
          // Command text arrives before command_start; use next command ID
          const nextCmdId = `${session.id}_cmd_${session.commandCounter + 1}`;
          session.currentCommandText = result.commandText;
          this.sendControl(session, {
            type: 'command_text',
            id: nextCmdId,
            text: result.commandText,
          });
        }

        if (result.commandStart) {
          session.commandCounter++;
          session.currentCommandId = `${session.id}_cmd_${session.commandCounter}`;
          session.commandInProgress = true;
          session.commandOutputBuffer = '';
          this.sendControl(session, {
            type: 'command_start',
            id: session.currentCommandId,
          });
        }

        if (result.commandEndExitCode !== null) {
          const cmdId = session.currentCommandId || `${session.id}_cmd_${session.commandCounter}`;
          session.commandInProgress = false;

          // Analyze command output for rich content before sending command_end
          this.analyzeCommandOutput(
            session,
            cmdId,
            session.commandOutputBuffer,
            session.currentCommandText,
          );
          session.commandOutputBuffer = '';
          session.currentCommandText = null;

          this.sendControl(session, {
            type: 'command_end',
            id: cmdId,
            exitCode: result.commandEndExitCode,
          });
          session.currentCommandId = null;
        }

        // Forward cleaned data (OSC sequences stripped) to clients
        const cleanData = result.cleanData;
        if (cleanData.length > 0) {
          // Buffer output for rich content analysis (cap at 256KB to avoid memory issues)
          if (session.commandInProgress && session.commandOutputBuffer.length < 256 * 1024) {
            session.commandOutputBuffer += cleanData;

            // Real-time progress detection on streaming output
            if (session.currentCommandId) {
              this.detectStreamingProgress(session, session.currentCommandId, cleanData);
            }
          }
          this.queueOutput(session, cleanData);
        }
      } else {
        // No shell integration — forward raw data as-is
        this.queueOutput(session, data);
      }
    });

    // Track exit
    term.onExit(({ exitCode, signal }) => {
      session.exitCode = exitCode;
      session.exitSignal = signal ?? null;
      session.lastActivity = Date.now();

      // Notify attached clients
      const msg: TerminalControlMessage = {
        type: 'session_exit',
        exitCode,
        signal: signal || undefined,
      };
      this.sendControl(session, msg);
    });

    this.sessions.set(id, session);

    return {
      sessionId: id,
      shell,
      pid: 0,
      cwd,
      storyId: resolvedStoryId,
    };
  }

  /** Get session by ID */
  get(id: string): TerminalSession | undefined {
    return this.sessions.get(id);
  }

  /** List all sessions as client-facing metadata */
  list(): TerminalSessionMeta[] {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      shell: s.shell,
      pid: s.pid,
      cwd: s.cwd,
      cols: s.cols,
      rows: s.rows,
      createdAt: s.createdAt,
      lastActivity: s.lastActivity,
      exitCode: s.exitCode,
      attached: s.attachedWs.size > 0,
      logging: s.logging,
      logFilePath: s.logFilePath,
      storyId: s.storyId ?? null,
    }));
  }

  /** Kill a session and clean up */
  kill(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;

    // Flush any buffered output before teardown
    this.flushOutput(session);

    // Stop logging if active
    if (session.logging) {
      this.stopLogging(id);
    }

    // Close all attached WebSockets
    for (const ws of session.attachedWs) {
      try {
        ws.close(1000, 'Session terminated');
      } catch {
        // Already closed
      }
    }
    session.attachedWs.clear();

    // Kill the PTY
    try {
      session.pty.kill();
    } catch {
      // Already dead
    }

    this.sessions.delete(id);
    return true;
  }

  /** Attach a WebSocket to a session — replays scrollback then streams live */
  attach(id: string, ws: WsLike): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;

    session.attachedWs.add(ws);

    // Send replay_start control message
    const replayBytes = session.scrollbackBytes;
    this.sendControlToWs(ws, { type: 'replay_start', bytes: replayBytes });

    // Replay scrollback buffer as binary frames
    for (const chunk of session.scrollbackBuffer) {
      try {
        ws.send(this.textEncoder.encode(chunk));
      } catch {
        break;
      }
    }

    // Send replay_end control message
    this.sendControlToWs(ws, { type: 'replay_end' });

    // Send current CWD if shell integration has tracked it
    if (session.shellIntegration && session.cwd) {
      this.sendControlToWs(ws, { type: 'cwd_changed', cwd: session.cwd });
    }

    // If session already exited, notify immediately
    if (session.exitCode !== null) {
      this.sendControlToWs(ws, {
        type: 'session_exit',
        exitCode: session.exitCode,
        signal: session.exitSignal || undefined,
      });
    }

    // If session is logging, notify the new client
    if (session.logging && session.logFilePath) {
      this.sendControlToWs(ws, { type: 'logging_started', logFilePath: session.logFilePath });
    }

    return true;
  }

  /** Detach a WebSocket from a session (session stays alive) */
  detach(id: string, ws: WsLike): void {
    const session = this.sessions.get(id);
    if (session) {
      session.attachedWs.delete(ws);
    }
  }

  /** Write data to a session's PTY */
  write(id: string, data: string): boolean {
    const session = this.sessions.get(id);
    if (!session || session.exitCode !== null) return false;
    session.pty.write(data);
    session.lastActivity = Date.now();
    return true;
  }

  /** Resize a session's PTY */
  resize(id: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(id);
    if (!session || session.exitCode !== null) return false;
    if (cols > 0 && rows > 0) {
      session.pty.resize(cols, rows);
      session.cols = cols;
      session.rows = rows;
    }
    return true;
  }

  /** Detect available shells on the system */
  async detectShells(): Promise<ShellInfo[]> {
    if (cachedShells) return cachedShells;

    const results: ShellInfo[] = [];
    const seen = new Set<string>();

    /** Resolve symlinks so /bin/bash and /usr/bin/bash don't appear as separate shells */
    function realPath(p: string): string {
      try {
        return realpathSync(p);
      } catch {
        return p;
      }
    }

    // Check user's default shell first
    const userShell = process.env.SHELL;
    if (userShell && existsSync(userShell) && !seen.has(realPath(userShell))) {
      seen.add(realPath(userShell));
      const version = await getShellVersion(userShell);
      results.push({ path: userShell, name: basename(userShell), version });
    }

    // Check known candidates
    for (const candidate of SHELL_CANDIDATES) {
      if (!existsSync(candidate.path)) continue;
      if (seen.has(realPath(candidate.path))) continue;
      seen.add(realPath(candidate.path));
      const version = await getShellVersion(candidate.path);
      results.push({ path: candidate.path, name: candidate.name, version });
    }

    cachedShells = results;
    return results;
  }

  /** Clear the shell cache (e.g., after a shell is installed) */
  clearShellCache(): void {
    cachedShells = null;
  }

  /** Start logging PTY output to a file for a given session */
  startLogging(id: string): { logFilePath: string } | null {
    const session = this.sessions.get(id);
    if (!session) return null;

    if (session.logging && session.logFilePath) {
      // Already logging — return existing path
      return { logFilePath: session.logFilePath };
    }

    ensureLogDir();
    const logFilePath = makeLogFilePath(id);

    // Write header to the log file
    const header = `# Terminal Session Log\n# Session: ${id}\n# Shell: ${session.shell}\n# Started: ${new Date().toISOString()}\n# CWD: ${session.cwd}\n${'#'.repeat(60)}\n\n`;
    try {
      writeFileSync(logFilePath, header, 'utf-8');
    } catch (err) {
      console.error(`[terminal] Failed to create log file: ${(err as Error).message}`);
      return null;
    }

    session.logging = true;
    session.logFilePath = logFilePath;

    // Notify clients
    this.sendControl(session, { type: 'logging_started', logFilePath });

    return { logFilePath };
  }

  /** Stop logging PTY output for a given session */
  stopLogging(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session || !session.logging) return false;

    // Write footer to log file
    if (session.logFilePath) {
      try {
        const footer = `\n${'#'.repeat(60)}\n# Logging stopped: ${new Date().toISOString()}\n`;
        appendFileSync(session.logFilePath, footer, 'utf-8');
      } catch {
        // Best effort
      }
    }

    session.logging = false;

    // Notify clients
    this.sendControl(session, { type: 'logging_stopped' });

    return true;
  }

  /** Get the log file path for a session (if logging has been started) */
  getLogFilePath(id: string): string | null {
    const session = this.sessions.get(id);
    return session?.logFilePath ?? null;
  }

  /** Append cleaned (ANSI-stripped) data to a log file */
  private appendToLog(logFilePath: string, data: string): void {
    try {
      const clean = stripAnsi(data);
      if (clean.length > 0) {
        appendFileSync(logFilePath, clean, 'utf-8');
      }
    } catch {
      // Best effort — don't crash the session on log write failure
    }
  }

  /** Garbage collect orphaned sessions */
  private gc(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      // Only GC sessions that have exited, have no attached clients, and are stale
      if (
        session.exitCode !== null &&
        session.attachedWs.size === 0 &&
        now - session.lastActivity > ORPHAN_TIMEOUT_MS
      ) {
        console.log(`[terminal] GC: removing orphaned session ${id} (exited ${session.exitCode})`);
        this.sessions.delete(id);
      }
    }
  }

  /** Append data to the scrollback ring buffer, evicting old data if over limit */
  private appendScrollback(session: TerminalSession, data: string): void {
    session.scrollbackBuffer.push(data);
    session.scrollbackBytes += data.length;

    // Evict oldest chunks if over limit
    while (session.scrollbackBytes > MAX_SCROLLBACK_BYTES && session.scrollbackBuffer.length > 1) {
      const evicted = session.scrollbackBuffer.shift()!;
      session.scrollbackBytes -= evicted.length;
    }
  }

  /**
   * Queue PTY output for coalesced delivery.
   * Flushes to WebSocket clients after FLUSH_INTERVAL_MS or when buffer exceeds
   * FLUSH_SIZE_THRESHOLD — whichever comes first.  Reduces the number of
   * WebSocket frames during high-throughput output (builds, logs, find).
   */
  private queueOutput(session: TerminalSession, data: string): void {
    this.appendScrollback(session, data);
    session.outputBuffer += data;

    // Tee to log file immediately (logging shouldn't be delayed)
    if (session.logging && session.logFilePath) {
      this.appendToLog(session.logFilePath, data);
    }

    // Flush immediately if buffer is large enough
    if (session.outputBuffer.length >= FLUSH_SIZE_THRESHOLD) {
      this.flushOutput(session);
      return;
    }

    // Otherwise schedule a flush
    if (!session.flushTimer) {
      session.flushTimer = setTimeout(() => this.flushOutput(session), FLUSH_INTERVAL_MS);
    }
  }

  /** Shared TextEncoder for binary WebSocket frames */
  private textEncoder = new TextEncoder();

  /** Flush the coalesced output buffer to all attached WebSocket clients as binary frames */
  private flushOutput(session: TerminalSession): void {
    if (session.flushTimer) {
      clearTimeout(session.flushTimer);
      session.flushTimer = null;
    }
    if (session.outputBuffer.length === 0) return;

    const data = session.outputBuffer;
    session.outputBuffer = '';

    // Send as binary frame — avoids UTF-8 validation overhead on both ends
    const buf = this.textEncoder.encode(data);
    for (const ws of session.attachedWs) {
      try {
        ws.send(buf);
      } catch {
        // WebSocket may be closed
      }
    }
  }

  /** Send a JSON control message to all attached WebSockets */
  // --- Rich Content Analysis ---

  /**
   * Analyze command output after a block completes and send rich_content
   * control messages for any detected structured content.
   *
   * Strips ANSI escape codes before analysis.
   */
  private analyzeCommandOutput(
    session: TerminalSession,
    blockId: string,
    raw: string,
    commandText: string | null,
  ): void {
    if (!raw || raw.length < 5) return;

    // Strip ANSI escape codes for content analysis
    const text = raw
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
      .replace(/\r/g, '')
      .trim();
    if (!text) return;

    // --- Markdown detection (command-text-aware: cat *.md, bat *.md, etc.) ---
    if (commandText && this.detectAndSendMarkdown(session, blockId, text, commandText)) return;

    // --- Test results detection (before JSON, since test JSON would be caught by generic JSON) ---
    if (this.detectAndSendTestResults(session, blockId, text, commandText)) return;

    // --- JSON detection ---
    if (this.detectAndSendJson(session, blockId, text)) return;

    // --- Diff detection ---
    if (this.detectAndSendDiff(session, blockId, text)) return;

    // --- Error / stack trace detection ---
    if (this.detectAndSendError(session, blockId, text)) return;

    // --- Table detection (CSV / TSV / column-aligned) ---
    if (this.detectAndSendTable(session, blockId, text)) return;

    // --- Image path detection ---
    if (commandText) {
      this.detectAndSendImages(session, blockId, text, commandText);
    }
  }

  /** Detect progress indicators in streaming output (called per chunk, not per block) */
  private detectStreamingProgress(session: TerminalSession, blockId: string, chunk: string): void {
    // Strip ANSI for pattern matching
    const clean = chunk.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\r/g, '');

    // Percentage pattern: "45%", "45.2%", "[=====>    ] 45%"
    const pctMatch = clean.match(/(\d{1,3}(?:\.\d)?)%/);
    if (pctMatch) {
      const pct = parseFloat(pctMatch[1]);
      if (pct >= 0 && pct <= 100) {
        // Extract label context (text before the percentage)
        const beforePct = clean.slice(0, clean.indexOf(pctMatch[0])).trim();
        const label =
          beforePct
            .slice(-60)
            .replace(/[\[\]|=>#\-\s]+$/, '')
            .trim() || 'Progress';

        // Extract speed if present (e.g., "1.2 MB/s")
        const speedMatch = clean.match(/(\d+(?:\.\d+)?\s*(?:KB|MB|GB|B|kB)\/s)/i);

        this.sendControl(session, {
          type: 'rich_content',
          blockId,
          contentType: 'progress',
          data: JSON.stringify({
            percent: pct,
            label,
            speed: speedMatch?.[1] || undefined,
          }),
        });
      }
    }

    // Fraction pattern: "[3/12]", "Step 3 of 12"
    const fracMatch = clean.match(/(?:\[|step\s+)(\d+)\s*(?:\/|of)\s*(\d+)/i);
    if (fracMatch && !pctMatch) {
      const current = parseInt(fracMatch[1]);
      const total = parseInt(fracMatch[2]);
      if (total > 0 && current <= total) {
        const pct = (current / total) * 100;
        const label =
          clean
            .slice(clean.indexOf(fracMatch[0]) + fracMatch[0].length)
            .trim()
            .slice(0, 60) || `Step ${current}/${total}`;

        this.sendControl(session, {
          type: 'rich_content',
          blockId,
          contentType: 'progress',
          data: JSON.stringify({ percent: pct, label }),
        });
      }
    }
  }

  private detectAndSendTestResults(
    session: TerminalSession,
    blockId: string,
    text: string,
    commandText: string | null,
  ): boolean {
    const result = parseTestOutput(text, commandText, session.cwd);
    if (!result) return false;

    result.sessionId = session.id;
    result.blockId = blockId;

    this.sendControl(session, {
      type: 'rich_content',
      blockId,
      contentType: 'test_results',
      data: JSON.stringify(result),
    });
    return true;
  }

  private detectAndSendMarkdown(
    session: TerminalSession,
    blockId: string,
    text: string,
    commandText: string,
  ): boolean {
    // Detect if the command is reading a markdown file
    const cmd = commandText.trim();
    const mdFilePattern = /(?:cat|bat|batcat|less|more|head|tail)\s+.*\.(?:md|mdx|markdown)\b/i;
    if (!mdFilePattern.test(cmd)) return false;

    // Require some markdown-like content (headings, lists, code blocks, links)
    const hasMarkdownFeatures =
      /^#{1,6}\s/m.test(text) ||
      /^\s*[-*+]\s/m.test(text) ||
      /```/m.test(text) ||
      /\[.+?\]\(.+?\)/.test(text);

    if (hasMarkdownFeatures && text.length > 20) {
      this.sendControl(session, {
        type: 'rich_content',
        blockId,
        contentType: 'markdown',
        data: text,
      });
      return true;
    }
    return false;
  }

  private detectAndSendImages(
    session: TerminalSession,
    blockId: string,
    text: string,
    commandText: string,
  ): void {
    // Detect image file paths in command output
    const imageExtensions = /\.(png|jpg|jpeg|gif|webp|svg|bmp|ico)$/i;
    const lines = text.split('\n');
    const imagePaths: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      // Check if the line looks like a file path (absolute or relative) ending in an image extension
      if (imageExtensions.test(trimmed) && !trimmed.includes(' ') && trimmed.length < 500) {
        // Resolve relative paths against session CWD
        const fullPath = trimmed.startsWith('/') ? trimmed : resolve(session.cwd, trimmed);
        if (existsSync(fullPath)) {
          imagePaths.push(fullPath);
        }
      }
    }

    if (imagePaths.length > 0 && imagePaths.length <= 20) {
      this.sendControl(session, {
        type: 'rich_content',
        blockId,
        contentType: 'image',
        data: JSON.stringify(imagePaths),
      });
    }
  }

  private detectAndSendJson(session: TerminalSession, blockId: string, text: string): boolean {
    const trimmed = text.trim();
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        const parsed = JSON.parse(trimmed);
        // Only render as JSON tree for non-trivial objects
        if (typeof parsed === 'object' && parsed !== null) {
          const keys = Array.isArray(parsed) ? parsed.length : Object.keys(parsed).length;
          if (keys > 2 || (Array.isArray(parsed) && keys > 0)) {
            // Check if it's a table-like array of objects
            if (
              Array.isArray(parsed) &&
              parsed.length >= 2 &&
              parsed.every(
                (item) => typeof item === 'object' && item !== null && !Array.isArray(item),
              )
            ) {
              const headers = Object.keys(parsed[0]);
              if (headers.length >= 2) {
                const rows = parsed.map((item: Record<string, unknown>) =>
                  headers.map((h) => String(item[h] ?? '')),
                );
                this.sendControl(session, {
                  type: 'rich_content',
                  blockId,
                  contentType: 'table',
                  data: JSON.stringify({ headers, rows, format: 'json' }),
                });
                return true;
              }
            }
            this.sendControl(session, {
              type: 'rich_content',
              blockId,
              contentType: 'json',
              data: trimmed,
            });
            return true;
          }
        }
      } catch {
        // Not valid JSON — fall through to other detectors
      }
    }
    return false;
  }

  private detectAndSendDiff(session: TerminalSession, blockId: string, text: string): boolean {
    if (!text.includes('diff --git ') && !text.startsWith('diff --git ')) return false;

    try {
      const files: Array<{
        oldPath: string;
        newPath: string;
        hunks: Array<{
          oldStart: number;
          oldCount: number;
          newStart: number;
          newCount: number;
          lines: Array<{ type: 'add' | 'remove' | 'context'; content: string }>;
        }>;
        binary: boolean;
        renamed: boolean;
      }> = [];
      let totalAdd = 0;
      let totalDel = 0;

      const diffSections = text.split(/^(?=diff --git )/m);
      for (const section of diffSections) {
        if (!section.startsWith('diff --git ')) continue;

        const lines = section.split('\n');
        const diffLine = lines[0];
        const match = diffLine.match(/^diff --git a\/(.+?) b\/(.+)$/);
        if (!match) continue;

        const oldPath = match[1];
        const newPath = match[2];
        const binary = section.includes('Binary files');
        const renamed = section.includes('rename from');
        const hunks: (typeof files)[0]['hunks'] = [];

        const hunkMatches = section.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@.*$/gm);
        for (const hm of hunkMatches) {
          const hunkStart = section.indexOf(hm[0]);
          const hunkEnd = section.indexOf('\n@@ ', hunkStart + 1);
          const hunkText =
            hunkEnd === -1
              ? section.slice(hunkStart + hm[0].length + 1)
              : section.slice(hunkStart + hm[0].length + 1, hunkEnd);

          const hunkLines = hunkText.split('\n').map((l) => {
            if (l.startsWith('+')) {
              totalAdd++;
              return { type: 'add' as const, content: l.slice(1) };
            }
            if (l.startsWith('-')) {
              totalDel++;
              return { type: 'remove' as const, content: l.slice(1) };
            }
            return { type: 'context' as const, content: l.startsWith(' ') ? l.slice(1) : l };
          });

          hunks.push({
            oldStart: parseInt(hm[1]),
            oldCount: parseInt(hm[2] ?? '1'),
            newStart: parseInt(hm[3]),
            newCount: parseInt(hm[4] ?? '1'),
            lines: hunkLines,
          });
        }

        files.push({ oldPath, newPath, hunks, binary, renamed });
      }

      if (files.length > 0) {
        this.sendControl(session, {
          type: 'rich_content',
          blockId,
          contentType: 'diff',
          data: JSON.stringify({
            files,
            stats: { additions: totalAdd, deletions: totalDel, filesChanged: files.length },
          }),
        });
        return true;
      }
    } catch {
      // Parse failure — fall through
    }
    return false;
  }

  private detectAndSendError(session: TerminalSession, blockId: string, text: string): boolean {
    // Node.js / JavaScript errors
    const nodeMatch = text.match(/^(\w*Error): (.+?)$/m);
    if (nodeMatch) {
      const frames: Array<{
        file: string;
        line: number;
        column?: number;
        function: string;
        isInternal: boolean;
      }> = [];

      const atLines = text.matchAll(/^\s+at\s+(?:(.+?)\s+)?\(?(.+?):(\d+):(\d+)\)?$/gm);
      for (const m of atLines) {
        const file = m[2];
        frames.push({
          function: m[1] || '(anonymous)',
          file,
          line: parseInt(m[3]),
          column: parseInt(m[4]),
          isInternal:
            file.includes('node_modules') || file.includes('node:') || !file.startsWith('/'),
        });
      }

      if (frames.length >= 1) {
        this.sendControl(session, {
          type: 'rich_content',
          blockId,
          contentType: 'error',
          data: JSON.stringify({
            errorType: nodeMatch[1],
            message: nodeMatch[2],
            file: frames[0]?.file,
            line: frames[0]?.line,
            column: frames[0]?.column,
            frames,
          }),
        });
        return true;
      }
    }

    // Python tracebacks
    if (text.includes('Traceback (most recent call last):')) {
      const frames: Array<{
        file: string;
        line: number;
        column?: number;
        function: string;
        isInternal: boolean;
      }> = [];

      const pyFrames = text.matchAll(/File "(.+?)", line (\d+), in (.+)/g);
      for (const m of pyFrames) {
        const file = m[1];
        frames.push({
          file,
          line: parseInt(m[2]),
          function: m[3],
          isInternal: file.includes('site-packages') || file.includes('/lib/python'),
        });
      }

      const pyError = text.match(/^(\w+(?:Error|Exception|Warning)): (.+)$/m);
      if (pyError && frames.length >= 1) {
        this.sendControl(session, {
          type: 'rich_content',
          blockId,
          contentType: 'error',
          data: JSON.stringify({
            errorType: pyError[1],
            message: pyError[2],
            file: frames[frames.length - 1]?.file,
            line: frames[frames.length - 1]?.line,
            frames: frames.reverse(),
          }),
        });
        return true;
      }
    }

    return false;
  }

  private detectAndSendTable(session: TerminalSession, blockId: string, text: string): boolean {
    const lines = text.split('\n').filter((l) => l.trim());
    if (lines.length < 3) return false; // Need at least header + 2 rows

    // CSV detection: comma-separated with consistent column count
    const commaCountFirst = (lines[0].match(/,/g) || []).length;
    if (commaCountFirst >= 1) {
      const isCSV = lines.every((l) => {
        const count = (l.match(/,/g) || []).length;
        return Math.abs(count - commaCountFirst) <= 1; // Allow slight variance
      });

      if (isCSV) {
        const headers = this.parseCSVLine(lines[0]);
        const rows = lines.slice(1).map((l) => this.parseCSVLine(l));
        if (headers.length >= 2) {
          this.sendControl(session, {
            type: 'rich_content',
            blockId,
            contentType: 'table',
            data: JSON.stringify({ headers, rows, format: 'csv' }),
          });
          return true;
        }
      }
    }

    // TSV detection: tab-separated
    if (lines[0].includes('\t')) {
      const tabCountFirst = (lines[0].match(/\t/g) || []).length;
      const isTSV = lines.every((l) => (l.match(/\t/g) || []).length === tabCountFirst);
      if (isTSV && tabCountFirst >= 1) {
        const headers = lines[0].split('\t').map((s) => s.trim());
        const rows = lines.slice(1).map((l) => l.split('\t').map((s) => s.trim()));
        this.sendControl(session, {
          type: 'rich_content',
          blockId,
          contentType: 'table',
          data: JSON.stringify({ headers, rows, format: 'tsv' }),
        });
        return true;
      }
    }

    return false;
  }

  /** Simple CSV line parser (handles quoted fields) */
  private parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  }

  private sendControl(session: TerminalSession, msg: TerminalControlMessage): void {
    for (const ws of session.attachedWs) {
      this.sendControlToWs(ws, msg);
    }
  }

  /** Send a JSON control message to a specific WebSocket using 0x02 prefix as binary frame */
  private sendControlToWs(ws: WsLike, msg: TerminalControlMessage): void {
    try {
      const json = JSON.stringify(msg);
      const payload = String.fromCharCode(TERMINAL_PROTOCOL.CONTROL) + json;
      ws.send(this.textEncoder.encode(payload));
    } catch {
      // WebSocket may be closed
    }
  }

  /** Destroy the manager (for graceful shutdown) */
  destroy(): void {
    if (this.gcTimer) {
      clearInterval(this.gcTimer);
      this.gcTimer = null;
    }
    for (const [id] of this.sessions) {
      this.kill(id);
    }
  }
}

/** Singleton session manager instance */
export const sessionManager = new TerminalSessionManager();
