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
  | { type: 'references'; fileId: string; symbolName: string };

export type WorkerResponse =
  | { type: 'ready' }
  | { type: 'parsed'; fileId: string; symbols: Symbol[] }
  | { type: 'definitions'; fileId: string; locations: Location[] }
  | { type: 'references'; fileId: string; locations: Location[] }
  | { type: 'error'; message: string };

// We use `any` for tree-sitter types since the module typing is awkward in workers
// web-tree-sitter v0.26+ exports named symbols (Parser, Language) — no default export
let ParserClass: any = null;
let LanguageClass: any = null;
const parsers = new Map<string, any>();
const trees = new Map<string, any>();
const fileLanguages = new Map<string, string>();
// For Svelte files we only parse the <script> block — track the line offset so
// symbol rows can be mapped back to the original file coordinates
const scriptRowOffsets = new Map<string, number>();

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
  markdown: 'tree-sitter-markdown.wasm',
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

  const grammarFile = grammarFiles[language] ?? grammarFiles[canonical];
  if (!grammarFile) return null;

  try {
    const LangCls = LanguageClass ?? ParserClass.Language;
    if (!LangCls) throw new Error('Language class not available');
    const lang = await LangCls.load(`/tree-sitter/${grammarFile}`);
    const parser = new ParserClass();
    parser.setLanguage(lang);
    parsers.set(canonical, parser);
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
