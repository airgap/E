import { type Subprocess } from 'bun';
import { nanoid } from 'nanoid';
import { EventEmitter } from 'events';
import { getDb } from '../../db/database';
import { generateMcpConfig } from '../mcp-config';
import { buildCliCommand } from '../cli-provider';
import type { CliProvider } from '@e/shared';
import {
  parseMcpToolName,
  isMcpFileWriteTool,
  extractFilePath,
  extractEditLineHint,
} from '@e/shared';
import type { PermissionMode } from '@e/shared';
import { getSandboxConfig } from '../../middleware/sandbox';
import { verifyFile } from '../code-verifier';
import {
  shouldRequireApproval,
  loadPermissionRules,
  loadTerminalCommandPolicy,
} from '../permission-rules';
import {
  getContextLimit,
  getAutoCompactThreshold,
  getRecommendedOptions,
  loadConversationHistory,
  summarizeWithLLM,
} from '../chat-compaction';
import { eventBridge } from '../event-bridge';
import { sendNotification } from '../notification-channels';
import { broadcastMessageUpdate } from '../../routes/message-sync';
import type { CliProcess } from './spawner';
import { hasScript, signalName, spawnWithScript, spawnWithPipe } from './spawner';
import { translateCliEvent, extractAndStoreArtifacts } from './event-translator';
import { prelinkToolCallId } from '../ask-user-bridge';

interface ClaudeSession {
  id: string;
  cliSessionId?: string;
  process?: Subprocess;
  cliProcess?: CliProcess;
  conversationId: string;
  workspacePath?: string;
  model?: string;
  systemPrompt?: string;
  effort?: string;
  maxBudgetUsd?: number;
  maxTurns?: number;
  allowedTools?: string[];
  disallowedTools?: string[];
  status: 'running' | 'idle' | 'terminated';
  emitter: EventEmitter;
  /** Buffer of all SSE events sent during this stream, for reconnection. */
  eventBuffer: string[];
  /** Whether the stream has finished (events fully read from CLI). */
  streamComplete: boolean;
  /** Whether the stream was cancelled by user (vs completed naturally). */
  cancelled: boolean;
  /** Nudges queued mid-stream to be prepended to the next message turn. */
  pendingNudges: string[];
  /** Active stream controller — set during SSE streaming for event injection. */
  streamController?: ReadableStreamDefaultController;
}

export class ClaudeProcessManager {
  private sessions = new Map<string, ClaudeSession>();
  /** Timers for auto-removing completed sessions after a grace period. */
  private cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Schedule removal of a completed session after 60s — enough time for
   *  the client to reconnect after a page reload, but prevents stale sessions
   *  from accumulating indefinitely and loading old conversations on reload. */
  private scheduleCleanup(sessionId: string) {
    // Clear any existing timer for this session
    const existing = this.cleanupTimers.get(sessionId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.sessions.delete(sessionId);
      this.cleanupTimers.delete(sessionId);
    }, 60_000);
    this.cleanupTimers.set(sessionId, timer);
  }

  async createSession(
    conversationId: string,
    opts: {
      model?: string;
      systemPrompt?: string;
      workspacePath?: string;
      effort?: string;
      maxBudgetUsd?: number;
      maxTurns?: number;
      allowedTools?: string[];
      disallowedTools?: string[];
      resumeSessionId?: string;
    } = {},
  ): Promise<string> {
    const sessionId = nanoid();

    const session: ClaudeSession = {
      id: sessionId,
      cliSessionId: opts.resumeSessionId,
      conversationId,
      workspacePath: opts.workspacePath,
      model: opts.model,
      systemPrompt: opts.systemPrompt,
      effort: opts.effort,
      maxBudgetUsd: opts.maxBudgetUsd,
      maxTurns: opts.maxTurns,
      allowedTools: opts.allowedTools,
      disallowedTools: opts.disallowedTools,
      status: 'idle',
      emitter: new EventEmitter(),
      eventBuffer: [],
      streamComplete: false,
      cancelled: false,
      pendingNudges: [],
    };

    this.sessions.set(sessionId, session);
    return sessionId;
  }

  async sendMessage(sessionId: string, content: string): Promise<ReadableStream> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    if (session.status === 'terminated') throw new Error(`Session ${sessionId} is terminated`);

    session.status = 'running';

    // Prepend any queued nudges to this turn's content
    if (session.pendingNudges.length > 0) {
      const nudgeBlock = session.pendingNudges
        .map((n) => `[User nudge during previous response]: ${n}`)
        .join('\n');
      content = `${nudgeBlock}\n\n${content}`;
      session.pendingNudges = [];
    }

    // Resolve CLI provider from settings
    let provider: CliProvider = 'claude';
    try {
      const db = getDb();
      const row = db.query("SELECT value FROM settings WHERE key = 'cliProvider'").get() as any;
      if (row) provider = JSON.parse(row.value) as CliProvider;
    } catch {
      /* use default */
    }

    // Apply sandbox restrictions
    const sandbox = getSandboxConfig(session.workspacePath || null);
    let systemPrompt = session.systemPrompt;
    if (sandbox.enabled && sandbox.allowedPaths.length > 0) {
      const sandboxDirective = `\n\n## Sandbox Restrictions\nYou MUST only read/write files within these directories: ${sandbox.allowedPaths.join(', ')}. Do NOT access files outside these paths. Do NOT run destructive commands like: ${sandbox.blockedCommands.slice(0, 5).join(', ')}.`;
      systemPrompt = (systemPrompt || '') + sandboxDirective;
    }

    // Generate MCP config excluding e-work to prevent database conflicts with the main E server
    const mcpConfigPath = generateMcpConfig({ excludeEWork: true });
    // Disable CLI's built-in AskUserQuestion — E handles user questions
    // through its own SSE-based question dialog instead.
    const disallowed = [...(session.disallowedTools || [])];
    if (!disallowed.includes('AskUserQuestion')) {
      disallowed.push('AskUserQuestion');
    }
    const { binary, args } = buildCliCommand(provider, {
      content,
      resumeSessionId: session.cliSessionId,
      model: session.model,
      systemPrompt,
      effort: session.effort,
      maxBudgetUsd: session.maxBudgetUsd,
      maxTurns: session.maxTurns,
      allowedTools: session.allowedTools,
      disallowedTools: disallowed,
      mcpConfigPath: mcpConfigPath || undefined,
    });

    console.log(`[${provider}] Spawning: ${binary} ${args.join(' ').slice(0, 200)}...`);

    // Build a clean env: remove CLAUDECODE to avoid "nested session" detection,
    // strip FORCE_COLOR to get plain output, and enable unbuffered I/O for real-time
    // streaming of events from the Claude CLI.
    const spawnEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      FORCE_COLOR: '0',
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8:strict',
      CI: '1',
      NONINTERACTIVE: '1',
    };
    delete spawnEnv.CLAUDECODE;

    let cliProc: CliProcess;
    try {
      const cwd = session.workspacePath || process.cwd();
      if (hasScript) {
        cliProc = spawnWithScript(binary, args, cwd, spawnEnv);
        console.log(`[${provider}] Spawned PID ${cliProc.pid} (script/pty)`);
      } else {
        cliProc = spawnWithPipe(binary, args, cwd, spawnEnv);
        console.log(`[${provider}] Spawned PID ${cliProc.pid} (pipe)`);
      }
    } catch (spawnErr) {
      const msg = String(spawnErr);
      console.error(`[${provider}] Failed to spawn: ${msg}`);
      session.status = 'idle';
      const encoder = new TextEncoder();
      return new ReadableStream({
        start(controller) {
          const errEvt = JSON.stringify({
            type: 'error',
            error: { type: 'spawn_error', message: `Failed to spawn ${binary}: ${msg}` },
          });
          controller.enqueue(encoder.encode(`data: ${errEvt}\n\n`));
          controller.close();
        },
      });
    }

    session.cliProcess = cliProc;

    // Build a respawn function for API timeout auto-retry.
    // Uses --resume with a continuation prompt so the CLI picks up from its last saved state.
    const cwd = session.workspacePath || process.cwd();
    const respawnForRetry = (): CliProcess => {
      const { binary: retryBin, args: retryArgs } = buildCliCommand(provider, {
        content: 'Continue where you left off.',
        resumeSessionId: session.cliSessionId,
        model: session.model,
        systemPrompt,
        effort: session.effort,
        maxBudgetUsd: session.maxBudgetUsd,
        maxTurns: session.maxTurns,
        allowedTools: session.allowedTools,
        disallowedTools: session.disallowedTools,
        mcpConfigPath: mcpConfigPath || undefined,
      });
      console.log(
        `[${provider}] Retry spawning: ${retryBin} ${retryArgs.join(' ').slice(0, 200)}...`,
      );
      if (hasScript) {
        return spawnWithScript(retryBin, retryArgs, cwd, spawnEnv);
      } else {
        return spawnWithPipe(retryBin, retryArgs, cwd, spawnEnv);
      }
    };

    return this.createSSEStream(session, respawnForRetry);
  }

  private createSSEStream(
    session: ClaudeSession,
    respawnForRetry?: () => CliProcess,
  ): ReadableStream {
    const encoder = new TextEncoder();
    let proc = session.cliProcess!;
    let cancelled = false;

    // Reset event buffer for this stream
    session.eventBuffer = [];
    session.streamComplete = false;

    /** Enqueue an SSE event string to both the HTTP stream and the replay buffer. */
    const enqueueEvent = (controller: ReadableStreamDefaultController, sseData: string) => {
      // Always buffer, even if the client disconnected
      session.eventBuffer.push(sseData);
      try {
        controller.enqueue(encoder.encode(sseData));
      } catch {
        // Client disconnected — event is still in the buffer for reconnection
      }
    };

    // Accumulate stderr for error reporting.
    // In PTY mode, stderr is merged with stdout (no separate stream).
    const stderrChunks: string[] = [];
    let stderrStreamReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

    /** Set up stderr reading for the current CLI process (reusable across retries). */
    const setupStderrReader = (p: CliProcess) => {
      stderrChunks.length = 0;
      if (stderrStreamReader) {
        try {
          stderrStreamReader.releaseLock();
        } catch {
          /* ignore */
        }
        stderrStreamReader = null;
      }
      if (p.stderr) {
        const stderrDecoder = new TextDecoder();
        stderrStreamReader = p.stderr.getReader();
        (async () => {
          try {
            while (true) {
              const { done, value } = await stderrStreamReader!.read();
              if (done) break;
              const text = stderrDecoder.decode(value, { stream: true });
              stderrChunks.push(text);
              for (const line of text.split('\n')) {
                if (line.trim()) console.error(`[claude:${session.id}:stderr] ${line}`);
              }
            }
          } catch {
            /* process ended */
          }
        })();
      }
    };

    // Hoist assistant content accumulator so the cancel handler can persist
    // any partial response that was already received before cancellation.
    let assistantContent: any[] | null = null;
    let assistantModel: string | null = null;

    // Periodic flush: persist partial assistant messages to DB every few seconds
    // so they survive browser reloads.
    const assistantMsgId = nanoid();
    let assistantMsgPersisted = false;
    let lastFlushTime = 0;
    const FLUSH_INTERVAL_MS = 500; // Reduced from 2000ms for faster cross-device sync

    const flushAssistantContent = () => {
      if (!assistantContent || assistantContent.length === 0) return;
      try {
        const db = getDb();
        const now = Date.now();
        if (!assistantMsgPersisted) {
          db.query(
            `INSERT INTO messages (id, conversation_id, role, content, model, timestamp)
             VALUES (?, ?, 'assistant', ?, ?, ?)`,
          ).run(
            assistantMsgId,
            session.conversationId,
            JSON.stringify(assistantContent),
            assistantModel,
            now,
          );
          db.query('UPDATE conversations SET updated_at = ? WHERE id = ?').run(
            now,
            session.conversationId,
          );
          assistantMsgPersisted = true;
        } else {
          db.query(`UPDATE messages SET content = ?, model = ?, timestamp = ? WHERE id = ?`).run(
            JSON.stringify(assistantContent),
            assistantModel,
            now,
            assistantMsgId,
          );
          db.query('UPDATE conversations SET updated_at = ? WHERE id = ?').run(
            now,
            session.conversationId,
          );
        }
        lastFlushTime = now;

        // Force WAL checkpoint so other connections see the write immediately
        try {
          db.exec('PRAGMA wal_checkpoint(PASSIVE)');
        } catch {
          // Checkpoint failure is non-critical, just log
        }

        // Broadcast message update event for cross-device sync
        broadcastMessageUpdate(session.conversationId, assistantMsgId, 'assistant');
      } catch (dbErr) {
        console.error('[claude] Failed to flush assistant content:', dbErr);
      }
    };

    const maybeFlush = () => {
      if (Date.now() - lastFlushTime >= FLUSH_INTERVAL_MS) {
        flushAssistantContent();
      }
    };

    const scheduleCleanup = () => this.scheduleCleanup(session.id);

    /** Clear stale CLI session ID from DB so the next message starts a fresh CLI session. */
    const clearStaleCliSessionId = () => {
      try {
        const db = getDb();
        db.query('UPDATE conversations SET cli_session_id = NULL WHERE id = ?').run(
          session.conversationId,
        );
        session.cliSessionId = undefined;
        console.log(
          `[claude:${session.id}] Cleared stale CLI session ID for conversation ${session.conversationId}`,
        );
      } catch (e) {
        console.error('[claude] Failed to clear stale session ID:', e);
      }
    };

    return new ReadableStream({
      start(controller) {
        // Store controller on session for event injection from external sources
        session.streamController = controller;

        // Ping to keep connection alive
        const pingInterval = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`data: {"type":"ping"}\n\n`));
          } catch {
            clearInterval(pingInterval);
          }
        }, 15000);

        // Timeout: if the CLI produces no content events within 120s, report an error.
        // This catches cases where the CLI hangs during API auth, MCP server startup, etc.
        // Hoisted here so both the cancel handler and the streaming loop can clear it.
        let receivedContentEvent = false;
        let contentTimeoutId: ReturnType<typeof setTimeout> | null = setTimeout(() => {
          if (!receivedContentEvent && !cancelled) {
            console.error(
              `[claude:${session.id}] Content timeout — no content received within 120s`,
            );
            clearActivityTimeout();
            clearStaleCliSessionId();
            const errEvt = JSON.stringify({
              type: 'error',
              error: {
                type: 'timeout',
                message:
                  'No response received from CLI within 120 seconds. The model may be overloaded or the CLI may have failed to start. Please try sending your message again.',
              },
            });
            enqueueEvent(controller, `data: ${errEvt}\n\n`);
            // Also send message_stop so client exits streaming state
            enqueueEvent(controller, `data: {"type":"message_stop"}\n\n`);
            session.streamComplete = true;
            scheduleCleanup();
            try {
              controller.close();
            } catch {
              /* already closed */
            }
            session.status = 'idle';
            proc.kill('SIGTERM');
          }
        }, 120_000);
        const clearContentTimeout = () => {
          if (contentTimeoutId) {
            clearTimeout(contentTimeoutId);
            contentTimeoutId = null;
          }
        };

        // Phase-aware activity timeout: uses tighter limits when the CLI is
        // waiting for an API response vs executing tool calls.
        const API_WAIT_TIMEOUT_MS = 180_000; // 3 minutes — API calls shouldn't take longer
        const TOOL_EXEC_TIMEOUT_MS = 300_000; // 5 minutes — MCP/tool calls can be slow
        let activityTimeoutId: ReturnType<typeof setTimeout> | null = null;
        let currentPhase: 'init' | 'tool_execution' | 'waiting_for_api' = 'init';
        let apiRetryRequested = false;
        let retryCount = 0;
        const MAX_API_RETRIES = respawnForRetry ? 1 : 0;

        const resetActivityTimeout = () => {
          if (activityTimeoutId) clearTimeout(activityTimeoutId);
          const timeoutMs =
            currentPhase === 'waiting_for_api' ? API_WAIT_TIMEOUT_MS : TOOL_EXEC_TIMEOUT_MS;
          activityTimeoutId = setTimeout(() => {
            if (cancelled || session.streamComplete) return;

            // In API-wait phase with retries available: trigger auto-retry
            if (
              currentPhase === 'waiting_for_api' &&
              retryCount < MAX_API_RETRIES &&
              session.cliSessionId
            ) {
              console.log(
                `[claude:${session.id}] API call timeout (${timeoutMs / 1000}s) — requesting retry`,
              );
              apiRetryRequested = true;
              // Kill the stuck process; the reading loop will detect exit and handle retry
              proc.kill('SIGTERM');
              return;
            }

            // General activity timeout — no retries left, show error
            console.error(
              `[claude:${session.id}] Activity timeout — no CLI output for ${timeoutMs / 1000}s (phase: ${currentPhase})`,
            );
            clearStaleCliSessionId();
            if (assistantContent && assistantContent.length > 0) {
              flushAssistantContent();
            }
            const errEvt = JSON.stringify({
              type: 'error',
              error: {
                type: 'activity_timeout',
                message:
                  'No response from the assistant for 5 minutes. A tool call may be stuck. Please try sending your message again.',
              },
            });
            enqueueEvent(controller, `data: ${errEvt}\n\n`);
            enqueueEvent(controller, `data: {"type":"message_stop"}\n\n`);
            session.streamComplete = true;
            scheduleCleanup();
            try {
              controller.close();
            } catch {
              /* already closed */
            }
            session.status = 'idle';
            proc.kill('SIGTERM');
          }, timeoutMs);
        };
        const clearActivityTimeout = () => {
          if (activityTimeoutId) {
            clearTimeout(activityTimeoutId);
            activityTimeoutId = null;
          }
        };

        session.emitter.once('cancel', () => {
          cancelled = true;
          clearContentTimeout();
          clearActivityTimeout();
          clearInterval(pingInterval);
          proc.kill('SIGINT');

          // Final flush of assistant content on cancellation
          if (assistantContent && assistantContent.length > 0) {
            flushAssistantContent();
            // Extract artifacts from partial content on cancel too
            try {
              extractAndStoreArtifacts(session.conversationId, assistantMsgId, assistantContent);
            } catch (dbErr) {
              console.error('[claude] Failed to extract artifacts on cancel:', dbErr);
            }
          }

          enqueueEvent(controller, `data: {"type":"message_stop","reason":"cancelled"}\n\n`);
          session.streamComplete = true;
          session.cancelled = true;
          scheduleCleanup();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
          session.status = 'idle';
        });

        // Run the streaming loop WITHOUT awaiting — this lets start() return
        // immediately so Bun begins delivering enqueued data to the HTTP
        // response in real-time instead of buffering until the CLI exits.
        (async () => {
          try {
            // Shared state across retry attempts
            let sentStop = false;
            let sentMessageStart = false;
            let processExitCode: number | undefined;

            // eslint-disable-next-line no-labels
            processAttempt: while (true) {
              // Per-attempt state (reset on retry)
              const decoder = new TextDecoder();
              let buffer = '';
              let receivedAnyEvent = false;
              apiRetryRequested = false;
              currentPhase = 'init';
              processExitCode = undefined;

              // Set up stderr for this process attempt
              setupStderrReader(proc);

              // Read stdout (or combined pty output) using explicit reader.
              // Race each read against process exit to avoid blocking forever.
              console.log(
                `[claude:${session.id}] Starting to read from CLI output (attempt ${retryCount + 1})`,
              );
              const stdoutReader = proc.stdout.getReader();

              // Sentinel that resolves when the process exits.
              const exitSentinel = proc.exited.then(async (code) => {
                processExitCode = code;
                console.log(`[claude:${session.id}] CLI process exited with code ${code}`);
                await new Promise((r) => setTimeout(r, 1000));
                return { done: true as const, value: undefined as Uint8Array | undefined };
              });

              while (true) {
                const result = await Promise.race([stdoutReader.read(), exitSentinel]);
                if (result.done || cancelled) {
                  // If the process exited and the reader is stalled, cancel it to clean up
                  if (processExitCode !== undefined) {
                    try {
                      stdoutReader.cancel();
                    } catch {
                      /* ignore */
                    }
                  }
                  break;
                }
                const value = result.value;
                if (!value) continue;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (let line of lines) {
                  // Strip \r from PTY/script output (\r\n line endings)
                  line = line.replace(/\r/g, '');
                  if (!line.trim()) continue;
                  let cliEvent: any;
                  try {
                    cliEvent = JSON.parse(line);
                  } catch {
                    // Non-JSON line from CLI — log it so it's visible for debugging
                    console.warn(`[claude:${session.id}] Non-JSON stdout: ${line.slice(0, 200)}`);
                    continue;
                  }

                  try {
                    // Log event receipt for debugging streaming delays
                    if (cliEvent.type !== 'system') {
                      console.log(`[claude:${session.id}] Received ${cliEvent.type} event`);
                    }

                    // Capture CLI session ID for future resume and persist to DB
                    if (cliEvent.type === 'system' && cliEvent.session_id) {
                      session.cliSessionId = cliEvent.session_id;
                      try {
                        const db = getDb();
                        db.query('UPDATE conversations SET cli_session_id = ? WHERE id = ?').run(
                          cliEvent.session_id,
                          session.conversationId,
                        );
                      } catch (e) {
                        console.error('[claude] Failed to persist session ID:', e);
                      }

                      // Send message_start immediately so UI shows streaming indicator
                      // This ensures users see feedback even if response generation is slow
                      if (!sentMessageStart) {
                        sentMessageStart = true;
                        const messageStartEvent = JSON.stringify({
                          type: 'message_start',
                          message: {
                            id: nanoid(),
                            role: 'assistant',
                            model: session.model || 'unknown',
                          },
                        });
                        console.log('[stream] Enqueuing message_start event');
                        enqueueEvent(controller, `data: ${messageStartEvent}\n\n`);
                      }
                    }

                    // Track whether we've received actual content (not just system init)
                    if (cliEvent.type === 'assistant' || cliEvent.type === 'result') {
                      receivedContentEvent = true;
                      clearContentTimeout();
                    }

                    // Reset rolling activity timeout on any event once content has started.
                    // This catches cases where the CLI hangs mid-stream (e.g. stuck MCP tool).
                    if (receivedContentEvent) {
                      resetActivityTimeout();
                    }

                    // Track phase transitions for API-wait timeout
                    if (cliEvent.type === 'assistant') {
                      currentPhase = 'tool_execution';
                    } else if (cliEvent.type === 'user') {
                      currentPhase = 'waiting_for_api';
                    }

                    // Accumulate all assistant content blocks across multi-turn tool execution
                    if (cliEvent.type === 'assistant' && cliEvent.message?.content) {
                      if (!assistantContent) assistantContent = [];
                      assistantContent.push(...cliEvent.message.content);
                      assistantModel = cliEvent.message.model || session.model || null;

                      // Periodically flush partial content to DB so it survives browser reloads
                      maybeFlush();

                      // Track file-writing tool calls for verification + approval
                      const fileWriteTools = [
                        'write_file',
                        'edit_file',
                        'create_file',
                        'str_replace_editor',
                        'Write',
                        'Edit',
                      ];
                      // Check permission mode and per-tool rules for approval
                      let permMode: PermissionMode = 'safe';
                      try {
                        const pDb = getDb();
                        const pRow = pDb
                          .query("SELECT value FROM settings WHERE key = 'permissionMode'")
                          .get() as any;
                        if (pRow) permMode = JSON.parse(pRow.value) as PermissionMode;
                      } catch {
                        /* default to safe */
                      }

                      // Load per-tool permission rules and terminal policy
                      const permRules = loadPermissionRules(
                        session.conversationId,
                        session.workspacePath,
                      );
                      const termPolicy = loadTerminalCommandPolicy();

                      for (const block of cliEvent.message.content) {
                        // Skip non-tool blocks (e.g. text blocks don't have .name)
                        if (block.type !== 'tool_use') continue;

                        // Evaluate per-tool permission rules
                        const ruleDecision = shouldRequireApproval(
                          block.name,
                          (block.input || {}) as Record<string, unknown>,
                          permRules,
                          permMode,
                          termPolicy,
                        );
                        if (ruleDecision === 'ask') {
                          const parsed = parseMcpToolName(block.name);
                          const filePath = extractFilePath(block.input || {});
                          const effectiveName = parsed.renderAs || parsed.toolName;
                          const desc =
                            effectiveName === 'Bash' ||
                            block.name === 'bash' ||
                            block.name === 'execute_command'
                              ? `Run: ${String(block.input?.command || '').slice(0, 100)}`
                              : filePath
                                ? `Write to ${filePath}`
                                : `Execute ${parsed.displayName}`;
                          const approvalEvent = JSON.stringify({
                            type: 'tool_approval_request',
                            toolCallId: block.id || nanoid(),
                            toolName: block.name,
                            input: block.input || {},
                            description: desc,
                          });
                          enqueueEvent(controller, `data: ${approvalEvent}\n\n`);

                          // Bridge approval request to commentators
                          if (session.workspacePath) {
                            eventBridge.emitRaw(session.workspacePath, approvalEvent);

                            // Send notification for approval request
                            sendNotification({
                              event: 'approval_needed',
                              title: 'Approval Needed',
                              message: `Tool "${parsed.displayName}" requires approval: ${desc}`,
                              workspaceId: session.workspacePath,
                              conversationId: session.conversationId,
                            }).catch((err) => {
                              console.error(
                                `[claude] Failed to send approval_needed notification:`,
                                err,
                              );
                            });
                          }
                        }

                        // Emit user_question_request for AskUserQuestion tool
                        // Match both the built-in name and the MCP server name format
                        if (
                          block.name === 'AskUserQuestion' ||
                          block.name === 'mcp__e-ask-user__AskUserQuestion'
                        ) {
                          const toolCallId = block.id || nanoid();
                          const questions = block.input?.questions || [];

                          // Pre-link this toolCallId so when the MCP server POSTs
                          // to /internal/ask-user (which happens after this), the
                          // bridge auto-links the token to this block.id.
                          prelinkToolCallId(toolCallId, questions);

                          // Always emit — this is the single emission point.
                          const questionEvent = JSON.stringify({
                            type: 'user_question_request',
                            toolCallId,
                            questions,
                          });
                          enqueueEvent(controller, `data: ${questionEvent}\n\n`);
                        }

                        // Trigger file verification for file-writing tools (both built-in and MCP)
                        const isFileWrite =
                          fileWriteTools.includes(block.name) || isMcpFileWriteTool(block.name);
                        if (isFileWrite) {
                          const filePath = extractFilePath(block.input || {});
                          if (filePath && typeof filePath === 'string') {
                            // Run async verification after a short delay to let the file be written
                            setTimeout(async () => {
                              try {
                                const result = await verifyFile(
                                  filePath,
                                  session.workspacePath || process.cwd(),
                                );
                                const verifyEvent = JSON.stringify({
                                  type: 'verification_result',
                                  filePath: result.filePath,
                                  passed: result.passed,
                                  issues: result.issues,
                                  tool: result.tool,
                                  duration: result.duration,
                                });
                                enqueueEvent(controller, `data: ${verifyEvent}\n\n`);

                                // Bridge verification result to commentators
                                if (session.workspacePath) {
                                  eventBridge.emitRaw(session.workspacePath, verifyEvent);
                                }
                              } catch {
                                /* verification failed silently */
                              }
                            }, 500);
                          }
                        }
                      }
                    }

                    // Emit tool_result events for user-type events (tool results from CLI)
                    if (cliEvent.type === 'user' && cliEvent.message?.content) {
                      for (const block of cliEvent.message.content) {
                        if (block.type === 'tool_result') {
                          // Look up tool name + filePath from accumulated assistant content
                          let toolName: string | undefined;
                          let filePath: string | undefined;
                          let editLineHint: number | undefined;
                          if (assistantContent) {
                            const toolBlock = assistantContent.find(
                              (b: any) => b.type === 'tool_use' && b.id === block.tool_use_id,
                            );
                            if (toolBlock) {
                              toolName = toolBlock.name;
                              const toolInput = toolBlock.input || {};
                              filePath = extractFilePath(toolInput) || undefined;
                              // Derive approximate edit line for Follow Along scrolling
                              if (filePath && toolName) {
                                try {
                                  const { readFileSync } = await import('fs');
                                  const fileContent = readFileSync(filePath, 'utf-8');
                                  editLineHint = extractEditLineHint(
                                    toolName,
                                    toolInput,
                                    fileContent,
                                  );
                                } catch {
                                  // File may have been deleted or unreadable — derive without content
                                  editLineHint = extractEditLineHint(toolName, toolInput);
                                }
                              }
                            }
                          }
                          const resultEvent = JSON.stringify({
                            type: 'tool_result',
                            toolCallId: block.tool_use_id || '',
                            toolName,
                            filePath,
                            editLineHint,
                            result:
                              typeof block.content === 'string'
                                ? block.content
                                : JSON.stringify(block.content),
                            isError: Boolean(block.is_error),
                          });
                          enqueueEvent(controller, `data: ${resultEvent}\n\n`);

                          // Bridge tool_result to commentators
                          if (session.workspacePath) {
                            eventBridge.emitRaw(session.workspacePath, resultEvent);
                          }

                          // Check for canvas_update metadata in tool result
                          if (toolName === 'canvas_push' && typeof block.content === 'string') {
                            try {
                              const parsed = JSON.parse(block.content);
                              if (parsed.__canvas_update) {
                                const canvasEvent = JSON.stringify({
                                  type: 'canvas_update',
                                  canvasId: parsed.__canvas_update.canvasId,
                                  contentType: parsed.__canvas_update.contentType,
                                  content: parsed.__canvas_update.content,
                                  title: parsed.__canvas_update.title,
                                  conversationId: session.conversationId,
                                });
                                enqueueEvent(controller, `data: ${canvasEvent}\n\n`);

                                // Also bridge to event bridge for cross-workspace support
                                if (session.workspacePath) {
                                  eventBridge.emitRaw(session.workspacePath, canvasEvent);
                                }
                              }
                            } catch {
                              // Failed to parse - ignore
                            }
                          }
                        }
                      }
                    }

                    receivedAnyEvent = true;

                    // Translate CLI events to API-style events and send to client.
                    // Wrap in try/catch so a client disconnect doesn't abort the
                    // loop — we still need to accumulate assistantContent for DB save.
                    const apiEvents = translateCliEvent(cliEvent);
                    for (const evt of apiEvents) {
                      console.log('[stream] Enqueuing event:', evt.slice(0, 100));
                      enqueueEvent(controller, `data: ${evt}\n\n`);
                    }

                    // Mirror translated events to active commentators via the event bridge.
                    // This is fire-and-forget — never blocks the primary stream.
                    if (session.workspacePath) {
                      for (const evt of apiEvents) {
                        eventBridge.emitRaw(session.workspacePath, evt);
                      }
                    }

                    // Persist token usage on result + check context pressure for autocompaction
                    if (cliEvent.type === 'result') {
                      sentStop = true;
                      const usage = cliEvent.usage;
                      if (usage) {
                        try {
                          const totalTokens =
                            (usage.input_tokens || 0) + (usage.output_tokens || 0);
                          const db = getDb();
                          db.query(
                            'UPDATE conversations SET total_tokens = total_tokens + ? WHERE id = ?',
                          ).run(totalTokens, session.conversationId);
                        } catch (e) {
                          console.error('[claude] Failed to persist token usage:', e);
                        }

                        // Check context pressure — warn at user threshold, autocompact at the Claude Code threshold
                        try {
                          const inputTokens = usage.input_tokens || 0;
                          const model = session.model || 'default';
                          const contextLimit = getContextLimit(model);
                          const autoCompactThreshold = getAutoCompactThreshold(model);

                          // Read user's auto-compaction settings
                          let autoCompactionEnabled = true;
                          let warningThresholdPct = 85;
                          try {
                            const db = getDb();
                            const autoCompactRow = db
                              .query("SELECT value FROM settings WHERE key = 'autoCompaction'")
                              .get() as any;
                            if (autoCompactRow)
                              autoCompactionEnabled = JSON.parse(autoCompactRow.value);

                            const thresholdRow = db
                              .query(
                                "SELECT value FROM settings WHERE key = 'autoCompactionThreshold'",
                              )
                              .get() as any;
                            if (thresholdRow) warningThresholdPct = JSON.parse(thresholdRow.value);
                          } catch {
                            /* use defaults */
                          }

                          const warningThreshold = Math.floor(
                            contextLimit * (warningThresholdPct / 100),
                          );

                          if (inputTokens >= warningThreshold) {
                            const shouldAutoCompact =
                              inputTokens >= autoCompactThreshold && autoCompactionEnabled;

                            if (shouldAutoCompact) {
                              console.log(
                                `[claude:${session.id}] Context at ${inputTokens}/${contextLimit} tokens (threshold ${autoCompactThreshold}) — applying autocompaction`,
                              );

                              // Run LLM compaction async so we can still emit the boundary event
                              // We do it in a fire-and-forget to avoid blocking the result event.
                              // The compaction must complete before the next user turn, which is fine
                              // since the user has to type and send a new message.
                              (async () => {
                                try {
                                  const db = getDb();

                                  // Get retention count from settings
                                  let retentionCount = 15;
                                  try {
                                    const retentionRow = db
                                      .query(
                                        "SELECT value FROM settings WHERE key = 'compactionRetentionCount'",
                                      )
                                      .get() as any;
                                    if (retentionRow)
                                      retentionCount = JSON.parse(retentionRow.value);
                                  } catch {
                                    /* use default */
                                  }

                                  // Load the full raw message history from DB
                                  const rawRows = db
                                    .query(
                                      'SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC',
                                    )
                                    .all(session.conversationId) as any[];
                                  const allMessages = rawRows.map((r: any) => {
                                    let parsed: any[];
                                    try {
                                      parsed = JSON.parse(r.content);
                                    } catch {
                                      parsed = [];
                                    }
                                    // Normalize nudge blocks so they don't confuse downstream APIs
                                    const content = Array.isArray(parsed)
                                      ? parsed.map((block: any) =>
                                          block.type === 'nudge'
                                            ? { type: 'text', text: `[User nudge]: ${block.text}` }
                                            : block,
                                        )
                                      : parsed;
                                    return { role: r.role, content };
                                  });

                                  if (allMessages.length === 0) return;

                                  // Determine split point using sliding window with user's retention count
                                  const history = loadConversationHistory(session.conversationId, {
                                    strategy: 'sliding-window',
                                    maxMessages: retentionCount,
                                    createSummary: false,
                                  });

                                  if (!history.compacted) {
                                    console.log(
                                      `[claude:${session.id}] Compaction not needed after re-check`,
                                    );
                                    return;
                                  }

                                  // compactedCount is the number of messages kept.
                                  // Everything before that split is dropped.
                                  const splitIdx = allMessages.length - history.compactedCount;
                                  const finalDropped = allMessages.slice(0, splitIdx);
                                  const keptMessages = allMessages.slice(splitIdx);

                                  // Generate LLM summary (falls back to rule-based on failure)
                                  const { summaryText, summaryMessage, usedLLM } =
                                    await summarizeWithLLM(finalDropped, keptMessages, model);

                                  // Build final compacted message array: [summary, ...kept]
                                  const compactedMessages = [summaryMessage, ...keptMessages];

                                  // Write compacted history back to DB
                                  db.query('DELETE FROM messages WHERE conversation_id = ?').run(
                                    session.conversationId,
                                  );
                                  let ts = Date.now();
                                  for (const msg of compactedMessages) {
                                    db.query(
                                      `INSERT INTO messages (id, conversation_id, role, content, timestamp)
                                     VALUES (?, ?, ?, ?, ?)`,
                                    ).run(
                                      nanoid(),
                                      session.conversationId,
                                      msg.role,
                                      JSON.stringify(msg.content),
                                      ts++,
                                    );
                                  }

                                  // Clear CLI session ID and store the summary text so the next
                                  // turn can inject it into the fresh CLI session's first prompt.
                                  session.cliSessionId = undefined;
                                  const compactTimestamp = Date.now();
                                  db.query(
                                    'UPDATE conversations SET cli_session_id = NULL, compact_summary = ? WHERE id = ?',
                                  ).run(summaryText, session.conversationId);

                                  // Record compaction event in history
                                  db.query(
                                    `INSERT INTO compaction_history (id, conversation_id, trigger, original_message_count,
                                     compacted_message_count, dropped_message_count, summary_text, used_llm, retention_count,
                                     threshold_pct, compacted_at)
                                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                                  ).run(
                                    nanoid(),
                                    session.conversationId,
                                    'auto',
                                    allMessages.length,
                                    compactedMessages.length,
                                    finalDropped.length,
                                    summaryText,
                                    usedLLM ? 1 : 0,
                                    retentionCount,
                                    warningThresholdPct,
                                    compactTimestamp,
                                  );

                                  console.log(
                                    `[claude:${session.id}] Autocompaction complete: ${allMessages.length} → ${compactedMessages.length} messages (LLM=${usedLLM})`,
                                  );
                                } catch (compactErr) {
                                  console.error('[claude] Autocompaction failed:', compactErr);
                                }
                              })();
                            }

                            // Emit context_warning for the warning banner
                            const usagePct =
                              contextLimit > 0
                                ? Math.round((inputTokens / contextLimit) * 1000) / 10
                                : 0;
                            const contextWarningEvent = JSON.stringify({
                              type: 'context_warning',
                              inputTokens,
                              contextLimit,
                              usagePercent: usagePct,
                              autocompacted: shouldAutoCompact,
                            });
                            enqueueEvent(controller, `data: ${contextWarningEvent}\n\n`);

                            // Also emit compact_boundary if compacting (matches Claude Code's SSE protocol)
                            if (shouldAutoCompact) {
                              const compactBoundaryEvent = JSON.stringify({
                                type: 'compact_boundary',
                                trigger: 'auto',
                                pre_tokens: inputTokens,
                                context_limit: contextLimit,
                              });
                              enqueueEvent(controller, `data: ${compactBoundaryEvent}\n\n`);
                            }
                          }
                        } catch (pressureErr) {
                          console.error('[claude] Context pressure check failed:', pressureErr);
                        }
                      }
                    }
                  } catch (eventErr) {
                    console.error(`[claude:${session.id}] Error processing event:`, eventErr);
                  }
                }
              }

              // --- Retry check: if the API-wait timeout killed the process, retry ---
              if (
                apiRetryRequested &&
                retryCount < MAX_API_RETRIES &&
                !cancelled &&
                session.cliSessionId &&
                respawnForRetry
              ) {
                retryCount++;
                apiRetryRequested = false;

                try {
                  const retryProc = respawnForRetry();
                  proc = retryProc;
                  session.cliProcess = retryProc;
                  console.log(
                    `[claude:${session.id}] API retry: spawned new CLI PID ${retryProc.pid} (attempt ${retryCount + 1})`,
                  );

                  // Notify the client
                  enqueueEvent(
                    controller,
                    `data: ${JSON.stringify({
                      type: 'api_retry',
                      attempt: retryCount,
                      message: 'API call timed out, retrying...',
                    })}\n\n`,
                  );

                  // Re-arm content timeout for the retry attempt
                  receivedContentEvent = false;
                  contentTimeoutId = setTimeout(() => {
                    if (!receivedContentEvent && !cancelled) {
                      console.error(`[claude:${session.id}] Content timeout on retry attempt`);
                      clearActivityTimeout();
                      clearStaleCliSessionId();
                      const errEvt = JSON.stringify({
                        type: 'error',
                        error: {
                          type: 'timeout',
                          message:
                            'Retry failed — no response from CLI. Please try sending your message again.',
                        },
                      });
                      enqueueEvent(controller, `data: ${errEvt}\n\n`);
                      enqueueEvent(controller, `data: {"type":"message_stop"}\n\n`);
                      session.streamComplete = true;

                      // Trigger pattern analysis asynchronously (non-blocking)
                      triggerPatternAnalysis(session.conversationId, session.workspacePath).catch(
                        (err) => {
                          console.error('Pattern analysis failed:', err);
                        },
                      );

                      scheduleCleanup();
                      try {
                        controller.close();
                      } catch {
                        /* already closed */
                      }
                      session.status = 'idle';
                      proc.kill('SIGTERM');
                    }
                  }, 120_000);

                  // eslint-disable-next-line no-labels
                  continue processAttempt;
                } catch (retryErr) {
                  console.error(`[claude:${session.id}] Failed to spawn retry CLI:`, retryErr);
                  // Fall through to normal cleanup
                }
              }

              // eslint-disable-next-line no-labels
              break processAttempt;
            } // end processAttempt while loop

            clearContentTimeout();
            clearActivityTimeout();
            clearInterval(pingInterval);

            // Check exit code and report errors if no content events received.
            // We check receivedContentEvent (not receivedAnyEvent) because the
            // CLI may send a 'system' init event and then hang — in that case
            // the client already shows the streaming indicator but never gets content.
            if (!cancelled && !receivedContentEvent) {
              // Wait for process to fully exit and stderr to finish flushing
              // BEFORE cancelling the stderr reader — otherwise we lose the error output.
              await proc.exited.catch(() => {});
              await new Promise((r) => setTimeout(r, 500));
              const exitCode = processExitCode ?? proc.exitCode;
              const stderr = stderrChunks.join('').trim();

              // Decode exit code for clarity
              let exitDetail = `code ${exitCode}`;
              if (exitCode !== null && exitCode !== undefined) {
                if (exitCode > 128)
                  exitDetail += ` (signal ${exitCode - 128}: ${signalName(exitCode - 128)})`;
                else if (exitCode === 127) exitDetail += ' (command not found)';
                else if (exitCode === 126) exitDetail += ' (permission denied)';
              }

              const errMsg = stderr
                ? `CLI exited (${exitDetail}) with: ${stderr.slice(0, 500)}`
                : `CLI exited with ${exitDetail} and produced no output`;
              console.error(`[claude:${session.id}] ${errMsg}`);
              // CLI never produced content — session is dead, clear it
              clearStaleCliSessionId();
              const errEvt = JSON.stringify({
                type: 'error',
                error: {
                  type: 'cli_error',
                  message: `${errMsg}. Please try sending your message again.`,
                },
              });
              enqueueEvent(controller, `data: ${errEvt}\n\n`);
            }

            // Cancel the stderr reader after error reporting is done
            if (stderrStreamReader) {
              try {
                stderrStreamReader.cancel();
              } catch {
                /* ignore */
              }
            }

            // Final flush of assistant message to DB (skip if cancel handler already saved it)
            if (!cancelled && assistantContent && assistantContent.length > 0) {
              try {
                flushAssistantContent();

                // Extract <artifact> blocks from text content and store them
                const artifactEvents = extractAndStoreArtifacts(
                  session.conversationId,
                  assistantMsgId,
                  assistantContent,
                );
                for (const evt of artifactEvents) {
                  enqueueEvent(controller, evt);
                }
              } catch (dbErr) {
                console.error('[claude] Failed to save assistant message:', dbErr);
              }
            }

            if (!cancelled && !sentStop) {
              // Stream ended without a result event — CLI died or was killed mid-stream.
              // Clear the session ID so the next message starts a fresh CLI session.
              clearStaleCliSessionId();
              enqueueEvent(controller, `data: {"type":"message_stop"}\n\n`);
            }
            session.streamComplete = true;
            scheduleCleanup();
            if (!cancelled) {
              try {
                controller.close();
              } catch {
                /* already closed */
              }
            }
            session.status = 'idle';
          } catch (err) {
            clearContentTimeout();
            clearActivityTimeout();
            clearInterval(pingInterval);

            // Final flush on error/disconnect — the periodic flush may have already
            // saved most of the content, this ensures the latest state is persisted.
            if (!cancelled && assistantContent && assistantContent.length > 0) {
              flushAssistantContent();
            }

            // Stream errored — clear session ID so next message starts fresh
            if (!cancelled) {
              clearStaleCliSessionId();
              const msg = String(err).replace(/"/g, '\\"');
              enqueueEvent(
                controller,
                `data: {"type":"error","error":{"type":"stream_error","message":"${msg}"}}\n\n`,
              );
              session.streamComplete = true;
              scheduleCleanup();
              try {
                controller.close();
              } catch {
                /* controller already closed */
              }
            }
            session.status = 'idle';
          }
        })(); // end async IIFE — not awaited so start() returns immediately
      },
      cancel() {
        // Client disconnected (e.g. page refresh). The CLI process continues
        // running and events keep being buffered in session.eventBuffer so the
        // client can reconnect and resume the stream.
        console.log(
          `[claude:${session.id.slice(0, 8)}] Client disconnected — session stays alive ` +
            `(status=${session.status}, buffered=${session.eventBuffer.length} events)`,
        );
      },
    });
  }

  /** Write data to the CLI process's stdin / pty input (for answering AskUserQuestion) */
  writeStdin(sessionId: string, data: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session?.cliProcess) return false;
    try {
      session.cliProcess.write(data);
      return true;
    } catch (err) {
      console.error(`[claude:${sessionId}] Failed to write to stdin:`, err);
      return false;
    }
  }

  /**
   * Queue a nudge to be injected into the agent context on its next turn.
   * Nudges are non-blocking — they don't interrupt the current stream.
   */
  queueNudge(sessionId: string, nudge: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.pendingNudges.push(nudge);
    console.log(`[claude:${sessionId}] Nudge queued: ${nudge.slice(0, 80)}`);
    return true;
  }

  /**
   * Inject an SSE event into all active (running) sessions.
   * Used by the ask-user bridge to push user_question_request events
   * before the CLI's assistant event arrives (avoiding deadlock).
   */
  injectEvent(sseData: string): void {
    const encoder = new TextEncoder();
    let injected = 0;
    for (const session of this.sessions.values()) {
      console.log(
        `[injectEvent] Session ${session.id}: status=${session.status}, hasController=${!!session.streamController}`,
      );
      if (session.status === 'running' && session.streamController) {
        session.eventBuffer.push(sseData);
        try {
          session.streamController.enqueue(encoder.encode(sseData));
          injected++;
          console.log(`[injectEvent] Enqueued to session ${session.id}`);
        } catch (e) {
          console.error(`[injectEvent] Failed to enqueue to session ${session.id}:`, e);
        }
      }
    }
    if (injected === 0) {
      console.warn(
        `[injectEvent] No active sessions found — event not delivered. Total sessions: ${this.sessions.size}`,
      );
    }
  }

  cancelGeneration(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.emitter.emit('cancel');
    }
  }

  terminateSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = 'terminated';
      session.cliProcess?.kill();
      this.sessions.delete(sessionId);
      const timer = this.cleanupTimers.get(sessionId);
      if (timer) {
        clearTimeout(timer);
        this.cleanupTimers.delete(sessionId);
      }
    }
  }

  getSessionCount(): number {
    return this.sessions.size;
  }

  getSession(sessionId: string): ClaudeSession | undefined {
    return this.sessions.get(sessionId);
  }

  listSessions(): Array<{
    id: string;
    conversationId: string;
    status: string;
    streamComplete: boolean;
    cancelled: boolean;
    bufferedEvents: number;
  }> {
    const list = Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      conversationId: s.conversationId,
      status: s.status,
      streamComplete: s.streamComplete,
      cancelled: s.cancelled,
      bufferedEvents: s.eventBuffer.length,
    }));
    console.log(
      `[sessions] listSessions called — ${list.length} session(s):`,
      list.map(
        (s) =>
          `${s.id.slice(0, 8)}… status=${s.status} complete=${s.streamComplete} cancelled=${s.cancelled} events=${s.bufferedEvents}`,
      ),
    );
    return list;
  }

  /**
   * Create a reconnection stream that replays all buffered SSE events
   * from an in-flight (or just-completed) session. If the stream is
   * still running, the returned stream stays open and receives new
   * events via the session's emitter until completion.
   */
  reconnectStream(sessionId: string): ReadableStream | null {
    const session = this.sessions.get(sessionId);
    if (!session) {
      console.log(`[reconnect] Session ${sessionId.slice(0, 8)}… not found`);
      return null;
    }
    // Allow reconnection to running sessions even with empty buffers —
    // the stream may have just started and events haven't arrived yet.
    // For completed sessions, require at least one buffered event.
    if (session.eventBuffer.length === 0 && session.streamComplete) {
      console.log(
        `[reconnect] Session ${sessionId.slice(0, 8)}… completed with 0 events — skipping`,
      );
      return null;
    }
    console.log(
      `[reconnect] Replaying session ${sessionId.slice(0, 8)}… ` +
        `(status=${session.status}, complete=${session.streamComplete}, buffered=${session.eventBuffer.length} events)`,
    );

    const encoder = new TextEncoder();
    const buffer = session.eventBuffer;
    const isComplete = session.streamComplete;

    return new ReadableStream({
      start(controller) {
        // 1. Replay all buffered events immediately
        for (const sseData of buffer) {
          try {
            controller.enqueue(encoder.encode(sseData));
          } catch {
            return; // client gone
          }
        }

        // 2. If stream already finished, close immediately
        if (isComplete) {
          try {
            controller.close();
          } catch {
            /* already closed */
          }
          return;
        }

        // 3. Stream is still running — listen for new events
        //    We record the current buffer length so we only forward
        //    events that arrive AFTER the replay.
        let cursor = buffer.length;

        const pingInterval = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`data: {"type":"ping"}\n\n`));
          } catch {
            clearInterval(pingInterval);
          }
        }, 15000);

        const pollInterval = setInterval(() => {
          // Forward any new events that were buffered since our last check
          while (cursor < session.eventBuffer.length) {
            try {
              controller.enqueue(encoder.encode(session.eventBuffer[cursor]));
            } catch {
              clearInterval(pollInterval);
              clearInterval(pingInterval);
              return;
            }
            cursor++;
          }

          // If stream is done, close
          if (session.streamComplete) {
            clearInterval(pollInterval);
            clearInterval(pingInterval);
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          }
        }, 100); // Poll every 100ms for new events

        // Clean up if client disconnects
        session.emitter.once('reconnect_close', () => {
          clearInterval(pollInterval);
          clearInterval(pingInterval);
        });
      },
      cancel() {
        session.emitter.emit('reconnect_close');
      },
    });
  }

  /**
   * Clear all stale CLI session IDs from DB. Called on server startup since
   * all in-memory CLI processes are gone after a restart.
   */
  clearStaleSessionIds(): void {
    try {
      const db = getDb();
      const result = db
        .query('UPDATE conversations SET cli_session_id = NULL WHERE cli_session_id IS NOT NULL')
        .run();
      console.log(
        `[claude] Cleared ${result.changes} stale CLI session ID(s) from previous server instance`,
      );
    } catch (e) {
      console.error('[claude] Failed to clear stale session IDs:', e);
    }
  }

  /**
   * Create a lightweight session for non-Claude provider streams (Ollama, OpenAI, etc.).
   * These sessions only buffer SSE events for reconnection — they don't manage a CLI process.
   */
  createLightweightSession(conversationId: string): string {
    const sessionId = nanoid();
    const session: ClaudeSession = {
      id: sessionId,
      conversationId,
      status: 'running',
      emitter: new EventEmitter(),
      eventBuffer: [],
      streamComplete: false,
      cancelled: false,
      pendingNudges: [],
    };
    this.sessions.set(sessionId, session);
    return sessionId;
  }

  /**
   * Wrap a provider ReadableStream with event buffering for reconnection support.
   * All SSE events flowing through the stream are captured in the session's eventBuffer.
   * When the stream completes, the session is marked complete and scheduled for cleanup.
   */
  wrapProviderStream(sessionId: string, providerStream: ReadableStream): ReadableStream {
    const session = this.sessions.get(sessionId);
    if (!session) return providerStream; // fallback: return unwrapped

    const encoder = new TextEncoder();
    const reader = providerStream.getReader();
    const scheduleCleanup = () => this.scheduleCleanup(sessionId);

    return new ReadableStream({
      async start(controller) {
        const decoder = new TextDecoder();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            // Forward data to client
            try {
              controller.enqueue(value);
            } catch {
              // Client disconnected — continue reading to buffer events
            }

            // Buffer SSE events for reconnection
            const text = decoder.decode(value, { stream: true });
            const lines = text.split('\n');
            for (const line of lines) {
              if (line.startsWith('data: ') && line.trim().length > 6) {
                session.eventBuffer.push(line + '\n\n');
              }
            }
          }
        } catch (err) {
          // Stream error
          const errEvt = `data: ${JSON.stringify({
            type: 'error',
            error: { type: 'stream_error', message: String(err) },
          })}\n\n`;
          session.eventBuffer.push(errEvt);
          try {
            controller.enqueue(encoder.encode(errEvt));
          } catch {
            /* client gone */
          }
        } finally {
          session.streamComplete = true;
          scheduleCleanup();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
          session.status = 'idle';
        }
      },
      cancel() {
        // Client disconnected (e.g. page refresh). Do NOT cancel the upstream
        // reader or mark the session complete — the start() loop will continue
        // reading from the provider and buffering events so the client can
        // reconnect and resume the stream. The start() loop's finally block
        // handles cleanup when the provider stream actually finishes.
        console.log(
          `[provider:${sessionId.slice(0, 8)}] Client disconnected — session stays alive ` +
            `(buffered=${session.eventBuffer.length} events)`,
        );
      },
    });
  }
}

/**
 * Trigger pattern analysis asynchronously after a conversation turn completes
 */
async function triggerPatternAnalysis(
  conversationId: string,
  workspacePath?: string,
): Promise<void> {
  try {
    // Lazy import to avoid circular dependencies
    const { detectPatterns, shouldProposeSkillOrRule } = await import('../pattern-detection');
    const { generateProposal } = await import('../proposal-generator');

    // Run pattern detection
    const patterns = await detectPatterns(workspacePath || '', conversationId, 'moderate');

    // Auto-propose for patterns that meet the threshold
    for (const pattern of patterns) {
      if (shouldProposeSkillOrRule(pattern, 3)) {
        try {
          // Generate proposal (this creates an agent note automatically)
          await generateProposal(pattern, 'skill');
        } catch (proposalErr) {
          console.error(`Failed to generate proposal for pattern ${pattern.id}:`, proposalErr);
        }
      }
    }
  } catch (err) {
    // Silent fail - pattern analysis is non-critical
    console.error('Pattern analysis error:', err);
  }
}
