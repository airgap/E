/**
 * inline-widgets.ts — CM6 inline interactive widgets in the buffer (LYK-1084).
 *
 * Real controls rendered *in* the text (not gutter decorations, not a separate
 * webview) — the kind of thing a VS Code extension can't do. First wave:
 *   - inlineNumberScrubber (LYK-1097): drag a numeric literal to change it.
 *   - inlineColorPicker     (LYK-1098): a swatch on color literals opens a picker.
 *
 * Both are flag-gated by the caller (see CodeEditor). Toggling the flags takes
 * effect when the editor next mounts the extension (reopen the file).
 */
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';

// Numbers not part of an identifier / hex color. Lookbehind excludes `\w . #`.
const NUMBER_RE = /(?<![\w.#-])-?\d+(?:\.\d+)?/g;
const HEX_RE = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;

/** Drag handle that edits the numeric literal it sits after. */
class NumberScrubWidget extends WidgetType {
  constructor(
    readonly from: number,
    readonly value: string,
  ) {
    super();
  }
  eq(o: NumberScrubWidget) {
    return o.from === this.from && o.value === this.value;
  }
  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('span');
    el.className = 'cm-num-scrub';
    el.title = 'Drag to change';
    el.textContent = '↔'; // ↔
    const decimals = (this.value.split('.')[1] ?? '').length;
    const step = decimals > 0 ? 1 / 10 ** decimals : 1;

    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startVal = parseFloat(this.value);
      // `from` is stable across edits because we always replace starting there;
      // only the length changes, which we track.
      let curLen = this.value.length;
      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        const next = startVal + Math.round(dx / 3) * step;
        const text = decimals > 0 ? next.toFixed(decimals) : String(next);
        const at = this.from;
        if (at + curLen > view.state.doc.length) return;
        view.dispatch({ changes: { from: at, to: at + curLen, insert: text } });
        curLen = text.length;
      };
      const onUp = (ev: PointerEvent) => {
        el.releasePointerCapture(ev.pointerId);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

/** Swatch before a color literal; click opens a native color picker. */
class ColorSwatchWidget extends WidgetType {
  constructor(
    readonly from: number,
    readonly to: number,
    readonly hex: string,
  ) {
    super();
  }
  eq(o: ColorSwatchWidget) {
    return o.from === this.from && o.hex === this.hex;
  }
  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('span');
    el.className = 'cm-color-swatch';
    el.style.backgroundColor = this.hex;
    el.title = 'Pick color';
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const input = document.createElement('input');
      input.type = 'color';
      // <input type=color> only accepts #rrggbb; expand #rgb shorthand.
      input.value = expandHex(this.hex);
      input.style.position = 'fixed';
      input.style.left = '-9999px';
      document.body.appendChild(input);
      input.addEventListener('input', () => {
        if (this.to <= view.state.doc.length) {
          view.dispatch({ changes: { from: this.from, to: this.to, insert: input.value } });
        }
      });
      input.addEventListener('change', () => input.remove());
      input.click();
    });
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

function expandHex(hex: string): string {
  if (hex.length === 4) {
    const [, r, g, b] = hex;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return hex.slice(0, 7);
}

function buildDecorations(
  view: EditorView,
  opts: { numbers: boolean; colors: boolean },
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  // Collect then sort, since a swatch (before) and a scrubber (after) can be
  // emitted out of position order across the two regexes.
  const decos: Array<{ pos: number; deco: Decoration }> = [];
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    if (opts.colors) {
      HEX_RE.lastIndex = 0;
      for (let m; (m = HEX_RE.exec(text)); ) {
        const start = from + m.index;
        const end = start + m[0].length;
        decos.push({
          pos: start,
          deco: Decoration.widget({
            widget: new ColorSwatchWidget(start, end, m[0]),
            side: -1,
          }),
        });
      }
    }
    if (opts.numbers) {
      NUMBER_RE.lastIndex = 0;
      for (let m; (m = NUMBER_RE.exec(text)); ) {
        const start = from + m.index;
        const end = start + m[0].length;
        decos.push({
          pos: end,
          deco: Decoration.widget({
            widget: new NumberScrubWidget(start, m[0]),
            side: 1,
          }),
        });
      }
    }
  }
  decos.sort((a, b) => a.pos - b.pos);
  for (const d of decos) builder.add(d.pos, d.pos, d.deco);
  return builder.finish();
}

const theme = EditorView.baseTheme({
  '.cm-num-scrub': {
    cursor: 'ew-resize',
    opacity: '0.35',
    marginLeft: '2px',
    fontSize: '0.85em',
    userSelect: 'none',
    color: 'var(--accent-primary)',
  },
  '.cm-num-scrub:hover': { opacity: '1' },
  '.cm-color-swatch': {
    display: 'inline-block',
    width: '0.8em',
    height: '0.8em',
    marginRight: '3px',
    borderRadius: '2px',
    border: '1px solid var(--border-primary)',
    cursor: 'pointer',
    verticalAlign: 'middle',
  },
});

export function inlineWidgetsExtension(opts: { numbers: boolean; colors: boolean }) {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, opts);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) {
          this.decorations = buildDecorations(u.view, opts);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
  return [plugin, theme];
}
