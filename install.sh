#!/usr/bin/env bash
#
# E installer. Downloads the latest release tarball from
# github.com/airgap/E, extracts the `e` binary + `client/` assets into
# ~/.e, and wires up PATH.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/airgap/E/main/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/airgap/E/main/install.sh | bash -s v0.1.0
#   curl -fsSL ...install.sh | bash -s -- --register-file-types
#   curl -fsSL ...install.sh | bash -s -- v0.1.0 --register-file-types
#
# When run in a terminal (including `curl … | bash`), it prompts whether to add
# an Applications launcher (Linux) and whether to associate code file types.
# With no terminal (CI / piped without a tty) it uses defaults: launcher yes
# (Linux), associations no. Flags below override and suppress the prompts.
#
# Arguments (order-independent):
#   <tag>                  Pin a specific release tag; default is "latest".
#   --register-file-types  Register E as the default handler for ALL code file
#                          types (no prompt). Non-fatal if it fails.
#   --no-file-types        Skip file-type association (no prompt).
#   --no-desktop           Skip the Applications launcher entry (no prompt).
#   -y, --yes              Accept defaults; never prompt.

set -euo pipefail

platform=$(uname -ms)

Color_Off=''; Red=''; Green=''; Dim=''; Bold_White=''; Bold_Green=''
if [[ -t 1 ]]; then
    Color_Off='\033[0m'
    Red='\033[0;31m'
    Green='\033[0;32m'
    Dim='\033[0;2m'
    Bold_Green='\033[1;32m'
    Bold_White='\033[1m'
fi

error()     { echo -e "${Red}error${Color_Off}:" "$@" >&2; exit 1; }
info()      { echo -e "${Dim}$@ ${Color_Off}"; }
info_bold() { echo -e "${Bold_White}$@ ${Color_Off}"; }
success()   { echo -e "${Green}$@ ${Color_Off}"; }

# Prompt on the controlling terminal and echo the answer (or $3 default if
# blank). Reads /dev/tty so it still works under `curl | bash`, where stdin is
# the script itself. Only call when a terminal is known to be attached.
#   read_choice "Question?" "[Y/n]" "y"
read_choice() {
    local _q=$1 _hint=$2 _def=$3 _ans=''
    printf '%b%s %s%b ' "$Dim" "$_q" "$_hint" "$Color_Off" >/dev/tty
    read -r _ans </dev/tty || _ans=''
    printf '%s' "${_ans:-$_def}"
}

# Interactive subset picker for file-type association. Lists the types E can
# own (queried from the freshly-installed binary) and reads a selection. Sets
# the globals `do_file_types` (0/1) and `ft_exts` (space-separated, empty=all).
choose_file_types() {
    local _e _n _i=0 _sel _tok _picked='' _tmpf _pid _killer _rc
    local -a _exts=() _labels=()

    # Query the just-installed binary for the type list — but guard with a
    # timeout: an OLDER release binary doesn't know `list-file-types`, treats it
    # as a path to open, and would boot a server and hang. If that happens we
    # bail cleanly instead of freezing.
    _tmpf=$(mktemp -t e-filetypes-XXXXXX)
    "$exe" list-file-types >"$_tmpf" 2>/dev/null &
    _pid=$!
    (
        sleep 5
        kill "$_pid" 2>/dev/null
    ) >/dev/null 2>&1 &
    _killer=$!
    wait "$_pid" 2>/dev/null
    _rc=$?
    kill "$_killer" 2>/dev/null
    wait "$_killer" 2>/dev/null || true

    if [ "$_rc" -ne 0 ] || [ ! -s "$_tmpf" ]; then
        rm -f "$_tmpf"
        info "This build can't list file types — skipping."
        info "You can set them up later with: e register-file-types ts py rs …"
        do_file_types=0
        return
    fi

    while IFS=$'\t' read -r _e _n; do
        [ -z "$_e" ] && continue
        _i=$((_i + 1))
        _exts[$_i]=$_e
        _labels[$_i]=$_n
        printf '  %2d) %-8s %s\n' "$_i" ".$_e" "$_n" >/dev/tty
    done <"$_tmpf"
    rm -f "$_tmpf"
    if [ "$_i" -eq 0 ]; then
        info "Could not list file types; skipping association."
        do_file_types=0
        return
    fi
    printf '%bPick numbers/extensions (space/comma separated), "all", or blank to skip:%b ' \
        "$Dim" "$Color_Off" >/dev/tty
    read -r _sel </dev/tty || _sel=''
    if [ -z "$_sel" ]; then do_file_types=0; return; fi
    case $_sel in all | ALL) do_file_types=1; ft_exts=''; return ;; esac
    _sel=${_sel//,/ }
    for _tok in $_sel; do
        if [[ $_tok =~ ^[0-9]+$ ]]; then
            [ -n "${_exts[$_tok]:-}" ] && _picked="$_picked ${_exts[$_tok]}"
        else
            _picked="$_picked ${_tok#.}"
        fi
    done
    # trim
    _picked=$(printf '%s' "$_picked" | xargs 2>/dev/null || printf '%s' "$_picked")
    if [ -z "$_picked" ]; then do_file_types=0; else do_file_types=1; ft_exts=$_picked; fi
}

# The entire installer runs inside main(), which is invoked only on the
# final line. A partially-delivered script (a curl | bash that drops
# mid-stream, or a proxy that mangles the body) is then a no-op: bash needs
# the closing brace and the trailing call before it executes anything,
# instead of running a half-finished install.
main() {

    # ── Parse args (order-independent: an optional tag plus optional flags) ───────
    release_tag=''
    opt_file_types=ask # ask | all | none   (--register-file-types forces all)
    opt_desktop=ask    # ask | yes | no     (--no-desktop forces no)
    assume_yes=0       # -y / --yes: accept defaults, never prompt
    for arg in "$@"; do
        case $arg in
        --register-file-types) opt_file_types=all ;;
        --no-file-types) opt_file_types=none ;;
        --no-desktop) opt_desktop=no ;;
        -y | --yes) assume_yes=1 ;;
        -*) error "unknown option: $arg" ;;
        *)
            if [[ -n $release_tag ]]; then
                error 'too many arguments; pass at most one release tag (e.g. "v0.1.0")'
            fi
            release_tag=$arg
            ;;
        esac
    done

    # Interactive only when a terminal is attached and the user didn't pass -y.
    # Under `curl | bash`, stdin is the script, so we test /dev/tty, not stdin.
    interactive=0
    if [[ $assume_yes = 0 ]] && [ -t 1 ] && [ -r /dev/tty ]; then interactive=1; fi

    # ── Platform detection ──────────────────────────────────────────────────────
    case $platform in
    'Darwin arm64')
        target=darwin-arm64
        archive_ext=tar.gz
        exe_ext=''
        ;;
    'Darwin x86_64')
        # Intel Macs are no longer built — only Apple Silicon (arm64). An x86_64
        # report here is usually a process running under Rosetta 2 on an arm64 Mac,
        # in which case the native arm64 build is the right one to install.
        if [[ $(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0) = 1 ]]; then
            info 'Running under Rosetta 2 on Apple Silicon; installing the native arm64 build.'
            target=darwin-arm64
            archive_ext=tar.gz
            exe_ext=''
        else
            error 'Intel Macs are not supported — E ships Apple Silicon (arm64) builds only.'
        fi
        ;;
    'Linux x86_64')
        target=linux-x64
        archive_ext=tar.gz
        exe_ext=''
        ;;
    'Linux aarch64'|'Linux arm64')
        target=linux-arm64
        archive_ext=tar.gz
        exe_ext=''
        ;;
    'MINGW64'*|'MSYS'*|'CYGWIN'*)
        target=windows-x64
        archive_ext=zip
        exe_ext='.exe'
        ;;
    *)
        error "unsupported platform: $platform"
        ;;
    esac

    if [[ $target = darwin-arm64 && $(sysctl -n sysctl.proc_translated 2>/dev/null || true) = 1 ]]; then
        info 'Running under Rosetta 2; installing the native arm64 build anyway.'
    fi

    # ── Figure out the release URL ──────────────────────────────────────────────
    GITHUB=${GITHUB-"https://github.com"}
    github_repo="$GITHUB/airgap/E"
    asset="e-${target}.${archive_ext}"

    if [[ -z $release_tag ]]; then
        release_uri="$github_repo/releases/latest/download/$asset"
    else
        release_uri="$github_repo/releases/download/$release_tag/$asset"
    fi

    # ── Install paths ──────────────────────────────────────────────────────────
    install_env=E_INSTALL
    bin_env=\$$install_env/bin
    install_dir=${E_INSTALL:-$HOME/.e}
    bin_dir=$install_dir/bin
    # The release archive ships its contents under a top-level `e-<platform>-<arch>/`
    # directory (see scripts/build-standalone.ts `stageName`), so the staged install
    # dir must carry the same `e-` prefix.
    stage_dir=$install_dir/e-$target
    exe=$bin_dir/e$exe_ext

    mkdir -p "$bin_dir" "$stage_dir" || error "failed to create install dir \"$install_dir\""

    # ── Obtain the staged install: local build or release download ───────────────
    # Clean the stage dir so an upgrade doesn't leave stale files behind.
    rm -rf "$stage_dir"/*

    if [[ -n ${E_LOCAL_DIST:-} ]]; then
        # Local mode (scripts/install-local.sh): install from an already-built
        # staged dir instead of downloading a release. No network at all, so this
        # sidesteps proxies and the public installer entirely. The dir must hold
        # the same layout as the release archive: `e[.exe]` + `client/` (+ e.png).
        [[ -d $E_LOCAL_DIST ]] || error "E_LOCAL_DIST is not a directory: \"$E_LOCAL_DIST\""
        info "Installing from local build: $E_LOCAL_DIST"
        cp -R "$E_LOCAL_DIST"/. "$stage_dir"/ \
            || error "failed to copy local build into \"$stage_dir\""
    else
        tmp_archive=$(mktemp -t e-install-XXXXXX)
        trap 'rm -f "$tmp_archive"' EXIT

        info "Downloading $asset…"
        curl --fail --location --progress-bar --output "$tmp_archive" "$release_uri" \
            || error "failed to download from \"$release_uri\""

        info "Extracting…"
        if [[ $archive_ext = tar.gz ]]; then
            tar -xzf "$tmp_archive" -C "$install_dir"
        elif [[ $archive_ext = zip ]]; then
            if command -v unzip >/dev/null 2>&1; then
                unzip -qo "$tmp_archive" -d "$install_dir"
            else
                # PowerShell fallback on MinGW where unzip isn't always present.
                powershell -NoProfile -Command "Expand-Archive -Force -Path '$tmp_archive' -DestinationPath '$install_dir'"
            fi
        fi
    fi

    # Either path lands the binary at $stage_dir/e (download extracts the
    # `e-<platform>-<arch>/…` tree; local mode copies it in directly).
    [[ -f "$stage_dir/e$exe_ext" ]] \
        || error "install layout unexpected — expected $stage_dir/e$exe_ext"

    # Symlink (or copy on MinGW where symlinks need dev mode) into the single
    # canonical `$bin_dir/e` so PATH resolves regardless of which platform was
    # installed last.
    if ln -sf "$stage_dir/e$exe_ext" "$exe" 2>/dev/null; then
        :
    else
        cp -f "$stage_dir/e$exe_ext" "$exe"
    fi
    chmod +x "$exe" 2>/dev/null || true

    # ── Register E in the desktop application launcher (Linux only) ──────────────
    # macOS/Windows get their launcher from the packaged app bundle, not this
    # tarball, so we neither prompt nor act there. On Linux: prompt when a
    # terminal is attached, otherwise default to yes (unchanged behavior).
    do_desktop=0
    if [[ $target = linux-* ]]; then
        case $opt_desktop in
        no) ;;
        yes) do_desktop=1 ;;
        ask)
            if [[ $interactive = 1 ]]; then
                case "$(read_choice "Add E to your Applications menu?" "[Y/n]" "y")" in
                [Nn]*) ;;
                *) do_desktop=1 ;;
                esac
            else
                do_desktop=1
            fi
            ;;
        esac
    fi

    # Written directly here rather than via `"$exe" install-desktop` so the
    # installer can NEVER start a server: an older binary that doesn't know the
    # subcommand would treat it as a path, boot the server, and hang the install.
    # Best-effort and non-fatal. Mirrors buildDesktopEntry() in
    # packages/server/src/file-associations/registrar.ts — keep the two in sync.
    if [[ $do_desktop = 1 ]]; then
        apps_dir=${XDG_DATA_HOME:-$HOME/.local/share}/applications
        desktop_file=$apps_dir/e.desktop
        # Don't downgrade an existing file-type handler entry (it already shows in
        # the menu); `e register-file-types` owns the richer MimeType version.
        if [[ -f $desktop_file ]] && grep -q '^MimeType=' "$desktop_file" 2>/dev/null; then
            info "E is already in your applications menu."
        elif mkdir -p "$apps_dir" 2>/dev/null; then
            {
                echo '[Desktop Entry]'
                echo 'Name=E'
                echo 'GenericName=AI Coding Assistant'
                echo 'Comment=Autonomous AI coding assistant'
                echo 'Type=Application'
                echo "Exec=$exe"
                echo 'Terminal=false'
                echo 'Categories=Development;IDE;'
                echo 'StartupNotify=true'
                echo 'StartupWMClass=E'
                echo 'NoDisplay=false'
                [[ -f "$stage_dir/e.png" ]] && echo "Icon=$stage_dir/e.png"
            } >"$desktop_file" 2>/dev/null \
                && info "Added E to your applications menu." \
                || info "Warning: could not add E to the applications menu (continuing)."
            command -v update-desktop-database >/dev/null 2>&1 \
                && update-desktop-database "$apps_dir" >/dev/null 2>&1 || true
        fi
    fi

    # ── Associate E with code file types ─────────────────────────────────────────
    # Linux-only today (the registrar's macOS/Windows paths are stubs), so we only
    # prompt there. Non-interactive default is "none" (unchanged). Non-fatal.
    do_file_types=0
    ft_exts=''
    case $opt_file_types in
    all) do_file_types=1 ;;
    none) ;;
    ask)
        if [[ $target = linux-* && $interactive = 1 ]]; then
            case "$(read_choice "Associate E with code files (.ts, .py, .rs, …)?" "[y/N/c]" "n")" in
            [Yy]*) do_file_types=1 ;;
            [Cc]*) choose_file_types ;; # sets do_file_types + ft_exts
            *) ;;
            esac
        fi
        ;;
    esac

    if [[ $do_file_types = 1 ]]; then
        info "Registering file types…"
        # ft_exts is an intentional word-split list (empty = all types).
        if "$exe" register-file-types $ft_exts; then
            success "Registered file types."
        else
            info "Warning: file-type registration failed (continuing)."
        fi
    fi

    # ── Friendly PATH setup ────────────────────────────────────────────────────
    tildify() {
        if [[ $1 = $HOME/* ]]; then
            echo "${1/$HOME\//\~/}"
        else
            echo "$1"
        fi
    }

    success "e was installed successfully to $Bold_Green$(tildify "$exe")"

    if command -v e >/dev/null 2>&1; then
        echo "Run ${Bold_White}e${Color_Off} to launch the app."
        exit 0
    fi

    tilde_bin_dir=$(tildify "$bin_dir")
    quoted_install_dir=\"${install_dir//\"/\\\"}\"
    if [[ $quoted_install_dir = \"$HOME/* ]]; then
        quoted_install_dir=${quoted_install_dir/$HOME\//\$HOME/}
    fi

    echo
    refresh_command=''

    append_to() {
        local cfg=$1
        if [[ -w $cfg ]]; then
            {
                echo -e "\n# e"
                for c in "${commands[@]}"; do echo "$c"; done
            } >>"$cfg"
            info "Added \"$tilde_bin_dir\" to \$PATH in \"$(tildify "$cfg")\""
            return 0
        fi
        return 1
    }

    case $(basename "$SHELL") in
    fish)
        commands=(
            "set --export $install_env $quoted_install_dir"
            "set --export PATH $bin_env \$PATH"
        )
        fish_config=$HOME/.config/fish/config.fish
        if append_to "$fish_config"; then
            refresh_command="source $(tildify "$fish_config")"
        else
            echo "Manually add the directory to $(tildify "$fish_config") (or similar):"
            for c in "${commands[@]}"; do info_bold "  $c"; done
        fi
        ;;
    zsh)
        commands=(
            "export $install_env=$quoted_install_dir"
            "export PATH=\"$bin_env:\$PATH\""
        )
        zsh_config=$HOME/.zshrc
        if append_to "$zsh_config"; then
            refresh_command="exec $SHELL"
        else
            echo "Manually add the directory to $(tildify "$zsh_config") (or similar):"
            for c in "${commands[@]}"; do info_bold "  $c"; done
        fi
        ;;
    bash)
        commands=(
            "export $install_env=$quoted_install_dir"
            "export PATH=\"$bin_env:\$PATH\""
        )
        bash_configs=("$HOME/.bash_profile" "$HOME/.bashrc")
        if [[ ${XDG_CONFIG_HOME:-} ]]; then
            bash_configs+=(
                "$XDG_CONFIG_HOME/.bash_profile"
                "$XDG_CONFIG_HOME/.bashrc"
                "$XDG_CONFIG_HOME/bash_profile"
                "$XDG_CONFIG_HOME/bashrc"
            )
        fi
        set_manually=true
        for cfg in "${bash_configs[@]}"; do
            if append_to "$cfg"; then
                refresh_command="source $cfg"
                set_manually=false
                break
            fi
        done
        if [[ $set_manually = true ]]; then
            echo "Manually add the directory to ~/.bashrc (or similar):"
            for c in "${commands[@]}"; do info_bold "  $c"; done
        fi
        ;;
    *)
        echo 'Manually add the directory to ~/.bashrc (or similar):'
        info_bold "  export $install_env=$quoted_install_dir"
        info_bold "  export PATH=\"$bin_env:\$PATH\""
        ;;
    esac

    echo
    info "To get started, run:"
    echo
    if [[ $refresh_command ]]; then
        info_bold "  $refresh_command"
    fi
    info_bold "  e"
}

main "$@"
