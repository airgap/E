/**
 * CM6 extension for inline merge conflict resolution.
 *
 * Scans the document for Git conflict markers (<<<<<<< / ======= / >>>>>>>),
 * renders interactive widget buttons (Accept Current / Incoming / Both / AI Merge),
 * and applies colour-tinted backgrounds to the conflict regions.
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

// ── Types ──────────────────────────────────────────────────────────────

export interface ConflictRegion {
  /** Line number (1-based) of the <<<<<<< marker */
  startLine: number;
  /** Line number (1-based) of the ======= separator */
  sepLine: number;
  /** Line number (1-based) of the >>>>>>> marker */
  endLine: number;
  /** Current branch label (text after <<<<<<<) */
  currentLabel: string;
  /** Incoming branch label (text after >>>>>>>) */
  incomingLabel: string;
}

export type ConflictResolution = 'current' | 'incoming' | 'both' | 'ai-merge';

export interface MergeConflictCallbacks {
  onResolve: (region: ConflictRegion, resolution: ConflictResolution) => void;
}

// ── Conflict scanning ──────────────────────────────────────────────────

const CONFLICT_START = /^<{7}\s*(.*)/;
const CONFLICT_SEP = /^={7}\s*$/;
const CONFLICT_END = /^>{7}\s*(.*)/;

/** Scan document text for conflict regions. */
export function findConflicts(doc: string): ConflictRegion[] {
  const lines = doc.split('\n');
  const regions: ConflictRegion[] = [];
  let i = 0;
  while (i < lines.length) {
    const startMatch = lines[i].match(CONFLICT_START);
    if (startMatch) {
      const startLine = i + 1; // 1-based
      const currentLabel = startMatch[1]?.trim() || 'HEAD';
      // Find separator
      let j = i + 1;
      let sepLine = -1;
      while (j < lines.length) {
        if (CONFLICT_SEP.test(lines[j])) {
          sepLine = j + 1;
          break;
        }
        j++;
      }
      if (sepLine === -1) {
        i++;
        continue;
      }
      // Find end
      let k = j + 1;
      let endLine = -1;
      let incomingLabel = '';
      while (k < lines.length) {
        const endMatch = lines[k].match(CONFLICT_END);
        if (endMatch) {
          endLine = k + 1;
          incomingLabel = endMatch[1]?.trim() || 'incoming';
          break;
        }
        k++;
      }
      if (endLine === -1) {
        i++;
        continue;
      }
      regions.push({ startLine, sepLine, endLine, currentLabel, incomingLabel });
      i = k + 1;
    } else {
      i++;
    }
  }
  return regions;
}

// ── Widget ─────────────────────────────────────────────────────────────

class ConflictHeaderWidget extends WidgetType {
  constructor(
    private region: ConflictRegion,
    private callbacks: MergeConflictCallbacks,
  ) {
    super();
  }

  eq(other: ConflictHeaderWidget): boolean {
    return (
      this.region.startLine === other.region.startLine &&
      this.region.endLine === other.region.endLine
    );
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-merge-conflict-header';
    wrap.setAttribute('aria-label', 'Merge conflict actions');

    const label = document.createElement('span');
    label.className = 'cm-merge-conflict-label';
    label.textContent = 'Merge Conflict';
    wrap.appendChild(label);

    const btnData: Array<{ text: string; res: ConflictResolution; cls: string }> = [
      { text: 'Accept Current', res: 'current', cls: 'cm-conflict-btn-current' },
      { text: 'Accept Incoming', res: 'incoming', cls: 'cm-conflict-btn-incoming' },
      { text: 'Accept Both', res: 'both', cls: 'cm-conflict-btn-both' },
      { text: 'AI Merge', res: 'ai-merge', cls: 'cm-conflict-btn-ai' },
    ];

    for (const bd of btnData) {
      const btn = document.createElement('button');
      btn.className = `cm-conflict-btn ${bd.cls}`;
      btn.textContent = bd.text;
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.callbacks.onResolve(this.region, bd.res);
      });
      wrap.appendChild(btn);
    }

    return wrap;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

// ── StateEffect / StateField for conflict decorations ──────────────────

const setConflictDecos = StateEffect.define<DecorationSet>();

const conflictDecoField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decos, tr) {
    for (const e of tr.effects) {
      if (e.is(setConflictDecos)) return e.value;
    }
    // Map positions through changes (document edits)
    return decos.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ── Decoration builders ────────────────────────────────────────────────

function buildConflictDecorations(
  view: EditorView,
  callbacks: MergeConflictCallbacks,
): DecorationSet {
  const doc = view.state.doc;
  const text = doc.toString();
  const regions = findConflicts(text);

  if (regions.length === 0) return Decoration.none;

  const builder = new RangeSetBuilder<Decoration>();

  for (const region of regions) {
    const lineCount = doc.lines;

    // Clamp to doc bounds
    if (region.startLine > lineCount || region.endLine > lineCount) continue;

    const startLineObj = doc.line(region.startLine);
    const sepLineObj = doc.line(region.sepLine);
    const endLineObj = doc.line(region.endLine);

    // Widget above the <<<<<<< line
    builder.add(
      startLineObj.from,
      startLineObj.from,
      Decoration.widget({
        widget: new ConflictHeaderWidget(region, callbacks),
        block: true,
        side: -1,
      }),
    );

    // <<<<<<< marker line — dim it
    builder.add(
      startLineObj.from,
      startLineObj.from,
      Decoration.line({ class: 'cm-conflict-marker-line' }),
    );

    // Current (ours) lines: green tint — between <<<<<<< and =======
    for (let ln = region.startLine + 1; ln < region.sepLine; ln++) {
      if (ln > lineCount) break;
      const line = doc.line(ln);
      builder.add(line.from, line.from, Decoration.line({ class: 'cm-conflict-current' }));
    }

    // ======= separator — dim
    builder.add(
      sepLineObj.from,
      sepLineObj.from,
      Decoration.line({ class: 'cm-conflict-marker-line' }),
    );

    // Incoming (theirs) lines: blue tint — between ======= and >>>>>>>
    for (let ln = region.sepLine + 1; ln < region.endLine; ln++) {
      if (ln > lineCount) break;
      const line = doc.line(ln);
      builder.add(line.from, line.from, Decoration.line({ class: 'cm-conflict-incoming' }));
    }

    // >>>>>>> marker line — dim
    builder.add(
      endLineObj.from,
      endLineObj.from,
      Decoration.line({ class: 'cm-conflict-marker-line' }),
    );
  }

  return builder.finish();
}

// ── ViewPlugin for sync ────────────────────────────────────────────────

function createConflictPlugin(callbacks: MergeConflictCallbacks) {
  return ViewPlugin.define((view) => {
    // Initial decoration build
    const decos = buildConflictDecorations(view, callbacks);
    view.dispatch({ effects: setConflictDecos.of(decos) });

    return {
      update(update: ViewUpdate) {
        if (update.docChanged) {
          const decos = buildConflictDecorations(update.view, callbacks);
          update.view.dispatch({ effects: setConflictDecos.of(decos) });
        }
      },
    };
  }, {});
}

// ── Helper: resolve a conflict in the document ─────────────────────────

/**
 * Given a ConflictRegion and a resolution type, return the replacement text.
 * The caller should replace from startLine.from to endLine.to with this text.
 */
export function resolveConflictText(
  doc: string,
  region: ConflictRegion,
  resolution: Exclude<ConflictResolution, 'ai-merge'>,
): string {
  const lines = doc.split('\n');

  // Extract "current" lines (between <<<<<<< and =======)
  const currentLines: string[] = [];
  for (let i = region.startLine; i < region.sepLine - 1; i++) {
    currentLines.push(lines[i]); // lines array is 0-based, startLine is 1-based
  }

  // Extract "incoming" lines (between ======= and >>>>>>>)
  const incomingLines: string[] = [];
  for (let i = region.sepLine; i < region.endLine - 1; i++) {
    incomingLines.push(lines[i]);
  }

  switch (resolution) {
    case 'current':
      return currentLines.join('\n');
    case 'incoming':
      return incomingLines.join('\n');
    case 'both':
      return [...currentLines, ...incomingLines].join('\n');
  }
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Returns CM6 extensions for merge conflict inline resolution.
 * The `callbacks` object is called when the user clicks a resolution button.
 */
export function mergeConflictExtension(callbacks: MergeConflictCallbacks): Extension[] {
  return [conflictDecoField, createConflictPlugin(callbacks)];
}

/** Quick check: does the content likely contain conflict markers? */
export function hasConflictMarkers(content: string): boolean {
  return content.includes('<<<<<<<') && content.includes('=======') && content.includes('>>>>>>>');
}
