import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { claudeManager } from '../services/claude-process';
import { AgentKernel } from '../services/agent-kernel';
import { getDb } from '../db/database';
import { readFile, readdir } from 'fs/promises';
import { join, basename } from 'path';
import {
  detectPatterns,
  shouldProposeSkillOrRule,
  logLearning,
} from '../services/pattern-detection';
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

  // Build system prompt
  const memoryContext = getWorkspaceMemoryContext(conv.workspace_path);
  const rulesContext = await getActiveRulesContext(conv.workspace_path);
  let systemPrompt = BASE_SYSTEM_PROMPT + (conv.system_prompt ? '\n\n' + conv.system_prompt : '');

  if (conv.plan_mode) systemPrompt = PLAN_MODE_DIRECTIVE + systemPrompt;
  if (conv.permission_mode === 'teach') systemPrompt = TEACH_MODE_DIRECTIVE + systemPrompt;
  if (memoryContext) systemPrompt += memoryContext;
  if (rulesContext) systemPrompt += rulesContext;

  // Use the first-party AgentKernel for all providers
  const kernel = new AgentKernel({
    sessionId: conversationId,
    workspacePath: conv.workspace_path,
  });

  // Create an SSE stream that translates Kernel events into legacy GUI-compatible data
  const sseStream = new ReadableStream({
    async start(controller) {
      const send = (type: string, data: any) => {
        controller.enqueue(
          new TextEncoder().encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      kernel.on('event', (ev) => {
        if (ev.type === 'text') {
          send('content_block_delta', {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: ev.data.text },
          });
        } else if (ev.type === 'tool_call') {
          send('content_block_stop', {
            type: 'content_block_stop',
            index: 0,
            content_block: ev.data.tool,
          });
        } else if (ev.type === 'tool_result') {
          send('tool_result', ev.data);
        } else if (ev.type === 'stop') {
          send('message_stop', { type: 'message_stop', usage: ev.data.usage });
          controller.close();
        } else if (ev.type === 'error') {
          send('error', { message: ev.data.message });
          controller.close();
        }
      });

      try {
        await kernel.run(content, conv.model, systemPrompt);
      } catch (err: any) {
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
      'Access-Control-Expose-Headers': 'X-Session-Id',
    },
  });
});

// Cancel active generation
app.post('/:conversationId/cancel', (c) => {
  // TODO: Kernel-level cancellation
  return c.json({ ok: true });
});

// List active sessions
app.get('/sessions', (c) => {
  return c.json({ ok: true, data: [] });
});

export { app as streamRoutes };
