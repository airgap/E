import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { getDb } from '../db/database';

export const scanRoutes = new Hono();

// Comment types and their priority mappings
const COMMENT_TYPES = ['TODO', 'FIXME', 'HACK', 'BUG', 'XXX', 'OPTIMIZE', 'NOTE'] as const;
type CommentType = (typeof COMMENT_TYPES)[number];

const PRIORITY_MAP: Record<CommentType, string> = {
  FIXME: 'high',
  BUG: 'high',
  TODO: 'medium',
  HACK: 'low',
  OPTIMIZE: 'low',
  NOTE: 'low',
  XXX: 'low',
};

const DEFAULT_EXTENSIONS = [
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'c',
  'cpp',
  'h',
  'hpp',
  'cs',
  'swift',
  'php',
  'vue',
  'svelte',
  'sh',
  'bash',
  'zsh',
  'css',
  'scss',
  'less',
  'html',
  'xml',
  'yaml',
  'yml',
  'toml',
];

const EXCLUDE_DIRS = ['node_modules', '.git', 'dist', 'build', '.svelte-kit'];

interface TodoMatch {
  file: string;
  line: number;
  type: CommentType;
  text: string;
  context: string[];
  suggestedTitle: string;
  suggestedDescription: string;
}

function extractTypeAndText(content: string): { type: CommentType; text: string } | null {
  // Match comment prefixes: //, #, /*, <!--
  // Then optional whitespace, then the keyword, then optional colon/space and the message
  const pattern = /(?:\/\/|#|\/\*|<!--)\s*(TODO|FIXME|HACK|BUG|XXX|OPTIMIZE|NOTE)[:\s]\s*(.*)/i;
  const match = content.match(pattern);
  if (!match) {
    // Fallback: look for keyword anywhere in the line
    const fallback = content.match(/(TODO|FIXME|HACK|BUG|XXX|OPTIMIZE|NOTE)[:\s]\s*(.*)/i);
    if (!fallback) return null;
    return {
      type: fallback[1].toUpperCase() as CommentType,
      text: fallback[2].replace(/\*\/|-->/, '').trim(),
    };
  }
  return {
    type: match[1].toUpperCase() as CommentType,
    text: match[2].replace(/\*\/|-->/, '').trim(),
  };
}

function generateSuggestedTitle(type: CommentType, text: string, file: string): string {
  if (text && text.length > 0) {
    // Truncate to a reasonable title length
    const truncated = text.length > 80 ? text.slice(0, 77) + '...' : text;
    return `[${type}] ${truncated}`;
  }
  const filename = file.split('/').pop() ?? file;
  return `[${type}] Issue in ${filename}`;
}

function generateSuggestedDescription(
  type: CommentType,
  text: string,
  file: string,
  line: number,
  context: string[],
): string {
  const parts: string[] = [];
  parts.push(`**Source:** \`${file}\` (line ${line})`);
  parts.push(`**Type:** ${type}`);
  if (text) {
    parts.push(`**Comment:** ${text}`);
  }
  if (context.length > 0) {
    parts.push('**Context:**');
    parts.push('```');
    parts.push(...context);
    parts.push('```');
  }
  return parts.join('\n');
}

async function runRipgrep(
  workspacePath: string,
  extensions: string[],
  maxResults: number,
): Promise<string[]> {
  const rgPattern = '(TODO|FIXME|HACK|BUG|XXX|OPTIMIZE|NOTE)[:\\s]';

  const args: string[] = [
    'rg',
    '--line-number',
    '--no-heading',
    '--with-filename',
    '--case-insensitive',
    '--max-count',
    String(maxResults),
  ];

  // Add extension filters
  for (const ext of extensions) {
    args.push('--glob', `*.${ext}`);
  }

  // Exclude directories
  for (const dir of EXCLUDE_DIRS) {
    args.push('--glob', `!${dir}/**`);
  }

  args.push(rgPattern, workspacePath);

  const proc = Bun.spawn(args, {
    cwd: workspacePath,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stdout = await new Response(proc.stdout).text();
  await proc.exited;

  // rg returns exit code 1 when no matches found, which is fine
  if (stdout.trim() === '') return [];

  return stdout.trim().split('\n').filter(Boolean);
}

async function getContextLines(file: string, targetLine: number): Promise<string[]> {
  try {
    const text = await Bun.file(file).text();
    const lines = text.split('\n');
    const start = Math.max(0, targetLine - 3);
    const end = Math.min(lines.length, targetLine + 2);
    return lines.slice(start, end).map((l, i) => {
      const lineNum = start + i + 1;
      const marker = lineNum === targetLine ? '>' : ' ';
      return `${marker} ${lineNum}: ${l}`;
    });
  } catch {
    return [];
  }
}

function parseRgLine(rgLine: string): { file: string; line: number; content: string } | null {
  // rg output format: /path/to/file:linenum:content
  // File paths may contain colons on Windows but we handle POSIX here.
  // Use a regex that accounts for absolute paths.
  const match = rgLine.match(/^(.+?):(\d+):(.*)$/);
  if (!match) return null;
  return {
    file: match[1],
    line: parseInt(match[2], 10),
    content: match[3],
  };
}

// POST /scan/todos
scanRoutes.post('/scan/todos', async (c) => {
  let body: {
    workspacePath: string;
    prdId?: string;
    extensions?: string[];
    maxResults?: number;
  };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const { workspacePath, extensions = DEFAULT_EXTENSIONS, maxResults = 500 } = body;

  if (!workspacePath) {
    return c.json({ ok: false, error: 'workspacePath is required' }, 400);
  }

  let rgLines: string[];
  try {
    rgLines = await runRipgrep(workspacePath, extensions, maxResults);
  } catch (err: any) {
    return c.json(
      { ok: false, error: `Failed to run ripgrep: ${err?.message ?? String(err)}` },
      500,
    );
  }

  const todos: TodoMatch[] = [];

  for (const rgLine of rgLines) {
    const parsed = parseRgLine(rgLine);
    if (!parsed) continue;

    const extracted = extractTypeAndText(parsed.content);
    if (!extracted) continue;

    const context = await getContextLines(parsed.file, parsed.line);

    const todo: TodoMatch = {
      file: parsed.file,
      line: parsed.line,
      type: extracted.type,
      text: extracted.text,
      context,
      suggestedTitle: generateSuggestedTitle(extracted.type, extracted.text, parsed.file),
      suggestedDescription: generateSuggestedDescription(
        extracted.type,
        extracted.text,
        parsed.file,
        parsed.line,
        context,
      ),
    };

    todos.push(todo);
  }

  return c.json({ ok: true, data: { todos, total: todos.length } });
});

// POST /scan/todos/import
scanRoutes.post('/scan/todos/import', async (c) => {
  let body: {
    workspacePath: string;
    todos: Array<{
      file: string;
      line: number;
      type: string;
      text: string;
      suggestedTitle: string;
      suggestedDescription: string;
    }>;
    prdId?: string;
  };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const { workspacePath, todos, prdId } = body;

  if (!workspacePath) {
    return c.json({ ok: false, error: 'workspacePath is required' }, 400);
  }

  if (!Array.isArray(todos) || todos.length === 0) {
    return c.json({ ok: false, error: 'todos must be a non-empty array' }, 400);
  }

  const db = getDb();
  const storyIds: string[] = [];
  const now = new Date().toISOString();

  const insert = db.prepare(`
    INSERT INTO prd_stories (
      id, prd_id, workspace_path, title, description, acceptance_criteria,
      priority, depends_on, dependency_reasons, status, attempts, max_attempts,
      learnings, sort_order, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, '[]', ?, '[]', '{}', 'pending', 0, 3, '[]', ?, ?, ?)
  `);

  const importMany = db.transaction(() => {
    for (let i = 0; i < todos.length; i++) {
      const todo = todos[i];
      const id = nanoid(12);
      const type = (todo.type?.toUpperCase() ?? 'TODO') as CommentType;
      const priority = PRIORITY_MAP[type] ?? 'medium';

      const title = todo.suggestedTitle || `[${type}] ${todo.file}:${todo.line}`;
      const description =
        todo.suggestedDescription ||
        `**Source:** \`${todo.file}\` (line ${todo.line})\n**Type:** ${type}\n**Comment:** ${todo.text}`;

      insert.run(
        id,
        prdId ?? null,
        workspacePath,
        title,
        description,
        priority,
        i, // sort_order
        now,
        now,
      );

      storyIds.push(id);
    }
  });

  try {
    importMany();
  } catch (err: any) {
    return c.json(
      { ok: false, error: `Failed to import todos: ${err?.message ?? String(err)}` },
      500,
    );
  }

  return c.json({ ok: true, data: { created: storyIds.length, storyIds } });
});

// GET /scan/todos/count
scanRoutes.get('/scan/todos/count', async (c) => {
  const workspacePath = c.req.query('workspacePath');

  if (!workspacePath) {
    return c.json({ ok: false, error: 'workspacePath query parameter is required' }, 400);
  }

  let rgLines: string[];
  try {
    // Use a high limit just for counting
    rgLines = await runRipgrep(workspacePath, DEFAULT_EXTENSIONS, 10000);
  } catch (err: any) {
    return c.json(
      { ok: false, error: `Failed to run ripgrep: ${err?.message ?? String(err)}` },
      500,
    );
  }

  const byType: Record<string, number> = {};
  let count = 0;

  for (const rgLine of rgLines) {
    const parsed = parseRgLine(rgLine);
    if (!parsed) continue;

    const extracted = extractTypeAndText(parsed.content);
    if (!extracted) continue;

    count++;
    byType[extracted.type] = (byType[extracted.type] ?? 0) + 1;
  }

  return c.json({ ok: true, data: { count, byType } });
});
