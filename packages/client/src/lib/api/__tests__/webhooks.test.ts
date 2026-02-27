import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../client', () => ({
  getAuthToken: vi.fn(() => 'test-token'),
  getCsrfToken: vi.fn(() => 'csrf-token'),
}));

import { webhooksApi } from '../webhooks';
import { getAuthToken, getCsrfToken } from '../client';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockOk(data: unknown) {
  return {
    ok: true,
    json: () => Promise.resolve({ data }),
    statusText: 'OK',
  };
}

function mockError(status: number, body?: { error: string }) {
  return {
    ok: false,
    statusText: `Error ${status}`,
    json: () => Promise.resolve(body ?? { error: `Error ${status}` }),
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.mocked(getAuthToken).mockReturnValue('test-token');
  vi.mocked(getCsrfToken).mockReturnValue('csrf-token');
});

describe('webhooksApi', () => {
  describe('auth headers', () => {
    test('includes Authorization and X-CSRF-Token headers', async () => {
      mockFetch.mockResolvedValue(mockOk([]));

      await webhooksApi.list('ws-1');

      const callHeaders = mockFetch.mock.calls[0][1].headers;
      expect(callHeaders['Authorization']).toBe('Bearer test-token');
      expect(callHeaders['X-CSRF-Token']).toBe('csrf-token');
    });

    test('omits Authorization when no token', async () => {
      vi.mocked(getAuthToken).mockReturnValue(null as any);
      mockFetch.mockResolvedValue(mockOk([]));

      await webhooksApi.list('ws-1');

      const callHeaders = mockFetch.mock.calls[0][1].headers;
      expect(callHeaders['Authorization']).toBeUndefined();
    });

    test('omits X-CSRF-Token when no csrf token', async () => {
      vi.mocked(getCsrfToken).mockReturnValue(null as any);
      mockFetch.mockResolvedValue(mockOk([]));

      await webhooksApi.list('ws-1');

      const callHeaders = mockFetch.mock.calls[0][1].headers;
      expect(callHeaders['X-CSRF-Token']).toBeUndefined();
    });
  });

  describe('list', () => {
    test('fetches webhooks for workspace', async () => {
      const webhooks = [{ id: 'wh-1' }];
      mockFetch.mockResolvedValue(mockOk(webhooks));

      const result = await webhooksApi.list('ws-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/webhooks?workspaceId=ws-1', expect.anything());
      expect(result).toEqual(webhooks);
    });

    test('encodes workspaceId', async () => {
      mockFetch.mockResolvedValue(mockOk([]));
      await webhooksApi.list('/my workspace');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('%2Fmy%20workspace'),
        expect.anything(),
      );
    });
  });

  describe('get', () => {
    test('fetches a single webhook', async () => {
      mockFetch.mockResolvedValue(mockOk({ id: 'wh-1' }));

      const result = await webhooksApi.get('wh-1');
      expect(mockFetch).toHaveBeenCalledWith('/api/webhooks/wh-1', expect.anything());
      expect(result).toEqual({ id: 'wh-1' });
    });
  });

  describe('getSecret', () => {
    test('extracts secret from nested response', async () => {
      mockFetch.mockResolvedValue(mockOk({ secret: 'super-secret-123' }));

      const result = await webhooksApi.getSecret('wh-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/webhooks/wh-1/secret', expect.anything());
      expect(result).toBe('super-secret-123');
    });
  });

  describe('create', () => {
    test('sends POST with webhook input', async () => {
      const input = { name: 'My Webhook', url: 'https://example.com/hook', workspaceId: 'ws-1' };
      mockFetch.mockResolvedValue(mockOk({ id: 'wh-new', ...input }));

      await webhooksApi.create(input as any);

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/webhooks',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(input),
        }),
      );
    });
  });

  describe('update', () => {
    test('sends PUT with webhook id and body', async () => {
      const update = { name: 'Updated' };
      mockFetch.mockResolvedValue(mockOk({ id: 'wh-1', name: 'Updated' }));

      await webhooksApi.update('wh-1', update as any);

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/webhooks/wh-1',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify(update),
        }),
      );
    });
  });

  describe('delete', () => {
    test('sends DELETE request', async () => {
      mockFetch.mockResolvedValue(mockOk(null));

      await webhooksApi.delete('wh-1');

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/webhooks/wh-1',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  describe('getExecutions', () => {
    test('fetches executions without limit', async () => {
      mockFetch.mockResolvedValue(mockOk([]));

      await webhooksApi.getExecutions('wh-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/webhooks/wh-1/executions', expect.anything());
    });

    test('fetches executions with limit', async () => {
      mockFetch.mockResolvedValue(mockOk([]));

      await webhooksApi.getExecutions('wh-1', 25);

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/webhooks/wh-1/executions?limit=25',
        expect.anything(),
      );
    });
  });

  describe('test', () => {
    test('sends POST to /test endpoint', async () => {
      mockFetch.mockResolvedValue(mockOk({ executionId: 'exec-1', status: 'success' }));

      const result = await webhooksApi.test('wh-1');

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/webhooks/wh-1/test',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(result).toEqual({ executionId: 'exec-1', status: 'success' });
    });
  });

  describe('error handling', () => {
    test('throws on non-ok response', async () => {
      mockFetch.mockResolvedValue(mockError(403, { error: 'Forbidden' }));

      await expect(webhooksApi.get('wh-1')).rejects.toThrow('Forbidden');
    });

    test('falls back when error JSON parse fails', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Server Error',
        json: () => Promise.reject(new Error('Parse error')),
      });

      await expect(webhooksApi.get('wh-1')).rejects.toThrow('Request failed');
    });
  });
});
