// ---------------------------------------------------------------------------
// Cloud-init / user-data template generation
// ---------------------------------------------------------------------------
// Generates the startup script injected into cloud instances at boot time.
// Works with cloud-init (GCP, Azure) and user-data (AWS EC2).
// Bootstraps the golem binary, injects secrets, and starts execution.
// ---------------------------------------------------------------------------

import type { CloudInitConfig } from '@e/shared';

/**
 * Generate a cloud-init / user-data shell script that bootstraps a golem
 * instance at boot time.
 *
 * The script:
 * 1. Installs prerequisites (git, curl, unzip)
 * 2. Downloads the golem binary
 * 3. Resolves LLM API keys from environment / secrets references
 * 4. Creates the golem spec JSON
 * 5. Launches the golem process
 *
 * Acceptance Criterion 3: injects repo URL, story spec, golem binary URL,
 * LLM API keys (from secrets manager), coordinator callback URL.
 */
export function generateCloudInitScript(config: CloudInitConfig): string {
  const envLines = Object.entries(config.env ?? {})
    .map(([key, value]) => `export ${key}="${escapeShellValue(value)}"`)
    .join('\n');

  const secretLines = Object.entries(config.llmApiKeyRefs)
    .map(([envVar, secretRef]) => {
      // Secrets are resolved at boot time from the cloud provider's secrets manager.
      // The actual resolution mechanism depends on the provider (AWS SSM, GCP Secret
      // Manager, Azure Key Vault) — the cloud-init script uses a generic helper.
      return `export ${envVar}=$(resolve_secret "${escapeShellValue(secretRef)}")`;
    })
    .join('\n');

  return `#!/bin/bash
set -euo pipefail

# ---------------------------------------------------------------------------
# e-golem cloud-init bootstrap script
# Generated at: ${new Date().toISOString()}
# Executor: ${config.executorId}
# ---------------------------------------------------------------------------

echo "[e-golem] Bootstrap starting..."

# --- System prerequisites ---
if command -v apt-get &>/dev/null; then
  apt-get update -qq && apt-get install -y -qq git curl unzip jq
elif command -v yum &>/dev/null; then
  yum install -y -q git curl unzip jq
elif command -v apk &>/dev/null; then
  apk add --no-cache git curl unzip jq
fi

# --- Secret resolution helper ---
# Override this function per-provider if using a cloud secrets manager.
# Default: expects secrets as environment variables already set.
resolve_secret() {
  local ref="$1"
  # Check if it looks like a cloud secret reference
  if [[ "$ref" == arn:aws:* ]]; then
    # AWS Secrets Manager / SSM Parameter Store
    aws secretsmanager get-secret-value --secret-id "$ref" --query SecretString --output text 2>/dev/null || echo ""
  elif [[ "$ref" == projects/*/secrets/* ]]; then
    # GCP Secret Manager
    gcloud secrets versions access latest --secret="$(echo "$ref" | awk -F/ '{print $4}')" 2>/dev/null || echo ""
  elif [[ "$ref" == https://*.vault.azure.net/* ]]; then
    # Azure Key Vault
    az keyvault secret show --id "$ref" --query value -o tsv 2>/dev/null || echo ""
  else
    # Treat as literal value or environment variable name
    echo "$ref"
  fi
}

# --- Environment variables ---
${envLines}

# --- Resolve secrets ---
${secretLines}

# --- Download golem binary ---
GOLEM_BINARY_URL="${escapeShellValue(config.golemBinaryUrl)}"
GOLEM_BIN="/usr/local/bin/e-golem"

echo "[e-golem] Downloading golem binary from $GOLEM_BINARY_URL..."
curl -fsSL "$GOLEM_BINARY_URL" -o "$GOLEM_BIN"
chmod +x "$GOLEM_BIN"

# --- Create golem spec ---
GOLEM_SPEC_FILE="/tmp/golem-spec.json"
cat > "$GOLEM_SPEC_FILE" <<'SPEC_EOF'
${config.storySpec}
SPEC_EOF

# --- Inject coordinator URL and executor ID into spec ---
COORDINATOR_URL="${escapeShellValue(config.coordinatorCallbackUrl)}"
EXECUTOR_ID="${escapeShellValue(config.executorId)}"
HEALTH_PORT="${config.healthPort}"

# Update spec with runtime values using jq
jq --arg url "$COORDINATOR_URL" --arg eid "$EXECUTOR_ID" --argjson hp "$HEALTH_PORT" \\
  '.coordinatorUrl = $url | .executorId = $eid | .healthPort = $hp' \\
  "$GOLEM_SPEC_FILE" > "$GOLEM_SPEC_FILE.tmp" && mv "$GOLEM_SPEC_FILE.tmp" "$GOLEM_SPEC_FILE"

# --- Launch golem ---
echo "[e-golem] Starting golem execution..."
exec "$GOLEM_BIN" run --spec "$GOLEM_SPEC_FILE"
`;
}

/**
 * Generate a minimal Dockerfile for container-based execution.
 * Used with ECS, Cloud Run, ACI, etc.
 */
export function generateContainerBootstrapScript(config: CloudInitConfig): string {
  return `#!/bin/sh
set -e

# e-golem container bootstrap
# Expects GOLEM_SPEC environment variable or /spec/golem-spec.json mount

if [ -n "$GOLEM_SPEC" ]; then
  echo "$GOLEM_SPEC" > /tmp/golem-spec.json
  SPEC_FILE="/tmp/golem-spec.json"
elif [ -f "/spec/golem-spec.json" ]; then
  SPEC_FILE="/spec/golem-spec.json"
else
  echo "[e-golem] ERROR: No golem spec found"
  exit 2
fi

# Set coordinator URL
export GOLEM_COORDINATOR_URL="${escapeShellValue(config.coordinatorCallbackUrl)}"
export GOLEM_EXECUTOR_ID="${escapeShellValue(config.executorId)}"

exec /usr/local/bin/e-golem run --spec "$SPEC_FILE"
`;
}

/**
 * Build a GolemSpec JSON string from a CloudInitConfig plus extra context.
 */
export function buildGolemSpecJson(
  config: CloudInitConfig,
  extras: {
    storyId: string;
    storyTitle: string;
    storyDescription: string;
    acceptanceCriteria: string[];
    model: string;
    effort: string;
    timeoutMs: number;
    branch: string;
  },
): string {
  const spec = {
    repoUrl: config.repoUrl,
    branch: extras.branch,
    story: {
      storyId: extras.storyId,
      title: extras.storyTitle,
      description: extras.storyDescription,
      acceptanceCriteria: extras.acceptanceCriteria,
    },
    llm: {
      model: extras.model,
      effort: extras.effort,
    },
    coordinatorUrl: config.coordinatorCallbackUrl,
    executorId: config.executorId,
    timeoutMs: extras.timeoutMs,
    autoCommit: true,
    autoPush: true,
    healthPort: config.healthPort,
  };
  return JSON.stringify(spec, null, 2);
}

/** Escape a value for safe inclusion in a shell script. */
function escapeShellValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`');
}
