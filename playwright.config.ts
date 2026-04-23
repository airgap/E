import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * E2E tests for E. The server is spawned by Playwright itself using the
 * single-process `start` mode which serves the prebuilt client from
 * packages/client/build alongside the API on the same port.
 *
 * Everything is isolated from the user's real state:
 *   - HOME is redirected to a fresh tmp directory so ~/.e/ doesn't get
 *     touched (SQLite DB, memory files, LSP installs, etc. all land in
 *     the temp dir and vanish when the test process exits).
 *   - PORT is hard-set to 3399 to avoid colliding with a dev server.
 */
const TEST_HOME = mkdtempSync(join(tmpdir(), 'e-e2e-'));
const TEST_PORT = 3399;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false, // Single shared server — tests are sequential on purpose.
  retries: 0,
  workers: 1,
  reporter: [['list']],

  use: {
    baseURL: `http://localhost:${TEST_PORT}`,
    // Traces on failure help debugging but are expensive; off by default locally.
    trace: 'retain-on-failure',
    actionTimeout: 5_000,
    navigationTimeout: 10_000,
    // Setting Origin on raw API requests hits the localhost bypass in the CSRF middleware,
    // which keeps these tests lean — no need to round-trip a token fetch before every mutation.
    extraHTTPHeaders: {
      Origin: `http://localhost:${TEST_PORT}`,
    },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    // `bun run start` at the repo root rebuilds the client then starts the server
    // from the fresh bundle. The build step is what catches stale-dist bugs —
    // without it, tests will silently pass against an old UI.
    command: 'bun run start',
    url: `http://localhost:${TEST_PORT}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      HOME: TEST_HOME,
      PORT: String(TEST_PORT),
      CLIENT_DIST: join(__dirname, 'packages/client/build'),
    },
  },
});
