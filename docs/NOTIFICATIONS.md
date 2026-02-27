# Multi-Channel Notification Routing

E can send agent notifications, approval requests, and status updates through external messaging channels (Slack, Discord, Telegram, Email). This enables lightweight interaction with E when away from the desktop.

## Features

### Supported Channels

- **Slack** - via incoming webhook URLs
- **Discord** - via webhook URLs
- **Telegram** - via bot token and chat ID
- **Email** - via SMTP configuration

### Notification Events

E can send notifications for the following events:

- **Golem Completion** - When a loop finishes all stories
- **Golem Failure** - When a loop fails or encounters an error
- **Approval Needed** - When an agent needs approval for a tool action
- **Story Completed** - When a story finishes successfully
- **Story Failed** - When a story fails after all retry attempts
- **Agent Error** - When an agent encounters an unexpected error
- **Agent Note Created** - When an agent leaves a note for the user

### Interactive Action Buttons

For Slack and Discord, approval request notifications include interactive action buttons:

- **Approve** - Approves the pending tool action
- **Reject** - Rejects the pending tool action

The action buttons link back to E's web interface to handle the approval.

## Configuration

### Setting Up Notification Channels

1. Open **Settings** → **Notifications** tab
2. Click **+ Add Channel**
3. Choose your channel type (Slack, Discord, Telegram, or Email)
4. Enter the required configuration details
5. Click **Test Send** to verify the channel works
6. Click **Create** to save the channel

#### Slack Setup

1. Create an incoming webhook at https://api.slack.com/messaging/webhooks
2. Copy the webhook URL
3. Paste it into the "Incoming Webhook URL" field in E

#### Discord Setup

1. In your Discord server, go to **Server Settings** → **Integrations** → **Webhooks**
2. Create a new webhook for the channel you want to receive notifications
3. Copy the webhook URL
4. Paste it into E

#### Telegram Setup

1. Create a bot using [@BotFather](https://t.me/BotFather) on Telegram
2. Copy the bot token
3. Get your chat ID using [@userinfobot](https://t.me/userinfobot) or add the bot to a group/channel
4. Enter both values in E

#### Email Setup

1. Get your SMTP server details (host, port, username, password)
2. For Gmail: use `smtp.gmail.com`, port `587`, and an [App Password](https://myaccount.google.com/apppasswords)
3. Enter all SMTP details in E
4. Specify the "from" and "to" email addresses

### Per-Workspace Notification Preferences

You can configure which events trigger notifications for each workspace:

1. In **Settings** → **Notifications**, click **⚙️ Workspace Preferences**
2. Select which **Events to Notify** for this workspace
3. Select which **Channels to Use** for this workspace
4. Click **Save Preferences**

If workspace preferences are not configured, notifications will be sent for all events to all enabled channels.

## Architecture

### Backend Components

#### Services

- **`notification-channels.ts`** - CRUD operations for notification channels, workspace preferences, and logging
- **`notification-event-handler.ts`** - Helper functions for sending typed notifications

#### Routes

- **`/api/notification-channels`** - REST API for managing channels
  - `GET /` - List all channels
  - `POST /` - Create a new channel
  - `GET /:id` - Get a specific channel
  - `PATCH /:id` - Update a channel
  - `DELETE /:id` - Delete a channel
  - `POST /test` - Test a channel configuration
  - `POST /send` - Send a notification
  - `GET /workspace/:id/preferences` - Get workspace notification preferences
  - `PUT /workspace/:id/preferences` - Update workspace notification preferences
  - `GET /logs` - Get notification delivery logs

#### Database Tables

```sql
-- Notification channels configuration
CREATE TABLE notification_channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL, -- 'slack' | 'discord' | 'telegram' | 'email'
  config TEXT NOT NULL, -- JSON config (webhook URL, bot token, SMTP details, etc.)
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Per-workspace notification preferences
CREATE TABLE workspace_notification_preferences (
  workspace_id TEXT PRIMARY KEY,
  enabled_events TEXT NOT NULL, -- JSON array of NotificationEventType
  enabled_channels TEXT NOT NULL, -- JSON array of channel IDs
  updated_at INTEGER NOT NULL
);

-- Notification delivery logs
CREATE TABLE notification_logs (
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
);
```

### Frontend Components

- **`NotificationChannelsSettings.svelte`** - UI for managing notification channels in Settings modal
- **API Client** - `api.notificationChannels.*` methods in `client.ts`

### Notification Triggers

Notifications are automatically sent when events occur:

1. **Loop/Golem Events** - Triggered in `loop/runner.ts`:
   - `golem_completion` - When a loop finishes all stories successfully
   - `golem_failure` - When a loop fails or encounters an error

2. **Story Events** - Triggered in `loop/runner.ts`:
   - `story_completed` - When a story passes quality checks and is committed
   - `story_failed` - When a story fails after all retry attempts

3. **Agent Notes** - Triggered in `loop/runner.ts`:
   - `agent_note_created` - When an agent creates a note for the user

4. **Tool Approvals** - Triggered in `claude-process/manager.ts`:
   - `approval_needed` - When an agent requests approval for a tool action

5. **Agent Errors** - Can be sent via `notifyAgentError()` helper function

## Usage Examples

### Programmatic Sending (Server-Side)

```typescript
import { sendNotification } from '../services/notification-channels';

// Send a simple notification
await sendNotification({
  event: 'story_completed',
  title: 'Story Completed',
  message: 'User authentication flow is now complete!',
  workspaceId: '/path/to/workspace',
  conversationId: 'conv-123',
  storyId: 'story-456',
});

// Send a notification with action buttons (for Slack/Discord)
await sendNotification({
  event: 'approval_needed',
  title: 'Approval Needed',
  message: 'Agent wants to run: git push origin main',
  workspaceId: '/path/to/workspace',
  conversationId: 'conv-123',
  actions: [
    {
      id: 'approve',
      label: 'Approve',
      style: 'primary',
      callbackUrl: 'https://e.local/api/approvals/abc123?action=approve',
    },
    {
      id: 'reject',
      label: 'Reject',
      style: 'danger',
      callbackUrl: 'https://e.local/api/approvals/abc123?action=reject',
    },
  ],
});
```

### API Examples

```bash
# List all notification channels
curl http://localhost:3002/api/notification-channels

# Create a Slack channel
curl -X POST http://localhost:3002/api/notification-channels \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Team Slack",
    "type": "slack",
    "config": {
      "webhookUrl": "https://hooks.slack.com/services/..."
    }
  }'

# Test a channel configuration
curl -X POST http://localhost:3002/api/notification-channels/test \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "type": "slack",
      "webhookUrl": "https://hooks.slack.com/services/..."
    }
  }'

# Update workspace notification preferences
curl -X PUT http://localhost:3002/api/notification-channels/workspace/ws-123/preferences \
  -H "Content-Type: application/json" \
  -d '{
    "enabledEvents": ["approval_needed", "story_completed", "story_failed"],
    "enabledChannels": ["ch-slack-1", "ch-discord-2"]
  }'

# Get notification delivery logs
curl http://localhost:3002/api/notification-channels/logs?limit=50
```

## Security Considerations

1. **API Credentials** - Webhook URLs, bot tokens, and SMTP passwords are stored in the database and never sent to the client
2. **Workspace Isolation** - Notifications include workspace context to support multi-workspace setups
3. **CSRF Protection** - All mutation endpoints require CSRF tokens
4. **Rate Limiting** - Consider implementing rate limiting for notification channels to prevent spam

## Troubleshooting

### Notifications Not Being Sent

1. Check that the channel is **enabled** (green toggle in Settings)
2. Verify the channel configuration is correct using the **Test Send** button
3. Check the **notification logs** via API: `GET /api/notification-channels/logs`
4. Ensure workspace preferences include the desired events and channels

### Slack/Discord Action Buttons Not Working

1. Verify the approval callback URLs are accessible from the internet (for remote Slack/Discord servers)
2. Check that the approval flow is implemented on the E server side
3. For local development, use a tunnel service like ngrok to expose E publicly

### Email Notifications Not Sending

1. Verify SMTP credentials are correct
2. For Gmail, ensure you're using an [App Password](https://myaccount.google.com/apppasswords), not your main password
3. Check firewall/network rules allow outbound SMTP connections
4. Try enabling "Less secure app access" if using older email providers

## Future Enhancements

- **Two-Way Communication** - Full conversational support through messaging apps (inspired by OpenClaw's 14+ channel integration)
- **Custom Templates** - User-defined notification message templates
- **Notification Throttling** - Configurable rate limits and batching to prevent spam
- **Rich Media** - Include code snippets, diffs, or screenshots in notifications
- **Mobile Push** - Native mobile app notifications
- **Voice Calls** - Phone call notifications for critical events (PagerDuty-style)
- **Notification Rules** - Advanced filtering and routing based on event properties
