/**
 * File Change Impact Analysis
 *
 * Given a set of changed files, predict which other files,
 * tests, and functions are affected using import graph
 * traversal and dependency analysis.
 */

export type ImpactLevel = 'direct' | 'transitive' | 'potential';

export type ImpactType = 'import' | 'test' | 'type' | 'config' | 'style';

export interface ImpactedFile {
  filePath: string;
  /** How this file is impacted */
  level: ImpactLevel;
  /** Why it's impacted */
  type: ImpactType;
  /** Which changed file causes the impact */
  causedBy: string;
  /** Import chain from changed file to this file */
  importChain?: string[];
  /** Risk score (0.0 - 1.0) */
  risk: number;
}

export interface ImpactAnalysisResult {
  /** Files that were changed (input) */
  changedFiles: string[];
  /** Files impacted by the changes */
  impactedFiles: ImpactedFile[];
  /** Test files that should be run */
  testsToRun: string[];
  /** Summary statistics */
  summary: {
    directImpact: number;
    transitiveImpact: number;
    potentialImpact: number;
    totalFiles: number;
    riskScore: number; // average risk across all impacted files
  };
  /** Warnings (circular deps, missing files, etc.) */
  warnings: string[];
}

export interface ImportGraphNode {
  filePath: string;
  /** Files this file imports from */
  imports: string[];
  /** Files that import this file */
  importedBy: string[];
  /** Whether this is a test file */
  isTest: boolean;
  /** Whether this is a config file */
  isConfig: boolean;
}

export interface ImportGraph {
  nodes: Map<string, ImportGraphNode>;
  /** Total number of files in the graph */
  totalFiles: number;
  /** Build timestamp */
  builtAt: number;
}

export interface ImpactAnalysisConfig {
  /** Maximum depth for transitive impact traversal */
  maxDepth: number;
  /** File patterns for test files */
  testPatterns: string[];
  /** File patterns for config files (changes here affect everything) */
  configPatterns: string[];
  /** Directories to exclude */
  excludeDirs: string[];
  /** Whether to include transitive impacts */
  includeTransitive: boolean;
}

export const DEFAULT_IMPACT_ANALYSIS_CONFIG: ImpactAnalysisConfig = {
  maxDepth: 5,
  testPatterns: ['**/*.test.*', '**/*.spec.*', '**/__tests__/**', '**/test/**'],
  configPatterns: [
    'tsconfig*.json',
    'package.json',
    'vite.config.*',
    'svelte.config.*',
    '.env*',
    'tailwind.config.*',
  ],
  excludeDirs: ['node_modules', '.git', 'dist', 'build'],
  includeTransitive: true,
};
