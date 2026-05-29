/**
 * test-failure-peek.ts (LYK-1017) — inline assertion diff under each
 * failing test line. Parses Jest/Vitest-style "Expected: … Received: …"
 * payloads from testResultsStore markers and renders a side-by-side
 * peek below the failure with an "Open as full diff" jump.
 *
 * Parsing scope:
 *   - Vitest: `expect(received).toBe(expected)` blocks emit
 *     "- Expected\n+ Received\n  …\n- expected\n+ received".
 *   - Jest's `expect(received).toEqual(expected)` emits "Expected: <x>\n
 *     Received: <y>".
 *   - jest-diff lines (`- expected`, `+ received`) are also recognised.
 * Failures without a parseable expected/received are skipped — the
 * gutter ✗ marker still surfaces them, just without a peek.
 *
 * Collapsibility:
 *   Multi-line values get a collapsed preview (first 4 lines) with
 *   "show more" toggling the full value. Single-line values render
 *   inline.
 *
 * State preservation:
 *   The widget identity is keyed on (line, expected, received). A
 *   re-run that produces the same trio leaves the widget DOM intact;
 *   different trios drop the previous widget. That's the cheap version
 *   of "preserve until another change" — good enough for v1.
 */

import { EditorView, Decoration, WidgetType, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { StateField, StateEffect, type Extension } from '@codemirror/state';
import { fileUriField } from './file-uri-field';
import { testResultsStore, type TestGutterMarker } from '$lib/stores/test-results.svelte';
import { editorStore } from '$lib/stores/editor.svelte';

interface FailurePeek {
  line: number;
  testName: string;
  expected: string;
  received: string;
}

const setPeeks = StateEffect.define<FailurePeek[]>();

// peeksField stores the parsed peeks; applyPeekDecorations (below)
// resolves them against the live document to produce block widgets.
const peeksField = StateField.define<FailurePeek[]>({
  create: () => [],
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setPeeks)) return e.value;
    return value;
  },
});

class FailurePeekWidget extends WidgetType {
  constructor(readonly peek: FailurePeek) {
    super();
  }
  eq(other: FailurePeekWidget): boolean {
    return (
      other.peek.line === this.peek.line &&
      other.peek.expected === this.peek.expected &&
      other.peek.received === this.peek.received
    );
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-test-failure-peek';

    const head = document.createElement('div');
    head.className = 'cm-tfp-head';
    head.textContent = this.peek.testName;
    wrap.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'cm-tfp-grid';

    grid.appendChild(this.makeColumn('Expected', this.peek.expected, 'expected'));
    grid.appendChild(this.makeColumn('Received', this.peek.received, 'received'));

    wrap.appendChild(grid);

    const actions = document.createElement('div');
    actions.className = 'cm-tfp-actions';
    const fullDiffBtn = document.createElement('button');
    fullDiffBtn.className = 'cm-tfp-action';
    fullDiffBtn.textContent = 'Open as full diff';
    fullDiffBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const diff = buildSyntheticDiff(this.peek.expected, this.peek.received);
      void editorStore.openDiffTab(`expect:${this.peek.testName}`, diff, /* staged */ false);
    });
    actions.appendChild(fullDiffBtn);
    wrap.appendChild(actions);

    return wrap;
  }
  ignoreEvent(e: Event): boolean {
    return e.type !== 'click';
  }

  /** Build one side of the diff with a collapsible preview when long. */
  private makeColumn(label: string, value: string, kind: 'expected' | 'received'): HTMLElement {
    const col = document.createElement('div');
    col.className = `cm-tfp-col cm-tfp-${kind}`;

    const lab = document.createElement('div');
    lab.className = 'cm-tfp-label';
    lab.textContent = label;
    col.appendChild(lab);

    const lines = value.split('\n');
    const isLong = lines.length > 4;
    let collapsed = isLong;

    const body = document.createElement('pre');
    body.className = 'cm-tfp-body';
    function render() {
      if (collapsed) {
        body.textContent = lines.slice(0, 4).join('\n') + (isLong ? '\n…' : '');
      } else {
        body.textContent = value;
      }
    }
    render();
    col.appendChild(body);

    if (isLong) {
      const toggle = document.createElement('button');
      toggle.className = 'cm-tfp-toggle';
      toggle.textContent = collapsed ? `show more (${lines.length - 4} more lines)` : 'collapse';
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        collapsed = !collapsed;
        toggle.textContent = collapsed ? `show more (${lines.length - 4} more lines)` : 'collapse';
        render();
      });
      col.appendChild(toggle);
    }

    return col;
  }
}

function buildSyntheticDiff(expected: string, received: string): string {
  // Minimal unified-diff blob for editorStore.openDiffTab to render.
  const exp = expected.split('\n');
  const rec = received.split('\n');
  const out: string[] = ['--- Expected', '+++ Received'];
  out.push(`@@ -1,${exp.length} +1,${rec.length} @@`);
  for (const l of exp) out.push(`-${l}`);
  for (const l of rec) out.push(`+${l}`);
  return out.join('\n') + '\n';
}

// ── Parsing ──

/**
 * Pull (expected, received) out of an errorMessage. Returns null when
 * the format isn't recognised — caller leaves the gutter ✗ marker
 * untouched but skips the peek.
 */
function parseExpectedReceived(msg: string): { expected: string; received: string } | null {
  // Form A: "Expected: <value>\nReceived: <value>" (Jest)
  const a = /Expected:\s*([\s\S]*?)\nReceived:\s*([\s\S]*?)(?:\n\s*at\s|$)/.exec(msg);
  if (a) return { expected: a[1].trim(), received: a[2].trim() };
  // Form B: vitest "- expected\n+ received" hunk
  const b = /- Expected\s*\n\+ Received\s*\n([\s\S]*)/.exec(msg);
  if (b) {
    const lines = b[1].split('\n');
    const expectedLines: string[] = [];
    const receivedLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith('- ')) expectedLines.push(line.slice(2));
      else if (line.startsWith('+ ')) receivedLines.push(line.slice(2));
      else if (line.trim() === '') break;
    }
    if (expectedLines.length || receivedLines.length) {
      return { expected: expectedLines.join('\n'), received: receivedLines.join('\n') };
    }
  }
  // Form C: chai-like "expected 'X' to be 'Y'"
  const c = /expected\s+(['"][^'"]*['"]|[^\s]+)\s+to\s+\S+\s+(['"][^'"]*['"]|[^\s]+)/.exec(msg);
  if (c)
    return {
      expected: c[2].replace(/^['"]|['"]$/g, ''),
      received: c[1].replace(/^['"]|['"]$/g, ''),
    };
  return null;
}

function peeksForFile(filePath: string, markers: TestGutterMarker[]): FailurePeek[] {
  const out: FailurePeek[] = [];
  for (const m of markers) {
    if (m.status !== 'failed' || !m.errorMessage) continue;
    const parsed = parseExpectedReceived(m.errorMessage);
    if (!parsed) continue;
    out.push({
      line: m.line,
      testName: m.testName,
      expected: parsed.expected,
      received: parsed.received,
    });
  }
  return out;
}

// ── ViewPlugin: keep peeks in sync with testResultsStore + file URI ──

const peekPlugin = ViewPlugin.fromClass(
  class {
    /** Track last-seen testResultsStore.version so we re-run only on changes. */
    lastVersion = -1;
    constructor(public view: EditorView) {
      this.recompute();
    }
    update(u: ViewUpdate) {
      const v = testResultsStore.version;
      const file = (u.state.field(fileUriField, false) ?? '').replace(/^file:\/\//, '');
      const prevFile = (u.startState.field(fileUriField, false) ?? '').replace(/^file:\/\//, '');
      if (v !== this.lastVersion || file !== prevFile) this.recompute();
    }
    recompute() {
      const file = (this.view.state.field(fileUriField, false) ?? '').replace(/^file:\/\//, '');
      const markers = file ? testResultsStore.getMarkersForFile(file) : [];
      const peeks = peeksForFile(file, markers);
      this.lastVersion = testResultsStore.version;
      this.view.dispatch({ effects: setPeeks.of(peeks) });
    }
  },
);

// ── Decoration wiring: peek widget anchored at the failed line ──
//
// The earlier StateField returns Decoration.none — actual placement
// happens here so we can resolve `peek.line` to a real doc offset (CM6
// state isn't visible from inside buildDecorations).

const applyPeekDecorations = EditorView.decorations.compute(['doc', peeksField], (state) => {
  const peeks = state.field(peeksField, false);
  if (!peeks || peeks.length === 0) return Decoration.none;
  const decos = [];
  for (const p of peeks) {
    const line = Math.max(1, Math.min(p.line, state.doc.lines));
    const pos = state.doc.line(line).to;
    decos.push(
      Decoration.widget({
        widget: new FailurePeekWidget(p),
        side: 1,
        block: true,
      }).range(pos),
    );
  }
  return Decoration.set(decos, /* sort */ true);
});

export function testFailurePeekExtension(): Extension[] {
  return [
    peeksField,
    peekPlugin,
    applyPeekDecorations,
    EditorView.baseTheme({
      '.cm-test-failure-peek': {
        margin: '4px 8px',
        padding: '8px 10px',
        background: 'color-mix(in srgb, var(--accent-error, #ef4444) 8%, transparent)',
        border: '1px solid color-mix(in srgb, var(--accent-error, #ef4444) 35%, transparent)',
        borderRadius: '4px',
        fontFamily: 'var(--font-family, monospace)',
        fontSize: '11px',
      },
      '.cm-tfp-head': {
        color: 'var(--accent-error, #ef4444)',
        fontWeight: '600',
        marginBottom: '6px',
      },
      '.cm-tfp-grid': {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '8px',
      },
      '.cm-tfp-col': {
        background: 'var(--bg-secondary)',
        borderRadius: '3px',
        padding: '6px 8px',
        overflow: 'auto',
      },
      '.cm-tfp-label': {
        fontSize: '10px',
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        color: 'var(--text-tertiary)',
        marginBottom: '4px',
      },
      '.cm-tfp-expected .cm-tfp-label': { color: 'var(--accent-secondary, #5ed26b)' },
      '.cm-tfp-received .cm-tfp-label': { color: 'var(--accent-error, #ef4444)' },
      '.cm-tfp-body': {
        margin: '0',
        padding: '0',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        color: 'var(--text-primary)',
        fontSize: '11px',
        maxHeight: '160px',
        overflow: 'auto',
      },
      '.cm-tfp-toggle': {
        marginTop: '4px',
        background: 'none',
        border: 'none',
        color: 'var(--accent-primary)',
        font: 'inherit',
        fontSize: '10px',
        cursor: 'pointer',
        padding: '0',
      },
      '.cm-tfp-actions': {
        marginTop: '6px',
      },
      '.cm-tfp-action': {
        background: 'var(--bg-tertiary)',
        border: '1px solid var(--border-primary)',
        color: 'var(--text-primary)',
        font: 'inherit',
        fontSize: '11px',
        padding: '2px 8px',
        borderRadius: '3px',
        cursor: 'pointer',
      },
      '.cm-tfp-action:hover': {
        background: 'var(--bg-hover)',
      },
    }),
  ];
}
