/**
 * git/branches.ts (LYK-1010) — branch listing, creation, deletion,
 * checkout, pull. Keeps the status-bar branch picker self-contained:
 * one round-trip per action, no client-side git plumbing.
 *
 * All routes are mounted under /git/ via routes/git/index.ts.
 */

import { Hono } from 'hono';
import { run, validateWorkspacePath } from './helpers';

const app = new Hono();

interface BranchInfo {
  name: string;
  isLocal: boolean;
  isRemote: boolean;
  /** True only for the local checked-out branch. */
  isCurrent: boolean;
  /** Upstream tracking ref (e.g. "origin/main") when set; null otherwise. */
  upstream: string | null;
  /** Commit count this branch is ahead of its upstream. 0 when no upstream. */
  ahead: number;
  /** Commit count this branch is behind its upstream. 0 when no upstream. */
  behind: number;
  /** Subject of the tip commit — useful for picker tooltips. */
  subject: string;
}

/**
 * List local + remote branches with tracking, ahead/behind, and tip
 * subject. Uses `git for-each-ref` with a format string so one process
 * answers everything the picker needs.
 */
app.get('/branches', async (c) => {
  const rootPath = c.req.query('path') || process.cwd();
  const pathCheck = validateWorkspacePath(rootPath);
  if (!pathCheck.valid) return c.json({ ok: false, error: pathCheck.reason }, 403);

  // Field separator: %09 = TAB. Last field is %(contents:subject) which
  // can itself contain tabs — keep it last so the split is unambiguous.
  const fmt = [
    '%(refname:short)',
    '%(HEAD)',
    '%(upstream:short)',
    '%(upstream:track)',
    '%(contents:subject)',
  ].join('%09');
  try {
    const { stdout, exitCode } = await run(
      ['git', 'for-each-ref', `--format=${fmt}`, 'refs/heads', 'refs/remotes'],
      { cwd: pathCheck.resolved },
    );
    if (exitCode !== 0) return c.json({ ok: true, data: { branches: [] } });

    const branches: BranchInfo[] = [];
    for (const line of stdout.split('\n')) {
      if (!line) continue;
      const parts = line.split('\t');
      if (parts.length < 4) continue;
      const [name, headFlag, upstream, track, ...rest] = parts;
      const subject = rest.join('\t').trim();
      const isCurrent = headFlag === '*';
      const isRemote = name.startsWith('origin/') || /^[^/]+\/[^/]+/.test(name);
      const isLocal = !isRemote;
      // `track` looks like `[ahead 2, behind 1]` or empty/`[gone]`.
      let ahead = 0;
      let behind = 0;
      const aMatch = /ahead (\d+)/.exec(track);
      const bMatch = /behind (\d+)/.exec(track);
      if (aMatch) ahead = parseInt(aMatch[1], 10);
      if (bMatch) behind = parseInt(bMatch[1], 10);
      branches.push({
        name,
        isLocal,
        isRemote,
        isCurrent,
        upstream: upstream || null,
        ahead,
        behind,
        subject,
      });
    }
    return c.json({ ok: true, data: { branches } });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

/**
 * Ahead/behind for the current branch vs its upstream. Cheap shortcut
 * for the status bar — avoids re-fetching the whole branch list every
 * time the user looks at the segment.
 */
app.get('/branch-status', async (c) => {
  const rootPath = c.req.query('path') || process.cwd();
  const pathCheck = validateWorkspacePath(rootPath);
  if (!pathCheck.valid) return c.json({ ok: false, error: pathCheck.reason }, 403);

  try {
    const { stdout: branchOut } = await run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: pathCheck.resolved,
    });
    const branch = branchOut.trim();
    const { stdout: trackOut, exitCode: trackExit } = await run(
      ['git', 'rev-list', '--left-right', '--count', '@{u}...HEAD'],
      { cwd: pathCheck.resolved },
    );
    if (trackExit !== 0) {
      return c.json({ ok: true, data: { branch, ahead: 0, behind: 0, hasUpstream: false } });
    }
    const [behindStr, aheadStr] = trackOut.trim().split(/\s+/);
    return c.json({
      ok: true,
      data: {
        branch,
        ahead: parseInt(aheadStr || '0', 10) || 0,
        behind: parseInt(behindStr || '0', 10) || 0,
        hasUpstream: true,
      },
    });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

/**
 * Checkout an existing branch. Body: { path, name, force? }. When the
 * tree is dirty git refuses unless `force` is set — caller is expected
 * to confirm with the user first.
 */
app.post('/checkout', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const rootPath: string = body.path || process.cwd();
  const name: string = body.name;
  const force: boolean = !!body.force;
  if (!name) return c.json({ ok: false, error: 'name required' }, 400);
  const pathCheck = validateWorkspacePath(rootPath);
  if (!pathCheck.valid) return c.json({ ok: false, error: pathCheck.reason }, 403);

  // Remote-tracking name like "origin/foo" — checkout creates a local
  // branch tracking it; git infers the local name from the remote one.
  const args = ['git', 'checkout'];
  if (force) args.push('--force');
  // Strip remote prefix when the caller passed e.g. "origin/foo" so the
  // local branch lands as "foo" with upstream set automatically.
  if (/^[^/]+\/.+/.test(name) && !name.startsWith('refs/')) {
    const local = name.split('/').slice(1).join('/');
    args.push('-B', local, '--track', name);
  } else {
    args.push(name);
  }
  try {
    const { stdout, stderr, exitCode } = await run(args, { cwd: pathCheck.resolved });
    if (exitCode !== 0) {
      return c.json({ ok: false, error: stderr.trim() || stdout.trim() || 'checkout failed' }, 409);
    }
    return c.json({ ok: true, data: { stdout: stdout.trim(), stderr: stderr.trim() } });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

/**
 * Create a new branch from a base ref, optionally checking it out.
 * Body: { path, name, base?, checkout? }.
 */
app.post('/branch-create', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const rootPath: string = body.path || process.cwd();
  const name: string = body.name;
  const base: string | undefined = body.base;
  const checkout: boolean = body.checkout !== false;
  if (!name) return c.json({ ok: false, error: 'name required' }, 400);
  const pathCheck = validateWorkspacePath(rootPath);
  if (!pathCheck.valid) return c.json({ ok: false, error: pathCheck.reason }, 403);

  const args = ['git', checkout ? 'checkout' : 'branch'];
  if (checkout) args.push('-b');
  args.push(name);
  if (base) args.push(base);
  try {
    const { stdout, stderr, exitCode } = await run(args, { cwd: pathCheck.resolved });
    if (exitCode !== 0) {
      return c.json({ ok: false, error: stderr.trim() || stdout.trim() || 'create failed' }, 409);
    }
    return c.json({ ok: true, data: { stdout: stdout.trim() } });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

/**
 * Delete a local branch. Body: { path, name, force? }. force => -D
 * (unmerged commits OK); otherwise -d (safe).
 */
app.post('/branch-delete', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const rootPath: string = body.path || process.cwd();
  const name: string = body.name;
  const force: boolean = !!body.force;
  if (!name) return c.json({ ok: false, error: 'name required' }, 400);
  const pathCheck = validateWorkspacePath(rootPath);
  if (!pathCheck.valid) return c.json({ ok: false, error: pathCheck.reason }, 403);

  try {
    const { stdout, stderr, exitCode } = await run(['git', 'branch', force ? '-D' : '-d', name], {
      cwd: pathCheck.resolved,
    });
    if (exitCode !== 0) {
      return c.json({ ok: false, error: stderr.trim() || stdout.trim() || 'delete failed' }, 409);
    }
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

/**
 * Pull the current branch. Body: { path, rebase? }.
 */
app.post('/pull', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const rootPath: string = body.path || process.cwd();
  const rebase: boolean = !!body.rebase;
  const pathCheck = validateWorkspacePath(rootPath);
  if (!pathCheck.valid) return c.json({ ok: false, error: pathCheck.reason }, 403);

  try {
    const args = ['git', 'pull'];
    if (rebase) args.push('--rebase');
    const { stdout, stderr, exitCode } = await run(args, { cwd: pathCheck.resolved });
    if (exitCode !== 0) {
      return c.json({ ok: false, error: stderr.trim() || stdout.trim() || 'pull failed' }, 409);
    }
    return c.json({ ok: true, data: { stdout: stdout.trim() } });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

export default app;
