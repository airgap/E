/**
 * E CLI — Diff Renderer
 *
 * Provides colorized unified diffs for file edits.
 */

import { diffLines, Change } from 'diff';
import chalk from 'chalk';

export function renderDiff(oldContent: string, newContent: string): string {
  const changes = diffLines(oldContent, newContent);
  let output = '';

  changes.forEach((part: Change) => {
    const color = part.added ? chalk.green : part.removed ? chalk.red : chalk.gray;
    const prefix = part.added ? '+ ' : part.removed ? '- ' : '  ';

    // Split lines to ensure prefix is on every line
    const lines = part.value.split('\n');
    // Remove last empty line if it exists (diffLines includes trailing newlines)
    if (lines[lines.length - 1] === '') lines.pop();

    output += lines.map((line) => color(prefix + line)).join('\n') + '\n';
  });

  return output.trim();
}
