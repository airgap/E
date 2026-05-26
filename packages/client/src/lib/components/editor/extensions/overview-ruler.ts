/**
 * overview-ruler.ts — CM6 extension: a right-edge block minimap.
 *
 * A scaled overview of the WHOLE file drawn on a canvas: each line becomes thin
 * bars for its runs of non-whitespace (so indentation + code shape read at a
 * glance), with diagnostic marks overlaid (error=red, warning=amber, info=blue)
 * and a viewport box for the visible region. Click/drag to scroll. No glyphs, no
 * dependency. Space is reserved on the editor's right so it never covers code.
 */
import { ViewPlugin, EditorView, type ViewUpdate } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { forEachDiagnostic } from '@codemirror/lint';

export type Severity = 'error' | 'warning' | 'info' | 'hint';

/** Worse severity wins when several diagnostics share a line. */
export function severityRank(s: string): number {
  return s === 'error' ? 3 : s === 'warning' ? 2 : s === 'info' ? 1 : 0;
}

const SEVERITY_VAR: Record<string, string> = {
  error: 'var(--danger, #f85149)',
  warning: 'var(--git-modified, #e2b93d)',
  info: 'var(--accent, #58a6ff)',
  hint: 'var(--text-tertiary, #888)',
};
export const severityColor = (s: string): string => SEVERITY_VAR[s] ?? SEVERITY_VAR.hint;

// Plain hex fallbacks for canvas fills (CSS vars don't resolve in a 2D context).
const SEVERITY_HEX: Record<string, string> = {
  error: '#f85149',
  warning: '#e2b93d',
  info: '#58a6ff',
  hint: '#888888',
};
export const severityHex = (s: string): string => SEVERITY_HEX[s] ?? SEVERITY_HEX.hint;

/**
 * Top offset (px) for a row on a `height`-px strip representing `total` lines.
 * Centers on the line and clamps so it's visible within the strip.
 */
export function overviewTop(line: number, total: number, height: number, markH = 2): number {
  const t = total <= 0 ? 0 : ((line - 0.5) / total) * height;
  return Math.max(0, Math.min(height - markH, t));
}

/**
 * Runs of non-whitespace in a line as [startCol, length] pairs, scanning at most
 * `maxCols` columns. Tabs count as one column. Pure + tested.
 */
export function lineRuns(text: string, maxCols = 120): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  const n = Math.min(text.length, maxCols);
  let start = -1;
  for (let i = 0; i < n; i++) {
    const ws = text[i] === ' ' || text[i] === '\t';
    if (!ws && start === -1) start = i;
    else if (ws && start !== -1) {
      runs.push([start, i - start]);
      start = -1;
    }
  }
  if (start !== -1) runs.push([start, n - start]);
  return runs;
}

const WIDTH = 64; // minimap width (px)
const MAX_LINE_H = 4; // px per line cap (short files don't get giant bars)
const COLS = 120; // columns mapped across the width
const CODE_LINE_CAP = 12000; // skip code bars above this (still draw marks + box)

const minimapTheme = EditorView.baseTheme({
  // Reserve space so code never renders under the minimap.
  '.cm-scroller': { paddingRight: `${WIDTH}px` },
  '.cm-overview-minimap': {
    position: 'absolute',
    top: '0',
    right: '0',
    width: `${WIDTH}px`,
    zIndex: '5',
    cursor: 'pointer',
    // Opaque panel so editor text/background isn't visible through the strip
    // (clearRect leaves canvas pixels transparent; the CSS background fills).
    background: 'var(--bg-elevated, rgba(0,0,0,0.35))',
  },
});

export function overviewRulerExtension(): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      canvas: HTMLCanvasElement;
      ctx: CanvasRenderingContext2D;
      scrollEl: HTMLElement;
      dragging = false;
      scheduled = false;
      onMove: (e: MouseEvent) => void;
      onUp: () => void;
      onScroll: () => void;

      constructor(view: EditorView) {
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'cm-overview-minimap';
        view.dom.appendChild(this.canvas); // .cm-editor is position:relative
        this.ctx = this.canvas.getContext('2d')!;
        this.scrollEl = view.scrollDOM;

        this.canvas.addEventListener('mousedown', (e) => {
          this.dragging = true;
          this.scrollToEvent(view, e);
          window.addEventListener('mousemove', this.onMove);
          window.addEventListener('mouseup', this.onUp);
        });
        this.onMove = (e: MouseEvent) => {
          if (this.dragging) this.scrollToEvent(view, e);
        };
        this.onUp = () => {
          this.dragging = false;
          window.removeEventListener('mousemove', this.onMove);
          window.removeEventListener('mouseup', this.onUp);
        };
        // Redraw on EVERY scroll (not just the over-rendered viewportChanged
        // chunks) so the viewport box tracks smoothly instead of jumping.
        this.onScroll = () => this.schedule(view);
        this.scrollEl.addEventListener('scroll', this.onScroll, { passive: true });

        this.draw(view);
      }

      update(u: ViewUpdate) {
        if (u.docChanged || u.geometryChanged || u.viewportChanged) this.schedule(u.view);
        else if (u.transactions.some((t) => t.effects.length)) this.schedule(u.view); // diagnostics
      }

      schedule(view: EditorView) {
        if (this.scheduled) return;
        this.scheduled = true;
        requestAnimationFrame(() => {
          this.scheduled = false;
          this.draw(view);
        });
      }

      scrollToEvent(view: EditorView, e: MouseEvent) {
        const rect = this.canvas.getBoundingClientRect();
        const total = Math.max(1, view.state.doc.lines);
        const frac = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
        const line = Math.max(1, Math.min(total, Math.round(frac * total)));
        const pos = view.state.doc.line(line).from;
        view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
      }

      draw(view: EditorView) {
        const ctx = this.ctx;
        const dpr = window.devicePixelRatio || 1;
        const W = WIDTH;
        const H = view.scrollDOM.clientHeight;
        if (H <= 0) return;
        if (this.canvas.width !== W * dpr || this.canvas.height !== H * dpr) {
          this.canvas.width = W * dpr;
          this.canvas.height = H * dpr;
          this.canvas.style.width = `${W}px`;
          this.canvas.style.height = `${H}px`;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);

        const doc = view.state.doc;
        const total = Math.max(1, doc.lines);
        const lineH = Math.min(MAX_LINE_H, H / total);
        const charW = W / COLS;

        // 1. Code-shape bars (skip for very large files to stay cheap).
        if (total <= CODE_LINE_CAP) {
          ctx.fillStyle = 'rgba(160,170,185,0.45)';
          let i = 0;
          for (const line of doc.iterLines()) {
            const y = i * lineH;
            for (const [col, len] of lineRuns(line, COLS)) {
              const x = col * charW;
              ctx.fillRect(x, y, Math.min(len * charW, W - x), Math.max(lineH * 0.8, 0.6));
            }
            i++;
          }
        }

        // 2. Diagnostic marks (worst severity per line) — full-width tint + right dot.
        const perLine = new Map<number, string>();
        forEachDiagnostic(view.state, (d, from) => {
          const ln = doc.lineAt(from).number;
          const cur = perLine.get(ln);
          if (!cur || severityRank(d.severity) > severityRank(cur)) perLine.set(ln, d.severity);
        });
        for (const [ln, sev] of perLine) {
          const y = overviewTop(ln, total, H, 2);
          const hex = severityHex(sev);
          ctx.fillStyle = hex + '33'; // faint full-width tint
          ctx.fillRect(0, y, W, Math.max(lineH, 2));
          ctx.fillStyle = hex; // solid mark on the right
          ctx.fillRect(W - 4, y, 4, Math.max(lineH, 2));
        }

        // 3. Viewport box from actual scroll PIXELS (smooth — not snapped to
        //    line boundaries), in the same line-scaled space as the bars
        //    (contentH = total*lineH).
        const sc = view.scrollDOM;
        const scrollH = sc.scrollHeight;
        const contentH = total * lineH;
        const boxY = scrollH > 0 ? (sc.scrollTop / scrollH) * contentH : 0;
        const boxH = scrollH > 0 ? Math.max(3, (sc.clientHeight / scrollH) * contentH) : contentH;
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(0, boxY, W, boxH);
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.strokeRect(0.5, boxY + 0.5, W - 1, boxH - 1);
      }

      destroy() {
        window.removeEventListener('mousemove', this.onMove);
        window.removeEventListener('mouseup', this.onUp);
        this.scrollEl.removeEventListener('scroll', this.onScroll);
        this.canvas.remove();
      }
    },
  );
  return [plugin, minimapTheme];
}
