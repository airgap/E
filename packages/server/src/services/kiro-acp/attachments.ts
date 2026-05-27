/**
 * kiro-acp/attachments.ts — convert E's wire-level Attachment[] (text+files
 * mixed with images, base64-encoded) into the KiroPromptContent[] shape the
 * ACP `session/prompt` method accepts.
 *
 * Kiro CLI advertises `promptCapabilities.image: true` from `initialize`, so
 * image blocks are first-class. File attachments are out of scope here — the
 * stream route already inlines text-file contents into the user message, so
 * by the time we reach the ACP path the only multimodal payloads worth
 * forwarding are images.
 */
import type { Attachment } from '@e/shared';
import type { KiroPromptContent } from './client';

/**
 * Build the ACP prompt blocks for a user turn. The text always comes first
 * (Kiro's vision models prefer leading text context), followed by one image
 * block per image attachment. Non-image attachments are ignored — they've
 * already been folded into `text` upstream.
 *
 * Returns at minimum a single text block (possibly empty-but-present) so the
 * ACP server never sees an empty `prompt: []` array.
 */
export function buildKiroPromptBlocks(
  text: string,
  attachments?: Attachment[],
): KiroPromptContent[] {
  const blocks: KiroPromptContent[] = [{ type: 'text', text }];
  if (!attachments?.length) return blocks;

  for (const att of attachments) {
    if (att.type !== 'image') continue;
    if (!att.content) continue; // missing base64 → skip rather than fail the turn
    const mimeType = att.mimeType || guessImageMimeFromName(att.name);
    blocks.push({ type: 'image', data: att.content, mimeType });
  }
  return blocks;
}

function guessImageMimeFromName(name: string | undefined): string {
  if (!name) return 'image/png';
  const dot = name.lastIndexOf('.');
  if (dot < 0) return 'image/png';
  const ext = name.slice(dot + 1).toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    default:
      return 'image/png';
  }
}
