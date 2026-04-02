/**
 * Smart Context Selection Service
 *
 * Scores files by relevance to the current task/query and
 * auto-includes the most relevant ones in LLM context.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, dirname, basename, extname } from 'path';
import type {
  FileRelevanceScore,
  RelevanceSignal,
  ContextSelectionConfig,
  ContextSelectionResult,
} from '@e/shared';
import { DEFAULT_CONTEXT_SELECTION_CONFIG, estimateTokens } from '@e/shared';

class ContextSelectionService {
  private static instance: ContextSelectionService;
  private config: ContextSelectionConfig = { ...DEFAULT_CONTEXT_SELECTION_CONFIG };

  static getInstance(): ContextSelectionService {
    if (!ContextSelectionService.instance) {
      ContextSelectionService.instance = new ContextSelectionService();
    }
    return ContextSelectionService.instance;
  }

  setConfig(config: Partial<ContextSelectionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): ContextSelectionConfig {
    return { ...this.config };
  }

  /**
   * Select relevant files for a given query/task in a workspace.
   */
  selectContext(
    query: string,
    workspacePath: string,
    recentFiles: string[] = [],
    errorFiles: string[] = [],
    mentionedFiles: string[] = [],
  ): ContextSelectionResult {
    if (!this.config.enabled) {
      return { files: [], totalTokens: 0, excluded: [] };
    }

    // Collect candidate files
    const candidates = this.collectFiles(workspacePath, 4);
    const keywords = this.extractKeywords(query);
    const scores: FileRelevanceScore[] = [];
    const excluded: { filePath: string; reason: string }[] = [];

    for (const filePath of candidates) {
      const relPath = relative(workspacePath, filePath);

      // Check exclude patterns
      if (this.isExcluded(relPath)) {
        excluded.push({ filePath: relPath, reason: 'excluded_pattern' });
        continue;
      }

      const signals: RelevanceSignal[] = [];

      // Keyword match
      const keywordScore = this.scoreKeywordMatch(relPath, keywords);
      if (keywordScore > 0) {
        signals.push({
          type: 'keyword_match',
          weight: keywordScore,
          detail: 'filename/path match',
        });
      }

      // Recent edit
      if (recentFiles.includes(relPath) || recentFiles.includes(filePath)) {
        signals.push({ type: 'recent_edit', weight: 1.0 });
      }

      // Same directory as mentioned files
      for (const mentioned of mentionedFiles) {
        if (dirname(relPath) === dirname(mentioned)) {
          signals.push({ type: 'same_directory', weight: 0.8, detail: dirname(mentioned) });
          break;
        }
      }

      // Name similarity to query keywords
      const nameSim = this.scoreNameSimilarity(basename(filePath, extname(filePath)), keywords);
      if (nameSim > 0.3) {
        signals.push({ type: 'name_similarity', weight: nameSim });
      }

      // Mentioned files
      if (mentionedFiles.includes(relPath) || mentionedFiles.includes(filePath)) {
        signals.push({ type: 'mentioned', weight: 1.0 });
      }

      // Error source files
      if (errorFiles.includes(relPath) || errorFiles.includes(filePath)) {
        signals.push({ type: 'error_source', weight: 1.0 });
      }

      // Test file
      if (this.isTestFile(relPath)) {
        signals.push({ type: 'test_file', weight: 0.5 });
      }

      // Calculate weighted score
      const totalScore = signals.reduce((sum, s) => {
        const weight = this.config.weights[s.type] || 1.0;
        return sum + s.weight * weight;
      }, 0);

      // Normalize to 0-1 range (max theoretical ~5)
      const normalizedScore = Math.min(1, totalScore / 3);

      scores.push({
        filePath: relPath,
        score: Math.round(normalizedScore * 100) / 100,
        signals,
        autoInclude: normalizedScore >= this.config.autoIncludeThreshold,
      });
    }

    // Sort by score descending
    scores.sort((a, b) => b.score - a.score);

    // Limit by maxAutoIncludeFiles and maxContextTokens
    const selected: FileRelevanceScore[] = [];
    let totalTokens = 0;

    for (const file of scores) {
      if (!file.autoInclude) continue;
      if (selected.length >= this.config.maxAutoIncludeFiles) break;

      try {
        const content = readFileSync(join(workspacePath, file.filePath), 'utf-8');
        const tokens = estimateTokens(content);
        if (totalTokens + tokens > this.config.maxContextTokens) {
          excluded.push({ filePath: file.filePath, reason: 'token_budget_exceeded' });
          continue;
        }
        totalTokens += tokens;
        selected.push(file);
      } catch {
        excluded.push({ filePath: file.filePath, reason: 'read_error' });
      }
    }

    return { files: selected, totalTokens, excluded };
  }

  private collectFiles(dir: string, maxDepth: number, depth = 0): string[] {
    if (depth >= maxDepth) return [];
    const files: string[] = [];

    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist')
          continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...this.collectFiles(full, maxDepth, depth + 1));
        } else if (entry.isFile()) {
          const ext = extname(entry.name);
          if (
            [
              '.ts',
              '.tsx',
              '.js',
              '.jsx',
              '.svelte',
              '.py',
              '.rs',
              '.go',
              '.java',
              '.css',
              '.html',
              '.json',
              '.md',
            ].includes(ext)
          ) {
            try {
              const stat = statSync(full);
              if (stat.size < 100_000) files.push(full); // Skip large files
            } catch {}
          }
        }
      }
    } catch {}

    return files;
  }

  private extractKeywords(query: string): string[] {
    return query
      .toLowerCase()
      .replace(/[^a-z0-9_\-./]/g, ' ')
      .split(/\s+/)
      .filter(
        (w) =>
          w.length > 2 &&
          ![
            'the',
            'and',
            'for',
            'this',
            'that',
            'with',
            'from',
            'have',
            'are',
            'was',
            'not',
          ].includes(w),
      );
  }

  private scoreKeywordMatch(filePath: string, keywords: string[]): number {
    const lower = filePath.toLowerCase();
    let matches = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) matches++;
    }
    return keywords.length > 0 ? matches / keywords.length : 0;
  }

  private scoreNameSimilarity(fileName: string, keywords: string[]): number {
    const lower = fileName.toLowerCase();
    let bestScore = 0;
    for (const kw of keywords) {
      if (lower === kw) return 1.0;
      if (lower.includes(kw) || kw.includes(lower)) {
        const score = Math.min(kw.length, lower.length) / Math.max(kw.length, lower.length);
        bestScore = Math.max(bestScore, score);
      }
    }
    return bestScore;
  }

  private isTestFile(filePath: string): boolean {
    return (
      /\.(test|spec)\.\w+$/.test(filePath) ||
      filePath.includes('__tests__') ||
      filePath.startsWith('test/')
    );
  }

  private isExcluded(filePath: string): boolean {
    for (const pattern of this.config.excludePatterns) {
      const regex = new RegExp(pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*'));
      if (regex.test(filePath)) return true;
    }
    return false;
  }
}

export const contextSelection = ContextSelectionService.getInstance();
