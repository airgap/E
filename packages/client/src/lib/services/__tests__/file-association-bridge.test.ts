/**
 * Tests for the file-association bridge. Verifies:
 *   1. The cold-start global (`window.__E_OPEN_FILE__`) is drained on
 *      install — handles the race where preload dispatches before the
 *      Svelte component mounts and registers the event listener.
 *   2. Runtime CustomEvent dispatches route through to editorStore.openFile.
 *   3. Loose-file flag flips Zen Mode on.
 *   4. install() is idempotent so HMR re-mounts don't double-register.
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';

// Mock the stores BEFORE importing the bridge so the module-level
// references resolve to the mocks.
const openFile = vi.fn(async (_path: string) => {});
vi.mock('$lib/stores/editor.svelte', () => ({
  editorStore: {
    openFile,
  },
}));

let zenMode = false;
const setZenMode = vi.fn((v: boolean) => {
  zenMode = v;
});
vi.mock('$lib/stores/ui.svelte', () => ({
  uiStore: {
    get zenMode() {
      return zenMode;
    },
    setZenMode,
  },
}));

const { installFileAssociationBridge } = await import('../file-association-bridge');

function flushMicrotasks() {
  return new Promise<void>((r) => queueMicrotask(r));
}

beforeEach(() => {
  openFile.mockClear();
  setZenMode.mockClear();
  zenMode = false;
  delete (window as any).__E_OPEN_FILE__;
  // Reset module-scoped install latch by re-importing? Vi's mock.module
  // doesn't expose that — instead, the bridge's `installed` latch is
  // intentionally one-shot for the test process. We test idempotency
  // separately by counting listener invocations, not by re-installing.
});

describe('installFileAssociationBridge', () => {
  test('drains the cold-start global and opens the file', async () => {
    (window as any).__E_OPEN_FILE__ = { path: '/tmp/foo.ts', loose: false };
    installFileAssociationBridge();
    await flushMicrotasks();
    expect(openFile).toHaveBeenCalledWith('/tmp/foo.ts');
    expect((window as any).__E_OPEN_FILE__).toBeUndefined();
    expect(setZenMode).not.toHaveBeenCalled();
  });

  test('loose=true flips Zen Mode on after the file opens', async () => {
    window.dispatchEvent(
      new CustomEvent('e:open-file', { detail: { path: '/tmp/loose.svelte', loose: true } }),
    );
    // The bridge awaits openFile then queues a microtask to flip zen — let
    // both resolve.
    await flushMicrotasks();
    await flushMicrotasks();
    expect(openFile).toHaveBeenCalledWith('/tmp/loose.svelte');
    expect(setZenMode).toHaveBeenCalledWith(true);
  });

  test('loose=false does NOT toggle Zen', async () => {
    window.dispatchEvent(
      new CustomEvent('e:open-file', { detail: { path: '/repo/src/foo.ts', loose: false } }),
    );
    await flushMicrotasks();
    expect(openFile).toHaveBeenCalledWith('/repo/src/foo.ts');
    expect(setZenMode).not.toHaveBeenCalled();
  });

  test('repeated install() calls do not register duplicate listeners', async () => {
    installFileAssociationBridge();
    installFileAssociationBridge();
    installFileAssociationBridge();
    window.dispatchEvent(
      new CustomEvent('e:open-file', { detail: { path: '/tmp/once.ts', loose: false } }),
    );
    await flushMicrotasks();
    // Should fire exactly once — the bridge's `installed` latch protects
    // against listener duplication under HMR.
    expect(openFile).toHaveBeenCalledTimes(1);
  });

  test('skips opens when the detail has no path (defensive)', async () => {
    window.dispatchEvent(new CustomEvent('e:open-file', { detail: { path: '', loose: true } }));
    await flushMicrotasks();
    expect(openFile).not.toHaveBeenCalled();
    expect(setZenMode).not.toHaveBeenCalled();
  });

  test('does not flip Zen when zenMode is already on (no-op via setZenMode guard)', async () => {
    zenMode = true; // already in zen
    window.dispatchEvent(
      new CustomEvent('e:open-file', { detail: { path: '/tmp/foo.pui', loose: true } }),
    );
    await flushMicrotasks();
    await flushMicrotasks();
    expect(openFile).toHaveBeenCalledWith('/tmp/foo.pui');
    // The bridge checks zenMode before calling setZenMode — skip when on.
    expect(setZenMode).not.toHaveBeenCalled();
  });
});
