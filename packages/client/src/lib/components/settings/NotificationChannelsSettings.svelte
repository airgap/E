<script lang="ts">
  /**
   * Notification Channels Settings — configure external notification channels.
   */
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import { uiStore } from '$lib/stores/ui.svelte';
  import type {
    NotificationChannel,
    NotificationChannelConfig,
    NotificationChannelType,
    NotificationEventType,
    SlackChannelConfig,
    DiscordChannelConfig,
    TelegramChannelConfig,
    EmailChannelConfig,
    SlackConfig,
    DiscordConfig,
    TelegramConfig,
    EmailConfig,
  } from '@e/shared';

  let channels = $state<NotificationChannel[]>([]);
  let loading = $state(false);
  let showAddModal = $state(false);
  let editingChannel = $state<NotificationChannel | null>(null);

  // Add/Edit form state
  let formName = $state('');
  let formType = $state<NotificationChannelType>('slack');
  let formSlackWebhook = $state('');
  let formDiscordWebhook = $state('');
  let formTelegramBotToken = $state('');
  let formTelegramChatId = $state('');
  let formEmailSmtpHost = $state('');
  let formEmailSmtpPort = $state(587);
  let formEmailSmtpSecure = $state(false);
  let formEmailSmtpUser = $state('');
  let formEmailSmtpPassword = $state('');
  let formEmailFromAddress = $state('');
  let formEmailToAddress = $state('');
  let testingSending = $state(false);

  onMount(() => {
    loadChannels();
  });

  async function loadChannels() {
    loading = true;
    try {
      const res = await api.notificationChannels.list();
      channels = res.data;
    } catch (error: any) {
      uiStore.toast('Failed to load notification channels', 'error');
    }
    loading = false;
  }

  function openAddModal() {
    editingChannel = null;
    resetForm();
    showAddModal = true;
  }

  function openEditModal(channel: NotificationChannel) {
    editingChannel = channel;
    formName = channel.name;
    formType = channel.type;

    // Populate form fields based on channel type
    switch (channel.type) {
      case 'slack':
        formSlackWebhook = (channel.config as SlackChannelConfig).webhookUrl || '';
        break;
      case 'discord':
        formDiscordWebhook = (channel.config as DiscordChannelConfig).webhookUrl || '';
        break;
      case 'telegram':
        formTelegramBotToken = (channel.config as TelegramChannelConfig).botToken || '';
        formTelegramChatId = (channel.config as TelegramChannelConfig).chatId || '';
        break;
      case 'email':
        const emailConfig = channel.config as EmailChannelConfig;
        formEmailSmtpHost = emailConfig.smtpHost || '';
        formEmailSmtpPort = emailConfig.smtpPort || 587;
        formEmailSmtpSecure = emailConfig.smtpSecure || false;
        formEmailSmtpUser = emailConfig.smtpUser || '';
        formEmailSmtpPassword = emailConfig.smtpPassword || '';
        formEmailFromAddress = emailConfig.fromEmail || '';
        formEmailToAddress = emailConfig.toEmail || '';
        break;
    }

    showAddModal = true;
  }

  function closeModal() {
    showAddModal = false;
    editingChannel = null;
    resetForm();
  }

  function resetForm() {
    formName = '';
    formType = 'slack';
    formSlackWebhook = '';
    formDiscordWebhook = '';
    formTelegramBotToken = '';
    formTelegramChatId = '';
    formEmailSmtpHost = '';
    formEmailSmtpPort = 587;
    formEmailSmtpSecure = false;
    formEmailSmtpUser = '';
    formEmailSmtpPassword = '';
    formEmailFromAddress = '';
    formEmailToAddress = '';
  }

  function buildConfig(): SlackConfig | DiscordConfig | TelegramConfig | EmailConfig | null {
    switch (formType) {
      case 'slack':
        if (!formSlackWebhook.trim()) {
          uiStore.toast('Slack webhook URL is required', 'error');
          return null;
        }
        return {
          webhookUrl: formSlackWebhook.trim(),
        };

      case 'discord':
        if (!formDiscordWebhook.trim()) {
          uiStore.toast('Discord webhook URL is required', 'error');
          return null;
        }
        return {
          webhookUrl: formDiscordWebhook.trim(),
        };

      case 'telegram':
        if (!formTelegramBotToken.trim() || !formTelegramChatId.trim()) {
          uiStore.toast('Telegram bot token and chat ID are required', 'error');
          return null;
        }
        return {
          botToken: formTelegramBotToken.trim(),
          chatId: formTelegramChatId.trim(),
        };

      case 'email':
        if (
          !formEmailSmtpHost.trim() ||
          !formEmailSmtpUser.trim() ||
          !formEmailSmtpPassword.trim() ||
          !formEmailFromAddress.trim() ||
          !formEmailToAddress.trim()
        ) {
          uiStore.toast('All email fields are required', 'error');
          return null;
        }
        return {
          smtpHost: formEmailSmtpHost.trim(),
          smtpPort: formEmailSmtpPort,
          smtpSecure: formEmailSmtpSecure,
          smtpUser: formEmailSmtpUser.trim(),
          smtpPassword: formEmailSmtpPassword.trim(),
          fromEmail: formEmailFromAddress.trim(),
          toEmail: formEmailToAddress.trim(),
        };

      default:
        return null;
    }
  }

  async function saveChannel() {
    if (!formName.trim()) {
      uiStore.toast('Channel name is required', 'error');
      return;
    }

    const config = buildConfig();
    if (!config) return;

    try {
      if (editingChannel) {
        await api.notificationChannels.update(editingChannel.id, { name: formName.trim(), config });
        uiStore.toast('Channel updated', 'success');
      } else {
        await api.notificationChannels.create({ name: formName.trim(), type: formType, config });
        uiStore.toast('Channel created', 'success');
      }
      await loadChannels();
      closeModal();
    } catch (error: any) {
      uiStore.toast(error.message || 'Failed to save channel', 'error');
    }
  }

  async function testChannel() {
    const config = buildConfig();
    if (!config) return;

    // Wrap the config with type discriminator for the test endpoint
    const wrappedConfig: NotificationChannelConfig = {
      type: formType,
      config,
    } as NotificationChannelConfig;

    testingSending = true;
    try {
      const res = await api.notificationChannels.test(wrappedConfig);
      if (res.data.success) {
        uiStore.toast('Test notification sent successfully!', 'success');
      } else {
        uiStore.toast(`Test failed: ${res.data.errorDetails || res.data.message}`, 'error');
      }
    } catch (error: any) {
      uiStore.toast(error.message || 'Test failed', 'error');
    }
    testingSending = false;
  }

  async function toggleChannel(channel: NotificationChannel) {
    try {
      await api.notificationChannels.update(channel.id, { enabled: !channel.enabled });
      await loadChannels();
      uiStore.toast(channel.enabled ? 'Channel disabled' : 'Channel enabled', 'success');
    } catch (error: any) {
      uiStore.toast('Failed to update channel', 'error');
    }
  }

  async function deleteChannel(channel: NotificationChannel) {
    if (!confirm(`Delete channel "${channel.name}"?`)) return;

    try {
      await api.notificationChannels.delete(channel.id);
      await loadChannels();
      uiStore.toast('Channel deleted', 'success');
    } catch (error: any) {
      uiStore.toast('Failed to delete channel', 'error');
    }
  }

  function getChannelTypeLabel(type: NotificationChannelType): string {
    switch (type) {
      case 'slack':
        return 'Slack';
      case 'discord':
        return 'Discord';
      case 'telegram':
        return 'Telegram';
      case 'email':
        return 'Email';
      default:
        return type;
    }
  }
</script>

<div class="notification-channels-settings">
  <div class="header">
    <h3>Notification Channels</h3>
    <p class="hint">
      Send agent notifications and approval requests to external messaging channels.
    </p>
  </div>

  {#if loading}
    <div class="loading">Loading channels...</div>
  {:else if channels.length === 0}
    <div class="empty-state">
      <p>No notification channels configured yet.</p>
      <p class="hint">
        Add a channel to receive notifications via Slack, Discord, Telegram, or Email.
      </p>
    </div>
  {:else}
    <div class="channels-list">
      {#each channels as channel (channel.id)}
        <div class="channel-card" class:disabled={!channel.enabled}>
          <div class="channel-header">
            <div class="channel-info">
              <span class="channel-name">{channel.name}</span>
              <span class="channel-type">{getChannelTypeLabel(channel.type)}</span>
            </div>
            <div class="channel-actions">
              <button
                class="toggle-btn"
                class:enabled={channel.enabled}
                onclick={() => toggleChannel(channel)}
                title={channel.enabled ? 'Disable channel' : 'Enable channel'}
              >
                {channel.enabled ? 'Enabled' : 'Disabled'}
              </button>
              <button class="edit-btn" onclick={() => openEditModal(channel)} title="Edit channel">
                Edit
              </button>
              <button
                class="delete-btn"
                onclick={() => deleteChannel(channel)}
                title="Delete channel"
              >
                ×
              </button>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  <button class="add-channel-btn" onclick={openAddModal}>+ Add Channel</button>
</div>

{#if showAddModal}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-overlay" onclick={closeModal}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="modal" onclick={(e) => e.stopPropagation()}>
      <div class="modal-header">
        <h3>{editingChannel ? 'Edit Channel' : 'Add Channel'}</h3>
        <button class="close-btn" onclick={closeModal}>×</button>
      </div>

      <div class="modal-body">
        <div class="form-group">
          <label>Channel Name</label>
          <input type="text" bind:value={formName} placeholder="e.g., My Slack Channel" />
        </div>

        {#if !editingChannel}
          <div class="form-group">
            <label>Channel Type</label>
            <select bind:value={formType}>
              <option value="slack">Slack</option>
              <option value="discord">Discord</option>
              <option value="telegram">Telegram</option>
              <option value="email">Email</option>
            </select>
          </div>
        {/if}

        {#if formType === 'slack'}
          <div class="form-group">
            <label>Incoming Webhook URL</label>
            <input
              type="text"
              bind:value={formSlackWebhook}
              placeholder="https://hooks.slack.com/services/..."
            />
            <p class="hint">
              Create a webhook at <a
                href="https://api.slack.com/messaging/webhooks"
                target="_blank"
                rel="noopener noreferrer">Slack API</a
              >
            </p>
          </div>
        {/if}

        {#if formType === 'discord'}
          <div class="form-group">
            <label>Webhook URL</label>
            <input
              type="text"
              bind:value={formDiscordWebhook}
              placeholder="https://discord.com/api/webhooks/..."
            />
            <p class="hint">
              Create a webhook in your Discord server settings → Integrations → Webhooks
            </p>
          </div>
        {/if}

        {#if formType === 'telegram'}
          <div class="form-group">
            <label>Bot Token</label>
            <input type="text" bind:value={formTelegramBotToken} placeholder="123456:ABC-DEF..." />
            <p class="hint">Create a bot via @BotFather on Telegram</p>
          </div>
          <div class="form-group">
            <label>Chat ID</label>
            <input type="text" bind:value={formTelegramChatId} placeholder="-1001234567890" />
            <p class="hint">
              Use @userinfobot to find your chat ID, or add the bot to a group/channel
            </p>
          </div>
        {/if}

        {#if formType === 'email'}
          <div class="form-group">
            <label>SMTP Host</label>
            <input type="text" bind:value={formEmailSmtpHost} placeholder="smtp.gmail.com" />
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>SMTP Port</label>
              <input type="number" bind:value={formEmailSmtpPort} placeholder="587" />
            </div>
            <div class="form-group">
              <label>
                <input type="checkbox" bind:checked={formEmailSmtpSecure} />
                Use TLS/SSL
              </label>
            </div>
          </div>
          <div class="form-group">
            <label>SMTP Username</label>
            <input type="text" bind:value={formEmailSmtpUser} placeholder="your-email@gmail.com" />
          </div>
          <div class="form-group">
            <label>SMTP Password</label>
            <input type="password" bind:value={formEmailSmtpPassword} placeholder="••••••••" />
          </div>
          <div class="form-group">
            <label>From Address</label>
            <input
              type="email"
              bind:value={formEmailFromAddress}
              placeholder="notifications@example.com"
            />
          </div>
          <div class="form-group">
            <label>To Address</label>
            <input type="email" bind:value={formEmailToAddress} placeholder="you@example.com" />
          </div>
        {/if}
      </div>

      <div class="modal-footer">
        <button class="test-btn" onclick={testChannel} disabled={testingSending}>
          {testingSending ? 'Sending...' : 'Test Send'}
        </button>
        <button class="cancel-btn" onclick={closeModal}>Cancel</button>
        <button class="save-btn" onclick={saveChannel}>
          {editingChannel ? 'Update' : 'Create'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .notification-channels-settings {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
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

  .channels-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .channel-card {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 1rem;
    transition: opacity 0.2s;
  }

  .channel-card.disabled {
    opacity: 0.5;
  }

  .channel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .channel-info {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .channel-name {
    font-weight: 500;
  }

  .channel-type {
    padding: 0.25rem 0.5rem;
    background: var(--bg-subtle);
    border-radius: 4px;
    font-size: 0.75rem;
    color: var(--fg-muted);
  }

  .channel-actions {
    display: flex;
    gap: 0.5rem;
  }

  .toggle-btn {
    padding: 0.375rem 0.75rem;
    background: var(--bg-subtle);
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.875rem;
    transition: all 0.2s;
  }

  .toggle-btn.enabled {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }

  .edit-btn,
  .delete-btn {
    padding: 0.375rem 0.75rem;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.875rem;
    transition: all 0.2s;
  }

  .edit-btn:hover {
    background: var(--bg-subtle);
  }

  .delete-btn:hover {
    background: var(--error);
    color: white;
    border-color: var(--error);
  }

  .add-channel-btn {
    padding: 0.75rem 1.5rem;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 1rem;
    font-weight: 500;
    transition: opacity 0.2s;
    align-self: flex-start;
  }

  .add-channel-btn:hover {
    opacity: 0.9;
  }

  /* Modal styles */
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  }

  .modal {
    background: var(--bg);
    border-radius: 8px;
    width: 90%;
    max-width: 600px;
    max-height: 90vh;
    overflow-y: auto;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.5rem;
    border-bottom: 1px solid var(--border);
  }

  .modal-header h3 {
    margin: 0;
    font-size: 1.25rem;
  }

  .close-btn {
    background: transparent;
    border: none;
    font-size: 1.5rem;
    cursor: pointer;
    color: var(--fg-muted);
    padding: 0;
    width: 2rem;
    height: 2rem;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .modal-body {
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .form-group label {
    font-size: 0.875rem;
    font-weight: 500;
  }

  .form-group input,
  .form-group select {
    padding: 0.5rem;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 0.875rem;
    color: var(--fg);
  }

  .form-group input[type='checkbox'] {
    width: auto;
    margin-right: 0.5rem;
  }

  .form-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }

  .modal-footer {
    padding: 1.5rem;
    border-top: 1px solid var(--border);
    display: flex;
    gap: 0.75rem;
    justify-content: flex-end;
  }

  .test-btn,
  .cancel-btn,
  .save-btn {
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.875rem;
    transition: opacity 0.2s;
  }

  .test-btn {
    background: var(--bg-subtle);
    color: var(--fg);
    margin-right: auto;
  }

  .cancel-btn {
    background: var(--bg-subtle);
    color: var(--fg);
  }

  .save-btn {
    background: var(--accent);
    color: white;
  }

  .test-btn:hover,
  .cancel-btn:hover,
  .save-btn:hover {
    opacity: 0.9;
  }

  .test-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  a {
    color: var(--accent);
    text-decoration: none;
  }

  a:hover {
    text-decoration: underline;
  }
</style>
