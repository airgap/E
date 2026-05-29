/**
 * line-diff.ts — compact LCS-based unified-diff generator. Produces a
 * single-hunk unified diff string suitable for UnifiedDiffView /
 * SideBySideDiffView (both parse standard `@@`/`+`/`-`/` ` lines).
 *
 * This is a real line diff (longest-common-subsequence), unlike the
 * whole-file-replace fallback some call sites use — it keeps unchanged
 * context lines as context so the diff reads naturally. Word-level
 * intra-line highlighting is left to the renderer (MergeView does it).
 *
 * Scope: line granularity, one synthetic hunk covering the whole file.
 * That's the right tradeoff for local-history previews where the inputs
 * are two full file revisions, not a pre-computed git hunk set.
 */

/** Compute the LCS table lengths for two line arrays. */
function lcsLengths(a: string[], b: string[]): number[][] {
  const n = a.length;
  const m = b.length;
  // (n+1) x (m+1) DP table. For very large files this is O(n*m) memory;
  // callers gate on file size before invoking (local history caps at 2MB).
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  return dp;
}

export interface DiffLine {
  type: 'context' | 'add' | 'remove';
  text: string;
}

/** Backtrack the LCS table into an ordered list of context/add/remove ops. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const dp = lcsLengths(a, b);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ type: 'context', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'remove', text: a[i] });
      i++;
    } else {
      out.push({ type: 'add', text: b[j] });
      j++;
    }
  }
  while (i < a.length) out.push({ type: 'remove', text: a[i++] });
  while (j < b.length) out.push({ type: 'add', text: b[j++] });
  return out;
}

/**
 * Build a unified-diff string between two file revisions. `path` is used
 * only for the ---/+++ header lines.
 */
export function unifiedDiff(path: string, before: string, after: string): string {
  const a = before.split('\n');
  const b = after.split('\n');
  const ops = diffLines(before, after);
  const lines: string[] = [`--- a/${path}`, `+++ b/${path}`, `@@ -1,${a.length} +1,${b.length} @@`];
  for (const op of ops) {
    const prefix = op.type === 'add' ? '+' : op.type === 'remove' ? '-' : ' ';
    lines.push(`${prefix}${op.text}`);
  }
  return lines.join('\n');
}
