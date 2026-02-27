/**
 * Hover-word highlight extension.
 *
 * When the user hovers over an identifier, all occurrences of that exact word
 * in the document are highlighted with a subtle background tint.
 * Highlights clear when the mouse leaves the editor content area.
 */
import { StateField, StateEffect, RangeSetBuilder, type Extension } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';

// ── Effects ───────────────────────────────────────────────────────────────────

/** Set or clear the highlighted word. */
export const setHoverWord = StateEffect.define<string | null>();

// ── Decoration mark ───────────────────────────────────────────────────────────

const hoverMark = Decoration.mark({ class: 'e-hover-word-highlight' });

// ── State field ───────────────────────────────────────────────────────────────

const hoverHighlightField = StateField.define<{ word: string | null; decos: DecorationSet }>({
  create: () => ({ word: null, decos: Decoration.none }),

  update(state, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setHoverWord)) {
        const word = effect.value;
        if (!word || word.length < 2) return { word: null, decos: Decoration.none };
        return { word, decos: buildHighlights(tr.state.doc.toString(), word) };
      }
    }
    // Recompute when doc changes while a word is active
    if (tr.docChanged && state.word) {
      return { word: state.word, decos: buildHighlights(tr.state.doc.toString(), state.word) };
    }
    return state;
  },

  provide: (f) => EditorView.decorations.from(f, (s) => s.decos),
});

// ── Highlight builder ─────────────────────────────────────────────────────────

function buildHighlights(docText: string, word: string): DecorationSet {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match whole-word only (don't highlight substrings)
  const re = new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`, 'g');
  const builder = new RangeSetBuilder<Decoration>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(docText)) !== null) {
    builder.add(m.index, m.index + word.length, hoverMark);
  }
  return builder.finish();
}

// ── Mouse-move handler ────────────────────────────────────────────────────────

/** Expand to word/identifier boundary (same logic as hover-info.ts). */
function wordAt(text: string, col: number): string {
  let start = col;
  let end = col;
  while (start > 0 && /[\w$]/.test(text[start - 1])) start--;
  while (end < text.length && /[\w$]/.test(text[end])) end++;
  return text.slice(start, end);
}

/** Build per-instance mouse handlers (avoids shared state across multiple editors). */
function makeMouseHandlers() {
  let rafId = 0;
  let lastWord = '';

  return EditorView.domEventHandlers({
    mousemove(event, view) {
      // Throttle via rAF to avoid thrashing
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos == null) {
          if (lastWord) {
            lastWord = '';
            view.dispatch({ effects: setHoverWord.of(null) });
          }
          return;
        }
        const line = view.state.doc.lineAt(pos);
        const word = wordAt(line.text, pos - line.from);
        if (word === lastWord) return;
        lastWord = word;
        view.dispatch({ effects: setHoverWord.of(word.length >= 2 ? word : null) });
      });
    },

    mouseleave(_event, view) {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      if (lastWord) {
        lastWord = '';
        view.dispatch({ effects: setHoverWord.of(null) });
      }
    },
  });
}

// ── Theme ─────────────────────────────────────────────────────────────────────
// Uses the editor's existing CSS variable infrastructure so it works with all themes.

const hoverHighlightTheme = EditorView.theme({
  '.e-hover-word-highlight': {
    backgroundColor: 'var(--hover-word-bg)',
    outline: '1px solid var(--hover-word-border)',
    outlineOffset: '-1px',
    borderRadius: '2px',
  },
});

// ── Export ────────────────────────────────────────────────────────────────────

/** Add to createExtensions() in CodeEditor.svelte. */
export function hoverHighlightExtension(): Extension {
  return [hoverHighlightField, makeMouseHandlers(), hoverHighlightTheme];
}
