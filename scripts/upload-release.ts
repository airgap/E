/**
 * upload-release.ts
 *
 * Uploads release artifacts to Cloudflare R2 and publishes a latest.json manifest.
 *
 * Usage:
 *   bun scripts/upload-release.ts <version> [--artifacts <dir>] [--bucket <name>]
 *
 * Prerequisites:
 *   - `wrangler` authenticated (CLOUDFLARE_API_TOKEN env or `wrangler login`)
 *   - CLOUDFLARE_ACCOUNT_ID environment variable set
 *
 * Example:
 *   bun scripts/upload-release.ts v0.1.0
 *   bun scripts/upload-release.ts v0.1.0 --artifacts ./release-artifacts --bucket e-releases
 */

import { readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execSync } from 'node:child_process';

const root = resolve(import.meta.dirname!, '..');

// ── Parse args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const version = args[0];
if (!version) {
  console.error(
    'Usage: bun scripts/upload-release.ts <version> [--artifacts <dir>] [--bucket <name>]',
  );
  process.exit(1);
}

function argVal(flag: string, fallback: string): string {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}

const artifactsDir = resolve(argVal('--artifacts', join(root, 'release-artifacts')));
const bucket = argVal('--bucket', 'e-releases');

if (!existsSync(artifactsDir)) {
  console.error(`Artifacts directory not found: ${artifactsDir}`);
  process.exit(1);
}

// ── Validate wrangler ───────────────────────────────────────────────────────
try {
  execSync('wrangler --version', { stdio: 'pipe' });
} catch {
  console.error('wrangler CLI not found. Install with: bun add -g wrangler');
  process.exit(1);
}

if (!process.env.CLOUDFLARE_ACCOUNT_ID) {
  console.warn('⚠ CLOUDFLARE_ACCOUNT_ID not set — wrangler may prompt or use default account');
}

// ── Generate manifest first ─────────────────────────────────────────────────
console.log('');
console.log('╔══════════════════════════════════════╗');
console.log('║   E — Upload Release to R2           ║');
console.log('╚══════════════════════════════════════╝');
console.log('');
console.log(`  Version:    ${version}`);
console.log(`  Artifacts:  ${artifactsDir}`);
console.log(`  Bucket:     ${bucket}`);
console.log('');

// Generate manifest
console.log('▸ Generating manifest…');
execSync(
  `bun ${join(root, 'scripts', 'generate-manifest.ts')} ${version} --artifacts ${artifactsDir}`,
  { stdio: 'inherit', cwd: root },
);
console.log('');

// ── Upload artifacts ────────────────────────────────────────────────────────
const files = readdirSync(artifactsDir).filter((f) => !f.startsWith('.'));

function r2Put(localPath: string, r2Key: string) {
  const cmd = `wrangler r2 object put "${bucket}/${r2Key}" --file "${localPath}"`;
  console.log(`  ↑ ${r2Key}`);
  try {
    execSync(cmd, { stdio: 'pipe', cwd: root });
  } catch (err: any) {
    console.error(`    ✗ Failed: ${err.stderr?.toString().trim() || err.message}`);
    throw err;
  }
}

console.log('▸ Uploading artifacts…');
let uploaded = 0;

for (const file of files) {
  const filepath = join(artifactsDir, file);
  const stat = statSync(filepath);
  if (!stat.isFile()) continue;

  const r2Key = `releases/${version}/${file}`;
  r2Put(filepath, r2Key);
  uploaded++;
}

// ── Upload manifest as latest.json ──────────────────────────────────────────
console.log('\n▸ Publishing manifest…');
const manifestPath = join(artifactsDir, 'latest.json');
r2Put(manifestPath, 'releases/latest.json');

// Also store a versioned copy
r2Put(manifestPath, `releases/${version}/manifest.json`);

console.log('');
console.log(`Done! Uploaded ${uploaded} artifacts + manifest for ${version}`);
console.log('');
console.log(`  Download page: https://script.dev/E`);
console.log(`  Manifest:      https://releases.script.dev/releases/latest.json`);
console.log('');
