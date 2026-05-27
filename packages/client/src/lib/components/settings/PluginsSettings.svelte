<script lang="ts">
  /**
   * Plugins settings panel — list installed plugins, install from .zip via
   * file picker or drag-drop, enable / disable / uninstall each.
   *
   * The contribution-kind badges on each row reflect what's wired
   * end-to-end vs. what's manifest-only ("coming soon"). The honest
   * framing avoids users assuming an LSP-shipping plugin will actually
   * start an LSP server today — it won't, until that runtime ships.
   */
  import { onMount } from 'svelte';
  import { pluginsStore } from '$lib/stores/plugins.svelte';
  import { uiStore } from '$lib/stores/ui.svelte';

  let fileInput = $state<HTMLInputElement | null>(null);
  let installing = $state(false);
  let installErrors = $state<string[]>([]);
  let dragOver = $state(false);

  onMount(() => {
    void pluginsStore.reload();
  });

  async function handleFile(file: File) {
    if (!file) return;
    if (!/\.zip$/i.test(file.name)) {
      installErrors = [`"${file.name}" is not a .zip file`];
      return;
    }
    installing = true;
    installErrors = [];
    const result = await pluginsStore.install(file);
    installing = false;
    if ('errors' in result) {
      installErrors = result.errors;
    } else {
      uiStore.toast(`Installed ${result.manifest.displayName}`, 'success');
    }
  }

  function onPickFile(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) void handleFile(f);
    // Reset so picking the same file again retriggers install (e.g. after fix).
    (e.target as HTMLInputElement).value = '';
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    const f = e.dataTransfer?.files?.[0];
    if (f) void handleFile(f);
  }

  async function toggleEnabled(id: string, enabled: boolean) {
    const ok = await pluginsStore.setEnabled(id, enabled);
    if (!ok) uiStore.toast('Failed to update plugin state', 'error');
  }

  async function uninstall(id: string, name: string) {
    if (!confirm(`Uninstall ${name}? This removes the extracted files.`)) return;
    const ok = await pluginsStore.uninstall(id);
    if (ok) uiStore.toast(`Uninstalled ${name}`, 'success');
    else uiStore.toast('Uninstall failed', 'error');
  }

  function contributionSummary(p: import('@e/shared').InstalledPlugin): string[] {
    const c = p.manifest.contributes ?? {};
    const parts: string[] = [];
    if (c.sidePanes?.length)
      parts.push(`${c.sidePanes.length} side pane${c.sidePanes.length > 1 ? 's' : ''}`);
    if (c.lsp?.length) parts.push(`${c.lsp.length} lsp`);
    if (c.primaryPanes?.length)
      parts.push(`${c.primaryPanes.length} primary pane${c.primaryPanes.length > 1 ? 's' : ''}`);
    if (c.syntaxHighlighters?.length) parts.push(`${c.syntaxHighlighters.length} syntax`);
    if (c.diagnostics?.length) parts.push(`${c.diagnostics.length} diagnostics`);
    if (c.hovers?.length) parts.push(`${c.hovers.length} hover`);
    return parts;
  }
</script>

<div class="plugins-settings">
  <header class="head">
    <h3>Plugins</h3>
    <p class="head-desc">
      Install plugins from <code>.zip</code> files. v1 wires <strong>side panes</strong>
      end-to-end; the other contribution kinds (LSP, syntax, primary panes, diagnostics, hovers) are accepted
      in manifests but not yet runtime-supported — each plugin's "warnings" list shows exactly which of
      its contributions are live.
    </p>
  </header>

  <!-- Install dropzone / picker -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="dropzone"
    class:drag-over={dragOver}
    class:installing
    ondragover={(e) => {
      e.preventDefault();
      dragOver = true;
    }}
    ondragleave={() => (dragOver = false)}
    ondrop={onDrop}
  >
    {#if installing}
      <span>Installing…</span>
    {:else}
      <p>Drag a <code>.zip</code> here, or</p>
      <button class="install-btn" onclick={() => fileInput?.click()}> Choose a plugin zip </button>
    {/if}
    <input
      bind:this={fileInput}
      type="file"
      accept=".zip,application/zip,application/x-zip-compressed"
      style="display: none"
      onchange={onPickFile}
    />
  </div>

  {#if installErrors.length > 0}
    <div class="errors" role="alert">
      <strong>Install failed:</strong>
      <ul>
        {#each installErrors as msg}
          <li>{msg}</li>
        {/each}
      </ul>
    </div>
  {/if}

  <!-- Installed list -->
  <section class="installed">
    <h4>Installed ({pluginsStore.plugins.length})</h4>
    {#if pluginsStore.loading && pluginsStore.plugins.length === 0}
      <p class="hint">Loading…</p>
    {:else if pluginsStore.plugins.length === 0}
      <p class="hint">No plugins installed yet.</p>
    {:else}
      <ul class="plugin-list">
        {#each pluginsStore.plugins as p (p.manifest.id)}
          <li class="plugin-item">
            <div class="plugin-head">
              <strong>{p.manifest.displayName}</strong>
              <span class="version">v{p.manifest.version}</span>
              {#if p.manifest.author}<span class="author">by {p.manifest.author}</span>{/if}
            </div>
            {#if p.manifest.description}
              <p class="desc">{p.manifest.description}</p>
            {/if}
            <div class="contributions">
              {#each contributionSummary(p) as c}
                <span class="contrib-chip">{c}</span>
              {/each}
            </div>
            {#if p.warnings.length > 0}
              <ul class="warnings">
                {#each p.warnings as w}
                  <li>⚠ {w}</li>
                {/each}
              </ul>
            {/if}
            <div class="row-actions">
              <label class="toggle">
                <input
                  type="checkbox"
                  checked={p.enabled}
                  onchange={(e) =>
                    toggleEnabled(p.manifest.id, (e.target as HTMLInputElement).checked)}
                />
                <span>{p.enabled ? 'Enabled' : 'Disabled'}</span>
              </label>
              <button
                class="uninstall"
                onclick={() => uninstall(p.manifest.id, p.manifest.displayName)}
              >
                Uninstall
              </button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>

<style>
  .plugins-settings {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .head h3 {
    margin: 0 0 6px;
    font-size: 14px;
    font-weight: 600;
  }
  .head-desc {
    margin: 0;
    font-size: 12px;
    color: var(--text-secondary, #aaa);
    line-height: 1.5;
  }
  .head-desc code {
    background: var(--bg-tertiary, rgba(255, 255, 255, 0.06));
    padding: 1px 4px;
    border-radius: 3px;
  }

  .dropzone {
    border: 2px dashed var(--border-secondary, rgba(255, 255, 255, 0.12));
    border-radius: 6px;
    padding: 28px 16px;
    text-align: center;
    transition:
      border-color 120ms ease,
      background-color 120ms ease;
  }
  .dropzone.drag-over {
    border-color: var(--accent-primary, #4ec1f5);
    background: color-mix(in srgb, var(--accent-primary, #4ec1f5) 6%, transparent);
  }
  .dropzone.installing {
    opacity: 0.7;
  }
  .dropzone p {
    margin: 0 0 8px;
    color: var(--text-secondary, #aaa);
    font-size: 12px;
  }
  .dropzone code {
    background: var(--bg-tertiary, rgba(255, 255, 255, 0.06));
    padding: 1px 4px;
    border-radius: 3px;
  }
  .install-btn {
    padding: 6px 14px;
    border-radius: 4px;
    background: var(--accent-bg, #0e639c);
    color: white;
    border: none;
    cursor: pointer;
    font-size: 12px;
  }
  .install-btn:hover {
    background: var(--accent-bg-hover, #1177bb);
  }

  .errors {
    background: color-mix(in srgb, var(--fg-danger, #e06c75) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--fg-danger, #e06c75) 30%, transparent);
    color: var(--fg-danger, #e06c75);
    padding: 10px 14px;
    border-radius: 4px;
    font-size: 12px;
  }
  .errors ul {
    margin: 4px 0 0 16px;
    padding: 0;
  }

  .installed h4 {
    margin: 0 0 8px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-secondary, #aaa);
  }
  .hint {
    margin: 0;
    color: var(--text-tertiary, #888);
    font-size: 12px;
  }
  .plugin-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .plugin-item {
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
    border-radius: 4px;
    padding: 10px 12px;
    background: var(--bg-tertiary, rgba(255, 255, 255, 0.03));
  }
  .plugin-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
  }
  .version {
    font-size: 11px;
    color: var(--text-tertiary, #888);
  }
  .author {
    font-size: 11px;
    color: var(--text-tertiary, #888);
  }
  .desc {
    margin: 4px 0 0;
    font-size: 12px;
    color: var(--text-secondary, #aaa);
  }
  .contributions {
    margin-top: 6px;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .contrib-chip {
    background: var(--bg-tertiary, rgba(255, 255, 255, 0.06));
    color: var(--text-secondary, #aaa);
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 8px;
  }
  .warnings {
    margin: 8px 0 0;
    padding: 0 0 0 16px;
    color: var(--accent-warning, #d4a657);
    font-size: 11px;
  }
  .row-actions {
    margin-top: 8px;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    cursor: pointer;
  }
  .uninstall {
    margin-left: auto;
    padding: 4px 10px;
    border-radius: 3px;
    background: transparent;
    color: var(--fg-danger, #e06c75);
    border: 1px solid color-mix(in srgb, var(--fg-danger, #e06c75) 30%, transparent);
    font-size: 11px;
    cursor: pointer;
  }
  .uninstall:hover {
    background: color-mix(in srgb, var(--fg-danger, #e06c75) 12%, transparent);
  }
</style>
