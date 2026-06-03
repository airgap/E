/**
 * Map a file name to the editor language key used by language-map.ts
 * (`loadLanguage`) and the LSP. Pure and dependency-free on purpose: it used to
 * live inside the editor store, which tempted components to copy it rather than
 * import the heavy store — those copies drifted and silently dropped languages
 * (e.g. Parabun `.pui` / `.pts`), so files opened from the tree lost
 * highlighting. Keep this the single source of truth.
 */
export function detectLanguage(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    pts: 'parabun-ts',
    ptsx: 'parabun-tsx',
    js: 'javascript',
    jsx: 'javascript',
    pjs: 'parabun-js',
    pjsx: 'parabun-jsx',
    mjs: 'javascript',
    cjs: 'javascript',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    c: 'cpp',
    h: 'cpp',
    cpp: 'cpp',
    cc: 'cpp',
    hpp: 'cpp',
    css: 'css',
    scss: 'scss',
    sass: 'sass',
    html: 'html',
    htm: 'html',
    svelte: 'svelte',
    pui: 'pui',
    vue: 'html',
    json: 'json',
    md: 'markdown',
    mdx: 'markdown',
    xml: 'xml',
    svg: 'xml',
    sql: 'sql',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    txt: 'text',
  };
  return map[ext] || 'text';
}
