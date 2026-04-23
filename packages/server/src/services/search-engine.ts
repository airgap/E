/**
 * Workspace text search — walk the tree, scan each file for a regex, return
 * matches. Three strategies are provided so we can benchmark them honestly:
 *
 *   - `sequential`  : current behavior, one file at a time. The baseline.
 *   - `concurrent`  : walks the tree then reads/scans files in parallel
 *                     chunks via `Promise.all`. Pure-Bun I/O parallelism;
 *                     no workers.
 *   - `pmap`        : uses Parabun's `bun:parallel.pmap` to run the regex
 *                     kernel across a worker pool with zero-copy file
 *                     content. CPU parallelism. Falls back to `concurrent`
 *                     when the module is absent (e.g. running on stock Bun).
 *
 * The three share `listCandidateFiles` and `SearchMatch`, so any delta in
 * numbers is attributable to the scan strategy, not the directory walk.
 */

import { readdir, readFile, stat } from 'fs/promises';
import { join, relative } from 'path';

export interface SearchMatch {
  file: string;
  relativePath: string;
  line: number;
  column: number;
  content: string;
  matchStart: number;
  matchEnd: number;
  context?: Array<{ line: number; content: string }>;
}

export interface SearchOptions {
  pattern: RegExp;
  limit: number;
  contextLines: number;
}

export interface SearchResult {
  results: SearchMatch[];
  totalMatches: number;
  fileCount: number;
  truncated: boolean;
}

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.svelte-kit',
  '__pycache__',
  '.next',
  '.nuxt',
  'coverage',
  '.cache',
  'target',
]);

const BINARY_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.svg',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.zip',
  '.tar',
  '.gz',
  '.bz2',
  '.pdf',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.mp3',
  '.mp4',
  '.avi',
  '.mov',
  '.wasm',
]);

const MAX_FILE_SIZE = 1024 * 1024;

/** Walk the tree; return every non-binary, small-enough file path. No reads. */
export async function listCandidateFiles(rootPath: string): Promise<string[]> {
  const out: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.claude') continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(fullPath);
      } else {
        const ext = '.' + (entry.name.split('.').pop()?.toLowerCase() ?? '');
        if (BINARY_EXTS.has(ext)) continue;
        try {
          const s = await stat(fullPath);
          if (s.size > MAX_FILE_SIZE) continue;
        } catch {
          continue;
        }
        out.push(fullPath);
      }
    }
  }

  await walk(rootPath);
  return out;
}

/**
 * Run the pattern against a single file's content. Extracted so it can be
 * dispatched to a worker via `fn.toString()` — keep it self-contained, no
 * closures over outer scope beyond primitives.
 */
export function scanOne(
  rootPath: string,
  filePath: string,
  content: string,
  pattern: RegExp,
  contextLines: number,
): SearchMatch[] {
  const lines = content.split('\n');
  const matches: SearchMatch[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(line)) !== null) {
      const ctx: Array<{ line: number; content: string }> = [];
      if (contextLines > 0) {
        for (
          let c = Math.max(0, i - contextLines);
          c <= Math.min(lines.length - 1, i + contextLines);
          c++
        ) {
          if (c === i) continue;
          ctx.push({
            line: c + 1,
            content: lines[c].length > 500 ? lines[c].slice(0, 500) : lines[c],
          });
        }
      }
      matches.push({
        file: filePath,
        relativePath: relative(rootPath, filePath),
        line: i + 1,
        column: m.index + 1,
        content: line.length > 500 ? line.slice(0, 500) : line,
        matchStart: m.index,
        matchEnd: m.index + m[0].length,
        ...(ctx.length > 0 ? { context: ctx } : {}),
      });
      // Prevent runaway on zero-width matches
      if (m.index === pattern.lastIndex) pattern.lastIndex++;
    }
  }
  return matches;
}

/** Aggregate matches from per-file results, respecting `limit`. */
function collect(perFile: SearchMatch[][], limit: number): SearchResult {
  const results: SearchMatch[] = [];
  let totalMatches = 0;
  let fileCount = 0;
  let truncated = false;
  for (const fileMatches of perFile) {
    if (fileMatches.length > 0) fileCount++;
    for (const m of fileMatches) {
      totalMatches++;
      if (results.length < limit) {
        results.push(m);
      } else {
        truncated = true;
      }
    }
  }
  return { results, totalMatches, fileCount, truncated };
}

// ── Strategy: sequential ─────────────────────────────────────────────────────

export async function searchSequential(
  rootPath: string,
  opts: SearchOptions,
): Promise<SearchResult> {
  const files = await listCandidateFiles(rootPath);
  const perFile: SearchMatch[][] = [];
  for (const path of files) {
    let content: string;
    try {
      content = await readFile(path, 'utf-8');
    } catch {
      perFile.push([]);
      continue;
    }
    // Fresh RegExp per call so `.lastIndex` state doesn't leak across files.
    const p = new RegExp(opts.pattern.source, opts.pattern.flags);
    perFile.push(scanOne(rootPath, path, content, p, opts.contextLines));
  }
  return collect(perFile, opts.limit);
}

// ── Strategy: concurrent (Promise.all in chunks) ─────────────────────────────

export async function searchConcurrent(
  rootPath: string,
  opts: SearchOptions,
  concurrency = 16,
): Promise<SearchResult> {
  const files = await listCandidateFiles(rootPath);
  const perFile: SearchMatch[][] = new Array(files.length);
  for (let base = 0; base < files.length; base += concurrency) {
    const slice = files.slice(base, base + concurrency);
    const results = await Promise.all(
      slice.map(async (path) => {
        try {
          const content = await readFile(path, 'utf-8');
          const p = new RegExp(opts.pattern.source, opts.pattern.flags);
          return scanOne(rootPath, path, content, p, opts.contextLines);
        } catch {
          return [];
        }
      }),
    );
    for (let i = 0; i < results.length; i++) perFile[base + i] = results[i];
  }
  return collect(perFile, opts.limit);
}

// ── Strategy: pmap (Parabun `bun:parallel.pmap` with sequential fallback) ────

/**
 * Kernel executed inside a worker. Parabun's `pure` contract means no
 * closures, no `this`, no outer-scope references, and — crucially — no
 * `require` (worker context is ESM-only). So we take pre-read file content
 * on the input chunk and only do regex work here. File I/O happens in the
 * caller via `Promise.all`, where it parallelizes against the event loop
 * just fine.
 *
 * Return shape mirrors the input's `files` array index-by-index so the
 * caller can reassemble with relative paths it already computed.
 */
function scanChunkKernel(chunk: {
  filesWithContent: Array<{ filePath: string; relativePath: string; content: string }>;
  patternSource: string;
  patternFlags: string;
  contextLines: number;
}): { perFile: SearchMatch[][] } {
  const pattern = new RegExp(chunk.patternSource, chunk.patternFlags);
  const perFile: SearchMatch[][] = [];
  for (const fileEntry of chunk.filesWithContent) {
    const lines = fileEntry.content.split('\n');
    const matches: SearchMatch[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(line)) !== null) {
        const ctx: Array<{ line: number; content: string }> = [];
        if (chunk.contextLines > 0) {
          for (
            let c = Math.max(0, i - chunk.contextLines);
            c <= Math.min(lines.length - 1, i + chunk.contextLines);
            c++
          ) {
            if (c === i) continue;
            ctx.push({
              line: c + 1,
              content: lines[c].length > 500 ? lines[c].slice(0, 500) : lines[c],
            });
          }
        }
        matches.push({
          file: fileEntry.filePath,
          relativePath: fileEntry.relativePath,
          line: i + 1,
          column: m.index + 1,
          content: line.length > 500 ? line.slice(0, 500) : line,
          matchStart: m.index,
          matchEnd: m.index + m[0].length,
          ...(ctx.length > 0 ? { context: ctx } : {}),
        });
        if (m.index === pattern.lastIndex) pattern.lastIndex++;
      }
    }
    perFile.push(matches);
  }
  return { perFile };
}

export async function searchPmap(
  rootPath: string,
  opts: SearchOptions,
  chunkCount?: number,
): Promise<SearchResult> {
  // Parabun-only module. Under stock Bun, fall back to the concurrent impl
  // so this function is always callable.
  let parallel: any;
  try {
    parallel = await import('bun:parallel' as string);
  } catch {
    return searchConcurrent(rootPath, opts);
  }
  if (!parallel?.default?.pmap && !parallel?.pmap) {
    return searchConcurrent(rootPath, opts);
  }
  const pmap = (parallel.default?.pmap ?? parallel.pmap) as (
    fn: unknown,
    items: unknown[],
    opts?: { concurrency?: number },
  ) => Promise<any[]>;

  const files = await listCandidateFiles(rootPath);

  // Step 1: read all files in parallel on the main thread. Node/Bun fs
  // already handles this concurrently; the bottleneck we care about (regex
  // work) is in step 2.
  const filesWithContent: Array<{ filePath: string; relativePath: string; content: string }> = [];
  const chunkRead = 64;
  for (let base = 0; base < files.length; base += chunkRead) {
    const slice = files.slice(base, base + chunkRead);
    const reads = await Promise.all(
      slice.map(async (filePath) => {
        try {
          const content = await readFile(filePath, 'utf-8');
          return { filePath, relativePath: relative(rootPath, filePath), content };
        } catch {
          return null;
        }
      }),
    );
    for (const r of reads) if (r) filesWithContent.push(r);
  }

  // Step 2: dispatch regex scanning across workers. Target ~2× CPU count of
  // chunks so slow files don't starve the pool.
  const workers =
    chunkCount ?? Math.min(32, Math.max(2, (navigatorHardwareConcurrency() ?? 8) * 2));
  const per = Math.max(1, Math.ceil(filesWithContent.length / workers));
  const chunks: Array<{
    filesWithContent: typeof filesWithContent;
    patternSource: string;
    patternFlags: string;
    contextLines: number;
  }> = [];
  for (let i = 0; i < filesWithContent.length; i += per) {
    chunks.push({
      filesWithContent: filesWithContent.slice(i, i + per),
      patternSource: opts.pattern.source,
      patternFlags: opts.pattern.flags,
      contextLines: opts.contextLines,
    });
  }

  const results: Array<{ perFile: SearchMatch[][] }> = await pmap(scanChunkKernel, chunks, {
    concurrency: workers,
  });
  const perFile: SearchMatch[][] = [];
  for (const r of results) for (const f of r.perFile) perFile.push(f);
  return collect(perFile, opts.limit);
}

function navigatorHardwareConcurrency(): number | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hc = (globalThis as any)?.navigator?.hardwareConcurrency;
    return typeof hc === 'number' ? hc : null;
  } catch {
    return null;
  }
}
