<script lang="ts">
  import { api } from '$lib/api/client';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { onMount } from 'svelte';

  interface CustomTool {
    id: string;
    name: string;
    description: string;
    inputSchema: any;
    handlerType: string;
    handlerCommand: string;
    workspacePath: string | null;
    enabled: boolean;
    createdAt: number;
    updatedAt: number;
  }

  let tools = $state<CustomTool[]>([]);
  let loading = $state(true);
  let saving = $state(false);
  let error = $state<string | null>(null);

  // New tool form
  let showNewForm = $state(false);
  let newName = $state('');
  let newDescription = $state('');
  let newInputSchema = $state('{}');
  let newCommand = $state('');
  let schemaError = $state<string | null>(null);

  // Edit state
  let editingId = $state<string | null>(null);
  let editName = $state('');
  let editDescription = $state('');
  let editInputSchema = $state('{}');
  let editCommand = $state('');
  let editSchemaError = $state<string | null>(null);

  // Test state
  let testingId = $state<string | null>(null);
  let testInput = $state('{}');
  let testResult = $state<{ output: string; exitCode: number; duration: number } | null>(null);
  let testError = $state<string | null>(null);
  let testRunning = $state(false);

  function workspacePath(): string {
    return settingsStore.workspacePath || '';
  }

  onMount(() => {
    loadTools();
  });

  async function loadTools() {
    loading = true;
    error = null;
    try {
      const res = await api.customTools.list(workspacePath() || undefined);
      tools = (res.data ?? []) as CustomTool[];
    } catch (err: any) {
      error = err?.message ?? 'Failed to load tools';
    } finally {
      loading = false;
    }
  }

  function formatSchema() {
    try {
      const parsed = JSON.parse(newInputSchema);
      newInputSchema = JSON.stringify(parsed, null, 2);
      schemaError = null;
    } catch {
      schemaError = 'Invalid JSON';
    }
  }

  function formatEditSchema() {
    try {
      const parsed = JSON.parse(editInputSchema);
      editInputSchema = JSON.stringify(parsed, null, 2);
      editSchemaError = null;
    } catch {
      editSchemaError = 'Invalid JSON';
    }
  }

  async function createTool() {
    schemaError = null;
    let parsedSchema: any = {};
    try {
      parsedSchema = JSON.parse(newInputSchema);
    } catch {
      schemaError = 'Invalid JSON schema';
      return;
    }

    if (!newName.trim()) {
      error = 'Name is required';
      return;
    }
    if (!newDescription.trim()) {
      error = 'Description is required';
      return;
    }
    if (!newCommand.trim()) {
      error = 'Handler command is required';
      return;
    }

    saving = true;
    error = null;
    try {
      await api.customTools.create({
        name: newName.trim(),
        description: newDescription.trim(),
        inputSchema: parsedSchema,
        handlerType: 'shell',
        handlerCommand: newCommand.trim(),
        workspacePath: workspacePath() || undefined,
      });
      newName = '';
      newDescription = '';
      newInputSchema = '{}';
      newCommand = '';
      showNewForm = false;
      await loadTools();
    } catch (err: any) {
      error = err?.message ?? 'Failed to create tool';
    } finally {
      saving = false;
    }
  }

  function startEdit(tool: CustomTool) {
    editingId = tool.id;
    editName = tool.name;
    editDescription = tool.description;
    editInputSchema = JSON.stringify(tool.inputSchema, null, 2);
    editCommand = tool.handlerCommand;
    editSchemaError = null;
    testingId = null;
    testResult = null;
    testError = null;
  }

  function cancelEdit() {
    editingId = null;
    editSchemaError = null;
  }

  async function saveEdit() {
    if (!editingId) return;
    editSchemaError = null;
    let parsedSchema: any = {};
    try {
      parsedSchema = JSON.parse(editInputSchema);
    } catch {
      editSchemaError = 'Invalid JSON schema';
      return;
    }

    saving = true;
    error = null;
    try {
      await api.customTools.update(editingId, {
        name: editName.trim(),
        description: editDescription.trim(),
        inputSchema: parsedSchema,
        handlerCommand: editCommand.trim(),
      });
      editingId = null;
      await loadTools();
    } catch (err: any) {
      error = err?.message ?? 'Failed to update tool';
    } finally {
      saving = false;
    }
  }

  async function toggleEnabled(tool: CustomTool) {
    try {
      await api.customTools.update(tool.id, { enabled: !tool.enabled });
      tools = tools.map((t) => (t.id === tool.id ? { ...t, enabled: !tool.enabled } : t));
    } catch (err: any) {
      error = err?.message ?? 'Failed to update tool';
    }
  }

  async function deleteTool(id: string) {
    if (!confirm('Delete this tool?')) return;
    try {
      await api.customTools.delete(id);
      tools = tools.filter((t) => t.id !== id);
      if (editingId === id) editingId = null;
      if (testingId === id) testingId = null;
    } catch (err: any) {
      error = err?.message ?? 'Failed to delete tool';
    }
  }

  function openTest(id: string) {
    testingId = testingId === id ? null : id;
    testInput = '{}';
    testResult = null;
    testError = null;
    editingId = null;
  }

  async function runTest(id: string) {
    testRunning = true;
    testResult = null;
    testError = null;
    let parsedInput: any = {};
    try {
      parsedInput = JSON.parse(testInput);
    } catch {
      testError = 'Invalid JSON input';
      testRunning = false;
      return;
    }
    try {
      const res = await api.customTools.test(id, parsedInput);
      if (res.ok) {
        testResult = res.data;
      } else {
        testError = 'Test failed';
      }
    } catch (err: any) {
      testError = err?.message ?? 'Test failed';
    } finally {
      testRunning = false;
    }
  }
</script>

<div class="panel">
  <div class="panel-header">
    <span class="panel-title">Custom Tools</span>
    <button
      class="btn-icon"
      onclick={() => {
        showNewForm = !showNewForm;
        editingId = null;
        testingId = null;
      }}
      title={showNewForm ? 'Cancel' : 'New Tool'}
    >
      {showNewForm ? '✕' : '+'}
    </button>
  </div>

  {#if error}
    <div class="error-banner">
      <span>{error}</span>
      <button class="error-dismiss" onclick={() => (error = null)}>✕</button>
    </div>
  {/if}

  <!-- New tool form -->
  {#if showNewForm}
    <div class="form-card">
      <div class="form-title">New Tool</div>
      <label class="field-label">
        Name
        <input
          class="field-input"
          type="text"
          bind:value={newName}
          placeholder="my_tool"
          pattern="[a-zA-Z0-9_]+"
        />
      </label>
      <label class="field-label">
        Description <span class="field-hint">(what Claude sees)</span>
        <textarea
          class="field-textarea"
          bind:value={newDescription}
          placeholder="Describe what this tool does…"
          rows="3"
        ></textarea>
      </label>
      <label class="field-label">
        Input Schema (JSON)
        <div class="schema-wrap">
          <textarea
            class="field-textarea field-mono"
            bind:value={newInputSchema}
            rows="4"
            placeholder="&#123;&#125;"
          ></textarea>
          <button class="btn-xs" onclick={formatSchema}>Format</button>
        </div>
        {#if schemaError}
          <span class="field-error">{schemaError}</span>
        {/if}
      </label>
      <label class="field-label">
        Handler Type
        <input class="field-input field-readonly" type="text" value="shell" readonly />
      </label>
      <label class="field-label">
        Handler Command
        <input
          class="field-input field-mono"
          type="text"
          bind:value={newCommand}
          placeholder="echo $TOOL_INPUT | jq .name"
        />
      </label>
      <div class="form-actions">
        <button class="btn-secondary" onclick={() => (showNewForm = false)}>Cancel</button>
        <button
          class="btn-primary"
          onclick={createTool}
          disabled={saving || !newName.trim() || !newDescription.trim() || !newCommand.trim()}
        >
          {saving ? 'Creating…' : 'Create Tool'}
        </button>
      </div>
    </div>
  {/if}

  <!-- Tool list -->
  {#if loading}
    <div class="loading-row">
      <div class="spinner"></div>
      <span>Loading…</span>
    </div>
  {:else if tools.length === 0 && !showNewForm}
    <div class="empty-state">
      <div class="empty-icon">
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          ><path
            d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
          /></svg
        >
      </div>
      <div class="empty-text">No custom tools yet</div>
      <button class="btn-primary" onclick={() => (showNewForm = true)}
        >Create your first tool</button
      >
    </div>
  {:else}
    <div class="tools-list">
      {#each tools as tool (tool.id)}
        <div class="tool-card" class:tool-card--disabled={!tool.enabled}>
          <!-- Tool header row -->
          <div class="tool-header">
            <div class="tool-header-left">
              <span class="tool-name">{tool.name}</span>
              <span class="tool-handler-type">shell</span>
            </div>
            <div class="tool-actions">
              <!-- Toggle enabled -->
              <button
                class="toggle-btn"
                class:toggle-on={tool.enabled}
                onclick={() => toggleEnabled(tool)}
                title={tool.enabled ? 'Disable' : 'Enable'}
              >
                {tool.enabled ? '●' : '○'}
              </button>
              <button
                class="action-btn"
                onclick={() => openTest(tool.id)}
                title="Test"
                class:action-btn--active={testingId === tool.id}
              >
                ▶
              </button>
              <button
                class="action-btn"
                onclick={() => startEdit(tool)}
                title="Edit"
                class:action-btn--active={editingId === tool.id}
              >
                ✎
              </button>
              <button
                class="action-btn action-btn--danger"
                onclick={() => deleteTool(tool.id)}
                title="Delete"
              >
                ✕
              </button>
            </div>
          </div>

          <!-- Description snippet -->
          <div class="tool-description">{tool.description}</div>

          <!-- Command snippet -->
          <div class="tool-command">
            <code
              >{tool.handlerCommand.length > 60
                ? tool.handlerCommand.slice(0, 57) + '…'
                : tool.handlerCommand}</code
            >
          </div>

          <!-- Edit panel -->
          {#if editingId === tool.id}
            <div class="inline-form">
              <label class="field-label">
                Name
                <input class="field-input" type="text" bind:value={editName} />
              </label>
              <label class="field-label">
                Description
                <textarea class="field-textarea" bind:value={editDescription} rows="3"></textarea>
              </label>
              <label class="field-label">
                Input Schema (JSON)
                <div class="schema-wrap">
                  <textarea class="field-textarea field-mono" bind:value={editInputSchema} rows="4"
                  ></textarea>
                  <button class="btn-xs" onclick={formatEditSchema}>Format</button>
                </div>
                {#if editSchemaError}
                  <span class="field-error">{editSchemaError}</span>
                {/if}
              </label>
              <label class="field-label">
                Handler Command
                <input class="field-input field-mono" type="text" bind:value={editCommand} />
              </label>
              <div class="form-actions">
                <button class="btn-secondary" onclick={cancelEdit}>Cancel</button>
                <button class="btn-primary" onclick={saveEdit} disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          {/if}

          <!-- Test panel -->
          {#if testingId === tool.id}
            <div class="inline-form">
              <label class="field-label">
                Input (JSON)
                <textarea
                  class="field-textarea field-mono"
                  bind:value={testInput}
                  rows="3"
                  placeholder="&#123;&#125;"
                ></textarea>
              </label>
              <div class="form-actions">
                <button
                  class="btn-secondary"
                  onclick={() => {
                    testingId = null;
                    testResult = null;
                    testError = null;
                  }}
                >
                  Close
                </button>
                <button class="btn-primary" onclick={() => runTest(tool.id)} disabled={testRunning}>
                  {testRunning ? 'Running…' : 'Run Test'}
                </button>
              </div>
              {#if testError}
                <div class="test-error">{testError}</div>
              {/if}
              {#if testResult}
                <div class="test-result">
                  <div class="test-result-meta">
                    <span class="test-exit-code" class:test-exit-ok={testResult.exitCode === 0}>
                      exit {testResult.exitCode}
                    </span>
                    <span class="test-duration">{testResult.duration}ms</span>
                  </div>
                  <pre class="test-output">{testResult.output || '(no output)'}</pre>
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border-secondary);
    flex-shrink: 0;
  }

  .panel-title {
    font-size: var(--fs-xs);
    font-weight: 700;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .btn-icon {
    width: 22px;
    height: 22px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-primary);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: var(--fs-md);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all var(--transition);
  }

  .btn-icon:hover {
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }

  .error-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 14px;
    background: color-mix(in srgb, var(--accent-error) 12%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--accent-error) 25%, transparent);
    font-size: var(--fs-sm);
    color: var(--accent-error);
    flex-shrink: 0;
  }

  .error-dismiss {
    background: transparent;
    border: none;
    color: var(--accent-error);
    cursor: pointer;
    font-size: var(--fs-sm);
    padding: 0 2px;
  }

  /* Form card */
  .form-card {
    margin: 12px 14px;
    padding: 14px;
    border: 1px solid var(--border-primary);
    border-radius: var(--radius);
    background: var(--bg-secondary);
    display: flex;
    flex-direction: column;
    gap: 10px;
    flex-shrink: 0;
  }

  .form-title {
    font-size: var(--fs-sm);
    font-weight: 700;
    color: var(--text-primary);
    margin-bottom: 2px;
  }

  /* Inline form inside tool card */
  .inline-form {
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--border-secondary);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* Field styles */
  .field-label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .field-hint {
    font-size: var(--fs-xxs);
    font-weight: 400;
    color: var(--text-tertiary);
    text-transform: none;
    letter-spacing: 0;
  }

  .field-input,
  .field-textarea {
    background: var(--bg-input);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: var(--fs-sm);
    font-family: var(--font-family-sans);
    padding: 6px 8px;
    outline: none;
    transition: border-color var(--transition);
    resize: vertical;
  }

  .field-input:focus,
  .field-textarea:focus {
    border-color: var(--accent-primary);
  }

  .field-mono {
    font-family: var(--font-family);
    font-size: var(--fs-xs);
  }

  .field-readonly {
    opacity: 0.5;
    cursor: default;
  }

  .field-error {
    font-size: var(--fs-xs);
    color: var(--accent-error);
    font-weight: 500;
    text-transform: none;
    letter-spacing: 0;
  }

  .schema-wrap {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .btn-xs {
    align-self: flex-end;
    padding: 2px 8px;
    font-size: var(--fs-xxs);
    font-weight: 600;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-primary);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all var(--transition);
  }

  .btn-xs:hover {
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }

  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .btn-primary {
    padding: 5px 14px;
    font-size: var(--fs-sm);
    font-weight: 600;
    border-radius: var(--radius-sm);
    border: 1px solid var(--accent-primary);
    background: var(--accent-primary);
    color: var(--bg-primary);
    cursor: pointer;
    transition: all var(--transition);
    letter-spacing: var(--ht-label-spacing);
  }

  .btn-primary:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  .btn-primary:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .btn-secondary {
    padding: 5px 14px;
    font-size: var(--fs-sm);
    font-weight: 600;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-primary);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all var(--transition);
    letter-spacing: var(--ht-label-spacing);
  }

  .btn-secondary:hover {
    border-color: var(--text-primary);
    color: var(--text-primary);
  }

  /* Loading / empty */
  .loading-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 24px;
    color: var(--text-tertiary);
    font-size: var(--fs-base);
  }

  .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid var(--border-primary);
    border-top-color: var(--accent-primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    flex-shrink: 0;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 40px 24px;
    color: var(--text-tertiary);
    text-align: center;
  }

  .empty-icon {
    opacity: 0.5;
    color: var(--text-tertiary);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .empty-text {
    font-size: var(--fs-base);
  }

  /* Tools list */
  .tools-list {
    flex: 1;
    overflow-y: auto;
    padding: 10px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .tool-card {
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius);
    padding: 10px 12px;
    background: var(--bg-secondary);
    transition: border-color var(--transition);
  }

  .tool-card:hover {
    border-color: var(--border-primary);
  }

  .tool-card--disabled {
    opacity: 0.5;
  }

  .tool-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 6px;
  }

  .tool-header-left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .tool-name {
    font-size: var(--fs-base);
    font-weight: 700;
    color: var(--text-primary);
    font-family: var(--font-family);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tool-handler-type {
    font-size: var(--fs-xxs);
    font-weight: 600;
    color: var(--text-tertiary);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    padding: 1px 5px;
    text-transform: uppercase;
    flex-shrink: 0;
  }

  .tool-actions {
    display: flex;
    align-items: center;
    gap: 3px;
    flex-shrink: 0;
  }

  .toggle-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: var(--fs-md);
    color: var(--text-tertiary);
    padding: 0 2px;
    transition: color var(--transition);
  }

  .toggle-btn:hover {
    color: var(--text-primary);
  }

  .toggle-on {
    color: var(--accent-primary);
  }

  .action-btn {
    width: 22px;
    height: 22px;
    border-radius: var(--radius-sm);
    border: 1px solid transparent;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    font-size: var(--fs-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all var(--transition);
    padding: 0;
  }

  .action-btn:hover {
    color: var(--accent-primary);
    border-color: var(--border-primary);
    background: var(--bg-hover);
  }

  .action-btn--active {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
  }

  .action-btn--danger:hover {
    color: var(--accent-error);
    border-color: var(--accent-error);
  }

  .tool-description {
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    line-height: 1.5;
    margin-bottom: 5px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .tool-command {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tool-command code {
    font-family: var(--font-family);
  }

  /* Test result */
  .test-error {
    font-size: var(--fs-sm);
    color: var(--accent-error);
    padding: 6px 8px;
    background: color-mix(in srgb, var(--accent-error) 10%, transparent);
    border-radius: var(--radius-sm);
    border: 1px solid color-mix(in srgb, var(--accent-error) 20%, transparent);
  }

  .test-result {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .test-result-meta {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: var(--fs-xs);
  }

  .test-exit-code {
    font-weight: 700;
    font-family: var(--font-family);
    color: var(--accent-error);
  }

  .test-exit-ok {
    color: #34d399;
  }

  .test-duration {
    color: var(--text-tertiary);
  }

  .test-output {
    font-size: var(--fs-xs);
    font-family: var(--font-family);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    padding: 8px 10px;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-all;
    color: var(--text-primary);
    max-height: 200px;
    overflow-y: auto;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
