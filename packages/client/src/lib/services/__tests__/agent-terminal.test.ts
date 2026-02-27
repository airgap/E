import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGetOrCreateAgentTab = vi.fn((_label: string) => ({ sessionId: 'agent-session' }));
const mockHas = vi.fn((_id: string) => false);
const mockCreateVirtualSession = vi.fn((_id: string, _opts?: unknown) => {});
const mockWriteToTerminal = vi.fn((_id: string, _data: string) => {});

vi.mock('$lib/stores/terminal.svelte', () => ({
  terminalStore: {
    getOrCreateAgentTab: (label: string) => mockGetOrCreateAgentTab(label),
  },
}));

vi.mock('$lib/services/terminal-connection', () => ({
  terminalConnectionManager: {
    has: (id: string) => mockHas(id),
    createVirtualSession: (id: string, opts?: unknown) =>
      opts !== undefined ? mockCreateVirtualSession(id, opts) : mockCreateVirtualSession(id),
    writeToTerminal: (id: string, data: string) => mockWriteToTerminal(id, data),
  },
}));

let mockAgentTerminalEnabled = true;
vi.mock('$lib/stores/settings.svelte', () => ({
  settingsStore: {
    get agentTerminalEnabled() {
      return mockAgentTerminalEnabled;
    },
  },
}));

import { handleAgentTerminalEvent, resetAgentTerminal } from '../agent-terminal';

beforeEach(() => {
  mockGetOrCreateAgentTab.mockReturnValue({ sessionId: 'agent-session' });
  mockHas.mockReturnValue(false);
  mockCreateVirtualSession.mockClear();
  mockWriteToTerminal.mockClear();
  mockAgentTerminalEnabled = true;
  resetAgentTerminal();
});

describe('handleAgentTerminalEvent', () => {
  test('ignores events when agent terminal is disabled', () => {
    mockAgentTerminalEnabled = false;

    handleAgentTerminalEvent({
      type: 'tool_use_start',
      toolName: 'Bash',
      toolCallId: 'tc-1',
      input: { command: 'ls' },
    } as any);

    expect(mockWriteToTerminal).not.toHaveBeenCalled();
  });

  test('ignores non-Bash tool_use_start events', () => {
    handleAgentTerminalEvent({
      type: 'tool_use_start',
      toolName: 'Read',
      toolCallId: 'tc-1',
      input: { file_path: '/foo' },
    } as any);

    expect(mockWriteToTerminal).not.toHaveBeenCalled();
  });

  test('writes command header for Bash tool_use_start', () => {
    handleAgentTerminalEvent({
      type: 'tool_use_start',
      toolName: 'Bash',
      toolCallId: 'tc-1',
      input: { command: 'npm test', description: 'Run tests' },
    } as any);

    expect(mockWriteToTerminal).toHaveBeenCalled();
    // Should have written separator, description, and command
    const allWrites = mockWriteToTerminal.mock.calls.map((c) => c[1]).join('');
    expect(allWrites).toContain('npm test');
    expect(allWrites).toContain('Run tests');
    expect(allWrites).toContain('─'); // separator
  });

  test('creates virtual session if not yet created', () => {
    mockHas.mockReturnValue(false);

    handleAgentTerminalEvent({
      type: 'tool_use_start',
      toolName: 'Bash',
      toolCallId: 'tc-1',
      input: { command: 'ls' },
    } as any);

    expect(mockCreateVirtualSession).toHaveBeenCalledWith('agent-session');
  });

  test('skips virtual session creation if already exists', () => {
    mockHas.mockReturnValue(true);

    handleAgentTerminalEvent({
      type: 'tool_use_start',
      toolName: 'Bash',
      toolCallId: 'tc-1',
      input: { command: 'ls' },
    } as any);

    expect(mockCreateVirtualSession).not.toHaveBeenCalled();
  });

  test('writes output for tool_result of tracked Bash call', () => {
    // First, start a Bash tool
    handleAgentTerminalEvent({
      type: 'tool_use_start',
      toolName: 'Bash',
      toolCallId: 'tc-1',
      input: { command: 'echo hello' },
    } as any);

    mockWriteToTerminal.mockClear();

    // Then, receive the result
    handleAgentTerminalEvent({
      type: 'tool_result',
      toolCallId: 'tc-1',
      toolName: 'Bash',
      result: 'hello\nworld',
      isError: false,
      duration: 150,
    } as any);

    const allWrites = mockWriteToTerminal.mock.calls.map((c) => c[1]).join('');
    expect(allWrites).toContain('hello');
    expect(allWrites).toContain('150ms');
    expect(allWrites).toContain('✓');
  });

  test('writes error output in red for error results', () => {
    handleAgentTerminalEvent({
      type: 'tool_use_start',
      toolName: 'Bash',
      toolCallId: 'tc-2',
      input: { command: 'false' },
    } as any);

    mockWriteToTerminal.mockClear();

    handleAgentTerminalEvent({
      type: 'tool_result',
      toolCallId: 'tc-2',
      toolName: 'Bash',
      result: 'Command failed',
      isError: true,
      duration: 50,
    } as any);

    const allWrites = mockWriteToTerminal.mock.calls.map((c) => c[1]).join('');
    expect(allWrites).toContain('\x1b[31m'); // ANSI red
    expect(allWrites).toContain('✗');
  });

  test('formats duration as seconds when >= 1000ms', () => {
    handleAgentTerminalEvent({
      type: 'tool_use_start',
      toolName: 'Bash',
      toolCallId: 'tc-3',
      input: { command: 'sleep 2' },
    } as any);

    mockWriteToTerminal.mockClear();

    handleAgentTerminalEvent({
      type: 'tool_result',
      toolCallId: 'tc-3',
      toolName: 'Bash',
      result: '',
      isError: false,
      duration: 2500,
    } as any);

    const allWrites = mockWriteToTerminal.mock.calls.map((c) => c[1]).join('');
    expect(allWrites).toContain('2.5s');
  });

  test('ignores tool_result when no tracked call', () => {
    handleAgentTerminalEvent({
      type: 'tool_result',
      toolCallId: 'tc-unknown',
      toolName: 'Read',
      result: 'some content',
      isError: false,
    } as any);

    expect(mockWriteToTerminal).not.toHaveBeenCalled();
  });

  test('ignores unrelated event types', () => {
    handleAgentTerminalEvent({
      type: 'message_start',
    } as any);

    expect(mockWriteToTerminal).not.toHaveBeenCalled();
  });

  test('handles tool_result matching by toolName when id differs', () => {
    handleAgentTerminalEvent({
      type: 'tool_use_start',
      toolName: 'Bash',
      toolCallId: 'tc-10',
      input: { command: 'ls' },
    } as any);

    mockWriteToTerminal.mockClear();

    // toolCallId differs but toolName is Bash
    handleAgentTerminalEvent({
      type: 'tool_result',
      toolCallId: 'tc-different',
      toolName: 'Bash',
      result: 'output',
      isError: false,
    } as any);

    expect(mockWriteToTerminal).toHaveBeenCalled();
  });
});

describe('resetAgentTerminal', () => {
  test('clears tracking state so subsequent tool_result is ignored', () => {
    handleAgentTerminalEvent({
      type: 'tool_use_start',
      toolName: 'Bash',
      toolCallId: 'tc-5',
      input: { command: 'ls' },
    } as any);

    resetAgentTerminal();
    mockWriteToTerminal.mockClear();

    // This should be ignored because tracking was reset
    handleAgentTerminalEvent({
      type: 'tool_result',
      toolCallId: 'tc-5',
      toolName: 'Read',
      result: 'output',
      isError: false,
    } as any);

    expect(mockWriteToTerminal).not.toHaveBeenCalled();
  });
});
