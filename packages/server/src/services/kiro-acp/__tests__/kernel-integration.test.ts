/**
 * Confirms AgentKernel.runKiroAcp translates the Kiro ACP `session/update`
 * notification shapes into the kernel events the chat route's permission
 * gating already understands.
 *
 * The mock KiroAcpClient lets us drive synthetic updates without spawning
 * the real `kiro-cli acp` subprocess, so the test is install-state-agnostic.
 */
import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import { EventEmitter } from 'node:events';
import { AgentKernel } from '../../agent-kernel';
import {
  activeConversations,
  release,
  __setClientFactoryForTests,
  __resetClientFactoryForTests,
} from '../session-pool';

// FakeClient stands in for the real KiroAcpClient via the session-pool's
// client-factory test seam. Avoids mock.module entirely so this test file
// doesn't leak its mock into sibling suites (Bun's mock.module is
// run-scoped, not file-scoped).
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

__setClientFactoryForTests(((opts: { cwd: string }) => {
  currentClient = new FakeClient();
  (currentClient as any).cwdHint = opts.cwd;
  return currentClient as any;
}) as any);
// Cap stays well above what these tests use so no eviction interferes.
process.env.E_KIRO_POOL_MAX = '32';

function resetPool() {
  for (const id of activeConversations()) release(id);
  currentClient = null;
  promptResolvers = [];
}

describe('AgentKernel.runKiroAcp', () => {
  beforeEach(resetPool);
  // Restore the production factory so client-trust-all (and any future
  // sibling test) sees the real KiroAcpClient.
  afterAll(() => {
    __resetClientFactoryForTests();
    delete process.env.E_KIRO_POOL_MAX;
  });

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

    // Real captured shape (LYK-978 probe): content is an array of
    // {type:'content', content:{type:'text', text:'...'}} blocks during
    // streaming, OR omitted entirely on the final {status:'completed'}
    // notification.
    currentClient!.emit('update', {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tooluse_abc',
      content: [{ type: 'content', content: { type: 'text', text: 'hello-from-kiro\n' } }],
    });
    promptResolvers[0]({ stopReason: 'end_turn' });
    await runPromise;

    const resultEvents = events.filter((e) => e.type === 'tool_result');
    expect(resultEvents).toHaveLength(1);
    expect(resultEvents[0].data).toMatchObject({
      tool_use_id: 'tooluse_abc',
      content: 'hello-from-kiro\n',
      is_error: false,
    });
  });

  test('failed tool_call_update marks is_error true', async () => {
    const kernel = new AgentKernel({
      sessionId: 'conv-tool-fail',
      workspacePath: '/tmp',
      provider: 'kiro',
    });
    const events: any[] = [];
    kernel.on('event', (ev) => events.push(ev));

    const runPromise = kernel.run('do', 'kiro');
    await new Promise((r) => setTimeout(r, 5));

    currentClient!.emit('update', {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tooluse_xyz',
      kind: 'execute',
      status: 'failed',
    });
    promptResolvers[0]({ stopReason: 'end_turn' });
    await runPromise;

    expect(events.find((e) => e.type === 'tool_result')?.data.is_error).toBe(true);
  });

  test('tool_call_chunk early-announce is dropped (no duplicate tool_call)', async () => {
    const kernel = new AgentKernel({
      sessionId: 'conv-chunk',
      workspacePath: '/tmp',
      provider: 'kiro',
    });
    const events: any[] = [];
    kernel.on('event', (ev) => events.push(ev));

    const runPromise = kernel.run('do', 'kiro');
    await new Promise((r) => setTimeout(r, 5));

    // Real Kiro behaviour: tool_call_chunk arrives first as a preview, then
    // the full tool_call follows. We only want ONE kernel tool_call so the
    // route doesn't pop two approval dialogs.
    currentClient!.emit('update', {
      sessionUpdate: 'tool_call_chunk',
      toolCallId: 'tooluse_abc',
      title: 'shell',
      kind: 'execute',
    });
    currentClient!.emit('update', {
      sessionUpdate: 'tool_call',
      toolCallId: 'tooluse_abc',
      title: 'Running: echo hi',
      kind: 'execute',
      rawInput: { command: 'echo hi' },
    });
    promptResolvers[0]({ stopReason: 'end_turn' });
    await runPromise;

    expect(events.filter((e) => e.type === 'tool_call')).toHaveLength(1);
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
