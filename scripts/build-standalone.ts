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

import { existsSync, cpSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execSync } from 'node:child_process';

const root = resolve(import.meta.dirname!, '..');
const clientBuild = join(root, 'packages', 'client', 'build');
const serverEntry = join(root, 'packages', 'server', 'src', 'standalone.ts');

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
execSync(`bun build ${serverEntry} --compile --outfile ${binaryOut}`, {
  stdio: 'inherit',
  cwd: root,
});
console.log(`  ✓ Binary: ${binaryOut}\n`);

// ── 3. Copy client build next to binary ─────────────────────────────────────
console.log('▸ Copying client assets…');
if (existsSync(clientOut)) rmSync(clientOut, { recursive: true, force: true });
cpSync(clientBuild, clientOut, { recursive: true });
console.log(`  ✓ Client: ${clientOut}\n`);

// ── 4. Done ──────────────────────────────────────────────────────────────────
console.log('Done!');
console.log('');
console.log('  Run:');
console.log(`    ${binaryOut}`);
console.log('');
console.log('  Options:');
console.log('    PORT=8080       custom port  (default 3002)');
console.log('    OPEN=1          open browser on start');
console.log('');
