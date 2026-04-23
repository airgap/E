import { Hono } from 'hono';
import { readFile } from 'fs/promises';
import { searchConcurrent, type SearchOptions } from '../services/search-engine';

const app = new Hono();

app.get('/', async (c) => {
  const query = c.req.query('q');
  const rootPath = c.req.query('path') || process.cwd();
  const isRegex = c.req.query('regex') === 'true';
  const caseSensitive = c.req.query('caseSensitive') === 'true';
  const wholeWord = c.req.query('wholeWord') === 'true';
  const limit = Math.min(parseInt(c.req.query('limit') || '500'), 2000);
  const contextLines = Math.min(parseInt(c.req.query('context') || '2'), 5);

  if (!query) return c.json({ ok: false, error: 'q parameter required' }, 400);

  const flags = caseSensitive ? 'g' : 'gi';
  let pattern: RegExp;
  try {
    const base = isRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wrapped = wholeWord ? `\\b(?:${base})\\b` : base;
    pattern = new RegExp(wrapped, flags);
  } catch (err) {
    return c.json({ ok: false, error: `Invalid regex: ${err}` }, 400);
  }

  // Concurrent strategy: walk tree, then read+scan files in 16-wide
  // Promise.all batches. ~1.6–1.7× faster than sequential on mid-size
  // repos (see scripts/bench-search.ts). Worker-pool dispatch (pmap)
  // didn't pay off for this workload — per-file regex is too cheap to
  // amortize serialization overhead, bench confirmed.
  const opts: SearchOptions = { pattern, limit, contextLines };
  const result = await searchConcurrent(rootPath, opts);
  return c.json({ ok: true, data: result });
});

// ---------------------------------------------------------------------------
// POST /replace — Replace text across files
// ---------------------------------------------------------------------------

app.post('/replace', async (c) => {
  const body = await c.req.json();
  const { searchText, replaceText, files, rootPath, isRegex, caseSensitive, wholeWord, dryRun } =
    body as {
      searchText: string;
      replaceText: string;
      files?: string[]; // if empty, replace in all files that match
      rootPath: string;
      isRegex?: boolean;
      caseSensitive?: boolean;
      wholeWord?: boolean;
      /** If true, compute counts/preview without actually writing files. */
      dryRun?: boolean;
    };

  if (!searchText || replaceText === undefined || !rootPath) {
    return c.json({ ok: false, error: 'searchText, replaceText, and rootPath required' }, 400);
  }

  const flags = caseSensitive ? 'g' : 'gi';
  let pattern: RegExp;
  try {
    const base = isRegex ? searchText : searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wrapped = wholeWord ? `\\b(?:${base})\\b` : base;
    pattern = new RegExp(wrapped, flags);
  } catch (err) {
    return c.json({ ok: false, error: `Invalid regex: ${err}` }, 400);
  }

  const targetFiles = files || [];
  let replacedCount = 0;
  let filesModified = 0;
  const perFile: Array<{ file: string; replacements: number }> = [];

  for (const filePath of targetFiles) {
    try {
      const content = await readFile(filePath, 'utf-8');
      pattern.lastIndex = 0;
      // Count occurrences first — RegExp.prototype.exec is the only safe way
      // to count without relying on String.prototype.replace's side effects.
      let countInFile = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        countInFile++;
        // Prevent infinite loop on zero-width matches
        if (match.index === pattern.lastIndex) pattern.lastIndex++;
      }
      if (countInFile === 0) continue;

      perFile.push({ file: filePath, replacements: countInFile });
      replacedCount += countInFile;
      filesModified++;

      if (!dryRun) {
        pattern.lastIndex = 0;
        const newContent = content.replace(pattern, replaceText);
        const { writeFile } = await import('fs/promises');
        await writeFile(filePath, newContent, 'utf-8');
      }
    } catch {
      // Skip unwritable/unreadable files
    }
  }

  return c.json({
    ok: true,
    data: { replacedCount, filesModified, perFile, dryRun: !!dryRun },
  });
});

export { app as searchRoutes };
