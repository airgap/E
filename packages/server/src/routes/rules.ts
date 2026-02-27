import { Hono } from 'hono';
import { readFile, writeFile, readdir, stat, mkdir } from 'fs/promises';
import { join, basename, relative } from 'path';
import { nanoid } from 'nanoid';
import { getDb } from '../db/database';
import type { RuleMode } from '@e/shared';

const app = new Hono();

/** Compatible rule files from other tools */
const COMPAT_FILES = ['.cursorrules', '.erules', 'AGENTS.md', '.github/copilot-instructions.md'];

/**
 * GET /api/rules?workspacePath=...
 * List all rule files with their metadata (mode: active/on-demand).
 * Discovers .claude/rules/*.md, CLAUDE.md, and compatible files.
 */
app.get('/', async (c) => {
  const workspacePath = c.req.query('workspacePath') || process.cwd();
  const db = getDb();
  const rules: Array<{
    path: string;
    name: string;
    content: string;
    type: string;
    mode: string;
    lastModified: number;
  }> = [];

  // Helper: get mode from DB or default to 'active'
  function getMode(filePath: string): RuleMode {
    const row = db
      .query('SELECT mode FROM rules_metadata WHERE workspace_path = ? AND file_path = ?')
      .get(workspacePath, filePath) as any;
    return row ? row.mode : 'active';
  }

  // 1. .claude/rules/*.md and .e/rules/*.md
  for (const rulesParent of ['.claude', '.e']) {
    const rulesDir = join(workspacePath, rulesParent, 'rules');
    try {
      const entries = await readdir(rulesDir, { recursive: true });
      for (const entry of entries) {
        if (!String(entry).endsWith('.md')) continue;
        const full = join(rulesDir, String(entry));
        try {
          const content = await readFile(full, 'utf-8');
          const s = await stat(full);
          rules.push({
            path: full,
            name: String(entry),
            content,
            type: 'rules',
            mode: getMode(full),
            lastModified: s.mtimeMs,
          });
        } catch {
          // Skip unreadable files
        }
      }
    } catch {
      // Directory doesn't exist
    }
  }

  // 2. CLAUDE.md / E.md in workspace root
  for (const p of ['CLAUDE.md', '.claude/CLAUDE.md', 'E.md', '.e/E.md']) {
    const full = join(workspacePath, p);
    try {
      const content = await readFile(full, 'utf-8');
      const s = await stat(full);
      rules.push({
        path: full,
        name: p,
        content,
        type: 'project',
        mode: getMode(full),
        lastModified: s.mtimeMs,
      });
    } catch {
      // File doesn't exist
    }
  }

  // 3. Compatible files (.cursorrules, AGENTS.md, .github/copilot-instructions.md)
  for (const p of COMPAT_FILES) {
    const full = join(workspacePath, p);
    try {
      const content = await readFile(full, 'utf-8');
      const s = await stat(full);
      rules.push({
        path: full,
        name: basename(p),
        content,
        type: 'compat-rules',
        mode: getMode(full),
        lastModified: s.mtimeMs,
      });
    } catch {
      // File doesn't exist
    }
  }

  return c.json({ ok: true, data: rules });
});

/**
 * POST /api/rules
 * Create a new rule file in .e/rules/ (or .claude/rules/ via rulesDir param)
 */
app.post('/', async (c) => {
  const body = await c.req.json();
  const { workspacePath, name, content, useClaudeDir } = body;

  if (!workspacePath || !name) {
    return c.json({ ok: false, error: 'workspacePath and name are required' }, 400);
  }

  const fileName = name.endsWith('.md') ? name : `${name}.md`;
  // Default to .e/rules/ for new rules; use .claude/rules/ only if explicitly requested
  const rulesParent = useClaudeDir ? '.claude' : '.e';
  const rulesDir = join(workspacePath, rulesParent, 'rules');
  await mkdir(rulesDir, { recursive: true });

  const filePath = join(rulesDir, fileName);

  // Check if file already exists
  try {
    await stat(filePath);
    return c.json({ ok: false, error: 'Rule file already exists' }, 409);
  } catch {
    // File doesn't exist, good
  }

  await writeFile(filePath, content || `# ${name.replace('.md', '')}\n\n`, 'utf-8');

  // Store default metadata as active
  const db = getDb();
  const id = nanoid();
  const now = Date.now();
  db.query(
    `INSERT OR REPLACE INTO rules_metadata (id, workspace_path, file_path, mode, created_at, updated_at)
     VALUES (?, ?, ?, 'active', ?, ?)`,
  ).run(id, workspacePath, filePath, now, now);

  return c.json(
    {
      ok: true,
      data: { path: filePath, name: fileName },
    },
    201,
  );
});

/**
 * PUT /api/rules/content
 * Update a rule file's content
 */
app.put('/content', async (c) => {
  const body = await c.req.json();
  const { path: filePath, content } = body;

  if (!filePath || content === undefined) {
    return c.json({ ok: false, error: 'path and content are required' }, 400);
  }

  await writeFile(filePath, content, 'utf-8');
  return c.json({ ok: true });
});

/**
 * PATCH /api/rules/mode
 * Toggle a rule's mode between active and on-demand
 */
app.patch('/mode', async (c) => {
  const body = await c.req.json();
  const { workspacePath, filePath, mode } = body;

  if (!workspacePath || !filePath || !mode) {
    return c.json({ ok: false, error: 'workspacePath, filePath, and mode are required' }, 400);
  }

  if (mode !== 'active' && mode !== 'on-demand') {
    return c.json({ ok: false, error: 'mode must be "active" or "on-demand"' }, 400);
  }

  const db = getDb();
  const existing = db
    .query('SELECT id FROM rules_metadata WHERE workspace_path = ? AND file_path = ?')
    .get(workspacePath, filePath) as any;

  const now = Date.now();
  if (existing) {
    db.query('UPDATE rules_metadata SET mode = ?, updated_at = ? WHERE id = ?').run(
      mode,
      now,
      existing.id,
    );
  } else {
    const id = nanoid();
    db.query(
      `INSERT INTO rules_metadata (id, workspace_path, file_path, mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, workspacePath, filePath, mode, now, now);
  }

  return c.json({ ok: true });
});

/**
 * GET /api/rules/active?workspacePath=...
 * Get all active rule contents for system prompt injection.
 * Returns concatenated content of all rules with mode='active'.
 */
app.get('/active', async (c) => {
  const workspacePath = c.req.query('workspacePath') || process.cwd();
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
          // Skip
        }
      }
    } catch {
      // Directory doesn't exist
    }
  }

  // Scan compatible files that are active
  for (const p of COMPAT_FILES) {
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

  const context =
    activeContents.length > 0 ? `\n\n## Active Rules\n\n${activeContents.join('\n\n')}` : '';

  return c.json({ ok: true, data: { context, count: activeContents.length } });
});

/**
 * GET /api/rules/by-name/:name?workspacePath=...
 * Get a single on-demand rule by filename for @rule injection.
 */
app.get('/by-name/:name', async (c) => {
  const name = c.req.param('name');
  const workspacePath = c.req.query('workspacePath') || process.cwd();

  // Search in .claude/rules/ and .e/rules/
  const claudeRulesDir = join(workspacePath, '.claude', 'rules');
  const eRulesDir = join(workspacePath, '.e', 'rules');
  const candidates = [
    join(claudeRulesDir, name),
    join(claudeRulesDir, `${name}.md`),
    join(eRulesDir, name),
    join(eRulesDir, `${name}.md`),
  ];

  // Also check compat files
  for (const p of COMPAT_FILES) {
    if (basename(p) === name || basename(p, '.md') === name) {
      candidates.push(join(workspacePath, p));
    }
  }

  for (const filePath of candidates) {
    try {
      const content = await readFile(filePath, 'utf-8');
      return c.json({
        ok: true,
        data: { path: filePath, name: basename(filePath), content },
      });
    } catch {
      // Try next
    }
  }

  return c.json({ ok: false, error: `Rule "${name}" not found` }, 404);
});

export { app as rulesRoutes };
