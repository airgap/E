import { hoverTooltip, type Tooltip } from '@codemirror/view';
import { lspStore } from '$lib/stores/lsp.svelte';
import { api } from '$lib/api/client';
import { fileUriField } from './file-uri-field';
import { buildTreeSitterTooltip, extractDocComment } from './hover-info';
import { highlightCode, tagHighlighter, tags } from '@lezer/highlight';
import { symbolStore } from '$lib/stores/symbols.svelte';

/**
 * CM6 extension: Unified hover tooltip.
 *
 * 1. If LSP is connected, fires textDocument/hover + textDocument/definition.
 *    On success, shows a VS Code-quality card with syntax-highlighted signature,
 *    docs, and definition peek.
 * 2. If LSP is absent or returns nothing, falls back to the tree-sitter + built-in card.
 */
export function lspHoverExtension(language: string, fileId: string) {
  return hoverTooltip(
    async (view, pos): Promise<Tooltip | null> => {
      // ── Try LSP first ─────────────────────────────────────────────────────
      if (lspStore.isConnected(language)) {
        const lspResult = await tryLspHover(view, pos, language);
        if (lspResult) return lspResult;
      }

      // ── Tree-sitter / built-in fallback ───────────────────────────────────
      return buildTreeSitterTooltip(view, pos, fileId);
    },
    { hoverTime: 300 },
  );
}

// ── Highlight token classes → CSS vars ───────────────────────────────────────
// These classes are set by TOKEN_HIGHLIGHTER and styled in e-cm-theme.ts

const TOKEN_HIGHLIGHTER = tagHighlighter([
  {
    tag: [
      tags.keyword,
      tags.controlKeyword,
      tags.operatorKeyword,
      tags.definitionKeyword,
      tags.moduleKeyword,
      tags.self,
    ],
    class: 'ht-kw',
  },
  { tag: tags.string, class: 'ht-str' },
  { tag: tags.special(tags.string), class: 'ht-str' },
  { tag: tags.regexp, class: 'ht-str' },
  { tag: tags.number, class: 'ht-num' },
  { tag: tags.bool, class: 'ht-num' },
  { tag: tags.null, class: 'ht-num' },
  { tag: tags.comment, class: 'ht-cmt' },
  { tag: tags.lineComment, class: 'ht-cmt' },
  { tag: tags.blockComment, class: 'ht-cmt' },
  { tag: tags.docComment, class: 'ht-cmt' },
  { tag: [tags.typeName, tags.typeOperator, tags.className, tags.namespace], class: 'ht-typ' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], class: 'ht-fn' },
  { tag: [tags.variableName, tags.definition(tags.variableName)], class: 'ht-var' },
  { tag: [tags.propertyName, tags.attributeName], class: 'ht-var' },
  { tag: tags.operator, class: 'ht-op' },
  { tag: tags.punctuation, class: 'ht-pun' },
  { tag: tags.tagName, class: 'ht-kw' },
  { tag: tags.attributeValue, class: 'ht-str' },
  { tag: tags.invalid, class: 'ht-err' },
]);

// ── Lezer parser cache ────────────────────────────────────────────────────────
// Parsers are eagerly loaded at module init so they are available synchronously
// by the time the tooltip's create() method runs. This avoids the race where an
// async highlight fires after the tooltip DOM has already been destroyed.

const lezerParsers = new Map<string, any | null>();

// Kick off loading immediately — these modules are already bundled by Vite so
// the dynamic import resolves in the next microtask, not over the network.
function preloadParsers() {
  const load = async (lang: string, fn: () => Promise<any>) => {
    if (lezerParsers.has(lang)) return;
    try {
      lezerParsers.set(lang, await fn());
    } catch {
      lezerParsers.set(lang, null);
    }
  };
  load('typescript', async () => {
    const { tsxLanguage } = await import('@codemirror/lang-javascript');
    return (tsxLanguage as any).parser;
  });
  load('python', async () => {
    const { pythonLanguage } = await import('@codemirror/lang-python');
    return (pythonLanguage as any).parser;
  });
  load('rust', async () => {
    const { rustLanguage } = await import('@codemirror/lang-rust');
    return (rustLanguage as any).parser;
  });
  load('css', async () => {
    const { cssLanguage } = await import('@codemirror/lang-css');
    return (cssLanguage as any).parser;
  });
  load('html', async () => {
    const { htmlLanguage } = await import('@codemirror/lang-html');
    return (htmlLanguage as any).parser;
  });
  load('json', async () => {
    const { jsonLanguage } = await import('@codemirror/lang-json');
    return (jsonLanguage as any).parser;
  });
}
preloadParsers();

function getLezerParserSync(lang: string): any | null {
  // Map language aliases to canonical cache key
  const key = lang === 'javascript' || lang === 'svelte' ? 'typescript' : lang;
  return lezerParsers.get(key) ?? null;
}

// ── Snippet highlight ─────────────────────────────────────────────────────────

/**
 * Synchronously highlight `code` into `pre` using the pre-loaded lezer parser.
 * Falls back to plain text if the parser isn't ready yet (rare: first open only).
 */
function highlightSnippetSync(pre: HTMLPreElement, code: string, lang: string): void {
  const parser = getLezerParserSync(lang);
  if (!parser) {
    pre.textContent = code;
    return;
  }
  try {
    const tree = parser.parse(code);
    let html = '';
    highlightCode(
      code,
      tree,
      TOKEN_HIGHLIGHTER,
      (text, cls) => {
        html += cls ? `<span class="${cls}">${escHtml(text)}</span>` : escHtml(text);
      },
      () => {
        html += '\n';
      },
    );
    pre.innerHTML = html;
  } catch {
    pre.textContent = code;
  }
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── LSP hover ────────────────────────────────────────────────────────────────

async function tryLspHover(
  view: import('@codemirror/view').EditorView,
  pos: number,
  language: string,
): Promise<Tooltip | null> {
  const line = view.state.doc.lineAt(pos);
  const uri = view.state.field(fileUriField, false) || '';
  if (!uri) return null;

  const lspPos = { line: line.number - 1, character: pos - line.from };

  // Fire hover + definition concurrently for minimum latency.
  // Cap at 2 s — if LSP is slow we fall through to tree-sitter rather than blocking.
  const withTimeout = <T>(p: Promise<T>, ms = 2000): Promise<T> =>
    Promise.race([
      p,
      new Promise<T>((_, rej) => setTimeout(() => rej(new Error('lsp-timeout')), ms)),
    ]);

  const [hoverResult, defResult] = await Promise.allSettled([
    withTimeout(
      lspStore.request(language, 'textDocument/hover', {
        textDocument: { uri },
        position: lspPos,
      }),
    ),
    withTimeout(
      lspStore.request(language, 'textDocument/definition', {
        textDocument: { uri },
        position: lspPos,
      }),
    ),
  ]);

  const hover = hoverResult.status === 'fulfilled' ? hoverResult.value : null;
  const def = defResult.status === 'fulfilled' ? defResult.value : null;

  if (!hover?.contents && !def) return null;

  // ── Parse hover content ───────────────────────────────────────────────────
  type Seg = { kind: 'code' | 'markdown' | 'plaintext'; value: string };
  const segments: Seg[] = [];

  if (hover?.contents) {
    const raw = hover.contents;
    if (typeof raw === 'string') {
      segments.push({ kind: 'plaintext', value: raw });
    } else if (Array.isArray(raw)) {
      for (const c of raw) {
        if (typeof c === 'string') segments.push({ kind: 'plaintext', value: c });
        else if (c.language) segments.push({ kind: 'code', value: c.value || '' });
        else
          segments.push({
            kind: c.kind === 'markdown' ? 'markdown' : 'plaintext',
            value: c.value || '',
          });
      }
    } else if (raw.language) {
      segments.push({ kind: 'code', value: raw.value || '' });
    } else {
      segments.push({
        kind: raw.kind === 'markdown' ? 'markdown' : 'plaintext',
        value: raw.value || '',
      });
    }
  }

  const nonEmpty = segments.filter((s) => s.value.trim());

  // ── Parse definition location ─────────────────────────────────────────────
  type DefLocation = { targetUri?: string; uri?: string; targetRange?: any; range?: any };
  let defLoc: DefLocation | null = null;
  if (def) {
    const locs: DefLocation[] = Array.isArray(def) ? def : [def];
    if (locs.length > 0) defLoc = locs[0];
  }

  if (!nonEmpty.length && !defLoc) return null;

  // ── Fetch definition snippet ──────────────────────────────────────────────
  type DefSnippet = { filePath: string; lines: string[]; startLine: number; lang: string };
  let defSnippet: DefSnippet | null = null;
  if (defLoc) {
    const defUri = defLoc.targetUri || defLoc.uri || '';
    const defRange = defLoc.targetRange || defLoc.range;
    const defFilePath = defUri.replace(/^file:\/\//, '');
    const currentFilePath = uri.replace(/^file:\/\//, '');
    const defLang = guessLang(defFilePath || currentFilePath);

    if (defRange) {
      const defStartLine = defRange.start.line; // 0-indexed
      const defEndLine = defRange.end.line;

      if (defFilePath && defFilePath !== currentFilePath) {
        try {
          const fileResp = await Promise.race([
            api.files.read(defFilePath),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500)),
          ]);
          const lines = fileResp.data.content.split('\n');
          defSnippet = {
            filePath: defFilePath,
            lines: extractDefLines(lines, defStartLine, defEndLine),
            startLine: defStartLine + 1,
            lang: defLang,
          };
        } catch {
          // Skip definition peek on timeout / error
        }
      } else {
        const lineCount = view.state.doc.lines;
        const allLines = Array.from(
          { length: lineCount },
          (_, i) => view.state.doc.line(i + 1).text,
        );
        defSnippet = {
          filePath: currentFilePath,
          lines: extractDefLines(allLines, defStartLine, defEndLine),
          startLine: defStartLine + 1,
          lang: defLang,
        };
      }
    }
  }

  // ── Extract doc comment from source (for when LSP doesn't provide docs) ──
  const { sigSegs: checkSigSegs, docSegs: checkDocSegs } = splitSegments(nonEmpty);
  let sourceDocComment: string | null = null;
  // Only extract doc comments if LSP didn't return documentation sections
  if (checkDocSegs.length === 0) {
    // Extract the word under cursor to find the symbol
    const lineText = line.text;
    const col = pos - line.from;
    let ws = col;
    let we = col;
    while (ws > 0 && /[\w$]/.test(lineText[ws - 1])) ws--;
    while (we < lineText.length && /[\w$]/.test(lineText[we])) we++;
    const hoveredWord = lineText.slice(ws, we);

    if (hoveredWord) {
      // Try to find the symbol in tree-sitter store to get its startRow
      const fileId = uri.replace(/^file:\/\//, '');
      const symbols = symbolStore.getSymbols(fileId);
      const sym = findSymbolByNameLsp(symbols, hoveredWord);
      if (sym) {
        sourceDocComment = extractDocComment(view, sym.startRow);
      }
    }
  }

  // ── Determine hover range ─────────────────────────────────────────────────
  let from = pos;
  let to = pos;
  if (hover?.range) {
    const sl = view.state.doc.line(hover.range.start.line + 1);
    from = sl.from + hover.range.start.character;
    const el = view.state.doc.line(hover.range.end.line + 1);
    to = el.from + hover.range.end.character;
  } else {
    const lineText = line.text;
    const col = pos - line.from;
    let s = col;
    let e = col;
    while (s > 0 && /\w/.test(lineText[s - 1])) s--;
    while (e < lineText.length && /\w/.test(lineText[e])) e++;
    from = line.from + s;
    to = line.from + e;
  }

  return {
    pos: from,
    end: to,
    above: true,
    create() {
      return { dom: buildLspCard(nonEmpty, defSnippet, sourceDocComment) };
    },
  };
}

/** Find a symbol by name in the tree-sitter symbol store (recursive) */
function findSymbolByNameLsp(symbols: any[], name: string): any | null {
  for (const sym of symbols) {
    if (sym.name === name) return sym;
    if (sym.children) {
      const found = findSymbolByNameLsp(sym.children, name);
      if (found) return found;
    }
  }
  return null;
}

// ── Card builder ──────────────────────────────────────────────────────────────

type Seg = { kind: 'code' | 'markdown' | 'plaintext'; value: string };
type DefSnippet = { filePath: string; lines: string[]; startLine: number; lang: string };

/** Build the hover card with synchronous syntax highlighting. */
function buildLspCard(
  segments: Seg[],
  defSnippet: DefSnippet | null,
  sourceDocComment: string | null = null,
): HTMLElement {
  const card = document.createElement('div');
  card.className = 'e-hover-card';

  const { sigSegs, docSegs } = splitSegments(segments);

  if (sigSegs.length > 0) {
    const sigSection = document.createElement('div');
    sigSection.className = 'e-hover-sig';
    for (const seg of sigSegs) {
      const pre = document.createElement('pre');
      pre.className = 'e-hover-pre';
      highlightSnippetSync(pre, seg.value, 'typescript');
      sigSection.appendChild(pre);
    }
    card.appendChild(sigSection);
  }

  if (docSegs.length > 0) {
    if (sigSegs.length > 0) card.appendChild(makeSep());
    const docSection = document.createElement('div');
    docSection.className = 'e-hover-docs';
    for (const seg of docSegs) {
      const p = document.createElement('p');
      p.className = 'e-hover-doc-para';
      p.innerHTML = simpleMarkdown(seg.value);
      docSection.appendChild(p);
    }
    card.appendChild(docSection);
  } else if (sourceDocComment) {
    // LSP didn't return docs — show the JSDoc comment from source instead
    if (sigSegs.length > 0) card.appendChild(makeSep());
    const docSection = document.createElement('div');
    docSection.className = 'e-hover-docs';
    const paragraphs = sourceDocComment.split('\n\n').filter((p) => p.trim());
    for (const para of paragraphs) {
      const p = document.createElement('p');
      p.className = 'e-hover-doc-para';
      p.innerHTML = simpleMarkdown(para.trim());
      docSection.appendChild(p);
    }
    card.appendChild(docSection);
  }

  if (defSnippet && defSnippet.lines.length > 0) {
    card.appendChild(makeSep());
    const peekSection = document.createElement('div');
    peekSection.className = 'e-hover-peek';

    const label = document.createElement('div');
    label.className = 'e-hover-peek-label';
    const shortPath = defSnippet.filePath.replace(/.*\/([^/]+\/[^/]+)$/, '$1');
    label.innerHTML = `<span class="e-hover-peek-icon">◈</span><span class="e-hover-peek-path">${esc(shortPath)}</span><span class="e-hover-peek-line">:${defSnippet.startLine}</span>`;
    peekSection.appendChild(label);

    const pre = document.createElement('pre');
    pre.className = 'e-hover-pre e-hover-peek-code';
    highlightSnippetSync(pre, defSnippet.lines.join('\n'), defSnippet.lang);
    peekSection.appendChild(pre);

    card.appendChild(peekSection);
  }

  return card;
}

function splitSegments(segments: Seg[]): { sigSegs: Seg[]; docSegs: Seg[] } {
  const sigSegs: Seg[] = [];
  const docSegs: Seg[] = [];
  for (const seg of segments) {
    if (seg.kind === 'code') {
      sigSegs.push(seg);
    } else if (seg.kind === 'markdown') {
      const fenceRe = /```(\w*)\n?([\s\S]*?)```/g;
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = fenceRe.exec(seg.value)) !== null) {
        const before = seg.value.slice(last, m.index).trim();
        if (before) docSegs.push({ kind: 'plaintext', value: before });
        sigSegs.push({ kind: 'code', value: m[2].trimEnd() });
        last = m.index + m[0].length;
      }
      const after = seg.value.slice(last).trim();
      if (after) docSegs.push({ kind: 'plaintext', value: after });
    } else {
      docSegs.push(seg);
    }
  }
  return { sigSegs, docSegs };
}

// ── Utilities ────────────────────────────────────────────────────────────────

function extractDefLines(allLines: string[], startLine: number, endLine: number): string[] {
  const MAX_LINES = 12;
  const end = Math.min(Math.max(endLine, startLine) + 1, startLine + MAX_LINES, allLines.length);
  const lines = allLines.slice(startLine, end);
  const indent = lines.reduce((min, l) => {
    if (!l.trim()) return min;
    const m = l.match(/^(\s*)/);
    return m ? Math.min(min, m[1].length) : min;
  }, Infinity);
  return lines.map((l) => l.slice(indent === Infinity ? 0 : indent));
}

function guessLang(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    svelte: 'typescript',
    py: 'python',
    rs: 'rust',
    go: 'go',
    css: 'css',
    json: 'json',
    html: 'html',
    md: 'markdown',
  };
  return map[ext] ?? 'typescript';
}

function makeSep(): HTMLElement {
  const sep = document.createElement('div');
  sep.className = 'e-hover-sep';
  return sep;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function simpleMarkdown(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code class="e-hover-inline-code">$1</code>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, ' ');
}
