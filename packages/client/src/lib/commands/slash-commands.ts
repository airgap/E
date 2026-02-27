import { settingsStore } from '$lib/stores/settings.svelte';
import { conversationStore } from '$lib/stores/conversation.svelte';
import { streamStore } from '$lib/stores/stream.svelte';
import { uiStore } from '$lib/stores/ui.svelte';
import { api } from '$lib/api/client';
import { uuid } from '$lib/utils/uuid';

export interface SlashCommandContext {
  conversationId: string | null;
  sessionId: string | null;
  args: string;
}

export interface SlashCommandResult {
  handled: boolean;
  sendAsMessage?: string;
}

interface SlashCommand {
  name: string;
  description: string;
  execute: (ctx: SlashCommandContext) => SlashCommandResult | Promise<SlashCommandResult>;
}

const commands: SlashCommand[] = [
  {
    name: 'clear',
    description: 'Clear chat display',
    execute: () => {
      if (conversationStore.active) {
        conversationStore.active.messages = [];
      }
      return { handled: true };
    },
  },
  {
    name: 'help',
    description: 'Show help information',
    execute: () => {
      const helpText = COMMANDS.map((c) => `/${c.name} — ${c.description}`).join('\n');
      if (conversationStore.active) {
        conversationStore.addMessage({
          id: uuid(),
          role: 'system',
          content: [{ type: 'text', text: `Available commands:\n${helpText}` }],
          timestamp: Date.now(),
        });
      }
      return { handled: true };
    },
  },
  {
    name: 'memory',
    description: 'View and edit memory files',
    execute: () => {
      uiStore.setSidebarTab('memory');
      uiStore.setSidebarOpen(true);
      return { handled: true };
    },
  },
  {
    name: 'config',
    description: 'Open settings',
    execute: () => {
      uiStore.openSettings();
      return { handled: true };
    },
  },
  {
    name: 'theme',
    description: 'Switch theme',
    execute: (ctx) => {
      const name = ctx.args.trim();
      if (name) {
        const validThemes = [
          'dark',
          'light',
          'dark-colorblind',
          'light-colorblind',
          'dark-ansi',
          'light-ansi',
          'high-contrast',
          'high-contrast-light',
        ];
        if (validThemes.includes(name)) {
          settingsStore.setTheme(name as any);
        }
      } else {
        // Cycle through themes
        const themes = [
          'dark',
          'light',
          'dark-colorblind',
          'light-colorblind',
          'dark-ansi',
          'light-ansi',
          'high-contrast',
          'high-contrast-light',
        ] as const;
        const idx = themes.indexOf(settingsStore.theme as (typeof themes)[number]);
        settingsStore.setTheme(themes[(idx < 0 ? 0 : idx + 1) % themes.length]);
      }
      return { handled: true };
    },
  },
  {
    name: 'model',
    description: 'Switch model',
    execute: (ctx) => {
      const modelArg = ctx.args.trim().toLowerCase();
      const modelMap: Record<string, string> = {
        opus: 'claude-opus-4-6',
        sonnet: 'claude-sonnet-4-6',
        haiku: 'claude-haiku-4-5-20251001',
      };
      const modelId = modelMap[modelArg] || modelArg;
      if (modelId) {
        settingsStore.setModel(modelId);
        if (conversationStore.activeId) {
          api.conversations.update(conversationStore.activeId, { model: modelId });
        }
      }
      return { handled: true };
    },
  },
  {
    name: 'plan',
    description: 'Toggle plan mode',
    execute: () => {
      if (conversationStore.active) {
        const newMode = !conversationStore.active.planMode;
        conversationStore.setPlanMode(newMode);
        const updates: Record<string, any> = { planMode: newMode };
        // Clear teach when enabling plan (mutual exclusivity)
        if (newMode && conversationStore.active.permissionMode === 'teach') {
          updates.permissionMode = settingsStore.permissionMode;
          conversationStore.setActive({
            ...conversationStore.active,
            planMode: newMode,
            permissionMode: settingsStore.permissionMode,
          });
        }
        if (conversationStore.activeId) {
          api.conversations.update(conversationStore.activeId, updates);
        }
      }
      return { handled: true };
    },
  },
  {
    name: 'teach',
    description: 'Toggle teach me mode',
    execute: () => {
      if (conversationStore.active) {
        const isTeach = conversationStore.active.permissionMode === 'teach';
        const newPermissionMode = isTeach ? settingsStore.permissionMode : 'teach';
        // Clear plan when enabling teach (mutual exclusivity)
        if (!isTeach) {
          conversationStore.setPlanMode(false);
        }
        conversationStore.setActive({
          ...conversationStore.active,
          planMode: isTeach ? conversationStore.active.planMode : false,
          permissionMode: newPermissionMode,
        });
        if (conversationStore.activeId) {
          api.conversations.update(conversationStore.activeId, {
            planMode: false,
            permissionMode: newPermissionMode,
          });
        }
      }
      return { handled: true };
    },
  },
  {
    name: 'permissions',
    description: 'Change permission mode',
    execute: (ctx) => {
      const mode = ctx.args.trim().toLowerCase();
      const validModes = ['plan', 'safe', 'fast', 'unrestricted'];
      if (validModes.includes(mode)) {
        settingsStore.setPermissionMode(mode as any);
      }
      return { handled: true };
    },
  },
  {
    name: 'cost',
    description: 'Show token/cost information',
    execute: async (ctx) => {
      if (ctx.conversationId) {
        try {
          const res = await api.conversations.cost(ctx.conversationId);
          const d = res.data;
          const msg = `Token usage: ${d.totalTokens.toLocaleString()} total (${d.inputTokens.toLocaleString()} in / ${d.outputTokens.toLocaleString()} out)\nEstimated cost: $${d.estimatedCostUsd.toFixed(4)}\nModel: ${d.model}`;
          conversationStore.addMessage({
            id: uuid(),
            role: 'system',
            content: [{ type: 'text', text: msg }],
            timestamp: Date.now(),
          });
        } catch {
          // Failed to fetch cost
        }
      }
      return { handled: true };
    },
  },
  {
    name: 'status',
    description: 'Show session info',
    execute: () => {
      const parts = [
        `Session: ${streamStore.sessionId || 'none'}`,
        `Status: ${streamStore.status}`,
        `Model: ${settingsStore.model}`,
        `Permission: ${settingsStore.permissionMode}`,
        `Effort: ${settingsStore.effort}`,
      ];
      if (conversationStore.active) {
        parts.push(`Conversation: ${conversationStore.active.id}`);
        parts.push(`Messages: ${conversationStore.active.messages.length}`);
        if (conversationStore.active.cliSessionId) {
          parts.push(`CLI Session: ${conversationStore.active.cliSessionId}`);
        }
      }
      conversationStore.addMessage({
        id: uuid(),
        role: 'system',
        content: [{ type: 'text', text: parts.join('\n') }],
        timestamp: Date.now(),
      });
      return { handled: true };
    },
  },
  {
    name: 'mcp',
    description: 'Manage MCP servers',
    execute: () => {
      uiStore.closeModal();
      uiStore.setSidebarTab('mcp');
      return { handled: true };
    },
  },
  {
    name: 'compact',
    description: 'Compress conversation history',
    execute: (ctx) => {
      // Send as a message to the Claude CLI which handles /compact natively
      return { handled: true, sendAsMessage: '/compact' };
    },
  },
  {
    name: 'init',
    description: 'Initialize project with CLAUDE.md',
    execute: () => {
      return { handled: true, sendAsMessage: '/init' };
    },
  },
  {
    name: 'e-init',
    description: 'Initialize project with E.md',
    execute: () => {
      return {
        handled: true,
        sendAsMessage:
          'Create an E.md file in the project root. Analyze the project structure, tech stack, and conventions. Write a comprehensive E.md that describes the project, its key conventions, important patterns, and guidelines for working in this codebase. Follow the same format as a CLAUDE.md file — include project overview, key architecture decisions, coding conventions, and common patterns.',
      };
    },
  },
  {
    name: 'commit',
    description: 'Create a git commit from changes',
    execute: () => {
      return {
        handled: true,
        sendAsMessage:
          'Create a git commit for the current changes. Review the diff, write a good commit message, and commit.',
      };
    },
  },
  {
    name: 'review-pr',
    description: 'Review a pull request',
    execute: (ctx) => {
      const prRef = ctx.args.trim();
      const msg = prRef
        ? `Review pull request ${prRef}. Check for bugs, security issues, and code quality.`
        : 'Review the current pull request. Check for bugs, security issues, and code quality.';
      return { handled: true, sendAsMessage: msg };
    },
  },
  {
    name: 'loop',
    description: 'Open Golem / work panel',
    execute: (ctx) => {
      uiStore.setSidebarTab('work');
      uiStore.setSidebarOpen(true);
      return { handled: true };
    },
  },
  {
    name: 'prd',
    description: 'Open PRD / work panel',
    execute: () => {
      uiStore.setSidebarTab('work');
      uiStore.setSidebarOpen(true);
      return { handled: true };
    },
  },
  {
    name: 'work',
    description: 'Open work panel',
    execute: () => {
      uiStore.setSidebarTab('work');
      uiStore.setSidebarOpen(true);
      return { handled: true };
    },
  },
  {
    name: 'import',
    description: 'Import issues from Jira/Linear/Asana',
    execute: () => {
      uiStore.setSidebarTab('work');
      uiStore.setSidebarOpen(true);
      uiStore.openModal('external-provider-config');
      return { handled: true };
    },
  },
];

// Dynamically registered skill commands (from installed SKILL.md files)
const skillCommands: SlashCommand[] = [];

/**
 * Parse frontmatter from a SKILL.md string to extract name and description.
 */
function parseSkillFrontmatter(content: string): { name: string; description: string } | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const yaml = match[1];
  const nameMatch = yaml.match(/^name:\s*(.+)$/m);
  const descMatch = yaml.match(/^description:\s*(.+)$/m);
  if (!nameMatch) return null;
  return {
    name: nameMatch[1].trim().replace(/^["']|["']$/g, ''),
    description: descMatch ? descMatch[1].trim().replace(/^["']|["']$/g, '') : '',
  };
}

/**
 * Register installed skills as slash commands.
 * Called when memory files are loaded so skill commands appear in the menu.
 */
export function registerSkillCommands(skillFiles: Array<{ content: string; path: string }>): void {
  // Clear previous skill commands
  skillCommands.length = 0;

  for (const file of skillFiles) {
    const fm = parseSkillFrontmatter(file.content);
    if (!fm || !fm.name) continue;

    // Sanitize: only lowercase alphanumeric + hyphens
    const cmdName = fm.name.toLowerCase().replace(/[^a-z0-9-]/g, '-');

    // Don't override built-in commands
    if (commands.find((c) => c.name === cmdName)) continue;

    const skillContent = file.content;
    skillCommands.push({
      name: cmdName,
      description: fm.description || `Run skill: ${fm.name}`,
      execute: (ctx: SlashCommandContext) => {
        // Send the skill content + user args as a message to the AI
        const userMsg = ctx.args
          ? `Use the following skill:\n\n${skillContent}\n\nTask: ${ctx.args}`
          : `Use the following skill:\n\n${skillContent}`;
        return { handled: true, sendAsMessage: userMsg };
      },
    });
  }
}

// Export for use in SlashCommandMenu — includes both built-in and skill commands
export const COMMANDS = commands.map((c) => ({ name: c.name, description: c.description }));

export function getAllCommands(): Array<{ name: string; description: string }> {
  return [
    ...commands.map((c) => ({ name: c.name, description: c.description })),
    ...skillCommands.map((c) => ({ name: c.name, description: c.description })),
  ];
}

export function executeSlashCommand(name: string, ctx: SlashCommandContext): SlashCommandResult {
  // Check built-in commands first
  const cmd = commands.find((c) => c.name === name);
  if (cmd) {
    const result = cmd.execute(ctx);
    if (result instanceof Promise) {
      result.catch(console.error);
      return { handled: true };
    }
    return result;
  }

  // Check skill commands
  const skillCmd = skillCommands.find((c) => c.name === name);
  if (skillCmd) {
    const result = skillCmd.execute(ctx);
    if (result instanceof Promise) {
      result.catch(console.error);
      return { handled: true };
    }
    return result;
  }

  return { handled: false };
}
