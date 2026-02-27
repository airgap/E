# E

A desktop AI assistant powered by Claude. Runs as a native app via Tauri, or as a single-process web server you can open in a browser.

## Prerequisites

- [Bun](https://bun.sh) >= 1.0
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-cli) on your PATH
- [Rust](https://rustup.rs) (for native desktop builds only)

## Quick Start

```sh
bun install
bun run dev
```

This starts the API server (port 3002) and SvelteKit dev server (port 3333).

## Web UI (single process)

Build the frontend and serve everything from one port — no Vite dev server, no Tauri, just Bun:

```sh
bun run start
```

Then open **http://localhost:3002**. The server builds the SvelteKit client to static files and serves them alongside the API. Set `PORT` to change the port.

## Remote Access

E supports secure remote access via Tailscale or SSH tunneling. See [docs/REMOTE_ACCESS.md](docs/REMOTE_ACCESS.md) for setup instructions.

**Quick setup:**

- Navigate to Settings > Remote Access in the UI
- Enable Tailscale serve/funnel or generate an SSH tunnel command
- Access E from your phone, laptop, or anywhere with authentication

## Project Structure

```
packages/
  client/    SvelteKit frontend
  server/    Hono + Bun API server
  shared/    Shared types and utilities
src-tauri/   Tauri desktop shell
scripts/     Build helpers
```

## Desktop App (Tauri)

The desktop build wraps E in a native window using Tauri v2. This section is **only needed if you want to build/run the desktop app** — the web UI works without any of this.

### Additional Prerequisites

- [Rust](https://rustup.rs) toolchain (`rustup`, `cargo`, `rustc`)
- Tauri CLI v2:
  ```sh
  cargo install tauri-cli --version "^2"
  ```
- System dependencies (Linux only):
  ```sh
  # Debian/Ubuntu
  sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
  ```

### Build & Run

```sh
# Development
bun run tauri:dev

# Production build
bun run tauri:build
```

The desktop build compiles the Bun server into a standalone sidecar binary and bundles the SvelteKit frontend as static files. The Tauri shell spawns the server on launch and loads the frontend in a native webview.

### How it works

1. SvelteKit builds to static HTML/JS via `adapter-static`
2. The Bun server compiles to a standalone binary via `bun build --compile`
3. Tauri bundles both into a native app with the server as a sidecar process
4. On launch, the app spawns the server, waits for it to be ready, then loads the UI

## Scripts

| Script                     | Description                                  |
| -------------------------- | -------------------------------------------- |
| `bun run dev`              | Start both client and server in dev mode     |
| `bun run dev:client`       | Start only the SvelteKit dev server          |
| `bun run dev:server`       | Start only the API server                    |
| `bun run start`            | Build client + serve everything on port 3002 |
| `bun run build`            | Build all packages                           |
| `bun run build:desktop`    | Build static client + compiled server binary |
| `bun run build:standalone` | Build standalone single-binary distribution  |
| `bun run tauri:dev`        | Run desktop app in development               |
| `bun run tauri:build`      | Build production desktop installer           |
| `bun run check`            | Type-check all packages                      |
| `bun run test`             | Run tests across all packages                |
| `bun run test:coverage`    | Run tests with coverage reporting            |
| `bun run format`           | Format all files with Prettier               |
| `bun run format:check`     | Check formatting without writing changes     |

## License

MIT
