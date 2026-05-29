/**
 * Tiny boolean expression evaluator for plugin `when` clauses
 * (LYK-1031 / LYK-1032).
 *
 * Supports an allowlisted identifier set plus the operators `!`, `&&`,
 * `||`, and parenthesized grouping. Identifiers resolve through a
 * snapshot of host state (collected lazily so re-evaluating against new
 * state is cheap). Unknown identifiers and parse errors evaluate to
 * `false`, which matches VS Code's permissive semantics for malformed
 * plugin expressions.
 *
 * Why a hand-rolled parser instead of `new Function(expr)`: plugin
 * authors supply these strings, and there's no benefit to letting them
 * eval arbitrary JavaScript in the renderer. Restricting the grammar
 * gives us a tight contract we can extend later without changing the
 * surface plugins target.
 */

import { uiStore } from './ui.svelte';
import { editorStore } from './editor.svelte';
import { terminalStore } from './terminal.svelte';
import { dapStore } from './dap.svelte';
import { streamStore } from './stream.svelte';
import { conversationStore } from './conversation.svelte';

/**
 * Allowlisted identifier set. Each entry returns a boolean drawn from
 * a host store, evaluated at call time so the expression always reads
 * fresh state. Add new entries here as plugin authors need them.
 */
const HOST_STATE_KEYS: Record<string, () => boolean> = {
  editorFocus: () => editorStore.activeTab !== null,
  hasActiveEditor: () => editorStore.activeTab !== null,
  hasOpenTabs: () => editorStore.hasOpenTabs,
  sidebarOpen: () => uiStore.sidebarOpen,
  terminalOpen: () => terminalStore.isOpen,
  zenMode: () => uiStore.zenMode,
  debugActive: () => dapStore.isActive,
  debugStopped: () => dapStore.state === 'stopped',
  debugRunning: () => dapStore.state === 'running',
  streaming: () => streamStore.isStreaming,
  hasActiveConversation: () => conversationStore.activeId !== null,
};

interface Token {
  kind: '!' | '&&' | '||' | '(' | ')' | 'id';
  value?: string;
}

function tokenize(input: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }
    if (ch === '!') {
      out.push({ kind: '!' });
      i++;
      continue;
    }
    if (ch === '(') {
      out.push({ kind: '(' });
      i++;
      continue;
    }
    if (ch === ')') {
      out.push({ kind: ')' });
      i++;
      continue;
    }
    if (ch === '&' && input[i + 1] === '&') {
      out.push({ kind: '&&' });
      i += 2;
      continue;
    }
    if (ch === '|' && input[i + 1] === '|') {
      out.push({ kind: '||' });
      i += 2;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < input.length && /[A-Za-z0-9_]/.test(input[j])) j++;
      out.push({ kind: 'id', value: input.slice(i, j) });
      i = j;
      continue;
    }
    // Any other character is a parse error — caller maps to false.
    throw new Error(`unexpected character '${ch}' at offset ${i}`);
  }
  return out;
}

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): boolean {
    const v = this.parseOr();
    if (this.pos !== this.tokens.length) {
      throw new Error(`unexpected trailing token at index ${this.pos}`);
    }
    return v;
  }

  /** Lowest precedence: a || b */
  private parseOr(): boolean {
    let left = this.parseAnd();
    while (this.peek('||')) {
      this.pos++;
      const right = this.parseAnd();
      left = left || right;
    }
    return left;
  }

  /** Higher precedence: a && b */
  private parseAnd(): boolean {
    let left = this.parseNot();
    while (this.peek('&&')) {
      this.pos++;
      const right = this.parseNot();
      left = left && right;
    }
    return left;
  }

  /** Unary: !x */
  private parseNot(): boolean {
    if (this.peek('!')) {
      this.pos++;
      return !this.parseNot();
    }
    return this.parsePrimary();
  }

  /** Atom: identifier or parenthesized expression. */
  private parsePrimary(): boolean {
    const tok = this.tokens[this.pos];
    if (!tok) throw new Error('unexpected end of expression');
    if (tok.kind === '(') {
      this.pos++;
      const v = this.parseOr();
      if (!this.peek(')')) throw new Error('missing close paren');
      this.pos++;
      return v;
    }
    if (tok.kind === 'id') {
      this.pos++;
      const resolver = HOST_STATE_KEYS[tok.value!];
      if (!resolver) return false; // unknown identifier → false (VS Code semantics)
      return resolver();
    }
    throw new Error(`unexpected token kind '${tok.kind}'`);
  }

  private peek(kind: Token['kind']): boolean {
    return this.tokens[this.pos]?.kind === kind;
  }
}

/**
 * Evaluate a plugin `when` expression. Empty / undefined / unparseable
 * expressions evaluate to `true` (match-always) — matches VS Code's
 * "no when clause → always active" semantics.
 */
export function evaluateWhen(expr: string | undefined | null): boolean {
  if (!expr || !expr.trim()) return true;
  try {
    const tokens = tokenize(expr);
    if (tokens.length === 0) return true;
    return new Parser(tokens).parse();
  } catch {
    return false;
  }
}

/** List of host identifiers plugin authors can reference. Surfaced in docs / dev tools. */
export function whenIdentifiers(): string[] {
  return Object.keys(HOST_STATE_KEYS).sort();
}
