import { describe, test, expect } from 'bun:test';
import { DEFAULT_SETTINGS } from '../settings';

describe('DEFAULT_SETTINGS', () => {
  test('has correct theme default', () => {
    expect(DEFAULT_SETTINGS.theme).toBe('dark');
  });

  test('has correct CLI provider default', () => {
    expect(DEFAULT_SETTINGS.cliProvider).toBe('claude');
  });

  test('has correct model default', () => {
    expect(DEFAULT_SETTINGS.model).toBe('claude-sonnet-4-6');
  });

  test('has correct permission mode default', () => {
    expect(DEFAULT_SETTINGS.permissionMode).toBe('safe');
  });

  test('starts with empty permission rules', () => {
    expect(DEFAULT_SETTINGS.permissionRules).toEqual([]);
  });

  test('has default keybindings', () => {
    expect(DEFAULT_SETTINGS.keybindings.length).toBeGreaterThan(0);
    const sendBinding = DEFAULT_SETTINGS.keybindings.find((k) => k.action === 'send');
    expect(sendBinding).toBeDefined();
    expect(sendBinding!.keys).toBe('Ctrl+Enter');
    expect(sendBinding!.context).toBe('input');
  });

  test('has all expected keybinding actions', () => {
    const actions = DEFAULT_SETTINGS.keybindings.map((k) => k.action);
    expect(actions).toContain('send');
    expect(actions).toContain('togglePlanMode');
    expect(actions).toContain('cancel');
    expect(actions).toContain('commandPalette');
    expect(actions).toContain('toggleSidebar');
    expect(actions).toContain('clearChat');
  });

  test('starts with no MCP servers', () => {
    expect(DEFAULT_SETTINGS.mcpServers).toEqual([]);
  });

  test('has autoMemory enabled by default', () => {
    expect(DEFAULT_SETTINGS.autoMemoryEnabled).toBe(true);
  });

  test('has correct default workspace path', () => {
    expect(DEFAULT_SETTINGS.workspacePath).toBe('.');
  });

  test('has correct appearance defaults', () => {
    expect(DEFAULT_SETTINGS.fontSize).toBe(14);
    expect(DEFAULT_SETTINGS.fontFamily).toContain('JetBrains Mono');
    expect(DEFAULT_SETTINGS.showThinkingBlocks).toBe(true);
    expect(DEFAULT_SETTINGS.showToolDetails).toBe(true);
  });

  test('has correct behavior defaults', () => {
    expect(DEFAULT_SETTINGS.autoScroll).toBe(true);
    expect(DEFAULT_SETTINGS.streamingEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.compactMessages).toBe(false);
  });

  test('all keybindings have required fields', () => {
    for (const kb of DEFAULT_SETTINGS.keybindings) {
      expect(typeof kb.keys).toBe('string');
      expect(typeof kb.action).toBe('string');
      expect(['global', 'input', 'chat']).toContain(kb.context);
      expect(typeof kb.description).toBe('string');
    }
  });
});
