/**
 * Bench for workspace text search. Runs each strategy N times against a
 * real repo and reports wall-clock distribution + correctness parity.
 *
 *   bun run scripts/bench-search.ts            # Bun: baseline + concurrent
 *   parabun run scripts/bench-search.ts        # Parabun: + real pmap row
 *
 * Usage:
 *   bun run scripts/bench-search.ts [--root /path] [--q pattern] [--n iters]
 */

import {
  searchSequential,
  searchConcurrent,
  searchPmap,
  listCandidateFiles,
  type SearchOptions,
} from '../packages/server/src/services/search-engine';

interface Args {
  root: string;
  q: string;
  iters: number;
}

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  const root = argOf(raw, '--root') ?? '/raid/E';
  const q = argOf(raw, '--q') ?? 'export';
  const iters = parseInt(argOf(raw, '--n') ?? '5', 10);
  return { root, q, iters };
}

function argOf(args: string[], key: string): string | undefined {
  const i = args.indexOf(key);
  return i >= 0 ? args[i + 1] : undefined;
}

function pct(ms: number[], p: number): number {
  const sorted = [...ms].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

function fmt(n: number): string {
  return n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2);
}

async function time<T>(fn: () => Promise<T>): Promise<{ ms: number; result: T }> {
  const t0 = performance.now();
  const result = await fn();
  return { ms: performance.now() - t0, result };
}

async function main() {
  const { root, q, iters } = parseArgs();

  const opts: SearchOptions = {
    pattern: new RegExp(q, 'gi'),
    limit: 500,
    contextLines: 2,
  };

  // Detect runtime for the report header
  let runtime = 'bun';
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await import('bun:parallel' as string);
    runtime = 'parabun';
  } catch {}

  const files = await listCandidateFiles(root);
  console.log(
    `\nBench: text search over ${root}  (${files.length} candidate files, query=${JSON.stringify(q)}, iters=${iters}, runtime=${runtime})\n`,
  );

  // Warm-up (page cache, JIT) — not counted.
  await searchSequential(root, opts);

  const strategies: Array<{
    name: string;
    fn: () => Promise<{ results: any[]; totalMatches: number; fileCount: number }>;
  }> = [
    {
      name: 'sequential',
      fn: () => searchSequential(root, opts),
    },
    {
      name: 'concurrent (Promise.all ×16)',
      fn: () => searchConcurrent(root, opts),
    },
    {
      name: `pmap (${runtime === 'parabun' ? 'real' : 'falls back to concurrent'})`,
      fn: () => searchPmap(root, opts),
    },
  ];

  const rows: Array<{
    name: string;
    ms: number[];
    totalMatches: number;
    fileCount: number;
  }> = [];

  for (const s of strategies) {
    const ms: number[] = [];
    let totalMatches = 0;
    let fileCount = 0;
    for (let i = 0; i < iters; i++) {
      const r = await time(s.fn);
      ms.push(r.ms);
      totalMatches = r.result.totalMatches;
      fileCount = r.result.fileCount;
    }
    rows.push({ name: s.name, ms, totalMatches, fileCount });
  }

  // Correctness parity
  const parity = rows.every(
    (r) => r.totalMatches === rows[0].totalMatches && r.fileCount === rows[0].fileCount,
  );

  // Report
  const widthName = Math.max(10, ...rows.map((r) => r.name.length));
  console.log(
    `${pad('strategy', widthName)}  ${pad('min', 7)}  ${pad('p50', 7)}  ${pad('p95', 7)}  ${pad('max', 7)}  ${pad('mean', 7)}  speedup   totalMatches  fileCount`,
  );
  console.log('-'.repeat(widthName + 80));
  const baseMedian = pct(rows[0].ms, 0.5);
  for (const r of rows) {
    const min = Math.min(...r.ms);
    const p50 = pct(r.ms, 0.5);
    const p95 = pct(r.ms, 0.95);
    const max = Math.max(...r.ms);
    const mean = r.ms.reduce((a, b) => a + b, 0) / r.ms.length;
    const speedup = baseMedian / p50;
    console.log(
      `${pad(r.name, widthName)}  ${pad(fmt(min) + 'ms', 7)}  ${pad(fmt(p50) + 'ms', 7)}  ${pad(fmt(p95) + 'ms', 7)}  ${pad(fmt(max) + 'ms', 7)}  ${pad(fmt(mean) + 'ms', 7)}  ${pad(speedup.toFixed(2) + '×', 7)}  ${pad(String(r.totalMatches), 12)}  ${pad(String(r.fileCount), 8)}`,
    );
  }
  console.log();
  if (!parity) {
    console.log(
      '⚠ Correctness mismatch: strategies returned different totalMatches/fileCount. Numbers above are not comparable.',
    );
    process.exit(1);
  } else {
    console.log('✓ Correctness parity: all strategies returned identical counts.');
  }
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s;
  return s + ' '.repeat(n - s.length);
}

await main();
