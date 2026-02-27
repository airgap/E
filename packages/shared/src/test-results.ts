// --- Test Result Types ---

/** Status of an individual test */
export type TestStatus = 'passed' | 'failed' | 'skipped' | 'pending';

/** A single test result with location information */
export interface TestResult {
  /** Full name of the test (e.g. "MyComponent > renders correctly") */
  testName: string;
  /** Status of this test */
  status: TestStatus;
  /** Absolute file path where the test is defined */
  filePath: string;
  /** 1-based line number of the test definition */
  line: number;
  /** Duration in milliseconds (if available) */
  duration?: number;
  /** Error message for failed tests */
  errorMessage?: string;
}

/** Results from a single test run */
export interface TestRunResult {
  /** Unique ID for this test run */
  id: string;
  /** Timestamp when the test run completed */
  timestamp: number;
  /** The test runner that produced these results */
  runner: 'vitest' | 'jest' | 'pytest' | 'unknown';
  /** Terminal session ID that ran the tests */
  sessionId: string;
  /** Command block ID that produced these results */
  blockId: string;
  /** All individual test results */
  results: TestResult[];
  /** Summary counts */
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    duration: number;
  };
}
