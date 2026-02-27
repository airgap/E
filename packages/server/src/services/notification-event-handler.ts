/**
 * Notification Event Handler
 *
 * Automatically sends notifications through configured channels when key events occur:
 * - Golem (loop) completion/failure
 * - Story completion/failure
 * - Approval requests
 * - Agent errors
 */

import { sendNotification } from './notification-channels';
import type { NotificationEventType } from '@e/shared';

interface NotificationPayload {
  event: NotificationEventType;
  title: string;
  message: string;
  workspaceId?: string;
  conversationId?: string;
  storyId?: string;
  actions?: Array<{
    id: string;
    label: string;
    style?: 'primary' | 'danger' | 'default';
    url: string;
  }>;
}

/**
 * Send a notification, gracefully handling errors
 */
async function notify(payload: NotificationPayload): Promise<void> {
  try {
    await sendNotification(payload);
  } catch (error) {
    console.error(`[notifications] Failed to send ${payload.event} notification:`, error);
  }
}

/**
 * Golem (loop) completion notification
 */
export async function notifyGolemCompletion(params: {
  loopId: string;
  prdName?: string;
  storiesCompleted: number;
  storiesFailed: number;
  workspaceId?: string;
  conversationId?: string;
}): Promise<void> {
  const prdLabel = params.prdName || 'Loop';
  await notify({
    event: 'golem_completion',
    title: `${prdLabel} Completed`,
    message: `Golem finished all work!\n✅ ${params.storiesCompleted} stories completed\n${params.storiesFailed > 0 ? `❌ ${params.storiesFailed} stories failed` : ''}`,
    workspaceId: params.workspaceId,
    conversationId: params.conversationId,
  });
}

/**
 * Golem (loop) failure notification
 */
export async function notifyGolemFailure(params: {
  loopId: string;
  prdName?: string;
  error: string;
  workspaceId?: string;
  conversationId?: string;
}): Promise<void> {
  const prdLabel = params.prdName || 'Loop';
  await notify({
    event: 'golem_failure',
    title: `${prdLabel} Failed`,
    message: `Golem encountered an error and stopped:\n${params.error}`,
    workspaceId: params.workspaceId,
    conversationId: params.conversationId,
  });
}

/**
 * Story completion notification
 */
export async function notifyStoryCompleted(params: {
  storyId: string;
  storyTitle: string;
  prdName?: string;
  workspaceId?: string;
  conversationId?: string;
}): Promise<void> {
  await notify({
    event: 'story_completed',
    title: 'Story Completed',
    message: `✅ ${params.storyTitle}${params.prdName ? `\n(PRD: ${params.prdName})` : ''}`,
    workspaceId: params.workspaceId,
    conversationId: params.conversationId,
    storyId: params.storyId,
  });
}

/**
 * Story failure notification
 */
export async function notifyStoryFailed(params: {
  storyId: string;
  storyTitle: string;
  error?: string;
  prdName?: string;
  workspaceId?: string;
  conversationId?: string;
}): Promise<void> {
  await notify({
    event: 'story_failed',
    title: 'Story Failed',
    message: `❌ ${params.storyTitle}${params.prdName ? `\n(PRD: ${params.prdName})` : ''}${params.error ? `\n\nError: ${params.error}` : ''}`,
    workspaceId: params.workspaceId,
    conversationId: params.conversationId,
    storyId: params.storyId,
  });
}

/**
 * Approval request notification
 */
export async function notifyApprovalNeeded(params: {
  toolName: string;
  toolInput?: string;
  conversationId?: string;
  workspaceId?: string;
  approvalUrl?: string;
}): Promise<void> {
  const message = params.toolInput
    ? `Tool "${params.toolName}" needs approval:\n\`\`\`\n${params.toolInput.slice(0, 200)}${params.toolInput.length > 200 ? '...' : ''}\n\`\`\``
    : `Tool "${params.toolName}" is waiting for your approval`;

  const actions = params.approvalUrl
    ? [
        {
          id: 'approve',
          label: 'Approve',
          style: 'primary' as const,
          url: `${params.approvalUrl}?action=approve`,
        },
        {
          id: 'reject',
          label: 'Reject',
          style: 'danger' as const,
          url: `${params.approvalUrl}?action=reject`,
        },
      ]
    : undefined;

  await notify({
    event: 'approval_needed',
    title: 'Approval Needed',
    message,
    workspaceId: params.workspaceId,
    conversationId: params.conversationId,
    actions,
  });
}

/**
 * Agent error notification
 */
export async function notifyAgentError(params: {
  error: string;
  conversationId?: string;
  workspaceId?: string;
}): Promise<void> {
  await notify({
    event: 'agent_error',
    title: 'Agent Error',
    message: `⚠️ An error occurred:\n${params.error.slice(0, 300)}${params.error.length > 300 ? '...' : ''}`,
    workspaceId: params.workspaceId,
    conversationId: params.conversationId,
  });
}
