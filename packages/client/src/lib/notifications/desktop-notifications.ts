/**
 * Desktop Notifications — OS-level notification bridge for background events.
 *
 * Fires Web Notifications API notifications when the browser tab is not focused
 * and certain events occur (story completion, failure, approval needed).
 *
 * Integrates alongside the existing chirp engine (StreamAudio.svelte handles
 * audio; this module handles OS notifications independently).
 *
 * Permission is requested gracefully on first use — never on page load.
 */

export type NotifyEvent =
  | 'story_completed'
  | 'story_failed'
  | 'approval_needed'
  | 'loop_completed'
  | 'loop_failed';

export interface NotifyOptions {
  title: string;
  body: string;
  /** Event type — used to check per-event-type settings. */
  event: NotifyEvent;
  /** Optional data for click handling (e.g. conversationId, storyId). */
  data?: {
    conversationId?: string;
    storyId?: string;
    loopId?: string;
  };
}

export type NotificationPermissionState = 'default' | 'granted' | 'denied';

class DesktopNotificationService {
  /** Whether the user has ever been prompted (avoids re-prompting on 'denied'). */
  private prompted = false;

  // --- Permission state ---

  get permission(): NotificationPermissionState {
    if (typeof Notification === 'undefined') return 'denied';
    return Notification.permission as NotificationPermissionState;
  }

  get isSupported(): boolean {
    return typeof Notification !== 'undefined';
  }

  get isGranted(): boolean {
    return this.permission === 'granted';
  }

  get isTabHidden(): boolean {
    if (typeof document === 'undefined') return false;
    return document.hidden;
  }

  // --- Permission request ---

  /**
   * Request notification permission gracefully.
   * Returns the resulting permission state.
   * Only prompts once per session — if already denied, returns 'denied' without re-prompting.
   */
  async requestPermission(): Promise<NotificationPermissionState> {
    if (!this.isSupported) return 'denied';
    if (this.permission === 'granted') return 'granted';
    if (this.permission === 'denied') return 'denied';

    // 'default' — prompt the user
    if (this.prompted) return this.permission;
    this.prompted = true;

    try {
      const result = await Notification.requestPermission();
      return result as NotificationPermissionState;
    } catch {
      return 'denied';
    }
  }

  /**
   * Ensure permission before sending a notification.
   * If permission is 'default', requests it gracefully first.
   * Returns true if permission is now granted.
   */
  private async ensurePermission(): Promise<boolean> {
    if (this.isGranted) return true;
    if (this.permission === 'denied') return false;

    // 'default' — try requesting
    const result = await this.requestPermission();
    return result === 'granted';
  }

  // --- Send notification ---

  /**
   * Fire a desktop notification if the tab is hidden and permission is granted.
   * Handles click-to-focus and auto-close.
   */
  async notify(options: NotifyOptions): Promise<void> {
    // Only notify when tab is not focused
    if (!this.isTabHidden) return;

    // Ensure permission (will prompt on first use if needed)
    const permitted = await this.ensurePermission();
    if (!permitted) return;

    try {
      const notification = new Notification(options.title, {
        body: options.body,
        icon: '/favicon.png',
        tag: `e-${options.event}-${options.data?.storyId || options.data?.loopId || 'general'}`,
        // Reuse same tag to avoid stacking duplicate notifications
        requireInteraction: options.event === 'approval_needed',
      });

      notification.onclick = () => {
        // Focus the window/tab
        window.focus();

        // Navigate to relevant conversation if we have a conversationId
        if (options.data?.conversationId) {
          // Use SvelteKit navigation via goto
          const goto = window.__e_goto;
          if (goto) {
            goto(`/conversation/${options.data.conversationId}`);
          }
        }

        notification.close();
      };

      // Auto-close after 8 seconds (except approval_needed which requires interaction)
      if (options.event !== 'approval_needed') {
        setTimeout(() => notification.close(), 8000);
      }
    } catch {
      // Notification API may throw in certain environments
    }
  }

  // --- Convenience methods ---

  storyCompleted(storyTitle: string, data?: NotifyOptions['data']) {
    return this.notify({
      title: 'Story completed',
      body: storyTitle,
      event: 'story_completed',
      data,
    });
  }

  storyFailed(storyTitle: string, detail?: string, data?: NotifyOptions['data']) {
    return this.notify({
      title: 'Story failed',
      body: detail ? `${storyTitle} — ${detail}` : storyTitle,
      event: 'story_failed',
      data,
    });
  }

  approvalNeeded(toolName?: string, data?: NotifyOptions['data']) {
    return this.notify({
      title: 'Approval needed',
      body: toolName
        ? `Tool "${toolName}" is waiting for your approval`
        : 'A tool is waiting for your approval',
      event: 'approval_needed',
      data,
    });
  }

  loopCompleted(totalStories: number, data?: NotifyOptions['data']) {
    return this.notify({
      title: 'Loop completed',
      body: `All ${totalStories} stories finished`,
      event: 'loop_completed',
      data,
    });
  }

  loopFailed(detail?: string, data?: NotifyOptions['data']) {
    return this.notify({
      title: 'Loop failed',
      body: detail || 'The loop encountered an error',
      event: 'loop_failed',
      data,
    });
  }
}

/** Singleton — shared across the app */
export const desktopNotifications = new DesktopNotificationService();

// --- Type augmentation for the goto helper stashed on window ---
declare global {
  interface Window {
    __e_goto?: (url: string) => Promise<void>;
  }
}
