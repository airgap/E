import { execSync } from 'node:child_process';
import { readdirSync, renameSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

const binDir = resolve(import.meta.dirname!, '..', 'src-tauri', 'binaries');
const baseName = 'e-server';

// Get target triple from rustc
const rustcOutput = execSync('rustc -vV', { encoding: 'utf-8' });
const hostLine = rustcOutput.split('\n').find((line) => line.startsWith('host:'));
if (!hostLine) {
  console.error('Error: Could not parse target triple from `rustc -vV`');
  process.exit(1);
}
const triple = hostLine.split('host:')[1].trim();

// Clean up any old suffixed binaries
for (const file of readdirSync(binDir)) {
  if (file.startsWith(`${baseName}-`) && file !== '.gitkeep') {
    const fullPath = join(binDir, file);
    unlinkSync(fullPath);
    console.log(`Removed old binary: ${file}`);
  }
}

// Rename the compiled binary with the target triple suffix
const ext = process.platform === 'win32' ? '.exe' : '';
const src = join(binDir, `${baseName}${ext}`);
const dest = join(binDir, `${baseName}-${triple}${ext}`);

try {
  renameSync(src, dest);
  console.log(`Renamed binary to ${baseName}-${triple}${ext}`);
} catch {
  console.error(`Error: No binary found at ${src}`);
  process.exit(1);
}
