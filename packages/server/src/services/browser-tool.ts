/**
 * Browser Automation Tool (Playwright)
 *
 * Headless browser sessions for screenshots, scraping, testing, PDF generation.
 * Lazily loads playwright — only installed when BROWSER_TOOL flag is enabled.
 */

import { nanoid } from 'nanoid';
import { getDb } from '../db/database';
import type { BrowserAction, BrowserActionResult, BrowserSession, BrowserConfig } from '@e/shared';
import { DEFAULT_BROWSER_CONFIG } from '@e/shared';

interface InternalSession {
  id: string;
  browser: any; // playwright Browser
  page: any; // playwright Page
  config: BrowserConfig;
  actionCount: number;
  createdAt: number;
  lastActionAt?: number;
  autoCloseTimer?: ReturnType<typeof setTimeout>;
}

class BrowserToolService {
  private static instance: BrowserToolService;
  private sessions = new Map<string, InternalSession>();
  private playwright: any = null;

  static getInstance(): BrowserToolService {
    if (!BrowserToolService.instance) {
      BrowserToolService.instance = new BrowserToolService();
    }
    return BrowserToolService.instance;
  }

  private async loadPlaywright() {
    if (this.playwright) return this.playwright;
    try {
      this.playwright = await import('playwright');
      return this.playwright;
    } catch {
      throw new Error('Playwright not installed. Run: bun add playwright');
    }
  }

  async createSession(config?: Partial<BrowserConfig>): Promise<BrowserSession> {
    const merged = { ...DEFAULT_BROWSER_CONFIG, ...config };
    if (this.sessions.size >= merged.maxSessions) {
      throw new Error(`Max sessions (${merged.maxSessions}) reached`);
    }

    const pw = await this.loadPlaywright();
    const browserType = pw[merged.browser] || pw.chromium;
    const browser = await browserType.launch({ headless: merged.headless });
    const page = await browser.newPage({
      viewport: merged.viewport,
    });

    const id = nanoid(12);
    const now = Date.now();
    const session: InternalSession = {
      id,
      browser,
      page,
      config: merged,
      actionCount: 0,
      createdAt: now,
    };

    // Auto-close timer
    session.autoCloseTimer = setTimeout(() => {
      this.closeSession(id).catch(() => {});
    }, merged.autoCloseAfterSeconds * 1000);

    this.sessions.set(id, session);

    const db = getDb();
    db.query(
      `INSERT INTO browser_sessions (id, status, browser, headless, viewport_width, viewport_height, created_at)
       VALUES (?, 'ready', ?, ?, ?, ?, ?)`,
    ).run(
      id,
      merged.browser,
      merged.headless ? 1 : 0,
      merged.viewport.width,
      merged.viewport.height,
      now,
    );

    return this.toPublicSession(session, 'ready');
  }

  async executeAction(sessionId: string, action: BrowserAction): Promise<BrowserActionResult> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const start = Date.now();
    const page = session.page;

    // Reset auto-close timer
    if (session.autoCloseTimer) clearTimeout(session.autoCloseTimer);
    session.autoCloseTimer = setTimeout(() => {
      this.closeSession(sessionId).catch(() => {});
    }, session.config.autoCloseAfterSeconds * 1000);

    try {
      let value: string | undefined;
      let screenshot: string | undefined;
      let pdfPath: string | undefined;

      switch (action.type) {
        case 'navigate':
          await page.goto(action.url!, {
            timeout: action.timeout || session.config.defaultTimeout,
          });
          break;
        case 'click':
          await page.click(action.selector!, {
            timeout: action.timeout || session.config.defaultTimeout,
          });
          break;
        case 'fill':
          await page.fill(action.selector!, action.text!);
          break;
        case 'select':
          await page.selectOption(action.selector!, action.value!);
          break;
        case 'type':
          await page.type(action.selector!, action.text!);
          break;
        case 'hover':
          await page.hover(action.selector!);
          break;
        case 'screenshot': {
          const opts = action.screenshotOptions || {};
          const buf = await page.screenshot({
            fullPage: opts.fullPage,
            path: opts.path,
            type: opts.type || 'png',
            quality: opts.type === 'jpeg' ? opts.quality : undefined,
          });
          screenshot = opts.path || `data:image/png;base64,${buf.toString('base64')}`;
          break;
        }
        case 'pdf': {
          const pdfOpts = action.pdfOptions || {};
          const path = pdfOpts.path || `${session.config.outputDir}/page-${Date.now()}.pdf`;
          await page.pdf({
            path,
            format: pdfOpts.format || 'A4',
            landscape: pdfOpts.landscape,
          });
          pdfPath = path;
          break;
        }
        case 'evaluate':
          value = String(await page.evaluate(action.script!));
          break;
        case 'wait':
          if (action.selector) {
            await page.waitForSelector(action.selector, {
              timeout: action.timeout || session.config.defaultTimeout,
            });
          } else {
            await page.waitForTimeout(action.timeout || 1000);
          }
          break;
        case 'scroll':
          await page.evaluate(`window.scrollTo(${action.scrollX || 0}, ${action.scrollY || 0})`);
          break;
        case 'upload':
          await page.setInputFiles(action.selector!, action.filePath!);
          break;
        case 'dialog':
          // Dialog handling is typically set up as a listener
          break;
      }

      session.actionCount++;
      session.lastActionAt = Date.now();

      const db = getDb();
      db.query(
        `UPDATE browser_sessions SET action_count = ?, last_action_at = ?, current_url = ?, current_title = ? WHERE id = ?`,
      ).run(session.actionCount, session.lastActionAt, page.url(), await page.title(), sessionId);

      return {
        success: true,
        url: page.url(),
        title: await page.title(),
        value,
        screenshot,
        pdfPath,
        durationMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message,
        durationMs: Date.now() - start,
      };
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (session.autoCloseTimer) clearTimeout(session.autoCloseTimer);
    try {
      await session.browser.close();
    } catch {}
    this.sessions.delete(sessionId);

    const db = getDb();
    db.query(`UPDATE browser_sessions SET status = 'closed', closed_at = ? WHERE id = ?`).run(
      Date.now(),
      sessionId,
    );
  }

  getSession(sessionId: string): BrowserSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return this.toPublicSession(session, 'ready');
  }

  listSessions(): BrowserSession[] {
    return Array.from(this.sessions.values()).map((s) => this.toPublicSession(s, 'ready'));
  }

  private toPublicSession(s: InternalSession, status: BrowserSession['status']): BrowserSession {
    return {
      id: s.id,
      status,
      currentUrl: s.page?.url?.(),
      currentTitle: undefined,
      viewport: s.config.viewport,
      browser: s.config.browser,
      headless: s.config.headless,
      createdAt: s.createdAt,
      lastActionAt: s.lastActionAt,
      actionCount: s.actionCount,
    };
  }
}

export const browserTool = BrowserToolService.getInstance();
