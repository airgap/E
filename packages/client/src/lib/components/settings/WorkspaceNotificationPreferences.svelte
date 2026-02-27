<script lang="ts">
  /**
   * Workspace Notification Preferences — configure which events and channels
   * trigger notifications for a specific workspace.
   */
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import { uiStore } from '$lib/stores/ui.svelte';
  import type {
    WorkspaceNotificationPreferences,
    NotificationChannel,
    NotificationEventType,
  } from '@e/shared';

  interface Props {
    workspaceId: string;
    workspaceName: string;
  }

  let { workspaceId, workspaceName }: Props = $props();

  let preferences = $state<WorkspaceNotificationPreferences>({
    workspaceId,
    enabledEvents: [],
    enabledChannels: [],
    updatedAt: Date.now(),
  });

  let channels = $state<NotificationChannel[]>([]);
  let loading = $state(false);
  let saving = $state(false);

  const eventOptions: { value: NotificationEventType; label: string; description: string }[] = [
    {
      value: 'golem_completion',
      label: 'Golem Completion',
      description: 'When a loop completes all stories',
    },
    {
      value: 'golem_failure',
      label: 'Golem Failure',
      description: 'When a loop fails or encounters an error',
    },
    {
      value: 'story_completed',
      label: 'Story Completed',
      description: 'When an individual story is completed',
    },
    {
      value: 'story_failed',
      label: 'Story Failed',
      description: 'When a story fails after max attempts',
    },
    {
      value: 'approval_needed',
      label: 'Approval Needed',
      description: 'When a tool requires your approval',
    },
    {
      value: 'agent_error',
      label: 'Agent Error',
      description: 'When an agent encounters an error',
    },
    {
      value: 'agent_note_created',
      label: 'Agent Note Created',
      description: 'When an agent leaves a note for you',
    },
  ];

  onMount(() => {
    loadPreferences();
    loadChannels();
  });

  async function loadPreferences() {
    loading = true;
    try {
      const res = await api.notificationChannels.getWorkspacePreferences(workspaceId);
      preferences = res.data;
    } catch (error: any) {
      console.error('Failed to load notification preferences:', error);
    }
    loading = false;
  }

  async function loadChannels() {
    try {
      const res = await api.notificationChannels.list();
      channels = res.data.filter((c) => c.enabled);
    } catch (error: any) {
      console.error('Failed to load channels:', error);
    }
  }

  async function savePreferences() {
    saving = true;
    try {
      await api.notificationChannels.updateWorkspacePreferences(workspaceId, {
        enabledEvents: preferences.enabledEvents,
        enabledChannels: preferences.enabledChannels,
      });
      uiStore.toast('Notification preferences saved', 'success');
    } catch (error: any) {
      uiStore.toast(error.message || 'Failed to save preferences', 'error');
    }
    saving = false;
  }

  function toggleEvent(event: NotificationEventType) {
    if (preferences.enabledEvents.includes(event)) {
      preferences.enabledEvents = preferences.enabledEvents.filter((e) => e !== event);
    } else {
      preferences.enabledEvents = [...preferences.enabledEvents, event];
    }
  }

  function toggleChannel(channelId: string) {
    if (preferences.enabledChannels.includes(channelId)) {
      preferences.enabledChannels = preferences.enabledChannels.filter((id) => id !== channelId);
    } else {
      preferences.enabledChannels = [...preferences.enabledChannels, channelId];
    }
  }
</script>

<div class="workspace-notification-preferences">
  <div class="header">
    <h3>Notification Preferences for {workspaceName}</h3>
    <p class="hint">
      Choose which events trigger notifications and which channels to send them to.
    </p>
  </div>

  {#if loading}
    <div class="loading">Loading preferences...</div>
  {:else}
    <div class="preferences-content">
      <section class="events-section">
        <h4>Events to Notify</h4>
        <p class="section-hint">Select which events should trigger notifications:</p>

        <div class="options-list">
          {#each eventOptions as option (option.value)}
            <label class="option-item">
              <input
                type="checkbox"
                checked={preferences.enabledEvents.includes(option.value)}
                onchange={() => toggleEvent(option.value)}
              />
              <div class="option-details">
                <span class="option-label">{option.label}</span>
                <span class="option-description">{option.description}</span>
              </div>
            </label>
          {/each}
        </div>
      </section>

      <section class="channels-section">
        <h4>Notification Channels</h4>
        <p class="section-hint">Select which channels should receive notifications:</p>

        {#if channels.length === 0}
          <div class="empty-state">
            <p>No notification channels configured yet.</p>
            <p class="hint">Configure channels in Settings → Notifications.</p>
          </div>
        {:else}
          <div class="options-list">
            {#each channels as channel (channel.id)}
              <label class="option-item">
                <input
                  type="checkbox"
                  checked={preferences.enabledChannels.includes(channel.id)}
                  onchange={() => toggleChannel(channel.id)}
                />
                <div class="option-details">
                  <span class="option-label">{channel.name}</span>
                  <span class="option-description">{channel.type}</span>
                </div>
              </label>
            {/each}
          </div>
        {/if}
      </section>
    </div>

    <div class="actions">
      <button class="save-btn" onclick={savePreferences} disabled={saving}>
        {saving ? 'Saving...' : 'Save Preferences'}
      </button>
    </div>
  {/if}
</div>

<style>
  .workspace-notification-preferences {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .header h3 {
    margin: 0 0 0.5rem;
    font-size: 1.125rem;
  }

  .hint,
  .section-hint {
    color: var(--fg-muted);
    font-size: 0.875rem;
    margin: 0 0 1rem;
  }

  .loading {
    text-align: center;
    padding: 2rem;
    color: var(--fg-muted);
  }

  .preferences-content {
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }

  section h4 {
    margin: 0 0 0.5rem;
    font-size: 1rem;
    font-weight: 500;
  }

  .options-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .option-item {
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

  .option-item:hover {
    background: var(--bg-subtle);
  }

  .option-item input[type='checkbox'] {
    margin-top: 0.25rem;
    cursor: pointer;
  }

  .option-details {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    flex: 1;
  }

  .option-label {
    font-weight: 500;
  }

  .option-description {
    font-size: 0.875rem;
    color: var(--fg-muted);
  }

  .empty-state {
    text-align: center;
    padding: 2rem;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--fg-muted);
  }

  .empty-state p {
    margin: 0.5rem 0;
  }

  .empty-state a {
    color: var(--accent);
    text-decoration: none;
  }

  .empty-state a:hover {
    text-decoration: underline;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
  }

  .save-btn {
    padding: 0.625rem 1.25rem;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.875rem;
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
