/**
 * publish-github-release.ts
 *
 * Create (or update) a GitHub release for the given tag and upload every
 * artifact from `--artifacts` to it. Tolerant of missing files: if a
 * platform's build didn't run (e.g. Windows rig offline), its artifacts
 * simply aren't uploaded and the release still publishes with whatever's
 * present.
 *
 * Usage:
 *   bun scripts/publish-github-release.ts v0.1.0
 *   bun scripts/publish-github-release.ts v0.1.0 --artifacts release-artifacts --notes-from HEAD~5..HEAD
 *
 * Requires:
 *   - `gh` CLI on PATH, authenticated with repo write scope (GH_TOKEN env
 *     or `gh auth login`)
 *   - The tag must already exist on origin (or will be created by gh from
 *     the local commit if --target is passed)
 */

import { readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { execSync, spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const tag = args[0];
if (!tag || tag.startsWith('-')) {
  console.error(
    'Usage: bun scripts/publish-github-release.ts <tag> [--artifacts <dir>] [--notes-from <rev-range>] [--repo <owner/repo>] [--draft] [--prerelease]',
  );
  process.exit(1);
}

function argOf(key: string, fallback?: string): string | undefined {
  const i = args.indexOf(key);
  return i >= 0 ? args[i + 1] : fallback;
}
function hasFlag(key: string): boolean {
  return args.includes(key);
}

const artifactsDir = resolve(argOf('--artifacts', 'release-artifacts')!);
const notesRange = argOf('--notes-from');
const repoFlag = argOf('--repo');
const draft = hasFlag('--draft');
const prerelease = hasFlag('--prerelease');

// ── gh binary + auth check ──────────────────────────────────────────────────
try {
  execSync('gh --version', { stdio: 'ignore' });
} catch {
  console.error('gh CLI not found on PATH. Install: https://cli.github.com/');
  process.exit(1);
}

// Auth: prefer GH_TOKEN env, fall back to `gh auth status`.
if (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
  const auth = spawnSync('gh', ['auth', 'status'], { stdio: 'pipe' });
  if (auth.status !== 0) {
    console.error('gh is not authenticated. Set GH_TOKEN or run `gh auth login`.');
    process.exit(1);
  }
}

// ── Collect artifacts ───────────────────────────────────────────────────────
if (!existsSync(artifactsDir)) {
  console.error(`Artifacts directory not found: ${artifactsDir}`);
  process.exit(1);
}

const artifacts = readdirSync(artifactsDir)
  .map((f) => join(artifactsDir, f))
  .filter((p) => statSync(p).isFile());

if (artifacts.length === 0) {
  console.error(`No artifacts in ${artifactsDir} — nothing to release. Exiting.`);
  process.exit(1);
}

console.log(`Publishing release ${tag} with ${artifacts.length} artifact(s):`);
for (const a of artifacts) {
  const sizeMb = (statSync(a).size / 1024 / 1024).toFixed(1);
  console.log(`  - ${basename(a)} (${sizeMb} MB)`);
}

// ── Release notes ───────────────────────────────────────────────────────────
let notes = `Release ${tag}`;
if (notesRange) {
  try {
    const log = execSync(`git log --pretty=format:'- %s' ${notesRange}`, {
      encoding: 'utf-8',
    }).trim();
    if (log) notes = `## Changes\n\n${log}`;
  } catch (err) {
    console.warn(`Could not generate notes from ${notesRange}:`, err);
  }
}

// Report which platforms are represented so the release body says so.
const hasLinux = artifacts.some((a) => /\.(deb|rpm|AppImage)$|-linux-/i.test(a));
const hasMac = artifacts.some((a) => /\.(dmg|app\.tar\.gz)$|-darwin-|-macos-/i.test(a));
const hasWindows = artifacts.some((a) => /\.(exe|msi)$|-windows-/i.test(a));
const platforms: string[] = [];
if (hasLinux) platforms.push('Linux');
if (hasMac) platforms.push('macOS');
if (hasWindows) platforms.push('Windows');
if (platforms.length) {
  notes = `${notes}\n\n_Binaries: ${platforms.join(', ')}_`;
}
if (!hasWindows) {
  console.warn('⚠ Windows artifacts missing — publishing release without them.');
}

// ── Create-or-update the release, then upload artifacts ─────────────────────
const ghArgs: string[] = ['release'];
const repoArgs = repoFlag ? ['-R', repoFlag] : [];

// Does the release already exist?
const existsResult = spawnSync('gh', [...ghArgs, 'view', tag, ...repoArgs], {
  stdio: 'ignore',
});
const exists = existsResult.status === 0;

if (exists) {
  console.log(`Release ${tag} already exists — uploading artifacts with --clobber.`);
  const up = spawnSync('gh', ['release', 'upload', tag, ...artifacts, '--clobber', ...repoArgs], {
    stdio: 'inherit',
  });
  if (up.status !== 0) {
    console.error('gh release upload failed.');
    process.exit(up.status ?? 1);
  }
} else {
  const createArgs = [
    'release',
    'create',
    tag,
    ...artifacts,
    '--title',
    tag,
    '--notes',
    notes,
    ...repoArgs,
  ];
  if (draft) createArgs.push('--draft');
  if (prerelease) createArgs.push('--prerelease');
  const create = spawnSync('gh', createArgs, { stdio: 'inherit' });
  if (create.status !== 0) {
    console.error('gh release create failed.');
    process.exit(create.status ?? 1);
  }
}

console.log(`Release ${tag} published successfully.`);
