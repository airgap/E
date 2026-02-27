import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock dependencies that stream.svelte.ts imports
vi.mock('../editor.svelte', () => ({
  editorStore: {
    followAlong: false,
    tabs: [],
    refreshFile: vi.fn(),
    setFollowAlongTarget: vi.fn(),
  },
  detectLanguage: vi.fn().mockReturnValue('typescript'),
}));

vi.mock('../primaryPane.svelte', () => ({
  primaryPaneStore: {
    openFileTab: vi.fn(),
    refreshFileTab: vi.fn(),
  },
}));

vi.mock('$lib/api/client', () => ({
  api: {
    files: {
      read: vi.fn().mockResolvedValue({ data: { content: '' } }),
    },
  },
}));

vi.mock('../artifacts.svelte', () => ({
  artifactsStore: {
    addFromStream: vi.fn(),
  },
}));

vi.mock('../agent-notes.svelte', () => ({
  agentNotesStore: {
    addFromStream: vi.fn(),
  },
}));

vi.mock('$lib/services/agent-terminal', () => ({
  handleAgentTerminalEvent: vi.fn(),
  resetAgentTerminal: vi.fn(),
}));

vi.mock('@e/shared', () => ({
  isMcpFileWriteTool: vi.fn().mockReturnValue(false),
  extractEditLineHint: vi.fn().mockReturnValue(null),
}));

import { streamStore } from '../stream.svelte';

beforeEach(() => {
  streamStore.reset();
});

// ============================================================================
// Initial state
// ============================================================================
describe('streamStore initial state', () => {
  test('starts with idle status', () => {
    expect(streamStore.status).toBe('idle');
  });

  test('starts with no session ID', () => {
    expect(streamStore.sessionId).toBeNull();
  });

  test('starts with no conversation ID', () => {
    expect(streamStore.conversationId).toBeNull();
  });

  test('starts with empty content blocks', () => {
    expect(streamStore.contentBlocks).toEqual([]);
  });

  test('starts with empty partial text', () => {
    expect(streamStore.partialText).toBe('');
  });

  test('starts with empty partial thinking', () => {
    expect(streamStore.partialThinking).toBe('');
  });

  test('starts with no error', () => {
    expect(streamStore.error).toBeNull();
  });

  test('starts with empty pending approvals', () => {
    expect(streamStore.pendingApprovals).toEqual([]);
  });

  test('starts with empty pending questions', () => {
    expect(streamStore.pendingQuestions).toEqual([]);
  });

  test('starts as not streaming', () => {
    expect(streamStore.isStreaming).toBe(false);
  });

  test('starts as not reconnecting', () => {
    expect(streamStore.isReconnecting).toBe(false);
  });

  test('starts with zero token usage', () => {
    expect(streamStore.tokenUsage).toEqual({ input: 0, output: 0 });
  });

  test('starts with empty tool results', () => {
    expect(streamStore.toolResults.size).toBe(0);
  });

  test('starts with no abort controller', () => {
    expect(streamStore.abortController).toBeNull();
  });

  test('starts with no context warning', () => {
    expect(streamStore.contextWarning).toBeNull();
  });

  test('starts with no compact boundary', () => {
    expect(streamStore.compactBoundary).toBeNull();
  });
});

// ============================================================================
// startStream
// ============================================================================
describe('streamStore.startStream', () => {
  test('sets status to connecting', () => {
    streamStore.startStream('conv-1');
    expect(streamStore.status).toBe('connecting');
  });

  test('sets conversation ID', () => {
    streamStore.startStream('conv-1');
    expect(streamStore.conversationId).toBe('conv-1');
  });

  test('clears partial text', () => {
    streamStore.handleEvent({
      type: 'message_start',
      message: { id: 'm1', role: 'assistant' },
    } as any);
    streamStore.handleEvent({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    } as any);
    streamStore.handleEvent({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'hello' },
    } as any);
    expect(streamStore.partialText).toBe('hello');

    streamStore.startStream('conv-2');
    expect(streamStore.partialText).toBe('');
  });

  test('clears content blocks', () => {
    streamStore.handleEvent({
      type: 'message_start',
      message: { id: 'm1', role: 'assistant' },
    } as any);
    streamStore.handleEvent({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    } as any);
    expect(streamStore.contentBlocks.length).toBe(1);

    streamStore.startStream('conv-2');
    expect(streamStore.contentBlocks).toEqual([]);
  });

  test('clears error', () => {
    streamStore.handleEvent({
      type: 'error',
      error: { type: 'test', message: 'Test error' },
    } as any);
    expect(streamStore.error).toBe('Test error');

    streamStore.startStream('conv-2');
    expect(streamStore.error).toBeNull();
  });

  test('clears tool results', () => {
    streamStore.handleEvent({
      type: 'tool_result',
      toolCallId: 'tc-1',
      result: 'ok',
      isError: false,
    } as any);
    expect(streamStore.toolResults.size).toBe(1);

    streamStore.startStream('conv-2');
    expect(streamStore.toolResults.size).toBe(0);
  });

  test('clears pending questions', () => {
    streamStore.handleEvent({
      type: 'message_start',
      message: { id: 'm1', role: 'assistant' },
    } as any);
    streamStore.handleEvent({
      type: 'user_question_request',
      toolCallId: 'q-1',
      questions: [{ question: 'Which?' }],
    } as any);
    expect(streamStore.pendingQuestions.length).toBe(1);

    streamStore.startStream('conv-2');
    expect(streamStore.pendingQuestions).toEqual([]);
  });

  test('clears context warning', () => {
    streamStore.handleEvent({
      type: 'context_warning',
      inputTokens: 100000,
      contextLimit: 200000,
      usagePercent: 50,
      autocompacted: false,
    } as any);
    expect(streamStore.contextWarning).not.toBeNull();

    streamStore.startStream('conv-2');
    expect(streamStore.contextWarning).toBeNull();
  });

  test('clears compact boundary', () => {
    streamStore.handleEvent({
      type: 'compact_boundary',
      trigger: 'auto',
      pre_tokens: 100000,
      context_limit: 200000,
    } as any);
    expect(streamStore.compactBoundary).not.toBeNull();

    streamStore.startStream('conv-2');
    expect(streamStore.compactBoundary).toBeNull();
  });
});

// ============================================================================
// handleEvent — message lifecycle
// ============================================================================
describe('streamStore.handleEvent — message lifecycle', () => {
  test('message_start sets status to streaming', () => {
    streamStore.startStream('conv-1');
    streamStore.handleEvent({
      type: 'message_start',
      message: { id: 'm1', role: 'assistant' },
    } as any);
    expect(streamStore.status).toBe('streaming');
  });

  test('message_stop sets status to idle when no pending approvals/questions', () => {
    streamStore.startStream('conv-1');
    streamStore.handleEvent({
      type: 'message_start',
      message: { id: 'm1', role: 'assistant' },
    } as any);
    expect(streamStore.status).toBe('streaming');

    streamStore.handleEvent({ type: 'message_stop' } as any);
    expect(streamStore.status).toBe('idle');
  });

  test('message_stop keeps tool_pending when approvals exist', () => {
    streamStore.startStream('conv-1');
    streamStore.handleEvent({
      type: 'message_start',
      message: { id: 'm1', role: 'assistant' },
    } as any);
    streamStore.handleEvent({
      type: 'tool_approval_request',
      toolCallId: 'tc-1',
      toolName: 'Bash',
      input: { command: 'ls' },
      description: 'List files',
    } as any);
    expect(streamStore.status).toBe('tool_pending');

    streamStore.handleEvent({ type: 'message_stop' } as any);
    // Should NOT go to idle — approval dialog is still active
    expect(streamStore.status).toBe('tool_pending');
  });

  test('message_stop keeps tool_pending when questions exist', () => {
    streamStore.startStream('conv-1');
    streamStore.handleEvent({
      type: 'message_start',
      message: { id: 'm1', role: 'assistant' },
    } as any);
    streamStore.handleEvent({
      type: 'user_question_request',
      toolCallId: 'q-1',
      questions: [{ question: 'Which framework?' }],
    } as any);
    expect(streamStore.status).toBe('tool_pending');

    streamStore.handleEvent({ type: 'message_stop' } as any);
    expect(streamStore.status).toBe('tool_pending');
  });

  test('message_stop clears partial text and thinking', () => {
    streamStore.startStream('conv-1');
    streamStore.handleEvent({
      type: 'message_start',
      message: { id: 'm1', role: 'assistant' },
    } as any);
    streamStore.handleEvent({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    } as any);
    streamStore.handleEvent({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'hello' },
    } as any);
    expect(streamStore.partialText).toBe('hello');

    streamStore.handleEvent({ type: 'message_stop' } as any);
    expect(streamStore.partialText).toBe('');
    expect(streamStore.partialThinking).toBe('');
  });

  test('message_delta updates token usage', () => {
    streamStore.startStream('conv-1');
    streamStore.handleEvent({
      type: 'message_start',
      message: { id: 'm1', role: 'assistant' },
    } as any);
    streamStore.handleEvent({
      type: 'message_delta',
      delta: { stop_reason: 'end_turn' },
      usage: { input_tokens: 150, output_tokens: 50 },
    } as any);

    expect(streamStore.tokenUsage).toEqual({ input: 150, output: 50 });
  });
});

// ============================================================================
// handleEvent — content blocks
// ============================================================================
describe('streamStore.handleEvent — content blocks', () => {
  beforeEach(() => {
    streamStore.startStream('conv-1');
    streamStore.handleEvent({
      type: 'message_start',
      message: { id: 'm1', role: 'assistant' },
    } as any);
  });

  test('content_block_start adds text block', () => {
    streamStore.handleEvent({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    } as any);

    expect(streamStore.contentBlocks).toHaveLength(1);
    expect(streamStore.contentBlocks[0]).toEqual(
      expect.objectContaining({ type: 'text', text: '' }),
    );
  });

  test('content_block_start adds thinking block', () => {
    streamStore.handleEvent({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'thinking', thinking: '' },
    } as any);

    expect(streamStore.contentBlocks).toHaveLength(1);
    expect(streamStore.contentBlocks[0]).toEqual(
      expect.objectContaining({ type: 'thinking', thinking: '' }),
    );
  });

  test('content_block_start adds tool_use block', () => {
    streamStore.handleEvent({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'tu-1', name: 'Bash' },
    } as any);

    expect(streamStore.contentBlocks).toHaveLength(1);
    expect(streamStore.contentBlocks[0]).toEqual(
      expect.objectContaining({ type: 'tool_use', id: 'tu-1', name: 'Bash', input: {} }),
    );
  });

  test('content_block_delta appends text', () => {
    streamStore.handleEvent({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    } as any);
    streamStore.handleEvent({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'Hello ' },
    } as any);
    streamStore.handleEvent({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'World' },
    } as any);

    expect(streamStore.contentBlocks[0]).toEqual(
      expect.objectContaining({ type: 'text', text: 'Hello World' }),
    );
    expect(streamStore.partialText).toBe('Hello World');
  });

  test('content_block_delta appends thinking', () => {
    streamStore.handleEvent({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'thinking', thinking: '' },
    } as any);
    streamStore.handleEvent({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: 'Hmm ' },
    } as any);
    streamStore.handleEvent({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: 'let me think' },
    } as any);

    expect(streamStore.contentBlocks[0]).toEqual(
      expect.objectContaining({ type: 'thinking', thinking: 'Hmm let me think' }),
    );
    expect(streamStore.partialThinking).toBe('Hmm let me think');
  });

  test('content_block_delta updates tool_use input from JSON', () => {
    streamStore.handleEvent({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'tu-1', name: 'Bash' },
    } as any);
    streamStore.handleEvent({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"command":"ls -la"}' },
    } as any);

    expect(streamStore.contentBlocks[0]).toEqual(
      expect.objectContaining({
        type: 'tool_use',
        input: { command: 'ls -la' },
      }),
    );
  });

  test('content_block_delta handles invalid partial JSON', () => {
    streamStore.handleEvent({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'tu-1', name: 'Bash' },
    } as any);
    streamStore.handleEvent({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"command": "l' },
    } as any);

    // Should keep previous input unchanged
    expect(streamStore.contentBlocks[0]).toEqual(
      expect.objectContaining({
        type: 'tool_use',
        input: {},
      }),
    );
  });

  test('content_block_delta ignores out-of-bounds index', () => {
    streamStore.handleEvent({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    } as any);

    // Index 5 doesn't exist
    streamStore.handleEvent({
      type: 'content_block_delta',
      index: 5,
      delta: { type: 'text_delta', text: 'ghost' },
    } as any);

    // Should not crash, content should be unchanged
    expect(streamStore.contentBlocks).toHaveLength(1);
    expect(streamStore.contentBlocks[0]).toEqual(
      expect.objectContaining({ type: 'text', text: '' }),
    );
  });

  test('content_block_delta ignores negative index', () => {
    streamStore.handleEvent({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    } as any);

    streamStore.handleEvent({
      type: 'content_block_delta',
      index: -1,
      delta: { type: 'text_delta', text: 'ghost' },
    } as any);

    expect(streamStore.contentBlocks).toHaveLength(1);
    expect(streamStore.contentBlocks[0]).toEqual(
      expect.objectContaining({ type: 'text', text: '' }),
    );
  });

  test('multiple content blocks are indexed correctly', () => {
    streamStore.handleEvent({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'thinking', thinking: '' },
    } as any);
    streamStore.handleEvent({
      type: 'content_block_start',
      index: 1,
      content_block: { type: 'text', text: '' },
    } as any);
    streamStore.handleEvent({
      type: 'content_block_start',
      index: 2,
      content_block: { type: 'tool_use', id: 'tu-1', name: 'Bash' },
    } as any);

    // Delta for thinking (index 0)
    streamStore.handleEvent({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: 'hmm' },
    } as any);

    // Delta for text (index 1)
    streamStore.handleEvent({
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'text_delta', text: 'hello' },
    } as any);

    expect(streamStore.contentBlocks).toHaveLength(3);
    expect(streamStore.contentBlocks[0]).toEqual(
      expect.objectContaining({ type: 'thinking', thinking: 'hmm' }),
    );
    expect(streamStore.contentBlocks[1]).toEqual(
      expect.objectContaining({ type: 'text', text: 'hello' }),
    );
    expect(streamStore.contentBlocks[2]).toEqual(
      expect.objectContaining({ type: 'tool_use', id: 'tu-1', name: 'Bash' }),
    );
  });
});

// ============================================================================
// handleEvent — tool interactions
// ============================================================================
describe('streamStore.handleEvent — tool interactions', () => {
  beforeEach(() => {
    streamStore.startStream('conv-1');
    streamStore.handleEvent({
      type: 'message_start',
      message: { id: 'm1', role: 'assistant' },
    } as any);
  });

  test('tool_approval_request sets status to tool_pending', () => {
    streamStore.handleEvent({
      type: 'tool_approval_request',
      toolCallId: 'tc-1',
      toolName: 'Bash',
      input: { command: 'rm -rf /' },
      description: 'Delete everything',
    } as any);

    expect(streamStore.status).toBe('tool_pending');
    expect(streamStore.pendingApprovals).toHaveLength(1);
    expect(streamStore.pendingApprovals[0]).toEqual({
      toolCallId: 'tc-1',
      toolName: 'Bash',
      input: { command: 'rm -rf /' },
      description: 'Delete everything',
    });
  });

  test('multiple tool_approval_requests accumulate', () => {
    streamStore.handleEvent({
      type: 'tool_approval_request',
      toolCallId: 'tc-1',
      toolName: 'Bash',
      input: {},
      description: 'First',
    } as any);
    streamStore.handleEvent({
      type: 'tool_approval_request',
      toolCallId: 'tc-2',
      toolName: 'Write',
      input: {},
      description: 'Second',
    } as any);

    expect(streamStore.pendingApprovals).toHaveLength(2);
  });

  test('user_question_request sets status to tool_pending', () => {
    streamStore.handleEvent({
      type: 'user_question_request',
      toolCallId: 'q-1',
      questions: [{ question: 'Which framework?' }],
    } as any);

    expect(streamStore.status).toBe('tool_pending');
    expect(streamStore.pendingQuestions).toHaveLength(1);
  });

  test('tool_result records result in toolResults map', () => {
    streamStore.handleEvent({
      type: 'tool_result',
      toolCallId: 'tc-1',
      result: 'file1.ts\nfile2.ts',
      isError: false,
      duration: 150,
    } as any);

    expect(streamStore.toolResults.get('tc-1')).toEqual({
      result: 'file1.ts\nfile2.ts',
      isError: false,
      duration: 150,
    });
  });

  test('tool_result records error result', () => {
    streamStore.handleEvent({
      type: 'tool_result',
      toolCallId: 'tc-err',
      result: 'Permission denied',
      isError: true,
    } as any);

    expect(streamStore.toolResults.get('tc-err')).toEqual({
      result: 'Permission denied',
      isError: true,
      duration: undefined,
    });
  });

  test('tool_result removes matching pending question', () => {
    streamStore.handleEvent({
      type: 'user_question_request',
      toolCallId: 'q-1',
      questions: [{ question: 'Which?' }],
    } as any);
    expect(streamStore.pendingQuestions).toHaveLength(1);

    streamStore.handleEvent({
      type: 'tool_result',
      toolCallId: 'q-1',
      result: 'answered',
      isError: false,
    } as any);
    expect(streamStore.pendingQuestions).toHaveLength(0);
  });

  test('tool_result does NOT remove pending approvals', () => {
    streamStore.handleEvent({
      type: 'tool_approval_request',
      toolCallId: 'tc-1',
      toolName: 'Bash',
      input: {},
      description: 'run ls',
    } as any);
    expect(streamStore.pendingApprovals).toHaveLength(1);

    streamStore.handleEvent({
      type: 'tool_result',
      toolCallId: 'tc-1',
      result: 'ok',
      isError: false,
    } as any);
    // Approvals must be resolved explicitly
    expect(streamStore.pendingApprovals).toHaveLength(1);
  });

  test('tool_result resumes streaming when all pending cleared', () => {
    streamStore.handleEvent({
      type: 'user_question_request',
      toolCallId: 'q-1',
      questions: [{ question: 'Which?' }],
    } as any);
    expect(streamStore.status).toBe('tool_pending');

    streamStore.handleEvent({
      type: 'tool_result',
      toolCallId: 'q-1',
      result: 'answered',
      isError: false,
    } as any);
    expect(streamStore.status).toBe('streaming');
  });

  test('resolveApproval removes approval and resumes streaming', () => {
    streamStore.handleEvent({
      type: 'tool_approval_request',
      toolCallId: 'tc-1',
      toolName: 'Bash',
      input: {},
      description: 'run ls',
    } as any);
    expect(streamStore.pendingApprovals).toHaveLength(1);
    expect(streamStore.status).toBe('tool_pending');

    streamStore.resolveApproval('tc-1');
    expect(streamStore.pendingApprovals).toHaveLength(0);
    expect(streamStore.status).toBe('streaming');
  });

  test('resolveApproval keeps tool_pending when other approvals remain', () => {
    streamStore.handleEvent({
      type: 'tool_approval_request',
      toolCallId: 'tc-1',
      toolName: 'Bash',
      input: {},
      description: 'First',
    } as any);
    streamStore.handleEvent({
      type: 'tool_approval_request',
      toolCallId: 'tc-2',
      toolName: 'Write',
      input: {},
      description: 'Second',
    } as any);

    streamStore.resolveApproval('tc-1');
    expect(streamStore.pendingApprovals).toHaveLength(1);
    // Still have pending
    expect(streamStore.status).toBe('tool_pending');
  });

  test('resolveQuestion removes question and resumes streaming', () => {
    streamStore.handleEvent({
      type: 'user_question_request',
      toolCallId: 'q-1',
      questions: [{ question: 'Which?' }],
    } as any);

    streamStore.resolveQuestion('q-1');
    expect(streamStore.pendingQuestions).toHaveLength(0);
    expect(streamStore.status).toBe('streaming');
  });
});

// ============================================================================
// handleEvent — error
// ============================================================================
describe('streamStore.handleEvent — error', () => {
  test('error event sets status to error', () => {
    streamStore.handleEvent({
      type: 'error',
      error: { type: 'network_error', message: 'Connection lost' },
    } as any);

    expect(streamStore.status).toBe('error');
    expect(streamStore.error).toBe('Connection lost');
  });
});

// ============================================================================
// handleEvent — verification results
// ============================================================================
describe('streamStore.handleEvent — verification_result', () => {
  test('stores verification result by file path', () => {
    streamStore.handleEvent({
      type: 'verification_result',
      filePath: '/src/main.ts',
      passed: true,
      issues: [],
    } as any);

    expect(streamStore.verifications.get('/src/main.ts')).toEqual({
      passed: true,
      issues: [],
    });
  });

  test('stores verification with issues', () => {
    streamStore.handleEvent({
      type: 'verification_result',
      filePath: '/src/main.ts',
      passed: false,
      issues: [{ severity: 'error', line: 10, message: 'Type error', rule: 'ts(2322)' }],
    } as any);

    const v = streamStore.verifications.get('/src/main.ts');
    expect(v?.passed).toBe(false);
    expect(v?.issues).toHaveLength(1);
    expect(v?.issues[0].severity).toBe('error');
  });
});

// ============================================================================
// handleEvent — context events
// ============================================================================
describe('streamStore.handleEvent — context events', () => {
  test('context_warning stores warning data', () => {
    streamStore.handleEvent({
      type: 'context_warning',
      inputTokens: 150000,
      contextLimit: 200000,
      usagePercent: 75,
      autocompacted: false,
    } as any);

    expect(streamStore.contextWarning).toEqual({
      inputTokens: 150000,
      contextLimit: 200000,
      usagePercent: 75,
      autocompacted: false,
    });
  });

  test('compact_boundary stores boundary data', () => {
    streamStore.handleEvent({
      type: 'compact_boundary',
      trigger: 'auto',
      pre_tokens: 150000,
      context_limit: 200000,
    } as any);

    expect(streamStore.compactBoundary).toEqual({
      trigger: 'auto',
      pre_tokens: 150000,
      context_limit: 200000,
    });
  });
});

// ============================================================================
// handleEvent — artifact and agent note forwarding
// ============================================================================
describe('streamStore.handleEvent — artifact/note forwarding', () => {
  test('artifact_created forwards to artifacts store', async () => {
    const { artifactsStore } = await import('../artifacts.svelte');

    const artifact = { id: 'a-1', title: 'Test', type: 'code', content: 'hello' };
    streamStore.handleEvent({
      type: 'artifact_created',
      artifact,
    } as any);

    expect(artifactsStore.addFromStream).toHaveBeenCalledWith(artifact);
  });

  test('agent_note_created forwards to agent notes store', async () => {
    const { agentNotesStore } = await import('../agent-notes.svelte');

    const note = { id: 'n-1', content: 'Note text', timestamp: Date.now() };
    streamStore.handleEvent({
      type: 'agent_note_created',
      note,
    } as any);

    expect(agentNotesStore.addFromStream).toHaveBeenCalledWith(note);
  });

  test('artifact_created with null artifact does not forward', async () => {
    const { artifactsStore } = await import('../artifacts.svelte');
    vi.mocked(artifactsStore.addFromStream).mockClear();

    streamStore.handleEvent({
      type: 'artifact_created',
      artifact: null,
    } as any);

    expect(artifactsStore.addFromStream).not.toHaveBeenCalled();
  });

  test('agent_note_created with null note does not forward', async () => {
    const { agentNotesStore } = await import('../agent-notes.svelte');
    vi.mocked(agentNotesStore.addFromStream).mockClear();

    streamStore.handleEvent({
      type: 'agent_note_created',
      note: null,
    } as any);

    expect(agentNotesStore.addFromStream).not.toHaveBeenCalled();
  });
});

// ============================================================================
// handleEvent — ping
// ============================================================================
describe('streamStore.handleEvent — ping', () => {
  test('ping event does not change status', () => {
    streamStore.startStream('conv-1');
    const statusBefore = streamStore.status;
    streamStore.handleEvent({ type: 'ping' } as any);
    expect(streamStore.status).toBe(statusBefore);
  });
});

// ============================================================================
// cancel
// ============================================================================
describe('streamStore.cancel', () => {
  test('aborts the abort controller', () => {
    const ctrl = new AbortController();
    const abortSpy = vi.spyOn(ctrl, 'abort');
    streamStore.setAbortController(ctrl);

    streamStore.cancel();

    expect(abortSpy).toHaveBeenCalled();
    expect(streamStore.abortController).toBeNull();
  });

  test('sets status to cancelled', () => {
    streamStore.startStream('conv-1');
    streamStore.cancel();
    expect(streamStore.status).toBe('cancelled');
  });

  test('clears partial text and thinking', () => {
    streamStore.startStream('conv-1');
    streamStore.handleEvent({
      type: 'message_start',
      message: { id: 'm1', role: 'assistant' },
    } as any);
    streamStore.handleEvent({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    } as any);
    streamStore.handleEvent({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'hello' },
    } as any);

    streamStore.cancel();

    expect(streamStore.partialText).toBe('');
    expect(streamStore.partialThinking).toBe('');
  });

  test('handles cancel when no abort controller', () => {
    streamStore.cancel();
    expect(streamStore.status).toBe('cancelled');
  });
});

// ============================================================================
// reset
// ============================================================================
describe('streamStore.reset', () => {
  test('resets all state to initial values', () => {
    // Set up some state
    streamStore.startStream('conv-1');
    streamStore.setSessionId('sess-1');
    streamStore.handleEvent({
      type: 'message_start',
      message: { id: 'm1', role: 'assistant' },
    } as any);
    streamStore.handleEvent({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    } as any);
    streamStore.handleEvent({
      type: 'error',
      error: { type: 'test', message: 'oops' },
    } as any);

    streamStore.reset();

    expect(streamStore.status).toBe('idle');
    expect(streamStore.sessionId).toBeNull();
    expect(streamStore.conversationId).toBeNull();
    expect(streamStore.contentBlocks).toEqual([]);
    expect(streamStore.partialText).toBe('');
    expect(streamStore.partialThinking).toBe('');
    expect(streamStore.pendingApprovals).toEqual([]);
    expect(streamStore.pendingQuestions).toEqual([]);
    expect(streamStore.toolResults.size).toBe(0);
    expect(streamStore.error).toBeNull();
    expect(streamStore.abortController).toBeNull();
  });
});

// ============================================================================
// captureState / restoreState
// ============================================================================
describe('streamStore capture and restore', () => {
  test('captureState returns snapshot of current state', () => {
    streamStore.startStream('conv-1');
    streamStore.setSessionId('sess-1');
    streamStore.handleEvent({
      type: 'message_start',
      message: { id: 'm1', role: 'assistant' },
    } as any);
    streamStore.handleEvent({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    } as any);
    streamStore.handleEvent({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'hello' },
    } as any);

    const snapshot = streamStore.captureState();

    expect(snapshot.status).toBe('streaming');
    expect(snapshot.sessionId).toBe('sess-1');
    expect(snapshot.conversationId).toBe('conv-1');
    expect(snapshot.contentBlocks).toHaveLength(1);
    expect(snapshot.partialText).toBe('hello');
  });

  test('restoreState restores from snapshot', () => {
    streamStore.startStream('conv-1');
    streamStore.setSessionId('sess-1');
    streamStore.handleEvent({
      type: 'message_start',
      message: { id: 'm1', role: 'assistant' },
    } as any);
    streamStore.handleEvent({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    } as any);
    streamStore.handleEvent({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'hello' },
    } as any);

    const snapshot = streamStore.captureState();

    // Reset and restore
    streamStore.reset();
    expect(streamStore.status).toBe('idle');

    streamStore.restoreState(snapshot);
    expect(streamStore.status).toBe('streaming');
    expect(streamStore.sessionId).toBe('sess-1');
    expect(streamStore.conversationId).toBe('conv-1');
    expect(streamStore.contentBlocks).toHaveLength(1);
    expect(streamStore.partialText).toBe('hello');
  });

  test('restoreState with null resets to initial state', () => {
    streamStore.startStream('conv-1');
    streamStore.restoreState(null);

    expect(streamStore.status).toBe('idle');
    expect(streamStore.sessionId).toBeNull();
  });

  test('captureState creates independent copy (no aliasing)', () => {
    streamStore.startStream('conv-1');
    streamStore.handleEvent({
      type: 'message_start',
      message: { id: 'm1', role: 'assistant' },
    } as any);
    streamStore.handleEvent({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    } as any);

    const snapshot = streamStore.captureState();

    // Add more content after snapshot
    streamStore.handleEvent({
      type: 'content_block_start',
      index: 1,
      content_block: { type: 'text', text: '' },
    } as any);

    // Snapshot should not be affected
    expect(snapshot.contentBlocks).toHaveLength(1);
    expect(streamStore.contentBlocks).toHaveLength(2);
  });
});

// ============================================================================
// isStreaming derived state
// ============================================================================
describe('streamStore.isStreaming', () => {
  test('true when status is streaming', () => {
    streamStore.startStream('conv-1');
    streamStore.handleEvent({
      type: 'message_start',
      message: { id: 'm1', role: 'assistant' },
    } as any);
    expect(streamStore.isStreaming).toBe(true);
  });

  test('true when status is connecting', () => {
    streamStore.startStream('conv-1');
    expect(streamStore.status).toBe('connecting');
    expect(streamStore.isStreaming).toBe(true);
  });

  test('true when status is tool_pending', () => {
    streamStore.startStream('conv-1');
    streamStore.handleEvent({
      type: 'message_start',
      message: { id: 'm1', role: 'assistant' },
    } as any);
    streamStore.handleEvent({
      type: 'tool_approval_request',
      toolCallId: 'tc-1',
      toolName: 'Bash',
      input: {},
      description: 'run ls',
    } as any);
    expect(streamStore.status).toBe('tool_pending');
    expect(streamStore.isStreaming).toBe(true);
  });

  test('true when reconnecting', () => {
    streamStore.setReconnecting(true);
    expect(streamStore.isStreaming).toBe(true);
    streamStore.setReconnecting(false);
  });

  test('false when idle', () => {
    expect(streamStore.status).toBe('idle');
    expect(streamStore.isStreaming).toBe(false);
  });

  test('false when error', () => {
    streamStore.handleEvent({
      type: 'error',
      error: { type: 'test', message: 'test' },
    } as any);
    expect(streamStore.status).toBe('error');
    expect(streamStore.isStreaming).toBe(false);
  });

  test('false when cancelled', () => {
    streamStore.cancel();
    expect(streamStore.status).toBe('cancelled');
    expect(streamStore.isStreaming).toBe(false);
  });
});

// ============================================================================
// setReconnecting
// ============================================================================
describe('streamStore.setReconnecting', () => {
  test('sets reconnecting flag', () => {
    expect(streamStore.isReconnecting).toBe(false);
    streamStore.setReconnecting(true);
    expect(streamStore.isReconnecting).toBe(true);
    streamStore.setReconnecting(false);
    expect(streamStore.isReconnecting).toBe(false);
  });
});

// ============================================================================
// Sub-agent indexOffset handling
// ============================================================================
describe('streamStore sub-agent index offset', () => {
  test('second message_start offsets content block indices', () => {
    streamStore.startStream('conv-1');

    // First agent turn
    streamStore.handleEvent({
      type: 'message_start',
      message: { id: 'm1', role: 'assistant' },
    } as any);
    streamStore.handleEvent({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    } as any);
    streamStore.handleEvent({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'First turn' },
    } as any);

    // Sub-agent turn (second message_start resets index space)
    streamStore.handleEvent({
      type: 'message_start',
      message: { id: 'm2', role: 'assistant' },
    } as any);
    streamStore.handleEvent({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    } as any);
    streamStore.handleEvent({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'Sub-agent turn' },
    } as any);

    // Should have 2 content blocks
    expect(streamStore.contentBlocks).toHaveLength(2);
    expect(streamStore.contentBlocks[0]).toEqual(
      expect.objectContaining({ type: 'text', text: 'First turn' }),
    );
    expect(streamStore.contentBlocks[1]).toEqual(
      expect.objectContaining({ type: 'text', text: 'Sub-agent turn' }),
    );
  });
});

// ============================================================================
// Forward agent terminal events
// ============================================================================
describe('streamStore forwards to agent terminal', () => {
  test('handleEvent calls handleAgentTerminalEvent', async () => {
    const { handleAgentTerminalEvent } = await import('$lib/services/agent-terminal');

    const event = { type: 'message_start', message: { id: 'm1', role: 'assistant' } } as any;
    streamStore.handleEvent(event);

    expect(handleAgentTerminalEvent).toHaveBeenCalledWith(event);
  });

  test('reset calls resetAgentTerminal', async () => {
    const { resetAgentTerminal } = await import('$lib/services/agent-terminal');

    streamStore.reset();

    expect(resetAgentTerminal).toHaveBeenCalled();
  });
});
