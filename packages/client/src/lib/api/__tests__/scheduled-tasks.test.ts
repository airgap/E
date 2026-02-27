import { describe, test, expect, vi, beforeEach } from 'vitest';
import { scheduledTasksApi } from '../scheduled-tasks';

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
});

describe('scheduledTasksApi', () => {
  describe('list', () => {
    test('fetches tasks for a workspace', async () => {
      const tasks = [{ id: 't1', name: 'task1' }];
      mockFetch.mockResolvedValue(mockOk(tasks));

      const result = await scheduledTasksApi.list('ws-123');

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/scheduled-tasks?workspaceId=ws-123',
        expect.objectContaining({ headers: { 'Content-Type': 'application/json' } }),
      );
      expect(result).toEqual(tasks);
    });

    test('encodes workspaceId in URL', async () => {
      mockFetch.mockResolvedValue(mockOk([]));
      await scheduledTasksApi.list('/path/with spaces');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('%2Fpath%2Fwith%20spaces'),
        expect.anything(),
      );
    });
  });

  describe('get', () => {
    test('fetches a single task by id', async () => {
      const task = { id: 't1', name: 'task1' };
      mockFetch.mockResolvedValue(mockOk(task));

      const result = await scheduledTasksApi.get('t1');
      expect(mockFetch).toHaveBeenCalledWith('/api/scheduled-tasks/t1', expect.anything());
      expect(result).toEqual(task);
    });
  });

  describe('create', () => {
    test('sends POST with input body', async () => {
      const input = { name: 'new task', schedule: '0 * * * *', workspaceId: 'ws-1' };
      mockFetch.mockResolvedValue(mockOk({ id: 't1', ...input }));

      await scheduledTasksApi.create(input as any);

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/scheduled-tasks',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(input),
        }),
      );
    });
  });

  describe('update', () => {
    test('sends PUT with task id and body', async () => {
      const update = { name: 'updated' };
      mockFetch.mockResolvedValue(mockOk({ id: 't1', name: 'updated' }));

      await scheduledTasksApi.update('t1', update as any);

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/scheduled-tasks/t1',
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

      await scheduledTasksApi.delete('t1');

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/scheduled-tasks/t1',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  describe('pause', () => {
    test('sends POST to /pause endpoint', async () => {
      mockFetch.mockResolvedValue(mockOk(null));

      await scheduledTasksApi.pause('t1');

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/scheduled-tasks/t1/pause',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('resume', () => {
    test('sends POST to /resume endpoint', async () => {
      mockFetch.mockResolvedValue(mockOk(null));

      await scheduledTasksApi.resume('t1');

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/scheduled-tasks/t1/resume',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('runNow', () => {
    test('sends POST to /run endpoint', async () => {
      mockFetch.mockResolvedValue(mockOk({ executionId: 'exec-1' }));

      const result = await scheduledTasksApi.runNow('t1');

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/scheduled-tasks/t1/run',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(result).toEqual({ executionId: 'exec-1' });
    });
  });

  describe('getExecutions', () => {
    test('fetches executions without limit', async () => {
      mockFetch.mockResolvedValue(mockOk([]));

      await scheduledTasksApi.getExecutions('t1');

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/scheduled-tasks/t1/executions',
        expect.anything(),
      );
    });

    test('fetches executions with limit', async () => {
      mockFetch.mockResolvedValue(mockOk([]));

      await scheduledTasksApi.getExecutions('t1', 10);

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/scheduled-tasks/t1/executions?limit=10',
        expect.anything(),
      );
    });
  });

  describe('error handling', () => {
    test('throws on non-ok response with error body', async () => {
      mockFetch.mockResolvedValue(mockError(400, { error: 'Bad input' }));

      await expect(scheduledTasksApi.get('t1')).rejects.toThrow('Bad input');
    });

    test('throws with statusText when error body has no error field', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({}),
      });

      await expect(scheduledTasksApi.get('t1')).rejects.toThrow(
        'Request failed: Internal Server Error',
      );
    });

    test('falls back to generic error when JSON parse fails', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Error',
        json: () => Promise.reject(new Error('Parse error')),
      });

      await expect(scheduledTasksApi.get('t1')).rejects.toThrow('Request failed');
    });
  });
});
