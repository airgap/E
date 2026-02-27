#!/usr/bin/env bash
# E IDE — Bash Shell Integration
# Emits OSC sequences for CWD tracking and command boundary detection.
# Sourced automatically when enableShellIntegration is true.

# Guard against double-sourcing
if [[ -n "$__e_shell_integration" ]]; then
  return 0
fi
__e_shell_integration=1

# --- Helpers ---

# Emit OSC 7 (CWD change notification)
# Format: \e]7;file://hostname/cwd\a
__e_emit_cwd() {
  local cwd
  cwd="$(pwd)"
  printf '\e]7;file://%s%s\a' "${HOSTNAME:-localhost}" "$cwd"
}

# Emit command start OSC 633;C
__e_emit_command_start() {
  printf '\e]633;C\a'
}

# Emit command line text OSC 633;E;commandText
__e_emit_command_line() {
  printf '\e]633;E;%s\a' "$1"
}

# Emit command end OSC 633;D;exitCode
__e_emit_command_end() {
  printf '\e]633;D;%s\a' "$1"
}

# --- Integration ---

# Store the original PROMPT_COMMAND (may be a function or string)
__e_original_prompt_command="${PROMPT_COMMAND:-}"

# Track command execution state
__e_command_executing=0

# The DEBUG trap fires before each command execution.
# We use it to detect when a command is about to run.
__e_preexec() {
  # Skip if we're inside the prompt command itself
  if [[ "$BASH_COMMAND" == "__e_prompt_command" ]] ||
     [[ "$BASH_COMMAND" == __e_* ]] ||
     [[ "$__e_command_executing" == "1" ]]; then
    return
  fi
  __e_command_executing=1
  __e_emit_command_line "$BASH_COMMAND"
  __e_emit_command_start
}

# This runs as PROMPT_COMMAND — after each command finishes.
__e_prompt_command() {
  local exit_code=$?

  # If a command was executing, emit command_end with exit code
  if [[ "$__e_command_executing" == "1" ]]; then
    __e_emit_command_end "$exit_code"
    __e_command_executing=0
  fi

  # Always emit CWD
  __e_emit_cwd

  # Run the original PROMPT_COMMAND if it was set
  if [[ -n "$__e_original_prompt_command" ]]; then
    eval "$__e_original_prompt_command"
  fi
}

# Install our PROMPT_COMMAND
PROMPT_COMMAND="__e_prompt_command"

# Install the DEBUG trap for pre-exec detection
trap '__e_preexec' DEBUG

# Emit initial CWD on shell startup
__e_emit_cwd
