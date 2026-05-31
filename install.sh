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

# ── Download + extract ──────────────────────────────────────────────────────
tmp_archive=$(mktemp -t e-install-XXXXXX)
trap 'rm -f "$tmp_archive"' EXIT

info "Downloading $asset…"
curl --fail --location --progress-bar --output "$tmp_archive" "$release_uri" \
    || error "failed to download from \"$release_uri\""

info "Extracting…"
# Clean the stage dir so an upgrade doesn't leave stale files behind.
rm -rf "$stage_dir"/*
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

# The archive extracts into $stage_dir (it ships as `e-<platform>-<arch>/…`).
[[ -f "$stage_dir/e$exe_ext" ]] \
    || error "archive layout unexpected — expected $stage_dir/e$exe_ext"

# Symlink (or copy on MinGW where symlinks need dev mode) into the single
# canonical `$bin_dir/e` so PATH resolves regardless of which platform was
# installed last.
if ln -sf "$stage_dir/e$exe_ext" "$exe" 2>/dev/null; then
    :
else
    cp -f "$stage_dir/e$exe_ext" "$exe"
fi
chmod +x "$exe" 2>/dev/null || true

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
