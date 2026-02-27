# Svelte 5 Reactivity Fix: The Real Solution

## Problem

The refactored approach of exporting $state variables in an object literal failed because Svelte 5 syntax rules don't allow $state() outside of variable declarations and class fields.

## Key Insight

The issue isn't actually with the store pattern itself. The real issue is that Svelte 5 properly tracks `$state` through the closure scope within `createStreamStore()`, but we need to ensure components are reading the state in a way that Svelte can track.

## The Actual Fix

Instead of trying to export $state directly (which violates Svelte syntax), we should:

1. **Keep the store structure as-is** - the getter pattern is fine
2. **Fix the component reactivity** by using `$effect.tracking()` to ensure proper dependency tracking
3. **Add explicit $state subscriptions** in components that display streaming content

## Why the Current Pattern Actually Works

```typescript
function createStreamStore() {
  let contentBlocks = $state<MessageContent[]>([]); // $state declared in closure

  return {
    get contentBlocks() {
      return contentBlocks; // Returns the $state variable
    },
    // ... methods that reassign contentBlocks
  };
}
```

This is actually valid Svelte 5 code. The $state is properly scoped and methods properly mutate it.

## The Real Problem

In StreamingMessage.svelte, when we do:

```typescript
let grouped = $derived.by(() => {
  const blocks = streamStore.contentBlocks; // Getting value through getter
  // ... use blocks
});
```

The issue is that `streamStore.contentBlocks` returns the VALUE at that moment, not a reactive reference. Svelte doesn't know that the underlying state changed.

## The Solution: Two Approaches

### Approach 1: Force Re-evaluation (Quick Fix)

Keep streamStore as-is, but explicitly touch reactive dependencies in components:

```svelte
<script>
  let _trigger = $state(0);

  let grouped = $derived.by(() => {
    _trigger; // Just reading it forces Svelte to track
    const blocks = streamStore.contentBlocks;
    // ...
  });

  // Increment _trigger whenever we need components to re-render
</script>
```

This is hacky but would work immediately.

### Approach 2: Use Svelte's Context API (Proper Fix)

Use Svelte's built-in context system for reactive stores:

```typescript
import { setContext, getContext } from 'svelte';

// Store
function createStreamStore() {
  let contentBlocks = $state<MessageContent[]>([]);
  // ...
}

const streamStore = createStreamStore();
setContext('streamStore', streamStore);

// Component
const streamStore = getContext('streamStore');
let grouped = $derived.by(() => {
  const blocks = streamStore.contentBlocks;
  // Now Svelte properly tracks the dependency
});
```

### Approach 3: Manual Subscription Pattern (Most Robust)

Similar to Svelte stores, create a subscription system:

```typescript
export function createStreamStore() {
  let subscribers: Set<() => void> = new Set();
  let contentBlocks = $state<MessageContent[]>([]);

  return {
    subscribe(fn: () => void) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    get contentBlocks() {
      return contentBlocks;
    },
    // On mutations:
    handleEvent(event) {
      contentBlocks = [...contentBlocks, newBlock];
      subscribers.forEach((fn) => fn()); // Notify subscribers
    },
  };
}

// Component:
const streamStore = getContext('streamStore');
onMount(() => {
  const unsubscribe = streamStore.subscribe(() => {
    // Force recalculation when store notifies
  });
  return unsubscribe;
});

let grouped = $derived.by(() => {
  return buildGrouped(streamStore.contentBlocks);
});
```

## Recommended Fix

Use **Approach 2 (Context API)** because:

1. ✅ It's the Svelte 5 recommended pattern
2. ✅ It's built-in and requires no changes to stream.svelte.ts structure
3. ✅ It properly tracks dependencies through Svelte's reactivity system
4. ✅ It scales well to other stores

## Implementation Steps for Context API Fix

1. In stream.svelte.ts, export the store and mark it for context:

```typescript
export const streamStore = createStreamStore();
export const STREAM_CONTEXT_KEY = 'streamStore';
```

2. In the root layout or app component, set context:

```svelte
<script>
  import { streamStore, STREAM_CONTEXT_KEY } from '$lib/stores/stream.svelte';
  import { setContext } from 'svelte';

  setContext(STREAM_CONTEXT_KEY, streamStore);
</script>
```

3. In components that need reactive streaming:

```svelte
<script>
  import { getContext } from 'svelte';
  import { STREAM_CONTEXT_KEY } from '$lib/stores/stream.svelte';

  const streamStore = getContext(STREAM_CONTEXT_KEY);

  let grouped = $derived.by(() => {
    const blocks = streamStore.contentBlocks;
    // Svelte now properly tracks this as depending on streamStore
    return buildGrouped(blocks);
  });
</script>
```

## Why This Fixes the Streaming Issue

With the Context API:

1. Components properly subscribe to the store object
2. When `streamStore.contentBlocks = [...]` executes, Svelte marks the context value as changed
3. Any component using getContext() is notified
4. The `$derived.by()` re-runs because it depends on streamStore
5. `grouped` is recalculated with new content blocks
6. UI renders the new message content

## Testing the Fix

1. Send a message
2. Messages should appear character-by-character
3. Console logs should show `[StreamingMessage] $derived recalculating` in real-time
4. No need to reload page

## Files to Modify

1. **stream.svelte.ts**: Add context key export (minimal change)
2. **+layout.svelte** or root component: Set context once
3. **StreamingMessage.svelte**: Use getContext instead of direct import
4. Optionally other components that display streaming content

This is a clean, Svelte 5-idiomatic solution that requires minimal code changes.
