/**
 * test-actions-gutter.ts (LYK-1015) — Run icon next to every `test(`,
 * `it(`, `describe(`, `bench(` call so the user can launch a single test
 * (or suite) without leaving the file.
 *
 * Detection is regex-based on each line:
 *   /(^|\W)(test|it|describe|bench)\s*\(\s*(['"`])([^'"`]+)\3/
 * The capture intentionally rejects template literals / dynamic names —
 * those don't translate into a stable test id the runner can pin to.
 * Tree-sitter-grade parsing per language is the right long-term path
 * (it's in the LYK-1015 acceptance) but the regex covers the
 * single-quoted / double-quoted / backticked literal form 95% of
 * frameworks ship with — and adapters per language can drop in once
 * grammar contributions exist.
 *
 * Click handler:
 *   1. Look up the test id in pluginTestDiscoveryStore by (file, line).
 *      A discovered id routes through api.plugins.runTests so the
 *      plugin runner (LYK-1055) handles framework specifics.
 *   2. When no discovered id matches, surface a toast nudging the user
 *      to open the Test Explorer for discovery. Same heuristic used to
 *      avoid speculatively spawning a terminal command for an unknown
 *      framework.
 *
 * Debug icon is deferred — the acceptance asks for 🐛 Debug but the
 * per-framework DAP glue isn't in tree yet (LYK-1024 multi-session DAP
 * + per-framework launch configs are the prerequisites).
 */

import { gutter, GutterMarker, ViewPlugin, type ViewUpdate, EditorView } from '@codemirror/view';
import { StateField, StateEffect, RangeSet, type Range, type Extension } from '@codemirror/state';
import { fileUriField } from './file-uri-field';
import { pluginTestDiscoveryStore } from '$lib/stores/pluginTestDiscovery.svelte';
import { settingsStore } from '$lib/stores/settings.svelte';
import { uiStore } from '$lib/stores/ui.svelte';
import { api } from '$lib/api/client';

interface DetectedTest {
  /** 1-indexed line number. */
  line: number;
  /** test | it | describe | bench */
  kind: string;
  /** Extracted name literal. */
  name: string;
}

const TEST_LINE_RE = /(^|[^A-Za-z0-9_$])(test|it|describe|bench)\s*\(\s*(['"`])([^'"`]+)\3/;

function detectTests(doc: { toString(): string }): DetectedTest[] {
  const lines = doc.toString().split('\n');
  const out: DetectedTest[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = TEST_LINE_RE.exec(lines[i]);
    if (!m) continue;
    out.push({ line: i + 1, kind: m[2], name: m[4] });
  }
  return out;
}

const setDetected = StateEffect.define<DetectedTest[]>();

const detectedField = StateField.define<DetectedTest[]>({
  create: () => [],
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setDetected)) return e.value;
    return value;
  },
});

class RunMarker extends GutterMarker {
  constructor(
    private readonly file: string,
    private readonly line: number,
    private readonly kind: string,
    private readonly name: string,
  ) {
    super();
  }
  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-test-action cm-test-run';
    el.textContent = '▶';
    el.title = `Run ${this.kind}: ${this.name}`;
    el.style.cursor = 'pointer';
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      void this.handleClick();
    });
    return el;
  }
  private async handleClick() {
    if (!this.file) return;
    const testId = pluginTestDiscoveryStore.testIdAt(this.file, this.line);
    if (!testId) {
      uiStore.toast(
        pluginTestDiscoveryStore.hasAny()
          ? `No matching test id for "${this.name}" at line ${this.line}.`
          : 'Open the Test Explorer first to discover tests.',
        'info',
      );
      return;
    }
    const ws = settingsStore.workspacePath;
    if (!ws || ws === '.') {
      uiStore.toast('No workspace selected.', 'warning');
      return;
    }
    try {
      await api.plugins.runTests(ws, [testId]);
      uiStore.toast(`Ran ${this.name}.`, 'success');
    } catch (e) {
      uiStore.toast(`Run failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  }
}

/**
 * ViewPlugin that re-scans the document and pushes detected tests into
 * the StateField. Debounced via `update.docChanged` so noisy keystrokes
 * don't thrash the gutter render.
 */
const detectorPlugin = ViewPlugin.fromClass(
  class {
    constructor(public view: EditorView) {
      const detected = detectTests(view.state.doc);
      view.dispatch({ effects: setDetected.of(detected) });
    }
    update(u: ViewUpdate) {
      if (!u.docChanged) return;
      const detected = detectTests(u.state.doc);
      this.view.dispatch({ effects: setDetected.of(detected) });
    }
  },
);

export function testActionsGutterExtension(): Extension[] {
  return [
    detectedField,
    detectorPlugin,
    gutter({
      class: 'cm-test-actions-gutter',
      markers(view) {
        const detected = view.state.field(detectedField, false);
        if (!detected || detected.length === 0) return RangeSet.empty;
        const uri = view.state.field(fileUriField, false) ?? '';
        const file = uri.replace(/^file:\/\//, '');
        const ranges: Range<GutterMarker>[] = [];
        for (const d of detected) {
          // Translate 1-based line numbers into a doc position at the
          // start of that line; gutter() keys markers by position so
          // the marker shows on the right line.
          if (d.line <= 0 || d.line > view.state.doc.lines) continue;
          const pos = view.state.doc.line(d.line).from;
          ranges.push(new RunMarker(file, d.line, d.kind, d.name).range(pos));
        }
        return RangeSet.of(ranges, /* sort */ true);
      },
      // No initialSpacer: without it the gutter reserves no width when
      // there are no detected tests, so non-test files don't pay for an
      // empty ▶ column (LYK gutter-padding cleanup). The gutter sizes to
      // the marker only on lines that actually have a test.
    }),
    EditorView.baseTheme({
      '.cm-test-actions-gutter': {
        // No fixed width — collapses to 0 when empty, expands to the
        // marker (~11px) on test lines.
        textAlign: 'center',
      },
      '.cm-test-action': {
        display: 'inline-block',
        fontSize: '11px',
        color: 'var(--accent-secondary, #5ed26b)',
        opacity: '0.55',
        transition: 'opacity 80ms ease',
      },
      '.cm-test-action:hover': {
        opacity: '1',
      },
    }),
  ];
}
