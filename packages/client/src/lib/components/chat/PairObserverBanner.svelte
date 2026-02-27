<script lang="ts">
  import { api } from '$lib/api/client';
  import { onMount, onDestroy } from 'svelte';

  // Read query params on mount
  let visible = $state(false);
  let roomId = $state<string | null>(null);
  let observerName = $state<string | null>(null);
  let hostName = $state<string | null>(null);
  let disconnected = $state(false);

  let eventSource: EventSource | null = null;

  onMount(() => {
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    const pairRoom = params.get('pairRoom');
    const name = params.get('name');

    if (!pairRoom) return;

    roomId = pairRoom;
    observerName = name ?? 'Observer';

    // Join the room
    (async () => {
      try {
        const roomRes = await api.pair.getRoom(pairRoom);
        hostName = roomRes.data.hostName ?? 'Host';

        await api.pair.joinRoom(pairRoom, observerName!);

        visible = true;

        // Connect to SSE stream
        const baseUrl = '/api';
        eventSource = new EventSource(`${baseUrl}/pair/rooms/${pairRoom}/stream`);
        eventSource.addEventListener('closed', () => {
          disconnected = true;
          visible = false;
          eventSource?.close();
        });
      } catch {
        // room doesn't exist or join failed - silently ignore
      }
    })();
  });

  onDestroy(() => {
    eventSource?.close();
  });

  function disconnect() {
    eventSource?.close();
    eventSource = null;
    visible = false;
    disconnected = true;

    // Remove query params from URL without reload
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('pairRoom');
      url.searchParams.delete('name');
      window.history.replaceState({}, '', url.toString());
    }
  }
</script>

{#if visible}
  <div class="observer-banner">
    <span class="observer-icon"
      ><svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        ><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle
          cx="12"
          cy="12"
          r="3"
        /></svg
      ></span
    >
    <span class="observer-text">
      Observing <strong>{hostName ?? 'Host'}</strong>'s session
      {#if observerName}
        as <em>{observerName}</em>
      {/if}
    </span>
    <div class="observer-spacer"></div>
    <button class="observer-disconnect" onclick={disconnect}>Disconnect</button>
  </div>
{/if}

{#if disconnected}
  <div class="observer-banner observer-banner--disconnected">
    <span class="observer-icon">○</span>
    <span class="observer-text">Disconnected from pair session</span>
  </div>
{/if}

<style>
  .observer-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 14px;
    background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--accent-primary) 25%, transparent);
    font-size: var(--fs-sm);
    color: var(--text-primary);
    flex-shrink: 0;
  }

  .observer-banner--disconnected {
    background: color-mix(in srgb, var(--text-tertiary) 10%, transparent);
    border-bottom-color: color-mix(in srgb, var(--text-tertiary) 20%, transparent);
    color: var(--text-tertiary);
  }

  .observer-icon {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    color: var(--accent-primary);
  }

  .observer-text {
    font-size: var(--fs-sm);
    line-height: 1.4;
  }

  .observer-text strong {
    font-weight: 700;
    color: var(--accent-primary);
  }

  .observer-text em {
    font-style: normal;
    color: var(--text-secondary);
  }

  .observer-spacer {
    flex: 1;
  }

  .observer-disconnect {
    padding: 3px 10px;
    font-size: var(--fs-xs);
    font-weight: 600;
    border-radius: var(--radius-sm);
    border: 1px solid color-mix(in srgb, var(--accent-primary) 40%, transparent);
    background: transparent;
    color: var(--accent-primary);
    cursor: pointer;
    transition: all var(--transition);
    flex-shrink: 0;
  }

  .observer-disconnect:hover {
    background: color-mix(in srgb, var(--accent-primary) 15%, transparent);
  }
</style>
