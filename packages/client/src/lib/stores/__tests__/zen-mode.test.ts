/**
 * Zen Mode unit tests on the uiStore. Three guarantees worth pinning:
 *
 *   1. Toggle is symmetric (on → off restores the entry state).
 *   2. Entering Zen stashes the pre-existing sidebar-open state and
 *      restores it on exit — a user who had the sidebar closed before
 *      entering Zen shouldn't have it forcibly re-opened on exit.
 *   3. Opening a sidebar tab while in Zen exits Zen automatically so
 *      the user can't get into a state where the tab activation does
 *      nothing visible.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { uiStore } from '../ui.svelte';

beforeEach(() => {
  // Start each test from a clean baseline. The store is a module
  // singleton; reset the bits we mutate.
  if (uiStore.zenMode) uiStore.toggleZenMode();
  uiStore.setSidebarOpen(true);
  uiStore.setSidebarTab('conversations');
  if (uiStore.zenMode) uiStore.toggleZenMode(); // setSidebarTab can re-enter if state was odd
});

describe('uiStore.zenMode', () => {
  test('toggleZenMode flips state', () => {
    expect(uiStore.zenMode).toBe(false);
    uiStore.toggleZenMode();
    expect(uiStore.zenMode).toBe(true);
    uiStore.toggleZenMode();
    expect(uiStore.zenMode).toBe(false);
  });

  test('entering Zen closes the sidebar', () => {
    uiStore.setSidebarOpen(true);
    uiStore.toggleZenMode();
    expect(uiStore.sidebarOpen).toBe(false);
  });

  test('exiting Zen restores the prior sidebar-open state (was open)', () => {
    uiStore.setSidebarOpen(true);
    uiStore.toggleZenMode();
    expect(uiStore.sidebarOpen).toBe(false);
    uiStore.toggleZenMode();
    expect(uiStore.sidebarOpen).toBe(true);
  });

  test('exiting Zen restores the prior sidebar-open state (was closed)', () => {
    uiStore.setSidebarOpen(false);
    uiStore.toggleZenMode();
    expect(uiStore.sidebarOpen).toBe(false);
    uiStore.toggleZenMode();
    // Was closed before entry → must stay closed on exit.
    expect(uiStore.sidebarOpen).toBe(false);
  });

  test('opening a sidebar tab while in Zen exits Zen so the user is never stuck', () => {
    uiStore.toggleZenMode();
    expect(uiStore.zenMode).toBe(true);
    uiStore.setSidebarTab('files');
    expect(uiStore.zenMode).toBe(false);
    expect(uiStore.sidebarOpen).toBe(true);
    expect(uiStore.sidebarTab).toBe('files');
  });

  test('setZenMode(v) is a no-op when v already matches current state', () => {
    expect(uiStore.zenMode).toBe(false);
    uiStore.setZenMode(false); // already off
    expect(uiStore.zenMode).toBe(false);

    uiStore.setZenMode(true);
    expect(uiStore.zenMode).toBe(true);
    uiStore.setZenMode(true); // already on
    expect(uiStore.zenMode).toBe(true);
  });
});
