/**
 * CM6 extension for inline git blame annotations.
 *
 * Shows author + relative time at the end of the caret line(s) only — every
 * line at once was visually noisy. Selections spanning multiple lines
 * annotate all lines covered (matches VS Code's GitLens "current line"
 * mode). Blame data is fetched once per file and cached; decorations
 * rebuild on selection AND on edit (since edits shift positions).
 */

import {
  EditorView,
  Decoration,
  type DecorationSet,
  WidgetType,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import {
  StateField,
  StateEffect,
  type Extension,
  RangeSetBuilder,
  type EditorState,
} from '@codemirror/state';
import { api } from '$lib/api/client';

// ── Types ──────────────────────────────────────────────────────────────

interface BlameLine {
  line: number;
  sha: string;
  author: string;
  timestamp: number;
  summary: string;
}

// ── State management ──────────────────────────────────────────────────

const setBlameDecos = StateEffect.define<DecorationSet>();

const blameDecoField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decos, tr) {
    for (const e of tr.effects) {
      if (e.is(setBlameDecos)) return e.value;
    }
    return decos.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ── Relative time formatting ──────────────────────────────────────────

function relativeTime(timestamp: number): string {
  if (!timestamp) return '';
  const now = Date.now() / 1000;
  const diff = now - timestamp;

  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 2592000) return `${Math.floor(diff / 604800)}w ago`;
  if (diff < 31536000) return `${Math.floor(diff / 2592000)}mo ago`;
  return `${Math.floor(diff / 31536000)}y ago`;
}

function shortenAuthor(author: string): string {
  if (!author) return '';
  // Take first name or username
  const parts = author.split(/\s+/);
  if (parts.length > 1) return parts[0];
  return author.length > 12 ? author.slice(0, 12) : author;
}

// ── Widget ─────────────────────────────────────────────────────────────

class BlameWidget extends WidgetType {
  constructor(private blame: BlameLine) {
    super();
  }

  eq(other: BlameWidget): boolean {
    return this.blame.sha === other.blame.sha && this.blame.line === other.blame.line;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-blame-annotation';
    const author = shortenAuthor(this.blame.author);
    const time = relativeTime(this.blame.timestamp);
    span.textContent = `  ${author}, ${time}`;
    span.title = `${this.blame.sha} — ${this.blame.author}\n${this.blame.summary}`;
    return span;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

// ── Decoration builder ────────────────────────────────────────────────

/**
 * Collect the 1-indexed line numbers covered by any selection range. A
 * collapsed cursor returns its single line; a multi-line selection returns
 * every line it touches; multi-cursor sessions return one entry per cursor.
 * Returns an empty set if there's no document.
 */
function selectedLineNumbers(state: EditorState): Set<number> {
  const lines = new Set<number>();
  const doc = state.doc;
  for (const range of state.selection.ranges) {
    const from = doc.lineAt(range.from).number;
    const to = doc.lineAt(range.to).number;
    for (let n = from; n <= to; n++) lines.add(n);
  }
  return lines;
}

function buildBlameDecorations(view: EditorView, blameData: BlameLine[]): DecorationSet {
  const doc = view.state.doc;
  const builder = new RangeSetBuilder<Decoration>();
  // Only annotate the caret line(s). When nothing is selected (e.g. the
  // editor isn't focused yet), this is empty and we emit zero decorations
  // — the old "every line" behaviour was visually noisy.
  const activeLines = selectedLineNumbers(view.state);
  if (activeLines.size === 0) return builder.finish();

  for (const blame of blameData) {
    if (blame.line > doc.lines) break;
    if (!activeLines.has(blame.line)) continue;
    // Skip uncommitted lines (all zeros SHA)
    if (blame.sha === '00000000') continue;

    const line = doc.line(blame.line);
    builder.add(
      line.to,
      line.to,
      Decoration.widget({
        widget: new BlameWidget(blame),
        side: 1,
      }),
    );
  }

  return builder.finish();
}

// ── ViewPlugin (takes file info via closure) ──────────────────────────

function createBlamePlugin(filePath: string, workspacePath: string) {
  return ViewPlugin.define((view) => {
    let blameData: BlameLine[] = [];
    let fetchTimer: ReturnType<typeof setTimeout> | null = null;

    function fetchBlame() {
      if (!filePath || !workspacePath) return;

      if (fetchTimer) clearTimeout(fetchTimer);
      fetchTimer = setTimeout(async () => {
        try {
          const res = await api.git.blame(workspacePath, filePath);
          if (res.ok && res.data?.blame) {
            blameData = res.data.blame;
            const decos = buildBlameDecorations(view, blameData);
            view.dispatch({ effects: setBlameDecos.of(decos) });
          }
        } catch {
          // Silently ignore blame failures (e.g., new file not in git)
        }
      }, 300);
    }

    // Initial fetch
    fetchBlame();

    return {
      update(update: ViewUpdate) {
        if (blameData.length === 0) return;
        // Rebuild on edit (line numbers shift) AND on selection change
        // (different caret line wants the annotation). docChanged alone
        // wasn't enough once we narrowed annotations to the caret line —
        // moving the cursor with arrow keys produced no doc change but
        // needed to repaint the widget on a different line.
        if (update.docChanged || update.selectionSet) {
          const decos = buildBlameDecorations(update.view, blameData);
          update.view.dispatch({ effects: setBlameDecos.of(decos) });
        }
      },
      destroy() {
        if (fetchTimer) clearTimeout(fetchTimer);
      },
    };
  });
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Returns CM6 extensions for inline git blame annotations.
 */
export function gitBlameExtension(filePath: string, workspacePath: string): Extension[] {
  return [blameDecoField, createBlamePlugin(filePath, workspacePath)];
}
