import type {
  Webhook,
  WebhookCreateInput,
  WebhookUpdateInput,
  WebhookWithStats,
  WebhookExecution,
} from '@e/shared';
import { getAuthToken, getCsrfToken } from './client';

const API_BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options?.headers as Record<string, string>) || {}),
  };

  const token = getAuthToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const csrf = getCsrfToken();
  if (csrf) headers['X-CSRF-Token'] = csrf;

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `Request failed: ${response.statusText}`);
  }

  const data = await response.json();
  return data.data;
}

export const webhooksApi = {
  /**
   * List all webhooks for a workspace (with stats)
   */
  async list(workspaceId: string): Promise<WebhookWithStats[]> {
    return request(`/webhooks?workspaceId=${encodeURIComponent(workspaceId)}`);
  },

  /**
   * Get a single webhook
   */
  async get(webhookId: string): Promise<Webhook> {
    return request(`/webhooks/${webhookId}`);
  },

  /**
   * Get the full secret for a webhook (for copy-to-clipboard)
   */
  async getSecret(webhookId: string): Promise<string> {
    const data = await request<{ secret: string }>(`/webhooks/${webhookId}/secret`);
    return data.secret;
  },

  /**
   * Create a new webhook
   */
  async create(input: WebhookCreateInput): Promise<Webhook> {
    return request('/webhooks', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  /**
   * Update a webhook
   */
  async update(webhookId: string, input: WebhookUpdateInput): Promise<Webhook> {
    return request(`/webhooks/${webhookId}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  },

  /**
   * Delete a webhook
   */
  async delete(webhookId: string): Promise<void> {
    return request(`/webhooks/${webhookId}`, {
      method: 'DELETE',
    });
  },

  /**
   * Get execution history for a webhook
   */
  async getExecutions(webhookId: string, limit?: number): Promise<WebhookExecution[]> {
    const queryParams = limit ? `?limit=${limit}` : '';
    return request(`/webhooks/${webhookId}/executions${queryParams}`);
  },

  /**
   * Test a webhook with a simulated payload
   */
  async test(webhookId: string): Promise<{ executionId: string; status: string }> {
    return request(`/webhooks/${webhookId}/test`, {
      method: 'POST',
    });
  },
};
