<script lang="ts">
  import { profilesStore } from '$lib/stores/profiles.svelte';
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { uiStore } from '$lib/stores/ui.svelte';
  import { skillsStore } from '$lib/stores/skills.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { api } from '$lib/api/client';

  let open = $state(false);
  let dropdownEl = $state<HTMLDivElement | null>(null);

  // Load installed skills on mount
  $effect(() => {
    if (open && skillsStore.installedSkills.length === 0) {
      skillsStore.loadInstalled(settingsStore.workspacePath || undefined);
    }
  });

  /** SVG path data for each profile icon */
  const profileIconPaths: Record<string, string> = {
    write: 'M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z',
    ask: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
    minimal: 'M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6',
  };
  const defaultIconPath = 'M13 2L3 14h9l-1 8 10-12h-9l1-8z';

  async function selectProfile(profileId: string) {
    open = false;
    profilesStore.setActiveProfileId(profileId);

    // Apply profile settings to the active conversation
    const conv = conversationStore.active;
    if (conv) {
      const profile = profilesStore.profiles.find((p) => p.id === profileId);
      if (profile) {
        try {
          await api.conversations.update(conv.id, {
            permissionMode: profile.permissionMode,
            allowedTools: profile.allowedTools,
            disallowedTools: profile.disallowedTools,
            profileId: profile.id,
          });
        } catch (e) {
          console.warn('[ProfileSwitcher] Failed to apply profile to conversation:', e);
        }
      }
    }
  }

  function handleClickOutside(e: MouseEvent) {
    if (dropdownEl && !dropdownEl.contains(e.target as Node)) {
      open = false;
    }
  }

  $effect(() => {
    if (open) {
      document.addEventListener('click', handleClickOutside, true);
      return () => document.removeEventListener('click', handleClickOutside, true);
    }
  });

  const activeProfile = $derived(profilesStore.activeProfile);
</script>

<div class="profile-switcher" bind:this={dropdownEl}>
  <button
    class="profile-btn"
    onclick={() => (open = !open)}
    title="Switch profile (Ctrl+Shift+P)"
    aria-haspopup="listbox"
    aria-expanded={open}
  >
    <svg
      class="profile-icon"
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      ><path d={profileIconPaths[activeProfile?.id ?? 'write'] ?? defaultIconPath} /></svg
    >
    <span class="profile-name">{activeProfile?.name ?? 'Write'}</span>
    <svg
      class="chevron"
      class:rotated={open}
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  </button>

  {#if open}
    <div class="profile-dropdown" role="listbox">
      <div class="dropdown-header">Agent Profile</div>
      {#each profilesStore.profiles as profile (profile.id)}
        <button
          class="profile-option"
          class:active={profile.id === profilesStore.activeProfileId}
          role="option"
          aria-selected={profile.id === profilesStore.activeProfileId}
          onclick={() => selectProfile(profile.id)}
        >
          <svg
            class="option-icon"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><path d={profileIconPaths[profile.id] ?? defaultIconPath} /></svg
          >
          <div class="option-info">
            <span class="option-name">{profile.name}</span>
            {#if profile.description}
              <span class="option-desc">{profile.description}</span>
            {/if}
          </div>
          {#if profile.id === profilesStore.activeProfileId}
            <svg
              class="check"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          {/if}
        </button>
      {/each}

      {#if skillsStore.activatedSkills.length > 0}
        <div class="dropdown-divider"></div>
        <div class="dropdown-header">Active Skills</div>
        {#each skillsStore.activatedSkills.slice(0, 5) as skill (skill.id)}
          <div class="skill-option">
            <svg
              class="option-icon"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg
            >
            <span class="skill-opt-name">{skill.name}</span>
            <button
              class="skill-toggle-btn"
              onclick={() => {
                skillsStore.activate(skill.id, false, settingsStore.workspacePath || undefined);
              }}
              title="Deactivate skill"
            >
              &times;
            </button>
          </div>
        {/each}
      {/if}

      <div class="dropdown-divider"></div>
      <button
        class="manage-profiles-btn"
        onclick={() => {
          open = false;
          uiStore.setSidebarTab('memory');
          uiStore.setSidebarOpen(true);
        }}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
        Skills Marketplace
      </button>
      <div class="dropdown-divider"></div>
      <button
        class="manage-profiles-btn"
        onclick={() => {
          open = false;
          uiStore.openModal('settings');
          // Settings modal will handle switching to profiles tab via localStorage flag
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem('e-settings-tab', 'profiles');
          }
        }}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
          <path
            d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
          />
        </svg>
        Manage Profiles
      </button>
    </div>
  {/if}
</div>

<style>
  .profile-switcher {
    position: relative;
  }

  .profile-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px 10px;
    font-size: var(--fs-sm);
    font-weight: 600;
    letter-spacing: var(--ht-label-spacing);
    border-radius: var(--radius-sm);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    color: var(--accent-primary);
    cursor: pointer;
    transition: all var(--transition);
    text-transform: var(--ht-label-transform);
    white-space: nowrap;
  }
  .profile-btn:hover {
    border-color: var(--accent-primary);
    box-shadow: var(--shadow-glow-sm);
  }

  .profile-icon {
    flex-shrink: 0;
  }

  .profile-name {
    max-width: 80px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .chevron {
    color: var(--text-tertiary);
    transition: transform var(--transition);
    flex-shrink: 0;
  }
  .chevron.rotated {
    transform: rotate(180deg);
  }

  .profile-dropdown {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    min-width: 240px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
    z-index: 200;
    overflow: hidden;
    animation: dropIn 0.12s ease;
  }

  @keyframes dropIn {
    from {
      opacity: 0;
      transform: translateY(-6px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .dropdown-header {
    font-size: var(--fs-xxs);
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-tertiary);
    padding: 10px 12px 6px;
  }

  .profile-option {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 12px;
    text-align: left;
    background: transparent;
    border: none;
    cursor: pointer;
    transition: background var(--transition);
    color: var(--text-primary);
  }
  .profile-option:hover {
    background: var(--bg-hover);
  }
  .profile-option.active {
    background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
  }

  .option-icon {
    flex-shrink: 0;
    width: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .option-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .option-name {
    font-size: var(--fs-base);
    font-weight: 600;
  }

  .option-desc {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .check {
    color: var(--accent-primary);
    flex-shrink: 0;
  }

  .dropdown-divider {
    height: 1px;
    background: var(--border-secondary);
    margin: 6px 0;
  }

  .manage-profiles-btn {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    padding: 8px 12px;
    text-align: left;
    background: transparent;
    border: none;
    cursor: pointer;
    transition: background var(--transition);
    color: var(--text-secondary);
    font-size: var(--fs-sm);
    font-weight: 500;
    margin-bottom: 4px;
  }
  .manage-profiles-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .skill-option {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 5px 12px;
    color: var(--text-secondary);
    font-size: var(--fs-xs);
  }
  .skill-opt-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .skill-toggle-btn {
    background: none;
    border: none;
    color: var(--text-tertiary);
    cursor: pointer;
    font-size: var(--fs-sm);
    padding: 0 4px;
    line-height: 1;
  }
  .skill-toggle-btn:hover {
    color: var(--accent-error);
  }

  /* Mobile: hide profile name, show only icon */
  :global([data-mobile]) .profile-name {
    display: none;
  }
  :global([data-mobile]) .profile-btn {
    padding: 5px 8px;
  }
</style>
