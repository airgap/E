import { test, expect, openFileViaTree } from './fixtures';

/**
 * Multi-cursor keybindings inside CodeMirror 6.
 *
 * We inspect `.cm-cursor` DOM elements, which CM6 renders one per live
 * selection range. After Ctrl+Alt+Down we expect two visible cursors.
 * Ctrl+Shift+L selects every occurrence of the current word.
 */

test.describe('multi-cursor', () => {
  test('Ctrl+Alt+Down adds a cursor on the line below', async ({ wsPage: page, workspace }) => {
    workspace.writeFile('mc.txt', 'alpha\nbeta\ngamma\n');
    await openFileViaTree(page, 'mc.txt');

    // Focus the editor and place the cursor on line 1.
    const firstLine = page.locator('.cm-line').first();
    await firstLine.click();

    // One cursor before the shortcut.
    await expect(page.locator('.cm-cursor')).toHaveCount(1);

    await page.keyboard.press('Control+Alt+ArrowDown');

    await expect(page.locator('.cm-cursor')).toHaveCount(2);
  });

  test('Ctrl+Shift+L selects all occurrences of the word under the cursor', async ({
    wsPage: page,
    workspace,
  }) => {
    workspace.writeFile('dupes.txt', 'foo\nbar foo\nfoo baz\n');
    await openFileViaTree(page, 'dupes.txt');

    // Double-click the first "foo" to select it as a word.
    const firstLine = page.locator('.cm-line').first();
    await firstLine.dblclick();

    // Sanity: one selection range, one cursor.
    await expect(page.locator('.cm-cursor')).toHaveCount(1);

    await page.keyboard.press('Control+Shift+l');

    // Three foos total — every match gets its own cursor.
    await expect(page.locator('.cm-cursor')).toHaveCount(3, { timeout: 2_000 });
  });
});
