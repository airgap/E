/**
 * terminal-links.ts — Link detection and handling for terminal output.
 *
 * Detects two kinds of links in terminal output:
 *
 * 1. **URLs** (http/https) — detected by @xterm/addon-web-links with a custom
 *    click handler that requires Ctrl+Click (Cmd+Click on macOS).
 *
 * 2. **File paths** — detected by a custom ILinkProvider registered on each
 *    terminal instance. Supports absolute paths, relative paths (./  ../),
 *    paths with directory segments (src/foo.ts), and optional :line:col
 *    suffixes.
 *
 * Both link types show underline decoration on hover and require Ctrl+Click
 * to activate, matching VS Code terminal behaviour. URLs open in the default
 * browser; file paths open in the IDE editor at the indicated position.
 */

import type { Terminal, ILinkProvider, ILink } from '@xterm/xterm';
import type { ILinkProviderOptions } from '@xterm/addon-web-links';
import { editorStore } from '$lib/stores/editor.svelte';
import { terminalStore } from '$lib/stores/terminal.svelte';

// ---------------------------------------------------------------------------
// File-path regex
// ---------------------------------------------------------------------------

/**
 * Regex to detect file paths in a line of terminal text.
 *
 * Three branches (combined with alternation):
 *
 * 1. Paths with an explicit prefix: `/`, `./`, `../`, `~/`
 *    These may or may not have a file extension.
 *
 * 2. Relative paths containing at least one `/` and ending with a file
 *    extension (e.g. `src/utils/foo.ts`).
 *
 * 3. Bare filenames with a file extension that are immediately followed by
 *    `:digit` or `(digit` (e.g. `foo.ts:42` or `foo.ts(42,5)`). Without
 *    a location suffix a standalone filename is too ambiguous (could be prose).
 *
 * All three branches may be followed by `:line:col` or `(line,col)`.
 *
 * Capture groups:
 *   [1] — line number from colon format (if present)
 *   [2] — column number from colon format (if present)
 *   [3] — line number from parenthesized format (if present)
 *   [4] — column number from parenthesized format (if present)
 */
const FILE_PATH_RE = new RegExp(
  '(?:' +
    // Branch 1 – explicit path prefix
    '(?:\\.{1,2}/|~/|/)' +
    '[^\\s:\'"()\\[\\]{},;]+' +
    '|' +
    // Branch 2 – relative path with directory segments and extension
    '(?:[a-zA-Z_@][a-zA-Z0-9_@.+-]*/)+' +
    '[a-zA-Z0-9_@.+-]+\\.[a-zA-Z0-9]{1,10}' +
    '|' +
    // Branch 3 – bare filename (must be followed by :line or (line,col))
    '[a-zA-Z_][a-zA-Z0-9_.-]*\\.[a-zA-Z0-9]{1,10}(?=:\\d|\\(\\d)' +
    ')' +
    // Optional location suffix — either :line:col or (line,col) (TypeScript diagnostic style)
    '(?:' +
    '(?::(\\d+)(?::(\\d+))?)' +
    '|' +
    '(?:\\((\\d+),(\\d+)\\))' +
    ')?',
  'g',
);

// ---------------------------------------------------------------------------
// Parsed link representation
// ---------------------------------------------------------------------------

interface ParsedFileLink {
  /** Full matched text (path + optional :line:col) */
  text: string;
  /** The file-path portion only (no :line:col) */
  path: string;
  /** 1-based line number, if present */
  line?: number;
  /** 1-based column, if present */
  col?: number;
  /** Character offset of the match start within the line (0-based) */
  startIndex: number;
}

// ---------------------------------------------------------------------------
// Path scanning
// ---------------------------------------------------------------------------

/**
 * Find all file-path links within a single line of text.
 */
function findFileLinks(text: string): ParsedFileLink[] {
  const results: ParsedFileLink[] = [];
  FILE_PATH_RE.lastIndex = 0;

  let m: RegExpExecArray | null;
  while ((m = FILE_PATH_RE.exec(text)) !== null) {
    const fullMatch = m[0];
    // Capture groups: [1] colon-line, [2] colon-col, [3] paren-line, [4] paren-col
    const colonLine = m[1] as string | undefined;
    const colonCol = m[2] as string | undefined;
    const parenLine = m[3] as string | undefined;
    const parenCol = m[4] as string | undefined;

    const lineStr = colonLine || parenLine;
    const colStr = colonCol || parenCol;

    // Extract path portion (strip :line:col or (line,col) suffix)
    let path = fullMatch;
    if (colonLine) {
      const suffix = colonCol ? `:${colonLine}:${colonCol}` : `:${colonLine}`;
      if (path.endsWith(suffix)) {
        path = path.slice(0, -suffix.length);
      }
    } else if (parenLine) {
      const suffix = parenCol ? `(${parenLine},${parenCol})` : `(${parenLine})`;
      if (path.endsWith(suffix)) {
        path = path.slice(0, -suffix.length);
      }
    }

    // Skip version-number look-alikes (v1.2.3, 1.0.0)
    if (/^v?\d+\.\d+/.test(path)) continue;

    // Skip URLs (handled by WebLinksAddon)
    if (/^(?:https?|ftp):\/\//.test(path)) continue;

    // Skip very short matches (noise)
    if (path.length < 3) continue;

    results.push({
      text: fullMatch,
      path,
      line: lineStr ? parseInt(lineStr, 10) : undefined,
      col: colStr ? parseInt(colStr, 10) : undefined,
      startIndex: m.index,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/**
 * Normalise a path by resolving `.` and `..` segments.
 */
function normalizePath(p: string): string {
  const parts = p.split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '..') {
      if (resolved.length > 1) resolved.pop();
    } else if (part !== '.' && part !== '') {
      resolved.push(part);
    }
  }
  return '/' + resolved.join('/');
}

/**
 * Resolve a (possibly relative) file path against a base directory.
 *
 * - Absolute paths are returned as-is.
 * - Home-relative paths (`~/…`) are returned as-is (the server expands `~`).
 * - Everything else is joined to `cwd` and normalised.
 */
export function resolvePath(filePath: string, cwd: string): string {
  if (filePath.startsWith('/')) return filePath;
  if (filePath.startsWith('~/')) return filePath;

  const rel = filePath.startsWith('./') ? filePath.slice(2) : filePath;
  const base = cwd.endsWith('/') ? cwd : cwd + '/';
  return normalizePath(base + rel);
}

// ---------------------------------------------------------------------------
// Tooltip helpers
// ---------------------------------------------------------------------------

const TOOLTIP_CLASS = 'terminal-link-tooltip';

/** Whether the platform uses Cmd rather than Ctrl as the modifier key */
const IS_MAC = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

const MODIFIER_LABEL = IS_MAC ? 'Cmd' : 'Ctrl';

function applyTooltipStyles(el: HTMLElement): void {
  el.style.position = 'absolute';
  el.style.zIndex = '1000';
  el.style.pointerEvents = 'none';
  el.style.whiteSpace = 'nowrap';
  el.style.padding = '3px 8px';
  el.style.borderRadius = '4px';
  el.style.fontSize = '12px';
  el.style.lineHeight = '1.4';
  el.style.backgroundColor = 'var(--bg-tertiary, #1e1e1e)';
  el.style.color = 'var(--text-secondary, #ccc)';
  el.style.border = '1px solid var(--border-primary, #333)';
  el.style.boxShadow = '0 2px 8px rgba(0,0,0,.35)';
}

function showTooltip(terminal: Terminal, event: MouseEvent, message: string): void {
  hideTooltip(terminal);
  const container = terminal.element;
  if (!container) return;

  const tip = document.createElement('div');
  tip.className = `xterm-hover ${TOOLTIP_CLASS}`;
  tip.textContent = message;
  applyTooltipStyles(tip);

  const rect = container.getBoundingClientRect();
  tip.style.left = `${event.clientX - rect.left}px`;
  tip.style.top = `${event.clientY - rect.top - 28}px`;
  container.appendChild(tip);
}

function hideTooltip(terminal: Terminal): void {
  const container = terminal.element;
  if (!container) return;
  container.querySelectorAll(`.${TOOLTIP_CLASS}`).forEach((el) => el.remove());
}

// ---------------------------------------------------------------------------
// URL handler (for @xterm/addon-web-links)
// ---------------------------------------------------------------------------

/**
 * Click handler for the WebLinksAddon. Only opens the URL when the
 * platform modifier key (Ctrl / Cmd) is held.
 */
export function createUrlClickHandler(): (event: MouseEvent, uri: string) => void {
  return (event: MouseEvent, uri: string) => {
    if (event.ctrlKey || event.metaKey) {
      window.open(uri, '_blank', 'noopener');
    }
  };
}

/**
 * Hover / leave callbacks for the WebLinksAddon so that a tooltip is shown
 * when the user hovers a URL.
 */
export function createUrlLinkOptions(terminal: Terminal): ILinkProviderOptions {
  return {
    hover(event: MouseEvent, _text: string) {
      showTooltip(terminal, event, `${MODIFIER_LABEL}+Click to follow link`);
    },
    leave() {
      hideTooltip(terminal);
    },
  };
}

// ---------------------------------------------------------------------------
// File-path link provider (custom ILinkProvider)
// ---------------------------------------------------------------------------

/**
 * Create an xterm `ILinkProvider` that detects file paths in terminal output.
 *
 * @param terminal    The xterm `Terminal` instance (used to read buffer lines)
 * @param sessionId   The terminal session ID (used to look up CWD)
 * @param fallbackCwd Fallback CWD when session metadata is unavailable
 */
export function createFilePathLinkProvider(
  terminal: Terminal,
  sessionId: string,
  fallbackCwd: string,
): ILinkProvider {
  return {
    provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void) {
      const bufLine = terminal.buffer.active.getLine(bufferLineNumber - 1);
      if (!bufLine) {
        callback(undefined);
        return;
      }

      const text = bufLine.translateToString(true);
      const parsed = findFileLinks(text);

      if (parsed.length === 0) {
        callback(undefined);
        return;
      }

      // Resolve CWD: prefer live session metadata, then fallback
      const sessionMeta = terminalStore.sessions.get(sessionId);
      const cwd = sessionMeta?.cwd || fallbackCwd;

      const links: ILink[] = parsed.map((p) => ({
        range: {
          start: { x: p.startIndex + 1, y: bufferLineNumber },
          end: { x: p.startIndex + p.text.length, y: bufferLineNumber },
        },
        text: p.text,
        decorations: { pointerCursor: true, underline: true },
        activate(event: MouseEvent) {
          if (!event.ctrlKey && !event.metaKey) return;
          const resolved = resolvePath(p.path, cwd);
          const goTo = p.line ? { line: p.line, col: p.col ?? 1 } : undefined;
          editorStore.openFile(resolved, false, goTo);
        },
        hover(event: MouseEvent) {
          let label = p.path;
          if (p.line) label += `:${p.line}`;
          if (p.col) label += `:${p.col}`;
          showTooltip(terminal, event, `${MODIFIER_LABEL}+Click to open ${label}`);
        },
        leave() {
          hideTooltip(terminal);
        },
      }));

      callback(links);
    },
  };
}
