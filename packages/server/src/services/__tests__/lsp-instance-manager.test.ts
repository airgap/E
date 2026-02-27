import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { resolve } from 'path';

import { LspInstanceManager, createLspParser, encodeLspMessage } from '../lsp-instance-manager';
import type { LspClient, LspInstanceInfo } from '../lsp-instance-manager';

// ---------------------------------------------------------------------------
// Helpers — mock LSP process and command resolution
// ---------------------------------------------------------------------------

/** Creates a minimal mock stdin writable with a write recorder. */
function makeMockStdin() {
  const written: string[] = [];
  return {
    written,
    write(data: string) {
      written.push(data);
    },
  };
}

/** Creates a mock stdout ReadableStream that can be pushed to. */
function makeMockStdout() {
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      controller = ctrl;
    },
  });
  return {
    stream,
    push(text: string) {
      controller.enqueue(new TextEncoder().encode(text));
    },
    close() {
      try {
        controller.close();
      } catch {
        // may already be closed
      }
    },
  };
}

/** Creates a mock stderr ReadableStream. */
function makeMockStderr() {
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      controller = ctrl;
    },
  });
  return {
    stream,
    push(text: string) {
      controller.enqueue(new TextEncoder().encode(text));
    },
    close() {
      try {
        controller.close();
      } catch {
        // may already be closed
      }
    },
  };
}

/** Creates a mock LSP process. */
function makeMockProcess() {
  const stdin = makeMockStdin();
  const stdout = makeMockStdout();
  const stderr = makeMockStderr();
  let killed = false;

  return {
    proc: {
      stdin,
      stdout: stdout.stream,
      stderr: stderr.stream,
      kill() {
        killed = true;
      },
    },
    stdin,
    stdout,
    stderr,
    isKilled: () => killed,
  };
}

/** Creates a mock spawnFn that returns controlled mock processes. */
function makeMockSpawn() {
  const calls: Array<{ args: string[]; opts: any }> = [];
  const processes: ReturnType<typeof makeMockProcess>[] = [];

  const spawnFn = (args: string[], opts: any) => {
    const mp = makeMockProcess();
    calls.push({ args, opts });
    processes.push(mp);
    return mp.proc;
  };

  return { spawnFn, calls, processes };
}

/** Creates a mock getLspCommand function that knows about specified languages. */
function makeMockGetLspCommand(
  languages: string[] = ['typescript', 'python', 'rust', 'go', 'css'],
) {
  return (language: string) => {
    if (languages.includes(language)) {
      return { command: `${language}-language-server`, args: ['--stdio'] };
    }
    return null;
  };
}

/** Creates a mock LspClient. */
function makeMockClient(id?: string): LspClient & { received: string[] } {
  const received: string[] = [];
  return {
    id: id ?? `client-${Math.random().toString(36).slice(2, 8)}`,
    send(data: string) {
      received.push(data);
    },
    received,
  };
}

// ---------------------------------------------------------------------------
// Tests: createLspParser
// ---------------------------------------------------------------------------

describe('createLspParser', () => {
  // Verifies that a single well-formed Content-Length message is parsed correctly.
  test('parses a single LSP JSON-RPC message', () => {
    const messages: any[] = [];
    const parser = createLspParser((msg) => messages.push(msg));

    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    const raw = `Content-Length: ${Buffer.byteLength(body, 'utf-8')}\r\n\r\n${body}`;

    parser.feed(raw);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ jsonrpc: '2.0', id: 1, method: 'initialize' });
  });

  // Verifies that multiple messages concatenated in a single chunk are all extracted.
  test('parses multiple messages in a single chunk', () => {
    const messages: any[] = [];
    const parser = createLspParser((msg) => messages.push(msg));

    const msg1 = JSON.stringify({ id: 1 });
    const msg2 = JSON.stringify({ id: 2 });
    const raw =
      `Content-Length: ${Buffer.byteLength(msg1)}\r\n\r\n${msg1}` +
      `Content-Length: ${Buffer.byteLength(msg2)}\r\n\r\n${msg2}`;

    parser.feed(raw);

    expect(messages).toHaveLength(2);
    expect(messages[0].id).toBe(1);
    expect(messages[1].id).toBe(2);
  });

  // Verifies that the parser correctly handles data arriving in arbitrary chunks.
  test('handles data split across multiple feed() calls', () => {
    const messages: any[] = [];
    const parser = createLspParser((msg) => messages.push(msg));

    const body = JSON.stringify({ jsonrpc: '2.0', id: 42 });
    const raw = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;

    // Split at an arbitrary point mid-header
    parser.feed(raw.slice(0, 10));
    expect(messages).toHaveLength(0);
    parser.feed(raw.slice(10));
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe(42);
  });

  // Ensures malformed JSON doesn't crash the parser — it's silently skipped.
  test('skips malformed JSON bodies without crashing', () => {
    const messages: any[] = [];
    const parser = createLspParser((msg) => messages.push(msg));

    const badBody = '{not valid json';
    const raw = `Content-Length: ${Buffer.byteLength(badBody)}\r\n\r\n${badBody}`;

    parser.feed(raw);
    expect(messages).toHaveLength(0);
  });

  // Ensures missing Content-Length header is gracefully handled.
  test('skips headers without Content-Length', () => {
    const messages: any[] = [];
    const parser = createLspParser((msg) => messages.push(msg));

    parser.feed('Some-Other-Header: value\r\n\r\n');
    expect(messages).toHaveLength(0);
  });

  // Verifies that after bad data, subsequent valid messages are still parsed.
  test('recovers after skipping bad header and parses subsequent valid messages', () => {
    const messages: any[] = [];
    const parser = createLspParser((msg) => messages.push(msg));

    // Feed a bad header followed by a good message
    const body = JSON.stringify({ id: 99 });
    const raw = `Bad-Header: nope\r\n\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;

    parser.feed(raw);
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe(99);
  });
});

// ---------------------------------------------------------------------------
// Tests: encodeLspMessage
// ---------------------------------------------------------------------------

describe('encodeLspMessage', () => {
  // Verifies the Content-Length header is correctly computed and formatted.
  test('encodes a message with correct Content-Length header', () => {
    const msg = { jsonrpc: '2.0', id: 1, method: 'test' };
    const encoded = encodeLspMessage(msg);

    const body = JSON.stringify(msg);
    expect(encoded).toBe(`Content-Length: ${Buffer.byteLength(body, 'utf-8')}\r\n\r\n${body}`);
  });

  // Verifies Content-Length handles multi-byte characters correctly (byte length ≠ char length).
  test('handles multi-byte characters correctly', () => {
    const msg = { text: '日本語テスト' };
    const encoded = encodeLspMessage(msg);

    const body = JSON.stringify(msg);
    const byteLength = Buffer.byteLength(body, 'utf-8');
    expect(encoded.startsWith(`Content-Length: ${byteLength}\r\n\r\n`)).toBe(true);
  });

  // Round-trip: encode then parse should yield the original message.
  test('round-trips with createLspParser', () => {
    const original = { jsonrpc: '2.0', id: 5, result: { capabilities: {} } };
    const encoded = encodeLspMessage(original);

    const messages: any[] = [];
    const parser = createLspParser((msg) => messages.push(msg));
    parser.feed(encoded);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// Tests: LspInstanceManager — makeKey
// ---------------------------------------------------------------------------

describe('LspInstanceManager.makeKey', () => {
  // Verifies composite key format uses resolved absolute paths.
  test('creates composite key from language and resolved rootPath', () => {
    const manager = new LspInstanceManager({ spawnFn: () => ({}), getLspCommandFn: () => null });
    const key = manager.makeKey('typescript', '/home/user/project');
    expect(key).toBe(`typescript:${resolve('/home/user/project')}`);
  });

  // Verifies that relative paths are resolved to the same absolute path.
  test('resolves relative paths to absolute', () => {
    const manager = new LspInstanceManager({ spawnFn: () => ({}), getLspCommandFn: () => null });
    const key1 = manager.makeKey('typescript', '.');
    const key2 = manager.makeKey('typescript', resolve('.'));
    expect(key1).toBe(key2);
  });

  // Different languages on the same root produce different keys.
  test('different languages produce different keys for same root', () => {
    const manager = new LspInstanceManager({ spawnFn: () => ({}), getLspCommandFn: () => null });
    const k1 = manager.makeKey('typescript', '/project');
    const k2 = manager.makeKey('python', '/project');
    expect(k1).not.toBe(k2);
  });

  // Same language on different roots produce different keys.
  test('same language produces different keys for different roots', () => {
    const manager = new LspInstanceManager({ spawnFn: () => ({}), getLspCommandFn: () => null });
    const k1 = manager.makeKey('typescript', '/project-a');
    const k2 = manager.makeKey('typescript', '/project-b');
    expect(k1).not.toBe(k2);
  });
});

// ---------------------------------------------------------------------------
// Tests: LspInstanceManager — connect (lazy start, reuse, keying)
// ---------------------------------------------------------------------------

describe('LspInstanceManager.connect', () => {
  let spawn: ReturnType<typeof makeMockSpawn>;
  let manager: LspInstanceManager;

  beforeEach(() => {
    spawn = makeMockSpawn();
    manager = new LspInstanceManager({
      maxInstances: 20,
      spawnFn: spawn.spawnFn,
      getLspCommandFn: makeMockGetLspCommand(),
    });
  });

  // AC1/AC4: First connection triggers lazy spawn with (language, rootPath) key.
  test('lazy-starts an LSP process on first connect', () => {
    const client = makeMockClient();
    const instance = manager.connect('typescript', '/project', client);

    expect(instance).not.toBeNull();
    expect(instance!.language).toBe('typescript');
    expect(instance!.rootPath).toBe(resolve('/project'));
    expect(spawn.calls).toHaveLength(1);
  });

  // AC2: Worktree rootPath spawns LSP in the worktree directory.
  test('spawns LSP process with cwd set to resolved rootPath', () => {
    const client = makeMockClient();
    manager.connect('typescript', '/project/.e/worktrees/story-1', client);

    expect(spawn.calls).toHaveLength(1);
    expect(spawn.calls[0].opts.cwd).toBe(resolve('/project/.e/worktrees/story-1'));
  });

  // AC2: Spawns with correct command and args from getLspCommand.
  test('spawns with correct command and args', () => {
    const client = makeMockClient();
    manager.connect('typescript', '/project', client);

    expect(spawn.calls[0].args).toEqual(['typescript-language-server', '--stdio']);
  });

  // Spawns with stdin/stdout/stderr pipes for communication.
  test('spawns with pipe stdio options', () => {
    const client = makeMockClient();
    manager.connect('typescript', '/project', client);

    expect(spawn.calls[0].opts.stdin).toBe('pipe');
    expect(spawn.calls[0].opts.stdout).toBe('pipe');
    expect(spawn.calls[0].opts.stderr).toBe('pipe');
  });

  // AC3: Second connect with same (language, rootPath) reuses the existing instance.
  test('reuses existing instance for same (language, rootPath)', () => {
    const client1 = makeMockClient('c1');
    const client2 = makeMockClient('c2');

    const inst1 = manager.connect('typescript', '/project', client1);
    const inst2 = manager.connect('typescript', '/project', client2);

    expect(inst1).toBe(inst2);
    expect(spawn.calls).toHaveLength(1); // Only one spawn
    expect(inst2!.clients.size).toBe(2);
  });

  // AC1: Different rootPaths get separate instances (worktree isolation).
  test('creates separate instances for different rootPaths', () => {
    const client1 = makeMockClient('c1');
    const client2 = makeMockClient('c2');

    const inst1 = manager.connect('typescript', '/project', client1);
    const inst2 = manager.connect('typescript', '/project/.e/worktrees/story-1', client2);

    expect(inst1).not.toBe(inst2);
    expect(spawn.calls).toHaveLength(2);
    expect(inst1!.rootPath).toBe(resolve('/project'));
    expect(inst2!.rootPath).toBe(resolve('/project/.e/worktrees/story-1'));
  });

  // Different languages on the same root get separate instances.
  test('creates separate instances for different languages on same root', () => {
    const client1 = makeMockClient('c1');
    const client2 = makeMockClient('c2');

    const inst1 = manager.connect('typescript', '/project', client1);
    const inst2 = manager.connect('python', '/project', client2);

    expect(inst1).not.toBe(inst2);
    expect(spawn.calls).toHaveLength(2);
  });

  // Returns null for unsupported languages.
  test('returns null for unsupported language', () => {
    const client = makeMockClient();
    const instance = manager.connect('cobol', '/project', client);

    expect(instance).toBeNull();
    expect(spawn.calls).toHaveLength(0);
  });

  // Records client in the instance's client map.
  test('adds client to instance client map', () => {
    const client = makeMockClient('my-client');
    const instance = manager.connect('typescript', '/project', client);

    expect(instance!.clients.has('my-client')).toBe(true);
    expect(instance!.clients.get('my-client')).toBe(client);
  });

  // Sets lastAccessed timestamp on connect.
  test('sets lastAccessed timestamp on connect', () => {
    const before = Date.now();
    const client = makeMockClient();
    const instance = manager.connect('typescript', '/project', client);
    const after = Date.now();

    expect(instance!.lastAccessed).toBeGreaterThanOrEqual(before);
    expect(instance!.lastAccessed).toBeLessThanOrEqual(after);
  });

  // Updates lastAccessed on reconnect to existing instance.
  test('updates lastAccessed on reconnect to existing instance', async () => {
    const client1 = makeMockClient('c1');
    const inst1 = manager.connect('typescript', '/project', client1);
    const firstAccess = inst1!.lastAccessed;

    // Small delay to ensure different timestamp
    await new Promise((r) => setTimeout(r, 5));

    const client2 = makeMockClient('c2');
    manager.connect('typescript', '/project', client2);

    expect(inst1!.lastAccessed).toBeGreaterThan(firstAccess);
  });

  // Dead instances are cleaned up and a new one is spawned.
  test('replaces dead instance with fresh spawn', () => {
    const client1 = makeMockClient('c1');
    const inst = manager.connect('typescript', '/project', client1);

    // Manually mark as dead (simulating process exit)
    inst!.dead = true;

    const client2 = makeMockClient('c2');
    const inst2 = manager.connect('typescript', '/project', client2);

    expect(inst2).not.toBe(inst);
    expect(inst2!.dead).toBe(false);
    expect(spawn.calls).toHaveLength(2);
  });

  // Handles spawn failure gracefully by returning null.
  test('returns null when spawn throws', () => {
    const failManager = new LspInstanceManager({
      spawnFn: () => {
        throw new Error('spawn ENOENT');
      },
      getLspCommandFn: makeMockGetLspCommand(),
    });

    const client = makeMockClient();
    const instance = failManager.connect('typescript', '/project', client);

    expect(instance).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: LspInstanceManager — sendToLsp
// ---------------------------------------------------------------------------

describe('LspInstanceManager.sendToLsp', () => {
  let spawn: ReturnType<typeof makeMockSpawn>;
  let manager: LspInstanceManager;

  beforeEach(() => {
    spawn = makeMockSpawn();
    manager = new LspInstanceManager({
      spawnFn: spawn.spawnFn,
      getLspCommandFn: makeMockGetLspCommand(),
    });
  });

  // Verifies JSON-RPC messages are encoded and written to the process stdin.
  test('writes encoded LSP message to process stdin', () => {
    const client = makeMockClient();
    manager.connect('typescript', '/project', client);

    const msg = { jsonrpc: '2.0', id: 1, method: 'textDocument/completion' };
    const sent = manager.sendToLsp('typescript', '/project', msg);

    expect(sent).toBe(true);
    const proc = spawn.processes[0];
    expect(proc.stdin.written).toHaveLength(1);
    expect(proc.stdin.written[0]).toBe(encodeLspMessage(msg));
  });

  // Updates lastAccessed timestamp on message send.
  test('updates lastAccessed on send', async () => {
    const client = makeMockClient();
    const inst = manager.connect('typescript', '/project', client);
    const firstAccess = inst!.lastAccessed;

    await new Promise((r) => setTimeout(r, 5));
    manager.sendToLsp('typescript', '/project', { id: 1 });

    expect(inst!.lastAccessed).toBeGreaterThan(firstAccess);
  });

  // Returns false when no instance exists for the given key.
  test('returns false for non-existent instance', () => {
    const result = manager.sendToLsp('typescript', '/nonexistent', { id: 1 });
    expect(result).toBe(false);
  });

  // Returns false when the instance is dead.
  test('returns false for dead instance', () => {
    const client = makeMockClient();
    const inst = manager.connect('typescript', '/project', client);
    inst!.dead = true;

    const result = manager.sendToLsp('typescript', '/project', { id: 1 });
    expect(result).toBe(false);
  });

  // Handles stdin.write throwing by returning false.
  test('returns false when stdin.write throws', () => {
    const throwManager = new LspInstanceManager({
      spawnFn: () => ({
        stdin: {
          write() {
            throw new Error('broken pipe');
          },
        },
        stdout: new ReadableStream(),
        stderr: new ReadableStream(),
      }),
      getLspCommandFn: makeMockGetLspCommand(),
    });

    const client = makeMockClient();
    throwManager.connect('typescript', '/project', client);

    const result = throwManager.sendToLsp('typescript', '/project', { id: 1 });
    expect(result).toBe(false);
  });

  // Returns false when stdin is a file descriptor number (not writable).
  test('returns false when stdin is a number (fd)', () => {
    const fdManager = new LspInstanceManager({
      spawnFn: () => ({
        stdin: 3, // file descriptor number
        stdout: new ReadableStream(),
        stderr: new ReadableStream(),
      }),
      getLspCommandFn: makeMockGetLspCommand(),
    });

    const client = makeMockClient();
    fdManager.connect('typescript', '/project', client);

    const result = fdManager.sendToLsp('typescript', '/project', { id: 1 });
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: LspInstanceManager — disconnect
// ---------------------------------------------------------------------------

describe('LspInstanceManager.disconnect', () => {
  let spawn: ReturnType<typeof makeMockSpawn>;
  let manager: LspInstanceManager;

  beforeEach(() => {
    spawn = makeMockSpawn();
    manager = new LspInstanceManager({
      spawnFn: spawn.spawnFn,
      getLspCommandFn: makeMockGetLspCommand(),
    });
  });

  // Removes the client from the instance's client map.
  test('removes client from instance', () => {
    const client = makeMockClient('my-client');
    const inst = manager.connect('typescript', '/project', client);

    manager.disconnect('typescript', '/project', 'my-client');

    expect(inst!.clients.has('my-client')).toBe(false);
    expect(inst!.clients.size).toBe(0);
  });

  // Instance stays alive after all clients disconnect (for LRU reuse).
  test('keeps instance alive after last client disconnects', () => {
    const client = makeMockClient('c1');
    manager.connect('typescript', '/project', client);

    manager.disconnect('typescript', '/project', 'c1');

    // Instance should still exist and not be dead
    const inst = manager.getInstance('typescript', '/project');
    expect(inst).not.toBeNull();
    expect(inst!.dead).toBe(false);
  });

  // Disconnecting a non-existent client is a no-op.
  test('no-op for non-existent client', () => {
    const client = makeMockClient('real');
    manager.connect('typescript', '/project', client);

    // Disconnect a client that was never connected — should not throw
    manager.disconnect('typescript', '/project', 'fake-client');
    expect(manager.getInstance('typescript', '/project')!.clients.size).toBe(1);
  });

  // Disconnecting from a non-existent instance is a no-op.
  test('no-op for non-existent instance', () => {
    // Should not throw
    manager.disconnect('typescript', '/nonexistent', 'any-client');
  });
});

// ---------------------------------------------------------------------------
// Tests: LspInstanceManager — shutdownForRoot
// ---------------------------------------------------------------------------

describe('LspInstanceManager.shutdownForRoot', () => {
  let spawn: ReturnType<typeof makeMockSpawn>;
  let manager: LspInstanceManager;

  beforeEach(() => {
    spawn = makeMockSpawn();
    manager = new LspInstanceManager({
      spawnFn: spawn.spawnFn,
      getLspCommandFn: makeMockGetLspCommand(),
    });
  });

  // AC5: shutdownForRoot stops all instances sharing a rootPath.
  test('shuts down all instances for the given rootPath', () => {
    const c1 = makeMockClient('c1');
    const c2 = makeMockClient('c2');

    manager.connect('typescript', '/worktree-a', c1);
    manager.connect('python', '/worktree-a', c2);

    const count = manager.shutdownForRoot('/worktree-a');

    expect(count).toBe(2);
    expect(manager.getInstance('typescript', '/worktree-a')).toBeNull();
    expect(manager.getInstance('python', '/worktree-a')).toBeNull();
  });

  // AC8: Main workspace LSP is unaffected when worktree is shut down.
  test('does not affect instances on other roots', () => {
    const c1 = makeMockClient('c1');
    const c2 = makeMockClient('c2');
    const c3 = makeMockClient('c3');

    manager.connect('typescript', '/main-project', c1);
    manager.connect('typescript', '/worktree-a', c2);
    manager.connect('python', '/worktree-a', c3);

    const count = manager.shutdownForRoot('/worktree-a');

    expect(count).toBe(2);
    // Main project instance should still be alive
    const mainInst = manager.getInstance('typescript', '/main-project');
    expect(mainInst).not.toBeNull();
    expect(mainInst!.dead).toBe(false);
  });

  // Returns 0 when no instances match the rootPath.
  test('returns 0 when no instances match', () => {
    const c = makeMockClient();
    manager.connect('typescript', '/project-a', c);

    const count = manager.shutdownForRoot('/nonexistent');
    expect(count).toBe(0);
  });

  // Resolves paths so that equivalent paths are matched.
  test('resolves rootPath for matching', () => {
    const c = makeMockClient();
    manager.connect('typescript', '/project/./subdir/..', c);

    const count = manager.shutdownForRoot('/project');
    expect(count).toBe(1);
  });

  // Clears clients on shutdown.
  test('clears clients on shutdown', () => {
    const c1 = makeMockClient('c1');
    const c2 = makeMockClient('c2');
    const inst = manager.connect('typescript', '/project', c1);
    manager.connect('typescript', '/project', c2);

    expect(inst!.clients.size).toBe(2);

    manager.shutdownForRoot('/project');

    expect(inst!.clients.size).toBe(0);
    expect(inst!.dead).toBe(true);
  });

  // AC6: Verifies shutdownForRoot sends proper LSP shutdown sequence.
  test('sends LSP shutdown+exit sequence to process stdin', async () => {
    const c = makeMockClient();
    manager.connect('typescript', '/project', c);
    const proc = spawn.processes[0];

    manager.shutdownForRoot('/project');

    // The shutdown method writes to stdin synchronously
    expect(proc.stdin.written.length).toBeGreaterThanOrEqual(1);

    // First write should be the shutdown request
    const shutdownMsg = proc.stdin.written[0];
    expect(shutdownMsg).toContain('"method":"shutdown"');
  });
});

// ---------------------------------------------------------------------------
// Tests: LspInstanceManager — shutdownAll
// ---------------------------------------------------------------------------

describe('LspInstanceManager.shutdownAll', () => {
  // Shuts down every managed instance regardless of root.
  test('shuts down all instances across all roots', () => {
    const spawn = makeMockSpawn();
    const manager = new LspInstanceManager({
      spawnFn: spawn.spawnFn,
      getLspCommandFn: makeMockGetLspCommand(),
    });

    manager.connect('typescript', '/project-a', makeMockClient('c1'));
    manager.connect('python', '/project-b', makeMockClient('c2'));
    manager.connect('rust', '/project-c', makeMockClient('c3'));

    expect(manager.getStats().total).toBe(3);

    manager.shutdownAll();

    expect(manager.getStats().total).toBe(0);
    expect(manager.getInstance('typescript', '/project-a')).toBeNull();
    expect(manager.getInstance('python', '/project-b')).toBeNull();
    expect(manager.getInstance('rust', '/project-c')).toBeNull();
  });

  // No-op on empty manager.
  test('no-op when no instances exist', () => {
    const manager = new LspInstanceManager({
      spawnFn: () => ({}),
      getLspCommandFn: makeMockGetLspCommand(),
    });

    manager.shutdownAll();
    expect(manager.getStats().total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: LspInstanceManager — getInstance
// ---------------------------------------------------------------------------

describe('LspInstanceManager.getInstance', () => {
  // Returns instance without spawning when it exists.
  test('returns existing instance without spawning', () => {
    const spawn = makeMockSpawn();
    const manager = new LspInstanceManager({
      spawnFn: spawn.spawnFn,
      getLspCommandFn: makeMockGetLspCommand(),
    });

    const client = makeMockClient();
    const connected = manager.connect('typescript', '/project', client);
    const retrieved = manager.getInstance('typescript', '/project');

    expect(retrieved).toBe(connected);
  });

  // Returns null when no instance exists (does not create one).
  test('returns null when no instance exists (does NOT lazy-start)', () => {
    const spawn = makeMockSpawn();
    const manager = new LspInstanceManager({
      spawnFn: spawn.spawnFn,
      getLspCommandFn: makeMockGetLspCommand(),
    });

    const instance = manager.getInstance('typescript', '/project');
    expect(instance).toBeNull();
    expect(spawn.calls).toHaveLength(0);
  });

  // Returns null for dead instances.
  test('returns null for dead instance', () => {
    const spawn = makeMockSpawn();
    const manager = new LspInstanceManager({
      spawnFn: spawn.spawnFn,
      getLspCommandFn: makeMockGetLspCommand(),
    });

    const client = makeMockClient();
    const inst = manager.connect('typescript', '/project', client);
    inst!.dead = true;

    expect(manager.getInstance('typescript', '/project')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: LspInstanceManager — getStats
// ---------------------------------------------------------------------------

describe('LspInstanceManager.getStats', () => {
  // Reports correct totals, active/idle counts, and byRoot breakdown.
  test('reports correct stats', () => {
    const spawn = makeMockSpawn();
    const manager = new LspInstanceManager({
      spawnFn: spawn.spawnFn,
      getLspCommandFn: makeMockGetLspCommand(),
    });

    const c1 = makeMockClient('c1');
    const c2 = makeMockClient('c2');
    const c3 = makeMockClient('c3');

    manager.connect('typescript', '/project-a', c1);
    manager.connect('python', '/project-a', c2);
    manager.connect('rust', '/project-b', c3);

    // Disconnect one client to make it idle
    manager.disconnect('rust', '/project-b', 'c3');

    const stats = manager.getStats();
    expect(stats.total).toBe(3);
    expect(stats.active).toBe(2);
    expect(stats.idle).toBe(1);

    const resolvedA = resolve('/project-a');
    const resolvedB = resolve('/project-b');
    expect(stats.byRoot[resolvedA]).toEqual(expect.arrayContaining(['typescript', 'python']));
    expect(stats.byRoot[resolvedA]).toHaveLength(2);
    expect(stats.byRoot[resolvedB]).toEqual(['rust']);
  });

  // Empty manager returns zero counts.
  test('returns empty stats when no instances', () => {
    const manager = new LspInstanceManager({
      spawnFn: () => ({}),
      getLspCommandFn: makeMockGetLspCommand(),
    });

    const stats = manager.getStats();
    expect(stats.total).toBe(0);
    expect(stats.active).toBe(0);
    expect(stats.idle).toBe(0);
    expect(Object.keys(stats.byRoot)).toHaveLength(0);
  });

  // Dead instances are excluded from stats (they shouldn't inflate counts).
  test('excludes dead instances from stats', () => {
    const spawn = makeMockSpawn();
    const manager = new LspInstanceManager({
      spawnFn: spawn.spawnFn,
      getLspCommandFn: makeMockGetLspCommand(),
    });

    const c = makeMockClient();
    const inst = manager.connect('typescript', '/project', c);
    inst!.dead = true;

    const stats = manager.getStats();
    // Dead instances are still in the map but should not count as active or idle
    expect(stats.active).toBe(0);
    expect(stats.idle).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: LspInstanceManager — LRU eviction
// ---------------------------------------------------------------------------

describe('LspInstanceManager — LRU eviction', () => {
  // AC7: When at max capacity, the least recently used idle instance is evicted.
  test('evicts LRU idle instance when at max capacity', () => {
    const spawn = makeMockSpawn();
    const manager = new LspInstanceManager({
      maxInstances: 3,
      spawnFn: spawn.spawnFn,
      getLspCommandFn: makeMockGetLspCommand(),
    });

    // Fill to capacity with 3 instances — disconnect the first to make it idle
    const c1 = makeMockClient('c1');
    const c2 = makeMockClient('c2');
    const c3 = makeMockClient('c3');

    manager.connect('typescript', '/project-1', c1);
    manager.connect('python', '/project-2', c2);
    manager.connect('rust', '/project-3', c3);

    // Disconnect client 1 to make it idle (LRU candidate)
    manager.disconnect('typescript', '/project-1', 'c1');

    // Now try to create a 4th — should evict the idle instance
    const c4 = makeMockClient('c4');
    const inst4 = manager.connect('go', '/project-4', c4);

    expect(inst4).not.toBeNull();
    expect(manager.getInstance('typescript', '/project-1')).toBeNull(); // evicted
    expect(manager.getInstance('python', '/project-2')).not.toBeNull();
    expect(manager.getInstance('rust', '/project-3')).not.toBeNull();
    expect(manager.getInstance('go', '/project-4')).not.toBeNull();
  });

  // AC7: Among idle instances, the oldest (LRU) is evicted.
  test('evicts the oldest idle instance (by lastAccessed)', async () => {
    const spawn = makeMockSpawn();
    const manager = new LspInstanceManager({
      maxInstances: 3,
      spawnFn: spawn.spawnFn,
      getLspCommandFn: makeMockGetLspCommand(),
    });

    // Create 3 instances; disconnect all to make them idle
    const c1 = makeMockClient('c1');
    const c2 = makeMockClient('c2');
    const c3 = makeMockClient('c3');

    manager.connect('typescript', '/p1', c1);
    await new Promise((r) => setTimeout(r, 5));
    manager.connect('python', '/p2', c2);
    await new Promise((r) => setTimeout(r, 5));
    manager.connect('rust', '/p3', c3);

    // All idle
    manager.disconnect('typescript', '/p1', 'c1');
    manager.disconnect('python', '/p2', 'c2');
    manager.disconnect('rust', '/p3', 'c3');

    // Touch python to make it more recent
    const c2b = makeMockClient('c2b');
    manager.connect('python', '/p2', c2b);
    manager.disconnect('python', '/p2', 'c2b');

    // Add new instance — should evict typescript (oldest idle)
    const c4 = makeMockClient('c4');
    manager.connect('go', '/p4', c4);

    expect(manager.getInstance('typescript', '/p1')).toBeNull(); // evicted (oldest)
    expect(manager.getInstance('python', '/p2')).not.toBeNull();
    expect(manager.getInstance('rust', '/p3')).not.toBeNull();
    expect(manager.getInstance('go', '/p4')).not.toBeNull();
  });

  // When no idle instances exist, the oldest active instance is force-evicted.
  test('evicts oldest active instance when no idle instances exist', async () => {
    const spawn = makeMockSpawn();
    const manager = new LspInstanceManager({
      maxInstances: 3,
      spawnFn: spawn.spawnFn,
      getLspCommandFn: makeMockGetLspCommand(),
    });

    // Create 3 active instances (all have clients connected)
    manager.connect('typescript', '/p1', makeMockClient('c1'));
    await new Promise((r) => setTimeout(r, 5));
    manager.connect('python', '/p2', makeMockClient('c2'));
    await new Promise((r) => setTimeout(r, 5));
    manager.connect('rust', '/p3', makeMockClient('c3'));

    // None are idle — oldest active (typescript) should be force-evicted
    const c4 = makeMockClient('c4');
    const inst = manager.connect('go', '/p4', c4);

    expect(inst).not.toBeNull();
    expect(manager.getInstance('typescript', '/p1')).toBeNull(); // force-evicted
    expect(manager.getInstance('python', '/p2')).not.toBeNull();
    expect(manager.getInstance('rust', '/p3')).not.toBeNull();
  });

  // Verifies the default max instance count is 20.
  test('default max instances is 20', () => {
    const manager = new LspInstanceManager({
      spawnFn: () => makeMockProcess().proc,
      getLspCommandFn: makeMockGetLspCommand(),
    });

    expect(manager._testHelpers.getMaxInstances()).toBe(20);
  });

  // Respects custom maxInstances configuration.
  test('respects custom maxInstances', () => {
    const manager = new LspInstanceManager({
      maxInstances: 5,
      spawnFn: () => makeMockProcess().proc,
      getLspCommandFn: makeMockGetLspCommand(),
    });

    expect(manager._testHelpers.getMaxInstances()).toBe(5);
  });

  // AC7: Max 20 total limit is enforced (fill to capacity then trigger eviction).
  test('enforces capacity limit with eviction', () => {
    const languages = [
      'typescript',
      'python',
      'rust',
      'go',
      'css',
      'typescript',
      'python',
      'rust',
      'go',
      'css',
    ];
    const spawn = makeMockSpawn();
    const manager = new LspInstanceManager({
      maxInstances: 5,
      spawnFn: spawn.spawnFn,
      getLspCommandFn: makeMockGetLspCommand(),
    });

    // Fill to capacity: 5 instances on different roots
    for (let i = 0; i < 5; i++) {
      const c = makeMockClient(`c${i}`);
      manager.connect(languages[i], `/root-${i}`, c);
      manager.disconnect(languages[i], `/root-${i}`, `c${i}`); // make idle
    }

    expect(manager.getStats().total).toBe(5);

    // Create a 6th — should evict the LRU idle instance
    const c = makeMockClient('c-new');
    manager.connect('typescript', '/root-new', c);

    expect(manager.getStats().total).toBe(5); // still at capacity
  });
});

// ---------------------------------------------------------------------------
// Tests: Worktree-scoped lifecycle (integration-like scenarios)
// ---------------------------------------------------------------------------

describe('Worktree-scoped lifecycle scenarios', () => {
  let spawn: ReturnType<typeof makeMockSpawn>;
  let manager: LspInstanceManager;

  beforeEach(() => {
    spawn = makeMockSpawn();
    manager = new LspInstanceManager({
      maxInstances: 20,
      spawnFn: spawn.spawnFn,
      getLspCommandFn: makeMockGetLspCommand(),
    });
  });

  // AC8: Main workspace + worktree each get independent LSP instances.
  test('main workspace and worktree get independent LSP instances', () => {
    const mainClient = makeMockClient('main-client');
    const wtClient = makeMockClient('wt-client');

    const mainInst = manager.connect('typescript', '/project', mainClient);
    const wtInst = manager.connect('typescript', '/project/.e/worktrees/story-1', wtClient);

    expect(mainInst).not.toBe(wtInst);
    expect(mainInst!.rootPath).toBe(resolve('/project'));
    expect(wtInst!.rootPath).toBe(resolve('/project/.e/worktrees/story-1'));
  });

  // AC5/AC6: shutdownForRoot cleans up worktree LSP without affecting main.
  test('shutting down worktree LSP does not affect main workspace', () => {
    const mainClient = makeMockClient('main');
    const wtClient1 = makeMockClient('wt1');
    const wtClient2 = makeMockClient('wt2');

    manager.connect('typescript', '/project', mainClient);
    manager.connect('typescript', '/project/.e/worktrees/story-1', wtClient1);
    manager.connect('python', '/project/.e/worktrees/story-1', wtClient2);

    expect(manager.getStats().total).toBe(3);

    // Simulate worktree removal
    const removed = manager.shutdownForRoot('/project/.e/worktrees/story-1');

    expect(removed).toBe(2);
    expect(manager.getStats().total).toBe(1);
    expect(manager.getInstance('typescript', '/project')).not.toBeNull();
    expect(manager.getInstance('typescript', '/project/.e/worktrees/story-1')).toBeNull();
    expect(manager.getInstance('python', '/project/.e/worktrees/story-1')).toBeNull();
  });

  // Multiple worktrees can coexist with distinct instances.
  test('multiple worktrees coexist with separate instances', () => {
    const c1 = makeMockClient('c1');
    const c2 = makeMockClient('c2');
    const c3 = makeMockClient('c3');

    const wt1 = manager.connect('typescript', '/project/.e/worktrees/story-1', c1);
    const wt2 = manager.connect('typescript', '/project/.e/worktrees/story-2', c2);
    const wt3 = manager.connect('typescript', '/project/.e/worktrees/story-3', c3);

    expect(wt1).not.toBe(wt2);
    expect(wt2).not.toBe(wt3);
    expect(manager.getStats().total).toBe(3);

    // Shut down one worktree — others unaffected
    manager.shutdownForRoot('/project/.e/worktrees/story-2');

    expect(manager.getInstance('typescript', '/project/.e/worktrees/story-1')).not.toBeNull();
    expect(manager.getInstance('typescript', '/project/.e/worktrees/story-2')).toBeNull();
    expect(manager.getInstance('typescript', '/project/.e/worktrees/story-3')).not.toBeNull();
  });

  // Full lifecycle: connect → send → disconnect → shutdown.
  test('full lifecycle: connect → send → disconnect → shutdownForRoot', () => {
    const client = makeMockClient('user');

    // 1. Connect (lazy start)
    const inst = manager.connect('typescript', '/project/.e/worktrees/my-story', client);
    expect(inst).not.toBeNull();
    expect(spawn.calls).toHaveLength(1);

    // 2. Send a message
    const sent = manager.sendToLsp('typescript', '/project/.e/worktrees/my-story', {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
    });
    expect(sent).toBe(true);

    // 3. Disconnect client
    manager.disconnect('typescript', '/project/.e/worktrees/my-story', 'user');
    expect(inst!.clients.size).toBe(0);
    // Instance still alive for reuse
    expect(manager.getInstance('typescript', '/project/.e/worktrees/my-story')).not.toBeNull();

    // 4. Shutdown for root (worktree removal)
    const count = manager.shutdownForRoot('/project/.e/worktrees/my-story');
    expect(count).toBe(1);
    expect(manager.getInstance('typescript', '/project/.e/worktrees/my-story')).toBeNull();
  });

  // Reconnect to an idle instance reuses it (no new spawn).
  test('reconnecting to idle instance reuses it without new spawn', () => {
    const c1 = makeMockClient('c1');
    const inst1 = manager.connect('typescript', '/project', c1);
    manager.disconnect('typescript', '/project', 'c1');

    // Instance is idle — reconnect should reuse
    const c2 = makeMockClient('c2');
    const inst2 = manager.connect('typescript', '/project', c2);

    expect(inst2).toBe(inst1);
    expect(spawn.calls).toHaveLength(1); // No new spawn
    expect(inst2!.clients.size).toBe(1);
    expect(inst2!.clients.has('c2')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: _testHelpers
// ---------------------------------------------------------------------------

describe('LspInstanceManager._testHelpers', () => {
  // Test helpers expose internal state for test assertions.
  test('getInstances returns internal map', () => {
    const spawn = makeMockSpawn();
    const manager = new LspInstanceManager({
      spawnFn: spawn.spawnFn,
      getLspCommandFn: makeMockGetLspCommand(),
    });

    const instances = manager._testHelpers.getInstances();
    expect(instances).toBeInstanceOf(Map);
    expect(instances.size).toBe(0);

    manager.connect('typescript', '/project', makeMockClient());
    expect(instances.size).toBe(1);
  });

  // getMaxInstances returns the configured max.
  test('getMaxInstances returns configured max', () => {
    const manager = new LspInstanceManager({
      maxInstances: 42,
      spawnFn: () => ({}),
      getLspCommandFn: () => null,
    });

    expect(manager._testHelpers.getMaxInstances()).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// Tests: Shutdown graceful sequence
// ---------------------------------------------------------------------------

describe('LspInstanceManager — graceful shutdown', () => {
  // Verifies that shutdown sends JSON-RPC shutdown request to the process.
  test('shutdown sends shutdown method to stdin', () => {
    const spawn = makeMockSpawn();
    const manager = new LspInstanceManager({
      spawnFn: spawn.spawnFn,
      getLspCommandFn: makeMockGetLspCommand(),
    });

    const c = makeMockClient();
    manager.connect('typescript', '/project', c);

    manager.shutdownAll();

    const proc = spawn.processes[0];
    // Should have at least the shutdown message
    expect(proc.stdin.written.length).toBeGreaterThanOrEqual(1);
    const firstWrite = proc.stdin.written[0];
    expect(firstWrite).toContain('"method":"shutdown"');
    expect(firstWrite).toContain('"jsonrpc":"2.0"');
  });

  // Marks instance as dead after shutdown.
  test('marks instance as dead after shutdown', () => {
    const spawn = makeMockSpawn();
    const manager = new LspInstanceManager({
      spawnFn: spawn.spawnFn,
      getLspCommandFn: makeMockGetLspCommand(),
    });

    const c = makeMockClient();
    const inst = manager.connect('typescript', '/project', c);

    manager.shutdownAll();

    expect(inst!.dead).toBe(true);
  });

  // Handles missing stdin gracefully (does not throw).
  test('handles null stdin gracefully', () => {
    const manager = new LspInstanceManager({
      spawnFn: () => ({
        stdin: null,
        stdout: new ReadableStream(),
        stderr: new ReadableStream(),
        kill() {},
      }),
      getLspCommandFn: makeMockGetLspCommand(),
    });

    const c = makeMockClient();
    manager.connect('typescript', '/project', c);

    // Should not throw
    manager.shutdownAll();
  });

  // Double-shutdown is idempotent (does not throw).
  test('double shutdown is idempotent', () => {
    const spawn = makeMockSpawn();
    const manager = new LspInstanceManager({
      spawnFn: spawn.spawnFn,
      getLspCommandFn: makeMockGetLspCommand(),
    });

    const c = makeMockClient();
    manager.connect('typescript', '/project', c);

    manager.shutdownAll();
    // Second call should be a safe no-op
    manager.shutdownAll();

    expect(manager.getStats().total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: Edge cases
// ---------------------------------------------------------------------------

describe('LspInstanceManager — edge cases', () => {
  // Empty rootPath is handled (resolves to cwd).
  test('handles empty rootPath by resolving to cwd', () => {
    const spawn = makeMockSpawn();
    const manager = new LspInstanceManager({
      spawnFn: spawn.spawnFn,
      getLspCommandFn: makeMockGetLspCommand(),
    });

    const c = makeMockClient();
    const inst = manager.connect('typescript', '', c);

    expect(inst).not.toBeNull();
    expect(inst!.rootPath).toBe(resolve(''));
  });

  // Very long rootPath strings don't cause issues.
  test('handles very long rootPath strings', () => {
    const spawn = makeMockSpawn();
    const manager = new LspInstanceManager({
      spawnFn: spawn.spawnFn,
      getLspCommandFn: makeMockGetLspCommand(),
    });

    const longPath = '/a' + '/b'.repeat(200);
    const c = makeMockClient();
    const inst = manager.connect('typescript', longPath, c);

    expect(inst).not.toBeNull();
    expect(inst!.rootPath).toBe(resolve(longPath));
  });

  // Multiple clients on different instances are tracked independently.
  test('tracks clients independently across instances', () => {
    const spawn = makeMockSpawn();
    const manager = new LspInstanceManager({
      spawnFn: spawn.spawnFn,
      getLspCommandFn: makeMockGetLspCommand(),
    });

    const cA1 = makeMockClient('a1');
    const cA2 = makeMockClient('a2');
    const cB1 = makeMockClient('b1');

    const instA = manager.connect('typescript', '/project-a', cA1);
    manager.connect('typescript', '/project-a', cA2);
    const instB = manager.connect('typescript', '/project-b', cB1);

    expect(instA!.clients.size).toBe(2);
    expect(instB!.clients.size).toBe(1);

    manager.disconnect('typescript', '/project-a', 'a1');
    expect(instA!.clients.size).toBe(1);
    expect(instB!.clients.size).toBe(1);
  });

  // Connecting with the same client ID to the same instance replaces the reference.
  test('same client ID on same instance updates reference', () => {
    const spawn = makeMockSpawn();
    const manager = new LspInstanceManager({
      spawnFn: spawn.spawnFn,
      getLspCommandFn: makeMockGetLspCommand(),
    });

    const c1 = makeMockClient('same-id');
    const c2 = { ...c1, send: (data: string) => {} }; // Different send fn but same ID

    manager.connect('typescript', '/project', c1);
    manager.connect('typescript', '/project', c2);

    const inst = manager.getInstance('typescript', '/project');
    // Should have 1 client (overwritten) not 2
    expect(inst!.clients.size).toBe(1);
    expect(inst!.clients.get('same-id')).toBe(c2);
  });

  // Handles process with no stdout gracefully.
  test('handles process with no stdout or stderr', () => {
    const manager = new LspInstanceManager({
      spawnFn: () => ({
        stdin: makeMockStdin(),
        stdout: null,
        stderr: null,
        kill() {},
      }),
      getLspCommandFn: makeMockGetLspCommand(),
    });

    const c = makeMockClient();
    // Should not throw
    const inst = manager.connect('typescript', '/project', c);
    expect(inst).not.toBeNull();
  });

  // Handles stdout as file descriptor number.
  test('handles stdout as file descriptor number', () => {
    const manager = new LspInstanceManager({
      spawnFn: () => ({
        stdin: makeMockStdin(),
        stdout: 1, // fd number
        stderr: 2,
        kill() {},
      }),
      getLspCommandFn: makeMockGetLspCommand(),
    });

    const c = makeMockClient();
    // Should not throw
    const inst = manager.connect('typescript', '/project', c);
    expect(inst).not.toBeNull();
  });
});
