/**
 * Verifies KiroAcpClient.newSession() sends the `/tools trust-all` bootstrap
 * prompt before returning. This is the LYK-978 workaround — without it, the
 * very first tool-using turn hangs because Kiro waits for an interactive
 * permission confirmation that headless ACP can't supply.
 *
 * Uses the client's `_proc` test seam to inject a fake subprocess (Bun's
 * mock.module for `node:child_process` is file-scoped and can't intercept
 * client.ts when other test files have already cached it).
 */
import { describe, test, expect } from 'bun:test';
import { EventEmitter } from 'node:events';
import { KiroAcpClient } from '../client';

class FakeStream extends EventEmitter {
  written: string[] = [];
  write(data: string, cb?: (err?: any) => void) {
    this.written.push(data);
    if (cb) cb();
    return true;
  }
  end() {}
}

class FakeProc extends EventEmitter {
  killed = false;
  stdin = new FakeStream();
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill() {
    this.killed = true;
    this.emit('exit', 0, null);
  }
}

interface SentLine {
  method: string;
  id: number;
  params: any;
}

function sentLines(proc: FakeProc): SentLine[] {
  return proc.stdin.written
    .join('')
    .split('\n')
    .filter(Boolean)
    .map((s) => {
      const obj = JSON.parse(s);
      return { method: obj.method, id: obj.id, params: obj.params };
    });
}

/** Reply to the most recent pending request with the given method on a proc. */
function replyTo(proc: FakeProc, method: string, result: unknown) {
  const lines = sentLines(proc);
  const match = lines.find((l) => l.method === method);
  if (!match) throw new Error(`no request to ${method} was sent`);
  const msg = { jsonrpc: '2.0', id: match.id, result };
  proc.stdout.emit('data', Buffer.from(JSON.stringify(msg) + '\n'));
}

describe('KiroAcpClient.newSession trust-all bootstrap', () => {
  test('sends /tools trust-all after session/new (default)', async () => {
    const proc = new FakeProc();
    const client = new KiroAcpClient({ cwd: '/tmp', _proc: proc as any });

    const sessionPromise = client.newSession({ cwd: '/tmp' });

    // Drain each round-trip in order — initialize, session/new, then the
    // bootstrap session/prompt.
    await new Promise((r) => setTimeout(r, 5));
    replyTo(proc, 'initialize', { protocolVersion: 1, agentCapabilities: {} });

    await new Promise((r) => setTimeout(r, 5));
    replyTo(proc, 'session/new', { sessionId: 'sess-123' });

    await new Promise((r) => setTimeout(r, 5));
    const lines = sentLines(proc);
    const bootstrap = lines.find(
      (l) => l.method === 'session/prompt' && l.params?.prompt?.[0]?.text === '/tools trust-all',
    );
    expect(bootstrap).toBeDefined();
    replyTo(proc, 'session/prompt', { stopReason: 'end_turn' });

    const sessionId = await sessionPromise;
    expect(sessionId).toBe('sess-123');

    client.close();
  });

  test('skipTrustAll opt suppresses the bootstrap', async () => {
    const proc = new FakeProc();
    const client = new KiroAcpClient({ cwd: '/tmp', _proc: proc as any });

    const sessionPromise = client.newSession({ cwd: '/tmp', skipTrustAll: true });
    await new Promise((r) => setTimeout(r, 5));
    replyTo(proc, 'initialize', { protocolVersion: 1, agentCapabilities: {} });
    await new Promise((r) => setTimeout(r, 5));
    replyTo(proc, 'session/new', { sessionId: 'sess-skip' });

    const sessionId = await sessionPromise;
    expect(sessionId).toBe('sess-skip');

    const promptCalls = sentLines(proc).filter((l) => l.method === 'session/prompt');
    expect(promptCalls).toHaveLength(0);

    client.close();
  });

  test('bootstrap failure does not block session creation', async () => {
    // Worst case: Kiro rejects /tools trust-all (different version, missing
    // feature, etc). newSession should still return the sessionId and let
    // the user proceed — they'll just hit the hang on the first tool call,
    // which is the same state they would have been in without the bootstrap.
    const proc = new FakeProc();
    const client = new KiroAcpClient({ cwd: '/tmp', _proc: proc as any });

    const sessionPromise = client.newSession({ cwd: '/tmp' });
    await new Promise((r) => setTimeout(r, 5));
    replyTo(proc, 'initialize', { protocolVersion: 1, agentCapabilities: {} });
    await new Promise((r) => setTimeout(r, 5));
    replyTo(proc, 'session/new', { sessionId: 'sess-err' });
    await new Promise((r) => setTimeout(r, 5));
    // Reply to the bootstrap prompt with a JSON-RPC error.
    const lines = sentLines(proc);
    const bootstrap = lines.find((l) => l.method === 'session/prompt');
    expect(bootstrap).toBeDefined();
    proc.stdout.emit(
      'data',
      Buffer.from(
        JSON.stringify({
          jsonrpc: '2.0',
          id: bootstrap!.id,
          error: { code: -32601, message: 'trust-all not supported' },
        }) + '\n',
      ),
    );

    const sessionId = await sessionPromise;
    expect(sessionId).toBe('sess-err'); // success — degraded but functional

    client.close();
  });
});
