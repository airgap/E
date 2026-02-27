/**
 * Coverage Store — manages code coverage data from lcov/json reports.
 *
 * Provides per-file, per-line coverage status for the coverage overlay extension.
 */

import { api } from '$lib/api/client';

export type LineCoverage = 'covered' | 'uncovered' | 'partial';

export interface FileCoverage {
  filePath: string;
  lines: Map<number, LineCoverage>; // 1-based line number → status
  coveredCount: number;
  uncoveredCount: number;
  percentage: number;
}

function createCoverageStore() {
  let coverageMap = $state<Map<string, FileCoverage>>(new Map());
  let loading = $state(false);
  let loaded = $state(false);

  return {
    get loading() {
      return loading;
    },
    get loaded() {
      return loaded;
    },

    /**
     * Get coverage data for a specific file.
     */
    getFileCoverage(filePath: string): FileCoverage | null {
      return coverageMap.get(normalizePath(filePath)) ?? null;
    },

    /**
     * Get line coverage status for a specific file and line.
     */
    getLineCoverage(filePath: string, line: number): LineCoverage | null {
      const fc = coverageMap.get(normalizePath(filePath));
      if (!fc) return null;
      return fc.lines.get(line) ?? null;
    },

    /**
     * Load coverage from an lcov string (typically read from coverage/lcov.info).
     */
    loadFromLcov(lcovContent: string, rootPath: string) {
      loading = true;
      const newMap = new Map<string, FileCoverage>();

      try {
        parseLcov(lcovContent, rootPath, newMap);
      } catch {
        // Invalid lcov data — clear coverage
      }

      coverageMap = newMap;
      loading = false;
      loaded = true;
    },

    /**
     * Load coverage from a JSON coverage report (e.g., c8/istanbul json output).
     */
    loadFromJson(jsonData: Record<string, any>) {
      loading = true;
      const newMap = new Map<string, FileCoverage>();

      try {
        for (const [filePath, fileData] of Object.entries(jsonData)) {
          const lines = new Map<number, LineCoverage>();
          let covered = 0;
          let uncovered = 0;

          const statementMap = (fileData as any).statementMap ?? {};
          const s = (fileData as any).s ?? {};

          for (const [stmtId, count] of Object.entries(s)) {
            const stmt = statementMap[stmtId];
            if (!stmt) continue;

            const startLine = stmt.start?.line;
            if (typeof startLine !== 'number') continue;

            const status: LineCoverage = (count as number) > 0 ? 'covered' : 'uncovered';
            // Don't overwrite 'uncovered' with 'covered' — worst status wins
            const existing = lines.get(startLine);
            if (!existing || (existing === 'covered' && status === 'uncovered')) {
              lines.set(startLine, status);
            }

            if (status === 'covered') covered++;
            else uncovered++;
          }

          const total = covered + uncovered;
          newMap.set(normalizePath(filePath), {
            filePath,
            lines,
            coveredCount: covered,
            uncoveredCount: uncovered,
            percentage: total > 0 ? Math.round((covered / total) * 100) : 0,
          });
        }
      } catch {
        // Invalid data
      }

      coverageMap = newMap;
      loading = false;
      loaded = true;
    },

    /**
     * Clear all coverage data.
     */
    clear() {
      coverageMap = new Map();
      loaded = false;
    },

    /**
     * Get overall coverage summary.
     */
    get summary() {
      let totalCovered = 0;
      let totalUncovered = 0;
      let fileCount = 0;

      for (const fc of coverageMap.values()) {
        totalCovered += fc.coveredCount;
        totalUncovered += fc.uncoveredCount;
        fileCount++;
      }

      const total = totalCovered + totalUncovered;
      return {
        fileCount,
        totalCovered,
        totalUncovered,
        percentage: total > 0 ? Math.round((totalCovered / total) * 100) : 0,
      };
    },
  };
}

function normalizePath(p: string): string {
  return p.replace(/^file:\/\//, '');
}

/**
 * Parse LCOV format coverage data.
 */
function parseLcov(content: string, rootPath: string, map: Map<string, FileCoverage>) {
  let currentFile = '';
  let lines = new Map<number, LineCoverage>();
  let covered = 0;
  let uncovered = 0;

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();

    if (line.startsWith('SF:')) {
      currentFile = line.slice(3);
      if (!currentFile.startsWith('/')) {
        currentFile = `${rootPath}/${currentFile}`;
      }
      lines = new Map();
      covered = 0;
      uncovered = 0;
    } else if (line.startsWith('DA:')) {
      const parts = line.slice(3).split(',');
      const lineNum = parseInt(parts[0], 10);
      const count = parseInt(parts[1], 10);
      if (!isNaN(lineNum)) {
        const status: LineCoverage = count > 0 ? 'covered' : 'uncovered';
        lines.set(lineNum, status);
        if (count > 0) covered++;
        else uncovered++;
      }
    } else if (line === 'end_of_record') {
      if (currentFile) {
        const total = covered + uncovered;
        map.set(normalizePath(currentFile), {
          filePath: currentFile,
          lines,
          coveredCount: covered,
          uncoveredCount: uncovered,
          percentage: total > 0 ? Math.round((covered / total) * 100) : 0,
        });
      }
      currentFile = '';
    }
  }
}

export const coverageStore = createCoverageStore();
