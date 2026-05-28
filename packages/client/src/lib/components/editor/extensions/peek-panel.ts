/**
 * Peek Panel — inline block widget that expands between editor lines to show
 * another file's content (or a list of cross-file locations) in place, the
 * way VS Code's `Alt-F12` / `Shift-F12` do. Supports two modes:
 *
 *   snippet    — a slice of the target file around a focus line. Used by
 *                `triggerPeekDefinition`.
 *   references — a clickable list of locations. Used by
 *                `triggerPeekReferences`; clicking a row swaps the panel
 *                into snippet mode for that location with a "← back" button.
 *
 * Opening is animated as a 3D fold: the panel pivots down from its anchor
 * line via `rotateX(-12deg) → 0deg` with perspective, fading and growing
 * height simultaneously. Closing reverses it. `prefers-reduced-motion`
 * collapses the animation to an instant state change.
 */

import {
  EditorView,
  ViewPlugin,
  Decoration,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { StateField, StateEffect, RangeSetBuilder, type Extension } from '@codemirror/state';
import { api } from '$lib/api/client';
import { editorStore } from '$lib/stores/editor.svelte';
import { lspStore } from '$lib/stores/lsp.svelte';

// ── Request shapes ───────────────────────────────────────────────────────────

export interface SnippetMode {
  kind: 'snippet';
  targetPath: string;
  /** 0-indexed inclusive line range to surface from the target. */
  startLine: number;
  endLine: number;
  /** 0-indexed line to highlight as "this is the match". */
  focusLine: number;
}

export interface PeekReference {
  targetPath: string;
  /** 0-indexed line of the reference. */
  line: number;
  /** Single-line preview of the reference site (trimmed). */
  preview: string;
}

export interface ReferencesMode {
  kind: 'references';
  /** Symbol whose references these are (used in header label). */
  symbol?: string;
  locations: PeekReference[];
}

export type PeekMode = SnippetMode | ReferencesMode;

export interface PeekRequest {
  /** 1-indexed line in the HOST editor where the panel mounts below. */
  anchorLine: number;
  mode: PeekMode;
  /** Set when this panel was opened from a references list; clicking "back"
   *  restores that list without re-fetching. */
  returnTo?: ReferencesMode;
}

export const peekOpen = StateEffect.define<PeekRequest>();
export const peekClose = StateEffect.define<number>(); // anchorLine; -1 = all

/** Trim an absolute path to its last two segments for the panel header. */
function shortPath(p: string): string {
  const parts = p.split('/').filter(Boolean);
  return parts.slice(-2).join('/');
}

// ── Widget ──────────────────────────────────────────────────────────────────

class PeekWidget extends WidgetType {
  constructor(private req: PeekRequest) {
    super();
  }

  eq(other: PeekWidget): boolean {
    if (other.req.anchorLine !== this.req.anchorLine) return false;
    const a = this.req.mode;
    const b = other.req.mode;
    if (a.kind !== b.kind) return false;
    if (a.kind === 'snippet' && b.kind === 'snippet') {
      return (
        a.targetPath === b.targetPath &&
        a.startLine === b.startLine &&
        a.endLine === b.endLine &&
        a.focusLine === b.focusLine
      );
    }
    if (a.kind === 'references' && b.kind === 'references') {
      if (a.locations.length !== b.locations.length) return false;
      for (let i = 0; i < a.locations.length; i++) {
        if (a.locations[i].targetPath !== b.locations[i].targetPath) return false;
        if (a.locations[i].line !== b.locations[i].line) return false;
      }
      return true;
    }
    return false;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-peek-panel cm-peek-entering';
    wrap.setAttribute('role', 'region');
    wrap.setAttribute(
      'aria-label',
      this.req.mode.kind === 'references' ? 'Peek references' : 'Peek definition',
    );

    wrap.appendChild(this.renderHeader(view));
    wrap.appendChild(this.renderBody(view));

    // Keyboard routing: Esc closes; Ctrl+Enter jumps when snippet-mode.
    wrap.tabIndex = 0;
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeAt(view, this.req.anchorLine);
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.stopPropagation();
        if (this.req.mode.kind === 'snippet') {
          const m = this.req.mode;
          closeAll(view);
          editorStore.openFile(m.targetPath, false, { line: m.focusLine + 1, col: 1 });
        }
      }
    });

    // Defer the open-class so the CSS transition actually runs.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        wrap.classList.remove('cm-peek-entering');
        wrap.classList.add('cm-peek-open');
      });
    });
    setTimeout(() => wrap.focus(), 0);

    return wrap;
  }

  private renderHeader(view: EditorView): HTMLElement {
    const header = document.createElement('div');
    header.className = 'cm-peek-header';

    const label = document.createElement('div');
    label.className = 'cm-peek-label';

    // If we came from a references list, show a "back" affordance first.
    if (this.req.returnTo) {
      const back = document.createElement('button');
      back.className = 'cm-peek-btn cm-peek-back';
      back.textContent = '←';
      back.title = 'Back to references list';
      back.addEventListener('click', () => {
        view.dispatch({
          effects: peekOpen.of({
            anchorLine: this.req.anchorLine,
            mode: this.req.returnTo!,
          }),
        });
      });
      label.appendChild(back);
    }

    const icon = document.createElement('span');
    icon.className = 'cm-peek-icon';
    icon.textContent = this.req.mode.kind === 'references' ? '❯' : '◈';
    label.appendChild(icon);

    if (this.req.mode.kind === 'snippet') {
      const m = this.req.mode;
      const file = document.createElement('span');
      file.className = 'cm-peek-path';
      file.textContent = shortPath(m.targetPath);
      label.appendChild(file);
      const lineLabel = document.createElement('span');
      lineLabel.className = 'cm-peek-line';
      lineLabel.textContent = `line ${m.focusLine + 1}`;
      label.appendChild(lineLabel);
    } else {
      const title = document.createElement('span');
      title.className = 'cm-peek-path';
      title.textContent = this.req.mode.symbol
        ? `References to ${this.req.mode.symbol}`
        : 'References';
      label.appendChild(title);
      const count = document.createElement('span');
      count.className = 'cm-peek-line';
      count.textContent = `${this.req.mode.locations.length} match${
        this.req.mode.locations.length === 1 ? '' : 'es'
      }`;
      label.appendChild(count);
    }
    header.appendChild(label);

    // Right side: actions
    const actions = document.createElement('div');
    actions.className = 'cm-peek-actions';

    if (this.req.mode.kind === 'snippet') {
      const m = this.req.mode;
      const jump = document.createElement('button');
      jump.className = 'cm-peek-btn';
      jump.textContent = 'Jump to file';
      jump.title = 'Open this file and close the peek (Ctrl+Enter)';
      jump.addEventListener('click', () => {
        closeAll(view);
        editorStore.openFile(m.targetPath, false, { line: m.focusLine + 1, col: 1 });
      });
      actions.appendChild(jump);
    }

    const close = document.createElement('button');
    close.className = 'cm-peek-btn cm-peek-close';
    close.textContent = '×';
    close.title = 'Close (Esc)';
    close.addEventListener('click', () => closeAt(view, this.req.anchorLine));
    actions.appendChild(close);

    header.appendChild(actions);
    return header;
  }

  private renderBody(view: EditorView): HTMLElement {
    const body = document.createElement('div');
    body.className = 'cm-peek-body';

    if (this.req.mode.kind === 'snippet') {
      this.renderSnippet(body);
    } else {
      this.renderReferences(view, body, this.req.mode);
    }
    return body;
  }

  private renderSnippet(body: HTMLElement): void {
    const m = this.req.mode as SnippetMode;
    const pre = document.createElement('pre');
    pre.className = 'cm-peek-code';
    pre.textContent = 'Loading…';
    body.appendChild(pre);

    void api.files
      .read(m.targetPath)
      .then((res) => {
        const lines = res.data.content.split('\n');
        const from = Math.max(0, m.startLine);
        const to = Math.min(lines.length - 1, m.endLine);
        const slice = lines.slice(from, to + 1);
        pre.textContent = '';
        slice.forEach((text, i) => {
          const rowLine = from + i;
          const row = document.createElement('div');
          row.className = 'cm-peek-row';
          if (rowLine === m.focusLine) row.classList.add('cm-peek-row-focus');
          const gutter = document.createElement('span');
          gutter.className = 'cm-peek-gutter';
          gutter.textContent = String(rowLine + 1);
          const code = document.createElement('span');
          code.className = 'cm-peek-text';
          code.textContent = text || ' ';
          row.appendChild(gutter);
          row.appendChild(code);
          pre.appendChild(row);
        });
        const focus = pre.querySelector<HTMLElement>('.cm-peek-row-focus');
        if (focus) {
          body.scrollTop = Math.max(
            0,
            focus.offsetTop - body.clientHeight / 2 + focus.clientHeight / 2,
          );
        }
      })
      .catch((err) => {
        pre.textContent = `Unable to read ${m.targetPath}: ${String(err).slice(0, 200)}`;
        pre.classList.add('cm-peek-error');
      });
  }

  private renderReferences(view: EditorView, body: HTMLElement, mode: ReferencesMode): void {
    const list = document.createElement('div');
    list.className = 'cm-peek-reflist';
    body.appendChild(list);

    // Group by file so users see files and how many hits each has.
    const byFile = new Map<string, PeekReference[]>();
    for (const loc of mode.locations) {
      const arr = byFile.get(loc.targetPath) ?? [];
      arr.push(loc);
      byFile.set(loc.targetPath, arr);
    }

    for (const [path, locs] of byFile.entries()) {
      const group = document.createElement('div');
      group.className = 'cm-peek-refgroup';

      const groupHeader = document.createElement('div');
      groupHeader.className = 'cm-peek-refgroup-header';
      groupHeader.textContent = `${shortPath(path)} · ${locs.length}`;
      group.appendChild(groupHeader);

      for (const loc of locs) {
        const row = document.createElement('button');
        row.className = 'cm-peek-refrow';
        row.type = 'button';
        const lineNo = document.createElement('span');
        lineNo.className = 'cm-peek-gutter';
        lineNo.textContent = String(loc.line + 1);
        const preview = document.createElement('span');
        preview.className = 'cm-peek-text';
        preview.textContent = loc.preview || '…';
        row.appendChild(lineNo);
        row.appendChild(preview);
        row.addEventListener('click', () => {
          // Swap this panel into snippet mode for the clicked location,
          // remembering the references list so the back button restores it.
          view.dispatch({
            effects: peekOpen.of({
              anchorLine: this.req.anchorLine,
              returnTo: mode,
              mode: {
                kind: 'snippet',
                targetPath: loc.targetPath,
                startLine: Math.max(0, loc.line - 4),
                endLine: loc.line + 4,
                focusLine: loc.line,
              },
            }),
          });
        });
        group.appendChild(row);
      }
      list.appendChild(group);
    }
  }

  get estimatedHeight(): number {
    return this.req.mode.kind === 'references' ? 260 : 260;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

// ── State field + view plugin ────────────────────────────────────────────────

const peekField = StateField.define<PeekRequest[]>({
  create: () => [],
  update(current, tr) {
    let next = current;
    for (const e of tr.effects) {
      if (e.is(peekOpen)) {
        next = next.filter((p) => p.anchorLine !== e.value.anchorLine).concat(e.value);
      } else if (e.is(peekClose)) {
        next = e.value < 0 ? [] : next.filter((p) => p.anchorLine !== e.value);
      }
    }
    return next;
  },
});

function peekDecorations(view: EditorView): DecorationSet {
  const peeks = view.state.field(peekField, false) ?? [];
  const builder = new RangeSetBuilder<Decoration>();
  const sorted = [...peeks].sort((a, b) => a.anchorLine - b.anchorLine);
  for (const req of sorted) {
    const lineNum = Math.min(Math.max(1, req.anchorLine), view.state.doc.lines);
    const line = view.state.doc.line(lineNum);
    builder.add(
      line.to,
      line.to,
      Decoration.widget({ widget: new PeekWidget(req), block: true, side: 1 }),
    );
  }
  return builder.finish();
}

const peekPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = peekDecorations(view);
    }
    update(u: ViewUpdate) {
      const fieldChanged = u.startState.field(peekField) !== u.state.field(peekField);
      if (fieldChanged || u.docChanged) {
        this.decorations = peekDecorations(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

// ── Public API ───────────────────────────────────────────────────────────────

export function closeAt(view: EditorView, anchorLine: number): void {
  view.dispatch({ effects: peekClose.of(anchorLine) });
}

export function closeAll(view: EditorView): void {
  view.dispatch({ effects: peekClose.of(-1) });
}

/** Open a Peek Definition panel at the current cursor via LSP. */
export function triggerPeekDefinition(view: EditorView, language: string): boolean {
  if (!lspStore.isConnected(language)) return false;
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  const filePath = editorStore.activeTab?.filePath || '';
  if (!filePath) return false;

  void lspStore
    .request(language, 'textDocument/definition', {
      textDocument: { uri: `file://${filePath}` },
      position: { line: line.number - 1, character: pos - line.from },
    })
    .then((result: any) => {
      if (!result) return;
      const locations = Array.isArray(result) ? result : [result];
      const loc = locations[0];
      if (!loc) return;
      const targetUri: string = loc.targetUri || loc.uri || '';
      const targetRange = loc.targetRange || loc.range;
      if (!targetUri || !targetRange) return;
      const targetPath = targetUri.replace(/^file:\/\//, '');
      const focus = targetRange.start.line as number;
      const pad = 6;
      view.dispatch({
        effects: peekOpen.of({
          anchorLine: line.number,
          mode: {
            kind: 'snippet',
            targetPath,
            startLine: Math.max(0, focus - pad),
            endLine: focus + pad,
            focusLine: focus,
          },
        }),
      });
    })
    .catch(() => {});

  return true;
}

/**
 * Open a Peek References panel at the current cursor. Tries LSP first;
 * when no LSP is connected for `language`, falls back to command-source
 * plugin references contributions (LYK-1051) so plugin authors can fill
 * in languages the LSP doesn't cover.
 */
export function triggerPeekReferences(view: EditorView, language: string): boolean {
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  const filePath = editorStore.activeTab?.filePath || '';
  if (!filePath) return false;
  if (!lspStore.isConnected(language)) {
    return triggerPluginPeekReferences(view, filePath, line, pos);
  }

  // Capture the word under the cursor for the header label. Best-effort only.
  const text = line.text;
  const col = pos - line.from;
  const wordMatch = text.slice(0, col).match(/[\w$]+$/);
  const wordEnd = text.slice(col).match(/^[\w$]*/);
  const symbol = (wordMatch?.[0] ?? '') + (wordEnd?.[0] ?? '');

  void lspStore
    .request(language, 'textDocument/references', {
      textDocument: { uri: `file://${filePath}` },
      position: { line: line.number - 1, character: col },
      context: { includeDeclaration: true },
    })
    .then(async (result: any) => {
      if (!Array.isArray(result) || result.length === 0) return;
      // Build preview snippets: one line of each reference site. Read each
      // unique file once so repeated references hit the same slice.
      const fileCache = new Map<string, string[]>();
      const locs: PeekReference[] = [];
      for (const r of result) {
        const uri: string = r.uri || r.targetUri || '';
        const range = r.range || r.targetRange;
        if (!uri || !range) continue;
        const path = uri.replace(/^file:\/\//, '');
        let lines = fileCache.get(path);
        if (!lines) {
          try {
            const res = await api.files.read(path);
            lines = res.data.content.split('\n');
            fileCache.set(path, lines);
          } catch {
            lines = [];
            fileCache.set(path, lines);
          }
        }
        const lineNo = range.start.line as number;
        const preview = (lines[lineNo] ?? '').trim().slice(0, 160);
        locs.push({ targetPath: path, line: lineNo, preview });
      }
      if (locs.length === 0) return;

      view.dispatch({
        effects: peekOpen.of({
          anchorLine: line.number,
          mode: { kind: 'references', symbol: symbol || undefined, locations: locs },
        }),
      });
    })
    .catch(() => {});

  return true;
}

/**
 * Plugin-source fallback for Peek References (LYK-1051). Same UX as the
 * LSP path but the locations come from `api.plugins.references`; we
 * union every plugin's contributions before rendering.
 */
function triggerPluginPeekReferences(
  view: EditorView,
  filePath: string,
  line: { number: number; from: number; text: string },
  pos: number,
): boolean {
  const col = pos - line.from;
  const content = view.state.doc.toString();
  const text = line.text;
  const wordMatch = text.slice(0, col).match(/[\w$]+$/);
  const wordEnd = text.slice(col).match(/^[\w$]*/);
  const symbol = (wordMatch?.[0] ?? '') + (wordEnd?.[0] ?? '');

  void api.plugins
    .references(filePath, content, line.number - 1, col)
    .then(async (res) => {
      const flatRefs = (res.data?.results ?? []).flatMap((r) => r.references);
      if (flatRefs.length === 0) return;
      const fileCache = new Map<string, string[]>();
      const locs: PeekReference[] = [];
      for (const r of flatRefs) {
        let lines = fileCache.get(r.file);
        if (!lines) {
          try {
            const fres = await api.files.read(r.file);
            lines = fres.data.content.split('\n');
            fileCache.set(r.file, lines);
          } catch {
            lines = [];
            fileCache.set(r.file, lines);
          }
        }
        const preview = (lines[r.line] ?? '').trim().slice(0, 160);
        locs.push({ targetPath: r.file, line: r.line, preview });
      }
      if (locs.length === 0) return;
      view.dispatch({
        effects: peekOpen.of({
          anchorLine: line.number,
          mode: { kind: 'references', symbol: symbol || undefined, locations: locs },
        }),
      });
    })
    .catch(() => {});
  return true;
}

export function peekPanelExtension(): Extension {
  return [peekField, peekPlugin];
}
