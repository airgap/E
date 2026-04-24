/**
 * File-type icon resolution for the file tree and anywhere a glyph needs to
 * stand in for a filename. Returns a base shape (file or folder open/closed),
 * a brand-ish color, and a short 1-3 character overlay label when one makes
 * sense — matches the visual language of VS Code's Material Icon theme
 * without pulling in a font or thousands of SVGs.
 *
 * The palette is tuned to work against both dark and light themes: every
 * color is an oklch-adjusted mid-tone, so the SVGs stay legible whichever
 * background is behind them.
 */

export type IconKind = 'file' | 'folder-open' | 'folder-closed';

export interface FileIcon {
  kind: IconKind;
  /** Accent color used for the main glyph stroke + tint. CSS color string. */
  color: string;
  /** Optional 1-3 character overlay (e.g. "TS", "JS", "PY"). */
  label?: string;
}

// ── Known folder names get dedicated colors/labels ────────────────────────
const FOLDER_NAMES: Record<string, { color: string; label?: string }> = {
  '.git': { color: '#f05032', label: 'GIT' },
  '.github': { color: '#8b949e', label: 'GH' },
  '.vscode': { color: '#007acc', label: 'VS' },
  '.e': { color: '#a78bfa' },
  node_modules: { color: '#8b949e', label: 'NM' },
  src: { color: '#60a5fa' },
  lib: { color: '#60a5fa' },
  app: { color: '#60a5fa' },
  packages: { color: '#f59e0b' },
  apps: { color: '#f59e0b' },
  dist: { color: '#6b7280', label: 'OUT' },
  build: { color: '#6b7280', label: 'OUT' },
  out: { color: '#6b7280', label: 'OUT' },
  target: { color: '#f97316', label: 'RS' },
  public: { color: '#34d399' },
  static: { color: '#34d399' },
  assets: { color: '#a78bfa' },
  images: { color: '#c084fc' },
  img: { color: '#c084fc' },
  styles: { color: '#ec4899' },
  scripts: { color: '#facc15' },
  test: { color: '#22c55e', label: 'T' },
  tests: { color: '#22c55e', label: 'T' },
  __tests__: { color: '#22c55e', label: 'T' },
  docs: { color: '#eab308', label: 'MD' },
  doc: { color: '#eab308', label: 'MD' },
  types: { color: '#3178c6', label: 'TS' },
  components: { color: '#ff3e00' },
  routes: { color: '#22d3ee' },
  server: { color: '#10b981' },
  client: { color: '#60a5fa' },
  shared: { color: '#a78bfa' },
};

// ── Known special filenames that override extension-based lookup ──────────
const SPECIAL_FILES: Record<string, { color: string; label: string }> = {
  'package.json': { color: '#cb3837', label: 'NPM' },
  'package-lock.json': { color: '#cb3837', label: 'LCK' },
  'bun.lock': { color: '#f472b6', label: 'LCK' },
  'bun.lockb': { color: '#f472b6', label: 'LCK' },
  'yarn.lock': { color: '#2c8ebb', label: 'LCK' },
  'pnpm-lock.yaml': { color: '#f69220', label: 'LCK' },
  'cargo.toml': { color: '#f97316', label: 'RS' },
  'cargo.lock': { color: '#f97316', label: 'LCK' },
  'go.mod': { color: '#00add8', label: 'GO' },
  'go.sum': { color: '#00add8', label: 'GO' },
  dockerfile: { color: '#2496ed', label: 'DOC' },
  'dockerfile.dev': { color: '#2496ed', label: 'DOC' },
  'docker-compose.yml': { color: '#2496ed', label: 'DC' },
  'docker-compose.yaml': { color: '#2496ed', label: 'DC' },
  makefile: { color: '#6b7280', label: 'MK' },
  jenkinsfile: { color: '#d33833', label: 'CI' },
  '.gitignore': { color: '#f05032', label: 'GIT' },
  '.gitattributes': { color: '#f05032', label: 'GIT' },
  '.env': { color: '#eab308', label: 'ENV' },
  '.env.local': { color: '#eab308', label: 'ENV' },
  '.env.production': { color: '#eab308', label: 'ENV' },
  '.npmrc': { color: '#cb3837', label: 'RC' },
  '.prettierrc': { color: '#c596c7', label: 'RC' },
  '.eslintrc': { color: '#4b32c3', label: 'RC' },
  'tsconfig.json': { color: '#3178c6', label: 'TS' },
  'tsconfig.node.json': { color: '#3178c6', label: 'TS' },
  'vite.config.ts': { color: '#bd34fe', label: 'VT' },
  'vite.config.js': { color: '#bd34fe', label: 'VT' },
  'svelte.config.js': { color: '#ff3e00', label: 'SV' },
  'vitest.config.ts': { color: '#6e9f18', label: 'VT' },
  readme: { color: '#60a5fa', label: 'MD' },
  'readme.md': { color: '#60a5fa', label: 'MD' },
  license: { color: '#eab308', label: 'LIC' },
  'license.md': { color: '#eab308', label: 'LIC' },
};

// ── Extension → color / label ─────────────────────────────────────────────
const EXTENSIONS: Record<string, { color: string; label: string }> = {
  // TypeScript / JavaScript
  ts: { color: '#3178c6', label: 'TS' },
  tsx: { color: '#3178c6', label: 'TSX' },
  mts: { color: '#3178c6', label: 'TS' },
  cts: { color: '#3178c6', label: 'TS' },
  js: { color: '#f7df1e', label: 'JS' },
  jsx: { color: '#f7df1e', label: 'JSX' },
  mjs: { color: '#f7df1e', label: 'JS' },
  cjs: { color: '#f7df1e', label: 'JS' },
  // Svelte / Vue / React
  svelte: { color: '#ff3e00', label: 'SV' },
  vue: { color: '#42b883', label: 'VUE' },
  // Web
  html: { color: '#e34f26', label: 'HTM' },
  htm: { color: '#e34f26', label: 'HTM' },
  css: { color: '#1572b6', label: 'CSS' },
  scss: { color: '#cc6699', label: 'SCS' },
  sass: { color: '#cc6699', label: 'SAS' },
  less: { color: '#1d365d', label: 'LSS' },
  // Data
  json: { color: '#facc15', label: '{}' },
  jsonc: { color: '#facc15', label: '{}' },
  json5: { color: '#facc15', label: '{}' },
  yaml: { color: '#cb171e', label: 'YML' },
  yml: { color: '#cb171e', label: 'YML' },
  toml: { color: '#9c4221', label: 'TML' },
  xml: { color: '#f59e0b', label: 'XML' },
  csv: { color: '#22c55e', label: 'CSV' },
  // Languages
  py: { color: '#3776ab', label: 'PY' },
  pyi: { color: '#3776ab', label: 'PY' },
  rs: { color: '#f97316', label: 'RS' },
  go: { color: '#00add8', label: 'GO' },
  rb: { color: '#cc342d', label: 'RB' },
  java: { color: '#ea2d2e', label: 'JV' },
  kt: { color: '#7f52ff', label: 'KT' },
  kts: { color: '#7f52ff', label: 'KT' },
  swift: { color: '#fa7343', label: 'SW' },
  c: { color: '#a8b9cc', label: 'C' },
  h: { color: '#a8b9cc', label: 'H' },
  cpp: { color: '#00599c', label: 'C++' },
  cc: { color: '#00599c', label: 'C++' },
  cxx: { color: '#00599c', label: 'C++' },
  hpp: { color: '#00599c', label: 'H++' },
  cs: { color: '#68217a', label: 'C#' },
  php: { color: '#777bb4', label: 'PHP' },
  lua: { color: '#000080', label: 'LUA' },
  dart: { color: '#0175c2', label: 'DRT' },
  ex: { color: '#4b275f', label: 'EX' },
  exs: { color: '#4b275f', label: 'EX' },
  erl: { color: '#a90533', label: 'ERL' },
  clj: { color: '#5881d8', label: 'CLJ' },
  scala: { color: '#c22d40', label: 'SCA' },
  hs: { color: '#5d4f85', label: 'HS' },
  ml: { color: '#ec6813', label: 'ML' },
  zig: { color: '#f7a41d', label: 'ZIG' },
  // Shell / scripts
  sh: { color: '#89e051', label: 'SH' },
  bash: { color: '#89e051', label: 'SH' },
  zsh: { color: '#89e051', label: 'SH' },
  fish: { color: '#89e051', label: 'SH' },
  ps1: { color: '#012456', label: 'PS' },
  bat: { color: '#c1f12e', label: 'BAT' },
  // Docs / prose
  md: { color: '#60a5fa', label: 'MD' },
  mdx: { color: '#60a5fa', label: 'MDX' },
  markdown: { color: '#60a5fa', label: 'MD' },
  rst: { color: '#60a5fa', label: 'RST' },
  txt: { color: '#9ca3af', label: 'TXT' },
  pdf: { color: '#dc2626', label: 'PDF' },
  // Images
  png: { color: '#c084fc', label: 'IMG' },
  jpg: { color: '#c084fc', label: 'IMG' },
  jpeg: { color: '#c084fc', label: 'IMG' },
  gif: { color: '#c084fc', label: 'IMG' },
  webp: { color: '#c084fc', label: 'IMG' },
  svg: { color: '#ffb13b', label: 'SVG' },
  ico: { color: '#c084fc', label: 'ICO' },
  bmp: { color: '#c084fc', label: 'IMG' },
  // Fonts
  woff: { color: '#a78bfa', label: 'FNT' },
  woff2: { color: '#a78bfa', label: 'FNT' },
  ttf: { color: '#a78bfa', label: 'FNT' },
  otf: { color: '#a78bfa', label: 'FNT' },
  // Archives / binary
  zip: { color: '#9ca3af', label: 'ZIP' },
  tar: { color: '#9ca3af', label: 'TAR' },
  gz: { color: '#9ca3af', label: 'GZ' },
  tgz: { color: '#9ca3af', label: 'TGZ' },
  '7z': { color: '#9ca3af', label: '7Z' },
  rar: { color: '#9ca3af', label: 'RAR' },
  // Audio / video
  mp3: { color: '#ef4444', label: 'AUD' },
  wav: { color: '#ef4444', label: 'AUD' },
  ogg: { color: '#ef4444', label: 'AUD' },
  flac: { color: '#ef4444', label: 'AUD' },
  mp4: { color: '#ef4444', label: 'VID' },
  mov: { color: '#ef4444', label: 'VID' },
  webm: { color: '#ef4444', label: 'VID' },
  // Databases
  sql: { color: '#336791', label: 'SQL' },
  db: { color: '#336791', label: 'DB' },
  sqlite: { color: '#336791', label: 'DB' },
  sqlite3: { color: '#336791', label: 'DB' },
  // Config / other
  env: { color: '#eab308', label: 'ENV' },
  ini: { color: '#6b7280', label: 'INI' },
  cfg: { color: '#6b7280', label: 'CFG' },
  conf: { color: '#6b7280', label: 'CFG' },
  log: { color: '#6b7280', label: 'LOG' },
  lock: { color: '#6b7280', label: 'LCK' },
  diff: { color: '#f59e0b', label: 'DIF' },
  patch: { color: '#f59e0b', label: 'DIF' },
  // Parabun / E-specific
  parabun: { color: '#ec4899', label: 'PB' },
  pb: { color: '#ec4899', label: 'PB' },
};

const DEFAULT_FILE = { color: '#9ca3af' };
const DEFAULT_FOLDER = { color: '#eab308' };

export function getFileIcon(name: string, isDirectory: boolean, isOpen = false): FileIcon {
  const lower = name.toLowerCase();

  if (isDirectory) {
    const hit = FOLDER_NAMES[lower];
    const { color, label } = hit ?? DEFAULT_FOLDER;
    return { kind: isOpen ? 'folder-open' : 'folder-closed', color, label };
  }

  // Special filenames (case-insensitive) take precedence over extension
  const special = SPECIAL_FILES[lower];
  if (special) return { kind: 'file', color: special.color, label: special.label };

  // Handle dotfiles like `.env.local` → try progressively shorter prefixes
  const dotMatch = /^(\.[^.]+)(\..*)?$/.exec(lower);
  if (dotMatch && SPECIAL_FILES[dotMatch[1]]) {
    const s = SPECIAL_FILES[dotMatch[1]];
    return { kind: 'file', color: s.color, label: s.label };
  }

  const ext = lower.includes('.') ? lower.split('.').pop()! : '';
  const extHit = EXTENSIONS[ext];
  if (extHit) return { kind: 'file', color: extHit.color, label: extHit.label };

  return { kind: 'file', color: DEFAULT_FILE.color };
}
