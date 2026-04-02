/**
 * Browser Automation Tool (Playwright)
 *
 * Headless browser automation for visual testing, web scraping,
 * form automation, screenshots, and PDF generation.
 */

export type BrowserActionType =
  | 'navigate'
  | 'click'
  | 'fill'
  | 'select'
  | 'screenshot'
  | 'pdf'
  | 'evaluate'
  | 'wait'
  | 'scroll'
  | 'hover'
  | 'type'
  | 'upload'
  | 'dialog';

export type BrowserSessionStatus = 'starting' | 'ready' | 'busy' | 'closed' | 'error';

export interface BrowserAction {
  type: BrowserActionType;
  /** CSS selector, text content, or XPath */
  selector?: string;
  /** URL to navigate to */
  url?: string;
  /** Text to type or fill */
  text?: string;
  /** Value to select (for dropdowns) */
  value?: string;
  /** JavaScript to evaluate in page context */
  script?: string;
  /** Wait timeout in ms */
  timeout?: number;
  /** Screenshot options */
  screenshotOptions?: {
    fullPage?: boolean;
    path?: string;
    type?: 'png' | 'jpeg';
    quality?: number;
  };
  /** PDF options */
  pdfOptions?: {
    path?: string;
    format?: 'A4' | 'Letter' | 'Legal';
    landscape?: boolean;
  };
  /** File path for uploads */
  filePath?: string;
  /** Dialog action (accept/dismiss) */
  dialogAction?: 'accept' | 'dismiss';
  /** Dialog prompt text */
  dialogText?: string;
  /** Scroll coordinates */
  scrollX?: number;
  scrollY?: number;
}

export interface BrowserActionResult {
  success: boolean;
  /** Page URL after action */
  url?: string;
  /** Page title after action */
  title?: string;
  /** Returned value (from evaluate, text content, etc.) */
  value?: string;
  /** Screenshot path or base64 data */
  screenshot?: string;
  /** PDF path */
  pdfPath?: string;
  /** Error message */
  error?: string;
  /** Duration in ms */
  durationMs: number;
}

export interface BrowserSession {
  id: string;
  status: BrowserSessionStatus;
  /** Current page URL */
  currentUrl?: string;
  /** Current page title */
  currentTitle?: string;
  /** Viewport size */
  viewport: { width: number; height: number };
  /** Browser type */
  browser: 'chromium' | 'firefox' | 'webkit';
  /** Whether running headless */
  headless: boolean;
  createdAt: number;
  lastActionAt?: number;
  /** Action history */
  actionCount: number;
}

export interface BrowserConfig {
  /** Default browser engine */
  browser: 'chromium' | 'firefox' | 'webkit';
  /** Run headless */
  headless: boolean;
  /** Default viewport */
  viewport: { width: number; height: number };
  /** Default timeout for actions (ms) */
  defaultTimeout: number;
  /** Directory for screenshots and PDFs */
  outputDir: string;
  /** Auto-close after inactivity (seconds) */
  autoCloseAfterSeconds: number;
  /** Maximum concurrent sessions */
  maxSessions: number;
}

export const DEFAULT_BROWSER_CONFIG: BrowserConfig = {
  browser: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 720 },
  defaultTimeout: 30000,
  outputDir: '.e/browser-captures',
  autoCloseAfterSeconds: 300,
  maxSessions: 3,
};

export interface StreamBrowserEvent {
  type: 'browser_event';
  sessionId: string;
  event: 'started' | 'navigated' | 'action' | 'screenshot' | 'error' | 'closed';
  data: {
    url?: string;
    title?: string;
    action?: BrowserActionType;
    screenshot?: string;
    error?: string;
  };
}
