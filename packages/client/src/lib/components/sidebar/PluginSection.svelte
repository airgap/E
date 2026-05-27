<script lang="ts">
  /**
   * Collapsible 'Plugins' subsection under the conversation list. Lists
   * every enabled plugin's contributed sidePanes; clicking a row opens
   * that pane in the sandboxed PluginPaneViewerModal.
   *
   * Always mounted (not feature-gated like Claude Code history) — if no
   * plugins are installed/enabled, the section renders a tiny hint
   * instead of vanishing, so users know how to install one.
   */
  import { onMount } from 'svelte';
  import { pluginsStore } from '$lib/stores/plugins.svelte';
  import { activePluginPaneStore } from '$lib/stores/active-plugin-pane.svelte';
  import { uiStore } from '$lib/stores/ui.svelte';
  import type { InstalledPlugin, SidePaneContribution } from '@e/shared';

  let expanded = $state(true);

  onMount(() => {
    void pluginsStore.reload();
  });

  function openPane(plugin: InstalledPlugin, pane: SidePaneContribution) {
    activePluginPaneStore.open(plugin, pane);
    uiStore.openModal('plugin-pane-viewer');
  }

  function openSettings() {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('e-settings-tab', 'plugins');
    }
    uiStore.openModal('settings');
  }

  // Flatten enabled plugins → list of {plugin, pane} rows.
  let rows = $derived.by(() => {
    const out: Array<{ plugin: InstalledPlugin; pane: SidePaneContribution }> = [];
    for (const p of pluginsStore.enabled) {
      for (const pane of p.manifest.contributes?.sidePanes ?? []) {
        out.push({ plugin: p, pane });
      }
    }
    return out;
  });
</script>

<section class="plugin-section" aria-label="Plugin side panes">
  <button
    class="header"
    onclick={() => (expanded = !expanded)}
    aria-expanded={expanded}
    title={expanded ? 'Collapse' : 'Expand'}
  >
    <svg
      class="caret"
      class:open={expanded}
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
    <span class="label">Plugins</span>
    <span class="count">{rows.length}</span>
  </button>

  {#if expanded}
    {#if rows.length === 0}
      <div class="hint">
        No plugin panes enabled yet.
        <button class="link" onclick={openSettings}>Open plugin settings →</button>
      </div>
    {:else}
      <ul class="list">
        {#each rows as row (`${row.plugin.manifest.id}:${row.pane.id}`)}
          <li>
            <button
              class="item"
              onclick={() => openPane(row.plugin, row.pane)}
              title={`${row.pane.label} (${row.plugin.manifest.displayName})`}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d={row.pane.icon} />
              </svg>
              <span class="item-label truncate">{row.pane.label}</span>
              <span class="item-from">{row.plugin.manifest.displayName}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>

<style>
  .plugin-section {
    border-top: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
    padding-top: 4px;
    margin-top: 8px;
  }
  .header {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: transparent;
    border: none;
    color: var(--text-secondary, #aaa);
    font-size: var(--fs-xs, 11px);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 600;
    cursor: pointer;
  }
  .header:hover {
    color: var(--text-primary, #d4d4d4);
  }
  .caret {
    transition: transform 100ms ease;
  }
  .caret.open {
    transform: rotate(90deg);
  }
  .label {
    flex: 1;
    text-align: left;
  }
  .count {
    background: var(--bg-tertiary, rgba(255, 255, 255, 0.06));
    padding: 1px 6px;
    border-radius: 8px;
    font-size: 10px;
    font-weight: 600;
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0 0 4px;
  }
  .item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: transparent;
    border: none;
    color: var(--text-primary, #d4d4d4);
    cursor: pointer;
    text-align: left;
  }
  .item:hover {
    background: var(--bg-hover, rgba(255, 255, 255, 0.04));
  }
  .item svg {
    color: var(--text-secondary, #aaa);
    flex-shrink: 0;
  }
  .item-label {
    flex: 1;
    font-size: 12px;
  }
  .truncate {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .item-from {
    font-size: 10px;
    color: var(--text-tertiary, #888);
  }

  .hint {
    padding: 8px 12px;
    font-size: 11px;
    color: var(--text-tertiary, #888);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .link {
    background: transparent;
    border: none;
    padding: 0;
    color: var(--accent-fg, #4ec1f5);
    cursor: pointer;
    text-align: left;
    font-size: 11px;
  }
  .link:hover {
    text-decoration: underline;
  }
</style>
