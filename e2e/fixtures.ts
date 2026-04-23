import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Workspace fixtures are created under `.e2e-tmp/` inside the repo rather than
 * the system temp dir. On some Linux hosts /tmp is tmpfs where inotify events
 * for subsequent writes are delivered with multi-second latencies — reliably
 * breaking file-watcher tests. A regular-disk path doesn't have that problem.
 */
const FIXTURE_ROOT = join(__dirname, '..', '.e2e-tmp');
if (!existsSync(FIXTURE_ROOT)) mkdirSync(FIXTURE_ROOT, { recursive: true });

/**
 * Shared fixtures for tests that need a real workspace.
 *
 * Each test gets its own temp directory seeded with files, and the E server
 * is pointed at it via the settings API. The fixture handles teardown so
 * leftover dirs don't accumulate in /tmp.
 */

export interface Workspace {
  dir: string;
  /** Write a file inside the workspace. Creates parent dirs as needed. */
  writeFile(relPath: string, contents: string): string;
  /** Absolute path to a file inside the workspace. */
  path(relPath: string): string;
}

export const test = base.extend<{ workspace: Workspace; wsPage: Page }>({
  workspace: async ({}, use) => {
    const dir = mkdtempSync(join(FIXTURE_ROOT, 'ws-'));
    const ws: Workspace = {
      dir,
      path(relPath: string) {
        return join(dir, relPath);
      },
      writeFile(relPath: string, contents: string) {
        const abs = join(dir, relPath);
        mkdirSync(join(abs, '..'), { recursive: true });
        writeFileSync(abs, contents, 'utf-8');
        return abs;
      },
    };
    await use(ws);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup — a stray file lock shouldn't fail the test.
    }
  },

  /**
   * A page that has already pointed the E server at the fixture workspace
   * and reloaded so the new workspacePath is reflected in the client.
   * The first-run tutorial overlay is suppressed via localStorage seed
   * so it doesn't eat clicks during tests.
   */
  wsPage: async ({ page, request, workspace }, use) => {
    // Tests can pre-populate `workspace` before the server starts watching.
    // That avoids an initial burst of CREATE events from dominating the inotify
    // queue when file-watcher tests run.
    await pointServerAtWorkspace(request, workspace.dir);
    // Mark the tutorial dismissed before the app script executes.
    // addInitScript fires on every navigation including the first load.
    await page.addInitScript(() => {
      localStorage.setItem(
        'e-tutorial',
        JSON.stringify({ completed: true, dismissedAt: Date.now(), currentStep: 0 }),
      );
      // Also suppress startup tips which show after 1.5s and can intercept clicks.
      localStorage.setItem('e-startup-tips-seen', '1');

      // Instrument WebSocket so tests can introspect file-watch traffic.
      // Installed before any app script runs so we capture the socket from creation.
      (window as any).__e_wsMessages = [];
      const OrigWS = window.WebSocket;
      const Wrapped = function (this: any, ...args: any[]) {
        const url = String(args[0] ?? '');
        const ws = new (OrigWS as any)(...args);
        if (url.includes('/file-watch/ws')) {
          ws.addEventListener('message', (e: MessageEvent) => {
            try {
              (window as any).__e_wsMessages.push(JSON.parse(e.data));
            } catch {}
          });
        }
        return ws;
      };
      // @ts-ignore — preserve prototype so `instanceof WebSocket` stays true for existing code
      Wrapped.prototype = OrigWS.prototype;
      Object.setPrototypeOf(Wrapped, OrigWS);
      // @ts-ignore
      window.WebSocket = Wrapped;
    });
    await page.goto('/');
    await expect(page.locator('#splash')).toHaveCount(0, { timeout: 15_000 });
    await use(page);
  },
});

export { expect };

/**
 * Register the test directory as a workspace AND set it as the global workspacePath.
 *
 * Registration is the one the client actually reads on fresh sessions: with no
 * localStorage state, workspaceStore falls back to `GET /api/workspaces` and opens
 * the most recently used one. We also PATCH settings for callers that read that
 * directly (like the server-side file watcher init).
 */
export async function pointServerAtWorkspace(
  request: APIRequestContext,
  workspacePath: string,
): Promise<void> {
  const create = await request.post('/api/workspaces', {
    data: { name: 'e2e-test', path: workspacePath },
  });
  // 409 means this workspace already exists (leftover from a previous run); that's fine,
  // we just need to make sure it's the most-recently-opened so the client picks it up.
  if (!create.ok() && create.status() !== 409) {
    throw new Error(`workspaces create failed: ${create.status()} ${await create.text()}`);
  }
  // Touch last_opened so workspaceStore._recoverFromServer picks this one.
  // We need the workspace id; look it up from the list endpoint.
  const list = await request.get('/api/workspaces');
  const body = await list.json();
  const ws = body.data.find((w: any) => w.path === workspacePath);
  if (ws) {
    await request.post(`/api/workspaces/${ws.id}/open`);
  }
  const settings = await request.patch('/api/settings', {
    data: { workspacePath },
  });
  expect(settings.ok()).toBeTruthy();
}

/**
 * Open a file via the file-tree UI click flow. This is the user journey so
 * we drive it through the UI rather than reaching into stores.
 */
export async function openFileViaTree(page: Page, relativePath: string): Promise<void> {
  // Files is a default sidebar tab, so just click it.
  await page.locator('button[title="Files"]').first().click();
  const item = page.locator(`.tree-item:has-text("${relativePath.split('/').pop()}")`).first();
  await expect(item).toBeVisible({ timeout: 5_000 });
  await item.click();
  // Wait for a CodeMirror editor to appear — proves the file was opened.
  await expect(page.locator('.cm-editor').first()).toBeVisible({ timeout: 5_000 });
}
