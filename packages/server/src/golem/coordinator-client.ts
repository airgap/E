// ---------------------------------------------------------------------------
// Golem Coordinator Client — HTTP client for the story coordination API
// ---------------------------------------------------------------------------
// Remote golems use this client to communicate with the E server (coordinator)
// for story claiming, heartbeat renewal, and result reporting.
// ---------------------------------------------------------------------------

import type {
  StoryClaimRequest,
  StoryClaimResponse,
  StoryHeartbeatRequest,
  StoryHeartbeatResponse,
  StoryResultReport,
  StoryResultResponse,
  AvailableStory,
} from '@e/shared';
import type { GolemLogger } from './logger.js';

/**
 * HTTP client for the E story coordination API.
 * Used by headless golems to communicate with the coordinator.
 */
export class CoordinatorClient {
  private baseUrl: string;
  private logger: GolemLogger;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  constructor(coordinatorUrl: string, logger: GolemLogger) {
    // Ensure URL ends without trailing slash
    this.baseUrl = coordinatorUrl.replace(/\/$/, '');
    this.logger = logger;
  }

  /**
   * Claim a story for execution.
   */
  async claimStory(request: StoryClaimRequest): Promise<StoryClaimResponse> {
    const resp = await this.post<{ ok: boolean; data: StoryClaimResponse; error?: string }>(
      '/claim',
      request,
    );

    if (!resp.ok && resp.error) {
      this.logger.warn('init', `Claim rejected: ${resp.error}`);
    }

    return resp.data;
  }

  /**
   * Send a heartbeat for a claimed story.
   */
  async sendHeartbeat(
    storyId: string,
    request: StoryHeartbeatRequest,
  ): Promise<StoryHeartbeatResponse> {
    const resp = await this.post<{ ok: boolean; data: StoryHeartbeatResponse; error?: string }>(
      `/${storyId}/heartbeat`,
      request,
    );

    return resp.data;
  }

  /**
   * Report the result of a story execution.
   */
  async reportResult(storyId: string, report: StoryResultReport): Promise<StoryResultResponse> {
    const resp = await this.post<{ ok: boolean; data: StoryResultResponse; error?: string }>(
      `/${storyId}/result`,
      report,
    );

    if (!resp.ok && resp.error) {
      this.logger.warn('report', `Result report issue: ${resp.error}`);
    }

    return resp.data;
  }

  /**
   * List available stories for claiming.
   */
  async getAvailableStories(params?: {
    workspacePath?: string;
    prdId?: string;
    executorType?: string;
  }): Promise<AvailableStory[]> {
    const searchParams = new URLSearchParams();
    if (params?.workspacePath) searchParams.set('workspacePath', params.workspacePath);
    if (params?.prdId) searchParams.set('prdId', params.prdId);
    if (params?.executorType) searchParams.set('executorType', params.executorType);

    const qs = searchParams.toString();
    const url = `/available${qs ? `?${qs}` : ''}`;

    const resp = await this.get<{ ok: boolean; data: AvailableStory[] }>(url);
    return resp.data;
  }

  /**
   * Submit a question to the coordinator and request human assistance.
   * Returns a questionId that can be used to poll for the answer.
   */
  async askQuestion(
    storyId: string,
    executorId: string,
    question: string,
    context?: string,
  ): Promise<string> {
    const resp = await this.post<{ ok: boolean; data: { questionId: string }; error?: string }>(
      `/${storyId}/question`,
      { executorId, question, context },
    );

    if (!resp.ok || !resp.data?.questionId) {
      throw new Error(`Failed to submit question: ${resp.error ?? 'unknown error'}`);
    }

    return resp.data.questionId;
  }

  /**
   * Wait for a human to answer a question.
   * Polls every 5 seconds until the answer arrives or the timeout expires.
   * Rejects if the question is not answered within timeoutMs.
   */
  async waitForAnswer(
    storyId: string,
    questionId: string,
    timeoutMs: number = 30 * 60 * 1000,
  ): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    const pollInterval = 5_000;

    while (Date.now() < deadline) {
      const resp = await this.get<{
        ok: boolean;
        data: { answered: boolean; answer?: string; answeredAt?: number };
        error?: string;
      }>(`/${storyId}/question/${questionId}`);

      if (!resp.ok) {
        throw new Error(`Failed to poll for answer: ${resp.error ?? 'unknown error'}`);
      }

      if (resp.data.answered && resp.data.answer !== undefined) {
        return resp.data.answer;
      }

      // Wait before next poll
      await new Promise<void>((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Timed out waiting for human response after ${timeoutMs}ms`);
  }

  /**
   * Start periodic heartbeat sending for a claimed story.
   */
  startHeartbeat(storyId: string, executorId: string, intervalMs: number): void {
    this.stopHeartbeat();

    this.heartbeatInterval = setInterval(async () => {
      try {
        const result = await this.sendHeartbeat(storyId, { executorId });
        if (!result.renewed) {
          this.logger.warn('agent', `Heartbeat rejected: ${result.reason}`, {
            storyId,
            executorId,
          });
          this.stopHeartbeat();
        }
      } catch (err) {
        this.logger.warn('agent', `Heartbeat failed: ${String(err)}`, { storyId });
      }
    }, intervalMs);
  }

  /**
   * Stop periodic heartbeat sending.
   */
  stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  // --- Private HTTP helpers ---

  private async post<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new Error(`Coordinator POST ${path} failed (${resp.status}): ${text.slice(0, 500)}`);
      }
    }

    return resp.json() as Promise<T>;
  }

  private async get<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const resp = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Coordinator GET ${path} failed (${resp.status}): ${text.slice(0, 500)}`);
    }

    return resp.json() as Promise<T>;
  }

  /**
   * Clean up all resources.
   */
  dispose(): void {
    this.stopHeartbeat();
  }
}
