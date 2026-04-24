/**
 * Lane-assignment algorithm for a commit graph.
 *
 * Given a list of commits in reverse-chronological order (newest first) with
 * their parent SHAs, compute which vertical "lane" each commit sits in and
 * which lanes need to be drawn through a commit row to connect its parents.
 *
 * The algorithm walks commits top-to-bottom. At each row it tracks the set
 * of active lanes — each lane holds an "expected SHA" (the commit that owes
 * a line down to continue the lane). When we encounter that SHA we place
 * the commit in the first lane that expects it; any other lanes still
 * expecting it fold into the commit's lane. The commit then seeds new
 * expectations — its first parent continues the commit's lane, additional
 * parents take the next free lane on the right.
 *
 * Output: per-row information sufficient to render a graph column as SVG.
 */

export interface GraphInput {
  sha: string;
  parents: string[];
}

export interface GraphSegment {
  /** Lane the segment enters this row on (from the row above). */
  fromLane: number;
  /** Lane the segment leaves this row on (to the row below). */
  toLane: number;
  /** Color index for the lane — stable across a run so it looks consistent. */
  color: number;
}

export interface GraphRow {
  /** The commit's assigned lane. */
  lane: number;
  color: number;
  /** All segments drawn through this row. */
  segments: GraphSegment[];
  /** How wide the graph column is in lanes, including this row. */
  laneCount: number;
}

/**
 * Compute per-row lane info.
 *
 * @param commits  Newest-first list of commits.
 * @returns        One GraphRow per commit, aligned 1:1 with the input.
 */
export function layoutGraph(commits: GraphInput[]): GraphRow[] {
  // A lane is "active" when the previous row left a line on it. Each active
  // lane records the SHA the lane is waiting for (the commit that will
  // continue/close it).
  let activeLanes: Array<{ sha: string; color: number } | null> = [];
  // Consistent color assignment by source lane — we cycle through
  // COLOR_SLOTS as new lanes are introduced.
  let nextColor = 0;
  const rows: GraphRow[] = [];

  for (const commit of commits) {
    // 1. Figure out which lane this commit lives in. If any active lane is
    //    expecting this commit, use the leftmost such lane.
    let lane = -1;
    let commitColor = -1;
    for (let i = 0; i < activeLanes.length; i++) {
      const a = activeLanes[i];
      if (a && a.sha === commit.sha) {
        if (lane === -1) {
          lane = i;
          commitColor = a.color;
        }
      }
    }

    // No lane waiting for this commit — it's a branch tip (or the first
    // commit). Claim a brand-new lane and a fresh color.
    if (lane === -1) {
      lane = firstFreeLane(activeLanes);
      commitColor = nextColor++;
      // Ensure the slot exists before we write to it below.
      while (activeLanes.length <= lane) activeLanes.push(null);
    }

    // 2. Draw segments from the previous row into this row.
    // Every active lane (including the ones waiting for this SHA) draws a
    // line down into this row. Lanes waiting for this SHA fold into `lane`;
    // all other lanes pass straight through.
    const segments: GraphSegment[] = [];
    for (let i = 0; i < activeLanes.length; i++) {
      const a = activeLanes[i];
      if (!a) continue;
      if (a.sha === commit.sha) {
        segments.push({ fromLane: i, toLane: lane, color: a.color });
      } else {
        segments.push({ fromLane: i, toLane: i, color: a.color });
      }
    }

    // 3. Clear any lanes that folded into this commit.
    const next: Array<{ sha: string; color: number } | null> = activeLanes.map((a) =>
      a && a.sha === commit.sha ? null : a,
    );

    // 4. Seed parent expectations.
    //    - First parent continues the commit's lane (reuses color).
    //    - Any additional parents open a new branch on the first free lane
    //      to the right. They get a fresh color unless the parent is already
    //      tracked (a merge rejoining an existing branch), in which case
    //      they reuse that color.
    if (commit.parents.length > 0) {
      // Always seed the first-parent expectation on the commit's lane. If
      // another lane already tracks the same parent, both lanes will fold
      // into whichever lane "wins" when the parent actually commits —
      // producing the diagonal lines that show a merge rejoining a branch.
      next[lane] = { sha: commit.parents[0], color: commitColor };

      for (let p = 1; p < commit.parents.length; p++) {
        const parent = commit.parents[p];
        // Merge parents take the next free lane on the right. We still seed
        // them even if another lane tracks the same parent, for the same
        // reason as above — the fold happens when the parent commits.
        const freeLane = firstFreeLane(next);
        while (next.length <= freeLane) next.push(null);
        next[freeLane] = { sha: parent, color: nextColor++ };
      }
    } else {
      // Root commit — lane closes.
      next[lane] = null;
    }

    // Trim trailing empty lanes so laneCount reflects actual width.
    while (next.length > 0 && next[next.length - 1] === null) next.pop();

    rows.push({
      lane,
      color: commitColor,
      segments,
      laneCount: Math.max(activeLanes.length, next.length, lane + 1),
    });

    activeLanes = next;
  }

  return rows;
}

function firstFreeLane(lanes: Array<{ sha: string; color: number } | null>): number {
  for (let i = 0; i < lanes.length; i++) {
    if (!lanes[i]) return i;
  }
  return lanes.length;
}

/**
 * Palette used by the graph renderer. Indexed by `GraphRow.color` and
 * `GraphSegment.color` modulo length.
 */
export const LANE_COLORS = [
  '#60a5fa', // blue
  '#34d399', // green
  '#f59e0b', // amber
  '#f472b6', // pink
  '#a78bfa', // violet
  '#22d3ee', // cyan
  '#fb7185', // rose
  '#eab308', // yellow
  '#4ade80', // emerald
  '#818cf8', // indigo
];
