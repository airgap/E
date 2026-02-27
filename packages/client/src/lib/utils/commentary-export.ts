/**
 * Commentary Export Utilities
 *
 * Handles exporting commentary history in various formats:
 * - Markdown (timestamped list for documentation)
 * - JSON (structured data for analysis)
 * - Audio (TTS replay for sharing/review)
 */

import type { CommentaryEntry } from '$lib/stores/commentary.svelte';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExportFormat = 'markdown' | 'json' | 'audio';

export interface ExportOptions {
  format: ExportFormat;
  entries: CommentaryEntry[];
  workspacePath?: string;
  startTime?: number;
  endTime?: number;
}

export interface ExportMetadata {
  workspaceName: string;
  personality: string;
  exportDate: string;
  totalEntries: number;
  timeRange: {
    start: string;
    end: string;
  };
}

// ---------------------------------------------------------------------------
// Format Helpers
// ---------------------------------------------------------------------------

/**
 * Filter entries by time range if specified.
 */
function filterByTimeRange(
  entries: CommentaryEntry[],
  startTime?: number,
  endTime?: number,
): CommentaryEntry[] {
  return entries.filter((entry) => {
    if (startTime && entry.timestamp < startTime) return false;
    if (endTime && entry.timestamp > endTime) return false;
    return true;
  });
}

/**
 * Format timestamp as human-readable string.
 */
function formatTimestamp(timestamp: number, includeDate = true): string {
  const date = new Date(timestamp);

  if (includeDate) {
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Get metadata for the export.
 */
function getExportMetadata(entries: CommentaryEntry[], workspaceName: string): ExportMetadata {
  const timestamps = entries.map((e) => e.timestamp);
  const minTime = Math.min(...timestamps);
  const maxTime = Math.max(...timestamps);

  // Get the most common personality used
  const personalityCounts = entries.reduce(
    (acc, entry) => {
      acc[entry.personality] = (acc[entry.personality] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const primaryPersonality =
    Object.entries(personalityCounts).sort(([, a], [, b]) => b - a)[0]?.[0] || 'unknown';

  return {
    workspaceName,
    personality: primaryPersonality,
    exportDate: new Date().toISOString(),
    totalEntries: entries.length,
    timeRange: {
      start: formatTimestamp(minTime),
      end: formatTimestamp(maxTime),
    },
  };
}

// ---------------------------------------------------------------------------
// Export Functions
// ---------------------------------------------------------------------------

/**
 * Generate Markdown export content from commentary entries.
 */
export function exportAsMarkdown(options: ExportOptions): string {
  const filtered = filterByTimeRange(options.entries, options.startTime, options.endTime);

  if (filtered.length === 0) {
    throw new Error('No commentary entries to export');
  }

  const workspaceName = options.workspacePath?.split('/').pop() || 'Unknown Workspace';
  const metadata = getExportMetadata(filtered, workspaceName);

  let markdown = '';

  // Add metadata header
  markdown += `# Commentary Export\n\n`;
  markdown += `**Workspace:** ${metadata.workspaceName}\n\n`;
  markdown += `**Personality:** ${metadata.personality}\n\n`;
  markdown += `**Exported:** ${metadata.exportDate}\n\n`;
  markdown += `**Time Range:** ${metadata.timeRange.start} — ${metadata.timeRange.end}\n\n`;
  markdown += `**Total Entries:** ${metadata.totalEntries}\n\n`;
  markdown += `---\n\n`;

  // Add commentary entries
  markdown += `## Commentary Timeline\n\n`;

  for (const entry of filtered) {
    const time = formatTimestamp(entry.timestamp);
    const personality = entry.personality
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (l) => l.toUpperCase());

    markdown += `### ${time}\n`;
    markdown += `**Personality:** ${personality}\n\n`;
    markdown += `> ${entry.text}\n\n`;
  }

  return markdown;
}

/**
 * Generate JSON export content from commentary entries.
 */
export function exportAsJSON(options: ExportOptions): string {
  const filtered = filterByTimeRange(options.entries, options.startTime, options.endTime);

  if (filtered.length === 0) {
    throw new Error('No commentary entries to export');
  }

  const workspaceName = options.workspacePath?.split('/').pop() || 'Unknown Workspace';
  const metadata = getExportMetadata(filtered, workspaceName);

  const exportData = {
    metadata,
    entries: filtered.map((entry) => ({
      timestamp: entry.timestamp,
      timestampISO: new Date(entry.timestamp).toISOString(),
      text: entry.text,
      personality: entry.personality,
      workspaceId: entry.workspaceId,
    })),
  };

  return JSON.stringify(exportData, null, 2);
}

/**
 * Generate audio export (TTS replay) from commentary entries.
 * Due to browser limitations with Web Speech API recording, this generates
 * a text script that can be used with external TTS tools.
 */
export async function exportAsAudio(options: ExportOptions): Promise<Blob> {
  const filtered = filterByTimeRange(options.entries, options.startTime, options.endTime);

  if (filtered.length === 0) {
    throw new Error('No commentary entries to export');
  }

  // Check if Web Speech API is available
  if (!('speechSynthesis' in window)) {
    throw new Error('Text-to-speech is not supported in this browser');
  }

  const workspaceName = options.workspacePath?.split('/').pop() || 'Unknown Workspace';
  const metadata = getExportMetadata(filtered, workspaceName);

  let script = '';
  script += `Commentary Export - ${metadata.workspaceName}\n`;
  script += `Exported: ${metadata.exportDate}\n`;
  script += `Personality: ${metadata.personality}\n`;
  script += `Total Entries: ${metadata.totalEntries}\n\n`;
  script += `---\n\n`;

  for (let i = 0; i < filtered.length; i++) {
    const entry = filtered[i];
    const time = formatTimestamp(entry.timestamp, false);
    script += `[${i + 1}] ${time}: ${entry.text}\n\n`;
  }

  script += `\n---\n\nNote: This is a text transcript. For audio playback, use a text-to-speech tool with this script.`;

  // Return as text blob (audio export would require server-side TTS or MediaRecorder API)
  return new Blob([script], { type: 'text/plain' });
}

/**
 * Download exported content as a file.
 */
export function downloadExport(content: string | Blob, format: ExportFormat): void {
  const dateStr = new Date().toISOString().split('T')[0];
  let filename: string;
  let mimeType: string;
  let blob: Blob;

  switch (format) {
    case 'markdown':
      filename = `commentary-${dateStr}.md`;
      mimeType = 'text/markdown';
      blob = typeof content === 'string' ? new Blob([content], { type: mimeType }) : content;
      break;
    case 'json':
      filename = `commentary-${dateStr}.json`;
      mimeType = 'application/json';
      blob = typeof content === 'string' ? new Blob([content], { type: mimeType }) : content;
      break;
    case 'audio':
      filename = `commentary-${dateStr}-audio-script.txt`;
      mimeType = 'text/plain';
      blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
      break;
    default:
      throw new Error(`Unsupported export format: ${format}`);
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
