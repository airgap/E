/**
 * CM6 extension for Proactive AI Warnings.
 *
 * On document change (debounced 5s), sends file content to the LLM for review.
 * Renders warnings as dashed underline decorations with hover tooltips.
 * Warnings can be dismissed per-line, stored in the session-scoped store.
 */

import {
  EditorView,
  Decoration,
  type DecorationSet,
  WidgetType,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { StateField, StateEffect, type Extension, RangeSetBuilder } from '@codemirror/state';
import {
  proactiveWarningsStore,
  type ProactiveWarning,
} from '$lib/stores/proactiveWarnings.svelte';

// ── State management ───────────────────────────────────────────────────

const setProactiveDecos = StateEffect.define<DecorationSet>();

const proactiveDecoField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decos, tr) {
    for (const e of tr.effects) {
      if (e.is(setProactiveDecos)) return e.value;
    }
    return decos.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ── Dismiss button widget ──────────────────────────────────────────────

class ProactiveWarningWidget extends WidgetType {
  constructor(
    private warning: ProactiveWarning,
    private filePath: string,
  ) {
    super();
  }

  eq(other: ProactiveWarningWidget): boolean {
    return (
      this.warning.line === other.warning.line && this.warning.message === other.warning.message
    );
  }

  toDOM(): HTMLElement {
    const container = document.createElement('span');
    container.className = 'cm-proactive-warning-widget';

    const icon = document.createElement('span');
    icon.className = `cm-proactive-warning-icon cm-proactive-${this.warning.severity}`;
    icon.textContent =
      this.warning.severity === 'error' ? '⚠' : this.warning.severity === 'warning' ? '⚡' : 'ℹ';
    container.appendChild(icon);

    const msg = document.createElement('span');
    msg.className = 'cm-proactive-warning-msg';
    msg.textContent = ` ${this.warning.message}`;
    container.appendChild(msg);

    const dismissBtn = document.createElement('span');
    dismissBtn.className = 'cm-proactive-dismiss';
    dismissBtn.textContent = '✕';
    dismissBtn.title = 'Dismiss this warning';
    dismissBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      proactiveWarningsStore.dismiss(this.filePath, this.warning);
    });
    container.appendChild(dismissBtn);

    container.title = `[${this.warning.category}] ${this.warning.message}`;

    return container;
  }

  ignoreEvent(e: Event): boolean {
    return e.type !== 'mousedown';
  }
}

// ── Decoration builder ────────────────────────────────────────────────

function buildWarningDecorations(
  view: EditorView,
  warnings: ProactiveWarning[],
  filePath: string,
): DecorationSet {
  const doc = view.state.doc;
  const builder = new RangeSetBuilder<Decoration>();

  // Sort warnings by line number (RangeSetBuilder requires ordered positions)
  const sorted = [...warnings].sort((a, b) => a.line - b.line);

  for (const warning of sorted) {
    if (warning.line < 1 || warning.line > doc.lines) continue;

    const line = doc.line(warning.line);

    // Underline the non-whitespace content of the line
    const lineText = line.text;
    const firstNonSpace = lineText.search(/\S/);
    const lastNonSpace = lineText.search(/\S\s*$/);
    if (firstNonSpace < 0) continue; // Empty/whitespace-only line

    const from = line.from + firstNonSpace;
    const to = line.from + (lastNonSpace >= 0 ? lastNonSpace + 1 : lineText.length);

    // Dashed underline mark
    const severityClass =
      warning.severity === 'error'
        ? 'cm-proactive-underline-error'
        : warning.severity === 'warning'
          ? 'cm-proactive-underline-warning'
          : 'cm-proactive-underline-info';

    builder.add(from, to, Decoration.mark({ class: severityClass }));

    // End-of-line widget with message
    builder.add(
      line.to,
      line.to,
      Decoration.widget({
        widget: new ProactiveWarningWidget(warning, filePath),
        side: 1,
      }),
    );
  }

  return builder.finish();
}

// ── ViewPlugin ─────────────────────────────────────────────────────────

function createProactiveWarningsPlugin(filePath: string, language: string) {
  return ViewPlugin.define((view) => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let destroyed = false;
    let lastContent = '';
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    function scheduleAnalysis(delay = 5000) {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (destroyed) return;
        const content = view.state.doc.toString();
        // Skip if content hasn't changed since last analysis
        if (content === lastContent) return;
        lastContent = content;
        proactiveWarningsStore.analyze(filePath, content, language);
      }, delay);
    }

    // Poll the store for updated warnings and rebuild decorations
    function refreshDecorations() {
      if (destroyed) return;
      const warnings = proactiveWarningsStore.getWarnings(filePath);
      const decos = buildWarningDecorations(view, warnings, filePath);
      view.dispatch({ effects: setProactiveDecos.of(decos) });
    }

    // Initial analysis (with longer delay to let user start editing)
    scheduleAnalysis(8000);

    // Poll store every 2s for updates (warnings come back async from LLM)
    pollTimer = setInterval(refreshDecorations, 2000);

    return {
      update(update: ViewUpdate) {
        if (update.docChanged) {
          // Re-analyze after edits (debounced 5s)
          scheduleAnalysis(5000);
        }
      },
      destroy() {
        destroyed = true;
        if (debounceTimer) clearTimeout(debounceTimer);
        if (pollTimer) clearInterval(pollTimer);
      },
    };
  }, {});
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Returns CM6 extensions for proactive AI warning decorations.
 */
export function proactiveWarningsExtension(filePath: string, language: string): Extension[] {
  return [proactiveDecoField, createProactiveWarningsPlugin(filePath, language)];
}
