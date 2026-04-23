import { test, expect, type Page } from '@playwright/test';

/**
 * Quick-open modal — verifies Ctrl+P (file mode), Ctrl+T (workspace symbols)
 * and Ctrl+Shift+O (document symbols) all open the same modal but seed the
 * input correctly. The symbol-search results themselves require a live LSP
 * and aren't covered here.
 *
 * We dispatch a synthetic KeyboardEvent on `window` (where svelte:window
 * attaches its handler) because real Ctrl+T / Ctrl+Shift+O would trigger
 * browser chrome shortcuts (new tab / bookmarks) before the app handler
 * runs in headless Chromium.
 */

async function fireKey(page: Page, key: string, opts: { ctrl?: boolean; shift?: boolean } = {}) {
  return page.evaluate(
    ({ key, ctrl, shift }) => {
      const codeMap: Record<string, string> = {
        p: 'KeyP',
        P: 'KeyP',
        t: 'KeyT',
        T: 'KeyT',
        o: 'KeyO',
        O: 'KeyO',
      };
      const event = new KeyboardEvent('keydown', {
        key,
        code: codeMap[key],
        ctrlKey: !!ctrl,
        shiftKey: !!shift,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(event);
      // Return whether any handler called preventDefault — useful for diagnosing.
      return event.defaultPrevented;
    },
    { key, ctrl: opts.ctrl ?? false, shift: opts.shift ?? false },
  );
}

test.describe('quick-open modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#splash')).toHaveCount(0, { timeout: 15_000 });
  });

  test('Ctrl+P opens in file mode with empty query', async ({ page }) => {
    const prevented = await fireKey(page, 'p', { ctrl: true });
    expect(prevented).toBe(true);
    const input = page.locator('.quick-open-input');
    await expect(input).toBeVisible();
    await expect(input).toHaveValue('');
    await expect(input).toHaveAttribute('placeholder', /Search files/);
    await page.keyboard.press('Escape');
  });

  test('Ctrl+T seeds workspace symbol mode with #', async ({ page }) => {
    const prevented = await fireKey(page, 't', { ctrl: true });
    expect(prevented).toBe(true);
    const input = page.locator('.quick-open-input');
    await expect(input).toBeVisible();
    await expect(input).toHaveValue('#');
    await expect(input).toHaveAttribute('placeholder', /symbols across the workspace/);
    await page.keyboard.press('Escape');
  });

  test('Ctrl+Shift+O seeds document symbol mode with @', async ({ page }) => {
    const prevented = await fireKey(page, 'O', { ctrl: true, shift: true });
    expect(prevented).toBe(true);
    const input = page.locator('.quick-open-input');
    await expect(input).toBeVisible();
    await expect(input).toHaveValue('@');
    await expect(input).toHaveAttribute('placeholder', /symbols in this file/);
    await page.keyboard.press('Escape');
  });
});
