// API base URL. In browser mode, the page is same-origin with the API.
// In Tauri local mode, __TAURI_SIDECAR_PORT__ points to localhost:port.
// In Tauri remote mode (E_REMOTE=host:port), __TAURI_SIDECAR_ORIGIN__ has the full host:port.
// Runtime remote: connectToRemote() sets __TAURI_SIDECAR_ORIGIN__ from the UI.
function getTauriOrigin(): string | null {
  if (typeof window === 'undefined') return null;
  const w = window as any;
  if (w.__TAURI_SIDECAR_ORIGIN__) return w.__TAURI_SIDECAR_ORIGIN__;
  if (w.__TAURI_SIDECAR_PORT__) return `localhost:${w.__TAURI_SIDECAR_PORT__}`;
  return null;
}

/** Connect the client to a remote E server. All API/WS calls redirect there. */
export async function connectToRemote(origin: string): Promise<void> {
  const health = await fetch(`http://${origin}/health`).catch(() => null);
  if (!health?.ok) throw new Error(`Cannot reach server at ${origin}`);
  (window as any).__TAURI_SIDECAR_ORIGIN__ = origin;
  try {
    localStorage.setItem('e-remote-origin', origin);
  } catch {}
}

/** Disconnect from remote server. Reverts to local sidecar. */
export function disconnectFromRemote(): void {
  delete (window as any).__TAURI_SIDECAR_ORIGIN__;
  try {
    localStorage.removeItem('e-remote-origin');
  } catch {}
}

/** Returns the current remote origin, or null if connected locally. */
export function getRemoteOrigin(): string | null {
  if (typeof window === 'undefined') return null;
  return (window as any).__TAURI_SIDECAR_ORIGIN__ || null;
}

/** Restore a persisted remote connection on startup. */
export function restoreRemoteConnection(): void {
  try {
    const saved = localStorage.getItem('e-remote-origin');
    if (saved) (window as any).__TAURI_SIDECAR_ORIGIN__ = saved;
  } catch {}
}

export function getBaseUrl(): string {
  const origin = getTauriOrigin();
  if (origin) return `http://${origin}/api`;
  return '/api';
}

export function getWsBase(): string {
  const origin = getTauriOrigin();
  if (origin) return `ws://${origin}/api`;
  const host = typeof window !== 'undefined' ? window.location.host : 'localhost:3002';
  const wsProtocol =
    typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${wsProtocol}://${host}/api`;
}

/**
 * Direct WebSocket base URL — bypasses Vite proxy in dev for lower latency.
 * In production (Tauri), falls back to the same-origin getWsBase().
 */
export function getDirectWsBase(): string {
  if (typeof window === 'undefined') return 'ws://localhost:3002/api';
  const origin = getTauriOrigin();
  if (origin) return `ws://${origin}/api`;
  // In dev mode, Vite serves on a different port than the API server.
  // Connect directly to the API server to skip the proxy hop.
  const isDev = window.location.port === '3333';
  if (isDev) {
    return 'ws://localhost:3002/api';
  }
  // Production — same origin
  return getWsBase();
}

export function setServerPort(_port: number) {
  // No-op — kept for backwards compatibility
}

export async function waitForServer(): Promise<void> {
  // Browser / dev mode: same-origin, no handshake needed.
  if (typeof window === 'undefined' || !('__TAURI__' in window)) return;

  // In Tauri the sidecar port is injected by an initialization script, so it's
  // present on reloads too. But on cold boot the sidecar may not be listening
  // yet, so we probe /health until it answers (up to 30s) before resolving.
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const origin = getTauriOrigin();
    if (origin) {
      try {
        const res = await fetch(`http://${origin}/health`, { cache: 'no-store' });
        if (res.ok) return;
      } catch {
        // Connection refused / net error — sidecar not up yet; retry.
      }
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  // Timed out — let the app continue; individual requests will surface their own errors.
}

// Auth token storage
let _authToken: string | null = null;
export function setAuthToken(token: string | null) {
  _authToken = token;
  if (typeof localStorage !== 'undefined') {
    if (token) localStorage.setItem('e-auth-token', token);
    else localStorage.removeItem('e-auth-token');
  }
}
export function getAuthToken(): string | null {
  if (_authToken) return _authToken;
  if (typeof localStorage !== 'undefined') {
    _authToken = localStorage.getItem('e-auth-token');
  }
  return _authToken;
}

// CSRF token — fetched once at startup, required for all mutations
let _csrfToken: string | null = null;
let _csrfFetching: Promise<void> | null = null;

/** Fetch and cache the CSRF token from the server. Called at app init and on token expiry. */
export async function initCsrfToken(): Promise<void> {
  if (_csrfToken) return;
  if (_csrfFetching) return _csrfFetching;
  _csrfFetching = (async () => {
    try {
      const res = await fetch(`${getBaseUrl()}/auth/csrf-token`);
      if (res.ok) {
        const body = await res.json();
        _csrfToken = body?.data?.token || null;
        if (!_csrfToken) {
          console.warn('[CSRF] Token response OK but token is null/empty:', body);
        } else {
          console.log('[CSRF] Token acquired');
        }
      } else {
        console.warn('[CSRF] Token fetch failed: HTTP %d %s', res.status, res.statusText);
      }
    } catch (err) {
      console.warn('[CSRF] Token fetch threw (server not ready?):', err);
    } finally {
      _csrfFetching = null;
    }
  })();
  return _csrfFetching;
}

/**
 * Re-fetch the CSRF token (e.g. after a server restart invalidated it).
 * Clears the cached token first so initCsrfToken actually fetches.
 */
export async function refreshCsrfToken(): Promise<void> {
  _csrfToken = null;
  _csrfFetching = null;
  await initCsrfToken();
}

export function getCsrfToken(): string | null {
  return _csrfToken;
}

async function request<T>(path: string, opts: RequestInit = {}, _retried = false): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string>),
  };
  const token = getAuthToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  // Include CSRF token on all requests (server validates on mutations)
  if (_csrfToken) headers['X-CSRF-Token'] = _csrfToken;

  let res: Response;
  try {
    res = await fetch(`${getBaseUrl()}${path}`, { ...opts, headers });
  } catch (err) {
    // Distinguish page-unload / HMR aborts from genuine connectivity issues.
    // When Vite HMR reloads the page mid-request, fetch throws an AbortError
    // or TypeError("Failed to fetch") — not a real server outage.
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Request was cancelled (page may be reloading).');
    }
    throw new Error('Cannot connect to server. Is the backend running?');
  }

  // Auto-refresh CSRF token on 403 (server restart invalidates old tokens)
  if (res.status === 403 && !_retried) {
    const body = await res.json().catch(() => ({}));
    if (body.error?.includes('CSRF')) {
      console.log('[CSRF] Token expired, refreshing...');
      await refreshCsrfToken();
      return request<T>(path, opts, true);
    }
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(
      res.ok
        ? `Server returned non-JSON response (${contentType || 'no content-type'} from ${path}). Is the backend running?`
        : `HTTP ${res.status}: ${res.statusText}`,
    );
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// --- Conversations ---
export const api = {
  conversations: {
    list: () => request<{ ok: boolean; data: any[] }>('/conversations'),
    get: (id: string) => request<{ ok: boolean; data: any }>(`/conversations/${id}`),
    create: (body: {
      title?: string;
      model?: string;
      systemPrompt?: string;
      workspacePath?: string;
      permissionMode?: string;
      effort?: string;
      maxBudgetUsd?: number;
      maxTurns?: number;
      allowedTools?: string[];
      disallowedTools?: string[];
      planMode?: boolean;
    }) =>
      request<{ ok: boolean; data: { id: string } }>('/conversations', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    update: (id: string, body: Record<string, any>) =>
      request<{ ok: boolean }>(`/conversations/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    delete: (id: string) => request<{ ok: boolean }>(`/conversations/${id}`, { method: 'DELETE' }),
    cost: (id: string) =>
      request<{
        ok: boolean;
        data: {
          model: string;
          totalTokens: number;
          inputTokens: number;
          outputTokens: number;
          estimatedCostUsd: number;
        };
      }>(`/conversations/${id}/cost`),
    deleteMessage: (conversationId: string, messageId: string, deletePair = false) =>
      request<{ ok: boolean }>(
        `/conversations/${conversationId}/messages/${messageId}?deletePair=${deletePair}`,
        {
          method: 'DELETE',
        },
      ),
    editMessage: (conversationId: string, messageId: string) =>
      request<{ ok: boolean }>(`/conversations/${conversationId}/messages/${messageId}`, {
        method: 'PUT',
      }),
    fork: (conversationId: string, messageId: string) =>
      request<{ ok: boolean; data: { id: string; parentId: string; forkMessageId: string } }>(
        `/conversations/${conversationId}/fork`,
        {
          method: 'POST',
          body: JSON.stringify({ messageId }),
        },
      ),
    /** Get fork lineage: parent, children, siblings */
    branches: (conversationId: string) =>
      request<{
        ok: boolean;
        data: {
          parent: { id: string; title: string; created_at: number } | null;
          children: Array<{
            id: string;
            title: string;
            forked_from_message_id: string;
            created_at: number;
          }>;
          siblings: Array<{
            id: string;
            title: string;
            forked_from_message_id: string;
            created_at: number;
          }>;
          sameForkSiblings: Array<{ id: string; title: string; created_at: number }>;
          forkMessageId: string | null;
          parentConversationId: string | null;
        };
      }>(`/conversations/${conversationId}/branches`),
    /** Get branches at a specific message fork point */
    branchesAt: (conversationId: string, messageId: string) =>
      request<{ ok: boolean; data: Array<{ id: string; title: string; created_at: number }> }>(
        `/conversations/${conversationId}/branches-at/${messageId}`,
      ),
    /** Get stored compact summary for a conversation (null if not yet generated). */
    summary: (id: string) =>
      request<{ ok: boolean; data: { id: string; title: string; summary: string | null } }>(
        `/conversations/${id}/summary`,
      ),
    /** Manually compact conversation history by summarizing older messages. */
    compact: (id: string) =>
      request<{
        ok: boolean;
        data: {
          originalCount: number;
          compactedCount: number;
          droppedCount: number;
          usedLLM: boolean;
        };
      }>(`/conversations/${id}/compact`, { method: 'POST' }),
    /** Get compaction history for a conversation. */
    compactionHistory: (id: string) =>
      request<{
        ok: boolean;
        data: Array<{
          id: string;
          trigger: 'auto' | 'manual';
          originalCount: number;
          compactedCount: number;
          droppedCount: number;
          summaryText: string;
          usedLLM: boolean;
          retentionCount: number;
          thresholdPct: number | null;
          compactedAt: number;
        }>;
      }>(`/conversations/${id}/compaction-history`),
    /** Get recent compaction events across all conversations. */
    recentCompactions: (limit = 50) =>
      request<{
        ok: boolean;
        data: Array<{
          id: string;
          conversationId: string;
          conversationTitle: string;
          trigger: 'auto' | 'manual';
          originalCount: number;
          compactedCount: number;
          droppedCount: number;
          summaryText: string;
          usedLLM: boolean;
          retentionCount: number;
          thresholdPct: number | null;
          compactedAt: number;
        }>;
      }>(`/conversations/compaction-history/recent?limit=${limit}`),
    /** Generate and store a compact summary for a conversation (idempotent). */
    summarize: (id: string) =>
      request<{ ok: boolean; data: { summary: string | null; cached: boolean } }>(
        `/conversations/${id}/summarize`,
        {
          method: 'POST',
        },
      ),
  },

  // --- Streaming ---
  stream: {
    send: async (
      conversationId: string,
      content: string,
      sessionId?: string | null,
      signal?: AbortSignal,
      attachments?: import('@e/shared').Attachment[],
      agentHandle?: string,
    ) => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const token = getAuthToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
      if (_csrfToken) headers['X-CSRF-Token'] = _csrfToken;
      if (sessionId) headers['X-Session-Id'] = sessionId;

      // Build images array for provider compatibility
      const images =
        attachments
          ?.filter((a) => a.type === 'image' && a.content && a.mimeType)
          .map((a) => ({ data: a.content!, mediaType: a.mimeType! })) || [];

      const body = JSON.stringify({
        content,
        ...(images.length > 0 ? { images } : {}),
        ...(attachments?.length ? { attachments } : {}),
        ...(agentHandle ? { agentHandle } : {}),
      });

      const res = await fetch(`${getBaseUrl()}/stream/${conversationId}`, {
        method: 'POST',
        headers,
        body,
        signal,
      });

      // Auto-refresh CSRF token on 403 and retry once
      if (res.status === 403) {
        const cloned = res.clone();
        try {
          const errBody = await cloned.json();
          if (errBody.error?.includes('CSRF')) {
            console.log('[CSRF] Stream token expired, refreshing...');
            await refreshCsrfToken();
            const retryHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
            if (token) retryHeaders['Authorization'] = `Bearer ${token}`;
            if (_csrfToken) retryHeaders['X-CSRF-Token'] = _csrfToken;
            if (sessionId) retryHeaders['X-Session-Id'] = sessionId;
            return fetch(`${getBaseUrl()}/stream/${conversationId}`, {
              method: 'POST',
              headers: retryHeaders,
              body,
              signal,
            });
          }
        } catch {
          // Couldn't parse error body — return original response
        }
      }

      return res;
    },
    cancel: (conversationId: string, sessionId: string) =>
      request(`/stream/${conversationId}/cancel`, {
        method: 'POST',
        headers: { 'X-Session-Id': sessionId },
      }),
    sessions: async (): Promise<{
      ok: boolean;
      data: Array<{
        id: string;
        conversationId: string;
        status: string;
        streamComplete: boolean;
        cancelled: boolean;
        bufferedEvents: number;
      }>;
    }> => {
      // Use raw fetch() instead of the request() helper. During SvelteKit page
      // initialization, the enhanced fetch() is intercepted by the client-side
      // router, returning non-JSON responses. Raw fetch goes directly through
      // the Vite dev proxy to the backend.
      const headers: Record<string, string> = {};
      const token = getAuthToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
      if (_csrfToken) headers['X-CSRF-Token'] = _csrfToken;
      const res = await fetch(`${getBaseUrl()}/stream/sessions`, {
        headers,
        cache: 'no-store',
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error(
          `Server returned non-JSON response (${contentType || 'no content-type'} from /stream/sessions). Is the backend running?`,
        );
      }
      return res.json();
    },
    reconnect: (sessionId: string, signal?: AbortSignal) => {
      const headers: Record<string, string> = {};
      const token = getAuthToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
      if (_csrfToken) headers['X-CSRF-Token'] = _csrfToken;
      return fetch(`${getBaseUrl()}/stream/reconnect/${sessionId}`, { headers, signal });
    },
    answerQuestion: (
      conversationId: string,
      sessionId: string,
      toolCallId: string,
      answers: Record<string, string>,
    ) =>
      request(`/stream/${conversationId}/answer`, {
        method: 'POST',
        headers: { 'X-Session-Id': sessionId },
        body: JSON.stringify({ toolCallId, answers }),
      }),
    nudge: (conversationId: string, sessionId: string, content: string) =>
      request<{ ok: boolean; queued: boolean; messageId: string }>(
        `/stream/${conversationId}/nudge`,
        {
          method: 'POST',
          headers: { 'X-Session-Id': sessionId },
          body: JSON.stringify({ content }),
        },
      ),
  },

  // --- Tasks ---
  tasks: {
    list: (conversationId?: string) => {
      const q = conversationId ? `?conversationId=${conversationId}` : '';
      return request<{ ok: boolean; data: any[] }>(`/tasks${q}`);
    },
    get: (id: string) => request<{ ok: boolean; data: any }>(`/tasks/${id}`),
    create: (body: {
      subject: string;
      description: string;
      activeForm?: string;
      conversationId?: string;
    }) =>
      request<{ ok: boolean; data: { id: string } }>('/tasks', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    update: (id: string, body: Record<string, any>) =>
      request<{ ok: boolean; data: any }>(`/tasks/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    delete: (id: string) => request<{ ok: boolean }>(`/tasks/${id}`, { method: 'DELETE' }),
  },

  // --- Settings ---
  settings: {
    get: () => request<{ ok: boolean; data: Record<string, any> }>('/settings'),
    update: (settings: Record<string, any>) =>
      request<{ ok: boolean }>('/settings', {
        method: 'PATCH',
        body: JSON.stringify({ settings }),
      }),
    ollamaStatus: () =>
      request<{ ok: boolean; data: { available: boolean } }>('/settings/ollama/status'),
    ollamaModels: () =>
      request<{
        ok: boolean;
        data: Array<{ name: string; size: number; modified_at: string }>;
      }>('/settings/ollama/models'),
    openaiModels: () =>
      request<{ ok: boolean; data: Array<{ id: string; name: string }> }>(
        '/settings/openai/models',
      ),
    geminiModels: () =>
      request<{ ok: boolean; data: Array<{ id: string; name: string }> }>(
        '/settings/gemini/models',
      ),
    setApiKey: (provider: string, apiKey: string) =>
      request<{ ok: boolean }>('/settings/api-key', {
        method: 'PUT',
        body: JSON.stringify({ provider, apiKey }),
      }),
    apiKeysStatus: () =>
      request<{ ok: boolean; data: Record<string, boolean> }>('/settings/api-keys/status'),
    getBudget: () =>
      request<{ ok: boolean; data: { budgetUsd: number | null } }>('/settings/budget'),
    setBudget: (budgetUsd: number | null) =>
      request<{ ok: boolean }>('/settings/budget', {
        method: 'PUT',
        body: JSON.stringify({ budgetUsd }),
      }),
    // Permission rules
    getPermissionRules: (opts?: {
      scope?: string;
      workspacePath?: string;
      conversationId?: string;
    }) => {
      const params = new URLSearchParams();
      if (opts?.scope) params.set('scope', opts.scope);
      if (opts?.workspacePath) params.set('workspacePath', opts.workspacePath);
      if (opts?.conversationId) params.set('conversationId', opts.conversationId);
      const q = params.toString();
      return request<{
        ok: boolean;
        data: Array<import('@e/shared').PermissionRule>;
      }>(`/settings/permission-rules${q ? '?' + q : ''}`);
    },
    createPermissionRule: (body: {
      type: 'allow' | 'deny' | 'ask';
      tool: string;
      pattern?: string;
      scope: 'session' | 'project' | 'global';
      workspacePath?: string;
      conversationId?: string;
    }) =>
      request<{ ok: boolean; data: import('@e/shared').PermissionRule }>(
        '/settings/permission-rules',
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
      ),
    updatePermissionRule: (id: string, body: Record<string, any>) =>
      request<{ ok: boolean; data: import('@e/shared').PermissionRule }>(
        `/settings/permission-rules/${id}`,
        {
          method: 'PATCH',
          body: JSON.stringify(body),
        },
      ),
    deletePermissionRule: (id: string) =>
      request<{ ok: boolean }>(`/settings/permission-rules/${id}`, { method: 'DELETE' }),
    getPermissionPresets: () =>
      request<{
        ok: boolean;
        data: Array<import('@e/shared').PermissionRulePreset>;
      }>('/settings/permission-rules/presets'),
    applyPermissionPreset: (body: {
      presetId: string;
      scope: 'session' | 'project' | 'global';
      workspacePath?: string;
      conversationId?: string;
    }) =>
      request<{
        ok: boolean;
        data: Array<import('@e/shared').PermissionRule>;
      }>('/settings/permission-rules/apply-preset', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  },

  // --- MCP ---
  mcp: {
    listServers: () => request<{ ok: boolean; data: any[] }>('/mcp/servers'),
    addServer: (body: any) =>
      request<{ ok: boolean }>('/mcp/servers', { method: 'POST', body: JSON.stringify(body) }),
    removeServer: (name: string) =>
      request<{ ok: boolean }>(`/mcp/servers/${name}`, { method: 'DELETE' }),
    getServer: (name: string) => request<{ ok: boolean; data: any }>(`/mcp/servers/${name}`),
    discover: () =>
      request<{
        ok: boolean;
        data: Array<{
          source: string;
          configPath: string;
          servers: Array<{
            name: string;
            command?: string;
            args?: string[];
            url?: string;
            env?: Record<string, string>;
            transport: string;
          }>;
        }>;
      }>('/mcp/discover'),
    importServers: (servers: any[]) =>
      request<{ ok: boolean; data: { imported: number } }>('/mcp/import', {
        method: 'POST',
        body: JSON.stringify({ servers }),
      }),
  },

  // --- Memory ---
  memory: {
    list: (workspacePath?: string) => {
      const q = workspacePath ? `?workspacePath=${encodeURIComponent(workspacePath)}` : '';
      return request<{ ok: boolean; data: any[] }>(`/memory${q}`);
    },
    update: (path: string, content: string) =>
      request<{ ok: boolean }>('/memory', {
        method: 'PUT',
        body: JSON.stringify({ path, content }),
      }),
  },

  // --- Skills Marketplace ---
  skillsRegistry: {
    browse: (params?: {
      query?: string;
      category?: string;
      sortBy?: string;
      tier?: string;
      page?: number;
      pageSize?: number;
      workspacePath?: string;
    }) => {
      const searchParams = new URLSearchParams();
      if (params?.query) searchParams.set('query', params.query);
      if (params?.category) searchParams.set('category', params.category);
      if (params?.sortBy) searchParams.set('sortBy', params.sortBy);
      if (params?.tier) searchParams.set('tier', params.tier);
      if (params?.page) searchParams.set('page', String(params.page));
      if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));
      if (params?.workspacePath) searchParams.set('workspacePath', params.workspacePath);
      const q = searchParams.toString();
      return request<{ ok: boolean; data: any }>(`/skills-registry/browse${q ? `?${q}` : ''}`);
    },
    getSkill: (id: string, workspacePath?: string) => {
      const q = workspacePath ? `?workspacePath=${encodeURIComponent(workspacePath)}` : '';
      return request<{ ok: boolean; data: any }>(
        `/skills-registry/skill/${encodeURIComponent(id)}${q}`,
      );
    },
    install: (
      skillId: string,
      opts?: { tier?: string; workspacePath?: string; pinnedVersion?: string },
    ) =>
      request<{ ok: boolean; data: { path: string; skillId: string } }>(
        '/skills-registry/install',
        {
          method: 'POST',
          body: JSON.stringify({ skillId, ...opts }),
        },
      ),
    uninstall: (skillId: string, workspacePath?: string) =>
      request<{ ok: boolean }>('/skills-registry/uninstall', {
        method: 'POST',
        body: JSON.stringify({ skillId, workspacePath }),
      }),
    installed: (workspacePath?: string) => {
      const q = workspacePath ? `?workspacePath=${encodeURIComponent(workspacePath)}` : '';
      return request<{ ok: boolean; data: any[] }>(`/skills-registry/installed${q}`);
    },
    create: (input: {
      name: string;
      description: string;
      category?: string;
      tags?: string[];
      promptTemplate?: string;
      rules?: string[];
      requiredTools?: string[];
      requiredMcpServers?: string[];
      workspacePath?: string;
    }) =>
      request<{ ok: boolean; data: { skillId: string; path: string } }>('/skills-registry/create', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    updateConfig: (skillId: string, config: Record<string, any>) =>
      request<{ ok: boolean }>('/skills-registry/config', {
        method: 'PATCH',
        body: JSON.stringify({ skillId, config }),
      }),
    activate: (skillId: string, activated: boolean, workspacePath?: string) =>
      request<{ ok: boolean }>('/skills-registry/activate', {
        method: 'PATCH',
        body: JSON.stringify({ skillId, activated, workspacePath }),
      }),
    pinVersion: (skillId: string, pinnedVersion?: string) =>
      request<{ ok: boolean }>('/skills-registry/pin-version', {
        method: 'PATCH',
        body: JSON.stringify({ skillId, pinnedVersion }),
      }),
    checkUpdates: () =>
      request<{
        ok: boolean;
        data: {
          updates: Array<{ skillId: string; currentVersion: string; latestVersion: string }>;
        };
      }>('/skills-registry/check-updates', {
        method: 'POST',
      }),
    suggest: (query: string) =>
      request<{
        ok: boolean;
        data: Array<{ skillId: string; skillName: string; reason: string; confidence: number }>;
      }>(`/skills-registry/suggest?query=${encodeURIComponent(query)}`),
    bundled: () => request<{ ok: boolean; data: any[] }>('/skills-registry/bundled'),
  },

  // --- Rules ---
  rules: {
    list: (workspacePath?: string) => {
      const q = workspacePath ? `?workspacePath=${encodeURIComponent(workspacePath)}` : '';
      return request<{
        ok: boolean;
        data: Array<{
          path: string;
          name: string;
          content: string;
          type: string;
          mode: string;
          lastModified: number;
        }>;
      }>(`/rules${q}`);
    },
    create: (workspacePath: string, name: string, content?: string) =>
      request<{ ok: boolean; data: { path: string; name: string } }>('/rules', {
        method: 'POST',
        body: JSON.stringify({ workspacePath, name, content }),
      }),
    updateContent: (path: string, content: string) =>
      request<{ ok: boolean }>('/rules/content', {
        method: 'PUT',
        body: JSON.stringify({ path, content }),
      }),
    setMode: (workspacePath: string, filePath: string, mode: string) =>
      request<{ ok: boolean }>('/rules/mode', {
        method: 'PATCH',
        body: JSON.stringify({ workspacePath, filePath, mode }),
      }),
    getActive: (workspacePath: string) => {
      const q = `?workspacePath=${encodeURIComponent(workspacePath)}`;
      return request<{ ok: boolean; data: { context: string; count: number } }>(
        `/rules/active${q}`,
      );
    },
    getByName: (name: string, workspacePath?: string) => {
      const q = workspacePath ? `?workspacePath=${encodeURIComponent(workspacePath)}` : '';
      return request<{
        ok: boolean;
        data: { path: string; name: string; content: string };
      }>(`/rules/by-name/${encodeURIComponent(name)}${q}`);
    },
  },

  // --- Files ---
  pui: {
    // Bundle a bare npm specifier from the workspace node_modules (parabun
    // bundler, svelte external) for the in-browser .pui designer preview.
    bundle: (specifier: string, fromFile: string) =>
      request<{ ok: boolean; data?: { js: string }; error?: string }>('/pui/bundle', {
        method: 'POST',
        body: JSON.stringify({ specifier, fromFile }),
      }),
    // Discover component manifests from the workspace's installed libraries
    // (any package with a `componentManifest` field) for the designer palette.
    manifests: (fromFile: string) =>
      request<{
        ok: boolean;
        data?: { manifests: Array<{ package: string; manifest: unknown }> };
        error?: string;
      }>('/pui/manifests', {
        method: 'POST',
        body: JSON.stringify({ fromFile }),
      }),
    // Resolve a bare specifier to a library SOURCE file (source-shipping libs)
    // so the preview can compile it client-side; null ⇒ use the bundle path.
    resolve: (specifier: string, fromFile: string) =>
      request<{ ok: boolean; data?: { path: string | null }; error?: string }>('/pui/resolve', {
        method: 'POST',
        body: JSON.stringify({ specifier, fromFile }),
      }),
    // Install / list / remove component libraries from a release tarball (or
    // local path) — the no-npm path. Installed libs feed the palette.
    libraries: {
      install: (source: string) =>
        request<{ ok: boolean; data?: { name: string }; error?: string }>('/pui/libraries', {
          method: 'POST',
          body: JSON.stringify({ source }),
        }),
      list: () =>
        request<{
          ok: boolean;
          data?: { libraries: Array<{ name: string; version: string; hasManifest: boolean }> };
        }>('/pui/libraries'),
      remove: (name: string) =>
        request<{ ok: boolean }>('/pui/libraries', {
          method: 'DELETE',
          body: JSON.stringify({ name }),
        }),
    },
  },
  sass: {
    // Compile SCSS/Sass source to CSS for the live preview.
    compile: (source: string, path: string, indented: boolean) =>
      request<{ ok: boolean; data?: { css: string }; error?: string }>('/sass/compile', {
        method: 'POST',
        body: JSON.stringify({ source, path, indented }),
      }),
  },
  files: {
    read: (path: string) =>
      request<{ ok: boolean; data: { path: string; content: string } }>(
        `/files/read?path=${encodeURIComponent(path)}`,
      ),
    write: (path: string, content: string) =>
      request<{ ok: boolean }>('/files/write', {
        method: 'PUT',
        body: JSON.stringify({ path, content }),
      }),
    create: (path: string, content = '') =>
      request<{ ok: boolean }>('/files/create', {
        method: 'POST',
        body: JSON.stringify({ path, content }),
      }),
    mkdir: (path: string) =>
      request<{ ok: boolean; error?: string }>('/files/mkdir', {
        method: 'POST',
        body: JSON.stringify({ path }),
      }),
    delete: (path: string) =>
      request<{ ok: boolean }>(`/files/delete?path=${encodeURIComponent(path)}`, {
        method: 'DELETE',
      }),
    rename: (oldPath: string, newPath: string) =>
      request<{ ok: boolean }>('/files/rename', {
        method: 'POST',
        body: JSON.stringify({ oldPath, newPath }),
      }),
    tree: (path?: string, depth?: number) => {
      const params = new URLSearchParams();
      if (path) params.set('path', path);
      if (depth) params.set('depth', String(depth));
      return request<{ ok: boolean; data: any[] }>(`/files/tree?${params}`);
    },
    editorConfig: (path: string) =>
      request<{ ok: boolean; data: import('@e/shared').EditorConfigProps }>(
        `/files/editorconfig?path=${encodeURIComponent(path)}`,
      ),
    directories: (path?: string) => {
      const params = new URLSearchParams();
      if (path) params.set('path', path);
      return request<{
        ok: boolean;
        data: { parent: string; directories: { name: string; path: string }[] };
      }>(`/files/directories?${params}`);
    },
    verify: (path: string, workspacePath?: string) =>
      request<{
        ok: boolean;
        data: {
          filePath: string;
          passed: boolean;
          issues: Array<{ severity: string; line?: number; message: string; rule?: string }>;
          tool: string;
          duration: number;
        };
      }>('/files/verify', {
        method: 'POST',
        body: JSON.stringify({ path, workspacePath }),
      }),
  },

  // --- Filesystem watcher ---
  fileWatch: {
    status: () => request<{ ok: boolean; data: { root: string | null } }>('/file-watch/status'),
    watch: (rootPath: string) =>
      request<{ ok: boolean; data: { root: string | null } }>('/file-watch/watch', {
        method: 'POST',
        body: JSON.stringify({ rootPath }),
      }),
  },

  // --- Agent registry (chat participants) ---
  agentsRegistry: {
    list: () =>
      request<{
        ok: boolean;
        data: Array<{
          id: string;
          handle: string;
          name: string;
          description: string;
          icon: string;
          tagline?: string;
          transport: 'claude-cli' | 'provider';
          provider?: string;
          model?: string;
          systemPrompt?: string;
          allowedTools?: string[];
          disallowedTools?: string[];
          enabled: boolean;
          source: 'builtin' | 'user';
        }>;
      }>('/agents-registry'),
  },

  // --- Debug Adapter Protocol ---
  debug: {
    adapters: () =>
      request<{
        ok: boolean;
        data: Array<{ id: string; label: string; languages: string[]; available: boolean }>;
      }>('/dap/adapters'),
    sessions: () =>
      request<{ ok: boolean; data: { total: number; sessions: string[] } }>('/dap/sessions'),
    stopSession: (id: string) =>
      request<{ ok: boolean }>(`/dap/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },

  // --- Workspaces ---
  workspaces: {
    list: () => request<{ ok: boolean; data: any[] }>('/workspaces'),
    get: (id: string) => request<{ ok: boolean; data: any }>(`/workspaces/${id}`),
    create: (body: { name: string; path: string; settings?: any }) =>
      request<{ ok: boolean; data: { id: string } }>('/workspaces', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    update: (id: string, body: Record<string, any>) =>
      request<{ ok: boolean }>(`/workspaces/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    delete: (id: string) => request<{ ok: boolean }>(`/workspaces/${id}`, { method: 'DELETE' }),
    open: (id: string) => request<{ ok: boolean }>(`/workspaces/${id}/open`, { method: 'POST' }),
    getSandbox: (path: string) =>
      request<{
        ok: boolean;
        data: { enabled: boolean; allowedPaths: string[]; blockedCommands: string[] };
      }>(`/workspaces/sandbox/config?path=${encodeURIComponent(path)}`),
    updateSandbox: (body: {
      workspacePath: string;
      enabled?: boolean;
      allowedPaths?: string[];
      blockedCommands?: string[];
    }) =>
      request<{ ok: boolean }>('/workspaces/sandbox/config', {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
  },

  // --- Agents ---
  agents: {
    list: (parentSessionId?: string) => {
      const q = parentSessionId ? `?parentSessionId=${parentSessionId}` : '';
      return request<{ ok: boolean; data: any[] }>(`/agents${q}`);
    },
    spawn: (body: any) =>
      request<{ ok: boolean; data: { agentId: string; sessionId: string } }>('/agents', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    get: (id: string) => request<{ ok: boolean; data: any }>(`/agents/${id}`),
    cancel: (id: string) => request<{ ok: boolean }>(`/agents/${id}/cancel`, { method: 'POST' }),
  },

  // --- Tools ---
  tools: {
    list: () => request<{ ok: boolean; data: any[] }>('/tools'),
  },

  // --- PreToolUse hook plumbing (inline edit approval) ---
  hooks: {
    /** Resolve a held PreToolUse hook request — unblocks Claude Code. */
    pretooluseRespond: (requestId: string, decision: 'allow' | 'deny', reason?: string) =>
      request<{ ok: boolean }>('/hooks/pretooluse-respond', {
        method: 'POST',
        body: JSON.stringify({ requestId, decision, reason }),
      }),
  },

  // --- Search ---
  search: {
    query: (
      q: string,
      path: string,
      opts: { regex?: boolean; caseSensitive?: boolean; wholeWord?: boolean; limit?: number } = {},
    ) => {
      const params = new URLSearchParams({
        q,
        path,
        regex: String(opts.regex ?? false),
        caseSensitive: String(opts.caseSensitive ?? false),
        wholeWord: String(opts.wholeWord ?? false),
        limit: String(opts.limit ?? 500),
      });
      return request<{
        ok: boolean;
        data: {
          results: Array<{
            file: string;
            relativePath: string;
            line: number;
            column: number;
            content: string;
            matchStart: number;
            matchEnd: number;
            context?: Array<{ line: number; content: string }>;
          }>;
          totalMatches: number;
          fileCount: number;
          truncated: boolean;
        };
      }>(`/search?${params}`);
    },
    replace: (
      searchText: string,
      replaceText: string,
      files: string[],
      rootPath: string,
      opts: {
        isRegex?: boolean;
        caseSensitive?: boolean;
        wholeWord?: boolean;
        dryRun?: boolean;
      } = {},
    ) =>
      request<{
        ok: boolean;
        data: {
          replacedCount: number;
          filesModified: number;
          perFile: Array<{ file: string; replacements: number }>;
          dryRun: boolean;
        };
      }>('/search/replace', {
        method: 'POST',
        body: JSON.stringify({
          searchText,
          replaceText,
          files,
          rootPath,
          isRegex: opts.isRegex ?? false,
          caseSensitive: opts.caseSensitive ?? false,
          wholeWord: opts.wholeWord ?? false,
          dryRun: opts.dryRun ?? false,
        }),
      }),
  },

  // --- LSP ---
  lsp: {
    servers: () =>
      request<{
        ok: boolean;
        data: Array<{
          language: string;
          command: string;
          args: string[];
          available: boolean;
          installable: boolean;
          npmPackage?: string;
          binaryDownload?: Record<string, string>;
          systemInstallHint?: string;
        }>;
      }>('/lsp/servers'),
    install: (language: string) =>
      request<{ ok: boolean; error?: string }>('/lsp/install', {
        method: 'POST',
        headers: { 'X-Confirm-Install': 'true' },
        body: JSON.stringify({ language }),
      }),
  },

  // --- Git ---
  git: {
    status: (path: string, opts: { ignored?: boolean } = {}) =>
      request<{
        ok: boolean;
        data: {
          isRepo: boolean;
          files: Array<{ path: string; status: string; staged: boolean }>;
          /** Gitignored paths — only populated when opts.ignored is true. */
          ignored: string[];
          indexLocked: boolean;
        };
      }>(`/git/status?path=${encodeURIComponent(path)}${opts.ignored ? '&ignored=true' : ''}`),
    branch: (path: string) =>
      request<{ ok: boolean; data: { branch: string } }>(
        `/git/branch?path=${encodeURIComponent(path)}`,
      ),
    stage: (path: string, files?: string[]) =>
      request<{ ok: boolean }>('/git/stage', {
        method: 'POST',
        body: JSON.stringify({ path, files }),
      }),
    unstage: (path: string, files?: string[]) =>
      request<{ ok: boolean }>('/git/unstage', {
        method: 'POST',
        body: JSON.stringify({ path, files }),
      }),
    snapshot: (path: string, conversationId?: string, reason?: string, messageId?: string) =>
      request<{
        ok: boolean;
        data: { id: string; headSha: string; stashSha: string | null; hasChanges: boolean };
      }>('/git/snapshot', {
        method: 'POST',
        body: JSON.stringify({ path, conversationId, reason, messageId }),
      }),
    snapshots: (path: string) =>
      request<{
        ok: boolean;
        data: Array<{
          id: string;
          workspacePath: string;
          conversationId: string | null;
          headSha: string;
          stashSha: string | null;
          reason: string;
          hasChanges: boolean;
          messageId: string | null;
          createdAt: number;
        }>;
      }>(`/git/snapshots?path=${encodeURIComponent(path)}`),
    snapshotByMessage: (messageId: string) =>
      request<{
        ok: boolean;
        data: {
          id: string;
          workspacePath: string;
          conversationId: string | null;
          headSha: string;
          stashSha: string | null;
          reason: string;
          hasChanges: boolean;
          messageId: string | null;
          createdAt: number;
        };
      }>(`/git/snapshot/by-message/${messageId}`),
    restoreSnapshot: (id: string) =>
      request<{ ok: boolean; data: { restored: boolean } }>(`/git/snapshot/${id}/restore`, {
        method: 'POST',
      }),
    diff: (path: string, file: string, staged: boolean) =>
      request<{ ok: boolean; data: { diff: string } }>(
        `/git/diff?path=${encodeURIComponent(path)}&file=${encodeURIComponent(file)}&staged=${staged}`,
      ),
    blame: (path: string, file: string) =>
      request<{
        ok: boolean;
        data: {
          blame: Array<{
            line: number;
            sha: string;
            author: string;
            timestamp: number;
            summary: string;
          }>;
        };
      }>(`/git/blame?path=${encodeURIComponent(path)}&file=${encodeURIComponent(file)}`),
    log: (path: string, opts?: { limit?: number; branch?: string; all?: boolean }) => {
      const q = new URLSearchParams({ path });
      if (opts?.limit) q.set('limit', String(opts.limit));
      if (opts?.branch) q.set('branch', opts.branch);
      if (opts?.all === false) q.set('all', 'false');
      return request<{
        ok: boolean;
        data: {
          commits: Array<{
            sha: string;
            parents: string[];
            author: string;
            email: string;
            timestamp: number;
            subject: string;
            refs: string[];
          }>;
        };
      }>(`/git/log?${q.toString()}`);
    },
    showCommit: (path: string, sha: string) =>
      request<{
        ok: boolean;
        data: {
          sha: string;
          parents: string[];
          author: string;
          email: string;
          timestamp: number;
          subject: string;
          body: string;
          files: Array<{ path: string; additions: number; deletions: number }>;
        };
      }>(`/git/commit/${encodeURIComponent(sha)}?path=${encodeURIComponent(path)}`),
    showCommitDiff: (path: string, sha: string, file?: string) => {
      const q = new URLSearchParams({ path });
      if (file) q.set('file', file);
      return request<{ ok: boolean; data: { diff: string } }>(
        `/git/commit/${encodeURIComponent(sha)}/diff?${q.toString()}`,
      );
    },
    commit: (path: string, message: string, opts?: { noAutoStage?: boolean; noVerify?: boolean }) =>
      request<{ ok: boolean; data: { sha: string } }>('/git/commit', {
        method: 'POST',
        body: JSON.stringify({
          path,
          message,
          noAutoStage: opts?.noAutoStage,
          noVerify: opts?.noVerify,
        }),
      }),
    /**
     * Atomic group commit: unstage all → stage specific files → commit
     * in a single server request. HMR-safe — can't be interrupted mid-group.
     */
    commitGroup: (path: string, files: string[], message: string, opts?: { noVerify?: boolean }) =>
      request<{ ok: boolean; data: { sha: string } }>('/git/commit-group', {
        method: 'POST',
        body: JSON.stringify({ path, files, message, noVerify: opts?.noVerify }),
      }),
    /**
     * Streaming commit with real-time output
     * @param onProgress - Callback for progress updates
     */
    commitStream: async (
      path: string,
      message: string,
      onProgress: (event: {
        type: 'status' | 'output' | 'error' | 'complete' | 'diagnostic';
        message?: string;
        detail?: string;
        sha?: string;
        phase?: 'before-staging' | 'after-staging' | 'after-commit';
        porcelain?: string;
        fileCount?: number;
      }) => void,
    ): Promise<{ ok: boolean; sha?: string; error?: string }> => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      const token = getAuthToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
      if (_csrfToken) headers['X-CSRF-Token'] = _csrfToken;

      console.log('[commitStream] Sending POST to /git/commit/stream', {
        path,
        message: message.slice(0, 50),
      });

      let response: Response;
      try {
        response = await fetch(`${getBaseUrl()}/git/commit/stream`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ path, message }),
        });
      } catch (err) {
        console.error('[commitStream] Fetch failed:', err);
        return { ok: false, error: String(err) };
      }

      console.log(
        '[commitStream] Response status:',
        response.status,
        'ok:',
        response.ok,
        'hasBody:',
        !!response.body,
      );
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({ error: response.statusText }));
        console.error('[commitStream] Non-OK response:', body);
        return { ok: false, error: body.error || `HTTP ${response.status}` };
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let sha = '';
      let gotComplete = false;
      let lastError = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              try {
                const event = JSON.parse(data);
                onProgress(event);
                if (event.type === 'complete') {
                  gotComplete = true;
                  if (event.sha) sha = event.sha;
                }
                if (event.type === 'error') {
                  lastError = event.message || 'Commit failed';
                  // Don't return early — let the stream finish so we don't
                  // leave a dangling connection that hides follow-up events.
                }
              } catch (parseErr) {
                console.warn(
                  '[commitStream] Malformed SSE JSON (skipped):',
                  data.slice(0, 200),
                  parseErr,
                );
              }
            }
          }
        }

        // Process any remaining data left in the buffer after stream closes
        if (buffer.trim() && buffer.startsWith('data: ')) {
          try {
            const event = JSON.parse(buffer.slice(6));
            onProgress(event);
            if (event.type === 'complete') {
              gotComplete = true;
              if (event.sha) sha = event.sha;
            }
            if (event.type === 'error') {
              lastError = event.message || 'Commit failed';
            }
          } catch (parseErr) {
            console.warn(
              '[commitStream] Malformed buffer remnant (skipped):',
              buffer.slice(0, 200),
              parseErr,
            );
          }
        }

        console.log(
          '[commitStream] Stream ended. gotComplete=%s lastError=%s sha=%s buffer=%s',
          gotComplete,
          lastError || '(none)',
          sha || '(none)',
          buffer ? buffer.slice(0, 100) : '(empty)',
        );

        // If we got an explicit error event, report it
        if (lastError) {
          console.error('[commitStream] Returning error:', lastError);
          return { ok: false, error: lastError };
        }

        // If the stream ended without a 'complete' event, something went
        // wrong (proxy timeout, connection drop, server crash, etc.)
        if (!gotComplete) {
          console.error(
            '[commitStream] Stream ended WITHOUT complete event — possible proxy timeout or connection drop',
          );
          return {
            ok: false,
            error:
              'Commit stream ended unexpectedly — the connection may have been interrupted. Check the terminal or git log to verify.',
          };
        }

        console.log('[commitStream] Success! sha=%s', sha);
        return { ok: true, sha };
      } catch (err) {
        console.error('[commitStream] Stream reader threw:', err);
        return { ok: false, error: String(err) };
      }
    },
    clean: (path: string) =>
      request<{
        ok: boolean;
        data: {
          cleaned: boolean;
          beforeFileCount: number;
          afterFileCount: number;
          fullyClean: boolean;
        };
      }>('/git/clean', {
        method: 'POST',
        body: JSON.stringify({ path }),
      }),
    diagnose: (path: string) =>
      request<{
        ok: boolean;
        data: {
          checks: Array<{
            name: string;
            status: 'ok' | 'warn' | 'error';
            message: string;
            detail?: string;
          }>;
        };
      }>(`/git/diagnose?path=${encodeURIComponent(path)}`),
    push: (path: string, remote?: string, branch?: string) =>
      request<{ ok: boolean; data: { pushed: boolean; setUpstream: boolean } }>('/git/push', {
        method: 'POST',
        body: JSON.stringify({ path, remote, branch }),
      }),
    /**
     * Streaming push with real-time output
     * @param onProgress - Callback for progress updates
     */
    pushStream: async (
      path: string,
      onProgress: (event: {
        type: 'status' | 'output' | 'error' | 'complete';
        message?: string;
        setUpstream?: boolean;
      }) => void,
      remote?: string,
      branch?: string,
    ): Promise<{ ok: boolean; setUpstream?: boolean; error?: string }> => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      const token = getAuthToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
      if (_csrfToken) headers['X-CSRF-Token'] = _csrfToken;

      const response = await fetch(`${getBaseUrl()}/git/push/stream`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ path, remote, branch }),
      });

      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({ error: response.statusText }));
        return { ok: false, error: body.error || `HTTP ${response.status}` };
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let setUpstream = false;
      let gotComplete = false;
      let lastError = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              try {
                const event = JSON.parse(data);
                onProgress(event);
                if (event.type === 'complete') {
                  gotComplete = true;
                  if (event.setUpstream) setUpstream = true;
                }
                if (event.type === 'error') {
                  lastError = event.message || 'Push failed';
                }
              } catch {
                // Ignore malformed SSE lines
              }
            }
          }
        }

        if (lastError) {
          return { ok: false, error: lastError };
        }

        if (!gotComplete) {
          return {
            ok: false,
            error: 'Push stream ended unexpectedly — the connection may have been interrupted.',
          };
        }

        return { ok: true, setUpstream };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
    generateCommitMessage: (path: string) =>
      request<{ ok: boolean; data: { message: string } }>('/git/generate-commit-message', {
        method: 'POST',
        body: JSON.stringify({ path }),
      }),
    aiMerge: (
      workspacePath: string,
      filePath: string,
      fileContent: string,
      region: {
        startLine: number;
        sepLine: number;
        endLine: number;
        currentLabel: string;
        incomingLabel: string;
      },
    ) =>
      request<{ ok: boolean; data: { mergedText: string }; error?: string }>('/git/ai-merge', {
        method: 'POST',
        body: JSON.stringify({ workspacePath, filePath, fileContent, region }),
      }),
    suggestCommitGroups: (path: string) =>
      request<{
        ok: boolean;
        error?: string;
        data: {
          groups: Array<{
            name: string;
            message: string;
            files: string[];
            reason: string;
          }>;
        };
      }>('/git/suggest-commit-groups', {
        method: 'POST',
        body: JSON.stringify({ path }),
      }),
    /**
     * Smart Commit: one-click analyze → group → stage → commit via SSE stream.
     * Combines Suggest Groups + Generate Message + Commit All in a single flow.
     */
    smartCommit: async (
      path: string,
      onProgress: (event: {
        type:
          | 'status'
          | 'groups'
          | 'committing'
          | 'committed'
          | 'group-error'
          | 'complete'
          | 'error';
        message?: string;
        groups?: Array<{
          index: number;
          name: string;
          message: string;
          files: string[];
          reason: string;
        }>;
        index?: number;
        total?: number;
        name?: string;
        fileCount?: number;
        sha?: string;
        committed?: number;
        shas?: string[];
      }) => void,
    ): Promise<{ ok: boolean; committed?: number; shas?: string[]; error?: string }> => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      const token = getAuthToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
      if (_csrfToken) headers['X-CSRF-Token'] = _csrfToken;

      let response: Response;
      try {
        response = await fetch(`${getBaseUrl()}/git/smart-commit`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ path }),
        });
      } catch (err) {
        return { ok: false, error: String(err) };
      }

      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({ error: response.statusText }));
        return { ok: false, error: body.error || `HTTP ${response.status}` };
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let gotComplete = false;
      let lastError = '';
      let committed = 0;
      let shas: string[] = [];

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const event = JSON.parse(line.slice(6));
                onProgress(event);
                if (event.type === 'complete') {
                  gotComplete = true;
                  committed = event.committed ?? 0;
                  shas = event.shas ?? [];
                }
                if (event.type === 'error') {
                  lastError = event.message || 'Smart commit failed';
                }
              } catch {
                // skip malformed SSE
              }
            }
          }
        }

        // Process remaining buffer
        if (buffer.trim() && buffer.startsWith('data: ')) {
          try {
            const event = JSON.parse(buffer.slice(6));
            onProgress(event);
            if (event.type === 'complete') {
              gotComplete = true;
              committed = event.committed ?? 0;
              shas = event.shas ?? [];
            }
            if (event.type === 'error') {
              lastError = event.message || 'Smart commit failed';
            }
          } catch {
            // skip
          }
        }

        if (lastError) return { ok: false, error: lastError };
        if (!gotComplete) {
          return {
            ok: false,
            error:
              'Smart commit stream ended unexpectedly — the connection may have been interrupted.',
          };
        }
        return { ok: true, committed, shas };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  },

  // --- Workspace Memory ---
  workspaceMemory: {
    list: (workspacePath: string, category?: string) => {
      const params = new URLSearchParams({ workspacePath });
      if (category) params.set('category', category);
      return request<{ ok: boolean; data: any[] }>(`/workspace-memory?${params}`);
    },
    get: (id: string) => request<{ ok: boolean; data: any }>(`/workspace-memory/${id}`),
    create: (body: {
      workspacePath: string;
      category?: string;
      key: string;
      content: string;
      source?: string;
      confidence?: number;
    }) =>
      request<{ ok: boolean; data: { id: string } }>('/workspace-memory', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    update: (id: string, body: Record<string, any>) =>
      request<{ ok: boolean }>(`/workspace-memory/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    delete: (id: string) =>
      request<{ ok: boolean }>(`/workspace-memory/${id}`, { method: 'DELETE' }),
    search: (workspacePath: string, q: string) => {
      const params = new URLSearchParams({ workspacePath, q });
      return request<{ ok: boolean; data: any[] }>(`/workspace-memory/search/query?${params}`);
    },
    extract: (workspacePath: string, messages: Array<{ role: string; content: string }>) =>
      request<{ ok: boolean; data: { extracted: number; created: number } }>(
        '/workspace-memory/extract',
        {
          method: 'POST',
          body: JSON.stringify({ workspacePath, messages }),
        },
      ),
    context: (workspacePath: string) => {
      const params = new URLSearchParams({ workspacePath });
      return request<{ ok: boolean; data: { context: string; count: number } }>(
        `/workspace-memory/context?${params}`,
      );
    },
    /** LLM-powered extraction from conversation messages */
    extractLlm: (workspacePath: string, messages: Array<{ role: string; content: string }>) =>
      request<{ ok: boolean; data: { extracted: number; created: number } }>(
        '/workspace-memory/extract-llm',
        {
          method: 'POST',
          body: JSON.stringify({ workspacePath, messages }),
        },
      ),
    /** LLM-powered extraction from git commits */
    extractCommits: (
      workspacePath: string,
      commits: Array<{ message: string; files?: string[] }>,
    ) =>
      request<{ ok: boolean; data: { extracted: number; created: number } }>(
        '/workspace-memory/extract-commits',
        {
          method: 'POST',
          body: JSON.stringify({ workspacePath, commits }),
        },
      ),
    /** Get version history for a memory entry */
    versions: (id: string) =>
      request<{
        ok: boolean;
        data: Array<{
          id: string;
          memoryId: string;
          content: string;
          confidence: number;
          category: string;
          savedAt: number;
        }>;
      }>(`/workspace-memory/versions/${id}`),
  },

  // --- PRDs ---
  prds: {
    list: (workspacePath?: string) => {
      const q = workspacePath ? `?workspacePath=${encodeURIComponent(workspacePath)}` : '';
      return request<{ ok: boolean; data: any[] }>(`/prds${q}`);
    },
    get: (id: string) => request<{ ok: boolean; data: any }>(`/prds/${id}`),
    create: (body: any) =>
      request<{ ok: boolean; data: { id: string; storyIds: string[] } }>('/prds', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    update: (id: string, body: Record<string, any>) =>
      request<{ ok: boolean }>(`/prds/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    delete: (id: string) => request<{ ok: boolean }>(`/prds/${id}`, { method: 'DELETE' }),
    addStory: (prdId: string, body: any) =>
      request<{ ok: boolean; data: { id: string } }>(`/prds/${prdId}/stories`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    updateStory: (prdId: string, storyId: string, body: Record<string, any>) =>
      request<{ ok: boolean; data: any }>(`/prds/${prdId}/stories/${storyId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    deleteStory: (prdId: string, storyId: string) =>
      request<{ ok: boolean }>(`/prds/${prdId}/stories/${storyId}`, { method: 'DELETE' }),
    archiveCompletedPrdStories: (prdId: string) =>
      request<{ ok: boolean; data: { archived: number } }>(
        `/prds/${prdId}/stories/archive-completed`,
        {
          method: 'POST',
          body: JSON.stringify({}),
        },
      ),
    import: (workspacePath: string, prdJson: any) =>
      request<{ ok: boolean; data: { id: string; storyIds: string[]; imported: number } }>(
        '/prds/import',
        {
          method: 'POST',
          body: JSON.stringify({ workspacePath, prdJson }),
        },
      ),
    export: (id: string) => request<{ ok: boolean; data: any }>(`/prds/${id}/export`),
    plan: (
      prdId: string,
      body: { mode: string; editMode: string; userPrompt?: string; model?: string },
    ) =>
      request<{
        ok: boolean;
        data: { conversationId: string; prdId: string; mode: string; editMode: string };
      }>(`/prds/${prdId}/plan`, { method: 'POST', body: JSON.stringify(body) }),
    generate: (prdId: string, body: { description: string; context?: string; count?: number }) =>
      request<{
        ok: boolean;
        data: {
          stories: Array<{
            title: string;
            description: string;
            acceptanceCriteria: string[];
            priority: 'critical' | 'high' | 'medium' | 'low';
            dependsOnIndices?: number[];
          }>;
          prdId: string;
        };
      }>(`/prds/${prdId}/generate`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    /** One-step: create a new PRD and generate stories from a description */
    generateFromDescription: (body: {
      description: string;
      workspacePath: string;
      name?: string;
      context?: string;
      count?: number;
      qualityChecks?: Array<{
        id: string;
        type: string;
        name: string;
        command: string;
        timeout: number;
        required: boolean;
        enabled: boolean;
      }>;
      autoAccept?: boolean;
    }) =>
      request<{
        ok: boolean;
        data: {
          prdId: string;
          stories: Array<{
            title: string;
            description: string;
            acceptanceCriteria: string[];
            priority: 'critical' | 'high' | 'medium' | 'low';
            dependsOnIndices?: number[];
          }>;
          accepted: number;
          storyIds: string[];
        };
      }>('/prds/generate-from-description', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    acceptGenerated: (
      prdId: string,
      stories: Array<{
        title: string;
        description: string;
        acceptanceCriteria: string[];
        priority: 'critical' | 'high' | 'medium' | 'low';
        dependsOnIndices?: number[];
      }>,
    ) =>
      request<{ ok: boolean; data: { storyIds: string[]; accepted: number } }>(
        `/prds/${prdId}/generate/accept`,
        {
          method: 'POST',
          body: JSON.stringify({ stories }),
        },
      ),
    refineStory: (
      prdId: string,
      storyId: string,
      answers?: Array<{ questionId: string; answer: string }>,
    ) =>
      request<{
        ok: boolean;
        data: {
          storyId: string;
          questions: Array<{
            id: string;
            question: string;
            context: string;
            suggestedAnswers?: string[];
          }>;
          qualityScore: number;
          qualityExplanation: string;
          meetsThreshold: boolean;
          updatedStory?: {
            title: string;
            description: string;
            acceptanceCriteria: string[];
            priority: 'critical' | 'high' | 'medium' | 'low';
          };
          improvements?: string[];
        };
      }>(`/prds/${prdId}/stories/${storyId}/refine`, {
        method: 'POST',
        body: JSON.stringify({ storyId, answers }),
      }),
    // --- Dependencies ---
    getDependencyGraph: (prdId: string) =>
      request<{
        ok: boolean;
        data: import('@e/shared').DependencyGraph;
      }>(`/prds/${prdId}/dependencies`),
    addDependency: (prdId: string, fromStoryId: string, toStoryId: string, reason?: string) =>
      request<{
        ok: boolean;
        data: import('@e/shared').DependencyGraph;
      }>(`/prds/${prdId}/dependencies`, {
        method: 'POST',
        body: JSON.stringify({ fromStoryId, toStoryId, reason }),
      }),
    removeDependency: (prdId: string, fromStoryId: string, toStoryId: string) =>
      request<{
        ok: boolean;
        data: import('@e/shared').DependencyGraph;
      }>(`/prds/${prdId}/dependencies`, {
        method: 'DELETE',
        body: JSON.stringify({ fromStoryId, toStoryId }),
      }),
    editDependency: (prdId: string, fromStoryId: string, toStoryId: string, reason: string) =>
      request<{
        ok: boolean;
        data: import('@e/shared').DependencyGraph;
      }>(`/prds/${prdId}/dependencies`, {
        method: 'PATCH',
        body: JSON.stringify({ fromStoryId, toStoryId, reason }),
      }),
    analyzeDependencies: (prdId: string, replaceAutoDetected?: boolean) =>
      request<{
        ok: boolean;
        data: import('@e/shared').AnalyzeDependenciesResponse;
      }>(`/prds/${prdId}/dependencies/analyze`, {
        method: 'POST',
        body: JSON.stringify({ replaceAutoDetected }),
      }),
    validateSprint: (prdId: string) =>
      request<{
        ok: boolean;
        data: import('@e/shared').SprintValidation;
      }>(`/prds/${prdId}/dependencies/validate`),
    // --- Acceptance Criteria Validation ---
    validateCriteria: (
      prdId: string,
      storyId: string,
      criteria: string[],
      storyTitle?: string,
      storyDescription?: string,
    ) =>
      request<{
        ok: boolean;
        data: import('@e/shared').ValidateACResponse;
      }>(`/prds/${prdId}/stories/${storyId}/validate-criteria`, {
        method: 'POST',
        body: JSON.stringify({ storyId, criteria, storyTitle, storyDescription }),
      }),
    // --- Story Estimation ---
    estimateStory: (prdId: string, storyId: string) =>
      request<{
        ok: boolean;
        data: import('@e/shared').EstimateStoryResponse;
      }>(`/prds/${prdId}/stories/${storyId}/estimate`, {
        method: 'POST',
        body: JSON.stringify({ storyId }),
      }),
    saveManualEstimate: (
      prdId: string,
      storyId: string,
      body: { size: string; storyPoints: number; reasoning?: string },
    ) =>
      request<{
        ok: boolean;
        data: import('@e/shared').EstimateStoryResponse;
      }>(`/prds/${prdId}/stories/${storyId}/estimate`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    estimatePrd: (prdId: string, reEstimate?: boolean) =>
      request<{
        ok: boolean;
        data: import('@e/shared').EstimatePrdResponse;
      }>(`/prds/${prdId}/estimate`, {
        method: 'POST',
        body: JSON.stringify({ reEstimate }),
      }),
    // --- PRD Completeness Analysis ---
    analyzeCompleteness: (prdId: string, sections?: string[]) =>
      request<{
        ok: boolean;
        data: import('@e/shared').AnalyzePrdCompletenessResponse;
      }>(`/prds/${prdId}/completeness`, {
        method: 'POST',
        body: JSON.stringify({ sections }),
      }),
    // --- Sprint Plan Recommendations ---
    generateSprintPlan: (prdId: string, capacity: number, capacityMode?: 'points' | 'count') =>
      request<{
        ok: boolean;
        data: import('@e/shared').SprintPlanResponse;
      }>(`/prds/${prdId}/sprint-plan`, {
        method: 'POST',
        body: JSON.stringify({ capacity, capacityMode }),
      }),
    saveAdjustedSprintPlan: (prdId: string, plan: import('@e/shared').SprintPlanResponse) =>
      request<{
        ok: boolean;
        data: import('@e/shared').SprintPlanResponse;
      }>(`/prds/${prdId}/sprint-plan`, {
        method: 'PUT',
        body: JSON.stringify(plan),
      }),
    // --- Story Templates ---
    listTemplates: (category?: string) => {
      const q = category ? `?category=${encodeURIComponent(category)}` : '';
      return request<{
        ok: boolean;
        data: import('@e/shared').StoryTemplate[];
      }>(`/prds/templates${q}`);
    },
    getTemplate: (templateId: string) =>
      request<{
        ok: boolean;
        data: import('@e/shared').StoryTemplate;
      }>(`/prds/templates/${templateId}`),
    createTemplate: (body: import('@e/shared').CreateTemplateRequest) =>
      request<{
        ok: boolean;
        data: import('@e/shared').StoryTemplate;
      }>('/prds/templates', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    updateTemplate: (
      templateId: string,
      body: Partial<import('@e/shared').CreateTemplateRequest>,
    ) =>
      request<{
        ok: boolean;
        data: import('@e/shared').StoryTemplate;
      }>(`/prds/templates/${templateId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    deleteTemplate: (templateId: string) =>
      request<{ ok: boolean }>(`/prds/templates/${templateId}`, { method: 'DELETE' }),
    createStoryFromTemplate: (
      prdId: string,
      templateId: string,
      variables?: Record<string, string>,
    ) =>
      request<{
        ok: boolean;
        data: import('@e/shared').CreateStoryFromTemplateResponse;
      }>(`/prds/${prdId}/stories/from-template`, {
        method: 'POST',
        body: JSON.stringify({ templateId, variables }),
      }),
    // --- Priority Recommendations ---
    recommendPriority: (prdId: string, storyId: string) =>
      request<{
        ok: boolean;
        data: import('@e/shared').PriorityRecommendationResponse;
      }>(`/prds/${prdId}/stories/${storyId}/priority`, {
        method: 'POST',
        body: JSON.stringify({ storyId }),
      }),
    acceptPriority: (prdId: string, storyId: string, priority: string, accept: boolean) =>
      request<{ ok: boolean }>(`/prds/${prdId}/stories/${storyId}/priority`, {
        method: 'PUT',
        body: JSON.stringify({ priority, accept }),
      }),
    recommendAllPriorities: (prdId: string) =>
      request<{
        ok: boolean;
        data: import('@e/shared').PriorityRecommendationBulkResponse;
      }>(`/prds/${prdId}/priorities`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),

    // --- PRD-Wide Refinement ---
    refineAllStories: (
      prdId: string,
      options?: { statuses?: string[]; includeCodeScan?: boolean },
    ) =>
      request<{
        ok: boolean;
        data: import('@e/shared').RefineAllResponse;
      }>(`/prds/${prdId}/refine-all`, {
        method: 'POST',
        body: JSON.stringify(options || {}),
      }),

    // --- Standalone Story Routes (prd_id = NULL) ---
    listStandaloneStories: (workspacePath: string) => {
      const q = `?workspacePath=${encodeURIComponent(workspacePath)}`;
      return request<{ ok: boolean; data: any[] }>(`/prds/stories${q}`);
    },
    listAllStories: (workspacePath: string) => {
      const q = `?workspacePath=${encodeURIComponent(workspacePath)}`;
      return request<{ ok: boolean; data: { standalone: any[]; byPrd: any[] } }>(
        `/prds/stories/all${q}`,
      );
    },
    createStandaloneStory: (body: {
      workspacePath: string;
      title: string;
      description?: string;
      acceptanceCriteria?: string[];
      priority?: string;
    }) =>
      request<{ ok: boolean; data: any }>('/prds/stories', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    updateStandaloneStory: (storyId: string, body: Record<string, any>) =>
      request<{ ok: boolean; data: any }>(`/prds/stories/${storyId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    deleteStandaloneStory: (storyId: string) =>
      request<{ ok: boolean }>(`/prds/stories/${storyId}`, { method: 'DELETE' }),
    estimateStandaloneStory: (storyId: string) =>
      request<{ ok: boolean; data: any }>(`/prds/stories/${storyId}/estimate`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    reorderStories: (storyIds: string[]) =>
      request<{ ok: boolean }>('/prds/stories/reorder', {
        method: 'POST',
        body: JSON.stringify({ storyIds }),
      }),
    saveStandaloneEstimate: (
      storyId: string,
      body: { size: string; storyPoints: number; reasoning?: string },
    ) =>
      request<{ ok: boolean; data: any }>(`/prds/stories/${storyId}/estimate`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    archiveAllCompleted: (workspacePath: string) =>
      request<{ ok: boolean; data: { archived: number } }>('/prds/stories/archive-completed', {
        method: 'POST',
        body: JSON.stringify({ workspacePath }),
      }),
  },

  // --- Loops ---
  loops: {
    start: (body: { prdId: string | null; workspacePath: string; config: any }) =>
      request<{ ok: boolean; data: { loopId: string } }>('/loops/start', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    pause: (id: string) => request<{ ok: boolean }>(`/loops/${id}/pause`, { method: 'POST' }),
    resume: (id: string) => request<{ ok: boolean }>(`/loops/${id}/resume`, { method: 'POST' }),
    cancel: (id: string) => request<{ ok: boolean }>(`/loops/${id}/cancel`, { method: 'POST' }),
    dismiss: (id: string) => request<{ ok: boolean }>(`/loops/${id}/dismiss`, { method: 'POST' }),
    get: (id: string) => request<{ ok: boolean; data: any }>(`/loops/${id}`),
    list: (status?: string) => {
      const q = status ? `?status=${status}` : '';
      return request<{ ok: boolean; data: any[] }>(`/loops${q}`);
    },
    log: (id: string) => request<{ ok: boolean; data: any[] }>(`/loops/${id}/log`),
    resetStory: (storyId: string) =>
      request<{ ok: boolean; data: any }>(`/loops/stories/${storyId}/reset`, { method: 'POST' }),
    resetFailed: (body: {
      prdId: string | null;
      workspacePath: string;
      restart?: boolean;
      config?: any;
    }) =>
      request<{
        ok: boolean;
        data: { resetCount: number; loopId: string | null; restartError?: string };
      }>('/loops/stories/reset-failed', { method: 'POST', body: JSON.stringify(body) }),
  },

  // --- Golem Identity ---
  golem: {
    get: () => request<{ ok: boolean; data: any }>('/golem'),
    rename: (name: string) =>
      request<{ ok: boolean; data: any }>('/golem', {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      }),
  },

  // --- External Providers (Jira, Linear, Asana) ---
  external: {
    saveConfig: (config: {
      provider: string;
      apiKey: string;
      email?: string;
      baseUrl?: string;
      teamId?: string;
      workspaceGid?: string;
    }) =>
      request<{ ok: boolean }>('/external/config', {
        method: 'POST',
        body: JSON.stringify(config),
      }),
    getConfigStatus: (provider: string) =>
      request<{
        ok: boolean;
        data: {
          configured: boolean;
          provider: string;
          baseUrl?: string;
          email?: string;
          teamId?: string;
          workspaceGid?: string;
        };
      }>(`/external/config/${provider}`),
    testConnection: (provider: string) =>
      request<{ ok: boolean; data: { connected: boolean; error?: string } }>(
        `/external/test/${provider}`,
        {
          method: 'POST',
        },
      ),
    listProjects: (provider: string) =>
      request<{ ok: boolean; data: any[] }>(`/external/projects/${provider}`),
    listIssues: (provider: string, projectKey: string, status?: string) => {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      const q = params.toString();
      return request<{ ok: boolean; data: any[] }>(
        `/external/issues/${provider}/${encodeURIComponent(projectKey)}${q ? '?' + q : ''}`,
      );
    },
    importIssues: (body: {
      provider: string;
      projectKey: string;
      workspacePath: string;
      issueIds?: string[];
      prdId?: string;
    }) =>
      request<{
        ok: boolean;
        data: { imported: number; skipped: number; storyIds: string[]; errors: string[] };
      }>('/external/import', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    refreshStory: (storyId: string) =>
      request<{ ok: boolean; data: any }>(`/external/refresh/${storyId}`, { method: 'POST' }),
    refreshAll: (workspacePath: string) =>
      request<{ ok: boolean; data: { refreshed: number; total: number; errors: string[] } }>(
        '/external/refresh-all',
        {
          method: 'POST',
          body: JSON.stringify({ workspacePath }),
        },
      ),
    pushStatus: (body: {
      storyId: string;
      status: 'completed' | 'failed';
      commitSha?: string;
      prUrl?: string;
      comment?: string;
    }) =>
      request<{ ok: boolean }>('/external/push-status', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  },

  // --- Auth ---
  auth: {
    status: () => request<{ ok: boolean; data: { enabled: boolean } }>('/auth/status'),
    register: (username: string, password: string, displayName?: string) =>
      request<{
        ok: boolean;
        data: { id: string; username: string; token: string; isAdmin: boolean };
      }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ username, password, displayName }),
      }),
    login: (username: string, password: string) =>
      request<{
        ok: boolean;
        data: {
          id: string;
          username: string;
          displayName: string;
          isAdmin: boolean;
          token: string;
        };
      }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      }),
    me: () =>
      request<{
        ok: boolean;
        data: { id: string; username: string; isAdmin: boolean };
      }>('/auth/me'),
    users: () => request<{ ok: boolean; data: any[] }>('/auth/users'),
  },
  // --- TODO Scanner ---
  scan: {
    scanTodos: (
      workspacePath: string,
      opts?: {
        extensions?: string[];
        /** Extra ripgrep globs appended after the built-in excludes (LYK-1005). */
        excludeGlobs?: string[];
        /** Extra extensions merged with the built-in defaults (LYK-1005). */
        extraExtensions?: string[];
        maxResults?: number;
        prdId?: string;
      },
    ) =>
      request<{
        ok: boolean;
        data: {
          todos: Array<{
            id: string;
            file: string;
            relativePath: string;
            line: number;
            type: string;
            text: string;
            context: string[];
            suggestedTitle: string;
            suggestedDescription: string;
            priority: string;
          }>;
          total: number;
        };
      }>('/scan/todos', {
        method: 'POST',
        body: JSON.stringify({ workspacePath, ...opts }),
      }),
    importTodos: (body: {
      workspacePath: string;
      todos: Array<{
        file: string;
        line: number;
        type: string;
        text: string;
        suggestedTitle: string;
        suggestedDescription: string;
        priority: string;
      }>;
      prdId?: string;
    }) =>
      request<{ ok: boolean; data: { created: number; storyIds: string[] } }>(
        '/scan/todos/import',
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
      ),
    todoCount: (workspacePath: string) =>
      request<{ ok: boolean; data: { count: number; byType: Record<string, number> } }>(
        `/scan/todos/count?workspacePath=${encodeURIComponent(workspacePath)}`,
      ),
  },

  // --- Ambient Background Agent ---
  ambient: {
    startWatching: (workspacePath: string) =>
      request<{ ok: boolean }>('/ambient/watch', {
        method: 'POST',
        body: JSON.stringify({ workspacePath }),
      }),
    stopWatching: (workspacePath: string) =>
      request<{ ok: boolean }>(
        `/ambient/watch?workspacePath=${encodeURIComponent(workspacePath)}`,
        {
          method: 'DELETE',
        },
      ),
    getNotifications: (workspacePath: string) =>
      request<{
        ok: boolean;
        data: Array<{
          id: string;
          workspacePath: string;
          type: string;
          severity: string;
          title: string;
          message: string;
          file?: string;
          line?: number;
          suggestion?: string;
          createdAt: number;
          dismissed: boolean;
        }>;
      }>(`/ambient/notifications?workspacePath=${encodeURIComponent(workspacePath)}`),
    dismissNotification: (id: string) =>
      request<{ ok: boolean }>(`/ambient/notifications/${id}`, { method: 'DELETE' }),
    clearNotifications: (workspacePath: string) =>
      request<{ ok: boolean }>(
        `/ambient/notifications?workspacePath=${encodeURIComponent(workspacePath)}`,
        {
          method: 'DELETE',
        },
      ),
    status: (workspacePath: string) =>
      request<{ ok: boolean; data: { watching: boolean; notificationCount: number } }>(
        `/ambient/status?workspacePath=${encodeURIComponent(workspacePath)}`,
      ),
  },

  // --- Cost Dashboard ---
  costs: {
    summary: (opts?: { workspacePath?: string; since?: number; until?: number }) => {
      const params = new URLSearchParams();
      if (opts?.workspacePath) params.set('workspacePath', opts.workspacePath);
      if (opts?.since) params.set('since', String(opts.since));
      if (opts?.until) params.set('until', String(opts.until));
      const q = params.toString();
      return request<{
        ok: boolean;
        data: {
          totalCostUsd: number;
          totalTokens: number;
          inputTokens: number;
          outputTokens: number;
          conversationCount: number;
          byModel: Array<{ model: string; costUsd: number; tokens: number; conversations: number }>;
          byDay: Array<{ date: string; costUsd: number; tokens: number }>;
          topConversations: Array<{
            id: string;
            title: string;
            costUsd: number;
            tokens: number;
            model: string;
            updatedAt: number;
          }>;
        };
      }>(`/costs/summary${q ? '?' + q : ''}`);
    },
  },

  // --- Diff Parser ---
  diff: {
    parse: (input: string, workspacePath?: string) =>
      request<{ ok: boolean; data: any }>('/diff/parse', {
        method: 'POST',
        body: JSON.stringify({ input, workspacePath }),
      }),
  },

  // --- Session Replay ---
  replay: {
    getTimeline: (conversationId: string) =>
      request<{ ok: boolean; data: any }>(`/replay/${conversationId}`),
    getChanges: (conversationId: string) =>
      request<{ ok: boolean; data: any }>(`/replay/${conversationId}/changes`),
  },

  // --- Custom Tools ---
  customTools: {
    list: (workspacePath?: string) => {
      const q = workspacePath ? `?workspacePath=${encodeURIComponent(workspacePath)}` : '';
      return request<{ ok: boolean; data: any[] }>(`/custom-tools${q}`);
    },
    create: (body: {
      name: string;
      description: string;
      inputSchema: any;
      handlerType: string;
      handlerCommand: string;
      workspacePath?: string;
    }) =>
      request<{ ok: boolean; data: any }>('/custom-tools', {
        method: 'POST',
        headers: { 'X-Confirm-Dangerous': 'true' },
        body: JSON.stringify(body),
      }),
    update: (id: string, body: Record<string, any>) =>
      request<{ ok: boolean; data: any }>(`/custom-tools/${id}`, {
        method: 'PATCH',
        headers: { 'X-Confirm-Dangerous': 'true' },
        body: JSON.stringify(body),
      }),
    delete: (id: string) => request<{ ok: boolean }>(`/custom-tools/${id}`, { method: 'DELETE' }),
    test: (id: string, input: Record<string, any>) =>
      request<{ ok: boolean; data: { output: string; exitCode: number; duration: number } }>(
        `/custom-tools/${id}/test`,
        { method: 'POST', body: JSON.stringify({ input }) },
      ),
  },

  // --- Live Pair Mode ---
  pair: {
    createRoom: (body: { conversationId: string; hostName: string }) =>
      request<{ ok: boolean; data: { roomId: string; shareUrl: string } }>('/pair/rooms', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    getRoom: (roomId: string) => request<{ ok: boolean; data: any }>(`/pair/rooms/${roomId}`),
    joinRoom: (roomId: string, observerName: string) =>
      request<{ ok: boolean }>(`/pair/rooms/${roomId}/join`, {
        method: 'POST',
        body: JSON.stringify({ observerName }),
      }),
    broadcast: (roomId: string, event: string, data: any) =>
      request<{ ok: boolean }>(`/pair/rooms/${roomId}/broadcast`, {
        method: 'POST',
        body: JSON.stringify({ event, data }),
      }),
    closeRoom: (roomId: string) =>
      request<{ ok: boolean }>(`/pair/rooms/${roomId}`, { method: 'DELETE' }),
  },

  // --- Multi-Workspace Initiatives ---
  initiatives: {
    list: () => request<{ ok: boolean; data: any[] }>('/initiatives'),
    create: (body: {
      name: string;
      description?: string;
      workspacePaths?: string[];
      prdIds?: string[];
      color?: string;
    }) =>
      request<{ ok: boolean; data: any }>('/initiatives', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    get: (id: string) => request<{ ok: boolean; data: any }>(`/initiatives/${id}`),
    update: (id: string, body: Record<string, any>) =>
      request<{ ok: boolean; data: any }>(`/initiatives/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    delete: (id: string) => request<{ ok: boolean }>(`/initiatives/${id}`, { method: 'DELETE' }),
    addWorkspace: (id: string, workspacePath: string) =>
      request<{ ok: boolean }>(`/initiatives/${id}/workspaces`, {
        method: 'POST',
        body: JSON.stringify({ workspacePath }),
      }),
    removeWorkspace: (id: string, workspacePath: string) =>
      request<{ ok: boolean }>(`/initiatives/${id}/workspaces`, {
        method: 'DELETE',
        body: JSON.stringify({ workspacePath }),
      }),
    addPrd: (id: string, prdId: string) =>
      request<{ ok: boolean }>(`/initiatives/${id}/prds`, {
        method: 'POST',
        body: JSON.stringify({ prdId }),
      }),
    removePrd: (id: string, prdId: string) =>
      request<{ ok: boolean }>(`/initiatives/${id}/prds`, {
        method: 'DELETE',
        body: JSON.stringify({ prdId }),
      }),
    getProgress: (id: string) => request<{ ok: boolean; data: any }>(`/initiatives/${id}/progress`),
  },

  // --- Agent Profiles ---
  profiles: {
    list: () => request<{ ok: boolean; data: import('@e/shared').AgentProfile[] }>('/profiles'),
    get: (id: string) =>
      request<{ ok: boolean; data: import('@e/shared').AgentProfile }>(`/profiles/${id}`),
    create: (body: import('@e/shared').AgentProfileCreateInput) =>
      request<{ ok: boolean; data: import('@e/shared').AgentProfile }>('/profiles', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    update: (id: string, body: import('@e/shared').AgentProfileUpdateInput) =>
      request<{ ok: boolean; data: import('@e/shared').AgentProfile }>(`/profiles/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    delete: (id: string) => request<{ ok: boolean }>(`/profiles/${id}`, { method: 'DELETE' }),
  },

  // --- Daily Digest ---
  digest: {
    today: (workspacePath?: string, date?: string) => {
      const params = new URLSearchParams();
      if (workspacePath) params.set('workspacePath', workspacePath);
      if (date) params.set('date', date);
      return request<{ ok: boolean; data: any }>(`/digest/today?${params}`);
    },
    week: (workspacePath?: string) => {
      const params = new URLSearchParams();
      if (workspacePath) params.set('workspacePath', workspacePath);
      return request<{ ok: boolean; data: any[] }>(`/digest/week?${params}`);
    },
  },

  // --- Manager View ---
  manager: {
    overview: () =>
      request<{
        ok: boolean;
        data: {
          workspaces: Array<{
            id: string;
            name: string;
            path: string;
            agentStatus: 'idle' | 'running' | 'waiting';
            activeLoops: any[];
            activeSessions: any[];
            pendingApprovals: any[];
            lastOpened: number;
          }>;
          pendingApprovals: Array<{
            sessionId: string;
            conversationId: string;
            conversationTitle: string;
            workspacePath: string | null;
            toolCallId: string;
            toolName: string;
            description: string;
          }>;
          inProgressStories: Array<{
            id: string;
            title: string;
            status: string;
            workspace_path: string;
            updated_at: number;
            prd_id: string | null;
            conversation_id: string | null;
            prd_name: string | null;
          }>;
          completedStories: Array<{
            id: string;
            title: string;
            status: string;
            workspace_path: string;
            updated_at: number;
            prd_id: string | null;
            prd_name: string | null;
          }>;
          summary: {
            totalWorkspaces: number;
            totalPendingApprovals: number;
            totalRunningAgents: number;
            totalActiveLoops: number;
            totalCompletedToday: number;
          };
        };
      }>('/manager/overview'),
  },

  // --- Artifacts ---
  artifacts: {
    list: (conversationId: string) =>
      request<{ ok: boolean; data: import('@e/shared').Artifact[] }>(
        `/artifacts?conversationId=${encodeURIComponent(conversationId)}`,
      ),
    get: (id: string) =>
      request<{ ok: boolean; data: import('@e/shared').Artifact }>(`/artifacts/${id}`),
    create: (body: import('@e/shared').ArtifactCreateInput) =>
      request<{ ok: boolean; data: import('@e/shared').Artifact }>('/artifacts', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    update: (id: string, body: import('@e/shared').ArtifactUpdateInput) =>
      request<{ ok: boolean; data: import('@e/shared').Artifact }>(`/artifacts/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    delete: (id: string) => request<{ ok: boolean }>(`/artifacts/${id}`, { method: 'DELETE' }),
    pin: (id: string, pinned: boolean) =>
      request<{ ok: boolean; data: import('@e/shared').Artifact }>(`/artifacts/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ pinned }),
      }),
  },

  // --- Agent Notes ---
  agentNotes: {
    list: (workspacePath: string, opts?: { status?: string; category?: string }) => {
      const params = new URLSearchParams({ workspacePath });
      if (opts?.status) params.set('status', opts.status);
      if (opts?.category) params.set('category', opts.category);
      return request<{ ok: boolean; data: import('@e/shared').AgentNote[] }>(
        `/agent-notes?${params}`,
      );
    },
    get: (id: string) =>
      request<{ ok: boolean; data: import('@e/shared').AgentNote }>(`/agent-notes/${id}`),
    create: (body: import('@e/shared').AgentNoteCreateInput) =>
      request<{ ok: boolean; data: import('@e/shared').AgentNote }>('/agent-notes', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    update: (id: string, body: import('@e/shared').AgentNoteUpdateInput) =>
      request<{ ok: boolean; data: import('@e/shared').AgentNote }>(`/agent-notes/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    delete: (id: string) => request<{ ok: boolean }>(`/agent-notes/${id}`, { method: 'DELETE' }),
    markRead: (workspacePath: string) =>
      request<{ ok: boolean; data: { updated: number } }>('/agent-notes/mark-read', {
        method: 'PATCH',
        body: JSON.stringify({ workspacePath }),
      }),
    unreadCount: (workspacePath: string) =>
      request<{ ok: boolean; data: { count: number } }>(
        `/agent-notes/unread-count?workspacePath=${encodeURIComponent(workspacePath)}`,
      ),
  },

  // --- Documents (WYSIWYG markdown editor surface) ---
  docs: {
    list: (workspacePath: string) =>
      request<{ ok: boolean; data: import('@e/shared').Document[] }>(
        `/docs?workspacePath=${encodeURIComponent(workspacePath)}`,
      ),
    get: (id: string) =>
      request<{ ok: boolean; data: import('@e/shared').Document }>(`/docs/${id}`),
    create: (body: import('@e/shared').DocumentCreateInput) =>
      request<{ ok: boolean; data: import('@e/shared').Document }>('/docs', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    update: (id: string, body: import('@e/shared').DocumentUpdateInput) =>
      request<{ ok: boolean; data: import('@e/shared').Document }>(`/docs/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    delete: (id: string) => request<{ ok: boolean }>(`/docs/${id}`, { method: 'DELETE' }),
  },

  // --- Claude Code history (read-only) ---
  // Surfaces ~/.claude/projects/<encoded-workspace>/*.jsonl. Off by default;
  // gated client-side by settings.showClaudeCodeHistory. The server endpoints
  // themselves are always available (just file reads on the user's machine).
  claudeCode: {
    list: (workspacePath: string) =>
      request<{
        ok: boolean;
        data: Array<{ id: string; title: string; updatedAt: number; messageCount: number }>;
      }>(`/claude-code/conversations?workspacePath=${encodeURIComponent(workspacePath)}`),
    get: (workspacePath: string, id: string) =>
      request<{
        ok: boolean;
        data: {
          id: string;
          title: string;
          updatedAt: number;
          messages: Array<{
            role: 'user' | 'assistant' | 'system';
            text: string;
            timestamp?: number;
          }>;
        };
      }>(
        `/claude-code/conversations/${encodeURIComponent(id)}?workspacePath=${encodeURIComponent(workspacePath)}`,
      ),
  },

  // --- Plugins ---
  // Install / list / enable / uninstall plugins. Install is multipart so
  // the zip can be streamed without base64-blowing the payload size.
  plugins: {
    list: () =>
      request<{ ok: boolean; data: import('@e/shared').InstalledPlugin[] }>(`/plugins/list`),
    install: async (zipFile: File | Blob) => {
      const fd = new FormData();
      fd.append('zip', zipFile);
      // request() helper sets Content-Type to application/json by default —
      // override by NOT going through it; use a bare fetch so the browser
      // sets the correct multipart boundary.
      const url = `${getBaseUrl()}/api/plugins/install`;
      const headers: Record<string, string> = {};
      const auth = getAuthToken();
      if (auth) headers['Authorization'] = `Bearer ${auth}`;
      const csrf = getCsrfToken();
      if (csrf) headers['X-CSRF-Token'] = csrf;
      const res = await fetch(url, { method: 'POST', headers, body: fd, credentials: 'include' });
      const body = await res.json();
      return body as
        | { ok: true; data: import('@e/shared').InstalledPlugin }
        | { ok: false; errors?: string[]; error?: string };
    },
    uninstall: (id: string) =>
      request<{ ok: boolean; error?: string }>(`/plugins/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    setEnabled: (id: string, enabled: boolean) =>
      request<{ ok: boolean; error?: string }>(`/plugins/${encodeURIComponent(id)}/enabled`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
      }),
    /**
     * Run command-source formatter contributions for `path` against
     * `content`. Returns the first plugin result, or null when no
     * matching formatter produced output (LYK-1046).
     */
    format: (path: string, content: string) =>
      request<{
        ok: boolean;
        data: { result: { formatted: string; source: string } | null };
      }>(`/plugins/format`, {
        method: 'POST',
        body: JSON.stringify({ path, content }),
      }),
    /**
     * Run command-source document-symbol providers (LYK-1048). Returns
     * the first plugin result, or null when no plugin emitted symbols.
     */
    documentSymbols: (path: string, content: string) =>
      request<{
        ok: boolean;
        data: {
          result: {
            symbols: Array<{
              name: string;
              kind: string;
              startRow: number;
              startCol: number;
              endRow: number;
              endCol: number;
              children?: any[];
            }>;
            source: string;
          } | null;
        };
      }>(`/plugins/document-symbols`, {
        method: 'POST',
        body: JSON.stringify({ path, content }),
      }),
    /**
     * Aggregate command-source completion contributions (LYK-1049).
     * Returns one result group per matching plugin; callers flatten and
     * merge into their existing completion list.
     */
    completions: (path: string, content: string, line: number, character: number) =>
      request<{
        ok: boolean;
        data: {
          results: Array<{
            items: Array<{
              label: string;
              insertText: string;
              detail?: string;
              kind?: string;
              documentation?: string;
            }>;
            source: string;
          }>;
        };
      }>(`/plugins/completions`, {
        method: 'POST',
        body: JSON.stringify({ path, content, line, character }),
      }),
    /**
     * Aggregate command-source references contributions (LYK-1051).
     * Positions are 0-indexed.
     */
    references: (path: string, content: string, line: number, character: number) =>
      request<{
        ok: boolean;
        data: {
          results: Array<{
            references: Array<{
              file: string;
              line: number;
              character: number;
              endLine?: number;
              endCharacter?: number;
            }>;
            source: string;
          }>;
        };
      }>(`/plugins/references`, {
        method: 'POST',
        body: JSON.stringify({ path, content, line, character }),
      }),
    /**
     * Run command-source rename providers (LYK-1053). First plugin whose
     * result is non-empty wins. Positions 0-indexed.
     */
    rename: (path: string, content: string, line: number, character: number, newName: string) =>
      request<{
        ok: boolean;
        data: {
          result: {
            edits: Record<
              string,
              Array<{
                startLine: number;
                startCharacter: number;
                endLine: number;
                endCharacter: number;
                newText: string;
              }>
            >;
            source: string;
          } | null;
        };
      }>(`/plugins/rename`, {
        method: 'POST',
        body: JSON.stringify({ path, content, line, character, newName }),
      }),
    /**
     * Aggregate command-source code-action contributions (LYK-1047).
     * Positions are 0-indexed.
     */
    codeActions: (
      path: string,
      content: string,
      startLine: number,
      startCharacter: number,
      endLine: number,
      endCharacter: number,
    ) =>
      request<{
        ok: boolean;
        data: {
          results: Array<{
            actions: Array<{
              title: string;
              kind?: string;
              edit?: {
                startLine: number;
                startCharacter: number;
                endLine: number;
                endCharacter: number;
                newText: string;
              };
              workspaceEdit?: Record<
                string,
                Array<{
                  startLine: number;
                  startCharacter: number;
                  endLine: number;
                  endCharacter: number;
                  newText: string;
                }>
              >;
            }>;
            source: string;
          }>;
        };
      }>(`/plugins/code-actions`, {
        method: 'POST',
        body: JSON.stringify({
          path,
          content,
          startLine,
          startCharacter,
          endLine,
          endCharacter,
        }),
      }),
    /**
     * Aggregate command-source test discovery (LYK-1054). Multiple
     * frameworks coexist — the caller picks how to merge roots into a
     * single Test Explorer tree.
     */
    discoverTests: (workspaceRoot: string) =>
      request<{
        ok: boolean;
        data: {
          results: Array<{
            tree: Array<{
              id: string;
              label: string;
              type: 'suite' | 'test';
              file?: string;
              line?: number;
              children?: any[];
            }>;
            source: string;
          }>;
        };
      }>(`/plugins/tests/discover`, {
        method: 'POST',
        body: JSON.stringify({ workspaceRoot }),
      }),
    /**
     * Run plugin-provided tests (LYK-1055). v1 buffers events until
     * completion; an SSE variant lands with LYK-1014 Test Explorer.
     */
    runTests: (workspaceRoot: string, testIds: string[]) =>
      request<{
        ok: boolean;
        data: {
          results: Array<{
            events: Array<{
              type: 'start' | 'pass' | 'fail' | 'skip' | 'output' | 'done';
              testId?: string;
              message?: string;
              duration?: number;
            }>;
            source: string;
          }>;
        };
      }>(`/plugins/tests/run`, {
        method: 'POST',
        body: JSON.stringify({ workspaceRoot, testIds }),
      }),
    // ── Registry ──
    registryConfig: () =>
      request<{ ok: boolean; data: { url: string | null } }>(`/plugins/registry/config`),
    setRegistryUrl: (url: string | null) =>
      request<{ ok: boolean; error?: string }>(`/plugins/registry/config`, {
        method: 'PATCH',
        body: JSON.stringify({ url }),
      }),
    fetchRegistry: (force?: boolean) =>
      request<{
        ok: boolean;
        data?: {
          index: import('@e/shared').PluginRegistry;
          fetchedAt: number;
          fromCache: boolean;
        };
        errors?: string[];
      }>(`/plugins/registry${force ? '?force=1' : ''}`),
    installFromRegistry: (entry: import('@e/shared').PluginRegistryEntry) =>
      request<{
        ok: boolean;
        data?: import('@e/shared').InstalledPlugin;
        errors?: string[];
      }>(`/plugins/registry/install`, {
        method: 'POST',
        body: JSON.stringify({ entry }),
      }),
  },

  // --- Canvas ---
  canvas: {
    get: (canvasId: string) => request<{ ok: boolean; data: any }>(`/canvas/item/${canvasId}`),
    list: (conversationId: string) =>
      request<{ ok: boolean; data: any[] }>(`/canvas/${conversationId}`),
    push: (body: {
      content_type: 'html' | 'svg' | 'mermaid' | 'table';
      content: string;
      title?: string;
      canvas_id?: string;
      conversation_id?: string;
    }) =>
      request<{ ok: boolean; data: any; canvasEvent: any }>('/canvas', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  },

  // --- Commentary History ---
  commentary: {
    getWorkspaceHistory: (workspaceId: string, limit?: number, offset?: number) => {
      const params = new URLSearchParams();
      if (limit) params.set('limit', String(limit));
      if (offset) params.set('offset', String(offset));
      const q = params.toString();
      return request<{
        ok: boolean;
        data: {
          history: Array<{
            id: string;
            workspace_id: string;
            conversation_id: string | null;
            text: string;
            personality: string;
            timestamp: number;
          }>;
        };
      }>(`/commentary/${encodeURIComponent(workspaceId)}/history${q ? '?' + q : ''}`);
    },
    getConversationHistory: (conversationId: string, limit?: number) => {
      const params = new URLSearchParams();
      if (limit) params.set('limit', String(limit));
      const q = params.toString();
      return request<{
        ok: boolean;
        data: {
          history: Array<{
            id: string;
            workspace_id: string;
            conversation_id: string | null;
            text: string;
            personality: string;
            timestamp: number;
          }>;
        };
      }>(`/commentary/conversation/${encodeURIComponent(conversationId)}${q ? '?' + q : ''}`);
    },
    clearHistory: (workspaceId: string) =>
      request<{ ok: boolean; data: { success: boolean } }>(
        `/commentary/${encodeURIComponent(workspaceId)}/history`,
        {
          method: 'DELETE',
        },
      ),
    exportHistory: (
      workspaceId: string,
      options?: {
        format?: 'markdown' | 'json';
        startTime?: number;
        endTime?: number;
        limit?: number;
      },
    ) => {
      const params = new URLSearchParams();
      if (options?.format) params.set('format', options.format);
      if (options?.startTime) params.set('startTime', String(options.startTime));
      if (options?.endTime) params.set('endTime', String(options.endTime));
      if (options?.limit) params.set('limit', String(options.limit));
      const q = params.toString();
      return request<{
        ok: boolean;
        data: {
          metadata: {
            workspaceName: string;
            workspaceId: string;
            personality: string;
            exportDate: string;
            totalEntries: number;
            timeRange: { start: string; end: string };
          };
          entries: Array<{
            id: string;
            workspaceId: string;
            conversationId: string | null;
            text: string;
            personality: string;
            timestamp: number;
            timestampISO: string;
          }>;
        };
      }>(`/commentary/${encodeURIComponent(workspaceId)}/export${q ? '?' + q : ''}`);
    },
    getSettings: (workspaceId: string) =>
      request<{
        ok: boolean;
        data: { enabled: boolean; personality: string; verbosity: string };
      }>(`/commentary/${encodeURIComponent(workspaceId)}/settings`),
    updateSettings: (
      workspaceId: string,
      settings: { enabled?: boolean; personality?: string; verbosity?: string },
    ) =>
      request<{
        ok: boolean;
        data: { enabled: boolean; personality: string; verbosity: string };
      }>(`/commentary/${encodeURIComponent(workspaceId)}/settings`, {
        method: 'PUT',
        body: JSON.stringify(settings),
      }),
  },

  // ── Cross-Session Messaging ──────────────────────────────────────────────────
  crossSession: {
    /** List active sessions available for cross-session messaging */
    listSessions: (excludeId?: string) => {
      const params = new URLSearchParams();
      if (excludeId) params.set('exclude', excludeId);
      const q = params.toString();
      return request<{
        ok: boolean;
        data: Array<{
          conversationId: string;
          title: string;
          workspaceName: string;
          workspaceId: string;
          status: 'idle' | 'running' | 'waiting';
          canReceive: boolean;
        }>;
      }>(`/cross-session/sessions${q ? '?' + q : ''}`);
    },

    /** Send a cross-session message */
    send: (fromConversationId: string, toConversationId: string, content: string) =>
      request<{
        ok: boolean;
        data: {
          id: string;
          fromConversationId: string;
          toConversationId: string;
          content: string;
          senderContext: {
            workspaceId: string;
            workspaceName: string;
            conversationTitle: string;
            agentProfile?: string;
          };
          timestamp: number;
          delivered: boolean;
        };
      }>('/cross-session/send', {
        method: 'POST',
        body: JSON.stringify({ fromConversationId, toConversationId, content }),
      }),

    /** Get undelivered messages for a conversation */
    getUndelivered: (conversationId: string) =>
      request<{
        ok: boolean;
        data: Array<{
          id: string;
          fromConversationId: string;
          toConversationId: string;
          content: string;
          senderContext: {
            workspaceId: string;
            workspaceName: string;
            conversationTitle: string;
            agentProfile?: string;
          };
          timestamp: number;
          delivered: boolean;
        }>;
      }>(`/cross-session/messages/${encodeURIComponent(conversationId)}`),

    /** Mark a message as delivered */
    markDelivered: (messageId: string) =>
      request<{ ok: boolean }>(
        `/cross-session/messages/${encodeURIComponent(messageId)}/delivered`,
        {
          method: 'POST',
        },
      ),

    /** Get message history for a conversation */
    getHistory: (
      conversationId: string,
      options?: { direction?: 'sent' | 'received' | 'both'; limit?: number },
    ) => {
      const params = new URLSearchParams();
      if (options?.direction) params.set('direction', options.direction);
      if (options?.limit) params.set('limit', String(options.limit));
      const q = params.toString();
      return request<{
        ok: boolean;
        data: Array<{
          id: string;
          fromConversationId: string;
          toConversationId: string;
          content: string;
          senderContext: {
            workspaceId: string;
            workspaceName: string;
            conversationTitle: string;
            agentProfile?: string;
          };
          timestamp: number;
          delivered: boolean;
        }>;
      }>(`/cross-session/history/${encodeURIComponent(conversationId)}${q ? '?' + q : ''}`);
    },

    /** Get recent cross-session message flow (for Manager View) */
    getFlow: (since?: number) => {
      const params = new URLSearchParams();
      if (since) params.set('since', String(since));
      const q = params.toString();
      return request<{
        ok: boolean;
        data: Array<{
          id: string;
          fromConversationId: string;
          toConversationId: string;
          content: string;
          senderContext: {
            workspaceId: string;
            workspaceName: string;
            conversationTitle: string;
            agentProfile?: string;
          };
          timestamp: number;
          delivered: boolean;
        }>;
      }>(`/cross-session/flow${q ? '?' + q : ''}`);
    },
  },

  // ── AI Code Actions ──

  ai: {
    /** Run an inline AI code action (explain, optimize, simplify, etc.) */
    codeAction: (
      code: string,
      action: string,
      options?: {
        filePath?: string;
        language?: string;
        diagnosticMessage?: string;
        customPrompt?: string;
      },
    ) =>
      request<{ ok: boolean; data: { result: string; action: string } }>('/ai/code-action', {
        method: 'POST',
        body: JSON.stringify({ code, action, ...options }),
      }),

    /** List available AI code actions */
    listActions: () =>
      request<{
        ok: boolean;
        data: { actions: Array<{ name: string; label: string }> };
      }>('/ai/actions'),
  },

  // ── Proactive Review ──

  review: {
    /** Request proactive AI review of code content */
    proactive: (content: string, filePath?: string, language?: string) =>
      request<{
        ok: boolean;
        data: {
          warnings: Array<{
            line: number;
            message: string;
            severity: 'info' | 'warning' | 'error';
            category: string;
          }>;
        };
      }>('/review/proactive', {
        method: 'POST',
        body: JSON.stringify({ content, filePath, language }),
      }),
  },

  // ── Format ──

  format: {
    /** Format a file using an external formatter */
    format: (filePath: string, language: string, workspacePath: string) =>
      request<{ ok: boolean; data: { formatted: boolean; formatter: string } }>('/format', {
        method: 'POST',
        body: JSON.stringify({ filePath, language, workspacePath }),
      }),
    /** List available formatters for a workspace */
    formatters: (workspacePath: string) =>
      request<{
        ok: boolean;
        data: { formatters: Array<{ name: string; languages: string[] }> };
      }>(`/format/formatters?workspacePath=${encodeURIComponent(workspacePath)}`),
  },

  // ── Tests ──

  tests: {
    /** Find test files affected by changed files via import graph analysis */
    affected: (rootPath: string, changedFiles: string[], maxDepth?: number) =>
      request<{
        ok: boolean;
        data: {
          affected: Array<{
            testFile: string;
            relativePath: string;
            reason: string;
            depth: number;
          }>;
          total: number;
        };
      }>('/tests/affected', {
        method: 'POST',
        body: JSON.stringify({ rootPath, changedFiles, maxDepth }),
      }),
    /** Get the command to run a specific test */
    run: (rootPath: string, testFile: string, testName?: string, framework?: string) =>
      request<{
        ok: boolean;
        data: { command: string; testFile: string; testName?: string };
      }>('/tests/run', {
        method: 'POST',
        body: JSON.stringify({ rootPath, testFile, testName, framework }),
      }),
    /** Generate unit tests for code using AI */
    generate: (
      code: string,
      filePath: string,
      functionName?: string,
      language?: string,
      testFramework?: string,
    ) =>
      request<{
        ok: boolean;
        data: { testCode: string; testFile: string; framework: string };
      }>('/tests/generate', {
        method: 'POST',
        body: JSON.stringify({ code, filePath, functionName, language, testFramework }),
      }),
  },

  // ── Pattern Learning / Self-Improving Skills ──

  learning: {
    /** Trigger pattern analysis for a conversation */
    analyze: (workspacePath: string, conversationId: string, sensitivity?: string) =>
      request<{
        ok: boolean;
        data: import('@e/shared').PatternDetection[];
      }>('/pattern-detection/analyze', {
        method: 'POST',
        body: JSON.stringify({ workspacePath, conversationId, sensitivity }),
      }),

    /** Get detected patterns for a workspace */
    getPatterns: (workspacePath: string) =>
      request<{
        ok: boolean;
        data: import('@e/shared').PatternDetection[];
      }>(`/pattern-detection/patterns?workspacePath=${encodeURIComponent(workspacePath)}`),

    /** Get skill/rule proposals for a workspace */
    getProposals: (workspacePath: string, status?: string) => {
      const params = new URLSearchParams({ workspacePath });
      if (status) params.set('status', status);
      return request<{
        ok: boolean;
        data: import('@e/shared').SkillProposal[];
      }>(`/pattern-detection/proposals?${params.toString()}`);
    },

    /** Get a specific proposal */
    getProposal: (proposalId: string) =>
      request<{
        ok: boolean;
        data: import('@e/shared').SkillProposal;
      }>(`/pattern-detection/proposals/${proposalId}`),

    /** Get learning log for a workspace */
    getLearningLog: (workspacePath: string, limit = 50) => {
      const params = new URLSearchParams({ workspacePath, limit: String(limit) });
      return request<{
        ok: boolean;
        data: import('@e/shared').LearningLogEntry[];
      }>(`/pattern-detection/learning-log?${params.toString()}`);
    },

    /** Approve a skill/rule proposal */
    approveProposal: (proposalId: string) =>
      request<{
        ok: boolean;
        data: { path: string };
      }>(`/pattern-detection/proposals/${proposalId}/approve`, {
        method: 'POST',
      }),

    /** Reject a skill/rule proposal */
    rejectProposal: (proposalId: string) =>
      request<{
        ok: boolean;
      }>(`/pattern-detection/proposals/${proposalId}/reject`, {
        method: 'POST',
      }),

    /** Check patterns and auto-propose */
    checkAndPropose: (workspacePath: string, minOccurrences?: number) =>
      request<{
        ok: boolean;
        data: { proposalsMade: import('@e/shared').SkillProposal[]; count: number };
      }>('/pattern-detection/check-and-propose', {
        method: 'POST',
        body: JSON.stringify({ workspacePath, minOccurrences }),
      }),

    /** Search skills registry for capability gaps */
    suggestSkills: (query: string) =>
      request<{
        ok: boolean;
        data: Array<{ skillId: string; skillName: string; reason: string; confidence: number }>;
      }>(`/skills-registry/suggest?query=${encodeURIComponent(query)}`),
  },

  // ── Notification Channels ──

  notificationChannels: {
    /** List all notification channels */
    list: () =>
      request<{
        ok: boolean;
        data: import('@e/shared').NotificationChannel[];
      }>('/notification-channels'),

    /** Get a specific notification channel */
    get: (id: string) =>
      request<{
        ok: boolean;
        data: import('@e/shared').NotificationChannel;
      }>(`/notification-channels/${id}`),

    /** Create a new notification channel */
    create: (input: import('@e/shared').NotificationChannelCreateInput) =>
      request<{
        ok: boolean;
        data: import('@e/shared').NotificationChannel;
      }>('/notification-channels', {
        method: 'POST',
        body: JSON.stringify(input),
      }),

    /** Update a notification channel */
    update: (id: string, updates: import('@e/shared').NotificationChannelUpdateInput) =>
      request<{
        ok: boolean;
        data: import('@e/shared').NotificationChannel;
      }>(`/notification-channels/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      }),

    /** Delete a notification channel */
    delete: (id: string) =>
      request<{
        ok: boolean;
      }>(`/notification-channels/${id}`, {
        method: 'DELETE',
      }),

    /** Test a notification channel configuration */
    test: (config: import('@e/shared').NotificationChannelConfig) =>
      request<{
        ok: boolean;
        data: import('@e/shared').NotificationTestResult;
      }>('/notification-channels/test', {
        method: 'POST',
        body: JSON.stringify({ config }),
      }),

    /** Send a notification */
    send: (input: import('@e/shared').NotificationSendInput) =>
      request<{
        ok: boolean;
      }>('/notification-channels/send', {
        method: 'POST',
        body: JSON.stringify(input),
      }),

    /** Get workspace notification preferences */
    getWorkspacePreferences: (workspaceId: string) =>
      request<{
        ok: boolean;
        data: import('@e/shared').WorkspaceNotificationPreferences;
      }>(`/notification-channels/workspace/${workspaceId}/preferences`),

    /** Update workspace notification preferences */
    updateWorkspacePreferences: (
      workspaceId: string,
      prefs: Partial<import('@e/shared').WorkspaceNotificationPreferences>,
    ) =>
      request<{
        ok: boolean;
        data: import('@e/shared').WorkspaceNotificationPreferences;
      }>(`/notification-channels/workspace/${workspaceId}/preferences`, {
        method: 'PUT',
        body: JSON.stringify(prefs),
      }),

    /** Get notification delivery logs */
    getLogs: (limit?: number) =>
      request<{
        ok: boolean;
        data: import('@e/shared').NotificationLog[];
      }>(`/notification-channels/logs${limit ? `?limit=${limit}` : ''}`),
  },

  // --- Worktrees ---
  worktrees: {
    list: (workspacePath: string) =>
      request<{
        ok: boolean;
        data: Array<
          import('@e/shared').WorktreeInfo & { record: import('@e/shared').WorktreeRecord | null }
        >;
      }>(`/worktrees?workspacePath=${encodeURIComponent(workspacePath)}`),
    create: (body: { workspacePath: string; storyId: string; baseBranch?: string }) =>
      request<{ ok: boolean; data: import('@e/shared').WorktreeRecord }>('/worktrees', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    prune: (workspacePath: string) =>
      request<{ ok: boolean; data: { prunedGit: number; prunedDb: number } }>('/worktrees/prune', {
        method: 'POST',
        body: JSON.stringify({ workspacePath }),
      }),
    status: (storyId: string) =>
      request<{
        ok: boolean;
        data: { branch: string; dirtyFiles: string[]; aheadBy: number; behindBy: number };
      }>(`/worktrees/${storyId}/status`),
    merge: (storyId: string, opts?: { skipQualityCheck?: boolean; retry?: boolean }) =>
      request<{
        ok: boolean;
        data: {
          storyId: string;
          status: string;
          commitSha?: string;
          operationLog: import('@e/shared').MergeOperationLogEntry[];
        };
      }>(`/worktrees/${storyId}/merge`, {
        method: 'POST',
        body: JSON.stringify(opts ?? {}),
      }),
    remove: (storyId: string, force?: boolean) =>
      request<{ ok: boolean; data: { storyId: string } }>(
        `/worktrees/${storyId}${force ? '?force=true' : ''}`,
        {
          method: 'DELETE',
        },
      ),
    assistedMerge: (storyId: string, body: { strategy: 'stash' | 'commit' }) =>
      request<{ ok: boolean; data: { conversationId: string; storyId: string } }>(
        `/worktrees/${storyId}/assisted-merge`,
        { method: 'POST', body: JSON.stringify(body) },
      ),
  },

  // ─── Feature Flags ──────────────────────────────────────────────────────
  featureFlags: {
    list: () => request<{ ok: boolean; flags: any[] }>('/feature-flags'),
    toggle: (id: string, enabled: boolean) =>
      request<{ ok: boolean }>(`/feature-flags/${id}/toggle`, {
        method: 'POST',
        body: JSON.stringify({ enabled }),
      }),
    reset: (id: string) => request<{ ok: boolean }>(`/feature-flags/${id}`, { method: 'DELETE' }),
  },

  // ─── KAIROS Daemon ─────────────────────────────────────────────────────
  kairos: {
    list: () => request<{ ok: boolean; daemons: any[] }>('/kairos'),
    get: (id: string) => request<{ ok: boolean; daemon: any }>(`/kairos/${id}`),
    start: (golemId: string, workspacePath: string, config?: any) =>
      request<{ ok: boolean; daemon: any }>('/kairos/start', {
        method: 'POST',
        body: JSON.stringify({ golemId, workspacePath, config }),
      }),
    stop: (id: string) => request<{ ok: boolean }>(`/kairos/${id}/stop`, { method: 'POST' }),
    pause: (id: string) => request<{ ok: boolean }>(`/kairos/${id}/pause`, { method: 'POST' }),
    resume: (id: string) => request<{ ok: boolean }>(`/kairos/${id}/resume`, { method: 'POST' }),
  },

  // ─── autoDream ─────────────────────────────────────────────────────────
  dream: {
    state: () => request<{ ok: boolean; state: any }>('/dream/state'),
    trigger: () => request<{ ok: boolean; result: any }>('/dream/trigger', { method: 'POST' }),
    logs: () => request<{ ok: boolean; logs: any[] }>('/dream/logs'),
  },

  // ─── Swarm Coordinator ─────────────────────────────────────────────────
  swarm: {
    list: () => request<{ ok: boolean; groups: any[] }>('/swarm'),
    get: (id: string) => request<{ ok: boolean; group: any }>(`/swarm/${id}`),
    create: (name: string, workspacePath: string, tasks: any[], config?: any) =>
      request<{ ok: boolean; group: any }>('/swarm', {
        method: 'POST',
        body: JSON.stringify({ name, workspacePath, tasks, config }),
      }),
    execute: (id: string) => request<{ ok: boolean }>(`/swarm/${id}/execute`, { method: 'POST' }),
    cancel: (id: string) => request<{ ok: boolean }>(`/swarm/${id}/cancel`, { method: 'POST' }),
  },

  // ─── BUDDY Pet ─────────────────────────────────────────────────────────
  buddy: {
    get: () => request<{ ok: boolean; buddy: any; species: any }>('/buddy'),
    interact: (type: 'pat' | 'feed' | 'play') =>
      request<{ ok: boolean; buddy: any }>('/buddy/interact', {
        method: 'POST',
        body: JSON.stringify({ type }),
      }),
    react: (event: string) =>
      request<{ ok: boolean; buddy: any }>('/buddy/react', {
        method: 'POST',
        body: JSON.stringify({ event }),
      }),
    species: () => request<{ ok: boolean; species: any[] }>('/buddy/species'),
    tick: () => request<{ ok: boolean; buddy: any }>('/buddy/tick', { method: 'POST' }),
  },

  // ─── ULTRAPLAN ──────────────────────────────────────────────────────────
  ultraplan: {
    list: () => request<{ ok: boolean; sessions: any[] }>('/ultraplan'),
    get: (id: string) => request<{ ok: boolean; session: any }>(`/ultraplan/${id}`),
    start: (prompt: string, workspacePath?: string, prdId?: string, config?: any) =>
      request<{ ok: boolean; session: any }>('/ultraplan/start', {
        method: 'POST',
        body: JSON.stringify({ prompt, workspacePath, prdId, config }),
      }),
    approve: (id: string, note?: string) =>
      request<{ ok: boolean; session: any }>(`/ultraplan/${id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ note }),
      }),
    reject: (id: string, note?: string) =>
      request<{ ok: boolean; session: any }>(`/ultraplan/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ note }),
      }),
  },

  // ─── Undercover Mode ──────────────────────────────────────────────────
  undercover: {
    status: (workspace?: string) =>
      request<{ ok: boolean; state: any }>(`/undercover/status?workspace=${workspace || '.'}`),
    activate: (workspacePath: string) =>
      request<{ ok: boolean; state: any }>('/undercover/activate', {
        method: 'POST',
        body: JSON.stringify({ workspacePath }),
      }),
    deactivate: (workspacePath: string) =>
      request<{ ok: boolean; state: any }>('/undercover/deactivate', {
        method: 'POST',
        body: JSON.stringify({ workspacePath }),
      }),
    scrub: (workspacePath: string, text: string) =>
      request<{ ok: boolean; scrubbed: string }>('/undercover/scrub', {
        method: 'POST',
        body: JSON.stringify({ workspacePath, text }),
      }),
    checkCommit: (workspacePath: string, message: string) =>
      request<{ ok: boolean; warning: any; clean: boolean }>('/undercover/check-commit', {
        method: 'POST',
        body: JSON.stringify({ workspacePath, message }),
      }),
    checkPR: (workspacePath: string, title: string, body: string) =>
      request<{ ok: boolean; warning: any; clean: boolean }>('/undercover/check-pr', {
        method: 'POST',
        body: JSON.stringify({ workspacePath, title, body }),
      }),
    dismissWarning: (workspacePath: string, warningId: string) =>
      request<{ ok: boolean }>('/undercover/dismiss-warning', {
        method: 'POST',
        body: JSON.stringify({ workspacePath, warningId }),
      }),
  },

  // ─── Model Router ──────────────────────────────────────────────────
  modelRouter: {
    analyze: (input: string, currentModel?: string) =>
      request<{ ok: boolean; signal: any }>('/model-router/analyze', {
        method: 'POST',
        body: JSON.stringify({ input, currentModel }),
      }),
    stats: () => request<{ ok: boolean; stats: any }>('/model-router/stats'),
    config: () => request<{ ok: boolean; config: any }>('/model-router/config'),
    updateConfig: (config: any) =>
      request<{ ok: boolean; config: any }>('/model-router/config', {
        method: 'POST',
        body: JSON.stringify(config),
      }),
  },

  // ─── Provider Fallback ────────────────────────────────────────────
  providerFallback: {
    health: () => request<{ ok: boolean; health: any[] }>('/provider-fallback/health'),
    config: () => request<{ ok: boolean; config: any }>('/provider-fallback/config'),
    updateConfig: (config: any) =>
      request<{ ok: boolean; config: any }>('/provider-fallback/config', {
        method: 'POST',
        body: JSON.stringify(config),
      }),
  },

  // ─── Context Selection ────────────────────────────────────────────
  contextSelection: {
    select: (
      query: string,
      workspacePath?: string,
      recentFiles?: string[],
      errorFiles?: string[],
      mentionedFiles?: string[],
    ) =>
      request<{ ok: boolean; result: any }>('/context-selection/select', {
        method: 'POST',
        body: JSON.stringify({ query, workspacePath, recentFiles, errorFiles, mentionedFiles }),
      }),
    config: () => request<{ ok: boolean; config: any }>('/context-selection/config'),
    updateConfig: (config: any) =>
      request<{ ok: boolean; config: any }>('/context-selection/config', {
        method: 'POST',
        body: JSON.stringify(config),
      }),
  },

  // ─── Retry / Circuit Breakers ─────────────────────────────────────
  retry: {
    circuits: () => request<{ ok: boolean; circuits: any }>('/retry/circuits'),
    circuit: (key: string) => request<{ ok: boolean; state: any }>(`/retry/circuits/${key}`),
    resetCircuit: (key: string) =>
      request<{ ok: boolean }>(`/retry/circuits/${key}/reset`, { method: 'POST' }),
    config: () => request<{ ok: boolean; config: any }>('/retry/config'),
    updateConfig: (config: any) =>
      request<{ ok: boolean; config: any }>('/retry/config', {
        method: 'POST',
        body: JSON.stringify(config),
      }),
  },

  // ─── Impact Analysis ──────────────────────────────────────────────
  impactAnalysis: {
    analyze: (changedFiles: string[], workspacePath?: string) =>
      request<{ ok: boolean; result: any }>('/impact-analysis/analyze', {
        method: 'POST',
        body: JSON.stringify({ changedFiles, workspacePath }),
      }),
    analyzeDiff: (workspacePath?: string) =>
      request<{ ok: boolean; result: any }>('/impact-analysis/analyze-diff', {
        method: 'POST',
        body: JSON.stringify({ workspacePath }),
      }),
  },

  // ─── Task Queue ───────────────────────────────────────────────────
  taskQueue: {
    list: () => request<{ ok: boolean; tasks: any[] }>('/task-queue'),
    get: (id: string) => request<{ ok: boolean; task: any }>(`/task-queue/${id}`),
    enqueue: (name: string, payload?: any, priority?: string, opts?: any) =>
      request<{ ok: boolean; task: any }>('/task-queue/enqueue', {
        method: 'POST',
        body: JSON.stringify({ name, payload, priority, ...opts }),
      }),
    cancel: (id: string) =>
      request<{ ok: boolean; cancelled: boolean }>(`/task-queue/${id}/cancel`, { method: 'POST' }),
    stats: () => request<{ ok: boolean; stats: any }>('/task-queue/stats/summary'),
  },

  // ─── Codebase Init ────────────────────────────────────────────────
  codebaseInit: {
    scan: (workspacePath?: string) =>
      request<{ ok: boolean; result: any }>('/codebase-init/scan', {
        method: 'POST',
        body: JSON.stringify({ workspacePath }),
      }),
    init: (workspacePath?: string, overwrite?: boolean) =>
      request<{ ok: boolean; result: any; rulesPath?: string }>('/codebase-init/init', {
        method: 'POST',
        body: JSON.stringify({ workspacePath, overwrite }),
      }),
  },

  // ─── Terminal Recording ───────────────────────────────────────────
  terminalRecording: {
    list: () => request<{ ok: boolean; recordings: any[] }>('/terminal-recording'),
    start: (sessionId: string, cols?: number, rows?: number, title?: string) =>
      request<{ ok: boolean; recording: any }>('/terminal-recording/start', {
        method: 'POST',
        body: JSON.stringify({ sessionId, cols, rows, title }),
      }),
    stop: (id: string) =>
      request<{ ok: boolean; recording: any }>(`/terminal-recording/${id}/stop`, {
        method: 'POST',
      }),
    events: (id: string) =>
      request<{ ok: boolean; header: any; events: any[] }>(`/terminal-recording/${id}/events`),
    delete: (id: string) =>
      request<{ ok: boolean }>(`/terminal-recording/${id}`, { method: 'DELETE' }),
    prune: () =>
      request<{ ok: boolean; pruned: number }>('/terminal-recording/prune', { method: 'POST' }),
  },

  // ─── Memory Index ──────────────────────────────────────────────────
  memoryIndex: {
    entries: (workspace?: string) =>
      request<{ ok: boolean; entries: any[] }>(
        `/memory-index/entries?workspace=${workspace || '.'}`,
      ),
    index: (workspace?: string) =>
      request<{ ok: boolean; index: string }>(`/memory-index/index?workspace=${workspace || '.'}`),
    create: (
      name: string,
      content: string,
      type?: string,
      description?: string,
      workspace?: string,
    ) =>
      request<{ ok: boolean; entry: any }>('/memory-index/entries', {
        method: 'POST',
        body: JSON.stringify({ name, content, type, description, workspace }),
      }),
    update: (filename: string, updates: any, workspace?: string) =>
      request<{ ok: boolean; entry: any }>(`/memory-index/entries/${filename}`, {
        method: 'PUT',
        body: JSON.stringify({ ...updates, workspace }),
      }),
    delete: (filename: string, workspace?: string) =>
      request<{ ok: boolean }>(`/memory-index/entries/${filename}?workspace=${workspace || '.'}`, {
        method: 'DELETE',
      }),
    rebuild: (workspace?: string) =>
      request<{ ok: boolean }>(`/memory-index/rebuild?workspace=${workspace || '.'}`, {
        method: 'POST',
      }),
  },

  // ─── AST Parsing ────────────────────────────────────────────────────
  ast: {
    parse: (filePath?: string, content?: string, language?: string) =>
      request<{ ok: boolean; structure: any }>('/ast/parse', {
        method: 'POST',
        body: JSON.stringify({ filePath, content, language }),
      }),
    functions: (path: string) =>
      request<{ ok: boolean; signatures: any[] }>(
        `/ast/functions?path=${encodeURIComponent(path)}`,
      ),
    classes: (path: string) =>
      request<{ ok: boolean; outlines: any[] }>(`/ast/classes?path=${encodeURIComponent(path)}`),
  },

  // ─── Browser Automation ──────────────────────────────────────────────
  browser: {
    createSession: (config?: any) =>
      request<{ ok: boolean; session: any }>('/browser/sessions', {
        method: 'POST',
        body: JSON.stringify({ config }),
      }),
    action: (sessionId: string, action: any) =>
      request<{ ok: boolean; result: any }>(`/browser/sessions/${sessionId}/action`, {
        method: 'POST',
        body: JSON.stringify(action),
      }),
    getSession: (id: string) => request<{ ok: boolean; session: any }>(`/browser/sessions/${id}`),
    listSessions: () => request<{ ok: boolean; sessions: any[] }>('/browser/sessions'),
    closeSession: (id: string) =>
      request<{ ok: boolean }>(`/browser/sessions/${id}/close`, { method: 'POST' }),
  },

  // ─── Prompt Cache ──────────────────────────────────────────────────────
  promptCache: {
    stats: () => request<{ ok: boolean; stats: any }>('/prompt-cache/stats'),
    conversationStats: (id: string) =>
      request<{ ok: boolean; stats: any }>(`/prompt-cache/stats/${id}`),
    config: () => request<{ ok: boolean; config: any }>('/prompt-cache/config'),
    updateConfig: (config: any) =>
      request<{ ok: boolean; config: any }>('/prompt-cache/config', {
        method: 'POST',
        body: JSON.stringify(config),
      }),
  },

  // ─── Telemetry ─────────────────────────────────────────────────────────
  telemetry: {
    config: () => request<{ ok: boolean; config: any }>('/telemetry/config'),
    updateConfig: (config: any) =>
      request<{ ok: boolean; config: any }>('/telemetry/config', {
        method: 'POST',
        body: JSON.stringify(config),
      }),
    events: (opts?: { since?: number; until?: number; type?: string; limit?: number }) => {
      const params = new URLSearchParams();
      if (opts?.since) params.set('since', String(opts.since));
      if (opts?.until) params.set('until', String(opts.until));
      if (opts?.type) params.set('type', opts.type);
      if (opts?.limit) params.set('limit', String(opts.limit));
      return request<{ ok: boolean; events: any[] }>(`/telemetry/events?${params}`);
    },
    summary: (date: string) => request<{ ok: boolean; summary: any }>(`/telemetry/summary/${date}`),
    track: (type: string, data?: any) =>
      request<{ ok: boolean }>('/telemetry/track', {
        method: 'POST',
        body: JSON.stringify({ type, data }),
      }),
    prune: () => request<{ ok: boolean; pruned: number }>('/telemetry/prune', { method: 'POST' }),
  },

  // ─── Agent Sleep ───────────────────────────────────────────────────────
  agentSleep: {
    list: (state?: string) =>
      request<{ ok: boolean; checkpoints: any[] }>(`/agent-sleep${state ? `?state=${state}` : ''}`),
    get: (id: string) => request<{ ok: boolean; checkpoint: any }>(`/agent-sleep/${id}`),
    sleep: (
      agentId: string,
      state: any,
      wakeCondition: any,
      workspacePath?: string,
      reason?: string,
    ) =>
      request<{ ok: boolean; checkpoint: any }>('/agent-sleep/sleep', {
        method: 'POST',
        body: JSON.stringify({ agentId, state, wakeCondition, workspacePath, reason }),
      }),
    wake: (id: string) =>
      request<{ ok: boolean; checkpoint: any }>(`/agent-sleep/${id}/wake`, { method: 'POST' }),
    cancel: (id: string) =>
      request<{ ok: boolean }>(`/agent-sleep/${id}/cancel`, { method: 'POST' }),
  },

  // ─── Swarm Mailbox ────────────────────────────────────────────────────
  swarmMailbox: {
    send: (groupId: string, fromAgentId: string, toAgentId: string, type: string, payload?: any) =>
      request<{ ok: boolean; message: any }>('/swarm-mailbox/send', {
        method: 'POST',
        body: JSON.stringify({ groupId, fromAgentId, toAgentId, type, payload }),
      }),
    claim: (id: string, claimerId: string) =>
      request<{ ok: boolean; claimed: boolean }>(`/swarm-mailbox/${id}/claim`, {
        method: 'POST',
        body: JSON.stringify({ claimerId }),
      }),
    respond: (id: string, responderId: string, responseType: string, payload?: any) =>
      request<{ ok: boolean; response: any }>(`/swarm-mailbox/${id}/respond`, {
        method: 'POST',
        body: JSON.stringify({ responderId, responseType, payload }),
      }),
    pending: (agentId: string, groupId?: string) =>
      request<{ ok: boolean; messages: any[] }>(
        `/swarm-mailbox/pending/${agentId}${groupId ? `?groupId=${groupId}` : ''}`,
      ),
    groupMessages: (groupId: string) =>
      request<{ ok: boolean; messages: any[] }>(`/swarm-mailbox/group/${groupId}`),
  },

  /**
   * Generic fetch wrapper for direct API calls.
   * Automatically adds auth and CSRF tokens to headers.
   */
  fetch: async (path: string, opts: RequestInit = {}): Promise<Response> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(opts.headers as Record<string, string>),
    };
    const token = getAuthToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (_csrfToken) headers['X-CSRF-Token'] = _csrfToken;

    return fetch(path, { ...opts, headers });
  },
};
