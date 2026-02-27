<script lang="ts">
  import { onMount } from 'svelte';
  import { skillsStore } from '$lib/stores/skills.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { uiStore } from '$lib/stores/ui.svelte';
  import { registerSkillCommands } from '$lib/commands/slash-commands';
  import { api } from '$lib/api/client';
  import { SKILL_CATEGORIES } from '@e/shared';
  import type { SkillSummary, SkillCategory, SkillSortBy } from '@e/shared';

  type ViewMode = 'browse' | 'installed' | 'create' | 'detail';

  let viewMode = $state<ViewMode>('browse');
  let searchInput = $state('');
  let searchTimeout: ReturnType<typeof setTimeout> | null = null;
  let installingId = $state<string | null>(null);
  let uninstallingId = $state<string | null>(null);

  // Create form state
  let createForm = $state({
    name: '',
    description: '',
    category: 'other' as SkillCategory,
    tags: '',
    promptTemplate: '',
    rules: '',
    requiredTools: '',
  });
  let createStep = $state(1);

  const workspacePath = $derived(settingsStore.workspacePath || undefined);

  onMount(() => {
    skillsStore.browse(workspacePath);
    skillsStore.loadInstalled(workspacePath);
  });

  function handleSearch() {
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      skillsStore.setSearchQuery(searchInput);
      skillsStore.browse(workspacePath);
    }, 300);
  }

  function setCategory(cat: SkillCategory | 'all') {
    skillsStore.setCategory(cat);
    skillsStore.browse(workspacePath);
  }

  function setSortBy(sort: SkillSortBy) {
    skillsStore.setSortBy(sort);
    skillsStore.browse(workspacePath);
  }

  function setTierFilter(tier: 'all' | 'bundled' | 'managed' | 'workspace') {
    skillsStore.setTierFilter(tier);
    skillsStore.browse(workspacePath);
  }

  async function installSkill(skill: SkillSummary) {
    installingId = skill.id;
    const ok = await skillsStore.install(skill.id, {
      tier: 'workspace',
      workspacePath,
    });
    if (ok) {
      uiStore.toast(`"${skill.name}" installed`, 'success');
      // Refresh memory to register slash commands
      try {
        const memRes = await api.memory.list();
        const skillFiles = memRes.data.filter((f: any) => f.type === 'skills');
        if (skillFiles.length > 0) {
          registerSkillCommands(skillFiles);
        }
      } catch {}
    } else {
      uiStore.toast(`Failed to install "${skill.name}"`, 'error');
    }
    installingId = null;
  }

  async function uninstallSkill(skill: SkillSummary) {
    uninstallingId = skill.id;
    const ok = await skillsStore.uninstall(skill.id, workspacePath);
    if (ok) {
      uiStore.toast(`"${skill.name}" uninstalled`, 'success');
    } else {
      uiStore.toast(`Failed to uninstall "${skill.name}"`, 'error');
    }
    uninstallingId = null;
  }

  async function toggleActivation(skill: SkillSummary) {
    const newState = !skill.activated;
    const ok = await skillsStore.activate(skill.id, newState, workspacePath);
    if (ok) {
      uiStore.toast(`"${skill.name}" ${newState ? 'activated' : 'deactivated'}`, 'success');
    }
  }

  async function viewDetail(skill: SkillSummary) {
    viewMode = 'detail';
    await skillsStore.viewSkill(skill.id, workspacePath);
  }

  async function handleCreate() {
    if (!createForm.name || !createForm.description) return;
    const result = await skillsStore.createSkill({
      name: createForm.name,
      description: createForm.description,
      category: createForm.category,
      tags: createForm.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      promptTemplate: createForm.promptTemplate || undefined,
      rules: createForm.rules
        .split('\n')
        .map((r) => r.trim())
        .filter(Boolean),
      requiredTools: createForm.requiredTools
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      workspacePath,
    });
    if (result) {
      uiStore.toast(`Skill "${createForm.name}" created`, 'success');
      createForm = {
        name: '',
        description: '',
        category: 'other',
        tags: '',
        promptTemplate: '',
        rules: '',
        requiredTools: '',
      };
      createStep = 1;
      viewMode = 'browse';
      skillsStore.browse(workspacePath);
    } else {
      uiStore.toast('Failed to create skill', 'error');
    }
  }

  function tierLabel(tier: string): string {
    switch (tier) {
      case 'bundled':
        return 'Built-in';
      case 'managed':
        return 'Registry';
      case 'workspace':
        return 'Workspace';
      default:
        return tier;
    }
  }

  function tierColor(tier: string): string {
    switch (tier) {
      case 'bundled':
        return 'var(--accent-primary)';
      case 'managed':
        return 'var(--accent-secondary)';
      case 'workspace':
        return 'var(--accent-warning)';
      default:
        return 'var(--text-tertiary)';
    }
  }
</script>

<div class="skills-marketplace">
  <!-- Header tabs -->
  <div class="market-tabs">
    <button
      class="market-tab"
      class:active={viewMode === 'browse'}
      onclick={() => {
        viewMode = 'browse';
        skillsStore.browse(workspacePath);
      }}
    >
      Marketplace
    </button>
    <button
      class="market-tab"
      class:active={viewMode === 'installed'}
      onclick={() => {
        viewMode = 'installed';
        skillsStore.loadInstalled(workspacePath);
      }}
    >
      Installed
      {#if skillsStore.installedSkills.length > 0}
        <span class="tab-count">{skillsStore.installedSkills.length}</span>
      {/if}
    </button>
    <button
      class="market-tab"
      class:active={viewMode === 'create'}
      onclick={() => {
        viewMode = 'create';
        createStep = 1;
      }}
    >
      + Create
    </button>
  </div>

  {#if viewMode === 'detail' && skillsStore.selectedSkill}
    <!-- Skill Detail View -->
    <div class="detail-view">
      <button
        class="back-btn"
        onclick={() => {
          viewMode = 'browse';
          skillsStore.clearSelection();
        }}
      >
        &larr; Back
      </button>

      <div class="detail-header">
        <h3 class="detail-name">{skillsStore.selectedSkill.metadata.name}</h3>
        <span class="tier-badge" style="color: {tierColor(skillsStore.selectedSkill.tier)}">
          {tierLabel(skillsStore.selectedSkill.tier)}
        </span>
      </div>

      <p class="detail-desc">{skillsStore.selectedSkill.metadata.description}</p>

      <div class="detail-meta">
        {#if skillsStore.selectedSkill.metadata.author}
          <span class="meta-item">By {skillsStore.selectedSkill.metadata.author}</span>
        {/if}
        <span class="meta-item">v{skillsStore.selectedSkill.metadata.version}</span>
        <span class="meta-item cat-badge">{skillsStore.selectedSkill.metadata.category}</span>
      </div>

      {#if skillsStore.selectedSkill.metadata.tags.length > 0}
        <div class="tag-list">
          {#each skillsStore.selectedSkill.metadata.tags as tag}
            <span class="tag">{tag}</span>
          {/each}
        </div>
      {/if}

      {#if skillsStore.selectedSkill.metadata.requiredTools?.length}
        <div class="req-section">
          <span class="req-label">Required Tools:</span>
          {#each skillsStore.selectedSkill.metadata.requiredTools as tool}
            <span class="req-item">{tool}</span>
          {/each}
        </div>
      {/if}

      {#if skillsStore.selectedSkill.metadata.requiredMcpServers?.length}
        <div class="req-section">
          <span class="req-label">Required MCP Servers:</span>
          {#each skillsStore.selectedSkill.metadata.requiredMcpServers as server}
            <span class="req-item">{server}</span>
          {/each}
        </div>
      {/if}

      {#if skillsStore.selectedSkill.promptTemplate}
        <div class="detail-section">
          <h4>Prompt Template</h4>
          <pre class="prompt-preview">{skillsStore.selectedSkill.promptTemplate}</pre>
        </div>
      {/if}

      {#if skillsStore.selectedSkill.rules?.length}
        <div class="detail-section">
          <h4>Rules</h4>
          <ul class="rules-list">
            {#each skillsStore.selectedSkill.rules as rule}
              <li>{rule}</li>
            {/each}
          </ul>
        </div>
      {/if}

      <div class="detail-actions">
        {#if skillsStore.selectedSkill.installed}
          <button
            class="action-btn"
            class:activated={skillsStore.selectedSkill.activated}
            onclick={() => {
              if (skillsStore.selectedSkill) {
                const id = skillsStore.selectedSkill.metadata.id;
                const newState = !skillsStore.selectedSkill.activated;
                skillsStore.activate(id, newState, workspacePath);
              }
            }}
          >
            {skillsStore.selectedSkill.activated ? 'Deactivate' : 'Activate'}
          </button>
          {#if skillsStore.selectedSkill.tier !== 'bundled'}
            <button
              class="action-btn danger"
              onclick={() => {
                if (skillsStore.selectedSkill) {
                  uninstallSkill({
                    id: skillsStore.selectedSkill.metadata.id,
                    name: skillsStore.selectedSkill.metadata.name,
                  } as SkillSummary);
                  viewMode = 'browse';
                }
              }}
            >
              Uninstall
            </button>
          {/if}
        {:else}
          <button
            class="action-btn primary"
            onclick={() => {
              if (skillsStore.selectedSkill) {
                installSkill({
                  id: skillsStore.selectedSkill.metadata.id,
                  name: skillsStore.selectedSkill.metadata.name,
                } as SkillSummary);
              }
            }}
          >
            Install to Workspace
          </button>
        {/if}
      </div>
    </div>
  {:else if viewMode === 'create'}
    <!-- Create Skill Flow -->
    <div class="create-view">
      <div class="create-progress">
        <span class="step" class:active={createStep >= 1}>1. Info</span>
        <span class="step-sep">&rarr;</span>
        <span class="step" class:active={createStep >= 2}>2. Prompt</span>
        <span class="step-sep">&rarr;</span>
        <span class="step" class:active={createStep >= 3}>3. Review</span>
      </div>

      {#if createStep === 1}
        <div class="create-step">
          <label class="form-label">
            Name
            <input class="form-input" bind:value={createForm.name} placeholder="My Custom Skill" />
          </label>
          <label class="form-label">
            Description
            <textarea
              class="form-textarea"
              bind:value={createForm.description}
              placeholder="What does this skill do?"
              rows="2"
            ></textarea>
          </label>
          <label class="form-label">
            Category
            <select class="form-input" bind:value={createForm.category}>
              {#each SKILL_CATEGORIES.filter((c) => c.value !== 'all') as cat}
                <option value={cat.value}>{cat.label}</option>
              {/each}
            </select>
          </label>
          <label class="form-label">
            Tags
            <input class="form-input" bind:value={createForm.tags} placeholder="tag1, tag2, tag3" />
          </label>
          <button
            class="action-btn primary"
            disabled={!createForm.name || !createForm.description}
            onclick={() => (createStep = 2)}
          >
            Next &rarr;
          </button>
        </div>
      {:else if createStep === 2}
        <div class="create-step">
          <label class="form-label">
            Prompt Template
            <textarea
              class="form-textarea tall"
              bind:value={createForm.promptTemplate}
              placeholder="Instructions for the agent when this skill is activated..."
              rows="6"
            ></textarea>
          </label>
          <label class="form-label">
            Rules (one per line)
            <textarea
              class="form-textarea"
              bind:value={createForm.rules}
              placeholder="Always do X&#10;Never do Y&#10;Prefer Z over W"
              rows="4"
            ></textarea>
          </label>
          <label class="form-label">
            Required Tools (comma-separated)
            <input
              class="form-input"
              bind:value={createForm.requiredTools}
              placeholder="Read, Write, Bash"
            />
          </label>
          <div class="step-nav">
            <button class="action-btn" onclick={() => (createStep = 1)}> &larr; Back </button>
            <button class="action-btn primary" onclick={() => (createStep = 3)}>
              Next &rarr;
            </button>
          </div>
        </div>
      {:else if createStep === 3}
        <div class="create-step">
          <h4 class="review-title">Review Your Skill</h4>
          <div class="review-field">
            <span class="review-label">Name:</span>
            <span class="review-value">{createForm.name}</span>
          </div>
          <div class="review-field">
            <span class="review-label">Description:</span>
            <span class="review-value">{createForm.description}</span>
          </div>
          <div class="review-field">
            <span class="review-label">Category:</span>
            <span class="review-value">{createForm.category}</span>
          </div>
          {#if createForm.tags}
            <div class="review-field">
              <span class="review-label">Tags:</span>
              <span class="review-value">{createForm.tags}</span>
            </div>
          {/if}
          {#if createForm.promptTemplate}
            <div class="review-field">
              <span class="review-label">Prompt:</span>
              <pre class="review-pre">{createForm.promptTemplate.slice(0, 200)}{createForm
                  .promptTemplate.length > 200
                  ? '...'
                  : ''}</pre>
            </div>
          {/if}
          <div class="step-nav">
            <button class="action-btn" onclick={() => (createStep = 2)}> &larr; Back </button>
            <button
              class="action-btn primary"
              disabled={skillsStore.creating}
              onclick={handleCreate}
            >
              {skillsStore.creating ? 'Creating...' : 'Create Skill'}
            </button>
          </div>
        </div>
      {/if}
    </div>
  {:else if viewMode === 'installed'}
    <!-- Installed Skills View -->
    <div class="installed-view">
      {#if skillsStore.installedLoading}
        <div class="empty">Loading installed skills...</div>
      {:else if skillsStore.installedSkills.length === 0}
        <div class="empty">No skills installed yet. Browse the marketplace to get started!</div>
      {:else}
        <div class="skills-list">
          {#each skillsStore.installedSkills as skill (skill.id)}
            <div class="skill-card" class:activated={skill.activated}>
              <div class="skill-header">
                <button class="skill-name-btn" onclick={() => viewDetail(skill)}>
                  {skill.name}
                </button>
                <div class="skill-badges">
                  <span class="tier-badge" style="color: {tierColor(skill.tier)}">
                    {tierLabel(skill.tier)}
                  </span>
                </div>
              </div>
              <p class="skill-desc">{skill.description}</p>
              <div class="skill-footer">
                <div class="skill-tags">
                  {#each skill.tags.slice(0, 3) as tag}
                    <span class="tag">{tag}</span>
                  {/each}
                </div>
                <div class="skill-actions">
                  <button
                    class="toggle-btn"
                    class:active={skill.activated}
                    onclick={() => toggleActivation(skill)}
                    title={skill.activated ? 'Deactivate' : 'Activate'}
                  >
                    {skill.activated ? 'ON' : 'OFF'}
                  </button>
                </div>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {:else}
    <!-- Browse / Marketplace View -->
    <div class="browse-view">
      <!-- Search -->
      <div class="search-bar">
        <input
          class="search-input"
          type="text"
          placeholder="Search skills..."
          bind:value={searchInput}
          oninput={handleSearch}
        />
      </div>

      <!-- Filters -->
      <div class="filter-bar">
        <div class="category-chips">
          {#each SKILL_CATEGORIES.slice(0, 7) as cat}
            <button
              class="cat-chip"
              class:active={skillsStore.selectedCategory === cat.value}
              onclick={() => setCategory(cat.value as SkillCategory | 'all')}
            >
              {cat.label}
            </button>
          {/each}
        </div>
      </div>

      <div class="sort-row">
        <div class="tier-filters">
          {#each [{ v: 'all', l: 'All' }, { v: 'bundled', l: 'Built-in' }, { v: 'managed', l: 'Registry' }, { v: 'workspace', l: 'Workspace' }] as f}
            <button
              class="tier-chip"
              class:active={skillsStore.tierFilter === f.v}
              onclick={() => setTierFilter(f.v as any)}
            >
              {f.l}
            </button>
          {/each}
        </div>
        <select
          class="sort-select"
          value={skillsStore.sortBy}
          onchange={(e) => setSortBy((e.target as HTMLSelectElement).value as SkillSortBy)}
        >
          <option value="popularity">Popular</option>
          <option value="name">A-Z</option>
          <option value="newest">Newest</option>
        </select>
      </div>

      <!-- Results -->
      {#if skillsStore.loading && skillsStore.skills.length === 0}
        <div class="empty">Loading skills...</div>
      {:else if skillsStore.error}
        <div class="error">{skillsStore.error}</div>
      {:else if skillsStore.skills.length === 0}
        <div class="empty">
          {searchInput ? 'No skills match your search' : 'No skills found'}
        </div>
      {:else}
        <div class="results-count">
          {skillsStore.total} skill{skillsStore.total !== 1 ? 's' : ''} found
        </div>
        <div class="skills-list">
          {#each skillsStore.skills as skill (skill.id)}
            <div
              class="skill-card"
              class:installed={skill.installed}
              class:activated={skill.activated}
            >
              <div class="skill-header">
                <button class="skill-name-btn" onclick={() => viewDetail(skill)}>
                  {skill.name}
                </button>
                <div class="skill-badges">
                  <span class="tier-badge" style="color: {tierColor(skill.tier)}">
                    {tierLabel(skill.tier)}
                  </span>
                  {#if skill.installed}
                    <span class="installed-badge">Installed</span>
                  {/if}
                </div>
              </div>
              <p class="skill-desc">{skill.description}</p>
              {#if skill.author}
                <span class="skill-author">by {skill.author}</span>
              {/if}
              <div class="skill-footer">
                <div class="skill-tags">
                  {#each skill.tags.slice(0, 3) as tag}
                    <span class="tag">{tag}</span>
                  {/each}
                </div>
                <div class="skill-actions">
                  {#if skill.installed}
                    <button
                      class="toggle-btn"
                      class:active={skill.activated}
                      onclick={() => toggleActivation(skill)}
                      title={skill.activated ? 'Deactivate' : 'Activate'}
                    >
                      {skill.activated ? 'ON' : 'OFF'}
                    </button>
                  {:else}
                    <button
                      class="install-btn"
                      onclick={() => installSkill(skill)}
                      disabled={installingId === skill.id}
                    >
                      {installingId === skill.id ? '...' : 'Install'}
                    </button>
                  {/if}
                </div>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .skills-marketplace {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  /* Header tabs */
  .market-tabs {
    display: flex;
    gap: 1px;
    border-bottom: 1px solid var(--border-primary);
    flex-shrink: 0;
  }
  .market-tab {
    flex: 1;
    padding: 8px 6px;
    font-size: var(--fs-xs);
    font-weight: 700;
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
    color: var(--text-tertiary);
    background: var(--bg-tertiary);
    border: none;
    cursor: pointer;
    transition: all var(--transition);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
  }
  .market-tab:hover {
    color: var(--text-primary);
  }
  .market-tab.active {
    color: var(--accent-primary);
    background: var(--bg-primary);
    border-bottom: 2px solid var(--accent-primary);
  }
  .tab-count {
    font-size: var(--fs-xxs);
    padding: 0 4px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-secondary);
    color: var(--text-secondary);
  }

  /* Search */
  .search-bar {
    padding: 8px 8px 4px;
  }
  .search-input {
    width: 100%;
    padding: 6px 10px;
    font-size: var(--fs-sm);
    background: var(--bg-primary);
    border: 1px solid var(--border-secondary);
    color: var(--text-primary);
    font-family: var(--font-family);
    box-sizing: border-box;
  }
  .search-input:focus {
    border-color: var(--accent-primary);
    outline: none;
  }

  /* Filters */
  .filter-bar {
    padding: 4px 8px;
  }
  .category-chips {
    display: flex;
    gap: 2px;
    flex-wrap: wrap;
  }
  .cat-chip {
    font-size: var(--fs-xxs);
    padding: 3px 6px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    color: var(--text-tertiary);
    cursor: pointer;
    transition: all var(--transition);
  }
  .cat-chip:hover {
    color: var(--text-primary);
    border-color: var(--border-secondary);
  }
  .cat-chip.active {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
    background: var(--bg-hover);
  }

  .sort-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 8px 6px;
    gap: 6px;
  }
  .tier-filters {
    display: flex;
    gap: 2px;
  }
  .tier-chip {
    font-size: var(--fs-xxs);
    padding: 2px 5px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    color: var(--text-tertiary);
    cursor: pointer;
    transition: all var(--transition);
  }
  .tier-chip:hover {
    color: var(--text-primary);
  }
  .tier-chip.active {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
    background: var(--bg-hover);
  }
  .sort-select {
    font-size: var(--fs-xxs);
    padding: 2px 4px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    color: var(--text-secondary);
    font-family: var(--font-family);
  }

  .results-count {
    padding: 0 8px 4px;
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
  }

  /* Skills list */
  .browse-view,
  .installed-view {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .skills-list {
    flex: 1;
    overflow-y: auto;
    padding: 0 8px 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  /* Skill card */
  .skill-card {
    padding: 8px 10px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-primary);
    display: flex;
    flex-direction: column;
    gap: 3px;
    transition: border-color var(--transition);
  }
  .skill-card:hover {
    border-color: var(--border-secondary);
  }
  .skill-card.installed {
    border-left: 2px solid var(--accent-secondary);
  }
  .skill-card.activated {
    border-left: 2px solid var(--accent-primary);
  }

  .skill-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }
  .skill-name-btn {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-primary);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    text-align: left;
    font-family: var(--font-family);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .skill-name-btn:hover {
    color: var(--accent-primary);
  }

  .skill-badges {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }
  .tier-badge {
    font-size: var(--fs-xxs);
    font-weight: 700;
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
  }
  .installed-badge {
    font-size: var(--fs-xxs);
    padding: 0 4px;
    background: var(--accent-secondary);
    color: var(--bg-primary);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .skill-desc {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    margin: 0;
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .skill-author {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    font-style: italic;
  }
  .skill-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    margin-top: 2px;
  }
  .skill-tags {
    display: flex;
    gap: 3px;
    min-width: 0;
    overflow: hidden;
  }
  .tag {
    font-size: var(--fs-xxs);
    padding: 1px 5px;
    background: var(--bg-tertiary);
    color: var(--text-tertiary);
    white-space: nowrap;
  }
  .tag-list {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
    margin: 4px 0;
  }
  .skill-actions {
    flex-shrink: 0;
  }
  .install-btn {
    font-size: var(--fs-xxs);
    padding: 3px 10px;
    background: var(--accent-primary);
    color: var(--bg-primary);
    border: none;
    font-weight: 700;
    cursor: pointer;
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
  }
  .install-btn:hover {
    opacity: 0.9;
  }
  .install-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .toggle-btn {
    font-size: var(--fs-xxs);
    padding: 2px 8px;
    border: 1px solid var(--border-secondary);
    background: var(--bg-secondary);
    color: var(--text-tertiary);
    font-weight: 700;
    cursor: pointer;
    transition: all var(--transition);
  }
  .toggle-btn.active {
    background: var(--accent-primary);
    color: var(--bg-primary);
    border-color: var(--accent-primary);
  }

  /* Detail view */
  .detail-view {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .back-btn {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    background: none;
    border: none;
    cursor: pointer;
    padding: 2px 0;
    text-align: left;
  }
  .back-btn:hover {
    color: var(--accent-primary);
  }
  .detail-header {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .detail-name {
    font-size: var(--fs-md);
    font-weight: 700;
    color: var(--text-primary);
    margin: 0;
  }
  .detail-desc {
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    margin: 0;
    line-height: 1.5;
  }
  .detail-meta {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }
  .meta-item {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
  }
  .cat-badge {
    padding: 1px 5px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
  }
  .req-section {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
  }
  .req-label {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    font-weight: 700;
  }
  .req-item {
    font-size: var(--fs-xxs);
    padding: 1px 5px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    color: var(--text-secondary);
    font-family: var(--font-mono);
  }
  .detail-section {
    margin-top: 4px;
  }
  .detail-section h4 {
    font-size: var(--fs-xs);
    font-weight: 700;
    color: var(--text-secondary);
    margin: 0 0 4px;
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
  }
  .prompt-preview {
    font-size: var(--fs-xs);
    font-family: var(--font-mono);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    padding: 8px;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--text-secondary);
    line-height: 1.5;
    max-height: 200px;
    overflow-y: auto;
    margin: 0;
  }
  .rules-list {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    padding-left: 16px;
    margin: 0;
    line-height: 1.6;
  }
  .detail-actions {
    display: flex;
    gap: 6px;
    margin-top: 4px;
    padding-top: 8px;
    border-top: 1px solid var(--border-primary);
  }
  .action-btn {
    font-size: var(--fs-xs);
    padding: 6px 14px;
    border: 1px solid var(--border-secondary);
    background: var(--bg-tertiary);
    color: var(--text-primary);
    font-weight: 700;
    cursor: pointer;
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
    transition: all var(--transition);
  }
  .action-btn:hover {
    background: var(--bg-hover);
  }
  .action-btn.primary {
    background: var(--accent-primary);
    color: var(--bg-primary);
    border-color: var(--accent-primary);
  }
  .action-btn.primary:hover {
    opacity: 0.9;
  }
  .action-btn.danger:hover {
    background: var(--accent-error);
    color: var(--bg-primary);
    border-color: var(--accent-error);
  }
  .action-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  /* Create view */
  .create-view {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .create-progress {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 0;
  }
  .step {
    font-size: var(--fs-xxs);
    font-weight: 700;
    color: var(--text-tertiary);
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
  }
  .step.active {
    color: var(--accent-primary);
  }
  .step-sep {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
  }
  .create-step {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .form-label {
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: var(--fs-xxs);
    font-weight: 700;
    color: var(--text-tertiary);
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
  }
  .form-input {
    font-size: var(--fs-sm);
    padding: 5px 8px;
    background: var(--bg-primary);
    border: 1px solid var(--border-secondary);
    color: var(--text-primary);
    font-family: var(--font-family);
  }
  .form-input:focus {
    border-color: var(--accent-primary);
    outline: none;
  }
  .form-textarea {
    font-size: var(--fs-sm);
    padding: 5px 8px;
    background: var(--bg-primary);
    border: 1px solid var(--border-secondary);
    color: var(--text-primary);
    font-family: var(--font-family);
    resize: vertical;
  }
  .form-textarea:focus {
    border-color: var(--accent-primary);
    outline: none;
  }
  .form-textarea.tall {
    min-height: 120px;
  }
  .step-nav {
    display: flex;
    gap: 6px;
    justify-content: space-between;
  }
  .review-title {
    font-size: var(--fs-sm);
    font-weight: 700;
    color: var(--text-primary);
    margin: 0;
  }
  .review-field {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .review-label {
    font-size: var(--fs-xxs);
    font-weight: 700;
    color: var(--text-tertiary);
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
  }
  .review-value {
    font-size: var(--fs-sm);
    color: var(--text-primary);
  }
  .review-pre {
    font-size: var(--fs-xs);
    font-family: var(--font-mono);
    background: var(--bg-tertiary);
    padding: 6px;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--text-secondary);
    margin: 0;
  }

  /* Common */
  .empty {
    padding: 20px;
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--fs-sm);
  }
  .error {
    padding: 12px;
    text-align: center;
    color: var(--accent-error);
    font-size: var(--fs-sm);
  }
</style>
