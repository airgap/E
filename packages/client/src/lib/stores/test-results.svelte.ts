/**
 * Test Results Store — holds parsed test run results for the editor gutter.
 *
 * Receives TestRunResult from terminal rich_content messages and provides
 * per-file, per-line test status markers for the CM6 gutter extension.
 */

import type { TestRunResult, TestStatus } from '@e/shared';

// ── localStorage key ──
const STORAGE_KEY = 'e-test-results';
const MAX_RUNS = 20;

// ── Types ──

/** Marker data for a single line in the gutter */
export interface TestGutterMarker {
  line: number;
  status: TestStatus;
  testName: string;
  duration?: number;
  errorMessage?: string;
}

// ── Persistence ──

function loadRuns(): TestRunResult[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // ignore
  }
  return [];
}

function saveRuns(runs: TestRunResult[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(runs));
  } catch {
    // ignore
  }
}

// ── Store ──

/** Monotonic version counter — incremented on every change so CM6 can detect updates */
let version = $state(0);

function createTestResultsStore() {
  // --- State ---
  let runs = $state<TestRunResult[]>(loadRuns());
  let fileResults = $state<Map<string, TestGutterMarker[]>>(new Map());

  // --- Derived ---
  const latestRun = $derived(runs.length > 0 ? runs[0] : null);
  const hasResults = $derived(runs.length > 0);

  // Build initial file map from persisted runs
  rebuildFileResults();

  function rebuildFileResults() {
    const newMap = new Map<string, TestGutterMarker[]>();
    const seenFiles = new Set<string>();

    // Most recent run takes precedence for each file
    for (const run of runs) {
      for (const result of run.results) {
        const fp = normalizePath(result.filePath);
        if (seenFiles.has(fp)) continue;

        const markers = newMap.get(fp) ?? [];
        markers.push({
          line: result.line,
          status: result.status,
          testName: result.testName,
          duration: result.duration,
          errorMessage: result.errorMessage,
        });
        newMap.set(fp, markers);
      }
      // Mark all files in this run as "covered" by the most recent run
      for (const result of run.results) {
        seenFiles.add(normalizePath(result.filePath));
      }
    }

    fileResults = newMap;
  }

  return {
    get runs() {
      return runs;
    },
    get latestRun() {
      return latestRun;
    },
    get hasResults() {
      return hasResults;
    },
    get version() {
      return version;
    },

    /** Get gutter markers for a specific file path */
    getMarkersForFile(filePath: string): TestGutterMarker[] {
      const normalized = normalizePath(filePath);
      return fileResults.get(normalized) ?? [];
    },

    /** Add a new test run result */
    addTestRun(result: TestRunResult) {
      runs = [result, ...runs].slice(0, MAX_RUNS);
      rebuildFileResults();
      version++;
      saveRuns(runs);
    },

    /** Clear all results */
    clearAll() {
      runs = [];
      fileResults = new Map();
      version++;
      saveRuns(runs);
    },

    /** Clear results for a specific file */
    clearFile(filePath: string) {
      const normalized = normalizePath(filePath);
      const newMap = new Map(fileResults);
      newMap.delete(normalized);
      fileResults = newMap;
      version++;
    },

    /** Get all file paths that have test results */
    get testedFiles(): string[] {
      return Array.from(fileResults.keys());
    },

    /** Get summary stats for the latest run */
    get summary() {
      if (!latestRun) return null;
      const results = latestRun.results;
      return {
        total: results.length,
        passed: results.filter((r: any) => r.status === 'passed').length,
        failed: results.filter((r: any) => r.status === 'failed').length,
        skipped: results.filter((r: any) => r.status === 'skipped' || r.status === 'pending')
          .length,
      };
    },
  };
}

function normalizePath(p: string): string {
  return p.replace(/^file:\/\//, '');
}

export const testResultsStore = createTestResultsStore();

// ── HMR support ──
if (import.meta.hot) {
  const hmrData = import.meta.hot.data as { ver?: number };
  if (hmrData?.ver !== undefined) {
    version = hmrData.ver;
  }
  import.meta.hot.dispose((data: Record<string, unknown>) => {
    data.ver = version;
  });
}
