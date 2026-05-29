/**
 * sticky-scroll.ts (LYK-979) — pin parent scope lines above the
 * viewport when scrolled past. Source-of-truth for the scope chain is
 * the tree-sitter symbol tree already maintained by symbolStore for
 * every open buffer.
 *
 * Tree-sitter coords are 0-indexed (startRow); CM6 doc lines are
 * 1-indexed. Conversions happen inline at the use sites so the
 * symbol-tree shape stays untouched.
 *
 * Render path: a DOM overlay anchored absolute over the editor scroller
 * (not a block widget) so the pinned lines float above the gutter
 * without breaking line height calculations or scrollIntoView math.
 * The overlay's row mirrors the editor's effective monospace metrics
 * via CM6's `defaultLineHeight` so themes / zoom levels stay in sync.
 *
 * Only langs with a tree-sitter parser produce symbols
 * (ts/tsx/js/svelte/.pui per symbols.svelte + the worker) — for
 * everything else, getSymbols() returns [], and we just don't render.
 *
 * Click on a pinned line dispatches a selection to its startRow with
 * scrollIntoView, matching how the breadcrumb segments jump.
 */

import { EditorView, ViewPlugin, type ViewUpdate, type PluginValue } from '@codemirror/view';
import { EditorSelection, type Extension } from '@codemirror/state';
import { symbolStore } from '$lib/stores/symbols.svelte';
import { settingsStore } from '$lib/stores/settings.svelte';
import type { Symbol as TsSymbol } from '$lib/workers/treesitter-worker';

interface PinnedRow {
  /** 1-indexed line number in the doc. */
  line: number;
  /** Symbol kind glyph + name, e.g. "ƒ render" or "𝒞 Widget". */
  label: string;
  /** Symbol kind for icon coloring. */
  kind: TsSymbol['kind'];
}

const KIND_ICON: Record<TsSymbol['kind'], string> = {
  function: 'ƒ',
  method: 'ƒ',
  class: '𝒞',
  interface: 'I',
  type: 'T',
  variable: 'v',
  property: '·',
  import: '↓',
};

/**
 * Walk the symbol tree and collect every ancestor whose [startRow,
 * endRow] range contains `line` (1-indexed). Returned outermost-first
 * so the pinned column reads top-down naturally.
 */
function ancestorsAtLine(symbols: TsSymbol[], line: number, maxDepth: number): TsSymbol[] {
  const acc: TsSymbol[] = [];
  function walk(list: TsSymbol[]) {
    for (const s of list) {
      // tree-sitter rows are 0-indexed; line is 1-indexed.
      const startLine = s.startRow + 1;
      const endLine = s.endRow + 1;
      if (startLine <= line && endLine >= line) {
        acc.push(s);
        if (acc.length >= maxDepth) return;
        if (s.children) walk(s.children);
        return; // only one match per level
      }
    }
  }
  walk(symbols);
  return acc;
}

export function stickyScrollExtension(fileIdFn: () => string): Extension {
  const plugin = ViewPlugin.fromClass(
    class implements PluginValue {
      overlay: HTMLDivElement;
      lastRendered: PinnedRow[] = [];
      scrollHandler: () => void;
      pollTimer: ReturnType<typeof setInterval>;

      constructor(public view: EditorView) {
        this.overlay = document.createElement('div');
        this.overlay.className = 'cm-sticky-scroll';
        this.overlay.setAttribute('aria-hidden', 'false');
        const scroller = view.scrollDOM;
        scroller.appendChild(this.overlay);
        // Scroll fires far more often than CM6's viewportChanged — bind
        // directly so the pinned column tracks the viewport pixel-for-
        // pixel.
        this.scrollHandler = () => this.render();
        scroller.addEventListener('scroll', this.scrollHandler, { passive: true });
        // symbolStore.symbolsByFile and settingsStore.stickyScroll*
        // changes don't dispatch into the EditorView. Poll the render
        // path at a low rate to pick them up — render() short-circuits
        // when the pinned set is unchanged, so the cost is one map
        // lookup + a sentinel comparison per tick.
        this.pollTimer = setInterval(() => this.render(), 250);
        this.render();
      }

      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || u.geometryChanged) {
          this.render();
        }
      }

      destroy() {
        this.view.scrollDOM.removeEventListener('scroll', this.scrollHandler);
        clearInterval(this.pollTimer);
        this.overlay.remove();
      }

      render() {
        if (!settingsStore.stickyScrollEnabled) {
          this.overlay.style.display = 'none';
          this.lastRendered = [];
          return;
        }
        const fileId = fileIdFn();
        const symbols = symbolStore.getSymbols(fileId);
        if (symbols.length === 0) {
          this.overlay.style.display = 'none';
          this.lastRendered = [];
          return;
        }
        // Top-visible line: pixel coordinate of the viewport top, mapped
        // back to a doc line via lineBlockAtHeight.
        const top = this.view.scrollDOM.scrollTop;
        const block = this.view.lineBlockAtHeight(top);
        const topLine = this.view.state.doc.lineAt(block.from).number;
        const maxDepth = Math.max(1, settingsStore.stickyScrollMaxDepth);
        const anc = ancestorsAtLine(symbols, topLine, maxDepth);
        // Drop the innermost ancestor when its first line IS the top
        // visible line — that line is already on-screen and pinning it
        // would duplicate it.
        const pinned: PinnedRow[] = [];
        for (const s of anc) {
          const startLine = s.startRow + 1;
          if (startLine >= topLine) continue;
          pinned.push({
            line: startLine,
            label: `${KIND_ICON[s.kind] ?? '·'} ${s.name}`,
            kind: s.kind,
          });
          if (pinned.length >= maxDepth) break;
        }

        // Bail if the pinned set hasn't changed — avoid touching the DOM.
        if (pinnedEq(this.lastRendered, pinned)) {
          // Position still needs updating on every scroll event.
          this.overlay.style.top = `${this.view.scrollDOM.scrollTop}px`;
          this.overlay.style.left = `${this.view.scrollDOM.scrollLeft}px`;
          return;
        }
        this.lastRendered = pinned;

        if (pinned.length === 0) {
          this.overlay.style.display = 'none';
          return;
        }
        this.overlay.style.display = 'block';
        // scrollDOM is the scroll container; an absolutely-positioned
        // child needs its top updated on every scroll so it "sticks"
        // to the visible top edge. position: sticky doesn't work here
        // because the overlay is a sibling of contentDOM, not part of
        // it, and CM6's scroller mechanics interact poorly with sticky.
        this.overlay.style.top = `${this.view.scrollDOM.scrollTop}px`;
        this.overlay.style.left = `${this.view.scrollDOM.scrollLeft}px`;
        this.overlay.innerHTML = '';
        const lineHeight = this.view.defaultLineHeight;
        for (let i = 0; i < pinned.length; i++) {
          const row = pinned[i];
          const el = document.createElement('div');
          el.className = 'cm-sticky-row';
          el.style.height = `${lineHeight}px`;
          el.style.lineHeight = `${lineHeight}px`;
          el.textContent = row.label;
          el.title = `Jump to line ${row.line}`;
          el.addEventListener('click', (e) => {
            e.stopPropagation();
            this.jumpTo(row.line);
          });
          this.overlay.appendChild(el);
        }
      }

      jumpTo(line: number) {
        const doc = this.view.state.doc;
        if (line < 1 || line > doc.lines) return;
        const pos = doc.line(line).from;
        this.view.dispatch({
          selection: EditorSelection.cursor(pos),
          effects: EditorView.scrollIntoView(pos, { y: 'start' }),
        });
        this.view.focus();
      }
    },
  );

  return [
    plugin,
    EditorView.baseTheme({
      '.cm-sticky-scroll': {
        position: 'absolute',
        top: '0',
        left: '0',
        right: 'auto',
        zIndex: '5',
        minWidth: '180px',
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border-subtle, var(--border-primary))',
        fontFamily: 'var(--font-family-mono, ui-monospace, monospace)',
        fontSize: '12px',
        color: 'var(--text-secondary)',
        boxShadow: '0 1px 4px rgba(0, 0, 0, 0.18)',
        cursor: 'pointer',
        userSelect: 'none',
        display: 'none',
      },
      '.cm-sticky-row': {
        padding: '0 12px',
        whiteSpace: 'pre',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      },
      '.cm-sticky-row:hover': {
        background: 'var(--bg-hover)',
        color: 'var(--text-primary)',
      },
    }),
  ];
}

function pinnedEq(a: PinnedRow[], b: PinnedRow[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].line !== b[i].line || a[i].label !== b[i].label) return false;
  }
  return true;
}
