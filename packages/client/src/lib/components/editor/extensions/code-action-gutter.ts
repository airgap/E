/**
 * code-action-gutter.ts — CM6 extension: lightbulb gutter on diagnostic lines.
 *
 * Shows a 💡 icon in the gutter next to lines that have diagnostics.
 * Clicking the lightbulb opens a quick-fix menu. The `Mod-.` keybinding
 * triggers the same menu for the diagnostic at the cursor position.
 */

import {
  gutter,
  GutterMarker,
  ViewPlugin,
  type ViewUpdate,
  type EditorView,
} from '@codemirror/view';
import {
  StateField,
  StateEffect,
  RangeSet,
  type Range,
  type Extension,
  Facet,
} from '@codemirror/state';
import { diagnosticCount, forEachDiagnostic } from '@codemirror/lint';

// ── Types ──

export interface QuickFixRequest {
  /** Screen X for positioning the menu */
  x: number;
  /** Screen Y for positioning the menu */
  y: number;
  /** 1-based line number */
  line: number;
  /** Document position (absolute offset) */
  pos: number;
  /** Diagnostics on this line */
  diagnostics: Array<{
    from: number;
    to: number;
    severity: string;
    message: string;
    source?: string;
  }>;
}

// ── Facet for callback ──

/**
 * Facet to provide the quick-fix callback from the editor host.
 * CodeEditor.svelte sets this to open the QuickFixMenu.
 */
export const quickFixCallback = Facet.define<
  (request: QuickFixRequest) => void,
  (request: QuickFixRequest) => void
>({
  combine: (values) => values[values.length - 1] ?? (() => {}),
});

// ── GutterMarker ──

class LightbulbMarker extends GutterMarker {
  constructor(
    private lineNum: number,
    private diagCount: number,
  ) {
    super();
  }

  toDOM(view: EditorView) {
    const el = document.createElement('span');
    el.className = 'cm-lightbulb-marker';
    el.textContent = '💡';
    el.title = `${this.diagCount} diagnostic${this.diagCount > 1 ? 's' : ''} — click for quick fixes`;
    el.setAttribute('aria-label', `Quick fix available on line ${this.lineNum}`);

    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const rect = el.getBoundingClientRect();
      const diags = getDiagnosticsOnLine(view, this.lineNum);
      const lineInfo = view.state.doc.line(this.lineNum);

      const cb = view.state.facet(quickFixCallback);
      cb({
        x: rect.right + 4,
        y: rect.top,
        line: this.lineNum,
        pos: lineInfo.from,
        diagnostics: diags,
      });
    });

    return el;
  }
}

// ── Helpers ──

interface DiagInfo {
  from: number;
  to: number;
  severity: string;
  message: string;
  source?: string;
}

function getDiagnosticsOnLine(view: EditorView, lineNum: number): DiagInfo[] {
  const diags: DiagInfo[] = [];
  const lineInfo = view.state.doc.line(lineNum);

  forEachDiagnostic(view.state, (d) => {
    const dLine = view.state.doc.lineAt(d.from);
    if (dLine.number === lineNum) {
      diags.push({
        from: d.from - lineInfo.from,
        to: d.to - lineInfo.from,
        severity: d.severity,
        message: d.message,
        source: d.source,
      });
    }
  });

  return diags;
}

/** Collect lines that have diagnostics. */
function collectDiagnosticLines(view: EditorView): Map<number, number> {
  const lineMap = new Map<number, number>();

  forEachDiagnostic(view.state, (d) => {
    const line = view.state.doc.lineAt(d.from).number;
    lineMap.set(line, (lineMap.get(line) || 0) + 1);
  });

  return lineMap;
}

// ── StateEffect + StateField ──

const setLightbulbs = StateEffect.define<Map<number, number>>();

const lightbulbField = StateField.define<RangeSet<GutterMarker>>({
  create() {
    return RangeSet.empty;
  },
  update(markers, tr) {
    markers = markers.map(tr.changes);

    for (const effect of tr.effects) {
      if (effect.is(setLightbulbs)) {
        const newRanges: Range<GutterMarker>[] = [];
        const doc = tr.state.doc;

        for (const [lineNum, count] of effect.value) {
          if (lineNum >= 1 && lineNum <= doc.lines) {
            const lineStart = doc.line(lineNum).from;
            newRanges.push(new LightbulbMarker(lineNum, count).range(lineStart));
          }
        }

        newRanges.sort((a, b) => a.from - b.from);
        markers = RangeSet.of(newRanges);
      }
    }

    return markers;
  },
});

// ── Gutter column ──

const lightbulbGutter = gutter({
  class: 'cm-lightbulb-gutter',
  markers: (view) => view.state.field(lightbulbField),
});

// ── ViewPlugin that syncs diagnostics → lightbulb state ──

const lightbulbSync = ViewPlugin.define((view) => {
  let lastDiagCount = -1;

  function sync() {
    const count = diagnosticCount(view.state);
    if (count === lastDiagCount) return;
    lastDiagCount = count;

    if (count === 0) {
      view.dispatch({ effects: setLightbulbs.of(new Map()) });
    } else {
      const lineMap = collectDiagnosticLines(view);
      view.dispatch({ effects: setLightbulbs.of(lineMap) });
    }
  }

  // Delay initial sync slightly to let diagnostics arrive
  setTimeout(sync, 100);

  return {
    update(_update: ViewUpdate) {
      sync();
    },
    destroy() {},
  };
});

// ── Mod-. command ──

/**
 * EditorView command: trigger quick fix at cursor position.
 * Returns true if there are diagnostics on the current line.
 */
export function triggerQuickFix(view: EditorView): boolean {
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  const diags = getDiagnosticsOnLine(view, line.number);

  if (diags.length === 0) return false;

  // Position the menu near the cursor
  const coords = view.coordsAtPos(pos);
  if (!coords) return false;

  const cb = view.state.facet(quickFixCallback);
  cb({
    x: coords.left,
    y: coords.bottom + 4,
    line: line.number,
    pos,
    diagnostics: diags,
  });

  return true;
}

// ── Public extension factory ──

/**
 * Create the code action gutter extension bundle.
 * Pass a callback to receive quick-fix requests when the lightbulb is clicked
 * or Mod-. is pressed.
 */
export function codeActionGutterExtension(
  onQuickFix: (request: QuickFixRequest) => void,
): Extension[] {
  return [quickFixCallback.of(onQuickFix), lightbulbField, lightbulbGutter, lightbulbSync];
}
