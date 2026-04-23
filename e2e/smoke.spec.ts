import { test, expect } from '@playwright/test';

/**
 * Baseline smoke test — is E actually booting in test mode?
 *
 * This is the canary: if anything breaks here, every other test is unreliable.
 * We do the bare minimum: hit the health endpoint and load the SPA.
 */

test.describe('smoke', () => {
  test('health endpoint responds with ok', async ({ request }) => {
    const res = await request.get('/health');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test('app shell loads and splash dismisses', async ({ page }) => {
    await page.goto('/');
    // The splash element exists at load time and removes itself once AppShell signals ready.
    // Waiting on its removal proves the init chain completed (server reachable, workspace loaded).
    await expect(page.locator('#splash')).toHaveCount(0, { timeout: 15_000 });
  });
});
