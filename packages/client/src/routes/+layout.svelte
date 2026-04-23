<script lang="ts">
  import '../app.css';
  import AppShell from '$lib/components/layout/AppShell.svelte';
  import LoginPage from '$lib/components/auth/LoginPage.svelte';
  import { api, getAuthToken, initCsrfToken, waitForServer } from '$lib/api/client';
  import { streamStore, STREAM_CONTEXT_KEY } from '$lib/stores/stream.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { findFont, buildGoogleFontsUrl, type FontOption } from '$lib/config/fonts';
  import { onMount, setContext, tick } from 'svelte';
  import { appReady } from '$lib/stores/ready';
  import SparkleCursor from '$lib/components/effects/SparkleCursor.svelte';
  import StreamAudio from '$lib/components/effects/StreamAudio.svelte';
  import TerminalAudio from '$lib/components/effects/TerminalAudio.svelte';
  import CommentaryAudio from '$lib/components/effects/CommentaryAudio.svelte';
  import LoopNotifications from '$lib/components/effects/LoopNotifications.svelte';
  import ActivityBreathing from '$lib/components/effects/ActivityBreathing.svelte';
  import { goto } from '$app/navigation';

  // Set stream store in context for proper Svelte 5 reactivity tracking
  setContext(STREAM_CONTEXT_KEY, streamStore);

  // Expose goto on window so desktop notification click handlers can navigate
  if (typeof window !== 'undefined') {
    window.__e_goto = goto;

    // Test-only hook — scoped to http(s) origins so it's a no-op inside the
    // Tauri webview (which serves from tauri://localhost). Desktop mode has
    // no use for it anyway.
    const origin = typeof location !== 'undefined' ? location.protocol : '';
    if (origin === 'http:' || origin === 'https:') {
      (async () => {
        const [{ primaryPaneStore }, { editorStore }] = await Promise.all([
          import('$lib/stores/primaryPane.svelte'),
          import('$lib/stores/editor.svelte'),
        ]);
        (window as any).__e_test = {
          activeFileContent(): string | undefined {
            const tab = primaryPaneStore.activeTab();
            return tab?.kind === 'file' ? tab.fileContent : undefined;
          },
          refreshFileTab: (path: string) => primaryPaneStore.refreshFileTab(path),
          refreshEditorFile: (path: string) => editorStore.refreshFile(path),
        };
      })();
    }
  }

  // --- Dynamic font loading & CSS variable application ---
  const loadedFonts = new Set<string>();

  function loadGoogleFont(font: FontOption) {
    if (!font.googleFont || loadedFonts.has(font.id)) return;
    const url = buildGoogleFontsUrl([font]);
    if (!url) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    document.head.appendChild(link);
    loadedFonts.add(font.id);
  }

  $effect(() => {
    const root = document.documentElement;
    // Enforce accessibility minimum (12px) even for persisted legacy values
    const basePx = Math.max(12, settingsStore.fontSize);

    // Apply mono font
    const monoFont = findFont(settingsStore.fontFamily);
    if (monoFont) {
      loadGoogleFont(monoFont);
      root.style.setProperty('--font-family', monoFont.family);
    }

    // Apply sans font (with per-font size adjustment)
    const sansFont = findFont(settingsStore.fontFamilySans);
    if (sansFont) {
      loadGoogleFont(sansFont);
      root.style.setProperty('--font-family-sans', sansFont.family);
    }

    // Base code font size — same per-font `sizeAdjust` mechanism as the sans
    // axis, so typefaces with unusual x-heights (Share Tech Mono is ~15%
    // smaller than IDE-standard monos at the same px) can compensate instead
    // of forcing users to manually bump the size.
    const monoPx = basePx + (monoFont?.sizeAdjust ?? 0);
    root.style.setProperty('--font-size', `${monoPx}px`);

    // UI (sans) font size — independent control when set, otherwise follows code font.
    const uiBasePx = Math.max(12, settingsStore.effectiveUiFontSize);
    const sansPx = uiBasePx + (sansFont?.sizeAdjust ?? 0);
    root.style.setProperty('--font-size-sans', `${sansPx}px`);
  });

  let { children } = $props();

  let authRequired = $state(false);
  let authenticated = $state(false);
  let checking = $state(true);

  /** Dismiss the HTML splash screen with a fade-out */
  function dismissSplash() {
    const el = document.getElementById('splash');
    if (!el) return;
    el.classList.add('dismissed');
    // Remove from DOM after transition
    setTimeout(() => el.remove(), 350);
  }

  /**
   * Wait for AppShell's full init chain (server → workspace → stream
   * reconnect → conversation restore) before dismissing splash.
   * Safety timeout ensures we never get stuck.
   */
  async function awaitReadyThenDismiss() {
    const SAFETY_TIMEOUT = 8000;
    await Promise.race([appReady, new Promise<void>((r) => setTimeout(r, SAFETY_TIMEOUT))]);
    dismissSplash();
  }

  onMount(async () => {
    // Kick off splash dismissal FIRST so its safety timeout can always fire —
    // if anything below throws or hangs (e.g. API calls before Tauri has injected
    // the sidecar port), the user still sees the app instead of the loading logo.
    awaitReadyThenDismiss();

    // In Tauri the sidecar port is injected asynchronously; fetches that leave
    // before it lands hit the custom protocol handler and hang indefinitely.
    // Wait for the origin to be known before any auth/CSRF calls.
    await waitForServer();

    // Fetch CSRF token before any mutations can happen
    await initCsrfToken();

    try {
      const status = await api.auth.status();
      authRequired = status.data.enabled;
      if (authRequired && getAuthToken()) {
        // Validate existing token
        try {
          await api.auth.me();
          authenticated = true;
        } catch {
          authenticated = false;
        }
      } else if (!authRequired) {
        authenticated = true;
      }
    } catch {
      // Can't reach server or auth not set up — show app
      authenticated = true;
    }
    checking = false;
  });
</script>

{#if !checking && authRequired && !authenticated}
  <LoginPage
    onAuthenticated={() => {
      authenticated = true;
      awaitReadyThenDismiss();
    }}
  />
{:else}
  <AppShell>
    {@render children()}
  </AppShell>
{/if}
{#if settingsStore.hypertheme === 'study'}
  <SparkleCursor />
{/if}
<StreamAudio />
<TerminalAudio />
<CommentaryAudio />
<LoopNotifications />
<ActivityBreathing />
