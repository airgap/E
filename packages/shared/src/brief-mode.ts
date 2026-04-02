/**
 * Brief Output Mode
 *
 * Condensed response formatter for KAIROS daemon and other background agents.
 * Transforms verbose LLM output into concise, structured responses.
 *
 * Three output modes:
 * - 'normal': Full verbose output (default for interactive sessions)
 * - 'brief': Condensed key points only (KAIROS daemon, background tasks)
 * - 'silent': No output, just actions (fire-and-forget background tasks)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type OutputMode = 'normal' | 'brief' | 'silent';

export interface BriefFormatConfig {
  /** Maximum lines in brief output */
  maxLines: number;
  /** Maximum characters per line */
  maxLineLength: number;
  /** Include action summaries (files changed, commands run) */
  includeActions: boolean;
  /** Include status indicators (success/fail icons) */
  includeStatus: boolean;
  /** Strip code blocks (keep only descriptions) */
  stripCodeBlocks: boolean;
  /** Strip markdown formatting */
  stripMarkdown: boolean;
}

export interface BriefOutput {
  /** One-line summary */
  headline: string;
  /** Key points (2-5 bullet points) */
  keyPoints: string[];
  /** Actions taken (file edits, commands, etc.) */
  actions: { type: 'edit' | 'create' | 'delete' | 'command' | 'info'; detail: string }[];
  /** Overall status */
  status: 'success' | 'partial' | 'failure' | 'info';
  /** Original output length vs brief length */
  compressionRatio: number;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_BRIEF_CONFIG: BriefFormatConfig = {
  maxLines: 8,
  maxLineLength: 120,
  includeActions: true,
  includeStatus: true,
  stripCodeBlocks: true,
  stripMarkdown: true,
};

// ─── Formatter ───────────────────────────────────────────────────────────────

/**
 * Transform verbose LLM output into brief format.
 */
export function formatBrief(
  input: string,
  config: BriefFormatConfig = DEFAULT_BRIEF_CONFIG,
): BriefOutput {
  const originalLength = input.length;
  let processed = input;

  // Strip code blocks
  if (config.stripCodeBlocks) {
    processed = processed.replace(/```[\s\S]*?```/g, '[code block]');
  }

  // Strip markdown formatting
  if (config.stripMarkdown) {
    processed = processed
      .replace(/#{1,6}\s+/g, '') // headers
      .replace(/\*\*([^*]+)\*\*/g, '$1') // bold
      .replace(/\*([^*]+)\*/g, '$1') // italic
      .replace(/`([^`]+)`/g, '$1') // inline code
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'); // links
  }

  // Split into lines and clean
  const lines = processed
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // Extract headline (first substantial line)
  const headline = lines[0]?.slice(0, config.maxLineLength) || 'No output';

  // Extract key points (lines starting with - or * or numbered)
  const bulletLines = lines.filter((l) => /^[-*•]\s/.test(l) || /^\d+[.)]\s/.test(l));
  const keyPoints = bulletLines
    .slice(0, 5)
    .map((l) => l.replace(/^[-*•\d.)]+\s*/, '').slice(0, config.maxLineLength));

  // If no bullets found, take first few non-headline lines
  if (keyPoints.length === 0) {
    for (const line of lines.slice(1, 4)) {
      if (line.length > 10) {
        keyPoints.push(line.slice(0, config.maxLineLength));
      }
    }
  }

  // Extract actions from common patterns
  const actions: BriefOutput['actions'] = [];
  if (config.includeActions) {
    for (const line of lines) {
      if (/\b(created?|wrote|added)\b.*\bfile/i.test(line)) {
        actions.push({ type: 'create', detail: line.slice(0, 80) });
      } else if (/\b(edited?|modified|updated|changed)\b/i.test(line)) {
        actions.push({ type: 'edit', detail: line.slice(0, 80) });
      } else if (/\b(deleted?|removed)\b/i.test(line)) {
        actions.push({ type: 'delete', detail: line.slice(0, 80) });
      } else if (/\b(ran|executed|running)\b.*\bcommand/i.test(line) || /^\$\s/.test(line)) {
        actions.push({ type: 'command', detail: line.slice(0, 80) });
      }
    }
  }

  // Determine status from content
  let status: BriefOutput['status'] = 'info';
  const lowerInput = input.toLowerCase();
  if (/\b(error|failed|failure|exception)\b/.test(lowerInput)) {
    status = 'failure';
  } else if (/\b(warning|partial|some)\b/.test(lowerInput)) {
    status = 'partial';
  } else if (/\b(success|completed|done|fixed|resolved)\b/.test(lowerInput)) {
    status = 'success';
  }

  const briefLength =
    headline.length + keyPoints.join('').length + actions.map((a) => a.detail).join('').length;

  return {
    headline,
    keyPoints,
    actions: actions.slice(0, 5),
    status,
    compressionRatio: originalLength > 0 ? briefLength / originalLength : 1,
  };
}

/**
 * Render a BriefOutput to a compact string.
 */
export function renderBrief(output: BriefOutput): string {
  const statusIcon =
    output.status === 'success'
      ? '[ok]'
      : output.status === 'failure'
        ? '[FAIL]'
        : output.status === 'partial'
          ? '[warn]'
          : '[i]';

  const parts: string[] = [`${statusIcon} ${output.headline}`];

  for (const point of output.keyPoints) {
    parts.push(`  - ${point}`);
  }

  if (output.actions.length > 0) {
    for (const action of output.actions) {
      const icon =
        action.type === 'create'
          ? '+'
          : action.type === 'delete'
            ? '-'
            : action.type === 'edit'
              ? '~'
              : '$';
      parts.push(`  ${icon} ${action.detail}`);
    }
  }

  return parts.join('\n');
}
