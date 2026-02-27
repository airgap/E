/**
 * Multi-channel notification routing types and interfaces.
 *
 * Enables E to send agent notifications, approval requests, and status updates
 * through external messaging channels (Slack, Discord, Telegram, Email).
 */

export type NotificationChannelType = 'slack' | 'discord' | 'telegram' | 'email';

export type NotificationEventType =
  | 'golem_completion'
  | 'golem_failure'
  | 'approval_needed'
  | 'story_completed'
  | 'story_failed'
  | 'agent_error'
  | 'agent_note_created'
  | 'budget_warning'
  | 'budget_exceeded'
  | 'daily_cost_summary';

export interface SlackConfig {
  webhookUrl: string;
}

export interface DiscordConfig {
  webhookUrl: string;
}

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export interface EmailConfig {
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassword: string;
  fromEmail: string;
  toEmail: string;
}

export type NotificationChannelConfig =
  | { type: 'slack'; config: SlackConfig }
  | { type: 'discord'; config: DiscordConfig }
  | { type: 'telegram'; config: TelegramConfig }
  | { type: 'email'; config: EmailConfig };

export interface NotificationChannel {
  id: string;
  name: string;
  type: NotificationChannelType;
  config: SlackConfig | DiscordConfig | TelegramConfig | EmailConfig;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceNotificationPreferences {
  workspaceId: string;
  enabledEvents: NotificationEventType[];
  enabledChannels: string[]; // Channel IDs
  updatedAt: number;
}

export interface NotificationLog {
  id: string;
  channelId: string;
  event: NotificationEventType;
  title: string;
  message: string;
  success: boolean;
  errorMessage?: string;
  sentAt: number;
  workspaceId?: string;
  conversationId?: string;
  storyId?: string;
}

export interface SendNotificationRequest {
  event: NotificationEventType;
  title: string;
  message: string;
  workspaceId?: string;
  conversationId?: string;
  storyId?: string;
  /** Optional: specific channels to send to (overrides workspace preferences) */
  channelIds?: string[];
  /** Optional: action buttons for Slack/Discord (approval flow) */
  actions?: NotificationAction[];
}

export interface NotificationAction {
  id: string;
  label: string;
  style?: 'primary' | 'danger' | 'default';
  /** Callback URL that will be invoked when the action is clicked */
  url: string;
}

export interface NotificationTestRequest {
  channelId: string;
}

export interface NotificationTestResponse {
  success: boolean;
  error?: string;
}

// Type aliases for consistency with server code
export type SlackChannelConfig = SlackConfig;
export type DiscordChannelConfig = DiscordConfig;
export type TelegramChannelConfig = TelegramConfig;
export type EmailChannelConfig = EmailConfig;
export type NotificationSendInput = SendNotificationRequest;

export interface NotificationTestResult {
  success: boolean;
  message: string;
  deliveredAt?: number;
  errorDetails?: string;
}

export interface NotificationChannelCreateInput {
  name: string;
  type: NotificationChannelType;
  config: SlackConfig | DiscordConfig | TelegramConfig | EmailConfig;
}

export interface NotificationChannelUpdateInput {
  name?: string;
  config?: SlackConfig | DiscordConfig | TelegramConfig | EmailConfig;
  enabled?: boolean;
}
