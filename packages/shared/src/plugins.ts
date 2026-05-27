/**
 * Plugin manifest schema for E.
 *
 * Plugins are installed from .zip files into ~/.e/plugins/<id>/. The
 * manifest is a top-level `plugin.json` file inside the zip; the rest of
 * the zip's contents are static assets the plugin references (HTML, CSS,
 * JS, images, LSP binaries, syntax grammars). No arbitrary JavaScript is
 * loaded into E's renderer or server processes — that's the central
 * security promise of v1.
 *
 * Six contribution kinds are declared here. Only `sidePanes` is wired to
 * the v1 runtime; the others are accepted in manifests but listed as
 * "not yet runtime-supported" in the Plugins UI so the schema doesn't
 * churn as we land them one at a time.
 *
 *   sidePanes          v1: WIRED. Renders a sandboxed iframe in the sidebar.
 *   lsp                Future: spawn the plugin's binary as an LSP server.
 *   primaryPanes       Future: register a sandboxed primary pane (like a
 *                      custom agent surface).
 *   syntaxHighlighters Future: register a TextMate / tree-sitter grammar.
 *   diagnostics        Future: register a diagnostics producer.
 *   hovers             Future: register a hover-content producer.
 */

export interface PluginManifest {
  /** Unique stable id. Filesystem-safe slug — `[a-z0-9-]+`. */
  id: string;
  /** Semver-ish version string for display + future update flow. */
  version: string;
  /** Human-readable name shown in the Plugins UI. */
  displayName: string;
  description?: string;
  author?: string;
  /** Homepage / repo URL. Shown in the Plugins UI. */
  homepage?: string;
  /** SPDX license id. Informational only. */
  license?: string;
  /** Minimum E version this plugin targets (semver string, optional). */
  engines?: { e?: string };
  /** Contribution points — see file header for the full list. */
  contributes?: PluginContributions;
}

export interface PluginContributions {
  sidePanes?: SidePaneContribution[];
  lsp?: LspContribution[];
  primaryPanes?: PrimaryPaneContribution[];
  syntaxHighlighters?: SyntaxHighlighterContribution[];
  diagnostics?: DiagnosticsContribution[];
  hovers?: HoverContribution[];
}

// ── sidePanes (v1: wired) ────────────────────────────────────────────────

export interface SidePaneContribution {
  /** Tab id. Becomes a SidebarTab when the plugin is enabled. */
  id: string;
  /** Label shown in the sidebar tab list. */
  label: string;
  /** SVG path-data string (single path). Matches the built-in tab icon shape. */
  icon: string;
  /**
   * Render mode. Only `iframe` is supported in v1.
   *   - iframe: load `src` (a path relative to the plugin's install dir)
   *     in a sandbox iframe.
   */
  kind: 'iframe';
  /** Relative path to the entry HTML inside the plugin zip. */
  src: string;
  /**
   * iframe sandbox flags. The default is `'allow-scripts'` (minimum useful
   * value — lets the panel run its own JS but doesn't grant same-origin
   * access to E's API). Plugins requesting `allow-same-origin` or any
   * write-y permissions trigger an extra confirmation in the UI before
   * activation.
   */
  sandbox?: string;
}

// ── lsp (future) ─────────────────────────────────────────────────────────

export interface LspContribution {
  /** Display label for the language. */
  language: string;
  /** Extensions the LSP claims (e.g. ['.foo', '.bar']). */
  extensions: string[];
  /**
   * Argv to launch the LSP server, relative to the plugin install dir.
   * The first entry is the binary; the rest are args. Future runtime
   * spawns this as a subprocess and bridges JSON-RPC over stdin/stdout
   * via the existing lsp client infrastructure.
   */
  command: string[];
}

// ── primaryPanes (future) ────────────────────────────────────────────────

export interface PrimaryPaneContribution {
  id: string;
  label: string;
  icon: string;
  kind: 'iframe';
  src: string;
}

// ── syntaxHighlighters (future) ──────────────────────────────────────────

export interface SyntaxHighlighterContribution {
  language: string;
  extensions: string[];
  /** Relative path to a TextMate grammar JSON. */
  tmGrammar?: string;
  /** Relative path to a tree-sitter parser .wasm. */
  treeSitterWasm?: string;
}

// ── diagnostics (future) ─────────────────────────────────────────────────

export interface DiagnosticsContribution {
  /** Languages / extensions the producer attaches to. */
  languages?: string[];
  extensions?: string[];
  /**
   * One of:
   *   - 'command': run a binary on save / on demand and parse output
   *     against a regex pattern (future).
   *   - 'lsp': consume diagnostics from the plugin's LSP server (future).
   */
  source: 'command' | 'lsp';
  command?: string[];
  /** Regex producing { file, line, col, severity, message } groups. */
  pattern?: string;
}

// ── hovers (future) ──────────────────────────────────────────────────────

export interface HoverContribution {
  languages?: string[];
  extensions?: string[];
  /**
   * One of:
   *   - 'lsp': delegate to the plugin's LSP server (future).
   *   - 'command': run a binary with file+pos and render its stdout as
   *     markdown (future).
   */
  source: 'lsp' | 'command';
  command?: string[];
}

// ── Runtime metadata (server-augmented) ──────────────────────────────────

/**
 * The shape returned by GET /api/plugins/list — the manifest plus
 * server-side state (enabled, installed path, etc.).
 */
export interface InstalledPlugin {
  manifest: PluginManifest;
  enabled: boolean;
  installedAt: number;
  /** Absolute path on disk; surfaced for debug, not for client navigation. */
  installPath: string;
  /** Warnings produced at manifest-parse time (e.g. "lsp contribution declared but runtime not yet wired"). */
  warnings: string[];
}

// ── Manifest validation ──────────────────────────────────────────────────

/** Filesystem-safe slug. Used as both the plugin id and its install-dir name. */
const SLUG = /^[a-z][a-z0-9-]{1,63}$/;

/**
 * Lightweight validator. Returns a list of error strings; an empty list
 * means the manifest is acceptable. Doesn't depend on zod so the schema
 * can be reused on both client (small bundle) and server.
 */
export function validateManifest(input: unknown): string[] {
  const errors: string[] = [];
  if (!input || typeof input !== 'object') {
    return ['manifest must be a JSON object'];
  }
  const m = input as Record<string, unknown>;
  if (typeof m.id !== 'string' || !SLUG.test(m.id)) {
    errors.push('manifest.id must be a lowercase slug matching /^[a-z][a-z0-9-]{1,63}$/');
  }
  if (typeof m.version !== 'string' || m.version.length === 0) {
    errors.push('manifest.version must be a non-empty string');
  }
  if (typeof m.displayName !== 'string' || m.displayName.length === 0) {
    errors.push('manifest.displayName must be a non-empty string');
  }
  const c = m.contributes;
  if (c !== undefined) {
    if (!c || typeof c !== 'object') {
      errors.push('manifest.contributes must be an object when present');
    } else {
      const con = c as Record<string, unknown>;
      const sp = con.sidePanes;
      if (sp !== undefined) {
        if (!Array.isArray(sp)) {
          errors.push('contributes.sidePanes must be an array');
        } else {
          for (let i = 0; i < sp.length; i++) {
            const item = sp[i] as Record<string, unknown> | null;
            if (!item || typeof item !== 'object') {
              errors.push(`sidePanes[${i}]: must be an object`);
              continue;
            }
            if (typeof item.id !== 'string' || !SLUG.test(item.id)) {
              errors.push(`sidePanes[${i}].id: must be a slug`);
            }
            if (typeof item.label !== 'string' || !item.label) {
              errors.push(`sidePanes[${i}].label: must be a non-empty string`);
            }
            if (typeof item.icon !== 'string' || !item.icon) {
              errors.push(`sidePanes[${i}].icon: must be a non-empty SVG path-data string`);
            }
            if (item.kind !== 'iframe') {
              errors.push(`sidePanes[${i}].kind: must be 'iframe' (v1 supports iframe only)`);
            }
            if (typeof item.src !== 'string' || !item.src) {
              errors.push(`sidePanes[${i}].src: must be a non-empty relative path`);
            } else if (item.src.includes('..')) {
              // Path traversal defence — extraction also strips ../ but
              // refusing here gives a clearer error.
              errors.push(`sidePanes[${i}].src: must not contain '..' segments`);
            }
          }
        }
      }
      // Other contribution shapes accepted-but-warned in plugin-loader.
    }
  }
  return errors;
}
