<script lang="ts">
  import { onMount } from 'svelte';

  interface ImageAsset {
    path: string;
    name: string;
    ext: string;
    modified: number;
  }

  let assets = $state<ImageAsset[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let selectedAsset = $state<ImageAsset | null>(null);
  let serverUrl = $state('');
  let serverConnected = $state(false);
  let previewUrl = $state<string | null>(null);

  const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'psd', 'xd'];

  onMount(() => {
    scanForAssets();
    // Check for stored Crossdraw server URL
    const stored = localStorage.getItem('e-crossdraw-server');
    if (stored) {
      serverUrl = stored;
      checkServer();
    }
  });

  async function scanForAssets() {
    loading = true;
    error = null;
    try {
      // Use the E IDE glob API to find image files
      const patterns = IMAGE_EXTENSIONS.map((ext) => `**/*.${ext}`);
      const res = await fetch('/api/tools/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: 'Glob',
          input: { pattern: `**/*.{${IMAGE_EXTENSIONS.join(',')}}` },
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const files: string[] = data.result?.files ?? data.files ?? [];
        assets = files
          .filter((f: string) => {
            const ext = f.split('.').pop()?.toLowerCase() ?? '';
            return IMAGE_EXTENSIONS.includes(ext);
          })
          .map((f: string) => ({
            path: f,
            name: f.split('/').pop() ?? f,
            ext: f.split('.').pop()?.toLowerCase() ?? '',
            modified: Date.now(),
          }))
          .slice(0, 200); // cap at 200 to avoid overwhelming the panel
      } else {
        error = 'Failed to scan for image assets';
      }
    } catch (e) {
      error = `Scan error: ${e instanceof Error ? e.message : String(e)}`;
    }
    loading = false;
  }

  async function checkServer() {
    if (!serverUrl) {
      serverConnected = false;
      return;
    }
    try {
      const res = await fetch(`${serverUrl}/api/health`, { signal: AbortSignal.timeout(3000) });
      serverConnected = res.ok;
    } catch {
      serverConnected = false;
    }
  }

  function saveServerUrl() {
    localStorage.setItem('e-crossdraw-server', serverUrl);
    checkServer();
  }

  function selectAsset(asset: ImageAsset) {
    selectedAsset = selectedAsset?.path === asset.path ? null : asset;
    if (selectedAsset) {
      loadPreview(selectedAsset);
    } else {
      previewUrl = null;
    }
  }

  async function loadPreview(asset: ImageAsset) {
    try {
      const res = await fetch('/api/tools/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: 'Read',
          input: { file_path: asset.path },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.result?.base64) {
          const mime =
            asset.ext === 'svg'
              ? 'image/svg+xml'
              : asset.ext === 'jpg' || asset.ext === 'jpeg'
                ? 'image/jpeg'
                : `image/${asset.ext}`;
          previewUrl = `data:${mime};base64,${data.result.base64}`;
        }
      }
    } catch {
      previewUrl = null;
    }
  }

  async function openInCrossdraw(asset: ImageAsset) {
    if (!serverUrl) return;
    // Open the Crossdraw web editor with this file
    const url = `${serverUrl}?file=${encodeURIComponent(asset.path)}&mode=multiplayer`;
    window.open(url, '_blank', 'noopener');
  }

  function openInEditor(asset: ImageAsset) {
    // Open the file in E's editor pane
    const event = new CustomEvent('e:open-file', { detail: { path: asset.path } });
    window.dispatchEvent(event);
  }

  function extColor(ext: string): string {
    switch (ext) {
      case 'svg':
        return '#ff9800';
      case 'psd':
        return '#26c6da';
      case 'xd':
        return '#e040fb';
      case 'gif':
        return '#66bb6a';
      default:
        return 'var(--accent-primary)';
    }
  }
</script>

<div class="crossdraw-panel">
  <div class="panel-header">
    <span class="panel-title">Crossdraw</span>
    <span class="panel-count">{assets.length}</span>
    <button class="refresh-btn" onclick={scanForAssets} title="Refresh">
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path
          d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"
        ></path>
      </svg>
    </button>
  </div>

  <!-- Server config -->
  <div class="server-config">
    <div class="server-row">
      <input
        type="text"
        class="server-input"
        placeholder="Crossdraw server URL"
        bind:value={serverUrl}
        onblur={saveServerUrl}
        onkeydown={(e) => e.key === 'Enter' && saveServerUrl()}
      />
      <span
        class="server-status"
        class:connected={serverConnected}
        title={serverConnected ? 'Connected' : 'Not connected'}
      >
      </span>
    </div>
  </div>

  <!-- Asset list -->
  <div class="asset-list">
    {#if loading}
      <div class="empty-state">Scanning for image assets…</div>
    {:else if error}
      <div class="empty-state error-state">{error}</div>
    {:else if assets.length === 0}
      <div class="empty-state">
        No image assets found in the workspace. Supported formats: PNG, JPEG, GIF, WebP, SVG, PSD,
        XD.
      </div>
    {:else}
      {#each assets as asset (asset.path)}
        <div class="asset-item" class:selected={selectedAsset?.path === asset.path}>
          <button class="asset-btn" onclick={() => selectAsset(asset)}>
            <span class="asset-ext" style="color: {extColor(asset.ext)}"
              >{asset.ext.toUpperCase()}</span
            >
            <span class="asset-name">{asset.name}</span>
          </button>
          <div class="asset-actions">
            {#if serverUrl && serverConnected}
              <button
                class="asset-action-btn"
                onclick={() => openInCrossdraw(asset)}
                title="Open in Crossdraw"
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path
                    d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"
                  ></path>
                </svg>
              </button>
            {/if}
          </div>
        </div>

        <!-- Preview -->
        {#if selectedAsset?.path === asset.path && previewUrl}
          <div class="asset-preview">
            <img src={previewUrl} alt={asset.name} />
          </div>
        {/if}
      {/each}
    {/if}
  </div>
</div>

<style>
  .crossdraw-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .panel-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 14px 8px;
    border-bottom: 1px solid var(--border-secondary);
    flex-shrink: 0;
  }

  .panel-title {
    font-size: var(--fs-sm);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-secondary);
  }

  .panel-count {
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-tertiary);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    border-radius: 10px;
    padding: 0 6px;
    min-width: 18px;
    text-align: center;
  }

  .refresh-btn {
    margin-left: auto;
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    cursor: pointer;
    color: var(--text-tertiary);
    transition: all var(--transition);
    padding: 0;
  }

  .refresh-btn:hover {
    color: var(--accent-primary);
    border-color: var(--border-primary);
    background: var(--bg-secondary);
  }

  .server-config {
    padding: 8px 10px;
    border-bottom: 1px solid var(--border-secondary);
    flex-shrink: 0;
  }

  .server-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .server-input {
    flex: 1;
    background: var(--bg-secondary);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    padding: 4px 8px;
    font-size: var(--fs-xs);
    color: var(--text-primary);
    font-family: var(--font-family-mono, monospace);
    outline: none;
    transition: border-color var(--transition);
  }

  .server-input:focus {
    border-color: var(--accent-primary);
  }

  .server-input::placeholder {
    color: var(--text-tertiary);
  }

  .server-status {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-tertiary);
    flex-shrink: 0;
    transition: background var(--transition);
  }

  .server-status.connected {
    background: #4caf50;
    box-shadow: 0 0 4px #4caf50aa;
  }

  .asset-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }

  .empty-state {
    color: var(--text-tertiary);
    font-size: var(--fs-sm);
    text-align: center;
    padding: 24px 16px;
    line-height: 1.6;
  }

  .error-state {
    color: var(--text-error, #ef5350);
  }

  .asset-item {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 8px 0 0;
    border-bottom: 1px solid transparent;
    transition: background var(--transition);
  }

  .asset-item:hover {
    background: var(--bg-hover);
  }

  .asset-item.selected {
    background: var(--bg-hover);
    border-bottom-color: var(--border-secondary);
  }

  .asset-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    padding: 6px 10px;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    color: var(--text-primary);
    min-width: 0;
  }

  .asset-ext {
    font-size: var(--fs-xxs);
    font-weight: 700;
    letter-spacing: 0.06em;
    flex-shrink: 0;
    min-width: 28px;
  }

  .asset-name {
    font-size: var(--fs-sm);
    color: var(--text-primary);
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .asset-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  .asset-action-btn {
    width: 20px;
    height: 20px;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid transparent;
    cursor: pointer;
    color: var(--text-tertiary);
    transition: all var(--transition);
    padding: 0;
  }

  .asset-action-btn:hover {
    color: var(--accent-primary);
    border-color: var(--border-primary);
    background: var(--bg-secondary);
  }

  .asset-preview {
    padding: 8px 10px;
    background: var(--bg-secondary);
    border-radius: var(--radius-sm);
    margin: 0 10px 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    max-height: 200px;
    overflow: hidden;
  }

  .asset-preview img {
    max-width: 100%;
    max-height: 180px;
    object-fit: contain;
    image-rendering: auto;
    border-radius: 2px;
  }
</style>
