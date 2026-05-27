import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync, utimesSync, existsSync } from 'node:fs';
import { encodeWorkspacePath, listConversations, readConversation } from '../claude-code-history';

const WORKSPACE = '/tmp/e-cc-history-test';
const ENCODED = encodeWorkspacePath(WORKSPACE);
const PROJECT_DIR = join(homedir(), '.claude', 'projects', ENCODED);

function writeJsonl(sessionId: string, lines: object[]) {
  if (!existsSync(PROJECT_DIR)) mkdirSync(PROJECT_DIR, { recursive: true });
  const filePath = join(PROJECT_DIR, `${sessionId}.jsonl`);
  writeFileSync(filePath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return filePath;
}

beforeEach(() => {
  if (existsSync(PROJECT_DIR)) rmSync(PROJECT_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(PROJECT_DIR)) rmSync(PROJECT_DIR, { recursive: true });
});

describe('encodeWorkspacePath', () => {
  test('plain absolute path: slashes → dashes', () => {
    expect(encodeWorkspacePath('/raid/parabun')).toBe('-raid-parabun');
  });
  test('path with dots: dots → dashes (double-dash from /. neighbour is real)', () => {
    expect(encodeWorkspacePath('/home/nicole/.e-worktrees/abc')).toBe(
      '-home-nicole--e-worktrees-abc',
    );
  });
  test('no separators', () => {
    expect(encodeWorkspacePath('plain')).toBe('plain');
  });
});

describe('listConversations', () => {
  test('returns [] when the project dir does not exist', () => {
    expect(listConversations(WORKSPACE)).toEqual([]);
  });

  test('lists conversations sorted by mtime descending', () => {
    const a = writeJsonl('aaaa-1', [
      { type: 'custom-title', customTitle: 'first conv' },
      { type: 'user', message: { content: 'hi A' } },
      { type: 'assistant', message: { content: 'hello' } },
    ]);
    const b = writeJsonl('bbbb-2', [
      { type: 'custom-title', customTitle: 'second conv' },
      { type: 'user', message: { content: 'hi B' } },
    ]);
    // Bump b's mtime so it sorts first.
    const now = Date.now() / 1000;
    utimesSync(a, now - 60, now - 60);
    utimesSync(b, now, now);

    const list = listConversations(WORKSPACE);
    expect(list.map((c) => c.title)).toEqual(['second conv', 'first conv']);
    expect(list[0].id).toBe('bbbb-2');
    expect(list[1].messageCount).toBe(2); // user + assistant
  });

  test('falls back to first-user-message snippet when no custom-title', () => {
    writeJsonl('ccc', [
      { type: 'mode', mode: 'normal' },
      { type: 'user', message: { content: 'Refactor the AppShell to use a state machine' } },
    ]);
    const list = listConversations(WORKSPACE);
    expect(list[0].title).toBe('Refactor the AppShell to use a state machine');
  });
});

describe('readConversation', () => {
  test('returns null for a missing session id', () => {
    expect(readConversation(WORKSPACE, 'nope')).toBeNull();
  });

  test('rejects malformed ids (path-traversal defence)', () => {
    expect(readConversation(WORKSPACE, '../etc/passwd')).toBeNull();
    expect(readConversation(WORKSPACE, 'a/b')).toBeNull();
    expect(readConversation(WORKSPACE, '..')).toBeNull();
  });

  test('parses user/assistant messages with both string and block-array content', () => {
    writeJsonl('ddd', [
      { type: 'custom-title', customTitle: 'mixed' },
      { type: 'user', message: { content: 'plain string content' } },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'first part. ' },
            { type: 'tool_use', name: 'Bash', input: {} }, // dropped (non-text)
            { type: 'text', text: 'second part.' },
          ],
        },
      },
    ]);
    const conv = readConversation(WORKSPACE, 'ddd');
    expect(conv).not.toBeNull();
    expect(conv!.title).toBe('mixed');
    expect(conv!.messages).toEqual([
      { role: 'user', text: 'plain string content', timestamp: undefined },
      { role: 'assistant', text: 'first part. second part.', timestamp: undefined },
    ]);
  });

  test('tolerates a malformed line without aborting', () => {
    const filePath = writeJsonl('eee', [
      { type: 'custom-title', customTitle: 'tolerant' },
      { type: 'user', message: { content: 'before' } },
    ]);
    // Append a broken line plus a good one after it.
    const fs = require('node:fs');
    fs.appendFileSync(filePath, '{not json\n');
    fs.appendFileSync(
      filePath,
      JSON.stringify({ type: 'user', message: { content: 'after' } }) + '\n',
    );
    const conv = readConversation(WORKSPACE, 'eee');
    expect(conv!.messages.map((m) => m.text)).toEqual(['before', 'after']);
  });

  test('skips events without text content (attachments, file snapshots, etc.)', () => {
    writeJsonl('fff', [
      { type: 'user', message: { content: 'real one' } },
      { type: 'attachment', name: 'file.png' },
      { type: 'file-history-snapshot', snapshot: {} },
      { type: 'mode', mode: 'plan' },
    ]);
    const conv = readConversation(WORKSPACE, 'fff');
    expect(conv!.messages).toHaveLength(1);
    expect(conv!.messages[0].text).toBe('real one');
  });
});
