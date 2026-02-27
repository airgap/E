<script lang="ts">
  import { uiStore } from '$lib/stores/ui.svelte';
  import { workStore } from '$lib/stores/work.svelte';
  import { workspaceStore } from '$lib/stores/workspace.svelte';
  import { api } from '$lib/api/client';

  type Provider = 'jira' | 'linear' | 'asana';
  type Step = 'config' | 'projects' | 'import';

  let activeProvider = $state<Provider>('jira');
  let step = $state<Step>('config');
  let testing = $state(false);
  let connectionStatus = $state<'idle' | 'success' | 'error'>('idle');
  let connectionError = $state('');
  let importing = $state(false);
  let importResult = $state<{ imported: number; skipped: number; errors: string[] } | null>(null);

  // Config fields
  let jiraBaseUrl = $state('');
  let jiraEmail = $state('');
  let jiraApiToken = $state('');

  let linearApiKey = $state('');

  let asanaToken = $state('');
  let asanaWorkspaceGid = $state('');

  // Projects
  let projects = $state<any[]>([]);
  let selectedProjectKey = $state('');
  let loadingProjects = $state(false);

  // Issues
  let issues = $state<any[]>([]);
  let selectedIssueIds = $state<Set<string>>(new Set());
  let loadingIssues = $state(false);
  let selectAll = $state(true);

  function close() {
    uiStore.closeModal();
  }

  async function testConnection() {
    testing = true;
    connectionStatus = 'idle';

    // Save config first
    const config = getConfigForProvider();
    if (!config) {
      connectionStatus = 'error';
      connectionError = 'Please fill in all required fields';
      testing = false;
      return;
    }

    try {
      await api.external.saveConfig(config);
      const res = await api.external.testConnection(activeProvider);
      if (res.ok && res.data.connected) {
        connectionStatus = 'success';
        connectionError = '';
      } else {
        connectionStatus = 'error';
        connectionError = res.data?.error || 'Connection failed';
      }
    } catch (err) {
      connectionStatus = 'error';
      connectionError = String(err);
    } finally {
      testing = false;
    }
  }

  function getConfigForProvider() {
    switch (activeProvider) {
      case 'jira':
        if (!jiraBaseUrl || !jiraEmail || !jiraApiToken) return null;
        return {
          provider: 'jira' as const,
          apiKey: jiraApiToken,
          email: jiraEmail,
          baseUrl: jiraBaseUrl.replace(/\/$/, ''),
        };
      case 'linear':
        if (!linearApiKey) return null;
        return { provider: 'linear' as const, apiKey: linearApiKey };
      case 'asana':
        if (!asanaToken) return null;
        return {
          provider: 'asana' as const,
          apiKey: asanaToken,
          workspaceGid: asanaWorkspaceGid || undefined,
        };
      default:
        return null;
    }
  }

  async function loadProjects() {
    loadingProjects = true;
    try {
      const res = await api.external.listProjects(activeProvider);
      if (res.ok) {
        projects = res.data;
        step = 'projects';
      }
    } catch (err) {
      connectionError = `Failed to load projects: ${String(err)}`;
    } finally {
      loadingProjects = false;
    }
  }

  async function loadIssues() {
    if (!selectedProjectKey) return;
    loadingIssues = true;
    try {
      const res = await api.external.listIssues(activeProvider, selectedProjectKey);
      if (res.ok) {
        issues = res.data;
        selectedIssueIds = new Set(issues.map((i: any) => i.externalId));
        selectAll = true;
        step = 'import';
      }
    } catch (err) {
      connectionError = `Failed to load issues: ${String(err)}`;
    } finally {
      loadingIssues = false;
    }
  }

  function toggleIssue(externalId: string) {
    const newSet = new Set(selectedIssueIds);
    if (newSet.has(externalId)) {
      newSet.delete(externalId);
    } else {
      newSet.add(externalId);
    }
    selectedIssueIds = newSet;
    selectAll = newSet.size === issues.length;
  }

  function toggleSelectAll() {
    if (selectAll) {
      selectedIssueIds = new Set();
      selectAll = false;
    } else {
      selectedIssueIds = new Set(issues.map((i: any) => i.externalId));
      selectAll = true;
    }
  }

  async function importSelected() {
    const workspacePath = workspaceStore.activeWorkspace?.workspacePath;
    if (!workspacePath) return;

    importing = true;
    importResult = null;
    try {
      const ids = Array.from(selectedIssueIds);
      const res = await workStore.importExternalIssues(
        activeProvider,
        selectedProjectKey,
        workspacePath,
        ids.length < issues.length ? ids : undefined,
      );
      if (res.ok) {
        importResult = res.data;
      }
    } catch (err) {
      importResult = { imported: 0, skipped: 0, errors: [String(err)] };
    } finally {
      importing = false;
    }
  }

  function providerLabel(p: Provider): string {
    return p === 'jira' ? 'Jira' : p === 'linear' ? 'Linear' : 'Asana';
  }

  function statusBadge(cat: string): string {
    return cat === 'done' ? 'done' : cat === 'in_progress' ? 'progress' : 'todo';
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-overlay" onclick={close}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal" onclick={(e) => e.stopPropagation()}>
    <div class="modal-header">
      <h2>Import from External Provider</h2>
      <button class="close-btn" onclick={close}>x</button>
    </div>

    <!-- Provider tabs -->
    <div class="provider-tabs">
      {#each ['jira', 'linear', 'asana'] as Provider[] as p}
        <button
          class="provider-tab"
          class:active={activeProvider === p}
          onclick={() => {
            activeProvider = p;
            step = 'config';
            connectionStatus = 'idle';
          }}
        >
          {providerLabel(p)}
        </button>
      {/each}
    </div>

    <div class="modal-body">
      {#if step === 'config'}
        <!-- Configuration step -->
        <div class="config-form">
          {#if activeProvider === 'jira'}
            <label class="field">
              <span>Instance URL</span>
              <input
                type="url"
                bind:value={jiraBaseUrl}
                placeholder="https://myorg.atlassian.net"
              />
            </label>
            <label class="field">
              <span>Email</span>
              <input type="email" bind:value={jiraEmail} placeholder="you@company.com" />
            </label>
            <label class="field">
              <span>API Token</span>
              <input
                type="password"
                bind:value={jiraApiToken}
                placeholder="API token from Atlassian"
              />
            </label>
          {:else if activeProvider === 'linear'}
            <label class="field">
              <span>API Key</span>
              <input type="password" bind:value={linearApiKey} placeholder="lin_api_..." />
            </label>
          {:else}
            <label class="field">
              <span>Personal Access Token</span>
              <input type="password" bind:value={asanaToken} placeholder="Asana PAT" />
            </label>
            <label class="field">
              <span>Workspace GID (optional)</span>
              <input type="text" bind:value={asanaWorkspaceGid} placeholder="1234567890" />
            </label>
          {/if}

          <div class="actions">
            <button class="btn-primary" onclick={testConnection} disabled={testing}>
              {testing ? 'Testing...' : 'Test Connection'}
            </button>
            {#if connectionStatus === 'success'}
              <button class="btn-primary" onclick={loadProjects} disabled={loadingProjects}>
                {loadingProjects ? 'Loading...' : 'Browse Projects'}
              </button>
            {/if}
          </div>

          {#if connectionStatus === 'success'}
            <div class="status success">Connected</div>
          {:else if connectionStatus === 'error'}
            <div class="status error">{connectionError}</div>
          {/if}
        </div>
      {:else if step === 'projects'}
        <!-- Project selection step -->
        <div class="project-list">
          <h3>Select a project</h3>
          {#each projects as project}
            <button
              class="project-item"
              class:selected={selectedProjectKey === project.id}
              onclick={() => {
                selectedProjectKey = project.id;
              }}
            >
              <span class="project-name">{project.name}</span>
              <span class="project-key">{project.id}</span>
              {#if project.issueCount != null}
                <span class="project-count">{project.issueCount} issues</span>
              {/if}
            </button>
          {:else}
            <div class="empty">No projects found</div>
          {/each}
        </div>

        <div class="actions">
          <button
            class="btn-secondary"
            onclick={() => {
              step = 'config';
            }}>Back</button
          >
          <button
            class="btn-primary"
            onclick={loadIssues}
            disabled={!selectedProjectKey || loadingIssues}
          >
            {loadingIssues ? 'Loading Issues...' : 'Load Issues'}
          </button>
        </div>
      {:else if step === 'import'}
        <!-- Issue selection + import step -->
        <div class="issue-list">
          <div class="issue-header">
            <label class="select-all">
              <input type="checkbox" checked={selectAll} onchange={toggleSelectAll} />
              <span>Select all ({issues.length} issues)</span>
            </label>
            <span class="selected-count">{selectedIssueIds.size} selected</span>
          </div>

          <div class="issue-scroll">
            {#each issues as issue}
              <label class="issue-item">
                <input
                  type="checkbox"
                  checked={selectedIssueIds.has(issue.externalId)}
                  onchange={() => toggleIssue(issue.externalId)}
                />
                <span class="issue-id">{issue.externalId}</span>
                <span class="issue-title">{issue.title}</span>
                <span class="issue-status {statusBadge(issue.statusCategory)}">
                  {issue.status}
                </span>
                <span class="issue-priority">{issue.priorityNormalized}</span>
              </label>
            {:else}
              <div class="empty">No open issues found</div>
            {/each}
          </div>
        </div>

        <div class="actions">
          <button
            class="btn-secondary"
            onclick={() => {
              step = 'projects';
            }}>Back</button
          >
          <button
            class="btn-primary"
            onclick={importSelected}
            disabled={importing || selectedIssueIds.size === 0}
          >
            {importing ? 'Importing...' : `Import ${selectedIssueIds.size} Issues`}
          </button>
        </div>

        {#if importResult}
          <div class="import-result">
            <div class="status success">
              Imported {importResult.imported} issue(s).
              {#if importResult.skipped > 0}
                Skipped {importResult.skipped} (already imported).
              {/if}
            </div>
            {#if importResult.errors.length > 0}
              <div class="status error">
                {importResult.errors.join(', ')}
              </div>
            {/if}
          </div>
        {/if}
      {/if}
    </div>
  </div>
</div>

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 10vh;
    z-index: 1000;
  }

  .modal {
    background: var(--bg-elevated);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-lg);
    width: 560px;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    box-shadow: var(--shadow-lg);
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px;
    border-bottom: 1px solid var(--border-primary);
  }
  .modal-header h2 {
    font-size: var(--fs-md);
    font-weight: 600;
    color: var(--text-primary);
  }
  .close-btn {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    font-size: var(--fs-md);
    color: var(--text-tertiary);
  }
  .close-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .provider-tabs {
    display: flex;
    border-bottom: 1px solid var(--border-primary);
  }
  .provider-tab {
    flex: 1;
    padding: 10px;
    font-size: var(--fs-base);
    font-weight: 500;
    text-align: center;
    color: var(--text-secondary);
    border-bottom: 2px solid transparent;
    transition: all var(--transition);
  }
  .provider-tab:hover {
    background: var(--bg-hover);
  }
  .provider-tab.active {
    color: var(--accent-primary);
    border-bottom-color: var(--accent-primary);
  }

  .modal-body {
    padding: 16px;
    overflow-y: auto;
    flex: 1;
  }

  .config-form {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .field span {
    font-size: var(--fs-sm);
    font-weight: 500;
    color: var(--text-secondary);
  }
  .field input {
    padding: 8px 10px;
    font-size: var(--fs-base);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    background: var(--bg-primary);
    color: var(--text-primary);
  }
  .field input:focus {
    border-color: var(--accent-primary);
    outline: none;
  }

  .actions {
    display: flex;
    gap: 8px;
    padding-top: 12px;
  }

  .btn-primary,
  .btn-secondary {
    padding: 8px 16px;
    font-size: var(--fs-base);
    border-radius: var(--radius-sm);
    font-weight: 500;
    cursor: pointer;
  }
  .btn-primary {
    background: var(--accent-primary);
    color: var(--text-on-accent);
  }
  .btn-primary:hover:not(:disabled) {
    opacity: 0.9;
  }
  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn-secondary {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }
  .btn-secondary:hover {
    background: var(--bg-hover);
  }

  .status {
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    font-size: var(--fs-sm);
    margin-top: 8px;
  }
  .status.success {
    background: color-mix(in srgb, var(--accent-secondary) 15%, transparent);
    color: var(--accent-secondary);
  }
  .status.error {
    background: color-mix(in srgb, var(--accent-error) 15%, transparent);
    color: var(--accent-error);
  }

  .project-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .project-list h3 {
    font-size: var(--fs-base);
    font-weight: 600;
    margin-bottom: 8px;
    color: var(--text-primary);
  }
  .project-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    text-align: left;
    font-size: var(--fs-base);
    color: var(--text-primary);
    transition: background var(--transition);
  }
  .project-item:hover {
    background: var(--bg-hover);
  }
  .project-item.selected {
    background: color-mix(in srgb, var(--accent-primary) 15%, transparent);
    border: 1px solid var(--accent-primary);
  }
  .project-name {
    flex: 1;
  }
  .project-key {
    font-size: var(--fs-xs);
    padding: 1px 6px;
    background: var(--bg-tertiary);
    border-radius: 3px;
    color: var(--text-tertiary);
    font-family: var(--font-mono, monospace);
  }
  .project-count {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
  }

  .issue-list {
    display: flex;
    flex-direction: column;
  }
  .issue-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border-primary);
    margin-bottom: 8px;
  }
  .select-all {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    cursor: pointer;
  }
  .selected-count {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
  }

  .issue-scroll {
    max-height: 300px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .issue-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 4px;
    border-radius: var(--radius-sm);
    font-size: var(--fs-sm);
    cursor: pointer;
  }
  .issue-item:hover {
    background: var(--bg-hover);
  }
  .issue-id {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    font-family: var(--font-mono, monospace);
    min-width: 70px;
  }
  .issue-title {
    flex: 1;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .issue-status {
    font-size: var(--fs-xxs);
    padding: 1px 6px;
    border-radius: 3px;
  }
  .issue-status.todo {
    background: var(--bg-tertiary);
    color: var(--text-tertiary);
  }
  .issue-status.progress {
    background: color-mix(in srgb, var(--accent-primary) 15%, transparent);
    color: var(--accent-primary);
  }
  .issue-status.done {
    background: color-mix(in srgb, var(--accent-secondary) 15%, transparent);
    color: var(--accent-secondary);
  }
  .issue-priority {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    min-width: 40px;
    text-align: right;
  }

  .import-result {
    margin-top: 12px;
  }

  .empty {
    padding: 16px;
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--fs-base);
  }
</style>
