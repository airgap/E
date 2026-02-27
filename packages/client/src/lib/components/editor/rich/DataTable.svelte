<script lang="ts">
  import type { RichTableData } from '@e/shared';
  import { chirpEngine } from '$lib/audio/chirp-engine';
  import { settingsStore } from '$lib/stores/settings.svelte';

  let { data } = $props<{ data: string }>();

  function uiClick() {
    if (settingsStore.soundEnabled) chirpEngine.uiClick();
  }

  let sortCol = $state<number | null>(null);
  let sortAsc = $state(true);
  let filter = $state('');
  let showFilter = $state(false);

  const parsed = $derived.by((): RichTableData | null => {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  });

  const filteredRows = $derived.by(() => {
    if (!parsed) return [];
    let rows = parsed.rows;

    if (filter.trim()) {
      const q = filter.toLowerCase();
      rows = rows.filter((row) => row.some((cell) => cell.toLowerCase().includes(q)));
    }

    if (sortCol !== null) {
      const col = sortCol;
      const asc = sortAsc;
      rows = [...rows].sort((a, b) => {
        const av = a[col] ?? '';
        const bv = b[col] ?? '';
        // Try numeric sort
        const an = Number(av);
        const bn = Number(bv);
        if (!isNaN(an) && !isNaN(bn)) {
          return asc ? an - bn : bn - an;
        }
        return asc ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }

    return rows;
  });

  function handleSort(colIdx: number) {
    uiClick();
    if (sortCol === colIdx) {
      sortAsc = !sortAsc;
    } else {
      sortCol = colIdx;
      sortAsc = true;
    }
  }

  async function copyAsCSV() {
    if (!parsed) return;
    const lines = [parsed.headers.join(','), ...filteredRows.map((r) => r.join(','))];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      uiClick();
    } catch {}
  }

  /** Sonify a numeric column — map values to pitch and play sequentially */
  function sonifyColumn(colIdx: number) {
    if (!parsed || !settingsStore.soundEnabled) return;
    const values = filteredRows.map((row) => Number(row[colIdx])).filter((v) => !isNaN(v));
    if (values.length === 0) return;
    uiClick();
    chirpEngine.sonifyData(values, {
      tempo: Math.max(60, Math.min(200, 3000 / values.length)),
    });
  }

  let sonifyCol = $state<number | null>(null);
</script>

{#if parsed}
  <div class="data-table-wrapper">
    <div class="table-toolbar">
      <span class="row-count">{filteredRows.length} row{filteredRows.length !== 1 ? 's' : ''}</span>
      <span class="format-badge">{parsed.format}</span>
      <button
        class="toolbar-btn"
        onclick={() => {
          showFilter = !showFilter;
          uiClick();
        }}
        title="Filter rows"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
        </svg>
      </button>
      <button class="toolbar-btn" onclick={copyAsCSV} title="Copy as CSV">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      </button>
      {#if settingsStore.soundEnabled && parsed}
        <select
          class="sonify-select"
          bind:value={sonifyCol}
          onchange={() => {
            if (sonifyCol !== null) {
              sonifyColumn(sonifyCol);
              sonifyCol = null;
            }
          }}
        >
          <option value={null}>Sonify...</option>
          {#each parsed.headers as header, i}
            <option value={i}>{header}</option>
          {/each}
        </select>
      {/if}
    </div>

    {#if showFilter}
      <div class="filter-row">
        <input type="text" class="filter-input" placeholder="Filter rows..." bind:value={filter} />
      </div>
    {/if}

    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            {#each parsed.headers as header, i}
              <th onclick={() => handleSort(i)} class:sorted={sortCol === i}>
                <span class="header-text">{header}</span>
                {#if sortCol === i}
                  <span class="sort-indicator">{sortAsc ? '\u25B2' : '\u25BC'}</span>
                {/if}
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each filteredRows as row, ri (ri)}
            <tr>
              {#each row as cell, ci (ci)}
                <td title={cell}>{cell}</td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
{:else}
  <pre class="parse-error">Failed to parse table data</pre>
{/if}

<style>
  .data-table-wrapper {
    border: var(--ht-border-width, 1px) var(--ht-border-style, solid)
      color-mix(in srgb, var(--text-tertiary, #6e7681) 20%, transparent);
    border-radius: var(--ht-radius, 4px);
    overflow: hidden;
    background: var(--bg-primary, #0d1117);
    transition: border-color var(--ht-transition-speed, 125ms) ease;
  }

  .table-toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    background: color-mix(in srgb, var(--bg-secondary, #161b22) 80%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--text-tertiary, #6e7681) 15%, transparent);
    font-size: var(--fs-sans-xxs);
    color: var(--text-tertiary, #6e7681);
  }

  .row-count {
    flex: 1;
  }

  .format-badge {
    padding: 1px 5px;
    border-radius: 3px;
    background: color-mix(in srgb, var(--accent-primary, #00b4ff) 15%, transparent);
    color: var(--accent-primary, #00b4ff);
    text-transform: uppercase;
    font-size: var(--fs-xs);
    font-weight: 600;
  }

  .toolbar-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 18px;
    border: none;
    background: none;
    color: var(--text-tertiary, #6e7681);
    cursor: pointer;
    border-radius: 3px;
    transition:
      color 0.15s,
      background 0.15s;
  }

  .toolbar-btn:hover {
    color: var(--text-primary, #c9d1d9);
    background: color-mix(in srgb, var(--text-primary, #c9d1d9) 10%, transparent);
  }

  .filter-row {
    padding: 4px 8px;
    border-bottom: 1px solid color-mix(in srgb, var(--text-tertiary, #6e7681) 15%, transparent);
  }

  .filter-input {
    width: 100%;
    padding: 3px 6px;
    border: 1px solid color-mix(in srgb, var(--text-tertiary, #6e7681) 30%, transparent);
    border-radius: 3px;
    background: var(--bg-primary, #0d1117);
    color: var(--text-primary, #c9d1d9);
    font-family: var(--font-family-mono, monospace);
    font-size: var(--fs-xs);
    outline: none;
  }

  .filter-input:focus {
    border-color: var(--accent-primary, #00b4ff);
  }

  .table-scroll {
    overflow-x: auto;
    max-height: 400px;
    overflow-y: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--fs-sans-xs);
  }

  th {
    position: sticky;
    top: 0;
    padding: 4px 8px;
    text-align: left;
    font-weight: 600;
    color: var(--text-secondary, #8b949e);
    background: var(--bg-secondary, #161b22);
    border-bottom: 1px solid color-mix(in srgb, var(--text-tertiary, #6e7681) 20%, transparent);
    cursor: pointer;
    user-select: none;
    white-space: nowrap;
    transition: color 0.15s;
  }

  th:hover {
    color: var(--text-primary, #c9d1d9);
  }

  th.sorted {
    color: var(--accent-primary, #00b4ff);
  }

  .header-text {
    margin-right: 4px;
  }

  .sort-indicator {
    font-size: var(--fs-xxs);
    opacity: 0.7;
  }

  td {
    padding: 3px 8px;
    color: var(--text-primary, #c9d1d9);
    border-bottom: 1px solid color-mix(in srgb, var(--text-tertiary, #6e7681) 8%, transparent);
    max-width: 300px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  tr:nth-child(even) td {
    background: color-mix(in srgb, var(--bg-secondary, #161b22) 40%, transparent);
  }

  tr:hover td {
    background: color-mix(in srgb, var(--accent-primary, #00b4ff) 6%, transparent);
  }

  .sonify-select {
    padding: 1px 4px;
    border: 1px solid color-mix(in srgb, var(--text-tertiary, #6e7681) 30%, transparent);
    border-radius: 3px;
    background: var(--bg-primary, #0d1117);
    color: var(--text-tertiary, #6e7681);
    font-family: var(--font-family-mono, monospace);
    font-size: var(--fs-xs);
    outline: none;
    cursor: pointer;
  }

  .sonify-select:hover {
    color: var(--text-primary, #c9d1d9);
    border-color: var(--accent-primary, #00b4ff);
  }

  .parse-error {
    margin: 0;
    padding: 8px;
    color: var(--accent-error, #ff3344);
    font-size: var(--fs-sans-xs);
  }
</style>
