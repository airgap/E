# Install

E comes in two flavors — pick what fits.

## E Server

The small standalone binary. One line drops `e` in `~/.e/bin/e` and wires `$PATH`:

```
curl -fsSL https://raw.githubusercontent.com/airgap/E/dev/install.sh | bash
```

Then:

```
e             # serve on :3002 and open a browser
e --headless  # serve only, no window — remote boxes, CI, phone over Tailscale
```

`PORT=8080 e` for a custom port. Pin a release: `… | bash -s v0.2.4`. This is the build behind Remote-SSH workspaces and the mobile/browser experience.

## E Desktop

The native app (Electron) — a real window. Download for your platform from [GitHub Releases](https://github.com/airgap/E/releases): `.deb` / `.rpm` (Linux), `.dmg` (macOS), `.exe` (Windows).

→ [welcome.md](welcome.md)
