# E

An AI-native IDE. Claude at the center, full editor around it. Runs as a native desktop app (Electron), or as a single-process web server you open in a browser.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/airgap/E/dev/install.sh | bash
```

Drops the latest release binary into `~/.e/bin/e` and wires up `$PATH`. Pin a specific release:

```sh
curl -fsSL https://raw.githubusercontent.com/airgap/E/dev/install.sh | bash -s v0.1.0
```

Supported targets: `linux-x64`, `linux-arm64`, `darwin-arm64`, `darwin-x64`, `windows-x64`. Releases: [github.com/airgap/E/releases](https://github.com/airgap/E/releases).

After install, run `e` to open the desktop app. For a server only (no window) — a remote box, CI, or browser access — run `e --headless`; it serves on port 3002 (`PORT=8080 e --headless` for a custom port, then open it in a browser).

## Development

```sh
bun install
bun run dev
```

Starts the API server (port 3002) and SvelteKit dev server (port 3333).

Or build the client once and serve everything from one port:

```sh
bun run start          # http://localhost:3002
```

Prerequisites for development: [Bun](https://bun.sh) ≥ 1.0, [Claude CLI](https://docs.anthropic.com/en/docs/claude-cli) on `$PATH`, [Rust](https://rustup.rs) for desktop builds.

## What's in the editor

CodeMirror 6 with a full IDE surface:

- **Language intelligence (LSP)** — completions with signature help, real-time diagnostics, hover docs with syntax-highlighted definition peek, code actions (Ctrl+.), code lens, inlay type hints. Document symbols (Ctrl+Shift+O) and workspace symbols (Ctrl+T) quick-open. Auto-install flow for TypeScript, Python, Rust, Go, C++, Java, SQL, Parabun.
- **Multi-cursor** — Alt-click, Ctrl+D (next occurrence), Ctrl+Shift+L (all occurrences), Ctrl+Alt+Up/Down (add cursor on line above/below), rectangular selection.
- **Peek Definition / Peek References** — `Alt+F12` and `Shift+F12` open an inline block widget that folds down between editor lines with the target file's content or a clickable references list. 3D pivot animation with `prefers-reduced-motion` respected.
- **Go-to-definition** — hold `Ctrl`/`Cmd` to paint an accent-colored underline on the word under the pointer (VS Code-style "this is a link" cue); click to jump. Resolution chain is LSP `textDocument/definition` → tree-sitter same-file → workspace-symbol by-word, with a toast on total miss so nothing fails silently.
- **File-type icons** — colored + labeled glyphs per extension (`TS`, `JS`, `PY`, `RS`, …), per special filename (`package.json`, `Dockerfile`, `.env`), and per folder name (`src`, `.git`, `node_modules`, `target`) across file tree, open-tabs, and `@file` pickers.
- **Project-wide find & replace** — case-sensitive, whole-word, and regex toggles. Two-phase replace-all (dry-run preview, then confirm).
- **File watcher** — external edits to open files reload automatically; dirty buffers get a toast instead of silent clobber.
- **File tree git status** — tracked files render at full strength, gitignored ones dim. Modified/added/deleted/untracked/renamed tints apply and roll up to parent folders.
- **Problems panel** — LSP diagnostics aggregated across files, filter by severity and free-text, click to jump.
- **Breakpoints + DAP debugger (v1)** — click the gutter to toggle, `F5` / `F10` / `F11` / `Shift+F5` for the usual controls. Variables, call stack, threads, and output panels. Python via `debugpy` ships out of the box; `.e/launch.json` schema mirrors VS Code.
- **Integrated terminal** — xterm.js with split tabs, full PTY, serialize/search/webgl/clipboard addons.
- **Git panel** — status, staging (including per-hunk), commits, branches, stash, merge-conflict resolution, snapshots, AI commit-message suggestions.
- **Git graph** — dedicated sidebar panel rendering the full commit history as colored lanes with branch / tag / HEAD pills; click a commit to open a tab showing its metadata, parents, file list with per-file +/− counts, and inline unified diffs.
- **Inline git blame** — author + relative time rendered next to each line as a subdued annotation; hover for the full commit summary. On by default.
- **Outline** — document symbols via LSP (hierarchical), tree-sitter fallback.
- **Test status gutter, coverage overlay, AI code actions, format-on-save.**

Full gap analysis and what's still ahead: [`IDE_GAP_ANALYSIS.md`](./IDE_GAP_ANALYSIS.md).

## AI surface

- **Multi-provider kernel** — Claude (Anthropic API + Claude CLI), AWS Bedrock, OpenAI, Gemini, Ollama. Auto-routing and cost tracking built in.
- **Chat participants (`@`-mentions)** — VS Code-style agent picker. Type `@claude-code` at the start of a turn to route it through the Claude CLI (ships as the first built-in agent); the active agent locks in as a chip above the input and stamps the assistant message with its badge. Backspace on empty input clears the agent.
- **MCP (Model Context Protocol)** — stdio, SSE, and HTTP transports. Auto-discovery of existing MCP configs. Tool + resource surface.
- **Golems** — per-machine named agents. Hostname-keyed persistence, last-active tracking, history queryable via MCP tool.
- **Permission modes** — `safe` / `fast` / `unrestricted` / `plan`. Per-tool rules with regex patterns, session / workspace / global scopes, presets.
- **Conversation forking** — branch from any message, compact for token budget, multi-agent orchestration with resource pooling.
- **Workspace memory** — conventions, learnings with confidence scores, pattern detection that proposes new skills/rules.
- **PRD / story executor** — multi-story work plans with per-story quality checks, parallel executors, auto-commit on completion.
- **Custom tools** — user-registered bash/Python scripts with approval gating.

## Remote access

Access E from a phone, tablet, or another machine via Tailscale or SSH tunneling. See [`docs/REMOTE_ACCESS.md`](docs/REMOTE_ACCESS.md).

- Settings → Remote Access → enable Tailscale serve/funnel, or generate an SSH tunnel command
- Authentication required on all remote connections

## Desktop app (Tauri)

Only needed for a native window — the web UI above works without it. Builds natively on Linux, macOS, and Windows.

### Additional prerequisites

- [Rust](https://rustup.rs) toolchain (`rustup`, `cargo`, `rustc`) on every platform
- **Linux** (Debian/Ubuntu):
  ```sh
  sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
  ```
- **macOS**: Xcode Command Line Tools (`xcode-select --install`). `11.0` (Big Sur) minimum.
- **Windows**: [WebView2 runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (usually preinstalled on Windows 11) and the MSVC build tools.

### Build & run

```sh
bun run tauri:dev      # development, with Rust hot-reload
bun run tauri:build    # production bundle — .deb/.rpm/.AppImage on Linux, .app/.dmg on macOS, .msi/.exe on Windows
```

### How it works

1. SvelteKit builds to static HTML/JS via `adapter-static`.
2. The Bun server compiles to a single binary via `bun build --compile`.
3. Tauri bundles both into a native app with the server as a sidecar process.
4. On launch, Tauri picks a free port, spawns the sidecar, and injects the port into the webview via an `initialization_script` (survives reloads). The client polls `/health` until ready.

## Language support (Parabun)

`.pts` / `.ptsx` / `.pjs` / `.pjsx` files get the same LSP-backed treatment as `.ts` — hover, completions, goto-definition, diagnostics, semantic tokens — routed through the [Parabun LSP](https://github.com/airgap/parabun) with TypeScript's language service underneath. Custom operator sugar (`|>`, `..=`, `..!`, `..&`, `pure`, `memo`, `signal`, `arena`, `defer`) is highlighted and hover-documented.

## Project structure

```
packages/
  client/    SvelteKit frontend (Svelte 5, CodeMirror 6, xterm.js)
  server/    Hono + Bun API server, 120+ route modules
  shared/    Shared types
src-tauri/   Tauri v2 desktop shell (Rust)
e2e/         Playwright end-to-end suite
scripts/     Build helpers + benchmarks
```

Server services of note:

- `services/agent-kernel.ts` — unified LLM execution across providers
- `services/agent-registry.ts`, `routes/agents-registry.ts` — chat-participant registry + leading-mention routing
- `services/lsp-instance-manager.ts`, `routes/lsp.ts` — LSP lifecycle + WebSocket bridge
- `services/dap-instance-manager.ts`, `routes/dap.ts` — DAP adapter manager
- `services/file-watcher.ts`, `routes/file-watch.ts` — workspace change broadcast
- `services/search-engine.ts` — sequential / concurrent / Parabun-pmap search strategies
- `routes/git/log.ts` — commit graph + per-commit detail endpoints feeding the Git Graph panel

## Tests & benchmarks

```sh
npx playwright test                   # e2e suite (16 tests, ~45s)
bun run --filter @e/server test       # server unit tests
bun run --filter @e/client test       # client unit tests
bun run scripts/bench-search.ts       # workspace search bench (Bun)
pb run scripts/bench-search.ts        # same bench with Parabun pmap row
```

## Scripts

| Script                     | Description                                 |
| -------------------------- | ------------------------------------------- |
| `bun run dev`              | Client + server in dev mode                 |
| `bun run dev:client`       | Vite dev server only                        |
| `bun run dev:server`       | API server only                             |
| `bun run start`            | Build client + single-process serve on 3002 |
| `bun run build`            | Build all packages                          |
| `bun run build:desktop`    | Static client + compiled server binary      |
| `bun run build:standalone` | Single-binary distribution                  |
| `bun run tauri:dev`        | Desktop app in development                  |
| `bun run tauri:build`      | Production desktop installer                |
| `bun run check`            | Type-check all packages                     |
| `bun run test`             | All unit tests                              |
| `bun run test:coverage`    | Unit tests with coverage                    |
| `bun run format`           | Prettier write                              |
| `bun run format:check`     | Prettier check without writing              |

## License

MIT
