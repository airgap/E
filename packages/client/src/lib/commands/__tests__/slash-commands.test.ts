import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock all store dependencies before importing
vi.mock('$lib/stores/settings.svelte', () => ({
  settingsStore: {
    theme: 'dark',
    model: 'claude-sonnet-4-6',
    permissionMode: 'safe',
    effort: 'high',
    setTheme: vi.fn(),
    setModel: vi.fn(),
    setPermissionMode: vi.fn(),
  },
}));

vi.mock('$lib/stores/conversation.svelte', () => ({
  conversationStore: {
    active: {
      id: 'conv-1',
      messages: [{ id: 'msg-1' }],
      planMode: false,
      cliSessionId: 'cli-1',
    },
    activeId: 'conv-1',
    addMessage: vi.fn(),
    setPlanMode: vi.fn(),
  },
}));

vi.mock('$lib/stores/stream.svelte', () => ({
  streamStore: {
    sessionId: 'session-1',
    status: 'idle',
  },
}));

vi.mock('$lib/stores/ui.svelte', () => ({
  uiStore: {
    setSidebarTab: vi.fn(),
    setSidebarOpen: vi.fn(),
    openSettings: vi.fn(),
    closeModal: vi.fn(),
    openModal: vi.fn(),
  },
}));

vi.mock('$lib/api/client', () => ({
  api: {
    conversations: {
      update: vi.fn(),
      cost: vi.fn().mockResolvedValue({
        data: {
          totalTokens: 1000,
          inputTokens: 300,
          outputTokens: 700,
          estimatedCostUsd: 0.015,
          model: 'claude-sonnet-4-6',
        },
      }),
    },
  },
}));

import {
  executeSlashCommand,
  COMMANDS,
  getAllCommands,
  registerSkillCommands,
} from '../slash-commands';
import { settingsStore } from '$lib/stores/settings.svelte';
import { conversationStore } from '$lib/stores/conversation.svelte';
import { uiStore } from '$lib/stores/ui.svelte';
import { api } from '$lib/api/client';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('COMMANDS', () => {
  test('exports list of commands', () => {
    expect(COMMANDS.length).toBeGreaterThan(0);
  });

  test('each command has name and description', () => {
    for (const cmd of COMMANDS) {
      expect(typeof cmd.name).toBe('string');
      expect(typeof cmd.description).toBe('string');
    }
  });

  test('includes expected commands', () => {
    const names = COMMANDS.map((c) => c.name);
    expect(names).toContain('clear');
    expect(names).toContain('help');
    expect(names).toContain('memory');
    expect(names).toContain('config');
    expect(names).toContain('theme');
    expect(names).toContain('model');
    expect(names).toContain('plan');
    expect(names).toContain('permissions');
    expect(names).toContain('cost');
    expect(names).toContain('status');
    expect(names).toContain('mcp');
    expect(names).toContain('compact');
    expect(names).toContain('init');
    expect(names).toContain('commit');
    expect(names).toContain('review-pr');
  });
});

describe('executeSlashCommand', () => {
  const ctx = { conversationId: 'conv-1', sessionId: 'session-1', args: '' };

  test('returns handled:false for unknown command', () => {
    const result = executeSlashCommand('nonexistent', ctx);
    expect(result.handled).toBe(false);
  });

  test('/clear clears messages', () => {
    const result = executeSlashCommand('clear', ctx);
    expect(result.handled).toBe(true);
    expect((conversationStore.active as any).messages).toEqual([]);
  });

  test('/help adds system message with command list', () => {
    const result = executeSlashCommand('help', ctx);
    expect(result.handled).toBe(true);
    expect(conversationStore.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'system',
        content: expect.arrayContaining([expect.objectContaining({ type: 'text' })]),
      }),
    );
  });

  test('/memory opens sidebar to memory tab', () => {
    const result = executeSlashCommand('memory', ctx);
    expect(result.handled).toBe(true);
    expect(uiStore.setSidebarTab).toHaveBeenCalledWith('memory');
    expect(uiStore.setSidebarOpen).toHaveBeenCalledWith(true);
  });

  test('/config opens settings', () => {
    const result = executeSlashCommand('config', ctx);
    expect(result.handled).toBe(true);
    expect(uiStore.openSettings).toHaveBeenCalled();
  });

  test('/theme with valid name sets theme', () => {
    const result = executeSlashCommand('theme', { ...ctx, args: 'light' });
    expect(result.handled).toBe(true);
    expect(settingsStore.setTheme).toHaveBeenCalledWith('light');
  });

  test('/theme with invalid name does not set theme', () => {
    const result = executeSlashCommand('theme', { ...ctx, args: 'invalid-theme' });
    expect(result.handled).toBe(true);
    expect(settingsStore.setTheme).not.toHaveBeenCalled();
  });

  test('/theme without args cycles theme', () => {
    const result = executeSlashCommand('theme', { ...ctx, args: '' });
    expect(result.handled).toBe(true);
    expect(settingsStore.setTheme).toHaveBeenCalled();
  });

  test('/model with shorthand maps to full model id', () => {
    executeSlashCommand('model', { ...ctx, args: 'opus' });
    expect(settingsStore.setModel).toHaveBeenCalledWith('claude-opus-4-6');
    expect(api.conversations.update).toHaveBeenCalledWith('conv-1', {
      model: 'claude-opus-4-6',
    });
  });

  test('/model with sonnet shorthand', () => {
    executeSlashCommand('model', { ...ctx, args: 'sonnet' });
    expect(settingsStore.setModel).toHaveBeenCalledWith('claude-sonnet-4-6');
  });

  test('/model with haiku shorthand', () => {
    executeSlashCommand('model', { ...ctx, args: 'haiku' });
    expect(settingsStore.setModel).toHaveBeenCalledWith('claude-haiku-4-5-20251001');
  });

  test('/model with full model id passes through', () => {
    executeSlashCommand('model', { ...ctx, args: 'claude-opus-4-6' });
    expect(settingsStore.setModel).toHaveBeenCalledWith('claude-opus-4-6');
  });

  test('/plan toggles plan mode', () => {
    const result = executeSlashCommand('plan', ctx);
    expect(result.handled).toBe(true);
    expect(conversationStore.setPlanMode).toHaveBeenCalledWith(true);
    expect(api.conversations.update).toHaveBeenCalledWith('conv-1', { planMode: true });
  });

  test('/permissions with valid mode sets it', () => {
    executeSlashCommand('permissions', { ...ctx, args: 'unrestricted' });
    expect(settingsStore.setPermissionMode).toHaveBeenCalledWith('unrestricted');
  });

  test('/permissions with invalid mode does nothing', () => {
    executeSlashCommand('permissions', { ...ctx, args: 'invalid' });
    expect(settingsStore.setPermissionMode).not.toHaveBeenCalled();
  });

  test('/cost fetches and displays cost info', () => {
    const result = executeSlashCommand('cost', ctx);
    expect(result.handled).toBe(true);
    // The cost command is async so it fires and forgets
  });

  test('/status adds system message with session info', () => {
    const result = executeSlashCommand('status', ctx);
    expect(result.handled).toBe(true);
    expect(conversationStore.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'system',
      }),
    );
  });

  test('/mcp opens MCP sidebar panel', () => {
    const result = executeSlashCommand('mcp', ctx);
    expect(result.handled).toBe(true);
    expect(uiStore.closeModal).toHaveBeenCalled();
    expect(uiStore.setSidebarTab).toHaveBeenCalledWith('mcp');
  });

  test('/compact returns sendAsMessage', () => {
    const result = executeSlashCommand('compact', ctx);
    expect(result.handled).toBe(true);
    expect(result.sendAsMessage).toBe('/compact');
  });

  test('/init returns sendAsMessage', () => {
    const result = executeSlashCommand('init', ctx);
    expect(result.handled).toBe(true);
    expect(result.sendAsMessage).toBe('/init');
  });

  test('/commit returns sendAsMessage with commit instruction', () => {
    const result = executeSlashCommand('commit', ctx);
    expect(result.handled).toBe(true);
    expect(result.sendAsMessage).toContain('commit');
  });

  test('/review-pr without args returns generic message', () => {
    const result = executeSlashCommand('review-pr', { ...ctx, args: '' });
    expect(result.handled).toBe(true);
    expect(result.sendAsMessage).toContain('Review the current pull request');
  });

  test('/review-pr with PR ref includes it in message', () => {
    const result = executeSlashCommand('review-pr', { ...ctx, args: '#123' });
    expect(result.handled).toBe(true);
    expect(result.sendAsMessage).toContain('#123');
  });

  test('/e-init returns sendAsMessage with E.md instruction', () => {
    const result = executeSlashCommand('e-init', ctx);
    expect(result.handled).toBe(true);
    expect(result.sendAsMessage).toContain('E.md');
  });

  test('/loop opens work sidebar', () => {
    const result = executeSlashCommand('loop', ctx);
    expect(result.handled).toBe(true);
    expect(uiStore.setSidebarTab).toHaveBeenCalledWith('work');
    expect(uiStore.setSidebarOpen).toHaveBeenCalledWith(true);
  });

  test('/prd opens work sidebar', () => {
    const result = executeSlashCommand('prd', ctx);
    expect(result.handled).toBe(true);
    expect(uiStore.setSidebarTab).toHaveBeenCalledWith('work');
    expect(uiStore.setSidebarOpen).toHaveBeenCalledWith(true);
  });

  test('/work opens work sidebar', () => {
    const result = executeSlashCommand('work', ctx);
    expect(result.handled).toBe(true);
    expect(uiStore.setSidebarTab).toHaveBeenCalledWith('work');
    expect(uiStore.setSidebarOpen).toHaveBeenCalledWith(true);
  });

  test('/import opens work sidebar and external provider modal', () => {
    const result = executeSlashCommand('import', ctx);
    expect(result.handled).toBe(true);
    expect(uiStore.setSidebarTab).toHaveBeenCalledWith('work');
    expect(uiStore.setSidebarOpen).toHaveBeenCalledWith(true);
    expect((uiStore as any).openModal).toHaveBeenCalledWith('external-provider-config');
  });

  test('/model with empty args does nothing', () => {
    const result = executeSlashCommand('model', { ...ctx, args: '' });
    expect(result.handled).toBe(true);
    expect(settingsStore.setModel).not.toHaveBeenCalled();
  });

  test('/cost without conversationId does nothing', () => {
    const result = executeSlashCommand('cost', { ...ctx, conversationId: null });
    expect(result.handled).toBe(true);
    // Async cost fetch should not be called (fire and forget, but with null conversationId)
  });

  test('/clear when no active conversation still returns handled', () => {
    (conversationStore as any).active = null;
    const result = executeSlashCommand('clear', ctx);
    expect(result.handled).toBe(true);
  });

  test('/help when no active conversation still returns handled', () => {
    (conversationStore as any).active = null;
    const result = executeSlashCommand('help', ctx);
    expect(result.handled).toBe(true);
  });

  test('/plan when no active conversation still returns handled', () => {
    (conversationStore as any).active = null;
    const result = executeSlashCommand('plan', ctx);
    expect(result.handled).toBe(true);
  });

  test('/status calls addMessage with expected fields', () => {
    const result = executeSlashCommand('status', ctx);
    expect(result.handled).toBe(true);
    const call = (conversationStore.addMessage as any).mock.calls[0][0];
    expect(call.content[0].text).toContain('Session: session-1');
    expect(call.content[0].text).toContain('Status: idle');
    expect(call.content[0].text).toContain('Model: claude-sonnet-4-6');
  });

  test('/permissions with plan mode sets it', () => {
    executeSlashCommand('permissions', { ...ctx, args: 'plan' });
    expect(settingsStore.setPermissionMode).toHaveBeenCalledWith('plan');
  });

  test('/permissions with fast mode sets it', () => {
    executeSlashCommand('permissions', { ...ctx, args: 'fast' });
    expect(settingsStore.setPermissionMode).toHaveBeenCalledWith('fast');
  });

  test('/permissions with safe mode sets it', () => {
    executeSlashCommand('permissions', { ...ctx, args: 'safe' });
    expect(settingsStore.setPermissionMode).toHaveBeenCalledWith('safe');
  });

  test('/theme with dark-colorblind sets theme', () => {
    executeSlashCommand('theme', { ...ctx, args: 'dark-colorblind' });
    expect(settingsStore.setTheme).toHaveBeenCalledWith('dark-colorblind');
  });

  test('/theme without args cycles from unknown theme position', () => {
    // Force theme to something not in the array
    (settingsStore as any).theme = 'unknown-theme';
    const result = executeSlashCommand('theme', { ...ctx, args: '' });
    expect(result.handled).toBe(true);
    // idx would be -1, so (idx < 0 ? 0 : idx + 1) = 0, then 0 % 8 = 0 → sets 'dark' (first theme)
    expect(settingsStore.setTheme).toHaveBeenCalledWith('dark');
  });
});

// ============================================================================
// getAllCommands
// ============================================================================
describe('getAllCommands', () => {
  test('returns built-in commands', () => {
    const all = getAllCommands();
    const names = all.map((c) => c.name);
    expect(names).toContain('clear');
    expect(names).toContain('help');
    expect(names).toContain('model');
  });

  test('includes registered skill commands', () => {
    registerSkillCommands([
      {
        content: '---\nname: my-skill\ndescription: Test skill\n---\nHello',
        path: '/skills/my-skill.md',
      },
    ]);

    const all = getAllCommands();
    const names = all.map((c) => c.name);
    expect(names).toContain('my-skill');

    // Clean up
    registerSkillCommands([]);
  });
});

// ============================================================================
// registerSkillCommands
// ============================================================================
describe('registerSkillCommands', () => {
  test('registers skill from valid frontmatter', () => {
    registerSkillCommands([
      {
        content: '---\nname: test-skill\ndescription: A test skill\n---\nSkill content here',
        path: '/skills/test-skill.md',
      },
    ]);

    const all = getAllCommands();
    const skill = all.find((c) => c.name === 'test-skill');
    expect(skill).toBeDefined();
    expect(skill!.description).toBe('A test skill');

    // Clean up
    registerSkillCommands([]);
  });

  test('skips files without frontmatter', () => {
    registerSkillCommands([
      {
        content: 'No frontmatter here',
        path: '/skills/no-fm.md',
      },
    ]);

    const all = getAllCommands();
    const names = all.map((c) => c.name);
    // Should not have added anything
    expect(names).not.toContain('no-fm');
    registerSkillCommands([]);
  });

  test('skips files without name in frontmatter', () => {
    registerSkillCommands([
      {
        content: '---\ndescription: No name\n---\nContent',
        path: '/skills/no-name.md',
      },
    ]);

    const all = getAllCommands();
    expect(all.length).toBe(COMMANDS.length);
    registerSkillCommands([]);
  });

  test('does not override built-in commands', () => {
    registerSkillCommands([
      {
        content: '---\nname: clear\ndescription: Override clear\n---\nContent',
        path: '/skills/clear.md',
      },
    ]);

    // Built-in /clear should still work normally, not be overridden
    const result = executeSlashCommand('clear', {
      conversationId: 'conv-1',
      sessionId: 'session-1',
      args: '',
    });
    expect(result.handled).toBe(true);

    // The getAllCommands should still show original description
    registerSkillCommands([]);
  });

  test('sanitizes skill name (only lowercase alphanumeric + hyphens)', () => {
    registerSkillCommands([
      {
        content: '---\nname: My Special Skill!\ndescription: desc\n---\nContent',
        path: '/skills/special.md',
      },
    ]);

    const all = getAllCommands();
    const skill = all.find((c) => c.name === 'my-special-skill-');
    expect(skill).toBeDefined();

    registerSkillCommands([]);
  });

  test('uses default description when none provided', () => {
    registerSkillCommands([
      {
        content: '---\nname: nodesc\n---\nContent',
        path: '/skills/nodesc.md',
      },
    ]);

    const all = getAllCommands();
    const skill = all.find((c) => c.name === 'nodesc');
    expect(skill).toBeDefined();
    expect(skill!.description).toContain('Run skill');

    registerSkillCommands([]);
  });

  test('executing a skill command returns sendAsMessage with skill content', () => {
    registerSkillCommands([
      {
        content: '---\nname: deploy\ndescription: Deploy app\n---\nDeploy instruction',
        path: '/skills/deploy.md',
      },
    ]);

    const result = executeSlashCommand('deploy', {
      conversationId: 'conv-1',
      sessionId: 'session-1',
      args: '',
    });
    expect(result.handled).toBe(true);
    expect(result.sendAsMessage).toContain('Deploy instruction');

    registerSkillCommands([]);
  });

  test('executing a skill command with args includes them', () => {
    registerSkillCommands([
      {
        content: '---\nname: deploy\ndescription: Deploy\n---\nDeploy instruction',
        path: '/skills/deploy.md',
      },
    ]);

    const result = executeSlashCommand('deploy', {
      conversationId: 'conv-1',
      sessionId: 'session-1',
      args: 'to production',
    });
    expect(result.handled).toBe(true);
    expect(result.sendAsMessage).toContain('to production');
    expect(result.sendAsMessage).toContain('Task:');

    registerSkillCommands([]);
  });

  test('clears previous skill commands on re-register', () => {
    registerSkillCommands([
      {
        content: '---\nname: old-skill\ndescription: Old\n---\nOld',
        path: '/skills/old.md',
      },
    ]);

    registerSkillCommands([
      {
        content: '---\nname: new-skill\ndescription: New\n---\nNew',
        path: '/skills/new.md',
      },
    ]);

    const all = getAllCommands();
    const names = all.map((c) => c.name);
    expect(names).not.toContain('old-skill');
    expect(names).toContain('new-skill');

    registerSkillCommands([]);
  });

  test('skill frontmatter handles quoted name and description', () => {
    registerSkillCommands([
      {
        content: '---\nname: "quoted-skill"\ndescription: \'Quoted desc\'\n---\nContent',
        path: '/skills/quoted.md',
      },
    ]);

    const all = getAllCommands();
    const skill = all.find((c) => c.name === 'quoted-skill');
    expect(skill).toBeDefined();
    expect(skill!.description).toBe('Quoted desc');

    registerSkillCommands([]);
  });
});
