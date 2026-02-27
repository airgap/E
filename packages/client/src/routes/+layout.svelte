<script lang="ts">
  import '../app.css';
  import AppShell from '$lib/components/layout/AppShell.svelte';
  import LoginPage from '$lib/components/auth/LoginPage.svelte';
  import { api, getAuthToken, initCsrfToken } from '$lib/api/client';
  import { streamStore, STREAM_CONTEXT_KEY } from '$lib/stores/stream.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { findFont, buildGoogleFontsUrl, type FontOption } from '$lib/config/fonts';
  import { onMount, setContext, tick } from 'svelte';
  import SparkleCursor from '$lib/components/effects/SparkleCursor.svelte';
  import StreamAudio from '$lib/components/effects/StreamAudio.svelte';
  import TerminalAudio from '$lib/components/effects/TerminalAudio.svelte';
  import CommentaryAudio from '$lib/components/effects/CommentaryAudio.svelte';
  import LoopNotifications from '$lib/components/effects/LoopNotifications.svelte';
  import { goto } from '$app/navigation';

  // Set stream store in context for proper Svelte 5 reactivity tracking
  setContext(STREAM_CONTEXT_KEY, streamStore);

  // Expose goto on window so desktop notification click handlers can navigate
  if (typeof window !== 'undefined') {
    window.__e_goto = goto;
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

    // Base font size (used by mono / code contexts)
    root.style.setProperty('--font-size', `${basePx}px`);

    // UI (sans) font size — independent control when set, otherwise follows code font.
    // Some typefaces carry a per-font sizeAdjust offset to compensate for visual sizing.
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

  onMount(async () => {
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

    // Wait for the DOM to settle after state change, then dismiss splash
    await tick();
    // Give one extra frame for layout to stabilize
    requestAnimationFrame(() => dismissSplash());
  });
</script>

{#if !checking && authRequired && !authenticated}
  <LoginPage
    onAuthenticated={() => {
      authenticated = true;
      tick().then(() => requestAnimationFrame(() => dismissSplash()));
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
