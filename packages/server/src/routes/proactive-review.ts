/**
 * Proactive AI Review — scans code for potential issues using LLM analysis.
 *
 * POST /api/review/proactive
 *   Body: { content, filePath, language }
 *   Returns: { ok, data: { warnings: ProactiveWarning[] } }
 */

import { Hono } from 'hono';
import { callLlm } from '../services/llm-oneshot';

export interface ProactiveWarning {
  line: number;
  message: string;
  severity: 'info' | 'warning' | 'error';
  category: string;
}

const SYSTEM_PROMPT = `You are an expert code reviewer embedded in an IDE. You proactively identify potential issues in code.

Analyze the provided code and identify:
- Potential bugs (null pointer issues, off-by-one errors, race conditions)
- Security concerns (injection, unvalidated input, hardcoded secrets)
- Performance issues (unnecessary re-renders, N+1 queries, memory leaks)
- Logic errors (unreachable code, wrong conditions, missing edge cases)
- Anti-patterns specific to the language/framework

Only report GENUINE issues that a senior developer would flag in code review. Do NOT flag:
- Style preferences or formatting
- Missing comments or documentation
- Minor naming suggestions
- Anything that's clearly intentional

Return a JSON array of warnings. Each warning has:
- "line": the 1-based line number where the issue is
- "message": a concise (1-2 sentence) description of the issue
- "severity": "info" | "warning" | "error"
- "category": one of "bug", "security", "performance", "logic", "pattern"

Return ONLY the JSON array, no markdown fencing, no explanation. If no issues are found, return an empty array: []`;

const app = new Hono();

app.post('/proactive', async (c) => {
  const body = await c.req.json();
  const { content, filePath, language } = body as {
    content: string;
    filePath?: string;
    language?: string;
  };

  if (!content) {
    return c.json({ ok: false, error: 'content is required' }, 400);
  }

  // Truncate very large files to keep prompt size reasonable
  const MAX_CONTENT = 8000;
  const truncated =
    content.length > MAX_CONTENT ? content.slice(0, MAX_CONTENT) + '\n// ...' : content;

  // Add line numbers for easier reference
  const numberedLines = truncated
    .split('\n')
    .map((line, i) => `${i + 1}: ${line}`)
    .join('\n');

  const userPrompt = [
    filePath ? `File: ${filePath}` : '',
    language ? `Language: ${language}` : '',
    '',
    numberedLines,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const result = await callLlm({
      system: SYSTEM_PROMPT,
      user: userPrompt,
      timeoutMs: 30_000,
    });

    // Parse the JSON response
    let warnings: ProactiveWarning[] = [];
    try {
      // Strip markdown fencing if present
      const cleaned = result
        .replace(/```json?\n?/g, '')
        .replace(/```\n?$/g, '')
        .trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        warnings = parsed
          .filter(
            (w: any) => typeof w.line === 'number' && typeof w.message === 'string' && w.line > 0,
          )
          .map((w: any) => ({
            line: w.line,
            message: String(w.message),
            severity: ['info', 'warning', 'error'].includes(w.severity) ? w.severity : 'info',
            category: String(w.category || 'pattern'),
          }));
      }
    } catch {
      // LLM returned non-JSON — treat as no warnings
      console.warn('[proactive-review] Failed to parse LLM response as JSON');
    }

    return c.json({ ok: true, data: { warnings } });
  } catch (err) {
    return c.json(
      {
        ok: false,
        error: `Proactive review failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      500,
    );
  }
});

export { app as proactiveReviewRoutes };
