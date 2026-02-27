<script lang="ts">
  import { api } from '$lib/api/client';
  import { onDestroy } from 'svelte';

  let { conversationId } = $props<{ conversationId: string }>();

  let active = $state(false);
  let roomId = $state<string | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let showPanel = $state(false);
  let observerCount = $state(0);
  let observers = $state<string[]>([]);
  let copied = $state(false);

  let pollInterval: ReturnType<typeof setInterval> | null = null;

  function shareUrl(): string {
    if (!roomId) return '';
    return window.location.origin + '/pair/' + roomId;
  }

  async function startPairing() {
    loading = true;
    error = null;
    try {
      const res = await api.pair.createRoom({ conversationId, hostName: 'Host' });
      roomId = res.data.roomId;
      active = true;
      showPanel = true;
      startPolling();
    } catch (err: any) {
      error = err?.message ?? 'Failed to create room';
    } finally {
      loading = false;
    }
  }

  async function stopPairing() {
    if (!roomId) return;
    loading = true;
    error = null;
    try {
      await api.pair.closeRoom(roomId);
    } catch {
      // ignore errors on close
    } finally {
      stopPolling();
      active = false;
      showPanel = false;
      roomId = null;
      observerCount = 0;
      observers = [];
      loading = false;
    }
  }

  function startPolling() {
    pollInterval = setInterval(async () => {
      if (!roomId) return;
      try {
        const res = await api.pair.getRoom(roomId);
        observerCount = res.data.observerCount ?? 0;
      } catch {
        // room may have been closed
      }
    }, 5000);
  }

  function stopPolling() {
    if (pollInterval !== null) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(shareUrl());
      copied = true;
      setTimeout(() => {
        copied = false;
      }, 2000);
    } catch {
      // clipboard not available, fallback
      const el = document.createElement('textarea');
      el.value = shareUrl();
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      copied = true;
      setTimeout(() => {
        copied = false;
      }, 2000);
    }
  }

  onDestroy(() => {
    stopPolling();
  });
</script>

<div class="pair-wrap">
  <button
    class="pair-btn"
    class:pair-btn--active={active}
    onclick={() => {
      if (active) {
        showPanel = !showPanel;
      } else {
        startPairing();
      }
    }}
    disabled={loading}
    title={active ? 'Pair Mode active' : 'Start Pair Mode'}
  >
    <span class="pair-icon">⑂</span>
    {#if active && observerCount > 0}
      <span class="pair-badge">{observerCount}</span>
    {:else}
      <span class="pair-label">Pair</span>
    {/if}
  </button>

  {#if showPanel && active && roomId}
    <div class="pair-panel">
      <div class="pair-panel-header">
        <span class="pair-panel-title">Live Pair Mode</span>
        <button class="pair-panel-close" onclick={() => (showPanel = false)}>✕</button>
      </div>

      {#if error}
        <div class="pair-error">{error}</div>
      {/if}

      <div class="pair-section">
        <div class="pair-section-label">Room ID</div>
        <code class="pair-room-id">{roomId}</code>
      </div>

      <div class="pair-section">
        <div class="pair-section-label">Share Link</div>
        <div class="pair-url-row">
          <input class="pair-url-input" type="text" readonly value={shareUrl()} />
          <button class="pair-copy-btn" onclick={copyUrl}>
            {copied ? '✓' : 'Copy'}
          </button>
        </div>
      </div>

      <div class="pair-section">
        <div class="pair-section-label">
          Observers
          <span class="pair-observer-count">{observerCount}</span>
        </div>
        {#if observerCount === 0}
          <div class="pair-no-observers">No observers yet. Share the link above.</div>
        {/if}
      </div>

      <div class="pair-panel-footer">
        <button class="pair-stop-btn" onclick={stopPairing} disabled={loading}>
          {loading ? 'Stopping…' : 'Stop Sharing'}
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .pair-wrap {
    position: relative;
  }

  .pair-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    font-size: var(--fs-sm);
    font-weight: 600;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-primary);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all var(--transition);
    height: 26px;
  }

  .pair-btn:hover:not(:disabled) {
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }

  .pair-btn--active {
    border-color: var(--accent-primary);
    color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
  }

  .pair-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .pair-icon {
    font-size: var(--fs-base);
    line-height: 1;
  }

  .pair-label {
    font-size: var(--fs-xs);
    letter-spacing: 0.04em;
  }

  .pair-badge {
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 8px;
    background: var(--accent-primary);
    color: var(--bg-primary);
    font-size: var(--fs-xxs);
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* Panel */
  .pair-panel {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    width: 300px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    z-index: 100;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .pair-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border-secondary);
  }

  .pair-panel-title {
    font-size: var(--fs-sm);
    font-weight: 700;
    color: var(--text-primary);
  }

  .pair-panel-close {
    background: transparent;
    border: none;
    color: var(--text-tertiary);
    cursor: pointer;
    font-size: var(--fs-sm);
    padding: 0;
    line-height: 1;
  }

  .pair-panel-close:hover {
    color: var(--text-primary);
  }

  .pair-error {
    padding: 8px 14px;
    font-size: var(--fs-sm);
    color: var(--accent-error);
    background: color-mix(in srgb, var(--accent-error) 10%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--accent-error) 20%, transparent);
  }

  .pair-section {
    padding: 10px 14px;
    border-bottom: 1px solid var(--border-secondary);
  }

  .pair-section-label {
    font-size: var(--fs-xxs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-tertiary);
    margin-bottom: 6px;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .pair-observer-count {
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 8px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    font-size: var(--fs-xxs);
    font-weight: 700;
    color: var(--text-secondary);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    text-transform: none;
    letter-spacing: 0;
  }

  .pair-room-id {
    font-family: var(--font-family);
    font-size: var(--fs-sm);
    color: var(--accent-primary);
    background: var(--bg-tertiary);
    padding: 4px 8px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-secondary);
    display: block;
    word-break: break-all;
  }

  .pair-url-row {
    display: flex;
    gap: 6px;
  }

  .pair-url-input {
    flex: 1;
    min-width: 0;
    font-size: var(--fs-xs);
    font-family: var(--font-family);
    background: var(--bg-input);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    padding: 5px 8px;
    outline: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pair-copy-btn {
    padding: 4px 10px;
    font-size: var(--fs-xs);
    font-weight: 600;
    border-radius: var(--radius-sm);
    border: 1px solid var(--accent-primary);
    background: var(--accent-primary);
    color: var(--bg-primary);
    cursor: pointer;
    transition: all var(--transition);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .pair-copy-btn:hover {
    filter: brightness(1.1);
  }

  .pair-no-observers {
    font-size: var(--fs-sm);
    color: var(--text-tertiary);
    font-style: italic;
  }

  .pair-panel-footer {
    padding: 10px 14px;
    display: flex;
    justify-content: flex-end;
  }

  .pair-stop-btn {
    padding: 5px 14px;
    font-size: var(--fs-sm);
    font-weight: 600;
    border-radius: var(--radius-sm);
    border: 1px solid var(--accent-error);
    background: transparent;
    color: var(--accent-error);
    cursor: pointer;
    transition: all var(--transition);
  }

  .pair-stop-btn:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent-error) 12%, transparent);
  }

  .pair-stop-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
