/**
 * CM6 gutter extension for debugger breakpoints.
 *
 * Click empty space in the gutter to toggle a breakpoint on that line.
 * Click an existing marker to remove it. Markers visually distinguish
 * enabled/disabled and verified/pending states.
 *
 * The extension is path-aware — we read from breakpointsStore keyed by
 * the current file path (passed via filePath at construction time) and
 * push changes back to the DAP store when a debug session is live.
 */

import { gutter, GutterMarker, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { StateField, StateEffect, RangeSet, type Range, type Extension } from '@codemirror/state';
import { breakpointsStore, type Breakpoint } from '$lib/stores/breakpoints.svelte';
import { dapStore } from '$lib/stores/dap.svelte';

const setBreakpointMarkers = StateEffect.define<Breakpoint[]>();

/** Filled red dot = verified, hollow = pending, dim = disabled. */
class BreakpointMarker extends GutterMarker {
  constructor(private bp: Breakpoint) {
    super();
  }

  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-bp-marker';
    el.classList.toggle('cm-bp-enabled', this.bp.enabled);
    el.classList.toggle('cm-bp-disabled', !this.bp.enabled);
    el.classList.toggle('cm-bp-verified', this.bp.verified === true);
    el.textContent = '●';
    el.title = `Breakpoint on line ${this.bp.line}${
      this.bp.verified === false ? ' (not yet verified)' : ''
    }${!this.bp.enabled ? ' (disabled)' : ''}`;
    el.setAttribute('aria-label', `Breakpoint line ${this.bp.line}`);
    return el;
  }
}

const breakpointField = StateField.define<RangeSet<GutterMarker>>({
  create() {
    return RangeSet.empty;
  },
  update(markers, tr) {
    markers = markers.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setBreakpointMarkers)) {
        const doc = tr.state.doc;
        const ranges: Range<GutterMarker>[] = [];
        for (const bp of e.value) {
          if (bp.line < 1 || bp.line > doc.lines) continue;
          const line = doc.line(bp.line);
          ranges.push(new BreakpointMarker(bp).range(line.from));
        }
        markers = RangeSet.of(ranges, true);
      }
    }
    return markers;
  },
});

/**
 * Build the extension for one open file. The filePath identifies which
 * breakpoints in the store this instance is responsible for — when the
 * store changes for that path, we rebuild the marker set.
 */
export function breakpointGutterExtension(filePath: string): Extension {
  const plugin = ViewPlugin.define((view) => {
    // Seed markers from the store on creation.
    view.dispatch({
      effects: setBreakpointMarkers.of(breakpointsStore.forFile(filePath)),
    });

    const unsubscribe = breakpointsStore.subscribe((path, bps) => {
      // Empty path is the 'clear all' signal — always relevant.
      if (path !== '' && path !== filePath) return;
      const newBps = path === '' ? [] : bps;
      view.dispatch({ effects: setBreakpointMarkers.of(newBps) });
    });

    return {
      update(_update: ViewUpdate) {
        // No-op: store subscription handles external updates.
      },
      destroy() {
        unsubscribe();
      },
    };
  });

  const bpGutter = gutter({
    class: 'cm-breakpoint-gutter',
    markers: (view) => view.state.field(breakpointField, false) ?? RangeSet.empty,
    domEventHandlers: {
      /**
       * Empty-gutter click → toggle breakpoint.
       * Clicks on the marker DOM are dispatched here too (CM6 bubbles them),
       * so toggle-semantics cover both add and remove with one handler.
       */
      mousedown(view, line) {
        const lineNum = view.state.doc.lineAt(line.from).number;
        breakpointsStore.toggle(filePath, lineNum);
        // If a session is running, push the updated list to the adapter.
        void dapStore.pushBreakpointsFor(filePath);
        return true;
      },
    },
  });

  return [breakpointField, plugin, bpGutter];
}
