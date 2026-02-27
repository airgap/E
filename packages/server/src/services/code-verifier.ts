import { extname } from 'path';

interface VerificationResult {
  filePath: string;
  passed: boolean;
  issues: Array<{
    severity: 'error' | 'warning' | 'info';
    line?: number;
    message: string;
    rule?: string;
  }>;
  tool: string;
  duration: number;
}

const VERIFIER_MAP: Record<
  string,
  { command: string[]; parser: (output: string, filePath: string) => VerificationResult['issues'] }
> = {
  '.ts': {
    command: ['npx', 'tsc', '--noEmit', '--pretty', 'false'],
    parser: parseTscOutput,
  },
  '.tsx': {
    command: ['npx', 'tsc', '--noEmit', '--pretty', 'false'],
    parser: parseTscOutput,
  },
  '.js': {
    command: ['npx', 'eslint', '--format', 'json', '--no-eslintrc'],
    parser: parseEslintJsonOutput,
  },
  '.jsx': {
    command: ['npx', 'eslint', '--format', 'json', '--no-eslintrc'],
    parser: parseEslintJsonOutput,
  },
  '.py': {
    command: ['python3', '-m', 'py_compile'],
    parser: parsePythonOutput,
  },
  '.rs': {
    command: ['cargo', 'check', '--message-format=short'],
    parser: parseCargoOutput,
  },
};

/**
 * Run verification on a file that was just written/edited by the AI agent.
 * Returns issues found, or an empty array if the file passes or no verifier is available.
 */
export async function verifyFile(
  filePath: string,
  workspacePath: string,
): Promise<VerificationResult> {
  const ext = extname(filePath).toLowerCase();
  const start = Date.now();

  // For TypeScript/JS, try to run a quick syntax check
  if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx') {
    return runSyntaxCheck(filePath, workspacePath, ext, start);
  }

  if (ext === '.py') {
    return runPythonCheck(filePath, start);
  }

  // No verifier available — pass by default
  return {
    filePath,
    passed: true,
    issues: [],
    tool: 'none',
    duration: Date.now() - start,
  };
}

async function runSyntaxCheck(
  filePath: string,
  workspacePath: string,
  ext: string,
  start: number,
): Promise<VerificationResult> {
  try {
    // Try Bun's transpiler for a quick syntax check (fastest option)
    const file = Bun.file(filePath);
    const content = await file.text();

    // Use Bun's built-in transpiler to check syntax
    const transpiler = new Bun.Transpiler({
      loader: ext === '.tsx' ? 'tsx' : ext === '.ts' ? 'ts' : ext === '.jsx' ? 'jsx' : 'js',
    });

    try {
      transpiler.transformSync(content);
      return {
        filePath,
        passed: true,
        issues: [],
        tool: 'bun-transpiler',
        duration: Date.now() - start,
      };
    } catch (err: any) {
      const message = String(err.message || err);
      // Extract line info if available
      const lineMatch = message.match(/:(\d+):/);
      return {
        filePath,
        passed: false,
        issues: [
          {
            severity: 'error',
            line: lineMatch ? parseInt(lineMatch[1]) : undefined,
            message: message.slice(0, 500),
            rule: 'syntax-error',
          },
        ],
        tool: 'bun-transpiler',
        duration: Date.now() - start,
      };
    }
  } catch {
    return {
      filePath,
      passed: true,
      issues: [],
      tool: 'none',
      duration: Date.now() - start,
    };
  }
}

async function runPythonCheck(filePath: string, start: number): Promise<VerificationResult> {
  try {
    const proc = Bun.spawn(['python3', '-m', 'py_compile', filePath], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode === 0) {
      return {
        filePath,
        passed: true,
        issues: [],
        tool: 'py_compile',
        duration: Date.now() - start,
      };
    }

    return {
      filePath,
      passed: false,
      issues: parsePythonOutput(stderr, filePath),
      tool: 'py_compile',
      duration: Date.now() - start,
    };
  } catch {
    return {
      filePath,
      passed: true,
      issues: [],
      tool: 'none',
      duration: Date.now() - start,
    };
  }
}

function parseTscOutput(output: string, filePath: string): VerificationResult['issues'] {
  const issues: VerificationResult['issues'] = [];
  const lines = output.split('\n');
  for (const line of lines) {
    if (line.includes(filePath)) {
      const match = line.match(/\((\d+),\d+\): (error|warning) (TS\d+): (.+)/);
      if (match) {
        issues.push({
          severity: match[2] as 'error' | 'warning',
          line: parseInt(match[1]),
          message: match[4],
          rule: match[3],
        });
      }
    }
  }
  return issues;
}

function parseEslintJsonOutput(output: string, _filePath: string): VerificationResult['issues'] {
  try {
    const results = JSON.parse(output);
    const issues: VerificationResult['issues'] = [];
    for (const result of results) {
      for (const msg of result.messages || []) {
        issues.push({
          severity: msg.severity === 2 ? 'error' : 'warning',
          line: msg.line,
          message: msg.message,
          rule: msg.ruleId,
        });
      }
    }
    return issues;
  } catch {
    return [];
  }
}

function parsePythonOutput(output: string, _filePath: string): VerificationResult['issues'] {
  const issues: VerificationResult['issues'] = [];
  const match = output.match(/line (\d+)/);
  if (output.trim()) {
    issues.push({
      severity: 'error',
      line: match ? parseInt(match[1]) : undefined,
      message: output.trim().slice(0, 500),
      rule: 'syntax-error',
    });
  }
  return issues;
}

function parseCargoOutput(output: string, _filePath: string): VerificationResult['issues'] {
  const issues: VerificationResult['issues'] = [];
  for (const line of output.split('\n')) {
    if (line.startsWith('error')) {
      issues.push({ severity: 'error', message: line.slice(0, 500) });
    } else if (line.startsWith('warning')) {
      issues.push({ severity: 'warning', message: line.slice(0, 500) });
    }
  }
  return issues;
}

export type { VerificationResult };
