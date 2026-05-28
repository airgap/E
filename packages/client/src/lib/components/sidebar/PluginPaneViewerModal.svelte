<script lang="ts">
  /**
   * Plugin side-pane viewer modal. Renders the plugin's HTML asset in a
   * sandboxed iframe so the plugin's own JS (if any) can run without
   * direct access to E's renderer or API.
   *
   * Default sandbox = `'allow-scripts'`. Plugins requesting riskier flags
   * (`allow-same-origin`, `allow-top-navigation`, etc.) had to declare
   * them in their manifest's `sidePanes[].sandbox` field; we honor that
   * verbatim. Future hardening: an extra confirmation in the install
   * flow when the manifest requests dangerous flags. Tracked but not
   * gated yet.
   */
  import { uiStore } from '$lib/stores/ui.svelte';
  import { activePluginPaneStore } from '$lib/stores/active-plugin-pane.svelte';
  import { getBaseUrl } from '$lib/api/client';
  import {
    onPluginCommand,
    postCommandToIframe,
    registerPluginIframe,
  } from '$lib/stores/pluginBridge';

  let iframeEl: HTMLIFrameElement | undefined = $state();

  // Forward palette-fired plugin commands into the iframe when the open
  // pane belongs to that plugin (LYK-1030 host→iframe hop). When this
  // modal isn't showing the plugin, the dispatch is dropped.
  $effect(() => {
    const off = onPluginCommand((d) => {
      const a = activePluginPaneStore.active;
      if (!a || a.plugin.manifest.id !== d.pluginId) return;
      postCommandToIframe(iframeEl, d.command, d.args);
    });
    return off;
  });

  // Register the iframe with the inbound RPC dispatcher so requests it
  // sends are routed to host handlers (LYK-1056). Re-runs when either
  // the iframe element or active plugin id changes.
  $effect(() => {
    const a = activePluginPaneStore.active;
    if (!iframeEl || !a) return;
    return registerPluginIframe(a.plugin.manifest.id, iframeEl);
  });

  function close() {
    uiStore.closeModal();
    activePluginPaneStore.clear();
  }

  function onBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) close();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }

  // `src` resolves through the server's /plugins/<id>/<path> static route
  // (path-traversal-safe; never escapes the plugin install dir).
  let src = $derived.by(() => {
    const a = activePluginPaneStore.active;
    if (!a) return '';
    const base = getBaseUrl();
    // pane.src is a relative path inside the plugin zip — never starts
    // with '/'. Validated at install time.
    return `${base}/plugins/${encodeURIComponent(a.plugin.manifest.id)}/${a.pane.src}`;
  });

  let sandbox = $derived(activePluginPaneStore.active?.pane.sandbox ?? 'allow-scripts');
  let title = $derived(activePluginPaneStore.active?.pane.label ?? 'Plugin');
  let pluginName = $derived(activePluginPaneStore.active?.plugin.manifest.displayName ?? '');
</script>

<svelte:window onkeydown={onKey} />

<div class="backdrop" role="presentation" onclick={onBackdropClick}>
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="plugin-pane-title">
    <header class="head">
      <h2 id="plugin-pane-title" class="title">{title}</h2>
      {#if pluginName}<span class="badge">{pluginName}</span>{/if}
      <button class="x" onclick={close} aria-label="Close" title="Close (Esc)">×</button>
    </header>
    <div class="body">
      {#if src}
        <iframe {src} {sandbox} {title} referrerpolicy="no-referrer" allow="" bind:this={iframeEl}
        ></iframe>
      {:else}
        <div class="state">No pane selected.</div>
      {/if}
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 24px;
  }
  .modal {
    background: var(--bg-secondary, #1e1e1e);
    color: var(--text-primary, #d4d4d4);
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.1));
    border-radius: 6px;
    width: min(1000px, 100%);
    height: min(720px, 100%);
    display: flex;
    flex-direction: column;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
    flex-shrink: 0;
  }
  .title {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    flex: 1;
  }
  .badge {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    background: var(--bg-tertiary, rgba(255, 255, 255, 0.06));
    color: var(--text-secondary, #aaa);
    padding: 2px 8px;
    border-radius: 8px;
  }
  .x {
    width: 28px;
    height: 28px;
    border: none;
    background: transparent;
    color: var(--text-secondary, #aaa);
    font-size: 18px;
    cursor: pointer;
    border-radius: 4px;
  }
  .x:hover {
    background: var(--bg-hover, rgba(255, 255, 255, 0.06));
    color: var(--text-primary, #d4d4d4);
  }
  .body {
    flex: 1;
    overflow: hidden;
    display: flex;
  }
  iframe {
    flex: 1;
    border: none;
    width: 100%;
    height: 100%;
    background: white;
  }
  .state {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-tertiary, #888);
  }
</style>
