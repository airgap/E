<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import { uiStore } from '$lib/stores/ui.svelte';

  interface McpServer {
    name: string;
    transport: string;
    command?: string;
    url?: string;
    status: string;
    scope: string;
  }

  interface DiscoveredSource {
    source: string;
    configPath: string;
    servers: Array<{
      name: string;
      command?: string;
      args?: string[];
      url?: string;
      env?: Record<string, string>;
      transport: string;
    }>;
  }

  const PRESETS = [
    {
      name: 'filesystem',
      label: 'Filesystem',
      desc: 'Read/write local files',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/'],
      builtIn: true,
      builtInNote: 'Built In',
    },
    {
      name: 'github',
      label: 'GitHub',
      desc: 'Repos, issues, PRs',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' },
    },
    {
      name: 'postgres',
      label: 'PostgreSQL',
      desc: 'Query databases',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://localhost/mydb'],
    },
    {
      name: 'brave-search',
      label: 'Brave Search',
      desc: 'Web search',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-brave-search'],
      env: { BRAVE_API_KEY: '' },
    },
    {
      name: 'memory',
      label: 'Memory',
      desc: 'Knowledge graph memory',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
    },
    {
      name: 'puppeteer',
      label: 'Puppeteer',
      desc: 'Browser automation',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    },
    {
      name: 'git',
      label: 'Git',
      desc: 'Commit history, blame, diff',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-git'],
      builtIn: true,
      builtInNote: 'Built In',
    },
    {
      name: 'sqlite',
      label: 'SQLite',
      desc: 'Query local databases',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'mcp-server-sqlite', '/path/to/db.sqlite'],
    },
    {
      name: 'shell',
      label: 'Shell',
      desc: 'Run shell commands',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'mcp-shell'],
      builtIn: true,
      builtInNote: 'Built In',
    },
    {
      name: 'obsidian',
      label: 'Obsidian',
      desc: 'Read markdown vaults',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'mcp-obsidian', '/path/to/vault'],
    },
    {
      name: 'linear',
      label: 'Linear',
      desc: 'Issues & projects',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'mcp-linear'],
      env: { LINEAR_API_KEY: '' },
    },
  ];

  let servers = $state<McpServer[]>([]);
  let loading = $state(true);
  let showAdd = $state(false);
  let addForm = $state({
    name: '',
    transport: 'stdio' as 'stdio' | 'sse' | 'http',
    command: '',
    args: '',
    url: '',
    env: '',
  });

  // ── Import/Discovery state ──
  let discoveredSources = $state<DiscoveredSource[]>([]);
  let discovering = $state(false);
  let showImport = $state(false);
  let selectedImports = $state<Set<string>>(new Set());
  let importing = $state(false);

  async function loadServers() {
    try {
      const res = await api.mcp.listServers();
      servers = res.data;
    } catch {
      /* */
    }
    loading = false;
  }

  async function addServer() {
    if (!addForm.name) return;
    try {
      await api.mcp.addServer({
        name: addForm.name,
        transport: addForm.transport,
        command: addForm.command || undefined,
        args: addForm.args ? addForm.args.split(/\s+/).filter(Boolean) : undefined,
        url: addForm.url || undefined,
        env: addForm.env ? JSON.parse(addForm.env) : undefined,
      });
      addForm = { name: '', transport: 'stdio', command: '', args: '', url: '', env: '' };
      showAdd = false;
      await loadServers();
      uiStore.toast('MCP server added', 'success');
    } catch (e) {
      uiStore.toast(`Failed: ${e}`, 'error');
    }
  }

  async function installPreset(preset: (typeof PRESETS)[0]) {
    try {
      await api.mcp.addServer({
        name: preset.name,
        transport: preset.transport,
        command: preset.command,
        args: preset.args,
        env: preset.env,
      });
      await loadServers();
      uiStore.toast(`${preset.label} added`, 'success');
    } catch {
      uiStore.toast(`Failed to add ${preset.label}`, 'error');
    }
  }

  async function removeServer(name: string) {
    try {
      await api.mcp.removeServer(name);
      servers = servers.filter((s) => s.name !== name);
      uiStore.toast('Server removed', 'info');
    } catch {
      uiStore.toast('Failed to remove server', 'error');
    }
  }

  // ── Import/Discovery ──
  async function discoverConfigs() {
    discovering = true;
    try {
      const res = await api.mcp.discover();
      discoveredSources = res.data;
      showImport = true;
      if (res.data.length === 0) {
        uiStore.toast('No external MCP configs found', 'info');
      }
    } catch (e) {
      uiStore.toast(`Discovery failed: ${e}`, 'error');
    }
    discovering = false;
  }

  function toggleImport(key: string) {
    const next = new Set(selectedImports);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    selectedImports = next;
  }

  function selectAllFromSource(source: DiscoveredSource) {
    const next = new Set(selectedImports);
    for (const server of source.servers) {
      const key = `${source.source}:${server.name}`;
      if (!installedNames.has(server.name) && !builtInNames.has(server.name)) {
        next.add(key);
      }
    }
    selectedImports = next;
  }

  async function importSelected() {
    if (selectedImports.size === 0) return;
    importing = true;
    const toImport: any[] = [];
    for (const source of discoveredSources) {
      for (const server of source.servers) {
        if (selectedImports.has(`${source.source}:${server.name}`)) {
          toImport.push(server);
        }
      }
    }
    try {
      const res = await api.mcp.importServers(toImport);
      uiStore.toast(
        `Imported ${res.data.imported} server${res.data.imported !== 1 ? 's' : ''}`,
        'success',
      );
      selectedImports = new Set();
      discoveredSources = [];
      showImport = false;
      await loadServers();
    } catch (e) {
      uiStore.toast(`Import failed: ${e}`, 'error');
    }
    importing = false;
  }

  onMount(loadServers);

  let installedNames = $derived(new Set(servers.map((s) => s.name)));
  let builtInNames = $derived(new Set(PRESETS.filter((p) => p.builtIn).map((p) => p.name)));
  let totalDiscovered = $derived(
    discoveredSources.reduce(
      (sum, s) => sum + s.servers.filter((sv) => !installedNames.has(sv.name)).length,
      0,
    ),
  );
</script>

<div class="mcp-panel">
  <div class="panel-header">
    <h3>MCP Servers</h3>
    <button class="add-btn" onclick={() => (showAdd = !showAdd)} title="Add custom server">+</button
    >
  </div>

  {#if loading}
    <div class="empty">Loading...</div>
  {:else}
    {#if servers.length > 0}
      <div class="server-list">
        {#each servers as server (server.name)}
          <div class="server-item">
            <div class="server-info">
              <span class="server-name">{server.name}</span>
              <span class="server-transport">{server.transport}</span>
            </div>
            <div class="server-meta">
              {#if server.command}
                <span class="server-cmd">{server.command}</span>
              {:else if server.url}
                <span class="server-cmd">{server.url}</span>
              {/if}
            </div>
            <div class="server-actions">
              <span class="status-dot" class:connected={server.status === 'connected'}></span>
              <button class="remove-btn" onclick={() => removeServer(server.name)} title="Remove">
                &times;
              </button>
            </div>
          </div>
        {/each}
      </div>
    {:else}
      <div class="empty">No MCP servers configured</div>
    {/if}

    {#if showAdd}
      <div class="add-form">
        <input bind:value={addForm.name} placeholder="Server name" class="form-input" />
        <select bind:value={addForm.transport} class="form-input">
          <option value="stdio">stdio</option>
          <option value="sse">SSE</option>
          <option value="http">HTTP</option>
        </select>
        {#if addForm.transport === 'stdio'}
          <input bind:value={addForm.command} placeholder="Command (e.g. npx)" class="form-input" />
          <input
            bind:value={addForm.args}
            placeholder="Args (space-separated)"
            class="form-input"
          />
        {:else}
          <input bind:value={addForm.url} placeholder="URL" class="form-input" />
        {/if}
        <input
          bind:value={addForm.env}
          placeholder={'Env JSON (e.g. {"KEY":"val"})'}
          class="form-input"
        />
        <button class="save-btn" onclick={addServer}>Add Server</button>
      </div>
    {/if}

    <!-- ── Import from other tools ── -->
    <div class="import-section">
      <h4 class="section-title">Import</h4>
      {#if !showImport || discoveredSources.length === 0}
        <button class="discover-btn" onclick={discoverConfigs} disabled={discovering}>
          {#if discovering}
            <span class="discover-spinner"></span>
            Scanning...
          {:else}
            Detect external MCP configs
          {/if}
        </button>
      {:else}
        <div class="discovered-list">
          {#each discoveredSources as source}
            {@const importable = source.servers.filter(
              (s) => !installedNames.has(s.name) && !builtInNames.has(s.name),
            )}
            {#if importable.length > 0 || source.servers.some((s) => installedNames.has(s.name) || builtInNames.has(s.name))}
              <div class="import-source">
                <div class="source-header">
                  <span class="source-label">{source.source}</span>
                  {#if importable.length > 1}
                    <button class="select-all-btn" onclick={() => selectAllFromSource(source)}
                      >Select all</button
                    >
                  {/if}
                </div>
                <span class="source-path">{source.configPath}</span>
                {#each source.servers as server}
                  {@const key = `${source.source}:${server.name}`}
                  {@const alreadyInstalled = installedNames.has(server.name)}
                  {@const isBuiltIn = builtInNames.has(server.name)}
                  <label class="import-item" class:disabled={alreadyInstalled || isBuiltIn}>
                    <input
                      type="checkbox"
                      checked={selectedImports.has(key)}
                      disabled={alreadyInstalled || isBuiltIn}
                      onchange={() => toggleImport(key)}
                    />
                    <span class="import-name">{server.name}</span>
                    <span class="import-transport">{server.transport}</span>
                    {#if alreadyInstalled}
                      <span class="preset-installed">Installed</span>
                    {:else if isBuiltIn}
                      <span class="preset-builtin-badge">Built In</span>
                    {/if}
                  </label>
                {/each}
              </div>
            {/if}
          {/each}
        </div>
        <div class="import-actions">
          <button
            class="save-btn"
            onclick={importSelected}
            disabled={selectedImports.size === 0 || importing}
          >
            {importing
              ? 'Importing...'
              : `Import ${selectedImports.size} server${selectedImports.size !== 1 ? 's' : ''}`}
          </button>
          <button
            class="cancel-btn"
            onclick={() => {
              showImport = false;
              discoveredSources = [];
              selectedImports = new Set();
            }}
          >
            Cancel
          </button>
        </div>
      {/if}
    </div>

    <div class="presets-section">
      <h4 class="section-title">Quick Add</h4>
      <div class="preset-grid">
        {#each PRESETS as preset}
          {#if preset.builtIn}
            <div class="preset-btn preset-builtin" title={preset.desc}>
              <span class="preset-name">{preset.label}</span>
              <span class="preset-desc">{preset.desc}</span>
              <span class="preset-builtin-badge">{preset.builtInNote}</span>
            </div>
          {:else}
            <button
              class="preset-btn"
              disabled={installedNames.has(preset.name)}
              onclick={() => installPreset(preset)}
              title={preset.desc}
            >
              <span class="preset-name">{preset.label}</span>
              <span class="preset-desc">{preset.desc}</span>
              {#if installedNames.has(preset.name)}
                <span class="preset-installed">Installed</span>
              {/if}
            </button>
          {/if}
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .mcp-panel {
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 4px 8px;
  }
  .panel-header h3 {
    font-size: var(--fs-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--text-secondary);
    margin: 0;
  }
  .add-btn {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--fs-lg);
    font-weight: 700;
    color: var(--text-tertiary);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    cursor: pointer;
  }
  .add-btn:hover {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
  }
  .empty {
    padding: 16px;
    text-align: center;
    font-size: var(--fs-sm);
    color: var(--text-tertiary);
  }
  .server-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .server-item {
    display: flex;
    flex-direction: column;
    padding: 8px 10px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    position: relative;
  }
  .server-info {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .server-name {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-primary);
  }
  .server-transport {
    font-size: var(--fs-xxs);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-tertiary);
    padding: 1px 6px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-secondary);
  }
  .server-meta {
    margin-top: 2px;
  }
  .server-cmd {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    font-family: var(--font-family);
    word-break: break-all;
  }
  .server-actions {
    position: absolute;
    top: 8px;
    right: 8px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .status-dot {
    width: 6px;
    height: 6px;
    background: var(--text-tertiary);
  }
  .status-dot.connected {
    background: var(--accent-secondary);
    box-shadow: 0 0 4px var(--accent-secondary);
  }
  .remove-btn {
    font-size: var(--fs-md);
    color: var(--text-tertiary);
    background: none;
    border: none;
    cursor: pointer;
    line-height: 1;
    padding: 0 2px;
    min-width: 24px;
    min-height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .remove-btn:hover {
    color: var(--accent-error);
  }
  .add-form {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
  }
  .form-input {
    font-size: var(--fs-sm);
    padding: 4px 8px;
    background: var(--bg-primary);
    border: 1px solid var(--border-secondary);
    color: var(--text-primary);
    font-family: var(--font-family);
  }
  .form-input:focus {
    border-color: var(--accent-primary);
    outline: none;
  }
  .save-btn {
    font-size: var(--fs-xs);
    padding: 4px 12px;
    background: var(--accent-primary);
    color: var(--bg-primary);
    border: none;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    cursor: pointer;
  }
  .save-btn:hover:not(:disabled) {
    opacity: 0.9;
  }
  .save-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  /* ── Import Section ── */
  .import-section {
    margin-top: 8px;
  }
  .section-title {
    font-size: var(--fs-xxs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--text-tertiary);
    margin: 0 0 6px 8px;
  }
  .discover-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    padding: 8px 12px;
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-secondary);
    background: var(--bg-tertiary);
    border: 1px dashed var(--border-secondary);
    cursor: pointer;
    transition: all var(--transition);
  }
  .discover-btn:hover:not(:disabled) {
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }
  .discover-btn:disabled {
    opacity: 0.7;
    cursor: default;
  }
  .discover-spinner {
    display: inline-block;
    width: 10px;
    height: 10px;
    border: 2px solid var(--text-tertiary);
    border-top-color: var(--accent-primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  .discovered-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .import-source {
    padding: 8px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
  }
  .source-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2px;
  }
  .source-label {
    font-size: var(--fs-xs);
    font-weight: 700;
    color: var(--accent-primary);
  }
  .select-all-btn {
    font-size: var(--fs-xxs);
    padding: 1px 6px;
    background: none;
    border: 1px solid var(--border-secondary);
    color: var(--text-tertiary);
    cursor: pointer;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .select-all-btn:hover {
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }
  .source-path {
    display: block;
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    font-family: var(--font-family);
    word-break: break-all;
    margin-bottom: 6px;
  }
  .import-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    cursor: pointer;
    font-size: var(--fs-xs);
    transition: background var(--transition);
  }
  .import-item:hover:not(.disabled) {
    background: var(--bg-hover);
  }
  .import-item.disabled {
    opacity: 0.5;
    cursor: default;
  }
  .import-item input[type='checkbox'] {
    margin: 0;
    accent-color: var(--accent-primary);
  }
  .import-name {
    font-weight: 600;
    color: var(--text-primary);
    flex: 1;
  }
  .import-transport {
    font-size: var(--fs-xxs);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-tertiary);
    padding: 1px 4px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-secondary);
  }
  .import-actions {
    display: flex;
    gap: 6px;
    margin-top: 8px;
  }
  .cancel-btn {
    font-size: var(--fs-xs);
    padding: 4px 12px;
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    border: 1px solid var(--border-secondary);
    cursor: pointer;
    font-weight: 600;
  }
  .cancel-btn:hover {
    border-color: var(--text-tertiary);
  }

  /* ── Presets Section ── */
  .presets-section {
    margin-top: 8px;
  }
  .preset-grid {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .preset-btn {
    display: flex;
    flex-direction: column;
    padding: 6px 10px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    text-align: left;
    cursor: pointer;
    transition: all var(--transition);
    position: relative;
  }
  .preset-btn:hover:not(:disabled) {
    border-color: var(--accent-primary);
  }
  .preset-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .preset-name {
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-primary);
  }
  .preset-desc {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
  }
  .preset-installed {
    position: absolute;
    top: 6px;
    right: 8px;
    font-size: var(--fs-xxs);
    color: var(--accent-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .preset-builtin {
    opacity: 0.45;
    cursor: default;
    border-style: dashed;
  }
  .preset-builtin-badge {
    position: absolute;
    top: 6px;
    right: 8px;
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
