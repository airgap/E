#!/usr/bin/env bun
// ---------------------------------------------------------------------------
// e-golem — Headless golem binary entry point
// ---------------------------------------------------------------------------
// Usage:
//   e-golem run --spec <path>       Run a story from a JSON spec file
//   e-golem run                     Run using GOLEM_SPEC env var (JSON string or file path)
//   e-golem version                 Print version info
//   e-golem help                    Show help
//
// Exit codes:
//   0 = success (story completed, all quality checks passed)
//   1 = story failure (agent error or quality check failure)
//   2 = infrastructure failure (clone failed, coordinator unreachable, etc.)
//   3 = timeout (execution exceeded time limit)
// ---------------------------------------------------------------------------

import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { GolemSpec, GolemExitCodeValue } from '@e/shared';
import { GolemExitCode, GOLEM_DEFAULTS } from '@e/shared';
import { GolemRunner } from './runner.js';

const VERSION = '0.1.0';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function printHelp(): void {
  const help = `
e-golem — Headless golem binary for remote story execution

USAGE:
  e-golem run --spec <path>       Run a story from a JSON spec file
  e-golem run                     Run using GOLEM_SPEC env var
  e-golem version                 Print version info
  e-golem help                    Show this help message

SPEC FILE:
  JSON file with the following structure:
  {
    "repoUrl": "https://github.com/org/repo.git",
    "branch": "main",
    "story": {
      "storyId": "story-123",
      "title": "Implement feature X",
      "description": "...",
      "acceptanceCriteria": ["criterion 1", "criterion 2"]
    },
    "llm": {
      "model": "claude-sonnet-4-6",
      "apiKey": "sk-..."
    },
    "coordinatorUrl": "https://e-server.example.com/api/story-coordination",
    "qualityChecks": [...]
  }

ENVIRONMENT VARIABLES:
  GOLEM_SPEC              JSON string or file path for the spec
  GOLEM_REPO_URL          Repository URL to clone
  GOLEM_BRANCH            Branch to clone (default: main)
  GOLEM_STORY_ID          Story ID
  GOLEM_STORY_TITLE       Story title
  GOLEM_STORY_DESC        Story description
  GOLEM_STORY_AC          Acceptance criteria (JSON array or newline-separated)
  GOLEM_LLM_MODEL         LLM model (default: ${GOLEM_DEFAULTS.model})
  GOLEM_COORDINATOR_URL   Coordinator callback URL
  GOLEM_EXECUTOR_ID       Executor ID (auto-generated if not set)
  GOLEM_MACHINE_ID        Machine ID (defaults to hostname)
  GOLEM_TIMEOUT_MS        Execution timeout in ms (default: ${GOLEM_DEFAULTS.timeoutMs})
  GOLEM_HEALTH_PORT       Health check port (default: ${GOLEM_DEFAULTS.healthPort}, 0 to disable)
  GOLEM_LOG_STREAM_URL    WebSocket URL for log streaming
  GOLEM_WORK_DIR          Working directory override
  GOLEM_MAX_TURNS         Max agent turns before stopping (default: 50)
  ANTHROPIC_API_KEY       Anthropic API key

EXIT CODES:
  0  Success — story completed, all quality checks passed
  1  Story failure — agent error or quality check failure
  2  Infrastructure failure — clone, coordinator, or runtime error
  3  Timeout — execution exceeded time limit
`.trim();

  console.log(help);
}

function printVersion(): void {
  console.log(`e-golem v${VERSION}`);
}

// ---------------------------------------------------------------------------
// Spec resolution — from file, env var JSON, or individual env vars
// ---------------------------------------------------------------------------

function resolveSpec(specPath?: string): GolemSpec {
  // 1. Explicit spec file path
  if (specPath) {
    const absPath = resolve(specPath);
    try {
      const content = readFileSync(absPath, 'utf-8');
      return JSON.parse(content) as GolemSpec;
    } catch (err) {
      throw new Error(`Failed to read spec file at ${absPath}: ${String(err)}`);
    }
  }

  // 2. GOLEM_SPEC env var — could be JSON string or file path
  const specEnv = process.env.GOLEM_SPEC;
  if (specEnv) {
    // Try as JSON first
    if (specEnv.trim().startsWith('{')) {
      try {
        return JSON.parse(specEnv) as GolemSpec;
      } catch (err) {
        throw new Error(`Failed to parse GOLEM_SPEC as JSON: ${String(err)}`);
      }
    }

    // Try as file path
    const absPath = resolve(specEnv);
    try {
      const content = readFileSync(absPath, 'utf-8');
      return JSON.parse(content) as GolemSpec;
    } catch (err) {
      throw new Error(`Failed to read GOLEM_SPEC file at ${absPath}: ${String(err)}`);
    }
  }

  // 3. Individual env vars
  const repoUrl = process.env.GOLEM_REPO_URL;
  const storyId = process.env.GOLEM_STORY_ID;
  const storyTitle = process.env.GOLEM_STORY_TITLE;
  const storyDesc = process.env.GOLEM_STORY_DESC;

  if (!repoUrl || !storyId) {
    throw new Error(
      'No spec provided. Use --spec <path>, GOLEM_SPEC env var, or set GOLEM_REPO_URL + GOLEM_STORY_ID env vars.',
    );
  }

  // Parse acceptance criteria — JSON array or newline-separated
  let acceptanceCriteria: string[] = [];
  const acEnv = process.env.GOLEM_STORY_AC;
  if (acEnv) {
    if (acEnv.trim().startsWith('[')) {
      try {
        acceptanceCriteria = JSON.parse(acEnv);
      } catch {
        acceptanceCriteria = acEnv.split('\n').filter(Boolean);
      }
    } else {
      acceptanceCriteria = acEnv.split('\n').filter(Boolean);
    }
  }

  return {
    repoUrl,
    branch: process.env.GOLEM_BRANCH || 'main',
    story: {
      storyId,
      title: storyTitle || storyId,
      description: storyDesc || '',
      acceptanceCriteria,
    },
    llm: {
      model: process.env.GOLEM_LLM_MODEL || GOLEM_DEFAULTS.model,
    },
    coordinatorUrl: process.env.GOLEM_COORDINATOR_URL,
    executorId: process.env.GOLEM_EXECUTOR_ID,
    machineId: process.env.GOLEM_MACHINE_ID,
    timeoutMs: process.env.GOLEM_TIMEOUT_MS ? Number(process.env.GOLEM_TIMEOUT_MS) : undefined,
    healthPort: process.env.GOLEM_HEALTH_PORT ? Number(process.env.GOLEM_HEALTH_PORT) : undefined,
    logStreamUrl: process.env.GOLEM_LOG_STREAM_URL,
    workDir: process.env.GOLEM_WORK_DIR,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<GolemExitCodeValue> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return GolemExitCode.SUCCESS;
  }

  if (command === 'version' || command === '--version' || command === '-v') {
    printVersion();
    return GolemExitCode.SUCCESS;
  }

  if (command !== 'run') {
    console.error(`Unknown command: ${command}. Run 'e-golem help' for usage.`);
    return GolemExitCode.INFRA_FAILURE;
  }

  // Parse --spec flag
  let specPath: string | undefined;
  const specIdx = args.indexOf('--spec');
  if (specIdx !== -1 && args[specIdx + 1]) {
    specPath = args[specIdx + 1];
  }

  // Resolve spec
  let spec: GolemSpec;
  try {
    spec = resolveSpec(specPath);
  } catch (err) {
    console.error(`Error: ${String(err)}`);
    return GolemExitCode.INFRA_FAILURE;
  }

  // Create and run the golem
  const runner = new GolemRunner(spec);

  // Register signal handlers for graceful shutdown
  let shutdownPromise: Promise<void> | null = null;

  const handleSignal = () => {
    if (!shutdownPromise) {
      shutdownPromise = runner.shutdown();
    }
  };

  process.on('SIGTERM', handleSignal);
  process.on('SIGINT', handleSignal);

  try {
    const result = await runner.run();
    return result.exitCode;
  } catch (err) {
    console.error(`Fatal error: ${String(err)}`);
    return GolemExitCode.INFRA_FAILURE;
  } finally {
    process.off('SIGTERM', handleSignal);
    process.off('SIGINT', handleSignal);
  }
}

// Run and exit with the appropriate code
main().then((code) => {
  process.exit(code);
});
