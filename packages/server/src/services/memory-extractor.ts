/**
 * LLM-based memory extractor — uses AI to identify patterns, conventions,
 * and decisions from conversation messages and commit history.
 *
 * Produces structured workspace memories with categories and confidence scores.
 */

import { callLlm } from './llm-oneshot';
import type { MemoryCategory } from '@e/shared';

export interface ExtractedMemory {
  category: MemoryCategory;
  key: string;
  content: string;
  confidence: number;
}

const EXTRACTION_SYSTEM_PROMPT = `You are a workspace memory extraction system for an AI IDE. Your job is to analyze conversation messages and identify reusable knowledge about the project's conventions, architecture, and patterns.

Extract memories into these categories:
- "convention": Coding conventions, formatting rules, style preferences
- "decision": Architecture decisions, technology choices, design trade-offs
- "preference": User preferences about tooling, workflow, or behavior
- "pattern": Common code patterns, idioms, or templates used in the project
- "context": General project context (what it does, who uses it, constraints)
- "architecture": System architecture details (how services connect, data flow, module structure)
- "naming": Naming conventions (file names, variable names, function names, component names)
- "forbidden": Things explicitly banned or to be avoided (anti-patterns, deprecated APIs)
- "testing": Testing conventions, preferred frameworks, coverage expectations

Rules:
- Only extract GENUINE project knowledge, not general programming wisdom
- Each memory should be a concise, reusable fact about THIS project
- Key should be a short (2-6 word) identifier
- Content should be a clear, actionable description
- Confidence: 0.9 for explicitly stated rules, 0.6-0.8 for inferred patterns, 0.4-0.5 for weak signals
- Skip trivial or obvious information

Return a JSON array of objects with fields: category, key, content, confidence
Return ONLY the JSON array, no markdown fencing. If nothing useful, return: []`;

const COMMIT_EXTRACTION_SYSTEM_PROMPT = `You are a workspace memory extraction system. Analyze these recent git commits and identify patterns about:
- Naming conventions (branch names, commit message style, file/folder naming)
- Architecture patterns (where new features go, how code is organized)
- Testing patterns (what gets tested, test file naming/location)
- Forbidden patterns (things being removed or migrated away from)

Return a JSON array of objects with fields: category, key, content, confidence
Categories: convention, decision, preference, pattern, context, architecture, naming, forbidden, testing
Confidence: 0.5-0.7 for patterns (higher if more consistent evidence)
Return ONLY the JSON array, no markdown fencing. If nothing useful, return: []`;

/**
 * Extract memories from conversation messages using LLM analysis.
 * Falls back to empty array on failure.
 */
export async function extractMemoriesFromConversation(
  messages: Array<{ role: string; content: string }>,
): Promise<ExtractedMemory[]> {
  // Truncate to keep within prompt size limits
  const MAX_CHARS = 12000;
  let text = '';
  for (const msg of messages) {
    const prefix = msg.role === 'user' ? 'User: ' : 'Assistant: ';
    const addition = `${prefix}${msg.content}\n\n`;
    if (text.length + addition.length > MAX_CHARS) break;
    text += addition;
  }

  if (text.length < 50) return [];

  try {
    const result = await callLlm({
      system: EXTRACTION_SYSTEM_PROMPT,
      user: text,
      timeoutMs: 30_000,
    });

    return parseExtractedMemories(result);
  } catch {
    return [];
  }
}

/**
 * Extract memories from git commit messages using LLM analysis.
 */
export async function extractMemoriesFromCommits(
  commits: Array<{ message: string; files?: string[] }>,
): Promise<ExtractedMemory[]> {
  if (commits.length === 0) return [];

  const text = commits
    .slice(0, 30) // Limit to recent commits
    .map((c) => {
      let entry = `Commit: ${c.message}`;
      if (c.files?.length) {
        entry += `\nFiles: ${c.files.slice(0, 10).join(', ')}`;
      }
      return entry;
    })
    .join('\n\n');

  if (text.length < 50) return [];

  try {
    const result = await callLlm({
      system: COMMIT_EXTRACTION_SYSTEM_PROMPT,
      user: text,
      timeoutMs: 30_000,
    });

    return parseExtractedMemories(result);
  } catch {
    return [];
  }
}

/**
 * Parse LLM response into extracted memories.
 */
function parseExtractedMemories(response: string): ExtractedMemory[] {
  try {
    const cleaned = response
      .replace(/```json?\n?/g, '')
      .replace(/```\n?$/g, '')
      .trim();
    const parsed = JSON.parse(cleaned);

    if (!Array.isArray(parsed)) return [];

    const validCategories = new Set<string>([
      'convention',
      'decision',
      'preference',
      'pattern',
      'context',
      'architecture',
      'naming',
      'forbidden',
      'testing',
    ]);

    return parsed
      .filter(
        (m: any) =>
          typeof m.key === 'string' &&
          typeof m.content === 'string' &&
          m.key.length > 1 &&
          m.content.length > 3,
      )
      .map((m: any) => ({
        category: validCategories.has(m.category) ? m.category : 'pattern',
        key: String(m.key).slice(0, 80),
        content: String(m.content).slice(0, 500),
        confidence: Math.max(0, Math.min(1, Number(m.confidence) || 0.5)),
      }));
  } catch {
    return [];
  }
}
