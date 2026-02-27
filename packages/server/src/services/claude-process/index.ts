/**
 * Claude Process Management — decomposed into focused modules:
 *
 *   spawner.ts          — CliProcess interface, spawnWithScript/spawnWithPipe, shell helpers
 *   event-translator.ts — translateCliEvent(), extractAndStoreArtifacts()
 *   manager.ts          — ClaudeProcessManager class (session lifecycle, SSE streaming)
 *
 * This barrel file re-exports the public API so existing imports continue to work:
 *   import { translateCliEvent, claudeManager } from '../services/claude-process';
 */

export { translateCliEvent } from './event-translator';
export { ClaudeProcessManager } from './manager';

import { ClaudeProcessManager } from './manager';

// Persist across Bun --hot reloads: store the singleton on globalThis so
// a module re-evaluation doesn't orphan running CLI processes.
// Also refresh the prototype so new methods (like injectEvent) are available
// on existing instances after HMR updates the class definition.
const GLOBAL_KEY = '__e_claudeManager';
const existing = (globalThis as any)[GLOBAL_KEY] as ClaudeProcessManager | undefined;
if (existing) {
  Object.setPrototypeOf(existing, ClaudeProcessManager.prototype);
}
export const claudeManager: ClaudeProcessManager =
  existing ?? ((globalThis as any)[GLOBAL_KEY] = new ClaudeProcessManager());
