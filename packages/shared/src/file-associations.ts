/**
 * Code file types that E can optionally register itself as the default
 * handler for.
 *
 * These used to be force-registered by the installer (electron-builder's
 * `build.fileAssociations` in the root package.json). They are now opt-in:
 * the installer never touches file associations, and registration happens
 * only via the in-app "Register file types" toggle or the
 * `install.sh --register-file-types` flag.
 *
 * Single source of truth shared by the server (which performs the OS-level
 * registration) and the client (which renders the toggle and the list).
 */
export interface CodeFileAssociation {
  /** File extension without the leading dot, e.g. "ts". */
  ext: string;
  /** Human-readable name shown in the UI and OS file dialogs. */
  name: string;
}

export const CODE_FILE_ASSOCIATIONS: readonly CodeFileAssociation[] = [
  { ext: 'ts', name: 'TypeScript' },
  { ext: 'tsx', name: 'TypeScript JSX' },
  { ext: 'js', name: 'JavaScript' },
  { ext: 'jsx', name: 'JavaScript JSX' },
  { ext: 'mjs', name: 'JavaScript Module' },
  { ext: 'cjs', name: 'CommonJS' },
  { ext: 'svelte', name: 'Svelte Component' },
  { ext: 'pui', name: 'Para UI Component' },
  { ext: 'pts', name: 'Para TypeScript' },
  { ext: 'pjs', name: 'Para JavaScript' },
  { ext: 'json', name: 'JSON' },
  { ext: 'md', name: 'Markdown' },
  { ext: 'mdx', name: 'MDX' },
  { ext: 'yaml', name: 'YAML' },
  { ext: 'yml', name: 'YAML' },
  { ext: 'toml', name: 'TOML' },
  { ext: 'css', name: 'CSS' },
  { ext: 'scss', name: 'SCSS' },
  { ext: 'html', name: 'HTML' },
  { ext: 'py', name: 'Python' },
  { ext: 'rs', name: 'Rust' },
  { ext: 'go', name: 'Go' },
  { ext: 'zig', name: 'Zig' },
  { ext: 'sh', name: 'Shell Script' },
  { ext: 'sql', name: 'SQL' },
];

/**
 * The XDG/freedesktop MIME type E registers for a given extension. We use a
 * private `text/x-e-*` namespace so registration/unregistration is fully
 * reversible and (with a raised glob weight) wins over system defaults for
 * these extensions without permanently redefining shared system MIME types.
 */
export function mimeTypeForExt(ext: string): string {
  return `text/x-e-${ext}`;
}
