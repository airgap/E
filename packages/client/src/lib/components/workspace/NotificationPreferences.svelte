<script lang="ts">
  /**
   * Per-Workspace Notification Preferences
   *
   * Allows users to configure which notification events and channels are enabled
   * for a specific workspace.
   */
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import { uiStore } from '$lib/stores/ui.svelte';
  import { workspaceStore } from '$lib/stores/workspace.svelte';
  import type {
    NotificationChannel,
    NotificationEventType,
    WorkspaceNotificationPreferences,
  } from '@e/shared';

  let workspaceId = $state('');
  let channels = $state<NotificationChannel[]>([]);
  let preferences = $state<WorkspaceNotificationPreferences | null>(null);
  let loading = $state(false);
  let saving = $state(false);

  // Local state for checkbox bindings
  let selectedEvents = $state<Set<NotificationEventType>>(new Set());
  let selectedChannels = $state<Set<string>>(new Set());

  // Event type labels
  const eventLabels: Record<NotificationEventType, { label: string; description: string }> = {
    golem_completion: {
      label: 'Golem Completion',
      description: 'When a loop finishes all stories',
    },
    golem_failure: {
      label: 'Golem Failure',
      description: 'When a loop encounters an error',
    },
    story_completed: {
      label: 'Story Completed',
      description: 'When an individual story is completed',
    },
    story_failed: {
      label: 'Story Failed',
      description: 'When a story fails after all retry attempts',
    },
    approval_needed: {
      label: 'Approval Needed',
      description: 'When a tool needs your approval to run',
    },
    agent_error: {
      label: 'Agent Error',
      description: 'When an agent encounters an error',
    },
    agent_note_created: {
      label: 'Agent Note Created',
      description: 'When an agent leaves a note for you',
    },
  };

  const allEventTypes: NotificationEventType[] = Object.keys(
    eventLabels,
  ) as NotificationEventType[];

  $effect(() => {
    const workspace = workspaceStore.activeWorkspace;
    if (workspace) {
      workspaceId = workspace.workspaceId;
      loadPreferences();
    }
  });

  async function loadPreferences() {
    if (!workspaceId) return;

    loading = true;
    try {
      const [channelsRes, prefsRes] = await Promise.all([
        api.notificationChannels.list(),
        api.notificationChannels.getWorkspacePreferences(workspaceId),
      ]);

      channels = channelsRes.data;
      preferences = prefsRes.data;

      // Sync local state from loaded preferences
      selectedEvents = new Set(preferences?.enabledEvents || []);
      selectedChannels = new Set(preferences?.enabledChannels || []);
    } catch (error: any) {
      uiStore.toast('Failed to load notification preferences', 'error');
    }
    loading = false;
  }

  async function savePreferences() {
    if (!workspaceId) return;

    saving = true;
    try {
      await api.notificationChannels.updateWorkspacePreferences(workspaceId, {
        enabledEvents: Array.from(selectedEvents),
        enabledChannels: Array.from(selectedChannels),
      });
      uiStore.toast('Notification preferences saved', 'success');
      await loadPreferences();
    } catch (error: any) {
      uiStore.toast('Failed to save preferences', 'error');
    }
    saving = false;
  }

  function toggleEvent(event: NotificationEventType) {
    if (selectedEvents.has(event)) {
      selectedEvents.delete(event);
    } else {
      selectedEvents.add(event);
    }
    selectedEvents = new Set(selectedEvents); // Trigger reactivity
  }

  function toggleChannel(channelId: string) {
    if (selectedChannels.has(channelId)) {
      selectedChannels.delete(channelId);
    } else {
      selectedChannels.add(channelId);
    }
    selectedChannels = new Set(selectedChannels); // Trigger reactivity
  }

  function selectAllEvents() {
    selectedEvents = new Set(allEventTypes);
  }

  function deselectAllEvents() {
    selectedEvents = new Set();
  }

  function selectAllChannels() {
    selectedChannels = new Set(channels.filter((c) => c.enabled).map((c) => c.id));
  }

  function deselectAllChannels() {
    selectedChannels = new Set();
  }
</script>

<div class="notification-preferences">
  <div class="header">
    <h3>Workspace Notification Preferences</h3>
    <p class="hint">
      Configure which events trigger notifications for this workspace and which channels to use.
    </p>
  </div>

  {#if loading}
    <div class="loading">Loading preferences...</div>
  {:else if channels.length === 0}
    <div class="empty-state">
      <p>No notification channels configured.</p>
      <p class="hint">
        Set up notification channels in Settings → Notifications before configuring workspace
        preferences.
      </p>
    </div>
  {:else}
    <div class="preferences-content">
      <!-- Event Selection -->
      <div class="section">
        <div class="section-header">
          <h4>Notification Events</h4>
          <div class="quick-actions">
            <button class="link-btn" onclick={selectAllEvents}>Select All</button>
            <span class="separator">•</span>
            <button class="link-btn" onclick={deselectAllEvents}>Deselect All</button>
          </div>
        </div>
        <div class="event-list">
          {#each allEventTypes as event (event)}
            <label class="checkbox-item">
              <input
                type="checkbox"
                checked={selectedEvents.has(event)}
                onchange={() => toggleEvent(event)}
              />
              <div class="checkbox-label">
                <span class="event-label">{eventLabels[event].label}</span>
                <span class="event-description">{eventLabels[event].description}</span>
              </div>
            </label>
          {/each}
        </div>
      </div>

      <!-- Channel Selection -->
      <div class="section">
        <div class="section-header">
          <h4>Notification Channels</h4>
          <div class="quick-actions">
            <button class="link-btn" onclick={selectAllChannels}>Select All</button>
            <span class="separator">•</span>
            <button class="link-btn" onclick={deselectAllChannels}>Deselect All</button>
          </div>
        </div>
        <div class="channel-list">
          {#each channels as channel (channel.id)}
            <label class="checkbox-item" class:disabled={!channel.enabled}>
              <input
                type="checkbox"
                checked={selectedChannels.has(channel.id)}
                disabled={!channel.enabled}
                onchange={() => toggleChannel(channel.id)}
              />
              <div class="checkbox-label">
                <span class="channel-name">{channel.name}</span>
                <span class="channel-type">{channel.type}</span>
                {#if !channel.enabled}
                  <span class="disabled-badge">Disabled</span>
                {/if}
              </div>
            </label>
          {/each}
        </div>
      </div>

      <!-- Save Button -->
      <div class="save-section">
        <button class="save-btn" onclick={savePreferences} disabled={saving}>
          {saving ? 'Saving...' : 'Save Preferences'}
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .notification-preferences {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    padding: 1rem;
  }

  .header h3 {
    margin: 0 0 0.5rem;
    font-size: 1.25rem;
  }

  .hint {
    color: var(--fg-muted);
    font-size: 0.875rem;
    margin: 0;
  }

  .loading,
  .empty-state {
    text-align: center;
    padding: 2rem;
    color: var(--fg-muted);
  }

  .empty-state p {
    margin: 0.5rem 0;
  }

  .preferences-content {
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--border);
  }

  .section-header h4 {
    margin: 0;
    font-size: 1rem;
    font-weight: 500;
  }

  .quick-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
  }

  .link-btn {
    background: transparent;
    border: none;
    color: var(--accent);
    cursor: pointer;
    padding: 0;
    font-size: 0.875rem;
    text-decoration: underline;
  }

  .link-btn:hover {
    opacity: 0.8;
  }

  .separator {
    color: var(--fg-muted);
  }

  .event-list,
  .channel-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .checkbox-item {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.75rem;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.2s;
  }

  .checkbox-item:hover {
    background: var(--bg-subtle);
  }

  .checkbox-item.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .checkbox-item.disabled:hover {
    background: var(--bg-elevated);
  }

  .checkbox-item input[type='checkbox'] {
    margin-top: 0.25rem;
    cursor: pointer;
  }

  .checkbox-item.disabled input[type='checkbox'] {
    cursor: not-allowed;
  }

  .checkbox-label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    flex: 1;
  }

  .event-label,
  .channel-name {
    font-weight: 500;
  }

  .event-description {
    color: var(--fg-muted);
    font-size: 0.875rem;
  }

  .channel-type {
    display: inline-block;
    padding: 0.125rem 0.5rem;
    background: var(--bg-subtle);
    border-radius: 4px;
    font-size: 0.75rem;
    color: var(--fg-muted);
    text-transform: capitalize;
    width: fit-content;
  }

  .disabled-badge {
    display: inline-block;
    padding: 0.125rem 0.5rem;
    background: var(--error);
    color: white;
    border-radius: 4px;
    font-size: 0.75rem;
    width: fit-content;
  }

  .save-section {
    display: flex;
    justify-content: flex-end;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
  }

  .save-btn {
    padding: 0.75rem 1.5rem;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 1rem;
    font-weight: 500;
    transition: opacity 0.2s;
  }

  .save-btn:hover {
    opacity: 0.9;
  }

  .save-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
