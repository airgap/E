import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { run, runExitCode, validateWorkspacePath } from './helpers';

const app = new Hono();

// Stage files
app.post('/stage', async (c) => {
  const body = await c.req.json();
  const { path: rootPath, files } = body;

  if (!rootPath) return c.json({ ok: false, error: 'path required' }, 400);

  const pathCheck = validateWorkspacePath(rootPath);
  if (!pathCheck.valid) {
    return c.json({ ok: false, error: pathCheck.reason }, 403);
  }

  try {
    // If no files specified, stage all
    const args =
      files && Array.isArray(files) && files.length > 0
        ? ['git', 'add', '--', ...files]
        : ['git', 'add', '-A'];

    const { stderr, exitCode } = await run(args, { cwd: pathCheck.resolved });

    if (exitCode !== 0) {
      return c.json({ ok: false, error: `git add failed: ${stderr.trim()}` }, 500);
    }

    return c.json({ ok: true });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// Unstage files
app.post('/unstage', async (c) => {
  const body = await c.req.json();
  const { path: rootPath, files } = body;

  if (!rootPath) return c.json({ ok: false, error: 'path required' }, 400);

  const pathCheck = validateWorkspacePath(rootPath);
  if (!pathCheck.valid) {
    return c.json({ ok: false, error: pathCheck.reason }, 403);
  }

  try {
    // If no files specified, unstage all
    const args =
      files && Array.isArray(files) && files.length > 0
        ? ['git', 'reset', 'HEAD', '--', ...files]
        : ['git', 'reset', 'HEAD'];

    const { stderr, exitCode } = await run(args, { cwd: pathCheck.resolved });

    // git reset exits 0 even when there's nothing to unstage
    if (exitCode !== 0) {
      return c.json({ ok: false, error: `git reset failed: ${stderr.trim()}` }, 500);
    }

    return c.json({ ok: true });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// Discard all uncommitted changes
app.post('/clean', async (c) => {
  const body = await c.req.json();
  const { path: rootPath } = body;

  if (!rootPath) return c.json({ ok: false, error: 'path required' }, 400);

  const pathCheck = validateWorkspacePath(rootPath);
  if (!pathCheck.valid) {
    return c.json({ ok: false, error: pathCheck.reason }, 403);
  }

  try {
    // Log status BEFORE clean
    const beforeStatusResult = await run(['git', 'status', '--porcelain'], {
      cwd: pathCheck.resolved,
    });
    const beforeStatus = beforeStatusResult.stdout;
    console.log('[git/clean] Status BEFORE clean:', beforeStatus);

    // Unstage everything first — handles files left in the index after a failed commit
    const resetResult = await run(['git', 'reset', 'HEAD'], { cwd: pathCheck.resolved });
    if (resetResult.exitCode !== 0) {
      console.warn('[git/clean] git reset HEAD failed (non-fatal):', resetResult.stderr.trim());
    }

    // Restore tracked files
    const checkoutResult = await run(['git', 'checkout', '--', '.'], { cwd: pathCheck.resolved });
    if (checkoutResult.exitCode !== 0) {
      console.warn('[git/clean] git checkout -- . failed:', checkoutResult.stderr.trim());
    }

    // Remove untracked files and directories
    const cleanResult = await run(['git', 'clean', '-fd'], { cwd: pathCheck.resolved });
    if (cleanResult.exitCode !== 0) {
      console.warn('[git/clean] git clean -fd failed:', cleanResult.stderr.trim());
    }

    // Log status AFTER clean
    const afterStatusResult = await run(['git', 'status', '--porcelain'], {
      cwd: pathCheck.resolved,
    });
    const afterStatus = afterStatusResult.stdout;
    console.log('[git/clean] Status AFTER clean:', afterStatus);

    const stillDirty = afterStatus.trim().length > 0;
    if (stillDirty) {
      console.warn(
        '[git/clean] WARNING: Working tree still has changes after clean:',
        afterStatus.trim(),
      );
    }

    return c.json({
      ok: true,
      data: {
        cleaned: true,
        beforeFileCount: beforeStatus.trim() ? beforeStatus.trim().split('\n').length : 0,
        afterFileCount: afterStatus.trim() ? afterStatus.trim().split('\n').length : 0,
        fullyClean: !stillDirty,
      },
    });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// Push to remote
app.post('/push', async (c) => {
  const body = await c.req.json();
  const { path: rootPath, remote, branch } = body;

  if (!rootPath) return c.json({ ok: false, error: 'path required' }, 400);

  const pathCheck = validateWorkspacePath(rootPath);
  if (!pathCheck.valid) {
    return c.json({ ok: false, error: pathCheck.reason }, 403);
  }

  try {
    // Get current branch if not specified
    let targetBranch = branch;
    if (!targetBranch) {
      const branchResult = await run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: pathCheck.resolved,
      });
      targetBranch = branchResult.stdout.trim();
      if (branchResult.exitCode !== 0 || !targetBranch) {
        return c.json({ ok: false, error: 'Could not determine current branch' }, 500);
      }
    }

    // Push to remote (defaults to 'origin' if not specified)
    const targetRemote = remote || 'origin';
    const pushResult = await run(['git', 'push', targetRemote, targetBranch], {
      cwd: pathCheck.resolved,
    });

    if (pushResult.exitCode !== 0) {
      // Check if it's an upstream tracking error
      if (
        pushResult.stderr.includes('no upstream branch') ||
        pushResult.stderr.includes('has no upstream')
      ) {
        // Try push with --set-upstream
        const upstreamResult = await run(
          ['git', 'push', '--set-upstream', targetRemote, targetBranch],
          { cwd: pathCheck.resolved },
        );
        if (upstreamResult.exitCode !== 0) {
          return c.json(
            { ok: false, error: upstreamResult.stderr.trim() || 'git push failed' },
            500,
          );
        }
        return c.json({ ok: true, data: { pushed: true, setUpstream: true } });
      }
      return c.json({ ok: false, error: pushResult.stderr.trim() || 'git push failed' }, 500);
    }

    return c.json({ ok: true, data: { pushed: true, setUpstream: false } });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// Streaming push endpoint with real-time output
app.post('/push/stream', async (c) => {
  const body = await c.req.json();
  const { path: rootPath, remote, branch } = body;

  if (!rootPath) return c.json({ ok: false, error: 'path required' }, 400);

  const pathCheck = validateWorkspacePath(rootPath);
  if (!pathCheck.valid) {
    return c.json({ ok: false, error: pathCheck.reason }, 403);
  }

  return streamSSE(c, async (stream) => {
    try {
      await stream.writeSSE({
        data: JSON.stringify({ type: 'status', message: 'Determining branch...' }),
      });

      // Get current branch if not specified
      let targetBranch = branch;
      if (!targetBranch) {
        const branchResult = await run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], {
          cwd: pathCheck.resolved,
        });
        targetBranch = branchResult.stdout.trim();
        if (branchResult.exitCode !== 0 || !targetBranch) {
          await stream.writeSSE({
            data: JSON.stringify({ type: 'error', message: 'Could not determine current branch' }),
          });
          return;
        }
      }

      const targetRemote = remote || 'origin';
      await stream.writeSSE({
        data: JSON.stringify({
          type: 'status',
          message: `Pushing ${targetBranch} to ${targetRemote}...`,
        }),
      });

      // Push to remote with streaming output
      const pushProc = Bun.spawn(['git', 'push', targetRemote, targetBranch], {
        cwd: pathCheck.resolved,
        stdout: 'pipe',
        stderr: 'pipe',
      });

      // Use separate decoders per stream to avoid corrupting multi-byte state
      const readStream = async (readable: ReadableStream): Promise<string> => {
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

      // Read both streams concurrently to prevent deadlock
      const outputs: Promise<string>[] = [];
      outputs.push(readStream(pushProc.stdout));
      outputs.push(readStream(pushProc.stderr));

      const [pushOut, pushErr] = await Promise.all(outputs);
      const pushExit = await pushProc.exited;

      if (pushExit !== 0) {
        // Check if it's an upstream tracking error
        if (pushErr.includes('no upstream branch') || pushErr.includes('has no upstream')) {
          await stream.writeSSE({
            data: JSON.stringify({
              type: 'status',
              message: 'Setting upstream and pushing...',
            }),
          });

          // Try push with --set-upstream
          const upstreamProc = Bun.spawn(
            ['git', 'push', '--set-upstream', targetRemote, targetBranch],
            {
              cwd: pathCheck.resolved,
              stdout: 'pipe',
              stderr: 'pipe',
            },
          );

          const upstreamOutputs: Promise<string>[] = [];
          upstreamOutputs.push(readStream(upstreamProc.stdout));
          upstreamOutputs.push(readStream(upstreamProc.stderr));

          await Promise.all(upstreamOutputs);
          const upstreamExit = await upstreamProc.exited;

          if (upstreamExit !== 0) {
            await stream.writeSSE({
              data: JSON.stringify({
                type: 'error',
                message: 'Push failed - check output above',
              }),
            });
            return;
          }

          await stream.writeSSE({
            data: JSON.stringify({
              type: 'complete',
              message: 'Push successful (upstream set)!',
              setUpstream: true,
            }),
          });
          return;
        }

        await stream.writeSSE({
          data: JSON.stringify({ type: 'error', message: 'Push failed - check output above' }),
        });
        return;
      }

      await stream.writeSSE({
        data: JSON.stringify({ type: 'complete', message: 'Push successful!', setUpstream: false }),
      });
    } catch (err) {
      await stream.writeSSE({
        data: JSON.stringify({ type: 'error', message: String(err) }),
      });
    }
  });
});

export default app;
