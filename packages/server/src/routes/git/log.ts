import { Hono } from 'hono';
import { run, validateWorkspacePath } from './helpers';

const app = new Hono();

// Unit separator (0x1F) is the safest delimiter — it never appears in commit
// messages, author names, or refs. Using `|` or `,` would eventually collide.
const US = '\x1f';
const RS = '\x1e'; // record separator (between commits)

export interface GraphCommit {
  sha: string;
  parents: string[];
  author: string;
  email: string;
  /** Unix seconds */
  timestamp: number;
  subject: string;
  /** Ref names pointing at this commit (branches, tags, HEAD). */
  refs: string[];
}

app.get('/log', async (c) => {
  const rootPath = c.req.query('path') || process.cwd();
  const limit = Math.min(parseInt(c.req.query('limit') ?? '500') || 500, 5000);
  const all = c.req.query('all') !== 'false'; // include all branches by default
  const branch = c.req.query('branch') || undefined;

  const pathCheck = validateWorkspacePath(rootPath);
  if (!pathCheck.valid) {
    return c.json({ ok: false, error: pathCheck.reason }, 403);
  }

  try {
    // %H = SHA, %P = parent SHAs (space-separated), %an = author, %ae = email,
    // %at = author timestamp, %s = subject, %D = ref names decoration.
    const fmt = `%H${US}%P${US}%an${US}%ae${US}%at${US}%s${US}%D${RS}`;
    const args = ['git', 'log', '--date-order', `--format=${fmt}`, `-n`, String(limit)];
    if (all && !branch) args.push('--all');
    if (branch) args.push(branch);

    const { stdout, stderr, exitCode } = await run(args, { cwd: pathCheck.resolved });
    if (exitCode !== 0) {
      return c.json({ ok: false, error: stderr.trim() || 'git log failed' }, 500);
    }

    const commits: GraphCommit[] = [];
    const records = stdout.split(RS);
    for (const record of records) {
      const trimmed = record.replace(/^\n/, '');
      if (!trimmed) continue;
      const fields = trimmed.split(US);
      if (fields.length < 7) continue;
      const [sha, parents, author, email, ts, subject, refsRaw] = fields;
      commits.push({
        sha,
        parents: parents ? parents.split(' ').filter(Boolean) : [],
        author,
        email,
        timestamp: parseInt(ts, 10) || 0,
        subject,
        refs: parseRefs(refsRaw),
      });
    }

    return c.json({ ok: true, data: { commits } });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

app.get('/commit/:sha', async (c) => {
  const rootPath = c.req.query('path') || process.cwd();
  const sha = c.req.param('sha');

  if (!sha || !/^[0-9a-f]{4,40}$/i.test(sha)) {
    return c.json({ ok: false, error: 'invalid sha' }, 400);
  }

  const pathCheck = validateWorkspacePath(rootPath);
  if (!pathCheck.valid) {
    return c.json({ ok: false, error: pathCheck.reason }, 403);
  }

  try {
    // Full commit metadata — pipe together the header info and the numstat
    // output so we get file-level insertions/deletions in one round trip.
    const metaFmt = `%H${US}%P${US}%an${US}%ae${US}%at${US}%s${US}%b`;
    const metaRes = await run(['git', 'show', '--no-patch', `--format=${metaFmt}`, sha], {
      cwd: pathCheck.resolved,
    });
    if (metaRes.exitCode !== 0) {
      return c.json({ ok: false, error: metaRes.stderr.trim() || 'git show failed' }, 500);
    }

    const metaFields = metaRes.stdout.replace(/\n+$/, '').split(US);
    if (metaFields.length < 7) {
      return c.json({ ok: false, error: 'unexpected git show output' }, 500);
    }
    const [resolvedSha, parents, author, email, ts, subject, body] = metaFields;

    // Files changed with numstat (tab-separated, first two columns are adds/dels).
    const filesRes = await run(['git', 'show', '--numstat', '--format=', sha], {
      cwd: pathCheck.resolved,
    });
    const files: Array<{ path: string; additions: number; deletions: number }> = [];
    if (filesRes.exitCode === 0) {
      for (const line of filesRes.stdout.split('\n')) {
        if (!line.trim()) continue;
        const [addsRaw, delsRaw, ...rest] = line.split('\t');
        const path = rest.join('\t');
        if (!path) continue;
        files.push({
          path,
          additions: addsRaw === '-' ? 0 : parseInt(addsRaw, 10) || 0,
          deletions: delsRaw === '-' ? 0 : parseInt(delsRaw, 10) || 0,
        });
      }
    }

    return c.json({
      ok: true,
      data: {
        sha: resolvedSha,
        parents: parents ? parents.split(' ').filter(Boolean) : [],
        author,
        email,
        timestamp: parseInt(ts, 10) || 0,
        subject,
        body: (body || '').trim(),
        files,
      },
    });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

app.get('/commit/:sha/diff', async (c) => {
  const rootPath = c.req.query('path') || process.cwd();
  const sha = c.req.param('sha');
  const file = c.req.query('file') || '';

  if (!sha || !/^[0-9a-f]{4,40}$/i.test(sha)) {
    return c.json({ ok: false, error: 'invalid sha' }, 400);
  }

  const pathCheck = validateWorkspacePath(rootPath);
  if (!pathCheck.valid) {
    return c.json({ ok: false, error: pathCheck.reason }, 403);
  }

  try {
    const args = ['git', 'show', '--format=', sha];
    if (file) args.push('--', file);
    const { stdout, stderr, exitCode } = await run(args, { cwd: pathCheck.resolved });
    if (exitCode !== 0) {
      return c.json({ ok: false, error: stderr.trim() || 'git show failed' }, 500);
    }
    return c.json({ ok: true, data: { diff: stdout } });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

/**
 * Parse `%D` output — e.g. `HEAD -> main, origin/main, tag: v1.2.3` — into a
 * flat list of ref names. The `HEAD -> x` split is normalized so both `HEAD`
 * and `x` appear as refs.
 */
function parseRefs(raw: string): string[] {
  if (!raw) return [];
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const part of parts) {
    const arrow = part.indexOf(' -> ');
    if (arrow !== -1) {
      out.push(part.slice(0, arrow).trim());
      out.push(part.slice(arrow + 4).trim());
    } else if (part.startsWith('tag: ')) {
      out.push(part); // keep the `tag:` prefix so the UI can style tags
    } else {
      out.push(part);
    }
  }
  return out;
}

export default app;
