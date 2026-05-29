/**
 * plugin-grammar-highlight.ts (LYK-1036) — apply a plugin tree-sitter
 * grammar's highlights.scm captures as CM6 decorations, and its
 * folds.scm captures as fold ranges.
 *
 * Per-extension routing: the extension is inert unless symbolStore has a
 * registered plugin highlights query for the editor's language
 * (hasPluginHighlights). For built-in languages the host's Lezer
 * highlighting (eHighlightStyle) keeps owning the colors — this only
 * lights up for plugin-supplied grammars, which is exactly the gap the
 * ticket targets (a grammar with no Lezer parser otherwise renders
 * plain).
 *
 * Capture → color: tree-sitter capture names are dotted
 * (`function.method`, `string.special`). We key the CSS class on the
 * top-level segment (`cm-ts-function`) and theme those against the
 * editor's existing `--syn-*` custom properties so plugin grammars match
 * the active theme automatically.
 *
 * Recompute cadence: debounced on docChanged (the worker re-parses the
 * full document each call — fine for the file sizes an editor handles;
 * incremental parsing across the worker boundary is a follow-up).
 */

import {
  EditorView,
  Decoration,
  type DecorationSet,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { StateField, StateEffect, type Extension, RangeSetBuilder } from '@codemirror/state';
import { foldService } from '@codemirror/language';
import { fileUriField } from './file-uri-field';
import { symbolStore } from '$lib/stores/symbols.svelte';

interface HiSpan {
  from: number;
  to: number;
  name: string;
}
interface FoldSpan {
  from: number;
  to: number;
}

const setHighlights = StateEffect.define<HiSpan[]>();
const setFolds = StateEffect.define<FoldSpan[]>();

/** Top-level capture segment → CSS class. */
function classFor(capture: string): string {
  const top = capture.split('.')[0];
  return `cm-ts-${top}`;
}

const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    // Map existing decorations through edits so they don't lag a frame.
    value = value.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setHighlights)) {
        const builder = new RangeSetBuilder<Decoration>();
        // Captures arrive in document order from tree-sitter; sort defensively
        // since RangeSetBuilder requires ascending `from`.
        const spans = [...e.value].sort((a, b) => a.from - b.from || a.to - b.to);
        for (const s of spans) {
          if (s.to <= s.from) continue;
          builder.add(s.from, s.to, Decoration.mark({ class: classFor(s.name) }));
        }
        value = builder.finish();
      }
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const foldRangesField = StateField.define<FoldSpan[]>({
  create: () => [],
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setFolds)) return e.value;
    // Shift fold offsets through edits so stale ranges don't misfire.
    if (tr.docChanged && value.length) {
      return value.map((f) => ({
        from: tr.changes.mapPos(f.from),
        to: tr.changes.mapPos(f.to),
      }));
    }
    return value;
  },
});

const highlightPlugin = (langFn: () => string) =>
  ViewPlugin.fromClass(
    class {
      timer: ReturnType<typeof setTimeout> | null = null;
      seq = 0;
      constructor(public view: EditorView) {
        this.schedule(0);
      }
      update(u: ViewUpdate) {
        if (
          u.docChanged ||
          u.state.field(fileUriField, false) !== u.startState.field(fileUriField, false)
        ) {
          this.schedule(120);
        }
      }
      schedule(delay: number) {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          this.timer = null;
          void this.run();
        }, delay);
      }
      async run() {
        const lang = langFn();
        if (!lang || !symbolStore.hasPluginHighlights(lang)) return;
        const mySeq = ++this.seq;
        const content = this.view.state.doc.toString();
        const { spans, folds } = await symbolStore.requestHighlights(content, lang);
        // Drop stale responses (newer request superseded this one).
        if (mySeq !== this.seq) return;
        this.view.dispatch({ effects: [setHighlights.of(spans), setFolds.of(folds)] });
      }
      destroy() {
        if (this.timer) clearTimeout(this.timer);
      }
    },
  );

export function pluginGrammarHighlightExtension(langFn: () => string): Extension[] {
  return [
    highlightField,
    foldRangesField,
    highlightPlugin(langFn),
    // Fold service backed by the grammar's folds.scm captures. Returns the
    // innermost fold range that starts on `lineStart`.
    foldService.of((state, lineStart, lineEnd) => {
      const folds = state.field(foldRangesField, false);
      if (!folds || folds.length === 0) return null;
      for (const f of folds) {
        if (f.from >= lineStart && f.from <= lineEnd && f.to > lineEnd) {
          return { from: f.from, to: f.to };
        }
      }
      return null;
    }),
    EditorView.baseTheme({
      '.cm-ts-keyword': { color: 'var(--syn-keyword)' },
      '.cm-ts-operator': { color: 'var(--syn-operator)' },
      '.cm-ts-string': { color: 'var(--syn-string)' },
      '.cm-ts-number': { color: 'var(--syn-number, var(--syn-string))' },
      '.cm-ts-comment': { color: 'var(--syn-comment)', fontStyle: 'italic' },
      '.cm-ts-function': { color: 'var(--syn-function)' },
      '.cm-ts-method': { color: 'var(--syn-function)' },
      '.cm-ts-constructor': { color: 'var(--syn-function)' },
      '.cm-ts-type': { color: 'var(--syn-type)' },
      '.cm-ts-constant': { color: 'var(--syn-number, var(--syn-type))' },
      '.cm-ts-variable': { color: 'var(--syn-variable)' },
      '.cm-ts-parameter': { color: 'var(--syn-variable)' },
      '.cm-ts-property': { color: 'var(--syn-variable)' },
      '.cm-ts-attribute': { color: 'var(--syn-type)' },
      '.cm-ts-tag': { color: 'var(--syn-keyword)' },
      '.cm-ts-label': { color: 'var(--syn-keyword)' },
      '.cm-ts-punctuation': { color: 'var(--text-secondary)' },
    }),
  ];
}
