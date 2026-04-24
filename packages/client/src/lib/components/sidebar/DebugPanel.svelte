<script lang="ts">
  /**
   * Debug panel — DAP v1 UI.
   *
   * Top: adapter picker + launch config input + control buttons (start / pause / step / stop).
   * Middle: tabs for Call Stack / Variables / Threads / Watch (+ Output).
   * Bottom: status line.
   *
   * Launch configs are read from `.e/launch.json` in the workspace root. For v1 the
   * schema mirrors VS Code's `launch.json`; we pass each config verbatim to the
   * adapter's `launch` request. Only one run at a time (`dapStore.isActive`).
   */

  import { dapStore, type StackFrame, type Variable } from '$lib/stores/dap.svelte';
  import { breakpointsStore } from '$lib/stores/breakpoints.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { api } from '$lib/api/client';
  import { onMount } from 'svelte';

  interface LaunchConfig {
    name: string;
    type: string; // 'python' | 'node' | ...
    request: 'launch' | 'attach';
    program?: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    [k: string]: any;
  }

  type Tab = 'callstack' | 'variables' | 'watch' | 'threads' | 'output';

  let activeTab = $state<Tab>('variables');
  let adapters = $state<Array<{ id: string; label: string; available: boolean }>>([]);
  let configs = $state<LaunchConfig[]>([]);
  let selectedConfig = $state<LaunchConfig | null>(null);
  let startError = $state<string | null>(null);
  let starting = $state(false);

  async function loadAdapters() {
    try {
      const res = await api.debug.adapters();
      adapters = res.data;
    } catch {
      adapters = [];
    }
  }

  async function loadLaunchConfigs() {
    const workspace = settingsStore.workspacePath;
    if (!workspace || workspace === '.') {
      configs = [];
      return;
    }
    try {
      const res = await api.files.read(`${workspace}/.e/launch.json`);
      const parsed = JSON.parse(res.data.content);
      const list: LaunchConfig[] = Array.isArray(parsed.configurations)
        ? parsed.configurations
        : [];
      configs = list;
      if (list.length > 0 && !selectedConfig) selectedConfig = list[0];
    } catch {
      // No launch.json — normal case; user can still run manually.
      configs = [];
    }
  }

  onMount(() => {
    loadAdapters();
    loadLaunchConfigs();
  });

  async function handleStart() {
    if (!selectedConfig) {
      startError = 'No launch configuration selected.';
      return;
    }
    const adapterId = selectedConfig.type;
    const adapterInfo = adapters.find((a) => a.id === adapterId);
    if (!adapterInfo) {
      startError = `No debug adapter registered for type "${adapterId}".`;
      return;
    }
    if (!adapterInfo.available) {
      startError = `${adapterInfo.label} is not installed on this machine.`;
      return;
    }

    starting = true;
    startError = null;
    try {
      const ws = settingsStore.workspacePath;
      // For python launch via debugpy, the adapter expects the full launch payload verbatim.
      // We pass the whole config object and let the adapter pick out its own fields.
      await dapStore.start({
        adapter: adapterId,
        cwd: selectedConfig.cwd ?? (ws !== '.' ? ws : undefined),
        launchArgs: selectedConfig,
      });
    } catch (e) {
      startError = String(e);
    } finally {
      starting = false;
    }
  }

  function handleStop() {
    void dapStore.stop();
  }

  /** Flatten local variables from the first available scope for compact display. */
  let flatLocals = $derived.by<Variable[]>(() => {
    const scope = dapStore.scopes.find((s) => /local/i.test(s.name)) ?? dapStore.scopes[0];
    if (!scope) return [];
    return dapStore.variablesByRef.get(scope.variablesReference) ?? [];
  });

  let totalBreakpoints = $derived.by(() => {
    let n = 0;
    for (const bps of breakpointsStore.byPath.values()) n += bps.length;
    return n;
  });

  function shortPath(path: string | undefined): string {
    if (!path) return '';
    const ws = settingsStore.workspacePath;
    if (ws && ws !== '.' && path.startsWith(ws + '/')) return path.slice(ws.length + 1);
    return path.split('/').slice(-2).join('/');
  }
</script>

<div class="debug-panel">
  <div class="debug-header">
    <span class="state-badge state-{dapStore.state}">{dapStore.state}</span>
  </div>

  <div class="launch-row">
    <select
      class="config-select"
      disabled={dapStore.isActive || configs.length === 0}
      bind:value={selectedConfig}
    >
      {#if configs.length === 0}
        <option value={null}>No .e/launch.json found</option>
      {:else}
        {#each configs as cfg (cfg.name)}
          <option value={cfg}>{cfg.name} ({cfg.type})</option>
        {/each}
      {/if}
    </select>

    <div class="debug-controls">
      {#if !dapStore.isActive}
        <button
          class="ctrl-btn primary"
          onclick={handleStart}
          disabled={starting || !selectedConfig}
          title="Start debugging"
        >
          {starting ? '…' : '▶'}
        </button>
      {:else}
        {#if dapStore.state === 'stopped'}
          <button
            class="ctrl-btn"
            onclick={() => void dapStore.continueExec()}
            title="Continue (F5)"
          >
            ▶
          </button>
          <button class="ctrl-btn" onclick={() => void dapStore.stepOver()} title="Step over (F10)">
            ⤼
          </button>
          <button class="ctrl-btn" onclick={() => void dapStore.stepIn()} title="Step in (F11)">
            ↘
          </button>
          <button
            class="ctrl-btn"
            onclick={() => void dapStore.stepOut()}
            title="Step out (Shift+F11)"
          >
            ↗
          </button>
        {:else}
          <button class="ctrl-btn" onclick={() => void dapStore.pause()} title="Pause (F6)">
            ⏸
          </button>
        {/if}
        <button class="ctrl-btn danger" onclick={handleStop} title="Stop (Shift+F5)">■</button>
      {/if}
    </div>
  </div>

  {#if startError}
    <div class="start-error">{startError}</div>
  {/if}
  {#if dapStore.errorMessage}
    <div class="start-error">{dapStore.errorMessage}</div>
  {/if}

  <div class="tab-row" role="tablist">
    <button
      class="tab-btn"
      class:active={activeTab === 'variables'}
      onclick={() => (activeTab = 'variables')}
      role="tab"
    >
      Variables
    </button>
    <button
      class="tab-btn"
      class:active={activeTab === 'callstack'}
      onclick={() => (activeTab = 'callstack')}
      role="tab"
    >
      Call stack
    </button>
    <button
      class="tab-btn"
      class:active={activeTab === 'threads'}
      onclick={() => (activeTab = 'threads')}
      role="tab"
    >
      Threads
    </button>
    <button
      class="tab-btn"
      class:active={activeTab === 'output'}
      onclick={() => (activeTab = 'output')}
      role="tab"
    >
      Output
    </button>
  </div>

  <div class="tab-body">
    {#if activeTab === 'variables'}
      {#if dapStore.state !== 'stopped'}
        <div class="placeholder">Hit a breakpoint to inspect variables.</div>
      {:else if flatLocals.length === 0}
        <div class="placeholder">No locals in this scope.</div>
      {:else}
        <ul class="var-list">
          {#each flatLocals as v (v.name)}
            <li class="var-item">
              <span class="var-name">{v.name}</span>
              {#if v.type}
                <span class="var-type">{v.type}</span>
              {/if}
              <span class="var-value">{v.value}</span>
            </li>
          {/each}
        </ul>
      {/if}
    {:else if activeTab === 'callstack'}
      {#if dapStore.stackFrames.length === 0}
        <div class="placeholder">Stack trace appears when execution is paused.</div>
      {:else}
        <ul class="frame-list">
          {#each dapStore.stackFrames as f (f.id)}
            <li
              class="frame-item"
              class:active={f.id === dapStore.currentFrameId}
              onclick={() => void dapStore.selectFrame(f.id)}
              onkeydown={(e) => e.key === 'Enter' && void dapStore.selectFrame(f.id)}
              role="button"
              tabindex="0"
            >
              <span class="frame-name">{f.name}</span>
              <span class="frame-loc">{shortPath(f.source?.path)}:{f.line}</span>
            </li>
          {/each}
        </ul>
      {/if}
    {:else if activeTab === 'threads'}
      {#if dapStore.threads.length === 0}
        <div class="placeholder">No threads yet.</div>
      {:else}
        <ul class="frame-list">
          {#each dapStore.threads as t (t.id)}
            <li class="frame-item" class:active={t.id === dapStore.currentThreadId}>
              <span class="frame-name">{t.name}</span>
              <span class="frame-loc">#{t.id}</span>
            </li>
          {/each}
        </ul>
      {/if}
    {:else if activeTab === 'output'}
      {#if dapStore.output.length === 0}
        <div class="placeholder">Adapter output will appear here.</div>
      {:else}
        <pre class="output-log">{dapStore.output.map((o) => o.output).join('')}</pre>
      {/if}
    {/if}
  </div>

  <div class="debug-footer">
    <span>{totalBreakpoints} breakpoint{totalBreakpoints === 1 ? '' : 's'}</span>
    {#if totalBreakpoints > 0}
      <button class="link-btn" onclick={() => breakpointsStore.clearAll()}>Remove all</button>
    {/if}
  </div>
</div>

<style>
  .debug-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    font-size: var(--fs-sm);
  }
  .debug-header {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border-primary);
  }
  .state-badge {
    padding: 1px 8px;
    font-size: var(--fs-xxs);
    font-weight: 700;
    border-radius: 10px;
    text-transform: uppercase;
    background: var(--bg-active);
    color: var(--text-tertiary);
  }
  .state-badge.state-running {
    background: var(--accent-success, #22c55e);
    color: var(--bg-primary);
  }
  .state-badge.state-stopped {
    background: var(--accent-warning, #cca700);
    color: var(--bg-primary);
  }
  .state-badge.state-error {
    background: var(--accent-error, #f14c4c);
    color: #fff;
  }

  .launch-row {
    display: flex;
    gap: 6px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border-primary);
    align-items: center;
  }
  .config-select {
    flex: 1;
    padding: 4px 8px;
    font-size: var(--fs-xs);
    background: var(--bg-input);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
  }
  .debug-controls {
    display: flex;
    gap: 2px;
  }
  .ctrl-btn {
    width: 24px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    background: var(--bg-active);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    cursor: pointer;
  }
  .ctrl-btn:hover:not(:disabled) {
    color: var(--text-primary);
    border-color: var(--border-secondary);
  }
  .ctrl-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .ctrl-btn.primary {
    color: var(--accent-success, #22c55e);
  }
  .ctrl-btn.danger {
    color: var(--accent-error, #f14c4c);
  }

  .start-error {
    padding: 6px 10px;
    margin: 6px 10px;
    background: color-mix(in srgb, var(--accent-error, #f14c4c) 15%, transparent);
    color: var(--accent-error, #f14c4c);
    border-radius: var(--radius-sm);
    font-size: var(--fs-xs);
  }

  .tab-row {
    display: flex;
    gap: 0;
    border-bottom: 1px solid var(--border-primary);
  }
  .tab-btn {
    padding: 6px 10px;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-tertiary);
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .tab-btn.active {
    color: var(--text-primary);
    border-bottom-color: var(--accent, var(--text-primary));
  }

  .tab-body {
    flex: 1;
    overflow: auto;
    padding: 6px 10px;
    min-height: 100px;
  }
  .placeholder {
    color: var(--text-tertiary);
    font-size: var(--fs-xs);
    padding: 20px 0;
    text-align: center;
  }

  .var-list,
  .frame-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .var-item {
    display: flex;
    align-items: baseline;
    gap: 6px;
    padding: 2px 0;
    font-family: var(--font-family);
    font-size: var(--fs-xs);
  }
  .var-name {
    font-weight: 600;
    color: var(--syn-variable, var(--text-primary));
  }
  .var-type {
    font-size: var(--fs-xxs);
    color: var(--syn-type, var(--text-tertiary));
  }
  .var-value {
    flex: 1;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .frame-item {
    display: flex;
    gap: 6px;
    padding: 3px 6px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: var(--fs-xs);
  }
  .frame-item:hover {
    background: var(--bg-hover);
  }
  .frame-item.active {
    background: var(--bg-active);
  }
  .frame-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-primary);
  }
  .frame-loc {
    font-family: var(--font-family);
    color: var(--text-tertiary);
    font-size: var(--fs-xxs);
  }

  .output-log {
    margin: 0;
    padding: 0;
    font-family: var(--font-family);
    font-size: var(--fs-xs);
    white-space: pre-wrap;
    word-break: break-all;
    color: var(--text-secondary);
  }

  .debug-footer {
    display: flex;
    justify-content: space-between;
    padding: 6px 10px;
    border-top: 1px solid var(--border-primary);
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
  }
  .link-btn {
    background: none;
    border: none;
    color: var(--text-tertiary);
    font-size: var(--fs-xxs);
    text-decoration: underline;
    cursor: pointer;
    padding: 0;
  }
  .link-btn:hover {
    color: var(--text-primary);
  }
</style>
