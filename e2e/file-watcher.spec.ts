import { test as base, expect, openFileViaTree, pointServerAtWorkspace } from './fixtures';
import { writeFileSync, mkdtempSync, rmSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * End-to-end file watcher: modify a file on disk externally and assert the
 * open editor picks up the change without user intervention.
 *
 * We build the fixture inline here rather than using the shared `wsPage`
 * fixture — this test needs the file to already exist BEFORE the server
 * starts watching, otherwise the inotify CREATE event storm delays delivery
 * of the actual modification we care about.
 */

const FIXTURE_ROOT = join(__dirname, '..', '.e2e-tmp');
if (!existsSync(FIXTURE_ROOT)) mkdirSync(FIXTURE_ROOT, { recursive: true });

const test = base.extend<{ preseededWs: { dir: string; filePath: string } }>({
  preseededWs: async ({}, use) => {
    const dir = mkdtempSync(join(FIXTURE_ROOT, 'fw-'));
    const filePath = join(dir, 'hello.txt');
    writeFileSync(filePath, 'line one\nline two\n', 'utf-8');
    await use({ dir, filePath });
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  },
});

test.describe('file watcher', () => {
  test('editor reloads when the underlying file changes on disk', async ({
    preseededWs,
    page,
    request,
  }) => {
    await pointServerAtWorkspace(request, preseededWs.dir);
    await page.addInitScript(() => {
      localStorage.setItem(
        'e-tutorial',
        JSON.stringify({ completed: true, dismissedAt: Date.now(), currentStep: 0 }),
      );
      localStorage.setItem('e-startup-tips-seen', '1');
    });
    await page.goto('/');
    await expect(page.locator('#splash')).toHaveCount(0, { timeout: 15_000 });

    await openFileViaTree(page, 'hello.txt');
    await expect(page.locator('.cm-line').first()).toHaveText(/line one/);

    const status = await request.get('/api/file-watch/status').then((r) => r.json());
    expect(status.data.root).toBe(preseededWs.dir);

    writeFileSync(preseededWs.filePath, 'updated one\nupdated two\nupdated three\n', 'utf-8');

    await expect(page.locator('.cm-line').first()).toHaveText(/updated one/, {
      timeout: 10_000,
    });
    await expect(page.locator('.cm-line').nth(2)).toHaveText(/updated three/);
  });
});
