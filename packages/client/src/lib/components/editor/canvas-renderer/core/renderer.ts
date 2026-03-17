/**
 * rAF render loop orchestrator for the canvas code editor.
 *
 * Creates its own canvas and injects it into the CM scroller
 * (same proven approach as scroll-lens.ts). Also injects a style
 * tag to hide CM's visual output while keeping input handling.
 */

import type { EditorView } from '@codemirror/view';
import { measureFontMetrics, invalidateFontMetrics } from './font-metrics';
import { invalidateColorCache, setProbeHost } from './syntax-colors';
import { computeScrollEffect } from './scroll-effect';
import { computeVisibleLines } from './layout';
import { drawGutterBackground, computeGutterWidth, drawLineNumber } from '../layers/gutter';
import { drawLineBackground } from '../layers/background';
import { drawLineText } from '../layers/text';
import { drawLineCursors, CursorBlinker } from '../layers/cursor';

export type ZoomAlign = 'center' | 'left' | 'right';

export class CanvasRenderer {
  private alive = false;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private css: HTMLStyleElement;
  private view: EditorView;
  private pw = 0;
  zoomAlign: ZoomAlign = 'center';
  private ph = 0;
  private blinker = new CursorBlinker();

  // Resolved CSS colors (cached, refreshed on theme change)
  private colors = {
    bg: '#1e1e1e',
    gutterBg: '#1e1e1e',
    gutterBorder: '#333',
    gutterText: '#858585',
    gutterActiveText: '#c6c6c6',
    activeLine: 'rgba(255,255,255,0.04)',
    selection: 'rgba(0,120,215,0.35)',
    textDefault: '#d4d4d4',
    cursor: '#fff',
  };

  constructor(view: EditorView) {
    this.view = view;
    const scroller = view.scrollDOM;

    // Create canvas inside the scroller (matches scroll-lens.ts approach)
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:7;';
    scroller.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    // Inject CSS to hide CM visual output but keep input handling
    this.css = document.createElement('style');
    this.css.textContent = [
      '.cm-editor .cm-content .cm-line { color: transparent; }',
      '.cm-editor .cm-content .cm-line * { color: transparent !important; }',
      '.cm-editor .cm-gutters { visibility: hidden; }',
      '.cm-editor .cm-activeLine { background: transparent !important; }',
      '.cm-editor .cm-content { caret-color: transparent; }',
      '.cm-editor .cm-cursor { display: none !important; }',
      '.cm-editor .cm-selectionBackground { background: transparent !important; }',
      '.cm-editor .cm-content ::selection { background: transparent !important; }',
    ].join('\n');
    view.dom.appendChild(this.css);

    setProbeHost(view.dom);
    this.resolveColors();
    console.log(
      '[canvas-renderer] created, scroller size:',
      scroller.clientWidth,
      'x',
      scroller.clientHeight,
    );
  }

  /** Start the render loop. */
  start(): void {
    this.alive = true;
    console.log('[canvas-renderer] render loop started');
    this.tick();
  }

  /** Stop the render loop and clean up. */
  destroy(): void {
    this.alive = false;
    this.canvas.remove();
    this.css.remove();
  }

  /** Update the EditorView reference (e.g. after re-creation). */
  setView(view: EditorView): void {
    // Remove old canvas and CSS from previous view
    this.canvas.remove();
    this.css.remove();

    this.view = view;
    const scroller = view.scrollDOM;

    // Re-inject into new view
    scroller.appendChild(this.canvas);
    view.dom.appendChild(this.css);

    setProbeHost(view.dom);
    this.onThemeChange();
  }

  /** Call when theme or font settings change. */
  onThemeChange(): void {
    invalidateFontMetrics();
    invalidateColorCache();
    this.resolveColors();
    this.pw = 0; // force canvas resize
  }

  /** Read CSS custom properties from the editor DOM. */
  private resolveColors(): void {
    const el = this.view.dom;
    const get = (prop: string, fallback: string): string => {
      const v = getComputedStyle(el).getPropertyValue(prop).trim();
      return v || fallback;
    };
    this.colors = {
      bg: get('--bg-code', '#1e1e1e'),
      gutterBg: get('--bg-secondary', '#1e1e1e'),
      gutterBorder: get('--border-secondary', '#333'),
      gutterText: get('--text-tertiary', '#858585'),
      gutterActiveText: get('--text-secondary', '#c6c6c6'),
      activeLine: get('--bg-hover', 'rgba(255,255,255,0.04)'),
      selection: get('--bg-selection', 'rgba(0,120,215,0.35)'),
      textDefault: getComputedStyle(el).color || '#d4d4d4',
      cursor: get('--accent-primary', '#fff'),
    };
  }

  private tick(): void {
    if (!this.alive) return;
    requestAnimationFrame(() => {
      if (!this.alive) return;
      try {
        this.render();
      } catch (e) {
        console.error('[canvas-renderer] render error:', e);
      }
      this.tick();
    });
  }

  private render(): void {
    const { canvas, ctx, view } = this;
    const scroller = view.scrollDOM;
    const dpr = devicePixelRatio || 1;
    const w = scroller.clientWidth;
    const h = scroller.clientHeight;

    if (w === 0 || h === 0) return;

    // ── Pin canvas to scroller viewport (it's position:absolute inside a scrollable container) ──
    canvas.style.top = scroller.scrollTop + 'px';
    canvas.style.left = scroller.scrollLeft + 'px';

    // ── Resize ──
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    if (pw !== this.pw || ph !== this.ph) {
      this.pw = pw;
      this.ph = ph;
      canvas.width = pw;
      canvas.height = ph;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // ── Clear ──
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = this.colors.bg;
    ctx.fillRect(0, 0, w, h);

    const metrics = measureFontMetrics(view);
    const totalLines = view.state.doc.lines;
    const gutterW = computeGutterWidth(totalLines, metrics);
    const textX = gutterW + 8; // 8px padding after gutter
    const tabSize = view.state.tabSize;
    const scrollTop = scroller.scrollTop;

    // ── Gutter background (not scroll-transformed) ──
    drawGutterBackground(ctx, gutterW, h, this.colors.gutterBg, this.colors.gutterBorder);

    // ── Visible lines ──
    const lines = computeVisibleLines(view);

    ctx.font = metrics.font;
    ctx.textBaseline = 'alphabetic';

    // ── Compute adjusted Y positions ──
    // Lines in the focus zone keep their original positions.
    // Lines in the taper zone pack tighter (reduced line height).
    // Strategy: find the anchor line closest to viewport center,
    // then walk upward and downward, accumulating compressed positions.

    const midY = h / 2;

    // Pre-compute scroll effects for each line using original positions
    const lineData: Array<{
      line: (typeof lines)[0];
      fx: ReturnType<typeof computeScrollEffect>;
      origMidY: number;
    }> = [];
    for (const line of lines) {
      const origMidY = line.y + line.height / 2;
      const fx = computeScrollEffect(origMidY, h);
      lineData.push({ line, fx, origMidY });
    }

    // Find anchor: line whose original center is closest to viewport center
    let anchorIdx = 0;
    let minDist = Infinity;
    for (let i = 0; i < lineData.length; i++) {
      const d = Math.abs(lineData[i].origMidY - midY);
      if (d < minDist) {
        minDist = d;
        anchorIdx = i;
      }
    }

    // Compute adjusted Y for each line
    const adjustedY = new Float64Array(lineData.length);

    // Anchor line keeps its original Y
    if (lineData.length > 0) {
      adjustedY[anchorIdx] = lineData[anchorIdx].line.y;

      // Walk downward from anchor
      for (let i = anchorIdx + 1; i < lineData.length; i++) {
        const prev = lineData[i - 1];
        const prevH = prev.line.height * prev.fx.heightScale;
        adjustedY[i] = adjustedY[i - 1] + prevH;
      }

      // Walk upward from anchor
      for (let i = anchorIdx - 1; i >= 0; i--) {
        const cur = lineData[i];
        const curH = cur.line.height * cur.fx.heightScale;
        adjustedY[i] = adjustedY[i + 1] - curH;
      }
    }

    // ── Cursor blink state (computed once, used per-line) ──
    const now = performance.now();
    const cursorHead = view.state.selection.main.head;
    const cursorVisible = this.blinker.isVisible(now, cursorHead);

    // ── Draw lines at adjusted positions ──
    for (let i = 0; i < lineData.length; i++) {
      const { line, fx } = lineData[i];
      if (fx.skip) continue;

      const drawY = adjustedY[i];
      const drawH = line.height * fx.heightScale;
      const drawMidY = drawY + drawH / 2;

      // Create a modified line with adjusted Y for the draw functions
      const adjustedLine = { ...line, y: drawY, height: drawH };

      ctx.save();
      ctx.globalAlpha = fx.opacity;

      // Transform anchor X depends on zoom alignment
      const anchorX = this.zoomAlign === 'left' ? 0 : this.zoomAlign === 'right' ? w : w / 2;

      ctx.translate(anchorX, drawMidY);
      ctx.scale(fx.scaleX, fx.scaleY);
      // Vertical shear — simulates rotateY, text faces curve normal
      if (fx.skew !== 0) {
        ctx.transform(1, fx.skew, 0, 1, 0, 0);
      }
      ctx.translate(-anchorX, -drawMidY);

      // Background (active line / selection)
      drawLineBackground(
        ctx,
        view,
        adjustedLine,
        metrics,
        w,
        textX,
        tabSize,
        this.colors.activeLine,
        this.colors.selection,
      );

      // Line number
      drawLineNumber(
        ctx,
        view,
        adjustedLine,
        metrics,
        gutterW,
        this.colors.gutterText,
        this.colors.gutterActiveText,
      );

      // Syntax-colored text
      drawLineText(ctx, view.state, adjustedLine, metrics, textX, this.colors.textDefault, tabSize);

      // Cursors (inside transform block so they distort with the text)
      drawLineCursors(
        ctx,
        view,
        adjustedLine,
        metrics,
        textX,
        tabSize,
        this.colors.cursor,
        cursorVisible,
      );

      ctx.restore();
    }
  }
}
