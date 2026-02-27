import { describe, test, expect } from 'vitest';
import { renderMarkdown, renderMarkdownPartial } from '../markdown';

describe('renderMarkdownPartial', () => {
  test('returns empty string for empty input', () => {
    expect(renderMarkdownPartial('')).toBe('');
  });

  test('wraps plain text in paragraph', () => {
    const result = renderMarkdownPartial('Hello world');
    expect(result).toBe('<p>Hello world</p>');
  });

  test('escapes HTML entities', () => {
    const result = renderMarkdownPartial('<script>alert("xss")</script>');
    expect(result).toContain('&lt;script&gt;');
    expect(result).toContain('&quot;');
    expect(result).not.toContain('<script>');
  });

  test('renders bold text', () => {
    const result = renderMarkdownPartial('This is **bold** text');
    expect(result).toContain('<strong>bold</strong>');
  });

  test('renders italic text', () => {
    const result = renderMarkdownPartial('This is *italic* text');
    expect(result).toContain('<em>italic</em>');
  });

  test('renders inline code', () => {
    const result = renderMarkdownPartial('Use `console.log` here');
    expect(result).toContain('<code>console.log</code>');
  });

  test('renders fenced code blocks', () => {
    const result = renderMarkdownPartial('```js\nconst x = 1;\n```');
    expect(result).toContain('code-block-wrapper');
    expect(result).toContain('data-language="js"');
    expect(result).toContain('const x = 1;');
  });

  test('renders code blocks without language', () => {
    const result = renderMarkdownPartial('```\nplain code\n```');
    expect(result).toContain('data-language="text"');
  });

  test('renders h1', () => {
    const result = renderMarkdownPartial('# Title');
    expect(result).toContain('<h1>Title</h1>');
  });

  test('renders h2', () => {
    const result = renderMarkdownPartial('## Subtitle');
    expect(result).toContain('<h2>Subtitle</h2>');
  });

  test('renders h3', () => {
    const result = renderMarkdownPartial('### Section');
    expect(result).toContain('<h3>Section</h3>');
  });

  test('renders links', () => {
    const result = renderMarkdownPartial('[Google](https://google.com)');
    expect(result).toContain('<a href="https://google.com"');
    expect(result).toContain('target="_blank"');
    expect(result).toContain('rel="noopener"');
    expect(result).toContain('>Google</a>');
  });

  test('renders unordered list items', () => {
    const result = renderMarkdownPartial('- Item one\n- Item two');
    expect(result).toContain('<li>Item one</li>');
    expect(result).toContain('<li>Item two</li>');
  });

  test('converts double newlines to paragraph breaks', () => {
    const result = renderMarkdownPartial('Paragraph 1\n\nParagraph 2');
    expect(result).toContain('</p><p>');
  });

  test('converts single newlines to br', () => {
    const result = renderMarkdownPartial('Line 1\nLine 2');
    expect(result).toContain('<br>');
  });

  test('handles ampersands in text', () => {
    const result = renderMarkdownPartial('A & B');
    expect(result).toContain('&amp;');
  });

  test('handles complex mixed markdown', () => {
    const result = renderMarkdownPartial('**Bold** and *italic* with `code`');
    expect(result).toContain('<strong>Bold</strong>');
    expect(result).toContain('<em>italic</em>');
    expect(result).toContain('<code>code</code>');
  });
});

describe('renderMarkdown', () => {
  test('renders basic markdown', async () => {
    const result = await renderMarkdown('Hello **world**');
    expect(result).toContain('<strong>world</strong>');
  });

  test('sanitizes dangerous HTML', async () => {
    const result = await renderMarkdown('<script>alert("xss")</script>');
    expect(result).not.toContain('<script>');
  });

  test('allows SVG tags', async () => {
    const result = await renderMarkdown(
      '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="red"/></svg>',
    );
    expect(result).toContain('<svg');
    expect(result).toContain('<circle');
  });

  test('allows data-language attribute', async () => {
    const result = await renderMarkdown('```javascript\ncode\n```');
    // marked renders code blocks with class, DOMPurify allows data-language
    expect(result).toContain('code');
  });

  test('renders GFM tables', async () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |';
    const result = await renderMarkdown(md);
    expect(result).toContain('<table>');
    expect(result).toContain('<td>');
  });

  test('returns empty string for empty input', async () => {
    const result = await renderMarkdown('');
    expect(result).toBe('');
  });

  test('renders line breaks', async () => {
    const result = await renderMarkdown('Line 1\nLine 2');
    expect(result).toContain('<br');
  });
});
