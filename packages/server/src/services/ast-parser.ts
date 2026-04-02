/**
 * Tree-sitter AST Parser Service
 *
 * Server-side structural code analysis using tree-sitter.
 * Provides file structure extraction, function signatures,
 * class outlines, and import/export analysis.
 */

import { readFileSync } from 'fs';
import { extname } from 'path';
import type {
  ASTNode,
  ASTNodeType,
  FileStructure,
  ImportNode,
  ExportNode,
  FunctionSignature,
  ClassOutline,
  TreeSitterLanguage,
} from '@e/shared';
import { EXTENSION_TO_LANGUAGE } from '@e/shared';

/**
 * Parse a file and extract its structure using regex-based analysis.
 * Falls back to regex when tree-sitter WASM is not available server-side.
 */
export function parseFileStructure(filePath: string): FileStructure {
  const ext = extname(filePath);
  const language = EXTENSION_TO_LANGUAGE[ext];
  if (!language) {
    return {
      filePath,
      language: ext.slice(1),
      nodes: [],
      imports: [],
      exports: [],
      lineCount: 0,
      errors: [`Unsupported file extension: ${ext}`],
    };
  }

  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch (err: any) {
    return {
      filePath,
      language,
      nodes: [],
      imports: [],
      exports: [],
      lineCount: 0,
      errors: [err.message],
    };
  }

  return parseContent(content, language, filePath);
}

/**
 * Parse content string and extract structure.
 */
export function parseContent(
  content: string,
  language: TreeSitterLanguage,
  filePath = '<inline>',
): FileStructure {
  const lines = content.split('\n');
  const nodes: ASTNode[] = [];
  const imports: ImportNode[] = [];
  const exports: ExportNode[] = [];
  const errors: string[] = [];

  try {
    if (['typescript', 'tsx', 'javascript', 'jsx'].includes(language)) {
      extractJSNodes(lines, nodes, imports, exports);
    } else if (language === 'python') {
      extractPythonNodes(lines, nodes, imports);
    } else if (language === 'rust') {
      extractRustNodes(lines, nodes);
    } else if (language === 'go') {
      extractGoNodes(lines, nodes, imports);
    } else {
      // Generic extraction for other languages
      extractGenericNodes(lines, nodes);
    }
  } catch (err: any) {
    errors.push(`Parse error: ${err.message}`);
  }

  return { filePath, language, nodes, imports, exports, lineCount: lines.length, errors };
}

function extractJSNodes(
  lines: string[],
  nodes: ASTNode[],
  imports: ImportNode[],
  exports: ExportNode[],
): void {
  const functionRegex =
    /^(\s*)(export\s+)?(async\s+)?function\s*(\*?)\s*(\w+)\s*(<[^>]*>)?\s*\(([^)]*)\)\s*(?::\s*([^{]+))?\s*\{?/;
  const classRegex =
    /^(\s*)(export\s+)?(abstract\s+)?class\s+(\w+)\s*(?:<[^>]*>)?\s*(?:extends\s+(\w+))?\s*(?:implements\s+([\w\s,]+))?\s*\{?/;
  const interfaceRegex =
    /^(\s*)(export\s+)?interface\s+(\w+)\s*(?:<[^>]*>)?\s*(?:extends\s+([\w\s,]+))?\s*\{?/;
  const typeRegex = /^(\s*)(export\s+)?type\s+(\w+)\s*(?:<[^>]*>)?\s*=/;
  const enumRegex = /^(\s*)(export\s+)?enum\s+(\w+)\s*\{?/;
  const constRegex = /^(\s*)(export\s+)?const\s+(\w+)\s*(?::\s*([^=]+))?\s*=/;
  const importRegex = /^import\s+(?:(type)\s+)?(?:{([^}]+)}|(\w+))\s+from\s+['"](.*)['"]/;
  const exportFromRegex = /^export\s+(?:(type)\s+)?{([^}]+)}\s+from\s+['"](.*)['"]/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    let match: RegExpMatchArray | null;

    if ((match = line.match(importRegex))) {
      const isTypeOnly = !!match[1];
      const specifiersRaw = match[2] || match[3];
      const source = match[4];
      const specifiers = specifiersRaw
        ? specifiersRaw.split(',').map((s) => {
            const parts = s.trim().split(/\s+as\s+/);
            return { name: parts[0].trim(), alias: parts[1]?.trim(), isDefault: !match![2] };
          })
        : [];
      imports.push({ source, specifiers, isTypeOnly, line: lineNo });
      continue;
    }

    if ((match = line.match(exportFromRegex))) {
      const specifiers = match[2].split(',').map((s) => s.trim());
      for (const spec of specifiers) {
        exports.push({
          name: spec,
          isDefault: false,
          isTypeOnly: !!match[1],
          source: match[3],
          line: lineNo,
        });
      }
      continue;
    }

    if ((match = line.match(functionRegex))) {
      const exported = !!match[2];
      const isAsync = !!match[3];
      const isGenerator = !!match[4];
      const name = match[5];
      const endLine = findBlockEnd(lines, i);
      nodes.push({
        type: 'function',
        name,
        startLine: lineNo,
        endLine,
        startCol: match[1].length,
        endCol: 0,
        children: [],
        signature: line.trim(),
        exported,
        modifiers: [...(isAsync ? ['async'] : []), ...(isGenerator ? ['generator'] : [])],
      });
      if (exported) exports.push({ name, isDefault: false, isTypeOnly: false, line: lineNo });
      continue;
    }

    if ((match = line.match(classRegex))) {
      const exported = !!match[2];
      const name = match[4];
      const endLine = findBlockEnd(lines, i);
      nodes.push({
        type: 'class',
        name,
        startLine: lineNo,
        endLine,
        startCol: match[1].length,
        endCol: 0,
        children: extractClassMembers(lines, i, endLine),
        exported,
        modifiers: match[3] ? ['abstract'] : [],
      });
      if (exported) exports.push({ name, isDefault: false, isTypeOnly: false, line: lineNo });
      continue;
    }

    if ((match = line.match(interfaceRegex))) {
      const exported = !!match[2];
      const name = match[3];
      const endLine = findBlockEnd(lines, i);
      nodes.push({
        type: 'interface',
        name,
        startLine: lineNo,
        endLine,
        startCol: match[1].length,
        endCol: 0,
        children: [],
        exported,
        modifiers: [],
      });
      if (exported) exports.push({ name, isDefault: false, isTypeOnly: true, line: lineNo });
      continue;
    }

    if ((match = line.match(typeRegex))) {
      const exported = !!match[2];
      const name = match[3];
      nodes.push({
        type: 'type_alias',
        name,
        startLine: lineNo,
        endLine: lineNo,
        startCol: match[1].length,
        endCol: line.length,
        children: [],
        exported,
        modifiers: [],
      });
      if (exported) exports.push({ name, isDefault: false, isTypeOnly: true, line: lineNo });
      continue;
    }

    if ((match = line.match(enumRegex))) {
      const exported = !!match[2];
      const name = match[3];
      const endLine = findBlockEnd(lines, i);
      nodes.push({
        type: 'enum',
        name,
        startLine: lineNo,
        endLine,
        startCol: match[1].length,
        endCol: 0,
        children: [],
        exported,
        modifiers: [],
      });
      if (exported) exports.push({ name, isDefault: false, isTypeOnly: false, line: lineNo });
      continue;
    }

    if ((match = line.match(constRegex))) {
      const exported = !!match[2];
      const name = match[3];
      nodes.push({
        type: 'variable',
        name,
        startLine: lineNo,
        endLine: lineNo,
        startCol: match[1].length,
        endCol: line.length,
        children: [],
        exported,
        modifiers: ['const'],
      });
      if (exported) exports.push({ name, isDefault: false, isTypeOnly: false, line: lineNo });
    }
  }
}

function extractPythonNodes(lines: string[], nodes: ASTNode[], imports: ImportNode[]): void {
  const funcRegex = /^(\s*)(async\s+)?def\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*(.+))?\s*:/;
  const classRegex = /^(\s*)class\s+(\w+)\s*(?:\(([^)]*)\))?\s*:/;
  const importRegex = /^(?:from\s+(\S+)\s+)?import\s+(.+)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    let match: RegExpMatchArray | null;

    if ((match = line.match(importRegex))) {
      const source = match[1] || match[2].split(',')[0].trim();
      imports.push({
        source,
        specifiers: [{ name: match[2].trim(), isDefault: false }],
        isTypeOnly: false,
        line: lineNo,
      });
      continue;
    }

    if ((match = line.match(funcRegex))) {
      const indent = match[1].length;
      const endLine = findPythonBlockEnd(lines, i, indent);
      nodes.push({
        type: match[1].length === 0 ? 'function' : 'method',
        name: match[3],
        startLine: lineNo,
        endLine,
        startCol: indent,
        endCol: 0,
        children: [],
        signature: line.trim(),
        exported: !match[3].startsWith('_'),
        modifiers: match[2] ? ['async'] : [],
      });
      continue;
    }

    if ((match = line.match(classRegex))) {
      const indent = match[1].length;
      const endLine = findPythonBlockEnd(lines, i, indent);
      nodes.push({
        type: 'class',
        name: match[2],
        startLine: lineNo,
        endLine,
        startCol: indent,
        endCol: 0,
        children: [],
        exported: !match[2].startsWith('_'),
        modifiers: [],
      });
    }
  }
}

function extractRustNodes(lines: string[], nodes: ASTNode[]): void {
  const fnRegex = /^(\s*)(pub\s+)?(?:async\s+)?fn\s+(\w+)\s*(?:<[^>]*>)?\s*\(/;
  const structRegex = /^(\s*)(pub\s+)?struct\s+(\w+)/;
  const enumRegex = /^(\s*)(pub\s+)?enum\s+(\w+)/;
  const implRegex = /^(\s*)impl\s+(?:<[^>]*>\s+)?(\w+)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    let match: RegExpMatchArray | null;

    if ((match = line.match(fnRegex))) {
      const endLine = findBlockEnd(lines, i);
      nodes.push({
        type: 'function',
        name: match[3],
        startLine: lineNo,
        endLine,
        startCol: match[1].length,
        endCol: 0,
        children: [],
        signature: line.trim(),
        exported: !!match[2],
        modifiers: line.includes('async') ? ['async'] : [],
      });
    } else if ((match = line.match(structRegex))) {
      const endLine = findBlockEnd(lines, i);
      nodes.push({
        type: 'class',
        name: match[3],
        startLine: lineNo,
        endLine,
        startCol: match[1].length,
        endCol: 0,
        children: [],
        exported: !!match[2],
        modifiers: ['struct'],
      });
    } else if ((match = line.match(enumRegex))) {
      const endLine = findBlockEnd(lines, i);
      nodes.push({
        type: 'enum',
        name: match[3],
        startLine: lineNo,
        endLine,
        startCol: match[1].length,
        endCol: 0,
        children: [],
        exported: !!match[2],
        modifiers: [],
      });
    } else if ((match = line.match(implRegex))) {
      const endLine = findBlockEnd(lines, i);
      nodes.push({
        type: 'module',
        name: `impl ${match[2]}`,
        startLine: lineNo,
        endLine,
        startCol: match[1].length,
        endCol: 0,
        children: [],
        exported: false,
        modifiers: ['impl'],
      });
    }
  }
}

function extractGoNodes(lines: string[], nodes: ASTNode[], imports: ImportNode[]): void {
  const funcRegex = /^func\s+(?:\((\w+)\s+\*?(\w+)\)\s+)?(\w+)\s*\(/;
  const typeStructRegex = /^type\s+(\w+)\s+struct\s*\{/;
  const typeInterfaceRegex = /^type\s+(\w+)\s+interface\s*\{/;
  const importRegex = /^\s*"([^"]+)"/;

  let inImportBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    let match: RegExpMatchArray | null;

    if (line.trim() === 'import (') {
      inImportBlock = true;
      continue;
    }
    if (inImportBlock) {
      if (line.trim() === ')') {
        inImportBlock = false;
        continue;
      }
      if ((match = line.match(importRegex))) {
        imports.push({
          source: match[1],
          specifiers: [{ name: match[1].split('/').pop()!, isDefault: true }],
          isTypeOnly: false,
          line: lineNo,
        });
      }
      continue;
    }

    if ((match = line.match(funcRegex))) {
      const endLine = findBlockEnd(lines, i);
      const name = match[3];
      const isExported = name[0] === name[0].toUpperCase();
      const type: ASTNodeType = match[1] ? 'method' : 'function';
      nodes.push({
        type,
        name,
        startLine: lineNo,
        endLine,
        startCol: 0,
        endCol: 0,
        children: [],
        signature: line.trim(),
        exported: isExported,
        modifiers: match[1] ? [`receiver:${match[2]}`] : [],
      });
    } else if ((match = line.match(typeStructRegex))) {
      const endLine = findBlockEnd(lines, i);
      nodes.push({
        type: 'class',
        name: match[1],
        startLine: lineNo,
        endLine,
        startCol: 0,
        endCol: 0,
        children: [],
        exported: match[1][0] === match[1][0].toUpperCase(),
        modifiers: ['struct'],
      });
    } else if ((match = line.match(typeInterfaceRegex))) {
      const endLine = findBlockEnd(lines, i);
      nodes.push({
        type: 'interface',
        name: match[1],
        startLine: lineNo,
        endLine,
        startCol: 0,
        endCol: 0,
        children: [],
        exported: match[1][0] === match[1][0].toUpperCase(),
        modifiers: [],
      });
    }
  }
}

function extractGenericNodes(lines: string[], nodes: ASTNode[]): void {
  // Very basic: find function-like patterns
  const funcRegex =
    /^(\s*)(?:(?:public|private|protected|static|virtual|override|async)\s+)*(?:\w+\s+)?(\w+)\s*\([^)]*\)\s*\{?/;
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(funcRegex);
    if (match && !['if', 'for', 'while', 'switch', 'catch'].includes(match[2])) {
      const endLine = findBlockEnd(lines, i);
      nodes.push({
        type: 'function',
        name: match[2],
        startLine: i + 1,
        endLine,
        startCol: match[1].length,
        endCol: 0,
        children: [],
        exported: false,
        modifiers: [],
      });
    }
  }
}

function extractClassMembers(lines: string[], classStart: number, classEnd: number): ASTNode[] {
  const members: ASTNode[] = [];
  const methodRegex =
    /^\s+(async\s+)?(?:(static|get|set|private|protected|public)\s+)*(\w+)\s*(?:<[^>]*>)?\s*\(/;

  for (let i = classStart + 1; i < classEnd && i < lines.length; i++) {
    const match = lines[i].match(methodRegex);
    if (match) {
      const endLine = findBlockEnd(lines, i);
      members.push({
        type: 'method',
        name: match[3],
        startLine: i + 1,
        endLine,
        startCol: 0,
        endCol: 0,
        children: [],
        signature: lines[i].trim(),
        exported: false,
        modifiers: [match[1]?.trim(), match[2]?.trim()].filter(Boolean) as string[],
      });
    }
  }
  return members;
}

function findBlockEnd(lines: string[], startIdx: number): number {
  let depth = 0;
  let foundOpen = false;
  for (let i = startIdx; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') {
        depth++;
        foundOpen = true;
      }
      if (ch === '}') {
        depth--;
      }
      if (foundOpen && depth === 0) return i + 1;
    }
  }
  return startIdx + 1;
}

function findPythonBlockEnd(lines: string[], startIdx: number, baseIndent: number): number {
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    const indent = line.length - line.trimStart().length;
    if (indent <= baseIndent) return i;
  }
  return lines.length;
}

/**
 * Extract function signatures from a file.
 */
export function extractFunctionSignatures(filePath: string): FunctionSignature[] {
  const structure = parseFileStructure(filePath);
  return structure.nodes
    .filter((n) => n.type === 'function' || n.type === 'method')
    .map((n) => ({
      name: n.name,
      params: [], // Would need deeper parsing
      isAsync: n.modifiers.includes('async'),
      isGenerator: n.modifiers.includes('generator'),
    }));
}

/**
 * Extract class outline from a file.
 */
export function extractClassOutlines(filePath: string): ClassOutline[] {
  const structure = parseFileStructure(filePath);
  return structure.nodes
    .filter((n) => n.type === 'class')
    .map((n) => ({
      name: n.name,
      implements: [],
      methods: n.children
        .filter((c) => c.type === 'method')
        .map((c) => ({
          name: c.name,
          params: [],
          isAsync: c.modifiers.includes('async'),
          isGenerator: false,
        })),
      properties: [],
    }));
}
