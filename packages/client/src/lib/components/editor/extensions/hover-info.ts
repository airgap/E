import { hoverTooltip, type Tooltip } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { symbolStore } from '$lib/stores/symbols.svelte';
import type { Symbol } from '$lib/workers/treesitter-worker';
import { highlightCode, tagHighlighter, tags as lzTags } from '@lezer/highlight';

/**
 * CM6 extension: Tree-sitter + syntax-aware hover (standalone, no LSP).
 * Used directly when you only want the tree-sitter path without LSP.
 * For normal use, `lspHoverExtension` in lsp-hover.ts calls
 * `buildTreeSitterTooltip` as its fallback.
 */
export function hoverInfoExtension(fileId: string) {
  return hoverTooltip((view, pos) => buildTreeSitterTooltip(view, pos, fileId), { hoverTime: 300 });
}

/**
 * Core tree-sitter hover logic — exported so lsp-hover.ts can use it
 * as a fallback when LSP returns nothing.
 */
export async function buildTreeSitterTooltip(
  view: import('@codemirror/view').EditorView,
  pos: number,
  fileId: string,
): Promise<Tooltip | null> {
  const line = view.state.doc.lineAt(pos);
  const lineText = line.text;
  const col = pos - line.from;

  // ── Expand to word boundary (includes $ for runes) ─────────────────────
  let start = col;
  let end = col;
  while (start > 0 && /[\w$]/.test(lineText[start - 1])) start--;
  while (end < lineText.length && /[\w$]/.test(lineText[end])) end++;

  const word = lineText.slice(start, end);
  const wordFrom = line.from + start;
  const wordTo = line.from + end;

  // ── Built-in knowledge base (Svelte runes, JS globals) ─────────────────
  const builtin = BUILTINS[word] ?? null;
  if (builtin) {
    return {
      pos: wordFrom,
      end: wordTo,
      above: true,
      create() {
        return { dom: buildBuiltinCard(builtin) };
      },
    };
  }

  // ── Syntax tree context ────────────────────────────────────────────────
  const tree = syntaxTree(view.state);
  const node = tree.resolveInner(pos, 1);
  const nodeType = node.type.name;
  const syntaxInfo = classifySyntaxNode(nodeType, word);

  // ── Symbol lookup ──────────────────────────────────────────────────────
  const symbols = symbolStore.getSymbols(fileId);
  const sym = word ? findSymbolByName(symbols, word) : null;

  // Debug: log what we found
  if (word && word.length > 2) {
    console.debug(
      '[hover-info] word=%o fileId=%o symCount=%d sym=%o nodeType=%o',
      word,
      fileId,
      symbols.length,
      sym?.name ?? null,
      nodeType,
    );
  }

  // Show tooltip if:
  //   • we found a symbol definition in the tree-sitter store
  //   • OR we recognised meaningful syntax (keyword, literal, type, etc.)
  // Never show for plain unrecognised identifiers with no symbol match,
  // and never show the bare 'identifier' label when there's no sym.
  const isGenericIdentifier = syntaxInfo?.label === 'identifier';
  if (!sym && (!syntaxInfo || isGenericIdentifier)) return null;

  // ── Extract definition lines from current document ─────────────────────
  let defLines: string[] | null = null;
  let docComment: string | null = null;
  if (sym) {
    defLines = extractDocLines(view, sym.startRow, sym.endRow);
    docComment = extractDocComment(view, sym.startRow);
  }

  return {
    pos: wordFrom,
    end: wordTo,
    above: true,
    create() {
      return { dom: buildFallbackCard(word, sym, syntaxInfo, defLines, docComment) };
    },
  };
}

// ── Source extraction ────────────────────────────────────────────────────────

const MAX_DEF_LINES = 12;

// ── Built-in knowledge base ──────────────────────────────────────────────────

interface BuiltinInfo {
  sig: string; // Type signature / declaration shown in monospace
  doc: string; // Human-readable description
  tags?: string[]; // e.g. ['Svelte 5', 'rune']
  docUrl?: string; // Link to official documentation (MDN, Svelte docs, etc.)
}

/** Known built-in globals: Svelte 5 runes, key JS globals, browser APIs */
const BUILTINS: Record<string, BuiltinInfo> = {
  // ── Svelte 5 runes ────────────────────────────────────────────────────────
  $state: {
    sig: 'function $state<T>(initial?: T): T',
    doc: 'Declares reactive state. When the value changes, the UI updates automatically. Can be used at the top level of a component or inside a class.',
    tags: ['Svelte 5', 'rune'],
    docUrl: 'https://svelte.dev/docs/svelte/$state',
  },
  '$state.raw': {
    sig: 'function $state.raw<T>(initial?: T): T',
    doc: 'Like `$state`, but the value is not made deeply reactive. Mutations to objects/arrays will not be tracked — you must reassign to trigger updates.',
    tags: ['Svelte 5', 'rune'],
    docUrl: 'https://svelte.dev/docs/svelte/$state#$state.raw',
  },
  '$state.snapshot': {
    sig: 'function $state.snapshot<T>(state: T): T',
    doc: "Returns a static (non-reactive) snapshot of a `$state` proxy. Useful for passing state to external functions that don't expect Svelte proxies.",
    tags: ['Svelte 5', 'rune'],
    docUrl: 'https://svelte.dev/docs/svelte/$state#$state.snapshot',
  },
  $derived: {
    sig: 'function $derived<T>(expression: T): T',
    doc: 'Declares a derived value that is recomputed whenever its dependencies change. The expression is re-evaluated lazily.',
    tags: ['Svelte 5', 'rune'],
    docUrl: 'https://svelte.dev/docs/svelte/$derived',
  },
  '$derived.by': {
    sig: 'function $derived.by<T>(fn: () => T): T',
    doc: 'Like `$derived`, but accepts a function body instead of a single expression. Use when the derivation requires multiple statements.',
    tags: ['Svelte 5', 'rune'],
    docUrl: 'https://svelte.dev/docs/svelte/$derived#$derived.by',
  },
  $effect: {
    sig: 'function $effect(fn: () => void | (() => void)): void',
    doc: 'Runs a side effect whenever its reactive dependencies change. Runs after the DOM has updated. Optionally return a cleanup function.',
    tags: ['Svelte 5', 'rune'],
    docUrl: 'https://svelte.dev/docs/svelte/$effect',
  },
  '$effect.pre': {
    sig: 'function $effect.pre(fn: () => void | (() => void)): void',
    doc: 'Like `$effect`, but runs *before* the DOM is updated. Use for reading DOM state before changes are applied.',
    tags: ['Svelte 5', 'rune'],
    docUrl: 'https://svelte.dev/docs/svelte/$effect#$effect.pre',
  },
  '$effect.tracking': {
    sig: 'function $effect.tracking(): boolean',
    doc: 'Returns `true` if called inside a reactive context (an effect or derived). Useful for conditional tracking logic.',
    tags: ['Svelte 5', 'rune'],
    docUrl: 'https://svelte.dev/docs/svelte/$effect#$effect.tracking',
  },
  '$effect.root': {
    sig: 'function $effect.root(fn: () => void | (() => void)): () => void',
    doc: "Creates a non-tracked scope that won't be auto-destroyed. Returns a function to manually destroy it. Useful for advanced effect management.",
    tags: ['Svelte 5', 'rune'],
    docUrl: 'https://svelte.dev/docs/svelte/$effect#$effect.root',
  },
  $props: {
    sig: 'function $props<T extends Record<string, any>>(): T',
    doc: 'Declares component props. Destructure the returned object to access individual props with optional defaults.',
    tags: ['Svelte 5', 'rune'],
    docUrl: 'https://svelte.dev/docs/svelte/$props',
  },
  $bindable: {
    sig: 'function $bindable<T>(fallback?: T): T',
    doc: 'Marks a prop as bindable, allowing the parent component to use `bind:propName`. Optionally provide a fallback value.',
    tags: ['Svelte 5', 'rune'],
    docUrl: 'https://svelte.dev/docs/svelte/$bindable',
  },
  $inspect: {
    sig: 'function $inspect<T>(...values: T[]): { with(fn: (...values: T[]) => void): void }',
    doc: 'Development-only rune that logs reactive values whenever they change. Equivalent to a `$effect` that calls `console.log`. Stripped in production.',
    tags: ['Svelte 5', 'rune', 'dev only'],
    docUrl: 'https://svelte.dev/docs/svelte/$inspect',
  },
  $host: {
    sig: 'function $host<El extends Element = Element>(): El',
    doc: 'Returns the host element when a Svelte component is compiled as a custom element. Only available inside custom element components.',
    tags: ['Svelte 5', 'rune'],
    docUrl: 'https://svelte.dev/docs/svelte/$host',
  },

  // ── Svelte lifecycle / utilities (Svelte 4 & 5 compat) ───────────────────
  onMount: {
    sig: 'function onMount(fn: () => void | (() => void)): void',
    doc: 'Runs after the component is first rendered to the DOM. Optionally return a cleanup function called on destroy. Does not run during SSR.',
    tags: ['Svelte'],
    docUrl: 'https://svelte.dev/docs/svelte/svelte#onMount',
  },
  onDestroy: {
    sig: 'function onDestroy(fn: () => void): void',
    doc: 'Registers a callback that runs when the component is destroyed. Runs on both client and server.',
    tags: ['Svelte'],
    docUrl: 'https://svelte.dev/docs/svelte/svelte#onDestroy',
  },
  beforeUpdate: {
    sig: 'function beforeUpdate(fn: () => void): void',
    doc: 'Runs before the component updates after state changes. Deprecated in Svelte 5 — use `$effect.pre` instead.',
    tags: ['Svelte', 'deprecated in Svelte 5'],
    docUrl: 'https://svelte.dev/docs/svelte/svelte#beforeUpdate',
  },
  afterUpdate: {
    sig: 'function afterUpdate(fn: () => void): void',
    doc: 'Runs after the component updates. Deprecated in Svelte 5 — use `$effect` instead.',
    tags: ['Svelte', 'deprecated in Svelte 5'],
    docUrl: 'https://svelte.dev/docs/svelte/svelte#afterUpdate',
  },
  tick: {
    sig: 'function tick(): Promise<void>',
    doc: 'Returns a promise that resolves after pending state changes have been applied to the DOM. Use when you need to read updated DOM layout.',
    tags: ['Svelte'],
    docUrl: 'https://svelte.dev/docs/svelte/svelte#tick',
  },
  createEventDispatcher: {
    sig: 'function createEventDispatcher<EventMap>(): EventDispatcher<EventMap>',
    doc: 'Creates a function for dispatching component events. Deprecated in Svelte 5 — use callback props instead.',
    tags: ['Svelte', 'deprecated in Svelte 5'],
    docUrl: 'https://svelte.dev/docs/svelte/svelte#createEventDispatcher',
  },
  getContext: {
    sig: 'function getContext<T>(key: unknown): T',
    doc: 'Retrieves a value set with `setContext` from the nearest ancestor component that provided it.',
    tags: ['Svelte'],
    docUrl: 'https://svelte.dev/docs/svelte/svelte#getContext',
  },
  setContext: {
    sig: 'function setContext<T>(key: unknown, context: T): T',
    doc: 'Associates a value with a context key during component initialisation. Available to all descendants via `getContext`.',
    tags: ['Svelte'],
    docUrl: 'https://svelte.dev/docs/svelte/svelte#setContext',
  },
  hasContext: {
    sig: 'function hasContext(key: unknown): boolean',
    doc: 'Returns `true` if a context value has been set for the given key in a parent component.',
    tags: ['Svelte'],
    docUrl: 'https://svelte.dev/docs/svelte/svelte#hasContext',
  },
  getAllContexts: {
    sig: 'function getAllContexts<T extends Map<any, any>>(): T',
    doc: 'Returns the full context map. Useful when programmatically passing all contexts to a child component.',
    tags: ['Svelte'],
    docUrl: 'https://svelte.dev/docs/svelte/svelte#getAllContexts',
  },

  // ── TypeScript / JS builtins worth documenting ────────────────────────────
  console: {
    sig: 'namespace console',
    doc: "Provides access to the browser's debugging console. Key methods: `log`, `warn`, `error`, `info`, `table`, `time`, `timeEnd`, `group`, `groupEnd`.",
    tags: ['Browser API'],
    docUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/console',
  },
  Promise: {
    sig: 'interface Promise<T>',
    doc: 'Represents the eventual completion or failure of an asynchronous operation. Use `.then()`, `.catch()`, `.finally()`, or `await`.',
    tags: ['JavaScript'],
    docUrl:
      'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise',
  },
  fetch: {
    sig: 'function fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>',
    doc: 'Starts a network request and returns a Promise that resolves to a `Response`. Use `response.json()`, `.text()`, or `.blob()` to read the body.',
    tags: ['Browser API'],
    docUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Window/fetch',
  },
  setTimeout: {
    sig: 'function setTimeout(fn: () => void, delay?: number): number',
    doc: 'Calls a function after a specified delay in milliseconds. Returns a timer ID that can be passed to `clearTimeout` to cancel it.',
    tags: ['Browser API'],
    docUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/setTimeout',
  },
  clearTimeout: {
    sig: 'function clearTimeout(id?: number): void',
    doc: 'Cancels a timeout created with `setTimeout`.',
    tags: ['Browser API'],
    docUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/clearTimeout',
  },
  setInterval: {
    sig: 'function setInterval(fn: () => void, delay?: number): number',
    doc: 'Repeatedly calls a function at the specified interval (in milliseconds). Returns an ID for `clearInterval`.',
    tags: ['Browser API'],
    docUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/setInterval',
  },
  clearInterval: {
    sig: 'function clearInterval(id?: number): void',
    doc: 'Cancels a repeating timer created with `setInterval`.',
    tags: ['Browser API'],
    docUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/clearInterval',
  },
  requestAnimationFrame: {
    sig: 'function requestAnimationFrame(callback: FrameRequestCallback): number',
    doc: 'Schedules a function to be called before the next repaint. Returns an ID for `cancelAnimationFrame`. Ideal for smooth animations.',
    tags: ['Browser API'],
    docUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame',
  },
  JSON: {
    sig: 'namespace JSON',
    doc: 'Utilities for JSON serialization and parsing. Key methods: `JSON.parse(text)`, `JSON.stringify(value, replacer?, space?)`.',
    tags: ['JavaScript'],
    docUrl: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON',
  },
  Math: {
    sig: 'namespace Math',
    doc: 'Math utilities. Key: `Math.floor`, `Math.ceil`, `Math.round`, `Math.abs`, `Math.max`, `Math.min`, `Math.random`, `Math.sqrt`, `Math.PI`.',
    tags: ['JavaScript'],
    docUrl: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math',
  },
  Object: {
    sig: 'namespace Object',
    doc: 'Object utilities. Key: `Object.keys`, `Object.values`, `Object.entries`, `Object.assign`, `Object.freeze`, `Object.fromEntries`.',
    tags: ['JavaScript'],
    docUrl:
      'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object',
  },
  Array: {
    sig: 'namespace Array',
    doc: 'Array utilities. Key: `Array.isArray(val)`, `Array.from(iterable)`, `Array.of(...items)`.',
    tags: ['JavaScript'],
    docUrl:
      'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array',
  },
  Map: {
    sig: 'class Map<K, V>',
    doc: 'A keyed collection. Unlike plain objects, keys can be of any type. Key methods: `set`, `get`, `has`, `delete`, `clear`, `forEach`, `entries`.',
    tags: ['JavaScript'],
    docUrl: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map',
  },
  Set: {
    sig: 'class Set<T>',
    doc: 'A collection of unique values. Key methods: `add`, `has`, `delete`, `clear`, `forEach`. Preserves insertion order.',
    tags: ['JavaScript'],
    docUrl: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Set',
  },
  WeakMap: {
    sig: 'class WeakMap<K extends object, V>',
    doc: 'Like `Map` but keys are held weakly — no memory leak if key is garbage collected. Keys must be objects.',
    tags: ['JavaScript'],
    docUrl:
      'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/WeakMap',
  },
  WeakSet: {
    sig: 'class WeakSet<T extends object>',
    doc: 'Like `Set` but values are held weakly. Useful for tracking objects without preventing garbage collection.',
    tags: ['JavaScript'],
    docUrl:
      'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/WeakSet',
  },
  Symbol: {
    sig: 'function Symbol(description?: string | number): symbol',
    doc: 'Creates a unique, immutable primitive value. Often used as object keys to avoid name collisions.',
    tags: ['JavaScript'],
    docUrl:
      'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Symbol',
  },
  Proxy: {
    sig: 'class Proxy<T extends object>',
    doc: "Wraps an object and intercepts operations (get, set, delete, etc.) via a handler. Used internally by Svelte's `$state` for deep reactivity.",
    tags: ['JavaScript'],
    docUrl:
      'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy',
  },
  structuredClone: {
    sig: 'function structuredClone<T>(value: T, options?: { transfer?: Transferable[] }): T',
    doc: 'Creates a deep clone of a value using the structured clone algorithm. Handles cycles, typed arrays, Maps, Sets, and more.',
    tags: ['Browser API'],
    docUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Window/structuredClone',
  },
  crypto: {
    sig: 'namespace crypto',
    doc: 'Web Crypto API. Key: `crypto.randomUUID()`, `crypto.getRandomValues(array)`, `crypto.subtle` for hashing/encryption.',
    tags: ['Browser API'],
    docUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Crypto',
  },
  localStorage: {
    sig: 'interface Storage (localStorage)',
    doc: 'Persistent key-value storage scoped to the origin. Key methods: `getItem`, `setItem`, `removeItem`, `clear`. Synchronous. Max ~5 MB.',
    tags: ['Browser API'],
    docUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage',
  },
  sessionStorage: {
    sig: 'interface Storage (sessionStorage)',
    doc: 'Like `localStorage` but data is cleared when the browser session ends (tab closed).',
    tags: ['Browser API'],
    docUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage',
  },
  // ── Additional JS/TS builtins ─────────────────────────────────────────────
  Date: {
    sig: 'class Date',
    doc: 'Represents a single moment in time. Key: `Date.now()`, `new Date()`, `.toISOString()`, `.getTime()`. For complex date operations, consider a library.',
    tags: ['JavaScript'],
    docUrl: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date',
  },
  RegExp: {
    sig: 'class RegExp',
    doc: 'Creates a regular expression for pattern matching. Use `/pattern/flags` literal syntax or `new RegExp(pattern, flags)`. Key methods: `.test()`, `.exec()`.',
    tags: ['JavaScript'],
    docUrl:
      'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp',
  },
  Error: {
    sig: 'class Error',
    doc: 'Base class for runtime errors. Subclasses: `TypeError`, `RangeError`, `ReferenceError`, `SyntaxError`. Has `message`, `stack`, and `name` properties.',
    tags: ['JavaScript'],
    docUrl:
      'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error',
  },
  parseInt: {
    sig: 'function parseInt(string: string, radix?: number): number',
    doc: 'Parses a string and returns an integer of the specified radix. Always specify the radix (e.g., `parseInt(str, 10)`) to avoid octal parsing.',
    tags: ['JavaScript'],
    docUrl:
      'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/parseInt',
  },
  parseFloat: {
    sig: 'function parseFloat(string: string): number',
    doc: 'Parses a string and returns a floating-point number. Returns `NaN` if the string cannot be parsed.',
    tags: ['JavaScript'],
    docUrl:
      'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/parseFloat',
  },
  isNaN: {
    sig: 'function isNaN(value: number): boolean',
    doc: 'Returns `true` if the value is `NaN`. Prefer `Number.isNaN()` which does not coerce the value.',
    tags: ['JavaScript'],
    docUrl:
      'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/isNaN',
  },
  isFinite: {
    sig: 'function isFinite(value: number): boolean',
    doc: 'Returns `true` if the value is a finite number (not `Infinity`, `-Infinity`, or `NaN`).',
    tags: ['JavaScript'],
    docUrl:
      'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/isFinite',
  },
  encodeURIComponent: {
    sig: 'function encodeURIComponent(component: string): string',
    doc: 'Encodes a URI component by escaping special characters. Use for query parameters and path segments.',
    tags: ['JavaScript'],
    docUrl:
      'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/encodeURIComponent',
  },
  decodeURIComponent: {
    sig: 'function decodeURIComponent(encoded: string): string',
    doc: 'Decodes a URI component previously encoded with `encodeURIComponent`.',
    tags: ['JavaScript'],
    docUrl:
      'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/decodeURIComponent',
  },
  atob: {
    sig: 'function atob(data: string): string',
    doc: 'Decodes a base64-encoded string. The inverse of `btoa()`. Returns a binary string.',
    tags: ['Browser API'],
    docUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/atob',
  },
  btoa: {
    sig: 'function btoa(data: string): string',
    doc: 'Encodes a binary string to base64. The inverse of `atob()`. Input must be a binary string (each char code 0-255).',
    tags: ['Browser API'],
    docUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/btoa',
  },
  AbortController: {
    sig: 'class AbortController',
    doc: 'Creates an `AbortSignal` used to cancel fetch requests and other async operations. Call `.abort()` to trigger cancellation.',
    tags: ['Browser API'],
    docUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/AbortController',
  },
  EventTarget: {
    sig: 'class EventTarget',
    doc: 'Base class for objects that can receive events. Key methods: `addEventListener()`, `removeEventListener()`, `dispatchEvent()`.',
    tags: ['Browser API'],
    docUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/EventTarget',
  },
  URL: {
    sig: 'class URL',
    doc: 'Parses and manipulates URLs. Properties: `href`, `origin`, `protocol`, `hostname`, `pathname`, `search`, `hash`, `searchParams`.',
    tags: ['Browser API'],
    docUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/URL',
  },
  URLSearchParams: {
    sig: 'class URLSearchParams',
    doc: 'Utility for working with query strings. Key methods: `get()`, `set()`, `append()`, `delete()`, `has()`, `toString()`, iterable.',
    tags: ['Browser API'],
    docUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams',
  },
  Response: {
    sig: 'class Response',
    doc: 'Represents a fetch response. Key: `.ok`, `.status`, `.headers`, `.json()`, `.text()`, `.blob()`, `.arrayBuffer()`, `.clone()`.',
    tags: ['Browser API'],
    docUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Response',
  },
  Request: {
    sig: 'class Request',
    doc: 'Represents a fetch request. Construct with URL and options (`method`, `headers`, `body`). Can be passed directly to `fetch()`.',
    tags: ['Browser API'],
    docUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Request',
  },
  Headers: {
    sig: 'class Headers',
    doc: 'Represents HTTP headers. Key methods: `get()`, `set()`, `append()`, `has()`, `delete()`, `forEach()`. Case-insensitive keys.',
    tags: ['Browser API'],
    docUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Headers',
  },
  FormData: {
    sig: 'class FormData',
    doc: 'Represents form data for `multipart/form-data` submissions. Key methods: `append()`, `get()`, `set()`, `delete()`, `has()`, `entries()`.',
    tags: ['Browser API'],
    docUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/FormData',
  },
  TextEncoder: {
    sig: 'class TextEncoder',
    doc: 'Encodes strings into `Uint8Array` using UTF-8. Key method: `.encode(string)`. Useful for binary/stream operations.',
    tags: ['Browser API'],
    docUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/TextEncoder',
  },
  TextDecoder: {
    sig: 'class TextDecoder',
    doc: 'Decodes `Uint8Array` (or other buffer sources) into strings. Constructor accepts encoding (default UTF-8). Key method: `.decode(buffer)`.',
    tags: ['Browser API'],
    docUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder',
  },
  WebSocket: {
    sig: 'class WebSocket',
    doc: 'Opens a persistent connection to a server for full-duplex communication. Events: `open`, `message`, `close`, `error`. Methods: `send()`, `close()`.',
    tags: ['Browser API'],
    docUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/WebSocket',
  },
  Worker: {
    sig: 'class Worker',
    doc: 'Runs JavaScript in a background thread. Communicate via `postMessage()` and `onmessage`. Use for CPU-intensive tasks off the main thread.',
    tags: ['Browser API'],
    docUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Worker',
  },
  IntersectionObserver: {
    sig: 'class IntersectionObserver',
    doc: 'Observes when elements enter/leave the viewport (or a parent container). Ideal for lazy loading, infinite scroll, and visibility tracking.',
    tags: ['Browser API'],
    docUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/IntersectionObserver',
  },
  MutationObserver: {
    sig: 'class MutationObserver',
    doc: 'Observes DOM tree changes (child additions/removals, attribute changes, text changes). Call `.observe(target, options)` to start.',
    tags: ['Browser API'],
    docUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver',
  },
  ResizeObserver: {
    sig: 'class ResizeObserver',
    doc: 'Reports changes to element dimensions. More efficient than `resize` events. Callback receives `ResizeObserverEntry` with `contentRect`.',
    tags: ['Browser API'],
    docUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver',
  },
  queueMicrotask: {
    sig: 'function queueMicrotask(callback: () => void): void',
    doc: 'Queues a microtask to execute after the current task completes but before rendering. Runs before `setTimeout` callbacks.',
    tags: ['Browser API'],
    docUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Window/queueMicrotask',
  },
  // ── Node.js / Bun builtins ────────────────────────────────────────────────
  Buffer: {
    sig: 'class Buffer extends Uint8Array',
    doc: 'Node.js binary data type. Key: `Buffer.from()`, `Buffer.alloc()`, `.toString()`, `.slice()`. In Bun, also available globally.',
    tags: ['Node.js'],
    docUrl: 'https://nodejs.org/api/buffer.html',
  },
  process: {
    sig: 'namespace process',
    doc: 'Node.js process info and control. Key: `process.env`, `process.argv`, `process.cwd()`, `process.exit()`, `process.stdout`.',
    tags: ['Node.js'],
    docUrl: 'https://nodejs.org/api/process.html',
  },
  require: {
    sig: 'function require(id: string): any',
    doc: 'CommonJS module loader. Synchronously loads a module by path or package name. Prefer ES `import` for new code.',
    tags: ['Node.js'],
    docUrl: 'https://nodejs.org/api/modules.html#requireid',
  },
};

function buildBuiltinCard(info: BuiltinInfo): HTMLElement {
  const card = document.createElement('div');
  card.className = 'e-hover-card';

  // Tags (e.g. "Svelte 5 · rune")
  if (info.tags?.length) {
    const tagRow = document.createElement('div');
    tagRow.className = 'e-hover-tags';
    tagRow.textContent = info.tags.join(' · ');
    card.appendChild(tagRow);
  }

  // Signature
  const sigSection = document.createElement('div');
  sigSection.className = 'e-hover-sig';
  const pre = document.createElement('pre');
  pre.className = 'e-hover-pre';
  pre.textContent = info.sig;
  sigSection.appendChild(pre);
  card.appendChild(sigSection);

  // Doc
  const sep = document.createElement('div');
  sep.className = 'e-hover-sep';
  card.appendChild(sep);

  const docSection = document.createElement('div');
  docSection.className = 'e-hover-docs';
  const p = document.createElement('p');
  p.className = 'e-hover-doc-para';
  // Render inline backtick code
  p.innerHTML = info.doc
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/`([^`]+)`/g, '<code class="e-hover-inline-code">$1</code>');
  docSection.appendChild(p);
  card.appendChild(docSection);

  // Documentation link
  if (info.docUrl) {
    card.appendChild(buildDocLinkSection(info.docUrl));
  }

  return card;
}

/**
 * Build a documentation link footer section for the hover card.
 * Shows a clickable link to official docs (MDN, Svelte, Node.js, etc).
 */
function buildDocLinkSection(url: string): HTMLElement {
  const section = document.createElement('div');
  section.className = 'e-hover-doc-link';

  const icon = document.createElement('span');
  icon.className = 'e-hover-doc-link-icon';
  icon.textContent = '⬡';
  section.appendChild(icon);

  const link = document.createElement('a');
  link.className = 'e-hover-doc-link-anchor';
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';

  // Extract a readable label from the URL
  const label = getDocLabel(url);
  link.textContent = label;
  section.appendChild(link);

  const arrow = document.createElement('span');
  arrow.className = 'e-hover-doc-link-arrow';
  arrow.textContent = '→';
  section.appendChild(arrow);

  return section;
}

/**
 * Extract a human-readable label from a documentation URL.
 */
function getDocLabel(url: string): string {
  if (url.includes('developer.mozilla.org')) return 'MDN Documentation';
  if (url.includes('svelte.dev')) return 'Svelte Documentation';
  if (url.includes('nodejs.org')) return 'Node.js Documentation';
  if (url.includes('typescriptlang.org')) return 'TypeScript Documentation';
  if (url.includes('bun.sh')) return 'Bun Documentation';
  if (url.includes('react.dev')) return 'React Documentation';
  if (url.includes('vuejs.org')) return 'Vue Documentation';
  if (url.includes('angular.dev') || url.includes('angular.io')) return 'Angular Documentation';
  if (url.includes('deno.land') || url.includes('deno.com')) return 'Deno Documentation';
  if (url.includes('docs.python.org')) return 'Python Documentation';
  if (url.includes('doc.rust-lang.org')) return 'Rust Documentation';
  if (url.includes('pkg.go.dev') || url.includes('go.dev')) return 'Go Documentation';
  return 'Documentation';
}

/**
 * Extract JSDoc / doc-comment block immediately preceding a symbol definition.
 * Scans backward from the symbol's start line looking for a contiguous comment block.
 * Returns the cleaned comment text (without * / // prefixes), or null if no doc found.
 */
export function extractDocComment(
  view: { state: { doc: any } },
  symbolStartRow: number,
): string | null {
  const doc = view.state.doc;
  const lineCount = doc.lines;

  // symbolStartRow is 0-indexed, doc.line() is 1-indexed
  const symLine = symbolStartRow + 1;
  if (symLine < 2 || symLine > lineCount) return null;

  const commentLines: string[] = [];
  let i = symLine - 1; // Start from line above the symbol

  // Walk upward collecting comment lines
  // Handle multi-line JSDoc: /** ... */
  // Handle single-line comments: // or ///
  while (i >= 1) {
    const text = doc.line(i).text.trim();

    if (text === '*/') {
      // Start of a block comment ending — walk up to find /**
      i--;
      while (i >= 1) {
        const inner = doc.line(i).text;
        const trimmed = inner.trim();

        if (trimmed.startsWith('/**') || trimmed.startsWith('/*')) {
          // Opening of block comment — extract the content after /** or /*
          const afterOpen = trimmed
            .replace(/^\/\*\*?\s?/, '')
            .replace(/\*\/$/, '')
            .trim();
          if (afterOpen) commentLines.unshift(afterOpen);
          break;
        } else {
          // Middle of block comment — strip leading *
          const cleaned = trimmed.replace(/^\*\s?/, '');
          commentLines.unshift(cleaned);
        }
        i--;
      }
      break;
    } else if (text.startsWith('/**') && text.endsWith('*/')) {
      // Single-line JSDoc: /** description */
      const content = text.slice(3, -2).trim();
      if (content) commentLines.unshift(content);
      break;
    } else if (text.startsWith('//')) {
      // Single-line comment (// or ///)
      const cleaned = text.replace(/^\/\/\/?\s?/, '');
      commentLines.unshift(cleaned);
      i--;
    } else if (text === '' || text.startsWith('@')) {
      // Skip blank lines and decorators above the comment
      if (commentLines.length > 0) break;
      i--;
    } else {
      // Non-comment line — stop
      break;
    }
  }

  if (commentLines.length === 0) return null;

  // Parse out @param, @returns, @example etc. as structured documentation
  const mainDoc: string[] = [];
  const params: string[] = [];
  const returns: string[] = [];
  const examples: string[] = [];
  let inExample = false;

  for (const line of commentLines) {
    if (line.startsWith('@param')) {
      inExample = false;
      const content = line.replace(/^@param\s+\{[^}]*\}\s*/, '').replace(/^@param\s+/, '');
      params.push(content);
    } else if (line.startsWith('@returns') || line.startsWith('@return')) {
      inExample = false;
      const content = line.replace(/^@returns?\s+\{[^}]*\}\s*/, '').replace(/^@returns?\s+/, '');
      returns.push(content);
    } else if (line.startsWith('@example')) {
      inExample = true;
    } else if (line.startsWith('@')) {
      inExample = false;
      // Skip other tags like @deprecated, @see, @since etc. — include them as-is
      mainDoc.push(line);
    } else if (inExample) {
      examples.push(line);
    } else {
      mainDoc.push(line);
    }
  }

  // Assemble final doc string
  const parts: string[] = [];
  const mainText = mainDoc.join(' ').trim();
  if (mainText) parts.push(mainText);
  if (params.length > 0) {
    parts.push('**Params:** ' + params.map((p) => '`' + p + '`').join(', '));
  }
  if (returns.length > 0) {
    parts.push('**Returns:** ' + returns.join(' '));
  }
  if (examples.length > 0) {
    parts.push('**Example:** `' + examples.join(' ').trim() + '`');
  }

  return parts.join('\n\n') || null;
}

function extractDocLines(
  view: { state: { doc: any } },
  startRow: number,
  endRow: number,
): string[] {
  const doc = view.state.doc;
  const lineCount = doc.lines;

  // Clamp
  const from = Math.max(1, startRow + 1);
  const to = Math.min(lineCount, Math.min(endRow + 2, from + MAX_DEF_LINES - 1));

  const lines: string[] = [];
  for (let i = from; i <= to; i++) {
    lines.push(doc.line(i).text);
  }

  // Trim common leading indent
  const indent = lines.reduce((min, l) => {
    if (!l.trim()) return min;
    const m = l.match(/^(\s*)/);
    return m ? Math.min(min, m[1].length) : min;
  }, Infinity);

  return lines.map((l) => l.slice(indent === Infinity ? 0 : indent));
}

// ── Syntax classification ────────────────────────────────────────────────────

interface SyntaxInfo {
  label: string;
  color: string;
  extras?: string[];
}

const JS_KEYWORDS = new Set([
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'export',
  'extends',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'let',
  'new',
  'of',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
  'abstract',
  'as',
  'declare',
  'enum',
  'from',
  'implements',
  'interface',
  'is',
  'keyof',
  'module',
  'namespace',
  'never',
  'override',
  'private',
  'protected',
  'public',
  'readonly',
  'require',
  'satisfies',
  'type',
  'unique',
  'unknown',
]);

function classifySyntaxNode(nodeType: string, word: string): SyntaxInfo | null {
  if (/String|TemplateLiteral|TaggedTemplate/i.test(nodeType))
    return { label: 'string literal', color: 'var(--syn-string)' };
  if (/Number|Integer|Float|Decimal/i.test(nodeType)) return buildNumericInfo(word);
  if (/Boolean|True|False/i.test(nodeType) || word === 'true' || word === 'false')
    return { label: 'boolean', color: 'var(--syn-keyword)' };
  if (/Null|Undefined/i.test(nodeType) || word === 'null' || word === 'undefined')
    return { label: word, color: 'var(--syn-keyword)' };
  if (/Keyword/i.test(nodeType) || JS_KEYWORDS.has(word))
    return { label: 'keyword', color: 'var(--syn-keyword)' };
  if (/Comment/i.test(nodeType)) return { label: 'comment', color: 'var(--text-tertiary)' };
  if (/Regex|RegExp/i.test(nodeType))
    return { label: 'regular expression', color: 'var(--syn-string)' };
  if (/Property|MemberExpression|Attribute/i.test(nodeType))
    return { label: 'property', color: 'var(--syn-property, var(--syn-variable))' };
  if (/TypeName|TypeReference|TypeAnnotation|TypeAlias|TypeParam/i.test(nodeType))
    return { label: 'type', color: 'var(--syn-type)' };
  if (/CallExpression/i.test(nodeType))
    return { label: 'function call', color: 'var(--syn-function)' };
  // VariableName and other identifier-like nodes: return a sentinel so we can
  // still show a tooltip when we find a matching symbol in the tree-sitter store.
  // Without this, buildTreeSitterTooltip returns null when sym !== null but
  // syntaxInfo === null (i.e. the lezer node is a plain identifier reference).
  if (/VariableName|Identifier/i.test(nodeType))
    return { label: 'identifier', color: 'var(--text-secondary)' };
  return null;
}

function buildNumericInfo(word: string): SyntaxInfo {
  const extras: string[] = [];
  const n = parseInt(word, 10);
  if (!isNaN(n)) {
    if (!word.startsWith('0x') && !word.startsWith('0b') && !word.startsWith('0o')) {
      extras.push(`hex  0x${n.toString(16).toUpperCase()}`);
      extras.push(`bin  0b${n.toString(2)}`);
      extras.push(`oct  0o${n.toString(8)}`);
    } else if (word.startsWith('0x')) {
      const v = parseInt(word, 16);
      extras.push(`dec  ${v}`);
      extras.push(`bin  0b${v.toString(2)}`);
    } else if (word.startsWith('0b')) {
      const v = parseInt(word.slice(2), 2);
      extras.push(`dec  ${v}`);
      extras.push(`hex  0x${v.toString(16).toUpperCase()}`);
    } else if (word.startsWith('0o')) {
      const v = parseInt(word.slice(2), 8);
      extras.push(`dec  ${v}`);
      extras.push(`hex  0x${v.toString(16).toUpperCase()}`);
    }
  }
  return { label: 'number', color: 'var(--syn-number, var(--syn-string))', extras };
}

// ── Symbol lookup ────────────────────────────────────────────────────────────

function findSymbolByName(symbols: Symbol[], name: string): Symbol | null {
  for (const sym of symbols) {
    if (sym.name === name) return sym;
    if (sym.children) {
      const found = findSymbolByName(sym.children, name);
      if (found) return found;
    }
  }
  return null;
}

// ── Card builder ─────────────────────────────────────────────────────────────

function buildFallbackCard(
  word: string,
  sym: Symbol | null,
  syntaxInfo: SyntaxInfo | null,
  defLines: string[] | null,
  docComment: string | null = null,
): HTMLElement {
  const card = document.createElement('div');
  card.className = 'e-hover-card';

  // — Signature: symbol kind+name or syntax label
  const sigSection = document.createElement('div');
  sigSection.className = 'e-hover-sig';
  const pre = document.createElement('pre');
  pre.className = 'e-hover-pre';

  if (sym) {
    const kindSpan = document.createElement('span');
    kindSpan.style.cssText = 'color: var(--syn-keyword); margin-right: 8px; font-weight: 600;';
    kindSpan.textContent = sym.kind;

    const nameSpan = document.createElement('span');
    nameSpan.style.cssText = 'color: var(--syn-function);';
    nameSpan.textContent = sym.name;

    pre.appendChild(kindSpan);
    pre.appendChild(nameSpan);
  } else if (syntaxInfo) {
    const labelSpan = document.createElement('span');
    labelSpan.style.cssText = `color: ${syntaxInfo.color}; font-style: italic;`;
    labelSpan.textContent = syntaxInfo.label;
    pre.appendChild(labelSpan);

    if (word && syntaxInfo.label !== word) {
      const wordSpan = document.createElement('span');
      wordSpan.style.cssText = 'color: var(--text-secondary); margin-left: 8px;';
      wordSpan.textContent = word;
      pre.appendChild(wordSpan);
    }
  }

  sigSection.appendChild(pre);
  card.appendChild(sigSection);

  // — JSDoc / doc comment extracted from source
  if (docComment) {
    card.appendChild(makeSep());
    const docSection = document.createElement('div');
    docSection.className = 'e-hover-docs';
    // Split by double newlines to create paragraphs
    const paragraphs = docComment.split('\n\n').filter((p) => p.trim());
    for (const para of paragraphs) {
      const p = document.createElement('p');
      p.className = 'e-hover-doc-para';
      p.innerHTML = simpleDocMarkdown(para.trim());
      docSection.appendChild(p);
    }
    card.appendChild(docSection);
  }

  // — Definition source lines (from current document)
  if (defLines && defLines.length > 0) {
    card.appendChild(makeSep());

    const peekSection = document.createElement('div');
    peekSection.className = 'e-hover-peek';

    const label = document.createElement('div');
    label.className = 'e-hover-peek-label';
    label.innerHTML = `<span class="e-hover-peek-icon">◈</span><span class="e-hover-peek-path">line ${sym!.startRow + 1}</span>`;
    peekSection.appendChild(label);

    const codePre = document.createElement('pre');
    codePre.className = 'e-hover-pre e-hover-peek-code';
    highlightPre(codePre, defLines.join('\n'));
    peekSection.appendChild(codePre);

    card.appendChild(peekSection);
  }

  // — Numeric conversions
  if (syntaxInfo?.extras?.length) {
    card.appendChild(makeSep());

    const docSection = document.createElement('div');
    docSection.className = 'e-hover-docs';
    for (const l of syntaxInfo.extras) {
      const p = document.createElement('p');
      p.className = 'e-hover-doc-para';
      const code = document.createElement('code');
      code.className = 'e-hover-inline-code';
      code.textContent = l;
      p.appendChild(code);
      docSection.appendChild(p);
    }
    card.appendChild(docSection);
  }

  return card;
}

/**
 * Render simple markdown for doc comments — handles bold, italic, inline code, and links.
 */
function simpleDocMarkdown(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code class="e-hover-inline-code">$1</code>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\n/g, ' ');
}

function makeSep(): HTMLElement {
  const sep = document.createElement('div');
  sep.className = 'e-hover-sep';
  return sep;
}

// ── Syntax highlighting for fallback card snippets ───────────────────────────

const FALLBACK_HIGHLIGHTER = tagHighlighter([
  {
    tag: [
      lzTags.keyword,
      lzTags.controlKeyword,
      lzTags.operatorKeyword,
      lzTags.definitionKeyword,
      lzTags.moduleKeyword,
      lzTags.self,
    ],
    class: 'ht-kw',
  },
  { tag: lzTags.string, class: 'ht-str' },
  { tag: lzTags.special(lzTags.string), class: 'ht-str' },
  { tag: lzTags.regexp, class: 'ht-str' },
  { tag: lzTags.number, class: 'ht-num' },
  { tag: lzTags.bool, class: 'ht-num' },
  { tag: lzTags.null, class: 'ht-num' },
  { tag: lzTags.comment, class: 'ht-cmt' },
  { tag: lzTags.lineComment, class: 'ht-cmt' },
  { tag: lzTags.blockComment, class: 'ht-cmt' },
  { tag: lzTags.docComment, class: 'ht-cmt' },
  {
    tag: [lzTags.typeName, lzTags.typeOperator, lzTags.className, lzTags.namespace],
    class: 'ht-typ',
  },
  {
    tag: [lzTags.function(lzTags.variableName), lzTags.function(lzTags.propertyName)],
    class: 'ht-fn',
  },
  { tag: [lzTags.variableName, lzTags.definition(lzTags.variableName)], class: 'ht-var' },
  { tag: [lzTags.propertyName, lzTags.attributeName], class: 'ht-var' },
  { tag: lzTags.operator, class: 'ht-op' },
  { tag: lzTags.punctuation, class: 'ht-pun' },
  { tag: lzTags.tagName, class: 'ht-kw' },
  { tag: lzTags.attributeValue, class: 'ht-str' },
]);

// Eagerly load the TypeScript/JS lezer parser so it's ready synchronously
// by the time the tooltip create() function runs.
let cachedTsParser: any | null = null;
import('@codemirror/lang-javascript')
  .then(({ tsxLanguage }) => {
    cachedTsParser = (tsxLanguage as any).parser ?? null;
  })
  .catch(() => {
    /* ignore */
  });

function highlightPre(pre: HTMLPreElement, code: string): void {
  if (!cachedTsParser) {
    pre.textContent = code;
    return;
  }
  try {
    const tree = cachedTsParser.parse(code);
    let html = '';
    highlightCode(
      code,
      tree,
      FALLBACK_HIGHLIGHTER,
      (text, cls) => {
        html += cls ? `<span class="${cls}">${escHtml(text)}</span>` : escHtml(text);
      },
      () => {
        html += '\n';
      },
    );
    pre.innerHTML = html;
  } catch {
    pre.textContent = code;
  }
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
