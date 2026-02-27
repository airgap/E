<script lang="ts">
  import { chirpEngine } from '$lib/audio/chirp-engine';
  import { settingsStore } from '$lib/stores/settings.svelte';

  let { data } = $props<{ data: string }>();

  function uiClick() {
    if (settingsStore.soundEnabled) chirpEngine.uiClick();
  }

  let parsed = $derived.by(() => {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  });

  let expandedPaths = $state<Set<string>>(new Set(['$']));
  let filter = $state('');

  function toggle(path: string) {
    uiClick();
    const next = new Set(expandedPaths);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    expandedPaths = next;
  }

  function expandAll(val: unknown, path: string) {
    const next = new Set(expandedPaths);
    function walk(v: unknown, p: string) {
      if (v && typeof v === 'object') {
        next.add(p);
        if (Array.isArray(v)) {
          v.forEach((item, i) => walk(item, `${p}[${i}]`));
        } else {
          Object.keys(v as Record<string, unknown>).forEach((k) =>
            walk((v as Record<string, unknown>)[k], `${p}.${k}`),
          );
        }
      }
    }
    walk(val, path);
    expandedPaths = next;
  }

  function collapseAll() {
    expandedPaths = new Set(['$']);
  }

  function typeColor(val: unknown): string {
    if (val === null) return 'var(--text-tertiary, #6e7681)';
    if (typeof val === 'string') return 'var(--accent-secondary, #00ff88)';
    if (typeof val === 'number') return '#79c0ff';
    if (typeof val === 'boolean') return '#d2a8ff';
    return 'var(--text-primary, #c9d1d9)';
  }

  function formatValue(val: unknown): string {
    if (val === null) return 'null';
    if (typeof val === 'string') return `"${val.length > 100 ? val.slice(0, 100) + '...' : val}"`;
    return String(val);
  }

  function getSummary(val: unknown): string {
    if (Array.isArray(val)) return `Array(${val.length})`;
    if (val && typeof val === 'object') return `{${Object.keys(val).length} keys}`;
    return '';
  }

  async function copyPath(path: string) {
    try {
      await navigator.clipboard.writeText(path);
      uiClick();
    } catch {}
  }
</script>

{#if parsed !== null}
  <div class="json-explorer">
    <div class="json-toolbar">
      <button class="toolbar-btn" onclick={() => expandAll(parsed, '$')} title="Expand all">
        Expand
      </button>
      <button class="toolbar-btn" onclick={collapseAll} title="Collapse all">Collapse</button>
    </div>
    <div class="json-tree">
      {#snippet renderNode(val: unknown, key: string, path: string, depth: number)}
        {@const isObj = val !== null && typeof val === 'object'}
        {@const isExpanded = expandedPaths.has(path)}
        <div class="json-node" style="padding-left: {depth * 14}px">
          {#if isObj}
            <button class="toggle-btn" onclick={() => toggle(path)}>
              <span class="chevron" class:open={isExpanded}>&#9654;</span>
            </button>
          {:else}
            <span class="leaf-spacer"></span>
          {/if}

          <span class="json-key" onclick={() => copyPath(path)} title="Click to copy path: {path}">
            {key}
          </span>
          <span class="colon">:</span>

          {#if isObj && !isExpanded}
            <span class="json-summary">{getSummary(val)}</span>
          {:else if !isObj}
            <span class="json-value" style="color: {typeColor(val)}">{formatValue(val)}</span>
          {/if}
        </div>

        {#if isObj && isExpanded}
          {#if Array.isArray(val)}
            {#each val as item, i (i)}
              {@render renderNode(item, String(i), `${path}[${i}]`, depth + 1)}
            {/each}
          {:else}
            {#each Object.entries(val as Record<string, unknown>) as [k, v] (k)}
              {@render renderNode(v, k, `${path}.${k}`, depth + 1)}
            {/each}
          {/if}
        {/if}
      {/snippet}

      {#if Array.isArray(parsed)}
        {#each parsed as item, i (i)}
          {@render renderNode(item, String(i), `$[${i}]`, 0)}
        {/each}
      {:else if typeof parsed === 'object'}
        {#each Object.entries(parsed as Record<string, unknown>) as [k, v] (k)}
          {@render renderNode(v, k, `$.${k}`, 0)}
        {/each}
      {:else}
        <span class="json-value" style="color: {typeColor(parsed)}">{formatValue(parsed)}</span>
      {/if}
    </div>
  </div>
{:else}
  <pre class="parse-error">Invalid JSON</pre>
{/if}

<style>
  .json-explorer {
    border: var(--ht-border-width, 1px) var(--ht-border-style, solid)
      color-mix(in srgb, var(--text-tertiary, #6e7681) 20%, transparent);
    border-radius: var(--ht-radius, 4px);
    overflow: hidden;
    background: var(--bg-primary, #0d1117);
    transition: border-color var(--ht-transition-speed, 125ms) ease;
  }

  .json-toolbar {
    display: flex;
    gap: 4px;
    padding: 4px 8px;
    background: color-mix(in srgb, var(--bg-secondary, #161b22) 80%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--text-tertiary, #6e7681) 15%, transparent);
  }

  .toolbar-btn {
    padding: 1px 8px;
    border: none;
    background: color-mix(in srgb, var(--text-tertiary, #6e7681) 15%, transparent);
    color: var(--text-tertiary, #6e7681);
    font-family: var(--font-family-mono, monospace);
    font-size: var(--fs-xxs);
    border-radius: 3px;
    cursor: pointer;
    transition:
      color 0.15s,
      background 0.15s;
  }

  .toolbar-btn:hover {
    color: var(--text-primary, #c9d1d9);
    background: color-mix(in srgb, var(--text-tertiary, #6e7681) 25%, transparent);
  }

  .json-tree {
    padding: 4px 0;
    max-height: 500px;
    overflow-y: auto;
    font-size: var(--fs-xs);
    line-height: 1.6;
  }

  .json-node {
    display: flex;
    align-items: baseline;
    gap: 2px;
    white-space: nowrap;
  }

  .toggle-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border: none;
    background: none;
    color: var(--text-tertiary, #6e7681);
    cursor: pointer;
    padding: 0;
    font-size: var(--fs-xxs);
    flex-shrink: 0;
  }

  .toggle-btn:hover {
    color: var(--text-primary, #c9d1d9);
  }

  .chevron {
    display: inline-block;
    transition: transform 0.12s ease;
  }

  .chevron.open {
    transform: rotate(90deg);
  }

  .leaf-spacer {
    display: inline-block;
    width: 14px;
    flex-shrink: 0;
  }

  .json-key {
    color: var(--text-secondary, #8b949e);
    cursor: pointer;
  }

  .json-key:hover {
    text-decoration: underline;
    color: var(--text-primary, #c9d1d9);
  }

  .colon {
    color: var(--text-tertiary, #6e7681);
    margin-right: 4px;
  }

  .json-summary {
    color: var(--text-tertiary, #6e7681);
    font-style: italic;
  }

  .json-value {
    word-break: break-all;
    white-space: pre-wrap;
  }

  .parse-error {
    margin: 0;
    padding: 8px;
    color: var(--accent-error, #ff3344);
    font-size: var(--fs-sans-xs);
  }
</style>
