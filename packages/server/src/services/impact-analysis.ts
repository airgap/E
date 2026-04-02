/**
 * File Change Impact Analysis Service
 *
 * Given changed files, builds an import graph and traverses it
 * to find all directly and transitively impacted files.
 */

import { readdirSync, readFileSync } from 'fs';
import { join, relative, dirname, extname, resolve } from 'path';
import type {
  ImpactedFile,
  ImpactAnalysisResult,
  ImportGraphNode,
  ImpactAnalysisConfig,
} from '@e/shared';
import { DEFAULT_IMPACT_ANALYSIS_CONFIG } from '@e/shared';

class ImpactAnalysisService {
  private static instance: ImpactAnalysisService;
  private config: ImpactAnalysisConfig = { ...DEFAULT_IMPACT_ANALYSIS_CONFIG };

  static getInstance(): ImpactAnalysisService {
    if (!ImpactAnalysisService.instance) {
      ImpactAnalysisService.instance = new ImpactAnalysisService();
    }
    return ImpactAnalysisService.instance;
  }

  setConfig(config: Partial<ImpactAnalysisConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Analyze the impact of changed files.
   */
  analyze(changedFiles: string[], workspacePath: string): ImpactAnalysisResult {
    const graph = this.buildImportGraph(workspacePath);
    const impactedFiles: ImpactedFile[] = [];
    const warnings: string[] = [];
    const visited = new Set<string>();

    // Normalize changed files to relative paths
    const changedSet = new Set(changedFiles.map((f) => this.normalizePath(f, workspacePath)));

    // Check if any changed files are config files — they impact everything
    for (const changed of changedSet) {
      if (this.isConfigFile(changed)) {
        warnings.push(`Config file changed: ${changed} — may affect all files`);
      }
    }

    // Traverse import graph from each changed file
    for (const changed of changedSet) {
      this.findImpacted(
        changed,
        changed,
        graph,
        impactedFiles,
        visited,
        changedSet,
        workspacePath,
        0,
        [],
      );
    }

    // Find test files that test changed modules
    const testsToRun = this.findRelatedTests(changedSet, graph, workspacePath);

    // Calculate summary
    const direct = impactedFiles.filter((f) => f.level === 'direct').length;
    const transitive = impactedFiles.filter((f) => f.level === 'transitive').length;
    const potential = impactedFiles.filter((f) => f.level === 'potential').length;
    const avgRisk =
      impactedFiles.length > 0
        ? impactedFiles.reduce((sum, f) => sum + f.risk, 0) / impactedFiles.length
        : 0;

    return {
      changedFiles: [...changedSet],
      impactedFiles,
      testsToRun: [...new Set(testsToRun)],
      summary: {
        directImpact: direct,
        transitiveImpact: transitive,
        potentialImpact: potential,
        totalFiles: impactedFiles.length,
        riskScore: Math.round(avgRisk * 100) / 100,
      },
      warnings,
    };
  }

  private findImpacted(
    filePath: string,
    causedBy: string,
    graph: Map<string, ImportGraphNode>,
    results: ImpactedFile[],
    visited: Set<string>,
    changedSet: Set<string>,
    workspacePath: string,
    depth: number,
    chain: string[],
  ): void {
    if (depth > this.config.maxDepth) return;

    const node = graph.get(filePath);
    if (!node) return;

    for (const importer of node.importedBy) {
      if (visited.has(importer) || changedSet.has(importer)) continue;
      visited.add(importer);

      const level = depth === 0 ? 'direct' : 'transitive';
      const risk = Math.max(0.1, 1 - depth * 0.2); // Risk decreases with distance

      results.push({
        filePath: importer,
        level,
        type: node.isTest ? 'test' : 'import',
        causedBy,
        importChain: [...chain, filePath, importer],
        risk: Math.round(risk * 100) / 100,
      });

      if (this.config.includeTransitive) {
        this.findImpacted(
          importer,
          causedBy,
          graph,
          results,
          visited,
          changedSet,
          workspacePath,
          depth + 1,
          [...chain, filePath],
        );
      }
    }
  }

  private findRelatedTests(
    changedFiles: Set<string>,
    graph: Map<string, ImportGraphNode>,
    workspacePath: string,
  ): string[] {
    const tests: string[] = [];

    for (const changed of changedFiles) {
      // Direct test file naming conventions
      const base = changed.replace(/\.\w+$/, '');
      for (const suffix of [
        '.test.ts',
        '.spec.ts',
        '.test.tsx',
        '.spec.tsx',
        '.test.js',
        '.spec.js',
      ]) {
        const testPath = base + suffix;
        if (graph.has(testPath)) tests.push(testPath);
      }

      // Check __tests__ directory
      const dir = dirname(changed);
      const name =
        changed
          .split('/')
          .pop()
          ?.replace(/\.\w+$/, '') || '';
      const testDir = join(dir, '__tests__');
      for (const suffix of ['.test.ts', '.test.tsx', '.test.js']) {
        const testPath = join(testDir, name + suffix);
        if (graph.has(testPath)) tests.push(testPath);
      }

      // Files that import the changed file and are tests
      const node = graph.get(changed);
      if (node) {
        for (const importer of node.importedBy) {
          const importerNode = graph.get(importer);
          if (importerNode?.isTest) tests.push(importer);
        }
      }
    }

    return tests;
  }

  private buildImportGraph(workspacePath: string): Map<string, ImportGraphNode> {
    const graph = new Map<string, ImportGraphNode>();
    const files = this.collectSourceFiles(workspacePath, 5);

    // First pass: create nodes and extract imports
    for (const file of files) {
      const relPath = relative(workspacePath, file);
      const imports = this.extractImports(file, workspacePath);
      const isTest = this.isTestFile(relPath);
      const isConfig = this.isConfigFile(relPath);

      graph.set(relPath, { filePath: relPath, imports, importedBy: [], isTest, isConfig });
    }

    // Second pass: build reverse edges (importedBy)
    for (const [filePath, node] of graph) {
      for (const imp of node.imports) {
        const target = graph.get(imp);
        if (target) {
          target.importedBy.push(filePath);
        }
      }
    }

    return graph;
  }

  private extractImports(filePath: string, workspacePath: string): string[] {
    const ext = extname(filePath);
    if (!['.ts', '.tsx', '.js', '.jsx', '.svelte'].includes(ext)) return [];

    try {
      const content = readFileSync(filePath, 'utf-8');
      const imports: string[] = [];
      const importRegex = /(?:import|from)\s+['"]([^'"]+)['"]/g;
      let match;

      while ((match = importRegex.exec(content)) !== null) {
        const source = match[1];
        if (source.startsWith('.')) {
          // Resolve relative import
          const resolved = this.resolveImport(source, filePath, workspacePath);
          if (resolved) imports.push(resolved);
        }
      }

      return imports;
    } catch {
      return [];
    }
  }

  private resolveImport(source: string, fromFile: string, workspacePath: string): string | null {
    const dir = dirname(fromFile);
    const base = resolve(dir, source);
    const relBase = relative(workspacePath, base);

    // Try with extensions
    for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.svelte', '/index.ts', '/index.js']) {
      const candidate = relBase + ext;
      // We don't check file existence here for performance — the graph will handle missing edges
      return candidate.replace(/\/index\.\w+$/, '/index' + ext.split('/').pop());
    }
    return relBase;
  }

  private collectSourceFiles(dir: string, maxDepth: number, depth = 0): string[] {
    if (depth >= maxDepth) return [];
    const files: string[] = [];

    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (this.config.excludeDirs.includes(entry.name) || entry.name.startsWith('.')) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...this.collectSourceFiles(full, maxDepth, depth + 1));
        } else if (entry.isFile()) {
          const ext = extname(entry.name);
          if (['.ts', '.tsx', '.js', '.jsx', '.svelte', '.py', '.rs', '.go'].includes(ext)) {
            files.push(full);
          }
        }
      }
    } catch {}

    return files;
  }

  private isTestFile(filePath: string): boolean {
    return this.config.testPatterns.some((p) => {
      const regex = new RegExp(p.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*'));
      return regex.test(filePath);
    });
  }

  private isConfigFile(filePath: string): boolean {
    return this.config.configPatterns.some((p) => {
      const regex = new RegExp(p.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*'));
      return regex.test(filePath);
    });
  }

  private normalizePath(filePath: string, workspacePath: string): string {
    if (filePath.startsWith('/') || filePath.startsWith(workspacePath)) {
      return relative(workspacePath, filePath);
    }
    return filePath;
  }
}

export const impactAnalysis = ImpactAnalysisService.getInstance();
