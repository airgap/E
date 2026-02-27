import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { claudeManager } from '../services/claude-process';
import { createOllamaStreamV2 } from '../services/ollama-provider-v2';
import { createBedrockStreamV2 } from '../services/bedrock-provider-v2';
import { createOpenAIStreamV2 } from '../services/openai-provider-v2';
import { createGeminiStreamV2 } from '../services/gemini-provider-v2';
import { getDb } from '../db/database';
import { readFile, readdir } from 'fs/promises';
import { join, basename } from 'path';
import {
  detectPatterns,
  shouldProposeSkillOrRule,
  logLearning,
} from '../services/pattern-detection';
import { resolveByToolCallId } from '../services/ask-user-bridge';
import { broadcastMessageUpdate } from './message-sync';
const app = new Hono();

const BASE_SYSTEM_PROMPT = `You are E, an expert AI coding assistant embedded directly inside the user's development environment.

## Your context

You run inside E — a desktop IDE built around you. You have full access to the user's workspace:
- **File tree & editor** — you can read, write, and diff any file
- **Terminal** — you can run shell commands, tests, and build scripts
- **Git** — you can read history, diffs, branches, and commits
- **LSP** — you have access to symbols, types, and diagnostics
- **Search** — you can ripgrep across the entire codebase instantly

The user sees your thinking steps and tool calls in real time as you work. Be transparent — show your reasoning, don't hide uncertainty.

## Self-Improving Skills System

You have the ability to learn from recurring patterns and propose reusable skills or rules:

- **When you notice a pattern** you've applied 3+ times (refactoring, command sequences, workflows), you can propose creating a skill or rule by leaving an agent note with category "skill-proposal"
- **Skill proposals should include**: a clear name, rationale explaining why it's useful, and the skill/rule content
- **Example scenarios**: repeated refactoring patterns, common command sequences, file operation workflows, debugging procedures, testing patterns
- **Be thoughtful**: only propose skills that are genuinely reusable, not one-off fixes

## How to behave

- **Be direct and precise.** Skip filler phrases. Get to the answer.
- **Prefer doing over explaining.** If you can fix it, fix it. Explain after.
- **Respect existing conventions.** Read the code before writing new code. Match the style, patterns, and idioms already in use.
- **Think in diffs, not rewrites.** Make the smallest correct change. Don't refactor what wasn't asked.
- **Be honest about confidence.** Say when something is uncertain, untested, or has tradeoffs.
- **One thing at a time.** Complete the current task fully before suggesting follow-ups.
- **Learn and adapt.** Notice patterns in your work and propose skills when you see opportunities for automation.

## Output style

- Use markdown. Code in fenced blocks with language tags.
- File paths in backticks. Symbol names in backticks.
- Keep prose tight. Bullet points over paragraphs where it aids scanning.
- For multi-step work, number the steps so the user can track progress.

`;

const PLAN_MODE_DIRECTIVE = `## Plan Mode

You are in PLAN MODE. Do NOT write code or make file changes. Instead:

1. **Analyze** the request and ask clarifying questions if the intent is ambiguous
2. **Break down** the work into clear, numbered implementation steps
3. **Identify** key files that need to change and what changes are needed
4. **Flag risks** — edge cases, breaking changes, dependencies, or unknowns
5. **Estimate scope** — is this a small tweak or a multi-file refactor?

Present your plan in clean markdown. Use headers, bullet points, and code references (backtick file paths and symbol names). Do NOT produce code blocks with full implementations — keep it at the planning level.

When the user is satisfied with the plan, they will turn off plan mode and ask you to execute.

`;

const TEACH_MODE_DIRECTIVE = `## Teach Me Mode

You are in TEACH ME mode. Your goal is to help the user LEARN, not just get answers.

Rules:
1. Do NOT give direct answers or write code immediately
2. Instead, ask 2-3 probing questions to understand what they already know
3. Give hints and let the user attempt the solution first
4. When the user makes an attempt, review it and give targeted feedback
5. Use the Socratic method: guide with questions like "What do you think would happen if...?", "Have you considered...?", "Why do you think that is?"
6. Only provide a full solution AFTER the user has genuinely tried and is stuck
7. Celebrate their correct reasoning enthusiastically
8. Keep explanations concise — one concept at a time

Start every response by assessing what the user knows, then guide them to the answer.

`;

function getWorkspaceMemoryContext(workspacePath: string | null): string {
  if (!workspacePath) return '';
  try {
    const db = getDb();
    const rows = db
      .query(
        `SELECT * FROM workspace_memories WHERE workspace_path = ? AND confidence >= 0.3 ORDER BY category, times_seen DESC, confidence DESC LIMIT 100`,
      )
      .all(workspacePath) as any[];
    if (rows.length === 0) return '';

    const grouped: Record<string, string[]> = {};
    for (const row of rows) {
      if (!grouped[row.category]) grouped[row.category] = [];
      grouped[row.category].push(`- ${row.key}: ${row.content}`);
    }
    const labels: Record<string, string> = {
      convention: 'Coding Conventions',
      decision: 'Architecture Decisions',
      preference: 'User Preferences',
      pattern: 'Common Patterns',
      context: 'Workspace Context',
    };
    let ctx = '\n\n## Workspace Memory\n\n';
    for (const [cat, items] of Object.entries(grouped)) {
      ctx += `### ${labels[cat] || cat}\n${items.join('\n')}\n\n`;
    }
    return ctx.trimEnd();
  } catch {
    return '';
  }
}

/** Compatible rule files from other tools */
const COMPAT_RULE_FILES = [
  '.cursorrules',
  '.erules',
  'AGENTS.md',
  '.github/copilot-instructions.md',
];

/**
 * Get the content of all active rules for injection into the system prompt.
 * Active rules are those NOT marked as 'on-demand' in rules_metadata.
 */
async function getActiveRulesContext(workspacePath: string | null): Promise<string> {
  if (!workspacePath) return '';
  try {
    const db = getDb();
    // Get all file paths with explicit 'on-demand' mode
    const onDemandRows = db
      .query("SELECT file_path FROM rules_metadata WHERE workspace_path = ? AND mode = 'on-demand'")
      .all(workspacePath) as Array<{ file_path: string }>;
    const onDemandPaths = new Set(onDemandRows.map((r) => r.file_path));

    const activeContents: string[] = [];

    // Scan .claude/rules/*.md and .e/rules/*.md
    for (const rulesParent of ['.claude', '.e']) {
      const rulesDir = join(workspacePath, rulesParent, 'rules');
      try {
        const entries = await readdir(rulesDir, { recursive: true });
        for (const entry of entries) {
          if (!String(entry).endsWith('.md')) continue;
          const full = join(rulesDir, String(entry));
          if (onDemandPaths.has(full)) continue;
          try {
            const content = await readFile(full, 'utf-8');
            if (content.trim()) {
              activeContents.push(`### Rule: ${String(entry)}\n${content.trim()}`);
            }
          } catch {
            // Skip unreadable files
          }
        }
      } catch {
        // Directory doesn't exist
      }
    }

    // Scan compatible files that are active
    for (const p of COMPAT_RULE_FILES) {
      const full = join(workspacePath, p);
      if (onDemandPaths.has(full)) continue;
      try {
        const content = await readFile(full, 'utf-8');
        if (content.trim()) {
          activeContents.push(`### Rule: ${basename(p)}\n${content.trim()}`);
        }
      } catch {
        // Skip
      }
    }

    if (activeContents.length === 0) return '';
    return `\n\n## Active Rules\n\n${activeContents.join('\n\n')}`;
  } catch {
    return '';
  }
}

async function getSessionOpts(conv: any) {
  let allowedTools: string[] | undefined;
  let disallowedTools: string[] | undefined;
  try {
    if (conv.allowed_tools) allowedTools = JSON.parse(conv.allowed_tools);
  } catch {}
  try {
    if (conv.disallowed_tools) disallowedTools = JSON.parse(conv.disallowed_tools);
  } catch {}

  // Build system prompt (outermost → innermost):
  //   [PLAN/TEACH directive] + [user system prompt] + [base prompt] + [workspace memories] + [active rules]
  const memoryContext = getWorkspaceMemoryContext(conv.workspace_path);
  const rulesContext = await getActiveRulesContext(conv.workspace_path);
  let systemPrompt = BASE_SYSTEM_PROMPT + (conv.system_prompt ? '\n\n' + conv.system_prompt : '');

  if (conv.plan_mode) {
    systemPrompt = PLAN_MODE_DIRECTIVE + systemPrompt;
  }

  if (conv.permission_mode === 'teach') {
    systemPrompt = TEACH_MODE_DIRECTIVE + systemPrompt;
  }

  if (memoryContext) {
    systemPrompt = systemPrompt + memoryContext;
  }

  if (rulesContext) {
    systemPrompt = systemPrompt + rulesContext;
  }

  return {
    model: conv.model,
    systemPrompt: systemPrompt || undefined,
    workspacePath: conv.workspace_path,
    effort: conv.effort,
    maxBudgetUsd: conv.max_budget_usd,
    maxTurns: conv.max_turns,
    allowedTools,
    disallowedTools,
    resumeSessionId: conv.cli_session_id || undefined,
  };
}

// Start or continue a streaming chat session
app.post('/:conversationId', async (c) => {
  const conversationId = c.req.param('conversationId');
  const body = await c.req.json();
  const { content } = body;

  const db = getDb();
  const conv = db.query('SELECT * FROM conversations WHERE id = ?').get(conversationId) as any;
  if (!conv) return c.json({ ok: false, error: 'Conversation not found' }, 404);

  // Build user message content blocks (text + optional images from attachments)
  const userContentBlocks: any[] = [{ type: 'text', text: content }];
  const attachments = body.attachments || [];
  for (const att of attachments) {
    if (att.type === 'image' && att.content && att.mimeType) {
      userContentBlocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: att.mimeType,
          data: att.content,
        },
      });
    }
  }

  // Save user message to DB
  const userMsgId = nanoid();
  db.query(
    `
    INSERT INTO messages (id, conversation_id, role, content, timestamp)
    VALUES (?, ?, 'user', ?, ?)
  `,
  ).run(userMsgId, conversationId, JSON.stringify(userContentBlocks), Date.now());

  // Broadcast user message update for cross-device sync
  broadcastMessageUpdate(conversationId, userMsgId, 'user');

  // Run pattern detection in background after message is sent
  // This happens asynchronously and won't block the response stream
  const workspacePath = conv.workspace_path;
  if (workspacePath) {
    // Run pattern detection after a short delay to let the assistant response complete
    setTimeout(async () => {
      try {
        // Detect patterns in the conversation
        const patterns = await detectPatterns(workspacePath, conversationId);

        // Check if any patterns should trigger a proposal
        for (const pattern of patterns) {
          const shouldPropose = shouldProposeSkillOrRule(pattern);
          if (shouldPropose && !pattern.proposalCreated) {
            // Generate a skill or rule proposal
            const { generateProposal } = await import('../services/proposal-generator');
            const proposalType = determineProposalType(pattern);
            const proposal = await generateProposal(pattern, proposalType);

            // Create an agent note for the proposal
            const noteId = nanoid(12);
            const now = Date.now();
            db.query(
              `INSERT INTO agent_notes (id, workspace_path, conversation_id, title, content, category, status, metadata, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, 'skill-proposal', 'unread', ?, ?, ?)`,
            ).run(
              noteId,
              workspacePath,
              conversationId,
              `New ${proposalType} proposal: ${proposal.name}`,
              `## Pattern Detected\n\n${pattern.description}\n\n**Occurrences:** ${pattern.occurrences}\n**Confidence:** ${(pattern.confidence * 100).toFixed(0)}%\n\n## Proposed ${proposalType === 'skill' ? 'Skill' : 'Rule'}\n\n${proposal.content}\n\n---\n\nReview and approve this proposal in the Learning panel to automatically create the ${proposalType} file.`,
              JSON.stringify({
                proposalId: proposal.id,
                patternId: pattern.id,
                proposalType,
                confidence: pattern.confidence,
              }),
              now,
              now,
            );

            // Log the pattern detection as a learning event
            logLearning(
              workspacePath,
              `Created ${proposalType} proposal: ${proposal.name}`,
              'proposal-created',
              proposal.id,
            );
          }
        }
      } catch (err) {
        console.error('[pattern-detection] Failed to analyze patterns:', err);
      }
    }, 5000); // Wait 5 seconds for response to complete
  }

  // Helper function to determine if a pattern should be a skill or rule
  function determineProposalType(pattern: any): 'skill' | 'rule' {
    // Workflows, problem-solving, and tool-usage become skills
    // Refactoring, file patterns, and command sequences become rules
    const skillTypes = ['workflow', 'problem-solving', 'tool-usage'];
    return skillTypes.includes(pattern.patternType) ? 'skill' : 'rule';
  }

  // Get active rules context once for all provider branches
  const activeRulesCtx = await getActiveRulesContext(conv.workspace_path);

  // Route to Ollama provider for local models (prefixed with "ollama:")
  const isOllama = conv.model?.startsWith('ollama:');
  if (isOllama) {
    const ollamaModel = conv.model.replace('ollama:', '');
    let ollamaSystemPrompt =
      BASE_SYSTEM_PROMPT + (conv.system_prompt ? '\n\n' + conv.system_prompt : '');
    if (conv.plan_mode) {
      ollamaSystemPrompt = PLAN_MODE_DIRECTIVE + ollamaSystemPrompt;
    }
    if (activeRulesCtx) {
      ollamaSystemPrompt = ollamaSystemPrompt + activeRulesCtx;
    }

    // Get allowed/disallowed tools
    let allowedTools: string[] | undefined;
    let disallowedTools: string[] | undefined;
    try {
      if (conv.allowed_tools) allowedTools = JSON.parse(conv.allowed_tools);
      if (conv.disallowed_tools) disallowedTools = JSON.parse(conv.disallowed_tools);
    } catch {}

    // Extract images from body if provided
    const images = body.images || [];

    const rawStream = createOllamaStreamV2({
      model: ollamaModel,
      content,
      conversationId,
      systemPrompt: ollamaSystemPrompt || undefined,
      workspacePath: conv.workspace_path,
      allowedTools,
      disallowedTools,
      images,
    });
    // Wrap with session for reconnection support on page reload
    const ollamaSessionId = claudeManager.createLightweightSession(conversationId);
    const stream = claudeManager.wrapProviderStream(ollamaSessionId, rawStream);
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        'X-Session-Id': ollamaSessionId,
        'Access-Control-Expose-Headers': 'X-Session-Id',
      },
    });
  }

  // Route to OpenAI provider (prefixed with "openai:")
  const isOpenAI = conv.model?.startsWith('openai:');
  if (isOpenAI) {
    const openaiModel = conv.model.replace('openai:', '');
    let openaiSystemPrompt =
      BASE_SYSTEM_PROMPT + (conv.system_prompt ? '\n\n' + conv.system_prompt : '');
    if (conv.plan_mode) {
      openaiSystemPrompt = PLAN_MODE_DIRECTIVE + openaiSystemPrompt;
    }
    if (activeRulesCtx) {
      openaiSystemPrompt = openaiSystemPrompt + activeRulesCtx;
    }
    let allowedTools: string[] | undefined;
    let disallowedTools: string[] | undefined;
    try {
      if (conv.allowed_tools) allowedTools = JSON.parse(conv.allowed_tools);
      if (conv.disallowed_tools) disallowedTools = JSON.parse(conv.disallowed_tools);
    } catch {}
    const images = body.images || [];
    const rawStream = createOpenAIStreamV2({
      model: openaiModel,
      content,
      conversationId,
      systemPrompt: openaiSystemPrompt || undefined,
      workspacePath: conv.workspace_path,
      allowedTools,
      disallowedTools,
      images,
    });
    // Wrap with session for reconnection support on page reload
    const openaiSessionId = claudeManager.createLightweightSession(conversationId);
    const stream = claudeManager.wrapProviderStream(openaiSessionId, rawStream);
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        'X-Session-Id': openaiSessionId,
        'Access-Control-Expose-Headers': 'X-Session-Id',
      },
    });
  }

  // Route to Google Gemini provider (prefixed with "gemini:")
  const isGemini = conv.model?.startsWith('gemini:');
  if (isGemini) {
    const geminiModel = conv.model.replace('gemini:', '');
    let geminiSystemPrompt =
      BASE_SYSTEM_PROMPT + (conv.system_prompt ? '\n\n' + conv.system_prompt : '');
    if (conv.plan_mode) {
      geminiSystemPrompt = PLAN_MODE_DIRECTIVE + geminiSystemPrompt;
    }
    if (activeRulesCtx) {
      geminiSystemPrompt = geminiSystemPrompt + activeRulesCtx;
    }
    let allowedTools: string[] | undefined;
    let disallowedTools: string[] | undefined;
    try {
      if (conv.allowed_tools) allowedTools = JSON.parse(conv.allowed_tools);
      if (conv.disallowed_tools) disallowedTools = JSON.parse(conv.disallowed_tools);
    } catch {}
    const images = body.images || [];
    const rawStream = createGeminiStreamV2({
      model: geminiModel,
      content,
      conversationId,
      systemPrompt: geminiSystemPrompt || undefined,
      workspacePath: conv.workspace_path,
      allowedTools,
      disallowedTools,
      images,
    });
    // Wrap with session for reconnection support on page reload
    const geminiSessionId = claudeManager.createLightweightSession(conversationId);
    const stream = claudeManager.wrapProviderStream(geminiSessionId, rawStream);
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        'X-Session-Id': geminiSessionId,
        'Access-Control-Expose-Headers': 'X-Session-Id',
      },
    });
  }

  // Route to Bedrock provider for AWS Bedrock models (prefixed with "bedrock:")
  const isBedrock = conv.model?.startsWith('bedrock:');
  if (isBedrock) {
    const bedrockModel = conv.model.replace('bedrock:', '');
    let bedrockSystemPrompt =
      BASE_SYSTEM_PROMPT + (conv.system_prompt ? '\n\n' + conv.system_prompt : '');
    if (conv.plan_mode) {
      bedrockSystemPrompt = PLAN_MODE_DIRECTIVE + bedrockSystemPrompt;
    }
    if (activeRulesCtx) {
      bedrockSystemPrompt = bedrockSystemPrompt + activeRulesCtx;
    }

    // Get allowed/disallowed tools
    let allowedTools: string[] | undefined;
    let disallowedTools: string[] | undefined;
    try {
      if (conv.allowed_tools) allowedTools = JSON.parse(conv.allowed_tools);
      if (conv.disallowed_tools) disallowedTools = JSON.parse(conv.disallowed_tools);
    } catch {}

    // Extract images from body if provided
    const images = body.images || [];

    const rawStream = createBedrockStreamV2({
      model: bedrockModel,
      content,
      conversationId,
      systemPrompt: bedrockSystemPrompt || undefined,
      workspacePath: conv.workspace_path,
      allowedTools,
      disallowedTools,
      permissionMode: conv.permission_mode,
      images,
    });
    // Wrap with session for reconnection support on page reload
    const bedrockSessionId = claudeManager.createLightweightSession(conversationId);
    const stream = claudeManager.wrapProviderStream(bedrockSessionId, rawStream);
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        'X-Session-Id': bedrockSessionId,
        'Access-Control-Expose-Headers': 'X-Session-Id',
      },
    });
  }

  let sessionId = c.req.header('x-session-id') || null;

  // Validate that a reused session belongs to this conversation.
  // If the client sends a stale session ID from a previous conversation,
  // discard it and create a fresh session to prevent the assistant
  // response from being persisted to the wrong conversation.
  if (sessionId) {
    const existing = claudeManager.getSession(sessionId);
    if (!existing || existing.conversationId !== conversationId) {
      sessionId = null;
    }
  }

  try {
    if (!sessionId) {
      sessionId = await claudeManager.createSession(conversationId, await getSessionOpts(conv));
    }

    // If this is the first turn after autocompaction (no cli_session_id, has compact_summary),
    // inject the summary into the message so the fresh CLI session has full context.
    // Clear the summary afterwards — it's a one-shot injection.
    let messageContent = content;

    // For Claude CLI path, note any image attachments since the CLI doesn't support multimodal
    const imageAttachments = (body.attachments || []).filter((a: any) => a.type === 'image');
    if (imageAttachments.length > 0) {
      const imageNames = imageAttachments.map((a: any) => a.name).join(', ');
      messageContent = `[${imageAttachments.length} image(s) attached: ${imageNames} — images are saved in the conversation but cannot be processed via the CLI. Use a vision-capable model like OpenAI GPT-4o, Gemini, or Bedrock Claude for image analysis.]\n\n${messageContent}`;
    }

    if (!conv.cli_session_id && conv.compact_summary) {
      const summaryFrame =
        `This session is being continued from a previous conversation that ran out of context. ` +
        `The summary below covers the earlier portion of the conversation.\n\n${conv.compact_summary}\n\n` +
        `Please continue the conversation from where we left off without asking the user any further questions.\n\n` +
        `User's next message: ${content}`;
      messageContent = summaryFrame;
      // Clear after use — don't inject again on subsequent turns
      db.query('UPDATE conversations SET compact_summary = NULL WHERE id = ?').run(conversationId);
    }

    const stream = await claudeManager.sendMessage(sessionId, messageContent);

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        'X-Session-Id': sessionId,
        'Access-Control-Expose-Headers': 'X-Session-Id',
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[stream] Failed to start:', msg);
    return c.json({ ok: false, error: msg }, 500);
  }
});

// Cancel active generation
app.post('/:conversationId/cancel', (c) => {
  const sessionId = c.req.header('x-session-id');
  if (sessionId) {
    claudeManager.cancelGeneration(sessionId);
  }
  return c.json({ ok: true });
});

// Submit answer to an AskUserQuestion prompt
app.post('/:conversationId/answer', async (c) => {
  const sessionId = c.req.header('x-session-id');
  if (!sessionId) return c.json({ ok: false, error: 'Missing session ID' }, 400);

  const body = await c.req.json();
  const { toolCallId, answers } = body;
  if (!toolCallId || !answers) {
    return c.json({ ok: false, error: 'Missing toolCallId or answers' }, 400);
  }

  // Try resolving via the ask-user bridge first (MCP server path).
  // The MCP server is long-polling for the answer — resolving unblocks it.
  if (resolveByToolCallId(toolCallId, answers)) {
    return c.json({ ok: true });
  }

  // Fall back to writing directly to CLI stdin (legacy/direct path)
  const answerPayload = JSON.stringify({ answers }) + '\n';
  const written = claudeManager.writeStdin(sessionId, answerPayload);
  if (!written) {
    return c.json({ ok: false, error: 'Failed to write to CLI stdin' }, 500);
  }

  return c.json({ ok: true });
});

// Queue a nudge to be injected into the agent context on its next turn
// This does NOT stop the current stream.
app.post('/:conversationId/nudge', async (c) => {
  const conversationId = c.req.param('conversationId');
  const sessionId = c.req.header('x-session-id');
  if (!sessionId) return c.json({ ok: false, error: 'Missing session ID' }, 400);

  const body = await c.req.json();
  const { content } = body;
  if (!content || typeof content !== 'string' || !content.trim()) {
    return c.json({ ok: false, error: 'Missing nudge content' }, 400);
  }

  const db = getDb();
  const conv = db.query('SELECT id FROM conversations WHERE id = ?').get(conversationId) as any;
  if (!conv) return c.json({ ok: false, error: 'Conversation not found' }, 404);

  // Save the nudge as a distinct message in the conversation history
  const nudgeMsgId = nanoid();
  db.query(
    `INSERT INTO messages (id, conversation_id, role, content, timestamp)
     VALUES (?, ?, 'user', ?, ?)`,
  ).run(
    nudgeMsgId,
    conversationId,
    JSON.stringify([{ type: 'nudge', text: content.trim() }]),
    Date.now(),
  );

  // Queue it for injection on the next agent turn (non-blocking)
  const queued = claudeManager.queueNudge(sessionId, content.trim());

  return c.json({ ok: true, queued, messageId: nudgeMsgId });
});

// List active sessions (never cache — must reflect real-time state)
app.get('/sessions', (c) => {
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate');
  return c.json({ ok: true, data: claudeManager.listSessions() });
});

// Reconnect to an in-flight or just-completed stream.
// Replays all buffered SSE events and continues streaming if still active.
app.get('/reconnect/:sessionId', (c) => {
  const sessionId = c.req.param('sessionId');
  const session = claudeManager.getSession(sessionId);
  if (!session) {
    return c.json({ ok: false, error: 'No active or recent stream for this session' }, 404);
  }

  const stream = claudeManager.reconnectStream(sessionId);
  if (!stream) {
    return c.json({ ok: false, error: 'No active or recent stream for this session' }, 404);
  }

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Session-Id': sessionId,
      'Access-Control-Expose-Headers': 'X-Session-Id',
    },
  });
});

export { app as streamRoutes };
