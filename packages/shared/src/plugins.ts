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
  /** Command-source formatters (LYK-1046). */
  formatters?: FormatterContribution[];
  /** Command-source document symbol providers (LYK-1048). */
  documentSymbols?: DocumentSymbolsContribution[];
  /** Command-source completion providers (LYK-1049). */
  completions?: CompletionsContribution[];
  /** Command-source inline (Copilot-style) completion providers (LYK-1050). */
  inlineCompletions?: InlineCompletionsContribution[];
  /** Terminal profiles surfaced in the "New Terminal" picker (LYK-1043). */
  terminalProfiles?: TerminalProfileContribution[];
  /** Debug adapters surfaced in the DebugPanel adapter picker (LYK-1044). */
  debuggers?: DebugAdapterContribution[];
  /** Workspace tasks surfaced in the task runner dropdown (LYK-1045). */
  taskDefinitions?: TaskDefinitionContribution[];
  /** Declarative sidebar tree views populated via the RPC bridge (LYK-1041). */
  treeViews?: TreeViewContribution[];
  /** Command-source references providers (LYK-1051). */
  references?: ReferencesContribution[];
  /** Command-source rename providers (LYK-1053). */
  rename?: RenameContribution[];
  /** Command-source code-action providers (LYK-1047 / LYK-1052). */
  codeActions?: CodeActionsContribution[];
  /** Command-source test discovery providers (LYK-1054). */
  testDiscovery?: TestDiscoveryContribution[];
  /** Command-source test runner providers (LYK-1055). */
  testRunner?: TestRunnerContribution[];
  // ── Phase 1 contribution types (LYK-1030/1031/1032/1033/1034/1037/1038/1039/1042). ──
  // Schema lands first; per-type host-side wiring lands per ticket so the
  // manifest shape doesn't churn as features ship.
  commands?: CommandContribution[];
  keybindings?: KeybindingContribution[];
  menus?: MenusContribution;
  statusBarItems?: StatusBarItemContribution[];
  configuration?: ConfigurationContribution;
  snippets?: SnippetsContribution[];
  themes?: ThemeContribution[];
  iconThemes?: IconThemeContribution[];
  languageConfiguration?: LanguageConfigurationContribution[];
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
  /** iframe sandbox flags; see SidePaneContribution.sandbox. Defaults to 'allow-scripts'. */
  sandbox?: string;
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

// ── formatters (LYK-1046, command source) ────────────────────────────────

/**
 * Command-source formatter. Wired in the same shape as HoverContribution:
 * the binary is spawned with `[…argv, absPath]`, the unformatted content
 * is piped to its stdin, and stdout is taken as the formatted replacement.
 * Stderr is ignored (host logs it for debugging only).
 */
export interface FormatterContribution {
  languages?: string[];
  extensions?: string[];
  source: 'command' | 'lsp';
  command?: string[];
}

// ── task definitions (LYK-1045) ──────────────────────────────────────────

/**
 * Plugin-contributed workspace task. Surfaces in the existing task
 * runner dropdown alongside package.json scripts and Makefile targets.
 *
 *   - command: the display string (what users see and read)
 *   - execution: the full shell command the terminal runs
 * Activation reuses the host's task-runner spawn path; plugins don't
 * implement the run side themselves in v1.
 */
export interface TaskDefinitionContribution {
  id: string;
  name: string;
  command: string;
  execution: string;
}

// ── tree views (LYK-1041, declarative) ───────────────────────────────────

/**
 * Plugin-contributed sidebar tree view. The host registers a sidebar
 * tab per declared view; the plugin's iframe populates it via the
 * `ui.setTreeData` RPC (LYK-1056 bridge). Each node optionally targets
 * a plugin-contributed command on activate.
 */
export interface TreeViewContribution {
  id: string;
  title: string;
  /** SVG path-data for the sidebar tab icon. Falls back to a generic shape. */
  icon?: string;
}

/**
 * Tree node payload — what plugins send through `ui.setTreeData`. The
 * host renders this recursively; ids must be unique within a single
 * view's data set so the renderer can key tree rows and persist
 * expand/collapse state.
 */
export interface TreeViewNode {
  id: string;
  label: string;
  /** Optional 1-3 character label / SVG path / emoji. */
  icon?: string;
  /** Whether the row starts expanded. Default false. */
  expanded?: boolean;
  /** Optional plugin-contributed command id to fire on activate. */
  command?: string;
  children?: TreeViewNode[];
}

export interface UiSetTreeDataParams {
  viewId: string;
  nodes: TreeViewNode[];
}

// ── debug adapters (LYK-1044) ────────────────────────────────────────────

/**
 * Plugin-contributed debug adapter. Surfaces in the DebugPanel adapter
 * list alongside built-in adapters. command[0] is install-dir-relative
 * when the plugin bundles the adapter, or an absolute PATH-resolvable
 * binary name (the runtime enforces existence; absolute paths outside
 * the install dir are refused at registration time).
 */
export interface DebugAdapterContribution {
  id: string;
  label: string;
  /** Languages this adapter can debug. Used by future "Debug File" auto-routing. */
  languages: string[];
  command: string;
  args?: string[];
  /** Human-readable install instructions shown when the adapter is missing. */
  installHint?: string;
}

// ── terminal profiles (LYK-1043) ─────────────────────────────────────────

/**
 * Plugin-contributed terminal profile. Surfaces in the "New Terminal"
 * picker alongside the host's auto-detected shells. shellPath is
 * relative to the plugin install dir or absolute; absolute paths are
 * only allowed for system shells (those that exist on PATH) so a
 * plugin can't drop a malicious binary that runs on click.
 */
export interface TerminalProfileContribution {
  /** Stable id, prefixed with the pluginId at registration time. */
  id: string;
  name: string;
  shellPath: string;
  args?: string[];
  env?: Record<string, string>;
  icon?: string;
}

// ── inline completions (LYK-1050, Copilot-style command source) ──────────

/**
 * Command-source inline completion provider. Spawn shape:
 *   `[…argv, absPath, <line>, <character>]`
 * with the file content piped to stdin. Stdout is JSON:
 *   { insertText: string, range?: { startLine, startChar, endLine, endChar } }
 *
 * range defaults to a single-point insertion at the cursor when omitted.
 * Returning empty / no JSON suppresses the suggestion. v1 first-wins:
 * inline ghost text can't compose results from multiple plugins
 * meaningfully.
 */
export interface InlineCompletionsContribution {
  languages?: string[];
  extensions?: string[];
  source: 'command' | 'lsp';
  command?: string[];
}

// ── test discovery (LYK-1054, command source) ────────────────────────────

/**
 * Command-source test discovery. Spawn shape:
 *   `[…argv, <workspaceRoot>]`
 * (no stdin). Stdout is JSON:
 *   Array<{
 *     id: string,        // unique within the plugin's tree
 *     label: string,
 *     type: 'suite' | 'test',
 *     children?: TestNode[],
 *     file?: string,
 *     line?: number
 *   }>
 * Results are aggregated across plugins so multiple frameworks can
 * coexist (e.g. one plugin for vitest, another for cargo test). The
 * client merges all roots into a single tree.
 */
export interface TestDiscoveryContribution {
  source: 'command' | 'lsp';
  command?: string[];
}

// ── test runner (LYK-1055, command source) ───────────────────────────────

/**
 * Command-source test runner. Spawn shape:
 *   `[…argv, <workspaceRoot>, <testId1>, <testId2>, …]`
 * Stdout is newline-delimited JSON events:
 *   { type: 'start'|'pass'|'fail'|'skip'|'output'|'done',
 *     testId?: string, message?: string, duration?: number }
 * v1 buffers all events and returns them on completion; SSE / streaming
 * lands when LYK-1014 Test Explorer wires its progressive UI.
 */
export interface TestRunnerContribution {
  source: 'command' | 'lsp';
  command?: string[];
}

// ── code actions / refactoring (LYK-1047 / LYK-1052, command source) ────

/**
 * Command-source code action provider. Spawn shape:
 *   `[…argv, absPath, <startLine>, <startChar>, <endLine>, <endChar>]`
 * with the file content piped to stdin. Stdout is JSON:
 *   Array<{
 *     title: string,
 *     kind?: string,        // 'quickfix' | 'refactor.rename' | 'refactor.extract' | …
 *     edit?: TextEdit,                       // single-file replacement
 *     workspaceEdit?: { [filePath]: TextEdit[] } // multi-file (LYK-1052)
 *   }>
 * An action may carry `edit`, `workspaceEdit`, or neither (when it's
 * just a placeholder for a future LYK-1056 ui.runCommand dispatch).
 * The same contribution surfaces both quickfix-shaped actions (LYK-1047)
 * and refactoring providers (LYK-1052) — `kind` lets the menu UI
 * categorize them ("Refactor…" group vs "Quick Fix…").
 */
export interface CodeActionsContribution {
  languages?: string[];
  extensions?: string[];
  source: 'command' | 'lsp';
  command?: string[];
}

// ── rename (LYK-1053, command source) ────────────────────────────────────

/**
 * Command-source rename provider. Spawn shape:
 *   `[…argv, absPath, <line>, <character>, <newName>]`
 * with the file content piped to stdin. Stdout is JSON describing the
 * resulting workspace edit:
 *
 *   { "<absPath>": [
 *       { startLine, startCharacter, endLine, endCharacter, newText }
 *     ],
 *     ...
 *   }
 *
 * Positions are 0-indexed. Empty objects mean "no edit possible" (the
 * client surfaces a notification but doesn't error).
 */
export interface RenameContribution {
  languages?: string[];
  extensions?: string[];
  source: 'command' | 'lsp';
  command?: string[];
}

// ── references (LYK-1051, command source) ────────────────────────────────

/**
 * Command-source references provider. Spawned with
 *   `[…argv, absPath, <line>, <character>]`
 * with the file content piped to stdin. Stdout is JSON:
 *   Array<{ file, line, character, endLine?, endCharacter? }>
 * Positions are 0-indexed (LSP convention) so plugin authors can reuse
 * existing tooling without translation.
 */
export interface ReferencesContribution {
  languages?: string[];
  extensions?: string[];
  source: 'command' | 'lsp';
  command?: string[];
}

// ── completions (LYK-1049, command source) ───────────────────────────────

/**
 * Command-source completion provider. Spawned as
 *   `[…argv, absPath, <line>, <character>]`
 * with the file content piped to stdin. Stdout is parsed as JSON:
 *   Array<{ label, insertText?, detail?, kind?, documentation? }>
 * `insertText` defaults to `label` when omitted.
 */
export interface CompletionsContribution {
  languages?: string[];
  extensions?: string[];
  source: 'command' | 'lsp';
  command?: string[];
  /** Optional trigger characters honored by the host autocomplete loop. */
  triggerCharacters?: string[];
}

// ── document symbols (LYK-1048, command source) ──────────────────────────

/**
 * Command-source document symbols. Spawn convention:
 *   `[…argv, absPath]`
 * The unformatted content is piped to stdin; stdout is parsed as JSON
 * matching the host's normalized Symbol shape:
 *   { name, kind, startRow, startCol, endRow, endCol, children? }
 * Out-of-shape entries are dropped silently — the parser is forgiving.
 */
export interface DocumentSymbolsContribution {
  languages?: string[];
  extensions?: string[];
  source: 'command' | 'lsp';
  command?: string[];
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

// ── commands (LYK-1030) ──────────────────────────────────────────────────

/**
 * A command id the plugin declares. Activating the command dispatches a
 * `command-invoked` message to the plugin's iframe via the postMessage
 * bridge (LYK-1056); plugins can also fire their own commands from inside
 * the iframe (e.g. from a menu the plugin builds in its sidePane).
 */
export interface CommandContribution {
  /** Globally unique. Convention: `<pluginId>.<verb>`. */
  command: string;
  /** Display name in palette / menus. */
  title: string;
  /** Optional grouping label in the palette ("Git", "Debug", "Plugin"). */
  category?: string;
  /** Optional palette icon (SVG path-data). */
  icon?: string;
}

// ── keybindings (LYK-1031) ───────────────────────────────────────────────

/**
 * Bind a (plugin-contributed) command to a keystroke. The host installs the
 * binding while the plugin is enabled and removes it on disable. `when`
 * expressions are evaluated against a small allowlist of host states; the
 * exact grammar lands with LYK-1031.
 */
export interface KeybindingContribution {
  /** Target command id (host-built-in or plugin-contributed). */
  command: string;
  /** Primary chord: "ctrl+shift+x", "alt+f5", "cmd+k cmd+s". */
  key: string;
  /** Optional macOS-specific override. */
  mac?: string;
  /** Optional context expression — empty / undefined = always. */
  when?: string;
}

// ── menus (LYK-1032) ─────────────────────────────────────────────────────

/**
 * Menu placements — VS Code-style. The keys are well-known menu ids the
 * host renders; the values are the menu-item descriptors. Only
 * `commandPalette` is wired in the first pass (LYK-998); the others land
 * with the menu surface that owns them.
 */
export interface MenusContribution {
  /** Items injected into the command palette. */
  commandPalette?: MenuItem[];
  /** Editor-content right-click menu. Wires later. */
  'editor/context'?: MenuItem[];
  /** Editor tab right-click menu. Wires later. */
  'editor/title'?: MenuItem[];
  /** File-tree right-click menu. Wires later. */
  'explorer/context'?: MenuItem[];
  /** Status bar right-click menu. Wires later. */
  'statusBar/context'?: MenuItem[];
}

export interface MenuItem {
  /** Target command id. */
  command: string;
  /** Optional context expression. */
  when?: string;
  /** Optional grouping (sort key); e.g. "navigation@1". */
  group?: string;
}

// ── statusBarItems (LYK-1042) ────────────────────────────────────────────

export interface StatusBarItemContribution {
  /** Stable id, unique within the plugin. */
  id: string;
  /** Left or right zone. */
  alignment: 'left' | 'right';
  /** Lower numbers sort closer to center; defaults to 0. */
  priority?: number;
  /** Initial text. Plugin can update later via the postMessage bridge. */
  text: string;
  /** Hover tooltip. */
  tooltip?: string;
  /** Command fired on click. */
  command?: string;
}

// ── configuration (LYK-1033) ─────────────────────────────────────────────

/**
 * Schema-driven plugin settings. The host renders them in Settings →
 * Plugins → <plugin>; values are persisted per workspace under a key
 * derived from the plugin id. Per-property schema follows a minimal
 * JSON-Schema subset (type/default/description/enum).
 */
export interface ConfigurationContribution {
  /** Section title in the Settings UI. */
  title?: string;
  /** Map of dotted-setting-keys → property schema. */
  properties: Record<string, ConfigurationProperty>;
}

export interface ConfigurationProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  default?: unknown;
  description?: string;
  enum?: unknown[];
  /** When type is 'array', schema of each item. */
  items?: { type: ConfigurationProperty['type'] };
}

// ── snippets (LYK-1037) ──────────────────────────────────────────────────

/**
 * Bundle of editor snippets per language. `path` resolves inside the
 * plugin install dir; the file shape mirrors VS Code's snippet JSON
 * (`{ name: { prefix, body, description } }`).
 */
export interface SnippetsContribution {
  language: string;
  path: string;
}

// ── themes (LYK-1038) ────────────────────────────────────────────────────

export interface ThemeContribution {
  /** Unique theme id. Convention: `<pluginId>.<theme>`. */
  id: string;
  /** Display label. */
  label: string;
  /** Base type — drives default token fallbacks. */
  uiTheme: 'vs-dark' | 'vs';
  /** Relative path to the theme JSON inside the plugin install dir. */
  path: string;
}

// ── iconThemes (LYK-1039) ────────────────────────────────────────────────

export interface IconThemeContribution {
  id: string;
  label: string;
  path: string;
}

// ── languageConfiguration (LYK-1034) ─────────────────────────────────────

/**
 * Per-language tokenizer hints — bracket pairs, autoclosing chars, comment
 * markers, indentation rules. Same shape as VS Code's
 * language-configuration.json (referenced via `path`).
 */
export interface LanguageConfigurationContribution {
  language: string;
  /** Relative path to the language-configuration JSON. */
  path: string;
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
      // Phase 1 contribution validators. Each does shallow shape checks —
      // missing required fields are errors; over-strict rules (e.g. icon
      // path-data correctness) are left to runtime, which logs warnings.

      const cmds = con.commands;
      if (cmds !== undefined) {
        if (!Array.isArray(cmds)) {
          errors.push('contributes.commands must be an array');
        } else {
          for (let i = 0; i < cmds.length; i++) {
            const c = cmds[i] as Record<string, unknown> | null;
            if (!c || typeof c !== 'object') {
              errors.push(`commands[${i}]: must be an object`);
              continue;
            }
            if (typeof c.command !== 'string' || !c.command) {
              errors.push(`commands[${i}].command: must be a non-empty string`);
            }
            if (typeof c.title !== 'string' || !c.title) {
              errors.push(`commands[${i}].title: must be a non-empty string`);
            }
          }
        }
      }

      const kbs = con.keybindings;
      if (kbs !== undefined) {
        if (!Array.isArray(kbs)) {
          errors.push('contributes.keybindings must be an array');
        } else {
          for (let i = 0; i < kbs.length; i++) {
            const k = kbs[i] as Record<string, unknown> | null;
            if (!k || typeof k !== 'object') {
              errors.push(`keybindings[${i}]: must be an object`);
              continue;
            }
            if (typeof k.command !== 'string' || !k.command) {
              errors.push(`keybindings[${i}].command: must be a non-empty string`);
            }
            if (typeof k.key !== 'string' || !k.key) {
              errors.push(`keybindings[${i}].key: must be a non-empty string`);
            }
          }
        }
      }

      const sbs = con.statusBarItems;
      if (sbs !== undefined) {
        if (!Array.isArray(sbs)) {
          errors.push('contributes.statusBarItems must be an array');
        } else {
          for (let i = 0; i < sbs.length; i++) {
            const s = sbs[i] as Record<string, unknown> | null;
            if (!s || typeof s !== 'object') {
              errors.push(`statusBarItems[${i}]: must be an object`);
              continue;
            }
            if (typeof s.id !== 'string' || !s.id) {
              errors.push(`statusBarItems[${i}].id: must be a non-empty string`);
            }
            if (s.alignment !== 'left' && s.alignment !== 'right') {
              errors.push(`statusBarItems[${i}].alignment: must be 'left' or 'right'`);
            }
            if (typeof s.text !== 'string') {
              errors.push(`statusBarItems[${i}].text: must be a string`);
            }
          }
        }
      }

      const menus = con.menus;
      if (menus !== undefined && (typeof menus !== 'object' || Array.isArray(menus))) {
        errors.push('contributes.menus must be an object map');
      }
      const cfg = con.configuration;
      if (cfg !== undefined) {
        if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
          errors.push('contributes.configuration must be an object');
        } else {
          const props = (cfg as Record<string, unknown>).properties;
          if (!props || typeof props !== 'object' || Array.isArray(props)) {
            errors.push('contributes.configuration.properties must be an object');
          }
        }
      }
      // themes / iconThemes / snippets / languageConfiguration share a
      // minimal `{ id?, label?, path }` shape; just require `path` is
      // present + relative when declared.
      for (const key of ['themes', 'iconThemes', 'snippets', 'languageConfiguration'] as const) {
        const v = con[key];
        if (v === undefined) continue;
        if (!Array.isArray(v)) {
          errors.push(`contributes.${key} must be an array`);
          continue;
        }
        for (let i = 0; i < v.length; i++) {
          const it = v[i] as Record<string, unknown> | null;
          if (!it || typeof it !== 'object') {
            errors.push(`${key}[${i}]: must be an object`);
            continue;
          }
          if (typeof it.path !== 'string' || !it.path) {
            errors.push(`${key}[${i}].path: must be a non-empty relative path`);
          } else if (it.path.includes('..')) {
            errors.push(`${key}[${i}].path: must not contain '..' segments`);
          }
        }
      }
      // Other contribution shapes accepted-but-warned in plugin-loader.
    }
  }
  return errors;
}
