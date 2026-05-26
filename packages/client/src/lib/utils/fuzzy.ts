// Subsequence fuzzy matcher shared by the command palette + file quick-open.
//
// Returns a positive score when every char of `query` appears in order within
// `text`, with bonuses for consecutive matches and matches at the start of a
// segment (after `/` or `.`), or -1 when there's no match. Case-insensitive.
// An empty query scores 0 (matches everything, no ranking signal).
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (q.length === 0) return 0;
  let score = 0;
  let qi = 0;
  let lastMatch = -1;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += 1;
      if (lastMatch === ti - 1) score += 2; // consecutive run
      if (ti === 0 || t[ti - 1] === '/' || t[ti - 1] === '.') score += 3; // segment start
      lastMatch = ti;
      qi++;
    }
  }
  return qi === q.length ? score : -1;
}

/**
 * Best fuzzy score of `query` across several fields (e.g. label + category), so
 * a command matches if any field does. Returns -1 when none match.
 */
export function fuzzyScoreFields(query: string, ...fields: string[]): number {
  let best = -1;
  for (const f of fields) {
    const s = fuzzyScore(query, f);
    if (s > best) best = s;
  }
  return best;
}
