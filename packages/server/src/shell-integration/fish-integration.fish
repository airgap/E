#!/usr/bin/env fish
# E IDE — Fish Shell Integration
# Emits OSC sequences for CWD tracking and command boundary detection.
# Sourced automatically when enableShellIntegration is true.

# Guard against double-sourcing
if set -q __e_shell_integration
    return 0
end
set -g __e_shell_integration 1

# --- Helpers ---

# Emit OSC 7 (CWD change notification)
function __e_emit_cwd
    printf '\e]7;file://%s%s\a' (hostname) "$PWD"
end

# Emit command start OSC 633;C
function __e_emit_command_start
    printf '\e]633;C\a'
end

# Emit command line text OSC 633;E;commandText
function __e_emit_command_line
    printf '\e]633;E;%s\a' $argv[1]
end

# Emit command end OSC 633;D;exitCode
function __e_emit_command_end
    printf '\e]633;D;%s\a' $argv[1]
end

# --- Integration ---

# fish_preexec fires before each command
function __e_fish_preexec --on-event fish_preexec
    __e_emit_command_line $argv[1]
    __e_emit_command_start
end

# fish_postexec fires after each command
function __e_fish_postexec --on-event fish_postexec
    __e_emit_command_end $status
end

# Track directory changes via the variable-set event on PWD
function __e_on_pwd_change --on-variable PWD
    __e_emit_cwd
end

# Also emit CWD on each prompt (covers all cases)
function __e_fish_prompt --on-event fish_prompt
    __e_emit_cwd
end

# Emit initial CWD on shell startup
__e_emit_cwd
