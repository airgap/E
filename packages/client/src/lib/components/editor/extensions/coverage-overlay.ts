/**
 * CM6 extension for code coverage overlay.
 *
 * Shows green/red/yellow line backgrounds based on coverage data from
 * the coverageStore. Updates whenever the store changes.
 */

import {
  EditorView,
  Decoration,
  type DecorationSet,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { StateField, StateEffect, type Extension, RangeSetBuilder } from '@codemirror/state';
import { coverageStore, type LineCoverage } from '$lib/stores/coverage.svelte';

// ── State management ───────────────────────────────────────────────────

const setCoverageDecos = StateEffect.define<DecorationSet>();

const coverageDecoField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decos, tr) {
    for (const e of tr.effects) {
      if (e.is(setCoverageDecos)) return e.value;
    }
    return decos.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ── Line decoration classes ────────────────────────────────────────────

const coveredDeco = Decoration.line({ class: 'cm-coverage-covered' });
const uncoveredDeco = Decoration.line({ class: 'cm-coverage-uncovered' });
const partialDeco = Decoration.line({ class: 'cm-coverage-partial' });

function decoForStatus(status: LineCoverage): Decoration {
  switch (status) {
    case 'covered':
      return coveredDeco;
    case 'uncovered':
      return uncoveredDeco;
    case 'partial':
      return partialDeco;
  }
}

// ── Decoration builder ────────────────────────────────────────────────

function buildCoverageDecorations(view: EditorView, filePath: string): DecorationSet {
  const fc = coverageStore.getFileCoverage(filePath);
  if (!fc) return Decoration.none;

  const doc = view.state.doc;
  const builder = new RangeSetBuilder<Decoration>();

  // Lines must be added in document order
  const sortedLines = Array.from(fc.lines.entries()).sort((a, b) => a[0] - b[0]);

  for (const [lineNum, status] of sortedLines) {
    if (lineNum < 1 || lineNum > doc.lines) continue;
    const line = doc.line(lineNum);
    builder.add(line.from, line.from, decoForStatus(status));
  }

  return builder.finish();
}

// ── ViewPlugin ─────────────────────────────────────────────────────────

function createCoveragePlugin(filePath: string) {
  return ViewPlugin.define((view) => {
    let destroyed = false;
    let lastLoaded = coverageStore.loaded;

    function refreshDecorations() {
      if (destroyed) return;
      const decos = buildCoverageDecorations(view, filePath);
      view.dispatch({ effects: setCoverageDecos.of(decos) });
    }

    // Initial render
    if (coverageStore.loaded) {
      refreshDecorations();
    }

    // Poll for coverage data changes
    const interval = setInterval(() => {
      if (coverageStore.loaded !== lastLoaded) {
        lastLoaded = coverageStore.loaded;
        refreshDecorations();
      }
    }, 2000);

    return {
      update(update: ViewUpdate) {
        // Rebuild on doc changes to keep line positions correct
        if (update.docChanged && coverageStore.loaded) {
          refreshDecorations();
        }
      },
      destroy() {
        destroyed = true;
        clearInterval(interval);
      },
    };
  }, {});
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Returns CM6 extensions for code coverage overlay.
 */
export function coverageOverlayExtension(filePath: string): Extension[] {
  return [coverageDecoField, createCoveragePlugin(filePath)];
}
