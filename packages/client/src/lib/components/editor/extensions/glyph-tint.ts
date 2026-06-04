/**
 * glyph-tint.ts — tint code glyphs by git age (LYK-1088).
 *
 * Unlike a VS Code extension (which can only paint gutter dots or whole-line
 * backgrounds), E owns its renderer, so we tint the *glyphs themselves* on a
 * continuous scale: recently-changed code is full-strength (and the freshest /
 * uncommitted lines get an accent glow), while old, settled code fades back.
 * The result is an at-a-glance heat map of where the file is actively churning.
 *
 * Data comes from the existing `git blame` endpoint (per-line sha + commit
 * timestamp). Flag-gated by the caller (`editorGlyphTint`); reopen the file to
 * apply after toggling. Off by default.
 */
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { StateEffect, StateField, type Extension, RangeSetBuilder } from '@codemirror/state';
import { api } from '$lib/api/client';

interface BlameLine {
  line: number;
  sha: string;
  timestamp: number;
}

const setTintDecos = StateEffect.define<DecorationSet>();

const tintField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decos, tr) {
    for (const e of tr.effects) {
      if (e.is(setTintDecos)) return e.value;
    }
    return decos.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

/**
 * Map each line's commit recency to a continuous opacity, and flag the freshest
 * lines (top decile + anything uncommitted) for the accent glow. The recency
 * scale spans the file's own oldest→newest commit so every file reads well
 * regardless of absolute age.
 */
function buildTintDecorations(view: EditorView, blame: BlameLine[]): DecorationSet {
  const doc = view.state.doc;
  const builder = new RangeSetBuilder<Decoration>();
  if (blame.length === 0) return builder.finish();

  const committed = blame.filter((b) => b.sha !== '00000000' && b.timestamp > 0);
  let min = Infinity;
  let max = -Infinity;
  for (const b of committed) {
    if (b.timestamp < min) min = b.timestamp;
    if (b.timestamp > max) max = b.timestamp;
  }
  const span = max - min;

  // Cache marks by class string so we don't allocate one per line.
  const markCache = new Map<string, Decoration>();
  const markFor = (recency: number, fresh: boolean): Decoration => {
    // Quantize opacity to 0.05 steps to keep the cache small and avoid
    // sub-pixel decoration churn on every rebuild.
    const opacity = Math.round((0.45 + 0.55 * recency) * 20) / 20;
    const cls = fresh ? 'cm-glyph-tint cm-glyph-fresh' : 'cm-glyph-tint';
    const key = `${cls}|${opacity}`;
    let m = markCache.get(key);
    if (!m) {
      m = Decoration.mark({ attributes: { style: `opacity:${opacity}` }, class: cls });
      markCache.set(key, m);
    }
    return m;
  };

  for (const b of blame) {
    if (b.line < 1 || b.line > doc.lines) continue;
    const line = doc.line(b.line);
    if (line.from === line.to) continue; // blank line — nothing to tint

    const uncommitted = b.sha === '00000000' || b.timestamp <= 0;
    let recency: number;
    if (uncommitted) {
      recency = 1;
    } else if (span <= 0) {
      recency = 1;
    } else {
      recency = (b.timestamp - min) / span;
    }
    // Freshest decile, or working-tree edits, earn the accent glow.
    const fresh = uncommitted || recency >= 0.9;
    builder.add(line.from, line.to, markFor(recency, fresh));
  }

  return builder.finish();
}

function createTintPlugin(filePath: string, workspacePath: string) {
  return ViewPlugin.define((view) => {
    let blame: BlameLine[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;

    function fetchBlame() {
      if (!filePath || !workspacePath) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          const res = await api.git.blame(workspacePath, filePath);
          if (res.ok && res.data?.blame) {
            blame = res.data.blame.map((b) => ({
              line: b.line,
              sha: b.sha,
              timestamp: b.timestamp,
            }));
            view.dispatch({ effects: setTintDecos.of(buildTintDecorations(view, blame)) });
          }
        } catch {
          // New / untracked file — nothing to tint.
        }
      }, 300);
    }

    fetchBlame();

    return {
      update(update: ViewUpdate) {
        if (blame.length === 0) return;
        // Edits shift line numbers; rebuild so the tint follows the text. (We
        // don't re-blame on every keystroke — the existing mapping is close
        // enough until the next file refresh re-fetches.)
        if (update.docChanged) {
          update.view.dispatch({
            effects: setTintDecos.of(buildTintDecorations(update.view, blame)),
          });
        }
      },
      destroy() {
        if (timer) clearTimeout(timer);
      },
    };
  });
}

const theme = EditorView.baseTheme({
  '.cm-glyph-tint': {
    transition: 'opacity 200ms ease',
  },
  '.cm-glyph-fresh': {
    textShadow: '0 0 6px color-mix(in srgb, var(--accent-primary) 55%, transparent)',
  },
});

/** Returns CM6 extensions that tint glyphs by git age. */
export function glyphTintExtension(filePath: string, workspacePath: string): Extension[] {
  return [tintField, createTintPlugin(filePath, workspacePath), theme];
}
