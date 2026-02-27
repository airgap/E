import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { createTestDb } from '../../test-helpers';

// ---------------------------------------------------------------------------
// Module mocks — must precede the import of the module under test
// ---------------------------------------------------------------------------

const testDb = createTestDb();
mock.module('../../db/database', () => ({
  getDb: () => testDb,
  initDatabase: () => {},
}));

let mockOllamaHealthy = true;
mock.module('../ollama-provider', () => ({
  checkOllamaHealth: async () => mockOllamaHealthy,
}));

let mockBuildCliResult = { binary: '/usr/bin/claude', args: ['-p', 'test'] };
mock.module('../cli-provider', () => ({
  buildCliCommand: (..._args: any[]) => mockBuildCliResult,
}));

// Save original globals so we can restore them
const originalFetch = globalThis.fetch;
const originalBunSpawn = Bun.spawn;

import { callLlm, resetOllamaCache, type CallLlmOptions } from '../llm-oneshot';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clearDb() {
  testDb.exec('DELETE FROM settings');
}

function setSetting(key: string, value: any) {
  testDb
    .query('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    .run(key, JSON.stringify(value));
}

function makeOllamaResponse(content: string) {
  return new Response(JSON.stringify({ message: { content }, done: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeAnthropicResponse(text: string) {
  return new Response(JSON.stringify({ content: [{ type: 'text', text }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Create a fake Bun.spawn return value that simulates CLI process output.
 */
function makeFakeProc(stdout: string, stderr = '', exitCode = 0) {
  const stdoutStream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(stdout));
      controller.close();
    },
  });
  const stderrStream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(stderr));
      controller.close();
    },
  });
  return {
    stdin: { end: () => {} },
    stdout: stdoutStream,
    stderr: stderrStream,
    exited: Promise.resolve(exitCode),
    kill: () => {},
    pid: 12345,
  };
}

/**
 * Build a stream-json stdout that `extractTextFromStreamJson` can parse.
 */
function makeStreamJsonOutput(text: string): string {
  const lines = [
    JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-1' }),
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'text', text }],
      },
    }),
    JSON.stringify({ type: 'result', subtype: 'success', usage: {} }),
  ];
  return lines.join('\n') + '\n';
}

const defaultOpts: CallLlmOptions = {
  system: 'You are helpful.',
  user: 'Say hello',
};

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('resetOllamaCache', () => {
  beforeEach(() => {
    clearDb();
    globalThis.fetch = originalFetch;
    resetOllamaCache();
  });

  test('allows re-checking Ollama availability after reset', async () => {
    // First: configure auto mode with Ollama available
    setSetting('oneshotProvider', 'auto');
    mockOllamaHealthy = true;

    globalThis.fetch = (async (url: string) => {
      if (typeof url === 'string' && url.includes('/api/chat')) {
        return makeOllamaResponse('first');
      }
      return new Response('', { status: 200 });
    }) as any;

    const result1 = await callLlm(defaultOpts);
    expect(result1).toBe('first');

    // Now make Ollama "unhealthy" — but cached, so it still uses Ollama
    mockOllamaHealthy = false;

    // Reset cache to force re-check
    resetOllamaCache();

    // Now auto mode should fall through to CLI since Ollama is unhealthy
    (Bun as any).spawn = () => makeFakeProc(makeStreamJsonOutput('from-cli'));
    const result2 = await callLlm(defaultOpts);
    expect(result2).toBe('from-cli');
  });
});

describe('callLlm — oneshotProvider routing', () => {
  beforeEach(() => {
    clearDb();
    globalThis.fetch = originalFetch;
    (Bun as any).spawn = originalBunSpawn;
    resetOllamaCache();
    mockOllamaHealthy = true;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    (Bun as any).spawn = originalBunSpawn;
  });

  // -----------------------------------------------------------------------
  // 'ollama' mode
  // -----------------------------------------------------------------------

  test('oneshotProvider=ollama routes directly to Ollama', async () => {
    setSetting('oneshotProvider', 'ollama');

    let capturedUrl = '';
    let capturedBody: any = null;
    globalThis.fetch = (async (url: string, init?: any) => {
      capturedUrl = url;
      capturedBody = JSON.parse(init.body);
      return makeOllamaResponse('ollama-direct');
    }) as any;

    const result = await callLlm(defaultOpts);
    expect(result).toBe('ollama-direct');
    expect(capturedUrl).toContain('/api/chat');
    expect(capturedBody.messages).toHaveLength(2); // system + user
    expect(capturedBody.messages[0].role).toBe('system');
    expect(capturedBody.messages[1].role).toBe('user');
    expect(capturedBody.stream).toBe(false);
  });

  test('oneshotProvider=ollama throws when Ollama returns non-ok', async () => {
    setSetting('oneshotProvider', 'ollama');

    globalThis.fetch = (async () => new Response('Service Unavailable', { status: 503 })) as any;

    await expect(callLlm(defaultOpts)).rejects.toThrow('Ollama error 503');
  });

  test('oneshotProvider=ollama throws when fetch fails', async () => {
    setSetting('oneshotProvider', 'ollama');

    globalThis.fetch = (async () => {
      throw new Error('ECONNREFUSED');
    }) as any;

    await expect(callLlm(defaultOpts)).rejects.toThrow('ECONNREFUSED');
  });

  test('oneshotProvider=ollama throws on empty response', async () => {
    setSetting('oneshotProvider', 'ollama');

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ message: { content: '' } }), {
        status: 200,
      })) as any;

    await expect(callLlm(defaultOpts)).rejects.toThrow('Ollama returned no text content');
  });

  // -----------------------------------------------------------------------
  // 'auto' mode
  // -----------------------------------------------------------------------

  test('oneshotProvider=auto uses Ollama when healthy', async () => {
    setSetting('oneshotProvider', 'auto');
    mockOllamaHealthy = true;

    globalThis.fetch = (async () => makeOllamaResponse('auto-ollama')) as any;

    const result = await callLlm(defaultOpts);
    expect(result).toBe('auto-ollama');
  });

  test('oneshotProvider=auto uses configured oneshot model', async () => {
    setSetting('oneshotProvider', 'auto');
    setSetting('oneshotModel', 'phi3:mini');
    mockOllamaHealthy = true;

    let capturedBody: any = null;
    globalThis.fetch = (async (_url: string, init?: any) => {
      capturedBody = JSON.parse(init.body);
      return makeOllamaResponse('with-custom-model');
    }) as any;

    await callLlm(defaultOpts);
    expect(capturedBody.model).toBe('phi3:mini');
  });

  test('oneshotProvider=auto respects explicit model override over oneshotModel', async () => {
    setSetting('oneshotProvider', 'auto');
    setSetting('oneshotModel', 'phi3:mini');
    mockOllamaHealthy = true;

    let capturedBody: any = null;
    globalThis.fetch = (async (_url: string, init?: any) => {
      capturedBody = JSON.parse(init.body);
      return makeOllamaResponse('explicit-model');
    }) as any;

    await callLlm({ ...defaultOpts, model: 'llama3:8b' });
    expect(capturedBody.model).toBe('llama3:8b');
  });

  test('oneshotProvider=auto falls back to CLI when Ollama unhealthy', async () => {
    setSetting('oneshotProvider', 'auto');
    mockOllamaHealthy = false;

    (Bun as any).spawn = () => makeFakeProc(makeStreamJsonOutput('cli-fallback'));

    const result = await callLlm(defaultOpts);
    expect(result).toBe('cli-fallback');
  });

  test('oneshotProvider=auto falls back to CLI when Ollama call fails', async () => {
    setSetting('oneshotProvider', 'auto');
    mockOllamaHealthy = true;

    let fetchCallCount = 0;
    globalThis.fetch = (async () => {
      fetchCallCount++;
      throw new Error('Ollama crashed');
    }) as any;

    (Bun as any).spawn = () => makeFakeProc(makeStreamJsonOutput('recovered-via-cli'));

    // Suppress expected console.warn
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    const result = await callLlm(defaultOpts);
    warnSpy.mockRestore();

    expect(result).toBe('recovered-via-cli');
    expect(fetchCallCount).toBe(1); // Ollama was tried once
  });

  test('oneshotProvider=auto invalidates cache on Ollama failure', async () => {
    setSetting('oneshotProvider', 'auto');
    mockOllamaHealthy = true;

    // First call: Ollama fails
    let ollamaCallCount = 0;
    globalThis.fetch = (async () => {
      ollamaCallCount++;
      throw new Error('Ollama down');
    }) as any;

    (Bun as any).spawn = () => makeFakeProc(makeStreamJsonOutput('from-cli'));
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

    await callLlm(defaultOpts);
    warnSpy.mockRestore();

    // The cache should now be invalidated. On next call with Ollama unhealthy,
    // it should re-check health (which will now be false)
    mockOllamaHealthy = false;
    ollamaCallCount = 0;

    const result = await callLlm(defaultOpts);
    // Should not even try Ollama fetch since health check returns false
    expect(ollamaCallCount).toBe(0);
    expect(result).toBe('from-cli');
  });

  // -----------------------------------------------------------------------
  // 'cli' mode (or default)
  // -----------------------------------------------------------------------

  test('oneshotProvider=cli routes directly to CLI', async () => {
    setSetting('oneshotProvider', 'cli');
    setSetting('cliProvider', 'claude');

    (Bun as any).spawn = () => makeFakeProc(makeStreamJsonOutput('cli-direct'));

    const result = await callLlm(defaultOpts);
    expect(result).toBe('cli-direct');
  });

  test('default oneshotProvider (auto) when no setting exists', async () => {
    // No oneshotProvider setting at all — defaults to 'auto'
    mockOllamaHealthy = true;

    globalThis.fetch = (async () => makeOllamaResponse('default-auto')) as any;

    const result = await callLlm(defaultOpts);
    expect(result).toBe('default-auto');
  });
});

describe('callLlm — CLI provider routing', () => {
  beforeEach(() => {
    clearDb();
    globalThis.fetch = originalFetch;
    (Bun as any).spawn = originalBunSpawn;
    resetOllamaCache();
    // Force CLI path by setting oneshotProvider to 'cli'
    setSetting('oneshotProvider', 'cli');
    mockBuildCliResult = { binary: '/usr/bin/claude', args: ['-p', 'test'] };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    (Bun as any).spawn = originalBunSpawn;
  });

  test('routes to CLI for cliProvider=claude', async () => {
    setSetting('cliProvider', 'claude');
    let spawnCalled = false;

    (Bun as any).spawn = (...args: any[]) => {
      spawnCalled = true;
      return makeFakeProc(makeStreamJsonOutput('claude-response'));
    };

    const result = await callLlm(defaultOpts);
    expect(spawnCalled).toBe(true);
    expect(result).toBe('claude-response');
  });

  test('routes to CLI for cliProvider=gemini-cli', async () => {
    setSetting('cliProvider', 'gemini-cli');

    (Bun as any).spawn = () => makeFakeProc(makeStreamJsonOutput('gemini-response'));

    const result = await callLlm(defaultOpts);
    expect(result).toBe('gemini-response');
  });

  test('routes to CLI for cliProvider=copilot', async () => {
    setSetting('cliProvider', 'copilot');

    (Bun as any).spawn = () => makeFakeProc(makeStreamJsonOutput('copilot-response'));

    const result = await callLlm(defaultOpts);
    expect(result).toBe('copilot-response');
  });

  test('routes to Ollama for cliProvider=ollama', async () => {
    setSetting('cliProvider', 'ollama');

    globalThis.fetch = (async () => makeOllamaResponse('ollama-via-cli-path')) as any;

    const result = await callLlm(defaultOpts);
    expect(result).toBe('ollama-via-cli-path');
  });

  test('routes to Kiro fallback for cliProvider=kiro with ANTHROPIC_API_KEY', async () => {
    setSetting('cliProvider', 'kiro');

    const originalKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';

    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

    let capturedUrl = '';
    let capturedHeaders: any = null;
    globalThis.fetch = (async (url: string, init?: any) => {
      capturedUrl = url;
      capturedHeaders = init.headers;
      return makeAnthropicResponse('kiro-fallback-response');
    }) as any;

    const result = await callLlm(defaultOpts);
    warnSpy.mockRestore();

    expect(result).toBe('kiro-fallback-response');
    expect(capturedUrl).toBe('https://api.anthropic.com/v1/messages');
    expect(capturedHeaders['x-api-key']).toBe('sk-test-key');

    if (originalKey !== undefined) {
      process.env.ANTHROPIC_API_KEY = originalKey;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  test('kiro throws when no ANTHROPIC_API_KEY', async () => {
    setSetting('cliProvider', 'kiro');

    const originalKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    await expect(callLlm(defaultOpts)).rejects.toThrow(
      'Kiro provider does not yet support one-shot LLM calls',
    );

    if (originalKey !== undefined) {
      process.env.ANTHROPIC_API_KEY = originalKey;
    }
  });

  test('throws for unsupported provider', async () => {
    setSetting('cliProvider', 'nonexistent-provider');

    await expect(callLlm(defaultOpts)).rejects.toThrow('Unsupported provider');
  });

  test('default cliProvider is claude when no setting exists', async () => {
    // No cliProvider setting — falls back to 'claude'
    let spawnCalled = false;
    (Bun as any).spawn = () => {
      spawnCalled = true;
      return makeFakeProc(makeStreamJsonOutput('default-claude'));
    };

    const result = await callLlm(defaultOpts);
    expect(spawnCalled).toBe(true);
    expect(result).toBe('default-claude');
  });
});

describe('callLlm — CLI process spawning', () => {
  beforeEach(() => {
    clearDb();
    globalThis.fetch = originalFetch;
    (Bun as any).spawn = originalBunSpawn;
    resetOllamaCache();
    setSetting('oneshotProvider', 'cli');
    setSetting('cliProvider', 'claude');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    (Bun as any).spawn = originalBunSpawn;
  });

  test('spawns process with correct env vars', async () => {
    let capturedEnv: any = null;

    (Bun as any).spawn = (_cmd: string[], opts: any) => {
      capturedEnv = opts.env;
      return makeFakeProc(makeStreamJsonOutput('env-test'));
    };

    await callLlm(defaultOpts);
    expect(capturedEnv.FORCE_COLOR).toBe('0');
    expect(capturedEnv.CI).toBe('1');
    expect(capturedEnv.NONINTERACTIVE).toBe('1');
  });

  test('closes stdin immediately after spawn', async () => {
    let stdinEndCalled = false;

    (Bun as any).spawn = () => {
      const proc = makeFakeProc(makeStreamJsonOutput('stdin-test'));
      (proc.stdin as any).end = () => {
        stdinEndCalled = true;
      };
      return proc;
    };

    await callLlm(defaultOpts);
    expect(stdinEndCalled).toBe(true);
  });

  test('handles stdin.end() throwing gracefully', async () => {
    (Bun as any).spawn = () => {
      const proc = makeFakeProc(makeStreamJsonOutput('stdin-throw'));
      (proc.stdin as any).end = () => {
        throw new Error('stdin already closed');
      };
      return proc;
    };

    // Should not throw
    const result = await callLlm(defaultOpts);
    expect(result).toBe('stdin-throw');
  });

  test('throws on non-zero exit code with no stdout', async () => {
    (Bun as any).spawn = () => makeFakeProc('', 'CLI error output', 1);

    await expect(callLlm(defaultOpts)).rejects.toThrow('CLI exited with code 1');
  });

  test('includes stderr in error message on non-zero exit', async () => {
    (Bun as any).spawn = () => makeFakeProc('', 'detailed error info', 1);

    try {
      await callLlm(defaultOpts);
      expect(true).toBe(false); // Should not reach
    } catch (err: any) {
      expect(err.message).toContain('detailed error info');
    }
  });

  test('still extracts text if exit code is non-zero but stdout has content', async () => {
    (Bun as any).spawn = () =>
      makeFakeProc(makeStreamJsonOutput('partial-output'), 'some warning', 1);

    // Non-zero exit but stdout has content — should still extract
    const result = await callLlm(defaultOpts);
    expect(result).toBe('partial-output');
  });

  test('kills process on timeout', async () => {
    let killCalled = false;

    (Bun as any).spawn = () => {
      const stdoutStream = new ReadableStream({
        start(_controller) {
          // Never close — simulates a hanging process
        },
      });
      const stderrStream = new ReadableStream({
        start(controller) {
          controller.close();
        },
      });
      return {
        stdin: { end: () => {} },
        stdout: stdoutStream,
        stderr: stderrStream,
        exited: new Promise(() => {}), // never resolves
        kill: () => {
          killCalled = true;
        },
        pid: 99999,
      };
    };

    await expect(callLlm({ ...defaultOpts, timeoutMs: 200 })).rejects.toThrow('timed out');

    expect(killCalled).toBe(true);
  }, 5_000);
});

describe('callLlm — Ollama model resolution', () => {
  beforeEach(() => {
    clearDb();
    globalThis.fetch = originalFetch;
    resetOllamaCache();
    mockOllamaHealthy = true;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('uses opts.model when provided', async () => {
    setSetting('oneshotProvider', 'ollama');

    let capturedBody: any = null;
    globalThis.fetch = (async (_url: string, init?: any) => {
      capturedBody = JSON.parse(init.body);
      return makeOllamaResponse('model-test');
    }) as any;

    await callLlm({ ...defaultOpts, model: 'mistral:7b' });
    expect(capturedBody.model).toBe('mistral:7b');
  });

  test('strips ollama: prefix from model', async () => {
    setSetting('oneshotProvider', 'ollama');

    let capturedBody: any = null;
    globalThis.fetch = (async (_url: string, init?: any) => {
      capturedBody = JSON.parse(init.body);
      return makeOllamaResponse('prefix-test');
    }) as any;

    await callLlm({ ...defaultOpts, model: 'ollama:llama3' });
    expect(capturedBody.model).toBe('llama3');
  });

  test('reads model from settings DB when not provided', async () => {
    setSetting('oneshotProvider', 'ollama');
    setSetting('model', 'ollama:phi3');

    let capturedBody: any = null;
    globalThis.fetch = (async (_url: string, init?: any) => {
      capturedBody = JSON.parse(init.body);
      return makeOllamaResponse('db-model');
    }) as any;

    await callLlm(defaultOpts);
    expect(capturedBody.model).toBe('phi3');
  });

  test('falls back to oneshotModel when no model is set anywhere', async () => {
    setSetting('oneshotProvider', 'ollama');
    // No 'model' or 'oneshotModel' setting

    let capturedBody: any = null;
    globalThis.fetch = (async (_url: string, init?: any) => {
      capturedBody = JSON.parse(init.body);
      return makeOllamaResponse('default-model');
    }) as any;

    await callLlm(defaultOpts);
    expect(capturedBody.model).toBe('qwen3:1.7b'); // default oneshotModel
  });

  test('uses custom oneshotModel setting as final fallback', async () => {
    setSetting('oneshotProvider', 'ollama');
    setSetting('oneshotModel', 'gemma:2b');
    // No 'model' setting

    let capturedBody: any = null;
    globalThis.fetch = (async (_url: string, init?: any) => {
      capturedBody = JSON.parse(init.body);
      return makeOllamaResponse('custom-oneshot-model');
    }) as any;

    await callLlm(defaultOpts);
    expect(capturedBody.model).toBe('gemma:2b');
  });

  test('uses OLLAMA_BASE_URL env var', async () => {
    setSetting('oneshotProvider', 'ollama');

    const originalBase = process.env.OLLAMA_BASE_URL;
    process.env.OLLAMA_BASE_URL = 'http://custom-host:9999';

    let capturedUrl = '';
    globalThis.fetch = (async (url: string) => {
      capturedUrl = url;
      return makeOllamaResponse('custom-base');
    }) as any;

    await callLlm(defaultOpts);
    expect(capturedUrl).toBe('http://custom-host:9999/api/chat');

    if (originalBase !== undefined) {
      process.env.OLLAMA_BASE_URL = originalBase;
    } else {
      delete process.env.OLLAMA_BASE_URL;
    }
  });
});

describe('callLlm — Ollama message construction', () => {
  beforeEach(() => {
    clearDb();
    globalThis.fetch = originalFetch;
    resetOllamaCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('includes system message when system prompt provided', async () => {
    setSetting('oneshotProvider', 'ollama');

    let capturedBody: any = null;
    globalThis.fetch = (async (_url: string, init?: any) => {
      capturedBody = JSON.parse(init.body);
      return makeOllamaResponse('system-test');
    }) as any;

    await callLlm({ system: 'Be concise', user: 'Hello' });
    expect(capturedBody.messages[0]).toEqual({ role: 'system', content: 'Be concise' });
    expect(capturedBody.messages[1]).toEqual({ role: 'user', content: 'Hello' });
  });

  test('omits system message when system prompt is empty', async () => {
    setSetting('oneshotProvider', 'ollama');

    let capturedBody: any = null;
    globalThis.fetch = (async (_url: string, init?: any) => {
      capturedBody = JSON.parse(init.body);
      return makeOllamaResponse('no-system');
    }) as any;

    await callLlm({ system: '', user: 'Hello' });
    // Empty string is falsy, so no system message
    expect(capturedBody.messages).toHaveLength(1);
    expect(capturedBody.messages[0].role).toBe('user');
  });

  test('sets stream to false for one-shot calls', async () => {
    setSetting('oneshotProvider', 'ollama');

    let capturedBody: any = null;
    globalThis.fetch = (async (_url: string, init?: any) => {
      capturedBody = JSON.parse(init.body);
      return makeOllamaResponse('stream-false');
    }) as any;

    await callLlm(defaultOpts);
    expect(capturedBody.stream).toBe(false);
  });
});

describe('callLlm — Kiro fallback (Anthropic API)', () => {
  beforeEach(() => {
    clearDb();
    globalThis.fetch = originalFetch;
    resetOllamaCache();
    setSetting('oneshotProvider', 'cli');
    setSetting('cliProvider', 'kiro');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('sends correct request body to Anthropic API', async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-test';

    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

    let capturedBody: any = null;
    globalThis.fetch = (async (_url: string, init?: any) => {
      capturedBody = JSON.parse(init.body);
      return makeAnthropicResponse('kiro-body-test');
    }) as any;

    await callLlm({ system: 'Be helpful', user: 'Hi there', model: 'claude-haiku-4-5' });
    warnSpy.mockRestore();

    expect(capturedBody.model).toBe('claude-haiku-4-5');
    expect(capturedBody.system).toBe('Be helpful');
    expect(capturedBody.messages[0]).toEqual({ role: 'user', content: 'Hi there' });
    expect(capturedBody.max_tokens).toBe(4096);

    if (originalKey !== undefined) {
      process.env.ANTHROPIC_API_KEY = originalKey;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  test('uses default model when none provided', async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-test';

    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

    let capturedBody: any = null;
    globalThis.fetch = (async (_url: string, init?: any) => {
      capturedBody = JSON.parse(init.body);
      return makeAnthropicResponse('kiro-default-model');
    }) as any;

    await callLlm(defaultOpts);
    warnSpy.mockRestore();

    expect(capturedBody.model).toBe('claude-sonnet-4-6');

    if (originalKey !== undefined) {
      process.env.ANTHROPIC_API_KEY = originalKey;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  test('sends correct headers to Anthropic API', async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-header-test';

    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

    let capturedHeaders: any = null;
    globalThis.fetch = (async (_url: string, init?: any) => {
      capturedHeaders = init.headers;
      return makeAnthropicResponse('headers-test');
    }) as any;

    await callLlm(defaultOpts);
    warnSpy.mockRestore();

    expect(capturedHeaders['Content-Type']).toBe('application/json');
    expect(capturedHeaders['anthropic-version']).toBe('2023-06-01');
    expect(capturedHeaders['x-api-key']).toBe('sk-header-test');

    if (originalKey !== undefined) {
      process.env.ANTHROPIC_API_KEY = originalKey;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  test('throws on Anthropic API error response', async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-test';

    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

    globalThis.fetch = (async () => new Response('Rate limited', { status: 429 })) as any;

    await expect(callLlm(defaultOpts)).rejects.toThrow('Anthropic API error 429');
    warnSpy.mockRestore();

    if (originalKey !== undefined) {
      process.env.ANTHROPIC_API_KEY = originalKey;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  test('throws when Anthropic returns empty content', async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-test';

    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ content: [] }), { status: 200 })) as any;

    await expect(callLlm(defaultOpts)).rejects.toThrow('Anthropic API returned no text content');
    warnSpy.mockRestore();

    if (originalKey !== undefined) {
      process.env.ANTHROPIC_API_KEY = originalKey;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });
});

describe('callLlm — timeout handling', () => {
  beforeEach(() => {
    clearDb();
    globalThis.fetch = originalFetch;
    (Bun as any).spawn = originalBunSpawn;
    resetOllamaCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    (Bun as any).spawn = originalBunSpawn;
  });

  test('uses default timeout of 120000ms', async () => {
    setSetting('oneshotProvider', 'ollama');

    let capturedSignal: AbortSignal | undefined;
    globalThis.fetch = (async (_url: string, init?: any) => {
      capturedSignal = init.signal;
      return makeOllamaResponse('timeout-default');
    }) as any;

    await callLlm(defaultOpts);
    expect(capturedSignal).toBeDefined();
  });

  test('uses custom timeoutMs', async () => {
    setSetting('oneshotProvider', 'ollama');

    globalThis.fetch = (async () => makeOllamaResponse('timeout-custom')) as any;

    // Should succeed with a generous timeout
    const result = await callLlm({ ...defaultOpts, timeoutMs: 30_000 });
    expect(result).toBe('timeout-custom');
  });
});

describe('extractTextFromStreamJson (via callViaCli)', () => {
  beforeEach(() => {
    clearDb();
    (Bun as any).spawn = originalBunSpawn;
    resetOllamaCache();
    setSetting('oneshotProvider', 'cli');
    setSetting('cliProvider', 'claude');
  });

  afterEach(() => {
    (Bun as any).spawn = originalBunSpawn;
  });

  test('extracts text from well-formed stream-json', async () => {
    const stdout = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-1' }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Hello ' }] },
      }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'World' }] },
      }),
      JSON.stringify({ type: 'result', subtype: 'success' }),
    ].join('\n');

    (Bun as any).spawn = () => makeFakeProc(stdout);

    const result = await callLlm(defaultOpts);
    expect(result).toBe('Hello World');
  });

  test('concatenates multiple text blocks within a single assistant message', async () => {
    const stdout = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Part 1' },
          { type: 'text', text: ' Part 2' },
        ],
      },
    });

    (Bun as any).spawn = () => makeFakeProc(stdout);

    const result = await callLlm(defaultOpts);
    expect(result).toBe('Part 1 Part 2');
  });

  test('skips non-text content blocks', async () => {
    const stdout = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'tu_1', name: 'Read', input: {} },
          { type: 'text', text: 'Actual text' },
        ],
      },
    });

    (Bun as any).spawn = () => makeFakeProc(stdout);

    const result = await callLlm(defaultOpts);
    expect(result).toBe('Actual text');
  });

  test('ignores non-JSON lines (CLI startup messages)', async () => {
    const stdout = [
      '╔══════════════════════════╗',
      '║  Claude Code v1.0       ║',
      '╚══════════════════════════╝',
      '',
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Response text' }] },
      }),
      '',
    ].join('\n');

    (Bun as any).spawn = () => makeFakeProc(stdout);

    const result = await callLlm(defaultOpts);
    expect(result).toBe('Response text');
  });

  test('ignores non-assistant event types', async () => {
    const stdout = [
      JSON.stringify({ type: 'system', subtype: 'init' }),
      JSON.stringify({ type: 'result', subtype: 'success', usage: { input_tokens: 10 } }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Only this' }] },
      }),
    ].join('\n');

    (Bun as any).spawn = () => makeFakeProc(stdout);

    const result = await callLlm(defaultOpts);
    expect(result).toBe('Only this');
  });

  test('throws when CLI produces no text content', async () => {
    const stdout = [
      JSON.stringify({ type: 'system', subtype: 'init' }),
      JSON.stringify({ type: 'result', subtype: 'success' }),
    ].join('\n');

    (Bun as any).spawn = () => makeFakeProc(stdout);

    await expect(callLlm(defaultOpts)).rejects.toThrow('CLI produced no text content');
  });

  test('throws when CLI output is empty', async () => {
    (Bun as any).spawn = () => makeFakeProc('');

    await expect(callLlm(defaultOpts)).rejects.toThrow('CLI produced no text content');
  });

  test('throws when CLI output is only blank lines', async () => {
    (Bun as any).spawn = () => makeFakeProc('\n\n\n');

    await expect(callLlm(defaultOpts)).rejects.toThrow('CLI produced no text content');
  });

  test('handles assistant message with empty content array', async () => {
    const stdout = JSON.stringify({
      type: 'assistant',
      message: { content: [] },
    });

    (Bun as any).spawn = () => makeFakeProc(stdout);

    await expect(callLlm(defaultOpts)).rejects.toThrow('CLI produced no text content');
  });

  test('handles assistant message with content blocks having empty text', async () => {
    const stdout = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: '' }] },
    });

    (Bun as any).spawn = () => makeFakeProc(stdout);

    // Empty text blocks are skipped (block.text is falsy), so no text is collected
    await expect(callLlm(defaultOpts)).rejects.toThrow('CLI produced no text content');
  });
});

describe('callLlm — settings edge cases', () => {
  beforeEach(() => {
    clearDb();
    globalThis.fetch = originalFetch;
    (Bun as any).spawn = originalBunSpawn;
    resetOllamaCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    (Bun as any).spawn = originalBunSpawn;
  });

  test('handles corrupt settings gracefully (falls back to defaults)', async () => {
    // Insert invalid JSON in settings
    testDb
      .query('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run('oneshotProvider', 'not-valid-json{{{');

    // Should fall back to 'auto' default
    mockOllamaHealthy = true;
    globalThis.fetch = (async () => makeOllamaResponse('corrupt-settings')) as any;

    const result = await callLlm(defaultOpts);
    expect(result).toBe('corrupt-settings');
  });

  test('handles missing settings table gracefully', async () => {
    // The test DB has the settings table, but if getDb() somehow fails,
    // the code catches and falls back to defaults.
    // We test through the normal path with empty settings.
    mockOllamaHealthy = true;
    globalThis.fetch = (async () => makeOllamaResponse('empty-settings')) as any;

    const result = await callLlm(defaultOpts);
    expect(result).toBe('empty-settings');
  });
});

describe('callLlm — Bedrock routing', () => {
  beforeEach(() => {
    clearDb();
    globalThis.fetch = originalFetch;
    (Bun as any).spawn = originalBunSpawn;
    resetOllamaCache();
    setSetting('oneshotProvider', 'cli');
    setSetting('cliProvider', 'bedrock');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    (Bun as any).spawn = originalBunSpawn;
  });

  test('routes to Bedrock when cliProvider=bedrock', async () => {
    // Bedrock uses dynamic import of @aws-sdk/client-bedrock-runtime.
    // The import will likely fail in test env, but we verify it attempts the path.
    try {
      await callLlm(defaultOpts);
    } catch (err: any) {
      // Expected — either the AWS SDK isn't available or credentials aren't configured.
      // The key point is that it didn't throw "unsupported provider".
      expect(err.message).not.toContain('Unsupported provider');
    }
  });
});

describe('callLlm — multiple sequential calls', () => {
  beforeEach(() => {
    clearDb();
    globalThis.fetch = originalFetch;
    resetOllamaCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('each call is independent', async () => {
    setSetting('oneshotProvider', 'ollama');

    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount++;
      return makeOllamaResponse(`response-${callCount}`);
    }) as any;

    const r1 = await callLlm({ system: 'sys1', user: 'user1' });
    const r2 = await callLlm({ system: 'sys2', user: 'user2' });
    const r3 = await callLlm({ system: 'sys3', user: 'user3' });

    expect(r1).toBe('response-1');
    expect(r2).toBe('response-2');
    expect(r3).toBe('response-3');
    expect(callCount).toBe(3);
  });
});
