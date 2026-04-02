/**
 * Codebase Init Scan Service
 *
 * Scans a repository and generates project context/rules automatically.
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { join, extname, basename } from 'path';
import type { CodebaseProfile, CodeConvention, InitScanResult, InitScanConfig } from '@e/shared';
import { DEFAULT_INIT_SCAN_CONFIG } from '@e/shared';

class CodebaseInitService {
  private static instance: CodebaseInitService;

  static getInstance(): CodebaseInitService {
    if (!CodebaseInitService.instance) {
      CodebaseInitService.instance = new CodebaseInitService();
    }
    return CodebaseInitService.instance;
  }

  /**
   * Scan a workspace and generate a profile + rules.
   */
  scan(workspacePath: string, config?: Partial<InitScanConfig>): InitScanResult {
    const cfg = { ...DEFAULT_INIT_SCAN_CONFIG, ...config };
    const start = Date.now();
    const profile = this.buildProfile(workspacePath, cfg);
    const generatedRules = this.generateRules(profile);
    const suggestedRulesFile = this.formatRulesFile(profile, generatedRules);
    const scannedFiles = this.countFiles(workspacePath, cfg.maxDepth);

    return {
      profile,
      generatedRules,
      suggestedRulesFile,
      scannedFiles,
      durationMs: Date.now() - start,
    };
  }

  private buildProfile(workspacePath: string, config: InitScanConfig): CodebaseProfile {
    const languages = new Set<string>();
    const frameworks = new Set<string>();
    const configFiles: string[] = [];
    const entryPoints: string[] = [];
    let packageManager: CodebaseProfile['packageManager'];
    let buildSystem: string | undefined;
    let testFramework: string | undefined;
    let hasTypeScript = false;
    let hasCi = false;
    let hasDocker = false;
    let readmeExcerpt: string | undefined;
    let packages: string[] | undefined;
    let name = basename(workspacePath);
    const conventions: CodeConvention[] = [];

    // Check root files
    const rootFiles = this.safeReaddir(workspacePath);

    // package.json
    if (rootFiles.includes('package.json')) {
      try {
        const pkg = JSON.parse(readFileSync(join(workspacePath, 'package.json'), 'utf-8'));
        name = pkg.name || name;
        if (pkg.workspaces) {
          packages = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces.packages;
        }
        // Detect frameworks from deps
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (allDeps.svelte || allDeps['@sveltejs/kit']) frameworks.add('SvelteKit');
        if (allDeps.react) frameworks.add('React');
        if (allDeps.vue) frameworks.add('Vue');
        if (allDeps.next) frameworks.add('Next.js');
        if (allDeps.hono) frameworks.add('Hono');
        if (allDeps.express) frameworks.add('Express');
        if (allDeps.fastify) frameworks.add('Fastify');
        if (allDeps.vitest) testFramework = 'Vitest';
        else if (allDeps.jest) testFramework = 'Jest';
        else if (allDeps.mocha) testFramework = 'Mocha';
        if (allDeps.typescript) hasTypeScript = true;
        if (allDeps.vite) buildSystem = 'Vite';
        else if (allDeps.webpack) buildSystem = 'Webpack';
        else if (allDeps.esbuild) buildSystem = 'esbuild';
        if (pkg.scripts?.build) buildSystem = buildSystem || 'npm scripts';
      } catch {}
      configFiles.push('package.json');
    }

    // Package manager detection
    if (rootFiles.includes('bun.lockb') || rootFiles.includes('bunfig.toml'))
      packageManager = 'bun';
    else if (rootFiles.includes('pnpm-lock.yaml')) packageManager = 'pnpm';
    else if (rootFiles.includes('yarn.lock')) packageManager = 'yarn';
    else if (rootFiles.includes('package-lock.json')) packageManager = 'npm';
    else if (rootFiles.includes('Cargo.toml')) packageManager = 'cargo';
    else if (rootFiles.includes('go.mod')) packageManager = 'go';
    else if (rootFiles.includes('requirements.txt') || rootFiles.includes('pyproject.toml'))
      packageManager = 'pip';

    // TypeScript
    if (rootFiles.includes('tsconfig.json')) {
      hasTypeScript = true;
      configFiles.push('tsconfig.json');
    }

    // CI/CD
    if (existsSync(join(workspacePath, '.github/workflows'))) hasCi = true;
    if (rootFiles.includes('.gitlab-ci.yml')) hasCi = true;
    if (rootFiles.includes('Jenkinsfile')) hasCi = true;

    // Docker
    if (rootFiles.includes('Dockerfile') || rootFiles.includes('docker-compose.yml'))
      hasDocker = true;

    // README
    const readmeFile = rootFiles.find((f) => /^readme/i.test(f));
    if (readmeFile) {
      try {
        const content = readFileSync(join(workspacePath, readmeFile), 'utf-8');
        readmeExcerpt = content.slice(0, 500);
      } catch {}
    }

    // Scan source files for language detection
    const langCounts = new Map<string, number>();
    this.walkFiles(
      workspacePath,
      config.maxDepth,
      (filePath) => {
        const ext = extname(filePath);
        const lang = this.extToLang(ext);
        if (lang) {
          languages.add(lang);
          langCounts.set(lang, (langCounts.get(lang) || 0) + 1);
        }
        // Entry points
        const base = basename(filePath);
        if (
          [
            'index.ts',
            'index.js',
            'main.ts',
            'main.js',
            'app.ts',
            'app.js',
            'main.py',
            'main.rs',
            'main.go',
          ].includes(base)
        ) {
          entryPoints.push(filePath.replace(workspacePath + '/', ''));
        }
      },
      config.maxFiles,
    );

    // Other config files
    for (const f of rootFiles) {
      if (/^(\.eslintrc|\.prettierrc|svelte\.config|vite\.config|tailwind\.config)/i.test(f)) {
        configFiles.push(f);
      }
    }

    // Detect conventions from config files
    if (rootFiles.some((f) => f.startsWith('.eslintrc'))) {
      conventions.push({ type: 'other', value: 'ESLint configured', confidence: 1 });
    }
    if (rootFiles.some((f) => f.startsWith('.prettierrc'))) {
      conventions.push({ type: 'other', value: 'Prettier configured', confidence: 1 });
    }
    if (hasTypeScript) {
      conventions.push({ type: 'other', value: 'TypeScript strict mode likely', confidence: 0.8 });
    }

    // Detect indent style from a sample file
    if (config.readContents) {
      this.detectIndentConvention(workspacePath, conventions);
    }

    return {
      name,
      languages: [...languages].sort((a, b) => (langCounts.get(b) || 0) - (langCounts.get(a) || 0)),
      frameworks: [...frameworks],
      packageManager,
      packages,
      buildSystem,
      testFramework,
      hasTypeScript,
      hasCi,
      hasDocker,
      entryPoints: entryPoints.slice(0, 10),
      readmeExcerpt,
      configFiles,
      conventions,
    };
  }

  private generateRules(profile: CodebaseProfile): string {
    const rules: string[] = [];

    rules.push(`Project: ${profile.name}`);
    rules.push(`Languages: ${profile.languages.join(', ')}`);
    if (profile.frameworks.length) rules.push(`Frameworks: ${profile.frameworks.join(', ')}`);
    if (profile.packageManager) rules.push(`Package manager: ${profile.packageManager}`);
    if (profile.testFramework) rules.push(`Tests: ${profile.testFramework}`);
    if (profile.hasTypeScript) rules.push('TypeScript: enabled — maintain strict types');
    if (profile.packages) rules.push(`Monorepo packages: ${profile.packages.join(', ')}`);
    if (profile.buildSystem) rules.push(`Build: ${profile.buildSystem}`);

    rules.push('');
    rules.push('Guidelines:');
    if (profile.hasTypeScript) {
      rules.push('- Use TypeScript for all new code. Avoid `any` types.');
      rules.push('- Export types from shared packages for cross-package use.');
    }
    if (profile.testFramework) {
      rules.push(`- Write tests using ${profile.testFramework}. Run tests before committing.`);
    }
    if (profile.conventions.length) {
      for (const c of profile.conventions) {
        if (c.confidence > 0.7) rules.push(`- ${c.value}`);
      }
    }

    return rules.join('\n');
  }

  private formatRulesFile(profile: CodebaseProfile, rules: string): string {
    const lines: string[] = [];
    lines.push(`# ${profile.name} — Project Rules`);
    lines.push('');
    lines.push('> Auto-generated by E init scan. Edit as needed.');
    lines.push('');
    lines.push(rules);
    lines.push('');
    if (profile.entryPoints.length) {
      lines.push('## Entry Points');
      for (const ep of profile.entryPoints) lines.push(`- \`${ep}\``);
      lines.push('');
    }
    if (profile.configFiles.length) {
      lines.push('## Config Files');
      for (const cf of profile.configFiles) lines.push(`- \`${cf}\``);
    }
    return lines.join('\n');
  }

  private detectIndentConvention(workspacePath: string, conventions: CodeConvention[]): void {
    const sampleFiles = ['src/index.ts', 'src/main.ts', 'src/app.ts', 'index.ts'];
    for (const f of sampleFiles) {
      const full = join(workspacePath, f);
      if (!existsSync(full)) continue;
      try {
        const content = readFileSync(full, 'utf-8');
        const lines = content.split('\n').filter((l) => l.startsWith(' ') || l.startsWith('\t'));
        if (lines.length < 3) continue;
        const tabs = lines.filter((l) => l.startsWith('\t')).length;
        const spaces = lines.filter((l) => l.startsWith('  ')).length;
        if (tabs > spaces) {
          conventions.push({ type: 'indent', value: 'tabs', confidence: tabs / (tabs + spaces) });
        } else {
          const twoSpace = lines.filter((l) => l.match(/^  [^ ]/)).length;
          const fourSpace = lines.filter((l) => l.match(/^    [^ ]/)).length;
          const size = fourSpace > twoSpace ? 4 : 2;
          conventions.push({
            type: 'indent',
            value: `${size} spaces`,
            confidence: spaces / (tabs + spaces),
          });
        }
        break;
      } catch {}
    }
  }

  private walkFiles(
    dir: string,
    maxDepth: number,
    cb: (path: string) => void,
    maxFiles: number,
    depth = 0,
    count = { n: 0 },
  ): void {
    if (depth >= maxDepth || count.n >= maxFiles) return;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (count.n >= maxFiles) return;
        if (
          entry.name.startsWith('.') ||
          entry.name === 'node_modules' ||
          entry.name === 'dist' ||
          entry.name === 'build'
        )
          continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          this.walkFiles(full, maxDepth, cb, maxFiles, depth + 1, count);
        } else if (entry.isFile()) {
          cb(full);
          count.n++;
        }
      }
    } catch {}
  }

  private countFiles(dir: string, maxDepth: number): number {
    let count = 0;
    this.walkFiles(dir, maxDepth, () => count++, 10000);
    return count;
  }

  private safeReaddir(dir: string): string[] {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  }

  private extToLang(ext: string): string | null {
    const map: Record<string, string> = {
      '.ts': 'TypeScript',
      '.tsx': 'TypeScript',
      '.js': 'JavaScript',
      '.jsx': 'JavaScript',
      '.py': 'Python',
      '.rs': 'Rust',
      '.go': 'Go',
      '.java': 'Java',
      '.c': 'C',
      '.cpp': 'C++',
      '.cs': 'C#',
      '.rb': 'Ruby',
      '.svelte': 'Svelte',
      '.vue': 'Vue',
      '.html': 'HTML',
      '.css': 'CSS',
    };
    return map[ext] || null;
  }
}

export const codebaseInit = CodebaseInitService.getInstance();
