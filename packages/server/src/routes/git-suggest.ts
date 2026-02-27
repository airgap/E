/**
 * AI-powered commit staging suggestions.
 *
 * Analyzes git diffs and groups changed files into logical commit groups,
 * each with a suggested commit message.
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { resolve } from 'path';
import { callLlm } from '../services/llm-oneshot';
import { parseCommitFailure } from './git/helpers';

const app = new Hono();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function run(
  args: string[],
  opts: { cwd: string },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(args, {
    cwd: opts.cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

function validateWorkspacePath(rawPath: string): {
  valid: boolean;
  resolved: string;
  reason?: string;
} {
  const resolved = resolve(rawPath);
  const blockedPrefixes = ['/proc', '/sys', '/dev', '/boot', '/sbin'];
  for (const prefix of blockedPrefixes) {
    if (resolved.startsWith(prefix)) {
      return { valid: false, resolved, reason: `Path ${prefix} is not a valid workspace` };
    }
  }
  return { valid: true, resolved };
}

// ---------------------------------------------------------------------------
// JSON extraction — handle noisy LLM output
// ---------------------------------------------------------------------------

/**
 * Robustly extract a JSON array from LLM output that may contain:
 * - `<think>...</think>` blocks (qwen3 and similar reasoning models)
 * - Markdown fences (```json ... ```)
 * - Explanatory text before/after the JSON
 * - Trailing commas in arrays/objects
 * - Single quotes instead of double quotes
 * - JavaScript-style comments
 * - Unquoted property keys
 */
function extractJsonArray(raw: string): string {
  let text = raw.trim();

  // 1. Strip <think>...</think> blocks (greedy — may appear multiple times)
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // 2. Strip markdown fences (may appear multiple times or wrap the whole output)
  text = text.replace(/```(?:json|jsonc)?\s*\n?/gi, '').trim();

  // 3. If the whole thing parses, great
  try {
    JSON.parse(text);
    return text;
  } catch {
    // continue to extraction
  }

  // 4. Find the outermost [...] bracket pair
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start !== -1 && end > start) {
    let candidate = text.slice(start, end + 1);

    // Try raw candidate first before any repair
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // continue to repair
    }

    candidate = repairJson(candidate);

    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // last resort — return as-is and let caller handle the parse error
    }
  }

  return text;
}

/**
 * Attempt to repair common JSON mistakes from small language models.
 */
function repairJson(input: string): string {
  let text = input;

  // Strip single-line comments (// ...)
  text = text.replace(/\/\/[^\n]*/g, '');

  // Strip multi-line comments (/* ... */)
  text = text.replace(/\/\*[\s\S]*?\*\//g, '');

  // Fix trailing commas before ] or } (very common)
  text = text.replace(/,\s*([\]}])/g, '$1');

  // Try parsing after comment/comma fixes — this handles most cases
  try {
    JSON.parse(text);
    return text;
  } catch {
    // continue to more aggressive repairs
  }

  // Replace single-quoted strings with double-quoted strings.
  // This is tricky — we walk character by character to avoid breaking
  // apostrophes inside double-quoted strings.
  text = replaceSingleQuotedStrings(text);

  // Fix unquoted property keys: { name: "..." } → { "name": "..." }
  // Match word chars before a colon that aren't inside quotes
  text = text.replace(/(?<=[\{,]\s*)([a-zA-Z_]\w*)(?=\s*:)/g, '"$1"');

  // Fix escaped single quotes that are now inside double quotes
  text = text.replace(/\\'/g, "'");

  return text;
}

/**
 * Replace single-quoted JSON strings with double-quoted ones.
 * Walks the string character by character to correctly handle
 * apostrophes inside already-double-quoted strings.
 */
function replaceSingleQuotedStrings(input: string): string {
  const chars = [...input];
  const result: string[] = [];
  let i = 0;

  while (i < chars.length) {
    const ch = chars[i];

    // Skip double-quoted strings entirely — they're already fine
    if (ch === '"') {
      result.push(ch);
      i++;
      while (i < chars.length) {
        if (chars[i] === '\\') {
          result.push(chars[i], chars[i + 1] ?? '');
          i += 2;
        } else if (chars[i] === '"') {
          result.push(chars[i]);
          i++;
          break;
        } else {
          result.push(chars[i]);
          i++;
        }
      }
      continue;
    }

    // Convert single-quoted strings to double-quoted
    if (ch === "'") {
      result.push('"');
      i++;
      while (i < chars.length) {
        if (chars[i] === '\\' && chars[i + 1] === "'") {
          // Escaped single quote → just the quote
          result.push("'");
          i += 2;
        } else if (chars[i] === '\\') {
          result.push(chars[i], chars[i + 1] ?? '');
          i += 2;
        } else if (chars[i] === "'") {
          result.push('"');
          i++;
          break;
        } else if (chars[i] === '"') {
          // Escape double quotes that appear inside the string
          result.push('\\"');
          i++;
        } else {
          result.push(chars[i]);
          i++;
        }
      }
      continue;
    }

    result.push(ch);
    i++;
  }

  return result.join('');
}

// ---------------------------------------------------------------------------
// Grouping strategies
// ---------------------------------------------------------------------------

export interface CommitGroup {
  name: string;
  message: string;
  files: string[];
  reason: string;
}

/**
 * Strategy 1: Ask the LLM for a JSON array of groups.
 * Works well with larger models (Claude, GPT-4, large Ollama models).
 * Returns [] if parsing fails.
 */
async function tryJsonGrouping(
  changedFiles: string[],
  diffPrompt: string,
  opts?: { forceCliProvider?: boolean },
): Promise<CommitGroup[]> {
  try {
    const llmResult = await callLlm({
      forceCliProvider: opts?.forceCliProvider,
      system: `You are a JSON API. You ONLY output valid JSON arrays — nothing else.
You analyze git diffs and group changed files into logical atomic commits.

RULES:
- Each group = related files for one feature, fix, or refactoring
- Every input file must appear in exactly one group
- Commit messages: imperative mood, under 72 chars
- Output ONLY a JSON array. No text before or after. No markdown fences.

REQUIRED OUTPUT FORMAT (exact keys, double quotes, valid JSON):
[{"name":"group name","message":"feat: do something","files":["file1.ts"],"reason":"why"}]`,
      user: `Group these ${changedFiles.length} changed files into logical commit groups:\n\n${diffPrompt}`,
      timeoutMs: 60_000,
    });

    const cleaned = extractJsonArray(llmResult);
    const groups: CommitGroup[] = JSON.parse(cleaned);

    if (!Array.isArray(groups) || groups.length === 0) {
      throw new Error('Expected non-empty array');
    }

    // Validate each group has required fields
    for (const g of groups) {
      if (!g.name || !g.message || !Array.isArray(g.files)) {
        throw new Error('Group missing required fields');
      }
    }

    // The LLM may mangle file paths (truncate, add leading /, drop directory
    // prefixes, etc.). Filter each group to only include paths that actually
    // exist in changedFiles.  For near-misses, try to match by basename or
    // suffix so a response like "commits.ts" still maps to
    // "packages/server/src/routes/git/commits.ts".
    const changedSet = new Set(changedFiles);
    // Pre-build basename→path index for fast basename matching
    const basenameIndex = new Map<string, string[]>();
    for (const cf of changedFiles) {
      const bn = cf.split('/').pop() || cf;
      const list = basenameIndex.get(bn) || [];
      list.push(cf);
      basenameIndex.set(bn, list);
    }

    for (const g of groups) {
      g.files = g.files
        .map((f: string) => {
          // Clean common LLM noise: backticks, leading ./, leading /
          const trimmed = f
            .trim()
            .replace(/^`+|`+$/g, '')
            .replace(/^\.\//, '')
            .replace(/^\/+/, '')
            .replace(/:\d+.*$/, ''); // strip :linenum suffix
          // Exact match
          if (changedSet.has(trimmed)) return trimmed;
          // Suffix match — LLM dropped a leading directory segment
          const suffixMatch = changedFiles.find(
            (cf) => cf.endsWith(trimmed) || trimmed.endsWith(cf),
          );
          if (suffixMatch) return suffixMatch;
          // Basename match — LLM returned just the filename
          const bn = trimmed.split('/').pop() || trimmed;
          const bnMatches = basenameIndex.get(bn);
          if (bnMatches?.length === 1) return bnMatches[0];
          // No match — drop this path
          console.warn('[git/suggest] Dropping unrecognised path from LLM:', f);
          return null;
        })
        .filter((f: string | null): f is string => f !== null);
    }
    // Remove groups that ended up empty after filtering
    const validGroups = groups.filter((g) => g.files.length > 0);
    if (validGroups.length === 0) {
      throw new Error('No valid file paths after filtering LLM response');
    }

    // Ensure every known file is accounted for
    const assignedFiles = new Set(validGroups.flatMap((g) => g.files));
    const missing = changedFiles.filter((f) => !assignedFiles.has(f));
    if (missing.length > 0) {
      validGroups.push({
        name: 'Other changes',
        message: 'chore: miscellaneous changes',
        files: missing,
        reason: 'Files not covered by other groups',
      });
    }

    return validGroups;
  } catch (err) {
    console.warn('[git/suggest-commit-groups] JSON grouping failed:', (err as Error).message);
    return [];
  }
}

/**
 * Strategy 2: Text-based format that small local models handle much better.
 * Uses a simple line-based format instead of JSON.
 * Returns [] if parsing fails.
 */
async function tryTextGrouping(changedFiles: string[], diffPrompt: string): Promise<CommitGroup[]> {
  try {
    const fileList = changedFiles.map((f, i) => `${i + 1}. ${f}`).join('\n');

    const llmResult = await callLlm({
      system: `You group git changes into logical commits. Output ONLY in this exact format, nothing else:

GROUP: <short group name>
MESSAGE: <git commit message, imperative mood, under 72 chars>
FILES: <comma-separated file numbers from the list>
REASON: <one sentence why these belong together>

You may output multiple GROUP blocks. Every file number must appear exactly once.`,
      user: `Group these files into logical commits:\n\n${fileList}\n\nDiffs:\n${diffPrompt}`,
      timeoutMs: 60_000,
    });

    return parseTextGroups(llmResult, changedFiles);
  } catch (err) {
    console.warn('[git/suggest-commit-groups] Text grouping failed:', (err as Error).message);
    return [];
  }
}

/**
 * Parse the text-based group format into CommitGroup objects.
 */
function parseTextGroups(raw: string, changedFiles: string[]): CommitGroup[] {
  // Strip <think> blocks
  const text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  const groups: CommitGroup[] = [];
  let current: Partial<CommitGroup> & { fileNums?: number[] } = {};

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    const groupMatch = line.match(/^GROUP:\s*(.+)/i);
    const msgMatch = line.match(/^MESSAGE:\s*(.+)/i);
    const filesMatch = line.match(/^FILES:\s*(.+)/i);
    const reasonMatch = line.match(/^REASON:\s*(.+)/i);

    if (groupMatch) {
      // Flush previous group
      if (current.name && current.fileNums?.length) {
        groups.push({
          name: current.name,
          message: current.message || 'chore: update files',
          files: current.fileNums
            .filter((n) => n >= 1 && n <= changedFiles.length)
            .map((n) => changedFiles[n - 1]),
          reason: current.reason || '',
        });
      }
      current = { name: groupMatch[1].trim() };
    } else if (msgMatch) {
      current.message = msgMatch[1].trim();
    } else if (filesMatch) {
      // Parse "1, 3, 5" or "1,3,5" or "1 3 5"
      current.fileNums = filesMatch[1]
        .split(/[\s,]+/)
        .map((s) => parseInt(s, 10))
        .filter((n) => !isNaN(n));
    } else if (reasonMatch) {
      current.reason = reasonMatch[1].trim();
    }
  }

  // Flush last group
  if (current.name && current.fileNums?.length) {
    groups.push({
      name: current.name,
      message: current.message || 'chore: update files',
      files: current.fileNums
        .filter((n) => n >= 1 && n <= changedFiles.length)
        .map((n) => changedFiles[n - 1]),
      reason: current.reason || '',
    });
  }

  if (groups.length === 0) return [];

  // Add catch-all for missed files
  const assigned = new Set(groups.flatMap((g) => g.files));
  const missing = changedFiles.filter((f) => !assigned.has(f));
  if (missing.length > 0) {
    groups.push({
      name: 'Other changes',
      message: 'chore: miscellaneous changes',
      files: missing,
      reason: 'Files not covered by other groups',
    });
  }

  return groups;
}

// ---------------------------------------------------------------------------
// POST /suggest-commit-groups
// ---------------------------------------------------------------------------

app.post('/suggest-commit-groups', async (c) => {
  const body = await c.req.json();
  const { path: rootPath } = body;

  if (!rootPath) return c.json({ ok: false, error: 'path required' }, 400);

  const pathCheck = validateWorkspacePath(rootPath);
  if (!pathCheck.valid) {
    return c.json({ ok: false, error: pathCheck.reason }, 403);
  }

  try {
    // Get status of all changed files
    const statusResult = await run(['git', 'status', '--porcelain', '-uall'], {
      cwd: pathCheck.resolved,
    });

    if (!statusResult.stdout.trim()) {
      return c.json({ ok: false, error: 'No changes to group' }, 400);
    }

    // Parse file list from porcelain output.
    // IMPORTANT: Do NOT trim() stdout before splitting — trim strips the leading
    // space from the first line which is the staged-status column ("XY filename").
    // Stripping it shifts slice(3) by one, corrupting the first file path.
    const changedFiles: string[] = [];
    for (const line of statusResult.stdout.split('\n')) {
      if (line.length < 4) continue;
      // porcelain format: "XY filename" or "XY orig -> renamed"
      const file = line.slice(3).split(' -> ').pop()?.trim();
      if (file) changedFiles.push(file);
    }

    if (changedFiles.length === 0) {
      return c.json({ ok: false, error: 'No changed files found' }, 400);
    }

    // If there's only 1-2 files, just return a single group
    if (changedFiles.length <= 2) {
      const diffResult = await run(['git', 'diff', 'HEAD'], { cwd: pathCheck.resolved });
      let diffText = diffResult.stdout.trim();
      if (diffText.length > 8_000) {
        diffText = diffText.slice(0, 8_000) + '\n... [truncated]';
      }

      // Generate a message for the single group
      const message = await callLlm({
        system:
          'You generate concise git commit messages. Output ONLY the commit message, nothing else. ' +
          'Use the imperative mood. Keep it to one line, under 72 characters.',
        user: `Git diff:\n\`\`\`\n${diffText}\n\`\`\``,
        timeoutMs: 30_000,
      });

      return c.json({
        ok: true,
        data: {
          groups: [
            {
              name: 'All changes',
              message: message.trim(),
              files: changedFiles,
              reason: 'All changed files grouped together',
            },
          ],
        },
      });
    }

    // Gather per-file diffs (abbreviated)
    const fileDiffs: string[] = [];
    let totalDiffLen = 0;
    const MAX_TOTAL_DIFF = 16_000;
    const MAX_PER_FILE = 2_000;

    for (const file of changedFiles) {
      if (totalDiffLen > MAX_TOTAL_DIFF) {
        fileDiffs.push(`--- ${file}\n[diff omitted due to length]`);
        continue;
      }

      // Try staged diff first, then unstaged
      let diffResult = await run(['git', 'diff', '--cached', '--', file], {
        cwd: pathCheck.resolved,
      });
      if (!diffResult.stdout.trim()) {
        diffResult = await run(['git', 'diff', '--', file], { cwd: pathCheck.resolved });
      }
      if (!diffResult.stdout.trim()) {
        // Untracked file — show filename only
        fileDiffs.push(`--- ${file}\n[new untracked file]`);
        continue;
      }

      let diff = diffResult.stdout;
      if (diff.length > MAX_PER_FILE) {
        diff = diff.slice(0, MAX_PER_FILE) + '\n... [truncated]';
      }
      fileDiffs.push(`--- ${file}\n${diff}`);
      totalDiffLen += diff.length;
    }

    const prompt = fileDiffs.join('\n\n');

    // Try grouping with escalating capability:
    // 1. JSON format with default model (fast, works with large models)
    // 2. Text format with default model (easier for small local models)
    // 3. JSON format with CLI provider (Claude/Gemini — more capable but slower)
    // 4. Fallback: single group with all files
    let groups: CommitGroup[] = await tryJsonGrouping(changedFiles, prompt);

    if (!groups.length) {
      console.log('[git/suggest-commit-groups] JSON grouping failed, trying text-based format');
      groups = await tryTextGrouping(changedFiles, prompt);
    }

    if (!groups.length) {
      console.log('[git/suggest-commit-groups] Text grouping failed, escalating to CLI provider');
      groups = await tryJsonGrouping(changedFiles, prompt, { forceCliProvider: true });
    }

    if (!groups.length) {
      // Ultimate fallback: single group with all files.
      // Still try to generate a meaningful commit message — the simpler
      // "just give me a message" call usually succeeds even when structured
      // grouping output doesn't.
      let fallbackMessage = 'chore: update files';
      try {
        const diffResult = await run(['git', 'diff', 'HEAD'], { cwd: pathCheck.resolved });
        let diffText = diffResult.stdout.trim();
        if (diffText.length > 12_000) {
          diffText = diffText.slice(0, 12_000) + '\n... [truncated]';
        }
        const untrackedResult = await run(['git', 'ls-files', '--others', '--exclude-standard'], {
          cwd: pathCheck.resolved,
        });
        const untrackedFiles = untrackedResult.stdout.trim();

        let msgPrompt = '';
        if (diffText) msgPrompt += `Git diff:\n\`\`\`\n${diffText}\n\`\`\`\n`;
        if (untrackedFiles) msgPrompt += `\nNew untracked files:\n${untrackedFiles}\n`;

        if (msgPrompt) {
          const msg = await callLlm({
            system:
              'You generate concise git commit messages. Output ONLY the commit message, nothing else. ' +
              'Use the imperative mood. Keep it to one line, under 72 characters.',
            user: msgPrompt,
            timeoutMs: 30_000,
            forceCliProvider: true,
          });
          if (msg.trim()) fallbackMessage = msg.trim();
        }
      } catch (err) {
        console.warn('[git/suggest-commit-groups] Fallback message generation failed:', err);
      }

      groups = [
        {
          name: 'All changes',
          message: fallbackMessage,
          files: changedFiles,
          reason: 'All changed files grouped together',
        },
      ];
    }

    return c.json({ ok: true, data: { groups } });
  } catch (err) {
    console.error('[git/suggest-commit-groups] Error:', err);
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /smart-commit — one-click: analyze → group → stage → commit (streamed)
//
// Unlike suggest-commit-groups, this endpoint streams progress at every step
// and ALWAYS commits — if grouping fails it falls back to a single commit
// with a generated message. It never leaves the user with nothing.
// ---------------------------------------------------------------------------

/**
 * Generate a commit message from a diff (simple, non-structured LLM call).
 * This almost always succeeds even when structured-output grouping doesn't.
 */
async function generateCommitMessage(
  cwd: string,
  opts?: { forceCliProvider?: boolean },
): Promise<string> {
  const diffResult = await run(['git', 'diff', 'HEAD'], { cwd });
  let diffText = diffResult.stdout.trim();
  if (diffText.length > 12_000) {
    diffText = diffText.slice(0, 12_000) + '\n... [truncated]';
  }

  const untrackedResult = await run(['git', 'ls-files', '--others', '--exclude-standard'], { cwd });
  const untrackedFiles = untrackedResult.stdout.trim();

  let prompt = '';
  if (diffText) prompt += `Git diff:\n\`\`\`\n${diffText}\n\`\`\`\n`;
  if (untrackedFiles) prompt += `\nNew untracked files:\n${untrackedFiles}\n`;
  if (!prompt) prompt = 'No diff available.';

  const msg = await callLlm({
    system:
      'You generate concise git commit messages. Output ONLY the commit message, nothing else. ' +
      'Use the imperative mood. Keep it to one line, under 72 characters.',
    user: prompt,
    timeoutMs: 30_000,
    forceCliProvider: opts?.forceCliProvider,
  });

  return msg.trim() || 'chore: update files';
}

app.post('/smart-commit', async (c) => {
  const body = await c.req.json();
  const { path: rootPath } = body;

  if (!rootPath) return c.json({ ok: false, error: 'path required' }, 400);

  const pathCheck = validateWorkspacePath(rootPath);
  if (!pathCheck.valid) {
    return c.json({ ok: false, error: pathCheck.reason }, 403);
  }

  const cwd = pathCheck.resolved;

  return streamSSE(c, async (stream) => {
    const status = (message: string) =>
      stream.writeSSE({ data: JSON.stringify({ type: 'status', message }) });

    try {
      // ── 1. Discover changed files ──────────────────────────────────────
      await status('Scanning for changes…');

      const statusResult = await run(['git', 'status', '--porcelain', '-uall'], { cwd });
      if (!statusResult.stdout.trim()) {
        await stream.writeSSE({
          data: JSON.stringify({ type: 'error', message: 'No changes to commit' }),
        });
        return;
      }

      const changedFiles: string[] = [];
      for (const line of statusResult.stdout.split('\n')) {
        if (line.length < 4) continue;
        const file = line.slice(3).split(' -> ').pop()?.trim();
        if (file) changedFiles.push(file);
      }

      if (changedFiles.length === 0) {
        await stream.writeSSE({
          data: JSON.stringify({ type: 'error', message: 'No changed files found' }),
        });
        return;
      }

      await status(
        `Analyzing ${changedFiles.length} changed file${changedFiles.length === 1 ? '' : 's'}…`,
      );

      // ── 2. Gather diffs & determine groups ─────────────────────────────
      let groups: CommitGroup[] = [];

      if (changedFiles.length <= 2) {
        // Small changeset — skip grouping, just generate a message
        await status('Generating commit message…');
        const message = await generateCommitMessage(cwd);
        groups = [
          {
            name: 'All changes',
            message,
            files: changedFiles,
            reason: 'All changed files grouped together',
          },
        ];
      } else {
        // Multiple files — gather per-file diffs and attempt grouping
        const fileDiffs: string[] = [];
        let totalDiffLen = 0;
        const MAX_TOTAL_DIFF = 16_000;
        const MAX_PER_FILE = 2_000;

        for (const file of changedFiles) {
          if (totalDiffLen > MAX_TOTAL_DIFF) {
            fileDiffs.push(`--- ${file}\n[diff omitted due to length]`);
            continue;
          }
          let diffResult = await run(['git', 'diff', '--cached', '--', file], { cwd });
          if (!diffResult.stdout.trim()) {
            diffResult = await run(['git', 'diff', '--', file], { cwd });
          }
          if (!diffResult.stdout.trim()) {
            fileDiffs.push(`--- ${file}\n[new untracked file]`);
            continue;
          }
          let diff = diffResult.stdout;
          if (diff.length > MAX_PER_FILE) {
            diff = diff.slice(0, MAX_PER_FILE) + '\n... [truncated]';
          }
          fileDiffs.push(`--- ${file}\n${diff}`);
          totalDiffLen += diff.length;
        }

        const prompt = fileDiffs.join('\n\n');

        // Escalating grouping strategies with transparent status updates.
        // Each strategy catches its own errors — we stream the failure reason
        // instead of silently returning [].
        const strategies: Array<{
          label: string;
          fn: () => Promise<CommitGroup[]>;
        }> = [
          {
            label: 'Grouping changes…',
            fn: () => tryJsonGrouping(changedFiles, prompt),
          },
          {
            label: 'Trying alternative grouping…',
            fn: () => tryTextGrouping(changedFiles, prompt),
          },
          {
            label: 'Escalating to CLI provider…',
            fn: () => tryJsonGrouping(changedFiles, prompt, { forceCliProvider: true }),
          },
        ];

        for (const { label, fn } of strategies) {
          if (groups.length > 0) break;
          await status(label);
          try {
            groups = await fn();
          } catch (err) {
            console.warn('[git/smart-commit] Strategy "%s" threw:', label, (err as Error).message);
          }
        }

        // All grouping failed — fall back to single group with a generated message
        if (!groups.length) {
          await status('Generating commit message…');
          let message = 'chore: update files';
          try {
            message = await generateCommitMessage(cwd, { forceCliProvider: true });
          } catch (err) {
            console.warn('[git/smart-commit] Message generation also failed:', err);
          }
          groups = [
            {
              name: 'All changes',
              message,
              files: changedFiles,
              reason: 'All changed files committed together',
            },
          ];
        }
      }

      // ── 3. Send groups to client ───────────────────────────────────────
      await stream.writeSSE({
        data: JSON.stringify({
          type: 'groups',
          groups: groups.map((g, i) => ({
            index: i,
            name: g.name,
            message: g.message,
            files: g.files,
            reason: g.reason,
          })),
        }),
      });

      // ── 4. Commit each group atomically ────────────────────────────────
      const shas: string[] = [];
      const total = groups.length;

      for (let i = 0; i < groups.length; i++) {
        const g = groups[i];
        const isLast = i === groups.length - 1;

        await stream.writeSSE({
          data: JSON.stringify({
            type: 'committing',
            index: i,
            total,
            name: g.name,
            message: g.message,
            fileCount: g.files.length,
          }),
        });

        try {
          // Unstage everything
          const resetResult = await run(['git', 'reset', 'HEAD'], { cwd });
          if (resetResult.exitCode !== 0) {
            throw new Error(`git reset failed: ${resetResult.stderr.trim()}`);
          }

          // Stage only this group's files
          const addResult = await run(['git', 'add', '--ignore-errors', '--', ...g.files], { cwd });
          if (addResult.stderr.trim()) {
            console.warn('[git/smart-commit] git add warnings:', addResult.stderr.trim());
          }

          // Verify something staged
          const stagedExit = await run(['git', 'diff', '--cached', '--quiet'], { cwd });
          if (stagedExit.exitCode === 0) {
            // Nothing staged — try adding all files in the group explicitly
            // (handles untracked files that diff --cached doesn't see)
            await run(['git', 'add', '--', ...g.files], { cwd });
            const recheckExit = await run(['git', 'diff', '--cached', '--quiet'], { cwd });
            if (recheckExit.exitCode === 0) {
              await stream.writeSSE({
                data: JSON.stringify({
                  type: 'group-error',
                  index: i,
                  message: `Nothing staged for group "${g.name}" — files may already be committed or paths are wrong`,
                }),
              });
              continue;
            }
          }

          // Smart commit skips hooks on ALL groups — the whole point is
          // "just do it". Running lint-staged + nx typecheck + tests (98s+)
          // on every commit defeats the purpose of a one-click flow.
          const commitArgs = ['git', 'commit', '--no-verify', '-m', g.message];
          const commitResult = await run(commitArgs, { cwd });
          if (commitResult.exitCode !== 0) {
            const summary = parseCommitFailure(commitResult.stderr, commitResult.stdout);
            await stream.writeSSE({
              data: JSON.stringify({
                type: 'group-error',
                index: i,
                message: summary,
              }),
            });
            // If the last group's hooks failed, stop
            if (isLast) break;
            continue;
          }

          // Get SHA
          const shaResult = await run(['git', 'rev-parse', 'HEAD'], { cwd });
          const sha = shaResult.stdout.trim();
          shas.push(sha);

          await stream.writeSSE({
            data: JSON.stringify({
              type: 'committed',
              index: i,
              sha,
              name: g.name,
              message: g.message,
            }),
          });
        } catch (err) {
          await stream.writeSSE({
            data: JSON.stringify({
              type: 'group-error',
              index: i,
              message: String(err),
            }),
          });
        }
      }

      // ── 5. Done ────────────────────────────────────────────────────────
      await stream.writeSSE({
        data: JSON.stringify({
          type: 'complete',
          committed: shas.length,
          total,
          shas,
        }),
      });
    } catch (err) {
      console.error('[git/smart-commit] Unexpected error:', err);
      await stream.writeSSE({
        data: JSON.stringify({ type: 'error', message: String(err) }),
      });
    }
  });
});

export const gitSuggestRoutes = app;
