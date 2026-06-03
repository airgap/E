/**
 * build-standalone.ts
 *
 * Builds self-contained "standalone" distributions of E — a single binary
 * (packages/server compiled with Bun) plus a co-located client/ folder of
 * static assets. Per target the layout inside the release archive is:
 *
 *   e-<platform>-<arch>/
 *     e              (or e.exe on Windows)   compiled Bun binary
 *     client/        SvelteKit static build
 *     e.png          launcher icon
 *
 * Usage:
 *   bun run scripts/build-standalone.ts                 # host platform only
 *   bun run scripts/build-standalone.ts --all           # all release targets
 *   bun run scripts/build-standalone.ts --targets darwin-arm64,linux-x64
 *   bun run scripts/build-standalone.ts --outdir <path>
 *
 * Cross-compilation is done by Bun (`bun build --compile --target=bun-<t>`), so
 * every target can be produced from any host. Cross-built binaries can't be
 * run-tested on the build host — smoke-test them on the real OS.
 *
 * The binary auto-detects client/ next to itself at runtime via CLIENT_DIST,
 * so no environment variable is required when running from the dist directory.
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

interface Target {
  /** Release suffix — matches install.sh's `target` detection. */
  suffix: string;
  /** Bun `--target` triple. */
  bun: string;
  ext: '' | '.exe';
  archive: 'tar' | 'zip';
}

// Every target the public installer knows about (README "Supported targets").
const ALL_TARGETS: Target[] = [
  { suffix: 'linux-x64', bun: 'bun-linux-x64', ext: '', archive: 'tar' },
  { suffix: 'linux-arm64', bun: 'bun-linux-arm64', ext: '', archive: 'tar' },
  { suffix: 'darwin-arm64', bun: 'bun-darwin-arm64', ext: '', archive: 'tar' },
  { suffix: 'darwin-x64', bun: 'bun-darwin-x64', ext: '', archive: 'tar' },
  { suffix: 'windows-x64', bun: 'bun-windows-x64', ext: '.exe', archive: 'zip' },
];

function hostSuffix(): string {
  const platform =
    process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'windows' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  return `${platform}-${arch}`;
}

// ── Args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function argVal(flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i !== -1 ? argv[i + 1] : undefined;
}
const outDir = argVal('--outdir') ? resolve(argVal('--outdir')!) : join(root, 'dist', 'standalone');

let targets: Target[];
if (argv.includes('--all')) {
  targets = ALL_TARGETS;
} else if (argVal('--targets')) {
  const want = new Set(argVal('--targets')!.split(','));
  targets = ALL_TARGETS.filter((t) => want.has(t.suffix));
  const unknown = [...want].filter((w) => !ALL_TARGETS.some((t) => t.suffix === w));
  if (unknown.length) {
    console.error(`Unknown target(s): ${unknown.join(', ')}`);
    console.error(`Valid: ${ALL_TARGETS.map((t) => t.suffix).join(', ')}`);
    process.exit(1);
  }
} else {
  const host = hostSuffix();
  targets = ALL_TARGETS.filter((t) => t.suffix === host);
  if (targets.length === 0) {
    console.error(`No release target matches host "${host}".`);
    process.exit(1);
  }
}

const host = hostSuffix();
const pkgDir = join(outDir, 'pkg');
const clientOut = join(outDir, 'client');

console.log('');
console.log('  E - standalone build');
console.log(`  Output:  ${outDir}`);
console.log(`  Targets: ${targets.map((t) => t.suffix).join(', ')}`);
console.log('');

// ── 1. Build client once (platform-independent static assets) ────────────────
console.log('> Building client (SvelteKit)...');
execSync('bun run --filter @e/client build', { stdio: 'inherit', cwd: root });
mkdirSync(outDir, { recursive: true });
if (existsSync(clientOut)) rmSync(clientOut, { recursive: true, force: true });
cpSync(clientBuild, clientOut, { recursive: true });
if (existsSync(iconSrc)) cpSync(iconSrc, join(outDir, 'e.png'));
console.log('  client built\n');

// ── 2. Per-target: compile, stage, archive ───────────────────────────────────
const built: string[] = [];
for (const t of targets) {
  console.log(`> [${t.suffix}] compiling server binary...`);
  const binaryOut = join(outDir, `e-${t.suffix}${t.ext}`);
  // Build the host target natively (no --target) — fastest and what
  // install:local relies on; cross-compile everything else.
  const targetFlag = t.suffix === host ? '' : `--target=${t.bun} `;
  execSync(
    `bun build ${serverEntry} --compile ${targetFlag}--external playwright --external playwright-core --external electron --external chromium-bidi --outfile ${binaryOut}`,
    { stdio: 'inherit', cwd: root },
  );
  if (t.ext !== '.exe') chmodSync(binaryOut, 0o755);

  // Stage `e-<suffix>/` (binary renamed to `e[.exe]` + client/ + e.png) — the
  // exact tree the archive ships and install.sh expects after extraction.
  const stageName = `e-${t.suffix}`;
  const stageDir = join(pkgDir, stageName);
  if (existsSync(stageDir)) rmSync(stageDir, { recursive: true, force: true });
  mkdirSync(stageDir, { recursive: true });
  cpSync(binaryOut, join(stageDir, `e${t.ext}`));
  if (t.ext !== '.exe') chmodSync(join(stageDir, `e${t.ext}`), 0o755);
  cpSync(clientOut, join(stageDir, 'client'), { recursive: true });
  if (existsSync(iconSrc)) cpSync(iconSrc, join(stageDir, 'e.png'));

  // Archive from pkg/ so the top-level entry is `e-<suffix>/`, not `pkg/...`.
  let archivePath: string;
  if (t.archive === 'zip') {
    archivePath = join(outDir, `${stageName}.zip`);
    rmSync(archivePath, { force: true });
    execSync(`zip -r -q ../${stageName}.zip ${stageName}`, { stdio: 'inherit', cwd: pkgDir });
  } else {
    archivePath = join(outDir, `${stageName}.tar.gz`);
    execSync(`tar -czf ../${stageName}.tar.gz ${basename(stageDir)}`, {
      stdio: 'inherit',
      cwd: pkgDir,
    });
  }
  built.push(archivePath);
  console.log(`  ${basename(archivePath)}\n`);
}

console.log('Done. Archives:');
for (const a of built) console.log(`  ${a}`);
console.log('');
