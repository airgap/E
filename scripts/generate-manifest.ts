/**
 * generate-manifest.ts
 *
 * Scans a release-artifacts/ directory and produces a latest.json manifest
 * with per-file metadata (name, size, sha256, platform, arch, type).
 *
 * Usage:
 *   bun scripts/generate-manifest.ts <version> [--artifacts <dir>] [--out <file>] [--url-prefix <url>]
 *
 * Example:
 *   bun scripts/generate-manifest.ts v0.1.0
 *   bun scripts/generate-manifest.ts v0.1.0 --artifacts release-artifacts --out latest.json
 */

import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname!, '..');

// ── Parse args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const version = args[0];
if (!version) {
  console.error(
    'Usage: bun scripts/generate-manifest.ts <version> [--artifacts <dir>] [--out <file>]',
  );
  process.exit(1);
}

function argVal(flag: string, fallback: string): string {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}

const artifactsDir = resolve(argVal('--artifacts', join(root, 'release-artifacts')));
const outFile = resolve(argVal('--out', join(artifactsDir, 'latest.json')));
const urlPrefix = argVal('--url-prefix', `https://releases.script.dev/releases/${version}`);

// ── Artifact identification ─────────────────────────────────────────────────
interface ArtifactMeta {
  id: string;
  name: string;
  platform: string;
  arch: string;
  type: 'desktop' | 'standalone';
  format: string;
}

function identifyArtifact(filename: string): ArtifactMeta | null {
  const lower = filename.toLowerCase();

  // Desktop installers
  if (lower.endsWith('.deb')) {
    return {
      id: 'deb',
      name: filename,
      platform: 'linux',
      arch: 'x64',
      type: 'desktop',
      format: 'deb',
    };
  }
  if (lower.endsWith('.rpm')) {
    return {
      id: 'rpm',
      name: filename,
      platform: 'linux',
      arch: 'x64',
      type: 'desktop',
      format: 'rpm',
    };
  }
  if (lower.endsWith('.appimage')) {
    return {
      id: 'appimage',
      name: filename,
      platform: 'linux',
      arch: 'x64',
      type: 'desktop',
      format: 'AppImage',
    };
  }
  if (lower.endsWith('.dmg')) {
    return {
      id: 'dmg',
      name: filename,
      platform: 'macos',
      arch: 'arm64',
      type: 'desktop',
      format: 'dmg',
    };
  }
  if (lower.endsWith('-setup.exe') || (lower.match(/\.exe$/i) && lower.includes('setup'))) {
    return {
      id: 'exe',
      name: filename,
      platform: 'windows',
      arch: 'x64',
      type: 'desktop',
      format: 'exe',
    };
  }
  if (lower.endsWith('.msi')) {
    return {
      id: 'msi',
      name: filename,
      platform: 'windows',
      arch: 'x64',
      type: 'desktop',
      format: 'msi',
    };
  }

  // Standalone server binaries
  if (lower === 'e-linux-x64' || lower.startsWith('e-linux-x64')) {
    return {
      id: 'standalone-linux',
      name: filename,
      platform: 'linux',
      arch: 'x64',
      type: 'standalone',
      format: 'binary',
    };
  }
  if (lower === 'e-darwin-arm64' || lower.startsWith('e-darwin-arm64')) {
    return {
      id: 'standalone-darwin-arm64',
      name: filename,
      platform: 'macos',
      arch: 'arm64',
      type: 'standalone',
      format: 'binary',
    };
  }
  if (lower === 'e-darwin-x64' || lower.startsWith('e-darwin-x64')) {
    return {
      id: 'standalone-darwin-x64',
      name: filename,
      platform: 'macos',
      arch: 'x64',
      type: 'standalone',
      format: 'binary',
    };
  }
  if (lower === 'e-windows-x64.exe' || lower.startsWith('e-windows-x64')) {
    return {
      id: 'standalone-windows',
      name: filename,
      platform: 'windows',
      arch: 'x64',
      type: 'standalone',
      format: 'exe',
    };
  }

  return null;
}

function sha256(filepath: string): string {
  const data = readFileSync(filepath);
  return createHash('sha256').update(data).digest('hex');
}

// ── Scan artifacts ──────────────────────────────────────────────────────────
console.log(`Scanning: ${artifactsDir}`);

const files: any[] = [];
const entries = readdirSync(artifactsDir).filter((f) => !f.startsWith('.') && f !== 'latest.json');

for (const entry of entries) {
  const filepath = join(artifactsDir, entry);
  const stat = statSync(filepath);
  if (!stat.isFile()) continue;

  const meta = identifyArtifact(entry);
  if (!meta) {
    console.warn(`  ⚠ Skipping unrecognized file: ${entry}`);
    continue;
  }

  console.log(`  ✓ ${meta.id}: ${entry} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);

  files.push({
    id: meta.id,
    name: meta.name,
    url: `${urlPrefix}/${meta.name}`,
    size: stat.size,
    sha256: sha256(filepath),
    platform: meta.platform,
    arch: meta.arch,
    type: meta.type,
    format: meta.format,
  });
}

// ── Write manifest ──────────────────────────────────────────────────────────
const manifest = {
  version: version.replace(/^v/, ''),
  tag: version,
  date: new Date().toISOString().split('T')[0],
  files,
};

writeFileSync(outFile, JSON.stringify(manifest, null, 2) + '\n');
console.log(`\nManifest written: ${outFile}`);
console.log(`  ${files.length} artifacts, version ${manifest.version}`);
