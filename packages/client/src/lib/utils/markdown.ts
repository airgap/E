import { marked, type Renderer } from 'marked';
import DOMPurify from 'dompurify';

// Configure marked for GFM
marked.setOptions({
  gfm: true,
  breaks: true,
});

/**
 * Custom renderer that emits placeholder divs for code blocks.
 * The placeholder carries base64-encoded code and the language name.
 * ProseBlock.svelte replaces these with live CodeBlock components.
 */
const customRenderer: Partial<Renderer> = {
  code({ text, lang }) {
    const language = lang || 'text';
    // Base64-encode so the code survives HTML attribute serialisation
    const encoded = btoa(unescape(encodeURIComponent(text)));
    return `<div class="code-block-wrapper" data-language="${language}" data-code="${encoded}"></div>\n`;
  },
};

marked.use({ renderer: customRenderer });

/**
 * Full markdown render with sanitization.
 * Used for completed messages.
 */
export async function renderMarkdown(source: string): Promise<string> {
  const raw = await marked.parse(source);
  return DOMPurify.sanitize(raw, {
    ADD_TAGS: ['svg', 'path', 'line', 'rect', 'circle'],
    ADD_ATTR: [
      'viewBox',
      'fill',
      'stroke',
      'stroke-width',
      'd',
      'x',
      'y',
      'width',
      'height',
      'rx',
      'data-language',
      'data-file-path',
      'data-code',
    ],
  });
}

/**
 * Fast synchronous partial render for streaming.
 * Handles basic markdown without full AST parsing.
 */
export function renderMarkdownPartial(source: string): string {
  if (!source) return '';

  let html = escapeHtml(source);

  // Fenced code blocks — emit a lightweight preview for streaming
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    const encoded = btoa(unescape(encodeURIComponent(code)));
    const escapedCode = code
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<div class="code-block-wrapper streaming-code-preview" data-language="${lang || 'text'}" data-code="${encoded}"><div class="streaming-code-header">${lang || 'text'}</div><pre class="streaming-code-body">${escapedCode}</pre></div>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Links
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>',
  );

  // Unordered lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');

  // Paragraphs (double newlines)
  html = html.replace(/\n\n/g, '</p><p>');

  // Single newlines
  html = html.replace(/\n/g, '<br>');

  return `<p>${html}</p>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
