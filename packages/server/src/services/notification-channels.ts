/**
 * Multi-Channel Notification Service
 *
 * Handles sending notifications through Slack, Discord, Telegram, and Email.
 */

import type {
  NotificationChannel,
  NotificationChannelConfig,
  NotificationSendInput,
  NotificationTestResult,
  SlackChannelConfig,
  DiscordChannelConfig,
  TelegramChannelConfig,
  EmailChannelConfig,
  WorkspaceNotificationPreferences,
} from '@e/shared';
import { getDb } from '../db/database.js';
import { nanoid } from 'nanoid';

/**
 * Initialize notification channels table
 */
export function ensureNotificationChannelsTable() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS notification_channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      config TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_notification_preferences (
      workspace_id TEXT PRIMARY KEY,
      enabled_events TEXT NOT NULL,
      enabled_channels TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS notification_logs (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      event TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      success INTEGER NOT NULL,
      error_message TEXT,
      sent_at INTEGER NOT NULL,
      workspace_id TEXT,
      conversation_id TEXT,
      story_id TEXT
    )
  `);
}

/**
 * List all notification channels
 */
export function listNotificationChannels(): NotificationChannel[] {
  ensureNotificationChannelsTable();
  const db = getDb();

  const rows = db
    .query('SELECT * FROM notification_channels ORDER BY created_at DESC')
    .all() as any[];

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    config: JSON.parse(row.config),
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/**
 * Get a notification channel by ID
 */
export function getNotificationChannel(id: string): NotificationChannel | null {
  ensureNotificationChannelsTable();
  const db = getDb();

  const row = db.query('SELECT * FROM notification_channels WHERE id = ?').get(id) as any;

  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    type: row.type,
    config: JSON.parse(row.config),
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Create a new notification channel
 */
export function createNotificationChannel(
  name: string,
  type: string,
  config: SlackChannelConfig | DiscordChannelConfig | TelegramChannelConfig | EmailChannelConfig,
): NotificationChannel {
  ensureNotificationChannelsTable();
  const db = getDb();

  const id = nanoid();
  const now = Date.now();

  db.query(
    `INSERT INTO notification_channels (id, name, type, config, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)`,
  ).run(id, name, type, JSON.stringify(config), now, now);

  return {
    id,
    name,
    type: type as any,
    config,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Update a notification channel
 */
export function updateNotificationChannel(
  id: string,
  updates: {
    name?: string;
    config?: SlackChannelConfig | DiscordChannelConfig | TelegramChannelConfig | EmailChannelConfig;
    enabled?: boolean;
  },
): void {
  ensureNotificationChannelsTable();
  const db = getDb();

  const sets: string[] = [];
  const values: any[] = [];

  if (updates.name !== undefined) {
    sets.push('name = ?');
    values.push(updates.name);
  }

  if (updates.config !== undefined) {
    sets.push('config = ?');
    values.push(JSON.stringify(updates.config));
  }

  if (updates.enabled !== undefined) {
    sets.push('enabled = ?');
    values.push(updates.enabled ? 1 : 0);
  }

  sets.push('updated_at = ?');
  values.push(Date.now());

  values.push(id);

  db.query(`UPDATE notification_channels SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

/**
 * Delete a notification channel
 */
export function deleteNotificationChannel(id: string): void {
  ensureNotificationChannelsTable();
  const db = getDb();

  db.query('DELETE FROM notification_channels WHERE id = ?').run(id);
}

/**
 * Get workspace notification preferences
 */
export function getWorkspaceNotificationPreferences(
  workspaceId: string,
): WorkspaceNotificationPreferences {
  ensureNotificationChannelsTable();
  const db = getDb();

  const row = db
    .query('SELECT * FROM workspace_notification_preferences WHERE workspace_id = ?')
    .get(workspaceId) as any;

  if (!row) {
    return {
      workspaceId,
      enabledEvents: [],
      enabledChannels: [],
      updatedAt: Date.now(),
    };
  }

  return {
    workspaceId,
    enabledEvents: JSON.parse(row.enabled_events),
    enabledChannels: JSON.parse(row.enabled_channels),
    updatedAt: row.updated_at,
  };
}

/**
 * Update workspace notification preferences
 */
export function updateWorkspaceNotificationPreferences(
  prefs: WorkspaceNotificationPreferences,
): void {
  ensureNotificationChannelsTable();
  const db = getDb();

  db.query(
    `INSERT INTO workspace_notification_preferences (workspace_id, enabled_events, enabled_channels, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(workspace_id) DO UPDATE SET
       enabled_events = excluded.enabled_events,
       enabled_channels = excluded.enabled_channels,
       updated_at = excluded.updated_at`,
  ).run(
    prefs.workspaceId,
    JSON.stringify(prefs.enabledEvents),
    JSON.stringify(prefs.enabledChannels),
    Date.now(),
  );
}

/**
 * Send a notification to a Slack channel
 */
async function sendSlackNotification(
  config: SlackChannelConfig,
  input: NotificationSendInput,
): Promise<void> {
  const payload: any = {
    text: input.title,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: input.title,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: input.message,
        },
      },
    ],
  };

  // Add action buttons if provided
  if (input.actions && input.actions.length > 0) {
    const buttons = input.actions.map((action) => ({
      type: 'button',
      text: {
        type: 'plain_text',
        text: action.label,
      },
      action_id: action.id,
      value: action.id,
      style:
        action.style === 'primary' ? 'primary' : action.style === 'danger' ? 'danger' : undefined,
    }));

    payload.blocks.push({
      type: 'actions',
      elements: buttons,
    });
  }

  const response = await fetch(config.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Slack webhook failed: ${response.status} ${response.statusText}`);
  }
}

/**
 * Send a notification to a Discord channel
 */
async function sendDiscordNotification(
  config: DiscordChannelConfig,
  input: NotificationSendInput,
): Promise<void> {
  const payload: any = {
    username: 'E Agent',
    embeds: [
      {
        title: input.title,
        description: input.message,
        color:
          input.event.includes('failed') || input.event === 'agent_error' ? 0xff0000 : 0x00ff00,
        timestamp: new Date().toISOString(),
      },
    ],
  };

  // Add action buttons if provided
  if (input.actions && input.actions.length > 0) {
    const buttons = input.actions.map((action) => ({
      type: 2, // Button type
      style: action.style === 'primary' ? 1 : action.style === 'danger' ? 4 : 2,
      label: action.label,
      custom_id: action.id,
    }));

    payload.components = [
      {
        type: 1, // Action row
        components: buttons,
      },
    ];
  }

  const response = await fetch(config.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Discord webhook failed: ${response.status} ${response.statusText}`);
  }
}

/**
 * Send a notification to Telegram
 */
async function sendTelegramNotification(
  config: TelegramChannelConfig,
  input: NotificationSendInput,
): Promise<void> {
  const message = `*${input.title}*\n\n${input.message}`;

  const payload: any = {
    chat_id: config.chatId,
    text: message,
    parse_mode: 'Markdown',
  };

  // Add inline keyboard for actions if provided
  if (input.actions && input.actions.length > 0) {
    const buttons = input.actions.map((action) => [
      {
        text: action.label,
        callback_data: action.id,
      },
    ]);

    payload.reply_markup = {
      inline_keyboard: buttons,
    };
  }

  const response = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Telegram API failed: ${response.status} ${error}`);
  }
}

/**
 * Send a notification via Email
 */
async function sendEmailNotification(
  config: EmailChannelConfig,
  input: NotificationSendInput,
): Promise<void> {
  // Use nodemailer for email sending
  const nodemailer = await import('nodemailer');

  const transporter = nodemailer.default.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth: {
      user: config.smtpUser,
      pass: config.smtpPassword,
    },
  });

  let html = `
    <h2>${input.title}</h2>
    <p>${input.message.replace(/\n/g, '<br>')}</p>
  `;

  // Add action buttons as links if provided
  if (input.actions && input.actions.length > 0) {
    html += '<br><br>';
    for (const action of input.actions) {
      const buttonStyle =
        action.style === 'primary'
          ? 'background-color: #007bff; color: white;'
          : action.style === 'danger'
            ? 'background-color: #dc3545; color: white;'
            : 'background-color: #6c757d; color: white;';

      html += `<a href="${action.url || '#'}" style="display: inline-block; padding: 10px 20px; margin-right: 10px; ${buttonStyle} text-decoration: none; border-radius: 4px;">${action.label}</a>`;
    }
  }

  await transporter.sendMail({
    from: config.fromEmail,
    to: config.toEmail,
    subject: input.title,
    html,
  });
}

/**
 * Send a notification through a specific channel
 */
async function sendToChannel(
  channel: NotificationChannel,
  input: NotificationSendInput,
): Promise<void> {
  if (!channel.enabled) {
    throw new Error('Channel is disabled');
  }

  switch (channel.type) {
    case 'slack':
      await sendSlackNotification(channel.config as SlackChannelConfig, input);
      break;
    case 'discord':
      await sendDiscordNotification(channel.config as DiscordChannelConfig, input);
      break;
    case 'telegram':
      await sendTelegramNotification(channel.config as TelegramChannelConfig, input);
      break;
    case 'email':
      await sendEmailNotification(channel.config as EmailChannelConfig, input);
      break;
    default:
      throw new Error(`Unknown channel type: ${channel.type}`);
  }
}

/**
 * Send a notification through all enabled channels for a workspace
 */
export async function sendNotification(input: NotificationSendInput): Promise<void> {
  ensureNotificationChannelsTable();

  const allChannels = listNotificationChannels();
  const enabledChannels = allChannels.filter((c) => c.enabled);

  // Filter by workspace preferences if workspace is specified
  let targetChannels = enabledChannels;
  if (input.workspaceId) {
    const prefs = getWorkspaceNotificationPreferences(input.workspaceId);

    // Check if this event is enabled for the workspace
    if (!prefs.enabledEvents.includes(input.event)) {
      return; // Event not enabled for this workspace
    }

    // Filter channels to only those enabled for this workspace
    targetChannels = enabledChannels.filter((c) => prefs.enabledChannels.includes(c.id));
  }

  // Send to all target channels
  for (const channel of targetChannels) {
    try {
      await sendToChannel(channel, input);
      logNotification(channel.id, input, true, null);
    } catch (error: any) {
      console.error(`Failed to send notification to channel ${channel.name}:`, error);
      logNotification(channel.id, input, false, error.message);
    }
  }
}

/**
 * Test a notification channel configuration
 */
export async function testNotificationChannel(
  config: SlackChannelConfig | DiscordChannelConfig | TelegramChannelConfig | EmailChannelConfig,
  type: string,
): Promise<NotificationTestResult> {
  const testInput: NotificationSendInput = {
    event: 'story_completed',
    title: 'Test Notification',
    message:
      'This is a test notification from E. If you see this, the channel is configured correctly!',
  };

  const tempChannel: NotificationChannel = {
    id: 'test',
    name: 'Test',
    type: type as any,
    config,
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  try {
    await sendToChannel(tempChannel, testInput);
    return {
      success: true,
      message: 'Test notification sent successfully!',
      deliveredAt: Date.now(),
    };
  } catch (error: any) {
    return {
      success: false,
      message: 'Failed to send test notification',
      errorDetails: error.message,
    };
  }
}

/**
 * Log a notification delivery attempt
 */
function logNotification(
  channelId: string,
  input: NotificationSendInput,
  success: boolean,
  errorMessage: string | null,
): void {
  const db = getDb();

  db.query(
    `INSERT INTO notification_logs (id, channel_id, event, title, message, success, error_message, sent_at, workspace_id, conversation_id, story_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    nanoid(),
    channelId,
    input.event,
    input.title,
    input.message,
    success ? 1 : 0,
    errorMessage,
    Date.now(),
    input.workspaceId || null,
    input.conversationId || null,
    input.storyId || null,
  );
}

/**
 * Get notification logs (for debugging/monitoring)
 */
export function getNotificationLogs(limit = 50) {
  ensureNotificationChannelsTable();
  const db = getDb();

  const rows = db
    .query('SELECT * FROM notification_logs ORDER BY sent_at DESC LIMIT ?')
    .all(limit) as any[];

  return rows.map((row) => ({
    id: row.id,
    channelId: row.channel_id,
    event: row.event,
    title: row.title,
    message: row.message,
    success: row.success === 1,
    errorMessage: row.error_message,
    sentAt: row.sent_at,
    workspaceId: row.workspace_id,
    conversationId: row.conversation_id,
    storyId: row.story_id,
  }));
}
