/**
 * Lightweight syntax highlighting using Shiki's tokenizer.
 *
 * Outputs HTML spans with CSS classes that reference our --syn-* CSS variables,
 * so highlighting automatically adapts to every theme without inline styles.
 *
 * Lazily loads the Shiki highlighter on first use (one-time ~50ms cost).
 */
import { createHighlighter, type Highlighter, type ThemedToken } from 'shiki';

let highlighterPromise: Promise<Highlighter> | null = null;
let highlighter: Highlighter | null = null;

// Extension → Shiki language ID
const extToLang: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  rb: 'ruby',
  php: 'php',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cs: 'csharp',
  swift: 'swift',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  htm: 'html',
  vue: 'vue',
  svelte: 'svelte',
  json: 'json',
  jsonc: 'jsonc',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  svg: 'xml',
  md: 'markdown',
  mdx: 'mdx',
  sql: 'sql',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'bash',
  ps1: 'powershell',
  dockerfile: 'dockerfile',
  graphql: 'graphql',
  gql: 'graphql',
  lua: 'lua',
  r: 'r',
  dart: 'dart',
  ex: 'elixir',
  exs: 'elixir',
  erl: 'erlang',
  hs: 'haskell',
  scala: 'scala',
  clj: 'clojure',
  zig: 'zig',
  nim: 'nim',
  tf: 'terraform',
};

/**
 * Map Shiki token scopes to our CSS variable classes.
 *
 * We use a simple heuristic: check the token's color from the neutral theme
 * and map well-known TextMate scopes to our semantic classes.
 */
function scopeToClass(scopes: string): string {
  const s = scopes;
  // Order matters — more specific first
  if (s.includes('comment')) return 'syn-comment';
  if (s.includes('string')) return 'syn-string';
  if (s.includes('constant.numeric') || s.includes('number')) return 'syn-number';
  if (s.includes('keyword') || s.includes('storage.type') || s.includes('storage.modifier'))
    return 'syn-keyword';
  if (
    s.includes('entity.name.function') ||
    s.includes('support.function') ||
    s.includes('meta.function-call')
  )
    return 'syn-function';
  if (
    s.includes('entity.name.type') ||
    s.includes('support.type') ||
    s.includes('storage.type.class') ||
    s.includes('entity.name.class')
  )
    return 'syn-type';
  if (s.includes('variable') || s.includes('entity.name.tag')) return 'syn-variable';
  if (s.includes('keyword.operator') || s.includes('punctuation')) return 'syn-operator';
  return '';
}

/** Escape HTML special chars */
function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function getHighlighter(): Promise<Highlighter> {
  if (highlighter) return highlighter;
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ['github-dark'],
      langs: [
        'typescript',
        'javascript',
        'tsx',
        'jsx',
        'python',
        'rust',
        'css',
        'html',
        'json',
        'svelte',
        'bash',
        'markdown',
        'yaml',
        'sql',
        'go',
        'java',
        'cpp',
        'c',
      ],
    });
  }
  highlighter = await highlighterPromise;
  return highlighter;
}

/**
 * Infer language from a file path extension.
 */
export function langFromPath(filePath: string): string | null {
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (!ext) return null;

  // Handle special filenames
  const name = filePath.split('/').pop()?.toLowerCase() || '';
  if (name === 'dockerfile') return 'dockerfile';
  if (name === 'makefile') return 'makefile';

  return extToLang[ext] || null;
}

/**
 * Highlight a single line of code, returning an HTML string with <span class="syn-*"> tokens.
 * Falls back to escaped plain text if language unknown or highlighter not ready.
 */
export async function highlightLine(code: string, lang: string | null): Promise<string> {
  if (!lang) return esc(code);

  try {
    const h = await getHighlighter();

    // Dynamically load language if not yet registered
    const loaded = h.getLoadedLanguages();
    if (!loaded.includes(lang as any)) {
      try {
        await h.loadLanguage(lang as any);
      } catch {
        return esc(code);
      }
    }

    const tokens = h.codeToTokens(code, {
      lang: lang as any,
      theme: 'github-dark',
      includeExplanation: true,
    });
    // tokens.tokens is an array of lines, each line is an array of tokens
    if (!tokens.tokens.length) return esc(code);

    const lineTokens = tokens.tokens[0]; // We only passed one line
    return lineTokens
      .map((tok: ThemedToken) => {
        const escaped = esc(tok.content);
        // Use fontStyle from the token's scope info
        const cls = scopeToClass(
          (tok as any).explanation?.[0]?.scopes?.map((s: any) => s.scopeName).join(' ') || '',
        );
        if (cls) return `<span class="${cls}">${escaped}</span>`;
        return escaped;
      })
      .join('');
  } catch {
    return esc(code);
  }
}

/**
 * Highlight multiple lines of code at once (more efficient than per-line).
 * Returns array of HTML strings, one per input line.
 */
export async function highlightLines(code: string, lang: string | null): Promise<string[]> {
  if (!lang) return code.split('\n').map(esc);

  try {
    const h = await getHighlighter();

    const loaded = h.getLoadedLanguages();
    if (!loaded.includes(lang as any)) {
      try {
        await h.loadLanguage(lang as any);
      } catch {
        return code.split('\n').map(esc);
      }
    }

    const tokens = h.codeToTokens(code, {
      lang: lang as any,
      theme: 'github-dark',
      includeExplanation: true,
    });

    return tokens.tokens.map((lineTokens) =>
      lineTokens
        .map((tok: ThemedToken) => {
          const escaped = esc(tok.content);
          const cls = scopeToClass(
            (tok as any).explanation?.[0]?.scopes?.map((s: any) => s.scopeName).join(' ') || '',
          );
          if (cls) return `<span class="${cls}">${escaped}</span>`;
          return escaped;
        })
        .join(''),
    );
  } catch {
    return code.split('\n').map(esc);
  }
}

/**
 * Synchronous plain-text escape for when highlighting isn't available yet.
 */
export function escapeHtml(text: string): string {
  return esc(text);
}
