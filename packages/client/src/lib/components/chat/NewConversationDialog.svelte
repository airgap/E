<script lang="ts">
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { api } from '$lib/api/client';

  let { open = $bindable(false), onCreated } = $props<{
    open: boolean;
    onCreated?: (id: string) => void;
  }>();

  let workspacePath = $state(settingsStore.workspacePath);
  let model = $state(settingsStore.model);
  let permissionMode = $state(settingsStore.permissionMode);
  let effort = $state(settingsStore.effort);
  let maxBudgetUsd = $state<string>('');
  let maxTurns = $state<string>('');
  let browsing = $state(false);
  let directories = $state<{ name: string; path: string }[]>([]);
  let browseParent = $state('');

  const models = [
    { id: 'claude-opus-4-6', label: 'Opus 4.6' },
    { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
    { id: 'claude-sonnet-4-5-20250929', label: 'Sonnet 4.5' },
    { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
  ];

  const permModes = [
    { id: 'plan', label: 'Plan', desc: 'Analyze before implementing' },
    { id: 'safe', label: 'Safe (Default)', desc: 'Ask before risky actions' },
    { id: 'fast', label: 'Fast', desc: 'Auto-accept edits' },
    { id: 'unrestricted', label: 'Unrestricted', desc: 'Bypass all permissions' },
  ];

  const efforts = [
    { id: 'low', label: 'Low' },
    { id: 'medium', label: 'Medium' },
    { id: 'high', label: 'High' },
  ];

  async function browseDirectory(path?: string) {
    try {
      const res = await api.files.directories(path);
      directories = res.data.directories;
      browseParent = res.data.parent;
      browsing = true;
    } catch {
      // Failed to browse
    }
  }

  function selectDirectory(path: string) {
    workspacePath = path;
    browsing = false;
  }

  async function create() {
    const res = await api.conversations.create({
      model,
      workspacePath: workspacePath !== '.' ? workspacePath : undefined,
      permissionMode,
      effort,
      maxBudgetUsd: maxBudgetUsd ? parseFloat(maxBudgetUsd) : undefined,
      maxTurns: maxTurns ? parseInt(maxTurns) : undefined,
    });
    const convRes = await api.conversations.get(res.data.id);
    conversationStore.setActive(convRes.data);
    conversationStore.prependConversation({
      id: convRes.data.id,
      title: convRes.data.title,
      createdAt: convRes.data.createdAt,
      updatedAt: convRes.data.updatedAt,
      messageCount: 0,
      model: convRes.data.model,
    });
    open = false;
    onCreated?.(res.data.id);
  }

  function handleBackdrop(e: MouseEvent) {
    if (e.target === e.currentTarget) open = false;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') open = false;
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="dialog-backdrop" onclick={handleBackdrop} onkeydown={handleKeydown}>
    <div class="dialog">
      <h2>New Conversation</h2>

      <div class="field">
        <label for="nc-path">Workspace Directory</label>
        <div class="path-row">
          <input id="nc-path" type="text" bind:value={workspacePath} placeholder="." />
          <button
            class="btn-browse"
            onclick={() => browseDirectory(workspacePath !== '.' ? workspacePath : undefined)}
            >Browse</button
          >
        </div>
      </div>

      {#if browsing}
        <div class="browse-panel">
          <div class="browse-header">
            <span class="browse-path">{browseParent}</span>
            <button class="btn-small" onclick={() => (browsing = false)}>Close</button>
          </div>
          <div class="browse-list">
            {#if browseParent !== '/'}
              <button
                class="browse-item"
                onclick={() =>
                  browseDirectory(browseParent.split('/').slice(0, -1).join('/') || '/')}
              >
                ../
              </button>
            {/if}
            <button
              class="browse-item select-current"
              onclick={() => selectDirectory(browseParent)}
            >
              Select this directory
            </button>
            {#each directories as dir}
              <button class="browse-item" onclick={() => browseDirectory(dir.path)}>
                {dir.name}/
              </button>
            {/each}
          </div>
        </div>
      {/if}

      <div class="field">
        <label for="nc-model">Model</label>
        <select id="nc-model" bind:value={model}>
          {#each models as m}
            <option value={m.id}>{m.label}</option>
          {/each}
        </select>
      </div>

      <div class="field">
        <label for="nc-perm">Permission Mode</label>
        <select id="nc-perm" bind:value={permissionMode}>
          {#each permModes as pm}
            <option value={pm.id}>{pm.label} — {pm.desc}</option>
          {/each}
        </select>
      </div>

      <div class="field">
        <label for="nc-effort">Effort</label>
        <select id="nc-effort" bind:value={effort}>
          {#each efforts as e}
            <option value={e.id}>{e.label}</option>
          {/each}
        </select>
      </div>

      <div class="field-row">
        <div class="field">
          <label for="nc-budget">Max Budget ($)</label>
          <input
            id="nc-budget"
            type="number"
            step="0.01"
            min="0"
            bind:value={maxBudgetUsd}
            placeholder="No limit"
          />
        </div>
        <div class="field">
          <label for="nc-turns">Max Turns</label>
          <input
            id="nc-turns"
            type="number"
            step="1"
            min="1"
            bind:value={maxTurns}
            placeholder="No limit"
          />
        </div>
      </div>

      <div class="dialog-actions">
        <button class="btn-cancel" onclick={() => (open = false)}>Cancel</button>
        <button class="btn-create" onclick={create}>Create</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .dialog-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .dialog {
    background: var(--bg-elevated);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius);
    padding: 24px;
    width: 480px;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: var(--shadow-lg);
  }

  h2 {
    margin: 0 0 20px;
    font-size: var(--fs-lg);
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: 0.5px;
  }

  .field {
    margin-bottom: 14px;
  }

  .field-row {
    display: flex;
    gap: 12px;
  }
  .field-row .field {
    flex: 1;
  }

  label {
    display: block;
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-secondary);
    margin-bottom: 4px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }

  input,
  select {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    background: var(--bg-input);
    color: var(--text-primary);
    font-size: var(--fs-base);
    font-family: inherit;
  }
  input:focus,
  select:focus {
    outline: none;
    border-color: var(--accent-primary);
  }

  .path-row {
    display: flex;
    gap: 8px;
  }
  .path-row input {
    flex: 1;
  }

  .btn-browse,
  .btn-small {
    padding: 8px 12px;
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    background: var(--bg-hover);
    color: var(--text-secondary);
    font-size: var(--fs-sm);
    cursor: pointer;
    white-space: nowrap;
  }
  .btn-browse:hover,
  .btn-small:hover {
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }

  .browse-panel {
    margin-bottom: 14px;
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .browse-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 10px;
    background: var(--bg-hover);
    border-bottom: 1px solid var(--border-primary);
  }
  .browse-path {
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    font-family: var(--font-family-mono, monospace);
  }
  .browse-list {
    max-height: 200px;
    overflow-y: auto;
  }
  .browse-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 6px 10px;
    font-size: var(--fs-base);
    color: var(--text-primary);
    cursor: pointer;
    border: none;
    background: none;
  }
  .browse-item:hover {
    background: var(--bg-hover);
  }
  .browse-item.select-current {
    color: var(--accent-primary);
    font-weight: 600;
    border-bottom: 1px solid var(--border-primary);
  }

  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 20px;
    padding-top: 16px;
    border-top: 1px solid var(--border-primary);
  }

  .btn-cancel {
    padding: 8px 16px;
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--fs-base);
    cursor: pointer;
  }
  .btn-cancel:hover {
    border-color: var(--text-secondary);
  }

  .btn-create {
    padding: 8px 20px;
    border: 1px solid var(--accent-primary);
    border-radius: var(--radius-sm);
    background: var(--accent-primary);
    color: var(--text-on-accent, #000);
    font-size: var(--fs-base);
    font-weight: 600;
    cursor: pointer;
  }
  .btn-create:hover {
    opacity: 0.9;
  }
</style>
