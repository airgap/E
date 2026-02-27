import { describe, test, expect, vi, beforeEach } from 'vitest';

const mockGetWorkspaceHistory = vi.fn();
const mockGetConversationHistory = vi.fn();
const mockClearHistory = vi.fn();

vi.mock('$lib/api/client', () => ({
  api: {
    commentary: {
      getWorkspaceHistory: (...args: unknown[]) => mockGetWorkspaceHistory(...args),
      getConversationHistory: (...args: unknown[]) => mockGetConversationHistory(...args),
      clearHistory: (...args: unknown[]) => mockClearHistory(...args),
    },
  },
}));

import {
  loadWorkspaceHistory,
  loadConversationHistory,
  clearWorkspaceHistory,
} from '../commentary-history';

beforeEach(() => {
  mockGetWorkspaceHistory.mockReset();
  mockGetConversationHistory.mockReset();
  mockClearHistory.mockReset();
});

describe('loadWorkspaceHistory', () => {
  test('returns mapped entries on success', async () => {
    mockGetWorkspaceHistory.mockResolvedValue({
      ok: true,
      data: {
        history: [
          { text: 'Hello', timestamp: 1000, personality: 'wizard', workspace_id: 'ws-1' },
          { text: 'World', timestamp: 2000, personality: 'sports_caster', workspace_id: 'ws-1' },
        ],
      },
    });

    const result = await loadWorkspaceHistory('ws-1');

    expect(mockGetWorkspaceHistory).toHaveBeenCalledWith('ws-1', 100, 0);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      text: 'Hello',
      timestamp: 1000,
      personality: 'wizard',
      workspaceId: 'ws-1',
    });
  });

  test('passes custom limit and offset', async () => {
    mockGetWorkspaceHistory.mockResolvedValue({ ok: true, data: { history: [] } });

    await loadWorkspaceHistory('ws-1', 50, 25);

    expect(mockGetWorkspaceHistory).toHaveBeenCalledWith('ws-1', 50, 25);
  });

  test('returns empty array when response is not ok', async () => {
    mockGetWorkspaceHistory.mockResolvedValue({ ok: false, data: {} });

    const result = await loadWorkspaceHistory('ws-1');
    expect(result).toEqual([]);
  });

  test('returns empty array when history is missing', async () => {
    mockGetWorkspaceHistory.mockResolvedValue({ ok: true, data: {} });

    const result = await loadWorkspaceHistory('ws-1');
    expect(result).toEqual([]);
  });

  test('returns empty array on error', async () => {
    mockGetWorkspaceHistory.mockRejectedValue(new Error('Network error'));

    const result = await loadWorkspaceHistory('ws-1');
    expect(result).toEqual([]);
  });
});

describe('loadConversationHistory', () => {
  test('returns mapped entries on success', async () => {
    mockGetConversationHistory.mockResolvedValue({
      ok: true,
      data: {
        history: [
          { text: 'Conv entry', timestamp: 3000, personality: 'noir', workspace_id: 'ws-2' },
        ],
      },
    });

    const result = await loadConversationHistory('conv-1');

    expect(mockGetConversationHistory).toHaveBeenCalledWith('conv-1', 100);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      text: 'Conv entry',
      timestamp: 3000,
      personality: 'noir',
      workspaceId: 'ws-2',
    });
  });

  test('passes custom limit', async () => {
    mockGetConversationHistory.mockResolvedValue({ ok: true, data: { history: [] } });

    await loadConversationHistory('conv-1', 20);

    expect(mockGetConversationHistory).toHaveBeenCalledWith('conv-1', 20);
  });

  test('returns empty array on error', async () => {
    mockGetConversationHistory.mockRejectedValue(new Error('Network error'));

    const result = await loadConversationHistory('conv-1');
    expect(result).toEqual([]);
  });

  test('returns empty array when response not ok', async () => {
    mockGetConversationHistory.mockResolvedValue({ ok: false, data: {} });

    const result = await loadConversationHistory('conv-1');
    expect(result).toEqual([]);
  });
});

describe('clearWorkspaceHistory', () => {
  test('calls api.commentary.clearHistory', async () => {
    mockClearHistory.mockResolvedValue(undefined);

    await clearWorkspaceHistory('ws-1');

    expect(mockClearHistory).toHaveBeenCalledWith('ws-1');
  });

  test('rethrows on error', async () => {
    mockClearHistory.mockRejectedValue(new Error('DB error'));

    await expect(clearWorkspaceHistory('ws-1')).rejects.toThrow('DB error');
  });
});
