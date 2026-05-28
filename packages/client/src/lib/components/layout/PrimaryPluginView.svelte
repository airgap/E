<script lang="ts">
  /**
   * PrimaryPluginView — full-pane plugin primary tab. Renders the plugin's
   * declared `src` (HTML asset, served through /plugins/<id>/<…>) in a
   * sandboxed iframe.
   *
   * Default sandbox = 'allow-scripts'. Plugins requesting wider sandbox
   * flags (e.g. allow-forms, allow-modals) declare them in the manifest's
   * primaryPanes[].sandbox field; we honour it verbatim. allow-same-origin
   * is intentionally NOT default — granting it means the plugin's JS can
   * reach the parent's API surface via window.parent, which defeats the
   * isolation. Future hardening: install-time confirmation when the
   * manifest requests dangerous flags.
   */
  import { getBaseUrl } from '$lib/api/client';

  let { pluginId, src, sandbox }: { pluginId: string; src: string; sandbox?: string } = $props();

  // Build the URL once; the asset route is path-traversal-safe + only
  // serves files inside the plugin's install dir.
  let iframeSrc = $derived(`${getBaseUrl()}/plugins/${encodeURIComponent(pluginId)}/${src}`);
  let iframeSandbox = $derived(sandbox ?? 'allow-scripts');
</script>

<div class="plugin-primary-view">
  <iframe
    src={iframeSrc}
    sandbox={iframeSandbox}
    title={`Plugin pane: ${pluginId}`}
    referrerpolicy="no-referrer"
    allow=""
  ></iframe>
</div>

<style>
  .plugin-primary-view {
    width: 100%;
    height: 100%;
    display: flex;
  }
  iframe {
    flex: 1;
    border: none;
    width: 100%;
    height: 100%;
    background: white;
  }
</style>
