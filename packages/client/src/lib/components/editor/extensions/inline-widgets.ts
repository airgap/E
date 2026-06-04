/**
 * inline-widgets.ts — CM6 inline interactive widgets in the buffer (LYK-1084).
 *
 * Real controls rendered *in* the text (not gutter decorations, not a separate
 * webview) — the kind of thing a VS Code extension can't do. First wave:
 *   - inlineNumberScrubber (LYK-1097): drag a numeric literal to change it.
 *   - inlineColorPicker     (LYK-1098): a swatch on color literals opens a picker.
 *
 * Second wave adds read-only/preview widgets in the same vein:
 *   - inlineSparklines  (LYK-1100): a tiny chart after numeric array literals.
 *   - inlineMediaPreview(LYK-1101): a thumbnail after image paths / inline SVG.
 *   - inlineRegexTester (LYK-1099): a click-to-open match tester on regex literals.
 *
 * All are flag-gated by the caller (see CodeEditor). Toggling the flags takes
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
import { api } from '$lib/api/client';

// Numbers not part of an identifier / hex color. Lookbehind excludes `\w . #`.
const NUMBER_RE = /(?<![\w.#-])-?\d+(?:\.\d+)?/g;
const HEX_RE = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
// Array of >=3 numbers, e.g. [1, 2, 3.5, -4]. Conservative so we don't sparkline
// every two-element tuple.
const ARRAY_RE = /\[\s*-?\d+(?:\.\d+)?(?:\s*,\s*-?\d+(?:\.\d+)?){2,}\s*\]/g;
// Quoted string ending in an image extension. Group 2 = the path.
const IMG_STR_RE = /(['"`])([^'"`\n]+\.(?:png|jpe?g|gif|webp|svg|avif|bmp|ico))\1/gi;
// Inline SVG markup.
const SVG_RE = /<svg[\s\S]*?<\/svg>/gi;
// Regex literal preceded by a token that can't be the left operand of division,
// so `a / b` isn't mistaken for a regex. Group 1 = the literal itself.
const REGEX_RE =
  /(?:^|[=(,:[!&|?{};\s])(\/(?![*/])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n])+\/[dgimsuy]*)/g;

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

// ── Sparkline (LYK-1100) ────────────────────────────────────────────────────

/** A tiny inline chart drawn from the numbers in an array literal. */
class SparklineWidget extends WidgetType {
  constructor(readonly values: number[]) {
    super();
  }
  eq(o: SparklineWidget) {
    return o.values.length === this.values.length && o.values.every((v, i) => v === this.values[i]);
  }
  toDOM(): HTMLElement {
    const w = Math.min(Math.max(this.values.length * 4, 16), 80);
    const h = 12;
    const min = Math.min(...this.values);
    const max = Math.max(...this.values);
    const span = max - min || 1;
    const pts = this.values
      .map((v, i) => {
        const x = (i / (this.values.length - 1)) * (w - 2) + 1;
        const y = h - 1 - ((v - min) / span) * (h - 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
    const wrap = document.createElement('span');
    wrap.className = 'cm-sparkline';
    wrap.title = `${this.values.length} values · ${min}…${max}`;
    wrap.innerHTML =
      `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">` +
      `<polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1" ` +
      `stroke-linejoin="round" stroke-linecap="round"/></svg>`;
    return wrap;
  }
  ignoreEvent() {
    return true;
  }
}

// ── Media preview (LYK-1101) ────────────────────────────────────────────────

function normalizePath(base: string, rel: string): string {
  const stack = base.split('/');
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') stack.pop();
    else stack.push(seg);
  }
  return stack.join('/');
}

/** Resolve an asset reference to a loadable URL, or null if not resolvable. */
function resolveAsset(raw: string, filePath?: string): string | null {
  if (/^(https?:|data:)/i.test(raw)) return raw;
  if (raw.startsWith('/')) return api.files.rawUrl(raw);
  if (!filePath) return null;
  const dir = filePath.slice(0, filePath.lastIndexOf('/'));
  return api.files.rawUrl(normalizePath(dir, raw));
}

/** A small thumbnail rendered after an image path or inline SVG. */
class MediaWidget extends WidgetType {
  constructor(readonly src: string) {
    super();
  }
  eq(o: MediaWidget) {
    return o.src === this.src;
  }
  toDOM(): HTMLElement {
    const img = document.createElement('img');
    img.className = 'cm-media-preview';
    img.src = this.src;
    img.loading = 'lazy';
    img.alt = '';
    // Drop the affordance entirely if the asset can't be loaded.
    img.addEventListener('error', () => img.remove());
    return img;
  }
  ignoreEvent() {
    return true;
  }
}

// ── Regex tester (LYK-1099) ─────────────────────────────────────────────────

/** A click-to-open match tester anchored to a regex literal. */
class RegexTestWidget extends WidgetType {
  constructor(
    readonly pattern: string,
    readonly flags: string,
  ) {
    super();
  }
  eq(o: RegexTestWidget) {
    return o.pattern === this.pattern && o.flags === this.flags;
  }
  toDOM(): HTMLElement {
    const btn = document.createElement('span');
    btn.className = 'cm-regex-test';
    btn.textContent = '⊙';
    btn.title = 'Test this regex';
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openRegexPanel(btn, this.pattern, this.flags);
    });
    return btn;
  }
  ignoreEvent() {
    return true;
  }
}

let activeRegexPanel: HTMLElement | null = null;
function closeRegexPanel() {
  if (activeRegexPanel) {
    activeRegexPanel.remove();
    activeRegexPanel = null;
    document.removeEventListener('pointerdown', onDocPointerDown, true);
  }
}
function onDocPointerDown(e: PointerEvent) {
  if (activeRegexPanel && !activeRegexPanel.contains(e.target as Node)) closeRegexPanel();
}
function openRegexPanel(anchor: HTMLElement, pattern: string, flags: string) {
  closeRegexPanel();
  const rect = anchor.getBoundingClientRect();
  const panel = document.createElement('div');
  panel.className = 'cm-regex-panel';
  panel.style.left = `${Math.round(rect.left)}px`;
  panel.style.top = `${Math.round(rect.bottom + 4)}px`;

  const header = document.createElement('div');
  header.className = 'cm-regex-panel-head';
  header.textContent = `/${pattern}/${flags}`;

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Type a sample string…';

  const result = document.createElement('div');
  result.className = 'cm-regex-panel-result';

  // Force the global flag so we can count every match; keep the user's others.
  const testFlags = flags.includes('g') ? flags : flags + 'g';
  const run = () => {
    const sample = input.value;
    if (!sample) {
      result.textContent = '';
      return;
    }
    let re: RegExp;
    try {
      re = new RegExp(pattern, testFlags);
    } catch (err) {
      result.textContent = `Invalid regex: ${String(err)}`;
      return;
    }
    const matches = [...sample.matchAll(re)];
    result.textContent = matches.length
      ? `${matches.length} match${matches.length === 1 ? '' : 'es'}: ${matches
          .slice(0, 6)
          .map((m) => JSON.stringify(m[0]))
          .join(', ')}`
      : 'No match';
  };
  input.addEventListener('input', run);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeRegexPanel();
    }
  });

  panel.append(header, input, result);
  document.body.appendChild(panel);
  activeRegexPanel = panel;
  input.focus();
  // Defer so the opening pointerdown doesn't immediately close it.
  setTimeout(() => document.addEventListener('pointerdown', onDocPointerDown, true), 0);
}

interface WidgetOpts {
  numbers: boolean;
  colors: boolean;
  sparklines: boolean;
  media: boolean;
  regex: boolean;
  filePath?: string;
}

function buildDecorations(view: EditorView, opts: WidgetOpts): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  // Collect then sort, since the various detectors emit widgets out of position
  // order. RangeSetBuilder needs strictly (from, then startSide) order.
  const decos: Array<{ pos: number; side: number; deco: Decoration }> = [];
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    if (opts.colors) {
      HEX_RE.lastIndex = 0;
      for (let m; (m = HEX_RE.exec(text)); ) {
        const start = from + m.index;
        const end = start + m[0].length;
        decos.push({
          pos: start,
          side: -1,
          deco: Decoration.widget({ widget: new ColorSwatchWidget(start, end, m[0]), side: -1 }),
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
          side: 1,
          deco: Decoration.widget({ widget: new NumberScrubWidget(start, m[0]), side: 1 }),
        });
      }
    }
    if (opts.sparklines) {
      ARRAY_RE.lastIndex = 0;
      for (let m; (m = ARRAY_RE.exec(text)); ) {
        const end = from + m.index + m[0].length;
        const values = (m[0].match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
        if (values.length >= 3) {
          decos.push({
            pos: end,
            side: 1,
            deco: Decoration.widget({ widget: new SparklineWidget(values), side: 1 }),
          });
        }
      }
    }
    if (opts.media) {
      IMG_STR_RE.lastIndex = 0;
      for (let m; (m = IMG_STR_RE.exec(text)); ) {
        const end = from + m.index + m[0].length;
        const url = resolveAsset(m[2], opts.filePath);
        if (url) {
          decos.push({
            pos: end,
            side: 1,
            deco: Decoration.widget({ widget: new MediaWidget(url), side: 1 }),
          });
        }
      }
      SVG_RE.lastIndex = 0;
      for (let m; (m = SVG_RE.exec(text)); ) {
        const end = from + m.index + m[0].length;
        const url = `data:image/svg+xml;utf8,${encodeURIComponent(m[0])}`;
        decos.push({
          pos: end,
          side: 1,
          deco: Decoration.widget({ widget: new MediaWidget(url), side: 1 }),
        });
      }
    }
    if (opts.regex) {
      REGEX_RE.lastIndex = 0;
      for (let m; (m = REGEX_RE.exec(text)); ) {
        const literal = m[1];
        const end = from + m.index + m[0].length;
        const close = literal.lastIndexOf('/');
        const pattern = literal.slice(1, close);
        const flags = literal.slice(close + 1);
        if (pattern.length === 0) continue;
        decos.push({
          pos: end,
          side: 1,
          deco: Decoration.widget({ widget: new RegexTestWidget(pattern, flags), side: 1 }),
        });
      }
    }
  }
  decos.sort((a, b) => a.pos - b.pos || a.side - b.side);
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
  '.cm-sparkline': {
    display: 'inline-flex',
    alignItems: 'center',
    marginLeft: '4px',
    verticalAlign: 'middle',
    color: 'var(--accent-primary)',
    opacity: '0.8',
  },
  '.cm-media-preview': {
    display: 'inline-block',
    maxHeight: '2.4em',
    maxWidth: '8em',
    marginLeft: '6px',
    borderRadius: '3px',
    border: '1px solid var(--border-primary)',
    verticalAlign: 'middle',
    objectFit: 'contain',
  },
  '.cm-regex-test': {
    cursor: 'pointer',
    marginLeft: '3px',
    opacity: '0.4',
    color: 'var(--accent-primary)',
    userSelect: 'none',
  },
  '.cm-regex-test:hover': { opacity: '1' },
});

// Floating panel lives on document.body, so it's styled globally (not via the
// editor's scoped baseTheme).
const REGEX_PANEL_STYLE_ID = 'cm-regex-panel-style';
function ensureRegexPanelStyle() {
  if (typeof document === 'undefined' || document.getElementById(REGEX_PANEL_STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = REGEX_PANEL_STYLE_ID;
  el.textContent = `
    .cm-regex-panel {
      position: fixed;
      z-index: 10000;
      min-width: 240px;
      max-width: 360px;
      padding: 8px;
      background: var(--bg-secondary, #1e1e1e);
      border: 1px solid var(--border-primary, #444);
      border-radius: 6px;
      box-shadow: 0 6px 24px rgba(0,0,0,0.35);
      font-size: 12px;
    }
    .cm-regex-panel-head {
      font-family: var(--ff-mono, monospace);
      color: var(--accent-primary, #e2733f);
      margin-bottom: 6px;
      word-break: break-all;
    }
    .cm-regex-panel input {
      width: 100%;
      box-sizing: border-box;
      padding: 4px 6px;
      background: var(--bg-primary, #111);
      border: 1px solid var(--border-primary, #444);
      border-radius: 4px;
      color: var(--text-primary, #eee);
      font-family: var(--ff-mono, monospace);
    }
    .cm-regex-panel-result {
      margin-top: 6px;
      color: var(--text-secondary, #aaa);
      word-break: break-word;
      line-height: 1.4;
    }
  `;
  document.head.appendChild(el);
}

export function inlineWidgetsExtension(opts: WidgetOpts) {
  if (opts.regex) ensureRegexPanelStyle();
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
