import { Hono } from 'hono';
import { run, validateWorkspacePath } from './helpers';
import type { DiagnosticCheck } from './helpers';

const app = new Hono();

// Git status
app.get('/status', async (c) => {
  const rootPath = c.req.query('path') || process.cwd();

  const pathCheck = validateWorkspacePath(rootPath);
  if (!pathCheck.valid) {
    return c.json({ ok: false, error: pathCheck.reason }, 403);
  }

  try {
    const { stdout: output, exitCode } = await run(['git', 'status', '--porcelain', '-uall'], {
      cwd: pathCheck.resolved,
    });

    if (exitCode !== 0) {
      return c.json({ ok: true, data: { isRepo: false, files: [], indexLocked: false } });
    }

    // Check for index.lock — indicates a git operation is in progress.
    // This is a cheap stat() call, safe to do on every poll.
    const gitDirResult = await run(['git', 'rev-parse', '--git-dir'], {
      cwd: pathCheck.resolved,
    });
    const gitDir = gitDirResult.stdout.trim();
    const lockPath = gitDir.startsWith('/')
      ? `${gitDir}/index.lock`
      : `${pathCheck.resolved}/${gitDir}/index.lock`;
    const indexLocked = await Bun.file(lockPath).exists();

    const files: Array<{ path: string; status: string; staged: boolean }> = [];
    for (const line of output.split('\n')) {
      if (line.length === 0) continue;
      const xy = line.slice(0, 2);
      const filePath = line.slice(3).trim();
      const x = xy[0]; // index (staged) column
      const y = xy[1]; // working-tree (unstaged) column

      if (x === '?' && y === '?') {
        // Untracked file — single entry, not staged
        files.push({ path: filePath, status: 'U', staged: false });
        continue;
      }

      // Emit a staged entry if X indicates a staged change
      if (x !== ' ' && x !== '?') {
        const status = x === 'A' ? 'A' : x === 'D' ? 'D' : x === 'R' ? 'R' : x === 'M' ? 'M' : x;
        files.push({ path: filePath, status, staged: true });
      }

      // Emit an unstaged entry if Y indicates a working-tree change
      if (y !== ' ' && y !== '?') {
        const status = y === 'D' ? 'D' : y === 'M' ? 'M' : y === 'A' ? 'A' : y;
        files.push({ path: filePath, status, staged: false });
      }
    }

    return c.json({ ok: true, data: { isRepo: true, files, indexLocked } });
  } catch {
    return c.json({ ok: true, data: { isRepo: false, files: [], indexLocked: false } });
  }
});

// Git branch
app.get('/branch', async (c) => {
  const rootPath = c.req.query('path') || process.cwd();

  const pathCheck = validateWorkspacePath(rootPath);
  if (!pathCheck.valid) {
    return c.json({ ok: false, error: pathCheck.reason }, 403);
  }

  try {
    const { stdout: output, exitCode } = await run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: pathCheck.resolved,
    });

    if (exitCode !== 0) {
      return c.json({ ok: true, data: { branch: '' } });
    }

    return c.json({ ok: true, data: { branch: output.trim() } });
  } catch {
    return c.json({ ok: true, data: { branch: '' } });
  }
});

// Git diff for a specific file
app.get('/diff', async (c) => {
  const rootPath = c.req.query('path') || process.cwd();
  const filePath = c.req.query('file');
  const staged = c.req.query('staged') === 'true';

  if (!filePath) {
    return c.json({ ok: false, error: 'file parameter required' }, 400);
  }

  const diffPathCheck = validateWorkspacePath(rootPath);
  if (!diffPathCheck.valid) {
    return c.json({ ok: false, error: diffPathCheck.reason }, 403);
  }

  try {
    const args = staged
      ? ['git', 'diff', '--cached', '--', filePath]
      : ['git', 'diff', '--', filePath];

    const {
      stdout: output,
      stderr: err,
      exitCode,
    } = await run(args, { cwd: diffPathCheck.resolved });

    if (exitCode !== 0) {
      return c.json({ ok: false, error: err.trim() || 'git diff failed' }, 500);
    }

    return c.json({ ok: true, data: { diff: output } });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// Git blame for a specific file
app.get('/blame', async (c) => {
  const rootPath = c.req.query('path') || process.cwd();
  const filePath = c.req.query('file');

  if (!filePath) {
    return c.json({ ok: false, error: 'file parameter required' }, 400);
  }

  const blamePathCheck = validateWorkspacePath(rootPath);
  if (!blamePathCheck.valid) {
    return c.json({ ok: false, error: blamePathCheck.reason }, 403);
  }

  try {
    // Use porcelain format for easy parsing
    const { stdout, stderr, exitCode } = await run(
      ['git', 'blame', '--porcelain', '--', filePath],
      { cwd: blamePathCheck.resolved },
    );

    if (exitCode !== 0) {
      return c.json({ ok: false, error: stderr.trim() || 'git blame failed' }, 500);
    }

    // Parse porcelain blame output
    interface BlameInfo {
      sha: string;
      author: string;
      authorTime: number;
      summary: string;
    }

    const commitMap = new Map<string, BlameInfo>();
    const lines: Array<{ line: number; sha: string }> = [];

    const outputLines = stdout.split('\n');
    let i = 0;
    while (i < outputLines.length) {
      const headerMatch = outputLines[i].match(/^([0-9a-f]{40})\s+(\d+)\s+(\d+)/);
      if (headerMatch) {
        const sha = headerMatch[1];
        const resultLine = parseInt(headerMatch[2]);

        // Read commit metadata if we haven't seen this SHA
        if (!commitMap.has(sha)) {
          const info: Partial<BlameInfo> = { sha };
          i++;
          while (i < outputLines.length && !outputLines[i].startsWith('\t')) {
            const line = outputLines[i];
            if (line.startsWith('author ')) info.author = line.slice(7);
            else if (line.startsWith('author-time ')) info.authorTime = parseInt(line.slice(12));
            else if (line.startsWith('summary ')) info.summary = line.slice(8);
            i++;
          }
          commitMap.set(sha, info as BlameInfo);
        } else {
          // Skip to the content line
          i++;
          while (i < outputLines.length && !outputLines[i].startsWith('\t')) {
            i++;
          }
        }

        lines.push({ line: resultLine, sha });
        i++; // skip the content line (starts with \t)
      } else {
        i++;
      }
    }

    // Build result: per-line blame info
    const blameData = lines.map((l) => {
      const commit = commitMap.get(l.sha);
      return {
        line: l.line,
        sha: l.sha.slice(0, 8),
        author: commit?.author || 'Unknown',
        timestamp: commit?.authorTime || 0,
        summary: commit?.summary || '',
      };
    });

    return c.json({ ok: true, data: { blame: blameData } });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// Git diagnostics — helps debug staging and commit flow issues
// ---------------------------------------------------------------------------

app.get('/diagnose', async (c) => {
  const rootPath = c.req.query('path') || process.cwd();

  const pathCheck = validateWorkspacePath(rootPath);
  if (!pathCheck.valid) {
    return c.json({ ok: false, error: pathCheck.reason }, 403);
  }

  const checks: DiagnosticCheck[] = [];

  try {
    // 1. Check if it's a git repo
    const repoResult = await run(['git', 'rev-parse', '--is-inside-work-tree'], {
      cwd: pathCheck.resolved,
    });
    const isRepo = repoResult.stdout.trim() === 'true';

    if (!isRepo) {
      checks.push({
        name: 'git-repo',
        status: 'error',
        message: 'Not a git repository',
        detail: `Path "${pathCheck.resolved}" is not inside a git work tree.`,
      });
      return c.json({ ok: true, data: { checks } });
    }
    checks.push({ name: 'git-repo', status: 'ok', message: 'Valid git repository' });

    // 2. Check for index.lock (indicates interrupted git operation)
    const gitDirResult = await run(['git', 'rev-parse', '--git-dir'], {
      cwd: pathCheck.resolved,
    });
    const gitDir = gitDirResult.stdout.trim();

    const lockPath = `${pathCheck.resolved}/${gitDir}/index.lock`;
    const lockExists = await Bun.file(lockPath).exists();
    if (lockExists) {
      checks.push({
        name: 'index-lock',
        status: 'error',
        message: 'Git index.lock file exists — a previous git operation may have been interrupted',
        detail: `Lock file at: ${lockPath}. Remove it manually if no git process is running.`,
      });
    } else {
      checks.push({ name: 'index-lock', status: 'ok', message: 'No stale lock files' });
    }

    // 3. Check HEAD validity
    const headResult = await run(['git', 'rev-parse', 'HEAD'], { cwd: pathCheck.resolved });
    const headSha = headResult.stdout.trim();
    if (headResult.exitCode !== 0) {
      checks.push({
        name: 'head-ref',
        status: 'warn',
        message: 'HEAD is invalid (no commits yet?)',
        detail: 'This is expected for a brand-new repo with no commits.',
      });
    } else {
      checks.push({
        name: 'head-ref',
        status: 'ok',
        message: `HEAD is valid: ${headSha.slice(0, 8)}`,
      });
    }

    // 4. Working tree status summary
    const statusResult = await run(['git', 'status', '--porcelain'], { cwd: pathCheck.resolved });
    const statusOutput = statusResult.stdout.trim();

    if (statusOutput.length === 0) {
      checks.push({
        name: 'working-tree',
        status: 'ok',
        message: 'Working tree is clean',
      });
    } else {
      const lines = statusOutput.split('\n');
      const staged = lines.filter((l) => l[0] !== ' ' && l[0] !== '?').length;
      const unstaged = lines.filter((l) => l[1] === 'M' || l[1] === 'D').length;
      const untracked = lines.filter((l) => l.startsWith('??')).length;
      checks.push({
        name: 'working-tree',
        status: 'warn',
        message: `Working tree has changes: ${staged} staged, ${unstaged} unstaged, ${untracked} untracked (${lines.length} total)`,
        detail: statusOutput,
      });
    }

    // 5. Check for staged vs unstaged discrepancy (common source of confusion)
    const stagedDiffResult = await run(['git', 'diff', '--cached', '--stat'], {
      cwd: pathCheck.resolved,
    });
    const stagedDiff = stagedDiffResult.stdout.trim();

    const unstagedDiffResult = await run(['git', 'diff', '--stat'], { cwd: pathCheck.resolved });
    const unstagedDiff = unstagedDiffResult.stdout.trim();

    if (stagedDiff && unstagedDiff) {
      checks.push({
        name: 'staging-mismatch',
        status: 'warn',
        message: 'Both staged AND unstaged changes exist — commit may not include all changes',
        detail: `Staged:\n${stagedDiff}\n\nUnstaged:\n${unstagedDiff}`,
      });
    } else if (stagedDiff) {
      checks.push({
        name: 'staging-mismatch',
        status: 'ok',
        message: 'Only staged changes present — commit will include all intended changes',
      });
    } else if (unstagedDiff) {
      checks.push({
        name: 'staging-mismatch',
        status: 'ok',
        message: 'Only unstaged changes present — will need `git add` before commit',
      });
    } else {
      checks.push({
        name: 'staging-mismatch',
        status: 'ok',
        message: 'No staged/unstaged diff discrepancy',
      });
    }

    // 6. Check for merge conflicts
    const conflictResult = await run(['git', 'diff', '--name-only', '--diff-filter=U'], {
      cwd: pathCheck.resolved,
    });
    const conflictFiles = conflictResult.stdout.trim();

    if (conflictFiles.length > 0) {
      checks.push({
        name: 'merge-conflicts',
        status: 'error',
        message: `Merge conflicts detected in ${conflictFiles.split('\n').length} file(s)`,
        detail: conflictFiles,
      });
    } else {
      checks.push({
        name: 'merge-conflicts',
        status: 'ok',
        message: 'No merge conflicts',
      });
    }

    // 7. Check if there's a rebase or merge in progress
    const gitDirAbs = gitDir.startsWith('/') ? gitDir : `${pathCheck.resolved}/${gitDir}`;
    const rebaseMerge = await Bun.file(`${gitDirAbs}/rebase-merge`).exists();
    const rebaseApply = await Bun.file(`${gitDirAbs}/rebase-apply`).exists();
    const mergeHead = await Bun.file(`${gitDirAbs}/MERGE_HEAD`).exists();

    if (rebaseMerge || rebaseApply) {
      checks.push({
        name: 'in-progress-op',
        status: 'error',
        message: 'A rebase is in progress — complete or abort it before committing',
      });
    } else if (mergeHead) {
      checks.push({
        name: 'in-progress-op',
        status: 'warn',
        message: 'A merge is in progress — resolve conflicts and commit the merge',
      });
    } else {
      checks.push({
        name: 'in-progress-op',
        status: 'ok',
        message: 'No rebase or merge in progress',
      });
    }

    // 8. Check current branch
    const branchResult = await run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: pathCheck.resolved,
    });
    const currentBranch = branchResult.stdout.trim();

    if (currentBranch === 'HEAD') {
      checks.push({
        name: 'branch',
        status: 'warn',
        message: "Detached HEAD state — commits won't be on any branch",
        detail: 'You are in detached HEAD state. Create a branch to save your work.',
      });
    } else {
      checks.push({
        name: 'branch',
        status: 'ok',
        message: `On branch: ${currentBranch}`,
      });
    }

    // 9. Check for very large untracked files that could slow down staging
    const untrackedResult = await run(['git', 'ls-files', '--others', '--exclude-standard'], {
      cwd: pathCheck.resolved,
    });
    const untrackedFiles = untrackedResult.stdout.trim();

    if (untrackedFiles) {
      const fileList = untrackedFiles.split('\n');
      if (fileList.length > 100) {
        checks.push({
          name: 'untracked-count',
          status: 'warn',
          message: `${fileList.length} untracked files — consider adding them to .gitignore to speed up staging`,
          detail: `First 10:\n${fileList.slice(0, 10).join('\n')}${fileList.length > 10 ? '\n...' : ''}`,
        });
      } else {
        checks.push({
          name: 'untracked-count',
          status: 'ok',
          message: `${fileList.length} untracked file(s)`,
        });
      }
    } else {
      checks.push({
        name: 'untracked-count',
        status: 'ok',
        message: 'No untracked files',
      });
    }

    return c.json({ ok: true, data: { checks } });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

export default app;
