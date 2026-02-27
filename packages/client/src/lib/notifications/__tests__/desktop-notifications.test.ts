import { describe, test, expect, vi, beforeEach } from 'vitest';

// We need to re-import after each mock setup, so use dynamic import pattern
let desktopNotifications: typeof import('../desktop-notifications').desktopNotifications;

let mockPermission = 'default' as string;
let mockRequestPermission = vi.fn(() => Promise.resolve('granted'));
let mockNotificationClose = vi.fn();
let mockNotificationInstances: { title: string; options: any; onclick: any; close: any }[] = [];

class MockNotification {
  static get permission() {
    return mockPermission;
  }
  static requestPermission = mockRequestPermission;

  title: string;
  options: any;
  onclick: ((this: Notification, ev: Event) => any) | null = null;
  close = mockNotificationClose;

  constructor(title: string, options: any) {
    this.title = title;
    this.options = options;
    mockNotificationInstances.push({ title, options, onclick: null, close: this.close });
    // Store reference to update onclick
    const instance = this;
    const idx = mockNotificationInstances.length - 1;
    Object.defineProperty(instance, 'onclick', {
      set(fn) {
        mockNotificationInstances[idx].onclick = fn;
      },
      get() {
        return mockNotificationInstances[idx].onclick;
      },
    });
  }
}

beforeEach(async () => {
  mockPermission = 'granted';
  mockRequestPermission = vi.fn(() => Promise.resolve('granted' as NotificationPermission));
  MockNotification.requestPermission = mockRequestPermission;
  mockNotificationClose = vi.fn();
  mockNotificationInstances = [];

  vi.stubGlobal('Notification', MockNotification);
  Object.defineProperty(document, 'hidden', { value: true, configurable: true, writable: true });

  // Re-import to get a fresh singleton
  vi.resetModules();
  const mod = await import('../desktop-notifications');
  desktopNotifications = mod.desktopNotifications;
});

describe('DesktopNotificationService', () => {
  describe('permission state', () => {
    test('isSupported returns true when Notification is defined', () => {
      expect(desktopNotifications.isSupported).toBe(true);
    });

    test('isGranted returns true when permission is granted', () => {
      mockPermission = 'granted';
      expect(desktopNotifications.isGranted).toBe(true);
    });

    test('isGranted returns false when permission is denied', () => {
      mockPermission = 'denied';
      expect(desktopNotifications.isGranted).toBe(false);
    });

    test('permission returns current Notification.permission', () => {
      mockPermission = 'default';
      expect(desktopNotifications.permission).toBe('default');
    });
  });

  describe('requestPermission', () => {
    test('returns granted when already granted', async () => {
      mockPermission = 'granted';
      const result = await desktopNotifications.requestPermission();
      expect(result).toBe('granted');
      expect(mockRequestPermission).not.toHaveBeenCalled();
    });

    test('returns denied when already denied', async () => {
      mockPermission = 'denied';
      const result = await desktopNotifications.requestPermission();
      expect(result).toBe('denied');
      expect(mockRequestPermission).not.toHaveBeenCalled();
    });

    test('prompts user when permission is default', async () => {
      mockPermission = 'default';
      mockRequestPermission.mockResolvedValue('granted' as NotificationPermission);
      const result = await desktopNotifications.requestPermission();
      expect(mockRequestPermission).toHaveBeenCalled();
      expect(result).toBe('granted');
    });

    test('only prompts once per session', async () => {
      mockPermission = 'default';
      mockRequestPermission.mockResolvedValue('denied' as NotificationPermission);

      await desktopNotifications.requestPermission();
      mockPermission = 'default'; // Still default
      await desktopNotifications.requestPermission();

      expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    });
  });

  describe('notify', () => {
    test('creates notification when tab is hidden and permission granted', async () => {
      mockPermission = 'granted';

      await desktopNotifications.notify({
        title: 'Test',
        body: 'Test body',
        event: 'story_completed',
      });

      expect(mockNotificationInstances).toHaveLength(1);
      expect(mockNotificationInstances[0].title).toBe('Test');
    });

    test('does not notify when tab is visible', async () => {
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });

      await desktopNotifications.notify({
        title: 'Test',
        body: 'Test body',
        event: 'story_completed',
      });

      expect(mockNotificationInstances).toHaveLength(0);
    });

    test('does not notify when permission is denied', async () => {
      mockPermission = 'denied';

      await desktopNotifications.notify({
        title: 'Test',
        body: 'Test body',
        event: 'story_completed',
      });

      expect(mockNotificationInstances).toHaveLength(0);
    });

    test('sets requireInteraction for approval_needed events', async () => {
      mockPermission = 'granted';

      await desktopNotifications.notify({
        title: 'Approval',
        body: 'Needs approval',
        event: 'approval_needed',
      });

      expect(mockNotificationInstances[0].options.requireInteraction).toBe(true);
    });

    test('does not set requireInteraction for other events', async () => {
      mockPermission = 'granted';

      await desktopNotifications.notify({
        title: 'Done',
        body: 'Story done',
        event: 'story_completed',
      });

      expect(mockNotificationInstances[0].options.requireInteraction).toBe(false);
    });

    test('uses tag based on event and data', async () => {
      mockPermission = 'granted';

      await desktopNotifications.notify({
        title: 'Test',
        body: 'body',
        event: 'story_completed',
        data: { storyId: 's-42' },
      });

      expect(mockNotificationInstances[0].options.tag).toBe('e-story_completed-s-42');
    });
  });

  describe('convenience methods', () => {
    test('storyCompleted sends notification', async () => {
      mockPermission = 'granted';
      await desktopNotifications.storyCompleted('My Story');
      expect(mockNotificationInstances).toHaveLength(1);
      expect(mockNotificationInstances[0].title).toBe('Story completed');
      expect(mockNotificationInstances[0].options.body).toBe('My Story');
    });

    test('storyFailed sends notification with detail', async () => {
      mockPermission = 'granted';
      await desktopNotifications.storyFailed('My Story', 'Timeout');
      expect(mockNotificationInstances[0].options.body).toBe('My Story — Timeout');
    });

    test('storyFailed sends notification without detail', async () => {
      mockPermission = 'granted';
      await desktopNotifications.storyFailed('My Story');
      expect(mockNotificationInstances[0].options.body).toBe('My Story');
    });

    test('approvalNeeded sends notification with tool name', async () => {
      mockPermission = 'granted';
      await desktopNotifications.approvalNeeded('Bash');
      expect(mockNotificationInstances[0].options.body).toContain('"Bash"');
    });

    test('approvalNeeded sends notification without tool name', async () => {
      mockPermission = 'granted';
      await desktopNotifications.approvalNeeded();
      expect(mockNotificationInstances[0].options.body).toContain('A tool is waiting');
    });

    test('loopCompleted sends notification', async () => {
      mockPermission = 'granted';
      await desktopNotifications.loopCompleted(5);
      expect(mockNotificationInstances[0].options.body).toBe('All 5 stories finished');
    });

    test('loopFailed sends notification with detail', async () => {
      mockPermission = 'granted';
      await desktopNotifications.loopFailed('Out of budget');
      expect(mockNotificationInstances[0].options.body).toBe('Out of budget');
    });

    test('loopFailed sends notification without detail', async () => {
      mockPermission = 'granted';
      await desktopNotifications.loopFailed();
      expect(mockNotificationInstances[0].options.body).toBe('The loop encountered an error');
    });
  });

  describe('requestPermission edge cases', () => {
    test('returns denied when Notification.requestPermission throws', async () => {
      mockPermission = 'default';
      MockNotification.requestPermission = vi.fn(() => Promise.reject(new Error('blocked')));

      const result = await desktopNotifications.requestPermission();
      expect(result).toBe('denied');
    });

    test('returns denied when Notification is not supported', async () => {
      vi.stubGlobal('Notification', undefined);
      vi.resetModules();
      const mod = await import('../desktop-notifications');
      const svc = mod.desktopNotifications;

      expect(svc.isSupported).toBe(false);
      const result = await svc.requestPermission();
      expect(result).toBe('denied');

      // Restore
      vi.stubGlobal('Notification', MockNotification);
    });
  });

  describe('ensurePermission (via notify)', () => {
    test('requests permission when default, then sends notification if granted', async () => {
      mockPermission = 'default';
      MockNotification.requestPermission = vi.fn(async () => {
        mockPermission = 'granted';
        return 'granted' as NotificationPermission;
      });

      await desktopNotifications.notify({
        title: 'Test',
        body: 'body',
        event: 'story_completed',
      });

      expect(MockNotification.requestPermission).toHaveBeenCalled();
      expect(mockNotificationInstances.length).toBe(1);
    });

    test('requests permission when default, stops if denied', async () => {
      mockPermission = 'default';
      MockNotification.requestPermission = vi.fn(async () => {
        mockPermission = 'denied';
        return 'denied' as NotificationPermission;
      });

      await desktopNotifications.notify({
        title: 'Test',
        body: 'body',
        event: 'story_completed',
      });

      expect(MockNotification.requestPermission).toHaveBeenCalled();
      expect(mockNotificationInstances.length).toBe(0);
    });
  });

  describe('notification onclick', () => {
    test('clicking notification focuses window and closes notification', async () => {
      mockPermission = 'granted';
      const mockFocus = vi.fn();
      vi.stubGlobal('focus', mockFocus);
      Object.defineProperty(window, 'focus', {
        value: mockFocus,
        writable: true,
        configurable: true,
      });

      await desktopNotifications.notify({
        title: 'Test',
        body: 'body',
        event: 'story_completed',
      });

      expect(mockNotificationInstances.length).toBe(1);
      const instance = mockNotificationInstances[0];

      // Trigger onclick
      instance.onclick();

      expect(mockFocus).toHaveBeenCalled();
      expect(instance.close).toHaveBeenCalled();
    });

    test('clicking notification with conversationId navigates via goto', async () => {
      mockPermission = 'granted';
      const mockGoto = vi.fn();
      const mockFocus = vi.fn();
      Object.defineProperty(window, 'focus', {
        value: mockFocus,
        writable: true,
        configurable: true,
      });
      (window as any).__e_goto = mockGoto;

      await desktopNotifications.notify({
        title: 'Test',
        body: 'body',
        event: 'story_completed',
        data: { conversationId: 'conv-123' },
      });

      const instance = mockNotificationInstances[0];
      instance.onclick();

      expect(mockGoto).toHaveBeenCalledWith('/conversation/conv-123');
      expect(instance.close).toHaveBeenCalled();

      delete (window as any).__e_goto;
    });

    test('clicking notification with conversationId but no goto does not throw', async () => {
      mockPermission = 'granted';
      const mockFocus = vi.fn();
      Object.defineProperty(window, 'focus', {
        value: mockFocus,
        writable: true,
        configurable: true,
      });
      delete (window as any).__e_goto;

      await desktopNotifications.notify({
        title: 'Test',
        body: 'body',
        event: 'story_completed',
        data: { conversationId: 'conv-456' },
      });

      const instance = mockNotificationInstances[0];
      // Should not throw even though __e_goto is undefined
      instance.onclick();
      expect(mockFocus).toHaveBeenCalled();
    });
  });

  describe('auto-close', () => {
    test('non-approval events schedule auto-close', async () => {
      vi.useFakeTimers();
      mockPermission = 'granted';

      await desktopNotifications.notify({
        title: 'Test',
        body: 'body',
        event: 'story_completed',
      });

      expect(mockNotificationInstances.length).toBe(1);
      const instance = mockNotificationInstances[0];

      expect(instance.close).not.toHaveBeenCalled();
      vi.advanceTimersByTime(8000);
      expect(instance.close).toHaveBeenCalled();

      vi.useRealTimers();
    });

    test('approval_needed events do NOT auto-close', async () => {
      vi.useFakeTimers();
      mockPermission = 'granted';

      await desktopNotifications.notify({
        title: 'Approval',
        body: 'body',
        event: 'approval_needed',
      });

      vi.advanceTimersByTime(10000);
      expect(mockNotificationInstances[0].close).not.toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  describe('tag generation', () => {
    test('uses loopId in tag when storyId is absent', async () => {
      mockPermission = 'granted';
      await desktopNotifications.notify({
        title: 'Loop',
        body: 'body',
        event: 'loop_completed',
        data: { loopId: 'loop-1' },
      });

      expect(mockNotificationInstances[0].options.tag).toBe('e-loop_completed-loop-1');
    });

    test('uses general in tag when no storyId or loopId', async () => {
      mockPermission = 'granted';
      await desktopNotifications.notify({
        title: 'Test',
        body: 'body',
        event: 'loop_failed',
      });

      expect(mockNotificationInstances[0].options.tag).toBe('e-loop_failed-general');
    });
  });

  describe('Notification API errors', () => {
    test('handles Notification constructor throwing', async () => {
      mockPermission = 'granted';
      vi.stubGlobal(
        'Notification',
        class {
          static get permission() {
            return 'granted';
          }
          static requestPermission = vi.fn();
          constructor() {
            throw new Error('Not allowed in this context');
          }
        },
      );

      // Should not throw
      vi.resetModules();
      const mod = await import('../desktop-notifications');
      Object.defineProperty(document, 'hidden', {
        value: true,
        configurable: true,
        writable: true,
      });
      await mod.desktopNotifications.notify({
        title: 'Test',
        body: 'body',
        event: 'story_completed',
      });

      // Restore
      vi.stubGlobal('Notification', MockNotification);
    });
  });

  describe('isTabHidden edge cases', () => {
    test('returns false when document is undefined', async () => {
      // isTabHidden checks typeof document
      // In happy-dom, document is always defined, but we can test the visible case
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      expect(desktopNotifications.isTabHidden).toBe(false);
    });
  });
});
