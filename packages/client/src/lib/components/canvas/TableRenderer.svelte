<script lang="ts">
  import { onMount } from 'svelte';

  interface Props {
    content: string;
  }

  let { content }: Props = $props();
  let tableData = $state<any[]>([]);
  let columns = $state<string[]>([]);
  let parseError = $state<string | null>(null);

  onMount(() => {
    try {
      const data = JSON.parse(content);
      if (!Array.isArray(data)) {
        throw new Error('Table content must be a JSON array');
      }
      tableData = data;

      // Extract column names from first object
      if (data.length > 0 && typeof data[0] === 'object') {
        columns = Object.keys(data[0]);
      }
    } catch (error) {
      console.error('[TableRenderer] Error parsing table data:', error);
      parseError = error instanceof Error ? error.message : 'Invalid JSON';
    }
  });
</script>

<div class="table-renderer">
  {#if parseError}
    <div class="error-message">
      <strong>Error parsing table data:</strong>
      <pre>{parseError}</pre>
    </div>
  {:else if tableData.length === 0}
    <div class="empty-message">No data to display</div>
  {:else}
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            {#each columns as col}
              <th>{col}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each tableData as row}
            <tr>
              {#each columns as col}
                <td>{row[col] ?? ''}</td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  .table-renderer {
    width: 100%;
  }

  .table-wrapper {
    overflow-x: auto;
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--fs-sm);
  }

  thead {
    background: var(--bg-tertiary);
    position: sticky;
    top: 0;
  }

  th {
    padding: 10px 12px;
    text-align: left;
    font-weight: 600;
    color: var(--text-primary);
    border-bottom: 2px solid var(--border-primary);
    white-space: nowrap;
  }

  tbody tr {
    transition: background var(--transition);
  }

  tbody tr:nth-child(even) {
    background: var(--bg-hover);
  }

  tbody tr:hover {
    background: color-mix(in srgb, var(--accent-primary) 8%, transparent);
  }

  td {
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-secondary);
    color: var(--text-secondary);
  }

  .error-message,
  .empty-message {
    padding: 16px;
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--fs-sm);
  }

  .error-message {
    background: color-mix(in srgb, var(--accent-error) 10%, transparent);
    border: 1px solid var(--accent-error);
    border-radius: var(--radius-sm);
    color: var(--text-error);
  }

  .error-message strong {
    display: block;
    margin-bottom: 8px;
  }

  .error-message pre {
    font-family: var(--font-family-mono, monospace);
    font-size: var(--fs-xs);
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0;
  }
</style>
