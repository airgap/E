import { Hono } from 'hono';
import { readFile, readdir, stat, writeFile, mkdir, unlink, rename } from 'fs/promises';
import { join, relative, dirname, resolve } from 'path';
import { homedir } from 'os';
import editorconfig from 'editorconfig';
import type { Context } from 'hono';
import type { EditorConfigProps } from '@e/shared';
import { resolveWorkspacePath, getForStory } from '../services/worktree-service';

const app = new Hono();

/**
 * Validate that a path is safe to access.
 * Blocks obvious traversal attempts and sensitive system paths.
 */
function isSafePath(filePath: string): { safe: boolean; reason?: string } {
  const resolved = resolve(filePath);

  // Block access to sensitive system directories
  const blockedPrefixes = ['/etc/shadow', '/proc/', '/sys/'];
  for (const prefix of blockedPrefixes) {
    if (resolved.startsWith(prefix)) {
      return { safe: false, reason: `Access to ${prefix} is blocked` };
    }
  }

  // Block access to SSH keys, credentials, etc.
  const blockedPatterns = [
    /\.ssh\/.*(?:id_|known_hosts|authorized_keys)/,
    /\.gnupg\//,
    /\.aws\/credentials/,
    /\.env(?:\.local|\.production)?$/,
  ];
  for (const pattern of blockedPatterns) {
    if (pattern.test(resolved)) {
      return { safe: false, reason: 'Access to sensitive files is blocked' };
    }
  }

  return { safe: true };
}

// ---------------------------------------------------------------------------
// Worktree-scoped file operations — path resolution helpers
// ---------------------------------------------------------------------------

/** Context for worktree-scoped file operations. */
interface WorktreeFileContext {
  /** Absolute path to the worktree directory (effective root for file ops). */
  effectivePath: string;
  /** Absolute path to the original workspace root (for path translation). */
  workspacePath: string;
}

/**
 * Extract story context from request and resolve worktree context.
 *
 * Story context is provided via:
 * - `X-Story-Context` header (preferred)
 * - `storyId` query parameter (alternative)
 *
 * Returns null when no story context is active (backward compatible).
 */
function getWorktreeContext(c: Context): WorktreeFileContext | null {
  const storyId = c.req.header('X-Story-Context') || c.req.query('storyId') || null;
  if (!storyId) return null;

  const record = getForStory(storyId);
  if (!record) {
    console.warn(`[worktree-files] No worktree record for story ${storyId}, using path as-is`);
    return null;
  }

  const wsPath = resolve(record.workspace_path);
  const effectivePath = resolveWorkspacePath(wsPath, storyId);

  if (effectivePath === wsPath) {
    console.warn(`[worktree-files] Worktree for story ${storyId} not active, using workspace path`);
    return null;
  }

  return { effectivePath, workspacePath: wsPath };
}

/** Translate a file path from workspace space to worktree space. */
function translateToWorktree(filePath: string, ctx: WorktreeFileContext): string {
  const resolved = resolve(filePath);
  if (resolved === ctx.workspacePath) return ctx.effectivePath;
  if (resolved.startsWith(ctx.workspacePath + '/')) {
    return join(ctx.effectivePath, relative(ctx.workspacePath, resolved));
  }
  return resolved;
}

/** Translate a file path from worktree space back to workspace space. */
function translateToWorkspace(filePath: string, ctx: WorktreeFileContext): string {
  const resolved = resolve(filePath);
  if (resolved === ctx.effectivePath) return ctx.workspacePath;
  if (resolved.startsWith(ctx.effectivePath + '/')) {
    return join(ctx.workspacePath, relative(ctx.effectivePath, resolved));
  }
  return resolved;
}

/** Check that a resolved path is within the allowed root directory. */
function isWithinRoot(filePath: string, root: string): boolean {
  const resolved = resolve(filePath);
  const resolvedRoot = resolve(root);
  return resolved === resolvedRoot || resolved.startsWith(resolvedRoot + '/');
}

/** Result of resolving a file path through worktree context. */
type ResolveResult = { ok: true; actualPath: string } | { ok: false; error: string };

/** Resolve the actual filesystem path, applying worktree translation and traversal checks. */
function resolveFilePath(filePath: string, ctx: WorktreeFileContext | null): ResolveResult {
  if (!ctx) return { ok: true, actualPath: resolve(filePath) };
  const actualPath = translateToWorktree(filePath, ctx);
  if (!isWithinRoot(actualPath, ctx.effectivePath)) {
    return { ok: false, error: 'Path outside worktree root is not allowed' };
  }
  return { ok: true, actualPath };
}

/** Convert a path for response output, translating worktree paths to workspace paths. */
function toResponsePath(filePath: string, ctx: WorktreeFileContext | null): string {
  if (!ctx) return filePath;
  return translateToWorkspace(filePath, ctx);
}

/** Recursively translate paths in tree nodes from worktree to workspace space. */
function translateTreePaths(nodes: any[], ctx: WorktreeFileContext): any[] {
  return nodes.map((node) => {
    const translated: any = { ...node, path: translateToWorkspace(node.path, ctx) };
    if (node.children) translated.children = translateTreePaths(node.children, ctx);
    return translated;
  });
}

// ---------------------------------------------------------------------------
// File operation endpoints — all support optional story context
// ---------------------------------------------------------------------------

// Read file
app.get('/read', async (c) => {
  const filePath = c.req.query('path');
  if (!filePath) return c.json({ ok: false, error: 'path required' }, 400);

  const ctx = getWorktreeContext(c);
  const resolved = resolveFilePath(filePath, ctx);
  if (!resolved.ok) return c.json({ ok: false, error: resolved.error }, 403);

  const pathCheck = isSafePath(resolved.actualPath);
  if (!pathCheck.safe) return c.json({ ok: false, error: pathCheck.reason }, 403);

  try {
    const content = await readFile(resolved.actualPath, 'utf-8');
    const s = await stat(resolved.actualPath);
    return c.json({
      ok: true,
      data: {
        path: toResponsePath(resolved.actualPath, ctx),
        content,
        size: s.size,
        lastModified: s.mtimeMs,
      },
    });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 404);
  }
});

// Directory tree (for file explorer)
app.get('/tree', async (c) => {
  const requestedPath = c.req.query('path');
  const depth = parseInt(c.req.query('depth') || '2');
  const ctx = getWorktreeContext(c);

  let rootPath: string;
  if (ctx && requestedPath) {
    const resolved = resolveFilePath(requestedPath, ctx);
    if (!resolved.ok) return c.json({ ok: false, error: resolved.error }, 403);
    rootPath = resolved.actualPath;
  } else if (ctx) {
    rootPath = ctx.effectivePath;
  } else {
    rootPath = requestedPath || process.cwd();
  }

  async function buildTree(dir: string, currentDepth: number): Promise<any[]> {
    if (currentDepth > depth) return [];

    try {
      const entries = await readdir(dir, { withFileTypes: true });
      const items = [];

      for (const entry of entries) {
        if (entry.name.startsWith('.') && entry.name !== '.claude') continue;
        if (['node_modules', '__pycache__', '.git', 'dist', 'build'].includes(entry.name)) continue;

        const fullPath = join(dir, entry.name);
        const relPath = relative(rootPath, fullPath);

        if (entry.isDirectory()) {
          const children = await buildTree(fullPath, currentDepth + 1);
          items.push({
            name: entry.name,
            path: fullPath,
            relativePath: relPath,
            type: 'directory',
            children,
          });
        } else {
          items.push({
            name: entry.name,
            path: fullPath,
            relativePath: relPath,
            type: 'file',
          });
        }
      }

      return items.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    } catch {
      return [];
    }
  }

  const tree = await buildTree(rootPath, 0);
  const responseTree = ctx ? translateTreePaths(tree, ctx) : tree;
  return c.json({ ok: true, data: responseTree });
});

// List subdirectories for directory picker
app.get('/directories', async (c) => {
  const requestedPath = c.req.query('path');
  const ctx = getWorktreeContext(c);

  let dirPath: string;
  if (ctx && requestedPath) {
    const resolved = resolveFilePath(requestedPath, ctx);
    if (!resolved.ok) return c.json({ ok: false, error: resolved.error }, 403);
    dirPath = resolved.actualPath;
  } else if (ctx) {
    dirPath = ctx.effectivePath;
  } else {
    dirPath = requestedPath || homedir();
  }

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => ({
        name: e.name,
        path: toResponsePath(join(dirPath, e.name), ctx),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return c.json({
      ok: true,
      data: { parent: toResponsePath(dirPath, ctx), directories: dirs },
    });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 400);
  }
});

// Write file
app.put('/write', async (c) => {
  const body = await c.req.json();
  const { path: filePath, content } = body;
  if (!filePath) return c.json({ ok: false, error: 'path required' }, 400);
  if (typeof content !== 'string') return c.json({ ok: false, error: 'content required' }, 400);

  const ctx = getWorktreeContext(c);
  const resolved = resolveFilePath(filePath, ctx);
  if (!resolved.ok) return c.json({ ok: false, error: resolved.error }, 403);

  const pathCheck = isSafePath(resolved.actualPath);
  if (!pathCheck.safe) return c.json({ ok: false, error: pathCheck.reason }, 403);

  try {
    await mkdir(dirname(resolved.actualPath), { recursive: true });
    await writeFile(resolved.actualPath, content, 'utf-8');
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// Create file
app.post('/create', async (c) => {
  const body = await c.req.json();
  const { path: filePath, content = '' } = body;
  if (!filePath) return c.json({ ok: false, error: 'path required' }, 400);

  const ctx = getWorktreeContext(c);
  const resolved = resolveFilePath(filePath, ctx);
  if (!resolved.ok) return c.json({ ok: false, error: resolved.error }, 403);

  const pathCheck = isSafePath(resolved.actualPath);
  if (!pathCheck.safe) return c.json({ ok: false, error: pathCheck.reason }, 403);

  try {
    try {
      await stat(resolved.actualPath);
      return c.json({ ok: false, error: 'File already exists' }, 409);
    } catch {
      // File doesn't exist, good
    }
    await mkdir(dirname(resolved.actualPath), { recursive: true });
    await writeFile(resolved.actualPath, content, 'utf-8');
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// Delete file
app.delete('/delete', async (c) => {
  const filePath = c.req.query('path');
  if (!filePath) return c.json({ ok: false, error: 'path required' }, 400);

  const ctx = getWorktreeContext(c);
  const resolved = resolveFilePath(filePath, ctx);
  if (!resolved.ok) return c.json({ ok: false, error: resolved.error }, 403);

  const pathCheck = isSafePath(resolved.actualPath);
  if (!pathCheck.safe) return c.json({ ok: false, error: pathCheck.reason }, 403);

  try {
    await unlink(resolved.actualPath);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// Rename/move file
app.post('/rename', async (c) => {
  const body = await c.req.json();
  const { oldPath, newPath } = body;
  if (!oldPath || !newPath)
    return c.json({ ok: false, error: 'oldPath and newPath required' }, 400);

  const ctx = getWorktreeContext(c);

  const oldResolved = resolveFilePath(oldPath, ctx);
  if (!oldResolved.ok) return c.json({ ok: false, error: oldResolved.error }, 403);

  const newResolved = resolveFilePath(newPath, ctx);
  if (!newResolved.ok) return c.json({ ok: false, error: newResolved.error }, 403);

  const oldCheck = isSafePath(oldResolved.actualPath);
  if (!oldCheck.safe) return c.json({ ok: false, error: oldCheck.reason }, 403);
  const newCheck = isSafePath(newResolved.actualPath);
  if (!newCheck.safe) return c.json({ ok: false, error: newCheck.reason }, 403);

  try {
    await mkdir(dirname(newResolved.actualPath), { recursive: true });
    await rename(oldResolved.actualPath, newResolved.actualPath);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// Resolve .editorconfig for a file path
app.get('/editorconfig', async (c) => {
  const filePath = c.req.query('path');
  if (!filePath) return c.json({ ok: false, error: 'path required' }, 400);

  const ctx = getWorktreeContext(c);
  const resolved = resolveFilePath(filePath, ctx);
  if (!resolved.ok) return c.json({ ok: false, error: resolved.error }, 403);

  try {
    const raw = await editorconfig.parse(resolved.actualPath);
    const config: EditorConfigProps = {};

    if (raw.indent_style === 'tab' || raw.indent_style === 'space') {
      config.indent_style = raw.indent_style as 'tab' | 'space';
    }
    if (raw.indent_size !== undefined && raw.indent_size !== 'tab') {
      config.indent_size = Number(raw.indent_size);
    }
    if (raw.tab_width !== undefined) {
      config.tab_width = Number(raw.tab_width);
    }
    if (raw.end_of_line === 'lf' || raw.end_of_line === 'crlf' || raw.end_of_line === 'cr') {
      config.end_of_line = raw.end_of_line as 'lf' | 'crlf' | 'cr';
    }
    if (raw.trim_trailing_whitespace !== undefined) {
      config.trim_trailing_whitespace =
        raw.trim_trailing_whitespace === true || raw.trim_trailing_whitespace === 'true';
    }
    if (raw.insert_final_newline !== undefined) {
      config.insert_final_newline =
        raw.insert_final_newline === true || raw.insert_final_newline === 'true';
    }
    if (raw.charset) {
      config.charset = String(raw.charset);
    }

    return c.json({ ok: true, data: config });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// Verify file (syntax check)
app.post('/verify', async (c) => {
  const body = await c.req.json<{ path: string; workspacePath?: string }>();
  const { path: filePath, workspacePath } = body;

  if (!filePath) return c.json({ ok: false, error: 'path required' }, 400);

  const ctx = getWorktreeContext(c);
  const resolved = resolveFilePath(filePath, ctx);
  if (!resolved.ok) return c.json({ ok: false, error: resolved.error }, 403);

  const effectiveWorkspace = ctx ? ctx.effectivePath : workspacePath || process.cwd();

  try {
    const { verifyFile } = await import('../services/code-verifier');
    const verifyResult = await verifyFile(resolved.actualPath, effectiveWorkspace);
    return c.json({ ok: true, data: verifyResult });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

/** @internal — exposed for unit tests to directly test helper functions. */
export const _testHelpers = {
  isSafePath,
  getWorktreeContext,
  translateToWorktree,
  translateToWorkspace,
  isWithinRoot,
  resolveFilePath,
  toResponsePath,
  translateTreePaths,
};

export { app as fileRoutes };
