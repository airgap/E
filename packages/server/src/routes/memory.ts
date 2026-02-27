import { Hono } from 'hono';
import { readFile, writeFile, readdir, stat, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { homedir } from 'os';

const app = new Hono();

// Get all memory files
app.get('/', async (c) => {
  const workspacePath = c.req.query('workspacePath') || process.cwd();
  const files = [];

  // Workspace memory (CLAUDE.md and E.md with parity)
  for (const p of ['CLAUDE.md', '.claude/CLAUDE.md', 'E.md', '.e/E.md']) {
    const full = join(workspacePath, p);
    try {
      const content = await readFile(full, 'utf-8');
      const s = await stat(full);
      files.push({ path: full, content, type: 'project', lastModified: s.mtimeMs });
    } catch {
      // File does not exist, skip
    }
  }

  // Local memory (CLAUDE.local.md and E.local.md)
  for (const localName of ['CLAUDE.local.md', 'E.local.md']) {
    const localPath = join(workspacePath, localName);
    try {
      const content = await readFile(localPath, 'utf-8');
      const s = await stat(localPath);
      files.push({ path: localPath, content, type: 'project-local', lastModified: s.mtimeMs });
    } catch {
      // File does not exist, skip
    }
  }

  // User memory (~/.claude/CLAUDE.md and ~/.e/E.md)
  for (const userCfg of [
    { dir: '.claude', file: 'CLAUDE.md' },
    { dir: '.e', file: 'E.md' },
  ]) {
    const userPath = join(homedir(), userCfg.dir, userCfg.file);
    try {
      const content = await readFile(userPath, 'utf-8');
      const s = await stat(userPath);
      files.push({ path: userPath, content, type: 'user', lastModified: s.mtimeMs });
    } catch {
      // File does not exist, skip
    }
  }

  // Auto memory (~/.claude/projects/ and ~/.e/projects/)
  const wsName = workspacePath.replace(/\//g, '-');
  for (const configDir of ['.claude', '.e']) {
    const autoMemPath = join(homedir(), configDir, 'projects', wsName, 'memory');
    try {
      const entries = await readdir(autoMemPath);
      for (const entry of entries) {
        const full = join(autoMemPath, entry);
        const content = await readFile(full, 'utf-8');
        const s = await stat(full);
        files.push({
          path: full,
          content,
          type: entry === 'MEMORY.md' ? 'auto-memory' : 'auto-topic',
          lastModified: s.mtimeMs,
        });
      }
    } catch {
      // Directory does not exist, skip
    }
  }

  // Rules (.claude/rules/ and .e/rules/)
  for (const rulesParent of ['.claude', '.e']) {
    const rulesDir = join(workspacePath, rulesParent, 'rules');
    try {
      const entries = await readdir(rulesDir, { recursive: true });
      for (const entry of entries) {
        if (!String(entry).endsWith('.md')) continue;
        const full = join(rulesDir, String(entry));
        const content = await readFile(full, 'utf-8');
        const s = await stat(full);
        files.push({ path: full, content, type: 'rules', lastModified: s.mtimeMs });
      }
    } catch {
      // Directory does not exist, skip
    }
  }

  // Skills (.claude/skills/ and .e/skills/)
  for (const skillsParent of ['.claude', '.e']) {
    const skillsDir = join(workspacePath, skillsParent, 'skills');
    try {
      const entries = await readdir(skillsDir);
      for (const entry of entries) {
        const skillFile = join(skillsDir, String(entry), 'SKILL.md');
        try {
          const content = await readFile(skillFile, 'utf-8');
          const s = await stat(skillFile);
          files.push({ path: skillFile, content, type: 'skills', lastModified: s.mtimeMs });
        } catch {
          // Skill file does not exist, skip
        }
      }
    } catch {
      // Directory does not exist, skip
    }
  }

  return c.json({ ok: true, data: files });
});

// Update a memory file
app.put('/', async (c) => {
  const body = await c.req.json();
  const { path: filePath, content } = body;

  // Ensure parent directory exists
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });
  await writeFile(filePath, content, 'utf-8');

  return c.json({ ok: true });
});

export { app as memoryRoutes };
