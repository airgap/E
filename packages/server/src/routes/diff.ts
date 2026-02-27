import { Hono } from 'hono';

export const diffRoutes = new Hono();

// ── Types ──────────────────────────────────────────────────────────────────

type DiffType = 'github_pr' | 'github_commit' | 'raw_diff' | 'git_range';
type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed';

interface DiffFile {
  path: string;
  oldPath?: string;
  additions: number;
  deletions: number;
  status: FileStatus;
}

interface DiffSummary {
  filesChanged: number;
  insertions: number;
  deletions: number;
}

interface ParsedDiff {
  type: DiffType;
  title?: string;
  url?: string;
  rawDiff: string;
  files: DiffFile[];
  summary: DiffSummary;
  contextBlock: string;
}

// ── Unified diff parser ────────────────────────────────────────────────────

function parseUnifiedDiff(raw: string): DiffFile[] {
  const files: DiffFile[] = [];
  // Split on "diff --git" boundaries
  const chunks = raw.split(/^diff --git /m).filter((c) => c.trim().length > 0);

  for (const chunk of chunks) {
    const lines = chunk.split('\n');
    // First line: "a/path b/path"
    const headerLine = lines[0] || '';
    const headerMatch = headerLine.match(/^a\/(.+?) b\/(.+?)$/);
    let aPath = headerMatch ? headerMatch[1] : '';
    let bPath = headerMatch ? headerMatch[2] : '';

    let additions = 0;
    let deletions = 0;
    let status: FileStatus = 'modified';
    let detectedOldPath: string | undefined;

    for (const line of lines.slice(1)) {
      if (line.startsWith('new file mode')) {
        status = 'added';
      } else if (line.startsWith('deleted file mode')) {
        status = 'deleted';
      } else if (line.startsWith('rename from ')) {
        detectedOldPath = line.slice('rename from '.length).trim();
        status = 'renamed';
      } else if (line.startsWith('rename to ')) {
        bPath = line.slice('rename to '.length).trim();
      } else if (line.startsWith('--- a/')) {
        // Already have paths from header
      } else if (line.startsWith('+++ b/')) {
        // Already have paths from header
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        additions++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        deletions++;
      }
    }

    const path = status === 'deleted' ? aPath : bPath || aPath;
    if (!path) continue;

    const file: DiffFile = { path, additions, deletions, status };
    if (status === 'renamed' && detectedOldPath) {
      file.oldPath = detectedOldPath;
    }
    files.push(file);
  }

  return files;
}

function buildContextBlock(
  type: DiffType,
  files: DiffFile[],
  rawDiff: string,
  url?: string,
  title?: string,
): string {
  const MAX_DIFF_CHARS = 8000;
  const truncatedDiff =
    rawDiff.length > MAX_DIFF_CHARS
      ? rawDiff.slice(0, MAX_DIFF_CHARS) + '\n... (truncated)'
      : rawDiff;

  const typeAttr = `type="${type}"`;
  const urlAttr = url ? ` url="${url}"` : '';

  const fileLines = files
    .map((f) => {
      const stats = `(+${f.additions} -${f.deletions})`;
      const renamed = f.oldPath ? ` (renamed from ${f.oldPath})` : '';
      return `- ${f.path} ${stats} [${f.status}]${renamed}`;
    })
    .join('\n');

  const titleLine = title ? `\n## Title\n${title}\n` : '';

  return (
    `<diff ${typeAttr}${urlAttr}>\n` +
    titleLine +
    `## Changed Files\n${fileLines}\n\n` +
    `## Diff\n\`\`\`diff\n${truncatedDiff}\n\`\`\`\n` +
    `</diff>`
  );
}

// ── Input detection ────────────────────────────────────────────────────────

function detectInputType(input: string): {
  type: DiffType;
  owner?: string;
  repo?: string;
  number?: string;
  sha?: string;
} {
  const trimmed = input.trim();

  // GitHub PR URL
  const prMatch = trimmed.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (prMatch) {
    return { type: 'github_pr', owner: prMatch[1], repo: prMatch[2], number: prMatch[3] };
  }

  // GitHub commit URL
  const commitMatch = trimmed.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/commit\/([0-9a-f]+)/i,
  );
  if (commitMatch) {
    return {
      type: 'github_commit',
      owner: commitMatch[1],
      repo: commitMatch[2],
      sha: commitMatch[3],
    };
  }

  // Raw diff
  if (trimmed.startsWith('diff --git') || trimmed.startsWith('---')) {
    return { type: 'raw_diff' };
  }

  // Git range (e.g. abc123..def456 or abc123...def456)
  if (/^[0-9a-f]{4,40}\.\.\.?[0-9a-f]{4,40}$/i.test(trimmed)) {
    return { type: 'git_range' };
  }

  // Default to raw_diff and let the caller decide
  return { type: 'raw_diff' };
}

// ── Fetch GitHub diff ──────────────────────────────────────────────────────

async function fetchGitHubDiff(
  owner: string,
  repo: string,
  prOrCommit: string,
  isPr: boolean,
): Promise<{ rawDiff: string; title?: string }> {
  const endpoint = isPr
    ? `https://github.com/${owner}/${repo}/pull/${prOrCommit}.diff`
    : `https://github.com/${owner}/${repo}/commit/${prOrCommit}.diff`;

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.diff',
    'User-Agent': 'e-diff-parser/1.0',
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers['Authorization'] = `token ${token}`;

  const res = await fetch(endpoint, { headers });
  if (!res.ok) {
    throw new Error(`GitHub returned HTTP ${res.status} for ${endpoint}`);
  }
  const rawDiff = await res.text();

  // Try to fetch PR title via API
  let title: string | undefined;
  if (isPr) {
    try {
      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${prOrCommit}`;
      const apiHeaders: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'e-diff-parser/1.0',
      };
      if (token) apiHeaders['Authorization'] = `token ${token}`;
      const apiRes = await fetch(apiUrl, { headers: apiHeaders });
      if (apiRes.ok) {
        const json = (await apiRes.json()) as { title?: string };
        title = json.title;
      }
    } catch {
      // title stays undefined
    }
  }

  return { rawDiff, title };
}

// ── Run git diff for a range ───────────────────────────────────────────────

async function runGitDiff(range: string, cwd: string): Promise<string> {
  const proc = Bun.spawn(['git', 'diff', range], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const errText = await new Response(proc.stderr).text();
    throw new Error(`git diff failed: ${errText.trim()}`);
  }
  return new Response(proc.stdout).text();
}

// ── Route ─────────────────────────────────────────────────────────────────

const MAX_RAW_BYTES = 50 * 1024; // 50 KB

diffRoutes.post('/parse', async (c) => {
  let body: { input?: string; workspacePath?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const { input, workspacePath } = body;
  if (!input || typeof input !== 'string') {
    return c.json({ ok: false, error: 'Missing required field: input' }, 400);
  }

  const trimmed = input.trim();
  const detected = detectInputType(trimmed);

  let rawDiff = '';
  let title: string | undefined;
  let url: string | undefined;

  try {
    if (detected.type === 'github_pr') {
      url = `https://github.com/${detected.owner}/${detected.repo}/pull/${detected.number}`;
      const result = await fetchGitHubDiff(detected.owner!, detected.repo!, detected.number!, true);
      rawDiff = result.rawDiff;
      title = result.title;
    } else if (detected.type === 'github_commit') {
      url = `https://github.com/${detected.owner}/${detected.repo}/commit/${detected.sha}`;
      const result = await fetchGitHubDiff(detected.owner!, detected.repo!, detected.sha!, false);
      rawDiff = result.rawDiff;
    } else if (detected.type === 'git_range') {
      if (!workspacePath) {
        return c.json({ ok: false, error: 'workspacePath is required for git range input' }, 400);
      }
      rawDiff = await runGitDiff(trimmed, workspacePath);
    } else {
      // raw_diff — use directly
      rawDiff = trimmed;
    }
  } catch (err: any) {
    return c.json({ ok: false, error: err?.message ?? 'Failed to fetch diff' }, 500);
  }

  // Truncate to 50 KB
  if (rawDiff.length > MAX_RAW_BYTES) {
    rawDiff = rawDiff.slice(0, MAX_RAW_BYTES) + '\n... (diff truncated at 50KB)';
  }

  const files = parseUnifiedDiff(rawDiff);

  const summary: DiffSummary = {
    filesChanged: files.length,
    insertions: files.reduce((s, f) => s + f.additions, 0),
    deletions: files.reduce((s, f) => s + f.deletions, 0),
  };

  const contextBlock = buildContextBlock(detected.type, files, rawDiff, url, title);

  const data: ParsedDiff = {
    type: detected.type,
    ...(title ? { title } : {}),
    ...(url ? { url } : {}),
    rawDiff,
    files,
    summary,
    contextBlock,
  };

  return c.json({ ok: true, data });
});
