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
  import { api } from '$lib/api/client';
  import type { PluginRegistry, PluginRegistryEntry } from '@e/shared';
  import PluginConfigForm from './PluginConfigForm.svelte';

  let view = $state<'installed' | 'browse'>('installed');

  let fileInput = $state<HTMLInputElement | null>(null);
  let installing = $state(false);
  let installErrors = $state<string[]>([]);
  let dragOver = $state(false);

  // Registry state
  let registryUrl = $state<string | null>(null);
  let registryUrlDraft = $state('');
  let registryUrlSaving = $state(false);
  let registryUrlError = $state<string | null>(null);
  let registryIndex = $state<PluginRegistry | null>(null);
  let registryFetchedAt = $state<number | null>(null);
  let registryFromCache = $state(false);
  let registryLoading = $state(false);
  let registryErrors = $state<string[]>([]);
  let registryInstallingId = $state<string | null>(null);

  // ── Registry discovery: search / tag filter / sort / pagination (LYK-1057) ──
  let registrySearch = $state('');
  let registryTagFilter = $state<Set<string>>(new Set());
  let registrySort = $state<'name' | 'recent'>('recent');
  let registryPage = $state(0);
  const REGISTRY_PAGE_SIZE = 50;

  /** Unique tags across the index, sorted alphabetically. */
  const availableTags = $derived(
    Array.from(new Set((registryIndex?.entries ?? []).flatMap((e) => e.tags ?? []))).sort(),
  );

  /** Search + tag filter applied to the registry. */
  const filteredEntries = $derived.by(() => {
    const entries = registryIndex?.entries ?? [];
    const q = registrySearch.trim().toLowerCase();
    return entries.filter((e) => {
      if (registryTagFilter.size > 0) {
        const tags = e.tags ?? [];
        for (const need of registryTagFilter) if (!tags.includes(need)) return false;
      }
      if (!q) return true;
      const hay = `${e.id}\n${e.displayName}\n${e.description ?? ''}\n${(e.tags ?? []).join(' ')}`;
      return hay.toLowerCase().includes(q);
    });
  });

  /** Sort applied to the filtered list. */
  const sortedEntries = $derived.by(() => {
    const list = [...filteredEntries];
    if (registrySort === 'name') {
      return list.sort((a, b) => a.displayName.localeCompare(b.displayName));
    }
    // 'recent' — preserve the registry's own ordering, which is newest-first
    // by the publisher convention.
    return list;
  });

  /** Current-page slice. */
  const paginatedEntries = $derived(
    sortedEntries.slice(registryPage * REGISTRY_PAGE_SIZE, (registryPage + 1) * REGISTRY_PAGE_SIZE),
  );
  const totalPages = $derived(Math.max(1, Math.ceil(sortedEntries.length / REGISTRY_PAGE_SIZE)));

  function toggleTag(t: string) {
    const next = new Set(registryTagFilter);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    registryTagFilter = next;
    registryPage = 0;
  }
  function clearFilters() {
    registrySearch = '';
    registryTagFilter = new Set();
    registryPage = 0;
  }

  onMount(async () => {
    void pluginsStore.reload();
    const cfg = await api.plugins.registryConfig();
    if (cfg.ok) {
      registryUrl = cfg.data.url;
      registryUrlDraft = cfg.data.url ?? '';
    }
  });

  async function loadRegistry(force = false) {
    registryLoading = true;
    registryErrors = [];
    const res = await api.plugins.fetchRegistry(force);
    registryLoading = false;
    if (!res.ok) {
      registryErrors = res.errors ?? ['fetch failed'];
      registryIndex = null;
      return;
    }
    registryIndex = res.data!.index;
    registryFetchedAt = res.data!.fetchedAt;
    registryFromCache = res.data!.fromCache;
  }

  async function saveRegistryUrl() {
    registryUrlSaving = true;
    registryUrlError = null;
    const url = registryUrlDraft.trim() === '' ? null : registryUrlDraft.trim();
    const res = await api.plugins.setRegistryUrl(url);
    registryUrlSaving = false;
    if (!res.ok) {
      registryUrlError = res.error ?? 'failed';
      return;
    }
    registryUrl = url;
    registryIndex = null;
    if (url) await loadRegistry();
  }

  async function installRegistryEntry(entry: PluginRegistryEntry) {
    registryInstallingId = entry.id;
    const res = await api.plugins.installFromRegistry(entry);
    registryInstallingId = null;
    if (res.ok) {
      uiStore.toast(`Installed ${entry.displayName}`, 'success');
      void pluginsStore.reload();
    } else {
      uiStore.toast(`Install failed: ${(res.errors ?? ['unknown'])[0]}`, 'error');
    }
  }

  function isInstalled(entryId: string): boolean {
    return pluginsStore.plugins.some((p) => p.manifest.id === entryId);
  }

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
      Install plugins from <code>.zip</code> files (Installed tab) or from a configured registry
      (Browse tab). <strong>Side panes</strong> and <strong>LSP servers</strong>
      are wired end-to-end; the other contribution kinds (syntax, primary panes, diagnostics, hovers)
      are accepted in manifests but not yet runtime-supported — each plugin's "warnings" list shows what's
      live for that plugin.
    </p>
  </header>

  <nav class="view-tabs">
    <button class:active={view === 'installed'} onclick={() => (view = 'installed')}>
      Installed
    </button>
    <button
      class:active={view === 'browse'}
      onclick={() => {
        view = 'browse';
        if (registryUrl && !registryIndex) void loadRegistry();
      }}
    >
      Browse
    </button>
  </nav>

  {#if view === 'installed'}
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
        <button class="install-btn" onclick={() => fileInput?.click()}>
          Choose a plugin zip
        </button>
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
              {#if p.enabled && p.manifest.contributes?.configuration}
                <!-- LYK-1033: render the plugin's declared settings inline.
                     Hidden when the plugin is disabled because reading +
                     writing values on a disabled plugin would just no-op
                     in the iframe; keeping the form behind enabled signals
                     "this surface is live". -->
                <PluginConfigForm block={p.manifest.contributes.configuration} />
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {:else}
    <!-- ── Browse (registry) ── -->
    <section class="registry">
      <div class="registry-config">
        <label for="reg-url">Registry URL (https only)</label>
        <div class="reg-url-row">
          <input
            id="reg-url"
            type="url"
            placeholder="https://example.com/plugins.json"
            bind:value={registryUrlDraft}
          />
          <button
            class="install-btn"
            onclick={saveRegistryUrl}
            disabled={registryUrlSaving || registryUrlDraft.trim() === (registryUrl ?? '')}
          >
            Save
          </button>
          <button
            class="install-btn"
            onclick={() => loadRegistry(true)}
            disabled={!registryUrl || registryLoading}
            title="Bypass cache and refetch"
          >
            Refresh
          </button>
        </div>
        {#if registryUrlError}
          <p class="reg-err">{registryUrlError}</p>
        {/if}
        {#if registryUrl && registryFetchedAt}
          <p class="reg-meta">
            Fetched {new Date(registryFetchedAt).toLocaleString()}
            {#if registryFromCache}<span class="cache-pill">cached</span>{/if}
          </p>
        {:else if !registryUrl}
          <p class="reg-meta hint">No registry configured. Paste a URL and press Save.</p>
        {/if}
      </div>

      {#if registryErrors.length > 0}
        <div class="errors" role="alert">
          <strong>Registry error:</strong>
          <ul>
            {#each registryErrors as msg}
              <li>{msg}</li>
            {/each}
          </ul>
        </div>
      {/if}

      {#if registryIndex}
        <h4>
          Available ({sortedEntries.length}{sortedEntries.length !== registryIndex.entries.length
            ? ` of ${registryIndex.entries.length}`
            : ''})
        </h4>

        <!-- LYK-1057: search + tag filter + sort controls -->
        {#if registryIndex.entries.length > 0}
          <div class="discovery-controls">
            <input
              type="search"
              class="discovery-search"
              placeholder="Search name, description, tags…"
              bind:value={registrySearch}
              oninput={() => (registryPage = 0)}
            />
            <select
              class="discovery-sort"
              bind:value={registrySort}
              onchange={() => (registryPage = 0)}
            >
              <option value="recent">Most recent</option>
              <option value="name">Name (A-Z)</option>
            </select>
            {#if availableTags.length > 0}
              <div class="discovery-tags">
                {#each availableTags as t (t)}
                  <button
                    type="button"
                    class="discovery-tag"
                    class:active={registryTagFilter.has(t)}
                    onclick={() => toggleTag(t)}
                  >
                    {t}
                  </button>
                {/each}
                {#if registrySearch || registryTagFilter.size > 0}
                  <button type="button" class="discovery-clear" onclick={clearFilters}>Clear</button
                  >
                {/if}
              </div>
            {/if}
          </div>
        {/if}

        {#if registryIndex.entries.length === 0}
          <p class="hint">Registry is empty.</p>
        {:else if sortedEntries.length === 0}
          <p class="hint">No entries match the current filters.</p>
        {:else}
          <ul class="plugin-list">
            {#each paginatedEntries as entry (entry.id)}
              {@const installed = isInstalled(entry.id)}
              <li class="plugin-item">
                <div class="plugin-head">
                  <strong>{entry.displayName}</strong>
                  <span class="version">v{entry.version}</span>
                  {#if entry.author}<span class="author">by {entry.author}</span>{/if}
                  {#if installed}
                    <span class="installed-badge" title="Already installed">Installed</span>
                  {/if}
                  {#if !entry.sha256}<span
                      class="contrib-chip"
                      title="No integrity hash on this entry">unverified</span
                    >{/if}
                </div>
                {#if entry.description}
                  <p class="desc">{entry.description}</p>
                {/if}
                {#if entry.tags?.length}
                  <div class="contributions">
                    {#each entry.tags as t}<span class="contrib-chip">{t}</span>{/each}
                  </div>
                {/if}
                <div class="row-actions">
                  {#if entry.homepage}
                    <a class="link" href={entry.homepage} target="_blank" rel="noreferrer"
                      >Homepage ↗</a
                    >
                  {/if}
                  <button
                    class="install-btn"
                    onclick={() => installRegistryEntry(entry)}
                    disabled={installed || registryInstallingId === entry.id}
                    style="margin-left: auto"
                  >
                    {#if installed}
                      Installed
                    {:else if registryInstallingId === entry.id}
                      Installing…
                    {:else}
                      Install
                    {/if}
                  </button>
                </div>
              </li>
            {/each}
          </ul>
          {#if totalPages > 1}
            <div class="discovery-pager">
              <button
                type="button"
                class="discovery-page-btn"
                disabled={registryPage === 0}
                onclick={() => (registryPage = Math.max(0, registryPage - 1))}
              >
                ← Prev
              </button>
              <span class="discovery-page-label">
                Page {registryPage + 1} of {totalPages}
              </span>
              <button
                type="button"
                class="discovery-page-btn"
                disabled={registryPage >= totalPages - 1}
                onclick={() => (registryPage = Math.min(totalPages - 1, registryPage + 1))}
              >
                Next →
              </button>
            </div>
          {/if}
        {/if}
      {:else if registryUrl && registryLoading}
        <p class="hint">Loading registry…</p>
      {/if}
    </section>
  {/if}
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
  /* LYK-1057: registry discovery controls */
  .discovery-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin: 8px 0;
  }
  .discovery-search {
    flex: 1;
    min-width: 200px;
    padding: 4px 8px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--fs-xs);
    outline: none;
  }
  .discovery-search:focus {
    border-color: var(--accent-primary);
  }
  .discovery-sort {
    padding: 4px 6px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--fs-xs);
  }
  .discovery-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    flex-basis: 100%;
  }
  .discovery-tag {
    background: var(--bg-tertiary, rgba(255, 255, 255, 0.04));
    color: var(--text-secondary);
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 10px;
    border: 1px solid transparent;
    cursor: pointer;
  }
  .discovery-tag:hover {
    background: var(--bg-hover);
  }
  .discovery-tag.active {
    background: color-mix(in srgb, var(--accent-primary) 18%, transparent);
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }
  .discovery-clear {
    background: none;
    border: none;
    color: var(--text-tertiary);
    font-size: 10px;
    cursor: pointer;
    text-decoration: underline;
    padding: 2px 4px;
  }
  .installed-badge {
    background: color-mix(in srgb, var(--accent-secondary) 18%, transparent);
    color: var(--accent-secondary);
    font-size: 10px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 8px;
  }
  .discovery-pager {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 8px 0;
    font-size: 11px;
    color: var(--text-tertiary);
  }
  .discovery-page-btn {
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    color: var(--text-primary);
    font: inherit;
    font-size: 11px;
    padding: 3px 10px;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .discovery-page-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .discovery-page-btn:hover:not(:disabled) {
    background: var(--bg-hover);
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

  /* ── View tabs (Installed / Browse) ── */
  .view-tabs {
    display: flex;
    gap: 4px;
    border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
    margin-top: -8px;
    margin-bottom: 4px;
  }
  .view-tabs button {
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    padding: 6px 12px;
    color: var(--text-secondary, #aaa);
    font-size: 12px;
    cursor: pointer;
  }
  .view-tabs button:hover {
    color: var(--text-primary, #d4d4d4);
  }
  .view-tabs button.active {
    color: var(--accent-fg, #4ec1f5);
    border-bottom-color: var(--accent-fg, #4ec1f5);
  }

  /* ── Registry / Browse view ── */
  .registry {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .registry-config label {
    display: block;
    font-size: 11px;
    color: var(--text-secondary, #aaa);
    margin-bottom: 4px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .reg-url-row {
    display: flex;
    gap: 6px;
  }
  .reg-url-row input {
    flex: 1;
    padding: 6px 10px;
    background: var(--bg-tertiary, rgba(255, 255, 255, 0.04));
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.1));
    border-radius: 4px;
    color: var(--text-primary, #d4d4d4);
    font-size: 12px;
    font-family: var(--font-family, monospace);
  }
  .reg-err {
    margin: 6px 0 0;
    font-size: 11px;
    color: var(--fg-danger, #e06c75);
  }
  .reg-meta {
    margin: 6px 0 0;
    font-size: 11px;
    color: var(--text-tertiary, #888);
  }
  .reg-meta.hint {
    font-style: italic;
  }
  .cache-pill {
    background: var(--bg-tertiary, rgba(255, 255, 255, 0.06));
    padding: 1px 6px;
    border-radius: 8px;
    font-size: 10px;
    margin-left: 6px;
  }
  .link {
    color: var(--accent-fg, #4ec1f5);
    font-size: 11px;
    text-decoration: none;
  }
  .link:hover {
    text-decoration: underline;
  }
</style>
