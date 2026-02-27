/**
 * Test Analyzer — builds import graphs and identifies affected test files.
 *
 * Scans a workspace for import/require relationships, then given a set of
 * changed files, finds which test files are affected (directly or transitively).
 */

import { readdir, readFile, stat } from 'fs/promises';
import { join, relative, resolve, dirname, extname } from 'path';

// ── Types ──────────────────────────────────────────────────────────────

export interface AffectedTestResult {
  testFile: string;
  relativePath: string;
  reason: string; // e.g. "imports changed file directly" or "transitively depends on X"
  depth: number; // 0 = direct import, 1+ = transitive
}

interface ImportEdge {
  from: string; // absolute path of the importing file
  to: string; // absolute path of the imported file
}

// ── Constants ──────────────────────────────────────────────────────────

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

const CODE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.svelte', '.vue']);

const TEST_PATTERNS = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /__tests__\//,
  /\.test\.svelte$/,
  /\.spec\.svelte$/,
];

// ── Import parsing ─────────────────────────────────────────────────────

const IMPORT_PATTERNS = [
  // ES imports: import ... from '...'
  /import\s+(?:[\w{}\s*,]+\s+from\s+)?['"]([^'"]+)['"]/g,
  // Dynamic imports: import('...')
  /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  // require: require('...')
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

function extractImports(content: string): string[] {
  const imports: string[] = [];
  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      imports.push(match[1]);
    }
  }
  return imports;
}

function isTestFile(filePath: string): boolean {
  return TEST_PATTERNS.some((p) => p.test(filePath));
}

/**
 * Resolve an import specifier to an absolute file path.
 * Handles relative imports only (not node_modules or aliases).
 */
function resolveImport(
  importSpecifier: string,
  fromFile: string,
  allFiles: Set<string>,
): string | null {
  // Only resolve relative imports
  if (!importSpecifier.startsWith('.')) return null;

  const dir = dirname(fromFile);
  const base = resolve(dir, importSpecifier);

  // Try exact match, then with extensions
  const candidates = [
    base,
    ...Array.from(CODE_EXTS).map((ext) => base + ext),
    ...Array.from(CODE_EXTS).map((ext) => join(base, 'index' + ext)),
  ];

  for (const candidate of candidates) {
    if (allFiles.has(candidate)) return candidate;
  }

  return null;
}

// ── Graph building ─────────────────────────────────────────────────────

async function collectFiles(rootPath: string): Promise<string[]> {
  const files: string[] = [];

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
        const ext = extname(entry.name).toLowerCase();
        if (CODE_EXTS.has(ext)) {
          files.push(fullPath);
        }
      }
    }
  }

  await walk(rootPath);
  return files;
}

async function buildImportGraph(
  rootPath: string,
): Promise<{ edges: ImportEdge[]; files: string[] }> {
  const files = await collectFiles(rootPath);
  const fileSet = new Set(files);
  const edges: ImportEdge[] = [];

  // Process files in parallel (batched to avoid too many open files)
  const BATCH_SIZE = 50;
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (filePath) => {
        try {
          const fileStat = await stat(filePath);
          if (fileStat.size > 512 * 1024) return; // Skip files > 512KB

          const content = await readFile(filePath, 'utf-8');
          const imports = extractImports(content);

          for (const imp of imports) {
            const resolved = resolveImport(imp, filePath, fileSet);
            if (resolved) {
              edges.push({ from: filePath, to: resolved });
            }
          }
        } catch {
          // Skip unreadable files
        }
      }),
    );
  }

  return { edges, files };
}

// ── Affected test detection ────────────────────────────────────────────

/**
 * Find all test files affected by changes to the given files.
 * Walks the reverse import graph transitively.
 */
export async function findAffectedTests(
  rootPath: string,
  changedFiles: string[],
  maxDepth = 5,
): Promise<AffectedTestResult[]> {
  const { edges, files } = await buildImportGraph(rootPath);

  // Build reverse adjacency: file → files that import it
  const reverseAdj = new Map<string, string[]>();
  for (const edge of edges) {
    const existing = reverseAdj.get(edge.to) ?? [];
    existing.push(edge.from);
    reverseAdj.set(edge.to, existing);
  }

  // Normalize changed files to absolute paths
  const changedSet = new Set(
    changedFiles.map((f) => (f.startsWith('/') ? f : resolve(rootPath, f))),
  );

  // BFS from changed files through reverse import graph
  const affected = new Map<string, { reason: string; depth: number }>();
  const queue: Array<{ file: string; depth: number; via: string }> = [];

  for (const changed of changedSet) {
    // If the changed file itself is a test, include it
    if (isTestFile(changed)) {
      affected.set(changed, { reason: 'changed directly', depth: 0 });
    }
    queue.push({ file: changed, depth: 0, via: relative(rootPath, changed) });
  }

  while (queue.length > 0) {
    const { file, depth, via } = queue.shift()!;
    if (depth >= maxDepth) continue;

    const importers = reverseAdj.get(file) ?? [];
    for (const importer of importers) {
      if (affected.has(importer)) continue;

      const nextDepth = depth + 1;
      const reason =
        nextDepth === 1 ? `imports ${via}` : `transitively depends on ${via} (depth ${nextDepth})`;

      if (isTestFile(importer)) {
        affected.set(importer, { reason, depth: nextDepth });
      }

      // Continue traversal even for non-test files
      queue.push({ file: importer, depth: nextDepth, via });
    }
  }

  // Convert to result format
  return Array.from(affected.entries())
    .map(([file, info]) => ({
      testFile: file,
      relativePath: relative(rootPath, file),
      reason: info.reason,
      depth: info.depth,
    }))
    .sort((a, b) => a.depth - b.depth);
}
