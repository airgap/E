/**
 * Init from Codebase Scan
 *
 * Auto-generate project rules and context by scanning the
 * repo structure, README, configs, package.json, etc.
 */

export interface CodebaseProfile {
  /** Project name */
  name: string;
  /** Detected primary languages */
  languages: string[];
  /** Detected frameworks */
  frameworks: string[];
  /** Package manager */
  packageManager?: 'npm' | 'yarn' | 'pnpm' | 'bun' | 'cargo' | 'go' | 'pip';
  /** Monorepo packages (if applicable) */
  packages?: string[];
  /** Build system */
  buildSystem?: string;
  /** Test framework */
  testFramework?: string;
  /** Has TypeScript */
  hasTypeScript: boolean;
  /** Has CI/CD config */
  hasCi: boolean;
  /** Has Docker */
  hasDocker: boolean;
  /** Entry points */
  entryPoints: string[];
  /** README excerpt (first 500 chars) */
  readmeExcerpt?: string;
  /** Important config files found */
  configFiles: string[];
  /** Detected coding conventions */
  conventions: CodeConvention[];
}

export interface CodeConvention {
  type: 'indent' | 'quotes' | 'semicolons' | 'trailing_comma' | 'naming' | 'imports' | 'other';
  value: string;
  confidence: number;
}

export interface InitScanResult {
  profile: CodebaseProfile;
  /** Generated rules/instructions for the AI */
  generatedRules: string;
  /** Suggested .e/rules.md content */
  suggestedRulesFile: string;
  /** Files that were scanned */
  scannedFiles: number;
  /** Scan duration in ms */
  durationMs: number;
}

export interface InitScanConfig {
  /** Maximum files to scan */
  maxFiles: number;
  /** Maximum depth to traverse */
  maxDepth: number;
  /** Whether to read file contents (slower but more accurate) */
  readContents: boolean;
  /** Maximum file size to read (bytes) */
  maxFileSize: number;
}

export const DEFAULT_INIT_SCAN_CONFIG: InitScanConfig = {
  maxFiles: 500,
  maxDepth: 6,
  readContents: true,
  maxFileSize: 100_000,
};
