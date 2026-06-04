/**
 * codePeeks store — tear-off floating code peeks (LYK-1104).
 *
 * Holds a collection of "peeks": pinned code regions that float over the UI as
 * draggable windows and update live as the underlying file changes. Populated
 * from the editor context menu ("Pin as floating peek"); rendered by
 * CodePeekLayer. Runtime-only (not persisted) — peeks are an ephemeral working
 * surface for the current session.
 */
import { uuid } from '$lib/utils/uuid';

export interface CodePeek {
  id: string;
  filePath: string;
  fileName: string;
  /** 1-indexed inclusive line range. */
  startLine: number;
  endLine: number;
  language: string;
  /** Current sliced text of the region (kept live). */
  content: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

let zCounter = 1;

function createCodePeeksStore() {
  let peeks = $state<CodePeek[]>([]);

  return {
    get peeks() {
      return peeks;
    },
    /** Returns the new peek's id. Staggers position so stacked pins don't overlap. */
    add(
      p: Omit<CodePeek, 'id' | 'x' | 'y' | 'w' | 'h'> &
        Partial<Pick<CodePeek, 'x' | 'y' | 'w' | 'h'>>,
    ) {
      const n = peeks.length;
      // Spawn over the editor area (right of the sidebar/conversation list), never
      // on top of it — a peek is interactive, so one parked over the sidebar would
      // silently swallow clicks on the conversations beneath it.
      const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
      const peek: CodePeek = {
        id: uuid(),
        x: p.x ?? Math.round(vw * 0.45) + n * 28,
        y: p.y ?? 110 + n * 28,
        w: p.w ?? 420,
        h: p.h ?? 260,
        ...p,
      };
      peeks = [...peeks, peek];
      return peek.id;
    },
    move(id: string, x: number, y: number) {
      peeks = peeks.map((pk) => (pk.id === id ? { ...pk, x, y } : pk));
    },
    resize(id: string, w: number, h: number) {
      peeks = peeks.map((pk) => (pk.id === id ? { ...pk, w, h } : pk));
    },
    updateContent(id: string, content: string) {
      peeks = peeks.map((pk) => (pk.id === id ? { ...pk, content } : pk));
    },
    close(id: string) {
      peeks = peeks.filter((pk) => pk.id !== id);
    },
    nextZ() {
      return ++zCounter;
    },
  };
}

export const codePeeksStore = createCodePeeksStore();
