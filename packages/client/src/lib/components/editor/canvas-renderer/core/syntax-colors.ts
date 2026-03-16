/**
 * Resolves Lezer highlight tree CSS classes to actual fill colors
 * by probing the DOM with temporary elements.
 *
 * Uses CM's `highlightTree` to walk the syntax tree and produce
 * colored spans for canvas text rendering.
 */

import { highlightTree } from '@lezer/highlight';
import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import { eHighlightStyle } from '../../e-cm-theme';

export interface ColorSpan {
  from: number;
  to: number;
  color: string;
}

const colorCache = new Map<string, string>();
let probeHost: HTMLElement | null = null;

/** Set the DOM element used as parent for color probes. */
export function setProbeHost(el: HTMLElement): void {
  probeHost = el;
}

/** Resolve a style-mod CSS class to an actual color string. */
function resolveColor(className: string, defaultColor: string): string {
  if (!className) return defaultColor;
  const cached = colorCache.get(className);
  if (cached !== undefined) return cached;

  const host = probeHost;
  if (!host) return defaultColor;

  const el = document.createElement('span');
  el.className = className;
  el.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;';
  host.appendChild(el);
  const color = getComputedStyle(el).color || defaultColor;
  el.remove();
  colorCache.set(className, color);
  return color;
}

/** Clear the color cache (call on theme change). */
export function invalidateColorCache(): void {
  colorCache.clear();
}

/**
 * Get colored spans for a line range.
 * Returns an array of {from, to, color} relative to `lineFrom`.
 */
export function getLineColors(
  state: EditorState,
  lineFrom: number,
  lineTo: number,
  defaultColor: string,
): ColorSpan[] {
  const tree = syntaxTree(state);
  const spans: ColorSpan[] = [];
  let pos = lineFrom;

  highlightTree(
    tree,
    eHighlightStyle,
    (from, to, classes) => {
      // Fill gap before this span with default color
      if (from > pos) {
        spans.push({ from: pos - lineFrom, to: from - lineFrom, color: defaultColor });
      }
      spans.push({
        from: from - lineFrom,
        to: to - lineFrom,
        color: resolveColor(classes, defaultColor),
      });
      pos = to;
    },
    lineFrom,
    lineTo,
  );

  // Fill trailing gap
  if (pos < lineTo) {
    spans.push({ from: pos - lineFrom, to: lineTo - lineFrom, color: defaultColor });
  }

  return spans;
}
