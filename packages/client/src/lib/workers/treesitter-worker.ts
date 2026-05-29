/**
 * Tree-sitter Web Worker for semantic analysis.
 * Handles parsing, symbol extraction, definition/reference queries.
 * WASM files are loaded from /tree-sitter/ in the static directory.
 */

export interface Symbol {
  name: string;
  kind: 'function' | 'class' | 'method' | 'variable' | 'type' | 'interface' | 'import' | 'property';
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
  children?: Symbol[];
}

export interface Location {
  filePath?: string;
  row: number;
  col: number;
  endRow: number;
  endCol: number;
  text: string;
}

export type WorkerRequest =
  | { type: 'init' }
  | { type: 'parse'; fileId: string; content: string; language: string }
  | { type: 'symbols'; fileId: string }
  | { type: 'definitions'; fileId: string; position: { row: number; col: number } }
  | { type: 'references'; fileId: string; symbolName: string }
  /**
   * LYK-1036: register a plugin-contributed grammar at runtime. `wasmUrl`
   * resolves to a full URL the worker can fetch (already pointing at the
   * plugin asset route). The next parse for `language` picks the plugin
   * grammar up; existing parsers cache by canonical name so plugins
   * shouldn't re-register the same language unless the wasm changed.
   */
  | {
      type: 'registerGrammar';
      language: string;
      wasmUrl: string;
      /** Optional highlights.scm / folds.scm URLs (LYK-1036). */
      highlightsUrl?: string;
      foldsUrl?: string;
    }
  /**
   * LYK-1036: run the registered grammar's highlights (+ folds) queries
   * over `content` and return capture spans. `requestId` correlates the
   * response since highlight requests can overlap.
   */
  | { type: 'highlight'; requestId: number; content: string; language: string };

/** A highlight capture span in document character offsets. */
export interface HighlightSpan {
  from: number;
  to: number;
  /** Capture name from highlights.scm, e.g. "keyword", "string.special". */
  name: string;
}
/** A fold range in document character offsets. */
export interface FoldSpan {
  from: number;
  to: number;
}

export type WorkerResponse =
  | { type: 'ready' }
  | { type: 'parsed'; fileId: string; symbols: Symbol[] }
  | { type: 'definitions'; fileId: string; locations: Location[] }
  | { type: 'references'; fileId: string; locations: Location[] }
  | { type: 'highlights'; requestId: number; spans: HighlightSpan[]; folds: FoldSpan[] }
  | { type: 'error'; message: string };

// We use `any` for tree-sitter types since the module typing is awkward in workers
// web-tree-sitter v0.26+ exports named symbols (Parser, Language) — no default export
let ParserClass: any = null;
let LanguageClass: any = null;
const parsers = new Map<string, any>();
/** Loaded tree-sitter Language objects, keyed by canonical language id.
 *  Needed to compile Query objects (LYK-1036). */
const loadedLanguages = new Map<string, any>();
const trees = new Map<string, any>();
const fileLanguages = new Map<string, string>();
// For Svelte files we only parse the <script> block — track the line offset so
// symbol rows can be mapped back to the original file coordinates
const scriptRowOffsets = new Map<string, number>();

/**
 * Plugin-registered grammars (LYK-1036). Keys are language ids; values
 * are absolute URLs the worker fetches when the language is parsed.
 * Plugin grammars take precedence over built-in ones — manifests can
 * override the host's bundled grammar for the same language id.
 */
const pluginGrammarUrls = new Map<string, string>();
/** highlights.scm / folds.scm source URLs per language (LYK-1036). */
const pluginHighlightUrls = new Map<string, string>();
const pluginFoldUrls = new Map<string, string>();
/** Compiled Query cache per language. `null` = fetched but failed/absent. */
const highlightQueries = new Map<string, any>();
const foldQueries = new Map<string, any>();
/** Cached query source text so re-compiles after a parser reset are cheap. */
const querySourceCache = new Map<string, string>();

/** Fetch + cache a .scm query source. Returns null on any failure. */
async function fetchQuerySource(url: string): Promise<string | null> {
  if (querySourceCache.has(url)) return querySourceCache.get(url)!;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const text = await res.text();
    querySourceCache.set(url, text);
    return text;
  } catch {
    return null;
  }
}

/**
 * Compile (and cache) a Query for `language` from `url`, associated with
 * the language loaded into its parser. Returns null when the grammar,
 * the query file, or compilation is unavailable.
 */
async function getQuery(
  language: string,
  url: string | undefined,
  cache: Map<string, any>,
): Promise<any | null> {
  if (!url) return null;
  if (cache.has(language)) return cache.get(language);
  // Ensure the parser (and thus the Language object) is loaded.
  await getParser(language);
  const canonical = language === 'svelte' ? 'typescript' : language;
  const lang = loadedLanguages.get(canonical) ?? loadedLanguages.get(language) ?? null;
  if (!lang) {
    cache.set(language, null);
    return null;
  }
  const src = await fetchQuerySource(url);
  if (!src) {
    cache.set(language, null);
    return null;
  }
  try {
    const mod = await import('web-tree-sitter');
    const QueryCls: any = (mod as any).Query;
    // web-tree-sitter 0.26 exposes `new Query(language, source)`; older
    // builds expose `language.query(source)`. Prefer the class.
    const q = QueryCls
      ? new QueryCls(lang, src)
      : typeof lang.query === 'function'
        ? lang.query(src)
        : null;
    cache.set(language, q);
    return q;
  } catch (err) {
    console.warn(`[treesitter] failed to compile query for ${language}:`, err);
    cache.set(language, null);
    return null;
  }
}

// Language name -> grammar WASM path mapping
const grammarFiles: Record<string, string> = {
  javascript: 'tree-sitter-javascript.wasm',
  typescript: 'tree-sitter-typescript.wasm',
  // Svelte files are parsed as TypeScript (covers <script lang="ts"> blocks)
  svelte: 'tree-sitter-typescript.wasm',
  python: 'tree-sitter-python.wasm',
  rust: 'tree-sitter-rust.wasm',
  cpp: 'tree-sitter-cpp.wasm',
  c: 'tree-sitter-c.wasm',
  java: 'tree-sitter-java.wasm',
  go: 'tree-sitter-go.wasm',
  html: 'tree-sitter-html.wasm',
  css: 'tree-sitter-css.wasm',
  json: 'tree-sitter-json.wasm',
};

/**
 * Extract the TypeScript/JavaScript content from a Svelte <script> block.
 * Returns the script content (without the surrounding <script> tags) and
 * the 0-indexed line number where that content starts in the original file.
 * If no <script> block is found, falls back to returning the full content
 * with startLine = 0 (so the TypeScript parser sees something; it will
 * produce a noisy tree but won't crash).
 */
function extractSvelteScript(source: string): { content: string; startLine: number } {
  // Match <script>, <script lang="ts">, <script lang="js">, <script context="module">, etc.
  const openRe = /<script(?:\s[^>]*)?\s*>/i;
  const closeRe = /<\/script\s*>/i;

  const openMatch = openRe.exec(source);
  if (!openMatch) {
    return { content: '', startLine: 0 };
  }

  const openEnd = openMatch.index + openMatch[0].length;
  const closeMatch = closeRe.exec(source.slice(openEnd));
  if (!closeMatch) {
    return { content: '', startLine: 0 };
  }

  const scriptContent = source.slice(openEnd, openEnd + closeMatch.index);

  // Count how many newlines appear before the start of the script content
  // (i.e. up to and including the opening <script> tag line)
  const startLine = (source.slice(0, openEnd).match(/\n/g) ?? []).length;

  return { content: scriptContent, startLine };
}

async function initTreeSitter() {
  if (ParserClass) return;
  // web-tree-sitter v0.26+ uses named exports — import both Parser and Language
  const mod = await import('web-tree-sitter');
  // Handle both old (default export) and new (named exports) APIs
  const P: any = (mod as any).Parser ?? (mod as any).default;
  if (!P || typeof P.init !== 'function') {
    throw new Error('web-tree-sitter: Parser class not found or missing init()');
  }
  await P.init({
    locateFile: (file: string) => `/tree-sitter/${file}`,
  });
  ParserClass = P;
  // Language may be a top-level named export or nested on Parser
  LanguageClass = (mod as any).Language ?? P.Language ?? null;
}

async function getParser(language: string): Promise<any | null> {
  // Normalise aliases so they share the same cached parser instance
  const canonical = language === 'svelte' ? 'typescript' : language;
  if (parsers.has(canonical)) return parsers.get(canonical)!;
  if (!ParserClass) return null;

  // Plugin-registered grammars take precedence over built-ins so a
  // manifest can override the host's bundled grammar for the same id
  // (LYK-1036). The URL is absolute — fetched directly by the loader.
  const pluginUrl = pluginGrammarUrls.get(language) ?? pluginGrammarUrls.get(canonical);
  const grammarUrl = pluginUrl
    ? pluginUrl
    : (() => {
        const grammarFile = grammarFiles[language] ?? grammarFiles[canonical];
        return grammarFile ? `/tree-sitter/${grammarFile}` : null;
      })();
  if (!grammarUrl) return null;

  try {
    const LangCls = LanguageClass ?? ParserClass.Language;
    if (!LangCls) throw new Error('Language class not available');
    const lang = await LangCls.load(grammarUrl);
    const parser = new ParserClass();
    parser.setLanguage(lang);
    parsers.set(canonical, parser);
    loadedLanguages.set(canonical, lang);
    return parser;
  } catch (e) {
    console.warn(`Failed to load tree-sitter grammar for ${language}:`, e);
    return null;
  }
}

function extractSymbols(node: any, language: string, rowOffset = 0): Symbol[] {
  const symbols: Symbol[] = [];

  function walk(n: any) {
    const sym = nodeToSymbol(n, language, rowOffset);
    if (sym) {
      const children: Symbol[] = [];
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i);
        if (child) {
          const childSyms = extractSymbolsFromNode(child, language, rowOffset);
          children.push(...childSyms);
        }
      }
      if (children.length > 0) sym.children = children;
      symbols.push(sym);
    } else {
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i);
        if (child) walk(child);
      }
    }
  }

  walk(node);
  return symbols;
}

function extractSymbolsFromNode(node: any, language: string, rowOffset = 0): Symbol[] {
  const symbols: Symbol[] = [];

  function walk(n: any) {
    const sym = nodeToSymbol(n, language, rowOffset);
    if (sym) {
      const children: Symbol[] = [];
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i);
        if (child) children.push(...extractSymbolsFromNode(child, language, rowOffset));
      }
      if (children.length > 0) sym.children = children;
      symbols.push(sym);
    } else {
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i);
        if (child) walk(child);
      }
    }
  }

  walk(node);
  return symbols;
}

function nodeToSymbol(node: any, language: string, rowOffset = 0): Symbol | null {
  const type = node.type;

  // TypeScript/JavaScript/Svelte (svelte files are parsed as typescript)
  if (['javascript', 'typescript', 'svelte'].includes(language)) {
    if (type === 'function_declaration' || type === 'function') {
      const name = node.childForFieldName('name');
      if (name) return makeSymbol(name.text, 'function', node, rowOffset);
    }
    if (type === 'class_declaration') {
      const name = node.childForFieldName('name');
      if (name) return makeSymbol(name.text, 'class', node, rowOffset);
    }
    if (type === 'method_definition') {
      const name = node.childForFieldName('name');
      if (name) return makeSymbol(name.text, 'method', node, rowOffset);
    }
    if (type === 'interface_declaration' || type === 'type_alias_declaration') {
      const name = node.childForFieldName('name');
      if (name) return makeSymbol(name.text, 'interface', node, rowOffset);
    }
    if (type === 'lexical_declaration' || type === 'variable_declaration') {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child && child.type === 'variable_declarator') {
          const name = child.childForFieldName('name');
          const value = child.childForFieldName('value');
          if (name) {
            const kind =
              value && (value.type === 'arrow_function' || value.type === 'function')
                ? 'function'
                : 'variable';
            return makeSymbol(name.text, kind, node, rowOffset);
          }
        }
      }
    }
    if (type === 'export_statement') {
      return null; // Let children be processed
    }
  }

  // Python
  if (language === 'python') {
    if (type === 'function_definition') {
      const name = node.childForFieldName('name');
      if (name) return makeSymbol(name.text, 'function', node);
    }
    if (type === 'class_definition') {
      const name = node.childForFieldName('name');
      if (name) return makeSymbol(name.text, 'class', node);
    }
  }

  // Rust
  if (language === 'rust') {
    if (type === 'function_item') {
      const name = node.childForFieldName('name');
      if (name) return makeSymbol(name.text, 'function', node);
    }
    if (type === 'struct_item' || type === 'enum_item') {
      const name = node.childForFieldName('name');
      if (name) return makeSymbol(name.text, 'type', node);
    }
    if (type === 'impl_item') {
      const typeName = node.childForFieldName('type');
      if (typeName) return makeSymbol(`impl ${typeName.text}`, 'class', node);
    }
    if (type === 'trait_item') {
      const name = node.childForFieldName('name');
      if (name) return makeSymbol(name.text, 'interface', node);
    }
  }

  return null;
}

function makeSymbol(name: string, kind: Symbol['kind'], node: any, rowOffset = 0): Symbol {
  return {
    name,
    kind,
    startRow: node.startPosition.row + rowOffset,
    startCol: node.startPosition.column,
    endRow: node.endPosition.row + rowOffset,
    endCol: node.endPosition.column,
  };
}

function findDefinitions(
  tree: any,
  language: string,
  row: number,
  col: number,
  rowOffset = 0,
): Location[] {
  const node = tree.rootNode.descendantForPosition({ row, column: col });
  if (!node) return [];

  const identNode =
    node.type === 'identifier' || node.type === 'property_identifier'
      ? node
      : node.parent?.type === 'identifier'
        ? node.parent
        : null;
  if (!identNode) return [];

  const name = identNode.text;
  const locations: Location[] = [];

  function walk(n: any) {
    const sym = nodeToSymbol(n, language);
    if (sym && sym.name === name) {
      locations.push({
        row: sym.startRow,
        col: sym.startCol,
        endRow: sym.endRow,
        endCol: sym.endCol,
        text: n.text.split('\n')[0].slice(0, 100),
      });
    }
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i);
      if (child) walk(child);
    }
  }

  walk(tree.rootNode);
  return locations;
}

function findReferences(tree: any, symbolName: string): Location[] {
  const locations: Location[] = [];

  function walk(n: any) {
    if ((n.type === 'identifier' || n.type === 'property_identifier') && n.text === symbolName) {
      locations.push({
        row: n.startPosition.row,
        col: n.startPosition.column,
        endRow: n.endPosition.row,
        endCol: n.endPosition.column,
        text: n.parent?.text?.split('\n')[0].slice(0, 100) ?? symbolName,
      });
    }
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i);
      if (child) walk(child);
    }
  }

  walk(tree.rootNode);
  return locations;
}

// Message handler
self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;

  try {
    switch (msg.type) {
      case 'init': {
        await initTreeSitter();
        self.postMessage({ type: 'ready' } satisfies WorkerResponse);
        break;
      }

      case 'registerGrammar': {
        // LYK-1036: store the URL and clear any cached parser for this
        // language so the next parse picks the new grammar up.
        pluginGrammarUrls.set(msg.language, msg.wasmUrl);
        if (msg.highlightsUrl) pluginHighlightUrls.set(msg.language, msg.highlightsUrl);
        if (msg.foldsUrl) pluginFoldUrls.set(msg.language, msg.foldsUrl);
        const canonical = msg.language === 'svelte' ? 'typescript' : msg.language;
        parsers.delete(canonical);
        loadedLanguages.delete(canonical);
        // Drop compiled queries so they recompile against the new grammar.
        highlightQueries.delete(msg.language);
        foldQueries.delete(msg.language);
        break;
      }

      case 'highlight': {
        await initTreeSitter();
        const spans: HighlightSpan[] = [];
        const folds: FoldSpan[] = [];
        const parser = await getParser(msg.language);
        if (parser) {
          const tree = parser.parse(msg.content);
          const hq = await getQuery(
            msg.language,
            pluginHighlightUrls.get(msg.language),
            highlightQueries,
          );
          if (hq && tree) {
            for (const cap of hq.captures(tree.rootNode)) {
              const node = cap.node;
              if (node.endIndex > node.startIndex) {
                spans.push({ from: node.startIndex, to: node.endIndex, name: cap.name });
              }
            }
          }
          const fq = await getQuery(msg.language, pluginFoldUrls.get(msg.language), foldQueries);
          if (fq && tree) {
            for (const cap of fq.captures(tree.rootNode)) {
              const node = cap.node;
              // Fold from the end of the first line of the node to its end.
              if (node.endIndex > node.startIndex) {
                folds.push({ from: node.startIndex, to: node.endIndex });
              }
            }
          }
          tree?.delete?.();
        }
        self.postMessage({
          type: 'highlights',
          requestId: msg.requestId,
          spans,
          folds,
        } satisfies WorkerResponse);
        break;
      }

      case 'parse': {
        await initTreeSitter();
        const parser = await getParser(msg.language);
        if (!parser) {
          console.warn('[treesitter] no parser for', msg.language, '— sending empty symbols');
          self.postMessage({
            type: 'parsed',
            fileId: msg.fileId,
            symbols: [],
          } satisfies WorkerResponse);
          break;
        }

        // For Svelte files, only parse the <script> block content.
        // The TypeScript grammar can't handle the surrounding HTML/template syntax.
        let parseContent = msg.content;
        let rowOffset = 0;
        if (msg.language === 'svelte') {
          const extracted = extractSvelteScript(msg.content);
          parseContent = extracted.content;
          rowOffset = extracted.startLine;
        }
        scriptRowOffsets.set(msg.fileId, rowOffset);

        const tree = parser.parse(parseContent);
        trees.set(msg.fileId, tree);
        fileLanguages.set(msg.fileId, msg.language);

        const symbols = extractSymbols(tree.rootNode, msg.language, rowOffset);
        console.debug(
          '[treesitter] parsed',
          msg.fileId,
          msg.language,
          'rowOffset=' + rowOffset,
          'symbols=' + symbols.length,
          symbols.map(
            (s) =>
              s.name + (s.children?.length ? `(${s.children.map((c) => c.name).join(',')})` : ''),
          ),
        );
        self.postMessage({
          type: 'parsed',
          fileId: msg.fileId,
          symbols,
        } satisfies WorkerResponse);
        break;
      }

      case 'symbols': {
        const tree = trees.get(msg.fileId);
        const lang = fileLanguages.get(msg.fileId);
        if (!tree || !lang) {
          self.postMessage({
            type: 'parsed',
            fileId: msg.fileId,
            symbols: [],
          } satisfies WorkerResponse);
          break;
        }
        const rowOff = scriptRowOffsets.get(msg.fileId) ?? 0;
        const symbols = extractSymbols(tree.rootNode, lang, rowOff);
        self.postMessage({
          type: 'parsed',
          fileId: msg.fileId,
          symbols,
        } satisfies WorkerResponse);
        break;
      }

      case 'definitions': {
        const tree = trees.get(msg.fileId);
        const lang = fileLanguages.get(msg.fileId);
        if (!tree || !lang) {
          self.postMessage({
            type: 'definitions',
            fileId: msg.fileId,
            locations: [],
          } satisfies WorkerResponse);
          break;
        }
        const defOffset = scriptRowOffsets.get(msg.fileId) ?? 0;
        // Adjust incoming position into the parsed sub-document coordinates
        const adjRow = Math.max(0, msg.position.row - defOffset);
        const locations = findDefinitions(tree, lang, adjRow, msg.position.col, defOffset);
        self.postMessage({
          type: 'definitions',
          fileId: msg.fileId,
          locations,
        } satisfies WorkerResponse);
        break;
      }

      case 'references': {
        const tree = trees.get(msg.fileId);
        if (!tree) {
          self.postMessage({
            type: 'references',
            fileId: msg.fileId,
            locations: [],
          } satisfies WorkerResponse);
          break;
        }
        const locations = findReferences(tree, msg.symbolName);
        self.postMessage({
          type: 'references',
          fileId: msg.fileId,
          locations,
        } satisfies WorkerResponse);
        break;
      }
    }
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: String(err),
    } satisfies WorkerResponse);
  }
};
