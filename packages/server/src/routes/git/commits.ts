import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { callLlm } from '../../services/llm-oneshot';
import { run, runExitCode, validateWorkspacePath, parseCommitFailure } from './helpers';

const app = new Hono();

// Commit staged changes (auto-stages all if nothing is staged — like VS Code)
// Pass `noAutoStage: true` to skip auto-staging (used by Smart Stage grouping)
app.post('/commit', async (c) => {
  const body = await c.req.json();
  const { path: rootPath, message, noAutoStage, noVerify } = body;

  if (!rootPath) return c.json({ ok: false, error: 'path required' }, 400);
  if (!message || typeof message !== 'string' || !message.trim()) {
    return c.json({ ok: false, error: 'commit message required' }, 400);
  }

  const pathCheck = validateWorkspacePath(rootPath);
  if (!pathCheck.valid) {
    return c.json({ ok: false, error: pathCheck.reason }, 403);
  }

  try {
    // If nothing is staged, auto-stage all changes (VS Code behavior)
    // When noAutoStage is set (e.g. Smart Stage grouping), skip this to avoid
    // committing files outside the intended group.
    const stagedExit = await runExitCode(['git', 'diff', '--cached', '--quiet'], {
      cwd: pathCheck.resolved,
    });
    // exit 0 = no staged changes, exit 1 = has staged changes
    if (stagedExit === 0) {
      if (noAutoStage) {
        return c.json({ ok: false, error: 'Nothing staged (auto-stage disabled)' }, 400);
      }
      console.log('[git/commit] Nothing staged — auto-staging all changes');
      const addResult = await run(['git', 'add', '-A'], { cwd: pathCheck.resolved });
      if (addResult.exitCode !== 0) {
        return c.json({ ok: false, error: `git add failed: ${addResult.stderr.trim()}` }, 500);
      }
    }

    const commitArgs = [
      'git',
      'commit',
      ...(noVerify ? ['--no-verify'] : []),
      '-m',
      message.trim(),
    ];
    console.log('[git/commit] Running:', commitArgs.join(' '));
    const commitResult = await run(commitArgs, {
      cwd: pathCheck.resolved,
    });
    console.log('[git/commit] git commit result:', {
      exitCode: commitResult.exitCode,
      stdout: commitResult.stdout,
      stderr: commitResult.stderr,
    });
    if (commitResult.exitCode !== 0) {
      return c.json(
        { ok: false, error: `git commit failed: ${commitResult.stderr || commitResult.stdout}` },
        500,
      );
    }

    // Get the new HEAD sha
    const shaResult = await run(['git', 'rev-parse', 'HEAD'], { cwd: pathCheck.resolved });
    const sha = shaResult.stdout.trim();

    return c.json({ ok: true, data: { sha } });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// Streaming commit endpoint with real-time output
app.post('/commit/stream', async (c) => {
  const body = await c.req.json();
  const { path: rootPath, message, noAutoStage, noVerify } = body;

  if (!rootPath) return c.json({ ok: false, error: 'path required' }, 400);
  if (!message || typeof message !== 'string' || !message.trim()) {
    return c.json({ ok: false, error: 'commit message required' }, 400);
  }

  const pathCheck = validateWorkspacePath(rootPath);
  if (!pathCheck.valid) {
    return c.json({ ok: false, error: pathCheck.reason }, 403);
  }

  return streamSSE(c, async (stream) => {
    try {
      console.log(
        '[git/commit/stream] Starting commit flow for:',
        pathCheck.resolved,
        'msg:',
        message.trim(),
      );

      // Check what's staged before committing
      const beforeStatusResult = await run(['git', 'status', '--porcelain'], {
        cwd: pathCheck.resolved,
      });
      console.log('[git/commit/stream] Status before commit:', beforeStatusResult.stdout);

      await stream.writeSSE({
        data: JSON.stringify({
          type: 'diagnostic',
          phase: 'before-staging',
          message: 'Current index and working tree status',
          porcelain: beforeStatusResult.stdout.trim(),
          fileCount: beforeStatusResult.stdout.trim()
            ? beforeStatusResult.stdout.trim().split('\n').length
            : 0,
        }),
      });

      // If nothing is staged, auto-stage all changes (VS Code behavior)
      // When noAutoStage is set (e.g. Smart Stage grouping), skip to avoid
      // committing files outside the intended group.
      const stagedExit = await runExitCode(['git', 'diff', '--cached', '--quiet'], {
        cwd: pathCheck.resolved,
      });
      console.log(
        '[git/commit/stream] Staged check exit code:',
        stagedExit,
        '(0=nothing staged, 1=has staged)',
      );
      // exit 0 = no staged changes, exit 1 = has staged changes
      if (stagedExit === 0) {
        if (noAutoStage) {
          console.log('[git/commit/stream] Nothing staged and noAutoStage set — aborting');
          await stream.writeSSE({
            data: JSON.stringify({
              type: 'error',
              message: 'Nothing staged (auto-stage disabled)',
            }),
          });
          return;
        }
        console.log('[git/commit/stream] Nothing staged — auto-staging all changes');
        await stream.writeSSE({
          data: JSON.stringify({
            type: 'status',
            message: 'Nothing staged — auto-staging all changes...',
          }),
        });
        const addResult = await run(['git', 'add', '-A'], { cwd: pathCheck.resolved });
        console.log('[git/commit/stream] git add -A result:', {
          exitCode: addResult.exitCode,
          stderr: addResult.stderr,
        });
        if (addResult.exitCode !== 0) {
          await stream.writeSSE({
            data: JSON.stringify({
              type: 'error',
              message: `git add failed: ${addResult.stderr.trim()}`,
            }),
          });
          return;
        }
      }

      await stream.writeSSE({
        data: JSON.stringify({
          type: 'status',
          message: 'Running pre-commit hooks and creating commit...',
        }),
      });

      const commitArgs = [
        'git',
        'commit',
        ...(noVerify ? ['--no-verify'] : []),
        '-m',
        message.trim(),
      ];
      console.log('[git/commit/stream] Running:', commitArgs.join(' '));
      const commitProc = Bun.spawn(commitArgs, {
        cwd: pathCheck.resolved,
        stdout: 'pipe',
        stderr: 'pipe',
      });

      // For long-running commits (with hooks), we need to stream the output as it comes
      // Use separate decoders to avoid corrupting multi-byte state across concurrent streams
      const readStreamChunked = async (readable: ReadableStream): Promise<string> => {
        const dec = new TextDecoder();
        const reader = readable.getReader();
        let fullOutput = '';
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = dec.decode(value, { stream: true });
            fullOutput += chunk;
            // Stream non-empty chunks immediately
            if (chunk.trim()) {
              await stream.writeSSE({ data: JSON.stringify({ type: 'output', message: chunk }) });
            }
          }
        } finally {
          reader.releaseLock();
        }
        return fullOutput;
      };

      // Guard against pre-commit hooks that hang forever (e.g. waiting for input).
      // If the commit takes more than 5 minutes, kill it and report the timeout.
      const COMMIT_TIMEOUT_MS = 5 * 60 * 1000;
      const commitTimeout = setTimeout(() => {
        console.error(
          '[git/commit/stream] TIMEOUT after %dms — killing commit process',
          COMMIT_TIMEOUT_MS,
        );
        try {
          commitProc.kill();
        } catch {
          // already exited
        }
      }, COMMIT_TIMEOUT_MS);

      // Read both streams concurrently to prevent deadlock
      const [commitOut, commitErr] = await Promise.all([
        readStreamChunked(commitProc.stdout),
        readStreamChunked(commitProc.stderr),
      ]);
      const commitExit = await commitProc.exited;
      clearTimeout(commitTimeout);
      console.log('[git/commit/stream] git commit result:', {
        exitCode: commitExit,
        stdout: commitOut.slice(0, 200),
        stderr: commitErr.slice(0, 200),
      });

      if (commitExit !== 0) {
        const rawDetail = commitErr.trim() || commitOut.trim() || 'Unknown error';
        console.error('[git/commit/stream] Commit failed:', rawDetail);

        // Parse the failure into a human-readable summary
        const summary = parseCommitFailure(rawDetail, commitOut.trim());

        await stream.writeSSE({
          data: JSON.stringify({
            type: 'error',
            message: summary,
            detail: rawDetail.length > 500 ? rawDetail.slice(-500) : rawDetail,
          }),
        });
        return;
      }

      // Check status AFTER commit — stream to client
      const afterCommitResult = await run(['git', 'status', '--porcelain'], {
        cwd: pathCheck.resolved,
      });
      console.log('[git/commit/stream] Status AFTER commit:', afterCommitResult.stdout);

      const afterCommitClean = afterCommitResult.stdout.trim().length === 0;
      await stream.writeSSE({
        data: JSON.stringify({
          type: 'diagnostic',
          phase: 'after-commit',
          message: afterCommitClean
            ? 'Working tree is clean after commit'
            : 'WARNING: Working tree still has changes after commit — some files may not have been included',
          porcelain: afterCommitResult.stdout.trim(),
          fileCount: afterCommitResult.stdout.trim()
            ? afterCommitResult.stdout.trim().split('\n').length
            : 0,
        }),
      });

      // Get the new HEAD sha
      const shaResult = await run(['git', 'rev-parse', 'HEAD'], { cwd: pathCheck.resolved });
      const sha = shaResult.stdout.trim();
      console.log('[git/commit/stream] Commit successful! SHA:', sha);

      await stream.writeSSE({
        data: JSON.stringify({ type: 'complete', sha, message: 'Commit successful!' }),
      });
    } catch (err) {
      console.error('[git/commit/stream] Unexpected error:', err);
      await stream.writeSSE({
        data: JSON.stringify({ type: 'error', message: String(err) }),
      });
    }
  });
});

// Atomic group commit: unstage all → stage specific files → commit.
// This is a single HTTP request so HMR/page reloads can't interrupt mid-group
// (previously this was 3 separate requests from the client).
app.post('/commit-group', async (c) => {
  const body = await c.req.json();
  const { path: rootPath, files, message, noVerify } = body;

  if (!rootPath) return c.json({ ok: false, error: 'path required' }, 400);
  if (!message || typeof message !== 'string' || !message.trim()) {
    return c.json({ ok: false, error: 'commit message required' }, 400);
  }
  if (!files || !Array.isArray(files) || files.length === 0) {
    return c.json({ ok: false, error: 'files array required' }, 400);
  }

  const pathCheck = validateWorkspacePath(rootPath);
  if (!pathCheck.valid) {
    return c.json({ ok: false, error: pathCheck.reason }, 403);
  }

  const cwd = pathCheck.resolved;

  try {
    // 1. Unstage everything
    const resetResult = await run(['git', 'reset', 'HEAD'], { cwd });
    if (resetResult.exitCode !== 0) {
      return c.json({ ok: false, error: `git reset failed: ${resetResult.stderr.trim()}` }, 500);
    }

    // 2. Stage only the group's files.
    //    Use --ignore-errors so one bad path doesn't block the whole group.
    //    Step 3 verifies at least something was staged.
    console.log('[git/commit-group] Staging %d files:', files.length, files);
    const addResult = await run(['git', 'add', '--ignore-errors', '--', ...files], { cwd });
    if (addResult.stderr.trim()) {
      // Log warnings (e.g. "pathspec 'x' did not match") but don't fail yet —
      // step 3 checks whether anything was actually staged.
      console.warn('[git/commit-group] git add warnings:', addResult.stderr.trim());
    }

    // 3. Verify something is actually staged (catches bad file paths)
    const stagedExit = await runExitCode(['git', 'diff', '--cached', '--quiet'], { cwd });
    if (stagedExit === 0) {
      return c.json(
        {
          ok: false,
          error: `Nothing staged after adding files — pathspecs may be wrong.\nFiles attempted: ${files.join(', ')}`,
        },
        400,
      );
    }

    // 4. Commit
    const commitArgs = [
      'git',
      'commit',
      ...(noVerify ? ['--no-verify'] : []),
      '-m',
      message.trim(),
    ];
    console.log(
      '[git/commit-group] Running: git commit -m "%s" (%d files, noVerify=%s)',
      message.trim(),
      files.length,
      !!noVerify,
    );
    const commitResult = await run(commitArgs, { cwd });
    if (commitResult.exitCode !== 0) {
      const summary = parseCommitFailure(commitResult.stderr, commitResult.stdout);
      return c.json({ ok: false, error: summary }, 500);
    }

    // 5. Get the new HEAD sha
    const shaResult = await run(['git', 'rev-parse', 'HEAD'], { cwd });
    const sha = shaResult.stdout.trim();
    console.log('[git/commit-group] Success! SHA:', sha);

    return c.json({ ok: true, data: { sha } });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// Generate a commit message from the current diff
app.post('/generate-commit-message', async (c) => {
  const body = await c.req.json();
  const { path: rootPath } = body;

  if (!rootPath) return c.json({ ok: false, error: 'path required' }, 400);

  const pathCheck = validateWorkspacePath(rootPath);
  if (!pathCheck.valid) {
    return c.json({ ok: false, error: pathCheck.reason }, 403);
  }

  try {
    // Get staged + unstaged diff
    const diffResult = await run(['git', 'diff', 'HEAD'], { cwd: pathCheck.resolved });
    let diffText = diffResult.stdout;

    // Also capture untracked file names
    const untrackedResult = await run(['git', 'ls-files', '--others', '--exclude-standard'], {
      cwd: pathCheck.resolved,
    });
    const untrackedFiles = untrackedResult.stdout.trim();

    if (!diffText.trim() && !untrackedFiles) {
      return c.json({ ok: false, error: 'No changes to describe' }, 400);
    }

    // Truncate very large diffs to avoid blowing the context
    const MAX_DIFF_CHARS = 12_000;
    if (diffText.length > MAX_DIFF_CHARS) {
      diffText = diffText.slice(0, MAX_DIFF_CHARS) + '\n\n... [diff truncated]';
    }

    let prompt = '';
    if (diffText.trim()) {
      prompt += `Git diff:\n\`\`\`\n${diffText}\n\`\`\`\n`;
    }
    if (untrackedFiles) {
      prompt += `\nNew untracked files:\n${untrackedFiles}\n`;
    }

    const message = await callLlm({
      system:
        'You generate concise git commit messages. Output ONLY the commit message, nothing else. ' +
        'Use the imperative mood (e.g. "Add feature" not "Added feature"). ' +
        'Keep it to one line, under 72 characters if possible. ' +
        'If the changes are substantial, add a blank line followed by a brief body (2-3 bullet points max).',
      user: prompt,
      // Let the configured CLI provider use its default model — avoids
      // hardcoding a model ID that may not exist for all providers.
      timeoutMs: 30_000,
    });

    return c.json({ ok: true, data: { message: message.trim() } });
  } catch (err) {
    console.error('[git/generate-commit-message] LLM call failed:', err);
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

export default app;
