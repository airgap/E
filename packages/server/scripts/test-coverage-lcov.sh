#!/bin/bash
# Generate merged coverage report for server tests.
# Runs tests in isolated groups to avoid mock.module contamination,
# collects lcov from each group, and merges into a single report.
set -e
cd "$(dirname "$0")/.."

rm -rf coverage
mkdir -p coverage/{g1,g2,g3,g4,g5}

echo "──── Group 1: database ────"
bun test --coverage --coverage-reporter=lcov --coverage-dir=coverage/g1 \
  src/db/__tests__/database.test.ts 2>&1 | tail -2

echo "──── Group 2: llm-oneshot ────"
bun test --coverage --coverage-reporter=lcov --coverage-dir=coverage/g2 \
  src/services/__tests__/llm-oneshot.test.ts 2>&1 | tail -2

echo "──── Group 3: providers + tool-schemas ────"
bun test --coverage --coverage-reporter=lcov --coverage-dir=coverage/g3 \
  src/services/__tests__/ollama-provider.test.ts \
  src/services/__tests__/tool-schemas.test.ts 2>&1 | tail -2

echo "──── Group 4: openai + gemini ────"
bun test --coverage --coverage-reporter=lcov --coverage-dir=coverage/g4 \
  src/services/__tests__/openai-provider-v2.test.ts \
  src/services/__tests__/gemini-provider-v2.test.ts 2>&1 | tail -2

echo "──── Group 5: everything else ────"
bun test --coverage --coverage-reporter=lcov --coverage-dir=coverage/g5 \
  src/routes \
  src/middleware \
  src/services/__tests__/auth.test.ts \
  src/services/__tests__/chat-compaction.test.ts \
  src/services/__tests__/claude-process.test.ts \
  src/services/__tests__/cli-provider.test.ts \
  src/services/__tests__/code-verifier.test.ts \
  src/services/__tests__/commentator.test.ts \
  src/services/__tests__/cost-calculator.test.ts \
  src/services/__tests__/event-bridge.test.ts \
  src/services/__tests__/mcp-config.test.ts \
  src/services/__tests__/mcp-discovery.test.ts \
  src/services/__tests__/mcp-tool-adapter.test.ts \
  src/services/__tests__/permission-rules.test.ts \
  src/services/__tests__/tool-executor.test.ts 2>&1 | tail -2

echo ""
echo "──── Merging lcov reports ────"

# Find all lcov files
LCOV_FILES=""
for dir in coverage/g{1,2,3,4,5}; do
  lcov_file=$(find "$dir" -name 'lcov.info' 2>/dev/null | head -1)
  if [ -n "$lcov_file" ]; then
    LCOV_FILES="$LCOV_FILES -a $lcov_file"
  fi
done

if [ -z "$LCOV_FILES" ]; then
  echo "No lcov files found!"
  exit 1
fi

lcov $LCOV_FILES -o coverage/merged.lcov --rc lcov_branch_coverage=1 2>/dev/null

echo ""
echo "──── Combined Coverage Summary ────"
lcov --summary coverage/merged.lcov --rc lcov_branch_coverage=1 2>&1 | grep -E '(lines|functions|branches)'
