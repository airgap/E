/**
 * Ribbon blame visualization — alternative to inline caret-line blame.
 *
 * Renders a thin colored band along the right edge of the editor's scroll
 * area. Each contiguous-author range is one segment; the colour is a
 * stable hash of the author identity. Sticky author labels float at the
 * top of each visible segment so the reader always knows whose code is on
 * screen without having to mouse-click into a specific line.
 *
 * The DOM is appended inside view.scrollDOM as a sibling of the content
 * layer so it scrolls with the document (no manual scroll-sync needed),
 * and is sized via the same content height the editor uses for the
 * scrollbar — so the ribbon segments always correspond 1:1 to where the
 * lines actually sit visually.
 */

import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { api } from '$lib/api/client';

interface BlameLine {
  line: number;
  sha: string;
  author: string;
  timestamp: number;
  summary: string;
}

/** A contiguous run of lines with the same commit. */
interface Segment {
  startLine: number;
  endLine: number;
  sha: string;
  author: string;
  summary: string;
  timestamp: number;
}

// ── Author colouring ──────────────────────────────────────────────────

/**
 * Stable djb2-style hash → HSL hue (0-360). Saturation + lightness are
 * fixed so colours stay legible against both light and dark editor themes;
 * only the hue varies between authors. We hash on the author identity
 * (name+email if available, else just name) so the same author always
 * gets the same colour across files and sessions.
 */
function authorHue(author: string): number {
  let hash = 5381;
  for (let i = 0; i < author.length; i++) {
    hash = ((hash << 5) + hash) ^ author.charCodeAt(i);
  }
  // Force unsigned, mod 360.
  return (hash >>> 0) % 360;
}

function authorColor(author: string, alpha = 1): string {
  const hue = authorHue(author);
  return `hsla(${hue}, 62%, 55%, ${alpha})`;
}

// ── Segment collapse ──────────────────────────────────────────────────

function collapseToSegments(blameData: BlameLine[]): Segment[] {
  const segments: Segment[] = [];
  let current: Segment | null = null;
  for (const blame of blameData) {
    if (!blame || blame.sha === '00000000') {
      // Boundary: uncommitted lines break the run.
      if (current) {
        segments.push(current);
        current = null;
      }
      continue;
    }
    if (current && current.sha === blame.sha && blame.line === current.endLine + 1) {
      current.endLine = blame.line;
    } else {
      if (current) segments.push(current);
      current = {
        startLine: blame.line,
        endLine: blame.line,
        sha: blame.sha,
        author: blame.author,
        summary: blame.summary,
        timestamp: blame.timestamp,
      };
    }
  }
  if (current) segments.push(current);
  return segments;
}

// ── DOM rendering ─────────────────────────────────────────────────────

class RibbonRenderer {
  private host: HTMLDivElement;
  /** One <div> per segment, parented to host. */
  private segmentEls: HTMLDivElement[] = [];

  constructor(scrollDOM: HTMLElement) {
    this.host = document.createElement('div');
    this.host.className = 'cm-blame-ribbon';
    this.host.style.position = 'absolute';
    this.host.style.top = '0';
    this.host.style.right = '0';
    this.host.style.width = '6px';
    this.host.style.pointerEvents = 'none';
    this.host.style.zIndex = '5';
    // Lives inside scrollDOM so it scrolls with the content automatically.
    scrollDOM.appendChild(this.host);
  }

  /**
   * Paint segments. line→Y mapping uses view.coordsAtPos so we get the
   * editor's *actual* layout (handles wrapped lines, folded ranges, mixed
   * font sizes). Positions are document-relative (scroll-independent).
   */
  paint(view: EditorView, segments: Segment[]) {
    this.host.innerHTML = '';
    this.segmentEls = [];
    if (segments.length === 0) {
      this.host.style.height = '0';
      return;
    }
    const contentHeight = view.contentHeight;
    this.host.style.height = `${contentHeight}px`;

    for (const seg of segments) {
      const startLine = view.state.doc.line(seg.startLine);
      const endLine =
        seg.endLine <= view.state.doc.lines
          ? view.state.doc.line(seg.endLine)
          : view.state.doc.line(view.state.doc.lines);
      const topPx = view.lineBlockAt(startLine.from).top;
      const bottomPx = view.lineBlockAt(endLine.from).bottom;
      const heightPx = Math.max(1, bottomPx - topPx);

      const segEl = document.createElement('div');
      segEl.className = 'cm-blame-ribbon-segment';
      segEl.style.position = 'absolute';
      segEl.style.left = '0';
      segEl.style.right = '0';
      segEl.style.top = `${topPx}px`;
      segEl.style.height = `${heightPx}px`;
      segEl.style.background = authorColor(seg.author, 0.55);
      segEl.title = `${seg.author}\n${seg.sha.slice(0, 8)} — ${seg.summary}`;

      // Sticky author label: positioned at the top of each segment but uses
      // CSS sticky so it pins to the viewport top while the segment is in
      // view (visible at all times for the topmost segment on screen).
      if (heightPx > 18) {
        const label = document.createElement('div');
        label.className = 'cm-blame-ribbon-label';
        label.textContent = shortAuthor(seg.author);
        label.style.position = 'sticky';
        label.style.top = '0';
        label.style.color = authorColor(seg.author, 1);
        label.style.fontSize = '10px';
        label.style.lineHeight = '12px';
        label.style.whiteSpace = 'nowrap';
        label.style.transformOrigin = 'top right';
        label.style.transform = 'translateX(-100%) rotate(0deg)';
        label.style.paddingRight = '4px';
        label.style.textAlign = 'right';
        label.style.fontFamily = 'system-ui, -apple-system, sans-serif';
        label.style.fontWeight = '600';
        label.style.textShadow =
          '0 0 2px rgba(0,0,0,0.7), 0 0 2px rgba(0,0,0,0.7), 0 0 2px rgba(0,0,0,0.7)';
        segEl.appendChild(label);
      }

      this.host.appendChild(segEl);
      this.segmentEls.push(segEl);
    }
  }

  destroy() {
    this.host.remove();
  }
}

function shortAuthor(author: string): string {
  if (!author) return '';
  const parts = author.split(/\s+/);
  if (parts.length > 1) return parts[0];
  return author.length > 16 ? author.slice(0, 16) : author;
}

// ── Public extension ──────────────────────────────────────────────────

export function gitBlameRibbonExtension(filePath: string, workspacePath: string): Extension {
  return ViewPlugin.define((view) => {
    let segments: Segment[] = [];
    let renderer: RibbonRenderer | null = null;
    let fetchTimer: ReturnType<typeof setTimeout> | null = null;

    function ensureRenderer() {
      if (!renderer) renderer = new RibbonRenderer(view.scrollDOM);
    }

    function repaint() {
      if (!renderer) return;
      renderer.paint(view, segments);
    }

    function fetchBlame() {
      if (!filePath || !workspacePath) return;
      if (fetchTimer) clearTimeout(fetchTimer);
      fetchTimer = setTimeout(async () => {
        try {
          const res = await api.git.blame(workspacePath, filePath);
          if (res.ok && res.data?.blame) {
            segments = collapseToSegments(res.data.blame as BlameLine[]);
            ensureRenderer();
            repaint();
          }
        } catch {
          /* silent — new files, non-git workspaces, etc. */
        }
      }, 300);
    }

    fetchBlame();

    return {
      update(update: ViewUpdate) {
        if (segments.length === 0) return;
        // Repaint on geometry change: edits shift lines, viewport changes
        // alter wrapped-line heights, and font-size settings can move
        // everything around. Selection changes don't require a repaint —
        // segments are not selection-dependent (unlike the caret mode).
        if (update.docChanged || update.viewportChanged || update.geometryChanged) {
          ensureRenderer();
          repaint();
        }
      },
      destroy() {
        if (fetchTimer) clearTimeout(fetchTimer);
        renderer?.destroy();
        renderer = null;
      },
    };
  });
}
