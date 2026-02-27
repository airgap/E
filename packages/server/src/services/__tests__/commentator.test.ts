import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import type { StreamEvent, StreamCommentary } from '@e/shared';
import {
  CommentatorService,
  summariseBatch,
  PERSONALITY_PROMPTS,
  VERBOSITY_PROMPT_MODIFIERS,
  shouldPassVerbosityFilter,
  getBatchTiming,
  MIN_BATCH_MS,
  MAX_BATCH_MS,
  type CommentaryPersonality,
  type CommentaryVerbosity,
  type LlmCaller,
} from '../commentator';

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------

function makeTextDelta(text: string): StreamEvent {
  return {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text },
  };
}

function makeToolResult(toolName: string, isError = false): StreamEvent {
  return {
    type: 'tool_result',
    toolCallId: 'tc_1',
    toolName,
    result: 'ok',
    isError,
  };
}

function makeMessageStart(model = 'claude-haiku'): StreamEvent {
  return {
    type: 'message_start',
    message: { id: 'msg_1', role: 'assistant', model },
  };
}

function makeToolUseStart(toolName: string): StreamEvent {
  return {
    type: 'tool_use_start',
    toolCallId: 'tc_1',
    toolName,
    input: {},
  };
}

function makePing(): StreamEvent {
  return { type: 'ping' };
}

function makeMessageStop(): StreamEvent {
  return { type: 'message_stop' };
}

function makeStoryUpdate(): StreamEvent {
  return {
    type: 'story_update',
    story: { id: 's1', title: 'Test Story', status: 'completed' } as any,
  };
}

function makeError(message: string): StreamEvent {
  return { type: 'error', error: { type: 'cli_error', message } };
}

function makeVerificationResult(passed: boolean): StreamEvent {
  return {
    type: 'verification_result',
    filePath: '/src/main.ts',
    passed,
    issues: [],
    tool: 'tsc',
    duration: 500,
  };
}

// ---------------------------------------------------------------------------
// summariseBatch
// ---------------------------------------------------------------------------

describe('summariseBatch', () => {
  test('returns empty string for empty batch', () => {
    expect(summariseBatch([])).toBe('');
  });

  test('summarises message_start events', () => {
    const result = summariseBatch([makeMessageStart('claude-haiku-4-5')], 'frequent');
    expect(result).toContain('Agent started a new response');
    expect(result).toContain('claude-haiku-4-5');
  });

  test('summarises text deltas with preview', () => {
    const result = summariseBatch([makeTextDelta('Hello world')], 'frequent');
    expect(result).toContain('Agent wrote: "Hello world"');
  });

  test('truncates long text deltas', () => {
    const longText = 'x'.repeat(200);
    const result = summariseBatch([makeTextDelta(longText)], 'frequent');
    expect(result).toContain('\u2026');
    expect(result.length).toBeLessThan(250);
  });

  test('summarises tool results', () => {
    const result = summariseBatch([makeToolResult('Read', false)], 'frequent');
    expect(result).toContain('"Read"');
    expect(result).toContain('succeeded');
  });

  test('summarises failed tool results', () => {
    const result = summariseBatch([makeToolResult('Write', true)], 'frequent');
    expect(result).toContain('"Write"');
    expect(result).toContain('failed');
  });

  test('summarises tool_use_start', () => {
    const result = summariseBatch([makeToolUseStart('Bash')], 'frequent');
    expect(result).toContain('Agent invoking tool "Bash"');
  });

  test('skips ping events', () => {
    const result = summariseBatch([makePing()]);
    expect(result).toBe('');
  });

  test('deduplicates consecutive identical summaries', () => {
    const events = [makeTextDelta('hello'), makeTextDelta('hello'), makeTextDelta('hello')];
    const result = summariseBatch(events);
    const lines = result.split('\n');
    expect(lines.length).toBe(1);
  });

  test('summarises mixed event batches', () => {
    const events: StreamEvent[] = [
      makeMessageStart(),
      makeToolUseStart('Read'),
      makeToolResult('Read'),
      makeTextDelta('Implementation done'),
      makeMessageStop(),
    ];
    const result = summariseBatch(events);
    expect(result).toContain('Agent started');
    expect(result).toContain('Agent invoking tool "Read"');
    expect(result).toContain('"Read" succeeded');
    expect(result).toContain('Agent wrote');
    expect(result).toContain('Agent message complete');
  });

  test('summarises error events', () => {
    const events: StreamEvent[] = [
      { type: 'error', error: { type: 'cli_error', message: 'Something broke' } },
    ];
    const result = summariseBatch(events);
    expect(result).toContain('Error: Something broke');
  });

  test('summarises verification results', () => {
    const events: StreamEvent[] = [
      {
        type: 'verification_result',
        filePath: '/src/main.ts',
        passed: true,
        issues: [],
        tool: 'tsc',
        duration: 500,
      },
    ];
    const result = summariseBatch(events);
    expect(result).toContain('/src/main.ts');
    expect(result).toContain('passed');
  });

  test('summarises content_block_start for thinking', () => {
    const events: StreamEvent[] = [
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: '' },
      },
    ];
    const result = summariseBatch(events);
    expect(result).toContain('Agent is thinking');
  });

  test('summarises content_block_start for tool_use', () => {
    const events: StreamEvent[] = [
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'tu_1', name: 'Read' },
      },
    ];
    const result = summariseBatch(events);
    expect(result).toContain('tool: Read');
  });
});

// ---------------------------------------------------------------------------
// Personality prompts
// ---------------------------------------------------------------------------

describe('PERSONALITY_PROMPTS', () => {
  const personalities: CommentaryPersonality[] = [
    'documentary_narrator',
    'technical_analyst',
    'comedic_observer',
    'project_lead',
  ];

  test('all personalities have prompts', () => {
    for (const p of personalities) {
      expect(PERSONALITY_PROMPTS[p]).toBeDefined();
      expect(PERSONALITY_PROMPTS[p].length).toBeGreaterThan(50);
    }
  });

  test('wizard personality has a prompt', () => {
    expect(PERSONALITY_PROMPTS.wizard).toBeDefined();
    expect(PERSONALITY_PROMPTS.wizard.length).toBeGreaterThan(50);
  });

  test('each personality includes at least 3 few-shot examples', () => {
    for (const p of personalities) {
      const prompt = PERSONALITY_PROMPTS[p];
      const exampleCount = (prompt.match(/Commentary:\s*"/g) || []).length;
      expect(exampleCount).toBeGreaterThanOrEqual(3);
    }
  });

  test('project_lead uses first person', () => {
    expect(PERSONALITY_PROMPTS.project_lead).toContain('first person');
  });

  test('documentary_narrator references David Attenborough', () => {
    expect(PERSONALITY_PROMPTS.documentary_narrator).toContain('David Attenborough');
  });

  test('technical_analyst focuses on architecture', () => {
    const prompt = PERSONALITY_PROMPTS.technical_analyst;
    expect(prompt).toContain('architecture');
    expect(prompt).toContain('design patterns');
  });

  test('comedic_observer is witty and playful', () => {
    const prompt = PERSONALITY_PROMPTS.comedic_observer;
    expect(prompt).toContain('witty');
    expect(prompt).toContain('playful');
  });

  test('project_lead is authoritative and uses I/my', () => {
    const prompt = PERSONALITY_PROMPTS.project_lead;
    expect(prompt).toContain('authoritative');
    expect(prompt).toContain('"I"');
  });

  test('each personality has structured Activity/Commentary examples', () => {
    for (const p of personalities) {
      const prompt = PERSONALITY_PROMPTS[p];
      expect(prompt).toContain('Activity:');
      expect(prompt).toContain('Commentary:');
    }
  });

  test('wizard prompt includes famous wizard easter egg references', () => {
    const prompt = PERSONALITY_PROMPTS.wizard;
    const wizardNames = [
      'Merlin',
      'Gandalf',
      'Dumbledore',
      'Morgana',
      'Rincewind',
      'Raistlin',
      'Elminster',
      'Prospero',
    ];
    const foundNames = wizardNames.filter((name) => prompt.includes(name));
    expect(foundNames.length).toBeGreaterThanOrEqual(2);
  });

  test('wizard prompt uses archaic language constructions', () => {
    const prompt = PERSONALITY_PROMPTS.wizard;
    const archaicWords = ['hath', 'doth', 'verily', 'forsooth', 'methinks'];
    const found = archaicWords.filter((w) => prompt.toLowerCase().includes(w));
    expect(found.length).toBeGreaterThanOrEqual(2);
  });

  test('wizard prompt refers to code as spells and runes', () => {
    const prompt = PERSONALITY_PROMPTS.wizard;
    expect(prompt).toContain('spells');
    expect(prompt).toContain('runes');
    expect(prompt).toContain('enchantment');
  });
});

// ---------------------------------------------------------------------------
// Verbosity filtering
// ---------------------------------------------------------------------------

describe('shouldPassVerbosityFilter', () => {
  test('frequent verbosity passes all events', () => {
    expect(shouldPassVerbosityFilter(makeMessageStart(), 'frequent')).toBe(true);
    expect(shouldPassVerbosityFilter(makeTextDelta('text'), 'frequent')).toBe(true);
    expect(shouldPassVerbosityFilter(makeToolUseStart('Read'), 'frequent')).toBe(true);
    expect(shouldPassVerbosityFilter(makeToolResult('Read'), 'frequent')).toBe(true);
    expect(shouldPassVerbosityFilter(makeMessageStop(), 'frequent')).toBe(true);
    expect(shouldPassVerbosityFilter(makeStoryUpdate(), 'frequent')).toBe(true);
    expect(shouldPassVerbosityFilter(makeError('fail'), 'frequent')).toBe(true);
  });

  test('strategic verbosity filters out low-signal events', () => {
    // Should pass
    expect(shouldPassVerbosityFilter(makeToolUseStart('Read'), 'strategic')).toBe(true);
    expect(shouldPassVerbosityFilter(makeToolResult('Read'), 'strategic')).toBe(true);
    expect(shouldPassVerbosityFilter(makeMessageStop(), 'strategic')).toBe(true);
    expect(shouldPassVerbosityFilter(makeStoryUpdate(), 'strategic')).toBe(true);
    expect(shouldPassVerbosityFilter(makeError('fail'), 'strategic')).toBe(true);
    expect(shouldPassVerbosityFilter(makeVerificationResult(true), 'strategic')).toBe(true);

    // Should NOT pass
    expect(shouldPassVerbosityFilter(makeMessageStart(), 'strategic')).toBe(false);
    expect(shouldPassVerbosityFilter(makeTextDelta('text'), 'strategic')).toBe(false);
    expect(
      shouldPassVerbosityFilter(
        { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
        'strategic',
      ),
    ).toBe(false);
  });

  test('minimal verbosity only passes major milestones', () => {
    // Should pass
    expect(shouldPassVerbosityFilter(makeStoryUpdate(), 'minimal')).toBe(true);
    expect(shouldPassVerbosityFilter(makeError('fail'), 'minimal')).toBe(true);
    expect(shouldPassVerbosityFilter(makeVerificationResult(true), 'minimal')).toBe(true);

    // Should NOT pass
    expect(shouldPassVerbosityFilter(makeToolUseStart('Read'), 'minimal')).toBe(false);
    expect(shouldPassVerbosityFilter(makeToolResult('Read'), 'minimal')).toBe(false);
    expect(shouldPassVerbosityFilter(makeMessageStop(), 'minimal')).toBe(false);
    expect(shouldPassVerbosityFilter(makeMessageStart(), 'minimal')).toBe(false);
    expect(shouldPassVerbosityFilter(makeTextDelta('text'), 'minimal')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Batch timing
// ---------------------------------------------------------------------------

describe('getBatchTiming', () => {
  test('frequent mode uses fast timing (3-5s)', () => {
    const timing = getBatchTiming('frequent');
    expect(timing.minBatchMs).toBe(MIN_BATCH_MS);
    expect(timing.maxBatchMs).toBe(MAX_BATCH_MS);
  });

  test('strategic mode uses moderate timing (8-12s)', () => {
    const timing = getBatchTiming('strategic');
    expect(timing.minBatchMs).toBe(8_000);
    expect(timing.maxBatchMs).toBe(12_000);
  });

  test('minimal mode uses slow timing (15-20s)', () => {
    const timing = getBatchTiming('minimal');
    expect(timing.minBatchMs).toBe(15_000);
    expect(timing.maxBatchMs).toBe(20_000);
  });
});

// ---------------------------------------------------------------------------
// Verbosity prompt modifiers
// ---------------------------------------------------------------------------

describe('VERBOSITY_PROMPT_MODIFIERS', () => {
  test('all three verbosity levels have modifiers', () => {
    const levels: CommentaryVerbosity[] = ['frequent', 'strategic', 'minimal'];
    for (const level of levels) {
      expect(VERBOSITY_PROMPT_MODIFIERS[level]).toBeDefined();
      expect(VERBOSITY_PROMPT_MODIFIERS[level].length).toBeGreaterThan(20);
    }
  });

  test('frequent modifier mentions detailed play-by-play', () => {
    expect(VERBOSITY_PROMPT_MODIFIERS.frequent).toContain('FREQUENT');
    expect(VERBOSITY_PROMPT_MODIFIERS.frequent).toContain('detailed');
  });

  test('strategic modifier mentions strategic milestones', () => {
    expect(VERBOSITY_PROMPT_MODIFIERS.strategic).toContain('STRATEGIC MILESTONES');
    expect(VERBOSITY_PROMPT_MODIFIERS.strategic).toContain('significant');
  });

  test('minimal modifier mentions minimal/concise', () => {
    expect(VERBOSITY_PROMPT_MODIFIERS.minimal).toContain('MINIMAL');
    expect(VERBOSITY_PROMPT_MODIFIERS.minimal).toContain('concise');
  });
});

// ---------------------------------------------------------------------------
// CommentatorService — lifecycle
// ---------------------------------------------------------------------------

describe('CommentatorService — lifecycle', () => {
  let service: CommentatorService;
  const mockLlm: LlmCaller = async () => 'mock response';

  beforeEach(() => {
    service = new CommentatorService(mockLlm);
  });

  afterEach(() => {
    service.stopAll();
  });

  test('startCommentary makes the workspace active', () => {
    expect(service.isActive('ws-1')).toBe(false);
    service.startCommentary('ws-1', 'documentary_narrator');
    expect(service.isActive('ws-1')).toBe(true);
    expect(service.getPersonality('ws-1')).toBe('documentary_narrator');
  });

  test('startCommentary stores verbosity (defaults to strategic)', () => {
    service.startCommentary('ws-1', 'documentary_narrator');
    expect(service.getVerbosity('ws-1')).toBe('strategic');
  });

  test('startCommentary stores custom verbosity', () => {
    service.startCommentary('ws-1', 'documentary_narrator', undefined, 'frequent');
    expect(service.getVerbosity('ws-1')).toBe('frequent');
  });

  test('forceStopCommentary deactivates the workspace', () => {
    service.startCommentary('ws-1', 'technical_analyst');
    expect(service.isActive('ws-1')).toBe(true);
    service.forceStopCommentary('ws-1');
    expect(service.isActive('ws-1')).toBe(false);
    expect(service.getPersonality('ws-1')).toBeUndefined();
    expect(service.getVerbosity('ws-1')).toBeUndefined();
  });

  test('startCommentary is idempotent for same personality', () => {
    service.startCommentary('ws-1', 'documentary_narrator');
    service.pushEvent('ws-1', makeMessageStart());
    service.startCommentary('ws-1', 'documentary_narrator');
    expect(service.getPersonality('ws-1')).toBe('documentary_narrator');
  });

  test('startCommentary replaces existing commentator when personality changes', () => {
    service.startCommentary('ws-1', 'documentary_narrator');
    service.startCommentary('ws-1', 'comedic_observer');
    expect(service.getPersonality('ws-1')).toBe('comedic_observer');
  });

  test('startCommentary updates verbosity without restarting when same personality', () => {
    service.startCommentary('ws-1', 'documentary_narrator', undefined, 'strategic');
    expect(service.getVerbosity('ws-1')).toBe('strategic');

    service.startCommentary('ws-1', 'documentary_narrator', undefined, 'frequent');
    expect(service.getVerbosity('ws-1')).toBe('frequent');
    expect(service.getPersonality('ws-1')).toBe('documentary_narrator');
  });

  test('setVerbosity updates verbosity for active commentator', () => {
    service.startCommentary('ws-1', 'documentary_narrator', undefined, 'strategic');
    expect(service.setVerbosity('ws-1', 'minimal')).toBe(true);
    expect(service.getVerbosity('ws-1')).toBe('minimal');
  });

  test('setVerbosity returns false for non-existent workspace', () => {
    expect(service.setVerbosity('nonexistent', 'frequent')).toBe(false);
  });

  test('forceStopCommentary is safe for non-existent workspace', () => {
    expect(() => service.forceStopCommentary('nonexistent')).not.toThrow();
  });

  test('pushEvent ignores events for inactive workspaces', () => {
    expect(() => service.pushEvent('ws-inactive', makeTextDelta('hello'))).not.toThrow();
  });

  test('pushEvent ignores ping events', () => {
    service.startCommentary('ws-1', 'documentary_narrator');
    service.pushEvent('ws-1', makePing());
  });

  test('pushEvent filters events based on verbosity', () => {
    service.startCommentary('ws-1', 'documentary_narrator', undefined, 'strategic');
    service.pushEvent('ws-1', makeTextDelta('hello'));
  });
});

// ---------------------------------------------------------------------------
// CommentatorService — reference counting
// ---------------------------------------------------------------------------

describe('CommentatorService — reference counting', () => {
  let service: CommentatorService;
  const mockLlm: LlmCaller = async () => 'mock response';

  beforeEach(() => {
    service = new CommentatorService(mockLlm);
  });

  afterEach(() => {
    service.stopAll();
  });

  test('acquireRef increments ref count', () => {
    expect(service.getRefCount('ws-1')).toBe(0);
    expect(service.acquireRef('ws-1')).toBe(1);
    expect(service.getRefCount('ws-1')).toBe(1);
    expect(service.acquireRef('ws-1')).toBe(2);
    expect(service.getRefCount('ws-1')).toBe(2);
  });

  test('releaseRef decrements ref count', () => {
    service.acquireRef('ws-1');
    service.acquireRef('ws-1');
    expect(service.getRefCount('ws-1')).toBe(2);
    expect(service.releaseRef('ws-1')).toBe(1);
    expect(service.getRefCount('ws-1')).toBe(1);
    expect(service.releaseRef('ws-1')).toBe(0);
    expect(service.getRefCount('ws-1')).toBe(0);
  });

  test('releaseRef does not go below zero', () => {
    expect(service.releaseRef('ws-1')).toBe(0);
    expect(service.getRefCount('ws-1')).toBe(0);
  });

  test('stopCommentary respects ref counting — does not stop while refs remain', () => {
    service.startCommentary('ws-1', 'documentary_narrator');
    service.acquireRef('ws-1');
    service.acquireRef('ws-1');

    const stopped = service.stopCommentary('ws-1');
    expect(stopped).toBe(false);
    expect(service.isActive('ws-1')).toBe(true);
  });

  test('stopCommentary stops when ref count is zero', () => {
    service.startCommentary('ws-1', 'documentary_narrator');

    const stopped = service.stopCommentary('ws-1');
    expect(stopped).toBe(true);
    expect(service.isActive('ws-1')).toBe(false);
  });

  test('stopCommentary stops after all refs released', () => {
    service.startCommentary('ws-1', 'documentary_narrator');
    service.acquireRef('ws-1');
    service.acquireRef('ws-1');

    service.releaseRef('ws-1');
    service.releaseRef('ws-1');

    const stopped = service.stopCommentary('ws-1');
    expect(stopped).toBe(true);
    expect(service.isActive('ws-1')).toBe(false);
  });

  test('forceStopCommentary ignores ref count', () => {
    service.startCommentary('ws-1', 'documentary_narrator');
    service.acquireRef('ws-1');
    service.acquireRef('ws-1');

    const stopped = service.forceStopCommentary('ws-1');
    expect(stopped).toBe(true);
    expect(service.isActive('ws-1')).toBe(false);
    expect(service.getRefCount('ws-1')).toBe(0);
  });

  test('stopAll clears all commentators and ref counts', () => {
    service.startCommentary('ws-1', 'documentary_narrator');
    service.startCommentary('ws-2', 'documentary_narrator');
    service.startCommentary('ws-3', 'technical_analyst');
    service.acquireRef('ws-1');
    service.acquireRef('ws-2');

    const count = service.stopAll();
    expect(count).toBe(3);
    expect(service.isActive('ws-1')).toBe(false);
    expect(service.isActive('ws-2')).toBe(false);
    expect(service.isActive('ws-3')).toBe(false);
    expect(service.getRefCount('ws-1')).toBe(0);
    expect(service.getRefCount('ws-2')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// CommentatorService — multi-workspace status
// ---------------------------------------------------------------------------

describe('CommentatorService — status and listing', () => {
  let service: CommentatorService;
  const mockLlm: LlmCaller = async () => 'mock response';

  beforeEach(() => {
    service = new CommentatorService(mockLlm);
  });

  afterEach(() => {
    service.stopAll();
  });

  test('getActiveWorkspaces returns all active workspace IDs', () => {
    expect(service.getActiveWorkspaces()).toEqual([]);

    service.startCommentary('ws-1', 'documentary_narrator');
    service.startCommentary('ws-2', 'documentary_narrator');

    const active = service.getActiveWorkspaces();
    expect(active).toContain('ws-1');
    expect(active).toContain('ws-2');
    expect(active.length).toBe(2);
  });

  test('activeCount tracks the number of active commentators', () => {
    expect(service.activeCount).toBe(0);
    service.startCommentary('ws-1', 'documentary_narrator');
    expect(service.activeCount).toBe(1);
    service.startCommentary('ws-2', 'documentary_narrator');
    expect(service.activeCount).toBe(2);
    service.forceStopCommentary('ws-1');
    expect(service.activeCount).toBe(1);
  });

  test('getStatus returns detailed info for all commentators including verbosity', () => {
    service.startCommentary('ws-1', 'documentary_narrator', undefined, 'frequent');
    service.startCommentary('ws-2', 'documentary_narrator', undefined, 'minimal');
    service.acquireRef('ws-1');
    service.acquireRef('ws-1');
    service.acquireRef('ws-2');

    const statuses = service.getStatus();
    expect(statuses.length).toBe(2);

    const ws1Status = statuses.find((s) => s.workspaceId === 'ws-1');
    expect(ws1Status).toBeDefined();
    expect(ws1Status!.personality).toBe('documentary_narrator');
    expect(ws1Status!.verbosity).toBe('frequent');
    expect(ws1Status!.refCount).toBe(2);
    expect(ws1Status!.generating).toBe(false);
    expect(ws1Status!.bufferedEvents).toBe(0);

    const ws2Status = statuses.find((s) => s.workspaceId === 'ws-2');
    expect(ws2Status).toBeDefined();
    expect(ws2Status!.personality).toBe('documentary_narrator');
    expect(ws2Status!.verbosity).toBe('minimal');
    expect(ws2Status!.refCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// CommentatorService — event batching
// ---------------------------------------------------------------------------

describe('CommentatorService — event batching', () => {
  let service: CommentatorService;
  let mockCallLlm: ReturnType<typeof mock>;

  beforeEach(() => {
    mockCallLlm = mock(() => Promise.resolve('Generated commentary'));
    service = new CommentatorService(mockCallLlm as LlmCaller);
  });

  afterEach(() => {
    service.stopAll();
  });

  test('batches events and calls LLM after MIN_BATCH_MS', async () => {
    service.startCommentary('ws-1', 'documentary_narrator', undefined, 'frequent');

    service.pushEvent('ws-1', makeMessageStart());
    service.pushEvent('ws-1', makeToolUseStart('Read'));
    service.pushEvent('ws-1', makeToolResult('Read'));

    expect(mockCallLlm).not.toHaveBeenCalled();

    await new Promise((resolve) => setTimeout(resolve, MIN_BATCH_MS + 500));

    expect(mockCallLlm).toHaveBeenCalledTimes(1);

    const callArgs = mockCallLlm.mock.calls[0][0] as any;
    expect(callArgs.system).toContain('David Attenborough');
    // Verbosity modifier is appended to system prompt
    expect(callArgs.system).toContain('FREQUENT');
    expect(callArgs.user).toContain('Agent started');
    expect(callArgs.user).toContain('Agent invoking tool "Read"');
    expect(callArgs.model).toContain('haiku');
  }, 10_000);

  test('emits StreamCommentary event after LLM call', async () => {
    const received: StreamCommentary[] = [];
    service.events.on('commentary', (evt: StreamCommentary) => {
      received.push(evt);
    });

    service.startCommentary('ws-1', 'documentary_narrator', undefined, 'frequent');
    service.pushEvent('ws-1', makeMessageStart());

    await new Promise((resolve) => setTimeout(resolve, MIN_BATCH_MS + 1_000));

    expect(received.length).toBe(1);
    expect(received[0].type).toBe('commentary');
    expect(received[0].text).toBe('Generated commentary');
    expect(received[0].personality).toBe('documentary_narrator');
    expect(received[0].workspaceId).toBe('ws-1');
    expect(received[0].timestamp).toBeGreaterThan(0);
  }, 10_000);

  test('flushes batch at MAX_BATCH_MS even with continuous events', async () => {
    service.startCommentary('ws-1', 'technical_analyst', undefined, 'frequent');

    const pushInterval = setInterval(() => {
      service.pushEvent('ws-1', makeTextDelta('ongoing work'));
    }, 500);

    await new Promise((resolve) => setTimeout(resolve, MAX_BATCH_MS + 1_500));
    clearInterval(pushInterval);

    expect(mockCallLlm.mock.calls.length).toBeGreaterThanOrEqual(1);
  }, 15_000);

  test('does not overlap LLM calls — drops batch if generating', async () => {
    const slowMock = mock(
      () => new Promise<string>((resolve) => setTimeout(() => resolve('Slow commentary'), 5_000)),
    );
    service = new CommentatorService(slowMock as LlmCaller);

    service.startCommentary('ws-1', 'comedic_observer', undefined, 'frequent');

    service.pushEvent('ws-1', makeMessageStart());
    await new Promise((resolve) => setTimeout(resolve, MIN_BATCH_MS + 500));

    expect(slowMock).toHaveBeenCalledTimes(1);

    service.pushEvent('ws-1', makeToolUseStart('Edit'));
    await new Promise((resolve) => setTimeout(resolve, MIN_BATCH_MS + 500));

    expect(slowMock).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => setTimeout(resolve, 4_000));
  }, 20_000);

  test('handles LLM errors gracefully without stopping commentary', async () => {
    const failThenSucceed = mock()
      .mockImplementationOnce(() => Promise.reject(new Error('LLM unavailable')))
      .mockImplementationOnce(() => Promise.resolve('Recovered'));

    service = new CommentatorService(failThenSucceed as unknown as LlmCaller);

    const received: StreamCommentary[] = [];
    service.events.on('commentary', (evt: StreamCommentary) => {
      received.push(evt);
    });

    service.startCommentary('ws-1', 'project_lead', undefined, 'frequent');
    service.pushEvent('ws-1', makeMessageStart());

    await new Promise((resolve) => setTimeout(resolve, MIN_BATCH_MS + 1_000));

    expect(received.length).toBe(0);
    expect(service.isActive('ws-1')).toBe(true);

    service.pushEvent('ws-1', makeToolUseStart('Read'));
    await new Promise((resolve) => setTimeout(resolve, MIN_BATCH_MS + 1_000));

    expect(received.length).toBe(1);
    expect(received[0].text).toBe('Recovered');
  }, 15_000);

  test('does not emit commentary if stopped during LLM call', async () => {
    let resolveLlm!: (v: string) => void;
    const pendingMock = mock(
      () =>
        new Promise<string>((resolve) => {
          resolveLlm = resolve;
        }),
    );
    service = new CommentatorService(pendingMock as LlmCaller);

    const received: StreamCommentary[] = [];
    service.events.on('commentary', (evt: StreamCommentary) => {
      received.push(evt);
    });

    service.startCommentary('ws-1', 'documentary_narrator', undefined, 'frequent');
    service.pushEvent('ws-1', makeMessageStart());

    await new Promise((resolve) => setTimeout(resolve, MIN_BATCH_MS + 500));
    expect(pendingMock).toHaveBeenCalledTimes(1);

    service.forceStopCommentary('ws-1');

    resolveLlm('Should not be emitted');
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(received.length).toBe(0);
  }, 10_000);

  test('LLM prompt includes verbosity modifier', async () => {
    service.startCommentary('ws-1', 'documentary_narrator', undefined, 'minimal');

    service.pushEvent('ws-1', makeStoryUpdate());

    await new Promise((resolve) => setTimeout(resolve, 16_000));

    if (mockCallLlm.mock.calls.length > 0) {
      const callArgs = mockCallLlm.mock.calls[0][0] as any;
      expect(callArgs.system).toContain('MINIMAL');
    }
  }, 25_000);

  test('strategic mode filters out text deltas', async () => {
    service.startCommentary('ws-1', 'technical_analyst', undefined, 'strategic');

    service.pushEvent('ws-1', makeTextDelta('hello'));
    service.pushEvent('ws-1', makeTextDelta('world'));
    service.pushEvent('ws-1', makeMessageStart());

    await new Promise((resolve) => setTimeout(resolve, 10_000));

    expect(mockCallLlm).not.toHaveBeenCalled();
  }, 15_000);

  test('strategic mode narrates tool use and errors', async () => {
    service.startCommentary('ws-1', 'technical_analyst', undefined, 'strategic');

    service.pushEvent('ws-1', makeToolUseStart('Edit'));
    service.pushEvent('ws-1', makeToolResult('Edit'));

    await new Promise((resolve) => setTimeout(resolve, 9_000));

    expect(mockCallLlm).toHaveBeenCalledTimes(1);
    const callArgs = mockCallLlm.mock.calls[0][0] as any;
    expect(callArgs.system).toContain('STRATEGIC MILESTONES');
  }, 15_000);
});

// ---------------------------------------------------------------------------
// CommentatorService — multiple workspaces (AC 1, 2, 3)
// ---------------------------------------------------------------------------

describe('CommentatorService — multiple workspaces', () => {
  let service: CommentatorService;
  let mockCallLlm: ReturnType<typeof mock>;

  beforeEach(() => {
    mockCallLlm = mock(() => Promise.resolve('Multi-workspace commentary'));
    service = new CommentatorService(mockCallLlm as LlmCaller);
  });

  afterEach(() => {
    service.stopAll();
  });

  test('AC 1+2: independent commentators with different personalities', async () => {
    const received: StreamCommentary[] = [];
    service.events.on('commentary', (evt: StreamCommentary) => {
      received.push(evt);
    });

    service.startCommentary('ws-1', 'documentary_narrator', undefined, 'frequent');
    service.startCommentary('ws-2', 'documentary_narrator', undefined, 'frequent');

    service.pushEvent('ws-1', makeMessageStart());
    service.pushEvent('ws-2', makeToolUseStart('Edit'));

    await new Promise((resolve) => setTimeout(resolve, MIN_BATCH_MS + 1_000));

    expect(mockCallLlm.mock.calls.length).toBe(2);
    expect(received.length).toBe(2);

    const ws1Commentary = received.find((c) => c.workspaceId === 'ws-1');
    const ws2Commentary = received.find((c) => c.workspaceId === 'ws-2');
    expect(ws1Commentary?.personality).toBe('documentary_narrator');
    expect(ws2Commentary?.personality).toBe('documentary_narrator');
  }, 10_000);

  test('AC 3: events for one workspace do not affect another (no crosstalk)', async () => {
    const received: StreamCommentary[] = [];
    service.events.on('commentary', (evt: StreamCommentary) => {
      received.push(evt);
    });

    service.startCommentary('ws-1', 'documentary_narrator', undefined, 'frequent');
    service.startCommentary('ws-2', 'documentary_narrator', undefined, 'frequent');

    service.pushEvent('ws-1', makeMessageStart());
    service.pushEvent('ws-1', makeToolUseStart('Read'));

    await new Promise((resolve) => setTimeout(resolve, MIN_BATCH_MS + 1_000));

    expect(received.length).toBe(1);
    expect(received[0].workspaceId).toBe('ws-1');
    expect(received[0].personality).toBe('documentary_narrator');
  }, 10_000);

  test('three simultaneous workspaces with different personalities', async () => {
    const received: StreamCommentary[] = [];
    service.events.on('commentary', (evt: StreamCommentary) => {
      received.push(evt);
    });

    service.startCommentary('ws-1', 'documentary_narrator', undefined, 'frequent');
    service.startCommentary('ws-2', 'technical_analyst', undefined, 'frequent');
    service.startCommentary('ws-3', 'comedic_observer', undefined, 'frequent');

    service.pushEvent('ws-1', makeMessageStart());
    service.pushEvent('ws-2', makeToolUseStart('Edit'));
    service.pushEvent('ws-3', makeToolResult('Bash', true));

    await new Promise((resolve) => setTimeout(resolve, MIN_BATCH_MS + 1_000));

    expect(mockCallLlm.mock.calls.length).toBe(3);
    expect(received.length).toBe(3);

    const personalities = received.map((c) => c.personality).sort();
    expect(personalities).toEqual([
      'comedic_observer',
      'documentary_narrator',
      'technical_analyst',
    ]);
  }, 10_000);

  test('stopping one workspace does not affect others', () => {
    service.startCommentary('ws-1', 'documentary_narrator');
    service.startCommentary('ws-2', 'documentary_narrator');
    service.startCommentary('ws-3', 'technical_analyst');

    service.forceStopCommentary('ws-2');

    expect(service.isActive('ws-1')).toBe(true);
    expect(service.isActive('ws-2')).toBe(false);
    expect(service.isActive('ws-3')).toBe(true);
    expect(service.activeCount).toBe(2);
  });

  test('ref counting works independently per workspace', () => {
    service.startCommentary('ws-1', 'documentary_narrator');
    service.startCommentary('ws-2', 'documentary_narrator');

    service.acquireRef('ws-1');
    service.acquireRef('ws-1');
    service.acquireRef('ws-2');

    expect(service.getRefCount('ws-1')).toBe(2);
    expect(service.getRefCount('ws-2')).toBe(1);

    service.releaseRef('ws-1');
    expect(service.getRefCount('ws-1')).toBe(1);
    expect(service.getRefCount('ws-2')).toBe(1);
  });

  test('different workspaces can have different verbosity levels', () => {
    service.startCommentary('ws-1', 'documentary_narrator', undefined, 'frequent');
    service.startCommentary('ws-2', 'documentary_narrator', undefined, 'minimal');

    expect(service.getVerbosity('ws-1')).toBe('frequent');
    expect(service.getVerbosity('ws-2')).toBe('minimal');
  });
});

// ---------------------------------------------------------------------------
// Wizard personality — dedicated tests
// ---------------------------------------------------------------------------

describe('Wizard personality', () => {
  test('wizard prompt uses archaic and mystical language', () => {
    const prompt = PERSONALITY_PROMPTS.wizard;
    expect(prompt).toContain('wizard');
    expect(prompt).toContain('arcane');
    expect(prompt).toContain('mystical');
  });

  test('wizard prompt references spells, runes, and enchantments', () => {
    const prompt = PERSONALITY_PROMPTS.wizard;
    expect(prompt).toContain('spell');
    expect(prompt).toContain('enchantment');
    expect(prompt).toContain('runes');
  });

  test('wizard prompt uses third person perspective', () => {
    const prompt = PERSONALITY_PROMPTS.wizard;
    expect(prompt).toContain('third person');
  });

  test('wizard prompt has Activity/Commentary examples', () => {
    const prompt = PERSONALITY_PROMPTS.wizard;
    expect(prompt).toContain('Activity:');
    expect(prompt).toContain('Commentary:');
  });

  test('wizard commentator can be started and stopped', () => {
    const mockLlm: LlmCaller = async () => 'The code-weaver has finished!';
    const service = new CommentatorService(mockLlm);
    service.startCommentary('ws-wiz', 'wizard');
    expect(service.isActive('ws-wiz')).toBe(true);
    expect(service.getPersonality('ws-wiz')).toBe('wizard');
    service.forceStopCommentary('ws-wiz');
    expect(service.isActive('ws-wiz')).toBe(false);
  });

  test('wizard commentary uses wizard system prompt in LLM call', async () => {
    const wizMock = mock(() => Promise.resolve('Behold! The artificer weaves its spell!'));
    const service = new CommentatorService(wizMock as LlmCaller);
    service.startCommentary('ws-wiz', 'wizard', undefined, 'frequent');
    service.pushEvent('ws-wiz', makeMessageStart());
    await new Promise((resolve) => setTimeout(resolve, MIN_BATCH_MS + 500));
    expect(wizMock).toHaveBeenCalledTimes(1);
    const callArgs = (wizMock.mock.calls as any[][])[0][0] as any;
    expect(callArgs.system).toContain('wizard');
    expect(callArgs.system).toContain('arcane');
    service.stopAll();
  }, 10_000);
});
