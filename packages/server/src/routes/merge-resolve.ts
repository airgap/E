/**
 * AI-assisted merge conflict resolution route.
 * POST /api/git/ai-merge — sends conflict context to LLM for resolution.
 */

import { Hono } from 'hono';
import { callLlm } from '../services/llm-oneshot';

export const mergeResolveRoutes = new Hono();

interface AiMergeRequest {
  workspacePath: string;
  filePath: string;
  fileContent: string;
  region: {
    startLine: number;
    sepLine: number;
    endLine: number;
    currentLabel: string;
    incomingLabel: string;
  };
}

mergeResolveRoutes.post('/ai-merge', async (c) => {
  try {
    const body = (await c.req.json()) as AiMergeRequest;
    const { filePath, fileContent, region } = body;

    if (!filePath || !fileContent || !region) {
      return c.json({ ok: false, error: 'Missing required fields' }, 400);
    }

    const lines = fileContent.split('\n');

    // Extract the conflict block (including markers)
    const conflictBlock = lines.slice(region.startLine - 1, region.endLine).join('\n');

    // Get surrounding context (5 lines before and after)
    const contextBefore = lines
      .slice(Math.max(0, region.startLine - 6), region.startLine - 1)
      .join('\n');
    const contextAfter = lines.slice(region.endLine, region.endLine + 5).join('\n');

    const system = `You are an expert programmer helping to resolve Git merge conflicts.
You will be given a merge conflict block with surrounding context from a file.
Your task is to produce the BEST resolution that:
1. Preserves the intent of BOTH changes when possible
2. Resolves any logical conflicts intelligently
3. Produces clean, correct code

IMPORTANT: Return ONLY the resolved code that should replace the entire conflict block (from <<<<<<< to >>>>>>>).
Do NOT include the conflict markers themselves.
Do NOT include any explanation, markdown formatting, or code fences.
Return ONLY the raw resolved code.`;

    const user = `File: ${filePath}

Context before the conflict:
\`\`\`
${contextBefore}
\`\`\`

Conflict block:
\`\`\`
${conflictBlock}
\`\`\`

Context after the conflict:
\`\`\`
${contextAfter}
\`\`\`

Current branch: ${region.currentLabel}
Incoming branch: ${region.incomingLabel}

Resolve this merge conflict. Return ONLY the resolved code.`;

    const result = await callLlm({ system, user, timeoutMs: 30000 });

    if (!result || result.trim() === '') {
      return c.json({ ok: false, error: 'LLM returned empty response' });
    }

    return c.json({
      ok: true,
      data: { mergedText: result.trim() },
    });
  } catch (err) {
    console.error('[ai-merge] Error:', err);
    return c.json({ ok: false, error: String(err) }, 500);
  }
});
