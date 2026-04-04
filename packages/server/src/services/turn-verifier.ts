/**
 * Turn Verifier — Post-turn diagnostics inspired by Pi's philosophy.
 *
 * Key insight from Pi: LSP diagnostics and linting during multi-file agent
 * edits confuse the model ("you're wrong" when it's mid-edit). Verification
 * should only happen at natural synchronization points — when the agent
 * signals it's done with a batch of edits.
 *
 * This service:
 * 1. Tracks which files were modified during an agent turn (Write/Edit tool calls)
 * 2. After the turn completes, runs configured quality checks on affected packages
 * 3. Returns structured verification results that can be fed back to the agent
 *    or displayed in the UI
 */

import { detectAffectedPackages, parseCheckOutput } from './quality-checker';
import { verifyFile, type VerificationResult } from './code-verifier';
import { getDb } from '../db/database';

export interface TurnVerificationConfig {
  /** Run syntax checks on modified files (fast, Bun transpiler) */
  syntaxCheck: boolean;
  /** Run configured workspace quality checks (typecheck, lint — slower) */
  qualityChecks: boolean;
  /** Maximum ms to spend on verification before giving up */
  timeoutMs: number;
  /** Only verify files with these extensions */
  extensions: Set<string>;
}

export const DEFAULT_TURN_VERIFICATION: TurnVerificationConfig = {
  syntaxCheck: true,
  qualityChecks: true,
  timeoutMs: 30_000,
  extensions: new Set(['.ts', '.tsx', '.js', '.jsx', '.svelte', '.py', '.rs', '.go']),
};

export interface TurnVerificationResult {
  /** Files that were modified during the turn */
  modifiedFiles: string[];
  /** Quick syntax check results per file */
  syntaxResults: VerificationResult[];
  /** Workspace-level quality check results */
  qualityResults: QualityCheckSummary[];
  /** Total verification duration */
  duration: number;
  /** Whether all checks passed */
  allPassed: boolean;
  /** Human-readable summary for the agent */
  summary: string;
}

export interface QualityCheckSummary {
  name: string;
  type: string;
  passed: boolean;
  errorCount: number;
  /** Filtered, actionable output (no boilerplate) */
  output: string;
  duration: number;
}

/**
 * Tracks file modifications during an agent turn and provides
 * post-turn verification.
 */
export class TurnVerifier {
  private modifiedFiles = new Set<string>();
  private config: TurnVerificationConfig;
  private workspacePath: string;

  constructor(workspacePath: string, config?: Partial<TurnVerificationConfig>) {
    this.workspacePath = workspacePath;
    this.config = { ...DEFAULT_TURN_VERIFICATION, ...config };
  }

  /**
   * Called when the agent modifies a file via Write or Edit tool.
   * Just records the path — no verification happens yet.
   */
  trackFileModification(filePath: string) {
    const ext = filePath.slice(filePath.lastIndexOf('.'));
    if (this.config.extensions.has(ext)) {
      this.modifiedFiles.add(filePath);
    }
  }

  /**
   * Called when the agent's turn is complete. Runs all configured
   * verification checks and returns structured results.
   *
   * This is the "natural synchronization point" — the only time
   * we should be checking for errors.
   */
  async verify(): Promise<TurnVerificationResult> {
    const start = Date.now();
    const files = Array.from(this.modifiedFiles);

    if (files.length === 0) {
      return {
        modifiedFiles: [],
        syntaxResults: [],
        qualityResults: [],
        duration: 0,
        allPassed: true,
        summary: '',
      };
    }

    const syntaxResults: VerificationResult[] = [];
    const qualityResults: QualityCheckSummary[] = [];

    // Phase 1: Quick syntax checks (fast, per-file, Bun transpiler)
    if (this.config.syntaxCheck) {
      const syntaxPromises = files.map((f) => verifyFile(f, this.workspacePath));
      const results = await Promise.all(syntaxPromises);
      syntaxResults.push(...results);
    }

    // Phase 2: Workspace quality checks (slower, but only if configured)
    if (this.config.qualityChecks) {
      const checks = this.loadWorkspaceQualityChecks();
      if (checks.length > 0) {
        // Detect which packages were affected to scope checks
        const affected = await detectAffectedPackages(this.workspacePath);
        const scopedChecks = this.scopeChecksToPackages(checks, affected);

        for (const check of scopedChecks) {
          if (Date.now() - start > this.config.timeoutMs) break;

          const result = await this.runSingleCheck(check);
          qualityResults.push(result);
        }
      }
    }

    const syntaxFailed = syntaxResults.filter((r) => !r.passed);
    const qualityFailed = qualityResults.filter((r) => !r.passed);
    const allPassed = syntaxFailed.length === 0 && qualityFailed.length === 0;
    const duration = Date.now() - start;

    const summary = this.buildSummary(files, syntaxFailed, qualityFailed, duration);

    return {
      modifiedFiles: files,
      syntaxResults,
      qualityResults,
      duration,
      allPassed,
      summary,
    };
  }

  /** Reset tracked files for a new turn */
  reset() {
    this.modifiedFiles.clear();
  }

  private loadWorkspaceQualityChecks(): WorkspaceCheck[] {
    try {
      const db = getDb();
      // Check for quality checks on the active PRD, or workspace-level settings
      const row = db
        .query("SELECT value FROM settings WHERE key = 'turnVerificationChecks'")
        .get() as any;

      if (row) {
        return JSON.parse(row.value);
      }

      // Fallback: auto-detect common check commands
      return this.autoDetectChecks();
    } catch {
      return this.autoDetectChecks();
    }
  }

  private autoDetectChecks(): WorkspaceCheck[] {
    const checks: WorkspaceCheck[] = [];
    const { existsSync } = require('fs');
    const { join } = require('path');

    // Auto-detect TypeScript project
    if (existsSync(join(this.workspacePath, 'tsconfig.json'))) {
      // Check for monorepo with package-scoped checks
      if (existsSync(join(this.workspacePath, 'packages'))) {
        checks.push({
          name: 'typecheck',
          type: 'typecheck',
          command: 'npx tsc --noEmit',
          timeout: 30_000,
          scopeable: true,
        });
      } else {
        checks.push({
          name: 'typecheck',
          type: 'typecheck',
          command: 'npx tsc --noEmit',
          timeout: 30_000,
          scopeable: false,
        });
      }
    }

    return checks;
  }

  private scopeChecksToPackages(
    checks: WorkspaceCheck[],
    affectedPackages: string[],
  ): WorkspaceCheck[] {
    if (affectedPackages.length === 0) return checks;

    return checks.map((check) => {
      if (!check.scopeable) return check;

      // For monorepo projects, scope typecheck to affected packages
      if (check.type === 'typecheck' && affectedPackages.length > 0) {
        const filters = affectedPackages.map((p) => `--filter @e/${p}`).join(' ');
        return {
          ...check,
          command: `bun run ${filters} check`,
          name: `typecheck (${affectedPackages.join(', ')})`,
        };
      }
      return check;
    });
  }

  private async runSingleCheck(check: WorkspaceCheck): Promise<QualityCheckSummary> {
    const start = Date.now();
    try {
      const parts = check.command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [check.command];
      const cleanParts = parts.map((p) => p.replace(/^["']|["']$/g, ''));

      const proc = Bun.spawn(cleanParts, {
        cwd: this.workspacePath,
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, FORCE_COLOR: '0', CI: '1' },
      });

      let timedOut = false;
      const timeoutId = setTimeout(() => {
        timedOut = true;
        proc.kill();
      }, check.timeout);

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      clearTimeout(timeoutId);

      const rawOutput = (stdout + '\n' + stderr).trim();
      const passed = exitCode === 0;
      const filtered = passed ? '' : parseCheckOutput(rawOutput, check.type);
      const errorCount = passed ? 0 : (filtered.match(/\b(error|Error)\b/g) || []).length;

      return {
        name: check.name,
        type: check.type,
        passed,
        errorCount,
        output: timedOut ? `[TIMEOUT after ${check.timeout}ms]` : filtered.slice(0, 8000),
        duration: Date.now() - start,
      };
    } catch (err) {
      return {
        name: check.name,
        type: check.type,
        passed: true, // Don't block on infra errors
        errorCount: 0,
        output: `Check error: ${String(err).slice(0, 500)}`,
        duration: Date.now() - start,
      };
    }
  }

  private buildSummary(
    files: string[],
    syntaxFailed: VerificationResult[],
    qualityFailed: QualityCheckSummary[],
    duration: number,
  ): string {
    if (syntaxFailed.length === 0 && qualityFailed.length === 0) {
      return `Verified ${files.length} modified file(s) — all checks passed (${duration}ms)`;
    }

    const parts: string[] = [];
    parts.push(`Post-turn verification found issues in ${files.length} modified file(s):`);

    if (syntaxFailed.length > 0) {
      parts.push('');
      parts.push('Syntax errors:');
      for (const r of syntaxFailed) {
        for (const issue of r.issues) {
          parts.push(`  ${r.filePath}${issue.line ? `:${issue.line}` : ''} — ${issue.message}`);
        }
      }
    }

    if (qualityFailed.length > 0) {
      parts.push('');
      for (const r of qualityFailed) {
        parts.push(`${r.name} (${r.errorCount} error(s)):`);
        if (r.output) {
          // Indent and truncate
          const lines = r.output.split('\n').slice(0, 20);
          parts.push(...lines.map((l) => `  ${l}`));
          if (r.output.split('\n').length > 20) {
            parts.push('  ... (truncated)');
          }
        }
      }
    }

    parts.push('');
    parts.push(`Verification took ${duration}ms`);
    return parts.join('\n');
  }
}

interface WorkspaceCheck {
  name: string;
  type: string;
  command: string;
  timeout: number;
  scopeable: boolean;
}
