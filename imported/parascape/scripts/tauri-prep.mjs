// Prepares the Tauri bundle inputs:
//   1. builds the site (dist/) — the desktop payload
//   2. stages the Parabun runtime as the Tauri sidecar
//      (src-tauri/binaries/parabun-<host-target-triple>)
// Run via `bun run tauri:prep` (invoked by tauri:build / tauri:dev).
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync, realpathSync, chmodSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

// 1. host target triple (Tauri names sidecars `<name>-<triple>`)
const vv = execSync("rustc -vV", { encoding: "utf8" });
const triple = (vv.match(/host:\s*(\S+)/) || [])[1];
if (!triple) throw new Error("could not determine host target triple from `rustc -vV`");

// 2. locate the parabun binary (env override, then PATH, then local spots)
let onPath = "";
try {
  onPath = execSync("command -v parabun", { encoding: "utf8" }).trim();
} catch {}
const candidates = [
  process.env.PARABUN_BIN,
  onPath,
  "/usr/local/bin/parabun",
  resolve(root, "../parabun/build/release/bun"),
].filter(Boolean);
const src = candidates.find(p => p && existsSync(p));
if (!src) throw new Error(`parabun binary not found (looked in: ${candidates.join(", ")}). Set PARABUN_BIN.`);
const real = realpathSync(src);

// 3. build the site (PARASCAPE_RUNNER lets CI use `parabun` where `bun` isn't on PATH)
const runner = process.env.PARASCAPE_RUNNER || "bun";
console.log(`[tauri-prep] building dist with ${runner}…`);
execSync(`${runner} run build`, { cwd: root, stdio: "inherit" });

// 4. stage the sidecar
const binDir = resolve(root, "src-tauri/binaries");
mkdirSync(binDir, { recursive: true });
const dest = resolve(binDir, `parabun-${triple}`);
copyFileSync(real, dest);
chmodSync(dest, 0o755);
console.log(`[tauri-prep] staged sidecar: ${dest}`);
console.log("[tauri-prep] ready — run `bun run tauri:build` (or it runs automatically).");
