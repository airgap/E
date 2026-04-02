/**
 * AST / Tree-sitter Types
 *
 * Structural code analysis for deeper code understanding,
 * refactoring safety, and intelligent context building.
 */

export type ASTNodeType =
  | 'function'
  | 'method'
  | 'class'
  | 'interface'
  | 'type_alias'
  | 'enum'
  | 'variable'
  | 'import'
  | 'export'
  | 'module'
  | 'namespace'
  | 'decorator'
  | 'comment';

export interface ASTNode {
  type: ASTNodeType;
  name: string;
  /** Line range (1-indexed) */
  startLine: number;
  endLine: number;
  /** Column range */
  startCol: number;
  endCol: number;
  /** Nested children (methods inside class, etc.) */
  children: ASTNode[];
  /** Function/method signature */
  signature?: string;
  /** Whether exported */
  exported: boolean;
  /** Modifiers (async, static, public, etc.) */
  modifiers: string[];
  /** JSDoc/comment documentation */
  documentation?: string;
}

export interface FileStructure {
  filePath: string;
  language: string;
  /** Top-level nodes */
  nodes: ASTNode[];
  /** Import statements */
  imports: ImportNode[];
  /** Export statements */
  exports: ExportNode[];
  /** Total line count */
  lineCount: number;
  /** Parse errors (if any) */
  errors: string[];
}

export interface ImportNode {
  source: string; // module path
  specifiers: { name: string; alias?: string; isDefault: boolean }[];
  isTypeOnly: boolean;
  line: number;
}

export interface ExportNode {
  name: string;
  isDefault: boolean;
  isTypeOnly: boolean;
  /** Re-export source (if re-exporting from another module) */
  source?: string;
  line: number;
}

export interface FunctionSignature {
  name: string;
  params: { name: string; type?: string; optional: boolean; defaultValue?: string }[];
  returnType?: string;
  isAsync: boolean;
  isGenerator: boolean;
  typeParams?: string[];
}

export interface ClassOutline {
  name: string;
  extends?: string;
  implements: string[];
  methods: FunctionSignature[];
  properties: {
    name: string;
    type?: string;
    visibility: 'public' | 'private' | 'protected';
    static: boolean;
  }[];
  typeParams?: string[];
}

/** Supported languages for tree-sitter parsing */
export const TREE_SITTER_LANGUAGES = [
  'typescript',
  'tsx',
  'javascript',
  'jsx',
  'python',
  'rust',
  'go',
  'java',
  'c',
  'cpp',
  'c_sharp',
  'svelte',
  'html',
  'css',
] as const;

export type TreeSitterLanguage = (typeof TREE_SITTER_LANGUAGES)[number];

/** Map file extensions to tree-sitter language names */
export const EXTENSION_TO_LANGUAGE: Record<string, TreeSitterLanguage> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'jsx',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.c': 'c',
  '.cpp': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.cs': 'c_sharp',
  '.svelte': 'svelte',
  '.html': 'html',
  '.css': 'css',
};
