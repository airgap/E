#!/usr/bin/env zsh
# E IDE — Zsh Shell Integration
# Emits OSC sequences for CWD tracking and command boundary detection.
# Sourced automatically when enableShellIntegration is true.

# Guard against double-sourcing
if [[ -n "$__e_shell_integration" ]]; then
  return 0
fi
__e_shell_integration=1

# --- Helpers ---

# Emit OSC 7 (CWD change notification)
__e_emit_cwd() {
  printf '\e]7;file://%s%s\a' "${HOST:-localhost}" "$PWD"
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

__e_command_executing=0

# preexec runs just before a command is executed
__e_preexec() {
  __e_command_executing=1
  __e_emit_command_line "$1"
  __e_emit_command_start
}

# precmd runs just before the prompt is displayed (after command finishes)
__e_precmd() {
  local exit_code=$?

  # If a command was executing, emit command_end
  if [[ "$__e_command_executing" == "1" ]]; then
    __e_emit_command_end "$exit_code"
    __e_command_executing=0
  fi

  # Always emit CWD
  __e_emit_cwd
}

# Install hooks using zsh's hook system
autoload -Uz add-zsh-hook
add-zsh-hook precmd __e_precmd
add-zsh-hook preexec __e_preexec

# Also emit CWD on directory change
__e_chpwd() {
  __e_emit_cwd
}
add-zsh-hook chpwd __e_chpwd

# Emit initial CWD on shell startup
__e_emit_cwd
