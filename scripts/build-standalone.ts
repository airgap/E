/**
 * build-standalone.ts
 *
 * Builds a self-contained "standalone" distribution of E — a single binary
 * (packages/server compiled with Bun) plus a co-located client/ folder of
 * static assets.  The resulting layout is:
 *
 *   dist/standalone/
 *     e              ← compiled Bun binary (Linux/macOS) / e.exe (Windows)
 *     client/        ← SvelteKit static build (copied from packages/client/build)
 *
 * Usage:
 *   bun run scripts/build-standalone.ts [--outdir <path>]
 *
 * The binary auto-detects client/ next to itself at runtime via CLIENT_DIST,
 * so no environment variable is required when running from the dist directory.
 *
 * Run the result:
 *   ./dist/standalone/e                   # serves on port 3002
 *   PORT=8080 ./dist/standalone/e         # custom port
 *   OPEN=1 ./dist/standalone/e            # also opens browser tab
 */

import { existsSync, cpSync, mkdirSync, rmSync, chmodSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { execSync } from 'node:child_process';

const root = resolve(import.meta.dirname!, '..');
const clientBuild = join(root, 'packages', 'client', 'build');
const serverEntry = join(root, 'packages', 'server', 'src', 'standalone.ts');
// Launcher icon, shipped next to the binary as `e.png` so `e install-desktop`
// can reference it from the freedesktop `.desktop` entry.
const iconSrc = join(root, 'src-tauri', 'icons', 'icon.png');

// Allow overriding the output directory
const outDirArg = process.argv.indexOf('--outdir');
const outDir =
  outDirArg !== -1 ? resolve(process.argv[outDirArg + 1]) : join(root, 'dist', 'standalone');

// Platform-suffixed binary name for release artifacts
function platformSuffix(): string {
  const platform =
    process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'windows' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  return `${platform}-${arch}`;
}

const suffix = platformSuffix();
const ext = process.platform === 'win32' ? '.exe' : '';
const binaryName = `e-${suffix}${ext}`;
const binaryOut = join(outDir, binaryName);
const clientOut = join(outDir, 'client');

console.log('');
console.log('╔══════════════════════════════════════╗');
console.log('║   E — standalone build               ║');
console.log('╚══════════════════════════════════════╝');
console.log('');
console.log(`  Output directory: ${outDir}`);
console.log('');

// ── 1. Build client ──────────────────────────────────────────────────────────
console.log('▸ Building client (SvelteKit)…');
execSync('bun run --filter @e/client build', { stdio: 'inherit', cwd: root });
console.log('  ✓ Client built\n');

// ── 2. Compile server binary ─────────────────────────────────────────────────
console.log('▸ Compiling server binary…');
mkdirSync(outDir, { recursive: true });
// Same --external list as packages/server/package.json's `build:binary`:
// playwright (+ its optional deps) are lazy-imported behind a flag and
// aren't reachable from the server boot path, so stripping them is safe
// and avoids a resolution failure for their optional dependencies.
execSync(
  `bun build ${serverEntry} --compile --external playwright --external playwright-core --external electron --external chromium-bidi --outfile ${binaryOut}`,
  { stdio: 'inherit', cwd: root },
);
console.log(`  ✓ Binary: ${binaryOut}\n`);

// ── 3. Copy client build next to binary ─────────────────────────────────────
console.log('▸ Copying client assets…');
if (existsSync(clientOut)) rmSync(clientOut, { recursive: true, force: true });
cpSync(clientBuild, clientOut, { recursive: true });
console.log(`  ✓ Client: ${clientOut}\n`);

// ── 3b. Copy launcher icon next to binary ───────────────────────────────────
if (existsSync(iconSrc)) {
  cpSync(iconSrc, join(outDir, 'e.png'));
  console.log(`  ✓ Icon: ${join(outDir, 'e.png')}\n`);
} else {
  console.log(`  ⚠ Icon not found at ${iconSrc}; launcher entry will have no icon\n`);
}

// ── 4. Ensure binary is executable ──────────────────────────────────────────
if (process.platform !== 'win32') {
  chmodSync(binaryOut, 0o755);
}

// ── 5. Package binary + client into a tarball so installers pull one file ───
// Layout inside the archive:
//   e-<platform>-<arch>/
//     e              (or e.exe)
//     client/        SvelteKit static build
// Installers extract this into `~/.e/<platform>-<arch>/` then symlink
// the binary into `~/.e/bin/e`. Windows gets a zip because `tar` under
// MinGW/PowerShell is inconsistent across versions.
//
// Stage the archive contents under `outDir/pkg/<stageName>/` so the stage
// dir doesn't collide with `outDir/e-<platform>` (the raw binary).
console.log('▸ Packaging release archive…');
const stageName = `e-${suffix}`;
const pkgDir = join(outDir, 'pkg');
const stageDir = join(pkgDir, stageName);
if (existsSync(stageDir)) rmSync(stageDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });
cpSync(binaryOut, join(stageDir, `e${ext}`));
if (process.platform !== 'win32') chmodSync(join(stageDir, 'e'), 0o755);
cpSync(clientOut, join(stageDir, 'client'), { recursive: true });
if (existsSync(iconSrc)) cpSync(iconSrc, join(stageDir, 'e.png'));

if (process.platform === 'win32') {
  const zipName = `${stageName}.zip`;
  // PowerShell ships with Compress-Archive on every Windows 10/11.
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Force -Path '${stageDir}\\*' -DestinationPath '${join(outDir, zipName)}'"`,
    { stdio: 'inherit' },
  );
  console.log(`  ✓ Archive: ${join(outDir, zipName)}\n`);
} else {
  const tarName = `${stageName}.tar.gz`;
  // Tar from pkg/ so the archive's top-level entry is `e-<platform>/`,
  // not `pkg/e-<platform>/`.
  execSync(`tar -czf ../${tarName} ${basename(stageDir)}`, {
    stdio: 'inherit',
    cwd: pkgDir,
  });
  console.log(`  ✓ Archive: ${join(outDir, tarName)}\n`);
}

// Leave the un-tarred stageDir in place too — convenient for local testing,
// ignored by the Jenkins stash which only picks up the tarball/zip.

// ── 6. Done ──────────────────────────────────────────────────────────────────
console.log('Done!');
console.log('');
console.log('  Run:');
console.log(`    ${binaryOut}`);
console.log('');
console.log('  Options:');
console.log('    PORT=8080       custom port  (default 3002)');
console.log('    OPEN=1          open browser on start');
console.log('');
