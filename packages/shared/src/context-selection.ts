/**
 * Smart Context Selection
 *
 * Relevance-score files so the LLM automatically gets the right
 * context without manual @mentions. Uses TF-IDF-like scoring,
 * recency, edit distance, and import graph proximity.
 */

export interface FileRelevanceScore {
  filePath: string;
  /** Overall relevance score (0.0 - 1.0) */
  score: number;
  /** Individual signal contributions */
  signals: RelevanceSignal[];
  /** Whether this file should be auto-included */
  autoInclude: boolean;
}

export interface RelevanceSignal {
  type:
    | 'keyword_match'
    | 'import_graph'
    | 'recent_edit'
    | 'same_directory'
    | 'name_similarity'
    | 'mentioned'
    | 'error_source'
    | 'test_file';
  weight: number;
  detail?: string;
}

export interface ContextSelectionConfig {
  /** Enable smart context selection */
  enabled: boolean;
  /** Maximum files to auto-include */
  maxAutoIncludeFiles: number;
  /** Minimum score to auto-include (0.0 - 1.0) */
  autoIncludeThreshold: number;
  /** Maximum total tokens for auto-included context */
  maxContextTokens: number;
  /** Weight multipliers for each signal type */
  weights: Record<RelevanceSignal['type'], number>;
  /** File patterns to always exclude */
  excludePatterns: string[];
}

export const DEFAULT_CONTEXT_SELECTION_CONFIG: ContextSelectionConfig = {
  enabled: true,
  maxAutoIncludeFiles: 10,
  autoIncludeThreshold: 0.4,
  maxContextTokens: 8000,
  weights: {
    keyword_match: 1.0,
    import_graph: 0.8,
    recent_edit: 0.7,
    same_directory: 0.5,
    name_similarity: 0.6,
    mentioned: 1.0,
    error_source: 0.9,
    test_file: 0.3,
  },
  excludePatterns: ['node_modules/**', '.git/**', 'dist/**', 'build/**', '*.lock', '*.min.js'],
};

export interface ContextSelectionResult {
  /** Files selected for inclusion, ordered by relevance */
  files: FileRelevanceScore[];
  /** Total estimated tokens */
  totalTokens: number;
  /** Files that were considered but excluded */
  excluded: { filePath: string; reason: string }[];
}
