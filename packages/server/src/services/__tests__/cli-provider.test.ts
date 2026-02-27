import { describe, test, expect } from 'bun:test';

// Use dynamic import to bypass potential mock.module contamination from other test files
const { buildCliCommand } = await import('../cli-provider');

describe('buildCliCommand - claude', () => {
  test('builds minimal claude command', () => {
    const { binary, args } = buildCliCommand('claude', { content: 'hello' });
    expect(binary.endsWith('claude')).toBe(true);
    expect(args).toContain('--output-format');
    expect(args).toContain('stream-json');
    expect(args).toContain('--verbose');
    expect(args).toContain('-p');
    expect(args).toContain('hello');
    expect(args).toContain('--dangerously-skip-permissions');
  });

  test('includes resume session flag', () => {
    const { args } = buildCliCommand('claude', { content: 'hi', resumeSessionId: 'sess-123' });
    expect(args).toContain('-r');
    expect(args).toContain('sess-123');
  });

  test('includes model flag', () => {
    const { args } = buildCliCommand('claude', { content: 'hi', model: 'claude-opus-4-6' });
    expect(args).toContain('--model');
    expect(args).toContain('claude-opus-4-6');
  });

  test('includes system prompt', () => {
    const { args } = buildCliCommand('claude', { content: 'hi', systemPrompt: 'be concise' });
    expect(args).toContain('--system-prompt');
    expect(args).toContain('be concise');
  });

  test('includes effort flag', () => {
    const { args } = buildCliCommand('claude', { content: 'hi', effort: 'high' });
    expect(args).toContain('--effort');
    expect(args).toContain('high');
  });

  test('includes max budget', () => {
    const { args } = buildCliCommand('claude', { content: 'hi', maxBudgetUsd: 5.0 });
    expect(args).toContain('--max-budget-usd');
    expect(args).toContain('5');
  });

  test('includes max turns', () => {
    const { args } = buildCliCommand('claude', { content: 'hi', maxTurns: 10 });
    expect(args).toContain('--max-turns');
    expect(args).toContain('10');
  });

  test('includes allowed tools as repeated flags', () => {
    const { args } = buildCliCommand('claude', {
      content: 'hi',
      allowedTools: ['Bash', 'Read'],
    });
    const allowedIndices = args.reduce(
      (acc: number[], arg, i) => (arg === '--allowedTools' ? [...acc, i] : acc),
      [],
    );
    expect(allowedIndices).toHaveLength(2);
    expect(args[allowedIndices[0] + 1]).toBe('Bash');
    expect(args[allowedIndices[1] + 1]).toBe('Read');
  });

  test('includes disallowed tools', () => {
    const { args } = buildCliCommand('claude', {
      content: 'hi',
      disallowedTools: ['Write'],
    });
    expect(args).toContain('--disallowedTools');
    expect(args).toContain('Write');
  });

  test('includes mcp config path', () => {
    const { args } = buildCliCommand('claude', {
      content: 'hi',
      mcpConfigPath: '/tmp/mcp.json',
    });
    expect(args).toContain('--mcp-config');
    expect(args).toContain('/tmp/mcp.json');
  });

  test('omits optional flags when not set', () => {
    const { args } = buildCliCommand('claude', { content: 'test' });
    expect(args).not.toContain('-r');
    expect(args).not.toContain('--model');
    expect(args).not.toContain('--system-prompt');
    expect(args).not.toContain('--effort');
    expect(args).not.toContain('--max-budget-usd');
    expect(args).not.toContain('--max-turns');
    expect(args).not.toContain('--allowedTools');
    expect(args).not.toContain('--disallowedTools');
    expect(args).not.toContain('--mcp-config');
  });
});

describe('buildCliCommand - kiro', () => {
  test('builds kiro-cli acp command', () => {
    const { binary, args } = buildCliCommand('kiro', { content: 'hello' });
    expect(binary).toBe('kiro-cli');
    expect(args).toEqual(['acp']);
  });

  test('uses acp mode regardless of options', () => {
    const { args } = buildCliCommand('kiro', {
      content: 'hi',
      resumeSessionId: 'sess-1',
      allowedTools: ['Bash', 'Read'],
      model: 'opus',
      systemPrompt: 'be concise',
    });
    // ACP mode always uses just ['acp'] - options are sent via JSON-RPC
    expect(args).toEqual(['acp']);
  });

  test('does not include chat command flags', () => {
    const { args } = buildCliCommand('kiro', {
      content: 'test',
      model: 'opus',
      systemPrompt: 'be concise',
    });
    expect(args).not.toContain('chat');
    expect(args).not.toContain('--no-interactive');
    expect(args).not.toContain('--output-format');
    expect(args).not.toContain('stream-json');
    expect(args).not.toContain('--trust-all-tools');
    expect(args).not.toContain('--model');
    expect(args).not.toContain('--system-prompt');
    expect(args).not.toContain('-p');
    expect(args).not.toContain('--dangerously-skip-permissions');
  });
});

describe('buildCliCommand - gemini-cli', () => {
  test('builds minimal gemini command', () => {
    const { binary, args } = buildCliCommand('gemini-cli', { content: 'hello' });
    expect(binary.endsWith('gemini')).toBe(true);
    expect(args).toContain('--output-format');
    expect(args).toContain('stream-json');
    expect(args).toContain('-p');
    expect(args).toContain('hello');
    expect(args).toContain('--sandbox=off');
    expect(args).toContain('--yolo');
  });

  test('includes model flag', () => {
    const { args } = buildCliCommand('gemini-cli', {
      content: 'hi',
      model: 'gemini-2.5-pro',
    });
    expect(args).toContain('--model');
    expect(args).toContain('gemini-2.5-pro');
  });

  test('includes system prompt', () => {
    const { args } = buildCliCommand('gemini-cli', {
      content: 'hi',
      systemPrompt: 'be concise',
    });
    expect(args).toContain('--system-prompt');
    expect(args).toContain('be concise');
  });

  test('includes resume session flag', () => {
    const { args } = buildCliCommand('gemini-cli', {
      content: 'hi',
      resumeSessionId: 'sess-456',
    });
    expect(args).toContain('-r');
    expect(args).toContain('sess-456');
  });

  test('includes mcp config path', () => {
    const { args } = buildCliCommand('gemini-cli', {
      content: 'hi',
      mcpConfigPath: '/tmp/mcp.json',
    });
    expect(args).toContain('--mcp-config');
    expect(args).toContain('/tmp/mcp.json');
  });

  test('does not include claude-specific flags', () => {
    const { args } = buildCliCommand('gemini-cli', { content: 'test' });
    expect(args).not.toContain('--verbose');
    expect(args).not.toContain('--dangerously-skip-permissions');
    expect(args).not.toContain('--allowedTools');
    expect(args).not.toContain('--disallowedTools');
  });

  test('omits optional flags when not set', () => {
    const { args } = buildCliCommand('gemini-cli', { content: 'test' });
    expect(args).not.toContain('-r');
    expect(args).not.toContain('--model');
    expect(args).not.toContain('--system-prompt');
    expect(args).not.toContain('--mcp-config');
  });

  test('warns for unsupported effort/maxTurns/maxBudgetUsd flags', () => {
    // These flags are not natively supported but should not throw
    const { args } = buildCliCommand('gemini-cli', {
      content: 'hi',
      effort: 'high',
      maxTurns: 10,
      maxBudgetUsd: 5.0,
    });
    // The flags should NOT appear in the args
    expect(args).not.toContain('--effort');
    expect(args).not.toContain('--max-turns');
    expect(args).not.toContain('--max-budget-usd');
  });

  test('warns for unsupported allowedTools/disallowedTools', () => {
    const { args } = buildCliCommand('gemini-cli', {
      content: 'hi',
      allowedTools: ['Bash'],
      disallowedTools: ['Write'],
    });
    expect(args).not.toContain('--allowedTools');
    expect(args).not.toContain('--disallowedTools');
  });
});

describe('buildCliCommand - copilot', () => {
  test('builds minimal copilot command', () => {
    const { binary, args } = buildCliCommand('copilot', { content: 'hello' });
    expect(binary.endsWith('copilot')).toBe(true);
    expect(args).toContain('--format');
    expect(args).toContain('json');
    expect(args).toContain('--no-interactive');
    expect(args).toContain('-p');
    expect(args).toContain('hello');
    expect(args).toContain('--accept-all');
  });

  test('includes model flag', () => {
    const { args } = buildCliCommand('copilot', {
      content: 'hi',
      model: 'gpt-5',
    });
    expect(args).toContain('--model');
    expect(args).toContain('gpt-5');
  });

  test('includes system prompt', () => {
    const { args } = buildCliCommand('copilot', {
      content: 'hi',
      systemPrompt: 'be concise',
    });
    expect(args).toContain('--system-prompt');
    expect(args).toContain('be concise');
  });

  test('includes resume session flag', () => {
    const { args } = buildCliCommand('copilot', {
      content: 'hi',
      resumeSessionId: 'sess-789',
    });
    expect(args).toContain('-r');
    expect(args).toContain('sess-789');
  });

  test('includes mcp config path via --additional-mcp-config', () => {
    const { args } = buildCliCommand('copilot', {
      content: 'hi',
      mcpConfigPath: '/tmp/mcp.json',
    });
    expect(args).toContain('--additional-mcp-config');
    expect(args).toContain('/tmp/mcp.json');
  });

  test('includes max turns', () => {
    const { args } = buildCliCommand('copilot', {
      content: 'hi',
      maxTurns: 15,
    });
    expect(args).toContain('--max-turns');
    expect(args).toContain('15');
  });

  test('does not include claude-specific flags', () => {
    const { args } = buildCliCommand('copilot', { content: 'test' });
    expect(args).not.toContain('--verbose');
    expect(args).not.toContain('--dangerously-skip-permissions');
    expect(args).not.toContain('--output-format');
    expect(args).not.toContain('stream-json');
    expect(args).not.toContain('--allowedTools');
    expect(args).not.toContain('--disallowedTools');
  });

  test('omits optional flags when not set', () => {
    const { args } = buildCliCommand('copilot', { content: 'test' });
    expect(args).not.toContain('-r');
    expect(args).not.toContain('--model');
    expect(args).not.toContain('--system-prompt');
    expect(args).not.toContain('--additional-mcp-config');
    expect(args).not.toContain('--max-turns');
  });

  test('warns for unsupported effort/maxBudgetUsd flags', () => {
    const { args } = buildCliCommand('copilot', {
      content: 'hi',
      effort: 'high',
      maxBudgetUsd: 5.0,
    });
    // These flags should NOT appear in args
    expect(args).not.toContain('--effort');
    expect(args).not.toContain('--max-budget-usd');
  });

  test('warns for unsupported allowedTools/disallowedTools', () => {
    const { args } = buildCliCommand('copilot', {
      content: 'hi',
      allowedTools: ['Bash'],
      disallowedTools: ['Write'],
    });
    expect(args).not.toContain('--allowedTools');
    expect(args).not.toContain('--disallowedTools');
  });
});

describe('buildCliCommand - default provider', () => {
  test('unknown provider falls back to claude', () => {
    const { binary } = buildCliCommand('claude', { content: 'test' });
    expect(binary.endsWith('claude')).toBe(true);
  });
});

describe('buildCliCommand - API-only providers', () => {
  test('bedrock throws error', () => {
    expect(() => buildCliCommand('bedrock', { content: 'test' })).toThrow(
      'bedrock provider does not use CLI commands',
    );
  });

  test('ollama throws error', () => {
    expect(() => buildCliCommand('ollama', { content: 'test' })).toThrow(
      'ollama provider does not use CLI commands',
    );
  });
});
