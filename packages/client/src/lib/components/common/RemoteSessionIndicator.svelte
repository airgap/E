<script lang="ts">
  import { onMount } from 'svelte';

  let isRemote = $state(false);
  let origin = $state('');
  let loading = $state(true);

  onMount(async () => {
    try {
      const res = await fetch('/api/session');
      const data = await res.json();
      if (data.ok) {
        isRemote = data.data.isRemote;
        origin = data.data.origin;
      }
    } catch {
      // Failed to get session info
    } finally {
      loading = false;
    }
  });
</script>

{#if !loading && isRemote}
  <div class="remote-indicator" title="Connected remotely from {origin}">
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <circle cx="12" cy="12" r="10"></circle>
      <polyline points="12 6 12 12 16 14"></polyline>
    </svg>
    <span>Remote</span>
  </div>
{/if}

<style>
  .remote-indicator {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    background: color-mix(in srgb, var(--accent-warning, #f59e0b) 20%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent-warning, #f59e0b) 40%, transparent);
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    color: var(--accent-warning, #f59e0b);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .remote-indicator svg {
    flex-shrink: 0;
  }

  @media (max-width: 768px) {
    .remote-indicator span {
      display: none;
    }
  }
</style>
