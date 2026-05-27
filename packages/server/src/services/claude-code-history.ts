/**
 * claude-code-history.ts — read-only access to Claude Code's per-workspace
 * conversation history on disk.
 *
 * Layout (Claude Code 1.x+):
 *   ~/.claude/projects/<encoded-workspace>/<session-uuid>.jsonl
 *
 * Encoding: the workspace path is folded by replacing every `/` and `.`
 * with `-`. E.g. `/raid/parabun` → `-raid-parabun`,
 * `/home/nicole/.e-worktrees/foo` → `-home-nicole--e-worktrees-foo`.
 * The double-dash is real — both `/` and `.` map to `-` independently.
 *
 * Each `.jsonl` file is one event per line with discriminator `type`:
 *   - custom-title    { customTitle: string }   — the user-facing title
 *   - mode            { mode: string }
 *   - permission-mode { permissionMode: string }
 *   - system          { content: string }
 *   - user            { content: string | … }
 *   - assistant       { content: string | … }
 *   - attachment      { name, … }
 *   - file-history-snapshot { … }
 *
 * We surface only what's useful for browse + seed: the title, the
 * mtime, the message list (user/assistant text). Hook events, mode
 * changes, attachments, and file snapshots are intentionally dropped
 * from the read API — they're noise at the browse level.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';

/** Encode a filesystem workspace path the way Claude Code does on disk. */
export function encodeWorkspacePath(workspacePath: string): string {
  return workspacePath.replace(/[/.]/g, '-');
}

/** Where Claude Code stores per-project conversations. */
function projectDir(workspacePath: string): string {
  return join(homedir(), '.claude', 'projects', encodeWorkspacePath(workspacePath));
}

export interface CCConversationSummary {
  /** Session UUID (matches the basename of the .jsonl file). */
  id: string;
  /** Display title — `custom-title` event if present, else first user message preview. */
  title: string;
  /** mtime of the .jsonl file (epoch ms) — proxy for last-activity time. */
  updatedAt: number;
  /** Approximate message count (user + assistant events only). */
  messageCount: number;
}

export interface CCMessage {
  role: 'user' | 'assistant' | 'system';
  /** Plain-text rendering of the message content. */
  text: string;
  /** Optional timestamp if the source event carried one. */
  timestamp?: number;
}

export interface CCConversation {
  id: string;
  title: string;
  updatedAt: number;
  messages: CCMessage[];
}

/**
 * Convert a content value (which Claude Code may store as a plain string OR
 * an array of `{type:'text',text}` blocks OR something else for tool calls)
 * into a plain text string. Drops non-text blocks.
 */
function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (block && typeof block === 'object') {
        const b = block as Record<string, unknown>;
        if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
      }
    }
    return parts.join('');
  }
  return '';
}

function firstLineSnippet(text: string, max = 80): string {
  const firstLine = text.split('\n').find((l) => l.trim().length > 0) ?? '';
  const trimmed = firstLine.trim();
  return trimmed.length > max ? trimmed.slice(0, max - 1) + '…' : trimmed;
}

/**
 * Parse a single .jsonl conversation file. Tolerant of malformed lines —
 * they're skipped with a debug log rather than aborting the parse, since
 * Claude Code may append new event types we don't recognise.
 */
function parseConversation(filePath: string, id: string): CCConversation | null {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
  const stat = statSync(filePath);
  const lines = raw.split('\n');
  let title = '';
  const messages: CCMessage[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    let ev: any;
    try {
      ev = JSON.parse(line);
    } catch {
      continue; // skip malformed lines
    }
    if (ev?.type === 'custom-title' && typeof ev.customTitle === 'string') {
      title = ev.customTitle;
    } else if (ev?.type === 'user' || ev?.type === 'assistant' || ev?.type === 'system') {
      // Claude Code wraps the inner message under a `message` key in newer
      // formats; older formats put content at the top level. Handle both.
      const inner = ev.message ?? ev;
      const text = contentToText(inner?.content);
      if (text) {
        messages.push({
          role: ev.type,
          text,
          timestamp:
            typeof ev.timestamp === 'number'
              ? ev.timestamp
              : typeof ev.timestamp === 'string'
                ? Date.parse(ev.timestamp) || undefined
                : undefined,
        });
      }
    }
  }

  if (!title) {
    const firstUser = messages.find((m) => m.role === 'user');
    title = firstUser ? firstLineSnippet(firstUser.text) : id.slice(0, 8);
  }

  return {
    id,
    title: title || id.slice(0, 8),
    updatedAt: stat.mtimeMs,
    messages,
  };
}

/**
 * List Claude Code conversations for a workspace. Returns [] when the
 * directory doesn't exist (Claude Code never used here, or different home).
 * Sorted most-recently-updated first.
 */
export function listConversations(workspacePath: string): CCConversationSummary[] {
  const dir = projectDir(workspacePath);
  if (!existsSync(dir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return [];
  }
  const out: CCConversationSummary[] = [];
  for (const fname of entries) {
    const id = fname.replace(/\.jsonl$/, '');
    const filePath = join(dir, fname);
    const conv = parseConversation(filePath, id);
    if (!conv) continue;
    out.push({
      id: conv.id,
      title: conv.title,
      updatedAt: conv.updatedAt,
      messageCount: conv.messages.length,
    });
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

/** Fetch one full conversation. Returns null when not found. */
export function readConversation(workspacePath: string, sessionId: string): CCConversation | null {
  // Defensive: reject any sessionId with path separators so we never escape
  // the project directory. The encoded form is just hex + dashes (UUIDs).
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) return null;
  const filePath = join(projectDir(workspacePath), `${sessionId}.jsonl`);
  if (!existsSync(filePath)) return null;
  return parseConversation(filePath, sessionId);
}
