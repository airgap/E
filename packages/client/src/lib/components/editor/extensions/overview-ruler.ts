/**
 * overview-ruler.ts — CM6 extension: a VS Code-style overview ruler.
 *
 * A thin strip on the editor's right edge with a mark for every diagnostic
 * across the WHOLE file (not just the viewport), positioned by line fraction and
 * colored by severity. Click a mark to jump to it. Errors win over warnings on a
 * shared line so the worst state shows.
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

/**
 * Top offset (px) for a mark on a `height`-px strip representing `total` lines.
 * Centers on the line and clamps so a mark is always visible within the strip.
 */
export function overviewTop(line: number, total: number, height: number, markH = 2): number {
  const t = total <= 0 ? 0 : ((line - 0.5) / total) * height;
  return Math.max(0, Math.min(height - markH, t));
}

const rulerTheme = EditorView.baseTheme({
  '.cm-overview-ruler': {
    position: 'absolute',
    top: '0',
    right: '0',
    width: '12px',
    zIndex: '4',
    pointerEvents: 'none',
  },
  '.cm-overview-mark': {
    position: 'absolute',
    right: '1px',
    width: '10px',
    height: '2px',
    borderRadius: '1px',
    cursor: 'pointer',
    pointerEvents: 'auto',
    opacity: '0.85',
  },
  '.cm-overview-mark:hover': { opacity: '1', height: '3px' },
});

export function overviewRulerExtension(): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      strip: HTMLDivElement;
      constructor(view: EditorView) {
        this.strip = document.createElement('div');
        this.strip.className = 'cm-overview-ruler';
        // .cm-editor is position:relative, so the strip pins to its right edge.
        view.dom.appendChild(this.strip);
        this.build(view);
      }
      update(u: ViewUpdate) {
        // Diagnostics arrive as state effects; rebuild on those + doc/size changes.
        if (u.docChanged || u.geometryChanged || u.transactions.some((t) => t.effects.length)) {
          this.build(u.view);
        }
      }
      build(view: EditorView) {
        const strip = this.strip;
        strip.replaceChildren();
        const doc = view.state.doc;
        const total = Math.max(1, doc.lines);
        const h = view.scrollDOM.clientHeight;
        strip.style.height = `${h}px`;

        // Best (worst) severity per line + a jump target.
        const perLine = new Map<number, { sev: string; pos: number }>();
        forEachDiagnostic(view.state, (d, from) => {
          const line = doc.lineAt(from).number;
          const cur = perLine.get(line);
          if (!cur || severityRank(d.severity) > severityRank(cur.sev)) {
            perLine.set(line, { sev: d.severity, pos: from });
          }
        });

        for (const [line, { sev, pos }] of perLine) {
          const mark = document.createElement('div');
          mark.className = 'cm-overview-mark';
          mark.style.top = `${overviewTop(line, total, h)}px`;
          mark.style.background = severityColor(sev);
          mark.title = `${sev} (line ${line})`;
          mark.addEventListener('mousedown', (e) => {
            e.preventDefault();
            view.dispatch({
              selection: { anchor: pos },
              effects: EditorView.scrollIntoView(pos, { y: 'center' }),
            });
            view.focus();
          });
          strip.appendChild(mark);
        }
        strip.style.display = perLine.size ? 'block' : 'none';
      }
      destroy() {
        this.strip.remove();
      }
    },
  );
  return [plugin, rulerTheme];
}
