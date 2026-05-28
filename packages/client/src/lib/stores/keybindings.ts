/**
 * Keybinding match helpers (LYK-1031).
 *
 * v1 supports single-chord bindings only: "ctrl+shift+x", "cmd+k",
 * "alt+f5". Multi-stroke chords ("cmd+k cmd+s") are recognised at parse
 * time but never match against a single KeyboardEvent — the chord state
 * machine lands with whichever menu/keybinding feature first needs it.
 *
 * `when` expressions are not interpreted yet — bindings with a `when`
 * clause are still matched against the keystroke but the host treats the
 * clause as "always true". That's safe enough for v1: plugin authors
 * shipping a keybinding without a working `when` will see it fire more
 * eagerly than VS Code, not less.
 */

export interface ParsedKeystroke {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  /** Lowercase canonical key (e.g. "x", "f5", "arrowup"). */
  key: string;
}

const MOD_ALIASES: Record<string, keyof Omit<ParsedKeystroke, 'key'>> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  shift: 'shift',
  alt: 'alt',
  meta: 'meta',
  cmd: 'meta',
  command: 'meta',
  win: 'meta',
  super: 'meta',
};

/** Parse a single-chord binding into modifiers + key. */
export function parseKeystroke(input: string): ParsedKeystroke | null {
  if (!input) return null;
  const out: ParsedKeystroke = {
    ctrl: false,
    shift: false,
    alt: false,
    meta: false,
    key: '',
  };
  const parts = input
    .toLowerCase()
    .split('+')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  for (const p of parts) {
    const modSlot = MOD_ALIASES[p];
    if (modSlot) {
      out[modSlot] = true;
    } else {
      // Only the final segment can be the key; if we already saw one,
      // the binding is malformed.
      if (out.key) return null;
      out.key = p;
    }
  }
  return out.key ? out : null;
}

/** True when a KeyboardEvent matches a parsed chord. */
export function keystrokeMatches(stroke: ParsedKeystroke, e: KeyboardEvent): boolean {
  if (stroke.ctrl !== e.ctrlKey) return false;
  if (stroke.shift !== e.shiftKey) return false;
  if (stroke.alt !== e.altKey) return false;
  if (stroke.meta !== e.metaKey) return false;
  const key = e.key.toLowerCase();
  return stroke.key === key;
}

/** True when running on macOS (drives `mac` field preference). */
export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || '');
}

/**
 * Pick the per-OS binding string. Honors a `mac` override on macOS,
 * otherwise falls back to the cross-platform `key`. Returns an empty
 * string when neither is set.
 */
export function pickKeybindingForOS(binding: { key: string; mac?: string }): string {
  if (isMac() && binding.mac) return binding.mac;
  return binding.key ?? '';
}
