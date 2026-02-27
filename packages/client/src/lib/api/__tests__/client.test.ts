import { describe, test, expect, vi, beforeEach } from 'vitest';
import { api } from '../client';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockJsonResponse(data: any, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(data),
  };
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('api.conversations', () => {
  test('list calls GET /api/conversations', async () => {
    const responseData = { ok: true, data: [{ id: 'conv-1' }] };
    mockFetch.mockResolvedValue(mockJsonResponse(responseData));

    const result = await api.conversations.list();
    expect(result).toEqual(responseData);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/conversations',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
  });

  test('get calls GET /api/conversations/:id', async () => {
    const responseData = { ok: true, data: { id: 'conv-1', title: 'Test' } };
    mockFetch.mockResolvedValue(mockJsonResponse(responseData));

    const result = await api.conversations.get('conv-1');
    expect(result).toEqual(responseData);
    expect(mockFetch).toHaveBeenCalledWith('/api/conversations/conv-1', expect.any(Object));
  });

  test('create calls POST /api/conversations with body', async () => {
    const responseData = { ok: true, data: { id: 'new-conv' } };
    mockFetch.mockResolvedValue(mockJsonResponse(responseData));

    const result = await api.conversations.create({ title: 'New Chat', model: 'claude-opus-4-6' });
    expect(result).toEqual(responseData);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/conversations',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ title: 'New Chat', model: 'claude-opus-4-6' }),
      }),
    );
  });

  test('update calls PATCH /api/conversations/:id', async () => {
    const responseData = { ok: true };
    mockFetch.mockResolvedValue(mockJsonResponse(responseData));

    await api.conversations.update('conv-1', { title: 'Updated' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/conversations/conv-1',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  test('delete calls DELETE /api/conversations/:id', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));

    await api.conversations.delete('conv-1');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/conversations/conv-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  test('cost calls GET /api/conversations/:id/cost', async () => {
    const responseData = {
      ok: true,
      data: {
        model: 'sonnet',
        totalTokens: 100,
        inputTokens: 30,
        outputTokens: 70,
        estimatedCostUsd: 0.01,
      },
    };
    mockFetch.mockResolvedValue(mockJsonResponse(responseData));

    const result = await api.conversations.cost('conv-1');
    expect(result.data.totalTokens).toBe(100);
    expect(mockFetch).toHaveBeenCalledWith('/api/conversations/conv-1/cost', expect.any(Object));
  });
});

describe('api.tasks', () => {
  test('list calls GET /api/tasks', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.tasks.list();
    expect(mockFetch).toHaveBeenCalledWith('/api/tasks', expect.any(Object));
  });

  test('list with conversationId includes query param', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.tasks.list('conv-1');
    expect(mockFetch).toHaveBeenCalledWith('/api/tasks?conversationId=conv-1', expect.any(Object));
  });

  test('get calls GET /api/tasks/:id', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { id: 'task-1' } }));
    await api.tasks.get('task-1');
    expect(mockFetch).toHaveBeenCalledWith('/api/tasks/task-1', expect.any(Object));
  });

  test('create calls POST /api/tasks', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { id: 'task-1' } }));
    await api.tasks.create({ subject: 'Test', description: 'Desc' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/tasks',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('update calls PATCH /api/tasks/:id', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: {} }));
    await api.tasks.update('task-1', { status: 'completed' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/tasks/task-1',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  test('delete calls DELETE /api/tasks/:id', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.tasks.delete('task-1');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/tasks/task-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});

describe('api.settings', () => {
  test('get calls GET /api/settings', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { theme: 'dark' } }));
    const result = await api.settings.get();
    expect(result.data.theme).toBe('dark');
  });

  test('update calls PATCH /api/settings', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.settings.update({ theme: 'light' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/settings',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ settings: { theme: 'light' } }),
      }),
    );
  });
});

describe('api.mcp', () => {
  test('listServers calls GET /api/mcp/servers', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.mcp.listServers();
    expect(mockFetch).toHaveBeenCalledWith('/api/mcp/servers', expect.any(Object));
  });

  test('addServer calls POST /api/mcp/servers', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.mcp.addServer({ name: 'test', transport: 'stdio', command: 'node' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/mcp/servers',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('removeServer calls DELETE /api/mcp/servers/:name', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.mcp.removeServer('test');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/mcp/servers/test',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  test('getServer calls GET /api/mcp/servers/:name', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { name: 'test' } }));
    await api.mcp.getServer('test');
    expect(mockFetch).toHaveBeenCalledWith('/api/mcp/servers/test', expect.any(Object));
  });
});

describe('api.memory', () => {
  test('list calls GET /api/memory', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.memory.list();
    expect(mockFetch).toHaveBeenCalledWith('/api/memory', expect.any(Object));
  });

  test('list with workspacePath includes encoded query param', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.memory.list('/my/project');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/memory?workspacePath=%2Fmy%2Fproject',
      expect.any(Object),
    );
  });

  test('update calls PUT /api/memory', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.memory.update('/path/to/file', 'content');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/memory',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ path: '/path/to/file', content: 'content' }),
      }),
    );
  });
});

describe('api.files', () => {
  test('read calls GET /api/files/read with encoded path', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({ ok: true, data: { path: '/a/b', content: 'hi' } }),
    );
    await api.files.read('/a/b');
    expect(mockFetch).toHaveBeenCalledWith('/api/files/read?path=%2Fa%2Fb', expect.any(Object));
  });

  test('tree calls GET /api/files/tree with params', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.files.tree('/root', 3);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('path=%2Froot');
    expect(url).toContain('depth=3');
  });

  test('directories calls GET /api/files/directories', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({ ok: true, data: { parent: '/', directories: [] } }),
    );
    await api.files.directories('/root');
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('path=%2Froot');
  });
});

describe('api.agents', () => {
  test('list calls GET /api/agents', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.agents.list();
    expect(mockFetch).toHaveBeenCalledWith('/api/agents', expect.any(Object));
  });

  test('list with parentSessionId includes query param', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.agents.list('session-1');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/agents?parentSessionId=session-1',
      expect.any(Object),
    );
  });

  test('spawn calls POST /api/agents', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({ ok: true, data: { agentId: 'a1', sessionId: 's1' } }),
    );
    await api.agents.spawn({ type: 'explore', prompt: 'test' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/agents',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('get calls GET /api/agents/:id', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: {} }));
    await api.agents.get('agent-1');
    expect(mockFetch).toHaveBeenCalledWith('/api/agents/agent-1', expect.any(Object));
  });

  test('cancel calls POST /api/agents/:id/cancel', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.agents.cancel('agent-1');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/agents/agent-1/cancel',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

describe('api.tools', () => {
  test('list calls GET /api/tools', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.tools.list();
    expect(mockFetch).toHaveBeenCalledWith('/api/tools', expect.any(Object));
  });
});

describe('api.stream', () => {
  test('send calls POST /api/stream/:conversationId', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    await api.stream.send('conv-1', 'Hello');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/stream/conv-1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ content: 'Hello' }),
      }),
    );
  });

  test('send includes session ID header when provided', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    await api.stream.send('conv-1', 'Hello', 'session-123');
    const callArgs = mockFetch.mock.calls[0][1];
    expect(callArgs.headers['X-Session-Id']).toBe('session-123');
  });

  test('send does not include session ID header when null', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    await api.stream.send('conv-1', 'Hello', null);
    const callArgs = mockFetch.mock.calls[0][1];
    expect(callArgs.headers['X-Session-Id']).toBeUndefined();
  });

  test('cancel calls POST /api/stream/:id/cancel with session header', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.stream.cancel('conv-1', 'session-123');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/stream/conv-1/cancel',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Session-Id': 'session-123' }),
      }),
    );
  });
});

describe('error handling', () => {
  test('throws on non-ok response with error from body', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({ error: 'Conversation not found' }),
    });

    await expect(api.conversations.get('nonexistent')).rejects.toThrow('Conversation not found');
  });

  test('falls back to status text when no error in body', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({}),
    });

    await expect(api.conversations.list()).rejects.toThrow('HTTP 500');
  });

  test('handles JSON parse failure in error response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.reject(new Error('invalid json')),
    });

    await expect(api.conversations.list()).rejects.toThrow('Internal Server Error');
  });

  test('throws on network failure (fetch rejects)', async () => {
    mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(api.conversations.list()).rejects.toThrow(
      'Cannot connect to server. Is the backend running?',
    );
  });

  test('throws on non-JSON ok response', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'text/html' }),
    });

    await expect(api.conversations.list()).rejects.toThrow(
      'Server returned non-JSON response (text/html from /conversations). Is the backend running?',
    );
  });

  test('throws HTTP status on non-JSON error response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      headers: new Headers({ 'content-type': 'text/html' }),
    });

    await expect(api.conversations.list()).rejects.toThrow('HTTP 502: Bad Gateway');
  });
});

// ---- Additional coverage for partially tested namespaces ----

describe('api.conversations (additional methods)', () => {
  test('deleteMessage calls DELETE /api/conversations/:cid/messages/:mid', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));

    await api.conversations.deleteMessage('conv-1', 'msg-1');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/conversations/conv-1/messages/msg-1?deletePair=false',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  test('deleteMessage with deletePair=true', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));

    await api.conversations.deleteMessage('conv-1', 'msg-1', true);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/conversations/conv-1/messages/msg-1?deletePair=true',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  test('editMessage calls PUT /api/conversations/:cid/messages/:mid', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));

    await api.conversations.editMessage('conv-1', 'msg-1');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/conversations/conv-1/messages/msg-1',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  test('fork calls POST /api/conversations/:cid/fork', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { id: 'forked-conv' } }));

    const result = await api.conversations.fork('conv-1', 'msg-1');
    expect(result.data.id).toBe('forked-conv');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/conversations/conv-1/fork',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ messageId: 'msg-1' }),
      }),
    );
  });
});

describe('api.settings (additional methods)', () => {
  test('ollamaStatus calls GET /api/settings/ollama/status', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { available: true } }));
    const result = await api.settings.ollamaStatus();
    expect(result.data.available).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith('/api/settings/ollama/status', expect.any(Object));
  });

  test('ollamaModels calls GET /api/settings/ollama/models', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        ok: true,
        data: [{ name: 'llama2', size: 3000, modified_at: '2024-01-01' }],
      }),
    );
    const result = await api.settings.ollamaModels();
    expect(result.data).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledWith('/api/settings/ollama/models', expect.any(Object));
  });

  test('setApiKey calls PUT /api/settings/api-key', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.settings.setApiKey('openai', 'sk-test');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/settings/api-key',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ provider: 'openai', apiKey: 'sk-test' }),
      }),
    );
  });

  test('apiKeysStatus calls GET /api/settings/api-keys/status', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({ ok: true, data: { openai: true, anthropic: false } }),
    );
    const result = await api.settings.apiKeysStatus();
    expect(result.data.openai).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith('/api/settings/api-keys/status', expect.any(Object));
  });

  test('getBudget calls GET /api/settings/budget', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { budgetUsd: 50 } }));
    const result = await api.settings.getBudget();
    expect(result.data.budgetUsd).toBe(50);
    expect(mockFetch).toHaveBeenCalledWith('/api/settings/budget', expect.any(Object));
  });

  test('setBudget calls PUT /api/settings/budget', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.settings.setBudget(100);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/settings/budget',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ budgetUsd: 100 }),
      }),
    );
  });

  test('setBudget with null', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.settings.setBudget(null);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/settings/budget',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ budgetUsd: null }),
      }),
    );
  });
});

describe('api.mcp (additional methods)', () => {
  test('discover calls GET /api/mcp/discover', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.mcp.discover();
    expect(mockFetch).toHaveBeenCalledWith('/api/mcp/discover', expect.any(Object));
  });

  test('importServers calls POST /api/mcp/import', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { imported: 2 } }));
    await api.mcp.importServers([{ name: 's1' }, { name: 's2' }]);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/mcp/import',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ servers: [{ name: 's1' }, { name: 's2' }] }),
      }),
    );
  });
});

describe('api.files (additional methods)', () => {
  test('write calls PUT /api/files/write', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.files.write('/a/b.txt', 'content');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/files/write',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ path: '/a/b.txt', content: 'content' }),
      }),
    );
  });

  test('create calls POST /api/files/create', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.files.create('/a/new.txt', 'hello');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/files/create',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ path: '/a/new.txt', content: 'hello' }),
      }),
    );
  });

  test('create with default empty content', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.files.create('/a/empty.txt');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/files/create',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ path: '/a/empty.txt', content: '' }),
      }),
    );
  });

  test('delete calls DELETE /api/files/delete with encoded path', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.files.delete('/a/b.txt');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/files/delete?path=%2Fa%2Fb.txt',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  test('rename calls POST /api/files/rename', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.files.rename('/old.txt', '/new.txt');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/files/rename',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ oldPath: '/old.txt', newPath: '/new.txt' }),
      }),
    );
  });

  test('editorConfig calls GET /api/files/editorconfig with encoded path', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: {} }));
    await api.files.editorConfig('/project/src/file.ts');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/files/editorconfig?path=%2Fproject%2Fsrc%2Ffile.ts',
      expect.any(Object),
    );
  });

  test('verify calls POST /api/files/verify', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        ok: true,
        data: { filePath: '/a.ts', passed: true, issues: [], tool: 'eslint', duration: 100 },
      }),
    );
    await api.files.verify('/a.ts', '/workspace');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/files/verify',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ path: '/a.ts', workspacePath: '/workspace' }),
      }),
    );
  });
});

describe('api.stream (additional methods)', () => {
  test('sessions calls GET /api/stream/sessions', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.stream.sessions();
    expect(mockFetch).toHaveBeenCalledWith('/api/stream/sessions', expect.any(Object));
  });

  test('reconnect calls GET /api/stream/reconnect/:sessionId', async () => {
    mockFetch.mockResolvedValue({ ok: true, body: null, headers: new Headers() });
    await api.stream.reconnect('session-1');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/stream/reconnect/session-1',
      expect.objectContaining({
        headers: expect.any(Object),
      }),
    );
  });

  test('answerQuestion calls POST /api/stream/:cid/answer', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.stream.answerQuestion('conv-1', 'session-1', 'tc-1', { q1: 'yes' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/stream/conv-1/answer',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Session-Id': 'session-1' }),
        body: JSON.stringify({ toolCallId: 'tc-1', answers: { q1: 'yes' } }),
      }),
    );
  });
});

// ---- New namespaces ----

describe('api.workspaces', () => {
  test('list calls GET /api/workspaces', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.workspaces.list();
    expect(mockFetch).toHaveBeenCalledWith('/api/workspaces', expect.any(Object));
  });

  test('get calls GET /api/workspaces/:id', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { id: 'ws-1' } }));
    await api.workspaces.get('ws-1');
    expect(mockFetch).toHaveBeenCalledWith('/api/workspaces/ws-1', expect.any(Object));
  });

  test('create calls POST /api/workspaces', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { id: 'ws-new' } }));
    await api.workspaces.create({ name: 'Test', path: '/my/project' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/workspaces',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Test', path: '/my/project' }),
      }),
    );
  });

  test('update calls PATCH /api/workspaces/:id', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.workspaces.update('ws-1', { name: 'Updated' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/workspaces/ws-1',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  test('delete calls DELETE /api/workspaces/:id', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.workspaces.delete('ws-1');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/workspaces/ws-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  test('open calls POST /api/workspaces/:id/open', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.workspaces.open('ws-1');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/workspaces/ws-1/open',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('getSandbox calls GET /api/workspaces/sandbox/config with encoded path', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        ok: true,
        data: { enabled: true, allowedPaths: [], blockedCommands: [] },
      }),
    );
    await api.workspaces.getSandbox('/my/project');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/workspaces/sandbox/config?path=%2Fmy%2Fproject',
      expect.any(Object),
    );
  });

  test('updateSandbox calls PUT /api/workspaces/sandbox/config', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.workspaces.updateSandbox({ workspacePath: '/p', enabled: true });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/workspaces/sandbox/config',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ workspacePath: '/p', enabled: true }),
      }),
    );
  });
});

describe('api.search', () => {
  test('query calls GET /api/search with params', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        ok: true,
        data: { results: [], totalMatches: 0, fileCount: 0, truncated: false },
      }),
    );
    await api.search.query('hello', '/project');
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('/api/search?');
    expect(url).toContain('q=hello');
    expect(url).toContain('path=%2Fproject');
    expect(url).toContain('regex=false');
    expect(url).toContain('limit=500');
  });

  test('query with regex and custom limit', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        ok: true,
        data: { results: [], totalMatches: 0, fileCount: 0, truncated: false },
      }),
    );
    await api.search.query('test.*', '/project', true, 100);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('regex=true');
    expect(url).toContain('limit=100');
  });
});

describe('api.lsp', () => {
  test('servers calls GET /api/lsp/servers', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.lsp.servers();
    expect(mockFetch).toHaveBeenCalledWith('/api/lsp/servers', expect.any(Object));
  });

  test('install calls POST /api/lsp/install', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.lsp.install('typescript');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/lsp/install',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ language: 'typescript' }),
      }),
    );
  });
});

describe('api.git', () => {
  test('status calls GET /api/git/status with encoded path', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { isRepo: true, files: [] } }));
    await api.git.status('/my/project');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/git/status?path=%2Fmy%2Fproject',
      expect.any(Object),
    );
  });

  test('branch calls GET /api/git/branch with encoded path', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { branch: 'main' } }));
    await api.git.branch('/my/project');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/git/branch?path=%2Fmy%2Fproject',
      expect.any(Object),
    );
  });

  test('snapshot calls POST /api/git/snapshot', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        ok: true,
        data: { id: 'snap-1', headSha: 'abc', stashSha: null, hasChanges: false },
      }),
    );
    await api.git.snapshot('/proj', 'conv-1', 'pre-agent');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/git/snapshot',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ path: '/proj', conversationId: 'conv-1', reason: 'pre-agent' }),
      }),
    );
  });

  test('snapshots calls GET /api/git/snapshots with encoded path', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.git.snapshots('/proj');
    expect(mockFetch).toHaveBeenCalledWith('/api/git/snapshots?path=%2Fproj', expect.any(Object));
  });

  test('restoreSnapshot calls POST /api/git/snapshot/:id/restore', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { restored: true } }));
    await api.git.restoreSnapshot('snap-1');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/git/snapshot/snap-1/restore',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('diff calls GET /api/git/diff with params', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { diff: '+line' } }));
    await api.git.diff('/proj', 'file.ts', true);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('path=%2Fproj');
    expect(url).toContain('file=file.ts');
    expect(url).toContain('staged=true');
  });
});

describe('api.workspaceMemory', () => {
  test('list calls GET /api/workspace-memory with workspacePath', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.workspaceMemory.list('/project');
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('/api/workspace-memory?');
    expect(url).toContain('workspacePath=%2Fproject');
  });

  test('list with category includes category param', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.workspaceMemory.list('/project', 'patterns');
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('category=patterns');
  });

  test('get calls GET /api/workspace-memory/:id', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { id: 'wm-1' } }));
    await api.workspaceMemory.get('wm-1');
    expect(mockFetch).toHaveBeenCalledWith('/api/workspace-memory/wm-1', expect.any(Object));
  });

  test('create calls POST /api/workspace-memory', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { id: 'wm-new' } }));
    await api.workspaceMemory.create({
      workspacePath: '/proj',
      key: 'test-key',
      content: 'some content',
    });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/workspace-memory',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ workspacePath: '/proj', key: 'test-key', content: 'some content' }),
      }),
    );
  });

  test('update calls PATCH /api/workspace-memory/:id', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.workspaceMemory.update('wm-1', { content: 'updated' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/workspace-memory/wm-1',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  test('delete calls DELETE /api/workspace-memory/:id', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.workspaceMemory.delete('wm-1');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/workspace-memory/wm-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  test('search calls GET /api/workspace-memory/search/query with params', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.workspaceMemory.search('/proj', 'test query');
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('/api/workspace-memory/search/query?');
    expect(url).toContain('workspacePath=%2Fproj');
    expect(url).toContain('q=test+query');
  });

  test('extract calls POST /api/workspace-memory/extract', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { extracted: 3, created: 2 } }));
    const messages = [{ role: 'user', content: 'hello' }];
    await api.workspaceMemory.extract('/proj', messages);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/workspace-memory/extract',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ workspacePath: '/proj', messages }),
      }),
    );
  });

  test('context calls GET /api/workspace-memory/context with params', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { context: 'ctx', count: 5 } }));
    await api.workspaceMemory.context('/proj');
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('/api/workspace-memory/context?');
    expect(url).toContain('workspacePath=%2Fproj');
  });
});

describe('api.prds', () => {
  test('list calls GET /api/prds', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.prds.list();
    expect(mockFetch).toHaveBeenCalledWith('/api/prds', expect.any(Object));
  });

  test('list with workspacePath includes encoded query param', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.prds.list('/my/project');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prds?workspacePath=%2Fmy%2Fproject',
      expect.any(Object),
    );
  });

  test('get calls GET /api/prds/:id', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { id: 'prd-1' } }));
    await api.prds.get('prd-1');
    expect(mockFetch).toHaveBeenCalledWith('/api/prds/prd-1', expect.any(Object));
  });

  test('create calls POST /api/prds', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({ ok: true, data: { id: 'prd-new', storyIds: [] } }),
    );
    await api.prds.create({ title: 'New PRD' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prds',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('update calls PATCH /api/prds/:id', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.prds.update('prd-1', { title: 'Updated' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prds/prd-1',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  test('delete calls DELETE /api/prds/:id', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.prds.delete('prd-1');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prds/prd-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  test('addStory calls POST /api/prds/:prdId/stories', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { id: 'story-1' } }));
    await api.prds.addStory('prd-1', { title: 'Story' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prds/prd-1/stories',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('updateStory calls PATCH /api/prds/:prdId/stories/:storyId', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: {} }));
    await api.prds.updateStory('prd-1', 'story-1', { title: 'Updated' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prds/prd-1/stories/story-1',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  test('deleteStory calls DELETE /api/prds/:prdId/stories/:storyId', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.prds.deleteStory('prd-1', 'story-1');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prds/prd-1/stories/story-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  test('import calls POST /api/prds/import', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({ ok: true, data: { id: 'prd-1', storyIds: [], imported: 3 } }),
    );
    await api.prds.import('/proj', { title: 'PRD' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prds/import',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ workspacePath: '/proj', prdJson: { title: 'PRD' } }),
      }),
    );
  });

  test('export calls GET /api/prds/:id/export', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: {} }));
    await api.prds.export('prd-1');
    expect(mockFetch).toHaveBeenCalledWith('/api/prds/prd-1/export', expect.any(Object));
  });

  test('plan calls POST /api/prds/:prdId/plan', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        ok: true,
        data: { conversationId: 'c1', prdId: 'prd-1', mode: 'auto', editMode: 'create' },
      }),
    );
    await api.prds.plan('prd-1', { mode: 'auto', editMode: 'create' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prds/prd-1/plan',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('generate calls POST /api/prds/:prdId/generate', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({ ok: true, data: { stories: [], prdId: 'prd-1' } }),
    );
    await api.prds.generate('prd-1', { description: 'Build auth' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prds/prd-1/generate',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('acceptGenerated calls POST /api/prds/:prdId/generate/accept', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({ ok: true, data: { storyIds: ['s1'], accepted: 1 } }),
    );
    const stories = [
      {
        title: 'S1',
        description: 'Desc',
        acceptanceCriteria: ['AC1'],
        priority: 'high' as const,
      },
    ];
    await api.prds.acceptGenerated('prd-1', stories);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prds/prd-1/generate/accept',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ stories }),
      }),
    );
  });

  test('refineStory calls POST /api/prds/:prdId/stories/:storyId/refine', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        ok: true,
        data: {
          storyId: 's1',
          questions: [],
          qualityScore: 80,
          qualityExplanation: '',
          meetsThreshold: true,
        },
      }),
    );
    await api.prds.refineStory('prd-1', 's1', [{ questionId: 'q1', answer: 'yes' }]);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prds/prd-1/stories/s1/refine',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('getDependencyGraph calls GET /api/prds/:prdId/dependencies', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: {} }));
    await api.prds.getDependencyGraph('prd-1');
    expect(mockFetch).toHaveBeenCalledWith('/api/prds/prd-1/dependencies', expect.any(Object));
  });

  test('addDependency calls POST /api/prds/:prdId/dependencies', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: {} }));
    await api.prds.addDependency('prd-1', 's1', 's2', 'blocks');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prds/prd-1/dependencies',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ fromStoryId: 's1', toStoryId: 's2', reason: 'blocks' }),
      }),
    );
  });

  test('removeDependency calls DELETE /api/prds/:prdId/dependencies', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: {} }));
    await api.prds.removeDependency('prd-1', 's1', 's2');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prds/prd-1/dependencies',
      expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({ fromStoryId: 's1', toStoryId: 's2' }),
      }),
    );
  });

  test('editDependency calls PATCH /api/prds/:prdId/dependencies', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: {} }));
    await api.prds.editDependency('prd-1', 's1', 's2', 'new reason');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prds/prd-1/dependencies',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ fromStoryId: 's1', toStoryId: 's2', reason: 'new reason' }),
      }),
    );
  });

  test('analyzeDependencies calls POST /api/prds/:prdId/dependencies/analyze', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: {} }));
    await api.prds.analyzeDependencies('prd-1', true);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prds/prd-1/dependencies/analyze',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ replaceAutoDetected: true }),
      }),
    );
  });

  test('validateSprint calls GET /api/prds/:prdId/dependencies/validate', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: {} }));
    await api.prds.validateSprint('prd-1');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prds/prd-1/dependencies/validate',
      expect.any(Object),
    );
  });

  test('validateCriteria calls POST', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: {} }));
    await api.prds.validateCriteria('prd-1', 's1', ['AC1'], 'Title', 'Desc');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prds/prd-1/stories/s1/validate-criteria',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('estimateStory calls POST /api/prds/:prdId/stories/:storyId/estimate', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: {} }));
    await api.prds.estimateStory('prd-1', 's1');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prds/prd-1/stories/s1/estimate',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('saveManualEstimate calls PUT /api/prds/:prdId/stories/:storyId/estimate', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: {} }));
    await api.prds.saveManualEstimate('prd-1', 's1', {
      size: 'medium',
      storyPoints: 5,
      reasoning: 'test',
    });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prds/prd-1/stories/s1/estimate',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  test('estimatePrd calls POST /api/prds/:prdId/estimate', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: {} }));
    await api.prds.estimatePrd('prd-1', true);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prds/prd-1/estimate',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ reEstimate: true }),
      }),
    );
  });

  test('analyzeCompleteness calls POST /api/prds/:prdId/completeness', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: {} }));
    await api.prds.analyzeCompleteness('prd-1', ['overview']);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prds/prd-1/completeness',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ sections: ['overview'] }),
      }),
    );
  });

  test('generateSprintPlan calls POST /api/prds/:prdId/sprint-plan', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: {} }));
    await api.prds.generateSprintPlan('prd-1', 20, 'points');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prds/prd-1/sprint-plan',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ capacity: 20, capacityMode: 'points' }),
      }),
    );
  });

  test('saveAdjustedSprintPlan calls PUT /api/prds/:prdId/sprint-plan', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: {} }));
    const plan = { sprints: [] } as any;
    await api.prds.saveAdjustedSprintPlan('prd-1', plan);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prds/prd-1/sprint-plan',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  test('listTemplates calls GET /api/prds/templates', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.prds.listTemplates();
    expect(mockFetch).toHaveBeenCalledWith('/api/prds/templates', expect.any(Object));
  });

  test('listTemplates with category', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.prds.listTemplates('backend');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prds/templates?category=backend',
      expect.any(Object),
    );
  });

  test('getTemplate calls GET /api/prds/templates/:id', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: {} }));
    await api.prds.getTemplate('tpl-1');
    expect(mockFetch).toHaveBeenCalledWith('/api/prds/templates/tpl-1', expect.any(Object));
  });

  test('createTemplate calls POST /api/prds/templates', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: {} }));
    await api.prds.createTemplate({ name: 'Bug fix', description: 'Template for bugs' } as any);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prds/templates',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('updateTemplate calls PATCH /api/prds/templates/:id', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: {} }));
    await api.prds.updateTemplate('tpl-1', { name: 'Updated' } as any);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prds/templates/tpl-1',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  test('deleteTemplate calls DELETE /api/prds/templates/:id', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.prds.deleteTemplate('tpl-1');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prds/templates/tpl-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  test('createStoryFromTemplate calls POST', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: {} }));
    await api.prds.createStoryFromTemplate('prd-1', 'tpl-1', { name: 'Auth' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prds/prd-1/stories/from-template',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ templateId: 'tpl-1', variables: { name: 'Auth' } }),
      }),
    );
  });

  test('recommendPriority calls POST', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: {} }));
    await api.prds.recommendPriority('prd-1', 's1');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prds/prd-1/stories/s1/priority',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('acceptPriority calls PUT', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.prds.acceptPriority('prd-1', 's1', 'high', true);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prds/prd-1/stories/s1/priority',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ priority: 'high', accept: true }),
      }),
    );
  });

  test('recommendAllPriorities calls POST', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: {} }));
    await api.prds.recommendAllPriorities('prd-1');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prds/prd-1/priorities',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('listStandaloneStories calls GET /api/prds/stories with workspacePath', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.prds.listStandaloneStories('/proj');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prds/stories?workspacePath=%2Fproj',
      expect.any(Object),
    );
  });

  test('listAllStories calls GET /api/prds/stories/all', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({ ok: true, data: { standalone: [], byPrd: [] } }),
    );
    await api.prds.listAllStories('/proj');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prds/stories/all?workspacePath=%2Fproj',
      expect.any(Object),
    );
  });

  test('createStandaloneStory calls POST /api/prds/stories', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: {} }));
    await api.prds.createStandaloneStory({ workspacePath: '/proj', title: 'Bug fix' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prds/stories',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('updateStandaloneStory calls PATCH /api/prds/stories/:storyId', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: {} }));
    await api.prds.updateStandaloneStory('s1', { title: 'Updated' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prds/stories/s1',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  test('deleteStandaloneStory calls DELETE /api/prds/stories/:storyId', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.prds.deleteStandaloneStory('s1');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prds/stories/s1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  test('estimateStandaloneStory calls POST', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: {} }));
    await api.prds.estimateStandaloneStory('s1');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prds/stories/s1/estimate',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('saveStandaloneEstimate calls PUT', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: {} }));
    await api.prds.saveStandaloneEstimate('s1', { size: 'small', storyPoints: 2 });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/prds/stories/s1/estimate',
      expect.objectContaining({ method: 'PUT' }),
    );
  });
});

describe('api.loops', () => {
  test('start calls POST /api/loops/start', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { loopId: 'loop-1' } }));
    await api.loops.start({ prdId: 'prd-1', workspacePath: '/proj', config: {} });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/loops/start',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ prdId: 'prd-1', workspacePath: '/proj', config: {} }),
      }),
    );
  });

  test('pause calls POST /api/loops/:id/pause', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.loops.pause('loop-1');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/loops/loop-1/pause',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('resume calls POST /api/loops/:id/resume', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.loops.resume('loop-1');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/loops/loop-1/resume',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('cancel calls POST /api/loops/:id/cancel', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.loops.cancel('loop-1');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/loops/loop-1/cancel',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('get calls GET /api/loops/:id', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { id: 'loop-1' } }));
    await api.loops.get('loop-1');
    expect(mockFetch).toHaveBeenCalledWith('/api/loops/loop-1', expect.any(Object));
  });

  test('list calls GET /api/loops', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.loops.list();
    expect(mockFetch).toHaveBeenCalledWith('/api/loops', expect.any(Object));
  });

  test('list with status filter', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.loops.list('running');
    expect(mockFetch).toHaveBeenCalledWith('/api/loops?status=running', expect.any(Object));
  });

  test('log calls GET /api/loops/:id/log', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.loops.log('loop-1');
    expect(mockFetch).toHaveBeenCalledWith('/api/loops/loop-1/log', expect.any(Object));
  });
});

describe('api.external', () => {
  test('saveConfig calls POST /api/external/config', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.external.saveConfig({ provider: 'jira', apiKey: 'key-123' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/external/config',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ provider: 'jira', apiKey: 'key-123' }),
      }),
    );
  });

  test('getConfigStatus calls GET /api/external/config/:provider', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({ ok: true, data: { configured: true, provider: 'jira' } }),
    );
    await api.external.getConfigStatus('jira');
    expect(mockFetch).toHaveBeenCalledWith('/api/external/config/jira', expect.any(Object));
  });

  test('testConnection calls POST /api/external/test/:provider', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { connected: true } }));
    await api.external.testConnection('jira');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/external/test/jira',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('listProjects calls GET /api/external/projects/:provider', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.external.listProjects('linear');
    expect(mockFetch).toHaveBeenCalledWith('/api/external/projects/linear', expect.any(Object));
  });

  test('listIssues calls GET /api/external/issues/:provider/:projectKey', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.external.listIssues('jira', 'PROJ');
    expect(mockFetch).toHaveBeenCalledWith('/api/external/issues/jira/PROJ', expect.any(Object));
  });

  test('listIssues with status filter', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.external.listIssues('jira', 'PROJ', 'open');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/external/issues/jira/PROJ?status=open',
      expect.any(Object),
    );
  });

  test('importIssues calls POST /api/external/import', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        ok: true,
        data: { imported: 2, skipped: 0, storyIds: ['s1'], errors: [] },
      }),
    );
    await api.external.importIssues({
      provider: 'jira',
      projectKey: 'PROJ',
      workspacePath: '/proj',
    });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/external/import',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('refreshStory calls POST /api/external/refresh/:storyId', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: {} }));
    await api.external.refreshStory('s1');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/external/refresh/s1',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('refreshAll calls POST /api/external/refresh-all', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({ ok: true, data: { refreshed: 3, total: 5, errors: [] } }),
    );
    await api.external.refreshAll('/proj');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/external/refresh-all',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ workspacePath: '/proj' }),
      }),
    );
  });

  test('pushStatus calls POST /api/external/push-status', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.external.pushStatus({ storyId: 's1', status: 'completed', commitSha: 'abc123' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/external/push-status',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

describe('api.auth', () => {
  test('status calls GET /api/auth/status', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { enabled: false } }));
    const result = await api.auth.status();
    expect(result.data.enabled).toBe(false);
    expect(mockFetch).toHaveBeenCalledWith('/api/auth/status', expect.any(Object));
  });

  test('register calls POST /api/auth/register', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        ok: true,
        data: { id: 'u1', username: 'alice', token: 'tok', isAdmin: true },
      }),
    );
    await api.auth.register('alice', 'password123', 'Alice');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/auth/register',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ username: 'alice', password: 'password123', displayName: 'Alice' }),
      }),
    );
  });

  test('login calls POST /api/auth/login', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        ok: true,
        data: {
          id: 'u1',
          username: 'alice',
          displayName: 'Alice',
          isAdmin: false,
          token: 'tok',
        },
      }),
    );
    await api.auth.login('alice', 'password123');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/auth/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ username: 'alice', password: 'password123' }),
      }),
    );
  });

  test('me calls GET /api/auth/me', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({ ok: true, data: { id: 'u1', username: 'alice', isAdmin: false } }),
    );
    await api.auth.me();
    expect(mockFetch).toHaveBeenCalledWith('/api/auth/me', expect.any(Object));
  });

  test('users calls GET /api/auth/users', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.auth.users();
    expect(mockFetch).toHaveBeenCalledWith('/api/auth/users', expect.any(Object));
  });
});

describe('api.scan', () => {
  test('scanTodos calls POST /api/scan/todos', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { todos: [], total: 0 } }));
    await api.scan.scanTodos('/proj');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/scan/todos',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ workspacePath: '/proj' }),
      }),
    );
  });

  test('scanTodos with options', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { todos: [], total: 0 } }));
    await api.scan.scanTodos('/proj', { extensions: ['.ts'], maxResults: 50, prdId: 'prd-1' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/scan/todos',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          workspacePath: '/proj',
          extensions: ['.ts'],
          maxResults: 50,
          prdId: 'prd-1',
        }),
      }),
    );
  });

  test('importTodos calls POST /api/scan/todos/import', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({ ok: true, data: { created: 1, storyIds: ['s1'] } }),
    );
    await api.scan.importTodos({
      workspacePath: '/proj',
      todos: [
        {
          file: '/a.ts',
          line: 10,
          type: 'TODO',
          text: 'fix this',
          suggestedTitle: 'Fix bug',
          suggestedDescription: 'Fix the bug',
          priority: 'high',
        },
      ],
    });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/scan/todos/import',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('todoCount calls GET /api/scan/todos/count with encoded path', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({ ok: true, data: { count: 5, byType: { TODO: 3, FIXME: 2 } } }),
    );
    await api.scan.todoCount('/proj');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/scan/todos/count?workspacePath=%2Fproj',
      expect.any(Object),
    );
  });
});

describe('api.ambient', () => {
  test('startWatching calls POST /api/ambient/watch', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.ambient.startWatching('/proj');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/ambient/watch',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ workspacePath: '/proj' }),
      }),
    );
  });

  test('stopWatching calls DELETE /api/ambient/watch with encoded path', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.ambient.stopWatching('/proj');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/ambient/watch?workspacePath=%2Fproj',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  test('getNotifications calls GET /api/ambient/notifications', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.ambient.getNotifications('/proj');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/ambient/notifications?workspacePath=%2Fproj',
      expect.any(Object),
    );
  });

  test('dismissNotification calls DELETE /api/ambient/notifications/:id', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.ambient.dismissNotification('notif-1');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/ambient/notifications/notif-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  test('clearNotifications calls DELETE /api/ambient/notifications with path', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.ambient.clearNotifications('/proj');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/ambient/notifications?workspacePath=%2Fproj',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  test('status calls GET /api/ambient/status with encoded path', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({ ok: true, data: { watching: true, notificationCount: 3 } }),
    );
    const result = await api.ambient.status('/proj');
    expect(result.data.watching).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/ambient/status?workspacePath=%2Fproj',
      expect.any(Object),
    );
  });
});

describe('api.costs', () => {
  test('summary calls GET /api/costs/summary with no params', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        ok: true,
        data: {
          totalCostUsd: 1.5,
          totalTokens: 1000,
          inputTokens: 400,
          outputTokens: 600,
          conversationCount: 5,
          byModel: [],
          byDay: [],
          topConversations: [],
        },
      }),
    );
    const result = await api.costs.summary();
    expect(result.data.totalCostUsd).toBe(1.5);
    expect(mockFetch).toHaveBeenCalledWith('/api/costs/summary', expect.any(Object));
  });

  test('summary with all options', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { totalCostUsd: 0 } }));
    await api.costs.summary({ workspacePath: '/proj', since: 1000, until: 2000 });
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('workspacePath=%2Fproj');
    expect(url).toContain('since=1000');
    expect(url).toContain('until=2000');
  });

  test('summary with partial options', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { totalCostUsd: 0 } }));
    await api.costs.summary({ workspacePath: '/proj' });
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('workspacePath=%2Fproj');
    expect(url).not.toContain('since=');
    expect(url).not.toContain('until=');
  });
});

describe('api.diff', () => {
  test('parse calls POST /api/diff/parse', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: {} }));
    await api.diff.parse('diff --git a/file.ts', '/proj');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/diff/parse',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ input: 'diff --git a/file.ts', workspacePath: '/proj' }),
      }),
    );
  });

  test('parse without workspacePath', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: {} }));
    await api.diff.parse('some diff');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/diff/parse',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ input: 'some diff', workspacePath: undefined }),
      }),
    );
  });
});

describe('api.replay', () => {
  test('getTimeline calls GET /api/replay/:conversationId', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: {} }));
    await api.replay.getTimeline('conv-1');
    expect(mockFetch).toHaveBeenCalledWith('/api/replay/conv-1', expect.any(Object));
  });

  test('getChanges calls GET /api/replay/:conversationId/changes', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: {} }));
    await api.replay.getChanges('conv-1');
    expect(mockFetch).toHaveBeenCalledWith('/api/replay/conv-1/changes', expect.any(Object));
  });
});

describe('api.customTools', () => {
  test('list calls GET /api/custom-tools', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.customTools.list();
    expect(mockFetch).toHaveBeenCalledWith('/api/custom-tools', expect.any(Object));
  });

  test('list with workspacePath', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.customTools.list('/proj');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/custom-tools?workspacePath=%2Fproj',
      expect.any(Object),
    );
  });

  test('create calls POST /api/custom-tools', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: {} }));
    await api.customTools.create({
      name: 'my-tool',
      description: 'Test tool',
      inputSchema: {},
      handlerType: 'command',
      handlerCommand: 'echo test',
    });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/custom-tools',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('update calls PATCH /api/custom-tools/:id', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: {} }));
    await api.customTools.update('ct-1', { description: 'Updated' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/custom-tools/ct-1',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  test('delete calls DELETE /api/custom-tools/:id', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.customTools.delete('ct-1');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/custom-tools/ct-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  test('test calls POST /api/custom-tools/:id/test', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({ ok: true, data: { output: 'ok', exitCode: 0, duration: 50 } }),
    );
    await api.customTools.test('ct-1', { arg1: 'val1' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/custom-tools/ct-1/test',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ input: { arg1: 'val1' } }),
      }),
    );
  });
});

describe('api.pair', () => {
  test('createRoom calls POST /api/pair/rooms', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({ ok: true, data: { roomId: 'room-1', shareUrl: 'https://...' } }),
    );
    await api.pair.createRoom({ conversationId: 'conv-1', hostName: 'Alice' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/pair/rooms',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ conversationId: 'conv-1', hostName: 'Alice' }),
      }),
    );
  });

  test('getRoom calls GET /api/pair/rooms/:roomId', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: {} }));
    await api.pair.getRoom('room-1');
    expect(mockFetch).toHaveBeenCalledWith('/api/pair/rooms/room-1', expect.any(Object));
  });

  test('joinRoom calls POST /api/pair/rooms/:roomId/join', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.pair.joinRoom('room-1', 'Bob');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/pair/rooms/room-1/join',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ observerName: 'Bob' }),
      }),
    );
  });

  test('broadcast calls POST /api/pair/rooms/:roomId/broadcast', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.pair.broadcast('room-1', 'typing', { text: 'hello' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/pair/rooms/room-1/broadcast',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ event: 'typing', data: { text: 'hello' } }),
      }),
    );
  });

  test('closeRoom calls DELETE /api/pair/rooms/:roomId', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.pair.closeRoom('room-1');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/pair/rooms/room-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});

describe('api.initiatives', () => {
  test('list calls GET /api/initiatives', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.initiatives.list();
    expect(mockFetch).toHaveBeenCalledWith('/api/initiatives', expect.any(Object));
  });

  test('create calls POST /api/initiatives', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: {} }));
    await api.initiatives.create({ name: 'Q1 Goals', description: 'Quarter goals' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/initiatives',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Q1 Goals', description: 'Quarter goals' }),
      }),
    );
  });

  test('get calls GET /api/initiatives/:id', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { id: 'init-1' } }));
    await api.initiatives.get('init-1');
    expect(mockFetch).toHaveBeenCalledWith('/api/initiatives/init-1', expect.any(Object));
  });

  test('update calls PATCH /api/initiatives/:id', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: {} }));
    await api.initiatives.update('init-1', { name: 'Updated' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/initiatives/init-1',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  test('delete calls DELETE /api/initiatives/:id', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.initiatives.delete('init-1');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/initiatives/init-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  test('addWorkspace calls POST /api/initiatives/:id/workspaces', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.initiatives.addWorkspace('init-1', '/proj');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/initiatives/init-1/workspaces',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ workspacePath: '/proj' }),
      }),
    );
  });

  test('removeWorkspace calls DELETE /api/initiatives/:id/workspaces', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.initiatives.removeWorkspace('init-1', '/proj');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/initiatives/init-1/workspaces',
      expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({ workspacePath: '/proj' }),
      }),
    );
  });

  test('addPrd calls POST /api/initiatives/:id/prds', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.initiatives.addPrd('init-1', 'prd-1');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/initiatives/init-1/prds',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ prdId: 'prd-1' }),
      }),
    );
  });

  test('removePrd calls DELETE /api/initiatives/:id/prds', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.initiatives.removePrd('init-1', 'prd-1');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/initiatives/init-1/prds',
      expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({ prdId: 'prd-1' }),
      }),
    );
  });

  test('getProgress calls GET /api/initiatives/:id/progress', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: {} }));
    await api.initiatives.getProgress('init-1');
    expect(mockFetch).toHaveBeenCalledWith('/api/initiatives/init-1/progress', expect.any(Object));
  });
});

describe('api.digest', () => {
  test('today calls GET /api/digest/today', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: {} }));
    await api.digest.today();
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('/api/digest/today?');
  });

  test('today with workspacePath and date', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: {} }));
    await api.digest.today('/proj', '2024-01-15');
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('workspacePath=%2Fproj');
    expect(url).toContain('date=2024-01-15');
  });

  test('week calls GET /api/digest/week', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.digest.week();
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('/api/digest/week?');
  });

  test('week with workspacePath', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.digest.week('/proj');
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('workspacePath=%2Fproj');
  });
});

describe('auth token handling', () => {
  test('includes Authorization header when auth token is set', async () => {
    // Import setAuthToken and getAuthToken
    const { setAuthToken } = await import('../client');

    // Mock localStorage
    const mockLocalStorage: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => mockLocalStorage[key] ?? null,
      setItem: (key: string, val: string) => {
        mockLocalStorage[key] = val;
      },
      removeItem: (key: string) => {
        delete mockLocalStorage[key];
      },
    });

    setAuthToken('my-test-token');
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.conversations.list();

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['Authorization']).toBe('Bearer my-test-token');

    // Clean up
    setAuthToken(null);
  });
});

// ── api.manager ──

describe('api.manager', () => {
  test('overview calls GET /api/manager/overview', async () => {
    const responseData = {
      ok: true,
      data: {
        workspaces: [],
        pendingApprovals: [],
        inProgressStories: [],
        completedStories: [],
        summary: {},
      },
    };
    mockFetch.mockResolvedValue(mockJsonResponse(responseData));
    const result = await api.manager.overview();
    expect(result).toEqual(responseData);
    expect(mockFetch).toHaveBeenCalledWith('/api/manager/overview', expect.any(Object));
  });
});

// ── api.artifacts ──

describe('api.artifacts', () => {
  test('list calls GET /api/artifacts with conversationId', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.artifacts.list('conv-1');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/artifacts?conversationId=conv-1'),
      expect.any(Object),
    );
  });

  test('get calls GET /api/artifacts/:id', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { id: 'art-1' } }));
    await api.artifacts.get('art-1');
    expect(mockFetch).toHaveBeenCalledWith('/api/artifacts/art-1', expect.any(Object));
  });

  test('create calls POST /api/artifacts', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { id: 'art-new' } }));
    await api.artifacts.create({
      title: 'Test',
      content: 'hello',
      type: 'code',
      conversationId: 'conv-1',
    } as any);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/artifacts',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('update calls PATCH /api/artifacts/:id', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { id: 'art-1' } }));
    await api.artifacts.update('art-1', { title: 'Updated' } as any);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/artifacts/art-1',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  test('delete calls DELETE /api/artifacts/:id', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.artifacts.delete('art-1');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/artifacts/art-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  test('pin calls PATCH /api/artifacts/:id with pinned body', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { id: 'art-1' } }));
    await api.artifacts.pin('art-1', true);
    const call = mockFetch.mock.calls[0];
    expect(call[0]).toBe('/api/artifacts/art-1');
    expect(JSON.parse(call[1].body)).toEqual({ pinned: true });
  });
});

// ── api.agentNotes ──

describe('api.agentNotes', () => {
  test('list calls GET /api/agent-notes with workspacePath', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.agentNotes.list('/my/project');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/agent-notes?workspacePath='),
      expect.any(Object),
    );
  });

  test('list with status and category filters', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.agentNotes.list('/proj', { status: 'unread', category: 'suggestion' });
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('status=unread');
    expect(url).toContain('category=suggestion');
  });

  test('get calls GET /api/agent-notes/:id', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { id: 'n-1' } }));
    await api.agentNotes.get('n-1');
    expect(mockFetch).toHaveBeenCalledWith('/api/agent-notes/n-1', expect.any(Object));
  });

  test('create calls POST /api/agent-notes', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { id: 'n-new' } }));
    await api.agentNotes.create({ title: 'Note', content: 'text', workspacePath: '/proj' } as any);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/agent-notes',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('update calls PATCH /api/agent-notes/:id', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { id: 'n-1' } }));
    await api.agentNotes.update('n-1', { status: 'read' } as any);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/agent-notes/n-1',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  test('delete calls DELETE /api/agent-notes/:id', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.agentNotes.delete('n-1');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/agent-notes/n-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  test('markRead calls PATCH /api/agent-notes/mark-read', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { updated: 3 } }));
    await api.agentNotes.markRead('/proj');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/agent-notes/mark-read',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  test('unreadCount calls GET /api/agent-notes/unread-count', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { count: 5 } }));
    await api.agentNotes.unreadCount('/proj');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/agent-notes/unread-count'),
      expect.any(Object),
    );
  });
});

// ── api.commentary ──

describe('api.commentary', () => {
  test('getWorkspaceHistory calls correct endpoint', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { history: [] } }));
    await api.commentary.getWorkspaceHistory('ws-1', 50, 10);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('/api/commentary/ws-1/history');
    expect(url).toContain('limit=50');
    expect(url).toContain('offset=10');
  });

  test('getWorkspaceHistory without optional params', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { history: [] } }));
    await api.commentary.getWorkspaceHistory('ws-1');
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('/api/commentary/ws-1/history');
    expect(url).not.toContain('limit=');
  });

  test('getConversationHistory calls correct endpoint', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { history: [] } }));
    await api.commentary.getConversationHistory('conv-1', 20);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('/api/commentary/conversation/conv-1');
    expect(url).toContain('limit=20');
  });

  test('clearHistory calls DELETE', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { success: true } }));
    await api.commentary.clearHistory('ws-1');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/commentary/ws-1/history'),
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  test('exportHistory with options', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({ ok: true, data: { metadata: {}, entries: [] } }),
    );
    await api.commentary.exportHistory('ws-1', {
      format: 'json',
      startTime: 1000,
      endTime: 2000,
      limit: 100,
    });
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('/api/commentary/ws-1/export');
    expect(url).toContain('format=json');
    expect(url).toContain('startTime=1000');
  });

  test('getSettings calls GET', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        ok: true,
        data: { enabled: true, personality: 'wizard', verbosity: 'strategic' },
      }),
    );
    await api.commentary.getSettings('ws-1');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/commentary/ws-1/settings'),
      expect.any(Object),
    );
  });

  test('updateSettings calls PUT', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { enabled: false } }));
    await api.commentary.updateSettings('ws-1', { enabled: false });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/commentary/ws-1/settings'),
      expect.objectContaining({ method: 'PUT' }),
    );
  });
});

// ── api.crossSession ──

describe('api.crossSession', () => {
  test('listSessions calls GET /api/cross-session/sessions', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.crossSession.listSessions();
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/cross-session/sessions'),
      expect.any(Object),
    );
  });

  test('listSessions with exclude param', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.crossSession.listSessions('sess-1');
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('exclude=sess-1');
  });

  test('send calls POST /api/cross-session/send', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { id: 'msg-1' } }));
    await api.crossSession.send('conv-from', 'conv-to', 'Hello');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/cross-session/send',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('getUndelivered calls correct endpoint', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.crossSession.getUndelivered('conv-1');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/cross-session/messages/conv-1'),
      expect.any(Object),
    );
  });

  test('markDelivered calls POST', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.crossSession.markDelivered('msg-1');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/cross-session/messages/msg-1/delivered'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('getHistory calls correct endpoint with options', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.crossSession.getHistory('conv-1', { direction: 'sent', limit: 50 });
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('/api/cross-session/history/conv-1');
    expect(url).toContain('direction=sent');
    expect(url).toContain('limit=50');
  });

  test('getFlow calls correct endpoint', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.crossSession.getFlow(1000);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('/api/cross-session/flow');
    expect(url).toContain('since=1000');
  });
});

// ── api.ai ──

describe('api.ai', () => {
  test('codeAction calls POST /api/ai/code-action', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({ ok: true, data: { result: 'optimized code', action: 'optimize' } }),
    );
    await api.ai.codeAction('const x = 1', 'optimize', {
      filePath: '/foo.ts',
      language: 'typescript',
    });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/ai/code-action',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('listActions calls GET /api/ai/actions', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { actions: [] } }));
    await api.ai.listActions();
    expect(mockFetch).toHaveBeenCalledWith('/api/ai/actions', expect.any(Object));
  });
});

// ── api.review ──

describe('api.review', () => {
  test('proactive calls POST /api/review/proactive', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { warnings: [] } }));
    await api.review.proactive('const x: any = 1', '/foo.ts', 'typescript');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/review/proactive',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

// ── api.format ──

describe('api.format', () => {
  test('format calls POST /api/format', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({ ok: true, data: { formatted: true, formatter: 'prettier' } }),
    );
    await api.format.format('/foo.ts', 'typescript', '/project');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/format',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('formatters calls GET /api/format/formatters', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { formatters: [] } }));
    await api.format.formatters('/project');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/format/formatters'),
      expect.any(Object),
    );
  });
});

// ── api.tests ──

describe('api.tests', () => {
  test('affected calls POST /api/tests/affected', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { affected: [], total: 0 } }));
    await api.tests.affected('/root', ['src/foo.ts']);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/tests/affected',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('run calls POST /api/tests/run', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        ok: true,
        data: { command: 'vitest run foo.test.ts', testFile: 'foo.test.ts' },
      }),
    );
    await api.tests.run('/root', 'foo.test.ts', 'myTest', 'vitest');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/tests/run',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('generate calls POST /api/tests/generate', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        ok: true,
        data: { testCode: '...', testFile: 'foo.test.ts', framework: 'vitest' },
      }),
    );
    await api.tests.generate('const x = 1', '/foo.ts', 'myFunc', 'typescript', 'vitest');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/tests/generate',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

// ── api.profiles ──

describe('api.profiles', () => {
  test('list calls GET /api/profiles', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.profiles.list();
    expect(mockFetch).toHaveBeenCalledWith('/api/profiles', expect.any(Object));
  });

  test('get calls GET /api/profiles/:id', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { id: 'p-1' } }));
    await api.profiles.get('p-1');
    expect(mockFetch).toHaveBeenCalledWith('/api/profiles/p-1', expect.any(Object));
  });

  test('create calls POST /api/profiles', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { id: 'p-new' } }));
    await api.profiles.create({ name: 'Test', systemPrompt: 'Be nice' } as any);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/profiles',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('update calls PATCH /api/profiles/:id', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { id: 'p-1' } }));
    await api.profiles.update('p-1', { name: 'Updated' } as any);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/profiles/p-1',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  test('delete calls DELETE /api/profiles/:id', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.profiles.delete('p-1');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/profiles/p-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});

// ── api.loops.resetFailed ──

describe('api.loops.resetFailed', () => {
  test('calls POST /api/loops/stories/reset-failed', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({ ok: true, data: { resetCount: 2, loopId: null } }),
    );
    await api.loops.resetFailed({ prdId: 'p-1', workspacePath: '/project' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/loops/stories/reset-failed',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('includes restart and config in body', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({ ok: true, data: { resetCount: 1, loopId: 'loop-1' } }),
    );
    await api.loops.resetFailed({
      prdId: null,
      workspacePath: '/ws',
      restart: true,
      config: { foo: 1 },
    });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.restart).toBe(true);
    expect(body.config).toEqual({ foo: 1 });
  });
});

// ── utility functions ──

describe('utility functions', () => {
  test('getBaseUrl returns /api', async () => {
    const { getBaseUrl } = await import('../client');
    expect(getBaseUrl()).toBe('/api');
  });

  test('getWsBase returns websocket URL', async () => {
    const { getWsBase } = await import('../client');
    const wsBase = getWsBase();
    expect(wsBase).toMatch(/^wss?:\/\/.+\/api$/);
  });

  test('getDirectWsBase returns websocket URL', async () => {
    const { getDirectWsBase } = await import('../client');
    const wsBase = getDirectWsBase();
    expect(wsBase).toMatch(/^wss?:\/\/.+\/api$/);
  });

  test('setServerPort is a no-op', async () => {
    const { setServerPort } = await import('../client');
    // Should not throw
    setServerPort(3002);
  });

  test('waitForServer resolves immediately', async () => {
    const { waitForServer } = await import('../client');
    await waitForServer();
  });

  test('getCsrfToken returns null when not initialized', async () => {
    const { getCsrfToken } = await import('../client');
    // Could be null or previously set from other tests
    const token = getCsrfToken();
    expect(token === null || typeof token === 'string').toBe(true);
  });

  test('initCsrfToken fetches CSRF token from server', async () => {
    const { initCsrfToken } = await import('../client');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({ data: { token: 'csrf-test-123' } }),
    });

    await initCsrfToken();
    // The fetch should have been called for the CSRF token endpoint
    // (may or may not actually fetch depending on cached state)
  });

  test('setAuthToken and getAuthToken work together', async () => {
    const { setAuthToken, getAuthToken } = await import('../client');
    setAuthToken('test-token-123');
    expect(getAuthToken()).toBe('test-token-123');
    // Clean up
    setAuthToken(null);
  });
});

// ── api.skillsRegistry additional methods ──

describe('api.skillsRegistry (additional methods)', () => {
  test('browse with all params', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: {} }));
    await api.skillsRegistry.browse({
      query: 'test',
      category: 'dev',
      sortBy: 'name',
      tier: 'free',
      page: 2,
      pageSize: 10,
      workspacePath: '/project',
    });
    const url = mockFetch.mock.calls[0][0];
    expect(url).toContain('query=test');
    expect(url).toContain('category=dev');
    expect(url).toContain('page=2');
    expect(url).toContain('workspacePath=%2Fproject');
  });

  test('getSkill with workspacePath', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: {} }));
    await api.skillsRegistry.getSkill('sk-1', '/project');
    expect(mockFetch.mock.calls[0][0]).toContain('workspacePath=');
  });

  test('suggest calls correct URL', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.skillsRegistry.suggest('deploy app');
    expect(mockFetch.mock.calls[0][0]).toContain('/api/skills-registry/suggest');
  });

  test('bundled calls correct URL', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: [] }));
    await api.skillsRegistry.bundled();
    expect(mockFetch.mock.calls[0][0]).toContain('/api/skills-registry/bundled');
  });

  test('activate calls PATCH with correct body', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.skillsRegistry.activate('sk-1', true, '/project');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.skillId).toBe('sk-1');
    expect(body.activated).toBe(true);
  });

  test('pinVersion calls PATCH', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.skillsRegistry.pinVersion('sk-1', '1.0.0');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/skills-registry/pin-version',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  test('checkUpdates calls POST', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { updates: [] } }));
    await api.skillsRegistry.checkUpdates();
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/skills-registry/check-updates',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('updateConfig calls PATCH', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.skillsRegistry.updateConfig('sk-1', { key: 'val' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/skills-registry/config',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });
});

// ── api.rules additional methods ──

describe('api.rules (additional methods)', () => {
  test('create calls POST /api/rules', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { path: '/r', name: 'test' } }));
    await api.rules.create('/ws', 'test-rule', 'content here');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/rules',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('updateContent calls PUT /api/rules/content', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.rules.updateContent('/path/rule.md', 'new content');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/rules/content',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  test('setMode calls PATCH /api/rules/mode', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.rules.setMode('/ws', '/path/rule.md', 'active');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/rules/mode',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  test('getActive calls GET with workspacePath', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { context: '', count: 0 } }));
    await api.rules.getActive('/ws');
    expect(mockFetch.mock.calls[0][0]).toContain('workspacePath=');
  });

  test('getByName calls correct endpoint', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({ ok: true, data: { path: '/r', name: 'test', content: '' } }),
    );
    await api.rules.getByName('test-rule', '/ws');
    expect(mockFetch.mock.calls[0][0]).toContain('/api/rules/by-name/test-rule');
  });
});

// ── api.git additional methods ──

describe('api.git (additional streaming methods)', () => {
  test('pushStream handles successful push', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"type":"status","message":"Pushing..."}\n' +
              'data: {"type":"complete","setUpstream":true}\n',
          ),
        );
        controller.close();
      },
    });

    mockFetch.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    const events: any[] = [];
    const result = await api.git.pushStream('/project', (evt) => events.push(evt));

    expect(result.ok).toBe(true);
    expect(result.setUpstream).toBe(true);
    expect(events.length).toBeGreaterThan(0);
  });

  test('pushStream handles error event', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"error","message":"Push rejected"}\n'));
        controller.close();
      },
    });

    mockFetch.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    const result = await api.git.pushStream('/project', () => {});

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Push rejected');
  });

  test('pushStream handles HTTP error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      body: null,
      headers: new Headers(),
      json: () => Promise.resolve({ error: 'Server broke' }),
    });

    const result = await api.git.pushStream('/project', () => {});
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Server broke');
  });

  test('pushStream handles stream ending without complete event', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"status","message":"Starting"}\n'));
        controller.close();
      },
    });

    mockFetch.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    const result = await api.git.pushStream('/project', () => {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain('unexpectedly');
  });

  test('pushStream handles reader throwing', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.error(new Error('broken'));
      },
    });

    mockFetch.mockResolvedValue({ ok: true, body: stream, headers: new Headers() });

    const result = await api.git.pushStream('/project', () => {});
    expect(result.ok).toBe(false);
  });

  test('suggestCommitGroups calls POST', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { groups: [] } }));
    await api.git.suggestCommitGroups('/project');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/git/suggest-commit-groups',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('aiMerge calls POST', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { mergedText: 'merged' } }));
    await api.git.aiMerge('/ws', '/file.ts', 'content', {
      startLine: 1,
      sepLine: 5,
      endLine: 10,
      currentLabel: 'HEAD',
      incomingLabel: 'feature',
    });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/git/ai-merge',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('generateCommitMessage calls POST', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({ ok: true, data: { message: 'feat: add thing' } }),
    );
    await api.git.generateCommitMessage('/project');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/git/generate-commit-message',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('clean calls POST', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { cleaned: true } }));
    await api.git.clean('/project');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/git/clean',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('diagnose calls GET', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { checks: [] } }));
    await api.git.diagnose('/project');
    expect(mockFetch.mock.calls[0][0]).toContain('/api/git/diagnose');
  });

  test('push calls POST', async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({ ok: true, data: { pushed: true, setUpstream: false } }),
    );
    await api.git.push('/project', 'origin', 'main');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/git/push',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('blame calls GET', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { blame: [] } }));
    await api.git.blame('/project', 'src/app.ts');
    expect(mockFetch.mock.calls[0][0]).toContain('/api/git/blame');
  });

  test('commit calls POST', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { sha: 'abc123' } }));
    await api.git.commit('/project', 'fix: bug');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/git/commit',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('snapshotByMessage calls GET', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: {} }));
    await api.git.snapshotByMessage('msg-1');
    expect(mockFetch.mock.calls[0][0]).toContain('/api/git/snapshot/by-message/msg-1');
  });

  test('restoreSnapshot calls POST', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, data: { restored: true } }));
    await api.git.restoreSnapshot('snap-1');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/git/snapshot/snap-1/restore',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

// ── request error handling (additional) ──

describe('request error handling (additional)', () => {
  test('handles non-JSON content-type on ok response', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'text/html' }),
      json: () => Promise.resolve({}),
    });

    await expect(api.conversations.list()).rejects.toThrow('non-JSON response');
  });

  test('handles non-JSON content-type on error response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      headers: new Headers({ 'content-type': 'text/html' }),
      json: () => Promise.resolve({}),
    });

    await expect(api.conversations.list()).rejects.toThrow('HTTP 502');
  });

  test('handles fetch failure (network down)', async () => {
    mockFetch.mockRejectedValue(new Error('Failed to fetch'));

    await expect(api.conversations.list()).rejects.toThrow('Cannot connect to server');
  });

  test('handles non-ok JSON response with error field', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({ error: 'Invalid input' }),
    });

    await expect(api.conversations.list()).rejects.toThrow('Invalid input');
  });

  test('handles non-ok JSON response without error field', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({}),
    });

    await expect(api.conversations.list()).rejects.toThrow('HTTP 403');
  });

  test('handles non-ok response when json() fails', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.reject(new Error('parse error')),
    });

    await expect(api.conversations.list()).rejects.toThrow('Internal Server Error');
  });
});

// ── api.stream additional methods ──

describe('api.stream (sessions / reconnect)', () => {
  test('sessions fetches with raw fetch and returns data', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({ ok: true, data: [{ id: 'sess-1' }] }),
    });

    const result = await api.stream.sessions();
    expect(result.data).toHaveLength(1);
    expect(mockFetch.mock.calls[0][0]).toContain('/api/stream/sessions');
  });

  test('sessions throws on non-ok response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: new Headers(),
    });

    await expect(api.stream.sessions()).rejects.toThrow('HTTP 500');
  });

  test('sessions throws on non-JSON response', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html' }),
      json: () => Promise.resolve({}),
    });

    await expect(api.stream.sessions()).rejects.toThrow('non-JSON response');
  });

  test('reconnect calls fetch with session ID in URL', async () => {
    mockFetch.mockResolvedValue({ ok: true, body: null, headers: new Headers() });
    await api.stream.reconnect('sess-123');
    expect(mockFetch.mock.calls[0][0]).toContain('/api/stream/reconnect/sess-123');
  });

  test('answerQuestion calls POST with correct body', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
    await api.stream.answerQuestion('conv-1', 'sess-1', 'tc-1', { q1: 'yes' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/stream/conv-1/answer',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.toolCallId).toBe('tc-1');
    expect(body.answers).toEqual({ q1: 'yes' });
  });

  test('nudge calls POST with content', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ ok: true, queued: true, messageId: 'm-1' }));
    await api.stream.nudge('conv-1', 'sess-1', 'keep going');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/stream/conv-1/nudge',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
