/**
 * Shared helper for command-source plugin contributions
 * (LYK-1046/1047/1048/1049/1050/1051/1052/1053/1054).
 *
 * The first command-source services (plugin-hovers, plugin-diagnostics,
 * plugin-formatter, plugin-document-symbols) each rolled their own copy
 * of the same plumbing: install-dir-relative argv0 resolution, extension
 * gating, sandboxed spawn, capped stdout, timeout. This module factors
 * those primitives out so every new bridge source ships ~30 lines of
 * source-specific glue (contribution shape + result parse) on top of a
 * shared runtime.
 */
import { resolve, sep, extname } from 'node:path';
import { existsSync } from 'node:fs';

type SpawnFn = typeof Bun.spawn;
let spawnFn: SpawnFn = Bun.spawn;

/** Test seam — services can call this through their own __setSpawnForTests. */
export function __setSharedSpawnForTests(fn: SpawnFn | null): void {
  spawnFn = fn ?? Bun.spawn;
}

/** Common shape we expect every contribution to expose. */
export interface CommandContributionShape {
  source?: 'command' | 'lsp';
  command?: string[];
  extensions?: string[];
}

/** True iff this contribution should run for `absPath`. */
export function contributionAppliesTo(c: CommandContributionShape, absPath: string): boolean {
  if (c.source !== 'command') return false;
  if (!c.command || c.command.length === 0) return false;
  const exts = c.extensions ?? [];
  if (exts.length === 0) return false;
  if (exts.includes('*')) return true;
  const ext = extname(absPath).toLowerCase();
  return exts.some((e) => e.toLowerCase() === ext);
}

/**
 * Resolve a plugin-relative argv0 inside `installPath`. Refuses absolute
 * paths and existsSync-checks the result so malformed manifests fail
 * fast instead of erroring out mid-spawn.
 */
export function resolvePluginBinary(installPath: string, arg0: string): string | null {
  if (!arg0) return null;
  if (arg0.startsWith('/')) return null;
  const r = resolve(installPath, arg0);
  const base = resolve(installPath);
  if (!r.startsWith(base + sep) && r !== base) return null;
  if (!existsSync(r)) return null;
  return r;
}

/**
 * Drain a stream up to `cap` bytes; anything past that is dropped. Used
 * for stdout reads where unbounded growth from a misbehaving plugin
 * would block the server.
 */
export async function readCapped(
  stream: ReadableStream<Uint8Array> | null,
  cap: number,
): Promise<string> {
  if (!stream) return '';
  const dec = new TextDecoder();
  const reader = stream.getReader();
  let total = 0;
  let out = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > cap) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        break;
      }
      out += dec.decode(value, { stream: true });
    }
  } catch {
    /* ignore */
  }
  out += dec.decode();
  return out;
}

export interface RunOptions {
  /** Absolute path to the binary inside the plugin install dir. */
  bin: string;
  /** Working directory — typically the plugin install dir. */
  cwd: string;
  /** Trailing argv after the binary, appended as-is. */
  argv: string[];
  /** Optional content piped to stdin. Empty/undefined = no stdin write. */
  stdin?: string;
  /** Wall-clock ms before kill(). */
  timeoutMs: number;
  /** Max stdout bytes; further bytes silently dropped. */
  stdoutCap: number;
  /**
   * Optional per-line callback fired as newline-delimited stdout arrives
   * (LYK-1055 streaming). When set, the read loop splits on '\n' and calls
   * this for each complete line as soon as it's available, in addition to
   * returning the full buffered stdout at the end. The trailing partial
   * line (if any) is flushed on close.
   */
  onLine?: (line: string) => void;
}

export interface RunResult {
  /** Captured stdout (utf-8). */
  stdout: string;
  /**
   * Best-effort exit code; absent when the spawn itself failed before
   * yielding a process.
   */
  exitCode?: number;
}

/**
 * Spawn a plugin binary with the given argv, optionally piping content
 * to stdin, and return the captured stdout. Stderr is read with the same
 * cap but currently discarded — callers can switch to capture if they
 * need to surface plugin diagnostics back to the user.
 *
 * Errors during spawn / timeout / read are smothered to null at the
 * caller; this function just returns whatever stdout it managed to
 * collect.
 */
export async function runPluginBinary(opts: RunOptions): Promise<RunResult | null> {
  let proc: ReturnType<SpawnFn>;
  try {
    proc = spawnFn({
      cmd: [opts.bin, ...opts.argv],
      cwd: opts.cwd,
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: 'pipe',
    });
  } catch {
    return null;
  }
  if (opts.stdin !== undefined) {
    try {
      const stdin = proc.stdin as { write: (chunk: Uint8Array) => unknown; end: () => unknown };
      if (stdin && typeof stdin.write === 'function') {
        stdin.write(new TextEncoder().encode(opts.stdin));
        stdin.end();
      }
    } catch {
      /* ignore — fall through and read whatever it produced */
    }
  }
  const killer = setTimeout(() => {
    try {
      proc.kill();
    } catch {
      /* ignore */
    }
  }, opts.timeoutMs);
  let stdout = '';
  let exitCode: number | undefined;
  try {
    if (opts.onLine) {
      // Streaming read: emit complete lines as they arrive, still capping
      // total bytes and accumulating the full buffer for the return value.
      stdout = await readCappedStreaming(
        proc.stdout as ReadableStream<Uint8Array> | null,
        opts.stdoutCap,
        opts.onLine,
      );
    } else {
      stdout = await readCapped(proc.stdout as ReadableStream<Uint8Array> | null, opts.stdoutCap);
    }
    exitCode = await proc.exited;
  } catch {
    return null;
  } finally {
    clearTimeout(killer);
  }
  return { stdout, exitCode };
}

/**
 * Like readCapped, but invokes `onLine` for each complete newline-
 * delimited line as it arrives. The trailing partial line is flushed
 * when the stream closes. Still enforces the byte cap on the returned
 * buffer (and stops emitting once capped).
 */
async function readCappedStreaming(
  stream: ReadableStream<Uint8Array> | null,
  cap: number,
  onLine: (line: string) => void,
): Promise<string> {
  if (!stream) return '';
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let out = '';
  let pending = '';
  let capped = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = dec.decode(value, { stream: true });
      if (!capped) {
        if (out.length + chunk.length > cap) {
          out += chunk.slice(0, cap - out.length);
          capped = true;
        } else {
          out += chunk;
        }
      }
      pending += chunk;
      let nl = pending.indexOf('\n');
      while (nl !== -1) {
        const line = pending.slice(0, nl);
        pending = pending.slice(nl + 1);
        try {
          onLine(line);
        } catch {
          /* a bad consumer must not break the read loop */
        }
        nl = pending.indexOf('\n');
      }
    }
    if (pending.trim()) {
      try {
        onLine(pending);
      } catch {
        /* ignore */
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
  return out;
}
