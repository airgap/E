<script lang="ts">
  import { onMount } from 'svelte';

  let { side = 'right' }: { side?: 'left' | 'right' } = $props();

  // Tauri injects window.__TAURI__ when withGlobalTauri: true.
  // In browser dev mode this is absent — guard everything behind this flag.
  const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;

  // Detect macOS via navigator.platform (reliable: 'MacIntel', 'MacARM', 'Mac68K').
  // macOS convention: controls on the left. Windows/Linux: controls on the right.
  const isMac =
    typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent);

  // Only render when this instance is on the platform-appropriate side.
  const shouldRender = $derived(
    isTauri && ((isMac && side === 'left') || (!isMac && side === 'right')),
  );

  let isMaximized = $state(false);

  function getWin() {
    return (window as any).__TAURI__?.window?.getCurrentWindow?.();
  }

  async function updateMaximized() {
    try {
      isMaximized = (await getWin()?.isMaximized()) ?? false;
    } catch {
      // Non-critical — ignore silently
    }
  }

  async function minimize() {
    try {
      await getWin()?.minimize();
    } catch {}
  }

  async function toggleMaximize() {
    try {
      await getWin()?.toggleMaximize();
      // Poll state after toggle since the event may not fire synchronously
      setTimeout(updateMaximized, 50);
    } catch {}
  }

  async function closeWindow() {
    try {
      await getWin()?.close();
    } catch {}
  }

  onMount(() => {
    if (!isTauri) return;

    updateMaximized();

    // Use native resize events to detect maximize/restore transitions.
    // This avoids needing a separate Tauri event listener permission.
    window.addEventListener('resize', updateMaximized);
    return () => window.removeEventListener('resize', updateMaximized);
  });
</script>

{#if shouldRender}
  <div class="window-controls" class:mac={isMac}>
    <button class="ctrl minimize" onclick={minimize} title="Minimize" aria-label="Minimize window">
      <!-- Horizontal bar -->
      <svg width="10" height="2" viewBox="0 0 10 2" aria-hidden="true">
        <line x1="0" y1="1" x2="10" y2="1" stroke="currentColor" stroke-width="1.5" />
      </svg>
    </button>

    <button
      class="ctrl maximize"
      onclick={toggleMaximize}
      title={isMaximized ? 'Restore' : 'Maximize'}
      aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
    >
      {#if isMaximized}
        <!-- Restore: two overlapping squares -->
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <rect
            x="2.5"
            y="0.5"
            width="7"
            height="7"
            rx="0.5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.25"
          />
          <rect
            x="0.5"
            y="2.5"
            width="7"
            height="7"
            rx="0.5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.25"
          />
        </svg>
      {:else}
        <!-- Maximize: single square -->
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <rect
            x="0.5"
            y="0.5"
            width="9"
            height="9"
            rx="0.5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.25"
          />
        </svg>
      {/if}
    </button>

    <button class="ctrl close" onclick={closeWindow} title="Close" aria-label="Close window">
      <!-- × icon -->
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <line
          x1="1.5"
          y1="1.5"
          x2="8.5"
          y2="8.5"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
        />
        <line
          x1="8.5"
          y1="1.5"
          x2="1.5"
          y2="8.5"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
        />
      </svg>
    </button>
  </div>
{/if}

<style>
  .window-controls {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
    /* Sit above the topbar ::after overlay (which uses pointer-events: none) */
    position: relative;
    z-index: 1;
  }

  /* macOS: reverse order so Close is leftmost (traffic-light convention) */
  .window-controls.mac {
    flex-direction: row-reverse;
  }

  .ctrl {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-sm);
    color: var(--text-tertiary);
    border: 1px solid transparent;
    transition: all var(--transition);
    flex-shrink: 0;
  }

  .ctrl:hover {
    border-color: var(--border-primary);
    background: var(--bg-hover);
  }

  .ctrl:active {
    transform: scale(0.88);
    opacity: 0.8;
  }

  /* Semantic hover colors — each button signals its destructiveness */
  .ctrl.minimize:hover {
    color: var(--accent-warning);
    box-shadow: 0 0 6px color-mix(in srgb, var(--accent-warning) 30%, transparent);
  }

  .ctrl.maximize:hover {
    color: var(--accent-secondary);
    box-shadow: 0 0 6px color-mix(in srgb, var(--accent-secondary) 30%, transparent);
  }

  .ctrl.close:hover {
    color: var(--accent-error);
    box-shadow: 0 0 6px color-mix(in srgb, var(--accent-error) 30%, transparent);
  }
</style>
