/**
 * ai-actions.ts — Server route for inline AI code actions.
 *
 * POST /api/ai/code-action
 *
 * Takes selected code + action type, runs a targeted LLM prompt,
 * and returns the result. Used by the editor context menu for
 * Explain, Optimize, Generate Test, Simplify, and Fix Diagnostic.
 */

import { Hono } from 'hono';
import { callLlm } from '../services/llm-oneshot';

const app = new Hono();

// ── Action Prompt Templates ──

interface ActionTemplate {
  system: string;
  /** Build the user prompt from code + optional context */
  buildUser: (code: string, context?: ActionContext) => string;
}

interface ActionContext {
  /** File path for additional context */
  filePath?: string;
  /** Language identifier (e.g. "typescript", "python") */
  language?: string;
  /** Diagnostic message for fix-diagnostic action */
  diagnosticMessage?: string;
  /** Custom user instruction for the "custom" action */
  customPrompt?: string;
}

const ACTION_TEMPLATES: Record<string, ActionTemplate> = {
  explain: {
    system:
      'You are a code explanation expert. Explain the provided code concisely in 2-4 sentences. ' +
      'Focus on what it does, not how to use it. Use clear, simple language. ' +
      'If the code has notable patterns or potential issues, mention them briefly.',
    buildUser: (code, ctx) => {
      const lang = ctx?.language ? ` (${ctx.language})` : '';
      return `Explain this code${lang}:\n\n\`\`\`\n${code}\n\`\`\``;
    },
  },

  optimize: {
    system:
      'You are a performance optimization expert. Return an optimized version of the provided code. ' +
      'Include a brief 1-2 line explanation of what you changed and why. ' +
      'Only optimize if there are genuine improvements. If already optimal, say so. ' +
      'Return the code in a fenced code block.',
    buildUser: (code, ctx) => {
      const lang = ctx?.language ? ` (${ctx.language})` : '';
      return `Optimize this code${lang}:\n\n\`\`\`\n${code}\n\`\`\``;
    },
  },

  'generate-test': {
    system:
      'You are a testing expert. Write comprehensive unit tests for the provided code. ' +
      'Use the most appropriate test framework for the language. ' +
      'Include edge cases and error conditions. Return only the test code in a fenced code block.',
    buildUser: (code, ctx) => {
      const lang = ctx?.language ? ` (${ctx.language})` : '';
      const file = ctx?.filePath ? `\nFile: ${ctx.filePath}` : '';
      return `Write unit tests for this code${lang}:${file}\n\n\`\`\`\n${code}\n\`\`\``;
    },
  },

  simplify: {
    system:
      'You are a code readability expert. Return a simpler, more readable equivalent of the provided code. ' +
      'Maintain the exact same behavior. Include a brief explanation of what you simplified. ' +
      'Return the code in a fenced code block.',
    buildUser: (code, ctx) => {
      const lang = ctx?.language ? ` (${ctx.language})` : '';
      return `Simplify this code${lang}:\n\n\`\`\`\n${code}\n\`\`\``;
    },
  },

  'fix-diagnostic': {
    system:
      'You are a bug-fixing expert. Given code with an error/warning diagnostic, ' +
      'return only the fixed version of the code in a fenced code block. ' +
      'Include a brief 1-line explanation of the fix.',
    buildUser: (code, ctx) => {
      const lang = ctx?.language ? ` (${ctx.language})` : '';
      const diag = ctx?.diagnosticMessage || 'unknown error';
      return `Fix this diagnostic error${lang}:\n\nError: ${diag}\n\nCode:\n\`\`\`\n${code}\n\`\`\``;
    },
  },

  document: {
    system:
      'You are a documentation expert. Add comprehensive JSDoc/docstring comments to the provided code. ' +
      'Document parameters, return values, and behavior. Keep the code unchanged. ' +
      'Return the documented code in a fenced code block.',
    buildUser: (code, ctx) => {
      const lang = ctx?.language ? ` (${ctx.language})` : '';
      return `Add documentation to this code${lang}:\n\n\`\`\`\n${code}\n\`\`\``;
    },
  },

  custom: {
    system:
      "You are an expert software engineer. Follow the user's instruction precisely. " +
      'If the instruction asks for code changes, return the modified code in a fenced code block. ' +
      'If it asks for an explanation, be concise and clear.',
    buildUser: (code, ctx) => {
      const lang = ctx?.language ? ` (${ctx.language})` : '';
      const instruction = ctx?.customPrompt || 'Improve this code';
      return `${instruction}\n\nCode${lang}:\n\`\`\`\n${code}\n\`\`\``;
    },
  },
};

// ── Route ──

app.post('/code-action', async (c) => {
  let body: {
    code: string;
    action: string;
    filePath?: string;
    language?: string;
    diagnosticMessage?: string;
    customPrompt?: string;
  };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const { code, action, filePath, language, diagnosticMessage, customPrompt } = body;

  if (!code || typeof code !== 'string') {
    return c.json({ ok: false, error: 'code is required (string)' }, 400);
  }

  if (!action || typeof action !== 'string') {
    return c.json({ ok: false, error: 'action is required (string)' }, 400);
  }

  const template = ACTION_TEMPLATES[action];
  if (!template) {
    return c.json(
      {
        ok: false,
        error: `Unknown action: ${action}. Valid: ${Object.keys(ACTION_TEMPLATES).join(', ')}`,
      },
      400,
    );
  }

  const context: ActionContext = { filePath, language, diagnosticMessage, customPrompt };

  try {
    const result = await callLlm({
      system: template.system,
      user: template.buildUser(code, context),
      timeoutMs: 60_000,
    });

    return c.json({
      ok: true,
      data: { result, action },
    });
  } catch (err: any) {
    return c.json({ ok: false, error: err?.message || 'AI code action failed' }, 500);
  }
});

/** List available actions */
app.get('/actions', (c) => {
  const actions = Object.keys(ACTION_TEMPLATES).map((name) => ({
    name,
    label: name.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase()),
  }));
  return c.json({ ok: true, data: { actions } });
});

export { app as aiActionRoutes };
