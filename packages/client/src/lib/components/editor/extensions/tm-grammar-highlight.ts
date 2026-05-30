/**
 * tm-grammar-highlight.ts (LYK-1035) — apply TextMate tokenizer output as
 * CM6 decorations for plugin-contributed TextMate grammars.
 *
 * Mirrors plugin-grammar-highlight.ts (the tree-sitter path) but sources
 * spans from tmGrammarsStore (the vscode-textmate worker). Inert unless a
 * TM grammar is registered for the editor's language. Reuses the same
 * cm-ts-<category> classes — themed once in plugin-grammar-highlight's
 * baseTheme against the editor's --syn-* vars — so TM and tree-sitter
 * grammars render with one consistent palette.
 */

import {
  EditorView,
  Decoration,
  type DecorationSet,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { StateField, StateEffect, type Extension, RangeSetBuilder } from '@codemirror/state';
import { fileUriField } from './file-uri-field';
import { tmGrammarsStore } from '$lib/stores/tmGrammars.svelte';

interface TmSpan {
  from: number;
  to: number;
  cls: string;
}

const setTmSpans = StateEffect.define<TmSpan[]>();

const tmField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setTmSpans)) {
        const builder = new RangeSetBuilder<Decoration>();
        const spans = [...e.value].sort((a, b) => a.from - b.from || a.to - b.to);
        for (const s of spans) {
          if (s.to <= s.from || !s.cls) continue;
          builder.add(s.from, s.to, Decoration.mark({ class: s.cls }));
        }
        value = builder.finish();
      }
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const tmPlugin = (langFn: () => string) =>
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
          this.schedule(150);
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
        if (!lang || !tmGrammarsStore.has(lang)) return;
        const mySeq = ++this.seq;
        const content = this.view.state.doc.toString();
        const spans = await tmGrammarsStore.requestTokens(content, lang);
        if (mySeq !== this.seq) return; // superseded
        this.view.dispatch({ effects: setTmSpans.of(spans) });
      }
      destroy() {
        if (this.timer) clearTimeout(this.timer);
      }
    },
  );

export function tmGrammarHighlightExtension(langFn: () => string): Extension[] {
  // No baseTheme here — the cm-ts-* classes are themed by
  // pluginGrammarHighlightExtension, which is always mounted alongside.
  return [tmField, tmPlugin(langFn)];
}
