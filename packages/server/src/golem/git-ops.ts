// ---------------------------------------------------------------------------
// Golem Git Operations — clone, commit, push for headless golem execution
// ---------------------------------------------------------------------------

import { GolemLogger } from './logger.js';

/**
 * Perform a shallow git clone of the repository.
 * Uses --depth=1 for speed, and checks out the specified branch.
 */
export async function shallowClone(
  repoUrl: string,
  branch: string,
  targetDir: string,
  logger: GolemLogger,
): Promise<void> {
  logger.info('clone', `Cloning ${repoUrl} (branch: ${branch}) into ${targetDir}`);

  const proc = Bun.spawn(
    ['git', 'clone', '--depth=1', '--branch', branch, '--single-branch', repoUrl, targetDir],
    {
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0', // Non-interactive
      },
    },
  );

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    const output = (stdout + '\n' + stderr).trim();
    logger.error('clone', `Clone failed (exit ${exitCode}): ${output.slice(0, 1000)}`);
    throw new Error(`Git clone failed with exit code ${exitCode}: ${output.slice(0, 500)}`);
  }

  logger.info('clone', 'Clone completed successfully');
}

/**
 * Create and checkout a new branch for the golem's work.
 */
export async function createBranch(
  cwd: string,
  branchName: string,
  logger: GolemLogger,
): Promise<void> {
  logger.info('commit', `Creating branch: ${branchName}`);

  const proc = Bun.spawn(['git', 'checkout', '-b', branchName], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    const output = (stdout + '\n' + stderr).trim();
    logger.error('commit', `Branch creation failed: ${output.slice(0, 500)}`);
    throw new Error(`Failed to create branch ${branchName}: ${output.slice(0, 500)}`);
  }
}

/**
 * Check if there are uncommitted changes in the working directory.
 */
export async function hasChanges(cwd: string): Promise<boolean> {
  const proc = Bun.spawn(['git', 'status', '--porcelain'], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const output = (await new Response(proc.stdout).text()).trim();
  await proc.exited;
  return output.length > 0;
}

/**
 * Stage all changes and create a commit.
 */
export async function commitChanges(
  cwd: string,
  message: string,
  logger: GolemLogger,
): Promise<string | null> {
  // Stage all changes
  const addProc = Bun.spawn(['git', 'add', '-A'], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  await addProc.exited;

  // Check if there's anything to commit
  if (!(await hasChanges(cwd))) {
    logger.info('commit', 'No changes to commit');
    return null;
  }

  // Create commit
  const commitProc = Bun.spawn(
    ['git', 'commit', '-m', message, '--author', 'E Golem <golem@e-work.dev>'],
    {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(commitProc.stdout).text(),
    new Response(commitProc.stderr).text(),
    commitProc.exited,
  ]);

  if (exitCode !== 0) {
    const output = (stdout + '\n' + stderr).trim();
    logger.error('commit', `Commit failed: ${output.slice(0, 500)}`);
    throw new Error(`Git commit failed: ${output.slice(0, 500)}`);
  }

  // Get the commit SHA
  const shaProc = Bun.spawn(['git', 'rev-parse', 'HEAD'], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const sha = (await new Response(shaProc.stdout).text()).trim();
  await shaProc.exited;

  logger.info('commit', `Committed: ${sha.slice(0, 8)}`, { commitSha: sha });
  return sha;
}

/**
 * Push the current branch to the remote.
 */
export async function pushBranch(
  cwd: string,
  branchName: string,
  logger: GolemLogger,
  force = false,
): Promise<void> {
  logger.info('push', `Pushing branch ${branchName} to origin`);

  const args = ['git', 'push', '-u', 'origin', branchName];
  if (force) args.splice(2, 0, '--force-with-lease');

  const proc = Bun.spawn(args, {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
    },
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    const output = (stdout + '\n' + stderr).trim();
    logger.error('push', `Push failed (exit ${exitCode}): ${output.slice(0, 1000)}`);
    throw new Error(`Git push failed: ${output.slice(0, 500)}`);
  }

  logger.info('push', 'Push completed successfully');
}

/**
 * Configure git user for commits in the working directory.
 */
export async function configureGitUser(cwd: string): Promise<void> {
  await Bun.spawn(['git', 'config', 'user.name', 'E Golem'], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  }).exited;

  await Bun.spawn(['git', 'config', 'user.email', 'golem@e-work.dev'], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  }).exited;
}
