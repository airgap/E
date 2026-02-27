<script lang="ts">
  import { uiStore } from '$lib/stores/ui.svelte';
  import { loopStore } from '$lib/stores/loop.svelte';
  import type { StoryTemplate, StoryTemplateCategory } from '@e/shared';

  type Phase = 'browse' | 'preview' | 'create' | 'use';

  let phase = $state<Phase>('browse');
  let selectedTemplate = $state<StoryTemplate | null>(null);
  let creating = $state(false);
  let usingTemplate = $state(false);

  // Template variables for "use" phase
  let templateVariables = $state<Record<string, string>>({});

  // Create-form state
  let newName = $state('');
  let newDescription = $state('');
  let newCategory = $state<StoryTemplateCategory>('feature');
  let newTitleTemplate = $state('');
  let newDescriptionTemplate = $state('');
  let newCriteriaText = $state('');
  let newPriority = $state<string>('medium');
  let newTags = $state('');

  // Category filter
  let filterCategory = $state<StoryTemplateCategory | null>(null);

  const categoryLabels: Record<StoryTemplateCategory, string> = {
    feature: 'Feature',
    bug: 'Bug Fix',
    tech_debt: 'Tech Debt',
    spike: 'Research Spike',
    custom: 'Custom',
  };

  const categoryIcons: Record<StoryTemplateCategory, string> = {
    feature: '+',
    bug: '!',
    tech_debt: '~',
    spike: '?',
    custom: '*',
  };

  let filteredTemplates = $derived(
    filterCategory
      ? loopStore.templates.filter((t) => t.category === filterCategory)
      : loopStore.templates,
  );

  function close() {
    loopStore.clearTemplates();
    phase = 'browse';
    selectedTemplate = null;
    templateVariables = {};
    uiStore.closeModal();
  }

  // Load templates when modal opens
  $effect(() => {
    if (loopStore.templates.length === 0 && !loopStore.templatesLoading) {
      loopStore.loadTemplates();
    }
  });

  function selectTemplate(template: StoryTemplate) {
    selectedTemplate = template;
    phase = 'preview';
  }

  function backToBrowse() {
    phase = 'browse';
    selectedTemplate = null;
    templateVariables = {};
  }

  function startUseTemplate() {
    if (!selectedTemplate) return;
    // Extract placeholders from the template
    const allText = [
      selectedTemplate.titleTemplate,
      selectedTemplate.descriptionTemplate,
      ...selectedTemplate.acceptanceCriteriaTemplates,
    ].join('\n');
    const matches = allText.matchAll(/\{\{(\w+)\}\}/g);
    const vars: Record<string, string> = {};
    for (const m of matches) {
      if (!vars[m[1]]) vars[m[1]] = '';
    }
    templateVariables = vars;
    phase = 'use';
  }

  async function handleUseTemplate() {
    if (!selectedTemplate || !loopStore.selectedPrdId) return;
    usingTemplate = true;
    try {
      const result = await loopStore.createStoryFromTemplate(
        loopStore.selectedPrdId,
        selectedTemplate.id,
        templateVariables,
      );
      if (result.ok) {
        uiStore.toast(`Story created from "${selectedTemplate.name}" template`, 'success');
        close();
      } else {
        uiStore.toast(result.error || 'Failed to create story', 'error');
      }
    } finally {
      usingTemplate = false;
    }
  }

  function openCreateForm() {
    phase = 'create';
    newName = '';
    newDescription = '';
    newCategory = 'custom';
    newTitleTemplate = '';
    newDescriptionTemplate = '';
    newCriteriaText = '';
    newPriority = 'medium';
    newTags = '';
  }

  async function handleCreate() {
    if (!newName.trim()) {
      uiStore.toast('Template name is required', 'error');
      return;
    }
    creating = true;
    try {
      const criteria = newCriteriaText
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      const tags = newTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const result = await loopStore.createTemplate({
        name: newName.trim(),
        description: newDescription.trim(),
        category: newCategory,
        titleTemplate: newTitleTemplate.trim(),
        descriptionTemplate: newDescriptionTemplate.trim(),
        acceptanceCriteriaTemplates: criteria,
        priority: newPriority as any,
        tags,
      });
      if (result.ok) {
        uiStore.toast(`Template "${newName}" created`, 'success');
        phase = 'browse';
      } else {
        uiStore.toast(result.error || 'Failed to create template', 'error');
      }
    } finally {
      creating = false;
    }
  }

  async function handleDeleteTemplate(template: StoryTemplate) {
    if (template.isBuiltIn) {
      uiStore.toast('Cannot delete built-in templates', 'warning');
      return;
    }
    if (!confirm(`Delete template "${template.name}"?`)) return;
    const result = await loopStore.deleteTemplate(template.id);
    if (result.ok) {
      uiStore.toast(`Template "${template.name}" deleted`, 'success');
      if (selectedTemplate?.id === template.id) {
        selectedTemplate = null;
        phase = 'browse';
      }
    } else {
      uiStore.toast(result.error || 'Failed to delete template', 'error');
    }
  }

  function formatPlaceholder(key: string): string {
    return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // Preview: apply current variables to template text
  function previewText(text: string): string {
    return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      const val = templateVariables[key];
      return val ? val : `[${formatPlaceholder(key)}]`;
    });
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div class="modal-overlay" onclick={close}>
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div class="modal" onclick={(e) => e.stopPropagation()}>
    <div class="modal-header">
      <div class="header-left">
        {#if phase !== 'browse'}
          <button class="back-btn" onclick={backToBrowse} title="Back to templates">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
          </button>
        {/if}
        <h2>
          {#if phase === 'browse'}Story Templates
          {:else if phase === 'preview'}Template Preview
          {:else if phase === 'create'}Create Template
          {:else if phase === 'use'}Use Template
          {/if}
        </h2>
      </div>
      <button class="close-btn" onclick={close} title="Close">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>

    <div class="modal-body">
      {#if loopStore.templatesLoading}
        <div class="loading-state">
          <div class="spinner-large"></div>
          <p>Loading templates...</p>
        </div>
      {:else if phase === 'browse'}
        <!-- Category filter -->
        <div class="filter-bar">
          <button
            class="filter-chip"
            class:active={filterCategory === null}
            onclick={() => (filterCategory = null)}>All</button
          >
          {#each Object.entries(categoryLabels) as [cat, label]}
            <button
              class="filter-chip"
              class:active={filterCategory === cat}
              onclick={() =>
                (filterCategory = filterCategory === cat ? null : (cat as StoryTemplateCategory))}
            >
              <span class="chip-icon">{categoryIcons[cat as StoryTemplateCategory]}</span>
              {label}
            </button>
          {/each}
        </div>

        <!-- Template grid -->
        <div class="template-grid">
          {#each filteredTemplates as template (template.id)}
            <button class="template-card" onclick={() => selectTemplate(template)}>
              <div class="card-header">
                <span class="card-category" data-cat={template.category}>
                  {categoryIcons[template.category]}
                  {categoryLabels[template.category]}
                </span>
                {#if template.isBuiltIn}
                  <span class="built-in-badge">Built-in</span>
                {:else}
                  <button
                    class="card-delete"
                    onclick={(e) => {
                      e.stopPropagation();
                      handleDeleteTemplate(template);
                    }}
                    title="Delete template">x</button
                  >
                {/if}
              </div>
              <h3 class="card-title">{template.name}</h3>
              <p class="card-desc">{template.description}</p>
              <div class="card-meta">
                <span class="criteria-count">{template.acceptanceCriteriaTemplates.length} AC</span>
                <span class="priority-tag" data-priority={template.priority}
                  >{template.priority}</span
                >
              </div>
            </button>
          {/each}
        </div>

        {#if filteredTemplates.length === 0}
          <div class="empty-state">
            {#if filterCategory}
              No templates in this category.
            {:else}
              No templates available yet.
            {/if}
          </div>
        {/if}
      {:else if phase === 'preview' && selectedTemplate}
        <!-- Template preview -->
        <div class="preview-section">
          <div class="preview-header">
            <span class="card-category" data-cat={selectedTemplate.category}>
              {categoryIcons[selectedTemplate.category]}
              {categoryLabels[selectedTemplate.category]}
            </span>
            <span class="priority-tag" data-priority={selectedTemplate.priority}
              >{selectedTemplate.priority}</span
            >
            {#if selectedTemplate.isBuiltIn}
              <span class="built-in-badge">Built-in</span>
            {/if}
          </div>

          <h3 class="preview-name">{selectedTemplate.name}</h3>
          <p class="preview-desc">{selectedTemplate.description}</p>

          <div class="preview-field">
            <label>Title Template</label>
            <div class="preview-value">{selectedTemplate.titleTemplate}</div>
          </div>

          <div class="preview-field">
            <label>Description Template</label>
            <div class="preview-value description-preview">
              {selectedTemplate.descriptionTemplate}
            </div>
          </div>

          <div class="preview-field">
            <label
              >Acceptance Criteria ({selectedTemplate.acceptanceCriteriaTemplates.length})</label
            >
            <ul class="ac-list">
              {#each selectedTemplate.acceptanceCriteriaTemplates as ac, i}
                <li><span class="ac-index">{i + 1}.</span> {ac}</li>
              {/each}
            </ul>
          </div>

          {#if selectedTemplate.tags.length > 0}
            <div class="preview-tags">
              {#each selectedTemplate.tags as tag}
                <span class="tag">{tag}</span>
              {/each}
            </div>
          {/if}
        </div>
      {:else if phase === 'use' && selectedTemplate}
        <!-- Use template: fill variables -->
        <div class="use-section">
          <p class="use-intro">
            Fill in the placeholders below to create a story from the
            <strong>{selectedTemplate.name}</strong> template.
          </p>

          {#if Object.keys(templateVariables).length > 0}
            <div class="variables-form">
              {#each Object.keys(templateVariables) as key}
                <div class="var-field">
                  <label for="var-{key}">{formatPlaceholder(key)}</label>
                  <input
                    id="var-{key}"
                    type="text"
                    bind:value={templateVariables[key]}
                    placeholder="Enter {formatPlaceholder(key).toLowerCase()}..."
                  />
                </div>
              {/each}
            </div>
          {:else}
            <p class="no-vars-hint">This template has no placeholders. It will be used as-is.</p>
          {/if}

          <!-- Live preview -->
          <div class="live-preview">
            <h4>Preview</h4>
            <div class="preview-field">
              <label>Title</label>
              <div class="preview-value">{previewText(selectedTemplate.titleTemplate)}</div>
            </div>
            <div class="preview-field">
              <label>Acceptance Criteria</label>
              <ul class="ac-list">
                {#each selectedTemplate.acceptanceCriteriaTemplates as ac, i}
                  <li><span class="ac-index">{i + 1}.</span> {previewText(ac)}</li>
                {/each}
              </ul>
            </div>
          </div>
        </div>
      {:else if phase === 'create'}
        <!-- Create custom template form -->
        <div class="create-form">
          <div class="form-row">
            <div class="form-field">
              <label for="tmpl-name">Name *</label>
              <input id="tmpl-name" bind:value={newName} placeholder="e.g. API Endpoint" />
            </div>
            <div class="form-field narrow">
              <label for="tmpl-category">Category</label>
              <select id="tmpl-category" bind:value={newCategory}>
                {#each Object.entries(categoryLabels) as [cat, label]}
                  <option value={cat}>{label}</option>
                {/each}
              </select>
            </div>
          </div>

          <div class="form-field">
            <label for="tmpl-desc">Description</label>
            <input
              id="tmpl-desc"
              bind:value={newDescription}
              placeholder="Brief description of when to use this template"
            />
          </div>

          <div class="form-field">
            <label for="tmpl-title">Title Template</label>
            <input
              id="tmpl-title"
              bind:value={newTitleTemplate}
              placeholder={'e.g. As a {{user_role}}, I want to {{action}}'}
            />
            <span class="field-hint">Use {'{{variable_name}}'} for placeholders</span>
          </div>

          <div class="form-field">
            <label for="tmpl-body">Description Template</label>
            <textarea
              id="tmpl-body"
              bind:value={newDescriptionTemplate}
              rows="5"
              placeholder="Template body with placeholder guidance..."
            ></textarea>
          </div>

          <div class="form-field">
            <label for="tmpl-criteria">Acceptance Criteria (one per line)</label>
            <textarea
              id="tmpl-criteria"
              bind:value={newCriteriaText}
              rows="4"
              placeholder="Each line becomes one acceptance criterion..."
            ></textarea>
          </div>

          <div class="form-row">
            <div class="form-field narrow">
              <label for="tmpl-priority">Priority</label>
              <select id="tmpl-priority" bind:value={newPriority}>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div class="form-field">
              <label for="tmpl-tags">Tags (comma-separated)</label>
              <input id="tmpl-tags" bind:value={newTags} placeholder="e.g. api, backend, crud" />
            </div>
          </div>
        </div>
      {/if}

      {#if loopStore.templatesError}
        <div class="error-banner">{loopStore.templatesError}</div>
      {/if}
    </div>

    <div class="modal-footer">
      {#if phase === 'browse'}
        <button class="btn-create-new" onclick={openCreateForm}> + New Template </button>
        <div class="footer-spacer"></div>
        <button class="btn-cancel" onclick={close}>Close</button>
      {:else if phase === 'preview'}
        <button class="btn-cancel" onclick={backToBrowse}>Back</button>
        <div class="footer-spacer"></div>
        {#if loopStore.selectedPrdId}
          <button class="btn-primary" onclick={startUseTemplate}> Use Template </button>
        {:else}
          <span class="no-prd-hint">Select a PRD to use templates</span>
        {/if}
      {:else if phase === 'use'}
        <button class="btn-cancel" onclick={() => (phase = 'preview')}>Back</button>
        <div class="footer-spacer"></div>
        <button class="btn-primary" onclick={handleUseTemplate} disabled={usingTemplate}>
          {#if usingTemplate}Creating...{:else}Create Story{/if}
        </button>
      {:else if phase === 'create'}
        <button class="btn-cancel" onclick={backToBrowse}>Cancel</button>
        <div class="footer-spacer"></div>
        <button class="btn-primary" onclick={handleCreate} disabled={creating || !newName.trim()}>
          {#if creating}Saving...{:else}Save Template{/if}
        </button>
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
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  .modal {
    background: var(--bg-primary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-lg, 8px);
    width: 720px;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  }
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-primary);
  }
  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .modal-header h2 {
    font-size: var(--fs-lg);
    font-weight: 600;
  }
  .back-btn {
    padding: 4px;
    border-radius: 4px;
    color: var(--text-tertiary);
    display: flex;
    align-items: center;
  }
  .back-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }
  .close-btn {
    padding: 4px;
    border-radius: 4px;
    color: var(--text-tertiary);
  }
  .close-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }
  .modal-body {
    padding: 16px 20px;
    overflow-y: auto;
    flex: 1;
  }

  /* Loading */
  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 40px 20px;
    gap: 12px;
  }
  .loading-state p {
    font-size: var(--fs-base);
    color: var(--text-secondary);
  }
  .spinner-large {
    width: 24px;
    height: 24px;
    border: 3px solid transparent;
    border-top-color: var(--accent-primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  .empty-state {
    padding: 40px 20px;
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--fs-base);
  }

  /* Filter bar */
  .filter-bar {
    display: flex;
    gap: 6px;
    margin-bottom: 16px;
    flex-wrap: wrap;
  }
  .filter-chip {
    padding: 4px 12px;
    font-size: var(--fs-xs);
    border-radius: 12px;
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    border: 1px solid var(--border-primary);
    cursor: pointer;
    transition: all var(--transition);
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .filter-chip:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .filter-chip.active {
    background: var(--accent-primary);
    color: var(--text-on-accent);
    border-color: var(--accent-primary);
  }
  .chip-icon {
    font-weight: 700;
    font-size: var(--fs-sm);
  }

  /* Template grid */
  .template-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }
  .template-card {
    display: flex;
    flex-direction: column;
    padding: 12px;
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
    cursor: pointer;
    transition: all var(--transition);
    text-align: left;
  }
  .template-card:hover {
    border-color: var(--accent-primary);
    background: var(--bg-hover);
  }
  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }
  .card-category {
    font-size: var(--fs-xxs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 2px 6px;
    border-radius: 3px;
    background: var(--bg-tertiary);
    color: var(--text-tertiary);
  }
  .card-category[data-cat='feature'] {
    color: var(--accent-primary);
    background: var(--bg-active);
  }
  .card-category[data-cat='bug'] {
    color: var(--accent-error);
    background: rgba(239, 68, 68, 0.1);
  }
  .card-category[data-cat='tech_debt'] {
    color: var(--accent-warning, #e6a817);
    background: rgba(230, 168, 23, 0.1);
  }
  .card-category[data-cat='spike'] {
    color: var(--accent-secondary);
    background: rgba(34, 197, 94, 0.1);
  }
  .card-category[data-cat='custom'] {
    color: var(--text-secondary);
    background: var(--bg-tertiary);
  }

  .built-in-badge {
    font-size: var(--fs-xxs);
    padding: 1px 5px;
    border-radius: 3px;
    background: var(--bg-tertiary);
    color: var(--text-tertiary);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .card-delete {
    font-size: var(--fs-sm);
    padding: 0 4px;
    color: var(--text-tertiary);
    opacity: 0;
    transition: opacity var(--transition);
    border: none;
    background: none;
    cursor: pointer;
  }
  .template-card:hover .card-delete {
    opacity: 1;
  }
  .card-delete:hover {
    color: var(--accent-error);
  }
  .card-title {
    font-size: var(--fs-base);
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 4px;
  }
  .card-desc {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    line-height: 1.4;
    flex: 1;
    margin-bottom: 8px;
  }
  .card-meta {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .criteria-count {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    font-weight: 600;
  }
  .priority-tag {
    font-size: var(--fs-xxs);
    font-weight: 600;
    padding: 1px 5px;
    border-radius: 3px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .priority-tag[data-priority='critical'] {
    color: var(--accent-error);
    background: rgba(239, 68, 68, 0.1);
  }
  .priority-tag[data-priority='high'] {
    color: var(--accent-warning, #e6a817);
    background: rgba(230, 168, 23, 0.1);
  }
  .priority-tag[data-priority='medium'] {
    color: var(--accent-primary);
    background: var(--bg-active);
  }
  .priority-tag[data-priority='low'] {
    color: var(--text-tertiary);
    background: var(--bg-tertiary);
  }

  /* Preview */
  .preview-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .preview-header {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .preview-name {
    font-size: var(--fs-lg);
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }
  .preview-desc {
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    line-height: 1.4;
    margin: 0;
  }
  .preview-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .preview-field label {
    font-size: var(--fs-xxs);
    font-weight: 600;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .preview-value {
    font-size: var(--fs-sm);
    color: var(--text-primary);
    padding: 8px 10px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .description-preview {
    max-height: 200px;
    overflow-y: auto;
  }
  .ac-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .ac-list li {
    font-size: var(--fs-sm);
    color: var(--text-primary);
    padding: 6px 10px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    line-height: 1.4;
  }
  .ac-index {
    font-weight: 700;
    color: var(--accent-primary);
    margin-right: 6px;
  }
  .preview-tags {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }
  .tag {
    font-size: var(--fs-xxs);
    padding: 2px 8px;
    border-radius: 10px;
    background: var(--bg-tertiary);
    color: var(--text-tertiary);
    font-weight: 500;
  }

  /* Use template */
  .use-section {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .use-intro {
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    line-height: 1.4;
    margin: 0;
  }
  .variables-form {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .var-field {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .var-field label {
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-secondary);
  }
  .var-field input {
    padding: 6px 10px;
    font-size: var(--fs-sm);
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
  }
  .var-field input:focus {
    border-color: var(--accent-primary);
    outline: none;
  }
  .no-vars-hint {
    font-size: var(--fs-sm);
    color: var(--text-tertiary);
    font-style: italic;
  }
  .live-preview {
    border-top: 1px solid var(--border-primary);
    padding-top: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .live-preview h4 {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-secondary);
    margin: 0;
  }

  /* Create form */
  .create-form {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .form-row {
    display: flex;
    gap: 10px;
  }
  .form-field {
    display: flex;
    flex-direction: column;
    gap: 3px;
    flex: 1;
  }
  .form-field.narrow {
    flex: 0 0 160px;
  }
  .form-field label {
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-secondary);
  }
  .form-field input,
  .form-field select,
  .form-field textarea {
    padding: 6px 10px;
    font-size: var(--fs-sm);
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    font-family: inherit;
  }
  .form-field textarea {
    resize: vertical;
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    line-height: 1.5;
  }
  .form-field input:focus,
  .form-field select:focus,
  .form-field textarea:focus {
    border-color: var(--accent-primary);
    outline: none;
  }
  .field-hint {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    font-style: italic;
  }

  /* Error */
  .error-banner {
    padding: 8px 12px;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid var(--accent-error);
    border-radius: var(--radius-sm);
    color: var(--accent-error);
    font-size: var(--fs-sm);
    margin-top: 12px;
  }

  /* Footer */
  .modal-footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 20px;
    border-top: 1px solid var(--border-primary);
  }
  .footer-spacer {
    flex: 1;
  }
  .btn-cancel {
    padding: 6px 16px;
    font-size: var(--fs-sm);
    border-radius: var(--radius-sm);
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    border: 1px solid var(--border-primary);
    cursor: pointer;
  }
  .btn-cancel:hover {
    background: var(--bg-hover);
  }
  .btn-primary {
    padding: 6px 20px;
    font-size: var(--fs-sm);
    font-weight: 600;
    border-radius: var(--radius-sm);
    background: var(--accent-primary);
    color: var(--text-on-accent);
    cursor: pointer;
  }
  .btn-primary:hover:not(:disabled) {
    opacity: 0.9;
  }
  .btn-primary:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .btn-create-new {
    padding: 6px 16px;
    font-size: var(--fs-sm);
    font-weight: 600;
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
    color: var(--accent-primary);
    border: 1px solid var(--accent-primary);
    cursor: pointer;
  }
  .btn-create-new:hover {
    background: var(--bg-active);
  }
  .no-prd-hint {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    font-style: italic;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
