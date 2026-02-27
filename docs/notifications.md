# Multi-Channel Notification Routing

Allow E to send agent notifications, approval requests, and status updates through external messaging channels (Slack, Discord, Telegram, Email).

## Features Implemented

### 1. Notification Channels

Support for 4 notification channel types:

- **Slack**: Via incoming webhook URL
- **Discord**: Via webhook URL
- **Telegram**: Via bot API (bot token + chat ID)
- **Email**: Via SMTP configuration

### 2. Notification Events

Configurable notification triggers:

- `golem_completed` - Loop completion
- `golem_failed` - Loop failure
- `story_completed` - Individual story completion
- `story_failed` - Individual story failure
- `approval_needed` - Tool approval requests (with action buttons)
- `agent_error` - Agent errors

### 3. Channel Management UI

**Settings → Notifications tab:**

- Add/edit/delete notification channels
- Enable/disable channels
- Test-send functionality for each channel
- Supports action buttons for approval requests (Slack/Discord)

### 4. Per-Workspace Preferences

**Workspace notification preferences:**

- Configure which events trigger notifications per workspace
- Select which channels receive notifications per workspace
- Accessible via Manager View workspace context

### 5. Automatic Integration

**Client-side integration:**

- `LoopNotifications.svelte` automatically sends notifications to configured channels
- Desktop notifications and external notifications work in parallel
- Silently fails if external notifications fail (doesn't interrupt UX)

**Server-side integration:**

- Approval requests automatically include action buttons (Slack/Discord)
- Notifications routed through workspace preferences
- Delivery logging for debugging/monitoring

## API Endpoints

### Notification Channels

- `GET /api/notification-channels` - List all channels
- `POST /api/notification-channels` - Create channel
- `PATCH /api/notification-channels/:id` - Update channel
- `DELETE /api/notification-channels/:id` - Delete channel
- `POST /api/notification-channels/test` - Test configuration

### Workspace Preferences

- `GET /api/notification-channels/workspace/:id/preferences` - Get preferences
- `PUT /api/notification-channels/workspace/:id/preferences` - Update preferences

### Sending Notifications

- `POST /api/notification-channels/send` - Send notification
- `GET /api/notification-channels/logs` - View delivery logs

## Database Schema

### Tables Created

- `notification_channels` - Channel configurations
- `workspace_notification_preferences` - Per-workspace settings
- `notification_logs` - Delivery history

## Usage

### 1. Configure a Channel

1. Open Settings → Notifications
2. Click "Add Channel"
3. Enter name and select type
4. Configure channel-specific settings:
   - **Slack**: Webhook URL from Slack API
   - **Discord**: Webhook URL from server settings
   - **Telegram**: Bot token + chat ID
   - **Email**: SMTP credentials
5. Click "Test Send" to verify
6. Click "Create"

### 2. Configure Workspace Preferences

1. Open Manager View
2. Select workspace
3. Open notification preferences
4. Select which events to enable
5. Select which channels to use
6. Save preferences

### 3. Receive Notifications

Notifications are sent automatically when:

- Loops complete or fail
- Stories complete or fail
- Agents request approvals (with approve/reject buttons)
- Agents encounter errors

## Technical Details

### Notification Flow

```
Event → LoopNotifications.svelte → api.notificationChannels.send() →
→ Server routes → notification-channels service →
→ Check workspace preferences → Send to enabled channels →
→ Log delivery result
```

### Action Buttons (Slack/Discord)

Approval requests include interactive buttons:

- **Approve** button (primary style)
- **Reject** button (danger style)
- Buttons link to approval callback URLs

### Error Handling

- Failed deliveries are logged but don't interrupt the user experience
- Test-send provides immediate feedback on configuration issues
- Per-channel enable/disable for easy troubleshooting

## Dependencies

- `nodemailer` (already installed) - Email notifications
- Native `fetch` - Webhook HTTP requests
