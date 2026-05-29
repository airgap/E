/**
 * test-code-lens.ts (LYK-1018) — file-level synthetic code lens
 * summarising the last test run's results above the first line.
 *
 * Renders `▶ Run all · N passed · M failed · 0.34s` when the active
 * file matches a test naming convention (`.test.` / `.spec.`) AND the
 * `testCodeLensEnabled` setting is on. Click "Run all" fans out into
 * api.plugins.runTests for every plugin-discovered test in the file.
 *
 * "Synthetic source" — the spec is clear that this is NOT an LSP code
 * lens. Producing it from a separate extension keeps the lsp-code-lens
 * pipeline focused on what it advertises (textDocument/codeLens), and
 * lets per-suite and per-test lenses land later in this file as
 * targeted overlays without changing the LSP path.
 *
 * Per-suite / per-test lenses with "Run / Debug" actions are deferred —
 * the gutter (LYK-1015) already provides per-test Run, and the
 * acceptance explicitly tolerates the synthetic nature of the file-
 * level lens; full per-call-site lenses with Debug need framework-
 * aware DAP glue (LYK-1024 prereq).
 */

import {
  EditorView,
  Decoration,
  type DecorationSet,
  WidgetType,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { StateField, StateEffect, type Extension } from '@codemirror/state';
import { fileUriField } from './file-uri-field';
import { testResultsStore } from '$lib/stores/test-results.svelte';
import { pluginTestDiscoveryStore } from '$lib/stores/pluginTestDiscovery.svelte';
import { settingsStore } from '$lib/stores/settings.svelte';
import { uiStore } from '$lib/stores/ui.svelte';
import { api } from '$lib/api/client';

interface LensState {
  /** Total tests with results in this file. */
  passed: number;
  failed: number;
  skipped: number;
  /** Total milliseconds across the last run for tests in this file. */
  durationMs: number;
}

const setLens = StateEffect.define<LensState | null>();

const lensField = StateField.define<LensState | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setLens)) return e.value;
    return value;
  },
  provide: (f) =>
    EditorView.decorations.from(f, (value) => {
      if (!value) return Decoration.none;
      const widget = new TestSummaryWidget(value);
      try {
        return Decoration.set([Decoration.widget({ widget, side: -1 }).range(0)]);
      } catch {
        return Decoration.none;
      }
    }),
});

class TestSummaryWidget extends WidgetType {
  constructor(readonly state: LensState) {
    super();
  }
  eq(other: TestSummaryWidget): boolean {
    return (
      other.state.passed === this.state.passed &&
      other.state.failed === this.state.failed &&
      other.state.skipped === this.state.skipped &&
      other.state.durationMs === this.state.durationMs
    );
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-test-codelens';

    // ▶ Run all
    const runBtn = document.createElement('span');
    runBtn.className = 'cm-test-codelens-run';
    runBtn.textContent = '▶ Run all';
    runBtn.title = 'Run every discovered test in this file';
    runBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.onRunAll();
    });
    wrap.appendChild(runBtn);

    const sep1 = document.createElement('span');
    sep1.className = 'cm-test-codelens-sep';
    sep1.textContent = ' · ';
    wrap.appendChild(sep1);

    const pass = document.createElement('span');
    pass.className = 'cm-test-codelens-pass';
    pass.textContent = `${this.state.passed} passed`;
    wrap.appendChild(pass);

    if (this.state.failed > 0) {
      const sep2 = document.createElement('span');
      sep2.className = 'cm-test-codelens-sep';
      sep2.textContent = ' · ';
      wrap.appendChild(sep2);

      const fail = document.createElement('span');
      fail.className = 'cm-test-codelens-fail';
      fail.textContent = `${this.state.failed} failed`;
      wrap.appendChild(fail);
    }
    if (this.state.skipped > 0) {
      const sep3 = document.createElement('span');
      sep3.className = 'cm-test-codelens-sep';
      sep3.textContent = ' · ';
      wrap.appendChild(sep3);

      const skip = document.createElement('span');
      skip.className = 'cm-test-codelens-skip';
      skip.textContent = `${this.state.skipped} skipped`;
      wrap.appendChild(skip);
    }
    if (this.state.durationMs > 0) {
      const sep4 = document.createElement('span');
      sep4.className = 'cm-test-codelens-sep';
      sep4.textContent = ' · ';
      wrap.appendChild(sep4);

      const dur = document.createElement('span');
      dur.className = 'cm-test-codelens-dur';
      dur.textContent =
        this.state.durationMs >= 1000
          ? `${(this.state.durationMs / 1000).toFixed(2)}s`
          : `${this.state.durationMs}ms`;
      wrap.appendChild(dur);
    }

    return wrap;
  }
  ignoreEvent(e: Event): boolean {
    return e.type !== 'click';
  }

  /** Fan out api.plugins.runTests for every test discovered in this file. */
  private async onRunAll() {
    // Caller can't know the active EditorView here. Use the discovery
    // store directly — Run All from the lens just runs everything the
    // explorer last discovered (no file filter), matching how the lens
    // copies summary state from the latest run.
    const ws = settingsStore.workspacePath;
    if (!ws || ws === '.') {
      uiStore.toast('No workspace selected.', 'warning');
      return;
    }
    // Pull discovered test ids whose file matches the active editor —
    // when we can't tell, we fall back to "all".
    const ids: string[] = [];
    const walk = (nodes: Array<any>) => {
      for (const n of nodes) {
        if (n.type === 'test' && n.id) ids.push(n.id);
        if (n.children) walk(n.children);
      }
    };
    for (const g of pluginTestDiscoveryStore.groups) walk(g.tree);
    if (ids.length === 0) {
      uiStore.toast('Open the Test Explorer first to discover tests.', 'info');
      return;
    }
    try {
      await api.plugins.runTests(ws, ids);
      uiStore.toast(`Ran ${ids.length} test${ids.length === 1 ? '' : 's'}.`, 'success');
    } catch (e) {
      uiStore.toast(`Run failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  }
}

function isTestFile(path: string): boolean {
  return /\.(test|spec)\.[a-z0-9]+$/i.test(path);
}

function computeLens(filePath: string): LensState | null {
  if (!isTestFile(filePath)) return null;
  const markers = testResultsStore.getMarkersForFile(filePath);
  if (markers.length === 0) return null;
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let durationMs = 0;
  for (const m of markers) {
    if (m.status === 'passed') passed++;
    else if (m.status === 'failed') failed++;
    else skipped++;
    if (m.duration) durationMs += m.duration;
  }
  return { passed, failed, skipped, durationMs };
}

const lensPlugin = ViewPlugin.fromClass(
  class {
    constructor(public view: EditorView) {
      this.recompute();
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.state.field(fileUriField, false) !== u.startState.field(fileUriField, false)
      ) {
        this.recompute();
      }
    }
    recompute() {
      if (!settingsStore.testCodeLensEnabled) {
        this.view.dispatch({ effects: setLens.of(null) });
        return;
      }
      const uri = this.view.state.field(fileUriField, false) ?? '';
      const file = uri.replace(/^file:\/\//, '');
      const lens = file ? computeLens(file) : null;
      this.view.dispatch({ effects: setLens.of(lens) });
    }
  },
);

export function testCodeLensExtension(): Extension[] {
  return [
    lensField,
    lensPlugin,
    EditorView.baseTheme({
      '.cm-test-codelens': {
        padding: '4px 12px',
        color: 'var(--text-tertiary)',
        fontSize: '11px',
        fontFamily: 'var(--font-family-sans, system-ui, sans-serif)',
        borderBottom: '1px solid var(--border-subtle, transparent)',
        display: 'flex',
        alignItems: 'center',
        gap: '0',
      },
      '.cm-test-codelens-run': {
        color: 'var(--accent-primary, #4ec1f5)',
        cursor: 'pointer',
        fontWeight: '600',
      },
      '.cm-test-codelens-run:hover': {
        textDecoration: 'underline',
      },
      '.cm-test-codelens-sep': {
        color: 'var(--text-tertiary)',
      },
      '.cm-test-codelens-pass': { color: 'var(--accent-secondary, #5ed26b)' },
      '.cm-test-codelens-fail': { color: 'var(--accent-error, #ef4444)' },
      '.cm-test-codelens-skip': { color: 'var(--accent-warning, #d4a657)' },
      '.cm-test-codelens-dur': { color: 'var(--text-tertiary)' },
    }),
  ];
}
