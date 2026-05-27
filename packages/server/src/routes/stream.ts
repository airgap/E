import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { AgentKernel } from '../services/agent-kernel';
import { getDb } from '../db/database';
import { broadcastMessageUpdate } from './message-sync';
import { FLAGS } from '@e/shared';
import type { PermissionMode } from '@e/shared';
import {
  analyzeUserFrustration,
  frustrationPromptAdjustment,
} from '../services/frustration-detector';
import { kairosDaemon } from '../services/kairos-daemon';
import { modelRouter } from '../services/model-router';
import { contextSelection } from '../services/context-selection';
import { loadProjectInstructions } from '../services/project-instructions';
import { loadAutoMemory } from '../services/auto-memory';
import { loadHooks, runHooks } from '../services/hooks';
import {
  shouldRequireApproval,
  loadPermissionRules,
  loadTerminalCommandPolicy,
} from '../services/permission-rules';
import { TurnVerifier } from '../services/turn-verifier';
import { calculateCost } from '../services/cost-calculator';
import { getAgent, extractLeadingMention } from '../services/agent-registry';

const app = new Hono();

const BASE_SYSTEM_PROMPT = `You are E, an expert AI coding assistant. Fulfill requests accurately and concisely. Use tools when needed.`;

app.post('/:conversationId', async (c) => {
  const conversationId = c.req.param('conversationId');
  const body = await c.req.json();
  const {
    content: rawContent,
    effort,
    maxTurns,
    maxBudgetUsd,
    allowedTools: reqAllowedTools,
    disallowedTools: reqDisallowedTools,
    permissionMode: reqPermMode,
    /** Optional @-mentioned agent handle (e.g. 'claude-code'). Takes precedence
     *  over any handle parsed from the message body. */
    agentHandle: reqAgentHandle,
    /** Multimodal attachments (images today). Forwarded to providers that
     *  accept them — Kiro maps these onto ACP image blocks. Text attachments
     *  are inlined into `content` upstream by the client. */
    attachments: reqAttachments,
  } = body;

  // ── Resolve agent (from request field or leading @-mention) ──────────────
  // The chat input sends `agentHandle` explicitly; we also parse a leading
  // `@handle ` for robustness (e.g. messages pasted from elsewhere).
  let agent = reqAgentHandle ? getAgent(reqAgentHandle) : null;
  let content = rawContent;
  if (!agent && typeof rawContent === 'string') {
    const mention = extractLeadingMention(rawContent);
    if (mention) {
      agent = mention.agent;
      content = mention.rest || rawContent;
    }
  }
  let allowedTools = reqAllowedTools;
  let disallowedTools = reqDisallowedTools;
  if (agent?.allowedTools?.length) allowedTools = agent.allowedTools;
  if (agent?.disallowedTools?.length) disallowedTools = agent.disallowedTools;

  const db = getDb();
  const conv = db.query('SELECT * FROM conversations WHERE id = ?').get(conversationId) as any;
  if (!conv) return c.json({ ok: false, error: 'Conversation not found' }, 404);

  // ── Load project instructions, auto-memory, hooks ──
  const workspacePath = conv.workspace_path || process.cwd();
  const projectInstructions = loadProjectInstructions(workspacePath);
  const autoMemory = loadAutoMemory();
  const hooks = loadHooks(workspacePath);

  // ── Load permission settings ──
  const permModeRow = db
    .query("SELECT value FROM settings WHERE key = 'permissionMode'")
    .get() as any;
  const permissionMode: PermissionMode =
    reqPermMode || (permModeRow ? JSON.parse(permModeRow.value) : 'safe');
  const permissionRules = loadPermissionRules(conversationId, workspacePath);
  const terminalPolicy = loadTerminalCommandPolicy();
  const isYolo = permissionMode === 'unrestricted';

  // Run onStart hooks
  runHooks(hooks.onStart, {
    SESSION_ID: conversationId,
    MODEL: conv.model || '',
    WORKSPACE_PATH: workspacePath,
  });

  // Load prior messages BEFORE saving the new one so we get a clean history
  const priorMessages = db
    .query(
      `SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC LIMIT 100`,
    )
    .all(conversationId) as { role: string; content: string }[];

  // 1. Save user message
  const userMsgId = nanoid();
  db.query(
    `INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, 'user', ?, ?)`,
  ).run(userMsgId, conversationId, JSON.stringify([{ type: 'text', text: content }]), Date.now());
  broadcastMessageUpdate(conversationId, userMsgId, 'user');

  // 1b. Frustration detection — analyze user sentiment
  let frustrationContext: string | undefined;
  if (FLAGS.FRUSTRATION_DETECTION) {
    const signal = analyzeUserFrustration(conversationId, content);
    frustrationContext = frustrationPromptAdjustment(signal);
  }

  // 1c. Model routing — auto-select model based on task complexity
  let effectiveModel = conv.model;
  if (FLAGS.KAIROS) {
    // Reuse flag gate since model routing is always-on when available
    const routingSignal = modelRouter.route(content, conv.model);
    if (routingSignal.confidence >= 0.6) {
      effectiveModel = routingSignal.recommendedModel;
    }
  }

  // 1d. Smart context selection — auto-include relevant files
  let contextPreamble = '';
  if (FLAGS.CONTEXT_COMPACTION && conv.workspace_path) {
    const ctxResult = contextSelection.selectContext(content, conv.workspace_path);
    if (ctxResult.files.length > 0) {
      const fileSnippets = ctxResult.files
        .slice(0, 5)
        .map((f) => `[${f.filePath} (relevance: ${f.score})]`);
      contextPreamble = `<auto_context>\nRelevant files: ${fileSnippets.join(', ')}\n</auto_context>\n\n`;
    }
  }

  // 2. Determine provider configuration
  const cliProviderRow = db
    .query("SELECT value FROM settings WHERE key = 'cliProvider'")
    .get() as any;
  let cliProvider = cliProviderRow ? JSON.parse(cliProviderRow.value) : 'claude';

  // Agent override: if an agent was resolved above, let it dictate the transport
  // for this turn. `claude-cli` agents force the Claude CLI path regardless of
  // the user's default provider setting; `provider` agents can pin a specific
  // LLM provider/model without touching conversation-level defaults.
  if (agent) {
    if (agent.transport === 'claude-cli') {
      cliProvider = 'claude';
    } else if (agent.transport === 'provider' && agent.provider) {
      cliProvider = agent.provider;
      if (agent.model) effectiveModel = agent.model;
    }
  }

  // Direct API providers bypass the external CLI — they stream natively
  const isDirectProvider =
    effectiveModel?.includes('gemini') ||
    effectiveModel?.includes('bedrock') ||
    effectiveModel?.startsWith('ollama:') ||
    effectiveModel?.startsWith('openai:') ||
    cliProvider === 'ollama' ||
    cliProvider === 'openai' ||
    cliProvider === 'bedrock';

  // If cliProvider is 'ollama'/'openai' and model doesn't have a prefix, add it
  if (
    cliProvider === 'ollama' &&
    effectiveModel &&
    !effectiveModel.startsWith('ollama:') &&
    !effectiveModel.includes(':')
  ) {
    effectiveModel = `ollama:${effectiveModel}`;
  }
  if (
    cliProvider === 'openai' &&
    effectiveModel &&
    !effectiveModel.startsWith('openai:') &&
    !effectiveModel.includes(':')
  ) {
    effectiveModel = `openai:${effectiveModel}`;
  }

  const useExternalCli = !isDirectProvider && cliProvider === 'claude';

  const kernel = new AgentKernel({
    sessionId: conversationId,
    workspacePath,
    useExternalCli,
    yolo: isYolo,
    provider: cliProvider,
  });

  // Post-turn verification: track file modifications, verify at turn end
  const turnVerifier = new TurnVerifier(workspacePath);
  let turnCostUsd = 0;

  const assistantMsgId = nanoid();
  let fullAssistantText = '';

  const sseStream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (type: string, data: any) => {
        controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      // 3. Emit sequence required by Svelte 5 GUI
      send('message_start', {
        type: 'message_start',
        message: {
          id: assistantMsgId,
          role: 'assistant',
          content: [],
          // Agent handle so the client can render the participant chip on the
          // streaming bubble before the message is persisted.
          ...(agent ? { agentHandle: agent.handle } : {}),
        },
      });

      send('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      });

      kernel.on('event', (ev) => {
        if (ev.type === 'thinking') {
          // Send as thinking delta if supported, otherwise just update text
          send('content_block_delta', {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'thinking_delta', thinking: ev.data?.message || 'Thinking...' },
          });
        } else if (ev.type === 'text') {
          fullAssistantText += ev.data.text;
          send('content_block_delta', {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: ev.data.text },
          });
        } else if (ev.type === 'tool_call') {
          const tool = ev.data.tool;

          // Permission check
          if (!isYolo) {
            const decision = shouldRequireApproval(
              tool.name,
              tool.input || {},
              permissionRules,
              permissionMode,
              terminalPolicy,
            );
            if (decision === 'deny') {
              send('tool_result', {
                tool_use_id: tool.id,
                tool_name: tool.name,
                content: `Tool "${tool.name}" blocked by permission mode "${permissionMode}"`,
                is_error: true,
              });
              // For providers that run tools in-process (kiro), also send a
              // best-effort cancel so subsequent tool work in the same turn
              // is stopped. Kernel's cancelTurn is a no-op for providers
              // without an interrupt path. See agent-kernel.ts for honest
              // framing of what this can and can't undo.
              kernel.cancelTurn();
              return;
            }
            // 'ask' decision: emit approval_required for client to handle
            if (decision === 'ask') {
              send('approval_required', {
                tool_use_id: tool.id,
                tool_name: tool.name,
                tool_input: tool.input,
              });
            }
          }

          // Check allowed/disallowed tool lists from request
          if (disallowedTools?.includes(tool.name)) {
            send('tool_result', {
              tool_use_id: tool.id,
              tool_name: tool.name,
              content: `Tool "${tool.name}" is disallowed`,
              is_error: true,
            });
            return;
          }
          if (allowedTools?.length && !allowedTools.includes(tool.name)) {
            send('tool_result', {
              tool_use_id: tool.id,
              tool_name: tool.name,
              content: `Tool "${tool.name}" is not in the allowed list`,
              is_error: true,
            });
            return;
          }

          // Run preToolCall hooks
          const hookEnv = {
            TOOL_NAME: tool.name,
            TOOL_ARGS: JSON.stringify(tool.input || {}),
            SESSION_ID: conversationId,
            MODEL: effectiveModel || '',
            WORKSPACE_PATH: workspacePath,
          };
          if (!runHooks(hooks.preToolCall, hookEnv)) {
            send('tool_result', {
              tool_use_id: tool.id,
              tool_name: tool.name,
              content: `Tool "${tool.name}" blocked by preToolCall hook`,
              is_error: true,
            });
            return;
          }

          send('content_block_stop', {
            type: 'content_block_stop',
            index: 0,
            content_block: tool,
          });

          // Run postToolCall hooks (fire-and-forget)
          runHooks(hooks.postToolCall, hookEnv);
        } else if (ev.type === 'tool_result') {
          // Track file modifications for post-turn verification
          const toolName = ev.data?.tool_name;
          if ((toolName === 'Write' || toolName === 'Edit') && !ev.data?.is_error) {
            // Extract file path from the result content
            const content = ev.data?.content || '';
            const pathMatch = content.match(/(?:wrote|replaced).*?(?:to|in)\s+(.+?)$/m);
            if (pathMatch) turnVerifier.trackFileModification(pathMatch[1].trim());
          }
          send('tool_result', ev.data);
        } else if (ev.type === 'stop') {
          try {
            db.query(
              `INSERT INTO messages (id, conversation_id, role, content, timestamp, agent_handle) VALUES (?, ?, 'assistant', ?, ?, ?)`,
            ).run(
              assistantMsgId,
              conversationId,
              JSON.stringify([{ type: 'text', text: fullAssistantText }]),
              Date.now(),
              agent?.handle ?? null,
            );
            db.query('UPDATE conversations SET updated_at = ? WHERE id = ?').run(
              Date.now(),
              conversationId,
            );
            broadcastMessageUpdate(conversationId, assistantMsgId, 'assistant');
          } catch (e) {
            console.error('[stream] DB Error:', e);
          }

          // Cost tracking: calculate per-turn cost from usage
          const usage = ev.data?.usage;
          if (usage && effectiveModel) {
            turnCostUsd = calculateCost(
              effectiveModel,
              usage.input_tokens || 0,
              usage.output_tokens || 0,
            );
            send('turn_cost', {
              type: 'turn_cost',
              model: effectiveModel,
              inputTokens: usage.input_tokens || 0,
              outputTokens: usage.output_tokens || 0,
              costUsd: turnCostUsd,
            });
          }

          // Post-turn verification: check modified files at natural sync point
          // (Pi insight: only verify when the agent is done, never mid-edit)
          turnVerifier
            .verify()
            .then((verification) => {
              if (verification.modifiedFiles.length > 0) {
                send('verification', {
                  type: 'verification',
                  allPassed: verification.allPassed,
                  modifiedFiles: verification.modifiedFiles,
                  summary: verification.summary,
                  syntaxErrors: verification.syntaxResults
                    .filter((r) => !r.passed)
                    .map((r) => ({
                      file: r.filePath,
                      issues: r.issues,
                    })),
                  qualityErrors: verification.qualityResults
                    .filter((r) => !r.passed)
                    .map((r) => ({
                      name: r.name,
                      errorCount: r.errorCount,
                      output: r.output,
                    })),
                  duration: verification.duration,
                });
              }
              send('message_stop', { type: 'message_stop', usage: ev.data.usage });
              controller.close();
            })
            .catch(() => {
              // Don't let verification failures block the response
              send('message_stop', { type: 'message_stop', usage: ev.data.usage });
              controller.close();
            });
        } else if (ev.type === 'error') {
          send('error', { message: ev.data.message });
          controller.close();
        }
      });

      // Build history-aware prompt so follow-up messages have full context.
      // This is necessary because the kernel is stateless — each call starts fresh.
      let promptWithHistory = content;
      if (priorMessages.length > 0) {
        const lines: string[] = ['<conversation_history>'];
        for (const msg of priorMessages) {
          let text = '';
          try {
            const blocks = JSON.parse(msg.content) as Array<{ type: string; text?: string }>;
            text = blocks
              .filter((b) => b.type === 'text')
              .map((b) => b.text ?? '')
              .join('');
          } catch {
            text = msg.content;
          }
          // Truncate individual messages to keep prompt manageable
          const role = msg.role === 'user' ? 'User' : 'Assistant';
          lines.push(`${role}: ${text.length > 4000 ? text.slice(0, 4000) + '…' : text}`);
        }
        lines.push('</conversation_history>');
        lines.push('');
        lines.push(content);
        promptWithHistory = lines.join('\n');
      }

      // Build system prompt with project instructions and auto-memory
      let systemPrompt = conv.system_prompt || BASE_SYSTEM_PROMPT;
      if (projectInstructions) systemPrompt += `\n\n${projectInstructions}`;
      if (autoMemory) systemPrompt += `\n\n${autoMemory}`;

      // Inject KAIROS heartbeat into system prompt so LLM is context-aware
      if (FLAGS.KAIROS) {
        const activeDaemons = kairosDaemon.getAllDaemons().filter((d) => d.status === 'running');
        if (activeDaemons.length > 0) {
          const heartbeat = activeDaemons
            .map((d) => {
              const recent = d.recentActions
                .slice(-3)
                .map((a) => `  - ${a.description}`)
                .join('\n');
              return `[KAIROS ${d.id}] workspace=${d.workspacePath} actions=${d.totalActions} recent:\n${recent || '  (none)'}`;
            })
            .join('\n');
          systemPrompt += `\n\n<kairos_heartbeat>\n${heartbeat}\n</kairos_heartbeat>`;
        }
      }

      // Inject frustration context if detected
      if (frustrationContext) {
        systemPrompt += `\n\n${frustrationContext}`;
      }

      // Prepend auto-selected context
      const finalPrompt = contextPreamble ? contextPreamble + promptWithHistory : promptWithHistory;

      try {
        await kernel.run(finalPrompt, effectiveModel, systemPrompt, undefined, {
          attachments: reqAttachments,
        });
        // Run onEnd hooks
        runHooks(hooks.onEnd, {
          SESSION_ID: conversationId,
          MODEL: effectiveModel || '',
          WORKSPACE_PATH: workspacePath,
        });
      } catch (err: any) {
        // Run onError hooks
        runHooks(hooks.onError, {
          ERROR_MESSAGE: err.message,
          SESSION_ID: conversationId,
          MODEL: effectiveModel || '',
          WORKSPACE_PATH: workspacePath,
        });
        send('error', { message: err.message });
        controller.close();
      }
    },
  });

  return new Response(sseStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Session-Id': conversationId,
    },
  });
});

// Cancel active generation
app.post('/:conversationId/cancel', (c) => {
  return c.json({ ok: true });
});

// List active sessions (kernel-based; no persistent sessions)
app.get('/sessions', (c) => {
  return c.json({ ok: true, data: [] });
});

export { app as streamRoutes };
