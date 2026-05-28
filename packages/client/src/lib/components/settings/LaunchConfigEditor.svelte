<script lang="ts">
  /**
   * LaunchConfigEditor (LYK-1020) — GUI editor for `<workspace>/.e/launch.json`.
   *
   * Backs the "Configure…" button in DebugPanel. Lists the current saved
   * configurations in a left rail; selecting one populates the form. Add /
   * duplicate / delete sit on the rail. Save persists the in-memory edits
   * to disk through launchConfigsStore.save() — Cancel just closes the
   * modal, discarding unsaved edits.
   *
   * Schema validation against each adapter's `configurationAttributes`
   * (the VS Code parity bit) is not wired — the adapter registry doesn't
   * publish attribute schemas yet. The form covers the well-known fields
   * (name/type/request/program/args/cwd/env/console) and a free-form
   * "extra JSON" textarea so adapter-specific options remain editable.
   *
   * Compound configurations (start N at once) are deferred — they require
   * multi-session DAP support (LYK-1024).
   */
  import { uiStore } from '$lib/stores/ui.svelte';
  import { launchConfigsStore } from '$lib/stores/launch-configs.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { api } from '$lib/api/client';
  import { onMount } from 'svelte';
  import type { LaunchConfig } from '@e/shared';

  // Form state — these mirror the standard LaunchConfig fields plus an
  // `extraJson` text blob holding any adapter-specific extensions so we
  // don't lose them on a round-trip through the form.
  interface FormState {
    name: string;
    type: string;
    request: 'launch' | 'attach';
    program: string;
    argsLines: string; // newline-separated
    cwd: string;
    envLines: string; // KEY=VALUE per line
    console: string;
    extraJson: string;
  }

  function emptyForm(type = ''): FormState {
    return {
      name: '',
      type,
      request: 'launch',
      program: '',
      argsLines: '',
      cwd: '',
      envLines: '',
      console: '',
      extraJson: '',
    };
  }

  /** Split a LaunchConfig into the form fields + an extras object. */
  function configToForm(c: LaunchConfig): FormState {
    const KNOWN = new Set(['name', 'type', 'request', 'program', 'args', 'cwd', 'env', 'console']);
    const extras: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(c)) {
      if (!KNOWN.has(k)) extras[k] = v;
    }
    return {
      name: c.name,
      type: c.type,
      request: c.request,
      program: c.program ?? '',
      argsLines: Array.isArray(c.args) ? c.args.join('\n') : '',
      cwd: c.cwd ?? '',
      envLines: c.env
        ? Object.entries(c.env)
            .map(([k, v]) => `${k}=${v}`)
            .join('\n')
        : '',
      console: c.console ?? '',
      extraJson: Object.keys(extras).length > 0 ? JSON.stringify(extras, null, 2) : '',
    };
  }

  /**
   * Rebuild a LaunchConfig from the form. Returns either the config or
   * a string error message — the caller decides how to surface it.
   */
  function formToConfig(f: FormState): LaunchConfig | string {
    if (!f.name.trim()) return 'Name is required.';
    if (!f.type.trim()) return 'Type is required.';
    let extras: Record<string, unknown> = {};
    if (f.extraJson.trim()) {
      try {
        const parsed = JSON.parse(f.extraJson);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return 'Extra JSON must be an object.';
        }
        extras = parsed;
      } catch (err) {
        return `Extra JSON: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
    let env: Record<string, string> | undefined;
    if (f.envLines.trim()) {
      env = {};
      for (const line of f.envLines.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const eq = trimmed.indexOf('=');
        if (eq < 0) return `env: each line needs KEY=VALUE (got "${trimmed}")`;
        env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1);
      }
    }
    const args = f.argsLines
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    return {
      ...extras,
      name: f.name.trim(),
      type: f.type.trim(),
      request: f.request,
      ...(f.program.trim() ? { program: f.program.trim() } : {}),
      ...(args.length > 0 ? { args } : {}),
      ...(f.cwd.trim() ? { cwd: f.cwd.trim() } : {}),
      ...(env ? { env } : {}),
      ...(f.console.trim() ? { console: f.console.trim() } : {}),
    } as LaunchConfig;
  }

  let adapters = $state<Array<{ id: string; label: string; available: boolean }>>([]);
  /**
   * Working copy of the configs — edits live here until Save commits them
   * to launchConfigsStore (which writes to disk). Cancel = discard.
   */
  let workingConfigs = $state<LaunchConfig[]>([]);
  let originalName = $state<string | null>(null);
  let form = $state<FormState>(emptyForm());
  let error = $state<string | null>(null);
  let saving = $state(false);

  onMount(async () => {
    try {
      const res = await api.debug.adapters();
      adapters = res.data;
    } catch {
      adapters = [];
    }
    // Snapshot the store's current configs into the working set. Edits
    // here don't escape until Save.
    workingConfigs = launchConfigsStore.configs.map((c) => ({ ...c }));
    if (workingConfigs.length > 0) selectConfig(workingConfigs[0].name);
    else newConfig();
  });

  function selectConfig(name: string) {
    const c = workingConfigs.find((x) => x.name === name);
    if (!c) return;
    originalName = name;
    form = configToForm(c);
    error = null;
  }

  function newConfig() {
    originalName = null;
    form = emptyForm(adapters[0]?.id ?? '');
    error = null;
  }

  function commitCurrent(): boolean {
    const result = formToConfig(form);
    if (typeof result === 'string') {
      error = result;
      return false;
    }
    if (originalName === null) {
      if (workingConfigs.some((c) => c.name === result.name)) {
        error = `A configuration named "${result.name}" already exists.`;
        return false;
      }
      workingConfigs = [...workingConfigs, result];
    } else {
      const idx = workingConfigs.findIndex((c) => c.name === originalName);
      if (idx < 0) return false;
      if (result.name !== originalName && workingConfigs.some((c) => c.name === result.name)) {
        error = `A configuration named "${result.name}" already exists.`;
        return false;
      }
      const copy = [...workingConfigs];
      copy[idx] = result;
      workingConfigs = copy;
    }
    originalName = result.name;
    error = null;
    return true;
  }

  function deleteCurrent() {
    if (originalName === null) return;
    workingConfigs = workingConfigs.filter((c) => c.name !== originalName);
    if (workingConfigs.length > 0) selectConfig(workingConfigs[0].name);
    else newConfig();
  }

  function duplicateCurrent() {
    if (!commitCurrent()) return;
    if (!originalName) return;
    const c = workingConfigs.find((x) => x.name === originalName);
    if (!c) return;
    let candidate = `${c.name} (copy)`;
    let i = 2;
    while (workingConfigs.some((x) => x.name === candidate)) {
      candidate = `${c.name} (copy ${i++})`;
    }
    const dup: LaunchConfig = { ...c, name: candidate };
    workingConfigs = [...workingConfigs, dup];
    selectConfig(candidate);
  }

  async function save() {
    if (!commitCurrent()) return;
    saving = true;
    try {
      // Sync the working set into the store, then persist.
      for (const orig of launchConfigsStore.configs.map((c) => c.name)) {
        if (!workingConfigs.some((c) => c.name === orig)) {
          launchConfigsStore.removeConfig(orig);
        }
      }
      for (const w of workingConfigs) {
        const existing = launchConfigsStore.configs.find((c) => c.name === w.name);
        if (existing) launchConfigsStore.updateConfig(w.name, w);
        else launchConfigsStore.addConfig(w);
      }
      await launchConfigsStore.save(settingsStore.workspacePath);
      uiStore.toast('Saved .e/launch.json', 'success');
      uiStore.closeModal();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      saving = false;
    }
  }

  function close() {
    uiStore.closeModal();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div
  class="modal-backdrop"
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  aria-label="Edit launch configurations"
  onclick={close}
  onkeydown={(e) => {
    if (e.key === 'Escape') close();
  }}
>
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="modal" onclick={(e) => e.stopPropagation()}>
    <header class="modal-header">
      <h2>Launch Configurations</h2>
      <button type="button" class="close-btn" aria-label="Close" onclick={close}>×</button>
    </header>

    <div class="modal-body">
      <aside class="config-list">
        <ul>
          {#each workingConfigs as c (c.name)}
            <li>
              <button
                type="button"
                class="config-item"
                class:active={originalName === c.name}
                onclick={() => {
                  if (originalName !== c.name) {
                    commitCurrent();
                    selectConfig(c.name);
                  }
                }}
              >
                <span class="config-item-name">{c.name}</span>
                <span class="config-item-type">{c.type}</span>
              </button>
            </li>
          {/each}
        </ul>
        <div class="list-actions">
          <button type="button" class="list-btn" onclick={newConfig}>+ New</button>
          <button
            type="button"
            class="list-btn"
            disabled={originalName === null}
            onclick={duplicateCurrent}
          >
            Duplicate
          </button>
          <button
            type="button"
            class="list-btn danger"
            disabled={originalName === null}
            onclick={deleteCurrent}
          >
            Delete
          </button>
        </div>
      </aside>

      <form class="config-form" onsubmit={(e) => e.preventDefault()}>
        <label>
          <span>Name</span>
          <input type="text" bind:value={form.name} placeholder="Launch script" />
        </label>
        <label>
          <span>Type</span>
          <select bind:value={form.type}>
            {#each adapters as a (a.id)}
              <option value={a.id}>{a.label}{a.available ? '' : ' (not installed)'}</option>
            {/each}
          </select>
        </label>
        <label>
          <span>Request</span>
          <select bind:value={form.request}>
            <option value="launch">launch</option>
            <option value="attach">attach</option>
          </select>
        </label>
        <label>
          <span>Program</span>
          <input type="text" bind:value={form.program} placeholder="src/main.py" />
        </label>
        <label>
          <span>Args (one per line)</span>
          <textarea bind:value={form.argsLines} rows="3" placeholder="--verbose"></textarea>
        </label>
        <label>
          <span>CWD</span>
          <input type="text" bind:value={form.cwd} placeholder="Defaults to workspace root" />
        </label>
        <label>
          <span>Env (KEY=VALUE per line)</span>
          <textarea bind:value={form.envLines} rows="3" placeholder="DEBUG=1"></textarea>
        </label>
        <label>
          <span>Console</span>
          <input
            type="text"
            bind:value={form.console}
            placeholder="integratedTerminal / internalConsole"
          />
        </label>
        <label>
          <span>Extra JSON (adapter-specific overrides)</span>
          <textarea bind:value={form.extraJson} rows="5" placeholder={'{ "justMyCode": true }'}
          ></textarea>
        </label>

        {#if error}
          <div class="form-error" role="alert">{error}</div>
        {/if}
      </form>
    </div>

    <footer class="modal-footer">
      <button type="button" class="footer-btn" onclick={close}>Cancel</button>
      <button type="button" class="footer-btn primary" disabled={saving} onclick={save}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </footer>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    backdrop-filter: blur(2px);
  }
  .modal {
    background: var(--bg-elevated, var(--bg-secondary));
    border: 1px solid var(--border-primary);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
    width: min(820px, 95vw);
    max-height: 86vh;
    display: flex;
    flex-direction: column;
  }
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-primary);
  }
  .modal-header h2 {
    margin: 0;
    font-size: var(--fs-md);
  }
  .close-btn {
    background: none;
    border: none;
    color: var(--text-tertiary);
    font-size: 22px;
    line-height: 1;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: var(--radius-sm);
  }
  .close-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .modal-body {
    display: grid;
    grid-template-columns: 220px 1fr;
    min-height: 0;
    overflow: hidden;
  }
  .config-list {
    border-right: 1px solid var(--border-primary);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .config-list ul {
    flex: 1;
    list-style: none;
    margin: 0;
    padding: 8px 6px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .config-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    padding: 6px 8px;
    background: none;
    border: none;
    color: var(--text-primary);
    text-align: left;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font: inherit;
  }
  .config-item:hover {
    background: var(--bg-hover);
  }
  .config-item.active {
    background: color-mix(in srgb, var(--accent-primary) 14%, transparent);
    color: var(--accent-primary);
  }
  .config-item-name {
    font-weight: 600;
    font-size: var(--fs-sm);
  }
  .config-item-type {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
  }
  .config-item.active .config-item-type {
    color: color-mix(in srgb, var(--accent-primary) 70%, var(--text-tertiary));
  }
  .list-actions {
    display: flex;
    gap: 4px;
    padding: 8px;
    border-top: 1px solid var(--border-primary);
  }
  .list-btn {
    flex: 1;
    padding: 4px 6px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--fs-xxs);
    cursor: pointer;
  }
  .list-btn:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .list-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .list-btn.danger:hover:not(:disabled) {
    color: var(--accent-error);
    border-color: var(--accent-error);
  }

  .config-form {
    padding: 16px 18px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .config-form label {
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: var(--fs-xs);
    color: var(--text-secondary);
  }
  .config-form input,
  .config-form select,
  .config-form textarea {
    padding: 5px 8px;
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    background: var(--bg-primary, var(--bg-secondary));
    color: var(--text-primary);
    font: inherit;
    font-size: var(--fs-sm);
    outline: none;
    font-family: var(--font-family);
  }
  .config-form input:focus,
  .config-form select:focus,
  .config-form textarea:focus {
    border-color: var(--accent-primary);
  }
  .config-form textarea {
    resize: vertical;
    min-height: 60px;
  }

  .form-error {
    padding: 8px 10px;
    background: color-mix(in srgb, var(--accent-error) 12%, transparent);
    border: 1px solid var(--accent-error);
    border-radius: var(--radius-sm);
    color: var(--accent-error);
    font-size: var(--fs-xs);
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 10px 16px;
    border-top: 1px solid var(--border-primary);
  }
  .footer-btn {
    padding: 6px 14px;
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    background: var(--bg-tertiary);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--fs-sm);
    cursor: pointer;
  }
  .footer-btn:hover:not(:disabled) {
    background: var(--bg-hover);
  }
  .footer-btn.primary {
    background: var(--accent-primary);
    color: var(--bg-primary);
    border-color: var(--accent-primary);
  }
  .footer-btn.primary:hover:not(:disabled) {
    filter: brightness(1.1);
  }
  .footer-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
