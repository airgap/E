/**
 * CM6 gutter extension that shows test pass/fail/skip markers next to test
 * functions. Reads from testResultsStore and renders ✓/✗/○ icons.
 * Click a marker to re-run that specific test.
 */

import { gutter, GutterMarker, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { StateField, StateEffect, RangeSet, type Range, type Extension } from '@codemirror/state';
import { testResultsStore, type TestGutterMarker } from '$lib/stores/test-results.svelte';
import { fileUriField } from './file-uri-field';
import type { TestStatus } from '@e/shared';

// ── Re-run callback ──

// Callback for re-running a test — set externally by CodeEditor
let _onRerunTest: ((testName: string, filePath: string) => void) | null = null;

/** Set the callback that fires when user clicks the re-run button in the gutter. */
export function setTestRerunCallback(cb: (testName: string, filePath: string) => void) {
  _onRerunTest = cb;
}

// ── StateEffect to push markers into CM6 ──

const setTestMarkers = StateEffect.define<TestGutterMarker[]>();

// ── GutterMarker subclasses ──

class TestPassMarker extends GutterMarker {
  constructor(
    private testName: string,
    private duration?: number,
    private filePath?: string,
  ) {
    super();
  }

  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-test-marker cm-test-pass';
    el.textContent = '\u2713';
    el.title = `PASS: ${this.testName}${this.duration != null ? ` (${this.duration}ms)` : ''}\nClick to re-run`;
    el.setAttribute('aria-label', `Test passed: ${this.testName}`);
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => {
      if (_onRerunTest && this.filePath) {
        _onRerunTest(this.testName, this.filePath);
      }
    });
    return el;
  }
}

class TestFailMarker extends GutterMarker {
  constructor(
    private testName: string,
    private errorMessage?: string,
    private filePath?: string,
  ) {
    super();
  }

  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-test-marker cm-test-fail';
    el.textContent = '\u2717';
    el.title = `FAIL: ${this.testName}${this.errorMessage ? `\n${this.errorMessage.slice(0, 200)}` : ''}\nClick to re-run`;
    el.setAttribute('aria-label', `Test failed: ${this.testName}`);
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => {
      if (_onRerunTest && this.filePath) {
        _onRerunTest(this.testName, this.filePath);
      }
    });
    return el;
  }
}

class TestSkipMarker extends GutterMarker {
  constructor(
    private testName: string,
    private filePath?: string,
  ) {
    super();
  }

  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-test-marker cm-test-skip';
    el.textContent = '\u25CB';
    el.title = `SKIP: ${this.testName}\nClick to run`;
    el.setAttribute('aria-label', `Test skipped: ${this.testName}`);
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => {
      if (_onRerunTest && this.filePath) {
        _onRerunTest(this.testName, this.filePath);
      }
    });
    return el;
  }
}

function markerForStatus(m: TestGutterMarker, filePath?: string): GutterMarker {
  switch (m.status) {
    case 'passed':
      return new TestPassMarker(m.testName, m.duration, filePath);
    case 'failed':
      return new TestFailMarker(m.testName, m.errorMessage, filePath);
    case 'skipped':
    case 'pending':
      return new TestSkipMarker(m.testName, filePath);
  }
}

// ── StateField for gutter marker positions ──

const testMarkerField = StateField.define<RangeSet<GutterMarker>>({
  create() {
    return RangeSet.empty;
  },
  update(markers, tr) {
    // Remap positions when the document changes
    markers = markers.map(tr.changes);

    for (const effect of tr.effects) {
      if (effect.is(setTestMarkers)) {
        const newRanges: Range<GutterMarker>[] = [];
        const doc = tr.state.doc;

        // Get file path for re-run
        const uri = tr.state.field(fileUriField, false) ?? '';
        const filePath = uri.replace(/^file:\/\//, '');

        for (const m of effect.value) {
          if (m.line >= 1 && m.line <= doc.lines) {
            const lineStart = doc.line(m.line).from;
            newRanges.push(markerForStatus(m, filePath).range(lineStart));
          }
        }

        // RangeSet requires sorted ranges
        newRanges.sort((a, b) => a.from - b.from);
        markers = RangeSet.of(newRanges);
      }
    }

    return markers;
  },
});

// ── Gutter column ──

const testGutter = gutter({
  class: 'cm-test-gutter',
  markers: (view) => view.state.field(testMarkerField),
});

// ── ViewPlugin that syncs store → CM6 state ──

const testStoreSync = ViewPlugin.define((view) => {
  let lastVersion = -1;

  function getFilePath(): string {
    const uri = view.state.field(fileUriField, false) ?? '';
    return uri.replace(/^file:\/\//, '');
  }

  function syncMarkers() {
    const currentVersion = testResultsStore.version;
    if (currentVersion === lastVersion) return;
    lastVersion = currentVersion;

    const filePath = getFilePath();
    if (!filePath) return;

    const markers = testResultsStore.getMarkersForFile(filePath);
    view.dispatch({ effects: setTestMarkers.of(markers) });
  }

  // Initial sync
  syncMarkers();

  // Poll every 2s to pick up new test results
  const interval = setInterval(syncMarkers, 2000);

  return {
    update(_update: ViewUpdate) {
      // Also sync when the document changes (file switch)
      syncMarkers();
    },
    destroy() {
      clearInterval(interval);
    },
  };
});

// ── Public extension factory ──

/**
 * Create the test status gutter extension bundle.
 * Always enabled — shows markers only when test results exist for the file.
 */
export function testStatusGutterExtension(): Extension[] {
  return [testMarkerField, testGutter, testStoreSync];
}
