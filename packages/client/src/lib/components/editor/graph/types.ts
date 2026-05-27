/**
 * Shared types for the popover DAG feature.
 *
 * Five planned relation kinds (only `import` ships in Phase 1):
 *   - import: module-level import edges (TS/TSX/Svelte/PUI)
 *   - reactive: signal → derived → effect dependencies (.pui / Svelte runes)
 *   - component: component → child-component renders + slot/snippet usage
 *   - call: function-call edges from references / call-hierarchy
 *   - dataflow: intra-function variable read/write dependencies
 *
 * One small graph is built per hover, centered on the symbol/file under
 * the cursor. The provider decides how deep to walk (typically 1-2 hops).
 */

export type RelationKind = 'import' | 'reactive' | 'component' | 'call' | 'dataflow';

/** Optional hint that helps the renderer style different node types. */
export type NodeKind =
  | 'file' // a source file (module-deps provider's primary node type)
  | 'symbol' // a function/class/variable
  | 'component' // a Svelte/PUI component
  | 'signal' // a reactive primitive (signal/derived/$state/$derived)
  | 'effect'
  | 'external'; // an external module (e.g. an npm package)

export interface RelationNode {
  /** Stable identifier within this graph. */
  id: string;
  /** Short text shown in the SVG. */
  label: string;
  kind: NodeKind;
  /** True for the node the cursor is centered on. Renderer emphasises it. */
  center?: boolean;
  /**
   * Where double-clicking the node should jump. For files: an absolute or
   * workspace-relative path. For symbols: file + position. Absent for
   * external/synthetic nodes that can't be navigated to.
   */
  navigate?: { filePath: string; line?: number; column?: number };
  /** Optional tooltip override (defaults to label). */
  title?: string;
}

export interface RelationEdge {
  from: string; // source node id
  to: string; // target node id
  /** Optional edge label rendered near the line midpoint. */
  label?: string;
}

export interface RelationGraph {
  kind: RelationKind;
  /** Brief title for the popover header (e.g. "Module deps · 3 imports, 2 dependents"). */
  title: string;
  nodes: RelationNode[];
  edges: RelationEdge[];
}

/**
 * Context handed to providers. Keeps the provider decoupled from CM6 — just
 * needs the file path, the current document text, and the cursor position.
 */
export interface ProviderContext {
  filePath: string;
  workspacePath: string;
  /** UTF-16 offset into the document at the cursor. */
  pos: number;
  /** Full file contents at the time of hover. */
  doc: string;
  /** 0-indexed line/column at the cursor (for symbol-anchored providers). */
  line: number;
  column: number;
}

export interface RelationProvider {
  /** Stable identifier (also the RelationKind it produces). */
  kind: RelationKind;
  /**
   * Fast pre-check: does this provider have anything useful to say about
   * the cursor position in this file? Should be cheap (sync, no IO).
   */
  supports(ctx: ProviderContext): boolean;
  /**
   * Build the graph. May be async (network/LSP/server calls allowed). The
   * provider is responsible for de-duplicating nodes by id and using
   * stable ids that survive re-fetches (so the renderer can preserve
   * layout across small updates).
   */
  build(ctx: ProviderContext): Promise<RelationGraph | null>;
}
