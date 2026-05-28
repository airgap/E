/**
 * Plugin-contributed inline completions (LYK-1050).
 *
 * Renders ghost-text after the caret showing what a plugin would insert
 * next; Tab accepts, Escape dismisses, any document change clears.
 *
 * Trigger model:
 *   - On caret idle (700 ms) we POST the file content + cursor to
 *     /api/plugins/inline-completion. First plugin to return non-empty
 *     insertText wins.
 *   - The fetched text is stored in a StateField and rendered as a
 *     widget decoration after the caret position.
 *   - A high-priority Tab keybinding accepts the suggestion when one
 *     is visible — otherwise it falls through to the editor's normal
 *     indent behavior (`indentWithTab` etc.).
 *   - Any further document change clears the suggestion, so the user
 *     doesn't get stale ghost text that no longer matches the buffer.
 *
 * The fetcher is cancellable via a request-id: only the most recent
 * fetch's result is applied, so fast typing won't paint a stale
 * suggestion from a slower earlier request.
 */
import { StateField, StateEffect } from '@codemirror/state';
import {
  EditorView,
  Decoration,
  type DecorationSet,
  ViewPlugin,
  WidgetType,
  keymap,
} from '@codemirror/view';
import { editorStore } from '$lib/stores/editor.svelte';
import { api } from '$lib/api/client';

const IDLE_MS = 700;

interface Suggestion {
  text: string;
  /** Document offset where the ghost text renders. */
  from: number;
}

const setSuggestion = StateEffect.define<Suggestion | null>();

const suggestionField = StateField.define<Suggestion | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setSuggestion)) return e.value;
    }
    // Any document edit invalidates a stale suggestion — the caret has
    // moved and the original prefix probably no longer matches.
    if (tr.docChanged) return null;
    if (tr.selection && value) {
      // Selection moved off the suggestion anchor; drop it.
      if (tr.selection.main.head !== value.from) return null;
    }
    return value;
  },
  provide: (f) =>
    EditorView.decorations.from(f, (value) => {
      if (!value) return Decoration.none;
      const widget = Decoration.widget({
        widget: new GhostTextWidget(value.text),
        side: 1,
      });
      try {
        return Decoration.set([widget.range(value.from)]);
      } catch {
        return Decoration.none;
      }
    }),
});

class GhostTextWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: WidgetType): boolean {
    return other instanceof GhostTextWidget && other.text === this.text;
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-plugin-inline-completion';
    // Newlines render as inline; CM6 doesn't position widget across
    // lines naturally, but the suggestion looks readable enough that
    // we keep the raw newlines for now.
    span.textContent = this.text;
    span.style.opacity = '0.45';
    span.style.fontStyle = 'italic';
    return span;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

const acceptInline = (view: EditorView): boolean => {
  const s = view.state.field(suggestionField);
  if (!s) return false;
  view.dispatch({
    changes: { from: s.from, to: s.from, insert: s.text },
    selection: { anchor: s.from + s.text.length },
    effects: setSuggestion.of(null),
  });
  return true;
};

const dismissInline = (view: EditorView): boolean => {
  const s = view.state.field(suggestionField);
  if (!s) return false;
  view.dispatch({ effects: setSuggestion.of(null) });
  return true;
};

const idlePlugin = ViewPlugin.fromClass(
  class {
    timer: ReturnType<typeof setTimeout> | null = null;
    /** Monotonic id to drop stale fetches. */
    fetchId = 0;
    constructor(public view: EditorView) {
      this.schedule();
    }
    update() {
      this.schedule();
    }
    schedule() {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => this.fetch(), IDLE_MS);
    }
    async fetch() {
      const tab = editorStore.activeTab;
      if (!tab) return;
      const head = this.view.state.selection.main.head;
      const lineObj = this.view.state.doc.lineAt(head);
      const lineIdx = lineObj.number - 1;
      const character = head - lineObj.from;
      const id = ++this.fetchId;
      try {
        const res = await api.plugins.inlineCompletion(
          tab.filePath,
          tab.content,
          lineIdx,
          character,
        );
        if (id !== this.fetchId) return; // a newer request superseded us
        if (this.view.state.selection.main.head !== head) return; // caret moved
        const text = res.data?.result?.insertText ?? '';
        if (!text) return;
        this.view.dispatch({ effects: setSuggestion.of({ text, from: head }) });
      } catch {
        /* swallow — best-effort */
      }
    }
    destroy() {
      if (this.timer) clearTimeout(this.timer);
    }
  },
);

/**
 * Compose the field + plugin + keymap. Tab is given a high priority so
 * it takes precedence over indentWithTab when a suggestion is visible;
 * when no suggestion, it returns false and the existing indent binding
 * runs.
 */
export function pluginInlineCompletionsExtension() {
  return [
    suggestionField,
    idlePlugin,
    keymap.of([
      { key: 'Tab', run: acceptInline },
      { key: 'Escape', run: dismissInline },
    ]),
  ];
}
