/**
 * Compile electron/main.ts + electron/preload.ts to CJS for Electron via
 * esbuild. (Bun.build / `bun build` collides with the local `electron/`
 * directory when resolving the `electron` external in Bun 1.3.5.)
 */
import { rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const outdir = 'electron/dist';
rmSync(outdir, { recursive: true, force: true });

for (const entry of ['electron/main.ts', 'electron/preload.ts']) {
  const name = entry.split('/').pop()!.replace(/\.ts$/, '.cjs');
  const res = spawnSync(
    'bunx',
    [
      'esbuild',
      entry,
      '--bundle',
      '--platform=node',
      '--format=cjs',
      `--outfile=${outdir}/${name}`,
      '--external:electron',
    ],
    { stdio: 'inherit' },
  );
  if (res.status !== 0) process.exit(res.status ?? 1);
}
console.log(`✔ wrote ${outdir}/main.cjs + preload.cjs`);
