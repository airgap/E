/**
 * Scroll state — broadcasts the main content scroll offset
 * so ambient effects (star sphere rotation) can react to scrolling.
 *
 * Uses both a $state (for reactive Svelte consumers) and a plain
 * variable (for rAF callbacks that read outside reactive context).
 */

let offset = $state(0);
/** Plain value readable from rAF / non-reactive contexts */
let rawOffset = 0;

export const scrollStore = {
  get offset() {
    return offset;
  },
  /** Raw value safe to read from requestAnimationFrame callbacks */
  get rawOffset() {
    return rawOffset;
  },
  set(value: number) {
    offset = value;
    rawOffset = value;
  },
};
