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
# Arguments (order-independent):
#   <tag>                  Pin a specific release tag; default is "latest".
#   --register-file-types  After install, register E as the default handler for
#                          code file types (opt-in; non-fatal if it fails).

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

# The entire installer runs inside main(), which is invoked only on the
# final line. A partially-delivered script (a curl | bash that drops
# mid-stream, or a proxy that mangles the body) is then a no-op: bash needs
# the closing brace and the trailing call before it executes anything,
# instead of running a half-finished install.
main() {

    # ── Parse args (order-independent: an optional tag plus optional flags) ───────
    release_tag=''
    register_file_types=0
    for arg in "$@"; do
        case $arg in
        --register-file-types) register_file_types=1 ;;
        -*) error "unknown option: $arg" ;;
        *)
            if [[ -n $release_tag ]]; then
                error 'too many arguments; pass at most one release tag (e.g. "v0.1.0")'
            fi
            release_tag=$arg
            ;;
        esac
    done

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
    # Written directly here rather than via `"$exe" install-desktop` so the
    # installer can NEVER start a server: an older binary that doesn't know the
    # subcommand would treat it as a path, boot the server, and hang the install.
    # Best-effort and non-fatal. Mirrors buildDesktopEntry() in
    # packages/server/src/file-associations/registrar.ts — keep the two in sync.
    # macOS/Windows get their launcher from the packaged app bundle, not this tarball.
    if [[ $target = linux-* ]]; then
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

    # ── Optional: register E as a handler for code file types (opt-in) ───────────
    # Non-fatal: a failure here must not abort the install.
    if [[ $register_file_types = 1 ]]; then
        info "Registering file types…"
        if "$exe" register-file-types; then
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
