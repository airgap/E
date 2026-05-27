import { describe, test, expect } from 'bun:test';
import type { Attachment } from '@e/shared';
import { buildKiroPromptBlocks } from '../attachments';

const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('buildKiroPromptBlocks', () => {
  test('text only produces a single text block', () => {
    const blocks = buildKiroPromptBlocks('hello kiro');
    expect(blocks).toEqual([{ type: 'text', text: 'hello kiro' }]);
  });

  test('empty text + no attachments still emits one text block', () => {
    // ACP server rejects an empty prompt array; we ALWAYS lead with text.
    const blocks = buildKiroPromptBlocks('');
    expect(blocks).toEqual([{ type: 'text', text: '' }]);
  });

  test('image attachment becomes an image block with explicit mimeType', () => {
    const att: Attachment = {
      type: 'image',
      name: 'screenshot.png',
      content: PNG_B64,
      mimeType: 'image/png',
    };
    const blocks = buildKiroPromptBlocks('look at this', [att]);
    expect(blocks).toEqual([
      { type: 'text', text: 'look at this' },
      { type: 'image', data: PNG_B64, mimeType: 'image/png' },
    ]);
  });

  test('infers mimeType from filename when not provided', () => {
    const att: Attachment = { type: 'image', name: 'photo.jpg', content: PNG_B64 };
    const blocks = buildKiroPromptBlocks('', [att]);
    expect(blocks[1]).toMatchObject({ type: 'image', mimeType: 'image/jpeg' });
  });

  test('falls back to image/png for unknown extensions', () => {
    const att: Attachment = { type: 'image', name: 'mystery.xyz', content: PNG_B64 };
    const blocks = buildKiroPromptBlocks('', [att]);
    expect(blocks[1]).toMatchObject({ mimeType: 'image/png' });
  });

  test('skips images missing base64 content rather than failing the turn', () => {
    const att: Attachment = { type: 'image', name: 'broken.png' };
    const blocks = buildKiroPromptBlocks('text', [att]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({ type: 'text', text: 'text' });
  });

  test('ignores non-image attachments — those are already inlined as text', () => {
    const fileAtt: Attachment = {
      type: 'file',
      name: 'data.csv',
      content: 'a,b,c\n1,2,3',
      mimeType: 'text/csv',
    };
    const imageAtt: Attachment = {
      type: 'image',
      name: 'chart.png',
      content: PNG_B64,
      mimeType: 'image/png',
    };
    const blocks = buildKiroPromptBlocks('analyze', [fileAtt, imageAtt]);
    expect(blocks).toHaveLength(2); // text + image only, not the file
    expect(blocks[1].type).toBe('image');
  });

  test('multiple images all get forwarded in order', () => {
    const a: Attachment = { type: 'image', name: 'a.png', content: 'AAA' };
    const b: Attachment = { type: 'image', name: 'b.webp', content: 'BBB' };
    const blocks = buildKiroPromptBlocks('compare', [a, b]);
    expect(blocks.map((b) => b.type)).toEqual(['text', 'image', 'image']);
    expect(blocks[1]).toMatchObject({ data: 'AAA', mimeType: 'image/png' });
    expect(blocks[2]).toMatchObject({ data: 'BBB', mimeType: 'image/webp' });
  });
});
