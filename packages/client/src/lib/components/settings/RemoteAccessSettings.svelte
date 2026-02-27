<script lang="ts">
  import { onMount } from 'svelte';

  // ─── State ──────────────────────────────────────────────────────────────────

  let loading = $state(false);
  let error = $state<string | null>(null);
  let successMsg = $state<string | null>(null);

  // Config
  let enabled = $state(true);
  let tailscaleEnabled = $state(true);
  let sshTunnelEnabled = $state(true);

  // Status
  let tailscaleAvailable = $state(false);
  let tailscaleRunning = $state(false);
  let tailscaleHostname = $state<string | null>(null);
  let tailscaleIp = $state<string | null>(null);
  let tailscaleError = $state<string | null>(null);
  let tailscaleConfigured = $state(false);
  let tailscaleUrl = $state<string | null>(null);

  // SSH
  let sshCommand = $state('');
  let sshPort = $state(3002);

  // Clients
  let activeClients = $state(0);
  let remoteClients = $state(0);
  let clients = $state<any[]>([]);

  // Allowed Origins
  let allowedOrigins = $state<string[]>([]);

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  onMount(() => {
    loadConfig();
    loadAllowedOrigins();
  });

  // ─── API calls ──────────────────────────────────────────────────────────────

  async function loadConfig() {
    loading = true;
    error = null;
    try {
      const res = await fetch('/api/remote-access/config');
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Failed to load config');

      enabled = data.data.config.enabled;
      tailscaleEnabled = data.data.config.tailscaleEnabled;
      sshTunnelEnabled = data.data.config.sshTunnelEnabled;

      tailscaleAvailable = data.data.tailscaleStatus.available;
      tailscaleRunning = data.data.tailscaleStatus.running;
      tailscaleHostname = data.data.tailscaleStatus.hostname || null;
      tailscaleIp = data.data.tailscaleStatus.ip || null;
      tailscaleError = data.data.tailscaleStatus.error || null;

      sshCommand = data.data.sshTunnel.command;
      sshPort = data.data.sshTunnel.localPort;

      activeClients = data.data.activeClients;
      remoteClients = data.data.remoteClients;

      // Load clients
      await loadClients();
    } catch (e: any) {
      error = e?.message ?? 'Failed to load remote access config';
    } finally {
      loading = false;
    }
  }

  async function loadClients() {
    try {
      const res = await fetch('/api/remote-access/clients');
      const data = await res.json();
      if (data.ok) {
        clients = data.data;
      }
    } catch {
      // Clients are optional
    }
  }

  async function loadAllowedOrigins() {
    try {
      const res = await fetch('/api/remote-access/allowed-origins');
      const data = await res.json();
      if (data.ok) {
        allowedOrigins = data.data.origins;
      }
    } catch {
      // Allowed origins are optional
    }
  }

  async function saveConfig() {
    error = null;
    successMsg = null;
    try {
      const res = await fetch('/api/remote-access/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, tailscaleEnabled, sshTunnelEnabled }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Failed to save config');
      successMsg = 'Remote access settings saved';
      setTimeout(() => (successMsg = null), 3000);
    } catch (e: any) {
      error = e?.message ?? 'Failed to save config';
    }
  }

  async function configureTailscale(funnel = false) {
    error = null;
    successMsg = null;
    try {
      const res = await fetch('/api/remote-access/tailscale/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ funnel }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Failed to configure Tailscale');
      tailscaleUrl = data.data.url;
      tailscaleConfigured = true;
      successMsg = `Tailscale ${funnel ? 'funnel' : 'serve'} configured! URL: ${data.data.url}`;
    } catch (e: any) {
      error = e?.message ?? 'Failed to configure Tailscale';
    }
  }

  async function stopTailscale() {
    error = null;
    successMsg = null;
    try {
      const res = await fetch('/api/remote-access/tailscale/stop', { method: 'POST' });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Failed to stop Tailscale');
      tailscaleConfigured = false;
      tailscaleUrl = null;
      successMsg = 'Tailscale stopped';
      setTimeout(() => (successMsg = null), 3000);
    } catch (e: any) {
      error = e?.message ?? 'Failed to stop Tailscale';
    }
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      successMsg = 'Copied to clipboard';
      setTimeout(() => (successMsg = null), 2000);
    } catch {
      error = 'Failed to copy to clipboard';
    }
  }

  function formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleString();
  }
</script>

<div class="remote-access-settings">
  {#if error}
    <div class="alert error">{error}</div>
  {/if}
  {#if successMsg}
    <div class="alert success">{successMsg}</div>
  {/if}

  {#if loading}
    <div class="loading">Loading remote access settings...</div>
  {:else}
    <div class="settings-section">
      <h3>Remote Access</h3>
      <p class="description">
        Enable secure remote access to E from outside your local network using Tailscale or SSH
        tunnels.
      </p>

      <label class="checkbox-row">
        <input type="checkbox" bind:checked={enabled} onchange={() => saveConfig()} />
        <span>Enable remote access</span>
      </label>

      <div class="info-box">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="16" x2="12" y2="12"></line>
          <line x1="12" y1="8" x2="12.01" y2="8"></line>
        </svg>
        <span>Remote connections always require authentication, even in single-user mode.</span>
      </div>

      {#if enabled}
        <!-- Tailscale Section -->
        <div class="method-section">
          <div class="method-header">
            <h4>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
              Tailscale Integration
            </h4>
            <label class="checkbox-small">
              <input
                type="checkbox"
                bind:checked={tailscaleEnabled}
                onchange={() => saveConfig()}
              />
              <span>Enabled</span>
            </label>
          </div>

          {#if tailscaleEnabled}
            <div class="method-content">
              <div class="status-row">
                <span class="status-label">Status:</span>
                {#if !tailscaleAvailable}
                  <span class="status-badge error">Not Installed</span>
                  <span class="status-hint">Install Tailscale to enable this feature</span>
                {:else if !tailscaleRunning}
                  <span class="status-badge warning">Not Running</span>
                  <span class="status-hint"
                    >{tailscaleError || 'Start Tailscale to use this feature'}</span
                  >
                {:else}
                  <span class="status-badge success">Ready</span>
                  {#if tailscaleHostname}
                    <span class="status-hint">{tailscaleHostname} ({tailscaleIp})</span>
                  {/if}
                {/if}
              </div>

              {#if tailscaleAvailable && tailscaleRunning}
                {#if tailscaleConfigured && tailscaleUrl}
                  <div class="url-row">
                    <span class="label">Access URL:</span>
                    <code class="url-code">{tailscaleUrl}</code>
                    <button
                      class="copy-btn"
                      onclick={() => copyToClipboard(tailscaleUrl || '')}
                      title="Copy URL"
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                      >
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                      </svg>
                    </button>
                  </div>
                  <button class="btn secondary small" onclick={() => stopTailscale()}
                    >Stop Tailscale</button
                  >
                {:else}
                  <div class="action-row">
                    <button class="btn primary small" onclick={() => configureTailscale(false)}>
                      Configure Tailscale Serve
                    </button>
                    <button class="btn secondary small" onclick={() => configureTailscale(true)}>
                      Configure Tailscale Funnel
                    </button>
                  </div>
                  <p class="hint">
                    <strong>Serve:</strong> Private access within your Tailscale network<br />
                    <strong>Funnel:</strong> Public access via HTTPS (requires ACL permissions)
                  </p>
                {/if}
              {/if}
            </div>
          {/if}
        </div>

        <!-- SSH Tunnel Section -->
        <div class="method-section">
          <div class="method-header">
            <h4>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
              </svg>
              SSH Tunnel
            </h4>
            <label class="checkbox-small">
              <input
                type="checkbox"
                bind:checked={sshTunnelEnabled}
                onchange={() => saveConfig()}
              />
              <span>Enabled</span>
            </label>
          </div>

          {#if sshTunnelEnabled}
            <div class="method-content">
              <p class="description">
                Use an SSH tunnel to securely forward E's port to your remote machine.
              </p>

              <div class="ssh-command">
                <span class="label">Command to run on your remote machine:</span>
                <code class="command-code">{sshCommand}</code>
                <button
                  class="copy-btn"
                  onclick={() => copyToClipboard(sshCommand)}
                  title="Copy command"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                  </svg>
                </button>
              </div>

              <div class="info-box">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="16" x2="12" y2="12"></line>
                  <line x1="12" y1="8" x2="12.01" y2="8"></line>
                </svg>
                <span>
                  Replace <code>&lt;your-server-ip&gt;</code> with your machine's IP address and
                  <code>user</code> with your username.
                </span>
              </div>
            </div>
          {/if}
        </div>

        <!-- Active Connections -->
        <div class="connections-section">
          <h4>Active Connections</h4>
          <div class="stats-row">
            <div class="stat">
              <span class="stat-label">Total:</span>
              <span class="stat-value">{activeClients}</span>
            </div>
            <div class="stat">
              <span class="stat-label">Remote:</span>
              <span class="stat-value">{remoteClients}</span>
            </div>
          </div>

          {#if clients.length > 0}
            <table class="clients-table">
              <thead>
                <tr>
                  <th>Origin</th>
                  <th>Type</th>
                  <th>Connected</th>
                </tr>
              </thead>
              <tbody>
                {#each clients as client (client.id)}
                  <tr>
                    <td class="origin-cell" title={client.origin}>{client.origin}</td>
                    <td>
                      <span class="badge" class:remote={client.isRemote}>
                        {client.isRemote ? 'Remote' : 'Local'}
                      </span>
                    </td>
                    <td class="time-cell">{formatTime(client.connectedAt)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        </div>

        <!-- Allowed Origins -->
        <div class="origins-section">
          <h4>Allowed Origins</h4>
          <p class="description">
            Origins configured via the <code>E_ALLOWED_ORIGINS</code> environment variable. These origins
            are allowed to access E when TLS is enabled.
          </p>

          {#if allowedOrigins.length > 0}
            <div class="origins-list">
              {#each allowedOrigins as origin}
                <div class="origin-row">
                  <code class="origin-code">{origin}</code>
                </div>
              {/each}
            </div>
          {:else}
            <div class="origins-empty">
              No allowed origins configured. Set the <code>E_ALLOWED_ORIGINS</code> environment variable
              to configure allowed origins.
            </div>
          {/if}

          <div class="info-box" style="margin-top: 8px;">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="16" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
            <span>
              To add origins, set the environment variable:
              <br />
              <code>E_ALLOWED_ORIGINS=https://example.com,https://other.com</code>
            </span>
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .remote-access-settings {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .alert {
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 13px;
  }

  .alert.error {
    background: color-mix(in srgb, var(--accent-error) 15%, transparent);
    color: var(--accent-error);
    border: 1px solid color-mix(in srgb, var(--accent-error) 30%, transparent);
  }

  .alert.success {
    background: color-mix(in srgb, var(--accent-success, #10b981) 15%, transparent);
    color: var(--accent-success, #10b981);
    border: 1px solid color-mix(in srgb, var(--accent-success, #10b981) 30%, transparent);
  }

  .loading {
    text-align: center;
    padding: 24px;
    color: var(--text-secondary);
    font-size: 13px;
  }

  .settings-section {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .settings-section h3 {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }

  .description {
    font-size: 13px;
    color: var(--text-secondary);
    margin: 0;
    line-height: 1.5;
  }

  .checkbox-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    color: var(--text-primary);
    cursor: pointer;
  }

  .checkbox-row input[type='checkbox'] {
    cursor: pointer;
  }

  .info-box {
    display: flex;
    gap: 8px;
    padding: 8px 12px;
    background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent-primary) 20%, transparent);
    border-radius: 6px;
    font-size: 12px;
    color: var(--text-secondary);
    align-items: flex-start;
  }

  .info-box svg {
    flex-shrink: 0;
    margin-top: 1px;
    color: var(--accent-primary);
  }

  .info-box code {
    font-family: var(--font-mono);
    background: color-mix(in srgb, var(--bg-primary) 50%, transparent);
    padding: 1px 4px;
    border-radius: 3px;
  }

  .method-section {
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: 8px;
    overflow: hidden;
  }

  .method-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px;
    background: var(--bg-tertiary);
    border-bottom: 1px solid var(--border-primary);
  }

  .method-header h4 {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }

  .checkbox-small {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .checkbox-small input[type='checkbox'] {
    cursor: pointer;
  }

  .method-content {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .status-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .status-label {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .status-badge {
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 4px;
    text-transform: uppercase;
    font-weight: 600;
  }

  .status-badge.success {
    background: var(--accent-success, #10b981);
    color: white;
  }

  .status-badge.warning {
    background: var(--accent-warning, #f59e0b);
    color: white;
  }

  .status-badge.error {
    background: var(--accent-error);
    color: white;
  }

  .status-hint {
    font-size: 12px;
    color: var(--text-tertiary);
  }

  .url-row,
  .ssh-command {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .label {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .url-code,
  .command-code {
    font-family: var(--font-mono);
    font-size: 11px;
    background: var(--bg-primary);
    padding: 4px 8px;
    border-radius: 4px;
    color: var(--accent-primary);
    word-break: break-all;
    flex: 1;
  }

  .copy-btn {
    padding: 4px;
    background: transparent;
    border: none;
    color: var(--text-tertiary);
    cursor: pointer;
    border-radius: 3px;
    display: inline-flex;
    align-items: center;
    transition: all 0.15s ease;
  }

  .copy-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .action-row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .hint {
    font-size: 11px;
    color: var(--text-tertiary);
    line-height: 1.4;
  }

  .connections-section {
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: 8px;
    padding: 12px;
  }

  .connections-section h4 {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 12px;
  }

  .stats-row {
    display: flex;
    gap: 24px;
    margin-bottom: 12px;
  }

  .stat {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .stat-label {
    font-size: 12px;
    color: var(--text-secondary);
  }

  .stat-value {
    font-size: 18px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .clients-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }

  .clients-table th {
    text-align: left;
    padding: 6px 8px;
    font-weight: 600;
    color: var(--text-tertiary);
    border-bottom: 1px solid var(--border-primary);
  }

  .clients-table td {
    padding: 6px 8px;
    color: var(--text-secondary);
    border-bottom: 1px solid color-mix(in srgb, var(--border-primary) 50%, transparent);
  }

  .origin-cell {
    font-family: var(--font-mono);
    font-size: 11px;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .time-cell {
    font-family: var(--font-mono);
    font-size: 10px;
  }

  .badge {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 3px;
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    text-transform: uppercase;
    font-weight: 600;
  }

  .badge.remote {
    background: color-mix(in srgb, var(--accent-warning, #f59e0b) 20%, transparent);
    color: var(--accent-warning, #f59e0b);
  }

  .btn {
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    border: 1px solid var(--border-primary);
    transition: all 0.15s ease;
  }

  .btn.primary {
    background: var(--accent-primary);
    color: white;
    border-color: var(--accent-primary);
  }

  .btn.primary:hover {
    filter: brightness(1.1);
  }

  .btn.secondary {
    background: var(--bg-secondary);
    color: var(--text-primary);
  }

  .btn.secondary:hover {
    background: var(--bg-tertiary);
  }

  .btn.small {
    padding: 4px 10px;
    font-size: 12px;
  }

  .origins-section {
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: 8px;
    padding: 12px;
  }

  .origins-section h4 {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 8px;
  }

  .origins-section .description {
    margin-bottom: 12px;
  }

  .origins-section .description code,
  .origins-empty code,
  .info-box code {
    font-family: var(--font-mono);
    background: var(--bg-primary);
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 11px;
  }

  .origins-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 8px;
  }

  .origin-row {
    display: flex;
    align-items: center;
    padding: 6px 10px;
    background: var(--bg-primary);
    border: 1px solid var(--border-primary);
    border-radius: 6px;
  }

  .origin-code {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--accent-primary);
    word-break: break-all;
    flex: 1;
  }

  .origins-empty {
    padding: 12px;
    text-align: center;
    color: var(--text-tertiary);
    font-size: 12px;
    background: var(--bg-primary);
    border: 1px dashed var(--border-primary);
    border-radius: 6px;
  }
</style>
