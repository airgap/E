/**
 * PRD event emitter — lightweight pub/sub for PRD mutation notifications.
 *
 * Used by crud.ts to broadcast changes and by the SSE endpoint to stream
 * them to connected clients.
 */

import { EventEmitter } from 'events';

export interface PrdEvent {
  type:
    | 'prd_created'
    | 'prd_updated'
    | 'prd_deleted'
    | 'story_added'
    | 'story_updated'
    | 'story_deleted'
    | 'stories_archived';
  prdId: string;
  storyId?: string;
  workspacePath?: string;
  ts: number;
}

/** Persist across Bun --hot reloads */
const GLOBAL_KEY = '__e_prdEvents';

export const prdEvents: EventEmitter =
  (globalThis as any)[GLOBAL_KEY] ?? ((globalThis as any)[GLOBAL_KEY] = new EventEmitter());
