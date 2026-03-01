/**
 * E CLI — Commit Command
 *
 * Automatically summarizes staged changes and proposes a commit message.
 */

import { theme } from '../ui/theme';
import { runChat } from './chat';
import { execSync } from 'child_process';

export async function runCommit(opts: { model: string; sessionId: string }) {
  try {
    // Check for staged changes
    const staged = execSync('git diff --cached --name-only', { encoding: 'utf-8' }).trim();

    if (!staged) {
      console.log(theme.warning('No staged changes found. Stage files with "git add" first.'));
      return;
    }

    const diff = execSync('git diff --cached', { encoding: 'utf-8' });

    console.log(`${theme.brand('E')} ${theme.system('Analyzing staged changes…')}`);

    const prompt = `Review these staged changes and write a professional git commit message. 
Format your response as:
Summary: <one line summary>
Description: <detailed multi-line description if needed>

STAGED CHANGES:
${diff}`;

    await runChat({
      prompt,
      model: opts.model,
      sessionId: opts.sessionId,
      yolo: false, // Allow user to edit/approve the message
    });
  } catch (err: any) {
    console.error(theme.error(`Git error: ${err.message}`));
  }
}
