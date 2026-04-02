/**
 * Brief Formatter Service
 *
 * Server-side wrapper for the brief output mode formatter.
 * Used by KAIROS daemon and other background agents.
 */

import type { OutputMode, BriefOutput, BriefFormatConfig } from '@e/shared';
import { formatBrief, renderBrief, DEFAULT_BRIEF_CONFIG } from '@e/shared';

/**
 * Format agent output based on the current output mode.
 */
export function formatAgentOutput(
  output: string,
  mode: OutputMode,
  config?: Partial<BriefFormatConfig>,
): string {
  switch (mode) {
    case 'silent':
      return '';
    case 'brief': {
      const brief = formatBrief(output, { ...DEFAULT_BRIEF_CONFIG, ...config });
      return renderBrief(brief);
    }
    case 'normal':
    default:
      return output;
  }
}

/**
 * Format agent output and return the structured BriefOutput.
 */
export function formatAgentOutputStructured(
  output: string,
  config?: Partial<BriefFormatConfig>,
): BriefOutput {
  return formatBrief(output, { ...DEFAULT_BRIEF_CONFIG, ...config });
}

/**
 * Apply brief formatting to a KAIROS daemon action result.
 */
export function formatKairosResult(
  rawOutput: string,
  mode: OutputMode,
): { formatted: string; brief?: BriefOutput } {
  if (mode === 'silent') return { formatted: '' };
  if (mode === 'normal') return { formatted: rawOutput };

  const brief = formatBrief(rawOutput);
  return {
    formatted: renderBrief(brief),
    brief,
  };
}
