<script lang="ts">
  import { webhooksApi } from '$lib/api/webhooks';
  import { workspaceStore } from '$lib/stores/workspace.svelte';
  import { profilesStore } from '$lib/stores/profiles.svelte';
  import { onMount } from 'svelte';
  import type {
    WebhookWithStats,
    WebhookExecution,
    WebhookAuthMethod,
    AgentProfile,
  } from '@e/shared';

  // ─── State ──────────────────────────────────────────────────────────────────

  let webhooks = $state<WebhookWithStats[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let successMsg = $state<string | null>(null);

  // Create / edit form
  let showForm = $state(false);
  let editingId = $state<string | null>(null);
  let formName = $state('');
  let formDescription = $state('');
  let formAuthMethod = $state<WebhookAuthMethod>('bearer');
  let formPromptTemplate = $state('');
  let formProfileId = $state('');
  let formMaxPerMinute = $state(10);
  let formSaving = $state(false);

  // Webhook history
  let showHistory = $state<string | null>(null);
  let executions = $state<WebhookExecution[]>([]);
  let historyLoading = $state(false);

  // Secret reveal
  let revealedSecrets = $state<Record<string, string>>({});

  // Profiles
  let profiles = $state<AgentProfile[]>([]);

  // ─── Derived ────────────────────────────────────────────────────────────────

  let workspaceId = $derived(workspaceStore.activeWorkspace?.workspaceId || '');
  let serverBase = $derived(
    typeof window !== 'undefined' ? `${window.location.origin}` : 'http://localhost:3002',
  );

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  onMount(() => {
    if (workspaceId) {
      loadWebhooks();
    }
    loadProfiles();
  });

  // ─── API calls ──────────────────────────────────────────────────────────────

  async function loadWebhooks() {
    if (!workspaceId) return;
    loading = true;
    error = null;
    try {
      webhooks = await webhooksApi.list(workspaceId);
    } catch (e: any) {
      error = e?.message ?? 'Failed to load webhooks';
    } finally {
      loading = false;
    }
  }

  async function loadProfiles() {
    try {
      const list = profilesStore.profiles;
      profiles = list;
    } catch {
      // Profiles are optional
    }
  }

  async function saveWebhook() {
    formSaving = true;
    error = null;
    successMsg = null;
    try {
      if (editingId) {
        await webhooksApi.update(editingId, {
          name: formName,
          description: formDescription,
          authMethod: formAuthMethod,
          promptTemplate: formPromptTemplate,
          profileId: formProfileId || undefined,
          maxPerMinute: formMaxPerMinute,
        });
        successMsg = 'Webhook updated';
      } else {
        const result = await webhooksApi.create({
          workspaceId,
          name: formName,
          description: formDescription,
          authMethod: formAuthMethod,
          promptTemplate: formPromptTemplate,
          profileId: formProfileId || undefined,
          maxPerMinute: formMaxPerMinute,
        });
        // Show the secret on creation
        if (result.secret) {
          revealedSecrets[result.id] = result.secret;
        }
        successMsg = 'Webhook created! Copy the secret — it will be hidden after refresh.';
      }
      resetForm();
      await loadWebhooks();
    } catch (e: any) {
      error = e?.message ?? 'Failed to save webhook';
    } finally {
      formSaving = false;
    }
  }

  async function deleteWebhook(id: string) {
    if (!confirm('Delete this webhook? This cannot be undone.')) return;
    error = null;
    try {
      await webhooksApi.delete(id);
      await loadWebhooks();
    } catch (e: any) {
      error = e?.message ?? 'Failed to delete webhook';
    }
  }

  async function toggleWebhook(wh: WebhookWithStats) {
    try {
      await webhooksApi.update(wh.id, {
        status: wh.status === 'enabled' ? 'disabled' : 'enabled',
      });
      await loadWebhooks();
    } catch (e: any) {
      error = e?.message ?? 'Failed to toggle webhook';
    }
  }

  async function testWebhook(id: string) {
    error = null;
    successMsg = null;
    try {
      const result = await webhooksApi.test(id);
      successMsg = `Test triggered (execution: ${result.executionId})`;
      // Refresh to show the execution
      await loadWebhooks();
      if (showHistory === id) {
        await loadHistory(id);
      }
    } catch (e: any) {
      error = e?.message ?? 'Test failed';
    }
  }

  async function revealSecret(id: string) {
    try {
      const secret = await webhooksApi.getSecret(id);
      revealedSecrets = { ...revealedSecrets, [id]: secret };
    } catch (e: any) {
      error = e?.message ?? 'Failed to reveal secret';
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

  async function regenerateSecret(id: string) {
    if (!confirm('Regenerate secret? The old secret will stop working immediately.')) return;
    try {
      await webhooksApi.update(id, { regenerateSecret: true });
      // Reveal the new secret
      const secret = await webhooksApi.getSecret(id);
      revealedSecrets = { ...revealedSecrets, [id]: secret };
      successMsg = 'Secret regenerated. Copy the new secret.';
      await loadWebhooks();
    } catch (e: any) {
      error = e?.message ?? 'Failed to regenerate secret';
    }
  }

  async function loadHistory(webhookId: string) {
    historyLoading = true;
    try {
      executions = await webhooksApi.getExecutions(webhookId, 20);
    } catch (e: any) {
      error = e?.message ?? 'Failed to load history';
    } finally {
      historyLoading = false;
    }
  }

  // ─── Form helpers ───────────────────────────────────────────────────────────

  function startCreate() {
    resetForm();
    formPromptTemplate =
      'A webhook event was received. Here is the payload:\n\n```json\n{{payload}}\n```\n\nPlease analyze this event and take appropriate action.';
    showForm = true;
  }

  function startEdit(wh: WebhookWithStats) {
    editingId = wh.id;
    formName = wh.name;
    formDescription = wh.description;
    formAuthMethod = wh.authMethod;
    formPromptTemplate = wh.promptTemplate;
    formProfileId = wh.profileId || '';
    formMaxPerMinute = wh.maxPerMinute;
    showForm = true;
  }

  function resetForm() {
    editingId = null;
    formName = '';
    formDescription = '';
    formAuthMethod = 'bearer';
    formPromptTemplate = '';
    formProfileId = '';
    formMaxPerMinute = 10;
    showForm = false;
  }

  function toggleHistory(webhookId: string) {
    if (showHistory === webhookId) {
      showHistory = null;
      executions = [];
    } else {
      showHistory = webhookId;
      loadHistory(webhookId);
    }
  }

  function formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleString();
  }

  function formatDuration(ms: number | undefined): string {
    if (!ms) return '—';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }
</script>

<div class="webhook-settings">
  {#if error}
    <div class="alert error">{error}</div>
  {/if}
  {#if successMsg}
    <div class="alert success">{successMsg}</div>
  {/if}

  {#if !workspaceId}
    <div class="empty-state">
      <p>Select a workspace to configure webhooks.</p>
    </div>
  {:else if showForm}
    <!-- Create / Edit Form -->
    <div class="form-section">
      <h3>{editingId ? 'Edit Webhook' : 'Create Webhook'}</h3>

      <label class="form-field">
        <span class="label">Name</span>
        <input type="text" bind:value={formName} placeholder="e.g. GitHub Push Handler" />
      </label>

      <label class="form-field">
        <span class="label">Description</span>
        <input type="text" bind:value={formDescription} placeholder="Optional description" />
      </label>

      <label class="form-field">
        <span class="label">Authentication Method</span>
        <select bind:value={formAuthMethod}>
          <option value="bearer">Bearer Token</option>
          <option value="hmac-sha256">HMAC-SHA256 Signature</option>
        </select>
      </label>

      <label class="form-field">
        <span class="label">Agent Profile (optional)</span>
        <select bind:value={formProfileId}>
          <option value="">Default (no profile)</option>
          {#each profiles as profile}
            <option value={profile.id}>{profile.name}</option>
          {/each}
        </select>
      </label>

      <label class="form-field">
        <span class="label">Rate Limit (max per minute)</span>
        <input type="number" bind:value={formMaxPerMinute} min="1" max="100" />
      </label>

      <div class="form-field">
        <span class="label">
          Prompt Template
          <span class="hint">Use {'{{payload}}'} to inject the webhook payload</span>
        </span>
        <textarea
          bind:value={formPromptTemplate}
          rows="8"
          placeholder="Describe what the agent should do with the webhook payload. Use double curly braces around 'payload' to inject the JSON data."
        ></textarea>
      </div>

      <div class="form-actions">
        <button class="btn secondary" onclick={resetForm}>Cancel</button>
        <button
          class="btn primary"
          onclick={saveWebhook}
          disabled={formSaving || !formName || !formPromptTemplate}
        >
          {formSaving ? 'Saving...' : editingId ? 'Update' : 'Create'}
        </button>
      </div>
    </div>
  {:else}
    <!-- Webhook List -->
    <div class="header-row">
      <h3>Webhooks</h3>
      <button class="btn primary small" onclick={startCreate}>+ New Webhook</button>
    </div>

    {#if loading}
      <div class="empty-state">Loading webhooks...</div>
    {:else if webhooks.length === 0}
      <div class="empty-state">
        <p>No webhooks configured.</p>
        <p class="hint">
          Webhooks let external services (GitHub, CI/CD, etc.) trigger agent actions automatically.
        </p>
      </div>
    {:else}
      <div class="webhook-list">
        {#each webhooks as wh (wh.id)}
          <div class="webhook-card" class:disabled={wh.status === 'disabled'}>
            <div class="card-header">
              <div class="card-title-row">
                <span class="webhook-name">{wh.name}</span>
                <div class="card-controls">
                  <button
                    class="icon-btn"
                    title={wh.status === 'enabled' ? 'Disable' : 'Enable'}
                    onclick={() => toggleWebhook(wh)}
                  >
                    {#if wh.status === 'enabled'}
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                      >
                        <path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path>
                        <line x1="12" y1="2" x2="12" y2="12"></line>
                      </svg>
                    {:else}
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                      >
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="15" y1="9" x2="9" y2="15"></line>
                        <line x1="9" y1="9" x2="15" y2="15"></line>
                      </svg>
                    {/if}
                  </button>
                  <button class="icon-btn" title="Test" onclick={() => testWebhook(wh.id)}>
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <polygon points="5 3 19 12 5 21 5 3"></polygon>
                    </svg>
                  </button>
                  <button class="icon-btn" title="Edit" onclick={() => startEdit(wh)}>
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                  </button>
                  <button
                    class="icon-btn danger"
                    title="Delete"
                    onclick={() => deleteWebhook(wh.id)}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <polyline points="3 6 5 6 21 6"></polyline>
                      <path
                        d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
                      ></path>
                    </svg>
                  </button>
                </div>
              </div>
              {#if wh.description}
                <div class="webhook-desc">{wh.description}</div>
              {/if}
            </div>

            <div class="card-details">
              <div class="detail-row">
                <span class="detail-label">URL:</span>
                <code class="detail-url">{serverBase}/api/webhooks/inbound/{wh.id}</code>
                <button
                  class="copy-btn"
                  onclick={() => copyToClipboard(`${serverBase}/api/webhooks/inbound/${wh.id}`)}
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

              <div class="detail-row">
                <span class="detail-label">Auth:</span>
                <span class="badge">{wh.authMethod}</span>
                <span class="detail-label" style="margin-left: 8px;">Secret:</span>
                {#if revealedSecrets[wh.id]}
                  <code class="secret-value">{revealedSecrets[wh.id]}</code>
                  <button
                    class="copy-btn"
                    onclick={() => copyToClipboard(revealedSecrets[wh.id])}
                    title="Copy secret"
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
                {:else}
                  <code class="secret-masked">{wh.secret}</code>
                  <button
                    class="copy-btn"
                    onclick={() => revealSecret(wh.id)}
                    title="Reveal secret"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                      <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                  </button>
                {/if}
                <button
                  class="copy-btn"
                  onclick={() => regenerateSecret(wh.id)}
                  title="Regenerate secret"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <polyline points="23 4 23 10 17 10"></polyline>
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                  </svg>
                </button>
              </div>

              <div class="detail-row">
                <span class="detail-label">Rate limit:</span>
                <span>{wh.maxPerMinute}/min</span>
                <span class="detail-label" style="margin-left: 8px;">Status:</span>
                <span
                  class="badge"
                  class:badge-enabled={wh.status === 'enabled'}
                  class:badge-disabled={wh.status === 'disabled'}
                >
                  {wh.status}
                </span>
              </div>
            </div>

            <!-- Stats row -->
            {#if wh.totalExecutions > 0}
              <div class="stats-row">
                <span class="stat"
                  >{wh.totalExecutions} invocation{wh.totalExecutions !== 1 ? 's' : ''}</span
                >
                <span class="stat">{wh.successfulExecutions} success</span>
                <span class="stat">{wh.failedExecutions} failed</span>
                {#if wh.averageResponseTimeMs}
                  <span class="stat">avg {formatDuration(wh.averageResponseTimeMs)}</span>
                {/if}
                {#if wh.lastExecutionStatus}
                  <span
                    class="stat-badge"
                    class:success={wh.lastExecutionStatus === 'success'}
                    class:failed={wh.lastExecutionStatus === 'failed'}
                    class:rate_limited={wh.lastExecutionStatus === 'rate_limited'}
                  >
                    last: {wh.lastExecutionStatus}
                  </span>
                {/if}
              </div>
            {/if}

            <!-- History toggle -->
            <button class="history-toggle" onclick={() => toggleHistory(wh.id)}>
              {showHistory === wh.id ? 'Hide' : 'Show'} History
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                class:rotated={showHistory === wh.id}
              >
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </button>

            {#if showHistory === wh.id}
              <div class="history-section">
                {#if historyLoading}
                  <div class="loading-msg">Loading history...</div>
                {:else if executions.length === 0}
                  <div class="empty-msg">No invocations yet</div>
                {:else}
                  <table class="history-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Status</th>
                        <th>Payload</th>
                        <th>Duration</th>
                        <th>Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each executions as exec (exec.id)}
                        <tr>
                          <td class="mono">{formatTime(exec.startedAt)}</td>
                          <td>
                            <span
                              class="status-dot"
                              class:success={exec.status === 'success'}
                              class:failed={exec.status === 'failed'}
                              class:running={exec.status === 'running'}
                              class:rate_limited={exec.status === 'rate_limited'}
                            ></span>
                            {exec.status}
                          </td>
                          <td>{formatBytes(exec.payloadSize)}</td>
                          <td>{formatDuration(exec.responseTimeMs)}</td>
                          <td class="source-cell" title={exec.source || ''}
                            >{exec.source ? exec.source.slice(0, 30) : '—'}</td
                          >
                        </tr>
                        {#if exec.errorMessage}
                          <tr class="error-row">
                            <td colspan="5" class="error-msg">{exec.errorMessage}</td>
                          </tr>
                        {/if}
                      {/each}
                    </tbody>
                  </table>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .webhook-settings {
    display: flex;
    flex-direction: column;
    gap: 12px;
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

  .empty-state {
    text-align: center;
    padding: 24px;
    color: var(--text-secondary);
    font-size: 13px;
  }

  .empty-state .hint {
    font-size: 12px;
    color: var(--text-tertiary);
    margin-top: 4px;
  }

  .header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .header-row h3 {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }

  /* --- Buttons --- */

  .btn {
    padding: 6px 14px;
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

  .btn.primary:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  .btn.primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
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

  .icon-btn {
    padding: 4px;
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
  }

  .icon-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .icon-btn.danger:hover {
    color: var(--accent-error);
  }

  .copy-btn {
    padding: 2px 4px;
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

  /* --- Form --- */

  .form-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .form-section h3 {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }

  .form-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .form-field .label {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .form-field .hint {
    font-size: 11px;
    color: var(--text-tertiary);
    font-weight: normal;
    margin-left: 6px;
  }

  .form-field input,
  .form-field select,
  .form-field textarea {
    padding: 6px 10px;
    border: 1px solid var(--border-primary);
    border-radius: 6px;
    background: var(--bg-primary);
    color: var(--text-primary);
    font-size: 13px;
    font-family: inherit;
  }

  .form-field textarea {
    font-family: var(--font-mono);
    font-size: 12px;
    resize: vertical;
    min-height: 80px;
  }

  .form-field input:focus,
  .form-field select:focus,
  .form-field textarea:focus {
    outline: none;
    border-color: var(--accent-primary);
  }

  .form-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    padding-top: 8px;
  }

  /* --- Webhook Cards --- */

  .webhook-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .webhook-card {
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: 8px;
    overflow: hidden;
  }

  .webhook-card.disabled {
    opacity: 0.6;
  }

  .card-header {
    padding: 10px 12px 6px;
  }

  .card-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .webhook-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .card-controls {
    display: flex;
    gap: 4px;
  }

  .webhook-desc {
    font-size: 12px;
    color: var(--text-secondary);
    margin-top: 2px;
  }

  .card-details {
    padding: 6px 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .detail-row {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    flex-wrap: wrap;
  }

  .detail-label {
    color: var(--text-tertiary);
    font-weight: 500;
    white-space: nowrap;
  }

  .detail-url {
    font-family: var(--font-mono);
    font-size: 11px;
    background: var(--bg-primary);
    padding: 2px 6px;
    border-radius: 3px;
    color: var(--text-secondary);
    word-break: break-all;
  }

  .badge {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 3px;
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    text-transform: uppercase;
    font-weight: 600;
  }

  .badge-enabled {
    background: color-mix(in srgb, var(--accent-success, #10b981) 20%, transparent);
    color: var(--accent-success, #10b981);
  }

  .badge-disabled {
    background: color-mix(in srgb, var(--text-tertiary) 20%, transparent);
    color: var(--text-tertiary);
  }

  .secret-value {
    font-family: var(--font-mono);
    font-size: 11px;
    background: var(--bg-primary);
    padding: 2px 6px;
    border-radius: 3px;
    color: var(--accent-primary);
    word-break: break-all;
  }

  .secret-masked {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-tertiary);
  }

  /* --- Stats --- */

  .stats-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 12px;
    font-size: 11px;
    color: var(--text-tertiary);
    border-top: 1px solid var(--border-primary);
    flex-wrap: wrap;
  }

  .stat-badge {
    padding: 1px 6px;
    border-radius: 3px;
    font-weight: 600;
    text-transform: uppercase;
    font-size: 10px;
  }

  .stat-badge.success {
    background: var(--accent-success, #10b981);
    color: white;
  }

  .stat-badge.failed {
    background: var(--accent-error);
    color: white;
  }

  .stat-badge.rate_limited {
    background: var(--accent-warning, #f59e0b);
    color: white;
  }

  /* --- History --- */

  .history-toggle {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 12px;
    font-size: 12px;
    color: var(--text-secondary);
    background: transparent;
    border: none;
    border-top: 1px solid var(--border-primary);
    cursor: pointer;
    width: 100%;
    text-align: left;
    transition: background 0.15s ease;
  }

  .history-toggle:hover {
    background: var(--bg-tertiary);
  }

  .history-toggle svg {
    transition: transform 0.2s ease;
  }

  .history-toggle svg.rotated {
    transform: rotate(180deg);
  }

  .history-section {
    border-top: 1px solid var(--border-primary);
    padding: 8px;
    max-height: 300px;
    overflow-y: auto;
  }

  .loading-msg,
  .empty-msg {
    padding: 12px;
    text-align: center;
    font-size: 12px;
    color: var(--text-tertiary);
  }

  .history-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
  }

  .history-table th {
    text-align: left;
    padding: 4px 8px;
    font-weight: 600;
    color: var(--text-tertiary);
    border-bottom: 1px solid var(--border-primary);
  }

  .history-table td {
    padding: 4px 8px;
    color: var(--text-secondary);
    border-bottom: 1px solid color-mix(in srgb, var(--border-primary) 50%, transparent);
  }

  .mono {
    font-family: var(--font-mono);
    font-size: 10px;
  }

  .source-cell {
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .status-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    margin-right: 4px;
    background: var(--text-tertiary);
  }

  .status-dot.success {
    background: var(--accent-success, #10b981);
  }

  .status-dot.failed {
    background: var(--accent-error);
  }

  .status-dot.running {
    background: var(--accent-primary);
  }

  .status-dot.rate_limited {
    background: var(--accent-warning, #f59e0b);
  }

  .error-row td {
    border-bottom: none;
  }

  .error-msg {
    font-size: 11px;
    color: var(--accent-error);
    padding-top: 0 !important;
    font-family: var(--font-mono);
  }
</style>
