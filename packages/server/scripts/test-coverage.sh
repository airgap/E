#!/bin/bash
# Run server tests in isolated groups to avoid mock.module contamination.
# bun's mock.module() is global — mocks from one test file bleed into others
# when they target the same resolved module path. Running contaminated tests
# in separate bun processes solves this.
#
# Usage: bash scripts/test-coverage.sh        # coverage report
#        bash scripts/test-coverage.sh --text  # text-only (no lcov merge)

set -e

cd "$(dirname "$0")/.."

PASS=0
FAIL=0
TOTAL=0

run_group() {
  local label="$1"
  shift
  echo "──── $label ────"
  local output
  output=$(bun test "$@" 2>&1) || true
  echo "$output" | tail -3

  # Extract pass/fail counts
  local p f
  p=$(echo "$output" | grep -oP '\d+(?= pass)' | tail -1)
  f=$(echo "$output" | grep -oP '\d+(?= fail)' | tail -1)
  PASS=$((PASS + ${p:-0}))
  FAIL=$((FAIL + ${f:-0}))
}

# Group 1: database.test.ts (needs real db/database module — mocked by almost all other files)
run_group "database (isolated)" src/db/__tests__/database.test.ts

# Group 2: llm-oneshot.test.ts (needs real llm-oneshot — mocked by settings.test.ts)
run_group "llm-oneshot (isolated)" src/services/__tests__/llm-oneshot.test.ts

# Group 3: service tests that need their real modules (contaminated by settings.test.ts and provider tests)
run_group "providers + tool-schemas (isolated)" \
  src/services/__tests__/ollama-provider.test.ts \
  src/services/__tests__/tool-schemas.test.ts

# Group 4: provider tests that mock tool-schemas (run separately from tool-schemas.test.ts)
run_group "openai + gemini providers (isolated)" \
  src/services/__tests__/openai-provider-v2.test.ts \
  src/services/__tests__/gemini-provider-v2.test.ts

# Group 5: route tests that mock service modules (would contaminate service tests in Group 6)
#   conversations.test.ts mocks chat-compaction — contaminates chat-compaction.test.ts
#   project-memory.test.ts mocks memory-extractor — could contaminate future tests
run_group "conversations + project-memory (isolated)" \
  src/routes/__tests__/conversations.test.ts \
  src/routes/__tests__/project-memory.test.ts

# Group 6a: worktree tests (use require() cache clearing + in-memory SQLite — must be isolated)
run_group "worktree merge + db (isolated)" \
  src/services/__tests__/worktree-merge.test.ts \
  src/services/__tests__/worktree-db.test.ts

# Group 6b: worktree route tests (mocks worktree-service — must be isolated from service tests)
run_group "worktree routes (isolated)" \
  src/routes/__tests__/worktrees.test.ts

# Group 6c: worktree service tests (uses real worktree-service — must be isolated from route mocks)
run_group "worktree service (isolated)" \
  src/services/__tests__/worktree-service.test.ts

# Group 6d: worktree lifecycle tests (mocks worktree-service + db — must be isolated from service tests)
run_group "worktree lifecycle (isolated)" \
  src/services/__tests__/worktree-lifecycle.test.ts

# Group 7: everything else (no contamination issues among these)
run_group "routes + remaining services" \
  src/routes/__tests__/git.test.ts \
  src/routes/__tests__/git-commit-stream.test.ts \
  src/routes/__tests__/mcp.test.ts \
  src/routes/__tests__/prd.test.ts \
  src/routes/__tests__/settings.test.ts \
  src/routes/__tests__/tasks.test.ts \
  src/routes/__tests__/tools.test.ts \
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
  src/services/__tests__/lsp-instance-manager.test.ts \
  src/services/__tests__/permission-rules.test.ts \
  src/services/__tests__/tool-executor.test.ts

TOTAL=$((PASS + FAIL))
echo ""
echo "════════════════════════════════"
echo " Total: $PASS pass / $FAIL fail ($TOTAL tests)"
echo "════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
