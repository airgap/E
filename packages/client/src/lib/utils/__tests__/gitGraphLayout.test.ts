import { describe, expect, test } from 'vitest';
import { layoutGraph } from '../gitGraphLayout';

describe('layoutGraph', () => {
  test('linear history stays in lane 0', () => {
    const rows = layoutGraph([
      { sha: 'c', parents: ['b'] },
      { sha: 'b', parents: ['a'] },
      { sha: 'a', parents: [] },
    ]);
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0]);
    // All rows share the same color on a straight line.
    expect(new Set(rows.map((r) => r.color)).size).toBe(1);
  });

  test('branch opens a second lane and keeps its color', () => {
    // topology:
    //   c (merge of b and d)
    //   | \
    //   b  d
    //   | /
    //   a
    const rows = layoutGraph([
      { sha: 'c', parents: ['b', 'd'] },
      { sha: 'b', parents: ['a'] },
      { sha: 'd', parents: ['a'] },
      { sha: 'a', parents: [] },
    ]);
    expect(rows[0].lane).toBe(0);
    expect(rows[1].lane).toBe(0);
    expect(rows[2].lane).toBe(1); // branch
    expect(rows[3].lane).toBe(0); // merge back into the trunk
    // Row 3's incoming segments should collapse lane 1 into lane 0.
    const folds = rows[3].segments.filter((s) => s.fromLane !== s.toLane);
    expect(folds.length).toBeGreaterThan(0);
  });

  test('branch tip claims a fresh lane and color', () => {
    // Two disconnected tips sharing no common ancestor yet:
    //   c     d
    //   |     |
    //   b     ?
    //   |
    //   a
    const rows = layoutGraph([
      { sha: 'd', parents: ['x'] },
      { sha: 'c', parents: ['b'] },
      { sha: 'b', parents: ['a'] },
      { sha: 'a', parents: [] },
    ]);
    // `d` is on lane 0, `c` opens lane 1 (since lane 0 is still waiting on x).
    expect(rows[0].lane).toBe(0);
    expect(rows[1].lane).toBe(1);
    expect(rows[0].color).not.toBe(rows[1].color);
  });

  test('laneCount reflects the peak width through the row', () => {
    // A fan-out before a merge — 3 lanes at the peak.
    const rows = layoutGraph([
      { sha: 'm', parents: ['a', 'b', 'c'] },
      { sha: 'a', parents: ['base'] },
      { sha: 'b', parents: ['base'] },
      { sha: 'c', parents: ['base'] },
      { sha: 'base', parents: [] },
    ]);
    const peak = Math.max(...rows.map((r) => r.laneCount));
    expect(peak).toBeGreaterThanOrEqual(3);
  });
});
