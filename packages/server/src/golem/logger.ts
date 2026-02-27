// ---------------------------------------------------------------------------
// Golem Logger — structured JSON line logging with optional WS streaming
// ---------------------------------------------------------------------------

import type { GolemLogLevel, GolemPhaseType, GolemLogEntry } from '@e/shared';

/**
 * Structured logger that outputs JSON lines to stdout and optionally
 * streams them to a coordinator via WebSocket.
 */
export class GolemLogger {
  private executorId: string;
  private storyId: string;
  private ws: WebSocket | null = null;
  private wsUrl: string | null = null;
  private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private buffer: GolemLogEntry[] = [];
  private maxBuffer = 1000;

  constructor(executorId: string, storyId: string) {
    this.executorId = executorId;
    this.storyId = storyId;
  }

  /**
   * Connect to a WebSocket endpoint for streaming logs.
   */
  connectWebSocket(url: string): void {
    this.wsUrl = url;
    this.doConnect();
  }

  private doConnect(): void {
    if (!this.wsUrl) return;

    try {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.onopen = () => {
        // Flush buffered messages
        for (const entry of this.buffer) {
          this.wsSend(entry);
        }
        this.buffer = [];
      };

      this.ws.onclose = () => {
        this.ws = null;
        // Reconnect after 5 seconds
        if (this.wsUrl) {
          this.wsReconnectTimer = setTimeout(() => this.doConnect(), 5000);
        }
      };

      this.ws.onerror = () => {
        // Error handler required to prevent unhandled rejection
        // onclose will handle reconnection
      };
    } catch {
      // WebSocket creation failed — will retry via buffer
    }
  }

  private wsSend(entry: GolemLogEntry): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(entry));
      } catch {
        // Best effort — don't crash on send failure
      }
    }
  }

  /**
   * Emit a structured log entry.
   */
  log(
    level: GolemLogLevel,
    phase: GolemPhaseType,
    msg: string,
    data?: Record<string, unknown>,
  ): void {
    const entry: GolemLogEntry = {
      ts: new Date().toISOString(),
      level,
      phase,
      msg,
      storyId: this.storyId,
      executorId: this.executorId,
      ...(data ? { data } : {}),
    };

    // Always write to stdout as JSON line
    const line = JSON.stringify(entry);
    process.stdout.write(line + '\n');

    // Stream via WebSocket if connected
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.wsSend(entry);
    } else if (this.wsUrl) {
      // Buffer for when WS reconnects
      this.buffer.push(entry);
      if (this.buffer.length > this.maxBuffer) {
        this.buffer.shift();
      }
    }
  }

  // Convenience methods
  debug(phase: GolemPhaseType, msg: string, data?: Record<string, unknown>): void {
    this.log('debug', phase, msg, data);
  }

  info(phase: GolemPhaseType, msg: string, data?: Record<string, unknown>): void {
    this.log('info', phase, msg, data);
  }

  warn(phase: GolemPhaseType, msg: string, data?: Record<string, unknown>): void {
    this.log('warn', phase, msg, data);
  }

  error(phase: GolemPhaseType, msg: string, data?: Record<string, unknown>): void {
    this.log('error', phase, msg, data);
  }

  fatal(phase: GolemPhaseType, msg: string, data?: Record<string, unknown>): void {
    this.log('fatal', phase, msg, data);
  }

  /**
   * Get all buffered log messages as strings (for result reporting).
   */
  getLogLines(): string[] {
    return this.buffer.map((e) => `[${e.ts}] [${e.level}] [${e.phase}] ${e.msg}`);
  }

  /**
   * Close the WebSocket connection and clean up.
   */
  close(): void {
    this.wsUrl = null;
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Best effort
      }
      this.ws = null;
    }
  }
}
