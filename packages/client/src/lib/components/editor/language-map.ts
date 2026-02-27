import type { LanguageSupport } from '@codemirror/language';

type LanguageLoader = () => Promise<LanguageSupport>;

const languageLoaders: Record<string, LanguageLoader> = {
  javascript: async () => {
    const { javascript } = await import('@codemirror/lang-javascript');
    return javascript();
  },
  typescript: async () => {
    const { javascript } = await import('@codemirror/lang-javascript');
    return javascript({ typescript: true, jsx: true });
  },
  python: async () => {
    const { python } = await import('@codemirror/lang-python');
    return python();
  },
  html: async () => {
    const { html } = await import('@codemirror/lang-html');
    return html();
  },
  svelte: async () => {
    // No dedicated CM6 Svelte package — use HTML with JS/TS script block support.
    // This gives syntax highlighting for the template, <script>, and <style> sections.
    const { html } = await import('@codemirror/lang-html');
    return html({ matchClosingTags: true, autoCloseTags: true });
  },
  css: async () => {
    const { css } = await import('@codemirror/lang-css');
    return css();
  },
  json: async () => {
    const { json } = await import('@codemirror/lang-json');
    return json();
  },
  markdown: async () => {
    const { markdown } = await import('@codemirror/lang-markdown');
    return markdown();
  },
  rust: async () => {
    const { rust } = await import('@codemirror/lang-rust');
    return rust();
  },
  cpp: async () => {
    const { cpp } = await import('@codemirror/lang-cpp');
    return cpp();
  },
  java: async () => {
    const { java } = await import('@codemirror/lang-java');
    return java();
  },
  xml: async () => {
    const { xml } = await import('@codemirror/lang-xml');
    return xml();
  },
  sql: async () => {
    const { sql } = await import('@codemirror/lang-sql');
    return sql();
  },
};

const loadedLanguages = new Map<string, LanguageSupport>();

export async function loadLanguage(language: string): Promise<LanguageSupport | null> {
  if (loadedLanguages.has(language)) {
    return loadedLanguages.get(language)!;
  }

  const loader = languageLoaders[language];
  if (!loader) return null;

  try {
    const lang = await loader();
    loadedLanguages.set(language, lang);
    return lang;
  } catch {
    return null;
  }
}

export function hasLanguageSupport(language: string): boolean {
  return language in languageLoaders;
}
