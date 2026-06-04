/**
 * text-animations.ts — animate text mutations (LYK-1089).
 *
 * Because E renders its own editor, inserted text can animate in (a brief
 * type-in glow + opacity fade) instead of just appearing — for your own typing
 * and for the agent's small edits alike. A VS Code extension can't touch glyph
 * rendering like this.
 *
 * Guardrails: only *small* inserts animate (MAX_ANIM_LEN). Bulk/programmatic
 * changes — opening a file, a full Write, a big paste — are skipped so we never
 * try to animate thousands of glyphs. Deletions remove their glyphs outright, so
 * there's nothing left to animate (a faithful "dissolve" would need an overlay;
 * left for a follow-up). Respects prefers-reduced-motion. Flag-gated by the
 * caller; reopen the file to apply.
 */
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { RangeSetBuilder, type Extension } from '@codemirror/state';

// Inserts longer than this are assumed programmatic/bulk and not animated.
const MAX_ANIM_LEN = 100;
// How long a freshly-inserted range keeps its animation decoration (ms).
const LIFETIME = 420;

const appearMark = Decoration.mark({ class: 'cm-text-appear' });

interface LiveRange {
  from: number;
  to: number;
  born: number;
}

const plugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet = Decoration.none;
    ranges: LiveRange[] = [];
    timer: ReturnType<typeof setTimeout> | null = null;

    update(u: ViewUpdate) {
      let dirty = false;

      if (u.docChanged) {
        // Map surviving ranges through this edit so the glow tracks the text.
        this.ranges = this.ranges
          .map((r) => ({
            from: u.changes.mapPos(r.from, 1),
            to: u.changes.mapPos(r.to, -1),
            born: r.born,
          }))
          .filter((r) => r.to > r.from);

        u.changes.iterChanges((_fromA, _toA, fromB, toB) => {
          const len = toB - fromB;
          if (len > 0 && len <= MAX_ANIM_LEN) {
            this.ranges.push({ from: fromB, to: toB, born: Date.now() });
          }
        });
        dirty = true;
      }

      // Expire old ranges.
      const now = Date.now();
      const before = this.ranges.length;
      this.ranges = this.ranges.filter((r) => now - r.born < LIFETIME);
      if (this.ranges.length !== before) dirty = true;

      if (dirty) this.decorations = this.build(u.view);
      this.schedule(u.view);
    }

    build(view: EditorView): DecorationSet {
      if (this.ranges.length === 0) return Decoration.none;
      const docLen = view.state.doc.length;
      // Sort + merge overlapping/adjacent ranges (rapid typing makes many).
      const sorted = [...this.ranges]
        .map((r) => ({
          from: Math.max(0, Math.min(r.from, docLen)),
          to: Math.max(0, Math.min(r.to, docLen)),
        }))
        .filter((r) => r.to > r.from)
        .sort((a, b) => a.from - b.from);

      const builder = new RangeSetBuilder<Decoration>();
      let cur: { from: number; to: number } | null = null;
      for (const r of sorted) {
        if (cur && r.from <= cur.to) {
          cur.to = Math.max(cur.to, r.to);
        } else {
          if (cur) builder.add(cur.from, cur.to, appearMark);
          cur = { from: r.from, to: r.to };
        }
      }
      if (cur) builder.add(cur.from, cur.to, appearMark);
      return builder.finish();
    }

    // Force a redraw after the lifetime so expired glows clear even when the
    // user stops typing (no further updates would otherwise fire).
    schedule(view: EditorView) {
      if (this.timer || this.ranges.length === 0) return;
      this.timer = setTimeout(() => {
        this.timer = null;
        view.dispatch({});
      }, LIFETIME + 30);
    }

    destroy() {
      if (this.timer) clearTimeout(this.timer);
    }
  },
  { decorations: (v) => v.decorations },
);

const theme = EditorView.baseTheme({
  '.cm-text-appear': {
    animation: 'cm-text-appear-kf 0.4s ease-out',
    borderRadius: '2px',
  },
  '@keyframes cm-text-appear-kf': {
    '0%': {
      backgroundColor: 'color-mix(in srgb, var(--accent-primary) 32%, transparent)',
      opacity: '0.45',
    },
    '100%': { backgroundColor: 'transparent', opacity: '1' },
  },
  '@media (prefers-reduced-motion: reduce)': {
    '.cm-text-appear': { animation: 'none' },
  },
});

export function textAnimationsExtension(): Extension[] {
  return [plugin, theme];
}
