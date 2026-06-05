# Install

One line. Drops the `e` binary in `~/.e/bin/e`, wires `$PATH`, and adds a launcher. Then run `e`.

```
curl -fsSL https://raw.githubusercontent.com/airgap/E/dev/install.sh | bash
```

Pin a specific release by passing a tag:

```
curl -fsSL https://raw.githubusercontent.com/airgap/E/dev/install.sh | bash -s v0.2.4
```

## Prebuilt binaries

Standalone, `.deb`, and `.rpm` builds — Linux (x64 / arm64), macOS (arm64), Windows (x64) — are on [GitHub Releases](https://github.com/airgap/E/releases).

## Run it

```
e
```

Starts the single-process server — open `http://localhost:3002`, or use the desktop app. Set `PORT=8080 e` to change the port.

→ [welcome.md](welcome.md)
