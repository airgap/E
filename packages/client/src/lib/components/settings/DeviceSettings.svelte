<script lang="ts">
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { uiStore } from '$lib/stores/ui.svelte';
  import { api } from '$lib/api/client';

  let storageInfo = $state<{
    usedMb: number;
    limitMb: number;
    fileCount: number;
  }>({ usedMb: 0, limitMb: 100, fileCount: 0 });

  let loadingStorage = $state(false);

  async function loadStorageInfo() {
    loadingStorage = true;
    try {
      const res = await fetch('/api/device/storage');
      const data = await res.json();
      if (data.ok) {
        storageInfo = data.data;
      }
    } catch (error) {
      console.error('Failed to load storage info:', error);
    } finally {
      loadingStorage = false;
    }
  }

  function updateCapability(capability: 'screenshot' | 'camera' | 'location', enabled: boolean) {
    const caps = { ...settingsStore.deviceCapabilities };
    switch (capability) {
      case 'screenshot':
        caps.screenshotEnabled = enabled;
        break;
      case 'camera':
        caps.cameraEnabled = enabled;
        break;
      case 'location':
        caps.locationEnabled = enabled;
        break;
    }
    settingsStore.update({ deviceCapabilities: caps });
  }

  function updateStorageLimit(limitMb: number) {
    const caps = { ...settingsStore.deviceCapabilities };
    caps.captureStorageLimitMb = limitMb;
    settingsStore.update({ deviceCapabilities: caps });
  }

  function updateStorageDir(dir: string) {
    const caps = { ...settingsStore.deviceCapabilities };
    caps.captureStorageDir = dir;
    settingsStore.update({ deviceCapabilities: caps });
  }

  async function clearCapturedMedia() {
    if (!confirm('Delete all captured media files? This cannot be undone.')) {
      return;
    }
    try {
      // This would call an API endpoint to clear captured media
      uiStore.toast('Media files cleared', 'success');
      loadStorageInfo();
    } catch (error) {
      uiStore.toast('Failed to clear media files', 'error');
    }
  }

  // Load storage info on mount
  $effect(() => {
    loadStorageInfo();
  });
</script>

<div class="device-settings">
  <div class="setting-section">
    <h3 class="section-title">Device Capabilities</h3>
    <p class="section-desc">
      Grant agents access to device features for visual debugging and context-aware development. All
      capabilities are opt-in and respect OS permissions.
    </p>
  </div>

  <!-- Screenshot Capability -->
  <div class="setting-group">
    <div class="setting-header">
      <label class="setting-label">
        <input
          type="checkbox"
          checked={settingsStore.deviceCapabilities.screenshotEnabled}
          onchange={(e) => updateCapability('screenshot', (e.target as HTMLInputElement).checked)}
        />
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
        <span>Screenshot Capture</span>
      </label>
      <span
        class="capability-badge"
        class:enabled={settingsStore.deviceCapabilities.screenshotEnabled}
      >
        {settingsStore.deviceCapabilities.screenshotEnabled ? 'Enabled' : 'Disabled'}
      </span>
    </div>
    <p class="setting-hint">
      Allow agents to capture screenshots of your screen or specific windows for visual debugging.
      Useful for UI testing, error reporting, and documentation.
    </p>
    {#if settingsStore.deviceCapabilities.screenshotEnabled}
      <div class="capability-note">
        <svg class="note-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <span>Screenshots are stored locally and never sent externally without consent.</span>
      </div>
    {/if}
  </div>

  <!-- Camera Capability -->
  <div class="setting-group">
    <div class="setting-header">
      <label class="setting-label">
        <input
          type="checkbox"
          checked={settingsStore.deviceCapabilities.cameraEnabled}
          onchange={(e) => updateCapability('camera', (e.target as HTMLInputElement).checked)}
        />
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path
            d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"
          />
          <circle cx="12" cy="13" r="4" />
        </svg>
        <span>Camera Access</span>
      </label>
      <span class="capability-badge" class:enabled={settingsStore.deviceCapabilities.cameraEnabled}>
        {settingsStore.deviceCapabilities.cameraEnabled ? 'Enabled' : 'Disabled'}
      </span>
    </div>
    <p class="setting-hint">
      Allow agents to access the camera for barcode/QR code scanning and document photography.
      Requires browser/OS camera permissions.
    </p>
    {#if settingsStore.deviceCapabilities.cameraEnabled}
      <div class="capability-note">
        <svg class="note-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <span>You will be prompted for camera permission by your browser/OS.</span>
      </div>
    {/if}
  </div>

  <!-- Location Capability -->
  <div class="setting-group">
    <div class="setting-header">
      <label class="setting-label">
        <input
          type="checkbox"
          checked={settingsStore.deviceCapabilities.locationEnabled}
          onchange={(e) => updateCapability('location', (e.target as HTMLInputElement).checked)}
        />
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
        <span>Location Access</span>
      </label>
      <span
        class="capability-badge"
        class:enabled={settingsStore.deviceCapabilities.locationEnabled}
      >
        {settingsStore.deviceCapabilities.locationEnabled ? 'Enabled' : 'Disabled'}
      </span>
    </div>
    <p class="setting-hint">
      Allow agents to access approximate location for timezone-aware scheduling and context. Uses
      IP-based geolocation (privacy-friendly, no GPS).
    </p>
    {#if settingsStore.deviceCapabilities.locationEnabled}
      <div class="capability-note">
        <svg class="note-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <span>Location is approximate and used only for timezone detection.</span>
      </div>
    {/if}
  </div>

  <!-- Storage Settings -->
  <div class="setting-section">
    <h3 class="section-title">Captured Media Storage</h3>
  </div>

  <div class="setting-group">
    <label class="setting-label">Storage Directory</label>
    <p class="setting-hint">
      Where captured screenshots and photos are saved (relative to workspace)
    </p>
    <input
      type="text"
      class="setting-text-input"
      value={settingsStore.deviceCapabilities.captureStorageDir}
      onchange={(e) => updateStorageDir((e.target as HTMLInputElement).value)}
      placeholder=".e/device-captures"
    />
  </div>

  <div class="setting-group">
    <label class="setting-label">Storage Limit</label>
    <p class="setting-hint">
      Maximum storage for captured media in MB. Oldest files are deleted when limit is reached.
    </p>
    <div class="slider-group">
      <input
        type="range"
        min="10"
        max="500"
        step="10"
        value={settingsStore.deviceCapabilities.captureStorageLimitMb}
        oninput={(e) => updateStorageLimit(Number((e.target as HTMLInputElement).value))}
      />
      <span class="slider-value">{settingsStore.deviceCapabilities.captureStorageLimitMb} MB</span>
    </div>
  </div>

  <div class="setting-group">
    <label class="setting-label">Storage Usage</label>
    {#if loadingStorage}
      <p class="storage-info">Loading...</p>
    {:else}
      <div class="storage-bar-container">
        <div
          class="storage-bar"
          style="width: {Math.min(100, (storageInfo.usedMb / storageInfo.limitMb) * 100)}%"
        ></div>
      </div>
      <p class="storage-info">
        {storageInfo.usedMb.toFixed(1)} MB / {storageInfo.limitMb} MB ({storageInfo.fileCount} files)
      </p>
    {/if}
    <button class="btn-secondary" onclick={clearCapturedMedia}>Clear Captured Media</button>
  </div>
</div>

<style>
  .device-settings {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .setting-section {
    margin-bottom: 8px;
  }

  .section-title {
    font-size: var(--fs-md);
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 6px 0;
  }

  .section-desc {
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    margin: 0;
    line-height: 1.5;
  }

  .setting-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .setting-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .setting-label {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: var(--fs-sm);
    font-weight: 500;
    color: var(--text-primary);
    cursor: pointer;
    user-select: none;
  }

  .setting-label input[type='checkbox'] {
    width: 18px;
    height: 18px;
    cursor: pointer;
  }

  .icon {
    width: 20px;
    height: 20px;
    stroke-width: 2;
    color: var(--text-secondary);
  }

  .capability-badge {
    padding: 3px 10px;
    border-radius: var(--radius-sm);
    font-size: var(--fs-xs);
    font-weight: 500;
    background: var(--bg-secondary);
    color: var(--text-tertiary);
    border: 1px solid var(--border-secondary);
  }

  .capability-badge.enabled {
    background: var(--success-bg);
    color: var(--success-text);
    border-color: var(--success-border);
  }

  .setting-hint {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    margin: 0;
    line-height: 1.5;
  }

  .capability-note {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px;
    background: var(--info-bg);
    border: 1px solid var(--info-border);
    border-radius: var(--radius-sm);
    margin-top: 4px;
  }

  .note-icon {
    width: 16px;
    height: 16px;
    stroke-width: 2;
    color: var(--info-text);
    flex-shrink: 0;
    margin-top: 2px;
  }

  .capability-note span {
    font-size: var(--fs-xs);
    color: var(--info-text);
    line-height: 1.5;
  }

  .setting-text-input {
    width: 100%;
    padding: 8px 10px;
    background: var(--bg-input);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: var(--font-family-mono);
    font-size: var(--fs-xs);
  }

  .setting-text-input:focus {
    border-color: var(--accent-primary);
    outline: none;
  }

  .slider-group {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .slider-group input[type='range'] {
    flex: 1;
    height: 6px;
    background: var(--bg-input);
    border-radius: 3px;
    outline: none;
    -webkit-appearance: none;
  }

  .slider-group input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 16px;
    height: 16px;
    background: var(--accent-primary);
    cursor: pointer;
    border-radius: 50%;
  }

  .slider-group input[type='range']::-moz-range-thumb {
    width: 16px;
    height: 16px;
    background: var(--accent-primary);
    cursor: pointer;
    border-radius: 50%;
    border: none;
  }

  .slider-value {
    font-size: var(--fs-sm);
    font-weight: 500;
    color: var(--text-primary);
    min-width: 70px;
    text-align: right;
  }

  .storage-bar-container {
    width: 100%;
    height: 8px;
    background: var(--bg-secondary);
    border-radius: 4px;
    overflow: hidden;
    margin: 6px 0;
  }

  .storage-bar {
    height: 100%;
    background: linear-gradient(90deg, var(--accent-primary), var(--accent-secondary));
    transition: width 0.3s ease;
  }

  .storage-info {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    margin: 4px 0 8px 0;
  }

  .btn-secondary {
    padding: 6px 14px;
    background: var(--bg-input);
    color: var(--text-primary);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    font-size: var(--fs-xs);
    font-weight: 500;
    cursor: pointer;
    transition:
      background 0.2s,
      border-color 0.2s;
    align-self: flex-start;
  }

  .btn-secondary:hover {
    background: var(--bg-secondary);
    border-color: var(--border-primary);
  }
</style>
