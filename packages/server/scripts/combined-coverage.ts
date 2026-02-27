#!/usr/bin/env bun
/**
 * Compute combined server test coverage across isolated test groups.
 * Takes the MAX per-file coverage and computes a weighted average
 * using actual source line counts.
 */
import { $ } from 'bun';

const groups = [
  { name: 'database', files: ['src/db/__tests__/database.test.ts'] },
  { name: 'llm-oneshot', files: ['src/services/__tests__/llm-oneshot.test.ts'] },
  {
    name: 'providers+schemas',
    files: [
      'src/services/__tests__/ollama-provider.test.ts',
      'src/services/__tests__/tool-schemas.test.ts',
    ],
  },
  {
    name: 'openai+gemini',
    files: [
      'src/services/__tests__/openai-provider-v2.test.ts',
      'src/services/__tests__/gemini-provider-v2.test.ts',
    ],
  },
  {
    name: 'conversations+memory',
    files: [
      'src/routes/__tests__/conversations.test.ts',
      'src/routes/__tests__/project-memory.test.ts',
    ],
  },
  {
    name: 'remaining',
    files: [
      'src/routes/__tests__/git.test.ts',
      'src/routes/__tests__/git-commit-stream.test.ts',
      'src/routes/__tests__/mcp.test.ts',
      'src/routes/__tests__/prd.test.ts',
      'src/routes/__tests__/settings.test.ts',
      'src/routes/__tests__/tasks.test.ts',
      'src/routes/__tests__/tools.test.ts',
      'src/middleware',
      'src/services/__tests__/auth.test.ts',
      'src/services/__tests__/chat-compaction.test.ts',
      'src/services/__tests__/claude-process.test.ts',
      'src/services/__tests__/cli-provider.test.ts',
      'src/services/__tests__/code-verifier.test.ts',
      'src/services/__tests__/commentator.test.ts',
      'src/services/__tests__/cost-calculator.test.ts',
      'src/services/__tests__/event-bridge.test.ts',
      'src/services/__tests__/mcp-config.test.ts',
      'src/services/__tests__/mcp-discovery.test.ts',
      'src/services/__tests__/mcp-tool-adapter.test.ts',
      'src/services/__tests__/permission-rules.test.ts',
      'src/services/__tests__/tool-executor.test.ts',
    ],
  },
];

const coverageRe = /^\s+(\S+\.ts)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|/;

async function runGroup(files: string[]) {
  const result = await $`bun test --coverage ${files} 2>&1`.text();
  const map = new Map<string, number>();
  for (const line of result.split('\n')) {
    const m = coverageRe.exec(line);
    if (m) map.set(m[1], parseFloat(m[3]));
  }
  const passMatch = result.match(/(\d+)\s+pass/);
  const failMatch = result.match(/(\d+)\s+fail/);
  return {
    coverage: map,
    pass: passMatch ? parseInt(passMatch[1]) : 0,
    fail: failMatch ? parseInt(failMatch[1]) : 0,
  };
}

// Count source lines per file (excluding blanks and comments)
async function countLines(filePath: string): Promise<number> {
  try {
    const text = await Bun.file(filePath).text();
    return text.split('\n').filter((l) => l.trim().length > 0).length;
  } catch {
    return 0;
  }
}

let totalPass = 0,
  totalFail = 0;
const best = new Map<string, number>();

for (const group of groups) {
  process.stderr.write(`  Running: ${group.name}...\n`);
  const r = await runGroup(group.files);
  totalPass += r.pass;
  totalFail += r.fail;
  for (const [f, pct] of r.coverage) {
    best.set(f, Math.max(best.get(f) ?? 0, pct));
  }
}

// Get line counts for all tracked files
const filePaths = [...best.keys()].map((f) => (f.startsWith('../') ? `../${f.slice(3)}` : f));
let totalLines = 0,
  coveredLines = 0;

const rows: { file: string; lines: number; pct: number; covered: number }[] = [];
for (const file of best.keys()) {
  const resolvedPath = file.startsWith('../')
    ? `/home/nicole/maude/packages/${file.slice(3)}`
    : `/home/nicole/maude/packages/server/${file}`;
  const lines = await countLines(resolvedPath);
  const pct = best.get(file)!;
  const covered = Math.round((lines * pct) / 100);
  rows.push({ file, lines, pct, covered });
  totalLines += lines;
  coveredLines += covered;
}

rows.sort((a, b) => a.pct - b.pct);

console.log('\n═══════════════════════════════════════════════════════');
console.log(' Server Combined Coverage (best per-file across groups)');
console.log('═══════════════════════════════════════════════════════\n');

for (const { file, lines, pct } of rows) {
  const icon = pct >= 90 ? '✓' : pct >= 80 ? '~' : '✗';
  console.log(
    `  ${icon} ${pct.toFixed(1).padStart(6)}%  (${String(lines).padStart(4)} lines)  ${file}`,
  );
}

const overall = totalLines > 0 ? (coveredLines / totalLines) * 100 : 0;
console.log(`\n  Tests: ${totalPass} pass / ${totalFail} fail`);
console.log(`  Lines: ${coveredLines}/${totalLines} = ${overall.toFixed(1)}% (weighted)`);
console.log(`  Target: 90%  ${overall >= 90 ? '✓ PASSED' : '✗ NEEDS WORK'}`);
