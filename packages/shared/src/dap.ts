/**
 * Debug Adapter Protocol (DAP) shared types.
 *
 * The launch.json schema mirrors VS Code's launch.json: a list of named
 * configurations per adapter type. The runtime forwards each config object
 * verbatim to the adapter's `launch` request, so all fields beyond the
 * minimum required ones are adapter-specific.
 */

export interface LaunchConfig {
  /** Display name in the picker. */
  name: string;
  /** Adapter id (e.g. 'python', 'node'). */
  type: string;
  /** 'launch' starts a new debuggee; 'attach' connects to an existing one. */
  request: 'launch' | 'attach';
  /** Path to the program to debug. Adapter-specific semantics. */
  program?: string;
  /** Command-line arguments passed to the program. */
  args?: string[];
  /** Working directory for the launched program. */
  cwd?: string;
  /** Environment variables (key/value) merged into the launched program. */
  env?: Record<string, string>;
  /** Where to send stdout/stderr (adapter-specific; e.g. 'integratedTerminal'). */
  console?: string;
  /** Adapter-specific extensions are tolerated and forwarded verbatim. */
  [k: string]: unknown;
}

export interface LaunchFile {
  /** Schema version — currently '1', kept for forward-compat. */
  version?: string;
  /** Saved configurations the picker offers. */
  configurations: LaunchConfig[];
  /**
   * Compound configurations (LYK-1020 follow-up) — a single picker entry
   * that starts multiple named configurations at once. Not consumed yet.
   */
  compounds?: Array<{
    name: string;
    configurations: string[];
  }>;
}
