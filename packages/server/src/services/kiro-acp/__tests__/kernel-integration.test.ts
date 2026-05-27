/**
 * Confirms AgentKernel.runKiroAcp translates the Kiro ACP `session/update`
 * notification shapes into the kernel events the chat route's permission
 * gating already understands.
 *
 * The mock KiroAcpClient lets us drive synthetic updates without spawning
 * the real `kiro-cli acp` subprocess, so the test is install-state-agnostic.
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { EventEmitter } from 'node:events';

// One client instance per test so we can grab a reference and push updates
// into it. The mock replaces both the constructor (for session-pool's use)
// and the class shape Kernel's session-pool acquire returns.
let currentClient: FakeClient | null = null;
let promptResolvers: Array<(r: { stopReason: string }) => void> = [];

class FakeClient extends EventEmitter {
  promptCalls: unknown[][] = [];
  closed = false;
  cancelled = false;
  async initialize() {}
  async newSession() {
    return 'fake-session';
  }
  prompt(blocks: unknown[]) {
    this.promptCalls.push(blocks);
    return new Promise<{ stopReason: string }>((resolve) => {
      promptResolvers.push(resolve);
    });
  }
  async cancel() {
    this.cancelled = true;
  }
  close() {
    this.closed = true;
  }
}

mock.module('../client', () => ({
  KiroAcpClient: class {
    constructor() {
      currentClient = new FakeClient();
      return currentClient as any;
    }
  },
}));

// Force the pool cap high enough that no eviction interferes, and import the
// kernel AFTER the mock is registered so the kiro module graph uses it.
process.env.E_KIRO_POOL_MAX = '32';
const { AgentKernel } = await import('../../agent-kernel');
const { activeConversations, release } = await import('../session-pool');

function resetPool() {
  for (const id of activeConversations()) release(id);
  currentClient = null;
  promptResolvers = [];
}

describe('AgentKernel.runKiroAcp', () => {
  beforeEach(resetPool);

  test('agent_message_chunk update becomes a kernel `text` event', async () => {
    const kernel = new AgentKernel({
      sessionId: 'conv-text',
      workspacePath: '/tmp',
      provider: 'kiro',
    });
    const events: any[] = [];
    kernel.on('event', (ev) => events.push(ev));

    const runPromise = kernel.run('hi', 'kiro');
    // Wait a tick so acquire() resolves and the kernel attaches its listener.
    await new Promise((r) => setTimeout(r, 5));
    expect(currentClient).not.toBeNull();

    currentClient!.emit('update', {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'hello world' },
    });
    promptResolvers[0]({ stopReason: 'end_turn' });
    const fullText = await runPromise;

    expect(fullText).toBe('hello world');
    const textEvents = events.filter((e) => e.type === 'text');
    expect(textEvents).toHaveLength(1);
    expect(textEvents[0].data).toEqual({ text: 'hello world' });
    const stopEvents = events.filter((e) => e.type === 'stop');
    expect(stopEvents[0].data.stopReason).toBe('end_turn');
  });

  test('tool_call update becomes a kernel `tool_call` event the route can gate on', async () => {
    const kernel = new AgentKernel({
      sessionId: 'conv-tool',
      workspacePath: '/tmp',
      provider: 'kiro',
    });
    const events: any[] = [];
    kernel.on('event', (ev) => events.push(ev));

    const runPromise = kernel.run('do something', 'kiro');
    await new Promise((r) => setTimeout(r, 5));

    // Real Kiro tool_call payload captured from kiro-cli 2.4.2 — see
    // agent-kernel.ts comment on the tool_call case for the shape.
    currentClient!.emit('update', {
      sessionUpdate: 'tool_call',
      toolCallId: 'tooluse_abc',
      title: 'Running: echo hi',
      kind: 'execute',
      rawInput: { command: 'echo hi', __tool_use_purpose: 'demo' },
    });
    promptResolvers[0]({ stopReason: 'end_turn' });
    await runPromise;

    const toolEvents = events.filter((e) => e.type === 'tool_call');
    expect(toolEvents).toHaveLength(1);
    expect(toolEvents[0].data.tool).toMatchObject({
      id: 'tooluse_abc',
      name: 'execute', // derived from `kind`, not a separate `name` field
      input: { command: 'echo hi', __tool_use_purpose: 'demo' },
      title: 'Running: echo hi',
    });
  });

  test('tool_call_update surfaces as a kernel tool_result event', async () => {
    const kernel = new AgentKernel({
      sessionId: 'conv-tool-update',
      workspacePath: '/tmp',
      provider: 'kiro',
    });
    const events: any[] = [];
    kernel.on('event', (ev) => events.push(ev));

    const runPromise = kernel.run('do', 'kiro');
    await new Promise((r) => setTimeout(r, 5));

    currentClient!.emit('update', {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tooluse_abc',
      kind: 'execute',
      status: 'completed',
      content: 'hi\n',
    });
    promptResolvers[0]({ stopReason: 'end_turn' });
    await runPromise;

    const resultEvents = events.filter((e) => e.type === 'tool_result');
    expect(resultEvents).toHaveLength(1);
    expect(resultEvents[0].data).toMatchObject({
      tool_use_id: 'tooluse_abc',
      tool_name: 'execute',
      content: 'hi\n',
      is_error: false,
    });
  });

  test('agent_thought_chunk surfaces as kernel `thinking` event', async () => {
    const kernel = new AgentKernel({
      sessionId: 'conv-think',
      workspacePath: '/tmp',
      provider: 'kiro',
    });
    const events: any[] = [];
    kernel.on('event', (ev) => events.push(ev));

    const runPromise = kernel.run('hmm', 'kiro');
    await new Promise((r) => setTimeout(r, 5));

    currentClient!.emit('update', {
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: 'reasoning...' },
    });
    promptResolvers[0]({ stopReason: 'end_turn' });
    await runPromise;

    // One initial "Spawning Kiro ACP session..." + the thought chunk.
    const thinkingEvents = events.filter((e) => e.type === 'thinking');
    expect(thinkingEvents.map((e) => e.data.message)).toContain('reasoning...');
  });

  test('attachments are forwarded into the prompt blocks', async () => {
    const kernel = new AgentKernel({
      sessionId: 'conv-img',
      workspacePath: '/tmp',
      provider: 'kiro',
    });

    const runPromise = kernel.run('look', 'kiro', undefined, undefined, {
      attachments: [{ type: 'image', name: 'a.png', content: 'AAAA', mimeType: 'image/png' }],
    });
    await new Promise((r) => setTimeout(r, 5));

    promptResolvers[0]({ stopReason: 'end_turn' });
    await runPromise;

    expect(currentClient!.promptCalls).toHaveLength(1);
    expect(currentClient!.promptCalls[0]).toEqual([
      { type: 'text', text: 'look' },
      { type: 'image', data: 'AAAA', mimeType: 'image/png' },
    ]);
  });
});
