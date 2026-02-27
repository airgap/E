# Real-Time Streaming Visibility System

## Problem Solved

Previously, when Claude made responses with many tool calls (10+, 20+, etc.), users wouldn't see ANY visual progress until the entire response was complete. This led to a poor user experience where users had no feedback on what was happening.

## Solution Implemented

A new **Tool Call Tracker** component that provides real-time visual feedback as Claude executes tools, showing:

- Live progress bar (0-100%)
- Count of completed/pending/running/errored tools
- Individual tool status (✓ completed, ⟳ running, ✕ error)
- Execution duration for each tool
- Automatic compact/detailed view based on tool count

## New Component: ToolCallTracker.svelte

### Location

`packages/client/src/lib/components/chat/ToolCallTracker.svelte` (314 lines)

### Features

#### 1. **Real-Time Progress Bar**

- Shows completion percentage (0-100%)
- Gradient color (primary → secondary accent)
- Updates as tools complete
- Smooth animated transitions

#### 2. **Tool Count Display**

- Shows "X/Y" completed
- Displays error count in red
- Updates live as tools finish

#### 3. **Detailed View (≤5 tools)**

Shows individual tool items with:

- Tool name
- Status icon (✓, ⟳, ✕, ○)
- Execution duration (in seconds)
- Individual status coloring

#### 4. **Compact View (>5 tools)**

Shows summary stats instead of full list:

- ✓ Completed: X
- ⟳ Running: X
- ✕ Errors: X

### Visual Design

**Styling:**

- Uses existing E theme variables
- Matches application color scheme
- Left border accent (primary color)
- Semi-transparent background (tertiary)
- Smooth slide-in animation on appearance

**Color Coding:**

- Green (✓): Completed tools
- Blue (⟳): Running/pending tools
- Red (✕): Tools with errors

## How It Works

### Data Flow

1. **Tool Detection**: ToolCallTracker scans `streamStore.contentBlocks` for tool_use blocks
2. **Status Tracking**: Each tool's status is derived from:
   - `streamStore.toolResults.has(toolId)` → completed/error
   - Current block index in streaming → running
   - Missing result → pending
3. **Real-Time Updates**: As streaming updates, tracker automatically refreshes
4. **Integration**: Automatically shown in `StreamingMessage` (no user setup needed)

### Status States

```
pending  ○ Tool identified but not yet running
running  ⟳ Tool actively executing (blue spinner)
completed ✓ Tool finished successfully (green)
error    ✕ Tool failed (red)
```

### Progress Calculation

```
Progress % = (Completed Tools / Total Tools) × 100
Updated on each: tool_result, content_block_start, content_block_stop
```

## User Experience

### Scenario 1: Few Tools (2-5)

```
TOOL EXECUTION                          2/5
████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 40%

✓ read_file                      0.2s
⟳ analyze_code
✕ format_result                  error
○ git_status
○ create_commit
```

### Scenario 2: Many Tools (20+)

```
TOOL EXECUTION                         18/20
██████████████████░░░░░░░░░░░░░░░░░░░░ 90%

✓ Completed         18
⟳ Running            1
✕ Errors             1
```

## Integration Points

### Modified Files

1. **StreamingMessage.svelte**
   - Added import: `import ToolCallTracker from './ToolCallTracker.svelte'`
   - Added component: `<ToolCallTracker />` at top of message-body
   - Shows automatically when tools are present

### Automatic Display

ToolCallTracker is always present but:

- Only renders when `totalTools > 0`
- Updates reactively as streaming progresses
- No configuration needed
- No performance impact when no tools

## Performance

- **Rendering**: O(n) where n = number of tools
- **Updates**: Debounced via Svelte reactivity
- **Memory**: Minimal (derives from existing store state)
- **Animation**: GPU-accelerated CSS animations

### Optimization for Large Tool Counts

- Switches to compact view at 5+ tools
- Reduces DOM elements from O(n) to O(1)
- Still shows all important metrics
- No visible performance degradation with 20+ tools

## Accessibility

✓ Color-coded with icons (not color-alone)
✓ Semantic HTML structure
✓ Clear progress percentage display
✓ Readable contrast ratios
✓ Keyboard accessible (no JS interactions needed)

## Customization

### Changing Compact Threshold

In `ToolCallTracker.svelte`, change this line:

```typescript
{#if totalTools > 5}  // Change 5 to your preferred threshold
```

### Styling

All animations and colors use CSS variables, responding to theme changes automatically:

- `--accent-primary` (running indicator)
- `--accent-secondary` (completion indicator)
- `--accent-error` (error indicator)
- `--bg-primary`, `--bg-tertiary` (backgrounds)

### Custom Icons

Replace status icons in the template:

```svelte
{#if tool.status === 'completed'}
  ✓ <!-- Change this -->
{/if}
```

## Browser Compatibility

All animations use standard CSS3:

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Troubleshooting

### Tracker Not Showing

**Issue**: Tool execution happening but no tracker visible

**Solution**:

- Ensure `streamStore.contentBlocks` contains tool_use blocks
- Check browser console for errors
- Verify streaming is active (`streamStore.isStreaming === true`)

### Incorrect Tool Count

**Issue**: Tool count doesn't match expected

**Solution**:

- Only counts `type === 'tool_use'` blocks
- Agent group tasks also appear as tool_use
- Check `contentBlocks` in Svelte DevTools

### Progress Stuck at 0%

**Issue**: Progress bar not updating

**Solution**:

- Verify tool results are being stored: `streamStore.toolResults.get(toolId)`
- Check that `tool_result` events are firing
- Look for errors in tool execution

## Future Enhancements

### Potential Additions

1. **Tool Execution Timeline**
   - Visual timeline showing tool execution order
   - Waterfall diagram for parallel vs sequential tools

2. **Tool Filtering**
   - Option to hide/show specific tool types
   - Filter by status (show only errors, etc.)

3. **Tool Details**
   - Expandable details for each tool
   - Input parameters display
   - Result preview

4. **Statistics**
   - Average execution time
   - Slowest tool identification
   - Success rate percentage

5. **Preferences**
   - User toggle to show/hide tracker
   - Compact/detailed view preference
   - Auto-collapse after completion

## Testing Recommendations

### Manual Testing

1. **Single Tool**: Run response with 1 tool_call
   - ✓ Tracker appears
   - ✓ Shows "1/1"
   - ✓ Displays tool name
   - ✓ Updates to completed

2. **Multiple Tools**: Run response with 3-5 tools
   - ✓ Detailed view shows each tool
   - ✓ Progress bar updates smoothly
   - ✓ Durations display correctly
   - ✓ Errors show in red

3. **Many Tools**: Run response with 20+ tools
   - ✓ Switches to compact view
   - ✓ Shows summary stats
   - ✓ Progress accurate
   - ✓ No performance issues

4. **Mixed Results**: Some tools succeed, some error
   - ✓ Error count displayed
   - ✓ Error tools highlighted in red
   - ✓ Success rate accurate

### Automated Testing

Properties to test:

- Tool count calculation
- Status determination logic
- Progress percentage accuracy
- View switching at threshold
- Reactive updates

## Code Structure

### Key Functions

```typescript
let toolCalls = $derived.by(() => {
  // Derived state: scan contentBlocks for tool_use
  // Determine status from toolResults map
  // Return sorted array of tool info
});

let progressPercent = $derived(
  totalTools > 0 ? Math.round((completedTools / totalTools) * 100) : 0,
);
```

### Reactive Tracking

All metrics are derived reactively:

- Updates when `streamStore.contentBlocks` changes
- Updates when `streamStore.toolResults` changes
- Updates when `streamStore.status` changes
- No manual trigger needed

## Related Components

- **StreamingMessage.svelte**: Parent component
- **ToolCallBlock.svelte**: Individual tool display
- **stream.svelte.ts**: Store with tool data
- **sse.ts**: Real-time streaming handler

---

**Now users see live progress even with complex multi-tool responses!** 🚀✨
