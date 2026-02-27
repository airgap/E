import { describe, test, expect, beforeEach, mock, spyOn } from 'bun:test';
import { resolve, join } from 'path';

// ---------------------------------------------------------------------------
// Mock worktree-service
// ---------------------------------------------------------------------------

let mockRecord: any = null;

mock.module('../../services/worktree-service', () => ({
  getForStory: () => mockRecord,
  resolveWorkspacePath: (wp: string, sid?: string | null) => {
    if (!sid) return resolve(wp);
    if (!mockRecord) return resolve(wp);
    if (!['active', 'merging', 'conflict'].includes(mockRecord.status)) return resolve(wp);
    return resolve(mockRecord.worktree_path);
  },
}));

// ---------------------------------------------------------------------------
// Mock fs/promises
// ---------------------------------------------------------------------------

let fsState: Record<string, any> = {};

mock.module('fs/promises', () => ({
  readFile: async () => {
    if (fsState.readFileError) throw new Error(fsState.readFileError);
    return fsState.fileContent ?? 'mock content';
  },
  stat: async () => {
    if (fsState.statError) throw new Error(fsState.statError);
    return { size: 42, mtimeMs: 1000000 };
  },
  readdir: async () => {
    if (fsState.readdirError) throw new Error(fsState.readdirError);
    return fsState.readdirEntries ?? [];
  },
  writeFile: async () => {
    if (fsState.writeFileError) throw new Error(fsState.writeFileError);
  },
  mkdir: async () => {},
  unlink: async () => {
    if (fsState.unlinkError) throw new Error(fsState.unlinkError);
  },
  rename: async () => {
    if (fsState.renameError) throw new Error(fsState.renameError);
  },
}));

mock.module('editorconfig', () => ({
  default: {
    parse: async () => ({ indent_style: 'space', indent_size: 2 }),
  },
}));

mock.module('../../services/code-verifier', () => ({
  verifyFile: async () => ({ valid: true, errors: [] }),
}));

// ---------------------------------------------------------------------------
// Import AFTER mocks
// ---------------------------------------------------------------------------

import { fileRoutes as app, _testHelpers } from '../files';

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const WORKSPACE = '/workspace/project';
const WORKTREE = '/workspace/project/.e/worktrees/test-story';

const defaultRecord = {
  id: 'wt-abc',
  story_id: 'test-story',
  prd_id: null,
  workspace_path: WORKSPACE,
  worktree_path: WORKTREE,
  branch_name: 'story/test-story',
  base_branch: 'main',
  base_commit: 'deadbeef',
  status: 'active' as string,
  created_at: 1000000,
  updated_at: 1000000,
};

function resetState() {
  mockRecord = null;
  fsState = {};
}

function jsonReq(method: string, body?: any, headers?: Record<string, string>): RequestInit {
  const init: any = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return init;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('File Routes — Worktree Context', () => {
  beforeEach(() => {
    resetState();
  });

  // =========================================================================
  // AC4 & AC5: Context extraction from header and query param
  // =========================================================================

  describe('context extraction', () => {
    test('X-Story-Context header activates worktree routing', async () => {
      mockRecord = { ...defaultRecord };
      const res = await app.request(`/read?path=${WORKSPACE}/src/file.ts`, {
        headers: { 'X-Story-Context': 'test-story' },
      });
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.path).toContain(WORKSPACE);
      expect(json.data.path).not.toContain('.e/worktrees');
    });

    test('storyId query param activates worktree routing', async () => {
      mockRecord = { ...defaultRecord };
      const res = await app.request(`/read?path=${WORKSPACE}/src/file.ts&storyId=test-story`);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.path).toContain(WORKSPACE);
      expect(json.data.path).not.toContain('.e/worktrees');
    });

    test('no context when neither header nor query provided', async () => {
      const res = await app.request('/read?path=/tmp/safe-test-file.txt');
      const json = await res.json();
      expect(json).toBeDefined();
    });
  });

  // =========================================================================
  // AC1 & AC6: All file ops use resolved worktree path
  // =========================================================================

  describe('GET /read — worktree context', () => {
    test('reads from worktree when context active', async () => {
      mockRecord = { ...defaultRecord };
      const res = await app.request(`/read?path=${WORKSPACE}/src/file.ts&storyId=test-story`);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.content).toBe('mock content');
    });

    test('returns workspace-relative path in response (AC8)', async () => {
      mockRecord = { ...defaultRecord };
      const res = await app.request(`/read?path=${WORKSPACE}/src/file.ts&storyId=test-story`);
      const json = await res.json();
      expect(json.data.path).toBe(join(resolve(WORKSPACE), 'src/file.ts'));
    });

    test('deep nested path translates correctly', async () => {
      mockRecord = { ...defaultRecord };
      const res = await app.request(
        `/read?path=${WORKSPACE}/src/deep/nested/file.ts&storyId=test-story`,
      );
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.path).toBe(join(resolve(WORKSPACE), 'src/deep/nested/file.ts'));
    });
  });

  describe('PUT /write — worktree context', () => {
    test('writes to worktree when context active', async () => {
      mockRecord = { ...defaultRecord };
      const res = await app.request(
        '/write?storyId=test-story',
        jsonReq('PUT', { path: `${WORKSPACE}/src/new.ts`, content: 'hello' }),
      );
      const json = await res.json();
      expect(json.ok).toBe(true);
    });
  });

  describe('POST /create — worktree context', () => {
    test('creates in worktree when context active', async () => {
      mockRecord = { ...defaultRecord };
      fsState.statError = 'ENOENT';
      const res = await app.request(
        '/create?storyId=test-story',
        jsonReq('POST', { path: `${WORKSPACE}/src/brand-new.ts`, content: '' }),
      );
      const json = await res.json();
      expect(json.ok).toBe(true);
    });
  });

  describe('DELETE /delete — worktree context', () => {
    test('deletes from worktree when context active', async () => {
      mockRecord = { ...defaultRecord };
      const res = await app.request(`/delete?path=${WORKSPACE}/src/old.ts&storyId=test-story`, {
        method: 'DELETE',
      });
      const json = await res.json();
      expect(json.ok).toBe(true);
    });
  });

  describe('POST /rename — worktree context', () => {
    test('renames within worktree when context active', async () => {
      mockRecord = { ...defaultRecord };
      const res = await app.request(
        '/rename?storyId=test-story',
        jsonReq('POST', {
          oldPath: `${WORKSPACE}/src/old.ts`,
          newPath: `${WORKSPACE}/src/new.ts`,
        }),
      );
      const json = await res.json();
      expect(json.ok).toBe(true);
    });
  });

  describe('GET /editorconfig — worktree context', () => {
    test('resolves editorconfig from worktree path', async () => {
      mockRecord = { ...defaultRecord };
      const res = await app.request(
        `/editorconfig?path=${WORKSPACE}/src/file.ts&storyId=test-story`,
      );
      const json = await res.json();
      expect(json.ok).toBe(true);
    });
  });

  describe('POST /verify — worktree context', () => {
    test('verifies file in worktree when context active', async () => {
      mockRecord = { ...defaultRecord };
      const res = await app.request(
        '/verify?storyId=test-story',
        jsonReq('POST', { path: `${WORKSPACE}/src/file.ts` }),
      );
      const json = await res.json();
      expect(json.ok).toBe(true);
    });
  });

  describe('GET /directories — worktree context', () => {
    test('lists directories from worktree and returns workspace paths (AC8)', async () => {
      mockRecord = { ...defaultRecord };
      fsState.readdirEntries = [
        { name: 'src', isDirectory: () => true },
        { name: 'README.md', isDirectory: () => false },
      ];
      const res = await app.request(`/directories?path=${WORKSPACE}&storyId=test-story`);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.directories).toHaveLength(1);
      expect(json.data.parent).toBe(resolve(WORKSPACE));
      expect(json.data.directories[0].path).toContain(WORKSPACE);
      expect(json.data.directories[0].path).not.toContain('.e/worktrees');
    });

    test('defaults to worktree root when no path and context active', async () => {
      mockRecord = { ...defaultRecord };
      fsState.readdirEntries = [];
      const res = await app.request('/directories?storyId=test-story');
      const json = await res.json();
      expect(json.ok).toBe(true);
    });
  });

  // =========================================================================
  // AC7: Path traversal protection against worktree root
  // =========================================================================

  describe('path traversal protection', () => {
    test('rejects path outside worktree via traversal', async () => {
      mockRecord = { ...defaultRecord };
      const traversalPath = `${WORKSPACE}/../../../etc/passwd`;
      const res = await app.request(
        `/read?path=${encodeURIComponent(traversalPath)}&storyId=test-story`,
      );
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('outside worktree root');
    });

    test('rejects absolute path outside worktree', async () => {
      mockRecord = { ...defaultRecord };
      const res = await app.request('/read?path=/etc/hosts&storyId=test-story');
      expect(res.status).toBe(403);
    });

    test('allows path within worktree', async () => {
      mockRecord = { ...defaultRecord };
      const res = await app.request(`/read?path=${WORKSPACE}/src/file.ts&storyId=test-story`);
      expect(res.status).toBe(200);
    });

    test('rejects traversal on write endpoint', async () => {
      mockRecord = { ...defaultRecord };
      const res = await app.request(
        '/write?storyId=test-story',
        jsonReq('PUT', { path: '/etc/evil', content: 'bad' }),
      );
      expect(res.status).toBe(403);
    });

    test('rejects traversal on delete endpoint', async () => {
      mockRecord = { ...defaultRecord };
      const res = await app.request('/delete?path=/etc/passwd&storyId=test-story', {
        method: 'DELETE',
      });
      expect(res.status).toBe(403);
    });

    test('rejects traversal on rename oldPath', async () => {
      mockRecord = { ...defaultRecord };
      const res = await app.request(
        '/rename?storyId=test-story',
        jsonReq('POST', { oldPath: '/etc/passwd', newPath: `${WORKSPACE}/src/safe.ts` }),
      );
      expect(res.status).toBe(403);
    });

    test('rejects traversal on rename newPath', async () => {
      mockRecord = { ...defaultRecord };
      const res = await app.request(
        '/rename?storyId=test-story',
        jsonReq('POST', { oldPath: `${WORKSPACE}/src/safe.ts`, newPath: '/tmp/evil' }),
      );
      expect(res.status).toBe(403);
    });

    test('prefix-collision path is rejected (e.g. /workspace/project2)', async () => {
      mockRecord = {
        ...defaultRecord,
        workspace_path: '/root',
        worktree_path: '/root/.e/worktrees/test',
      };
      const res = await app.request('/read?path=/root2/file&storyId=test-story');
      expect(res.status).toBe(403);
    });
  });

  // =========================================================================
  // AC9: Backward compatible with no context
  // =========================================================================

  describe('backward compatibility', () => {
    test('GET /read works without story context', async () => {
      const res = await app.request('/read?path=/tmp/test-compat.txt');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.path).toBe('/tmp/test-compat.txt');
    });

    test('PUT /write works without story context', async () => {
      const res = await app.request('/write', jsonReq('PUT', { path: '/tmp/w.txt', content: 'x' }));
      const json = await res.json();
      expect(json.ok).toBe(true);
    });

    test('POST /create works without story context', async () => {
      fsState.statError = 'ENOENT';
      const res = await app.request(
        '/create',
        jsonReq('POST', { path: '/tmp/c.txt', content: '' }),
      );
      const json = await res.json();
      expect(json.ok).toBe(true);
    });

    test('DELETE /delete works without story context', async () => {
      const res = await app.request('/delete?path=/tmp/d.txt', { method: 'DELETE' });
      const json = await res.json();
      expect(json.ok).toBe(true);
    });

    test('POST /rename works without story context', async () => {
      const res = await app.request(
        '/rename',
        jsonReq('POST', { oldPath: '/tmp/old.txt', newPath: '/tmp/new.txt' }),
      );
      const json = await res.json();
      expect(json.ok).toBe(true);
    });

    test('GET /editorconfig works without story context', async () => {
      const res = await app.request('/editorconfig?path=/tmp/file.ts');
      const json = await res.json();
      expect(json.ok).toBe(true);
    });

    test('required params still validated without context', async () => {
      const res1 = await app.request('/read');
      expect(res1.status).toBe(400);

      const res2 = await app.request('/write', jsonReq('PUT', { content: 'x' }));
      expect(res2.status).toBe(400);

      const res3 = await app.request('/delete', { method: 'DELETE' });
      expect(res3.status).toBe(400);
    });
  });

  // =========================================================================
  // AC2 & AC3: Graceful fallback when storyId has no active worktree
  // =========================================================================

  describe('graceful fallback', () => {
    test('falls back when storyId has no record (AC3)', async () => {
      mockRecord = null;
      const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
      const res = await app.request('/read?path=/tmp/test.txt&storyId=unknown-story');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.path).toBe('/tmp/test.txt');
      warnSpy.mockRestore();
    });

    test('falls back when worktree is abandoned', async () => {
      mockRecord = { ...defaultRecord, status: 'abandoned' };
      const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
      const res = await app.request('/read?path=/tmp/test.txt&storyId=test-story');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.path).toBe('/tmp/test.txt');
      warnSpy.mockRestore();
    });

    test('falls back when worktree is merged', async () => {
      mockRecord = { ...defaultRecord, status: 'merged' };
      const res = await app.request('/read?path=/tmp/test.txt&storyId=test-story');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.path).toBe('/tmp/test.txt');
    });

    test('falls back when worktree is cleanup_pending', async () => {
      mockRecord = { ...defaultRecord, status: 'cleanup_pending' };
      const res = await app.request('/read?path=/tmp/test.txt&storyId=test-story');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.path).toBe('/tmp/test.txt');
    });
  });

  // =========================================================================
  // isSafePath still works
  // =========================================================================

  describe('isSafePath preserved', () => {
    test('blocks sensitive paths without context', async () => {
      const res = await app.request('/read?path=/proc/self/environ');
      expect(res.status).toBe(403);
    });

    test('blocks sensitive paths with context', async () => {
      // Both workspace and worktree under /proc so translated path stays blocked
      mockRecord = {
        ...defaultRecord,
        workspace_path: '/proc',
        worktree_path: '/proc/worktrees/test-story',
      };
      const res = await app.request('/read?path=/proc/self/environ&storyId=test-story');
      expect(res.status).toBe(403);
    });
  });

  // =========================================================================
  // Response path translation (AC8)
  // =========================================================================

  describe('response path translation (AC8)', () => {
    test('read response path is workspace-relative', async () => {
      mockRecord = { ...defaultRecord };
      const res = await app.request(`/read?path=${WORKSPACE}/deep/path/f.ts&storyId=test-story`);
      const json = await res.json();
      expect(json.data.path).toBe(join(resolve(WORKSPACE), 'deep/path/f.ts'));
    });

    test('directory listing paths are workspace-relative', async () => {
      mockRecord = { ...defaultRecord };
      fsState.readdirEntries = [{ name: 'lib', isDirectory: () => true }];
      const res = await app.request(`/directories?path=${WORKSPACE}/src&storyId=test-story`);
      const json = await res.json();
      expect(json.data.parent).toBe(join(resolve(WORKSPACE), 'src'));
      expect(json.data.directories[0].path).toContain(WORKSPACE);
      expect(json.data.directories[0].path).not.toContain('.e/worktrees');
    });
  });

  // =========================================================================
  // X-Story-Context header takes precedence over query param
  // =========================================================================

  describe('header precedence', () => {
    test('header takes precedence over query param', async () => {
      mockRecord = { ...defaultRecord };
      // Header says test-story (has active worktree), query says unknown
      const res = await app.request(`/read?path=${WORKSPACE}/src/file.ts&storyId=unknown`, {
        headers: { 'X-Story-Context': 'test-story' },
      });
      const json = await res.json();
      expect(json.ok).toBe(true);
      // The header value (test-story) was used, not the query (unknown)
      expect(json.data.path).not.toContain('.e/worktrees');
    });
  });

  // =========================================================================
  // Tree endpoint with worktree context
  // =========================================================================

  describe('GET /tree — worktree context', () => {
    test('tree defaults to worktree root when context active and no path', async () => {
      mockRecord = { ...defaultRecord };
      fsState.readdirEntries = [];
      const res = await app.request('/tree?storyId=test-story');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data).toEqual([]);
    });

    test('tree translates paths in response', async () => {
      mockRecord = { ...defaultRecord };
      fsState.readdirEntries = [
        { name: 'src', isDirectory: () => true },
        { name: 'file.ts', isDirectory: () => false },
      ];
      const res = await app.request(`/tree?path=${WORKSPACE}&storyId=test-story&depth=1`);
      const json = await res.json();
      expect(json.ok).toBe(true);
      // Response paths should show workspace paths, not worktree paths
      for (const node of json.data) {
        expect(node.path).not.toContain('.e/worktrees');
      }
    });

    test('tree works without context (backward compat)', async () => {
      fsState.readdirEntries = [];
      const res = await app.request('/tree?path=/tmp');
      const json = await res.json();
      expect(json.ok).toBe(true);
    });

    test('tree rejects path traversal with context', async () => {
      mockRecord = { ...defaultRecord };
      const res = await app.request('/tree?path=/etc&storyId=test-story');
      expect(res.status).toBe(403);
    });
  });

  // =========================================================================
  // Verify uses worktree root as workspace path
  // =========================================================================

  describe('POST /verify — workspace resolution', () => {
    test('verify uses body workspacePath when no story context', async () => {
      const res = await app.request(
        '/verify',
        jsonReq('POST', { path: '/tmp/file.ts', workspacePath: '/tmp' }),
      );
      const json = await res.json();
      expect(json.ok).toBe(true);
    });

    test('verify rejects path traversal with context', async () => {
      mockRecord = { ...defaultRecord };
      const res = await app.request(
        '/verify?storyId=test-story',
        jsonReq('POST', { path: '/etc/hosts' }),
      );
      expect(res.status).toBe(403);
    });
  });

  // =========================================================================
  // Error handling
  // =========================================================================

  describe('error handling', () => {
    test('read returns 404 on file not found', async () => {
      fsState.readFileError = 'ENOENT: no such file';
      const res = await app.request('/read?path=/tmp/nonexistent.txt');
      expect(res.status).toBe(404);
    });

    test('write returns 500 on write error', async () => {
      fsState.writeFileError = 'permission denied';
      const res = await app.request('/write', jsonReq('PUT', { path: '/tmp/w.txt', content: 'x' }));
      expect(res.status).toBe(500);
    });

    test('create returns 409 when file exists', async () => {
      // stat succeeds means file exists
      const res = await app.request('/create', jsonReq('POST', { path: '/tmp/exists.txt' }));
      expect(res.status).toBe(409);
    });

    test('delete returns 500 on unlink error', async () => {
      fsState.unlinkError = 'permission denied';
      const res = await app.request('/delete?path=/tmp/x.txt', { method: 'DELETE' });
      expect(res.status).toBe(500);
    });

    test('rename returns 500 on error', async () => {
      fsState.renameError = 'cross-device link';
      const res = await app.request(
        '/rename',
        jsonReq('POST', { oldPath: '/tmp/a.txt', newPath: '/tmp/b.txt' }),
      );
      expect(res.status).toBe(500);
    });

    test('rename requires both paths', async () => {
      const res = await app.request('/rename', jsonReq('POST', { oldPath: '/tmp/a.txt' }));
      expect(res.status).toBe(400);
    });

    test('write requires content', async () => {
      const res = await app.request('/write', jsonReq('PUT', { path: '/tmp/w.txt' }));
      expect(res.status).toBe(400);
    });

    test('verify requires path', async () => {
      const res = await app.request('/verify', jsonReq('POST', {}));
      expect(res.status).toBe(400);
    });

    test('editorconfig requires path', async () => {
      const res = await app.request('/editorconfig');
      expect(res.status).toBe(400);
    });

    test('create requires path', async () => {
      const res = await app.request('/create', jsonReq('POST', {}));
      expect(res.status).toBe(400);
    });
  });
});

// ===========================================================================
// Helper function unit tests (via _testHelpers)
// ===========================================================================

describe('File Route Helper Functions', () => {
  const {
    translateToWorktree,
    translateToWorkspace,
    isWithinRoot,
    resolveFilePath,
    toResponsePath,
    translateTreePaths,
    isSafePath,
  } = _testHelpers;

  const ctx = {
    effectivePath: resolve('/workspace/.e/worktrees/story1'),
    workspacePath: resolve('/workspace'),
  };

  describe('translateToWorktree', () => {
    test('maps workspace root to worktree root', () => {
      expect(translateToWorktree('/workspace', ctx)).toBe(ctx.effectivePath);
    });

    test('maps workspace subpath to worktree subpath', () => {
      expect(translateToWorktree('/workspace/src/file.ts', ctx)).toBe(
        join(ctx.effectivePath, 'src/file.ts'),
      );
    });

    test('returns non-workspace paths as-is (resolved)', () => {
      expect(translateToWorktree('/other/path', ctx)).toBe(resolve('/other/path'));
    });

    test('handles deep nested paths', () => {
      expect(translateToWorktree('/workspace/a/b/c/d.ts', ctx)).toBe(
        join(ctx.effectivePath, 'a/b/c/d.ts'),
      );
    });
  });

  describe('translateToWorkspace', () => {
    test('maps worktree root to workspace root', () => {
      expect(translateToWorkspace(ctx.effectivePath, ctx)).toBe(ctx.workspacePath);
    });

    test('maps worktree subpath to workspace subpath', () => {
      const worktreePath = join(ctx.effectivePath, 'src/file.ts');
      expect(translateToWorkspace(worktreePath, ctx)).toBe(join(ctx.workspacePath, 'src/file.ts'));
    });

    test('returns non-worktree paths as-is', () => {
      expect(translateToWorkspace('/other/path', ctx)).toBe(resolve('/other/path'));
    });
  });

  describe('isWithinRoot', () => {
    test('returns true for exact root match', () => {
      expect(isWithinRoot('/workspace', '/workspace')).toBe(true);
    });

    test('returns true for path within root', () => {
      expect(isWithinRoot('/workspace/src/file.ts', '/workspace')).toBe(true);
    });

    test('returns false for path outside root', () => {
      expect(isWithinRoot('/etc/passwd', '/workspace')).toBe(false);
    });

    test('returns false for prefix collision (workspace2 vs workspace)', () => {
      expect(isWithinRoot('/workspace2/file', '/workspace')).toBe(false);
    });

    test('returns false for traversal attack', () => {
      expect(isWithinRoot('/workspace/../etc/passwd', '/workspace')).toBe(false);
    });

    test('returns true for deeply nested path', () => {
      expect(isWithinRoot('/workspace/a/b/c/d/e', '/workspace')).toBe(true);
    });
  });

  describe('resolveFilePath', () => {
    test('returns resolved path without context (backward compat)', () => {
      const result = resolveFilePath('/tmp/file.ts', null);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.actualPath).toBe(resolve('/tmp/file.ts'));
      }
    });

    test('translates and validates with context', () => {
      const result = resolveFilePath('/workspace/src/file.ts', ctx);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.actualPath).toBe(join(ctx.effectivePath, 'src/file.ts'));
      }
    });

    test('rejects path outside worktree', () => {
      const result = resolveFilePath('/etc/passwd', ctx);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('outside worktree root');
      }
    });

    test('rejects traversal path', () => {
      const result = resolveFilePath('/workspace/../../etc/passwd', ctx);
      expect(result.ok).toBe(false);
    });
  });

  describe('toResponsePath', () => {
    test('returns path as-is without context', () => {
      expect(toResponsePath('/some/path', null)).toBe('/some/path');
    });

    test('translates worktree path to workspace path with context', () => {
      const worktreePath = join(ctx.effectivePath, 'src/file.ts');
      expect(toResponsePath(worktreePath, ctx)).toBe(join(ctx.workspacePath, 'src/file.ts'));
    });
  });

  describe('translateTreePaths', () => {
    test('translates all path properties in tree nodes', () => {
      const nodes = [
        {
          name: 'src',
          path: join(ctx.effectivePath, 'src'),
          relativePath: 'src',
          type: 'directory',
          children: [
            {
              name: 'file.ts',
              path: join(ctx.effectivePath, 'src/file.ts'),
              relativePath: 'src/file.ts',
              type: 'file',
            },
          ],
        },
      ];

      const translated = translateTreePaths(nodes, ctx);
      expect(translated[0].path).toBe(join(ctx.workspacePath, 'src'));
      expect(translated[0].children[0].path).toBe(join(ctx.workspacePath, 'src/file.ts'));
      // relativePath should be unchanged
      expect(translated[0].relativePath).toBe('src');
    });

    test('handles empty tree', () => {
      expect(translateTreePaths([], ctx)).toEqual([]);
    });

    test('handles nodes without children', () => {
      const nodes = [{ name: 'f.ts', path: join(ctx.effectivePath, 'f.ts'), type: 'file' }];
      const translated = translateTreePaths(nodes, ctx);
      expect(translated[0].path).toBe(join(ctx.workspacePath, 'f.ts'));
      expect(translated[0].children).toBeUndefined();
    });
  });

  describe('isSafePath', () => {
    test('allows normal paths', () => {
      expect(isSafePath('/tmp/file.txt').safe).toBe(true);
    });

    test('blocks /proc/', () => {
      expect(isSafePath('/proc/self/environ').safe).toBe(false);
    });

    test('blocks /sys/', () => {
      expect(isSafePath('/sys/kernel/debug').safe).toBe(false);
    });

    test('blocks SSH keys', () => {
      expect(isSafePath('/home/user/.ssh/id_rsa').safe).toBe(false);
    });

    test('blocks .gnupg', () => {
      expect(isSafePath('/home/user/.gnupg/secret').safe).toBe(false);
    });

    test('blocks .env files', () => {
      expect(isSafePath('/project/.env').safe).toBe(false);
      expect(isSafePath('/project/.env.local').safe).toBe(false);
      expect(isSafePath('/project/.env.production').safe).toBe(false);
    });

    test('blocks AWS credentials', () => {
      expect(isSafePath('/home/user/.aws/credentials').safe).toBe(false);
    });
  });
});
