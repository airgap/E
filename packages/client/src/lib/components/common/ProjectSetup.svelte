<script lang="ts">
  import { uiStore } from '$lib/stores/ui.svelte';
  import { workspaceListStore } from '$lib/stores/projects.svelte';
  import { api } from '$lib/api/client';

  let name = $state('');
  let path = $state('');
  let error = $state('');
  let dirOptions = $state<{ name: string; path: string }[]>([]);
  let showDirPicker = $state(false);
  let browsedPath = $state('');

  async function browseDirectories(parentPath?: string) {
    try {
      const res = await api.files.directories(parentPath);
      browsedPath = res.data.parent;
      dirOptions = res.data.directories;
      showDirPicker = true;
    } catch {}
  }

  function selectPath(selectedPath: string) {
    path = selectedPath;
    if (!name) {
      name = selectedPath.split('/').pop() || '';
    }
    showDirPicker = false;
  }

  async function create() {
    error = '';
    if (!name.trim() || !path.trim()) {
      error = 'Name and path are required';
      return;
    }
    try {
      await workspaceListStore.createWorkspace(name.trim(), path.trim());
      close();
    } catch (e: any) {
      error = e.message || 'Failed to create workspace';
    }
  }

  function close() {
    name = '';
    path = '';
    error = '';
    showDirPicker = false;
    uiStore.closeModal();
  }
</script>

{#if uiStore.activeModal === 'workspace-setup'}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-overlay" onclick={close}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="modal" onclick={(e) => e.stopPropagation()}>
      <div class="modal-header">
        <h2>New Workspace</h2>
        <button class="close-btn" onclick={close}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div class="modal-body">
        <div class="field">
          <label class="field-label">Workspace name</label>
          <input bind:value={name} placeholder="My Workspace" class="field-input" />
        </div>

        <div class="field">
          <label class="field-label">Directory</label>
          <div class="path-row">
            <input bind:value={path} placeholder="/path/to/workspace" class="field-input" />
            <button class="browse-btn" onclick={() => browseDirectories(path || undefined)}>
              Browse
            </button>
          </div>
        </div>

        {#if showDirPicker}
          <div class="dir-picker">
            <div class="dir-picker-path">{browsedPath}</div>
            {#if browsedPath !== '/'}
              <button
                class="dir-option"
                onclick={() =>
                  browseDirectories(browsedPath.split('/').slice(0, -1).join('/') || '/')}
                >..</button
              >
            {/if}
            <button class="dir-option dir-select" onclick={() => selectPath(browsedPath)}>
              Select this directory
            </button>
            {#each dirOptions as dir}
              <button class="dir-option" onclick={() => browseDirectories(dir.path)}>
                {dir.name}/
              </button>
            {/each}
          </div>
        {/if}

        {#if error}
          <div class="error">{error}</div>
        {/if}
      </div>

      <div class="modal-footer">
        <button class="btn-cancel" onclick={close}>Cancel</button>
        <button class="btn-create" onclick={create}>Create Workspace</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .modal {
    width: 460px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-primary);
  }
  .modal-header h2 {
    font-size: var(--fs-lg);
    font-weight: 700;
    margin: 0;
  }

  .close-btn {
    color: var(--text-tertiary);
    padding: 4px;
    border-radius: var(--radius-sm);
    transition: all var(--transition);
  }
  .close-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .modal-body {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .field-label {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .field-input {
    width: 100%;
  }

  .path-row {
    display: flex;
    gap: 8px;
  }
  .path-row .field-input {
    flex: 1;
  }
  .browse-btn {
    padding: 8px 16px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    font-size: var(--fs-base);
    transition: all var(--transition);
  }
  .browse-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .dir-picker {
    max-height: 200px;
    overflow-y: auto;
    background: var(--bg-secondary);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    padding: 4px;
  }
  .dir-picker-path {
    padding: 6px 10px;
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    border-bottom: 1px solid var(--border-secondary);
    margin-bottom: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dir-option {
    display: block;
    width: 100%;
    text-align: left;
    padding: 6px 10px;
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
    transition: all var(--transition);
  }
  .dir-option:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .dir-option.dir-select {
    color: var(--accent-primary);
    font-weight: 600;
  }

  .error {
    color: var(--accent-error);
    font-size: var(--fs-sm);
    padding: 8px;
    background: rgba(255, 51, 68, 0.05);
    border: 1px solid rgba(255, 51, 68, 0.2);
    border-radius: var(--radius-sm);
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 16px 20px;
    border-top: 1px solid var(--border-primary);
  }
  .btn-cancel {
    padding: 8px 16px;
    font-size: var(--fs-base);
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
    transition: all var(--transition);
  }
  .btn-cancel:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .btn-create {
    padding: 8px 20px;
    font-size: var(--fs-base);
    background: var(--accent-primary);
    color: var(--text-on-accent);
    border-radius: var(--radius-sm);
    font-weight: 700;
    transition: all var(--transition);
  }
  .btn-create:hover {
    opacity: 0.9;
    box-shadow: var(--shadow-glow-sm);
  }
</style>
